/**
 * [Harness Engineering] Layer 3: Knowledge & Information Retrieval (The "Brain")
 * harness-brain.js - 지식 검색(RAG) 및 APS Issues API 연동 엔진
 */

'use strict';

const fs = require('fs');
const path = require('path');

const HarnessBrain = {
    /**
     * APS Issues API를 통해 프로젝트 이슈 목록을 가져옵니다.
     * (Mock Data 및 템플릿 제공)
     */
    getProjectIssues: async function (containerId, token) {
        // 실제 운영 시 ACC Issues API 호출
        // Sample: https://developer.api.autodesk.com/issues/v1/containers/${containerId}/issues
        return [
            { 
                id: 'ISS-001',
                title: 'B1층 옹벽 배관 간섭 발생', 
                status: 'open', 
                linkedElement: 'Pipe [10423]',
                assignee: '홍길동',
                trade: '기계설비',
                structure: 'B1층 옹벽',
                createdDate: '2026-05-27',
                description: '지하 1층 옹벽을 관통하는 슬리브 배관이 구조벽 보강근과 간섭하여 상세 조율 요망.'
            },
            { 
                id: 'ISS-002',
                title: '송수펌프실 밸브 규격 상이', 
                status: 'in_progress', 
                linkedElement: 'Valve [20987]',
                assignee: '이순신',
                trade: '기계설비',
                structure: '송수펌프실',
                createdDate: '2026-05-13',
                description: '송수펌프 토출측 체크밸브 규격이 설계서(KS B 2332)와 다르게 반입되어 교체 필요.'
            },
            {
                id: 'ISS-003',
                title: '정수지 콘크리트 균열 보수 필요',
                status: 'open',
                linkedElement: 'Wall [50221]',
                assignee: '김유신',
                trade: '토목구조',
                structure: '제2정수지',
                createdDate: '2026-06-01',
                description: '제2정수지 외벽 콘크리트 표면에 0.2mm 내외의 미세 균열 발생하여 에폭시 그라우팅 보수 요망.'
            }
        ];
    },

    /**
     * 사내 표준(수량산출 기준서 등) 및 LLM_Wiki(CDE/BIM)에서 관련 지식을 검색합니다.
     */
    searchKnowledge: async function (query) {
        console.log(`[Brain-Harness] 지식 검색(RAG) 중: ${query}`);

        let additionalKnowledge = "";
        
        // 🚨 [CDE & BIM 지식 RAG 연동]
        // 쿼리에 CDE, BIM, LOD, ACC, Revit, IFC, ISO 등 도메인 키워드가 있는 경우
        var upperQuery = query.toUpperCase();
        var isBimCdeQuery = [
            'BIM', 'CDE', 'LOD', 'ACC', 'REVIT', 'IFC', 'ISO', 
            '공통 데이터', '공통데이터', '공통데이터환경', '정보 모델', '정보모델',
            'SSOT', 'WIP', 'SHARED', 'PUBLISHED', 'ARCHIVED', '개념'
        ].some(function(keyword) {
            return upperQuery.indexOf(keyword.toUpperCase()) !== -1;
        });

        if (isBimCdeQuery) {
            try {
                // LLM_Wiki/40_CDE_BIM 디렉토리 내의 지식 마크다운 스캔
                var targetDir = path.join(__dirname, '../LLM_Wiki/40_CDE_BIM');
                if (fs.existsSync(targetDir)) {
                    var files = fs.readdirSync(targetDir);
                    var wikiContents = [];
                    files.forEach(function(file) {
                        if (file.endsWith('.md')) {
                            var filePath = path.join(targetDir, file);
                            var content = fs.readFileSync(filePath, 'utf8');
                            
                            // 파일 이름과 마크다운 요약 추출해서 컨텍스트화
                            wikiContents.push(`### [사내 지식 문서: ${file}]\n${content}\n`);
                        }
                    });
                    if (wikiContents.length > 0) {
                        additionalKnowledge = "\n\n## 🌐 [CDE & BIM 사내 표준 위키 데이터]\n" + wikiContents.join('\n');
                        console.log(`[Brain-Harness] CDE/BIM RAG 데이터 주입 완료 (${wikiContents.length}개 문서)`);
                    }
                }
            } catch(e) {
                console.warn('[Brain-Harness] CDE/BIM Wiki 파일 스캔 실패:', e.message);
            }
        }

        const mockKnowledgeBase = [
            { 
                key: '콘크리트', 
                content: '※ 콘크리트 수량 산출 표준: 콘크리트 수량 산출 시 개구부 면적 0.1㎡ 이하 및 구조 부재 결합부 중복체적은 별도로 공제하지 않는다.' 
            },
            { 
                key: '거푸집', 
                content: '※ 거푸집 수량 산출 표준: 거푸집 수량은 콘크리트와 접하는 실 구조 단면적으로 산출하며, 설계 층고 3.5m 초과 시에는 동바리 할증률(10%)을 적용해야 한다.' 
            },
            {
                key: '배관',
                content: '※ 배관 및 피팅 표준: 관구경 50A 이하의 급수관은 나사접합 방식을 사용하며, 65A 이상은 플랜지 접합 또는 용접 접합을 원칙으로 한다.'
            },
            {
                key: '밸브',
                content: '※ 밸브 설치 표준: 주요 기기 차단용 및 역류 방지용 밸브 설치 시 점검 및 유지보수를 위한 이격 거리(최소 300mm 이상)를 확보해야 한다.'
            }
        ];

        const match = mockKnowledgeBase.find(k => query.includes(k.key));
        var baseRes = match ? match.content : "";
        
        if (additionalKnowledge) {
            return (baseRes ? (baseRes + "\n\n") : "") + additionalKnowledge;
        }

        return baseRes || "관련 사내 표준 서식을 찾을 수 없습니다. 일반적인 건설 기준에 따라 답변하십시오.";
    },

    /**
     * 모든 지식 컨텍스트를 하나로 결합합니다.
     */
    enrichSystemPrompt: async function (basePrompt, modelContext, issues) {
        let enriched = basePrompt;

        if (modelContext) {
            const contextStr = (typeof modelContext === 'string')
                ? modelContext
                : JSON.stringify(modelContext, null, 2);
            enriched += `\n\n<MODEL_DATA>\n${contextStr}\n</MODEL_DATA>`;
        }

        if (issues && issues.length > 0) {
            enriched += `\n\n<ISSUE_DATA>\n${JSON.stringify(issues, null, 2)}\n</ISSUE_DATA>`;
        }

        return enriched;
    }
};

module.exports = HarnessBrain;
