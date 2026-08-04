---
title: Compare Issue & Multi-Version Synchronization
tags: [features, compare-issue, version-control, synchronization]
created: 2026-07-16
related: [State_Management, PDF_Export]
---

# 🔍 Compare Issue & Multi-Version Synchronization

도면 버전 A와 B의 시각적/기하학적 차이를 분석하고 검토하는 과정에서 발생하는 비교 전용 이슈 관리 기능에 대한 명세입니다.

---

## 1. 비교 이슈 데이터의 구조적 차이

단독 이슈와 달리, 비교 이슈는 두 버전의 형상 정보와 시점 정보를 동시에 대조 보존해야 하므로 다음과 같은 확장 속성을 보유합니다.

- **`imgBefore`**: 변경 전 버전(Version A) 도면의 3D 뷰 캡처 URL.
- **`imgAfter`**: 변경 후 버전(Version B) 도면의 3D 뷰 캡처 URL.
- **`img`**: 이슈 마크업이 병합된 최종 결과 이미지 URL.
- **`_type`**: `"compare"`로 지정되어 단독 테이블 리스트 상에서 별도 배지로 식별되게 분기 처리됩니다.

---

## 2. 양방향 동기화 및 강제 박제 프로세스

버전 비교 탭(`comparison.js`)에서 작성한 이슈는 단독 뷰어 탭(`main.js`)의 메인 리스트에도 실시간 반영되어야 합니다. 이를 해결하기 위해 저장 이벤트를 낚아채어 양방향 스토리지에 동시 박제하는 적재 메커니즘을 설계하였습니다.

### 1) 비교 이슈 저장 흐름

```javascript
// 3) 🚨 [양방향 스토리지 동시 강제 박제]
var storageKeys = ['my_saved_compare_issues', 'aps_project_issues'];
var saveSuccess = true;

for (var ki = 0; ki < storageKeys.length; ki++) {
    var key = storageKeys[ki];
    var currentList = [];
    try {
        currentList = JSON.parse(localStorage.getItem(key) || '[]');
    } catch(e) {
        currentList = [];
    }
    
    // 기존 동일 ID 필터링 후 신규 이슈 추가
    currentList = currentList.filter(function(x) { return x && String(x.id) !== String(generatedId); });
    currentList.push(permanentIssueObj);
    
    try {
        localStorage.setItem(key, JSON.stringify(currentList));
        
        // 메모리 인메모리 리스트도 실시간 갱신
        if (key === 'my_saved_compare_issues') {
            window.currentIssueList = currentList;
            if (typeof window.compareIssues !== 'undefined') window.compareIssues = currentList;
        }
    } catch(e) {
        // QuotaExceededError 등 예외 처리 (Storage Limit 가드 작동)
        ...
    }
}
```

### 2) 단독 이슈 복제 찌꺼기 원천 청소
버전 비교 창에서 저장한 비교 이슈가 메인 단독 이슈 창고인 `my_saved_issues`에 복제 오염되는 현상을 원천 방지하기 위해 저장 직후 50ms 지연을 두고 디톡스(Detox) 루틴을 수행합니다.

```javascript
setTimeout(function() {
    try {
        var rawMain = localStorage.getItem('my_saved_issues');
        if (rawMain) {
            var parsedMain = JSON.parse(rawMain);
            if (Array.isArray(parsedMain)) {
                // COMP- 접두사 또는 compare 타입을 가진 이슈들을 메인 단독 보관함에서 정화
                var cleanedMain = parsedMain.filter(function(item) {
                    return item && String(item.id).indexOf('COMP-') === -1 && String(item._type) !== 'compare';
                });
                localStorage.setItem('my_saved_issues', JSON.stringify(cleanedMain));
            }
        }
        
        // UI 테이블 재렌더링
        if (typeof window.renderIssueTable === 'function') window.renderIssueTable();
        if (typeof window.renderCompareIssueTable === 'function') window.renderCompareIssueTable();
    } catch(ex) {}
}, 50);
```

이와 같이 스토리지를 독립적으로 유지하면서도 뷰어 컴포넌트 간에는 실시간 상태가 통일되도록 유지합니다.
용량 초과 방어를 위해 도입된 canvas 압축 기법은 [[Storage_Quota_Exceeded]] 문서를 참조해 주십시오.
