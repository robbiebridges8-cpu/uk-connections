const { createClient } = require('@supabase/supabase-js');

// Log environment variable status (not values for security)
console.log('Environment check:', {
    hasSupabaseUrl: !!process.env.SUPABASE_URL,
    hasSupabaseKey: !!process.env.SUPABASE_ANON_KEY,
    supabaseUrlPrefix: process.env.SUPABASE_URL ? process.env.SUPABASE_URL.substring(0, 30) + '...' : 'MISSING'
});

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

function getTodayString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Parse categories if stored as JSON string
function parsePuzzle(puzzle) {
    if (!puzzle) return null;

    // If categories is a string, parse it
    if (typeof puzzle.categories === 'string') {
        try {
            puzzle.categories = JSON.parse(puzzle.categories);
        } catch (e) {
            console.error('Failed to parse categories:', e);
        }
    }

    return puzzle;
}

exports.handler = async (event) => {
    const params = event.queryStringParameters || {};

    // The original API path comes through as a query parameter from Netlify redirects
    const originalPath = params.path || event.path || '';

    console.log('Request:', { originalPath, params, today: getTodayString() });

    try {
        // GET /api/puzzle/today
        if (originalPath.includes('/api/puzzle/today') || originalPath === '/.netlify/functions/puzzle') {
            const date = params.date || getTodayString();

            console.log('Fetching puzzle for date:', date);

            const { data: puzzle, error } = await supabase
                .from('puzzles')
                .select('*')
                .eq('date', date)
                .single();

            console.log('Supabase response:', {
                hasData: !!puzzle,
                error: error ? { message: error.message, code: error.code, details: error.details } : null,
                puzzleKeys: puzzle ? Object.keys(puzzle) : [],
                categoriesType: puzzle ? typeof puzzle.categories : 'N/A'
            });

            if (error) {
                console.error('Supabase error:', error);
                return {
                    statusCode: 404,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ error: 'No puzzle found for today', details: error.message })
                };
            }

            if (!puzzle) {
                return {
                    statusCode: 404,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ error: 'No puzzle found for today' })
                };
            }

            const { count } = await supabase
                .from('puzzles')
                .select('*', { count: 'exact', head: true })
                .lte('date', date);

            const parsedPuzzle = parsePuzzle(puzzle);

            const response = {
                ...parsedPuzzle,
                puzzleNumber: count || 1
            };

            console.log('Returning puzzle:', { date: response.date, puzzleNumber: response.puzzleNumber, categoriesLength: response.categories?.length });

            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(response)
            };
        }

        // GET /api/puzzles (archive)
        if (originalPath.includes('/api/puzzles') || params.action === 'archive') {
            const today = getTodayString();

            const { data: puzzles, error } = await supabase
                .from('puzzles')
                .select('date')
                .lte('date', today)
                .order('date', { ascending: true });

            if (error) {
                console.error('Archive fetch error:', error);
                return {
                    statusCode: 500,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ error: 'Failed to fetch puzzles', details: error.message })
                };
            }

            const archive = (puzzles || []).map((p, index) => ({
                date: p.date,
                puzzleNumber: index + 1
            }));

            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ puzzles: archive })
            };
        }

        // GET /api/puzzle/:date - extract date from path or params
        const dateMatch = originalPath.match(/\/puzzle\/(\d{4}-\d{2}-\d{2})/);
        const date = dateMatch ? dateMatch[1] : params.date;

        if (date || params.action === 'date') {
            const targetDate = date || params.date;
            const today = getTodayString();

            if (!targetDate) {
                return {
                    statusCode: 400,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ error: 'Date parameter required' })
                };
            }

            // Don't expose future puzzles
            if (targetDate > today) {
                return {
                    statusCode: 403,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ error: 'Cannot access future puzzles' })
                };
            }

            const { data: puzzle, error } = await supabase
                .from('puzzles')
                .select('*')
                .eq('date', targetDate)
                .single();

            if (error || !puzzle) {
                return {
                    statusCode: 404,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ error: 'Puzzle not found' })
                };
            }

            const { count } = await supabase
                .from('puzzles')
                .select('*', { count: 'exact', head: true })
                .lte('date', targetDate);

            const parsedPuzzle = parsePuzzle(puzzle);

            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...parsedPuzzle,
                    puzzleNumber: count || 1
                })
            };
        }

        return {
            statusCode: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Invalid request', path: originalPath })
        };

    } catch (error) {
        console.error('Function error:', error);
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Internal server error', message: error.message })
        };
    }
};
