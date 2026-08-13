/**
 * ai-panel.js — AI Chat and Action Mapping Client (ES6 Module)
 * v4.0 — 메인 이슈탭 실시간 데이터 연동 + 이슈 질문 지능형 분기 + 뷰어 브릿지 연동
 */

import { 
    getModelMetadata,
    getViewerInstance
} from './viewer.js';

let chatHistory = [];
let modelMetadata = null;

function syncModelMetadataFromHarness(data) {
    if (!data) return;
    const categories = Array.isArray(data.categoryList)
        ? data.categoryList
        : Object.keys(data.categories || data.categoryInstancesMap || {});
    if (categories.length === 0) return;

    modelMetadata = {
        categories,
        elementsCount: data.totalElements || Object.values(data.categoryInstancesMap || {}).reduce((sum, ids) => sum + (ids?.length || 0), 0),
        elements: modelMetadata?.elements || []
    };
}

function getCurrentModelCategories() {
    const fromSsot = Object.keys(window.categoryInstancesMap || {});
    const fromDynamic = Array.isArray(window.dynamicCategories) ? window.dynamicCategories : [];
    const fromMetadata = Array.isArray(modelMetadata?.categories) ? modelMetadata.categories : [];
    return [...new Set([...fromSsot, ...fromDynamic, ...fromMetadata].filter(Boolean))].sort();
}

function buildBimContext() {
    const categories = getCurrentModelCategories();
    const countFromSsot = Object.values(window.categoryInstancesMap || {}).reduce((sum, ids) => sum + (ids?.length || 0), 0);
    const elementCount = countFromSsot || modelMetadata?.elementsCount || 0;

    if (categories.length === 0) {
        return 'No active model metadata.';
    }

    return [
        `현재 파일명: ${window.currentModelName || 'BIM Model'}`,
        `총 객체 수: ${elementCount}`,
        `존재하는 카테고리 목록: [${categories.join(', ')}]`,
        `사용자 별칭 규칙: "벽"은 "벽체" 또는 "Walls"와 가장 가까운 실제 카테고리로, "배관"은 "Pipes"와 가장 가까운 실제 카테고리로 매칭하세요. TARGET은 반드시 위 카테고리 목록의 실제 이름으로 출력하세요.`
    ].join('\n');
}

const WEEKLY_TASK_STORAGE_KEY = 'gangbuk_construction_weekly_tasks';

function readConstructionWeeklyTasks() {
    try {
        const parsed = JSON.parse(localStorage.getItem(WEEKLY_TASK_STORAGE_KEY) || '[]');
        if (Array.isArray(parsed)) return parsed;
        if (parsed && typeof parsed === 'object') {
            return Object.values(parsed).flatMap((tasks) => Array.isArray(tasks) ? tasks : []);
        }
    } catch (err) {
        console.warn('[AI Panel] weekly task storage parse failed:', err);
    }
    return [];
}

function parseTaskDate(value) {
    if (!value) return null;
    const parts = String(value).split('-').map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
    const date = new Date(parts[0], parts[1] - 1, parts[2]);
    date.setHours(0, 0, 0, 0);
    return date;
}

function getMonday(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay() || 7;
    d.setDate(d.getDate() - day + 1);
    return d;
}

function addWeeks(date, count) {
    const d = new Date(date);
    d.setDate(d.getDate() + count * 7);
    return d;
}

function parseWeekKey(weekKey) {
    const match = String(weekKey || '').match(/^(\d{4})-W(\d{2})$/);
    if (!match) return getMonday(new Date());
    const firstThursday = new Date(Number(match[1]), 0, 4);
    const firstMonday = getMonday(firstThursday);
    return addWeeks(firstMonday, Number(match[2]) - 1);
}

function getWeekMeta(date) {
    const monday = getMonday(date);
    const firstThursday = new Date(monday.getFullYear(), 0, 4);
    const firstMonday = getMonday(firstThursday);
    const diffDays = Math.round((monday - firstMonday) / 86400000);
    const week = Math.floor(diffDays / 7) + 1;
    const year = monday.getFullYear();
    return {
        key: `${year}-W${String(week).padStart(2, '0')}`,
        label: `${year}년 ${week}주차`
    };
}

function getSelectedConstructionWeekRange() {
    const selectedKey = document.getElementById('bim-week-select')?.value || getWeekMeta(new Date()).key;
    const start = parseWeekKey(selectedKey);
    const end = addWeeks(start, 1);
    end.setDate(end.getDate() - 1);
    end.setHours(23, 59, 59, 999);
    return { key: selectedKey, label: getWeekMeta(start).label, start, end };
}

function taskOverlapsWeek(task, week) {
    const start = parseTaskDate(task.startDate) || parseTaskDate(task.dueDate) || week.start;
    let due = parseTaskDate(task.dueDate) || start;
    if (due < start) due = start;
    if (task.status === '완료') {
        due = addWeeks(due, 1);
    }
    return start <= week.end && due >= week.start;
}

function getConstructionWeeklyTaskSnapshot() {
    const allTasks = readConstructionWeeklyTasks();
    const week = getSelectedConstructionWeekRange();
    const weekTasks = allTasks.filter((task) => taskOverlapsWeek(task, week));
    const countBy = (getter) => weekTasks.reduce((acc, task) => {
        const key = getter(task) || '-';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});

    return {
        week,
        allTasks,
        weekTasks,
        statusCounts: countBy((task) => task.status || '계획'),
        categoryCounts: countBy((task) => task.category || '기타'),
        peopleCounts: countBy((task) => task.people || '미지정')
    };
}

function isConstructionWeeklyTaskQuery(text) {
    const lower = String(text || '').toLowerCase();
    const hasWork = ['주간 업무', '금주 업무', '업무 현황', '주간업무', '업무'].some((word) => lower.includes(word));
    const hasConstructionTab = ['시공 bim', '시공bim', '시공 대시보드', '시공 bim 대시보드', '탭'].some((word) => lower.includes(word));
    const hasQuestion = ['현황', '몇', '개수', '목록', '알려', '요약', '진행중', '완료', '계획', '보류', '담당', '수행'].some((word) => lower.includes(word));
    return hasWork && (hasConstructionTab || hasQuestion);
}

function formatCountMap(map) {
    const entries = Object.entries(map || {}).sort((a, b) => b[1] - a[1]);
    return entries.length ? entries.map(([key, count]) => `${key} ${count}건`).join(', ') : '없음';
}

