/**
 * ai-panel.js — AI Chat and Action Mapping Client (ES6 Module)
 * v4.0 — 메인 이슈탭 실시간 데이터 연동 + 이슈 질문 지능형 분기 + 뷰어 브릿지 연동
 */

import { 
    selectAndFocusNodes, 
    setNodesColor, 
    isolateNodes, 
    resetViewerOverrides,
    getModelMetadata,
    searchAndGetBulkProperties,
    setElementColorByName,
    getViewerInstance
} from './viewer.js';

let chatHistory = [];
let modelMetadata = null;

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
// 🤖 [Viewer Bridge] 의도 파악 (Intent Classification)
// ─────────────────────────────────────────────────────────────────

/**
 * 모델 특성(체적·면적·수량) 조회 의도 여부 판별
 */
function isModelPropertyQuery(text) {
    const keywords = [
        '체적', '볼륨', 'volume', '면적', 'area', '수량', '길이', '개수',
        '몇 개', '몇개', '얼마나', '재료', 'material', '특성', '속성',
        '모델', 'bim', '부재', '슬래브', '벽', '기둥', '보', '계단', '지붕',
        '콘크리트', '철근', '강재', '창문', '문', '바닥', '천장'
    ];
    const lower = text.toLowerCase();
    // 이슈 키워드가 있으면 모델 조회가 아님
    if (isIssueRelatedQuery(text) && !lower.includes('bim') && !lower.includes('모델')) return false;
    return keywords.some(kw => lower.includes(kw.toLowerCase()));
}

/**
 * 모델 색상 제어 의도 여부 판별
 */
function isModelColorControlQuery(text) {
    const colorActions = ['색', '색상', '칠', '하이라이트', '표시', '강조', '변경', '바꿔', '바꿔줘', '칠해'];
    const colorNames   = ['빨간', '파란', '초록', '노란', '주황', '하늘', '분홍', '흰', '회색', 'red', 'blue', 'green', 'yellow', 'orange', 'cyan', 'white', 'gray'];
    const lower = text.toLowerCase();
    const hasAction = colorActions.some(kw => lower.includes(kw));
    const hasColor  = colorNames.some(kw => lower.includes(kw));
    return hasAction || hasColor;
}

/**
 * 쿼리에서 BIM 부재명 키워드 추출 (예: '슬래브의 체적' → '슬래브')
 */
function extractElementKeyword(text) {
    const elementPatterns = [
        '슬래브', 'slab', '벽체', '벽', 'wall', '기둥', 'column', '보', 'beam',
        '계단', 'stair', '지붕', 'roof', '바닥', 'floor', '문', 'door', '창문', 'window',
        '파이프', 'pipe', '덕트', 'duct', '콘크리트', 'concrete'
    ];
    const lower = text.toLowerCase();
    const found = elementPatterns.find(kw => lower.includes(kw.toLowerCase()));
    return found || null;
}

/**
 * 쿼리에서 색상 키워드 추출
 */
function extractColorKeyword(text) {
    const colorMap = {
        '빨간': 'red', '빨강': 'red', '빨간색': 'red', 'red': 'red',
        '파란': 'blue', '파랑': 'blue', '파란색': 'blue', 'blue': 'blue',
        '초록': 'green', '초록색': 'green', 'green': 'green',
        '노란': 'yellow', '노랑': 'yellow', '노란색': 'yellow', 'yellow': 'yellow',
        '주황': 'orange', '주황색': 'orange', 'orange': 'orange',
        '하늘': 'cyan', '하늘색': 'cyan', 'cyan': 'cyan',
        '분홍': 'magenta', '분홍색': 'magenta', 'magenta': 'magenta',
        '흰': 'white', '흰색': 'white', 'white': 'white',
        '회': 'gray', '회색': 'gray', 'gray': 'gray'
    };
    const lower = text.toLowerCase();
    const entry = Object.entries(colorMap).find(([k]) => lower.includes(k));
    return entry ? entry[1] : 'cyan';
}

// ─────────────────────────────────────────────────────────────────
// 📊 메인 이슈탭 실시간 데이터 수집 및 컨텍스트 문자열 생성
// ─────────────────────────────────────────────────────────────────
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
// 🔎 BIM 카테고리 기반 dbId 검색
// ─────────────────────────────────────────────────────────────────
function findDbIdsByCategory(target) {
    if (!modelMetadata || !modelMetadata.elements) return [];
    const query = String(target).toLowerCase().trim();
    return modelMetadata.elements
        .filter(el => {
            const cat  = String(el.category).toLowerCase();
            const name = String(el.name).toLowerCase();
            return cat.includes(query) || query.includes(cat) || name.includes(query);
        })
        .map(m => m.dbId);
}

