# 강북정수장 APS AI 플랫폼 구축 - Antigravity 초기 설정 프롬프트

아래 프롬프트를 Antigravity에 입력하면 APS(Autodesk Platform Services) 기반의 AI 플랫폼 프로젝트를 체계적으로 구성할 수 있습니다.

---

## ✅ 환경 요구사항 (설치 완료)

| 도구 | 버전 | 설치 상태 |
|------|------|----------|
| Git | 2.53.0 | 설치 완료 |
| Node.js (LTS) | 24.14.0 | 설치 완료 |
| npm | 11.9.0 | 설치 완료 |

---

## 🚀 Antigravity 초기 설정 프롬프트

> **아래 프롬프트를 복사하여 Antigravity 채팅창에 그대로 입력하세요.**

```text
I want to build an AI platform based on Autodesk Platform Services (APS) for Gangbuk Water Purification Plant (강북정수장 APS).
Please set up a full-stack Node.js project in the current workspace (c:\antigravity\강북정수장 APS) with the following structure and features:

## Project Overview
- Platform: Autodesk Platform Services (APS)
- Tech stack: Node.js (Express) backend + Vanilla HTML/CSS/JS frontend
- AI integration: Support for connecting AI models (LLM API like Google Gemini / OpenAI) to analyze APS viewer data (assets, properties, maintenance records).

## Project Structure to Create / Refine
c:\antigravity\강북정수장 APS\
├── server.js                  # Express Server Entry Point (already created)
├── config.js                  # Configuration Loader (already created)
├── package.json               # Dependencies and scripts (already created)
├── .env                       # Environment variables (already created)
├── .gitignore                 # Git ignore patterns (already created)
├── routes/
│   ├── auth.js                # APS OAuth2 Authentication Routes
│   ├── models.js              # APS Data Management & Model Derivative API Routes
│   └── ai.js                  # AI Analysis API Routes
├── services/
│   ├── aps.js                 # APS SDK Wrapper service (Token, Bucket, Translate)
│   └── ai.js                  # AI API Integration service (Gemini/OpenAI)
└── public/
    ├── index.html             # Main Dashboard & View Area (already created)
    ├── css/
    │   └── style.css          # Premium Stylesheet
    └── js/
        ├── viewer.js          # Autodesk Forge Viewer v7 Initialization & Loader
        └── ai-panel.js        # AI Chat & Analysis Panel UI

## Key Features to Implement
1. **APS Authentication**: OAuth 2.0 2-legged token management for viewing models and 3-legged token for Hubs integration.
2. **APS Viewer**: Autodesk Forge Viewer v7 integration inside `public/index.html` to show 3D/2D CAD models.
3. **Data Management & Translation**: List buckets, upload files, check translation status, and load model URNs.
4. **AI Analysis Panel**: A sidebar panel in the frontend that sends selected model metadata or user questions to the AI (Google Gemini or OpenAI) for analysis.
5. **REST API**: Structured API endpoints `/api/auth/token`, `/api/models/list`, `/api/ai/analyze` for frontend-backend communication.

Please review the existing files and create the missing files under routes/, services/, public/css/, and public/js/ with proper implementations. The UI should look modern and premium.
```

---

## 📋 APS 앱 등록 방법 (Autodesk Developer Portal)

1. [Autodesk Developer Portal](https://aps.autodesk.com/myapps/)에 접속 및 로그인
2. **Create App** 클릭
3. 앱 이름 입력 및 API 선택:
   - ✅ **Data Management API**
   - ✅ **Model Derivative API**
   - ✅ **Viewer** (기본 포함)
4. Callback URL에 `http://localhost:8080/api/auth/callback` 입력
5. 생성된 **Client ID**와 **Client Secret**을 `.env` 파일에 복사하여 붙여넣기

---

## 🔗 참고 링크

- [APS 공식 튜토리얼](https://get-started.aps.autodesk.com/)
- [APS Viewer 레퍼런스](https://aps.autodesk.com/en/docs/viewer/v7/developers_guide/overview/)
- [APS Node.js SDK](https://github.com/autodesk-platform-services/aps-sdk-node)
