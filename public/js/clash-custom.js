/**
 * clash-custom.js
 * Model Coordination Clash Detection — API-based instance loader & viewer integration.
 * Replaces the former client-side AABB bounding-box computation engine.
 */

import { initViewer, loadModel } from './viewer.js';

// ─── Module State ────────────────────────────────────────────────────────────
let clashViewer = null;           // Autodesk viewer instance for this tab
let allInstances   = [];          // Full list received from /api/clash/instances
let filteredInstances = [];       // After client-side search filter
let loadedModelCache = {};        // { [urn]: Autodesk.Viewing.Model }

// Discipline badge colours
const DISC_COLORS = {
    C:  { bg: 'rgba(30,90,200,0.18)', border: '#3b82f6', text: '#60a5fa' },
    A:  { bg: 'rgba(34,197,94,0.15)', border: '#22c55e', text: '#4ade80' },
    M:  { bg: 'rgba(239,68,68,0.15)', border: '#ef4444', text: '#f87171' },
    E:  { bg: 'rgba(245,158,11,0.18)', border: '#f59e0b', text: '#fbbf24' },
    AM: { bg: 'rgba(168,85,247,0.18)', border: '#a855f7', text: '#c084fc' },
};
function discStyle(disc) {
    const c = DISC_COLORS[disc] || { bg: 'rgba(100,116,139,0.18)', border: '#475569', text: '#94a3b8' };
    return `background:${c.bg}; border:1px solid ${c.border}; color:${c.text}; padding:1px 6px; border-radius:4px; font-size:0.7rem; font-weight:700;`;
}

// ─── 1. Entry Point ──────────────────────────────────────────────────────────
export async function initCustomClashTab() {
    setupEventListeners();
    await ensureClashViewerInitialized();
    checkAndShowAuthStatus(); // 로그인 상태 비동기 표시
}
window.initCustomClashTab = initCustomClashTab;

// ─── 1.5 Auth Status Check ───────────────────────────────────────────────────
async function checkAndShowAuthStatus() {
    const statusEl = document.getElementById('custom-clash-status');
    try {
        const resp = await fetch('/api/auth/profile');
        if (resp.ok) {
            const profile = await resp.json();
            if (profile && profile.name) {
                // ✅ 로그인 상태 — 상태 배지에 사용자명 표시
                if (statusEl) {
                    statusEl.textContent = `🔑 ${profile.name} 로그인됨 — 간섭 목록 불러오기를 클릭하세요`;
                    statusEl.style.borderColor = '#22c55e';
                    statusEl.style.color = '#4ade80';
                }
                return true;
            }
        }
    } catch (_) {}
    // 비로그인 상태 안내
    if (statusEl && statusEl.textContent.includes('대기')) {
        statusEl.textContent = '⚠️ 비로그인 — BIM Metadata 기반으로 표시됩니다';
        statusEl.style.borderColor = '#f59e0b';
        statusEl.style.color = '#fbbf24';
    }
    return false;
}

// ─── 2. Event Listeners ──────────────────────────────────────────────────────
function setupEventListeners() {
    const btn = document.getElementById('btn-run-custom-clash');
    if (btn) btn.onclick = () => loadClashInstances();

    const searchInput = document.getElementById('clash-list-search');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            const q = searchInput.value.trim().toLowerCase();
            filteredInstances = q
                ? allInstances.filter(i =>
                    (i.leftElementName  || '').toLowerCase().includes(q) ||
                    (i.rightElementName || '').toLowerCase().includes(q) ||
                    (i.leftDocumentName || '').toLowerCase().includes(q) ||
                    (i.rightDocumentName|| '').toLowerCase().includes(q) ||
                    (i.id || '').toLowerCase().includes(q))
                : [...allInstances];
            renderClashList(filteredInstances);
        });
    }
}


// ─── 3. Viewer Init ──────────────────────────────────────────────────────────
async function ensureClashViewerInitialized() {
    const container = document.getElementById('customClashViewer');
    if (!container) return null;
    if (clashViewer && clashViewer.impl) {
        try { clashViewer.resize(); } catch(_) {}
        return clashViewer;
    }
    try {
        const viewer = await initViewer(container, true);
        if (viewer) {
            clashViewer = viewer;
            window.customClashViewer = viewer;
            setTimeout(() => { try { viewer.resize(); } catch(_) {} }, 150);
        }
        return viewer;
    } catch (err) {
        console.error('[Clash Viewer Init]', err);
        return null;
    }
}

