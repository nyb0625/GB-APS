# 강북정수장 APS 탭별 기능 정리

작성 기준: 2026-08-14 현재 프로젝트 소스 기준

이 문서는 `public/index.html`의 메인 탭 구조와 각 탭에서 로드되는 JavaScript 모듈, Express API 라우트를 기준으로 현재 프로젝트에서 사용할 수 있는 기능을 탭별로 정리한 자료입니다.

## 공통 기능

### 상단 공통 영역

- 메인 탭 전환: 홈, BIM, 현장, 프로젝트, 이슈, 현장 관제(CCTV)
- 모델 선택 드롭다운: 로컬 OSS 또는 Autodesk Docs에서 조회된 BIM 모델을 선택해 3D 뷰어에 로드
- BIM 모델 업로드: `.rvt`, `.f3d`, `.nwd`, `.dwg`, `.zip` 파일 업로드 후 APS Model Derivative 변환 요청
- Autodesk Docs 로그인: Autodesk OAuth 로그인, 프로필/토큰 기반 ACC 문서 및 이슈 연동
- 목록으로 이동: Autodesk Docs 탐색 화면에서 이전 목록으로 복귀

### 3D Viewer 공통 기능

- Autodesk Viewer 7.x 기반 BIM 모델 표시
- 모델 로드, 선택, 확대/포커스, 격리, 색상 강조, 초기화
- 모델 메타데이터 추출: Category, Type, Name, 층, 구조 등
- 스크린샷 캡처
- 다중 모델 병합 로드
- 모델 가시성/병합 팝업
- 폴더/공종 기준 RVT 모델 트리 조회
- 특정 이슈와 연결된 모델 버전 및 객체 위치로 이동

### AI 채팅 패널

- 우측 하단 플로팅 버튼으로 AI 채팅 패널 열기/닫기
- 채팅 패널 드래그 이동 및 크기 조절
- 현재 BIM 모델 메타데이터를 포함한 질의
- 이슈 현황 요약, 이슈 차트 응답, 최근 이슈 목록 질의
- 시공 BIM 주간 업무 현황 질의
- 이슈 필터 적용 및 PDF 내보내기 명령 실행
- OpenAI, Gemini, Ollama provider 구조 지원

## 1. 예시1 탭

### 목적

강북정수장 증설공사 현황을 한 화면에 요약해 보여주는 현장 종합 모니터링 샘플 화면입니다.

### 주요 기능

- 실시간 공정 D-Day 표시
- 공사 기간 및 종합 공정률 표시
- 현재 공종 안내
- 공사 개요 이미지 및 기본 정보 표 표시
- 현장 관련 주요 KPI/현황 패널 표시
- 날씨 정보 표시
- CCTV 미리보기 채널 선택
- CCTV HLS 스트림 재생
- CCTV 스트림 실패 시 로컬 이미지 fallback 표시
- 현장 관제 탭으로 바로 이동

### 연결 모듈/API

- `public/js/example1-cctv.js`
- `GET /api/cctv/live`
- `GET /api/cctv/proxy/:protocol/:host`

## 2. 예시2 / BIM TEST 탭

### 목적

이 탭은 2026-08-28 기준으로 현재 플랫폼에서 제거하고 `archived-features/BIM_TEST` 폴더에 보관했습니다.
작업 일정, BIM 모델 업데이트, 프로젝트 파일 검색 기능을 묶어 실험하던 샘플 화면입니다.

### 작업 일정 영역

- Forma 이슈 기반 작업 일정 조회
- 업데이트/건화 관련 이슈를 작업 일정 데이터로 정규화
- 월별 Gantt 차트 표시
- 전체, 진행중, 완료, 지연, 평균 기간 KPI 표시
- 월 선택 필터
- 상태 필터
- 제목, 담당자, 위치, 유형, 설명 검색
- 공휴일, 토요일, 일요일, 오늘 날짜 강조
- 캐시 기반 빠른 표시 및 백그라운드 새로고침

### CDE 업무 영역

- 로그인 사용자 기준으로 본인 관련 업무 목록 표시
- 진행 업무/종료 업무 전환
- 업무 생성
- 요청자, 관리자, 작업자 역할 기반 업무 흐름 처리
- 관리자에게 검토 요청
- 관리자가 작업자 지정 및 업무 전달
- 작업자가 결과물 선택 후 검토 요청
- 관리자가 반려 또는 승인
- 요청자가 최종 종료
- 업무 삭제
- 처리 이력 표시
- ACC Docs 결과물 선택 모달
- 선택한 결과물을 프로젝트 3D 뷰어에서 열기
- 서버 저장 실패 시 localStorage 백업 사용

