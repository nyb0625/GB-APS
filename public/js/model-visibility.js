/* ==========================================================================
   model-visibility.js — 3D 모델 가시성 조절 & 계층형 병합 로드 팝업 모듈
   ========================================================================== */

// 현재 뷰어에 로드된 모델 객체들을 추적 관리하는 전역 딕셔너리
export const loadedModels = {};
export const rotationState = {};
export const opacityState = {};
const materialOpacityBackup = {};
const modelOpacityUnconsolidated = new Set();
const pendingOpacityReapply = new Map();
const OPACITY_STATE_KEY = 'aps_model_visibility_opacity_v1';

try {
    Object.assign(opacityState, JSON.parse(localStorage.getItem(OPACITY_STATE_KEY) || '{}'));
} catch (e) {
    console.warn('[ModelVisibility] opacity state restore skipped:', e.message);
}
function persistOpacityState() {
    try {
        localStorage.setItem(OPACITY_STATE_KEY, JSON.stringify(opacityState));
    } catch (e) {
        console.warn('[ModelVisibility] opacity state save skipped:', e.message);
    }
}

function normalizeUrnValue(value) {
    return value ? String(value).replace(/^urn:/, '').replace(/=/g, '').trim() : '';
}

function getThreeNamespace() {
    return window.THREE || (window.Autodesk && Autodesk.Viewing && Autodesk.Viewing.Private && Autodesk.Viewing.Private.THREE) || null;
}

function getViewerModels(viewer) {
    if (!viewer) return [];
    const models = [];
    const addModel = (model) => {
        if (!model) return;
        if (!models.some(candidate => candidate === model || candidate.id === model.id)) {
            models.push(model);
        }
    };
    try {
        if (typeof viewer.getAllModels === 'function') {
            (viewer.getAllModels() || []).forEach(addModel);
        }
    } catch (e) {}
    try {
        const queue = viewer.impl && typeof viewer.impl.modelQueue === 'function'
            ? viewer.impl.modelQueue()
            : null;
        if (queue && typeof queue.getModels === 'function') {
            (queue.getModels() || []).forEach(addModel);
        }
    } catch (e) {}
    addModel(viewer.model);
    return models;
}

function isModelInViewer(viewer, model) {
    if (!viewer || !model) return true;
    return getViewerModels(viewer).some(candidate => candidate === model || candidate.id === model.id);
}

function modelUrnMatches(model, urn) {
    if (!model || !urn) return false;
    const normTarget = normalizeUrnValue(urn);
    const data = model.getData ? model.getData() : null;
    const candidates = [
        data && data.urn,
        data && data.loadOptions && data.loadOptions.bubbleNode && data.loadOptions.bubbleNode.urn,
        data && data.loadOptions && data.loadOptions.bubbleNode && typeof data.loadOptions.bubbleNode.urn === 'function' && data.loadOptions.bubbleNode.urn(),
        model.loader && model.loader.svfUrn,
        model.myData && model.myData.urn
    ].filter(Boolean);

    return candidates.some(candidate => {
        const normCandidate = normalizeUrnValue(candidate);
        return normCandidate && (
            normCandidate === normTarget ||
            normCandidate.includes(normTarget) ||
            normTarget.includes(normCandidate)
        );
    });
}

function registerLoadedModel(urn, model) {
    if (!urn || !model) return model;
    loadedModels[urn] = model;
    try {
        if (!model.__apsVisibilityUrns) model.__apsVisibilityUrns = new Set();
        model.__apsVisibilityUrns.add(urn);
        model.__apsVisibilityUrns.add(normalizeUrnValue(urn));
    } catch (e) {}
    return model;
}

function getLoadedModelByUrn(urn, viewer) {
    const normTarget = normalizeUrnValue(urn);
    const exactModel = loadedModels[urn];
    if (exactModel && isModelInViewer(viewer, exactModel)) return exactModel;
    const key = Object.keys(loadedModels).find(k => {
        const candidate = loadedModels[k];
        return normalizeUrnValue(k) === normTarget && isModelInViewer(viewer, candidate);
    });
    if (key) return loadedModels[key];

    const viewerMatch = getViewerModels(viewer).find(model => {
        if (model.__apsVisibilityUrns && (model.__apsVisibilityUrns.has(urn) || model.__apsVisibilityUrns.has(normTarget))) return true;
        return modelUrnMatches(model, urn);
    });
    return viewerMatch || null;
}

function getMainViewerModelByUrn(viewer, urn) {
    if (!viewer || !viewer.model || !urn) return null;

    const normTarget = normalizeUrnValue(urn);
    const data = viewer.model.getData ? viewer.model.getData() : null;
    const candidates = [
        window._currentMainModelUrn,
        data && data.urn,
        data && data.loadOptions && data.loadOptions.bubbleNode && data.loadOptions.bubbleNode.urn,
        viewer.model.loader && viewer.model.loader.svfUrn
    ].filter(Boolean);

    const matched = candidates.some(candidate => {
        const normCandidate = normalizeUrnValue(candidate);
        return normCandidate && (
            normCandidate === normTarget ||
            normCandidate.includes(normTarget) ||
            normTarget.includes(normCandidate)
        );
    });

    return matched ? viewer.model : null;
}

function createPlacementTransform(rotateMinus90) {
    const THREE_NS = getThreeNamespace();
    if (!THREE_NS) return null;
    const transform = new THREE_NS.Matrix4();
    if (rotateMinus90) {
        transform.makeRotationZ(-Math.PI / 2);
    } else {
        transform.identity();
    }
    return transform;
}

function isRotationEnabled(urn) {
    const normTarget = normalizeUrnValue(urn);
    return !!Object.keys(rotationState).find(k => normalizeUrnValue(k) === normTarget && rotationState[k]);
}

function getStoredModelOpacity(urn) {
    const normTarget = normalizeUrnValue(urn);
    const key = Object.keys(opacityState).find(k => normalizeUrnValue(k) === normTarget);
    const raw = key ? opacityState[key] : opacityState[urn];
    const value = Number(raw);
    return Number.isFinite(value) ? Math.max(0.1, Math.min(1, value)) : 1;
}

