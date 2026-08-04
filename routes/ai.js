const express = require('express');
const aiService = require('../services/ai.js');
const config = require('../config.js');

const router = express.Router();

// POST /api/ai/chat - Multi-turn conversation with action parsing
router.post('/chat', async (req, res, next) => {
    try {
        const { messages, systemContext, issues } = req.body || {};
        if (!messages || !messages.length) {
            return res.status(400).json({ error: 'messages array is required' });
        }
        console.log(`[AI-Route] Received chat request, messages count: ${messages.length}`);
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