### 연결 모듈/API

- `archived-features/BIM_TEST/example2-schedule.js`
- `public/js/example2-cde-tasks.js` (현재 저장소에 파일 없음)
- `GET /api/issues/forma-gangbuk?limit=1000&workSchedule=1`
- `GET /api/tasks/workflow`
- `PUT /api/tasks/workflow`
- `POST /api/tasks/workflow`
- `DELETE /api/tasks/workflow/:taskId`
- `GET /api/auth/profile`
- `GET /api/hubs/:hub_id/projects/:project_id/members`
- `GET /api/hubs/:hub_id/projects/:project_id/contents`

## 3. 월간 이슈 현황 탭

### 목적

구조물별 월간 이슈 진행 현황을 전체 구조물 기준으로 분석하는 화면입니다.

### 주요 기능

- 기준 월 선택
- 상태 필터
- 구조물 검색
- 상태별 보기와 유형별 보기 전환
- 월간 이슈 현황 새로고침
- 월간 이슈 PDF 내보내기
- 구조물/월 기준 이슈 집계
- 생성, 검토, 지연, 종료 상태 그룹화
- 설계, 간섭, 업무/업데이트 등 유형 그룹화
- 구조물별 드릴다운 모달

### 연결 모듈/API

- `public/js/construction-dashboard.js`
- `GET /api/issues/forma-gangbuk?limit=500`
- `POST /api/issues/export-pdf`

## 4. 현장 탭

### 목적

시공 BIM 관점에서 구조물별 이슈, 주간 업무, 공정 진행, 모델 업데이트를 통합 관리하는 운영형 대시보드입니다.

### 이슈/구조물 현황

- 전체 이슈 로드 및 새로고침
- 구조물별 이슈 Gantt/현황 표시
- 상태 그룹별 이슈 집계
- 간섭/설계/업무 유형별 이슈 집계
- 구조물 클릭 시 상세 이슈 모달 열기
- 월간 이슈 현황 탭과 동일한 SSOT 캐시 공유

### 주간 업무 보드

- 주차 선택
- 업무 추가, 수정, 삭제
- 수행 인원, 구분, 상태, 시작일, 마감일, 내용 관리
- 주간 업무 목록 보기
- 필터 보기
- 통계 보기
- 업무 타임라인 보기
- 월간/연간 타임라인 스케일 전환
- 수행 인원 기준 또는 구분 기준 타임라인 그룹화
- 타임라인 확대 모달
- 상태별 업무 통계 모달

### 시공 진행 패널

- 우선시공부, 증설/본공사 등 구역별 공정 항목 표시
- 공정률, 상태, 시작일, 종료일 관리
- 공정 항목별 진행 막대 표시
- 모델 업데이트 통계 카드
- 모델 업데이트 상세 모달
- 모델 업데이트 항목을 프로젝트 뷰어로 열기

### 4D 시공 시뮬레이션

- APS 3D Viewer 기반 주간/단계별 시공 시각화
- 선택 객체를 단계별 공정 그룹에 배정
- 단계 재생
- 단계별 색상 강조
- 시뮬레이션 초기화
- 배정 데이터 localStorage 저장

### 레이아웃 개편 전 기능 인벤토리

- `공사 진행률`: `bim-dashboard-progress`, `bim-progress-donuts` 기반 구역별 공정률 요약 카드입니다. 현재 개편안에서는 화면에서 숨기되 DOM은 보존합니다.
- `공사 일정`: `bim-dashboard-schedule`, `bim-construction-gantt` 기반 현재 진행 공사 Gantt입니다. 이슈 총건수, 새로고침, 주간/월간/연간 전환, 확대 모달 기능을 유지합니다.
- `BIM 모델 간편조회`: `bim-dashboard-inspector` 기반 구조물 폴더 선택, 공종 태그, 3D 모델 열기, 부재 검색, 거리/치수 측정, 단면 보기, 부재 정보 기능입니다. 현재 개편안에서는 화면에서 숨기되 DOM은 보존합니다.
- `현장 실시간 연동`: `bim-dashboard-live`, `bim-progress-map`, `bim-live-hotspots`, `bim-progress-mini-viewer` 기반 영역도/핫스팟/3D 미니 뷰어 연동 패널입니다.
- `현장 CCTV`: `bim-dashboard-cctv`, `bim-live-cctv-grid` 기반 실시간 CCTV 스트림, 구조물 연계 CCTV 강조, 현장 관제 탭 이동 기능입니다.
- `업무 운영/숨김 지표`: `bim-dashboard-operations`, `bim-dashboard-hidden-metrics` 기반 주간 업무, 검색, 통계, 타임라인, 간섭/이슈 집계 연결 DOM입니다. 현재 화면에서는 숨김 상태로 기능 연결용 DOM만 유지합니다.