function buildConstructionWeeklyTaskAnswer(question) {
    const snapshot = getConstructionWeeklyTaskSnapshot();
    const { week, weekTasks, allTasks } = snapshot;
    const lower = String(question || '').toLowerCase();
    const sortedTasks = weekTasks.slice().sort((a, b) => {
        return String(a.startDate || '').localeCompare(String(b.startDate || '')) ||
            String(a.dueDate || '').localeCompare(String(b.dueDate || ''));
    });

    if (lower.includes('진행중')) {
        const active = sortedTasks.filter((task) => task.status === '진행중');
        return [
            `${week.label} 주간 업무 중 진행중 업무는 ${active.length}건입니다.`,
            active.length ? active.map((task, idx) => `${idx + 1}. [${task.category || '기타'}] ${task.content || '-'} (${task.startDate || '-'}~${task.dueDate || '-'}, ${task.people || '미지정'})`).join('\n') : '진행중 업무가 없습니다.'
        ].join('\n');
    }

    if (lower.includes('목록') || lower.includes('뭐') || lower.includes('어떤')) {
        return [
            `${week.label} 주간 업무는 총 ${sortedTasks.length}건입니다.`,
            sortedTasks.length ? sortedTasks.map((task, idx) => `${idx + 1}. [${task.status || '계획'} / ${task.category || '기타'}] ${task.content || '-'} (${task.startDate || '-'}~${task.dueDate || '-'}, ${task.people || '미지정'})`).join('\n') : '선택한 주차에 등록된 업무가 없습니다.'
        ].join('\n');
    }

    return [
        `${week.label} 주간 업무 현황입니다.`,
        `전체 등록 업무: ${allTasks.length}건, 선택 주차 업무: ${weekTasks.length}건`,
        `상태별: ${formatCountMap(snapshot.statusCounts)}`,
        `구분별: ${formatCountMap(snapshot.categoryCounts)}`,
        `수행인원별: ${formatCountMap(snapshot.peopleCounts)}`,
        sortedTasks.length
            ? `주요 업무: ${sortedTasks.slice(0, 5).map((task) => `[${task.status || '계획'}] ${task.content || '-'}`).join(' / ')}`
            : '선택한 주차에 등록된 업무가 없습니다.'
    ].join('\n');
}

export async function initAiPanel() {
    const chatForm  = document.getElementById('chat-form');
    const chatInput = document.getElementById('chat-input');
    
    if (chatForm) {
        chatForm.onsubmit = async (e) => {
            e.preventDefault();
            const text = chatInput.value.trim();
            if (!text) return;
            chatInput.value = '';
            await submitChatMessage(text);
        };
    }
    
    // BIM 모델 로드 완료 시 메타데이터 추출
    if (window.viewer) {
        window.viewer.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, async () => {
            console.log('[AI Panel] Geometry loaded. Extracting metadata...');
            modelMetadata = await getModelMetadata(window.viewer);
            console.log('[AI Panel] Extracted categories:', modelMetadata?.categories);
            addSystemMessage('BIM 모델 로드 완료. AI 분석 서비스를 시작합니다.');
        });
    }

    window.addEventListener('APS_MODEL_DATA_EXTRACTED', (event) => {
        syncModelMetadataFromHarness(event.detail);
        console.log('[AI Panel] Harness categories synced:', getCurrentModelCategories());
    });

    // 엔터키 자동 전송 가드
    (function() {
        console.log('[Chatbot Interface] 엔터키 자동 전송 가드 세션 기동.');

        var chatInput  = document.getElementById('chat-input')
            || document.querySelector('.chat-input-box input, .chat-input-box textarea');
        var sendButton = document.getElementById('btn-send-chat')
            || document.getElementById('chat-submit')
            || document.querySelector('.chat-send-btn');

        if (!chatInput) {
            chatInput = document.querySelector('input[type="text"][placeholder*="메시지"], textarea[placeholder*="입력"]');
        }

        if (!chatInput || !sendButton) {
            console.warn('[Chatbot Interface] 입력창 또는 전송 버튼 맵핑 실패.');
            return;
        }

        chatInput.addEventListener('keydown', function(event) {
            if (event.isComposing || event.keyCode === 229) return;
            if (event.key === 'Enter' || event.keyCode === 13) {
                if (event.shiftKey) return;
                event.preventDefault();
                if (sendButton && typeof sendButton.click === 'function') {
                    console.log('[Chatbot Interface] Enter 키 감지 → 전송 ✅');
                    sendButton.click();
                }
            }
        });

        console.log('[Chatbot Interface] 엔터키 전송 링크 연동 완료.');
    })();
}

// ─────────────────────────────────────────────────────────────────
// 🔍 이슈 관련 질문 여부 판별
// ─────────────────────────────────────────────────────────────────
function isIssueRelatedQuery(text) {
    const lower = text.toLowerCase();

    // ── 1순위: '이슈'가 명시적으로 포함되면 즉시 이슈 쿼리로 판별
    if (lower.includes('이슈')) return true;

    // ── 2순위: 이슈 전용 고유 키워드 (BIM 조회와 겹치지 않는 단어들만)
    const issueOnlyKeywords = [
        '결함', '하자', '반려', '협의', '보류', '지연', '초안',
        '공종', '담당자', '구조물별', '월간 이슈', '이슈 현황',
        '단독 이슈', '비교 이슈',
        'open 이슈', 'closed 이슈',
    ];
    if (issueOnlyKeywords.some(kw => lower.includes(kw))) return true;

    // ── 3순위: 시설명(정수장 고유 구조물) + 상태/집계 단어가 함께 있을 때만
    const facilityKeywords = [
        '응집침전지', '침전지', '착수정', '여과지', '정수지', '저류조',
        '배수지', '가압장', '약품동',
    ];
    const issueStatusKeywords = [
        '현황', '요약', '집계', '통계', '분포', '건수', '보고',
        '완료', '진행', '검토', '목록', '리스트',
    ];
    const hasFacility = facilityKeywords.some(kw => lower.includes(kw));
    const hasStatus   = issueStatusKeywords.some(kw => lower.includes(kw));
    if (hasFacility && hasStatus) return true;

    return false;
}

// ─────────────────────────────────────────────────────────────────
// 📊 메인 이슈탭 실시간 데이터 수집 및 컨텍스트 문자열 생성
// ─────────────────────────────────────────────────────────────────
function isIssueChartRequest(text) {
    const lower = String(text || '').toLowerCase();
    if (!isIssueRelatedQuery(lower)) return false;
    return ['그래프', '차트', 'chart', 'graph', '시각화', '막대', '분포'].some(word => lower.includes(word));
}