// ─── Safe Base64 URN Generator (Prevents atob InvalidCharacterError) ─────────
export function getSafeBase64Urn(urn) {
    if (!urn) return null;
    const str = String(urn).trim();
    if (str.startsWith('urn:dXJu') || (str.startsWith('urn:') && str.length > 50 && !str.includes('adsk.'))) {
        return str;
    }
    const rawUrn = str.startsWith('urn:') ? str : `urn:${str}`;
    const b64 = (typeof Buffer !== 'undefined') 
        ? Buffer.from(rawUrn).toString('base64') 
        : btoa(rawUrn);
    return 'urn:' + b64.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
window.getSafeBase64Urn = getSafeBase64Urn;


// ─── 4. Fetch Clash Instances from Backend ───────────────────────────────────
async function loadClashInstances() {
    const statusEl   = document.getElementById('custom-clash-status');
    const countEl    = document.getElementById('custom-clash-count');
    const resultsEl  = document.getElementById('custom-clash-results');
    const btn        = document.getElementById('btn-run-custom-clash');

    // Discipline 코드 정규화 (UUID 값이 primaryId/comparedId에 오염되어 주입되는 현상 원천 차단)
    const sanitizeDiscipline = (val) => {
        if (!val) return 'ALL';
        const clean = String(val).trim().toUpperCase();
        return ['C', 'A', 'M', 'E', 'AM', 'ALL'].includes(clean) ? clean : 'ALL';
    };

    const structure  = document.getElementById('clash-filter-structure')?.value || 'ALL';
    const primaryId  = sanitizeDiscipline(document.getElementById('clash-filter-discipline')?.value || document.getElementById('discipline-filter')?.value);
    const comparedId = sanitizeDiscipline(document.getElementById('clash-filter-compared-discipline')?.value || document.getElementById('compared-discipline-filter')?.value);
    const status     = document.getElementById('clash-filter-status')?.value || 'ALL';

    if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }
    if (statusEl) statusEl.textContent = '⏳ 간섭 데이터 불러오는 중...';
    if (resultsEl) resultsEl.innerHTML = '<div style="color:#38bdf8; text-align:center; padding:30px;">⏳ Model Coordination 서버에서 간섭 목록을 가져오는 중입니다...</div>';

    try {
        // (1단계) 토큰 발급/검증 액션 실행 및 완료 보장 (Promise/await)
        let accessToken = window.accessToken || sessionStorage.getItem('aps_access_token') || '';
        try {
            const tokenResp = await fetch('/api/auth/token');
            if (tokenResp.ok) {
                const tokenData = await tokenResp.json();
                if (tokenData && tokenData.access_token) {
                    accessToken = tokenData.access_token;
                    // (2단계) 세션/전역 변수에 토큰 값 할당 완료 대기
                    window.accessToken = accessToken;
                    sessionStorage.setItem('aps_access_token', accessToken);
                }
            }
        } catch (tokenErr) {
            console.warn('[Clash Auth Token Fetch Warning]', tokenErr.message);
        }

        // 1. projectId 명확히 분리 (b. 접두사 포함)
        const rawProjId = window.currentProjectId || sessionStorage.getItem('aps_project_id') || 'd005cd39-4a35-4843-b350-81da491266ef';
        const projectId = rawProjId.startsWith('b.') ? rawProjId : `b.${rawProjId}`;

        // 2. Model Set ID (test_id) 확보: UI/전역/세션 및 하드코딩 테스트 UUID 바인딩
        const HARDCODED_TEST_ID = 'c0374bde-3a12-4b72-a1f9-906d20387b92'; // ACC 활성화 모델 세트 디버깅 UUID

        const testIdCandidate = 
            document.getElementById('clash-filter-test-id')?.value ||
            document.getElementById('clash-model-set-select')?.value ||
            document.getElementById('model-set-filter')?.value ||
            window.currentTestId ||
            window.currentModelSetId ||
            sessionStorage.getItem('aps_test_id') ||
            sessionStorage.getItem('aps_model_set_id') ||
            '';

        const testId = (testIdCandidate && testIdCandidate.trim() !== '') ? testIdCandidate.trim() : HARDCODED_TEST_ID;

        // URL 쿼리 파라미터 조립 (변수 오염 방지를 위해 각 필드 독립 설정)
        const params = new URLSearchParams();
        params.set('structure', structure);
        params.set('folderId', structure);
        params.set('primaryId', primaryId);
        params.set('comparedId', comparedId);
        params.set('primaryDiscipline', primaryId);
        params.set('comparedDiscipline', comparedId);
        params.set('status', status);
        params.set('projectId', projectId);
        params.set('project_id', projectId);
        params.set('testId', testId);
        params.set('test_id', testId);
        params.set('modelSetId', testId);

        console.log(`[GetClashInstances Pipeline] Request URL Params: projectId=${projectId}, test_id=${testId}, primaryId=${primaryId}, comparedId=${comparedId}`);

        // (3단계) Authorization Header에 'Bearer ' + accessToken 명시적 주입 후 GetClashInstances API 최종 호출
        const headers = { 'Content-Type': 'application/json' };
        if (accessToken) {
            headers['Authorization'] = `Bearer ${accessToken}`;
        }

        // Parallel Fetch: Instances API & Matrix API (Forma Count Sync)
        const [resp, matrixResp] = await Promise.all([
            fetch(`/api/clash/instances?${params}`, { headers }),
            fetch(`/api/clash/matrix?structure=${structure}`, { headers }).catch(() => null)
        ]);

        if (!resp.ok) {
            const errData = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
            const httpStatus = resp.status || errData.status;
            const errMsg = errData.error || `HTTP ${resp.status}`;
            console.error("🚨 [CLASH API REAL ERROR] HTTP Status:", httpStatus);
            console.error("🚨 [CLASH API REAL ERROR] Error Message:", errMsg);
            if (errData.testId) {
                console.error("🚨 [CLASH API REAL ERROR] Target Test ID:", errData.testId);
            }

            throw new Error(`[HTTP ${httpStatus}] ${errMsg}`);
        }

        const body = await resp.json();
        let instances = body.instances || [];

        // Parse Forma Matrix Count
        let formaMatrixCount = null;
        if (matrixResp && matrixResp.ok) {
            const matrixBody = await matrixResp.json().catch(() => null);
            if (matrixBody && Array.isArray(matrixBody.matrix)) {
                // Check if it's Forma Matrix (flat array with .row and .col)
                if (matrixBody.matrix.length > 0 && matrixBody.matrix[0].row !== undefined) {
                    if (primaryId !== 'ALL' && comparedId !== 'ALL') {
                        const cell = matrixBody.matrix.find(c =>
                            (c.row === primaryId && c.col === comparedId) || (c.row === comparedId && c.col === primaryId)
                        );
                        formaMatrixCount = cell ? cell.count : 0;
                    } else {
                        formaMatrixCount = matrixBody.totalClashes || matrixBody.matrix.reduce((sum, c) => sum + (c.count || 0), 0);
                    }
                } else {
                    // 2D Array format (Fallback Matrix Engine)
                    formaMatrixCount = null; // Let the instance count take over
                }
            }
        }

        // ── Dual Discipline Filter (Client-side Fallback Safety) ────────────────
        if (primaryId !== 'ALL' && comparedId !== 'ALL') {
            instances = instances.filter(i =>
                (i.leftDiscipline === primaryId && i.rightDiscipline === comparedId) ||
                (i.leftDiscipline === comparedId && i.rightDiscipline === primaryId)
            );
        } else if (primaryId !== 'ALL') {
            instances = instances.filter(i => i.leftDiscipline === primaryId || i.rightDiscipline === primaryId);
        } else if (comparedId !== 'ALL') {
            instances = instances.filter(i => i.leftDiscipline === comparedId || i.rightDiscipline === comparedId);
        }

        // ── Client-side status filter ──────────────────────────────────────
        if (status !== 'ALL') {
            instances = instances.filter(i =>
                String(i.status || 'Active').toLowerCase() === status.toLowerCase()
            );
        }

        allInstances = instances;
        filteredInstances = [...instances];

        const groupedList = groupClashInstances(filteredInstances);
        const finalCount = formaMatrixCount !== null ? formaMatrixCount : filteredInstances.length;

        const searchInput = document.getElementById('clash-list-search');
        if (searchInput) searchInput.value = '';

        if (countEl) countEl.textContent = `간섭 발생 목록: ${finalCount}건`;

        // Source 유형별 상태 배지 및 안내 메시지 표시
        const src = body.source || '';
        const isLiveMC  = src === 'acc-mc-live';
        const isFallback = src === 'bim-metadata-fallback' || src === 'enriched-clash-dataset';
        if (statusEl) {
            if (isLiveMC) {
                statusEl.textContent = `✅ 실시간 간섭 ${finalCount}건 [ACC Model Coordination Live]`;
                statusEl.style.borderColor = '#22c55e';
                statusEl.style.color       = '#4ade80';
            } else if (isFallback) {
                statusEl.innerHTML = `
                    <span>⚠️ BIM Metadata 기반 ${finalCount}건 [ACC 실시간 API 미연동]</span>
                    <button id="btn-acc-setup-guide" style="margin-left:8px; padding:2px 8px; font-size:0.72rem; background:#0284c7; color:#fff; border:none; border-radius:4px; cursor:pointer; font-weight:600; transition:all 0.2s;">
                        ⚙️ ACC 연동 가이드
                    </button>
                `;
                statusEl.style.borderColor = '#f59e0b';
                statusEl.style.color       = '#fbbf24';

                setTimeout(() => {
                    const guideBtn = document.getElementById('btn-acc-setup-guide');
                    if (guideBtn) guideBtn.onclick = () => showAccSetupModal();
                }, 50);
            } else {
                statusEl.textContent = `✅ 간섭 발생 목록: ${finalCount}건`;
                statusEl.style.borderColor = '#38bdf8';
                statusEl.style.color       = '#38bdf8';
            }
        }

        renderClashList(filteredInstances, { showLoginBanner: isFallback && body.loginUrl });

    } catch (err) {
        console.error("🚨 [CLASH API REAL ERROR] Execution Catch:", err);
        if (statusEl) {
            statusEl.textContent = `❌ ${err.message}`;
            statusEl.style.borderColor = '#ef4444';
            statusEl.style.color       = '#ef4444';
        }
        if (resultsEl) {
            resultsEl.innerHTML = `
                <div style="color:#ef4444; padding:20px; background:rgba(239,68,68,0.1); border-radius:8px; border:1px solid rgba(239,68,68,0.3); margin:8px; font-size:0.83rem;">
                    <div style="font-weight:bold; font-size:0.9rem; margin-bottom:8px;">🚨 [CLASH API REAL ERROR]</div>
                    <div style="line-height:1.6; word-break:break-all;">${escapeHtml(err.message)}</div>
                </div>`;
        }
    } finally {
        if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
    }
}

