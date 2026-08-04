---
title: CDE Standard Workflow & Autodesk Construction Cloud (ACC)
tags: [conceptual, CDE, ISO-19650, ACC, workflow, developer-guide]
created: 2026-07-16
related: [BIM_CDE_Overview, BIM_Core_Concepts, State_Management]
---

# 🌐 CDE Standard Workflow & Autodesk Construction Cloud (ACC)

본 문서는 국제 표준 **ISO 19650** 기반의 CDE(Common Data Environment) 표준 정보 라이프사이클 워크플로우와, 본 정수장 APS 플랫폼이 연동하고 있는 **Autodesk Construction Cloud (ACC)** CDE의 API 연결 메커니즘을 상세히 명세합니다.

---

## 1. ISO 19650 CDE 정보 라이프사이클 워크플로우

국제 표준 ISO 19650은 프로젝트 정보의 무결성을 확보하기 위해 CDE 내의 문서 및 3D 모델을 다음 4가지 상태 영역으로 분리하여 관리할 것을 규정합니다.

```
 [ WIP (Work in Progress) ]   ➔ 내부 작성 중 (설계사 고유 영역)
             │
             ▼ (승인/공유 승인)
 [ SHARED (공유 상태) ]       ➔ 타 공종 협업 및 간섭 검토용 (조정/협업 영역)
             │
             ▼ (발주처 승인/인증)
 [ PUBLISHED (발행 상태) ]    ➔ 시공 및 인허가용 확정 도면 (시공 기준 문서)
             │
             ├── 준공 완료
             ▼
 [ ARCHIVED (보존 상태) ]     ➔ 이력 추적 및 FM(시설물 관리) 유지 보수 영역
```

1. **W WIP (Work in Progress - 작성 중)**: 각 설계 및 시공 주체 내부에서 설계 작업을 수행하는 비공개 영역.
2. **S SHARED (Shared - 공유)**: 설계 조정 및 타 분야(토목, 기계, 전기 등) 간의 간섭 검토를 위해 내부 검증 후 공식 승인하여 공유한 영역.
3. **P PUBLISHED (Published - 발행)**: 발주처 및 인허가 부서의 최종 서명을 거쳐 시공에 직접 투입할 수 있도록 인가된 완료 상태 정보.
4. **A ARCHIVED (Archived - 보존)**: 과거의 진행 상태 히스토리를 추적하기 위해 백업해 둔 아카이브 영역.

---

## 2. Autodesk Construction Cloud (ACC) CDE 아키텍처

본 정수장 모니터링 시스템은 이 CDE 표준 프로세스를 충족하기 위해 오토데스크의 **ACC(Autodesk Construction Cloud)** 클라우드를 백엔드 데이터 허브로 연동합니다.

### 플랫폼 ACC 연동 아키텍처

```
[정수장 APS 플랫폼]  <=== 3-Legged OAuth ===>  [Autodesk Forge/APS Auth]
        │
        ├── 1) Hubs/Projects API 조회 ➔ 활성 프로젝트 추출
        ├── 2) Folder/Item API 조회 ➔ BIM 트리 구조 매핑 (Workspaces)
        └── 3) Model Derivative API ➔ RVT/IFC를 SVF2 3D 뷰어로 스트리밍
```

### 주요 연동 모듈 명세

#### 1) 3-Legged OAuth 인증 처리 (`api/auth/token`)
사용자가 본 시스템에 로그인하면, Autodesk 계정 연동을 통해 토큰(AccessToken/RefreshToken)을 안전하게 획득하고, Refresh Token 만료 시 백엔드 단에서 자동으로 갱신(Refresh)하여 통신을 유지합니다.

#### 2) 폴더 구조 재귀적 스캔 (`explorer.js`)
ACC CDE 클라우드 상에 보관된 도면 문서 폴더 구조를 실시간 탐색합니다.
- **API EndPoint**: `/api/hubs/{hubId}/projects/{projectId}/contents`
- **로직 흐름**: 프로젝트 루트에서 시작하여 하위 폴더들을 재귀적으로 순회(`fetchFolderContents`)하여 `.rvt`, `.ifc` 등 3D BIM 도면을 자동으로 필터링 및 적재합니다.

#### 3) 이슈 추적 관리 (Issues API)
- 플랫폼 내에서 생성된 [[Standalone_Issue]]와 [[Compare_Issue]]는 로컬에 기록되는 동시에 ACC CDE의 중앙 이슈 데이터베이스에도 전송되어, ACC 모바일 앱 또는 현장 태블릿을 쓰는 작업자와 실시간 양방향 협업 대장을 동기화합니다.
- 이를 통해 '현장 발견 결함'이 'CDE 디지털 트윈 모델'에 다이렉트로 반영되는 순환 고리를 형성합니다.
