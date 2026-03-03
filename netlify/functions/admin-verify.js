const jwt = require('jsonwebtoken');

exports.handler = async (event) => {
    // Only allow POST
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
    const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET;

    if (!ADMIN_PASSWORD || !ADMIN_JWT_SECRET) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Admin authentication not configured' })
        };
    }

    let body;
    try {
        body = JSON.parse(event.body || '{}');
    } catch (e) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Invalid JSON' })
        };
    }

    const { password } = body;

    if (!password || password !== ADMIN_PASSWORD) {
        return {
            statusCode: 401,
            body: JSON.stringify({ error: 'Invalid password' })
        };
    }

    // Generate JWT with 24 hour expiry
    const token = jwt.sign(
        { admin: true },
        ADMIN_JWT_SECRET,
        { expiresIn: '24h' }
    );

    return {
        statusCode: 200,
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ valid: true, token })
    };
};