function getModelRootId(model) {
    if (!model) return 1;
    try {
        if (typeof model.getRootId === 'function') return model.getRootId();
    } catch (e) {}
    try {
        const tree = model.getInstanceTree && model.getInstanceTree();
        if (tree && typeof tree.getRootId === 'function') return tree.getRootId();
    } catch (e2) {}
    try {
        const data = model.getData && model.getData();
        const tree = data && data.instanceTree;
        if (tree && typeof tree.getRootId === 'function') return tree.getRootId();
    } catch (e3) {}
    return 1;
}

function getMaterialBackupKey(model, urn) {
    return `${model && model.id != null ? model.id : 'model'}:${normalizeUrnValue(urn)}`;
}

function ensureModelCanUseCustomMaterials(viewer, model) {
    if (!viewer || !model || model.id == null || modelOpacityUnconsolidated.has(model.id)) return;
    try {
        if (typeof model.isConsolidated === 'function' && !model.isConsolidated()) {
            modelOpacityUnconsolidated.add(model.id);
            return;
        }
        if (typeof model.unconsolidate === 'function') {
            model.unconsolidate();
        } else if (viewer.impl && typeof viewer.impl.unconsolidateModel === 'function') {
            viewer.impl.unconsolidateModel(model);
        }
        modelOpacityUnconsolidated.add(model.id);
    } catch (e) {
        console.warn('[ModelVisibility] model unconsolidate skipped:', e.message);
    }
}

function forEachModelFragment(model, callback) {
    if (!model || typeof callback !== 'function') return;
    const fragList = model.getFragmentList && model.getFragmentList();
    if (!fragList) return;

    const visited = new Set();
    const visit = (fragId) => {
        if (visited.has(fragId)) return;
        visited.add(fragId);
        callback(fragId, fragList);
    };

    try {
        const tree = model.getInstanceTree && model.getInstanceTree();
        if (tree && typeof tree.enumNodeFragments === 'function') {
            tree.enumNodeFragments(getModelRootId(model), visit, true);
            if (visited.size > 0) return;
        }
    } catch (e) {
        console.warn('[ModelVisibility] fragment tree traversal failed:', e.message);
    }

    const fragments = fragList.fragments || {};
    const fragCount = fragments.fragId2dbId ? fragments.fragId2dbId.length : (typeof fragList.getCount === 'function' ? fragList.getCount() : 0);
    for (let fragId = 0; fragId < fragCount; fragId++) {
        visit(fragId);
    }
}

function registerViewerMaterial(viewer, material, name) {
    if (!viewer || !viewer.impl || !material) return material;
    material.name = name;
    try {
        const matman = typeof viewer.impl.matman === 'function' ? viewer.impl.matman() : null;
        if (matman && typeof matman.addMaterial === 'function') {
            matman.addMaterial(name, material, true);
        }
    } catch (e) {
        console.warn('[ModelVisibility] material manager registration skipped:', e.message);
    }
    return material;
}

function configureOpacityMaterial(material, opacity) {
    if (!material) return material;
    const value = Math.max(0.1, Math.min(1, Number(opacity) || 1));
    const THREE_NS = getThreeNamespace();

    material.transparent = value < 0.99;
    material.opacity = value;
    material.depthWrite = value >= 0.99;
    material.depthTest = true;
    material.alphaTest = 0;
    material.visible = true;
    if (THREE_NS && typeof THREE_NS.NormalBlending !== 'undefined') {
        material.blending = THREE_NS.NormalBlending;
    }
    if (material.uniforms && material.uniforms.opacity) {
        material.uniforms.opacity.value = value;
    }
    if (material.defines && value < 0.99) {
        material.defines.USE_TRANSPARENCY = 1;
    }
    material.needsUpdate = true;
    return material;
}

function getViewerModelKey(viewer, model, urn) {
    const viewerId = viewer && (viewer.id || viewer.container?.id || 'viewer');
    const modelId = model && model.id != null ? model.id : normalizeUrnValue(urn);
    return `${viewerId}:${modelId}:${normalizeUrnValue(urn)}`;
}

function setModelMaterialOpacity(viewer, model, urn, opacity) {
    const value = Math.max(0.1, Math.min(1, Number(opacity) || 1));
    const backupKey = getMaterialBackupKey(model, urn);
    if (!materialOpacityBackup[backupKey]) materialOpacityBackup[backupKey] = {};
    const backup = materialOpacityBackup[backupKey];
    ensureModelCanUseCustomMaterials(viewer, model);
    let appliedCount = 0;

    forEachModelFragment(model, (fragId, fragList) => {
        const renderProxy = viewer && viewer.impl && typeof viewer.impl.getRenderProxy === 'function'
            ? viewer.impl.getRenderProxy(model, fragId)
            : null;
        const currentMaterial = (renderProxy && renderProxy.material) || (fragList.getMaterial && fragList.getMaterial(fragId));
        if (!currentMaterial) return;
        if (!backup[fragId]) backup[fragId] = currentMaterial;
        appliedCount++;

        const assignMaterial = (target, materialToAssign) => {
            if (!target || !materialToAssign) return;
            target.material = materialToAssign;
            target.material.needsUpdate = true;
        };

        if (value >= 0.99) {
            const originalMaterial = configureOpacityMaterial(backup[fragId], 1);
            assignMaterial(renderProxy, originalMaterial);
            assignMaterial(renderProxy && renderProxy.meshProxy, originalMaterial);
            assignMaterial(renderProxy && renderProxy.mesh, originalMaterial);
            if (typeof fragList.setMaterial === 'function') {
                fragList.setMaterial(fragId, originalMaterial);
            }
            if (fragList.fragments && Array.isArray(fragList.fragments.materials)) {
                fragList.fragments.materials[fragId] = originalMaterial;
            }
            return;
        }

        const sourceMaterial = backup[fragId] || currentMaterial;
        const material = configureOpacityMaterial(
            typeof sourceMaterial.clone === 'function' ? sourceMaterial.clone() : sourceMaterial,
            value
        );
        registerViewerMaterial(viewer, material, `aps-opacity-${model.id != null ? model.id : 'model'}-${fragId}-${Math.round(value * 100)}`);
        assignMaterial(renderProxy, material);
        assignMaterial(renderProxy && renderProxy.meshProxy, material);
        assignMaterial(renderProxy && renderProxy.mesh, material);
        if (typeof fragList.setMaterial === 'function') {
            fragList.setMaterial(fragId, material);
        }
        if (fragList.fragments && Array.isArray(fragList.fragments.materials)) {
            fragList.fragments.materials[fragId] = material;
        }
    });

    return appliedCount;
}

