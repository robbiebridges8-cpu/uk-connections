const { createClient } = require('@supabase/supabase-js');

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

exports.handler = async (event) => {
    const params = event.queryStringParameters || {};

    // The original API path comes through as a query parameter from Netlify redirects
    const originalPath = params.path || event.path || '';

    try {
        // GET /api/puzzle/today
        if (originalPath.includes('/api/puzzle/today') || originalPath === '/.netlify/functions/puzzle') {
            const date = params.date || getTodayString();

            const { data: puzzle, error } = await supabase
                .from('puzzles')
                .select('*')
                .eq('date', date)
                .single();

            if (error || !puzzle) {
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

            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...puzzle,
                    puzzleNumber: count || 1
                })
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
                return {
                    statusCode: 500,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ error: 'Failed to fetch puzzles' })
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

            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...puzzle,
                    puzzleNumber: count || 1
                })
            };
        }

        return {
            statusCode: 400,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Invalid request' })
        };

    } catch (error) {
        console.error('Function error:', error);
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ error: 'Internal server error' })
        };
    }
};
