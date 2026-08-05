/* ==========================================================================
   model-visibility.js — 3D 모델 가시성 조절 & 계층형 병합 로드 팝업 모듈
   ========================================================================== */

// 현재 뷰어에 로드된 모델 객체들을 추적 관리하는 전역 딕셔너리
export const loadedModels = {};
export const rotationState = {};

function normalizeUrnValue(value) {
    return value ? String(value).replace(/^urn:/, '').replace(/=/g, '').trim() : '';
}

function getThreeNamespace() {
    return window.THREE || (window.Autodesk && Autodesk.Viewing && Autodesk.Viewing.Private && Autodesk.Viewing.Private.THREE) || null;
}

function getLoadedModelByUrn(urn) {
    const normTarget = normalizeUrnValue(urn);
    if (loadedModels[urn]) return loadedModels[urn];
    const key = Object.keys(loadedModels).find(k => normalizeUrnValue(k) === normTarget);
    return key ? loadedModels[key] : null;
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

export function applyModelRotation(viewer, urn, rotateMinus90) {
    if (!viewer) viewer = getActiveViewer();
    const model = getLoadedModelByUrn(urn) || getMainViewerModelByUrn(viewer, urn);
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
    return window.viewer || window.cctvViewer;
}

/**
 * 🌐 [Backend API] '01 Revit (<강북정수장 증설공사 BIM 용역>)' 계층형 폴더 및 파일 트리 정보 가져오기
 */
export async function fetchGlobalRvtModels(force = false) {
    const url = force ? '/api/models/tree?force=1' : '/api/models/tree';
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
    window._globalRvtModelsCacheAt = Date.now();
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
    listEl.innerHTML = '<div style="padding:12px; color:#94a3b8; font-size:12px;">Autodesk Docs ?? ??? ???? ????.</div>';

    let rvtTree = null;
    try {
        rvtTree = window._globalRvtModelsCache || await fetchGlobalRvtModels();
    } catch (err) {
        listEl.innerHTML = `<div style="padding:12px; color:#fca5a5; background:rgba(248,113,113,0.08); border:1px solid rgba(248,113,113,0.25); border-radius:6px; font-size:12px; line-height:1.45;"><b>?? Autodesk Docs ?? ??? ???? ?????.</b><br>${err.message}</div>`;
        return;
    }

    listEl.innerHTML = '';
    if (Array.isArray(rvtTree.children) && rvtTree.children.length > 0) {
        rvtTree.children.forEach(subFolder => {
            const subElem = renderTreeFolderNode(subFolder, mainUrn);
            if (subElem) listEl.appendChild(subElem);
        });
    } else {
        listEl.innerHTML = '<div style="padding:12px; color:#94a3b8; font-size:12px;">??? Revit ??? ????.</div>';
    }
}

/**
 * ?? ???(C ??, A ??, M ??, E ??, AM ????, S ??) ?? ? ??
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
function renderTreeFolderNode(folderNode, mainUrn) {
    if (!folderNode) return null;
    const details = document.createElement('details');
    details.open = true; // 기본 100% 펼침 상태
    details.setAttribute('open', '');
    details.style.cssText = 'margin-bottom: 6px;';

    const summary = document.createElement('summary');
    summary.style.cssText = 'font-size: 0.78rem; color: #38bdf8; font-weight: bold; cursor: pointer; padding: 4px 6px; background: rgba(56,189,248,0.06); border-radius: 4px; user-select: none; margin-bottom: 4px; display: flex; align-items: center; justify-content: space-between;';
    summary.innerHTML = `
        <span style="display:flex; align-items:center; gap:6px; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            <i class="fas fa-folder-open" style="color:#f59e0b; flex-shrink:0;"></i>
            <span>${folderNode.folderName || folderNode.name || '폴더'}</span>
        </span>
        <!-- 폴더 제어 버튼 그룹 (-90도 전체 회전 & 전체 ON/OFF 스위치) -->
        <div style="display:flex; align-items:center; gap:8px;" onclick="event.stopPropagation();">
            <label style="display:inline-flex; align-items:center; gap:3px; font-size:0.68rem; color:#94a3b8; cursor:pointer;" title="폴더 하위 전체 Z축 -90도 회전 일괄 적용">
                <input type="checkbox" class="folder-rotate-cb" style="accent-color:#38bdf8; cursor:pointer; width:11px; height:11px;"> -90°
            </label>
            <label style="position:relative;display:inline-flex;align-items:center;cursor:pointer;flex-shrink:0;" title="폴더 하위 전체 ON/OFF">
                <input type="checkbox" class="folder-vis-toggle-cb" style="opacity:0;width:0;height:0;position:absolute;">
                <span class="fvt-track" style="width:28px;height:14px;background:#334155;border-radius:28px;display:block;transition:background 0.2s;position:relative;">
                    <span class="fvt-thumb" style="width:10px;height:10px;background:#fff;border-radius:50%;position:absolute;top:2px;left:2px;transition:left 0.2s;"></span>
                </span>
            </label>
        </div>
    `;
    details.appendChild(summary);

    const folderRotateCb = summary.querySelector('.folder-rotate-cb');
    const folderCb = summary.querySelector('.folder-vis-toggle-cb');
    const folderTrack = summary.querySelector('.fvt-track');
    const folderThumb = summary.querySelector('.fvt-thumb');

    // ⚡ 폴더 하위 일괄 -90도 회전 체크박스 이벤트
    if (folderRotateCb) {
        folderRotateCb.onchange = () => {
            const isRotateOn = folderRotateCb.checked;
            const childRotateCbs = details.querySelectorAll('.rotate-cb');
            childRotateCbs.forEach(cb => {
                cb.checked = isRotateOn;
                cb.dispatchEvent(new Event('change'));
            });
        };
    }

    // ⚡ 폴더 토글 변경 시 하위 파일 스위치들 일괄 ON/OFF 실행
    folderCb.onchange = () => {
        const isFolderOn = folderCb.checked;
        folderTrack.style.background = isFolderOn ? '#38bdf8' : '#334155';
        folderThumb.style.left = isFolderOn ? '16px' : '2px';

        const childCbs = details.querySelectorAll('.vis-toggle-cb');
        childCbs.forEach(cb => {
            if (cb.checked !== isFolderOn) {
                cb.checked = isFolderOn;
                cb.dispatchEvent(new Event('change'));
            }
        });
    };

    const contentDiv = document.createElement('div');
    contentDiv.style.cssText = 'margin-left: 10px; padding-left: 8px; border-left: 1px dashed rgba(255,255,255,0.12); display: flex; flex-direction: column; gap: 4px;';

    // 1. 하위 폴더 노드 (Subfolders) 재귀 렌더링
    if (Array.isArray(folderNode.children) && folderNode.children.length > 0) {
        folderNode.children.forEach(subChild => {
            const childElem = renderTreeFolderNode(subChild, mainUrn);
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

            // 🎯 사용자가 직접 열고 있는 메인 모델 파일인지 판별 (오직 이 경우에만 [활성] 뱃지)
            const isMainModel = !!(normFileUrn && normMainUrn && normFileUrn === normMainUrn);
            if (isMainModel) {
                const activeViewer = getActiveViewer();
                if (activeViewer && activeViewer.model) {
                    loadedModels[file.urn] = activeViewer.model;
                }
            }
            
            // 병합되어 뷰어에 이미 켜져 있는 보조 모델 판별
            const isAlreadyLoaded = !!loadedModels[file.urn] || Object.keys(loadedModels).some(u => normalizeUrnValue(u) === normFileUrn);
            const isCheckedOn = isMainModel || isAlreadyLoaded;

            const row = document.createElement('div');
            row.style.cssText = `display:flex; align-items:center; gap:6px; padding:4px 8px; background:${isMainModel ? 'rgba(56, 189, 248, 0.12)' : isAlreadyLoaded ? 'rgba(56, 189, 248, 0.05)' : 'rgba(255,255,255,0.03)'}; border:1px solid ${isMainModel ? 'rgba(56, 189, 248, 0.45)' : isAlreadyLoaded ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255,255,255,0.06)'}; border-radius:5px;`;
            row.innerHTML = `
                <!-- 공종 색상 칩 뱃지 -->
                <span style="font-size:0.65rem; font-weight:800; color:${trade.color}; background:${trade.bg}; border:1px solid ${trade.border}; padding:1px 5px; border-radius:3px; flex-shrink:0; min-width:18px; text-align:center;" title="공종: ${trade.name}">
                    ${trade.code}
                </span>
                <span title="${file.name}" style="flex:1; font-size:0.76rem; color:${isMainModel ? '#38bdf8' : '#cbd5e1'}; font-weight:${isMainModel ? 'bold' : 'normal'}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                    ${file.name}
                </span>
                ${isMainModel ? '<span style="font-size:0.62rem; color:#38bdf8; background:rgba(56,189,248,0.22); border:1px solid rgba(56,189,248,0.6); padding:1px 5px; border-radius:4px; font-weight:bold; flex-shrink:0;">활성</span>' : ''}
                <!-- -90° 회전 옵션 체크박스 -->
                <label style="display:inline-flex; align-items:center; gap:3px; font-size:0.68rem; color:#94a3b8; cursor:pointer;" title="Z축 -90도 회전 주입">
                    <input type="checkbox" class="rotate-cb" data-urn="${file.urn}" style="accent-color:#38bdf8; cursor:pointer; width:11px; height:11px;"> -90°
                </label>
                <!-- ON / OFF 토글 스위치 -->
                <label style="position:relative;display:inline-flex;align-items:center;cursor:pointer;flex-shrink:0;">
                    <input type="checkbox" class="vis-toggle-cb" data-urn="${file.urn}" data-name="${file.name}" ${isCheckedOn ? 'checked' : ''} style="opacity:0;width:0;height:0;position:absolute;">
                    <span class="vt-track" style="width:30px;height:15px;background:${isCheckedOn ? '#38bdf8' : '#334155'};border-radius:30px;display:block;transition:background 0.2s;position:relative;">
                        <span class="vt-thumb" style="width:11px;height:11px;background:#fff;border-radius:50%;position:absolute;top:2px;left:${isCheckedOn ? '17px' : '2px'};transition:left 0.2s;"></span>
                    </span>
                </label>
            `;
            const cb = row.querySelector('.vis-toggle-cb');
            const rotateCb = row.querySelector('.rotate-cb');
            const track = row.querySelector('.vt-track');
            const thumb = row.querySelector('.vt-thumb');

            if (rotateCb) {
                rotateCb.checked = isRotationEnabled(file.urn);
                rotateCb.onchange = () => {
                    rotationState[file.urn] = rotateCb.checked;
                    const targetViewer = getActiveViewer();
                    const applied = applyModelRotation(targetViewer, file.urn, rotateCb.checked);
                    if (!applied && (getLoadedModelByUrn(file.urn) || getMainViewerModelByUrn(targetViewer, file.urn))) {
                        console.warn('[ModelVisibility] model exists, but rotation could not be applied:', file.name);
                    }
                };
            }

            // ⚡ 토글 스위치 변경 시 실제 ON/OFF 제어 연결부
            cb.onchange = async () => {
                const isOn = cb.checked;
                track.style.background = isOn ? '#38bdf8' : '#334155';
                thumb.style.left = isOn ? '17px' : '2px';

                const targetViewer = getActiveViewer();
                if (!targetViewer) {
                    console.warn('[ModelVisibility] 활성화된 Autodesk Viewer 객체를 찾을 수 없습니다.');
                    alert('3D Viewer가 아직 초기화되지 않았습니다.');
                    return;
                }

                if (isOn) {
                    await appendModelToViewer(targetViewer, file.urn, file.name);
                } else {
                    setModelVisibility(targetViewer, file.urn, false);
                }
            };
            contentDiv.appendChild(row);
        });
    }

    details.appendChild(contentDiv);
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
    const cachedModel = getLoadedModelByUrn(urn) || getMainViewerModelByUrn(viewer, urn);
    if (cachedModel) {
        try {
            viewer.showModel(cachedModel.id);
            applyModelRotation(viewer, urn, isRotationEnabled(urn));
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
            loadedModels[urn] = viewer.model;
            applyModelRotation(viewer, urn, isRotationEnabled(urn));
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
            globalOffset: globalOffset
        };

        const placementTransform = createPlacementTransform(isRotationEnabled(urn));
        if (placementTransform) {
            loadOptions.placementTransform = placementTransform;
        }

        Autodesk.Viewing.Document.load(normalizedUrn, (doc) => {
            const geometry = doc.getRoot().getDefaultGeometry();
            viewer.loadDocumentNode(doc, geometry, loadOptions).then(model => {
                loadedModels[urn] = model;
                applyModelRotation(viewer, urn, isRotationEnabled(urn));
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

    const normTargetUrn = normalizeUrnValue(urn);

    // 1. loadedModels (병합 로드된 보조 모델) 딕셔너리에서 찾아 제어
    let foundModel = loadedModels[urn];
    if (!foundModel) {
        const matchingKey = Object.keys(loadedModels).find(k => normalizeUrnValue(k) === normTargetUrn);
        if (matchingKey) foundModel = loadedModels[matchingKey];
    }

    if (foundModel) {
        try {
            if (visible) {
                viewer.showModel(foundModel.id);
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
        if (viewer.model) {
            if (visible) {
                viewer.showModel(viewer.model.id);
                console.log(`[Viewer ON] showModel (Main): ${urn}`);
            } else {
                viewer.hideModel(viewer.model.id);
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
    window.resetVisibilityState = resetVisibilityState;
    window.closeModelVisibilityPopup = closeModelVisibilityPopup;
    window.applyModelRotation = applyModelRotation;

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