### 2026-08-27 레이아웃 개편 방향

- 상단: `공사 일정`을 전체 폭으로 배치하고 상단 영역을 하단보다 조금 높게 가져갑니다.
- 하단 좌측: `현장 실시간 연동` 패널을 배치합니다.
- 하단 우측: `현장 CCTV` 패널을 배치합니다.
- 하단 좌우 비율은 40:60으로 구성합니다.
- `공사 진행률`과 `BIM 모델 간편조회`는 삭제하지 않고 숨김 처리해 향후 재배치 가능성을 보존합니다.

### 연결 모듈/API

- `public/js/construction-dashboard.js`
- `public/js/weekly-3d-viewer.js`
- `GET /api/issues/forma-gangbuk`
- `GET /api/models/tree`
- `GET /api/hubs/:hub_id/projects/:project_id/members`

## 5. 대시보드 탭

### 목적

프로젝트 일정, 인원, 이슈 현황을 한 화면에서 보는 메인 현황판입니다.

### 일정/Gantt 기능

- 업무 일정 Gantt 표시
- 일정 추가
- 일정 클릭 수정
- 일정 우클릭 삭제
- 계획 시작/종료일 관리
- 실제 시작/종료일 관리
- 담당자 입력
- 진행률 자동 계산
- 지연/완료 상태 표시
- 주말/공휴일/오늘 날짜 강조
- 가로 스크롤 슬라이더
- 일정 표와 타임라인 세로 스크롤 동기화
- 일정 localStorage 저장

### KPI 기능

- 금주 발생 이슈 수
- 금주 이슈 해결률
- 금주 투입 인원
- 투입 인원 수동 수정
- 진행중 업무 수

### 이슈 차트/목록 기능

- 이슈 유형 도넛 차트
- 상태별, 구조물별, 공종별 서브 차트
- 주차별/담당자별/구조물별/상태별 막대 차트 전환
- 진행중 이슈 목록 표시
- Forma 이슈 SSOT 캐시와 연동

### 연결 모듈/API

- `public/js/dashboard.js`
- `GET /api/issues/forma-gangbuk?limit=500`
- `GET /api/hubs/:hub_id/projects/:project_id/members`

## 6. 프로젝트 탭

### 목적

ACC/Autodesk Docs와 로컬 OSS 모델을 탐색하고, BIM 모델을 로드/비교/관리하는 3D 작업 화면입니다.

### Autodesk Docs 탐색

- Hub 목록 조회
- Project 목록 조회
- Folder/File 탐색
- Breadcrumb 탐색
- RVT 파일 검색
- 파일 버전 목록 조회
- 특정 버전 선택 및 로드
- 현재 버전 표시
- 최근 선택 모델/폴더 상태 유지
- Autodesk Docs 로그인 세션 기반 접근

### 3D 모델 작업

- BIM 모델 로드
- 모델 선택/확대/격리
- 객체 속성 조회 기반 AI/이슈 연동
- 모델 가시성/병합 팝업
- 여러 RVT 모델 병합 표시
- 공종/파일명 기반 모델 분류
- 모델 회전 보정
- 모델별 가시성 on/off
- 모델 제거
- 메인 뷰어와 CCTV 뷰어 간 활성 대상 분리

### 버전/비교 기능

- 파일 버전 드롭다운
- 버전 전환 시 기존 카메라 시점 복원
- 이전 버전/현재 버전 비교 뷰어
- 좌우 뷰어 카메라 동기화
- 추가/삭제/변경 객체 색상 강조
- 변경 속성 비교
- 비교 결과 3컬럼 표시
- 비교 결과 필터링
- 비교 이슈 생성 및 수정
- 이슈와 비교 버전 연결

