const express = require('express');
const { 
    getAuthorizationUrl, 
    authCallbackMiddleware, 
    authRefreshMiddleware,
    getUserProfile
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
    const forceLogin = req.query.force === '1' || req.query.prompt === 'login' || req.query.switch === '1';
    const url = getAuthorizationUrl(callbackUrl, { forceLogin });
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
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    req.session.destroy((err) => {
        if (err) console.error('[Auth] session destroy error:', err);
        res.clearCookie('gangbuk.aps.sid', { path: '/' });
        res.clearCookie('connect.sid', { path: '/' });
        res.redirect('/');
    });
});

// GET /api/auth/token - Get public Viewer token for the logged-in Autodesk session only.
router.get('/token', authRefreshMiddleware, async (req, res) => {
    res.json(req.publicOAuthToken);
});

// GET /api/auth/profile - Fetch logged-in user profile details
router.get('/profile', async (req, res) => {
    if (!req.session || !req.session.refresh_token) {
        return res.json({ name: null });
    }
    
    return authRefreshMiddleware(req, res, async () => {
        try {
            const profile = await getUserProfile(req.internalOAuthToken.access_token);
            const firstName = profile.firstName || profile.given_name || '';
            const lastName = profile.lastName || profile.family_name || '';
            const fallbackName = [firstName, lastName].filter(Boolean).join(' ').trim();
            res.json({
                id: profile.sub || profile.userId || profile.id || profile.oxygenId || profile.email || null,
                name: profile.name || profile.displayName || fallbackName || profile.email || 'User',
                email: profile.email || profile.emailId || profile.userName || null
            });
        } catch (err) {
            console.error('[Auth] Profile fetch failed:', err.message);
            res.json({ name: null });
        }
    });
});

module.exports = router;
