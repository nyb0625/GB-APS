---
title: BIM & CDE Conceptual Map of Contents (MOC)
tags: [conceptual, BIM, CDE, MOC, developer-guide]
created: 2026-07-16
related: [BIM_Core_Concepts, CDE_Workflow_ACC]
---

# 🌐 BIM & CDE Conceptual Map of Contents (MOC)

본 문서는 **BIM(Building Information Modeling)** 및 **CDE(Common Data Environment, 공통 데이터 환경)**와 관련된 플랫폼 핵심 도메인 개념들의 안내 지도(MOC)입니다. 각 세부 사항은 양방향 연결을 통해 자세히 정의되어 있습니다.

---

## 🏛️ 세부 지식 토픽

### 1) [[BIM_Core_Concepts]]
BIM 정보 모델을 구성하는 3대 요소(형상, 속성, 관계) 및 국제 표준 모델 상세도인 **LOD(Level of Development)** 100 ~ 500 규격을 분석합니다. 정수장 플랜트 모델이 갖춰야 하는 데이터 규격과 파일 호환 포맷(Revit, IFC)을 수록하고 있습니다.

### 2) [[CDE_Workflow_ACC]]
국제 표준 **ISO 19650** 기반의 CDE 정보 라이프사이클 4단계(WIP ➔ Shared ➔ Published ➔ Archived)의 표준 흐름을 명세합니다. 또한, 본 플랫폼이 백엔드 단에서 Autodesk Construction Cloud(ACC)의 OAuth 인증 및 Contents API를 연동하여 클라우드 도면 폴더 재귀 스캔 및 중앙 이슈 데이터를 동기화하는 엔지니어링 메커니즘을 상세히 다룹니다.

---

## 🏗️ 플랫폼에서의 3차원 디지털 트윈 연동 구조

BIM과 CDE 도메인 지식은 플랫폼 내에서 동떨어진 이론이 아닌, 실제 기능 코드와 유기적으로 연결되어 상태를 동기화하고 있습니다.

- **속성 정보와 핀 맵핑**: BIM 속성 데이터를 뷰어 이벤트(`SELECTION_CHANGED_EVENT`) 상에서 실시간 연동해 내는 구조는 [[Standalone_Issue]]에 정의되어 있습니다.
- **다중 도면 비교 분석**: CDE 내 버전별 도면 대조 및 양방향 스토리지 박제 기법은 [[Compare_Issue]] 및 [[PDF_Export]]를 통해 상세 흐름을 이해할 수 있습니다.