### 업로드/변환 기능

- 로컬 모델 파일 업로드
- APS OSS 객체 목록 조회
- Model Derivative 변환 요청
- 변환 상태/manifest 조회

### 연결 모듈/API

- `public/js/main.js`
- `public/js/explorer.js`
- `public/js/viewer.js`
- `public/js/version-manager.js`
- `public/js/model-visibility.js`
- `public/js/comparison.js`
- `public/js/diff-viewer.js`
- `GET /api/hubs`
- `GET /api/hubs/:hub_id/projects`
- `GET /api/hubs/:hub_id/projects/:project_id/contents`
- `GET /api/hubs/:hub_id/projects/:project_id/contents/:item_id/versions`
- `GET /api/hubs/:hub_id/projects/:project_id/search-rvt`
- `GET /api/models`
- `POST /api/models`
- `GET /api/models/:urn/status`
- `GET /api/models/tree`
- `POST /api/diff/run`
- `POST /api/versions/diff/run`
- `POST /api/versions/diff/create`
- `GET /api/versions/diff/:diffId/status`
- `GET /api/versions/diff/:diffId/results`

## 7. 이슈 탭

### 목적

Forma/ACC 이슈와 로컬 이슈, 비교 이슈를 통합 조회하고 PDF 보고서 및 3D 위치 확인까지 연결하는 이슈 관리 화면입니다.

### 이슈 목록/필터

- 전체 이슈 조회
- 설계 이슈 필터
- 간섭 이슈 필터
- 업데이트 이슈 필터
- 컬럼별 검색/필터
- 컬럼 표시/숨김
- 컬럼 순서 변경
- 현재 필터 상태 유지
- Forma 이슈 캐시 사용
- 건화 카테고리 이슈 제외/별도 처리

### 이슈 상세

- 이슈 상세 모달
- 제목, 상태, 유형, 담당자, 확인자, 위치, 배치, 시작일, 마감일, 설명 표시
- Snapshot 이미지 표시
- 종료/완료 이슈의 결과 내용 표시
- 3D 뷰어에서 위치보기
- 이슈와 연결된 모델 URN/버전 자동 해석
- 연결 모델이 현재 모델과 다르면 프로젝트 탭에서 해당 모델 로드 후 객체 포커스

### 단독/비교 이슈 관리

- 단독 모델 이슈 생성
- 3D 객체 선택 기반 dbId 저장
- 제목, 상태, 유형, 설명, 구조물명, 공종, 담당자, 확인자, 시작일, 마감일, 배치 정보 관리
- 여러 캡처 이미지 첨부
- 종료 처리 시 조치 내용 및 완료 캡처 추가
- 버전 비교 이슈 생성/수정
- 비교 전/후 버전 정보 보존
- 로컬 저장소 기반 이슈 병합 표시

### PDF 보고서

- 단일 이슈 PDF 내보내기
- 선택/필터된 이슈 일괄 PDF 내보내기
- 보고서 필드 선택
- Before/After 이미지 보고서 지원
- Puppeteer/Handlebars 기반 A4 가로 보고서 생성

### 연결 모듈/API

- `public/js/main.js`
- `public/js/issue-manager.js`
- `public/js/comparison.js`
- `GET /api/issues`
- `GET /api/issues/forma-gangbuk`
- `GET /api/issues/forma-gangbuk/:issueId/placement-debug`
- `GET /api/issues/snapshot`
- `POST /api/issues`
- `DELETE /api/issues/:id`
- `POST /api/issues/export-pdf`

## 8. 현장 관제(CCTV) 탭

### 목적

실시간 CCTV 영상과 APS 3D 모델을 나란히 배치해 현장 영상 기반 이슈 등록과 BIM 위치 검증을 수행하는 화면입니다.

### 실시간 CCTV

- CCTV 라이브 채널 조회
- HLS 스트림 재생
- HLS 프록시 재작성
- 스트림 실패 시 fallback 이미지 표시
- 채널 썸네일 목록 표시
- 채널 선택 시 영상 전환
- 채널별 연결 BIM 모델 자동 로드

### CCTV-3D 모델 연동