function scheduleOpacityReapply(viewer, urn) {
    const model = getLoadedModelByUrn(urn, viewer) || getMainViewerModelByUrn(viewer, urn);
    if (!viewer || !model || !window.Autodesk || !Autodesk.Viewing) return;
    const key = getViewerModelKey(viewer, model, urn);
    const current = pendingOpacityReapply.get(key) || { count: 0 };
    if (current.count >= 2) return;

    const run = () => {
        pendingOpacityReapply.set(key, { count: current.count + 1 });
        setTimeout(() => {
            setModelOpacity(viewer, urn, getStoredModelOpacity(urn), { skipSchedule: true });
        }, 120);
    };

    const events = [
        Autodesk.Viewing.OBJECT_TREE_CREATED_EVENT,
        Autodesk.Viewing.GEOMETRY_LOADED_EVENT
    ].filter(Boolean);

    events.forEach(eventName => {
        const handler = (event) => {
            if (event && event.model && model.id != null && event.model.id !== model.id) return;
            try { viewer.removeEventListener(eventName, handler); } catch (e) {}
            run();
        };
        try { viewer.addEventListener(eventName, handler); } catch (e) {}
    });

    setTimeout(run, 500);
}

export function setModelOpacity(viewer, urn, opacity, options = {}) {
    if (!viewer) viewer = getActiveViewer();
    const model = getLoadedModelByUrn(urn, viewer) || getMainViewerModelByUrn(viewer, urn);
    const value = Math.max(0.1, Math.min(1, Number(opacity) || 1));
    opacityState[urn] = value;
    persistOpacityState();
    if (!viewer || !model) {
        console.warn('[ModelVisibility] opacity skipped: target model not found in active viewer.', {
            urn,
            viewerModels: getViewerModels(viewer).map(m => ({
                id: m && m.id,
                dataUrn: m && m.getData && m.getData() && m.getData().urn,
                loaderUrn: m && m.loader && m.loader.svfUrn
            }))
        });
        return false;
    }

    try {
        const appliedCount = setModelMaterialOpacity(viewer, model, urn, value);
        if (!appliedCount) {
            console.warn('[ModelVisibility] opacity skipped: no editable fragments found.', { urn, modelId: model && model.id });
            return false;
        }
        if (viewer.impl && typeof viewer.impl.invalidate === 'function') {
            viewer.impl.invalidate(true, true, true);
        }
        if (viewer.impl && typeof viewer.impl.sceneUpdated === 'function') {
            viewer.impl.sceneUpdated(true);
        }
        if (!options.skipSchedule) {
            scheduleOpacityReapply(viewer, urn);
        }
        console.log('[ModelVisibility] opacity applied:', {
            urn,
            opacity: value,
            modelId: model && model.id,
            fragments: appliedCount,
            viewerModels: getViewerModels(viewer).length,
            mode: 'material'
        });
        return true;
    } catch (err) {
        console.warn('[ModelVisibility] opacity apply failed:', err.message);
        return false;
    }
}

export function applyModelRotation(viewer, urn, rotateMinus90) {
    if (!viewer) viewer = getActiveViewer();
    const model = getLoadedModelByUrn(urn, viewer) || getMainViewerModelByUrn(viewer, urn);
    if (!viewer || !model) return false;

    const transform = createPlacementTransform(rotateMinus90);
    if (!transform) {
        console.warn('[ModelVisibility] THREE namespace is not available; rotation skipped.');
        return false;
    }

    try {
        if (typeof model.setPlacementTransform === 'function') {
            model.setPlacementTransform(transform);
        } else if (model.getData && model.getData()) {
            model.getData().placementTransform = transform;
        } else {
            return false;
        }
        if (viewer.impl && typeof viewer.impl.invalidate === 'function') {
            viewer.impl.invalidate(true, true, true);
        }
        return true;
    } catch (err) {
        console.warn('[ModelVisibility] rotation apply failed:', err.message);
        return false;
    }
}

/**
 * 🔍 현재 활성화된 뷰어 타겟(메인 3D 뷰어 window.viewer 또는 CCTV 뷰어 window.cctvViewer) 반환
 */
export function getActiveViewer() {
    if (window._modelVisibilityTargetViewer) {
        return window._modelVisibilityTargetViewer;
    }
    const cctvTab = document.getElementById('tab-content-cctv');
    if (cctvTab && cctvTab.style.display !== 'none' && window.cctvViewer) {
        return window.cctvViewer;
    }
    return window.projectViewer ||
        window.myGlobalViewer ||
        window.viewer ||
        window.NOP_VIEWER ||
        window.cctvViewer;
}

// Z축 -90도 자동 회전 대상 구조물 폴더 지정 (02 신설구조물 하위 5개 시설)
const AUTO_ROTATE_TARGETS = [
    '01 착수정',
    '02 응집침전지',
    '03 급속여과지',
    '04 후오존접촉지',
    '05 활성탄흡착지',
    '착수정',
    '응집침전지',
    '급속여과지',
    '후오존접촉지',
    '활성탄흡착지'
];