// ─── 4.5. Group Raw Instances into Clash Groups (reduce) ──────────────────────
function groupClashInstances(instances) {
    if (!instances || !Array.isArray(instances)) return [];

    const groupedMap = instances.reduce((acc, item) => {
        const groupKey = item.clashGroupId || item.groupId || 
                         (item.leftDocumentName ? `${item.leftDocumentName}_${item.leftObjectId || item.lvid || '0'}` : `group_${item.leftObjectId || item.ldid || '0'}`);

        if (!acc[groupKey]) {
            acc[groupKey] = {
                groupId: groupKey,
                masterItem: item,
                items: [],
                count: 0,
                primaryElementName: item.leftElementName || item.leftDocumentName || `Primary #${item.leftObjectId}`,
                primaryDiscipline: item.leftDiscipline || '?',
                primaryObjectId: item.leftObjectId
            };
        }

        acc[groupKey].items.push(item);
        acc[groupKey].count += 1;
        return acc;
    }, {});

    return Object.values(groupedMap);
}

// ─── 5. Render List (ACC Grouping Style) ──────────────────────────────────────
function renderClashList(instances, opts = {}) {
    const container = document.getElementById('custom-clash-results');
    if (!container) return;

    container.innerHTML = '';

    // ── 로그인 유도 배너 (Fallback 모드일 때) ──────────────────────────────
    if (opts.showLoginBanner) {
        const banner = document.createElement('div');
        banner.style.cssText = 'background:rgba(245,158,11,0.12); border:1px solid rgba(245,158,11,0.4); border-radius:8px; padding:12px 16px; margin-bottom:10px; font-size:0.8rem; line-height:1.6; color:#fbbf24;';
        banner.innerHTML = `
            <div style="font-weight:700; margin-bottom:4px;">⚠️ BIM Metadata 기반 표시 중</div>
            <div style="color:#94a3b8;">실제 ACC Model Coordination 간섭 데이터를 불러오려면 <strong style="color:#38bdf8;">Autodesk 계정 로그인</strong>이 필요합니다.</div>
            <div style="margin-top:8px;">
                <a href="/api/auth/login?force=1" style="background:linear-gradient(135deg,#3b82f6,#2563eb); color:#fff; padding:5px 14px; border-radius:5px; text-decoration:none; font-weight:700; font-size:0.78rem;">🔑 Autodesk 로그인</a>
            </div>`;
        container.appendChild(banner);
    }

    const groups = groupClashInstances(instances);

    if (!groups || groups.length === 0) {
        container.innerHTML += `
            <div style="color:#22c55e; text-align:center; padding:40px; background:rgba(34,197,94,0.08); border-radius:8px; border:1px solid rgba(34,197,94,0.25); margin:8px;">
                🎉 선택한 조건에 해당하는 활성 간섭이 없습니다.
            </div>`;
        return;
    }

    groups.forEach((group, gIdx) => {
        const card = document.createElement('div');
        card.className = 'clash-group-card';
        card.dataset.gidx = gIdx;
        card.style.cssText = 'background:#0f172a; padding:12px; border-radius:8px; border:1px solid #334155; margin-bottom:10px; cursor:pointer; transition:all 0.18s ease; user-select:none;';

        const master = group.masterItem;
        const lDisc = master.leftDiscipline  || '?';
        const lName = master.leftElementName  || master.leftDocumentName  || `부재 #${master.leftObjectId  || gIdx}`;

        const comparedItemsHtml = group.items.map((it, iIdx) => {
            const rDisc = it.rightDiscipline || '?';
            const rName = it.rightElementName || it.rightDocumentName || `부재 #${it.rightObjectId || iIdx}`;
            return `
                <div style="display:flex; align-items:flex-start; gap:6px; margin-top:4px; font-size:0.75rem; background:rgba(30,41,59,0.6); padding:5px 8px; border-radius:4px; border-left:2px solid #22c55e;">
                    <span style="${discStyle(rDisc)}">${escapeHtml(rDisc)}</span>
                    <span style="color:#86efac; flex:1; line-height:1.4;">${escapeHtml(rName)} <span style="color:#64748b; font-size:0.7rem;">(ID: ${it.rightObjectId || 'N/A'})</span></span>
                </div>`;
        }).join('');

        card.innerHTML = `
            <div style="font-size:0.78rem; color:#94a3b8; margin-bottom:6px; display:flex; justify-content:space-between; align-items:center;">
                <span style="font-weight:700; color:#38bdf8;">📂 간섭 그룹 #${gIdx + 1}</span>
                <span style="color:#38bdf8; font-size:0.72rem; font-weight:700; background:rgba(56,189,248,0.15); padding:2px 8px; border-radius:10px; border:1px solid rgba(56,189,248,0.3);">
                    간섭 ${group.count}건
                </span>
            </div>
            <div style="display:flex; align-items:flex-start; gap:6px; margin-bottom:6px; background:rgba(15,23,42,0.8); padding:8px; border-radius:6px; border:1px solid #1e293b;">
                <span style="${discStyle(lDisc)}">${escapeHtml(lDisc)}</span>
                <div style="flex:1;">
                    <div style="font-size:0.8rem; font-weight:600; color:#fca5a5;">${escapeHtml(lName)}</div>
                    <div style="font-size:0.68rem; color:#64748b; margin-top:2px;">기준 부재 ID: ${master.leftObjectId || 'N/A'} | 파일: ${escapeHtml(master.leftDocumentName || '')}</div>
                </div>
            </div>
            <div style="margin-top:6px;">
                <div style="font-size:0.7rem; color:#94a3b8; margin-bottom:4px; font-weight:600;">⚡ 교차 간섭 대상 목록 (${group.count}개):</div>
                ${comparedItemsHtml}
            </div>`;

        card.addEventListener('mouseenter', () => {
            card.style.background = '#1e293b';
            card.style.borderColor = '#3b82f6';
            card.style.transform = 'translateX(2px)';
        });
        card.addEventListener('mouseleave', () => {
            if (card.dataset.selected !== 'true') {
                card.style.background = '#0f172a';
                card.style.borderColor = '#334155';
                card.style.transform = '';
            }
        });
        card.addEventListener('click', () => {
            document.querySelectorAll('.clash-group-card').forEach(c => {
                c.dataset.selected = 'false';
                c.style.background = '#0f172a';
                c.style.borderColor = '#334155';
                c.style.transform = '';
            });
            card.dataset.selected = 'true';
            card.style.background = '#1e293b';
            card.style.borderColor = '#3b82f6';
            highlightClashInViewer(master);
        });

        container.appendChild(card);
    });
}

