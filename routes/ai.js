const express = require('express');
const aiService = require('../services/ai.js');
const config = require('../config.js');

const router = express.Router();

// POST /api/ai/chat - Multi-turn conversation with action parsing & Issue RAG Context Injection
router.post('/chat', async (req, res, next) => {
    try {
        let { messages, systemContext, issues } = req.body || {};
        if (!messages || !messages.length) {
            return res.status(400).json({ error: 'messages array is required' });
        }
        
        const lastMsg = String(messages[messages.length - 1]?.content || '').toLowerCase();
        const isIssueRelated = ['이슈', '문제', 'issue', '현황', '불량', '하자', '간섭', '결함'].some(k => lastMsg.includes(k));

        if (isIssueRelated && (!issues || !Array.isArray(issues) || issues.length === 0)) {
            try {
                // 백엔드 이슈 서비스 라우트 모듈이나 캐시에서 실시간 강북 정수장 이슈 로딩
                const issuesRoute = require('./issues.js');
                if (issuesRoute && typeof issuesRoute.getGangbukIssuesCache === 'function') {
                    issues = await issuesRoute.getGangbukIssuesCache();
                }
            } catch (e) {
                console.warn('[AI-Route] Backend issue fetch fallback warning:', e.message);
            }
        }

        console.log(`[AI-Route] Received chat request (isIssueRelated: ${isIssueRelated}), messages count: ${messages.length}`);
        const reply = await aiService.chat({ messages, systemContext, issues });
        res.json({ reply, timestamp: new Date().toISOString() });
    } catch (err) {
        console.error('[AI-Route] Chat error:', err.message);
        res.status(500).json({ error: 'AI Chat failed', message: err.message });
    }
});

// POST /api/ai/analyze - Single-shot analysis of specific model data
router.post('/analyze', async (req, res, next) => {
    try {
        const { modelData, question, context } = req.body || {};
        if (!question) {
            return res.status(400).json({ error: 'question is required' });
        }
        const answer = await aiService.analyzeModel({ modelData, question, context });
        res.json({ answer, timestamp: new Date().toISOString() });
    } catch (err) {
        console.error('[AI-Route] Analyze error:', err.message);
        res.status(500).json({ error: 'AI Analyze failed', message: err.message });
    }
});

// POST /api/ai/summarize - Summarize selection of BIM elements
router.post('/summarize', async (req, res, next) => {
    try {
        const { elements, urn } = req.body || {};
        if (!Array.isArray(elements) || elements.length === 0) {
            return res.status(400).json({ error: 'elements array is required' });
        }
        const summary = await aiService.summarizeElements({ elements, urn });
        res.json({ summary, timestamp: new Date().toISOString() });
    } catch (err) {
        console.error('[AI-Route] Summarize error:', err.message);
        res.status(500).json({ error: 'AI Summarize failed', message: err.message });
    }
});

// GET /api/ai/provider - Return provider config status
router.get('/provider', (req, res) => {
    res.json({
        provider: process.env.AI_PROVIDER || 'gemini',
        hasOpenAI: !!config.ai.openaiKey,
        hasGemini: !!config.ai.geminiKey,
        ollama: {
            host: config.ai.ollamaHost,
            model: process.env.OLLAMA_MODEL || 'llama3',
        },
    });
});

module.exports = router;