function isTargetAutoRotateFolder(pathArray) {
    const pathStr = pathArray.join('/');
    return AUTO_ROTATE_TARGETS.some(target => pathStr.includes(target));
}

function autoRegisterRotationStates(node, parentPaths = []) {
    if (!node) return;
    const currentName = node.folderName || node.name || '';
    const currentPath = [...parentPaths, currentName];
    const isAutoRotate = isTargetAutoRotateFolder(currentPath);

    if (Array.isArray(node.files)) {
        node.files.forEach(file => {
            if (file && file.urn && isAutoRotate) {
                rotationState[file.urn] = true;
            }
        });
    }

    if (Array.isArray(node.children)) {
        node.children.forEach(child => autoRegisterRotationStates(child, currentPath));
    }
}

/**
 * 🌐 [Backend API] '01 Revit (<강북정수장 증설공사 BIM 용역>)' 계층형 폴더 및 파일 트리 정보 가져오기
 */
function getCurrentProjectContext() {
    const explorer = window.explorer || null;
    const hubId = window.currentHubId ||
        explorer?.currentHubId ||
        localStorage.getItem('aps_last_hub_id') ||
        '';
    const projectId = window.currentProjectId ||
        explorer?.currentProjectId ||
        localStorage.getItem('aps_last_project_id') ||
        '';
    return { hubId, projectId };
}

function buildModelTreeUrl(force = false) {
    const params = new URLSearchParams();
    const { hubId, projectId } = getCurrentProjectContext();
    if (hubId) params.set('hubId', hubId);
    if (projectId) params.set('projectId', projectId);
    if (force) params.set('force', '1');
    const query = params.toString();
    return query ? `/api/models/tree?${query}` : '/api/models/tree';
}

export async function fetchGlobalRvtModels(force = false) {
    const url = buildModelTreeUrl(force);
    const resp = await fetch(url, { credentials: 'same-origin' });
    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
        const message = data.message || `HTTP ${resp.status}`;
        throw new Error(`Autodesk Docs 모델 목록을 불러오지 못했습니다: ${message}`);
    }
    if (!data || !Array.isArray(data.children)) {
        throw new Error('Autodesk Docs 모델 목록 응답 형식이 올바르지 않습니다.');
    }

    window._globalRvtModelsCache = data;
    window._globalRvtModelsCacheKey = `${data.hubId || ''}:${data.projectId || ''}`;
    window._globalRvtModelsCacheAt = Date.now();
    autoRegisterRotationStates(data);
    return data;
}
/**
 * Popup manager for the 3D model visibility/merge panel.
 */
export async function refreshGlobalVisibilityPopup(mainUrn, fallbackItems = [], targetViewer = null) {
    const popup = document.getElementById('model-visibility-popup');
    const listEl = document.getElementById('model-visibility-list');
    if (!popup || !listEl) {
        console.warn('[ModelVisibility] popup DOM is missing.');
        return;
    }

    const isOpen = popup.style.display && popup.style.display !== 'none';
    if (isOpen) {
        popup.style.display = 'none';
        window._modelVisibilityTargetViewer = null;
        return;
    }

    window._modelVisibilityTargetViewer = targetViewer || null;
    popup.style.top = '75px';
    popup.style.left = '20px';
    popup.style.zIndex = '999999';
    popup.style.display = 'flex';
    listEl.innerHTML = '<div style="padding:12px; color:#94a3b8; font-size:12px;">Autodesk Docs 폴더 목록을 불러오는 중입니다...</div>';

    let rvtTree = null;
    try {
        const { hubId, projectId } = getCurrentProjectContext();
        const cacheKey = `${hubId || ''}:${projectId || ''}`;
        rvtTree = (window._globalRvtModelsCacheKey === cacheKey ? window._globalRvtModelsCache : null) ||
            await fetchGlobalRvtModels();
        autoRegisterRotationStates(rvtTree);
    } catch (err) {
        listEl.innerHTML = `<div style="padding:12px; color:#fca5a5; background:rgba(248,113,113,0.08); border:1px solid rgba(248,113,113,0.25); border-radius:6px; font-size:12px; line-height:1.45;"><b>Autodesk Docs 목록을 불러오지 못했습니다.</b><br>${err.message}</div>`;
        return;
    }

    listEl.innerHTML = '';
    if (Array.isArray(rvtTree.children) && rvtTree.children.length > 0) {
        rvtTree.children.forEach(subFolder => {
            const subElem = renderTreeFolderNode(subFolder, mainUrn);
            if (subElem) listEl.appendChild(subElem);
        });
    } else {
        listEl.innerHTML = '<div style="padding:12px; color:#94a3b8; font-size:12px;">표시할 Revit 모델이 없습니다.</div>';
    }
}

/**
 * 주요 공종(C 토목, A 건축, M 기계, E 전기, AM 건축설비, S 구조) 분류 및 색상
 */
export function getTradeInfo(fileName) {
    const name = (fileName || '').toUpperCase();
    // 1. 건축설비 (AM) — 우선 검사
    if (name.includes('_AM.') || name.includes('_AM_') || name.endsWith('_AM') || name.includes('건축설비')) {
        return { code: 'AM', name: '건축설비', color: '#10b981', bg: 'rgba(16, 185, 129, 0.15)', border: 'rgba(16, 185, 129, 0.5)' };
    }
    // 2. 토목 (C)
    if (name.includes('_C.') || name.includes('_C_') || name.endsWith('_C') || name.includes('토목')) {
        return { code: 'C', name: '토목', color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.15)', border: 'rgba(56, 189, 248, 0.5)' };
    }
    // 3. 건축 (A)
    if (name.includes('_A.') || name.includes('_A_') || name.endsWith('_A') || name.includes('건축')) {
        return { code: 'A', name: '건축', color: '#f87171', bg: 'rgba(248, 113, 113, 0.15)', border: 'rgba(248, 113, 113, 0.5)' };
    }
    // 4. 기계 (M)
    if (name.includes('_M.') || name.includes('_M_') || name.endsWith('_M') || name.includes('기계')) {
        return { code: 'M', name: '기계', color: '#fbbf24', bg: 'rgba(251, 191, 36, 0.15)', border: 'rgba(251, 191, 36, 0.5)' };
    }
    // 5. 전기 (E)
    if (name.includes('_E.') || name.includes('_E_') || name.endsWith('_E') || name.includes('전기')) {
        return { code: 'E', name: '전기', color: '#a78bfa', bg: 'rgba(167, 139, 250, 0.15)', border: 'rgba(167, 139, 250, 0.5)' };
    }
    // 6. 구조 (S)
    if (name.includes('_S.') || name.includes('_S_') || name.endsWith('_S') || name.includes('구조')) {
        return { code: 'S', name: '구조', color: '#34d399', bg: 'rgba(52, 211, 153, 0.15)', border: 'rgba(52, 211, 153, 0.5)' };
    }
    return { code: '공종', name: '기타', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.15)', border: 'rgba(148, 163, 184, 0.5)' };
}

