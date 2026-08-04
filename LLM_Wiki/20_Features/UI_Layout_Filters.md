---
title: Dynamic Table Filters & Layout Customization
tags: [features, table-layout, column-customization, dynamic-filter]
created: 2026-07-16
related: [State_Management]
---

# 📊 Dynamic Table Filters & Layout Customization

이슈 리스트 테이블의 가독성을 극대화하기 위해 제공하는 컬럼 표시 설정(순서/활성) 영속화 및 각 열 단위 다중 필터링 적용에 대한 핵심 설계 방식입니다.

---

## 1. 컬럼 사용자 지정 및 순서 변경 (`toggleColumn`)

관리자는 테이블에 표시할 속성 컬럼과 이들의 표시 순서를 UI의 체크박스를 통해 제어할 수 있으며, 이 순서는 LocalStorage에 영속화되어 재로그인 시에도 유지됩니다.

- **핵심 변수**:
  - `window.allIssueColumns`: 전체 지원하는 컬럼 정의 데이터 (`key`, `label`).
  - `window.activeIssueColumns`: 현재 활성화된 컬럼 키들의 배열 리스트.
- **상태 영속화**:
  - `my_all_columns_order`: 전체 컬럼의 노출 순서 배열 저장.
  - `my_active_columns`: 현재 노출 체크된 활성 컬럼 목록 저장.

```javascript
window.toggleColumn = function(columnKey) {
    var idx = window.activeIssueColumns.indexOf(columnKey);
    if (idx > -1) {
        // 비활성화
        window.activeIssueColumns.splice(idx, 1);
    } else {
        // 활성화
        window.activeIssueColumns.push(columnKey);
    }
    
    // 로컬 스토리지 박제
    localStorage.setItem('my_active_columns', JSON.stringify(window.activeIssueColumns));
    
    // 테이블 다시 그리기
    window.renderIssueTable();
};
```

---

## 2. 동적 드롭다운 옵션 바인딩 및 다중 열 필터링

열 단위 필터링(`#initializeTableFilters`)은 테이블 행이 그려진 직후 호출되어 검색 환경을 구성합니다.

### 1) 드롭다운 필터 고유 값 자동 추출
하드코딩된 옵션 대신, 현재 테이블에 렌더링된 열의 텍스트 데이터를 동적으로 수집하여 드롭다운 리스트 옵션으로 만듭니다.

```javascript
filters.forEach(function(filter) {
    var colIdx = parseInt(filter.getAttribute('data-col'));
    if (filter.tagName === 'SELECT') {
        var uniqueValues = new Set();
        
        rows.forEach(function(row) {
            var cell = row.querySelector('td:nth-child(' + (colIdx + 1) + ')');
            if (cell) {
                var text = (cell.textContent || cell.innerText).trim();
                if (text) uniqueValues.add(text);
            }
        });

        filter.innerHTML = '<option value="">전체</option>';
        uniqueValues.forEach(function(val) {
            var opt = document.createElement('option');
            opt.value = val;
            opt.text = val;
            filter.appendChild(opt);
        });
    }
});
```

### 2) 다중 조건 실시간 필터 (`applyFilters`)
사용자가 필터를 조작하면, 모든 조건이 AND 형식으로 누적 평가됩니다.

```javascript
function applyFilters() {
    // 1단계: 현재 필터 값 캐싱
    filters.forEach(function(filter) {
        var colIdx = parseInt(filter.getAttribute('data-col'));
        window.currentTableFilterValues[colIdx] = filter.value;
    });

    // 2단계: 각 행 순회 검증
    rows.forEach(function(row) {
        var isMatch = true;
        
        filters.forEach(function(filter) {
            var filterVal = filter.value.toLowerCase().trim();
            if (!filterVal) return; // 필터 값 없으면 통과
            
            var colIdx = parseInt(filter.getAttribute('data-col'));
            var cell = row.querySelector('td:nth-child(' + (colIdx + 1) + ')');
            
            if (cell) {
                var cellText = (cell.textContent || cell.innerText).toLowerCase().trim();
                
                if (filter.tagName === 'SELECT') {
                    // 드롭다운: 완전 일치 매칭
                    if (cellText !== filterVal) isMatch = false;
                } else if (filter.tagName === 'INPUT') {
                    // 텍스트 인풋: 부분 일치(contains)
                    if (cellText.indexOf(filterVal) === -1) isMatch = false;
                }
            }
        });
        
        // 최종 필터 결과에 따른 노출 여부 지정
        row.style.display = isMatch ? '' : 'none';
    });
}
```

이와 같은 원리를 통해 수십~수백 건의 이슈 행 속에서도 필요한 데이터(예: 특정 구조물명, 특정 공종, 특정 작성자 등)만을 실시간 다중 조건 조합으로 정밀 필터링해 낼 수 있습니다.
반영된 상태 관리 연동은 [[State_Management]] 문서를 함께 대조해 보십시오.
