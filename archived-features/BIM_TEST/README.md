# BIM TEST 탭 보관 정리

## 보관 일자

- 2026-08-28

## 기존 탭 위치

- 탭 ID: `example2`
- 기존 메뉴 라벨: `BIM TEST`
- 기존 HTML 컨테이너: `#example2-tab`
- 기존 진입 함수: `window.preloadExample2Schedule`, `window.ensureExample2Schedule`
- 기존 전용 모듈: `public/js/example2-schedule.js`

## 보관된 파일

- `example2-schedule.js`: 기존 `BIM TEST` 탭의 전용 프런트엔드 모듈 복사본

## 기능 구성

- 업무 일정 대시보드
- Forma 이슈 기반 작업 일정 조회
- 업데이트/건화 관련 이슈의 일정 데이터 정규화
- 월별 Gantt 차트 표시
- 전체, 진행중, 완료, 지연, 평균 기간 KPI 표시
- 월 선택, 상태, 제목, 담당자, 위치, 유형, 설명 검색 필터
- 공휴일, 토요일, 일요일, 오늘 날짜 강조
- 캐시 기반 빠른 표시 및 백그라운드 새로고침
- BIM 모델 업데이트 패널
- Autodesk Docs 모델 트리 조회
- 모델별 버전 목록 표시
- 최신/이전 버전 비교 실행
- 프로젝트 3D 뷰어로 모델 열기
- 프로젝트 파일 통합 검색
- 모델, 도면/문서, CCTV, 이슈 관련 항목 검색
- 검색 결과에서 모델 열기, 문서 보기, CCTV/이슈 상세 연결

## 사용하던 API

- `GET /api/issues/forma-gangbuk?limit=1000&workSchedule=1`
- `GET /api/models/tree`
- `GET /api/hubs/:hub_id/projects/:project_id/contents/:item_id/versions`
- `GET /api/hubs/:hub_id/projects/:project_id/search-files`
- `GET /api/cctv/live`
- `POST /api/diff/run`

## 현재 플랫폼 제거 내역

- 상단 메인 탭 메뉴에서 `BIM TEST` 버튼 제거
- `public/index.html`의 `#example2-tab` DOM 제거
- `example2-schedule.js` 동적 import 및 초기화 함수 제거
- `switchTab('example2')` 처리 분기 제거
- URL 파라미터 `?tab=example2` 허용 목록 제거
- `public/js/example2-schedule.js` 활성 소스 삭제

## 참고

- 문서에 언급된 `public/js/example2-cde-tasks.js`는 현재 저장소에 존재하지 않았습니다.
- 기능을 되살릴 경우 이 폴더의 `example2-schedule.js`를 기준으로 새 탭 또는 기존 BIM 화면에 재배치하면 됩니다.
