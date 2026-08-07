/**
 * routes/chatbot.js — Chatbot LLM API Router with Quantitative Issue Aggregation
 */
'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const aiService = require('../services/ai.js');
const issuesRoute = require('./issues.js');

const router = express.Router();

// 1. 강북 정수장 이슈 데이터 수집 헬퍼 함수
async function fetchGangbukIssues() {
    try {
        if (issuesRoute && typeof issuesRoute.getGangbukIssuesCache === 'function') {
            const cached = await issuesRoute.getGangbukIssuesCache();
            if (Array.isArray(cached) && cached.length > 0) {
                return cached;
            }
        }
        const dataPath = path.join(__dirname, '..', 'data', 'issues.json');
        if (fs.existsSync(dataPath)) {
            const raw = fs.readFileSync(dataPath, 'utf8');
            const parsed = JSON.parse(raw || '[]');
            if (Array.isArray(parsed) && parsed.length > 0) {
                return parsed;
            }
        }
    } catch (err) {
        console.warn('[Chatbot Route] fetchGangbukIssues error:', err.message);
    }
    return [];
}

// 2. reduce() 기반 '월간 이슈 현황' 탭 스타일의 구조물/위치별 정량 데이터 집계
function aggregateIssuesByStructure(issues) {
    if (!Array.isArray(issues) || issues.length === 0) {
        return {
            summaryText: '=== [월간 이슈 현황 탭 데이터] ===\n총 이슈: 0건. (완료율 0%)\n=================================',
            totalCount: 0,
            grouped: {}
        };
    }

    const totals = issues.reduce((acc, issue) => {
        acc.total += 1;
        const st = String(issue.status || issue.statusName || 'open').toLowerCase().replace(/[s_-]+/g, '');
        if (st.includes('closed') || st.includes('종료') || st.includes('완료')) acc.closed += 1;
        else if (st.includes('delay') || st.includes('지연')) acc.delayed += 1;
        else if (st.includes('review') || st.includes('검토')) acc.review += 1;
        else acc.created += 1;
        return acc;
    }, { total: 0, created: 0, review: 0, delayed: 0, closed: 0 });

    const completionRate = totals.total ? Math.round((totals.closed / totals.total) * 100) : 0;

    const grouped = issues.reduce((acc, issue) => {
        let structName = issue.structure || issue.location || issue.locationName || issue.locationDetails || '';
        if (!structName && issue.customAttributes) {
            const attrs = Array.isArray(issue.customAttributes) ? issue.customAttributes : Object.values(issue.customAttributes);
            const found = attrs.find(a => /위치|구조물|location/i.test(a.title || a.name || ''));
            if (found) structName = found.value || found.text || '';
        }
        structName = String(structName || '미지정 구조물').trim();

        if (!acc[structName]) {
            acc[structName] = { total: 0, created: 0, review: 0, delayed: 0, closed: 0, items: [] };
        }

        acc[structName].total += 1;
        const st = String(issue.status || issue.statusName || 'open').toLowerCase().replace(/[s_-]+/g, '');
        if (st.includes('closed') || st.includes('종료') || st.includes('완료')) acc[structName].closed += 1;
        else if (st.includes('delay') || st.includes('지연')) acc[structName].delayed += 1;
        else if (st.includes('review') || st.includes('검토')) acc[structName].review += 1;
        else acc[structName].created += 1;

        acc[structName].items.push(issue);
        return acc;
    }, {});

    const summaryParts = Object.entries(grouped).map(([struct, data]) => {
        const details = [];
        if (data.created > 0) details.push(`생성 ${data.created}`);
        if (data.review > 0) details.push(`검토 ${data.review}`);
        if (data.delayed > 0) details.push(`지연 ${data.delayed}`);
        if (data.closed > 0) details.push(`종료 ${data.closed}`);
        return `[${struct}: 총 ${data.total}건 (${details.join(', ') || 'N/A'})]`;
    });

    const summaryText = `[월간 이슈 현황 탭 데이터]\n전체 이슈: 총 ${totals.total}건 (생성 ${totals.created}건, 검토 ${totals.review}건, 지연 ${totals.delayed}건, 종료 ${totals.closed}건 / 완료율 ${completionRate}%)\n구조물별 월간 이슈 진행: ${summaryParts.join(', ')}`;

    return {
        summaryText,
        totalCount: totals.total,
        grouped
    };
}

// POST /api/chatbot/chat — Chatbot endpoint with Quantitative Issue Aggregation
router.post('/chat', async (req, res, next) => {
    try {
        let { messages, systemContext, issues } = req.body || {};
        if (!messages || !messages.length) {
            return res.status(400).json({ error: 'messages array is required' });
        }

        const lastMsg = String(messages[messages.length - 1]?.content || '').toLowerCase();
        const isIssueRelated = ['이슈', '문제', 'issue', '현황', '불량', '하자', '간섭', '결함', '요약', '정량', '구조물'].some(k => lastMsg.includes(k));

        if (isIssueRelated && (!issues || !Array.isArray(issues) || issues.length === 0)) {
            issues = await fetchGangbukIssues();
        }

        const aggregation = aggregateIssuesByStructure(issues || []);

        // LLM 시스템 프롬프트 강화
        const quantitativePrompt = `
[정량적 통계 요약본]
${aggregation.summaryText}

🚨 [시스템 필수 준수 지침]:
사용자가 이슈 요약을 요청하면, 반드시 내가 제공한 [정량적 통계 요약본]을 사용하여 '현재 OOO 구조물에 O건, XXX 구조물에 O건의 이슈가 있습니다'라는 형태의 수치 중심 브리핑으로 답변을 시작해. 절대로 스스로 개수를 세지 말고 제공된 통계 수치를 그대로 사용해. 그 후 주요 이슈의 상세 내용을 간단히 덧붙여.
`;

        const enrichedSystemContext = `${systemContext || ''}\n\n${quantitativePrompt}`;

        console.log(`[Chatbot-Route] Quantitative Aggregation: ${aggregation.summaryText}`);

        const reply = await aiService.chat({
            messages,
            systemContext: enrichedSystemContext,
            issues: issues || []
        });

        res.json({
            reply,
            aggregation: aggregation.summaryText,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error('[Chatbot-Route] Chat error:', err.message);
        res.status(500).json({ error: 'Chatbot service error', message: err.message });
    }
});

module.exports = router;
module.exports.aggregateIssuesByStructure = aggregateIssuesByStructure;
module.exports.fetchGangbukIssues = fetchGangbukIssues;