/**
 * 🌐 계층형 폴더 노드 및 파일 토글 스위치 DOM 생성 함수 (재귀지원 & 폴더 토글)
 */
function renderTreeFolderNode(folderNode, mainUrn, parentFolders = []) {
    if (!folderNode) return null;
    const folderName = folderNode.folderName || folderNode.name || '폴더';
    const currentPath = [...parentFolders, folderName];
    const isAutoRotateFolder = isTargetAutoRotateFolder(currentPath);

    const details = document.createElement('details');
    details.open = true; // 기본 100% 펼침 상태
    details.setAttribute('open', '');
    details.style.cssText = 'margin-bottom: 6px;';

    const summary = document.createElement('summary');
    summary.style.cssText = 'font-size: 0.78rem; color: #38bdf8; font-weight: bold; cursor: pointer; padding: 4px 6px; background: rgba(56,189,248,0.06); border-radius: 4px; user-select: none; margin-bottom: 4px; display: flex; align-items: center; justify-content: space-between;';
    summary.innerHTML = `
        <span style="display:flex; align-items:center; gap:6px; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            <i class="fas fa-folder-open" style="color:#f59e0b; flex-shrink:0;"></i>
            <span>${folderName}</span>
        </span>
        <!-- 폴더 제어 버튼 그룹 (전체 ON/OFF 스위치) -->
        <div style="display:flex; align-items:center; gap:8px;" onclick="event.stopPropagation();">
            <label style="position:relative;display:inline-flex;align-items:center;cursor:pointer;flex-shrink:0;" title="폴더 하위 전체 ON/OFF">
                <input type="checkbox" class="folder-vis-toggle-cb" style="opacity:0;width:0;height:0;position:absolute;">
                <span class="fvt-track" style="width:28px;height:14px;background:#334155;border-radius:28px;display:block;transition:background 0.2s;position:relative;">
                    <span class="fvt-thumb" style="width:10px;height:10px;background:#fff;border-radius:50%;position:absolute;top:2px;left:2px;transition:left 0.2s;"></span>
                </span>
            </label>
        </div>
    `;
    details.appendChild(summary);

    const folderCb = summary.querySelector('.folder-vis-toggle-cb');
    const folderTrack = summary.querySelector('.fvt-track');
    const folderThumb = summary.querySelector('.fvt-thumb');

    // ⚡ 폴더 스위치 UI 갱신 헬퍼
    const syncFolderSwitchUI = (isFolderOn) => {
        folderCb.checked = isFolderOn;
        folderTrack.style.background = isFolderOn ? '#38bdf8' : '#334155';
        folderThumb.style.left = isFolderOn ? '16px' : '2px';
    };

    // ⚡ 하위 파일들의 켜짐 상태를 기반으로 폴더 스위치 자동 조절
    const updateFolderStateFromChildren = () => {
        const childFileCbs = Array.from(contentDiv.querySelectorAll('.vis-toggle-cb'));
        if (childFileCbs.length > 0) {
            const allChecked = childFileCbs.every(cb => cb.checked);
            syncFolderSwitchUI(allChecked);
        }
    };

    // ⚡ 하위 자식 노드 변경 시 이벤트 수신
    details.addEventListener('child-vis-changed', () => {
        updateFolderStateFromChildren();
    });

    // ⚡ 폴더 토글 변경 시 하위 파일 스위치들 일괄 ON/OFF 실행
    folderCb.onchange = () => {
        const isFolderOn = folderCb.checked;
        syncFolderSwitchUI(isFolderOn);

        const childCbs = contentDiv.querySelectorAll('.vis-toggle-cb');
        childCbs.forEach(cb => {
            if (cb.checked !== isFolderOn) {
                cb.checked = isFolderOn;
                cb.dispatchEvent(new Event('change'));
            }
        });
        details.dispatchEvent(new CustomEvent('child-vis-changed', { bubbles: true }));
    };

    const contentDiv = document.createElement('div');
    contentDiv.style.cssText = 'margin-left: 10px; padding-left: 8px; border-left: 1px dashed rgba(255,255,255,0.12); display: flex; flex-direction: column; gap: 4px;';

    // 1. 하위 폴더 노드 (Subfolders) 재귀 렌더링
    if (Array.isArray(folderNode.children) && folderNode.children.length > 0) {
        folderNode.children.forEach(subChild => {
            const childElem = renderTreeFolderNode(subChild, mainUrn, currentPath);
            if (childElem) contentDiv.appendChild(childElem);
        });
    }

    // URN 비교를 위한 정규화 함수
    const currentMainUrn = mainUrn || window._currentMainModelUrn || '';
    const normMainUrn = normalizeUrnValue(currentMainUrn);

    // 2. 파일 단위 노드 (Leaves) 렌더링 - 공종 뱃지 칩 포함
    if (Array.isArray(folderNode.files) && folderNode.files.length > 0) {
        folderNode.files.forEach(file => {
            const trade = getTradeInfo(file.name);
            const normFileUrn = normalizeUrnValue(file.urn);

            // 해당 파일이 회전 대상 5개 폴더 하위에 속한 경우 rotationState 자동 적용
            if (isAutoRotateFolder) {
                rotationState[file.urn] = true;
            }

            // 🎯 사용자가 직접 열고 있는 메인 모델 파일인지 판별 (오직 이 경우에만 [활성] 뱃지)
            const isMainModel = !!(normFileUrn && normMainUrn && normFileUrn === normMainUrn);
            if (isMainModel) {
                const activeViewer = getActiveViewer();
                if (activeViewer && activeViewer.model) {
                    registerLoadedModel(file.urn, activeViewer.model);
                    if (isRotationEnabled(file.urn)) {
                        applyModelRotation(activeViewer, file.urn, true);
                    }
                }
            }
            
            // 병합되어 뷰어에 이미 켜져 있는 보조 모델 판별
            const isAlreadyLoaded = !!getLoadedModelByUrn(file.urn, getActiveViewer()) ||
                Object.keys(loadedModels).some(u => normalizeUrnValue(u) === normFileUrn);
            const isCheckedOn = isMainModel || isAlreadyLoaded;
            const modelOpacity = getStoredModelOpacity(file.urn);
            const modelOpacityPct = Math.round(modelOpacity * 100);

            const row = document.createElement('div');
            row.style.cssText = `display:grid; grid-template-columns:auto minmax(120px,1fr) auto auto auto; align-items:center; gap:6px; padding:6px 8px; background:${isMainModel ? 'rgba(56, 189, 248, 0.12)' : isAlreadyLoaded ? 'rgba(56, 189, 248, 0.05)' : 'rgba(255,255,255,0.03)'}; border:1px solid ${isMainModel ? 'rgba(56, 189, 248, 0.45)' : isAlreadyLoaded ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255,255,255,0.06)'}; border-radius:5px;`;
            row.innerHTML = `
                <!-- 공종 색상 칩 뱃지 -->
                <span style="font-size:0.65rem; font-weight:800; color:${trade.color}; background:${trade.bg}; border:1px solid ${trade.border}; padding:1px 5px; border-radius:3px; flex-shrink:0; min-width:18px; text-align:center;" title="공종: ${trade.name}">
                    ${trade.code}
                </span>
                <span title="${file.name}" style="min-width:0; font-size:0.76rem; color:${isMainModel ? '#38bdf8' : '#cbd5e1'}; font-weight:${isMainModel ? 'bold' : 'normal'}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                    ${file.name}
                </span>
                <span style="font-size:0.62rem; color:#38bdf8; background:${isMainModel ? 'rgba(56,189,248,0.22)' : 'transparent'}; border:1px solid ${isMainModel ? 'rgba(56,189,248,0.6)' : 'transparent'}; padding:1px 5px; border-radius:4px; font-weight:bold; min-width:26px; text-align:center;">${isMainModel ? '활성' : ''}</span>
                <button type="button" class="model-opacity-toggle" title="모델 투명도 조절" aria-expanded="false" style="height:24px; min-width:50px; display:inline-flex; align-items:center; justify-content:center; gap:4px; border:1px solid rgba(148,163,184,0.28); border-radius:5px; background:rgba(15,23,42,0.76); color:#cbd5e1; cursor:pointer; font-size:0.66rem; font-weight:800;">
                    <i class="fas fa-adjust" style="font-size:10px;"></i>
                    <span class="model-opacity-chip">${modelOpacityPct}%</span>
                </button>
                <!-- ON / OFF 토글 스위치 -->
                <label style="position:relative;display:inline-flex;align-items:center;cursor:pointer;flex-shrink:0;">
                    <input type="checkbox" class="vis-toggle-cb" data-urn="${file.urn}" data-name="${file.name}" ${isCheckedOn ? 'checked' : ''} style="opacity:0;width:0;height:0;position:absolute;">
                    <span class="vt-track" style="width:30px;height:15px;background:${isCheckedOn ? '#38bdf8' : '#334155'};border-radius:30px;display:block;transition:background 0.2s;position:relative;">
                        <span class="vt-thumb" style="width:11px;height:11px;background:#fff;border-radius:50%;position:absolute;top:2px;left:${isCheckedOn ? '17px' : '2px'};transition:left 0.2s;"></span>
                    </span>
                </label>
                <div class="model-opacity-control" style="grid-column:1 / -1; display:none; align-items:center; gap:8px; min-width:0; padding:5px 2px 1px 30px;">
                    <span style="color:#94a3b8; font-size:0.68rem; font-weight:800; white-space:nowrap;">투명도</span>
                    <input type="range" class="model-opacity-range" data-urn="${file.urn}" min="10" max="100" step="5" value="${modelOpacityPct}" title="모델 투명도" style="flex:1; min-width:80px; accent-color:#38bdf8;">
                    <span class="model-opacity-value" style="width:34px; text-align:right; color:#cbd5e1; font-size:0.68rem; font-weight:800;">${modelOpacityPct}%</span>
                    <button type="button" class="model-opacity-reset" title="투명도 초기화" style="width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;border:1px solid rgba(148,163,184,0.28);border-radius:5px;background:rgba(15,23,42,0.76);color:#cbd5e1;cursor:pointer;"><i class="fas fa-rotate-left" style="font-size:10px;"></i></button>
                </div>
            `;
            const cb = row.querySelector('.vis-toggle-cb');
            const track = row.querySelector('.vt-track');
            const thumb = row.querySelector('.vt-thumb');
            const opacityToggle = row.querySelector('.model-opacity-toggle');
            const opacityChip = row.querySelector('.model-opacity-chip');
            const opacityPanel = row.querySelector('.model-opacity-control');
            const opacityRange = row.querySelector('.model-opacity-range');
            const opacityValue = row.querySelector('.model-opacity-value');
            const opacityReset = row.querySelector('.model-opacity-reset');

            const applyOpacityFromRange = () => {
                const value = Math.max(10, Math.min(100, Number(opacityRange.value) || 100));
                opacityValue.textContent = value + '%';
                opacityChip.textContent = value + '%';
                const targetViewer = getActiveViewer();
                setModelOpacity(targetViewer, file.urn, value / 100);
            };

            opacityToggle.onclick = (event) => {
                event.preventDefault();
                event.stopPropagation();
                const willOpen = opacityPanel.style.display === 'none';
                opacityPanel.style.display = willOpen ? 'flex' : 'none';
                opacityToggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
            };
            opacityToggle.onmousedown = event => event.stopPropagation();
            opacityRange.oninput = applyOpacityFromRange;
            opacityRange.onclick = event => event.stopPropagation();
            opacityRange.onmousedown = event => event.stopPropagation();
            opacityReset.onclick = (event) => {
                event.preventDefault();
                event.stopPropagation();
                opacityRange.value = '100';
                applyOpacityFromRange();
            };

            // ⚡ 토글 스위치 변경 시 실제 ON/OFF 제어 연결부
            cb.onchange = async () => {
                const isOn = cb.checked;
                track.style.background = isOn ? '#38bdf8' : '#334155';
                thumb.style.left = isOn ? '17px' : '2px';

                // 상위 폴더 스위치 상태 동기화 및 부모 트리로 이벤트 전파
                updateFolderStateFromChildren();
                details.dispatchEvent(new CustomEvent('child-vis-changed', { bubbles: true }));

                const targetViewer = getActiveViewer();
                if (!targetViewer) {
                    console.warn('[ModelVisibility] 활성화된 Autodesk Viewer 객체를 찾을 수 없습니다.');
                    alert('3D Viewer가 아직 초기화되지 않았습니다.');
                    return;
                }

                if (isOn) {
                    const model = await appendModelToViewer(targetViewer, file.urn, file.name);
                    if (model) {
                        setModelOpacity(targetViewer, file.urn, getStoredModelOpacity(file.urn));
                    }
                } else {
                    setModelVisibility(targetViewer, file.urn, false);
                }
            };
            contentDiv.appendChild(row);
        });
    }

    details.appendChild(contentDiv);

    // 초기 렌더링 완료 후 하위 파일 켜짐 상태에 따라 폴더 스위치 초기 상태 자동 동기화
    setTimeout(() => {
        updateFolderStateFromChildren();
    }, 0);

    return details;
}