// ─── Defensive Helpers for Viewer Highlighting ────────────────────────────────

/**
 * 1) 로딩 대기 보장 (Promise/Event 기반):
 * GEOMETRY_LOADED_EVENT 및 isLoadDone()을 통해 지오메트리 및 fragments 메모리가 완전 로드되었는지 대기
 */
function waitForModelGeometry(viewer, targetModel) {
    return new Promise((resolve) => {
        if (!targetModel) return resolve(null);

        const hasFragments = targetModel.getData && targetModel.getData()?.fragments;
        const isDone = typeof targetModel.isLoadDone === 'function' ? targetModel.isLoadDone() : true;

        if (isDone && hasFragments) {
            return resolve(targetModel);
        }

        let timeoutId = null;
        const onGeometryLoaded = (event) => {
            if (!event || event.model === targetModel || !event.model) {
                if (viewer && typeof viewer.removeEventListener === 'function' && window.Autodesk?.Viewing?.GEOMETRY_LOADED_EVENT) {
                    viewer.removeEventListener(window.Autodesk.Viewing.GEOMETRY_LOADED_EVENT, onGeometryLoaded);
                }
                if (timeoutId) clearTimeout(timeoutId);
                resolve(targetModel);
            }
        };

        if (viewer && typeof viewer.addEventListener === 'function' && window.Autodesk?.Viewing?.GEOMETRY_LOADED_EVENT) {
            viewer.addEventListener(window.Autodesk.Viewing.GEOMETRY_LOADED_EVENT, onGeometryLoaded);
        }

        timeoutId = setTimeout(() => {
            if (viewer && typeof viewer.removeEventListener === 'function' && window.Autodesk?.Viewing?.GEOMETRY_LOADED_EVENT) {
                viewer.removeEventListener(window.Autodesk.Viewing.GEOMETRY_LOADED_EVENT, onGeometryLoaded);
            }
            resolve(targetModel);
        }, 4000);
    });
}

