const express = require('express');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// JSON file database
const DB_FILE = path.join(__dirname, 'data.json');

function loadDB() {
    try {
        if (fs.existsSync(DB_FILE)) {
            return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
        }
    } catch (error) {
        console.error('Error loading database:', error);
    }
    return {
        leagues: {},
        players: {},
        memberships: [], // { playerUuid, leagueId, joinedAt }
        scores: [] // { playerUuid, leagueId, date, mistakes, recordedAt }
    };
}

function saveDB(db) {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    } catch (error) {
        console.error('Error saving database:', error);
    }
}

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
app.post('/api/leagues', (req, res) => {
    const { name } = req.body;
    if (!name || !name.trim()) {
        return res.status(400).json({ error: 'League name is required' });
    }

    const db = loadDB();
    const id = uuidv4().slice(0, 8); // Short ID for URLs

    db.leagues[id] = {
        id,
        name: name.trim(),
        createdAt: new Date().toISOString()
    };

    saveDB(db);

    // Build dynamic URL based on request
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const url = `${protocol}://${host}/league/${id}`;

    res.json({ id, name: name.trim(), url });
});

// Get league info
app.get('/api/leagues/:id', (req, res) => {
    const { id } = req.params;
    const db = loadDB();

    const league = db.leagues[id];
    if (!league) {
        return res.status(404).json({ error: 'League not found' });
    }

    const memberCount = db.memberships.filter(m => m.leagueId === id).length;

    res.json({ ...league, memberCount });
});

// Join a league
app.post('/api/leagues/:id/join', (req, res) => {
    const { id } = req.params;
    const { uuid, displayName } = req.body;

    if (!uuid || !displayName || !displayName.trim()) {
        return res.status(400).json({ error: 'UUID and display name are required' });
    }

    const db = loadDB();

    const league = db.leagues[id];
    if (!league) {
        return res.status(404).json({ error: 'League not found' });
    }

    // Upsert player
    db.players[uuid] = {
        uuid,
        displayName: displayName.trim(),
        createdAt: db.players[uuid]?.createdAt || new Date().toISOString()
    };

    // Add membership if not exists
    const existingMembership = db.memberships.find(
        m => m.playerUuid === uuid && m.leagueId === id
    );

    if (!existingMembership) {
        db.memberships.push({
            playerUuid: uuid,
            leagueId: id,
            joinedAt: new Date().toISOString()
        });
    }

    saveDB(db);

    res.json({ success: true, league });
});

// Get leaderboard for a league
app.get('/api/leagues/:id/leaderboard', (req, res) => {
    const { id } = req.params;
    const date = req.query.date || getTodayString();

    const db = loadDB();

    const league = db.leagues[id];
    if (!league) {
        return res.status(404).json({ error: 'League not found' });
    }

    // Get all members
    const memberUuids = db.memberships
        .filter(m => m.leagueId === id)
        .map(m => m.playerUuid);

    // Get scores for this date
    const dateScores = db.scores.filter(
        s => s.leagueId === id && s.date === date
    );

    // Build member list with scores
    const members = memberUuids.map(uuid => {
        const player = db.players[uuid];
        const score = dateScores.find(s => s.playerUuid === uuid);
        return {
            uuid,
            display_name: player?.displayName || 'Unknown',
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

    const leaderboard = members.map((member, index) => {
        if (member.mistakes !== null) {
            if (member.mistakes !== lastMistakes) {
                currentRank = index + 1 - members.slice(0, index).filter(m => m.mistakes === null).length;
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
app.post('/api/scores', (req, res) => {
    const { uuid, date, mistakes } = req.body;

    if (!uuid || !date || mistakes === undefined) {
        return res.status(400).json({ error: 'UUID, date, and mistakes are required' });
    }

    const db = loadDB();

    // Get all leagues the player is in
    const playerLeagues = db.memberships
        .filter(m => m.playerUuid === uuid)
        .map(m => m.leagueId);

    if (playerLeagues.length === 0) {
        return res.json({ success: true, recorded: 0 });
    }

    let recorded = 0;

    for (const leagueId of playerLeagues) {
        // Check if score already exists
        const existingIndex = db.scores.findIndex(
            s => s.playerUuid === uuid && s.leagueId === leagueId && s.date === date
        );

        if (existingIndex >= 0) {
            // Update existing score
            db.scores[existingIndex].mistakes = mistakes;
            db.scores[existingIndex].recordedAt = new Date().toISOString();
        } else {
            // Add new score
            db.scores.push({
                playerUuid: uuid,
                leagueId,
                date,
                mistakes,
                recordedAt: new Date().toISOString()
            });
        }
        recorded++;
    }

    saveDB(db);

    res.json({ success: true, recorded });
});

// Get player's leagues with today's stats
app.get('/api/player/:uuid/leagues', (req, res) => {
    const { uuid } = req.params;
    const today = getTodayString();

    const db = loadDB();

    const playerLeagueIds = db.memberships
        .filter(m => m.playerUuid === uuid)
        .map(m => m.leagueId);

    const leagues = playerLeagueIds.map(leagueId => {
        const league = db.leagues[leagueId];
        if (!league) return null;

        const totalMembers = db.memberships.filter(m => m.leagueId === leagueId).length;
        const playedToday = db.scores.filter(
            s => s.leagueId === leagueId && s.date === today
        ).length;

        return {
            id: leagueId,
            name: league.name,
            total_members: totalMembers,
            played_today: playedToday
        };
    }).filter(Boolean);

    res.json({ leagues });
});

// Check if player is member of a league
app.get('/api/leagues/:id/membership/:uuid', (req, res) => {
    const { id, uuid } = req.params;
    const db = loadDB();

    const membership = db.memberships.find(
        m => m.leagueId === id && m.playerUuid === uuid
    );

    res.json({ isMember: !!membership });
});

// Update player display name
app.put('/api/player/:uuid', (req, res) => {
    const { uuid } = req.params;
    const { displayName } = req.body;

    if (!displayName || !displayName.trim()) {
        return res.status(400).json({ error: 'Display name is required' });
    }

    const db = loadDB();

    if (!db.players[uuid]) {
        db.players[uuid] = {
            uuid,
            displayName: displayName.trim(),
            createdAt: new Date().toISOString()
        };
    } else {
        db.players[uuid].displayName = displayName.trim();
    }

    saveDB(db);

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
