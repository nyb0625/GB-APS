# 4D 시공 시뮬레이션 및 이슈 데이터 SSOT 규제 통합

## 1. 개요 (Overview)
본 문서는 강북정수장 APS 프로젝트의 프론트엔드/백엔드 최신 고도화 기능 중 **4D 시공 공정 시뮬레이션 기능**, **이슈 데이터의 전역 단일 출처(SSOT) 규제**, **CCTV 스마트 BIM 뷰어 동적 URN 매핑**, 그리고 **대시보드 UI/UX 최적화**에 대한 종합적인 기술 명세를 담고 있습니다.

---

## 2. 주요 기능 및 아키텍처 (Key Features & Architecture)

### 2.1 4D 시공 공정 시뮬레이션 UI 및 착색 렌더링 (`weekly-3d-viewer.js`)
- **개념**: Autodesk Forge Viewer 내에서 3D 정수지 구조물의 공정 순서(1단계: 하부 슬래브, 2단계: 벽체, 3단계: 상부 슬래브)를 단계별로 할당하고 4D 시공 순서에 따른 가시성 및 색상을 시각화하는 모듈.
- **주요 구현 특징**:
  - **독립 패널 구축**: 3D 뷰어 하단에 독립된 서브 패널로 위치하여 뷰어 시야를 방해하지 않고 3D 모델 본연의 깔끔한 형상 렌더링 보장.
  - **`LocalStorage` 영구 보존**: 키 `weekly_4d_phase_data`를 통해 페이지 새로고침이나 탭 이동 후에도 사용자가 할당한 객체(`dbId`) 목록을 영구 유지. `🧹 초기화` 버튼 누름 시에만 클리어.
  - **단계별 고유 착색 (Theming Color)**:
    - 🟡 **1단계 (하부 슬래브)**: 선명한 노란색 (`Vector4(1.0, 0.8, 0.0, 0.95)`)
    - 🔵 **2단계 (벽체)**: 선명한 파란색 (`Vector4(0.0, 0.45, 1.0, 0.95)`)
    - 🟢 **3단계 (상부 슬래브)**: 선명한 초록색 (`Vector4(0.15, 0.85, 0.25, 0.95)`)
  - **타 뷰어 격리**: 오직 예시1 탭 스크립트(`weekly-3d-viewer.js`) 내부에서만 동작하여 타 3D 뷰어에 영향을 주지 않음.

### 2.2 이슈 데이터 전역 Single Source of Truth (`window._gangbukFormaSSOT`)
- **개념**: 대시보드, 시공 BIM 대시보드, 월간 이슈 현황 등 타 탭에서 독립적으로 API를 호출하거나 캐시를 오염시키는 문제를 차단하고, 오직 '이슈' 탭에서 관리하는 데이터 원천만 단독 참조하도록 규제.
- **파이프라인 구조**:
  1. `main.js`의 `fetchFormaIssues()`에서 Forma API 수신 후 건화(Gunhwa) 이슈를 거른 순수 데이터셋을 `window._gangbukFormaSSOT`로 정의.
  2. 서브 필터(설계이슈/간섭이슈 등) 클릭 시에도 `window._gangbukFormaSSOT`는 변함없이 보존.
  3. `dashboard.js` 및 `construction-dashboard.js`는 자체 fetch 대신 `window._gangbukFormaSSOT` 또는 `loadFormaIssuesForMainTab()`을 거쳐 100% 동일한 정제 데이터를 수신.

### 2.3 CCTV 탭 스마트 BIM 동적 URN 해소 (`cctv.js`)
- **개념**: CCTV 채널("국립현충원" 등) 선택 시 하드코딩된 URN 대신 live 프로젝트 모델 트리(`/api/models/tree`)에서 모델명(예: `[강북_구조물_신설_06_역세척펌프동_C]`)을 동적으로 수색하여 URN을 실시간 바인딩.
- **효과**: Autodesk Forge URN 갱신 시에도 CCTV BIM 뷰어가 로딩 실패 없이 정확한 3D 모델을 표출함.

### 2.4 현황 진척도 조감도 및 대시보드 UI/UX 정돈
- 최신 전체 배치 조감도 이미지([`public/images/gangbuk-progress-map.png`](file:///E:/antigravity/강북정수장 APS/public/images/gangbuk-progress-map.png)) 수신 및 캐시 버스팅 파라미터 적용.
- 신설 영역 버튼 위치 조정 (`top: 77%`) 및 패널 구분선, 뷰어 높이(`350px`) 정밀 최적화.

---

## 3. 관련 파일 구조 (Related Files)
- [`public/js/weekly-3d-viewer.js`](file:///E:/antigravity/강북정수장 APS/public/js/weekly-3d-viewer.js) — 4D 시뮬레이션 UI & 착색 모듈
- [`public/js/main.js`](file:///E:/antigravity/강북정수장 APS/public/js/main.js) — 전역 이슈 SSOT 관리 및 이슈 탭 렌더러
- [`public/js/dashboard.js`](file:///E:/antigravity/강북정수장 APS/public/js/dashboard.js) — 메인 대시보드 이슈 동기화 모듈
- [`public/js/construction-dashboard.js`](file:///E:/antigravity/강북정수장 APS/public/js/construction-dashboard.js) — 시공 BIM 대시보드 & 월간 이슈 현황 모듈
- [`public/js/cctv.js`](file:///E:/antigravity/강북정수장 APS/public/js/cctv.js) — CCTV 스마트 BIM 동적 URN 해소 모듈
- [`public/index.html`](file:///E:/antigravity/강북정수장 APS/public/index.html) — 레이아웃 및 뷰어 350px 갱신
