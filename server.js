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
try {
    dns.setDefaultResultOrder('ipv4first');
} catch (e) {}
const config = require('./config.js');

const authRouter = require('./routes/auth.js');
const diffRouter = require('./routes/diff');

const app = express();
app.disable('x-powered-by');

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

// Mount Routes (세션을 공유받을 라우터들을 연결)
app.use('/api/auth', authRouter);
app.use('/api/diff', diffRouter);
app.use('/api/models', require('./routes/models.js'));
app.use('/api/ai', require('./routes/ai.js'));
app.use('/api/hubs', require('./routes/hubs.js'));
app.use('/api/cctv', require('./routes/cctv.js'));
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
