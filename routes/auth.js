const express = require('express');
const { 
    getAuthorizationUrl, 
    authCallbackMiddleware, 
    authRefreshMiddleware, 
    getUserProfile, 
    getViewerToken 
} = require('../services/aps.js');
const { APS_CALLBACK_URL } = require('../config.js');

const router = express.Router();

// Dynamic callback helper to support ngrok and local hostnames
function buildDynamicCallbackUrl(req) {
    // 1. .env에 설정된 APS_CALLBACK_URL을 최우선 적용 (Autodesk Developer Portal 등록 주소 일치 보장)
    if (APS_CALLBACK_URL && APS_CALLBACK_URL.trim().length > 0) {
        return APS_CALLBACK_URL.trim();
    }
    const forwardedHost = req.headers['x-forwarded-host'] || req.headers['x-original-host'];
    const forwardedProto = req.headers['x-forwarded-proto'] || 'http';
    if (forwardedHost) {
        return `${forwardedProto}://${forwardedHost}/api/auth/callback`;
    }
    const protocol = req.secure ? 'https' : (req.headers['x-forwarded-proto'] || 'http');
    const host = req.headers.host;
    return `${protocol}://${host}/api/auth/callback`;
}

// GET /api/auth/login - Redirect user to Autodesk Sign In
router.get('/login', (req, res) => {
    const callbackUrl = buildDynamicCallbackUrl(req);
    const url = getAuthorizationUrl(callbackUrl);
    res.redirect(url);
});

// GET /api/auth/callback - Handle OAuth login callback
router.get('/callback', 
    (req, res, next) => authCallbackMiddleware(req, res, next, buildDynamicCallbackUrl(req)),
    (req, res) => {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.set('Pragma', 'no-cache');
        res.type('html').send(`<!doctype html>
            <meta charset="utf-8">
            <title>Signing in...</title>
            <script>
                window.location.replace('/');
            </script>
        `);
    }
);

// GET /api/auth/logout - Log out user and destroy session
router.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) console.error('[Auth] session destroy error:', err);
        res.redirect('/');
    });
});

// GET /api/auth/token - Get public Viewer token (3-legged session token OR fallback 2-legged token)
router.get('/token', async (req, res) => {
    // If user has a 3-legged session, check/refresh and return it
    if (req.session && req.session.refresh_token) {
        return authRefreshMiddleware(req, res, () => {
            res.json(req.publicOAuthToken);
        });
    }
    
    // Fallback: 2-legged credentials for local bucket models
    try {
        const token = await getViewerToken();
        res.json(token);
    } catch (err) {
        res.status(500).json({ error: 'Token generation failed', message: err.message });
    }
});

// GET /api/auth/profile - Fetch logged-in user profile details
router.get('/profile', async (req, res) => {
    if (!req.session || !req.session.refresh_token) {
        return res.json({ name: null });
    }
    
    return authRefreshMiddleware(req, res, async () => {
        try {
            const profile = await getUserProfile(req.internalOAuthToken.access_token);
            res.json({ name: profile.name || 'User' });
        } catch (err) {
            console.error('[Auth] Profile fetch failed:', err.message);
            res.json({ name: null });
        }
    });
});

module.exports = router;