/**
 * Ensures a model's Object Tree (Instance Tree) is fully created and available.
 */
function waitForInstanceTree(viewer, targetModel) {
    return new Promise((resolve) => {
        if (!targetModel) return resolve(null);
        if (typeof targetModel.getInstanceTree === 'function' && targetModel.getInstanceTree()) {
            return resolve(targetModel);
        }
        if (typeof targetModel.getObjectTree === 'function') {
            targetModel.getObjectTree(
                () => resolve(targetModel),
                () => resolve(targetModel)
            );
        } else {
            resolve(targetModel);
        }
    });
}

/**
 * 2) 유효성 검사 (Null Check) 강화:
 * viewer.model 또는 타겟 model 객체가 실제로 존재하는지, data/fragments/instanceTree/dbId 유효성 사전 검사
 */
function isModelReadyAndValid(model, dbId) {
    if (!model || typeof model !== 'object') return false;
    if (!dbId || isNaN(dbId) || dbId <= 0) return false;

    // fragments 접근 에러 방지 (Cannot read properties of null (reading 'fragments'))
    const modelData = (typeof model.getData === 'function') ? model.getData() : model.data;
    if (!modelData) return false;
    if (!modelData.fragments && !model.fragments) return false;

    // instanceTree 검사
    const tree = (typeof model.getInstanceTree === 'function') ? model.getInstanceTree() : null;
    if (!tree) return false;

    return true;
}

