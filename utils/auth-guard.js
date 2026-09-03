function hasAutodeskSession(req) {
    return !!(req.session && req.session.refresh_token);
}

function requireAutodeskSession(req, res, next) {
    if (hasAutodeskSession(req)) {
        return next();
    }
    return res.status(401).json({ error: 'Not authenticated. Please login first.' });
}

function requireAutodeskSessionForAsset(req, res, next) {
    if (hasAutodeskSession(req)) {
        return next();
    }
    if (req.accepts('html')) {
        return res.redirect('/api/auth/login?force=1');
    }
    return res.status(401).send('Authentication required');
}

module.exports = {
    hasAutodeskSession,
    requireAutodeskSession,
    requireAutodeskSessionForAsset
};
