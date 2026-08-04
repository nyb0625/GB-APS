/**
 * ai-panel.js — AI Chat and Action Mapping Client (ES6 Module)
 * v3.0 — 메인 이슈탭 실시간 데이터 연동 + 이슈 질문 지능형 분기
 */

import { 
    selectAndFocusNodes, 
    setNodesColor, 
    isolateNodes, 
    resetViewerOverrides,
    getModelMetadata 
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
    const keywords = [
        '이슈', '문제', '결함', '하자', '단독', '비교', '공종', '구조물', '담당자',
        '상태', '요약', '몇개', '몇 개', '개수', '보고', '현황', '목록',
        '총 몇', '얼마나', '어떤', '어느', '집계', '분포', '통계',
        '응집침전지', '침전지', '정수', '여과', '저류', '펌프', '배수',
        '토목', '기계', '전기', '계장', '건축',
        'open', 'closed', '완료', '진행', '검토', '보류'
    ];
    const lower = text.toLowerCase();
    return keywords.some(kw => lower.includes(kw.toLowerCase()));
}

// ─────────────────────────────────────────────────────────────────
// 📊 메인 이슈탭 실시간 데이터 수집 및 컨텍스트 문자열 생성
// ─────────────────────────────────────────────────────────────────
function getIssueContext() {
    // 1) window.currentIssueList를 단일 진실 소스로 우선 사용
    let allIssues = [];

    if (Array.isArray(window.currentIssueList) && window.currentIssueList.length > 0) {
        allIssues = window.currentIssueList;
    } else {
        // fallback: LocalStorage 3개 키 병합 + 중복 제거
        let l1 = [], l2 = [], l3 = [];
        try { l1 = JSON.parse(localStorage.getItem('aps_project_issues')      || '[]'); } catch(e) {}
        try { l2 = JSON.parse(localStorage.getItem('my_saved_issues')         || '[]'); } catch(e) {}
        try { l3 = JSON.parse(localStorage.getItem('my_saved_compare_issues') || '[]'); } catch(e) {}
        const raw = l1.concat(l2).concat(l3);
        const seen = {};
        raw.forEach(item => {
            if (item && item.id && !seen[item.id]) {
                seen[item.id] = true;
                allIssues.push(item);
            }
        });
    }

    // 2) 단독/비교 분류
    const isCompare = item =>
        String(item.id || '').startsWith('COMP-') ||
        item._type === 'compare' ||
        item.type  === 'compare';

    const singleIssues  = allIssues.filter(i => i && !isCompare(i));
    const compareIssues = allIssues.filter(i => i &&  isCompare(i));

    // 3) 구조물별 집계
    const byStructure = {};
    allIssues.forEach(item => {
        const s = (item.structure || '미지정').trim();
        if (!byStructure[s]) byStructure[s] = { single: 0, compare: 0 };
        if (isCompare(item)) byStructure[s].compare++;
        else                  byStructure[s].single++;
    });

    // 4) 공종별 집계
    const byTrade = {};
    allIssues.forEach(item => {
        const t = (item.trade || '미지정').trim();
        if (!byTrade[t]) byTrade[t] = 0;
        byTrade[t]++;
    });

    // 5) 상태별 집계
    const byStatus = {};
    allIssues.forEach(item => {
        const s = (item.status || '미지정').trim();
        if (!byStatus[s]) byStatus[s] = 0;
        byStatus[s]++;
    });

    // 6) 담당자별 집계
    const byAssignee = {};
    allIssues.forEach(item => {
        const a = (item.assignee || '미지정').trim();
        if (!byAssignee[a]) byAssignee[a] = 0;
        byAssignee[a]++;
    });

    // 7) 단독 이슈 상세 목록 (최대 80개)
    const singleDetail = singleIssues.slice(0, 80).map((item, i) =>
        `  ${i + 1}. [${item.title || '제목 없음'}] | 구조물: ${item.structure || '-'} | 공종: ${item.trade || '-'} | 상태: ${item.status || '-'} | 담당자: ${item.assignee || '-'} | 날짜: ${item.date || item.startDate || '-'} | 내용: ${(item.description || item.desc || '').substring(0, 60)}`
    ).join('\n');

    // 8) 비교 이슈 상세 목록 (최대 80개)
    const compareDetail = compareIssues.slice(0, 80).map((item, i) =>
        `  ${i + 1}. [${item.title || '제목 없음'}] | 구조물: ${item.structure || '-'} | 공종: ${item.trade || '-'} | 상태: ${item.status || '-'} | 담당자: ${item.assignee || '-'} | 날짜: ${item.date || '-'} | 검토: ${(item.reviewContent || item.reviewDesc || '').substring(0, 40)} | 변경: ${(item.changeContent || item.changeDesc || '').substring(0, 40)}`
    ).join('\n');

    // 9) 컨텍스트 문자열 조립
    let ctx = '=== 메인 이슈탭 실시간 데이터 ===\n';
    ctx += `■ 전체 이슈: ${allIssues.length}개\n`;
    ctx += `  - 단독 이슈: ${singleIssues.length}개\n`;
    ctx += `  - 비교 이슈: ${compareIssues.length}개\n\n`;

    ctx += '■ 구조물별 현황:\n';
    Object.entries(byStructure).forEach(([k, v]) => {
        ctx += `  · ${k}: 단독 ${v.single}개 / 비교 ${v.compare}개\n`;
    });

    ctx += '\n■ 공종별 현황:\n';
    Object.entries(byTrade).forEach(([k, v]) => {
        ctx += `  · ${k}: ${v}개\n`;
    });

    ctx += '\n■ 상태별 현황:\n';
    Object.entries(byStatus).forEach(([k, v]) => {
        ctx += `  · ${k}: ${v}개\n`;
    });

    ctx += '\n■ 담당자별 현황:\n';
    Object.entries(byAssignee).forEach(([k, v]) => {
        ctx += `  · ${k}: ${v}개\n`;
    });

    if (singleIssues.length > 0) {
        ctx += `\n■ 단독 이슈 상세 목록 (${Math.min(singleIssues.length, 80)}/${singleIssues.length}개):\n`;
        ctx += singleDetail + '\n';
    }

    if (compareIssues.length > 0) {
        ctx += `\n■ 비교 이슈 상세 목록 (${Math.min(compareIssues.length, 80)}/${compareIssues.length}개):\n`;
        ctx += compareDetail + '\n';
    }

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

        // system 메시지 구성
        const systemMessages = [
            {
                role: 'system',
                content: [
                    '당신은 강북정수장 APS 웹 시스템에 탑재된 AI 엔지니어링 챗봇입니다.',
                    '도면 비교 분석, 이슈 관리, 구조물 정보 및 토목/기계 공종에 대해 정확하고 신뢰성 있는 전문 답변을 한국어로 제공하세요.',
                    '이슈 관련 질문에는 반드시 제공된 "메인 이슈탭 실시간 데이터"를 기반으로 정확한 수치와 목록을 답변하세요.',
                    '추측이나 가정 없이 데이터에 있는 사실만 답변하세요.',
                    '',
                    '사용 가능한 뷰어 제어 액션 태그:',
                    '[ACTION:SELECT, TARGET:카테고리명] — 해당 객체 선택',
                    '[ACTION:THEME, TARGET:카테고리명, COLOR:색상] — 색상 강조',
                    '[ACTION:RESET_VIEWER] — 뷰어 초기화',
                    '[ACTION:COUNT, TARGET:카테고리명] — 객체 수 조회',
                    '',
                    '현재 BIM 모델 컨텍스트:',
                    bimContext
                ].join('\n')
            }
        ];

        // 가이드 내용이 있으면 시스템 규칙 및 가이드 본문 주입
        if (guideContent) {
            systemMessages.push({
                role: 'system',
                content: [
                    '🎯 [사용자 가이드라인 규칙]',
                    '사용자가 플랫폼의 특정 기능(간트 차트 추가법, CCTV 동기화 방법, 이슈 배치 클릭 이동 등)에 대해 질문하면, 반드시 아래에 제공되는 [강북정수장 APS AI 플랫폼 가이드] 내용을 기준으로 친절하게 설명서처럼 답변하세요.',
                    '',
                    '# 강북정수장 APS AI 플랫폼 가이드 (llm_wiki.md):',
                    guideContent
                ].join('\n')
            });
        }

        // 이슈 컨텍스트가 있으면 system 메시지로 추가
        if (issueContext) {
            systemMessages.push({
                role: 'system',
                content: issueContext
            });
        }

        const ollamaMessages = [
            ...systemMessages,
            ...chatHistory.slice(0, -1)
        ];
        ollamaMessages.push({ role: 'user', content: cleanQuery });

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
            `❌ 로컬 LLM(Ollama) 서버에 연결할 수 없습니다.\n터미널에서 'ollama run gemma4:e2b' 가 구동 중인지 확인하세요.\n\n오류 상세: ${err.message}`
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
