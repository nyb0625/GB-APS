---
title: Issue Resolve Workflow & Background Capture
tags: [features, resolve-workflow, screenshot, markup, state-machine]
created: 2026-07-16
related: [Standalone_Issue, State_Management]
---

# 🔧 Issue Resolve Workflow & Background Capture

이슈의 진행 상태가 '종료' 또는 '완료' 단계로 진입할 때, 현장 변경 전후 비교 검증을 위해 추가 조치 캡처 이미지를 수집하고 병합하는 비동기 업무 플로우 분석입니다.

---

## 1. 종료 상태 감지 및 UI 토글

이슈 상세 폼에서 상태 셀렉트 박스(`#dyn-issue-status`)의 값이 변경될 때 실시간으로 변경 후 정보를 기록할 수 있는 영역(`#issue-resolve-section`)을 노출합니다.

- **트리거 시점**: `statusSelect.onchange` 이벤트 핸들러 작동.
- **노출 조건**: `status === '종료' || status === '완료'` 일 때만 노출.
- **수집 항목**: 조치 완료 내용 설명 (`#issue-resolve-note`), 조치 후 이미지 (`#resolve-image-preview`).

---

## 2. 비동기 캡처 및 대기 프로세스 (Auto-Save & Floating Mode)

조치 이미지를 새로 캡처하기 위해 뷰어 화면으로 돌아갈 때, 사용자가 작성 중이던 폼 데이터를 잃지 않도록 자동으로 로컬에 백업하고 전용 플로팅 조작계를 띄웁니다.

```
[종료/완료 선택] ➔ [추가 캡처 버튼 클릭]
                        │
                        ▼
① 현재 작성 중인 텍스트 및 상태 값 자동 저장 (LocalStorage 임시 업데이트)
② 현재 이슈 ID를 `pending_resolve_issue_id` 키로 박제
③ 현재 이슈 상세 모달을 숨김 (`display: none`)
④ 뷰어 위에 플로팅 컨트롤러 (`#floating-resolve-capture`) 노출
```

```javascript
resolveCaptureBtn.onclick = function(e) {
    var currentIssueId = savedIssueRef ? (savedIssueRef.id || savedIssueRef.dbId) : document.getElementById('dyn-issue-dbid').value;
    localStorage.setItem('pending_resolve_issue_id', currentIssueId);
    
    // Auto-save 임시 백업
    var noteVal = resolveNoteText ? resolveNoteText.value.trim() : "";
    var currentStatus = statusSelect ? statusSelect.value : null;

    var list = JSON.parse(localStorage.getItem('my_saved_issues') || '[]');
    for (var idx = 0; idx < list.length; idx++) {
        if (String(list[idx].id) === String(currentIssueId) || String(list[idx].dbId) === String(currentIssueId)) {
            list[idx].resolveNote = noteVal;
            if (currentStatus) list[idx].status = currentStatus;
            break;
        }
    }
    localStorage.setItem('my_saved_issues', JSON.stringify(list));
    
    // 모달 숨기고 전용 플로팅 조작 바 띄우기
    fallbackModal.style.display = 'none';
    var floatingBtn = document.getElementById('floating-resolve-capture');
    if (floatingBtn) floatingBtn.style.display = 'flex';
};
```

---

## 3. 캡처 세션 수집 및 이미지 병합 적재

사용자가 뷰어를 회전하여 조치 완료된 형상 시점을 맞추고 플로팅 캡처 버튼을 클릭하면, 뷰어 스냅샷을 낚아채어 마크업 세션을 기동합니다.

```javascript
activeViewer.getScreenShot(w, h, function(screenshotDataUrl) {
    window.startMarkupSession(screenshotDataUrl, function(mergedB64) {
        var pendingId = localStorage.getItem('pending_resolve_issue_id');
        if (pendingId) {
            // 🚨 압축 수행 (localStorage 5MB 한계 대응)
            window.compressBase64Image(mergedB64, 800, 0.6, function(compressedB64) {
                var list = JSON.parse(localStorage.getItem('my_saved_issues') || '[]');
                for (var idx = 0; idx < list.length; idx++) {
                    if (String(list[idx].id) === String(pendingId) || String(list[idx].dbId) === String(pendingId)) {
                        // 조치 완료 이미지로 최종 저장
                        list[idx].resolveImage = compressedB64;
                        break;
                    }
                }
                localStorage.setItem('my_saved_issues', JSON.stringify(list));
                
                // 대기 모드 해제 및 기존 이슈 상세창 팝업 복귀
                localStorage.removeItem('pending_resolve_issue_id');
                window.openIssueModal(targetIssue.dbId, targetIssue, targetIssue.img);
            });
        }
    });
});
```

이와 같이 폼 백업 ➔ 모달 분리 ➔ 캡처 수집 ➔ 마크업 병합 ➔ 복귀로 이어지는 유기적인 프로세스가 구현되어 있습니다.
캡처 이미지 저장 시의 용량 관리 기법은 [[Storage_Quota_Exceeded]]에 정리되어 있습니다.
