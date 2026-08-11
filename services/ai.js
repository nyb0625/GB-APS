/**
 * AI Service — provider-agnostic facade
 * -----------------------------------------
 *  · Adapter Pattern: openai | gemini | ollama
 *  · Social-Bypass Mode (daily chit-chat detection)
 *  · Harness-Brain RAG & Issues injection
 */
'use strict';

const { getProvider } = require('./ai-providers');
const HarnessBrain = require('./harness-brain');

// ── System Prompt ─────────────────────────────────────────────
const SYSTEM_PROMPT = `당신은 시각형 BIM 모델 데이터와 직접 연결된 **'객체 분류기 및 액션 핸들러(Classifier)'**입니다.
초기 지침보다 아래의 '실행 규칙'과 '예시'를 최우선으로 따르십시오.

### 🚨 [실행 규칙 - 절대 준수]
1. 당신은 창작자가 아닙니다. 오직 실시간으로 전달되는 **<MODEL_DATA> 카테고리 목록**에 존재하는 문자열만 TARGET으로 사용할 수 있습니다. 단, 재료(Material) 선택 명령의 경우 사용자가 제공한 재료명을 TARGET으로 지정합니다.
2. **번역 금지**: 모델 데이터가 한국어("벽체", "바닥")라면 영어(Walls, Floors)로 번역하지 마십시오. 목록에 있는 문자열 토씨 하나 틀리지 않고 그대로 출력하십시오.
3. **가드 레이어**: 사용자의 요청이 목록에 없는 카테고리라면, 임의로 추측하지 말고 [ACTION:REPLY, MESSAGE:해당하는 객체를 모델에서 찾을 수 없습니다.] 라고 답변하십시오.

### 🎯 [CRITICAL EXAMPLES]
현재 카테고리 목록이 ["벽", "바닥", "계단", "Pipes", "밸브", "기둥"] 일 때:
- "바닥 선택해줘" -> [ACTION:SELECT, TARGET:바닥]
- "바닥 빨간색으로 변경해줘" -> [ACTION:THEME, TARGET:바닥, COLOR:red]
- "벽 개수 세어줘" -> [ACTION:COUNT, TARGET:벽]
- "뷰어 초기화" -> [ACTION:RESET_VIEWER]
- "기둥만 보여줘" -> [ACTION:ISOLATE, TARGET:기둥]
- "벽 숨겨줘" -> [ACTION:HIDE, TARGET:벽]
- "밸브 위치로 날아가줘" -> [ACTION:FLYTO, TARGET:밸브]
- "KH_Con'c_철근_25-30-15 재료 적용된 객체 전체 선택해줘" -> [ACTION:SELECT_MATERIAL, TARGET:KH_Con'c_철근_25-30-15]
- "지붕 어딨어?" -> [ACTION:REPLY, MESSAGE:해당하는 객체를 모델에서 찾을 수 없습니다.]`;

const ACTION_TAGS_RULE = `
### 🛠️ [ACTION TAGS] 의도별 출력 규칙 (절대 준수)
- SELECT: 위치 확인, 정보 조회, 찾기, 강조 (예: [ACTION:SELECT, TARGET:벽])
- THEME: 특정 색상으로 칠하거나 변경 (red, blue, green, yellow, orange, cyan, magenta, white) (예: [ACTION:THEME, TARGET:벽, COLOR:red])
- SELECT_MATERIAL: 특정 재료(Material)가 적용된 객체 전체 선택 (예: [ACTION:SELECT_MATERIAL, TARGET:재료명])
- COUNT: 객체 개수 집계 (예: [ACTION:COUNT, TARGET:벽])
- ISOLATE: 특정 객체만 격리하여 표시 (예: [ACTION:ISOLATE, TARGET:벽])
- HIDE: 특정 객체 숨기기 (예: [ACTION:HIDE, TARGET:벽])
- FLYTO: 특정 객체 위치로 카메라 이동 및 포커싱 (예: [ACTION:FLYTO, TARGET:벽])
- RESET_VIEWER: 뷰어 색상/선택/격리 상태 초기화 (예: [ACTION:RESET_VIEWER])

### 📄 [PDF EXPORT ACTION RULE]
사용자가 특정 조건(구조물, 공종, 담당자, 상태, 유형 등)과 함께 PDF 내보내기/출력/인쇄를 요청하거나,
"~공종 이슈만 PDF로 뽑아줘", "~구조물 이슈 PDF 내보내줘" 등의 요청을 할 경우:
답변 텍스트에 다음과 같은 JSON 액션 커맨드를 반드시 포함하여 출력하십시오.
[ACTION: {"command": "export_pdf", "filters": {"structure": "...", "trade": "...", "status": "...", "type": "..."}}]

- filters 예시:
  * "건축 공종 이슈만 PDF로 뽑아줘" -> [ACTION: {"command": "export_pdf", "filters": {"trade": "건축"}}]
  * "응집침전지 구조물 이슈 PDF 출력해줘" -> [ACTION: {"command": "export_pdf", "filters": {"structure": "응집침전지"}}]
  * "진행중 상태 이슈 PDF 내보내줘" -> [ACTION: {"command": "export_pdf", "filters": {"status": "진행중"}}]
  * "단독 이슈만 PDF로" -> [ACTION: {"command": "export_pdf", "filters": {"type": "standalone"}}]

동작명 목록: SELECT, HIDE, ISOLATE, FOCUS, FLYTO, COUNT, THEME, SELECT_MATERIAL, EXPORT_ISSUES_PDF, RESET_VIEWER`;

