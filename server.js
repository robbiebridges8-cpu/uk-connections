require('dotenv').config();

const express = require('express');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Supabase setup
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables');
    process.exit(1);
}

// Public client for regular operations
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Admin client with service role key (bypasses RLS)
let supabaseAdmin = null;
if (SUPABASE_SERVICE_ROLE_KEY) {
    supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

// Admin session tokens (in-memory store)
const adminSessions = new Map();
const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

function generateSessionToken() {
    return crypto.randomBytes(32).toString('hex');
}

function validateAdminSession(token) {
    if (!token) return false;
    const session = adminSessions.get(token);
    if (!session) return false;
    if (Date.now() > session.expires) {
        adminSessions.delete(token);
        return false;
    }
    return true;
}

// Clean up expired sessions periodically
setInterval(() => {
    const now = Date.now();
    for (const [token, session] of adminSessions.entries()) {
        if (now > session.expires) {
            adminSessions.delete(token);
        }
    }
}, 60 * 60 * 1000); // Every hour

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

// Expose public-safe configuration to the client (NO admin password)
app.get('/api/config', (req, res) => {
    res.json({
        supabaseUrl: SUPABASE_URL,
        supabaseAnonKey: SUPABASE_ANON_KEY
    });
});

// ===== ADMIN AUTH API =====

// Verify admin password and return session token
app.post('/api/admin/verify', (req, res) => {
    const { password } = req.body;

    if (!ADMIN_PASSWORD) {
        return res.status(500).json({ error: 'Admin password not configured' });
    }

    if (!password || password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Invalid password' });
    }

    // Generate session token
    const token = generateSessionToken();
    adminSessions.set(token, {
        created: Date.now(),
        expires: Date.now() + SESSION_EXPIRY_MS
    });

    res.json({ valid: true, token });
});

// ===== ADMIN QUERY PROXY =====

// Proxy Supabase operations for admin (requires valid session token)
app.post('/api/admin/query', async (req, res) => {
    // Validate session token
    const authHeader = req.headers.authorization;
    const token = authHeader?.replace('Bearer ', '');

    if (!validateAdminSession(token)) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!supabaseAdmin) {
        return res.status(500).json({ error: 'Admin operations not configured (missing service role key)' });
    }

    const { table, operation, data, id, filters, order } = req.body;

    // Only allow operations on puzzles table for now
    if (table !== 'puzzles') {
        return res.status(403).json({ error: 'Operation not allowed on this table' });
    }

    try {
        let query;

        switch (operation) {
            case 'select':
                query = supabaseAdmin.from(table).select(data?.columns || '*');
                if (order) {
                    query = query.order(order.column, { ascending: order.ascending });
                }
                break;

            case 'insert':
                query = supabaseAdmin.from(table).insert(data).select().single();
                break;

            case 'update':
                if (!id) {
                    return res.status(400).json({ error: 'ID required for update' });
                }
                query = supabaseAdmin.from(table).update(data).eq('id', id);
                break;

            case 'delete':
                if (!id) {
                    return res.status(400).json({ error: 'ID required for delete' });
                }
                query = supabaseAdmin.from(table).delete().eq('id', id);
                break;

            default:
                return res.status(400).json({ error: 'Invalid operation' });
        }

        const { data: result, error } = await query;

        if (error) {
            return res.status(500).json({ error: error.message });
        }

        res.json({ data: result });

    } catch (e) {
        console.error('Admin query error:', e);
        res.status(500).json({ error: 'Query failed' });
    }
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
