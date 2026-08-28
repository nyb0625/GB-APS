/**
 * APS AI Platform — HTTP entry point (Gangbuk Water Purification Plant APS)
 * ----------------------------------------------------------------------
 *  · Load and validate config (./config.js)
 *  · Static assets serving from public/
 *  · Basic health check & simple endpoints
 */
const express = require('express');
const session = require('express-session');
const path = require('path');
const dns = require('dns');
const https = require('https');
const zlib = require('zlib');
try {
    dns.setDefaultResultOrder('ipv4first');
} catch (e) {}
const config = require('./config.js');

const authRouter = require('./routes/auth.js');
const diffRouter = require('./routes/diff');

const app = express();
app.disable('x-powered-by');

// Catch unhandled errors gracefully so the server doesn't crash
process.on('uncaughtException', (err) => {
    console.error('[CRITICAL] Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('[CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason);
});

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static assets
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

// 🚨 [필수] 라우터보다 먼저 세션 금고를 전역에 깔아야 함
app.use(session({
    secret: config.SERVER_SESSION_SECRET || 'kunhwa-bim-secret-key',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false, httpOnly: true }
}));

// Basic health check route
app.get('/health', (req, res) => res.json({
    status: 'ok',
    env: config.env,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
}));

// Test API route
app.get('/api/info', (req, res) => {
    res.json({
        name: 'APS AI Platform (Gangbuk APS)',
        version: '1.0.0',
        apsClientId: config.APS_CLIENT_ID ? 'Configured (Ends with: ...' + config.APS_CLIENT_ID.slice(-4) + ')' : 'Not Configured',
    });
});

// Autodesk Viewer SDK assets are served through same-origin proxy so Web Workers
// do not need to import scripts directly from the external CDN.
app.get(/^\/api\/viewer-sdk\/([^/]+)\/(.+)$/, (req, res) => {
    const version = req.params[0];
    const assetPath = req.params[1];
    if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version) || assetPath.includes('..')) {
        res.status(400).send('Invalid viewer asset path');
        return;
    }

    const upstreamPath = `/modelderivative/v2/viewers/${version}/${assetPath}`;
    const upstreamUrl = `https://developer.api.autodesk.com${upstreamPath}`;
    const contentTypes = {
        '.js': 'application/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.wasm': 'application/wasm'
    };

    https.get(upstreamUrl, {
        headers: {
            'Accept-Encoding': 'gzip, br, deflate'
        }
    }, (upstream) => {
        if (upstream.statusCode && upstream.statusCode >= 400) {
            res.status(upstream.statusCode).send(`Viewer SDK asset fetch failed: ${upstream.statusCode}`);
            upstream.resume();
            return;
        }
        const ext = path.extname(assetPath).toLowerCase();
        res.setHeader('Content-Type', contentTypes[ext] || upstream.headers['content-type'] || 'application/octet-stream');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        const encoding = String(upstream.headers['content-encoding'] || '').toLowerCase();
        if (encoding.includes('br')) {
            upstream.pipe(zlib.createBrotliDecompress()).pipe(res);
        } else if (encoding.includes('gzip')) {
            upstream.pipe(zlib.createGunzip()).pipe(res);
        } else if (encoding.includes('deflate')) {
            upstream.pipe(zlib.createInflate()).pipe(res);
        } else {
            upstream.pipe(res);
        }
    }).on('error', (err) => {
        console.error('[Viewer SDK Proxy] Failed:', upstreamUrl, err.message);
        res.status(502).send('Viewer SDK proxy failed');
    });
});

// Mount Routes (세션을 공유받을 라우터들을 연결)
app.use('/api/auth', authRouter);
app.use('/api/diff', diffRouter);
app.use('/api/models', require('./routes/models.js'));
app.use('/api/ai', require('./routes/ai.js'));
app.use('/api/chatbot', require('./routes/chatbot.js'));
app.use('/api/hubs', require('./routes/hubs.js'));
app.use('/api/cctv', require('./routes/cctv.js'));
app.use('/api/tasks', require('./routes/tasks.js'));
app.use('/api/media', require('./routes/media.js'));
app.use('/api/schedule-source', require('./routes/schedule-source.js'));
app.use(require('./routes/issues.js'));

// Error Handling Middleware
app.use((req, res) => {
    res.status(404).json({ error: 'Not Found' });
});

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
});

// Start Server
const server = app.listen(config.PORT, () => {
    console.log('');
    console.log('  ╭────────────────────────────────────────────╮');
    console.log(`  │  APS AI Platform — ${String(config.env).padEnd(22)}│`);
    console.log(`  │  http://localhost:${String(config.PORT).padEnd(24)}│`);
    console.log('  ╰────────────────────────────────────────────╯');
    console.log('');
    console.log('[SERVER_STATIC_ROOT]', require('path').resolve(__dirname, 'public'));
    console.log('[SERVER_PORT]', process.env.PORT || config.PORT || 8000);
});

module.exports = app;