/**
 * ON ??: ??? ??? ??? ?? ????? ?? ????.
 */
export async function appendModelToViewer(viewer, urn, name) {
    if (!viewer) viewer = getActiveViewer();
    if (!viewer || !urn) return null;
    const normalizedUrn = urn.startsWith('urn:') ? urn : 'urn:' + urn;

    // ?? ??? ??? ?? ???? ?? ??? ? ?? ???? ????.
    const cachedModel = getLoadedModelByUrn(urn, viewer) || getMainViewerModelByUrn(viewer, urn);
    if (cachedModel) {
        try {
            viewer.showModel(cachedModel.id);
            applyModelRotation(viewer, urn, isRotationEnabled(urn));
            setModelOpacity(viewer, urn, getStoredModelOpacity(urn));
            console.log(`[Viewer ON] ?? ?? (?? ??): ${name}`);
        } catch (e) {
            console.warn('[Viewer ON Error]', e);
        }
        return cachedModel;
    }

    // ?? ?? ?? ???? ?? ?? ???? ?? ???? ????.
    if (viewer.model && (urn.includes(viewer.model.loader?.svfUrn) || urn === window._currentMainModelUrn)) {
        try {
            viewer.showModel(viewer.model.id);
            registerLoadedModel(urn, viewer.model);
            applyModelRotation(viewer, urn, isRotationEnabled(urn));
            setModelOpacity(viewer, urn, getStoredModelOpacity(urn));
            return viewer.model;
        } catch (e) {}
    }

    // ?? ?? ??? ?? ???? loadOptions.placementTransform? ?? ?? ????.
    return new Promise((resolve, reject) => {
        const globalOffset = (viewer.model && viewer.model.getData && viewer.model.getData().globalOffset)
            ? viewer.model.getData().globalOffset
            : { x: 0, y: 0, z: 0 };

        const loadOptions = {
            keepCurrentModels: true,
            preserveView: true,
            globalOffset: globalOffset,
            skipHiddenFragments: false,
            useConsolidation: false
        };

        const placementTransform = createPlacementTransform(isRotationEnabled(urn));
        if (placementTransform) {
            loadOptions.placementTransform = placementTransform;
        }

        Autodesk.Viewing.Document.load(normalizedUrn, (doc) => {
            const geometry = doc.getRoot().getDefaultGeometry();
            viewer.loadDocumentNode(doc, geometry, loadOptions).then(model => {
                registerLoadedModel(urn, model);
                applyModelRotation(viewer, urn, isRotationEnabled(urn));
                setModelOpacity(viewer, urn, getStoredModelOpacity(urn));
                console.log(`[Viewer ON] ??? ?? ?? ?? ??: ${name}`);
                resolve(model);
            }).catch(reject);
        }, reject);
    });
}