/**
 * 3) 다중 모델 렌더링 (Multi-Model) 참조 확인:
 * viewer.getAllModels() 목록에서 documentId, documentName, URN을 매핑하여 정확한 모델 탐색
 */
function findMatchingModelInViewer(viewer, docId, docName, rawUrn) {
    if (!viewer || typeof viewer.getAllModels !== 'function') return null;
    const models = viewer.getAllModels() || [];
    if (models.length === 0) return null;

    const normUrn = rawUrn ? getSafeBase64Urn(rawUrn) : '';
    const normName = (docName || '').toLowerCase().trim();
    const normDocId = docId ? String(docId).trim() : '';

    // 1) URN 기반 매핑
    if (normUrn) {
        const found = models.find(m => {
            const mData = typeof m.getData === 'function' ? m.getData() : null;
            const mUrn = getSafeBase64Urn(mData?.urn || (typeof m.getSeedUrn === 'function' ? m.getSeedUrn() : ''));
            return mUrn && (mUrn === normUrn || mUrn.includes(normUrn) || normUrn.includes(mUrn));
        });
        if (found) return found;
    }

    // 2) Document Name / Title 기반 매핑
    if (normName) {
        const found = models.find(m => {
            const title = (typeof m.getDocumentTitle === 'function' ? m.getDocumentTitle() : (m.getData?.()?.title || '')).toLowerCase();
            return title && (title.includes(normName) || normName.includes(title));
        });
        if (found) return found;
    }

    // 3) Document ID / Index 기반 매핑
    if (normDocId && !isNaN(parseInt(normDocId, 10))) {
        const idx = parseInt(normDocId, 10);
        if (models[idx]) return models[idx];
    }

    return null;
}

