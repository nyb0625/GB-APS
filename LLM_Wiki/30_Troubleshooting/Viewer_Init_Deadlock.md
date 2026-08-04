---
title: Viewer Initialization Deadlock & Smart Focus Polling
tags: [troubleshooting, autodesk-viewer, deadlock, timing-issue, event-handling]
created: 2026-07-16
related: [Standalone_Issue]
---

# 🛠️ Viewer Initialization Deadlock & Smart Focus Polling

## 1. 문제 상황 (Trouble Scenario)

이슈 탭에서 상세 이슈 정보를 조회할 때, 배치(Placement) 칸을 클릭하면 **프로젝트 탭으로 이동만 되고 실제 3D 모델 URN 로드 및 해당 위치 줌(Zoom) 기능이 전혀 작동하지 않는 현상**이 발견되었습니다.

### 원인 분석 (Root Cause - Chicken and Egg Deadlock)
1. **Timing Issue**: 프로젝트 탭으로 전환(`window.switchTab('project')`)이 완료되기 전에 뷰어 인스턴스(`window.NOP_VIEWER` 등)를 즉시 확인해 모델을 로드하려고 함으로써 `activeViewer = null`로 중단되었습니다.
2. **Chicken-and-Egg Deadlock (닭과 달걀 데드락)**:
   - 뷰어를 찾기 위해 Polling 대기를 하려고 해도, 뷰어 엔진이 아직 화면에 기동(Initialize)조차 되지 않아 뷰어 인스턴스가 계속 생성되지 않았습니다.
   - 반대로, 뷰어 엔진을 기동하려면 모델 URN을 로드해야 하는데, 뷰어 인스턴스가 존재하지 않아 로드 메서드를 호출할 수 없는 교착 상태에 직면했습니다.
3. **NaN Parser Guard**: dbId가 `"ISSUE-XXXX"` 등의 문자열 형식을 포함할 때 `parseInt` 실패 시 함수 전체가 `return` 종료되는 결함이 동반되었습니다.

---

## 2. 해결 방안 (Solution Architecture - v4 Engine)

이 교착 상태를 타개하기 위해 **"엔진 강제 기동 후 인스턴스 낚아채기"** 기법을 적용하여 뷰어 카메라 워킹 엔진 v4를 수립하였습니다.

```
[배치(Placement) 링크 클릭] ➔ [switchTab('project') 탭 스위칭]
                                      │
                                      ▼ 300ms 대기 (DOM 안정화)
                                      │
                                뷰어 인스턴스 확인
                                      │
           ┌──────────────────────────┴──────────────────────────┐
           ▼ [뷰어 없음]                                         ▼ [뷰어 이미 있음]
   즉시 `loadIntoViewer(targetUrn)`                              즉시 URN 비교
   호출로 뷰어 엔진 강제 활성화                                          │
           │                                                     ├── URN 다름: 새 모델 로드 시작
     5초 Smart Polling                                           │             (GEOMETRY_LOADED 일회성 핸들러)
  (인스턴스 생성 낚아채기)                                        └── URN 같음: 즉시 select & fitToView
           │
           ▼
  `GEOMETRY_LOADED_EVENT`
     일회성 리스너 바인딩
           │
           ▼ 300ms 지연
    select & fitToView
```

---

## 3. 핵심 리팩토링 코드 명세

### 1) 뷰어 미존재 시 강제 로드 및 생성 감시

```javascript
window.focusIssueOnViewer = function(dbId, targetUrn) {
    var numericId    = parseInt(dbId, 10);
    var hasNumericId = !isNaN(numericId) && numericId > 0;
    
    // 1. 프로젝트 탭으로 이동
    if (typeof window.switchTab === 'function') window.switchTab('project');

    // 2. 300ms 후 뷰어 체크
    setTimeout(function() {
        var activeViewer = window.NOP_VIEWER || window.myGlobalViewer || window.viewer ||
                           (window.explorer && window.explorer.viewer ? window.explorer.viewer : null);

        if (!activeViewer) {
            // 🚨 [데드락 격파]: 기다리지 않고 loadIntoViewer로 엔진을 먼저 강제 깨움
            if (targetUrn && window.explorer && typeof window.explorer.loadIntoViewer === 'function') {
                window.explorer.loadIntoViewer(targetUrn);
                
                // 엔진이 기동하여 인스턴스가 낚아채질 때까지 Smart Polling
                waitForViewerCreationAndZoom(); 
            }
        } else {
            // 뷰어가 이미 존재하므로 기존 URN 비교 및 줌인 처리
            executeLoadAndFocus(activeViewer);
        }
    }, 300);
    
    // ── 뷰어 인스턴스 낚아채기 헬퍼 ──
    function waitForViewerCreationAndZoom() {
        var attempts = 0;
        var checkInterval = setInterval(function() {
            attempts++;
            var v = window.NOP_VIEWER || window.myGlobalViewer || window.viewer ||
                    (window.explorer && window.explorer.viewer ? window.explorer.viewer : null);
            if (v) {
                clearInterval(checkInterval);
                // 엔진 켜짐 ➔ 일회성 리스너 대입
                attachFocusOnceLoaded(v);
            } else if (attempts >= 50) {
                clearInterval(checkInterval); // 5초 초과 시 포기
            }
        }, 100);
    }
};
```

### 2) `GEOMETRY_LOADED_EVENT` 일회성 리스너 처리
이전에 사용하던 `tryFocus` 방식의 불안정한 폴링 줌인을 전면 폐기하고, 형상이 완벽하게 그래픽 카드로 업로드 완료되었을 때 단 한 번만 트리거되는 이벤트를 구독하여 카메라를 구동합니다.

```javascript
function attachFocusOnceLoaded(v) {
    if (!hasNumericId) return;
    var fired = false;
    var onLoaded = function() {
        if (fired) return;
        fired = true;
        // 🚨 일회성 해제 (중복 트리거 가드)
        try { v.removeEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, onLoaded); } catch(e) {}
        
        // 부재 데이터 트리 빌드를 고려하여 300ms의 미세 지연을 준 뒤 정확하게 포커싱
        setTimeout(function() {
            try {
                if (typeof v.clearSelection === 'function') v.clearSelection();
                v.select(numericId);
                v.fitToView([numericId]);
            } catch(e) { console.warn('[focusIssueOnViewer] fitToView 오류:', e); }
        }, 300);
    };
    v.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, onLoaded);
}
```

이 고해상도 타이밍 제어 기법을 통해, 뷰어가 빈 화면인 초기 구동 시나리오에서도 배치 버튼 클릭 시 **탭 전환 ➔ 3D 뷰어 로딩바 노출 ➔ 모델 렌더링 완료 ➔ 즉시 해당 부재 줌인**까지 완벽하게 이어지는 부드러운 사용성을 확보하게 되었습니다.
배치 클릭 연동 상세 구조는 [[Standalone_Issue]]를 참고해 주십시오.
