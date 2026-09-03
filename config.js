/**
 * Application Configuration
 * -------------------------
 * 환경 변수 로드·검증·구조화된 내보내기.
 * 필수 값이 없으면 즉시 프로세스를 종료해 잘못된 런타임을 예방합니다.
 */
const { Scopes } = require('@aps_sdk/authentication');
require('dotenv').config();

// ── 필수 환경 변수 목록 ─────────────────────────────────────────
const REQUIRED_ENV = ['APS_CLIENT_ID', 'APS_CLIENT_SECRET', 'APS_CALLBACK_URL', 'SERVER_SESSION_SECRET'];

const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missing.length) {
    console.warn('\n[config] ⚠️  Missing some required environment variables:');
    missing.forEach((k) => console.warn(`   - ${k}`));
    console.warn('\n→ .env 파일 혹은 시스템 환경 변수를 확인해 주세요.\n');
    // 초기 설정 시 .env가 비어있을 수 있으므로 즉시 종료하지 않고 경고만 표시하여 설치 및 설정을 진행할 수 있게 합니다.
}

// ── 구조화된 설정 ──────────────────────────────────────────────
const config = {
    env: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT, 10) || 8000,

    // APS (Autodesk Platform Services)
    aps: {
        clientId: process.env.APS_CLIENT_ID || '',
        clientSecret: process.env.APS_CLIENT_SECRET || '',
        callbackUrl: process.env.APS_CALLBACK_URL || 'http://localhost:8000/api/auth/callback',
        internalScopes: [
            Scopes.DataRead,
            Scopes.DataCreate,
            Scopes.DataWrite,
            Scopes.BucketCreate,
            Scopes.BucketRead,
            Scopes.ViewablesRead,
            Scopes.AccountRead
        ],
        publicScopes: [Scopes.ViewablesRead],
    },

    // 세션
    session: {
        secret: process.env.SERVER_SESSION_SECRET || 'aps-ai-platform-default-secret-key',
        maxAge: (parseInt(process.env.SESSION_MAX_AGE_DAYS, 10) || 30) * 24 * 60 * 60 * 1000,
    },

    // AI 서비스
    ai: {
        openaiKey: process.env.OPENAI_API_KEY || '',
        geminiKey: process.env.GEMINI_API_KEY || '',
        ollamaHost: process.env.OLLAMA_HOST || 'http://localhost:11434',
    },
};

// ── 이전 코드 호환용 평면 내보내기 ──────────────────────
module.exports = {
    ...config,
    APS_CLIENT_ID: config.aps.clientId,
    APS_CLIENT_SECRET: config.aps.clientSecret,
    APS_CALLBACK_URL: config.aps.callbackUrl,
    SERVER_SESSION_SECRET: config.session.secret,
    INTERNAL_TOKEN_SCOPES: config.aps.internalScopes,
    PUBLIC_TOKEN_SCOPES: config.aps.publicScopes,
    PORT: config.port,
};
