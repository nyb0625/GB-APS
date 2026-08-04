---
title: BIM Core Concepts & Level of Development (LOD)
tags: [conceptual, BIM, LOD, metadata, Revit, IFC]
created: 2026-07-16
related: [BIM_CDE_Overview, CDE_Workflow_ACC]
---

# 📐 BIM Core Concepts & Level of Development (LOD)

본 문서는 **BIM(Building Information Modeling)**의 정보 구성 3대 요소, **LOD(Level of Development, 모델 상세도)** 표준 규격, 그리고 정수장 플랜트 도면의 파일 포맷 연동 방식에 대해 상세히 정리합니다.

---

## 1. BIM 정보 구성의 3대 요소

BIM 데이터는 단순한 3D 그래픽 메쉬(Mesh)와 달리 다음 세 가지 차원의 결합으로 이루어져 정보적 가치를 가집니다.

1. **형상 정보 (Geometry/Spatial Data)**: 부재의 3D 크기, 좌표, 형상, 시각적 재질 등 외형적 요소.
2. **속성 정보 (Attribute/Property Metadata)**: 자재의 모델명, 규격, 공급사, 제작일, 안전 점검 주기 등 비기하학적 메타데이터.
3. **관계 정보 (Relationship Data)**: 배관과 밸브의 연결 구조, 구조 벽체와 기둥의 결합 형태, 공간과의 포함 관계 등 논리적 계통 정보.

---

## 2. LOD (Level of Development, 모델 상세도) 개념

LOD는 미국건축가협회(AIA) 및 BIMForum 등 국제 표준에 정의된 **모델의 완성도 및 신뢰성 지표**입니다. 모델이 생애주기의 어느 단계에 적합한 신뢰성을 가졌는지 평가합니다.

| LOD 단계 | 명칭 | 상세 수준 (Level of Detail) | 주 사용 단계 |
| :--- | :--- | :--- | :--- |
| **LOD 100** | 개념 설계 (Conceptual) | 개념적 매스 모델, 대략적인 크기 및 방위만 표시 | 기획 단계 |
| **LOD 200** | 기본 설계 (Schematic) | 일반적인 시스템 및 대략적인 형상, 수량 제공 | 기본설계 단계 |
| **LOD 300** | 실시 설계 (Detailed) | 정밀한 크기, 위치, 계통 연결 등을 실도면 규격으로 묘사 | 실시설계 / 시공 입찰 |
| **LOD 350** | 시공 조정 (Coordination) | 부재 간의 상세 연결부(접합부, 브래킷, 통로 등) 및 간섭 검토용 디테일 포함 | 시공 상세도(Shop Drawing) |
| **LOD 400** | 제작 및 조립 (Fabrication) | 공장 제작 및 현장 조립이 가능한 수준의 부품 디테일과 볼트 수량까지 묘사 | 제작 / 조립 단계 |
| **LOD 500** | 준공 및 유지관리 (As-Built) | 실제 현장 시공 현황과 100% 일치하도록 정합된 모델 (메타데이터 포함) | 유지관리 (FM / O&M) |

### 💧 정수장 플랜트 모델의 LOD 수준
본 정수장 APS 플랫폼에 로드되는 Revit 모델은 배관 간섭 분석 및 장비 유지관리에 활용되어야 하므로 **LOD 350 ~ 500** 수준의 준공 모델로 구성되어 있습니다. 특히 밸브나 펌프의 제작사 메타데이터가 포함되어 있어, 플랫폼 대시보드 및 이슈 등록 시 상세 속성을 직접 연계할 수 있는 기반이 됩니다.

---

## 3. 핵심 파일 포맷 및 상호운용성

BIM 모델을 서로 다른 뷰어나 해석 프로그램 간에 전송하기 위해 업계 표준 포맷이 널리 쓰입니다.

### 1) Autodesk Revit Format (.rvt)
- 오토데스크의 대표적인 BIM 저작 도구 포맷입니다.
- 정수장 플랜트 구조 및 기계 설비 배관 모델링에 가장 많이 사용됩니다.
- 본 플랫폼은 이 `.rvt` 파일을 업로드하면 APS Model Derivative API를 거쳐 WebGL 뷰어용 포맷(`.svf` / `.svf2`)으로 자동 경량화 변환을 수행합니다.

### 2) IFC (Industry Foundation Classes - .ifc)
- 빌딩스마트(buildingSMART) 협회에서 제정한 오픈 빔(Open BIM) 국제 표준 파일 포맷입니다.
- 특정 벤더에 종속되지 않고 도면 데이터를 중립적으로 교환하기 위해 활용됩니다.
- APS 뷰어 역시 `.ifc` 파일의 렌더링 및 속성 파싱을 완벽하게 호환 지원합니다.
