---
title: APS AI Platform LLM Wiki Index
tags: [index, moc, developer-guide]
created: 2026-07-16
related: []
---

# 🗺️ APS AI Platform LLM Wiki MOC

APS(Autodesk Platform Services) 정수장 모니터링 시스템의 핵심 아키텍처, 주요 기능 명세, 그리고 최근 직면했던 핵심 이슈 및 해결 과정을 체계적으로 구조화한 개발 지식 저장소입니다. 본 위키는 옵시디언(Obsidian)의 양방향 링크 구조를 적용하여 설계되었습니다.

---

## 🏛️ 10. 시스템 아키텍처 (Architecture)

프로젝트의 전체적인 구동 원리와 데이터 스토리지 구성 방식입니다.

- [[System_Overview]]: 단일 페이지 애플리케이션(SPA)의 탭 관리 기법 및 뷰어 렌더링 최적화 꼼수 분석
- [[State_Management]]: LocalStorage 기반의 세 가지 핵심 데이터 구조 및 양방향 실시간 동기화 마스터 락

## 🚀 20. 주요 기능 명세 (Features)

시스템의 3대 핵심 모듈 및 데이터 연동 흐름입니다.

- [[Standalone_Issue]]: 단독 이슈 CRUD 라이프사이클 및 URN 자동 해상 로직
- [[Compare_Issue]]: 버전 비교 이슈 및 양방향 스토리지 동시 박제 흐름
- [[Resolve_Workflow]]: 이슈 '종료' 시점 조치 캡처 추가 발화 및 백그라운드 대기 워크플로우
- [[UI_Layout_Filters]]: 메인 테이블 헤더 순서 커스터마이징 및 다중 열 필터링 적용 원리
- [[PDF_Export]]: 인쇄 최적화 HTML 보고서 기반 PDF 변환 및 중복 캡처 페이지 침범 방지 기법

## 🛠️ 30. 트러블슈팅 및 극복 기록 (Troubleshooting)

브라우저의 하드웨어/메모리 한계를 극복하고 동기화 결함을 패치해 낸 핵심 해결 일지입니다.

- [[Storage_Quota_Exceeded]]: LocalStorage 5MB 용량 한계로 인한 QuotaExceededError와 Canvas 기반 극강 JPEG 이미지 압축 해결
- [[Viewer_Init_Deadlock]]: 프로젝트 탭 전환 직후 발생한 뷰어 초기화 닭-달걀 데드락과 뷰어 강제 기동(Smart Polling) 카메라 줌인 연동

## 🌐 40. BIM & CDE 개념 가이드 (BIM & CDE Concepts)

건설 클라우드 협업 환경 및 디지털 트윈의 핵심 도메인 개념 정리입니다.

- [[BIM_CDE_Overview]]: BIM과 CDE 지식 영역 MOC 가이드라인 대시보드
- [[BIM_Core_Concepts]]: BIM의 3대 핵심 정보 모델 구성 요소 및 LOD(상세도) 레벨 표준 분석
- [[CDE_Workflow_ACC]]: ISO 19650 기준 CDE 워크플로우 4단계 및 ACC 클라우드 API 연동 명세


