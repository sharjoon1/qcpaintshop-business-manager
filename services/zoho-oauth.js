/**
 * ZOHO OAUTH SERVICE
 * Manages Zoho Books OAuth2 tokens - storage in MySQL, auto-refresh
 *
 * Zoho OAuth Flow:
 *   1. Initial: Authorization Code → Access Token + Refresh Token
 *   2. Runtime: Refresh Token → New Access Token (auto, every ~55 min)
 *   3. Tokens stored in zoho_oauth_tokens table
 *
 * Usage:
 *   const zohoOAuth = require('../services/zoho-oauth');
 *   zohoOAuth.setPool(pool);
 *   const token = await zohoOAuth.getAccessToken();
 */

const https = require('https');
const querystring = require('querystring');

let pool;

// Zoho OAuth endpoints (India datacenter - .in domain)
const ZOHO_ACCOUNTS_URL = 'https://accounts.zoho.in';
const ZOHO_TOKEN_PATH = '/oauth/v2/token';

/**
 * Initialize with database pool
 */
function setPool(dbPool) {
    pool = dbPool;
}

/**
 * Get valid access token - auto-refreshes if expired
 * This is the main method other services should call
 */
async function getAccessToken() {
    if (!pool) throw new Error('Database pool not initialized for ZohoOAuth');

    const orgId = process.env.ZOHO_ORGANIZATION_ID;
    if (!orgId) throw new Error('ZOHO_ORGANIZATION_ID not set in .env');

    // Check for stored token
    const [rows] = await pool.query(
        `SELECT * FROM zoho_oauth_tokens WHERE organization_id = ? LIMIT 1`,
        [orgId]
    );

    if (rows.length > 0) {
        const token = rows[0];
        const now = new Date();
        const expiresAt = new Date(token.expires_at);

        // If token expires in more than 5 minutes, use it
        if (expiresAt > new Date(now.getTime() + 5 * 60 * 1000)) {
            return token.access_token;
        }

        // Token expired or expiring soon - refresh it
        console.log('[ZohoOAuth] Access token expired/expiring, refreshing...');
        return await refreshAccessToken(token.refresh_token, orgId);
    }

    // No token stored - try to generate from refresh token in .env
    const refreshToken = process.env.ZOHO_REFRESH_TOKEN;
    if (!refreshToken) {
        throw new Error('No Zoho token found. Set ZOHO_REFRESH_TOKEN in .env or complete OAuth flow.');
    }

    console.log('[ZohoOAuth] No stored token, generating from .env refresh token...');
    return await refreshAccessToken(refreshToken, orgId);
}

/**
 * Refresh access token using refresh token
 */
async function refreshAccessToken(refreshToken, orgId) {
    const clientId = process.env.ZOHO_CLIENT_ID;
    const clientSecret = process.env.ZOHO_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
        throw new Error('ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET must be set in .env');
    }

    const params = {
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'refresh_token'
    };

    try {
        const response = await httpPost(ZOHO_ACCOUNTS_URL + ZOHO_TOKEN_PATH, params);

        if (response.error) {
            throw new Error(`Zoho OAuth error: ${response.error}`);
        }

        if (!response.access_token) {
            throw new Error('No access_token in Zoho response');
        }

        // Calculate expiry (Zoho tokens last 1 hour, we store 55 min for safety)
        const expiresIn = response.expires_in || 3600;
        const expiresAt = new Date(Date.now() + (expiresIn - 300) * 1000);

        // Store/update in database
        await pool.query(`
            INSERT INTO zoho_oauth_tokens (organization_id, access_token, refresh_token, token_type, api_domain, expires_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                access_token = VALUES(access_token),
                token_type = VALUES(token_type),
                api_domain = VALUES(api_domain),
                expires_at = VALUES(expires_at),
                updated_at = CURRENT_TIMESTAMP
        `, [
            orgId,
            response.access_token,
            refreshToken,
            response.token_type || 'Zoho-oauthtoken',
            response.api_domain || 'https://www.zohoapis.in',
            expiresAt
        ]);

        console.log(`[ZohoOAuth] Token refreshed, expires at ${expiresAt.toISOString()}`);
        return response.access_token;

    } catch (error) {
        console.error('[ZohoOAuth] Token refresh failed:', error.message);
        throw error;
    }
}

/**
 * Generate initial tokens from authorization code
 * Used once during initial setup
 *
 * Steps to get auth code:
 * 1. Visit: https://accounts.zoho.in/oauth/v2/auth?scope=ZohoBooks.fullaccess.all&client_id=YOUR_ID&response_type=code&redirect_uri=YOUR_REDIRECT&access_type=offline
 * 2. Authorize and get the code from redirect URL
 * 3. Call this function with the code
 */
