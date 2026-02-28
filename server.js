require('dotenv').config();

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Supabase setup
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables');
    process.exit(1);
}

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

// ===== CONFIG API =====

// Expose public-safe configuration to the client
app.get('/api/config', (req, res) => {
    res.json({
        supabaseUrl: SUPABASE_URL,
        supabaseAnonKey: SUPABASE_ANON_KEY
    });
});

// ===== PUZZLE API ROUTES =====

// Get today's puzzle (supports ?date=YYYY-MM-DD for testing)
app.get('/api/puzzle/today', async (req, res) => {
    const today = req.query.date || getTodayString();

    const { data: puzzle, error } = await supabase
        .from('puzzles')
        .select('*')
        .eq('date', today)
        .single();

    if (error || !puzzle) {
        return res.status(404).json({ error: 'No puzzle found for today' });
    }

    // Calculate puzzle number (count of puzzles up to and including today)
    const { count } = await supabase
        .from('puzzles')
        .select('*', { count: 'exact', head: true })
        .lte('date', today);

    res.json({
        ...puzzle,
        puzzleNumber: count || 1
    });
});

// Get puzzle for a specific date (only if date <= today)
app.get('/api/puzzle/:date', async (req, res) => {
    const { date } = req.params;
    const today = getTodayString();

    // Don't expose future puzzles
    if (date > today) {
        return res.status(403).json({ error: 'Cannot access future puzzles' });
    }

    const { data: puzzle, error } = await supabase
        .from('puzzles')
        .select('*')
        .eq('date', date)
        .single();

    if (error || !puzzle) {
        return res.status(404).json({ error: 'Puzzle not found' });
    }

    // Calculate puzzle number
    const { count } = await supabase
        .from('puzzles')
        .select('*', { count: 'exact', head: true })
        .lte('date', date);

    res.json({
        ...puzzle,
        puzzleNumber: count || 1
    });
});

// Get all puzzles up to today (for archive)
app.get('/api/puzzles', async (req, res) => {
    const today = getTodayString();

    const { data: puzzles, error } = await supabase
        .from('puzzles')
        .select('date')
        .lte('date', today)
        .order('date', { ascending: true });

    if (error) {
        return res.status(500).json({ error: 'Failed to fetch puzzles' });
    }

    // Return just dates with puzzle numbers for the archive
    const archive = (puzzles || []).map((p, index) => ({
        date: p.date,
        puzzleNumber: index + 1
    }));

    res.json({ puzzles: archive });
});

// Serve index.html for all other routes (SPA-style routing)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`Connections UK server running at http://localhost:${PORT}`);
});