async function ensureFormaIssueDataLoaded() {
    if (Array.isArray(window._gangbukFormaSSOT) && window._gangbukFormaSSOT.length > 0) {
        return window._gangbukFormaSSOT;
    }
    if (typeof window.loadFormaIssuesForMainTab === 'function') {
        try {
            return await window.loadFormaIssuesForMainTab(false);
        } catch (err) {
            console.warn('[AI Panel] Forma issue loader failed:', err);
        }
    }
    try {
        const resp = await fetch('/api/issues/forma-gangbuk?limit=1000', { credentials: 'same-origin' });
        if (resp.ok) {
            const json = await resp.json();
            const issues = Array.isArray(json.data) ? json.data : [];
            window._gangbukFormaSSOT = issues;
            window._gangbukFormaCache = issues;
            window.currentIssueList = issues;
            window.currentFilteredIssues = issues.slice();
            return issues;
        }
    } catch (err) {
        console.warn('[AI Panel] Forma issue fetch failed:', err);
    }
    return [];
}

function issueValue(issue, key) {
    if (typeof window.getIssueFieldValue === 'function') {
        const value = window.getIssueFieldValue(issue, key);
        if (value && value !== '-') return value;
    }
    const raw = issue?.rawFormaIssue || issue?.rawDetailIssue || issue || {};
    if (key === 'type') return issue?.typePath || issue?.issueTypePath || issue?.type || issue?.category || raw.typePath || raw.issueTypePath || raw.type || raw.category || '-';
    if (key === 'location') return issue?.structure || issue?.location || issue?.locationName || issue?.locationDetails || raw.location || raw.locationName || '-';
    if (key === 'status') return issue?.status || issue?.statusName || issue?.state || raw.status || raw.state || '-';
    if (key === 'trade') return issue?.trade || issue?.discipline || issue?.workType || raw.trade || raw.discipline || '-';
    return issue?.[key] || raw?.[key] || '-';
}

function collectAllIssueData() {
    const sources = [
        window._gangbukFormaSSOT,
        window._gangbukFormaCache,
        window._constructionIssueCache,
        window.currentIssueList,
        window.currentFilteredIssues,
        window.formaCache?.issues
    ];
    let rawList = [];
    sources.forEach(list => {
        if (Array.isArray(list) && list.length) rawList = rawList.concat(list);
    });

    ['aps_project_issues', 'my_saved_issues', 'my_saved_compare_issues'].forEach(key => {
        try {
            const parsed = JSON.parse(localStorage.getItem(key) || '[]');
            if (Array.isArray(parsed)) rawList = rawList.concat(parsed);
        } catch (e) {}
    });

    const allIssues = [];
    const seen = new Set();
    rawList.forEach(item => {
        if (!item) return;
        const id = item.id || item.displayId || item.dbId || item.objectId || '';
        const fallback = [item.title, issueValue(item, 'location'), issueValue(item, 'type'), issueValue(item, 'status')].join('|');
        const uniqueKey = String(id || fallback).trim();
        if (!uniqueKey || seen.has(uniqueKey)) return;
        seen.add(uniqueKey);
        allIssues.push(item);
    });
    return allIssues;
}

function countBy(items, getter) {
    return items.reduce((acc, item) => {
        const key = String(getter(item) || '미지정').trim() || '미지정';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});
}

function topEntries(map, limit = 12) {
    return Object.entries(map || {})
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
        .slice(0, limit);
}

function buildIssueStats(issues) {
    return {
        total: issues.length,
        byStatus: countBy(issues, issue => issueValue(issue, 'status')),
        byLocation: countBy(issues, issue => issueValue(issue, 'location')),
        byType: countBy(issues, issue => issueValue(issue, 'type')),
        byTrade: countBy(issues, issue => issueValue(issue, 'trade'))
    };
}

function formatIssueSummary(stats) {
    const fmt = map => topEntries(map, 8).map(([key, count]) => `${key} ${count}건`).join(', ') || '없음';
    return [
        `Forma 이슈 데이터 기준으로 총 ${stats.total}건을 확인했습니다.`,
        `상태별: ${fmt(stats.byStatus)}`,
        `구조물/위치별: ${fmt(stats.byLocation)}`,
        `유형별: ${fmt(stats.byType)}`,
        `공종별: ${fmt(stats.byTrade)}`
    ].join('\n');
}

function renderIssueChartAnswer(question) {
    const issues = collectAllIssueData();
    const stats = buildIssueStats(issues);
    appendMessage('assistant', `${formatIssueSummary(stats)}\n\n아래에 그래프로 표시했습니다.`);

    const container = document.getElementById('chat-history');
    if (!container) return;
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble assistant';
    const chartId = `ai-issue-chart-${Date.now()}`;
    bubble.innerHTML = `
        <div class="sender">AI 에이전트</div>
        <div class="text">
            <div style="height:260px; min-width:280px;">
                <canvas id="${chartId}"></canvas>
            </div>
        </div>
    `;
    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;

    if (typeof Chart === 'undefined') {
        addSystemMessage('Chart.js가 로드되지 않아 그래프를 표시하지 못했습니다.');
        return;
    }

    const lower = String(question || '').toLowerCase();
    const selected = lower.includes('구조') || lower.includes('위치') || lower.includes('location')
        ? { title: '구조물/위치별 이슈', map: stats.byLocation, color: '#38bdf8' }
        : lower.includes('유형') || lower.includes('type')
            ? { title: '유형별 이슈', map: stats.byType, color: '#a78bfa' }
            : lower.includes('공종') || lower.includes('trade')
                ? { title: '공종별 이슈', map: stats.byTrade, color: '#f59e0b' }
                : { title: '상태별 이슈', map: stats.byStatus, color: '#10b981' };

    const entries = topEntries(selected.map, 12);
    const canvas = document.getElementById(chartId);
    new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: entries.map(([key]) => key),
            datasets: [{
                label: selected.title,
                data: entries.map(([, count]) => count),
                backgroundColor: selected.color,
                borderRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                title: { display: true, text: selected.title, color: '#e5e7eb' }
            },
            scales: {
                x: { ticks: { color: '#cbd5e1', maxRotation: 30, minRotation: 0 }, grid: { color: 'rgba(148,163,184,0.12)' } },
                y: { beginAtZero: true, ticks: { color: '#94a3b8', precision: 0 }, grid: { color: 'rgba(148,163,184,0.16)' } }
            }
        }
    });
}

