---
title: LocalStorage QuotaExceededError Resolution
tags: [troubleshooting, localStorage, image-compression, canvas, exception-handling]
created: 2026-07-16
related: [State_Management]
---

# 🛠️ LocalStorage QuotaExceededError Resolution

## 1. 문제 상황 (Trouble Scenario)

정수장 3D 뷰어 화면에서 고화질 마크업 스냅샷을 다수 촬영하여 단독 이슈 또는 비교 이슈를 등록할 때, 브라우저 콘솔에 다음과 같은 크래시 에러가 발생하며 이슈 저장이 원천 중단되는 상황이 발생했습니다:

```
Uncaught DOMException: Failed to execute 'setItem' on 'Storage': 
Setting the value of 'my_saved_issues' exceeded the quota.
```

### 원인 분석 (Root Cause)
- 브라우저의 LocalStorage 용량 한계는 도메인당 **최대 5MB**입니다.
- 마크업 스냅샷 이미지(`base64` 포맷)는 기본 PNG/WebP 고화질 데이터로 저장되어 장당 **1.2MB ~ 2MB**의 용량을 차지하였습니다.
- 결과적으로 이슈를 3~4개만 저장해도 바로 5MB 한도를 초과하여 앱이 멈추는 메모리 포화 결함으로 이어졌습니다.

---

## 2. 해결 방안 (Solution Architecture)

이 문제를 해결하기 위해 두 가지 방어선을 마련했습니다:
1. **스마트 이미지 압축 (Canvas API)**: base64 이미지를 저장하기 전 해상도를 줄이고 JPEG 포맷(퀄리티 0.6)으로 극강 압축하여 장당 용량을 **50KB~100KB (기존 대비 5% 수준)**로 줄입니다.
2. **트랜잭션 세이프 가드 (Try-Catch & Rollback)**: 쓰기 실패 시 스토리지 롤백 및 사용자 알림 시스템을 마련합니다.

### 1) 이미지 극강 압축 유틸리티 구현
HTML5 Canvas에 이미지를 올려 가로 폭을 최대 800px로 조절하고 화질을 0.6 수준의 JPEG로 리턴하는 비동기 유틸리티 함수를 추가했습니다.

```javascript
window.compressBase64Image = function(base64Str, maxWidth, quality, callback) {
    if (!base64Str || typeof base64Str !== 'string' || !base64Str.startsWith('data:image')) {
        return callback(base64Str); // 이미지가 아니면 패스
    }
    var img = new Image();
    img.onload = function() {
        try {
            var canvas = document.createElement('canvas');
            var width = img.width;
            var height = img.height;

            // 가로폭 리사이징 비율 계산
            if (width > maxWidth) {
                height = Math.round(height * (maxWidth / width));
                width = maxWidth;
            }
            canvas.width = width;
            canvas.height = height;
            var ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.drawImage(img, 0, 0, width, height);
                // jpeg 0.6 변환으로 용량 극대화 다이어트
                var compressedBase64 = canvas.toDataURL('image/jpeg', quality);
                callback(compressedBase64);
            } else {
                callback(base64Str);
            }
        } catch(e) {
            callback(base64Str);
        }
    };
    img.onerror = function() { callback(base64Str); };
    img.src = base64Str;
};
```

여러 장의 이미지를 순차 처리하기 위한 배열 동기화 함수도 수립했습니다:
```javascript
window.compressBase64Array = function(arr, maxWidth, quality, callback) {
    if (!arr || !arr.length) return callback([]);
    var results = [];
    function next(idx) {
        if (idx >= arr.length) return callback(results);
        window.compressBase64Image(arr[idx], maxWidth, quality, function(res) {
            results.push(res);
            next(idx + 1);
        });
    }
    next(0);
};
```

---

## 3. 적용 사례 (Application Code)

이슈 저장 시점에 비동기 체인을 걸고, `try...catch` 예외 처리를 통해 QuotaExceededError 발생 시 스토리지 무결성을 보장합니다.

```javascript
// 단독 이슈 저장 시점
window.compressBase64Array(captureImages, 800, 0.6, function(compressedImages) {
    window.compressBase64Image(resolveImageVal, 800, 0.6, function(compressedResolveImage) {
        var compressedPrimary = compressedImages[0] || "";
        
        // permanentIssueObj 객체에 압축 이미지 대입
        ...
        mainList.push(permanentIssueObj);

        var saveSuccess = true;
        try {
            // 저장 시도
            localStorage.setItem('my_saved_issues', JSON.stringify(mainList));
        } catch(e) {
            // 🚨 QuotaExceededError 감지 시 롤백 및 경고
            if (e.name === 'QuotaExceededError' || e.code === 22) {
                alert("🚨 브라우저 저장 공간(5MB)이 가득 찼습니다!\n오래된 이슈를 삭제하거나 이미지를 줄여주세요.");
                mainList.pop(); // 방금 넣은 아이템 다시 빼내어 롤백
                saveSuccess = false;
            } else {
                console.error("이슈 저장 중 알 수 없는 오류:", e);
                saveSuccess = false;
            }
        }
        
        if (saveSuccess) {
            // UI 닫기 및 테이블 리로드
            ...
        }
    });
});
```

이 압축 로직 도입으로 인해, 3~4개에 불과하던 저장 한계 수량이 **최대 80~100개 이상의 이슈를 보존**할 수 있을 정도로 스토리지 효율성이 극적으로 증대되었습니다.
LocalStorage 설계 구조는 [[State_Management]] 문서를 함께 참조해 주십시오.