- CCTV 전용 Autodesk Viewer 초기화
- 채널별 모델명/URN 기반 BIM 모델 로드
- 모델 트리에서 채널 모델 URN 동적 해석
- 채널별 저장된 3D 카메라 시점 복원
- 현재 3D 시점 저장
- 프리셋 시점 전환: ISO, Top, Front
- CCTV 카메라 각도에 맞춘 뷰어-CCTV 시점 동기화
- 모델 가시성/병합 팝업 실행

### 현장 이슈 등록

- 현재 CCTV 영상 캡처 후 이슈 등록
- 영상 일시정지 오버레이
- 제목, 작성자, 작성일시, 상세 내용 입력
- 활성 채널을 위치/구조물명으로 저장
- 캡처 이미지 압축 저장
- 현장 이슈 목록 표시
- 현장 이슈 수정
- 현장 이슈 삭제
- 현장 이슈 localStorage 저장

### CCTV 보고서

- 등록된 CCTV 현장 이슈 PDF/인쇄 보고서 출력
- 요약 목록 및 상세 페이지 생성
- 캡처 이미지 포함

### 연결 모듈/API

- `public/js/cctv.js`
- `public/js/model-visibility.js`
- `public/js/viewer.js`
- `GET /api/cctv/live`
- `GET /api/cctv/filtered-list`
- `GET /api/cctv/proxy/:protocol/:host`
- `GET /api/models/tree`

## 백엔드 API 기능 요약

### 인증

- Autodesk OAuth 로그인/콜백/로그아웃
- Viewer 토큰 발급
- 로그인 사용자 프로필 조회

### APS/ACC 데이터

- Hub, Project, Folder, File, Version 조회
- ACC 프로젝트 구성원 조회
- RVT 모델 트리 조회
- 모델 업로드 및 변환
- 변환 상태 조회

### 이슈

- Forma 이슈 조회 및 정규화
- 이슈 상세 enrichment
- 이슈 배치/모델 정보 해석
- 이슈 snapshot 이미지 프록시
- 로컬 이슈 CRUD
- PDF 보고서 생성

### 업무/일정

- 일반 작업 일정 저장
- 예시2 CDE 업무 워크플로우 저장
- 업무 흐름 서버 저장 및 localStorage fallback

### CCTV

- 라이브 CCTV 채널 목록 제공
- 공공 CCTV HLS 스트림 프록시
- 필터링된 CCTV 목록 제공

### AI

- 채팅
- 모델 데이터 분석
- BIM 요소 요약
- Provider 설정 상태 조회

### 지도/타일

- VWorld WMTS 타일 프록시
- VWorld 주소 좌표 변환
- Nominatim fallback 지오코딩

## 주요 데이터 저장 위치

- `localStorage.project_schedules`: 대시보드 업무 일정
- `localStorage.dashboard_manual_crew`: 대시보드 투입 인원 수동값
- `localStorage.gangbuk_construction_weekly_tasks`: 시공 BIM 주간 업무
- `localStorage.weekly_4d_phase_data`: 4D 시공 시뮬레이션 단계 배정
- `localStorage.cctv_field_issues`: CCTV 현장 이슈
- `localStorage.cctv_saved_view_*`: CCTV 채널별 3D 카메라 시점
- `localStorage.example2_local_workflow_tasks_v3`: 보관된 BIM TEST CDE 업무 백업
- `data/workflow_tasks.json`: 보관된 BIM TEST CDE 업무 서버 저장 파일
- `data/issues.json`: 로컬 이슈 저장 파일

## 참고 파일

- `public/index.html`: 메인 탭/화면 구조
- `public/js/main.js`: 프로젝트, 이슈, Forma, PDF, 비교 이슈 중심 로직
- `public/js/dashboard.js`: 메인 대시보드
- `public/js/construction-dashboard.js`: BIM/현장 탭
- `public/js/cctv.js`: 현장 관제 탭
- `public/js/example1-cctv.js`: 예시1 CCTV/날씨/D-Day
- `archived-features/BIM_TEST/example2-schedule.js`: 보관된 BIM TEST 작업 일정/모델 업데이트/검색 모듈
- `public/js/example2-cde-tasks.js`: 문서상 예시2 CDE 업무 모듈, 현재 저장소에 파일 없음
- `public/js/viewer.js`: Autodesk Viewer 래퍼
- `public/js/model-visibility.js`: 모델 가시성/병합/회전
- `public/js/diff-viewer.js`: 버전 비교 뷰어
- `routes/`: Express API 라우트
