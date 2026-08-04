---
title: PDF Report Export & Layout Integration
tags: [features, pdf-export, cloneNode, layout-clipping, template-render]
created: 2026-07-16
related: [Compare_Issue, Resolve_Workflow]
---

# 📄 PDF Report Export & Layout Integration

저장된 단독/비교 이슈 전체 리스트를 문서 규격에 맞는 고해상도 PDF 종합 보고서 형태로 출력하는 컴포넌트 설계 분석 및 과거 레이아웃 잘림/침범 버그의 척결 과정 요약입니다.

---

## 1. 이벤트 중복 방지 설계 (`initPdfExport`와 `cloneNode` 기법)

비교 모듈 로드 시, 기존 PDF 버튼 핸들러가 가비지 컬렉션(GC)되지 않고 중복 등록되어 알림창 오동작을 일으키는 버그가 존재하였습니다.
이를 해결하기 위해 **DOM 노드 복제 치트키**를 적용하였습니다.

```javascript
function initPdfExport() {
    var pdfBtn = document.getElementById('pdf-export-btn') || ...;
    if (!pdfBtn) return;
    
    // 무한 루프 복제 방지 잠금 키 체크
    if (pdfBtn.dataset.pdfCleaned) return;

    // 🚨 기존에 부착되어 있던 모든 불필요한 이벤트 리스너를 복제 교체로 완전 삭제
    var cleanPdfBtn = pdfBtn.cloneNode(true);
    cleanPdfBtn.dataset.pdfCleaned = "true";
    if (pdfBtn.parentNode) {
        pdfBtn.parentNode.replaceChild(cleanPdfBtn, pdfBtn);
    }

    // 깨끗해진 노드에 인쇄 이벤트 단독 점화
    cleanPdfBtn.onclick = function(e) {
        ...
        buildAndOpenBatchPdf(issueList, liveImgBefore, liveImgAfter);
    };
}
```

---

## 2. 종합 인쇄 보고서 빌드 및 인젝션 (`buildAndOpenBatchPdf`)

새 팝업창(`window.open`)을 생성한 뒤, 사전에 기획된 4:3 비율의 보고서 템플릿과 이슈 상세 데이터를 동적 문자열 조작으로 밀어 넣은 뒤 `print()`를 실행합니다.

- **포맷팅 템플릿 제어**:
  - 단독 이슈: 변경 전/후가 없는 경우 전체 폭의 1장 레이아웃(`isSingleImageLayout`).
  - 비교 이슈 / 완료된 단독 이슈: 좌우 50% 분할로 버전 A/B 및 조치 전/후 이미지를 나란히 배치.
  - **4:3 Aspect Ratio 확보**: `.image-container { aspect-ratio: 4 / 3; }` 및 `object-fit: contain` 속성을 활용해 원본 비율 왜곡을 방지합니다.

---

## 3. [해결 기록] 비교 이슈 캡처 중복 인쇄 및 페이지 침범 문제 해결

### 1) 버그 증상
버전 비교 탭에서 내보낸 PDF 보고서에서 동일한 캡처 이미지가 하단 첨부파일 영역에 2번씩 반복 렌더링되어 공간을 침범하고 다음 페이지를 강제로 채우는 인쇄 레이아웃 파괴 현상이 있었습니다.

### 2) 해결 방안 (중복 필터링 가드 적용)
이미 상단 메인 보고서 테이블 내에 표현된 이미지(`mainImage`, `afterImage`)는 첨부파일 목록에서 제외하도록 `filter` 처리하였습니다.

```javascript
// 🚨 comparison.js Line 3700 부근 개선
var attachedImages = collectPdfIssueImages(issue, mainImage, afterImage);
if (isCompareIssue) {
    // 🚨 비교 이슈의 경우, 이미 상단 테이블에 들어간 [변경 전], [변경 후] 이미지는 첨부파일 목록에서 제외하여 중복 출력 방지
    attachedImages = attachedImages.filter(function(img) {
        return img !== mainImage && img !== afterImage;
    });
} else {
    attachedImages = captureImages.length >= 2 ? captureImages.slice(2) : [];
}
```

또한, CSS 단에서 페이지 분할을 물리적으로 제어하여 경계선 걸침 현상을 차단했습니다.
```css
.pdf-report-block { 
    width: 100%; 
    position: relative; 
    page-break-after: always; /* 각 이슈 블록마다 명확히 페이지 넘김 */
    margin-bottom: 40px; 
}
.pdf-report-block:last-child { 
    page-break-after: avoid; 
}
```

이와 같은 교정 작업을 통해 어떤 조합으로 이슈를 내보내도 인쇄 잘림 현상 없이 깔끔한 고화질 문서를 확보하게 되었습니다.