/**
 * ??/?? [ON/OFF ??] ?? ???? ?? ?? ??(showModel) / ???(hideModel)
 */
export function setModelVisibility(viewer, urn, visible) {
    if (!viewer) viewer = getActiveViewer();
    if (!viewer) return;

    // 1. loadedModels (병합 로드된 보조 모델) 딕셔너리에서 찾아 제어
    let foundModel = getLoadedModelByUrn(urn, viewer);

    if (foundModel) {
        try {
            if (visible) {
                viewer.showModel(foundModel.id);
                setModelOpacity(viewer, urn, getStoredModelOpacity(urn));
                console.log(`[Viewer ON] showModel (Secondary): ${urn}`);
            } else {
                viewer.hideModel(foundModel.id);
                console.log(`[Viewer OFF] hideModel (Secondary): ${urn}`);
            }
        } catch (e) {
            console.warn('[ModelVisibility] Secondary model visibility error:', e.message);
        }
        return;
    }

    // 2. 메인 모델(viewer.model) 제어
    try {
        const mainModel = getMainViewerModelByUrn(viewer, urn);
        if (mainModel) {
            if (visible) {
                viewer.showModel(mainModel.id);
                setModelOpacity(viewer, urn, getStoredModelOpacity(urn));
                console.log(`[Viewer ON] showModel (Main): ${urn}`);
            } else {
                viewer.hideModel(mainModel.id);
                console.log(`[Viewer OFF] hideModel (Main): ${urn}`);
            }
        }
    } catch (err) {
        console.warn('[ModelVisibility] Viewer main model toggle error:', err.message);
    }
}

