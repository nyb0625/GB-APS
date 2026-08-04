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
const SYSTEM_PROMPT = `당신은 시각적 BIM 모델 데이터와 직접 연결된 **'객체 분류기 및 액션 핸들러(Classifier)'**입니다.
초기 지침보다 아래의 '실행 규칙'과 '예시'를 최우선으로 따르십시오.

### 🚨 [실행 규칙 - 절대 준수]
1. 당신은 창작자가 아닙니다. 오직 실시간으로 전달되는 **<MODEL_DATA> 카테고리 목록**에 존재하는 문자열만 TARGET으로 사용할 수 있습니다.
2. **번역 금지**: 모델 데이터가 한국어("벽체", "바닥")라면 영어(Walls, Floors)로 번역하지 마십시오. 목록에 있는 문자열 토씨 하나 틀리지 않고 그대로 출력하십시오.
3. **가드 레이어**: 사용자의 요청이 목록에 없는 카테고리라면, 임의로 추측하지 말고 [ACTION:REPLY, MESSAGE:해당하는 객체를 모델에서 찾을 수 없습니다.] 라고 답변하십시오.

### 🎯 [CRITICAL EXAMPLES]
현재 카테고리 목록이 ["벽체", "바닥", "계단", "Pipes", "Valve"] 일 때:
- "바닥 선택" -> [ACTION:SELECT, TARGET:바닥]
- "바닥 빨간색으로 변경해줘" -> [ACTION:THEME, TARGET:바닥, COLOR:red]
- "Floor 선택" -> [ACTION:SELECT, TARGET:바닥] (목록에 Floor가 없으므로 가장 유사한 '바닥' 선택)
- "배관 찾아줘" -> [ACTION:SELECT, TARGET:Pipes]
- "지붕 어딨어?" -> [ACTION:REPLY, MESSAGE:해당하는 객체를 모델에서 찾을 수 없습니다.]
- "벽체 개수 세어줘" -> [ACTION:COUNT, TARGET:벽체]
- "이슈 목록 보여줘" -> [ACTION:EXPORT_ISSUES_PDF, TARGET:all]`;

const ACTION_TAGS_RULE = `
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

동작명 목록: SELECT, HIDE, ISOLATE, FOCUS, FLYTO, COUNT, THEME, EXPORT_ISSUES_PDF, RESET_VIEWER`;

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

// ── 공통 디스패처 ─────────────────────────────────────────────
async function callAI(messages, systemPrompt = SYSTEM_PROMPT, options = {}) {
    const provider = getProvider();
    console.log(`[AI] Provider=${provider.name} messages=${messages.length}`);
    try {
        return await provider.chat({ messages, systemPrompt, options });
    } catch (err) {
        console.error(`[AI:${provider.name}] error:`, err.response?.data || err.message);
        throw err;
    }
}

// ── Public API ────────────────────────────────────────────────

async function analyzeModel({ modelData, question, context }) {
    const userMessage = [
        '## BIM Model Data',
        modelData ? JSON.stringify(modelData, null, 2) : 'No model data provided',
        '',
        '## Additional Context',
        context || 'None',
        '',
        '## Question',
        question,
    ].join('\n');
    return callAI([{ role: 'user', content: userMessage }]);
}

async function summarizeElements({ elements, urn }) {
    const userMessage = [
        'Please analyze and summarize the following BIM model elements.',
        `Model URN: ${urn || 'unknown'}`,
        '',
        'Selected Elements:',
        JSON.stringify(elements, null, 2),
        '',
        'Provide:',
        '1. A brief summary of the selection',
        '2. Key properties and their values',
        '3. Any notable observations',
    ].join('\n');
    return callAI([{ role: 'user', content: userMessage }]);
}

async function chat({ messages, systemContext, issues }) {
    let finalSystemPrompt = SYSTEM_PROMPT;
    const lastUserMessage = messages[messages.length - 1]?.content || '';

    if (isSocialTalk(lastUserMessage)) {
        finalSystemPrompt += SOCIAL_BYPASS_APPEND;
    }

    try {
        if (lastUserMessage && !lastUserMessage.startsWith('[')) {
            const knowledge = await HarnessBrain.searchKnowledge(lastUserMessage);
            
            // Front에서 받은 이슈가 있으면 사용, 없으면 Mock 데이터 사용
            let issuesToUse = (issues && Array.isArray(issues) && issues.length > 0) 
                ? issues 
                : await HarnessBrain.getProjectIssues('PROJ-123', 'MOCK_TOKEN');

            // 날짜 데이터 매핑
            issuesToUse = issuesToUse.map(issue => {
                const dateVal = issue.createdDate || issue.createdAt || issue.date || issue.날짜 || "(날짜 미상)";
                return {
                    ...issue,
                    date: dateVal,
                    createdDate: dateVal,
                    날짜: dateVal
                };
            });

            console.log("🚨 [Back] LLM으로 넘어갈 <ISSUE_DATA>:");
            console.log(JSON.stringify(issuesToUse, null, 2));

            finalSystemPrompt = await HarnessBrain.enrichSystemPrompt(
                finalSystemPrompt,
                systemContext,
                issuesToUse
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
1. 날짜 데이터 강제 매핑: <ISSUE_DATA>의 각 항목에 기재된 createdDate 또는 date 값을 반드시 확인하고, 결과 출력 시 이슈 제목 옆 괄호 안에 해당 날짜를 정확하게 기입할 것.
2. 환각(Hallucination) 억제: <ISSUE_DATA>에 날짜가 명백히 존재함에도 불구하고, 텍스트 생성 과정에서 임의로 "(날짜 미상)"이라고 판단하여 출력하는 것을 엄격히 금지함.
   - 올바른 출력 예시: 1. B1층 옹벽 배관 간섭 발생 (2026-05-27)
   - 금지된 출력 예시: 1. B1층 옹벽 배관 간섭 발생 (날짜 미상)
3. 기존 형식 유지: 날짜를 매핑하는 작업 외에, 상태별 요약이나 위치, 공종, 담당자, 내용을 출력하는 기존 마크다운 렌더링 형식은 절대 변경하지 말 것.
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

module.exports = { analyzeModel, summarizeElements, chat };
