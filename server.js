const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Supabase setup
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://bwybtkrfgepsoeuvxvmf.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ3eWJ0a3JmZ2Vwc29ldXZ4dm1mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIwNjIzMzcsImV4cCI6MjA4NzYzODMzN30.aF5KTncfws-grjCkgwQD47fUSkTuJC6-gJMhB0JC0F4';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Helper to get today's date string
function getTodayString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// ===== API ROUTES =====

// Create a new league
app.post('/api/leagues', async (req, res) => {
    const { name } = req.body;
    if (!name || !name.trim()) {
        return res.status(400).json({ error: 'League name is required' });
    }

    const id = uuidv4().slice(0, 8);

    const { error } = await supabase
        .from('leagues')
        .insert({ id, name: name.trim() });

    if (error) {
        console.error('Error creating league:', error);
        return res.status(500).json({ error: 'Failed to create league' });
    }

    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const url = `${protocol}://${host}/league/${id}`;

    res.json({ id, name: name.trim(), url });
});

// Get league info
app.get('/api/leagues/:id', async (req, res) => {
    const { id } = req.params;

    const { data: league, error } = await supabase
        .from('leagues')
        .select('*')
        .eq('id', id)
        .single();

    if (error || !league) {
        return res.status(404).json({ error: 'League not found' });
    }

    const { count } = await supabase
        .from('league_memberships')
        .select('*', { count: 'exact', head: true })
        .eq('league_id', id);

    res.json({ ...league, memberCount: count || 0 });
});

// Join a league
app.post('/api/leagues/:id/join', async (req, res) => {
    const { id } = req.params;
    const { uuid, displayName } = req.body;

    if (!uuid || !displayName || !displayName.trim()) {
        return res.status(400).json({ error: 'UUID and display name are required' });
    }

    const { data: league, error: leagueError } = await supabase
        .from('leagues')
        .select('*')
        .eq('id', id)
        .single();

    if (leagueError || !league) {
        return res.status(404).json({ error: 'League not found' });
    }

    // Upsert player
    await supabase
        .from('players')
        .upsert({ uuid, display_name: displayName.trim() }, { onConflict: 'uuid' });

    // Add membership if not exists
    await supabase
        .from('league_memberships')
        .upsert({ player_uuid: uuid, league_id: id }, { onConflict: 'player_uuid,league_id', ignoreDuplicates: true });

    res.json({ success: true, league });
});

// Get leaderboard for a league
app.get('/api/leagues/:id/leaderboard', async (req, res) => {
    const { id } = req.params;
    const date = req.query.date || getTodayString();

    const { data: league, error: leagueError } = await supabase
        .from('leagues')
        .select('*')
        .eq('id', id)
        .single();

    if (leagueError || !league) {
        return res.status(404).json({ error: 'League not found' });
    }

    // Get all members with their player info
    const { data: memberships } = await supabase
        .from('league_memberships')
        .select('player_uuid, players(uuid, display_name)')
        .eq('league_id', id);

    // Get scores for this date
    const { data: scores } = await supabase
        .from('daily_scores')
        .select('*')
        .eq('league_id', id)
        .eq('date', date);

    // Build member list with scores
    const members = (memberships || []).map(m => {
        const score = (scores || []).find(s => s.player_uuid === m.player_uuid);
        return {
            uuid: m.player_uuid,
            display_name: m.players?.display_name || 'Unknown',
            mistakes: score?.mistakes ?? null,
            date: score?.date ?? null
        };
    });

    // Sort: played first (by mistakes), then not played (alphabetically)
    members.sort((a, b) => {
        if (a.mistakes !== null && b.mistakes !== null) {
            return a.mistakes - b.mistakes;
        }
        if (a.mistakes !== null) return -1;
        if (b.mistakes !== null) return 1;
        return a.display_name.localeCompare(b.display_name);
    });

    // Calculate ranks
    let currentRank = 0;
    let lastMistakes = null;
    let playedCount = 0;

    const leaderboard = members.map((member, index) => {
        if (member.mistakes !== null) {
            playedCount++;
            if (member.mistakes !== lastMistakes) {
                currentRank = playedCount;
                lastMistakes = member.mistakes;
            }
            return { ...member, rank: currentRank };
        }
        return { ...member, rank: null };
    });

    res.json({
        league,
        date,
        leaderboard
    });
});

// Record a score
app.post('/api/scores', async (req, res) => {
    const { uuid, date, mistakes } = req.body;

    if (!uuid || !date || mistakes === undefined) {
        return res.status(400).json({ error: 'UUID, date, and mistakes are required' });
    }

    // Get all leagues the player is in
    const { data: memberships } = await supabase
        .from('league_memberships')
        .select('league_id')
        .eq('player_uuid', uuid);

    if (!memberships || memberships.length === 0) {
        return res.json({ success: true, recorded: 0 });
    }

    let recorded = 0;

    for (const { league_id } of memberships) {
        const { error } = await supabase
            .from('daily_scores')
            .upsert(
                { player_uuid: uuid, league_id, date, mistakes },
                { onConflict: 'player_uuid,league_id,date' }
            );

        if (!error) recorded++;
    }

    res.json({ success: true, recorded });
});

// Get player's leagues with today's stats
app.get('/api/player/:uuid/leagues', async (req, res) => {
    const { uuid } = req.params;
    const today = getTodayString();

    const { data: memberships } = await supabase
        .from('league_memberships')
        .select('league_id, leagues(id, name)')
        .eq('player_uuid', uuid);

    if (!memberships || memberships.length === 0) {
        return res.json({ leagues: [] });
    }

    const leagues = await Promise.all(memberships.map(async m => {
        const { count: totalMembers } = await supabase
            .from('league_memberships')
            .select('*', { count: 'exact', head: true })
            .eq('league_id', m.league_id);

        const { count: playedToday } = await supabase
            .from('daily_scores')
            .select('*', { count: 'exact', head: true })
            .eq('league_id', m.league_id)
            .eq('date', today);

        return {
            id: m.league_id,
            name: m.leagues?.name || 'Unknown',
            total_members: totalMembers || 0,
            played_today: playedToday || 0
        };
    }));

    res.json({ leagues });
});

// Check if player is member of a league
app.get('/api/leagues/:id/membership/:uuid', async (req, res) => {
    const { id, uuid } = req.params;

    const { data } = await supabase
        .from('league_memberships')
        .select('*')
        .eq('league_id', id)
        .eq('player_uuid', uuid)
        .single();

    res.json({ isMember: !!data });
});

// Update player display name
app.put('/api/player/:uuid', async (req, res) => {
    const { uuid } = req.params;
    const { displayName } = req.body;

    if (!displayName || !displayName.trim()) {
        return res.status(400).json({ error: 'Display name is required' });
    }

    const { error } = await supabase
        .from('players')
        .upsert({ uuid, display_name: displayName.trim() }, { onConflict: 'uuid' });

    if (error) {
        console.error('Error updating player:', error);
        return res.status(500).json({ error: 'Failed to update player' });
    }

    res.json({ success: true });
});

// Serve index.html for all other routes (SPA-style routing)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`Connections UK server running at http://localhost:${PORT}`);
});