async function highlightClashInViewer(item) {
    const placeholder = document.getElementById('clash-viewer-placeholder');
    if (placeholder) placeholder.style.display = 'none';

    // Ensure viewer is ready
    const viewer = clashViewer || await ensureClashViewerInitialized();
    if (!viewer) return;

    // Use getSafeBase64Urn to prevent atob InvalidCharacterError
    const rawLeftUrn  = item.leftViewerUrn  || item.leftUrn  || item.leftModelUrn;
    const rawRightUrn = item.rightViewerUrn || item.rightUrn || item.rightModelUrn;

    const leftUrn  = getSafeBase64Urn(rawLeftUrn);
    const rightUrn = getSafeBase64Urn(rawRightUrn);

    const leftId   = parseInt(item.leftObjectId  || item.lvid || 0, 10);
    const rightId  = parseInt(item.rightObjectId || item.rvid || 0, 10);

    try {
        // 1) 뷰어에 로드된 기존 모델 인스턴스 배열 취득
        const existingModels = (typeof viewer.getAllModels === 'function') ? viewer.getAllModels() : [];

        // 2) URN 기반 비동기 모델 로드 시도
        const [loadedM1, loadedM2] = await Promise.all([
            ensureModelLoaded(viewer, leftUrn),
            ensureModelLoaded(viewer, rightUrn)
        ]);

        // 3) 다중 모델 매핑 로직 (loaded -> URN/Name 매핑 -> existingModels 순으로 안전 매핑)
        let m1 = loadedM1 || findMatchingModelInViewer(viewer, item.leftDocumentId, item.leftDocumentName, leftUrn) || (existingModels.length > 0 ? existingModels[0] : null);
        let m2 = loadedM2 || findMatchingModelInViewer(viewer, item.rightDocumentId, item.rightDocumentName, rightUrn) || (existingModels.length > 1 ? existingModels[1] : (existingModels.length > 0 ? existingModels[0] : null));

        // 4) 로딩 대기 보장 (Geometry/Fragments + Instance Tree 비동기 대기)
        [m1, m2] = await Promise.all([
            waitForModelGeometry(viewer, m1).then(m => waitForInstanceTree(viewer, m)),
            waitForModelGeometry(viewer, m2).then(m => waitForInstanceTree(viewer, m))
        ]);

        // 5) Safely clear all existing theming
        if (typeof viewer.clearThemingColors === 'function') {
            if (m1 && isModelReadyAndValid(m1, 1)) try { viewer.clearThemingColors(m1); } catch(_) {}
            if (m2 && isModelReadyAndValid(m2, 1)) try { viewer.clearThemingColors(m2); } catch(_) {}
            try { viewer.clearThemingColors(); } catch(_) {}
        }

        // 6) 유효성 검사 (Null Check) 강화 후 Isolate 대상 구성
        const targets = [];
        const isM1Valid = isModelReadyAndValid(m1, leftId);
        const isM2Valid = isModelReadyAndValid(m2, rightId);

        if (isM1Valid) {
            targets.push({ model: m1, selection: [leftId], ids: [leftId] });
        }
        if (isM2Valid && m2 !== m1) {
            targets.push({ model: m2, selection: [rightId], ids: [rightId] });
        } else if (isM2Valid && m2 === m1 && targets.length > 0) {
            targets[0].selection.push(rightId);
            targets[0].ids.push(rightId);
        }

        // 7) 안전한 Isolate & FitToView 실행 (방어 코드)
        if (targets.length > 0) {
            try {
                if (typeof viewer.aggregateIsolate === 'function') {
                    viewer.aggregateIsolate(targets);
                } else {
                    if (isM1Valid) viewer.isolate([leftId], m1);
                    if (isM2Valid) viewer.isolate([rightId], m2);
                }
                
                if (typeof viewer.aggregateFitToView === 'function') {
                    viewer.aggregateFitToView(targets);
                } else if (targets[0] && targets[0].ids) {
                    viewer.fitToView(targets[0].ids, targets[0].model);
                }
            } catch (vizErr) {
                console.warn('[Viewer Isolation Notice]', vizErr.message);
            }
        }

        // 8) 유효성 검사 후 setThemingColor 안전 적용
        const RED   = new window.THREE.Vector4(1.0, 0.0, 0.0, 1.0); // Solid Red
        const GREEN = new window.THREE.Vector4(0.0, 1.0, 0.0, 1.0); // Solid Green

        if (isM1Valid) {
            try { viewer.setThemingColor(leftId, RED, m1, true); } catch(e) {
                console.warn('[Viewer Theming Notice - M1]', e.message);
            }
        }
        if (isM2Valid) {
            try { viewer.setThemingColor(rightId, GREEN, m2, true); } catch(e) {
                console.warn('[Viewer Theming Notice - M2]', e.message);
            }
        }

        // 9) Force Viewer Redraw
        if (viewer && viewer.impl && typeof viewer.impl.invalidate === 'function') {
            viewer.impl.invalidate(true, true, true);
        }

    } catch (err) {
        console.error('[Clash Highlight Error]', err);
    }
}

/**
 * Load a model into the viewer only if it hasn't been loaded yet.
 * @param {object} viewer - Autodesk Viewer instance
 * @param {string} rawUrn - ACC Version URN or Base64 URN
 * @returns {Promise<Autodesk.Viewing.Model|null>}
 */
async function ensureModelLoaded(viewer, rawUrn) {
    if (!rawUrn && !window.currentUrn) return null;

    const safeUrn = rawUrn ? getSafeBase64Urn(rawUrn) : getSafeBase64Urn(window.currentUrn);

    if (loadedModelCache[safeUrn]) return loadedModelCache[safeUrn];

    try {
        const model = await loadModel(viewer, safeUrn);
        if (model) {
            loadedModelCache[safeUrn] = model;
            return model;
        }
    } catch (err) {
        console.warn('[Clash Model Load Notice]', safeUrn?.substring(0, 40), err.message || err);
    }

    // 🚨 Fallback: If exact URN fails to load (e.g. 403 ACC permission), load window.currentUrn
    if (window.currentUrn && safeUrn !== getSafeBase64Urn(window.currentUrn)) {
        try {
            const fallbackUrn = getSafeBase64Urn(window.currentUrn);
            if (loadedModelCache[fallbackUrn]) return loadedModelCache[fallbackUrn];
            const fallbackModel = await loadModel(viewer, fallbackUrn);
            if (fallbackModel) {
                loadedModelCache[fallbackUrn] = fallbackModel;
                return fallbackModel;
            }
        } catch (_) {}
    }

    return null;
}

