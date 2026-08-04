---
title: Standalone Issue LifeCycle & URN Resolution
tags: [features, standalone-issue, resolver, URN]
created: 2026-07-16
related: [State_Management, Viewer_Init_Deadlock]
---

# 🚀 Standalone Issue LifeCycle & URN Resolution

정수장 3D 도면 뷰어 내에서 단독 컴포넌트(부재)를 클릭하여 직관적으로 이슈를 등록하고, 이를 뷰어로 역추적하여 줌인하는 핵심 연동 프로세스입니다.

---

## 1. 이슈 상세 모달의 양방향 분기

이슈 관리 모달(`window.openIssueModal`)은 하나의 모달 템플릿으로 신규 생성 모드와 기존 데이터 조회 모드를 스마트하게 전환합니다.

- **분기점 기준**: `objectName` 파라미터가 객체 타입인지 검사합니다.
  ```javascript
  var isViewMode = false;
  var savedIssueRef = null;
  if (objectName && typeof objectName === 'object' && !Array.isArray(objectName)) {
      isViewMode = true;
      savedIssueRef = objectName;
  }
  ```
- **상세 조회 모드**: 폼 입력 필드를 `readonly` 처리하며, 기존 이슈에 박제되어 있던 속성 데이터(`title`, `description`, `structure`, `trade`, `startDate`, `dueDate`)를 화면에 매핑해 줍니다.

---

## 2. 배치(Placement) 클릭 연동 뷰어 역이동

이슈 상세 조회 시, 배치 정보가 기록된 영역(`#dyn-issue-placement`)을 누르면 즉시 해당 이슈가 발생했던 3D 도면 모델로 자동으로 이동하고 카메라 시점이 대상 컴포넌트를 줌인하도록 연동하였습니다.

### 1) URN 지능형 해석 엔진 (`window.resolveModelUrn`)
이슈 데이터에 모델 URN 정보가 유실되어 존재하지 않는 경우를 대비해, 파일명(`placement` 또는 `file`)을 기반으로 URN을 역추적해 내는 엔진을 구현했습니다.

```javascript
window.resolveModelUrn = async function(fileName) {
    if (!fileName) return "";
    var cleanName = fileName.replace(/\.[^/.]+$/, "").trim(); // 확장자 제거
    
    // 1단계: 로컬 캐시 메모리 검색
    var cache = JSON.parse(localStorage.getItem('aps_model_urn_cache') || '{}');
    if (cache[cleanName]) return cache[cleanName];

    // 2단계: 로컬 모델 셀렉트 드롭다운 옵션 검색
    var modelDropdown = document.getElementById('models');
    if (modelDropdown) {
        ...
    }

    // 3단계: Autodesk Construction Cloud (ACC) 폴더 구조 재귀적 탐색 및 파일 매핑
    try {
        var contents = await fetchACCProjectContents(); 
        ...
    } catch(e) { ... }
    
    return "";
};
```

### 2) 뷰어 이동 흐름
배치 칸을 클릭하면, URN 해석 결과를 가지고 뷰어를 이동시키는 `focusIssueOnViewer(dbId, targetUrn)`를 호출합니다.

```javascript
placementInput.onclick = async function() {
    var targetUrn = savedIssueRef.urn || "";
    var targetDbId = savedIssueRef.dbId || "";
    var placementFile = savedIssueRef.placement || "";
    
    if (!targetUrn) {
        targetUrn = await window.resolveModelUrn(placementFile);
    }
    
    if (targetUrn) {
        fallbackModal.style.display = 'none';
        window.focusIssueOnViewer(targetDbId, targetUrn);
    }
};
```
자세한 뷰어 기동 및 줌인 동기화 원리는 [[Viewer_Init_Deadlock]] 트러블슈팅 문서를 확인하십시오.