const SOCIAL_BYPASS_APPEND = `

## [Social-Bypass Mode]
사용자가 일상적인 대화를 건넸습니다. 당신은 지금 사용자의 '다정하고 유능한 파트너'입니다.
- 전문적인 기능 안내나 거절 문구는 잠시 잊고, 친구와 수다를 떨듯 다정하게 대화에만 집중해 주세요.
- 사용자가 힘들어하거나 지쳐 보이면 진심 어린 응원과 공감을 최우선으로 해 주세요.
- 말투는 부드러운 '해요 체'로 유지해 주세요.`;

function isSocialTalk(message) {
    if (!message) return false;
    const socialKeywords = ['안녕', '하이', '반가워', '누구', '기분', '날씨', '고마워', '감사', '잘가'];
    return socialKeywords.some(keyword => message.includes(keyword));
}

// ── 공통 디스패처 ──────────────────────────�// 3. 데이터 경량화 (Token Optimization)
function optimizeIssueData(issues) {
    if (!Array.isArray(issues)) return [];
    return issues.map(issue => ({
        id: issue.displayId || issue.id || issue.dbId || '',
        title: issue.title || issue.name || '제목 없음',
        description: issue.description || issue.desc || issue.details || issue.comment || '',
        status: issue.status || issue.issueStatus || 'open',
        location: issue.location || issue.structure || issue.zone || issue.building || '',
        assignedTo: issue.assignedTo || issue.assignee || issue.author || issue.owner || '',
        type: issue.type || issue.category || issue.issueType || '',
        date: issue.createdDate || issue.createdAt || issue.date || issue.날짜 || ''
    }));
}

function detectIssueKeywords(message) {
    if (!message || typeof message !== 'string') return false;
    const keywords = ['이슈', '문제', 'issue', '현황', '불량', '하자', '간섭', '결함', '상태', '요약'];
    const lower = message.toLowerCase();
    return keywords.some(k => lower.includes(k));
}