// ─── ACC Integration Setup Guide Modal ───────────────────────────────────────
async function showAccSetupModal() {
    let clientId = 'N/A';
    try {
        const res = await fetch('/api/auth/client-id');
        if (res.ok) {
            const data = await res.json();
            clientId = data.clientId || 'N/A';
        }
    } catch (_) {}

    let modal = document.getElementById('acc-setup-guide-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'acc-setup-guide-modal';
        modal.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100vw; height: 100vh;
            background: rgba(15, 23, 42, 0.85); backdrop-filter: blur(4px);
            display: flex; align-items: center; justify-content: center; z-index: 99999;
        `;
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div style="background: #1e293b; border: 1px solid #3b82f6; border-radius: 12px; padding: 24px; max-width: 520px; width: 90%; color: #f8fafc; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);">
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid #334155; padding-bottom: 12px; margin-bottom: 16px;">
                <h3 style="margin:0; font-size:1.1rem; color:#38bdf8; display:flex; align-items:center; gap:8px;">
                    ⚙️ ACC Model Coordination 연동 설정 안내
                </h3>
                <span id="close-acc-modal-x" style="cursor:pointer; font-size:1.2rem; color:#94a3b8;">&times;</span>
            </div>

            <div style="font-size:0.85rem; line-height:1.6; color:#cbd5e1;">
                <p style="margin-top:0;">현재 프로젝트에 <strong>Autodesk Construction Cloud (ACC) Model Coordination API</strong> 연동 허용이 필요합니다.</p>
                
                <div style="background:#0f172a; padding:12px; border-radius:8px; border:1px solid #334155; margin:12px 0;">
                    <div style="font-weight:700; color:#f59e0b; margin-bottom:6px;">📌 1단계: ACC 관리자 연동 설정</div>
                    <ol style="margin:0; padding-left:20px; font-size:0.8rem; color:#94a3b8;">
                        <li>Autodesk ACC Account Admin에 접속합니다.</li>
                        <li><strong>Custom Integrations (앱 통합)</strong> 메뉴로 이동합니다.</li>
                        <li>아래의 APS Client ID를 등록하고 Model Coordination 권한을 허용합니다.</li>
                    </ol>
                </div>

                <div style="margin-bottom:16px;">
                    <label style="font-size:0.75rem; font-weight:700; color:#94a3b8; display:block; margin-bottom:4px;">현재 플랫폼 APS Client ID</label>
                    <div style="display:flex; gap:8px;">
                        <input type="text" readonly value="${escapeHtml(clientId)}" id="acc-client-id-input" style="flex:1; background:#0f172a; border:1px solid #475569; color:#38bdf8; padding:8px 12px; border-radius:6px; font-family:monospace; font-size:0.85rem;">
                        <button id="btn-copy-client-id" style="background:#3b82f6; color:#fff; border:none; border-radius:6px; padding:0 12px; cursor:pointer; font-weight:600; font-size:0.8rem;">📋 복사</button>
                    </div>
                </div>
            </div>

            <div style="display:flex; justify-height:end; gap:8px; margin-top:20px;">
                <button id="btn-retry-acc-live" style="background:#22c55e; color:#fff; border:none; border-radius:6px; padding:8px 16px; cursor:pointer; font-weight:600; font-size:0.85rem;">🔄 연동 재시도</button>
                <button id="btn-close-acc-modal" style="background:#475569; color:#fff; border:none; border-radius:6px; padding:8px 16px; cursor:pointer; font-weight:600; font-size:0.85rem;">닫기</button>
            </div>
        </div>
    `;

    modal.style.display = 'flex';

    document.getElementById('close-acc-modal-x').onclick = () => modal.style.display = 'none';
    document.getElementById('btn-close-acc-modal').onclick = () => modal.style.display = 'none';

    document.getElementById('btn-copy-client-id').onclick = () => {
        const input = document.getElementById('acc-client-id-input');
        input.select();
        navigator.clipboard.writeText(input.value);
        alert('Client ID가 클립보드에 복사되었습니다.');
    };

    document.getElementById('btn-retry-acc-live').onclick = () => {
        modal.style.display = 'none';
        loadClashInstances();
    };
}

// ─── Utility ─────────────────────────────────────────────────────────────────
function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