function getIssueContext() {
    let rawList = [];

    // 1) '월간 이슈 현황' 탭 및 메인 캐시 소스 전수 수집
    if (Array.isArray(window._constructionIssueCache) && window._constructionIssueCache.length > 0) {
        rawList = rawList.concat(window._constructionIssueCache);
    }
    if (Array.isArray(window._gangbukFormaCache) && window._gangbukFormaCache.length > 0) {
        rawList = rawList.concat(window._gangbukFormaCache);
    }
    if (window.formaCache && Array.isArray(window.formaCache.issues) && window.formaCache.issues.length > 0) {
        rawList = rawList.concat(window.formaCache.issues);
    }
    if (Array.isArray(window.currentIssueList) && window.currentIssueList.length > 0) {
        rawList = rawList.concat(window.currentIssueList);
    }
    if (Array.isArray(window.currentFilteredIssues) && window.currentFilteredIssues.length > 0) {
        rawList = rawList.concat(window.currentFilteredIssues);
    }

    // fallback: LocalStorage 3개 키 병합
    let l1 = [], l2 = [], l3 = [];
    try { l1 = JSON.parse(localStorage.getItem('aps_project_issues')      || '[]'); } catch(e) {}
    try { l2 = JSON.parse(localStorage.getItem('my_saved_issues')         || '[]'); } catch(e) {}
    try { l3 = JSON.parse(localStorage.getItem('my_saved_compare_issues') || '[]'); } catch(e) {}
    rawList = rawList.concat(l1).concat(l2).concat(l3);

    // 중복 제거 (ID 또는 Title+Structure)
    const allIssues = [];
    const seen = new Set();
    rawList.forEach(item => {
        if (!item) return;
        const key = item.id || (String(item.title || '') + '|' + String(item.structure || item.location || ''));
        if (key && !seen.has(key)) {
            seen.add(key);
            allIssues.push(item);
        }
    });

    if (allIssues.length === 0) {
        return '=== [월간 이슈 현황 탭 실시간 데이터] ===\n[정량적 통계 요약본]: 현재 등록된 월간 이슈 데이터가 0건입니다.\n=================================';
    }

    // 2) 상태별 KPI 집계 (생성, 검토, 지연, 종료)
    const totals = allIssues.reduce((acc, issue) => {
        acc.total += 1;
        const rawStatus = String(issue.status || issue.statusName || issue.state || 'open').toLowerCase().replace(/[s_-]+/g, '');
        if (rawStatus.includes('closed') || rawStatus.includes('종료') || rawStatus.includes('완료') || rawStatus.includes('close')) {
            acc.closed += 1;
        } else if (rawStatus.includes('delay') || rawStatus.includes('지연') || rawStatus.includes('late') || rawStatus.includes('overdue')) {
            acc.delayed += 1;
        } else if (rawStatus.includes('review') || rawStatus.includes('검토') || rawStatus.includes('answer')) {
            acc.review += 1;
        } else {
            acc.created += 1;
        }
        return acc;
    }, { total: 0, created: 0, review: 0, delayed: 0, closed: 0 });

    const completionRate = totals.total ? Math.round((totals.closed / totals.total) * 100) : 0;

    // 3) 구조물(위치)별 정량 그룹핑
    const groupedByLocation = allIssues.reduce((acc, item) => {
        let loc = item.structure || item.location || item.locationName || item.locationDetails || '';
        if (!loc && item.customAttributes) {
            const attrs = Array.isArray(item.customAttributes) ? item.customAttributes : Object.values(item.customAttributes);
            const found = attrs.find(a => /위치|구조물|location/i.test(a.title || a.name || ''));
            if (found) loc = found.value || found.text || '';
        }
        loc = String(loc || '미지정 구조물').trim();

        if (!acc[loc]) {
            acc[loc] = { total: 0, created: 0, review: 0, delayed: 0, closed: 0, items: [] };
        }

        acc[loc].total += 1;
        const rawStatus = String(item.status || item.statusName || 'open').toLowerCase().replace(/[s_-]+/g, '');
        if (rawStatus.includes('closed') || rawStatus.includes('종료') || rawStatus.includes('완료')) acc[loc].closed += 1;
        else if (rawStatus.includes('delay') || rawStatus.includes('지연')) acc[loc].delayed += 1;
        else if (rawStatus.includes('review') || rawStatus.includes('검토')) acc[loc].review += 1;
        else acc[loc].created += 1;

        acc[loc].items.push(item);
        return acc;
    }, {});

    const locationSummaryParts = Object.entries(groupedByLocation).map(([loc, data]) => {
        const details = [];
        if (data.created > 0) details.push(`생성 ${data.created}`);
        if (data.review > 0) details.push(`검토 ${data.review}`);
        if (data.delayed > 0) details.push(`지연 ${data.delayed}`);
        if (data.closed > 0) details.push(`종료 ${data.closed}`);
        return `[${loc}: 총 ${data.total}건 (${details.join(', ') || 'N/A'})]`;
    });

    const locationSummaryText = locationSummaryParts.join(', ');

    const detailList = allIssues.slice(0, 80).map((item, i) =>
        `  ${i + 1}. [${item.title || '제목 없음'}] | 구조물/위치: ${item.structure || item.location || '-'} | 상태: ${item.status || '-'} | 담당자: ${item.assignee || '-'} | 날짜: ${item.date || item.startDate || '-'}`
    ).join('\n');

    let ctx = '=== [월간 이슈 현황 탭 실시간 데이터] ===\n';
    ctx += `■ 전체 이슈 KPI: 총 ${totals.total}건 (생성 ${totals.created}건, 검토 ${totals.review}건, 지연 ${totals.delayed}건, 종료 ${totals.closed}건 / 완료율 ${completionRate}%)\n`;
    ctx += `■ [구조물별 월간 이슈 진행 현황]:\n${locationSummaryText}\n\n`;
    ctx += `■ 개별 이슈 상세 리스트 (${Math.min(allIssues.length, 80)}/${allIssues.length}개):\n`;
    ctx += detailList + '\n';
    ctx += '=================================';
    return ctx;
}

// ─────────────────────────────────────────────────────────────────
// 📌 [마크다운 -> HTML 변환 유틸리티 함수]
function parseMarkdownToHTML(text) {
    if (!text) return "";
    
    // 1. **굵은 글씨** 변환: **텍스트** -> <strong>텍스트</strong>
    let htmlText = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    // 2. *기울임꼴* 변환: *텍스트* -> <em>텍스트</em>
    htmlText = htmlText.replace(/\*(.*?)\*/g, '<em>$1</em>');
    
    // 3. `코드` 변환: `코드` -> <code>코드</code>
    htmlText = htmlText.replace(/`(.*?)`/g, '<code style="background:#0f172a; padding:2px 4px; border-radius:4px; font-family:monospace; font-size:12px;">$1</code>');
    
    // 4. 줄바꿈(\n)을 HTML <br> 태그로 변환 (엔터키 렌더링)
    htmlText = htmlText.replace(/\n/g, '<br>');
    
    return htmlText;
}
window.parseMarkdownToHTML = parseMarkdownToHTML;