async function chat({ messages, systemContext, issues }) {
    let finalSystemPrompt = SYSTEM_PROMPT;
    const lastUserMessage = messages[messages.length - 1]?.content || '';

    if (isSocialTalk(lastUserMessage)) {
        finalSystemPrompt += SOCIAL_BYPASS_APPEND;
    }

    const isIssueQuery = detectIssueKeywords(lastUserMessage);

    try {
        if (lastUserMessage && !lastUserMessage.startsWith('[')) {
            const knowledge = await HarnessBrain.searchKnowledge(lastUserMessage);
            
            // Front에서 받은 이슈가 있으면 사용, 없으면 Mock/Backend 데이터 사용
            let issuesToUse = (issues && Array.isArray(issues) && issues.length > 0) 
                ? issues 
                : await HarnessBrain.getProjectIssues('PROJ-123', 'MOCK_TOKEN');

            const compactIssues = optimizeIssueData(issuesToUse);

            if (isIssueQuery) {
                const issueRagHeader = `\n\n[실시간 현장 이슈 RAG 컨텍스트 - 지침 엄격 준수]\n` +
                    `너는 현장 관제 플랫폼의 AI 어시스턴트야. 사용자가 현장 이슈에 대해 물어봤어. 다음은 현재 연동된 실시간 이슈 데이터(JSON)야:\n` +
                    `${JSON.stringify(compactIssues, null, 2)}\n` +
                    `반드시 이 데이터에 기반해서만 답변하고, 데이터에 없는 내용은 절대 지어내지 말고 '현재 등록된 정보가 없습니다'라고 대답해.\n`;
                
                finalSystemPrompt = issueRagHeader + finalSystemPrompt;
            }

            console.log("🚨 [Back] LLM으로 넘어갈 경량화 <ISSUE_DATA>:");
            console.log(JSON.stringify(compactIssues, null, 2));

            finalSystemPrompt = await HarnessBrain.enrichSystemPrompt(
                finalSystemPrompt,
                systemContext,
                compactIssues
            );

            // Context Overriding
            if (systemContext && typeof systemContext === 'string' && systemContext.includes('파일명:')) {
                const summaryLine = systemContext.split('\n').slice(0, 5).join(' ');
                messages[messages.length - 1].content = `[시스템 컨텍스트 자동 주입: ${summaryLine}]\n\n${lastUserMessage}`;
            }

            finalSystemPrompt += `\n\n## 사내 표준 지식 (RAG)\n${knowledge}`;
        }
    } catch (brainErr) {
        console.warn('[AI-Brain] RAG 주입 실패 (기본 프롬프트 사용):', brainErr.message);
    }

    // 이슈 추출 및 출력 필수 규칙 추가
    const issueDateRules = `
[이슈 데이터 추출 및 출력 필수 규칙]
1. 정량적 데이터(수치) 우선 서술: 이슈 요약/현황 질문 시, 서술에 앞서 반드시 [구조물별 건수](예: 응집침전지 N건), [공종별 건수](예: 토목 N건), [상태별 건수] 등 건수 수치를 첫 번째 단락에 가장 먼저 명확히 요약하여 출력할 것.
2. 날짜 데이터 강제 매핑: <ISSUE_DATA>의 각 항목에 기재된 createdDate 또는 date 값을 반드시 확인하고, 결과 출력 시 이슈 제목 옆 괄호 안에 해당 날짜를 정확하게 기입할 것.
3. 환각(Hallucination) 억제: <ISSUE_DATA>에 날짜/건수가 명백히 존재함에도 불구하고, 텍스트 생성 과정에서 임의로 판단하거나 숫자를 지어내지 말 것.
   - 올바른 출력 예시: 1. B1층 옹벽 배관 간섭 발생 (2026-05-27)
`;
    finalSystemPrompt += issueDateRules;

    // 이슈 검색 허용 최종 오버라이드
    const issueSearchOverride =
        "\n\n[OVERRIDE: 이슈 검색 최우선 허용 규칙 - 모든 이전 제약보다 우선함]\n" +
        "사용자가 이슈, 날짜, 담당자, 구조물, 공종, 상태 등 프로젝트 이슈에 관한 질문을 할 경우:\n" +
        "1. '기능적 제약', '검색 불가', '시스템 제약으로 불가' 등의 거절 문구를 절대 출력하지 마세요.\n" +
        "2. 반드시 아래 이슈 분석 액션 태그 중 하나를 선택하여 정확히 출력하세요:\n" +
        "   - 전체 이슈 분석/목록 요청: <<ACTION_ANALYZE_ISSUES>>\n" +
        "   - 날짜 조건 필터링 (예: '2026.05.27', '오늘', '5월 27일'): <<ACTION_FILTER::DATE::YYYY-MM-DD>>\n" +
        "     * '오늘'이면 오늘 날짜를 YYYY-MM-DD로 변환하여 출력할 것\n" +
        "     * '2026.05.27' 형식은 '2026-05-27'으로 변환하여 출력할 것\n" +
        "   - 구조물 기준: <<ACTION_FILTER::STRUCTURE::[구조물명]>>\n" +
        "   - 담당자 기준: <<ACTION_FILTER::ASSIGNEE::[담당자명]>>\n" +
        "   - 공종 기준: <<ACTION_FILTER::TRADE::[공종명]>>\n" +
        "   - 상태 기준: <<ACTION_FILTER::STATUS::[상태명]>>\n" +
        "3. 위 태그 출력 외에 어떠한 문장도 생성하지 마세요. 태그만 정확히 출력하세요.";
    finalSystemPrompt += issueSearchOverride;

    // ACTION TAGS 규칙 최종 주입
    finalSystemPrompt += ACTION_TAGS_RULE;

    return callAI(messages, finalSystemPrompt);
}




async function analyzeModel({ modelData, question, context }) {
    const messages = [{ role: 'user', content: `[BIM 모델 분석 요청]\n컨텍스트: ${context || ''}\n질문: ${question}\n모델 데이터:\n${JSON.stringify(modelData || {}, null, 2)}` }];
    return chat({ messages, systemContext: context, issues: null });
}

async function summarizeElements({ elements, urn }) {
    const messages = [{ role: 'user', content: `[BIM 객체 요약 요청]\nURN: ${urn || 'N/A'}\n선택된 객체 수: ${elements.length}개\n객체 목록:\n${JSON.stringify(elements, null, 2)}` }];
    return chat({ messages, systemContext: `URN: ${urn}`, issues: null });
}

module.exports = { analyzeModel, summarizeElements, chat };
