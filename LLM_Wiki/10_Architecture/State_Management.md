---
title: LocalStorage State Management & Sync Guard
tags: [architecture, state-management, localStorage, sync-guard]
created: 2026-07-16
related: [System_Overview, Standalone_Issue, Compare_Issue]
---

# 💾 LocalStorage State Management & Sync Guard

본 시스템은 정수장 관리자가 로컬 오프라인 환경에서도 안전하게 이슈를 영속화하고 추적할 수 있도록 **브라우저 로컬 스토리지(LocalStorage)**를 분산 설계하여 상태 관리를 제어하고 있습니다.

---

## 1. 3대 핵심 스토리지 스키마

이슈의 유형과 동기화 역할에 따라 3가지 키로 상태가 나누어져 관리됩니다.

### 1) 단독 이슈 창고 (`my_saved_issues`)
- **목적**: 3D 모델 뷰어 상에서 정수장 구조물을 단독 선택하여 작성한 모든 단독 이슈의 SSOT(Single Source of Truth) 저장소입니다.
- **포맷 규격**:
  ```json
  {
    "id": "ISSUE-17211111111",
    "dbId": 13181,
    "title": "벽체 균열 발생",
    "desc": "급속여과지 벽체 크랙 3mm 발견...",
    "structure": "급속여과지 구조물",
    "trade": "토목",
    "status": "Open",
    "images": ["data:image/jpeg;base64,..."],
    "urn": "dXJuOmFkc2sub2JqZWN0czpvcy5vYmplY3Q6...",
    "resolveNote": "보수재 충진 완료"
  }
  ```

### 2) 비교 이슈 창고 (`my_saved_compare_issues`)
- **목적**: 버전 비교 탭에서 도면 버전 A와 B를 대조하며 생성된 이슈만을 기록하는 독립 저장소입니다.
- **포맷 규격**:
  ```json
  {
    "id": "COMP-17211111111",
    "dbId": "13181",
    "title": "배관 간섭 이슈",
    "reviewContent": "v2 대비 배관 위치 이동 필요",
    "changeContent": "v3에서 우회 배관 수정 완료",
    "imgBefore": "data:image/jpeg;base64,...",
    "imgAfter": "data:image/jpeg;base64,...",
    "img": "data:image/jpeg;base64,..."
  }
  ```

### 3) 플랫폼 통합 창고 (`aps_project_issues`)
- **목적**: 플랫폼 내의 모델 탐색기 및 메인 대시보드 리포팅을 위한 단독+비교 전체 병합 저장소입니다. 로컬 업로드 이슈 외에 서버나 ACC 연동 데이터를 가상 통합하는 완충 지대 역할을 수행합니다.

---

## 2. 양방향 동기화 마스터 락 (Delete Sync Master Lock)

데이터가 3대 스토리지로 나뉘어 저장되다 보니, **단독 이슈를 삭제하거나 수정할 때 다른 저장소에 그 흔적이 찌꺼기(유령 데이터)로 남는 불일치 현상**이 초기에 보고되었습니다.
이를 원천 봉쇄하기 위해 삭제 발생 시 모든 창고를 동시 추적하여 폭사시키는 **마스터 락(Master Lock) 가드**가 수립되었습니다.

```javascript
window.deleteIssue = function(event, type, title, dateStr) {
    ...
    // 3대 핵심 저장소 키 동시 대청소 바인딩
    var storageKeys = ['my_saved_issues', 'aps_project_issues', 'my_saved_compare_issues'];

    storageKeys.forEach(function(key) {
        var raw = localStorage.getItem(key);
        if (!raw) return;
        var list = JSON.parse(raw);
        
        // 고유 ID(targetId) 또는 제목/날짜 교차 검증을 통해 완벽한 정화 수행
        var filteredList = list.filter(function(item) {
            if (!item) return false;
            // ID 비교
            if (targetId && (String(item.id) === String(targetId) || String(item.dbId) === String(targetId))) {
                return false; 
            }
            // 폴백: 제목 및 날짜 문자열 정합 대조
            ...
            return true;
        });
        
        localStorage.setItem(key, JSON.stringify(filteredList));
    });
};
```

---

## 3. 동적 데이터 병합 및 중복성 필터

이슈 테이블(`renderIssueTable`)이나 마커를 그릴 때 브라우저 메모리에 로드된 각기 다른 소스 데이터를 정합하고 출력합니다. 이때 중복 출현을 차단하기 위해 **고유 ID 맵핑 가드**를 적용합니다.

```javascript
var list1 = JSON.parse(localStorage.getItem('aps_project_issues') || '[]');
var list2 = JSON.parse(localStorage.getItem('my_saved_issues') || '[]');
var list3 = JSON.parse(localStorage.getItem('my_saved_compare_issues') || '[]');

// 병합 및 유니크 ID 필터링
var totalIssues = list1.concat(list2).concat(list3);
var uniqueMap = {};
var finalMergedList = [];
for (var u = 0; u < totalIssues.length; u++) {
    var item = totalIssues[u];
    if (item && item.id && !uniqueMap[item.id]) {
        uniqueMap[item.id] = true;
        finalMergedList.push(item);
    }
}
window.currentIssueList = finalMergedList;
```
양방향 링크를 통해 [[Storage_Quota_Exceeded]]에 상세히 설명되어 있는 데이터 초과 에러 방어 기법을 함께 참고하십시오.