async function generateTokenFromCode(authCode) {
    const clientId = process.env.ZOHO_CLIENT_ID;
    const clientSecret = process.env.ZOHO_CLIENT_SECRET;
    const redirectUri = process.env.ZOHO_REDIRECT_URI || 'https://act.qcpaintshop.com/oauth/callback';
    const orgId = process.env.ZOHO_ORGANIZATION_ID;

    const params = {
        code: authCode,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
    };

    const response = await httpPost(ZOHO_ACCOUNTS_URL + ZOHO_TOKEN_PATH, params);

    if (response.error) {
        throw new Error(`Zoho OAuth error: ${response.error}`);
    }

    if (!response.access_token || !response.refresh_token) {
        throw new Error('Invalid response from Zoho OAuth');
    }

    const expiresIn = response.expires_in || 3600;
    const expiresAt = new Date(Date.now() + (expiresIn - 300) * 1000);

    // Store tokens
    await pool.query(`
        INSERT INTO zoho_oauth_tokens (organization_id, access_token, refresh_token, token_type, api_domain, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            access_token = VALUES(access_token),
            refresh_token = VALUES(refresh_token),
            token_type = VALUES(token_type),
            api_domain = VALUES(api_domain),
            expires_at = VALUES(expires_at),
            updated_at = CURRENT_TIMESTAMP
    `, [
        orgId,
        response.access_token,
        response.refresh_token,
        response.token_type || 'Zoho-oauthtoken',
        response.api_domain || 'https://www.zohoapis.in',
        expiresAt
    ]);

    console.log('[ZohoOAuth] Initial tokens stored successfully');
    return {
        access_token: response.access_token,
        refresh_token: response.refresh_token,
        expires_at: expiresAt
    };
}

/**
 * Get OAuth authorization URL for initial setup
 */
function getAuthorizationUrl() {
    const clientId = process.env.ZOHO_CLIENT_ID;
    const redirectUri = process.env.ZOHO_REDIRECT_URI || 'https://act.qcpaintshop.com/oauth/callback';

    const params = querystring.stringify({
        scope: 'ZohoBooks.fullaccess.all',
        client_id: clientId,
        response_type: 'code',
        redirect_uri: redirectUri,
        access_type: 'offline',
        prompt: 'consent'
    });

    return `${ZOHO_ACCOUNTS_URL}/oauth/v2/auth?${params}`;
}

/**
 * Get current token status (for admin dashboard)
 */
async function getTokenStatus() {
    if (!pool) return { connected: false, error: 'Database not initialized' };

    const orgId = process.env.ZOHO_ORGANIZATION_ID;
    if (!orgId) return { connected: false, error: 'ZOHO_ORGANIZATION_ID not configured' };

    const [rows] = await pool.query(
        `SELECT expires_at, updated_at FROM zoho_oauth_tokens WHERE organization_id = ? LIMIT 1`,
        [orgId]
    );

    if (rows.length === 0) {
        return {
            connected: false,
            error: 'No token stored. Complete OAuth setup first.',
            setup_url: getAuthorizationUrl()
        };
    }

    const token = rows[0];
    const now = new Date();
    const expiresAt = new Date(token.expires_at);
    const isValid = expiresAt > now;

    return {
        connected: isValid,
        expires_at: token.expires_at,
        last_refreshed: token.updated_at,
        expires_in_minutes: isValid ? Math.round((expiresAt - now) / 60000) : 0,
        status: isValid ? 'active' : 'expired'
    };
}

/**
 * Revoke token (for disconnect)
 */
async function revokeToken() {
    const orgId = process.env.ZOHO_ORGANIZATION_ID;

    const [rows] = await pool.query(
        `SELECT refresh_token FROM zoho_oauth_tokens WHERE organization_id = ? LIMIT 1`,
        [orgId]
    );

    if (rows.length > 0) {
        // Revoke from Zoho
        try {
            await httpPost(ZOHO_ACCOUNTS_URL + '/oauth/v2/token/revoke', {
                token: rows[0].refresh_token
            });
        } catch (e) {
            console.warn('[ZohoOAuth] Revoke request failed (may already be revoked):', e.message);
        }

        // Remove from DB
        await pool.query(`DELETE FROM zoho_oauth_tokens WHERE organization_id = ?`, [orgId]);
    }

    return { success: true, message: 'Zoho connection disconnected' };
}

// ========================================
// HTTP HELPER (no external dependency)
// ========================================

/**
 * Simple HTTPS POST using native Node.js https module
 */
function httpPost(url, params) {
    return new Promise((resolve, reject) => {
        const postData = querystring.stringify(params);
        const urlObj = new URL(url);

        const options = {
            hostname: urlObj.hostname,
            port: 443,
            path: urlObj.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error(`Invalid JSON response: ${data.substring(0, 200)}`));
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(30000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
        req.write(postData);
        req.end();
    });
}

module.exports = {
    setPool,
    getAccessToken,
    refreshAccessToken,
    generateTokenFromCode,
    getAuthorizationUrl,
    getTokenStatus,
    revokeToken
};