/**
 * 🔒 [Popup Close Helper] 3D 모델 가시성/병합 팝업창 닫기
 */
export function closeModelVisibilityPopup() {
    const popup = document.getElementById('model-visibility-popup');
    if (popup) {
        popup.style.display = 'none';
    }
    window._modelVisibilityTargetViewer = null;
}

/**
 * 🧹 [Visibility Reset] 다른 모델로 이동/열기 시 기존 병합 모델 숨김 및 가시성 캐시 상태 초기화
 */
export function resetVisibilityState(viewer) {
    if (!viewer) viewer = getActiveViewer();
    
    // 1. 기존 병합 로드되었던 보조 모델들 전부 hide/unload
    Object.keys(loadedModels).forEach(urn => {
        try {
            const model = loadedModels[urn];
            if (model && viewer) {
                if (typeof viewer.hideModel === 'function' && model.id != null) {
                    viewer.hideModel(model.id);
                } else if (typeof viewer.unloadModel === 'function') {
                    viewer.unloadModel(model);
                }
            }
        } catch (e) {
            console.warn('[ModelVisibility] Reset model warning:', e.message);
        }
        delete loadedModels[urn];
    });

    // 2. 모델을 끄거나 초기화 시 팝업창 자동 닫기 및 아이콘 숨김
    closeModelVisibilityPopup();
    const mainControls = document.getElementById('main-viewer-controls');
    if (mainControls) mainControls.style.display = 'none';
    console.log('[ModelVisibility] 다른 모델로 이동함에 따라 기존 가시성 병합 상태가 완전 초기화되었습니다.');
}

/**
 * 🌐 [Popup Event Initializer] 팝업 닫기 및 버튼 이벤트 바인딩
 */
export function initModelVisibilityPopupEvents() {
    const popup = document.getElementById('model-visibility-popup');
    const btnClose = document.getElementById('btn-close-model-visibility');
    const btnAllOn = document.getElementById('btn-visibility-all-on');
    const btnAllOff = document.getElementById('btn-visibility-all-off');
    const btnMainFloating = document.getElementById('btn-main-floating-visibility');
    const btnCctvFloating = document.getElementById('btn-cctv-model-visibility');

    if (btnMainFloating) {
        btnMainFloating.onclick = (e) => {
            if (e) { e.preventDefault(); e.stopPropagation(); }
            refreshGlobalVisibilityPopup();
        };
    }
    if (btnCctvFloating) {
        btnCctvFloating.onclick = (e) => {
            if (e) { e.preventDefault(); e.stopPropagation(); }
            refreshGlobalVisibilityPopup();
        };
    }

    if (btnClose && popup) {
        btnClose.addEventListener('click', () => {
            closeModelVisibilityPopup();
        });
    }

    if (btnAllOn) {
        btnAllOn.addEventListener('click', () => {
            const cbs = document.querySelectorAll('#model-visibility-list .vis-toggle-cb');
            cbs.forEach(cb => {
                if (!cb.checked) {
                    cb.checked = true;
                    cb.dispatchEvent(new Event('change'));
                }
            });
        });
    }

    if (btnAllOff) {
        btnAllOff.addEventListener('click', () => {
            const cbs = document.querySelectorAll('#model-visibility-list .vis-toggle-cb');
            cbs.forEach(cb => {
                if (cb.checked) {
                    cb.checked = false;
                    cb.dispatchEvent(new Event('change'));
                }
            });
            // 🎯 전체 모델 OFF 시 팝업창 자동 닫기
            closeModelVisibilityPopup();
        });
    }

    // 📌 드래그 기능 구현 (Drag and Drop floating panel)
    const header = document.getElementById('model-visibility-header');
    if (popup && header) {
        let isDragging = false;
        let startX = 0, startY = 0;
        let initialLeft = 0, initialTop = 0;

        header.addEventListener('mousedown', (e) => {
            if (e.target.closest('#btn-close-model-visibility')) return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            const rect = popup.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;

            document.body.style.userSelect = 'none';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            popup.style.left = `${Math.max(10, initialLeft + dx)}px`;
            popup.style.top = `${Math.max(10, initialTop + dy)}px`;
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                document.body.style.userSelect = '';
            }
        });
    }
}

// 전역 브라우저 객체(window) 노출 및 자동 이벤트 바인딩
if (typeof window !== 'undefined') {
    window.refreshGlobalVisibilityPopup = refreshGlobalVisibilityPopup;
    window.appendModelToViewer = appendModelToViewer;
    window.setModelVisibility = setModelVisibility;
    window.getActiveViewer = getActiveViewer;
    window.loadedModels = loadedModels;
    window.rotationState = rotationState;
    window.opacityState = opacityState;
    window.resetVisibilityState = resetVisibilityState;
    window.closeModelVisibilityPopup = closeModelVisibilityPopup;
    window.applyModelRotation = applyModelRotation;
    window.setModelOpacity = setModelOpacity;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initModelVisibilityPopupEvents();
            fetchGlobalRvtModels().catch(err => console.warn('[ModelVisibility] preload skipped:', err.message));
        });
    } else {
        initModelVisibilityPopupEvents();
        fetchGlobalRvtModels().catch(err => console.warn('[ModelVisibility] preload skipped:', err.message));
    }
}
