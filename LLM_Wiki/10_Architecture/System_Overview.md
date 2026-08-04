---
title: System Overview & Tab Swtiching Architecture
tags: [architecture, SPA, rendering-optimization]
created: 2026-07-16
related: [State_Management]
---

# 🏛️ System Overview & Tab Switching Architecture

본 정수장 APS 통합 관리 시스템은 페이지 새로고침 없이 빠른 전환과 실시간 3D 도면 연동을 달성하기 위해 **단일 페이지 애플리케이션(SPA)** 형태로 설계되었습니다.

---

## 1. 탭 관리 아키텍처 (`window.switchTab`)

이 시스템은 대시보드(`dashboard`), 모델 뷰어(`project`), 이슈 테이블(`issue`) 등 여러 탭 영역을 동적으로 숨기거나 보여줍니다.
- **핵심 진입점**: `public/index.html`에 전역 노출된 `window.switchTab(tabName)` 함수가 그 역할을 수행합니다.

### 탭 별 마크업 구조
- 대시보드 탭: `#tab-content-dashboard`
- 프로젝트(뷰어) 탭: `#tab-content-project`
- 이슈 탭: `#tab-content-issue`

```javascript
window.switchTab = function(tabName) {
    // 탭 버튼 active 클래스 제어
    var tabs = document.querySelectorAll('.tab-btn');
    ...
    // 대시보드 및 이슈 탭은 display = 'block'/'flex' 또는 'none'으로 토글
    if (dashboard) dashboard.style.display = (tabName === 'dashboard') ? 'block' : 'none';
    if (issue) issue.style.display = (tabName === 'issue') ? 'flex' : 'none';
    
    // 프로젝트(3D 뷰어) 탭은 특별한 속임수 적용
    if (project) { ... }
};
```

---

## 2. 렌더링 리소스 보존을 위한 [궁극의 속임수 (Invisible Render Trick)]

Autodesk Platform Services (APS) Viewer 모듈은 DOM 상에서 완전히 `display: none` 처리가 될 경우, 브라우저가 WebGL 렌더링 루프를 즉시 중단하고 메모리를 언로드하거나 뷰어 크기 감지에 실패하는 이슈가 있습니다. 이를 방어하고 탭 전환 시 새로 렌더링하는 지연 시간을 제거하기 위해 **CSS Layer 트릭**을 설계하였습니다.

### 기술적 구현 명세

프로젝트 탭이 비활성화될 때 숨기는 로직:

```javascript
if (project) {
    if (tabName === 'project') {
        // 프로젝트 탭 복귀 시: 정상적으로 활성화하고 z-index를 최상위로 올림
        project.style.position = 'relative';
        project.style.opacity = '1';
        project.style.pointerEvents = 'auto';
        project.style.zIndex = '1';
        
        setTimeout(function() {
            var activeViewer = window.myGlobalViewer || window.viewer || window.NOP_VIEWER;
            if (activeViewer && typeof activeViewer.resize === 'function') {
                activeViewer.resize(); // 뷰어 크기 맞춤 갱신
            }
        }, 100);
    } else {
        // 🚨 타 탭으로 이동할 때: 화면 크기는 100%를 유지하되 투명하게 만들고 터치를 넘김
        project.style.position = 'absolute';
        project.style.top = '0px';
        project.style.left = '0px';
        project.style.width = '100%'; 
        project.style.height = '100%';
        project.style.opacity = '0.01'; // 0으로 하면 브라우저 렌더러가 멈추므로 0.01 부여
        project.style.pointerEvents = 'none'; // 클릭 이벤트가 아래 레이어로 흐르도록 통과
        project.style.zIndex = '-999'; // 다른 탭 페이지(z-index: 10) 뒤로 숨김
    }
}
```

### 아키텍처적 장점
1. **Zero-Latency**: 탭 전환 시 뷰어를 해제(tearDown)하고 재시작할 필요 없이 즉시 전환됩니다.
2. **State Preservation**: 사용자가 3D 도면 내에서 분절하고 보던 시점(Camera State)과 선택 부재 정보가 다른 탭을 오가도 그대로 유지됩니다.
3. **Background Sync**: 뷰어가 메모리 상에 살아있어 다른 탭에 있을 때도 마커 생성과 카메라 변경 동기화 루프가 깨지지 않고 안전하게 가동됩니다.