// ─────────────────────────────────────────────────────────────────
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

    // ── [기능 A] 🎨 뷰어 색상 제어 쿼리 — LLM 없이 즉시 처리 ─────────────────
    const isColorCtrl = isModelColorControlQuery(lq);
    const elementKw   = extractElementKeyword(lq);
    if (isColorCtrl && elementKw) {
        console.log('[Viewer Bridge] 색상 제어 명령 감지:', elementKw);
        toggleLoading(true);
        const colorKw = extractColorKeyword(lq);
        const colorResult = await setElementColorByName(elementKw, colorKw);
        toggleLoading(false);
        if (colorResult.success) {
            appendMessage('assistant', colorResult.message);
            chatHistory.push({ role: 'assistant', content: colorResult.message });
        } else {
            // 색상 제어 실패 시에도 LLM에게 계속 진행
            addSystemMessage(`⚠️ 뷰어 색상 제어 실패: ${colorResult.message}`);
        }
        if (colorResult.success) return; // 완전히 처리됨
    }

    // ── [기능 B] 🔬 뷰어 모델 특성 조회 — 실시간 데이터 추출 후 LLM에 주입 ─────
    let viewerPropertyContext = null;
    const isModelQuery = isModelPropertyQuery(lq);
    if (isModelQuery && elementKw) {
        console.log('[Viewer Bridge] 모델 특성 조회 감지:', elementKw);
        addSystemMessage(`🔍 뷰어에서 '${elementKw}' 부재 특성을 실시간으로 추출하는 중...`);
        const propResult = await searchAndGetBulkProperties(elementKw);
        viewerPropertyContext = propResult.contextText;
        console.log('[Viewer Bridge] 추출 완료:', viewerPropertyContext);
    }

    // ── [기능 2] BIM 모델 컨텍스트 ────────────────────────────────
    let bimContext = 'No active model metadata.';
    if (modelMetadata) {
        bimContext = [
            `현재 파일명: ${window.currentModelName || 'BIM Model'}`,
            `총 객체 수: ${modelMetadata.elementsCount}`,
            `존재하는 카테고리 목록: [${modelMetadata.categories.join(', ')}]`
        ].join('\n');
    }

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
            '[ACTION:SELECT, TARGET:카테고리명] — 해당 객체 선택',
            '[ACTION:THEME, TARGET:카테고리명, COLOR:색상] — 색상 강조',
            '[ACTION:RESET_VIEWER] — 뷰어 초기화',
            '[ACTION:COUNT, TARGET:카테고리명] — 객체 수 조회',
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

        // 뷰어 실시간 특성 데이터 주입 (모델 조회 쿼리인 경우)
        if (viewerPropertyContext) {
            finalUserContent = [
                `[실시간 BIM 뷰어 데이터]`,
                viewerPropertyContext,
                ``,
                `[사용자 질문]`,
                cleanQuery,
                ``,
                `위 실시간 뷰어 데이터를 기반으로, 부재 개수·체적·면적 등의 수치를 구체적으로 언급하며 정확하게 답변하세요.`
            ].join('\n');
        }

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

    // 1. Reset Viewer
    if (text.includes('[ACTION:RESET_VIEWER]')) {
        resetViewerOverrides(window.viewer);
        text = text.replace('[ACTION:RESET_VIEWER]', '');
        addSystemMessage('💡 뷰어 스타일 및 격리 상태가 초기화되었습니다.');
    }

    // 2. Select
    const selectRegex = /\[ACTION:SELECT,\s*TARGET:([^\]]+)\]/i;
    const selectMatch = text.match(selectRegex);
    if (selectMatch) {
        const target = selectMatch[1].trim();
        const dbIds  = findDbIdsByCategory(target);
        if (dbIds.length > 0) {
            selectAndFocusNodes(window.viewer, dbIds);
            addSystemMessage(`💡 <b>${target}</b> 카테고리 객체 ${dbIds.length}개가 선택되었습니다.`);
        } else {
            addSystemMessage(`⚠️ 모델 내부에서 <b>${target}</b> 카테고리를 찾을 수 없습니다.`);
        }
        text = text.replace(selectRegex, '');
    }

    // 3. Theme / Color
    const themeRegex = /\[ACTION:THEME,\s*TARGET:([^,\]]+),\s*COLOR:([^\]]+)\]/i;
    const themeMatch = text.match(themeRegex);
    if (themeMatch) {
        const target = themeMatch[1].trim();
        const color  = themeMatch[2].trim();
        const dbIds  = findDbIdsByCategory(target);
        if (dbIds.length > 0) {
            setNodesColor(window.viewer, dbIds, color);
            addSystemMessage(`💡 <b>${target}</b> 카테고리가 <b>${color}</b> 색상으로 칠해졌습니다.`);
        } else {
            addSystemMessage(`⚠️ 모델 내부에서 <b>${target}</b> 카테고리를 찾을 수 없습니다.`);
        }
        text = text.replace(themeRegex, '');
    }

    // 4. Count
    const countRegex = /\[ACTION:COUNT,\s*TARGET:([^\]]+)\]/i;
    const countMatch = text.match(countRegex);
    if (countMatch) {
        const target = countMatch[1].trim();
        const dbIds  = findDbIdsByCategory(target);
        text = text.replace(countRegex, `(조회 결과: 총 ${dbIds.length}개 객체 검출)`);
    }

    text = text.trim();
    if (!text) text = '지시하신 뷰어 제어 명령을 실행했습니다.';
    return text;
}