// ─────────────────────────────────────────────────────────────────
// 💬 메시지 버블 추가
// ─────────────────────────────────────────────────────────────────
function appendMessage(role, content) {
    const container = document.getElementById('chat-history');
    if (!container) return;
    
    const div = document.createElement('div');
    div.className = `chat-bubble ${role}`;
    const formatted = parseMarkdownToHTML(content);
    div.innerHTML = `
        <div class="sender">${role === 'user' ? '사용자' : 'AI 에이전트'}</div>
        <div class="text">${formatted}</div>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function addSystemMessage(text) {
    const container = document.getElementById('chat-history');
    if (!container) return;
    const div = document.createElement('div');
    div.className = 'chat-bubble system';
    div.innerHTML = `<div class="text">${parseMarkdownToHTML(text)}</div>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

// ─────────────────────────────────────────────────────────────────
// ⏳ 로딩 스피너
// ─────────────────────────────────────────────────────────────────
function toggleLoading(show) {
    const container = document.getElementById('chat-history');
    if (!container) return;
    let loader = document.getElementById('chat-loader');
    if (show) {
        if (!loader) {
            loader = document.createElement('div');
            loader.id = 'chat-loader';
            loader.className = 'chat-bubble assistant loading';
            loader.innerHTML = `
                <div class="sender">AI 에이전트</div>
                <div class="loading-dots">
                    <span>.</span><span>.</span><span>.</span>
                </div>
            `;
            container.appendChild(loader);
        }
        container.scrollTop = container.scrollHeight;
    } else {
        if (loader) loader.remove();
    }
}

// ─────────────────────────────────────────────────────────────────
// 📄 [UI 자동화 파이프라인] 필터 적용 ➔ 백그라운드 PDF 생성 ➔ 다이렉트 다운로드 & Auto-Cleanup
// ─────────────────────────────────────────────────────────────────
export async function executeFilterAndPdfExport(filters = {}) {
    console.log('[UI Automation Pipeline] 필터 적용 및 백그라운드 PDF 다이렉트 자동 다운로드 기동:', filters);

    // 1) 메인 화면을 이슈 탭으로 전환
    if (typeof window.switchTab === 'function') {
        window.switchTab('issue');
    } else {
        const issueTabBtn = document.getElementById('main-tab-issue-btn');
        if (issueTabBtn) issueTabBtn.click();
    }

    await sleep(250);

    // 2) 서브 탭 카테고리 필터 (standalone / compare / all)
    if (filters.type || filters.category) {
        const t = String(filters.type || filters.category).toLowerCase();
        if (t.includes('single') || t.includes('standalone') || t.includes('단독')) {
            if (typeof window.filterIssues === 'function') window.filterIssues('standalone');
        } else if (t.includes('compare') || t.includes('비교')) {
            if (typeof window.filterIssues === 'function') window.filterIssues('compare');
        } else if (t.includes('all') || t.includes('전체')) {
            if (typeof window.filterIssues === 'function') window.filterIssues('all');
        }
    }

    // 3) 헤더 필터 조작 (구조물 structure, 공종 trade, 상태 status, 담당자 assignee, 제목 title)
    const filterElements = document.querySelectorAll('.column-filter');
    const targetMap = {
        structure: filters.structure || filters.structureName || filters.구조물 || '',
        trade: filters.trade || filters.discipline || filters.공종 || '',
        status: filters.status || filters.상태 || '',
        assignee: filters.assignee || filters.담당자 || '',
        title: filters.title || filters.제목 || ''
    };

    filterElements.forEach(filterEl => {
        const th = filterEl.closest('th');
        const thText = th ? th.textContent.toLowerCase().trim() : '';

        Object.keys(targetMap).forEach(key => {
            const targetVal = targetMap[key];
            if (!targetVal) return;

            const isTargetCol = thText.includes(key) ||
                (key === 'structure' && (thText.includes('구조물') || thText.includes('structure'))) ||
                (key === 'trade' && (thText.includes('공종') || thText.includes('trade') || thText.includes('discipline'))) ||
                (key === 'status' && (thText.includes('상태') || thText.includes('status'))) ||
                (key === 'assignee' && (thText.includes('담당자') || thText.includes('assignee'))) ||
                (key === 'title' && (thText.includes('제목') || thText.includes('title')));

            if (isTargetCol) {
                if (filterEl.tagName === 'SELECT') {
                    let matchedOpt = null;
                    const valLower = String(targetVal).toLowerCase().trim();
                    for (let i = 0; i < filterEl.options.length; i++) {
                        const optText = filterEl.options[i].text.toLowerCase().trim();
                        const optVal = filterEl.options[i].value.toLowerCase().trim();
                        if (optText.includes(valLower) || optVal.includes(valLower) || valLower.includes(optText)) {
                            matchedOpt = filterEl.options[i];
                            break;
                        }
                    }
                    if (matchedOpt) {
                        filterEl.value = matchedOpt.value;
                    }
                } else if (filterEl.tagName === 'INPUT') {
                    filterEl.value = targetVal;
                }

                // 이벤트 발생시켜 filterIssues / applyFilters 실행
                filterEl.dispatchEvent(new Event('input', { bubbles: true }));
                filterEl.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });
    });

    // 4) 필터링 렌더링 완료 대기 (350ms) 후 PDF 모달 생성 및 내보내기 자동 클릭 & Auto-Cleanup
    await sleep(350);

    const pdfBtn = document.getElementById('btn-main-pdf-export');
    if (pdfBtn) {
        pdfBtn.click();

        // 팝업 모달이 생성되면 내보내기 버튼 자동 클릭 및 잔류 팝업 강제 제거 (Auto-Cleanup)
        await sleep(200);
        const executeBtn = document.getElementById('btn-execute-pdf-export');
        if (executeBtn) {
            executeBtn.click();
            console.log('[UI Automation Pipeline] 다이렉트 PDF 내보내기 (#btn-execute-pdf-export) 자동 클릭 완료 ✅');
        }

        const modal = document.getElementById('pdf-export-modal');
        if (modal) modal.remove();

        return true;
    } else {
        // Fallback: buildAndOpenBatchPdf 직접 기동
        const filteredIssues = Array.isArray(window.currentFilteredIssues) && window.currentFilteredIssues.length > 0
            ? window.currentFilteredIssues
            : window.currentIssueList || [];

        if (filteredIssues.length === 0) {
            console.warn('[UI Automation Pipeline] 내보낼 이슈 데이터가 없습니다.');
            return false;
        }

        if (typeof window.buildAndOpenBatchPdf !== 'function') {
            try {
                await import('./comparison.js?v=pdf-hide-change-row-20260703-4');
            } catch (e) {}
        }

        if (typeof window.buildAndOpenBatchPdf === 'function') {
            const BLANK_1PX = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
            window.buildAndOpenBatchPdf(filteredIssues, BLANK_1PX, BLANK_1PX);
            return true;
        }
    }
    return false;
}
window.executeFilterAndPdfExport = executeFilterAndPdfExport;

async function triggerPdfExport(filterValue = 'all') {
    return await executeFilterAndPdfExport({ type: filterValue });
}

/** 특정 id의 요소가 DOM에 나타날 때까지 대기 (최대 maxMs ms) */
function waitForElement(id, maxMs = 2000) {
    return new Promise(resolve => {
        const el = document.getElementById(id);
        if (el) { resolve(el); return; }

        const observer = new MutationObserver(() => {
            const found = document.getElementById(id);
            if (found) {
                observer.disconnect();
                clearTimeout(timer);
                resolve(found);
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });

        const timer = setTimeout(() => {
            observer.disconnect();
            resolve(null);
        }, maxMs);
    });
}

/** 지정 ms 만큼 대기 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────────
// 🚀 메인 챗 디스패처
// ─────────────────────────────────────────────────────────────────
async function submitChatMessage(messageText) {
    const cleanQuery = messageText.trim();
    if (!cleanQuery) return;

    appendMessage('user', cleanQuery);
    chatHistory.push({ role: 'user', content: cleanQuery });

    // ── [기능 1] PDF 자동 트리거 & 조건 필터링 ─────────────────────
    const lq = cleanQuery.toLowerCase();
    const isPdfRequest =
        lq.includes('pdf') || lq.includes('내보내') ||
        lq.includes('출력') || lq.includes('인쇄') || lq.includes('보고서');

    if (isPdfRequest) {
        console.log('[Smart AI Agent] PDF 내보내기 요청 감지 → UI 자동화 파이프라인 기동');

        const extractedFilters = {};
        if (lq.includes('건축')) extractedFilters.trade = '건축';
        else if (lq.includes('토목')) extractedFilters.trade = '토목';
        else if (lq.includes('기계')) extractedFilters.trade = '기계';
        else if (lq.includes('전기')) extractedFilters.trade = '전기';
        else if (lq.includes('계장')) extractedFilters.trade = '계장';

        if (lq.includes('응집침전지') || lq.includes('침전지')) extractedFilters.structure = '응집침전지';
        else if (lq.includes('여과지')) extractedFilters.structure = '여과지';
        else if (lq.includes('정수지')) extractedFilters.structure = '정수지';

        if (lq.includes('진행') || lq.includes('open')) extractedFilters.status = '진행중';
        else if (lq.includes('검토') || lq.includes('review')) extractedFilters.status = '검토중';

        if (lq.includes('단독')) extractedFilters.type = 'single';
        else if (lq.includes('비교')) extractedFilters.type = 'compare';

        const triggered = await executeFilterAndPdfExport(extractedFilters);
        if (triggered) {
            appendMessage('assistant', `📄 조건에 맞춰 PDF 파일을 백그라운드에서 생성하여 즉시 다운로드합니다.`);
            chatHistory.push({ role: 'assistant', content: `조건에 맞춰 PDF 파일을 백그라운드에서 생성하여 즉시 다운로드합니다.` });
            return;
        }
    }

    if (isConstructionWeeklyTaskQuery(cleanQuery)) {
        const weeklyAnswer = buildConstructionWeeklyTaskAnswer(cleanQuery);
        appendMessage('assistant', weeklyAnswer);
        chatHistory.push({ role: 'assistant', content: weeklyAnswer });
        return;
    }

    if (isIssueRelatedQuery(cleanQuery)) {
        await ensureFormaIssueDataLoaded();
        if (isIssueChartRequest(cleanQuery)) {
            renderIssueChartAnswer(cleanQuery);
            chatHistory.push({ role: 'assistant', content: 'Forma 이슈 데이터를 그래프로 표시했습니다.' });
            return;
        }
    }

    const handledViewerIntent = !isIssueRelatedQuery(cleanQuery) && await tryExecuteLocalViewerIntent(cleanQuery);
    if (handledViewerIntent) return;

    // ── [기능 2] BIM 모델 컨텍스트 ────────────────────────────────
    const bimContext = buildBimContext();

    // ── [기능 3] 이슈 컨텍스트 (이슈 관련 질문일 때만 포함) ────────
    const includeIssueCtx = isIssueRelatedQuery(cleanQuery);
    const issueContext = includeIssueCtx ? getIssueContext() : null;

    if (includeIssueCtx) {
        console.log('[Smart AI Agent] 이슈 관련 질문 감지 → 메인 이슈탭 컨텍스트 주입');
    }

    toggleLoading(true);

    const OLLAMA_ENDPOINT = 'http://localhost:11434/v1/chat/completions';

    try {
        // ── [신규] llm_wiki.md 가이드 문서 Fetch ──
        let guideContent = "";
        try {
            const guideRes = await fetch('/llm_wiki.md');
            if (guideRes.ok) {
                guideContent = await guideRes.text();
            }
        } catch(e) {
            console.warn('[Smart AI Agent] llm_wiki.md 로드 실패:', e);
        }

        // system 메시지 구성 (단일 시스템 메시지 통합)
        let systemPromptText = [
            '당신은 강북정수장 APS 웹 시스템에 탑재된 AI 엔지니어링 챗봇입니다.',
            '도면 비교 분석, 이슈 관리, 구조물 정보 및 토목/기계 공종에 대해 정확하고 신뢰성 있는 전문 답변을 한국어로 제공하세요.',
            '🎯 [이슈 답변 핵심 지침 - 정량적 데이터 중심]',
            '사용자가 이슈 요약, 현황, 통계, 목록 관련 질문을 하면, 반드시 서술이나 단순 나열에 앞서 **[구조물별 건수]**, **[공종별 건수]**, **[상태별 건수]**의 정량적 수치 통계를 첫 번째 단락에 가장 먼저 제시하세요.',
            '예시: "응집침전지 N건, 여과지 N건 / 토목 N건, 기계 N건 / 진행 중 N건, 지연 N건"',
            '수치는 무조건 주입된 실시간 데이터의 정확한 건수로만 수치화하고 절대 지어내지 마세요.',
            '',
            '사용 가능한 뷰어 제어 액션 태그:',
            '사용자가 3D 모델 객체의 선택, 색상 변경, 개수, 숨김, 격리, 위치 이동을 요청하면 설명보다 ACTION 태그를 우선 출력하세요.',
            'TARGET은 반드시 아래 현재 BIM 모델 컨텍스트의 카테고리 목록에 있는 실제 이름으로 출력하세요.',
            '예: 사용자가 "벽"이라고 했고 목록에 "벽체"가 있으면 TARGET은 반드시 "벽체"입니다.',
            '[ACTION:SELECT, TARGET:카테고리명] — 해당 객체 선택',
            '[ACTION:THEME, TARGET:카테고리명, COLOR:색상] — 색상 강조',
            '[ACTION:RESET_VIEWER] — 뷰어 초기화',
            '[ACTION:COUNT, TARGET:카테고리명] — 객체 수 조회',
            '[ACTION:ISOLATE, TARGET:카테고리명] — 해당 객체만 보기',
            '[ACTION:HIDE, TARGET:카테고리명] — 해당 객체 숨기기',
            '[ACTION:FLYTO, TARGET:카테고리명] — 해당 객체 위치로 이동',
            '[ACTION:SELECT_MATERIAL, TARGET:재료명] — 해당 재료가 적용된 객체 선택',
            '색상은 red, blue, green, yellow, orange, cyan, magenta, white, gray 중 하나를 사용하세요.',
            '',
            '현재 BIM 모델 컨텍스트:',
            bimContext
        ].join('\n');

        if (guideContent) {
            systemPromptText += '\n\n' + [
                '🎯 [사용자 가이드라인 규칙 (llm_wiki.md)]',
                guideContent
            ].join('\n');
        }

        let finalUserContent = cleanQuery;

        // 이슈 컨텍스트 주입 (이슈 쿼리인 경우)
        if (issueContext) {
            finalUserContent = [
                `[실시간 메인 이슈 탭 데이터 컨텍스트]`,
                issueContext,
                ``,
                `[사용자 질문]`,
                cleanQuery,
                ``,
                `🚨 [지침: 정량적 데이터 기반 필수 답변 규칙]`,
                `이슈 요약이나 현황 질문 시, 주입된 데이터의 실시간 숫자를 기반으로 아래와 같이 **[구조물별 건수]**, **[공종별 건수]**, **[상태별 건수]**를 첫 번째 단락에 가장 먼저 정량적으로 수치화하여 답변하세요:`,
                `• **구조물별 현황**: [구조물명] N건 (단독 X건, 비교 Y건)`,
                `• **공종별 현황**: [공종명] N건`,
                `• **상태별 현황**: [상태명] N건`,
                `데이터에 명시된 수치만 토대로 답변하고, 숫자를 임의 추측하거나 지어내지 마세요.`
            ].join('\n');
        }

        const ollamaMessages = [
            { role: 'system', content: systemPromptText },
            ...chatHistory.slice(0, -1),
            { role: 'user', content: finalUserContent }
        ];

        const response = await fetch(OLLAMA_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'gemma4:e2b',
                messages: ollamaMessages,
                temperature: 0.1,  // 이슈 데이터 수치 정확도를 위해 낮게 설정
                stream: false
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Ollama API 응답 에러 (${response.status}): ${errText}`);
        }

        const data = await response.json();
        toggleLoading(false);

        let reply = '';
        if (data?.choices?.[0]?.message) {
            reply = data.choices[0].message.content;
        } else {
            reply = '로컬 LLM으로부터 올바른 응답 데이터를 받지 못했습니다.';
        }

        console.log('[Smart AI Agent] Ollama 답변 수신 성공 ✅');

        const processedReply = processActionTags(reply);
        appendMessage('assistant', processedReply);
        chatHistory.push({ role: 'assistant', content: reply });

    } catch (err) {
        console.error('[Smart AI Agent] Ollama 연동 실패:', err.message);
        toggleLoading(false);
        appendMessage('assistant',
            `❌ 연결 실패\n(로컬 LLM 서버 http://localhost:11434 연결 불가: ${err.message})`
        );
    }
}

// ─────────────────────────────────────────────────────────────────
// 🎬 뷰어 액션 태그 파싱
// ─────────────────────────────────────────────────────────────────
const handleChatCommands = (text) => {
    const actions = [];
    const patterns = [
        { reg: /\[(?:COMMAND|ACTION)\s*:\s*THEME\s*,\s*TARGET\s*:\s*([^,\]]+)\s*,\s*COLOR\s*:\s*([^\]]+)\]/gi, type: 'theme' },
        { reg: /\[(?:COMMAND|ACTION)\s*:\s*(RESET_VIEWER)\]/gi, type: 'reset' },
        { reg: /\[(?:COMMAND|ACTION)\s*:\s*SELECT_MATERIAL\s*,\s*TARGET\s*:\s*([^\]]+)\]/gi, type: 'select_material' },
        { reg: /\[(?:COMMAND|ACTION)\s*:\s*([^,\]]+)\s*,\s*TARGET\s*:\s*([^\]]+)\]/gi, type: 'standard' }
    ];

    for (const p of patterns) {
        const matches = [...text.matchAll(p.reg)];
        for (const match of matches) {
            if (p.type === 'theme') {
                actions.push({ action: 'theme', target: match[1].trim(), params: { color: match[2].trim() } });
            } else if (p.type === 'reset') {
                actions.push({ action: 'reset_viewer', target: null });
            } else if (p.type === 'select_material') {
                actions.push({ action: 'select_material', target: match[1].trim() });
            } else {
                const action = match[1].trim();
                if (/^(theme|select_material)$/i.test(action)) continue;
                actions.push({ action, target: match[2].trim() });
            }
        }
    }
    return actions;
};

async function executeViewerCommand(data) {
    if (!window.ActionHarness || typeof window.ActionHarness.dispatch !== 'function') {
        return { success: false, error: 'ActionHarness is not loaded.' };
    }
    const activeViewer = getViewerInstance?.() || window.viewer || window._viewer || window.NOP_VIEWER || window.viewerLeft;
    return await window.ActionHarness.dispatch({
        action: (data.command || data.action || 'select').toLowerCase(),
        target: data.target || data.category || null,
        params: data.params || {}
    }, activeViewer);
}

function normalizeViewerColor(text) {
    const lower = String(text || '').toLowerCase();
    const colorMap = [
        { keys: ['빨강', '빨간', '빨간색', 'red'], value: 'red' },
        { keys: ['파랑', '파란', '파란색', 'blue'], value: 'blue' },
        { keys: ['초록', '녹색', 'green'], value: 'green' },
        { keys: ['노랑', '노란', '노란색', 'yellow'], value: 'yellow' },
        { keys: ['주황', '주황색', 'orange'], value: 'orange' },
        { keys: ['하늘색', '청록', 'cyan'], value: 'cyan' },
        { keys: ['분홍', '자홍', 'magenta'], value: 'magenta' },
        { keys: ['흰색', '하얀색', 'white'], value: 'white' },
        { keys: ['회색', 'gray', 'grey'], value: 'gray' }
    ];
    return colorMap.find((item) => item.keys.some((key) => lower.includes(key)))?.value || null;
}

function findLikelyCategoryFromText(text) {
    const lower = String(text || '').toLowerCase();
    const categories = getCurrentModelCategories();

    if (categories.length > 0) {
        const exact = categories.find((cat) => lower.includes(String(cat).toLowerCase()));
        if (exact) return exact;
    }

    const aliases = [
        { keys: ['벽체', '벽', 'wall', 'walls'], hints: ['벽체', '벽', 'wall'], fallback: '벽' },
        { keys: ['바닥', 'floor', 'floors', 'slab', '슬래브'], hints: ['바닥', 'floor', 'slab', '슬래브'], fallback: '바닥' },
        { keys: ['기둥', 'column', 'columns'], hints: ['기둥', 'column'], fallback: '기둥' },
        { keys: ['보', 'beam', 'beams'], hints: ['보', 'beam'], fallback: '보' },
        { keys: ['계단', 'stair', 'stairs'], hints: ['계단', 'stair'], fallback: '계단' },
        { keys: ['배관', '파이프', 'pipe', 'pipes'], hints: ['배관', '파이프', 'pipe'], fallback: '배관' },
        { keys: ['문', 'door', 'doors'], hints: ['문', 'door'], fallback: '문' },
        { keys: ['창', '창문', 'window', 'windows'], hints: ['창', 'window'], fallback: '창문' }
    ];

    const matchedAlias = aliases.find((entry) => entry.keys.some((key) => lower.includes(key)));
    if (!matchedAlias) return null;

    if (categories.length > 0) {
        const matchedCategory = categories.find((cat) => {
            const catLower = String(cat).toLowerCase();
            return matchedAlias.hints.some((hint) => catLower.includes(hint.toLowerCase()));
        });
        if (matchedCategory) return matchedCategory;
    }

    return matchedAlias.fallback;
}

function inferViewerCommandFromText(text) {
    const lower = String(text || '').toLowerCase();
    const target = findLikelyCategoryFromText(text);
    const color = normalizeViewerColor(text);

    if ((lower.includes('초기화') || lower.includes('원래대로') || lower.includes('reset')) && lower.includes('뷰어')) {
        return { action: 'reset_viewer', target: null };
    }
    if (!target) return null;

    if (color && ['색', '색상', '칠', '변경', '바꿔', '바꿔줘', '하이라이트', '강조'].some((word) => lower.includes(word))) {
        return { action: 'theme', target, params: { color } };
    }
    if (['몇 개', '몇개', '개수', '수량', 'count'].some((word) => lower.includes(word))) {
        return { action: 'count', target };
    }
    if (['숨겨', '숨기', 'hide'].some((word) => lower.includes(word))) {
        return { action: 'hide', target };
    }
    if (['만 보여', '격리', 'isolate'].some((word) => lower.includes(word))) {
        return { action: 'isolate', target };
    }
    if (['이동', '날아', '위치', 'flyto', 'focus'].some((word) => lower.includes(word))) {
        return { action: 'flyto', target };
    }
    if (['선택', '찾아', '찾기', 'select'].some((word) => lower.includes(word))) {
        return { action: 'select', target };
    }

    return null;
}

async function tryExecuteLocalViewerIntent(text) {
    const command = inferViewerCommandFromText(text);
    if (!command) return false;

    const res = await executeViewerCommand(command);
    if (res?.success) {
        const countText = typeof res.count === 'number' ? ` (${res.count}개)` : '';
        const message = `요청하신 뷰어 명령을 실행했습니다.${countText}`;
        appendMessage('assistant', message);
        chatHistory.push({ role: 'assistant', content: message });
        return true;
    }

    addSystemMessage(`⚠️ 명령 실행 실패: ${res?.error || '알 수 없는 오류'}`);
    appendMessage('assistant', `뷰어 명령을 실행하려고 했지만 실패했습니다: ${res?.error || '알 수 없는 오류'}`);
    return true;
}

function processActionTags(reply) {
    let text = reply;

    // 0. JSON 액션 인터셉터 ([ACTION: {"command": "export_pdf", "filters": {...}}])
    const jsonActionRegex = /\[ACTION:\s*(\{[\s\S]*?\})\]/i;
    const jsonMatch = text.match(jsonActionRegex);
    if (jsonMatch) {
        try {
            const actionObj = JSON.parse(jsonMatch[1]);
            if (actionObj && (actionObj.command === 'export_pdf' || actionObj.action === 'export_pdf')) {
                const filters = actionObj.filters || {};
                text = text.replace(jsonActionRegex, '').trim();
                const filterDesc = Object.entries(filters).map(([k, v]) => `${k}:${v}`).join(', ');
                addSystemMessage(`📄 조건에 맞춰 PDF 파일을 백그라운드에서 생성하여 즉시 다운로드합니다.`);
                setTimeout(() => {
                    executeFilterAndPdfExport(filters);
                }, 100);
            }
        } catch (e) {
            console.error('[AI Action Parser] JSON 액션 파싱 실패:', e);
        }
    }

    const actions = handleChatCommands(text);
    if (actions.length > 0) {
        actions.forEach(async (act) => {
            const res = await executeViewerCommand(act);
            if (res?.success) {
                const countText = typeof res.count === 'number' ? ` (${res.count}개)` : '';
                addSystemMessage(`💡 ${act.action.toUpperCase()} ${act.target || ''}${countText} 명령을 실행했습니다.`);
            } else {
                addSystemMessage(`⚠️ 명령 실행 실패: ${res?.error || '알 수 없는 오류'}`);
            }
        });
        text = text.replace(/\[(?:COMMAND|ACTION)\s*:\s*(?!\s*\{)[^\]]+\]/gi, '');
    }

    text = text.trim();
    if (!text) text = '지시하신 뷰어 제어 명령을 실행했습니다.';
    return text;
}
