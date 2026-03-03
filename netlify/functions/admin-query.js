const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
    // Only allow POST
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

    if (!ADMIN_JWT_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Admin operations not configured' })
        };
    }

    // Validate JWT from Authorization header
    const authHeader = event.headers.authorization || event.headers.Authorization;
    const token = authHeader?.replace('Bearer ', '');

    if (!token) {
        return {
            statusCode: 401,
            body: JSON.stringify({ error: 'No token provided' })
        };
    }

    try {
        jwt.verify(token, ADMIN_JWT_SECRET);
    } catch (e) {
        return {
            statusCode: 401,
            body: JSON.stringify({ error: 'Invalid or expired token' })
        };
    }

    // Parse request body
    let body;
    try {
        body = JSON.parse(event.body || '{}');
    } catch (e) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Invalid JSON' })
        };
    }

    const { table, operation, data, id, order } = body;

    // Only allow operations on puzzles table
    if (table !== 'puzzles') {
        return {
            statusCode: 403,
            body: JSON.stringify({ error: 'Operation not allowed on this table' })
        };
    }

    // Initialize Supabase admin client
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

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
                    return {
                        statusCode: 400,
                        body: JSON.stringify({ error: 'ID required for update' })
                    };
                }
                query = supabaseAdmin.from(table).update(data).eq('id', id);
                break;

            case 'delete':
                if (!id) {
                    return {
                        statusCode: 400,
                        body: JSON.stringify({ error: 'ID required for delete' })
                    };
                }
                query = supabaseAdmin.from(table).delete().eq('id', id);
                break;

            default:
                return {
                    statusCode: 400,
                    body: JSON.stringify({ error: 'Invalid operation' })
                };
        }

        const { data: result, error } = await query;

        if (error) {
            return {
                statusCode: 500,
                body: JSON.stringify({ error: error.message })
            };
        }

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ data: result })
        };

    } catch (e) {
        console.error('Admin query error:', e);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Query failed' })
        };
    }
};
