# 강북정수장 APS AI 플랫폼 — 개발 위키 (LLM Wiki)

본 위키는 강북정수장 APS AI 플랫폼 개발 과정에서 진행된 서버 실행 가이드 및 주요 기능 개선 사항을 구조적으로 정리한 문서입니다.

---

## 1. 서버 구동 가이드
* **실행 환경**: Node.js 20+
* **구동 포트**: `http://localhost:8000` (개발 환경 기준)
* **실행 명령**:
  ```bash
  # Windows PowerShell 실행 정책 제한(PSSecurityException) 우회 구동
  cmd /c "npm run dev"
  ```

---

## 2. 주요 시스템 개선 사항

### 2.1. 일정 추가 모달 담당자 정보 연동 최적화
* **수정 파일**: [public/js/dashboard.js](file:///c:/antigravity/%EA%B0%95%EB%B6%81%EC%A0%95%EC%88%98%EC%9E%A5%20APS/public/js/dashboard.js#L897-L925)
* **기존 문제**: 대시보드 일정 관리에서 담당자 목록 조회 시 특정 프로젝트 ID(`b.374bde3a-83a3-4dd5-80c2-2e01ddeac719`)로 고정되어 타 프로젝트 전환 시 오작동함.
* **해결 내용**:
  * `window.currentProjectId` 및 `localStorage`를 탐색해 현재 사용자가 보고 있는 활성 프로젝트의 ID를 동적으로 바인딩하도록 수정.
  * 프로젝트 전환 시 캐시가 충돌하지 않도록 프로젝트 ID별 캐시 오브젝트(`window.dashboardProjectMembersCache = { projectId, list }`)를 생성하여 사용.

### 2.2. 간트 차트 시각적 어긋남 및 스크롤 개선
* **수정 파일**: 
  * [public/css/dashboard.css](file:///c:/antigravity/%EA%B0%95%EB%B6%81%EC%A0%95%EC%88%98%EC%9E%A5%20APS/public/css/dashboard.css#L210-L302)
  * [public/js/dashboard.js](file:///c:/antigravity/%EA%B0%95%EB%B6%81%EC%A0%95%EC%88%98%EC%9E%A5%20APS/public/js/dashboard.js#L950-L985)
* **기존 문제**: 좌측 테이블 셀의 높이와 우측 타임라인 행의 높이가 일치하지 않고, 세로 스크롤이 따로 작동하여 그래프가 깨짐.
* **해결 내용**:
  * **헤더/데이터 행 높이 통일**: 헤더는 `--gantt-header-h: 32px;`, 데이터 행은 `--gantt-row-h: 38px;`로 고정하고 `box-sizing: border-box`를 강제하여 테두리로 인한 픽셀 오차를 없앰.
  * **세로 스크롤 동기화**: 좌측 테이블(`gantt-table-wrap`)과 우측 타임라인(`gantt-timeline-wrap`)의 세로 스크롤 위치(`scrollTop`)를 실시간 양방향 동기화.
  * **디자인 최적화**: 레이아웃 일관성을 위해 좌측 테이블의 스크롤바 감춤 처리.

### 2.3. 일정 담당자 입력 방식 수정
* **수정 파일**: [public/js/dashboard.js](file:///c:/antigravity/%EA%B0%95%EB%B6%81%EC%A0%95%EC%88%98%EC%9E%A5%20APS/public/js/dashboard.js#L743-L762)
* **기존 문제**: 담당자 정보를 고정된 리스트에서 선택해야 하여 신규 인원 등록 등이 불가함.
* **해결 내용**:
  * 일정 추가/수정 모달에서 기존의 `<select>` 요소를 `<input type="text">`로 대체하여 담당자 정보를 직접 입력할 수 있도록 변경.
  * 선택 방식 폐지에 따라 기존의 불필요한 비동기 멤버 목록 API 조회 로직을 제거하여 성능 향상.

### 2.4. 하단 막대그래프 다차원 지표 분석 필터 구현
* **수정 파일**:
  * [public/index.html](file:///c:/antigravity/%EA%B0%95%EB%B6%81%EC%A0%95%EC%88%98%EC%9E%A5%20APS/public/index.html#L1060-L1070)
  * [public/js/dashboard.js](file:///c:/antigravity/%EA%B0%95%EB%B6%81%EC%A0%95%EC%88%98%EC%9E%A5%20APS/public/js/dashboard.js#L570-L730)
* **기존 문제**: 주차별 이슈 발생 그래프가 1개의 데이터 차원(주차별 구조물 분포)으로 고정되어 다른 분석을 보기 어려움.
* **해결 내용**:
  * 막대그래프 카드 헤더에 지표 분석 필터(드롭다운)를 추가하고, 이에 맞춰 실시간 차트 제목 변경 및 데이터 동적 매핑 구현.
  * **지표 옵션**:
    1. **주차별 이슈 발생 현황** (`weekly_status`): 주차별 총 이슈 수 (단일 컬러 `#00f2fe`)
    2. **이슈 담당자 현황** (`assignee_status`): 상위 8명 담당자의 이슈 보유 수 (단일 컬러 `#8b5cf6`)
    3. **구조물별 이슈 현황** (`structure_status`): 상위 8개 구조물의 이슈 발생 수 (단일 컬러 `#f59e0b`)
    4. **상태별 이슈 현황** (`by_status`): 전체 이슈 상태(Open/진행중/보류/완료) 분포 현황 (상태 고유 컬러 매핑)
  * **시각화 최적화**: 상태별 구분이 필요하지 않은 1~3번 지표는 누적형(Stacked) 설정을 해제하여 단일 막대로 깔끔하게 표현하고, 범례(Legend)를 숨김 처리하여 유효 차트 영역을 확보함.

### 2.5. PDF 보고서 출력 시 비교 이슈의 이미지 중복 첨부 문제 해결
* **수정 파일**: [public/js/comparison.js](file:///c:/antigravity/%EA%B0%95%EB%B6%81%EC%A0%95%EC%88%98%EC%9E%A5%20APS/public/js/comparison.js#L3700-L3708)
* **기존 문제**: 비교 이슈에 대해 PDF 내보내기 시, 이미 상단 비교 테이블 내 `[변경 전]`, `[변경 후]` 섹션에 들어간 2장의 주요 이미지들이 보고서 맨 아래 첨부파일 영역(`pdf-attachment-grid`)에 중복으로 추가 첨부되어 불필요하게 2페이지를 생성하고 침범하는 오류가 있었습니다.
* **해결 내용**:
  * PDF의 배치 출력 스크립트(`buildAndOpenBatchPdf`)에서 이미지 수집 단계 이후, 이슈 유형이 비교 이슈(`isCompareIssue === true`)인 경우에는 메인 비교 테이블에 노출된 `mainImage`와 `afterImage`를 첨부 이미지 목록(`attachedImages`)에서 제외하도록 필터링 로직을 주입하였습니다.
  * 이로 인해 중복 이미지가 하단 첨부 영역에 나타나지 않게 되며, 해당 내용으로 인한 페이지 넘침 현상이 해결되었습니다.

### 2.6. 신규 "현장 관제" (CCTV & BIM 모니터링) 탭 구축
* **수정 및 추가 파일**:
  * [public/index.html](file:///c:/antigravity/%EA%B0%95%EB%B6%81%EC%A0%95%EC%88%98%EC%9E%A5%20APS/public/index.html#L894-L897) — 메인 헤더 탭 메뉴에 "현장 관제" 이동 버튼 연동 및 DOMContentLoaded 리스너를 통한 URL 파라미터(`?tab=...`) 기반 탭 스위칭 적용.
  * [public/js/explorer.js](file:///c:/antigravity/%EA%B0%95%EB%B6%81%EC%A0%95%EC%88%98%EC%9E%A5%20APS/public/js/explorer.js#L533-L536) — 사용자가 모델 탐색기에서 선택한 URN과 이름을 `localStorage`에 자동 보관하여 CCTV 관제 시 자동 연동.
  * [NEW] [public/cctv.html](file:///c:/antigravity/%EA%B0%95%EB%B6%81%EC%A0%95%EC%88%98%EC%9E%A5%20APS/public/cctv.html) — 5:5 비율 of CCTV 임베드 및 APS 3D 뷰어 컨테이너 레이아웃, 하단 위치별 CCTV 제어 보드, 이슈 발행 대화상자 마크업 설계.
  * [NEW] [public/css/cctv.css](file:///c:/antigravity/%EA%B0%95%EB%B6%81%EC%A0%95%EC%88%98%EC%9E%A5%20APS/public/css/cctv.css) — 프리미엄 다크테마 스타일 시트, 카드 호버 인터랙션, 모달 대화상자 정렬 구현.
  * [NEW] [public/js/cctv.js](file:///c:/antigravity/%EA%B0%95%EB%B6%81%EC%A0%95%EC%88%98%EC%9E%A5%20APS/public/js/cctv.js) — 토큰 API를 이용한 뷰어 초기화 및 `localStorage` 기반 모델 로드, `[시점 동기화]` 클릭 시 지정 카메라 각도 이동 애니메이션, `[이슈 등록]` 클릭 시 동영상 정지 오버레이 및 모달 대화상자 연동, 하단 위치별 CCTV 채널 클릭 시 실시간 YouTube 영상 스트림 교체 구현.
  * [NEW] 공정 이미지 3종 (`public/img/lapse/lapse_1.jpg`, `lapse_2.jpg`, `lapse_3.jpg`) — 타임머신 썸네일용 가상 이미지.
* **CCTV 채널 구성 (5개 채널)**:
  * A채널: 급속여과지 구조물 CCTV (`cctv_1`) — 링크: `https://www.youtube.com/live/RVvYQghFCXk?si=QW07EwfF-1kjV0M4` (embed 변환 적용)
  * B채널: 정수지 구조물 CCTV (`cctv_2`)
  * C채널: 송수펌프동 구조물 CCTV (`cctv_3`)
  * D채널: 응집침전지 구조물 CCTV (`cctv_4`)
  * E채널: 착수정 구조물 CCTV (`cctv_5`)
* **상태 연동 및 이슈 모달 바인딩**:
  * CCTV 채널 선택 시 이슈 모달의 '구조물 명' 필드가 연동되어 자동으로 채워지도록 편의성 개선.

### 2.7. 이슈 상세 모달 "배치(Placement)" 클릭 연동 시동 기능 및 다단계 URN 해석 엔진
* **수정 파일**:
  * [public/js/main.js](file:///c:/antigravity/%EA%B0%95%EB%B6%81%EC%A0%95%EC%88%98%EC%9E%A5%20APS/public/js/main.js#L3140-L3246) — `resolveModelUrn` 및 `updateUrnCache` 유틸 함수 구현, `placementInput.onclick` 비동기 URN 획득 & 뷰어 폴백 줌 기능 구현
  * [public/js/explorer.js](file:///c:/antigravity/%EA%B0%95%EB%B6%81%EC%A0%95%EC%88%98%EC%9E%A5%20APS/public/js/explorer.js#L217-L223) — 파일 목록 테이블 렌더링 시 자동으로 URN 캐시 갱신 트리거 주입
* **내용**:
  * 이슈 목록에서 등록된 이슈 클릭 시 생성되는 상세정보 모달창의 배치 정보 입력 칸(`#dyn-issue-placement`)에 클릭 링크 효과(밑줄, 하늘색 텍스트, `pointer` 커서 및 마우스 툴팁 안내)를 추가했습니다.
  * 로컬 및 ACC 이슈 생성 시 `urn` 속성이 저장되지 않아 발생하던 "이동할 3D 모델 URN 정보가 존재하지 않습니다." 문제를 해결하기 위해 **다단계 URN 해석 엔진**을 도입했습니다.
  * **해석 단계**:
    1. **로컬 캐시**: 브라우저 로컬 캐시(`localStorage` key `aps_model_urn_cache`)에 이전에 로드된 적이 있는 매핑 스캔.
    2. **서버 모델 API**: 캐시 미스 시 `/api/models` API를 비동기 호출하여 로컬 모델 리스트 중 파일명과 일치하는 URN을 자동 조회.
    3. **ACC 프로젝트 컨텐츠 재귀 탐색**: ACC의 경우 현재 프로젝트 Contents API(`/api/hubs/{hubId}/projects/{projId}/contents`)를 동적 조회하고 1단계 하위 폴더들까지 실시간 비동기 재귀 스캔하여 매칭되는 URN을 추적/획득.
    4. **뷰어 폴백 줌**: URN 스캔에 최종 실패하였더라도 만약 뷰어상에 임의의 모델이 열려 있는 상태인 경우, 동작을 완전히 중단하지 않고 **현재 뷰어 화면의 3D 공간을 기준으로 대상 dbId 컴포넌트로 포커싱(Zoom-in)**을 수행하도록 예외 폴백 처리 완료.

---

## 3. 히스토리 파일 및 백업 목록
* **최종 변경 내역 상세**: [walkthrough.md](file:///C:/Users/126365_KH/.gemini/antigravity/brain/74650917-1753-4e6b-9650-630ab74e313c/walkthrough.md)
* **레거시 빌드 백업**: `KH-APS__2/` 디렉토리에 이전 소스 코드 백업 보유
