window.compressImg = function(base64, callback) {
    if (!base64 || typeof base64 !== 'string' || base64.indexOf('data:image') !== 0) {
        if (callback) callback(base64);
        return;
    }
    var img = new Image();
    img.onload = function() {
        try {
            var canvas = document.createElement('canvas');
            var ctx = canvas.getContext('2d');
            var maxW = 1920;
            var width = img.width;
            var height = img.height;
            if (width > maxW) {
                height = Math.round((height * maxW) / width);
                width = maxW;
            }
            canvas.width = width;
            canvas.height = height;
            if (ctx) {
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.fillStyle = "#FFFFFF";
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(img, 0, 0, width, height);
                var compressed = canvas.toDataURL('image/webp', 0.9);
                if (!compressed || compressed.indexOf('data:image/webp') === -1) {
                    compressed = canvas.toDataURL('image/jpeg', 0.9);
                }
                if (callback) callback(compressed);
            } else {
                if (callback) callback(base64);
            }
        } catch(e) {
            if (callback) callback(base64);
        }
    };
    img.onerror = function() {
        if (callback) callback(base64);
    };
    img.src = base64;
};

import { initViewer, loadModel } from './viewer.js';

(function() {
    console.log("[Anti-Dummy Guard] 버전 비교 데이터 검증 및 유령 더미 원천 차단 세션 가동.");

    // 🚨 1) 로컬 스토리지 데이터 상태를 엄격히 점검
    var rawCompare = localStorage.getItem('my_saved_compare_issues');
    
    // 만약 사용자가 '삭제' 버튼을 눌러 창고가 비어있거나(null), 완전히 초기화된 상태라면
    if (rawCompare === null || rawCompare === undefined || rawCompare.trim() === '[]') {
        console.log("[Anti-Dummy Guard] 창고가 깨끗하게 비어있습니다. 빈 배열([])로 강제 고정합니다.");
        
        // 라이브러리가 내부에 숨겨둔 하드코딩 샘플 데이터 배열을 무력화하기 위해 빈 값 강제 주입
        localStorage.setItem('my_saved_compare_issues', '[]');
        
        window.currentIssueList = [];
        if (typeof window.compareIssues !== 'undefined') window.compareIssues = [];
        if (typeof window.currentCompareIssues !== 'undefined') window.currentCompareIssues = [];
    } else {
        // 데이터가 존재할 때는 온전하게 파싱하여 전달
        try {
            var parsed = JSON.parse(rawCompare);
            if (Array.isArray(parsed)) {
                window.currentIssueList = parsed;
                if (typeof window.compareIssues !== 'undefined') window.compareIssues = parsed;
                if (typeof window.currentCompareIssues !== 'undefined') window.currentCompareIssues = parsed;
            }
        } catch(e) {
            localStorage.setItem('my_saved_compare_issues', '[]');
        }
    }

    // 🚨 2) 라이브러리가 비동기 타이머나 Forge 뷰어 로드 이벤트로 더미를 재주입하는 행위를 상시 감시 및 차단
    var originalGetItem = localStorage.getItem;
    localStorage.getItem = function(key) {
        var val = originalGetItem.apply(this, arguments);
        if (key === 'my_saved_compare_issues') {
            if (!val || val.trim() === '[]') {
                return '[]'; // 다른 스크립트가 더미를 채워 넣으려고 발악해도 무조건 순수 빈 배열 리턴
            }
        }
        return val;
    };
})();

// 🚨 과거 유령 데이터(blob URL) 자동 삭제 클렌징 로직
(function cleanUpOldBlobIssues() {
    try {
        var issues = JSON.parse(localStorage.getItem('aps_project_issues') || '[]');
        
        // blob: 으로 시작하는 이미지를 가진 이슈는 필터링(제외)
        var cleanedIssues = issues.filter(function(issue) {
            var isBeforeBlob = issue.imgBefore && issue.imgBefore.indexOf('blob:') === 0;
            var isAfterBlob = issue.imgAfter && issue.imgAfter.indexOf('blob:') === 0;
            return !isBeforeBlob && !isAfterBlob; // 둘 다 blob이 아닐 때만 유지
        });

        // 삭제된 데이터가 존재한다면 로컬 스토리지 업데이트 및 목록 재렌더링
        if (issues.length !== cleanedIssues.length) {
            localStorage.setItem('aps_project_issues', JSON.stringify(cleanedIssues));
            console.log("자동 클렌징: " + (issues.length - cleanedIssues.length) + "개의 유령 이슈 데이터가 삭제되었습니다.");
            
            // UI가 이미 그려진 상태일 수 있으므로 목록 렌더링 함수 재호출
            setTimeout(function() {
                if (typeof window.renderIssueList === 'function') window.renderIssueList();
            }, 100);
        }
    } catch (err) {
        console.error("이슈 클렌징 중 오류 발생:", err);
    }
})();

let viewers = []; // [viewers[0]: Old/Left, viewers[1]: New/Right]

let currentDiffData = null;
let isSyncing = false;
let rAF = null;

// Revit elements to exclude from diff (centerlines, axes, separators, etc.)
const REVIT_EXCLUDE_KEYWORDS = [
    'centerline', 'center line', 'centre line',
    '<room separation>', '<area boundary>', '<stair path>',
    'grid', 'level', 'scopebox', 'scope box'
];

let COLORS = { added: null, removed: null, changed: null, ghost: null };

function initColors() {
    if (typeof THREE !== 'undefined' && !COLORS.added) {
        COLORS.added = new THREE.Vector4(0, 1, 0, 0.7);      // Green
        COLORS.removed = new THREE.Vector4(1, 0, 0, 0.7);    // Red
        COLORS.changed = new THREE.Vector4(1, 1, 0, 0.7);    // Yellow
        COLORS.ghost = new THREE.Vector4(0.5, 0.5, 0.5, 0.1); // Subtle Transparent Grey
    }
}

function isCenterlineObject(data) {
    const name = (data.name || '').toLowerCase();
    const cat = (data.category || '').toLowerCase();
    return REVIT_EXCLUDE_KEYWORDS.some(kw => name.includes(kw) || cat.includes(kw));
}

// ── Camera Sync ─────────────────────────────────────────────────────────────
window.isCameraSyncing = false;

function syncCamerasDirect(sourceViewer, targetViewer) {
    if (window.isCameraSyncing) return;
    window.isCameraSyncing = true;

    var sourceNav = sourceViewer.navigation;
    var targetNav = targetViewer.navigation;

    // 1. 애니메이션 없이 수학적 좌표 및 타겟 즉시 복사
    targetNav.setPosition(sourceNav.getPosition());
    targetNav.setTarget(sourceNav.getTarget());
    targetNav.setCameraUpVector(sourceNav.getCameraUpVector());
    
    if (sourceNav.getFov) { 
        targetNav.setFov(sourceNav.getFov()); 
    }

    // 2. 뷰어 화면 즉시 강제 렌더링 (애니메이션 스킵)
    targetViewer.impl.invalidate(true, true, true);

    // 3. 콜스택이 완전히 비워진 후 락(Lock) 해제
    setTimeout(function() {
        window.isCameraSyncing = false;
    }, 0);
}

export function initCameraSync(vA, vB) {
    if (!vA || !vB) return;
    cleanupCameraSync(vA, vB);

    vA._syncFunc = function() { syncCamerasDirect(vA, vB); };
    vB._syncFunc = function() { syncCamerasDirect(vB, vA); };

    vA.addEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, vA._syncFunc);
    vB.addEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, vB._syncFunc);
}

export function cleanupCameraSync(vA, vB) {
    [vA, vB].forEach(v => {
        if (!v) return;
        if (v._syncFunc) {
            v.removeEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, v._syncFunc);
            v._syncFunc = null;
        }
    });
    window.isCameraSyncing = false;
}

// ── Split Viewers Initialization & Disposal ──────────────────────────────────
function disposeSplitViewers() {
    const oldViewers = [
        ...(Array.isArray(viewers) ? viewers : []),
        window.leftViewer,
        window.rightViewer
    ].filter(Boolean);

    oldViewers.forEach(v => {
        try {
            if (typeof v.finish === 'function') v.finish();
        } catch (e) {
            console.warn('[Viewer] finish skipped:', e.message);
        }
    });

    viewers = [];
    window.leftViewer = null;
    window.rightViewer = null;

    // Completely remove and recreate containers to prevent WebGL context leaks / Feedback loop
    const wrapper = document.getElementById('viewer-split-wrapper');
    if (wrapper) {
        const leftEl = document.getElementById('viewer-left') || document.getElementById('left-viewer-div');
        const rightEl = document.getElementById('viewer-right') || document.getElementById('right-viewer-div');

        if (leftEl) leftEl.remove();
        if (rightEl) rightEl.remove();

        const newLeft = document.createElement('div');
        newLeft.id = 'viewer-left';
        newLeft.style.cssText = 'flex: 1; width: 50%; height: 100%; position: relative; overflow: hidden; border-right: 2px solid var(--border-color); box-sizing: border-box;';
        newLeft.innerHTML = `<span id="viewer-label-before" style="position: absolute; top: 20px; left: 50%; transform: translateX(-50%); z-index: 100; pointer-events: none; background: rgba(0, 0, 0, 0.6); color: #fff; padding: 6px 16px; border-radius: 20px; font-weight: bold; font-size: 14px; white-space: nowrap; border: 1px solid rgba(255,255,255,0.15);">이전 버전</span>`;

        const newRight = document.createElement('div');
        newRight.id = 'viewer-right';
        newRight.style.cssText = 'flex: 1; width: 50%; height: 100%; position: relative; overflow: hidden; box-sizing: border-box;';
        newRight.innerHTML = `<span id="viewer-label-after" style="position: absolute; top: 20px; left: 50%; transform: translateX(-50%); z-index: 100; pointer-events: none; background: rgba(0, 0, 0, 0.6); color: #fff; padding: 6px 16px; border-radius: 20px; font-weight: bold; font-size: 14px; white-space: nowrap; border: 1px solid rgba(255,255,255,0.15);">현재 버전</span>`;

        wrapper.appendChild(newLeft);
        wrapper.appendChild(newRight);
        console.log('[Viewer] split viewer containers destroyed and recreated');
    } else {
        const leftContainer =
            document.getElementById('left-viewer-div') ||
            document.getElementById('viewer-left');

        const rightContainer =
            document.getElementById('right-viewer-div') ||
            document.getElementById('viewer-right');

        if (leftContainer) leftContainer.innerHTML = '';
        if (rightContainer) rightContainer.innerHTML = '';
    }

    console.log('[Viewer] split viewers disposed');
}

async function waitForViewerImpl(viewer) {
    if (!viewer) return;
    for (let i = 0; i < 50; i++) {
        if (viewer.impl) return;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}

export async function initSplitViewers() {
    // 🚨 뷰어 초기화 전 DOM 강제 표시 로직 주입 (clientWidth 0 방지)
    document.body.classList.add('comparison-active');
    const compContainer = document.getElementById('comparison-container');
    if (compContainer) {
        compContainer.style.display = 'flex';
        compContainer.classList.add('active');
    }
    const compBar = document.getElementById('comparison-bar');
    if (compBar) {
        compBar.style.display = 'flex';
        compBar.classList.add('active');
    }
    const compPanel = document.getElementById('comparison-panel');
    if (compPanel) {
        compPanel.style.display = 'flex';
        compPanel.classList.add('active');
    }
    const previewEl = document.getElementById('preview');
    if (previewEl) {
        previewEl.style.display = 'none';
    }

    if (window.leftViewer) { try { window.leftViewer.finish(); } catch(e){} window.leftViewer = null; }
    if (window.rightViewer) { try { window.rightViewer.finish(); } catch(e){} window.rightViewer = null; }

    // 🚨 Split 모드 시 Overlay 숨김 처리 및 Split Wrapper 노출
    const viewerOverlay = document.getElementById('viewer-overlay');
    if (viewerOverlay) {
        viewerOverlay.style.setProperty('display', 'none', 'important');
    }
    const splitWrapper = document.getElementById('viewer-split-wrapper');
    if (splitWrapper) {
        splitWrapper.style.display = 'flex';
        splitWrapper.style.flex = '1';
        splitWrapper.style.height = '100%';
    }

    const leftParent = document.getElementById('viewer-left');
    if (leftParent) {
        const oldLeft = document.getElementById('left-viewer-div');
        if (oldLeft) oldLeft.remove(); // 기존 캔버스 완전 삭제
        const newLeft = document.createElement('div');
        newLeft.id = 'left-viewer-div';
        newLeft.style.cssText = 'width: 100%; height: 100%; position: relative;';
        leftParent.appendChild(newLeft);
    }

    const rightParent = document.getElementById('viewer-right');
    if (rightParent) {
        const oldRight = document.getElementById('right-viewer-div');
        if (oldRight) oldRight.remove(); // 기존 캔버스 완전 삭제
        const newRight = document.createElement('div');
        newRight.id = 'right-viewer-div';
        newRight.style.cssText = 'width: 100%; height: 100%; position: relative;';
        rightParent.appendChild(newRight);
    }

    const leftContainer =
        document.getElementById('left-viewer-div') ||
        document.getElementById('viewer-left');

    const rightContainer =
        document.getElementById('right-viewer-div') ||
        document.getElementById('viewer-right');

    if (!leftContainer || !rightContainer) {
        console.warn('[Viewer] Split viewer container를 찾을 수 없습니다.');
        return;
    }

    // 1. 부모 강제 기상 함수 (display: none 강제 해제)
    function forceVisible(el) {
        while (el && el.nodeName !== 'BODY') {
            const style = window.getComputedStyle(el);
            if (style.display === 'none') {
                if (el.id === 'comparison-container' || el.id === 'viewer-split-wrapper' || el.id === 'comparison-panel') {
                    el.style.display = 'flex';
                } else {
                    el.style.display = 'block';
                }
            }
            el = el.parentElement;
        }
    }

    if (leftContainer) forceVisible(leftContainer);
    if (rightContainer) forceVisible(rightContainer);

    // 2. 브라우저 렌더링(Paint) 대기
    await new Promise((resolve) => { setTimeout(resolve, 50); });

    const vA = await initViewer(leftContainer, true);
    const vB = await initViewer(rightContainer, true);

    if (!vA || !vB) {
        console.warn('[Viewer] Split viewers could not be initialized (one or both are null).');
        return;
    }

    // Wait until viewer.impl is fully initialized to avoid async collisions
    await Promise.all([
        waitForViewerImpl(vA),
        waitForViewerImpl(vB)
    ]);

    viewers = [vA, vB];
    window.leftViewer = vA;
    window.rightViewer = vB;

    console.log('[Viewer] split viewers initialized with ready impl', {
        leftReady: !!vA && !!vA.impl,
        rightReady: !!vB && !!vB.impl
    });

    [vA, vB].forEach((v, idx) => {
        const label = `Viewer${idx === 0 ? 'A' : 'B'}`;
        // await loadViewCubeExtension(v, label); // temporarily disabled during diff stabilization
        v.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, () => {
            forceUpdateModelUI(v, idx);
        });
    });

    // Sync Property Selection
    let isSelectingSelf = false;
    const handleSelection = (srcViewer, dstViewer, srcLabel, ev) => {
        const dbIds = ev.dbIdArray;
        if (!dbIds || dbIds.length === 0) return;
        const dbId = dbIds[0];

        if (!isSelectingSelf) {
            isSelectingSelf = true;
            dstViewer.clearSelection();
            isSelectingSelf = false;
        }

        const panel = srcViewer.getPropertyPanel
            ? srcViewer.getPropertyPanel()
            : (srcViewer._toolbar && srcViewer._toolbar._propPanel);

        if (!panel) return;
        panel.viewer = srcViewer;

        if (!panel._isSyncPatched) {
            panel.requestNodeProperties = function (id) {
                const activeViewer = this.viewer;
                const activeModel = activeViewer.model;
                if (activeModel) {
                    activeModel.getProperties(id, (result) => {
                        this.setProperties(result.properties || [], result.name);
                    }, (err) => {
                        console.error(`[PropertyPanel] Failed to fetch properties for dbId: ${id}`, err);
                    });
                }
            };
            panel._isSyncPatched = true;
        }
        panel.setNodeProperties(dbId);
    };

    vA.addEventListener(Autodesk.Viewing.SELECTION_CHANGED_EVENT,
        (ev) => handleSelection(vA, vB, 'Viewer A', ev));
    vB.addEventListener(Autodesk.Viewing.SELECTION_CHANGED_EVENT,
        (ev) => handleSelection(vB, vA, 'Viewer B', ev));

    return { viewerA: vA, viewerB: vB };
}

async function loadViewCubeExtension(viewer, label) {
    try {
        const extName = 'Autodesk.ViewCubeUi';
        let ext = viewer.getExtension(extName);
        if (!ext) {
            ext = await viewer.loadExtension(extName);
        }
        if (ext && typeof ext.displayViewCube === 'function') {
            ext.displayViewCube(true);
        }
        if (viewer.toolController) {
            viewer.toolController.activateTool('orbit');
        }
        if (viewer.navigation) {
            viewer.navigation.setRequestTransition(true);
        }
    } catch (e) {
        console.warn(`[ViewCube] ${label}: Could not load ViewCube extension:`, e.message);
    }
}

function forceUpdateModelUI(viewer, index) {
    const model = viewer.model;
    if (!model) return;

    const modelName = (model && typeof model.getDocumentNode === 'function' ? model.getDocumentNode() : null)?.data?.name ||
        model.getData()?.loadOptions?.bubbleNode?.getDisplayName() ||
        model.getMetadata('name') ||
        "Unknown Model";

    const labelKey = index === 0 ? 'slot-a-name' : 'slot-b-name';
    const elById = document.getElementById(labelKey);
    if (elById) elById.textContent = modelName;

    const allSlotValues = document.querySelectorAll('.slot-value, .version-info, .version-label');
    allSlotValues.forEach(el => {
        if (el.textContent.includes('Select from tree...')) {
            const isSideA = el.closest('#slot-a') || el.id === 'slot-a-name' || el.classList.contains('slot-a');
            const isSideB = el.closest('#slot-b') || el.id === 'slot-b-name' || el.classList.contains('slot-b');
            if (index === 0 && isSideA) el.textContent = modelName;
            if (index === 1 && isSideB) el.textContent = modelName;
            if (!isSideA && !isSideB) el.textContent = modelName;
        }
    });
}

// ── Versions Loading ────────────────────────────────────────────────────────
export async function loadVersions(urnA, urnB) {
    if (typeof window !== 'undefined') window.loadVersions = loadVersions;
    await initSplitViewers();
    if (!viewers[0] || !viewers[1]) {
        console.warn('[Viewer] Cannot load models because split viewers are not ready.');
        return;
    }
    await Promise.all([loadModel(viewers[0], urnA), loadModel(viewers[1], urnB)]);

    [0, 1].forEach(idx => {
        const v = viewers[idx];
        if (v && v.model) {
            const node = (v.model && typeof v.model.getDocumentNode === 'function' ? v.model.getDocumentNode() : null);
            const rawName = node?.data?.name || 
                           v.model.getData()?.loadOptions?.bubbleNode?.getDisplayName() || 
                           "Unknown Model";
            const vNum = node?.data?.versionNumber || "";
            const formattedName = window.formatBimModelName ? window.formatBimModelName(rawName, vNum) : rawName;
            const elId = idx === 0 ? 'slot-a-name' : 'slot-b-name';
            const el = document.getElementById(elId);
            if (el) {
                el.textContent = formattedName;
                el.style.color = "#fff";
            }
        }
    });
}

// ── Extract and Map Properties ──────────────────────────────────────────────
async function getModelMap(viewer) {
    return new Promise(async (resolve, reject) => {
        // 방어 코드: viewer가 없거나 model이 없으면 안전하게 reject
        if (!viewer || !viewer.model) {
            console.error("[Comparison] 뷰어 또는 모델이 준비되지 않았습니다.");
            return reject(new Error("Viewer or Model is undefined"));
        }
        const model = viewer.model;

        let it = model.getInstanceTree();
        if (!it) {
            await new Promise(res => {
                const onTree = () => {
                    viewer.removeEventListener(Autodesk.Viewing.OBJECT_TREE_CREATED_EVENT, onTree);
                    res();
                };
                viewer.addEventListener(Autodesk.Viewing.OBJECT_TREE_CREATED_EVENT, onTree);
                setTimeout(res, 5000);
            });
            it = model.getInstanceTree();
        }

        if (!it) return reject(new Error('Instance tree could not be loaded.'));

        const map = new Map();
        const leafIds = [];

        it.enumNodeChildren(it.getRootId(), (dbId) => {
            if (it.getChildCount(dbId) === 0) leafIds.push(dbId);
        }, true);

        let processed = 0;
        const total = leafIds.length;
        if (total === 0) return resolve(map);

        const chunkSize = 100;
        function processNext() {
            const end = Math.min(processed + chunkSize, total);
            const chunk = leafIds.slice(processed, end);

            model.getBulkProperties(chunk, { propagate: true }, (props) => {
                props.forEach(p => {
                    const extId = p.externalId || (p.properties.find(pr => pr.displayName === 'GlobalId')?.displayValue);
                    if (extId) {
                        map.set(extId, {
                            dbId: p.dbId,
                            name: p.name,
                            properties: p.properties,
                            externalId: extId,
                            category: p.properties.find(pr => pr.displayName === 'Category')?.displayValue || 'Element',
                            level: p.properties.find(pr => ['Level', 'Base Level', 'Constraint', 'Reference Level'].includes(pr.displayName))?.displayValue || '-'
                        });
                    }
                });
                processed = end;
                if (processed < total) {
                    processNext();
                } else {
                    resolve(map);
                }
            }, (err) => {
                console.error('[Diff] Error in getBulkProperties:', err);
                processed = end;
                if (processed < total) processNext(); else resolve(map);
            });
        }
        processNext();
    });
}

// ── Local Comparison Logic ──────────────────────────────────────────────────
export async function runDiff(projectId, prevUrn, curUrn, region, onProgress) {
    if (onProgress) onProgress(10);

    // 방어 코드: viewers[0] 또는 viewers[1]이 없으면 즉시 실행 중단
    if (!viewers[0] || !viewers[1]) {
        console.error("[Comparison] 비교를 실행할 뷰어 인스턴스가 존재하지 않습니다.");
        return Promise.reject(new Error("Viewer instances are undefined"));
    }

    const [mapOld, mapNew] = await Promise.all([
        getModelMap(viewers[0]),
        getModelMap(viewers[1])
    ]);

    if (onProgress) onProgress(50);

    const added = [];
    const removed = [];
    const changed = [];

    // Check for Added and Changed
    mapNew.forEach((data, extId) => {
        if (isCenterlineObject(data)) return;
        if (!mapOld.has(extId)) {
            added.push(data);
        } else {
            const oldData = mapOld.get(extId);
            const diffs = compareProperties(oldData.properties, data.properties);
            if (diffs.length > 0) {
                changed.push({ ...data, oldDbId: oldData.dbId, diffs });
            }
        }
    });

    // Check for Removed
    mapOld.forEach((data, extId) => {
        if (isCenterlineObject(data)) return;
        if (!mapNew.has(extId)) {
            removed.push(data);
        }
    });

    if (onProgress) onProgress(100);

    // 🚨 무시할 내부 시스템 속성 목록 (가짜 변경 필터링)
    const IGNORE_PROPS = ['parent', 'viewable_in', 'lmvid', 'externalid', 'has sibling', 'child', 'elementid', 'element id'];
    const filteredChanged = changed.filter(item => {
        // 1. [Bypass] 형상이나 위치가 1mm라도 변했다면 무조건 진짜! (통과)
        let isGeom = item.isGeometryChanged === true || item.isShapeChanged === true;
        let isTrans = item.isPositionChanged === true || item.isTransformationChanged === true;

        const cats = item.categories || [];
        if (cats.length > 0) {
            isGeom = isGeom || cats.some(c => c.toLowerCase() === 'geometry');
            isTrans = isTrans || cats.some(c => c.toLowerCase() === 'transformation' || c.toLowerCase() === 'position');
        }

        // 로컬 비교 시 diffs 문자열 배열 내 키워드 매칭 백업 검사
        const hasKeywordMatch = item.diffs && item.diffs.some(d => {
            const dl = d.toLowerCase();
            return dl.includes('geometry') || dl.includes('transform') || dl.includes('position') || dl.includes('rotation') || dl.includes('shape');
        });

        if (isGeom || isTrans || hasKeywordMatch) {
            return true;
        }

        // 2. [Strict Filter] 형상/위치 변경이 없는 순수 속성(Attribute) 변경인 경우
        // item.properties는 객체의 '전체 속성'일 수 있으므로, 명시적인 변경점(differences)이 없으면 가짜로 취급
        const props = item.differences || item.changedKeys || item.diffs;
        
        if (!props || props.length === 0) {
            return false; 
        }

        let hasRealChange = false;
        for (let i = 0; i < props.length; i++) {
            const prop = props[i];
            let propName = '';
            if (typeof prop === 'string') {
                propName = prop.includes(': ') ? prop.split(': ')[0] : prop;
            } else {
                propName = prop.name || prop.displayName || prop.propertyName || prop.attributeName || "";
            }
            
            if (!propName || typeof propName !== 'string') continue;

            // 추출한 속성명이 IGNORE_PROPS에 없다면 진짜 의미 있는 변경임!
            if (!IGNORE_PROPS.includes(propName.trim().toLowerCase())) {
                hasRealChange = true;
                break; // 하나라도 진짜가 있으면 더 볼 필요 없이 합격
            }
        }

        return hasRealChange;
    });

    currentDiffData = {
        added,
        removed,
        changed: filteredChanged,
        modified: filteredChanged
    };
    window.currentDiffData = currentDiffData;
    window.comparisonData = currentDiffData;
    return currentDiffData;
}

function compareProperties(propsA, propsB) {
    const TOLERANCE = 0.001;
    const changes = [];

    const mapA = new Map();
    propsA.forEach(p => { if (p.displayName) mapA.set(p.displayName, p.displayValue); });

    const mapB = new Map();
    propsB.forEach(p => { if (p.displayName) mapB.set(p.displayName, p.displayValue); });

    const allKeys = new Set([...mapA.keys(), ...mapB.keys()]);

    for (const key of allKeys) {
        const valA = mapA.get(key);
        const valB = mapB.get(key);

        if (valA === valB) continue;

        let isDifferent = false;

        const numA = parseFloat(valA);
        const numB = parseFloat(valB);

        if (!isNaN(numA) && !isNaN(numB)) {
            if (Math.abs(numA - numB) > TOLERANCE) {
                isDifferent = true;
            }
        } else {
            if (String(valA) !== String(valB)) {
                isDifferent = true;
            }
        }

        if (isDifferent) {
            const oldVal = (valA === undefined) ? '(none)' : valA;
            const newVal = (valB === undefined) ? '(none)' : valB;
            changes.push(`${key}: ${oldVal} → <b>${newVal}</b>`);
        }
    }
    return changes;
}

// ── Color coding and Ghosting ───────────────────────────────────────────────
export function visualizeDiff(results) {
    if (!results || viewers.length < 2) return;
    initColors();

    const modelA = viewers[0].model;
    const modelB = viewers[1].model;

    if (modelA) viewers[0].clearThemingColors(modelA);
    if (modelB) viewers[1].clearThemingColors(modelB);

    const applyGhost = (viewer, model) => {
        if (!model) return;
        const it = model.getInstanceTree();
        if (!it) return;

        it.enumNodeChildren(it.getRootId(), (dbId) => {
            let fragCount = 0;
            it.enumNodeFragments(dbId, () => { fragCount++; });
            if (fragCount === 0) return;

            try {
                viewer.setThemingColor(dbId, COLORS.ghost, model, true);
            } catch (err) {}
        }, true);
    };

    applyGhost(viewers[0], modelA);
    applyGhost(viewers[1], modelB);

    if (modelB) {
        (results.added || []).forEach(obj => {
            if (obj.dbId && COLORS.added) {
                try { viewers[1].setThemingColor(obj.dbId, COLORS.added, modelB, true); } catch (e) {}
            }
        });
        (results.changed || []).forEach(obj => {
            if (obj.dbId && COLORS.changed) {
                try { viewers[1].setThemingColor(obj.dbId, COLORS.changed, modelB, true); } catch (e) {}
            }
        });
    }

    if (modelA) {
        (results.removed || []).forEach(obj => {
            if (obj.dbId && COLORS.removed) {
                try { viewers[0].setThemingColor(obj.dbId, COLORS.removed, modelA, true); } catch (e) {}
            }
        });
        (results.changed || []).forEach(obj => {
            if (obj.oldDbId && COLORS.changed) {
                try { viewers[0].setThemingColor(obj.oldDbId, COLORS.changed, modelA, true); } catch (e) {}
            }
        });
    }

    updateResultsPanel(results);
}

// ── Results Panel Rendering ─────────────────────────────────────────────────
const activeFilters = {
    shape: true,
    transform: true,
    property: true
};

function getDiffType(diffStr) {
    const lower = diffStr.toLowerCase();
    const shapeKws = ['면적', 'area', '체적', 'volume', '두께', 'thickness', '길이', 'length', '높이', 'height', '폭', 'width', '치수', 'dimension', '반지름', 'radius', '지름', 'diameter'];
    const transKws = ['위치', '좌표', '레벨', '높낮이', 'offset', 'level', 'location', 'coordinate', 'position', 'elevation', '간격띄우기'];
    
    if (shapeKws.some(kw => lower.includes(kw))) return 'shape';
    if (transKws.some(kw => lower.includes(kw))) return 'transform';
    return 'property';
}

export function updateResultsPanel(results) {
    const countAddedEl = document.getElementById('count-added');
    const countRemovedEl = document.getElementById('count-removed');
    const countModifiedEl = document.getElementById('count-modified');
    const totalCountEl = document.getElementById('comparison-count');

    const addedCount = results.added?.length || 0;
    const removedCount = results.removed?.length || 0;
    const changedCount = results.changed?.length || 0;

    if (countAddedEl) countAddedEl.textContent = addedCount;
    if (countRemovedEl) countRemovedEl.textContent = removedCount;
    if (countModifiedEl) countModifiedEl.textContent = changedCount;
    if (totalCountEl) totalCountEl.textContent = `${addedCount + removedCount + changedCount}개 객체`;

    populateTable('added', results.added || [], 'list-added');
    populateTable('removed', results.removed || [], 'list-removed');
    populateTable('changed', results.changed || [], 'list-modified');
}

export function populateTable(type, list, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    // Apply filters specifically to the changed items in list-modified
    let displayList = list;
    if (type === 'changed') {
        displayList = list.filter(obj => {
            const filteredDiffs = (obj.diffs || []).filter(diff => {
                const dType = getDiffType(diff);
                return activeFilters[dType];
            });
            return filteredDiffs.length > 0;
        });
    }

    if (displayList.length === 0) {
        container.innerHTML = `<div style="padding: 15px; text-align: center; color: var(--text-muted); font-size: 0.8rem;">항목 없음</div>`;
        return;
    }

    displayList.forEach(obj => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'diff-row-v2';
        itemDiv.style.cssText = 'padding: 8px 12px; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); border-radius: 6px; cursor: pointer; transition: all 0.2s; display: flex; flex-direction: column; gap: 4px;';
        
        itemDiv.onmouseenter = () => {
            itemDiv.style.background = 'rgba(255,255,255,0.08)';
            itemDiv.style.borderColor = 'rgba(255,255,255,0.15)';
        };
        itemDiv.onmouseleave = () => {
            if (!itemDiv.classList.contains('selected')) {
                itemDiv.style.background = 'rgba(255,255,255,0.03)';
                itemDiv.style.borderColor = 'rgba(255,255,255,0.05)';
            }
        };

        const name = obj.name || 'Unknown';
        const category = obj.category || 'Element';
        const level = obj.level || '-';

        let bodyHtml = `
            <div style="font-weight: 500; font-size: 0.85rem; color: #fff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${name}">${name}</div>
            <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--text-muted);">
                <span>${category}</span>
                <span>${level}</span>
            </div>
        `;

        if (type === 'changed') {
            const activeDiffs = (obj.diffs || []).filter(diff => {
                const dType = getDiffType(diff);
                return activeFilters[dType];
            });
            const changesText = activeDiffs.join('\n').replace(/<b>/g, '').replace(/<\/b>/g, '');
            const changesHtml = activeDiffs.join('<br>');
            bodyHtml += `
                <div style="margin-top: 4px; padding-top: 4px; border-top: 1px solid rgba(255,255,255,0.05); font-size: 0.72rem; color: #ffffff; line-height: 1.3;" title="${changesText}">
                    ${changesHtml}
                </div>
            `;
        }

        itemDiv.innerHTML = bodyHtml;

        itemDiv.onclick = async () => {
            document.querySelectorAll('.diff-row-v2').forEach(r => {
                r.classList.remove('selected');
                r.style.background = 'rgba(255,255,255,0.03)';
                r.style.borderColor = 'rgba(255,255,255,0.05)';
            });
            itemDiv.classList.add('selected');
            itemDiv.style.background = 'rgba(0, 242, 254, 0.1)';
            itemDiv.style.borderColor = 'var(--accent-color)';

            if (window.overlayViewer) {
                const overlayViewer = window.overlayViewer;
                const modelBefore = window.overlayModelBefore;
                const modelAfter = window.overlayModelAfter;
                let targetModel;
                
                if (type === 'removed') {
                    targetModel = modelBefore;
                } else {
                    targetModel = modelAfter;
                }

                if (overlayViewer && targetModel) {
                    overlayViewer.select([obj.dbId], targetModel);
                    overlayViewer.fitToView([obj.dbId], targetModel);
                }
            } else {
                if (type === 'removed') {
                    await navigateBothViewers(viewers[0], obj.dbId, viewers[1], null);
                    if (viewers[0]?.model) { viewers[0].select([obj.dbId]); viewers[1].clearSelection(); }
                } else if (type === 'added') {
                    await navigateBothViewers(viewers[1], obj.dbId, viewers[0], null);
                    if (viewers[1]?.model) { viewers[1].select([obj.dbId]); viewers[0].clearSelection(); }
                } else if (type === 'changed') {
                    await navigateBothViewers(viewers[1], obj.dbId, viewers[0], obj.oldDbId);
                    if (viewers[1]?.model) viewers[1].select([obj.dbId]);
                    if (viewers[0]?.model && obj.oldDbId) viewers[0].select([obj.oldDbId]);
                }
            }
        };

        container.appendChild(itemDiv);
    });
}

function applyOverlayVisuals(viewer, diffResults, modelBefore, modelAfter) {
    if (!viewer) return;

    // 🚨 투명도 조절 패널 UI 동적 생성
    let opacityPanel = document.getElementById('overlay-opacity-panel');
    if (!opacityPanel) {
        opacityPanel = document.createElement('div');
        opacityPanel.id = 'overlay-opacity-panel';
        opacityPanel.style.cssText = "position: fixed !important; top: 100px !important; right: 20px !important; z-index: 999999 !important; background: rgba(17, 24, 39, 0.95); border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 12px; padding: 15px 20px; color: #fff; display: flex !important; flex-direction: column; gap: 15px; box-shadow: 0 4px 15px rgba(0,0,0,0.5); backdrop-filter: blur(4px);";
        
        opacityPanel.innerHTML = 
            "<div style='font-weight: bold; font-size: 14px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 8px; margin-bottom: 12px;'>가시성 On/Off</div>" +
            "<div style='display: flex; align-items: center; margin-bottom: 10px;'>" +
            "  <label style='font-size: 13px; color: #ef4444; cursor: pointer; display: flex; align-items: center;'>" +
            "    <input type='checkbox' id='toggle-removed' checked style='margin-right: 8px; cursor: pointer;'> 제거됨 (Removed)" +
            "  </label>" +
            "</div>" +
            "<div style='display: flex; align-items: center; margin-bottom: 10px;'>" +
            "  <label style='font-size: 13px; color: #10b981; cursor: pointer; display: flex; align-items: center;'>" +
            "    <input type='checkbox' id='toggle-added' checked style='margin-right: 8px; cursor: pointer;'> 추가됨 (Added)" +
            "  </label>" +
            "</div>" +
            "<div style='display: flex; align-items: center;'>" +
            "  <label style='font-size: 13px; color: #f59e0b; cursor: pointer; display: flex; align-items: center;'>" +
            "    <input type='checkbox' id='toggle-changed' checked style='margin-right: 8px; cursor: pointer;'> 변경됨 (Changed)" +
            "  </label>" +
            "</div>";
            
        document.body.appendChild(opacityPanel);

        // 🚨 On/Off 토글 이벤트 핸들러
        
        // 1. 제거됨 (Removed) 토글
        document.getElementById('toggle-removed').addEventListener('change', function(e) {
            if (!window.overlayContext || !window.overlayContext.diff) return;
            var ctx = window.overlayContext;
            var isVisible = e.target.checked;
            var ids = (ctx.diff.removed || []).map(function(item) { return item.id || item.dbId; }).filter(Boolean);
            var color = new THREE.Vector4(239/255, 68/255, 68/255, 1); // #ef4444 불투명

            if (!isVisible) { 
                ctx.viewer.hide(ids, ctx.modelBefore); 
            } else { 
                ctx.viewer.show(ids, ctx.modelBefore); 
                ids.forEach(function(id) { ctx.viewer.setThemingColor(id, color, ctx.modelBefore, true); }); 
            }
        });

        // 2. 추가됨 (Added) 토글
        document.getElementById('toggle-added').addEventListener('change', function(e) {
            if (!window.overlayContext || !window.overlayContext.diff) return;
            var ctx = window.overlayContext;
            var isVisible = e.target.checked;
            var ids = (ctx.diff.added || []).map(function(item) { return item.id || item.dbId; }).filter(Boolean);
            var color = new THREE.Vector4(16/255, 185/255, 129/255, 1); // #10b981 불투명

            if (!isVisible) { 
                ctx.viewer.hide(ids, ctx.modelAfter); 
            } else { 
                ctx.viewer.show(ids, ctx.modelAfter); 
                ids.forEach(function(id) { ctx.viewer.setThemingColor(id, color, ctx.modelAfter, true); }); 
            }
        });

        // 3. 변경됨 (Changed) 토글
        document.getElementById('toggle-changed').addEventListener('change', function(e) {
            if (!window.overlayContext || !window.overlayContext.diff) return;
            var ctx = window.overlayContext;
            var isVisible = e.target.checked;
            var ids = (ctx.diff.changed || []).map(function(item) { return item.id || item.dbId; }).filter(Boolean);
            var color = new THREE.Vector4(245/255, 158/255, 11/255, 1); // #f59e0b 불투명

            if (!isVisible) { 
                ctx.viewer.hide(ids, ctx.modelAfter); 
            } else { 
                ctx.viewer.show(ids, ctx.modelAfter); 
                ids.forEach(function(id) { ctx.viewer.setThemingColor(id, color, ctx.modelAfter, true); }); 
            }
        });
    } else {
        opacityPanel.style.setProperty('display', 'flex', 'important');
        const toggleRemoved = document.getElementById('toggle-removed');
        const toggleAdded = document.getElementById('toggle-added');
        const toggleChanged = document.getElementById('toggle-changed');
        if (toggleRemoved) toggleRemoved.checked = true;
        if (toggleAdded) toggleAdded.checked = true;
        if (toggleChanged) toggleChanged.checked = true;
    }

    if (!diffResults) return;

    window.overlayContext = { viewer: viewer, diff: diffResults, modelBefore: modelBefore, modelAfter: modelAfter };

    // 1. 네이티브 투명 와이어프레임(Ghosting) 효과 켜기
    viewer.setGhosting(true);

    // 2. 오토데스크 익스텐션의 자체 렌더링이 끝날 때까지 대기 후 덮어쓰기 (Race condition 방어)
    setTimeout(function() {
        const removedIds = (diffResults.removed || []).map(item => item.id || item.dbId).filter(Boolean);
        const addedIds = (diffResults.added || []).map(item => item.id || item.dbId).filter(Boolean);
        const changedIds = (diffResults.changed || []).map(item => item.id || item.dbId).filter(Boolean);
        
        // 2. 각 모델별 타겟 객체 격리(Isolate) -> 나머지는 알아서 투명(Ghosting) 배경으로 전환됨
        if (removedIds.length > 0) {
            viewer.isolate(removedIds, modelBefore);
        } else {
            if (modelBefore) {
                const rootId = typeof modelBefore.getRootId === 'function' ? modelBefore.getRootId() : (modelBefore.getInstanceTree() ? modelBefore.getInstanceTree().getRootId() : 1);
                viewer.hide(rootId, modelBefore); // 제거된 게 없으면 이전 모델은 통째로 숨김
            }
        }

        const afterActiveIds = addedIds.concat(changedIds);
        if (afterActiveIds.length > 0) {
            viewer.isolate(afterActiveIds, modelAfter);
        } else {
            if (modelAfter) {
                const rootId = typeof modelAfter.getRootId === 'function' ? modelAfter.getRootId() : (modelAfter.getInstanceTree() ? modelAfter.getInstanceTree().getRootId() : 1);
                viewer.hide(rootId, modelAfter);
            }
        }

        // 3. 격리된 타겟 객체들에 커스텀 색상 입히기
        var colorAdded = new THREE.Vector4(16/255, 185/255, 129/255, 1);   // 초록
        var colorRemoved = new THREE.Vector4(239/255, 68/255, 68/255, 1);  // 빨강
        var colorChanged = new THREE.Vector4(245/255, 158/255, 11/255, 1); // 노랑

        removedIds.forEach(id => { viewer.setThemingColor(id, colorRemoved, modelBefore, true); });
        addedIds.forEach(id => { viewer.setThemingColor(id, colorAdded, modelAfter, true); });
        changedIds.forEach(id => { viewer.setThemingColor(id, colorChanged, modelAfter, true); });
    }, 800);
}

function updateDynamicViewerLabels() {
    const labelBefore = document.getElementById('viewer-label-before');
    const labelAfter = document.getElementById('viewer-label-after');
    if (window.currentVersionA && window.currentVersionB) {
        const vBefore = window.currentVersionA.versionNumber || window.currentVersionA.versionId || window.currentVersionA.name || "00";
        const vAfter = window.currentVersionB.versionNumber || window.currentVersionB.versionId || window.currentVersionB.name || "00";
        if (labelBefore) labelBefore.innerText = "이전 버전 (ver." + vBefore + ")";
        if (labelAfter) labelAfter.innerText = "현재 버전 (ver." + vAfter + ")";
    }
}

function getObjectBounds(viewer, dbId) {
    if (!viewer || !viewer.model) return null;
    const it = viewer.model.getInstanceTree();
    if (!it) return null;
    const bounds = new THREE.Box3();
    const box = new THREE.Box3();
    it.enumNodeFragments(dbId, (fragId) => {
        viewer.model.getFragmentList().getWorldBounds(fragId, box);
        bounds.union(box);
    }, true);
    return bounds.isEmpty() ? null : bounds;
}

export async function navigateBothViewers(srcViewer, srcDbId, dstViewer, dstDbId) {
    if (!srcViewer) return;
    try {
        isSyncing = true;
        srcViewer.fitToView([srcDbId]);

        // Safety timeout to reset isSyncing flag in case event doesn't fire
        const safetyTimeout = setTimeout(() => {
            isSyncing = false;
        }, 1500);

        if (dstViewer && dstViewer.model) {
            if (dstDbId) {
                dstViewer.fitToView([dstDbId]);
                const onCameraTransitionEnd = () => {
                    srcViewer.removeEventListener(Autodesk.Viewing.CAMERA_TRANSITION_COMPLETED, onCameraTransitionEnd);
                    clearTimeout(safetyTimeout);
                    isSyncing = false;
                };
                srcViewer.addEventListener(Autodesk.Viewing.CAMERA_TRANSITION_COMPLETED, onCameraTransitionEnd);
            } else {
                const onCameraTransitionEnd = () => {
                    srcViewer.removeEventListener(Autodesk.Viewing.CAMERA_TRANSITION_COMPLETED, onCameraTransitionEnd);
                    clearTimeout(safetyTimeout);
                    const cameraState = srcViewer.getState({ viewport: true });
                    dstViewer.restoreState(cameraState, null, true);
                    isSyncing = false;
                };
                srcViewer.addEventListener(Autodesk.Viewing.CAMERA_TRANSITION_COMPLETED, onCameraTransitionEnd);
            }
        } else {
            const onCameraTransitionEnd = () => {
                srcViewer.removeEventListener(Autodesk.Viewing.CAMERA_TRANSITION_COMPLETED, onCameraTransitionEnd);
                clearTimeout(safetyTimeout);
                isSyncing = false;
            };
            srcViewer.addEventListener(Autodesk.Viewing.CAMERA_TRANSITION_COMPLETED, onCameraTransitionEnd);
        }
    } catch (err) {
        console.warn('[Diff] navigateBothViewers error:', err.message);
        isSyncing = false;
    }
}

// ── Korean Font Loader for PDF ──────────────────────────────────────────────
let _nanumGothicBase64 = null;

async function loadNanumGothicFont(doc) {
    const FONT_URL = 'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/nanumgothic/NanumGothic-Regular.ttf';
    const FONT_NAME = 'NanumGothic';

    if (!_nanumGothicBase64) {
        console.log('[PDF] Fetching NanumGothic font...');
        const response = await fetch(FONT_URL);
        if (!response.ok) throw new Error(`폰트 다운로드 실패: ${response.status}`);
        const buffer = await response.arrayBuffer();

        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        _nanumGothicBase64 = btoa(binary);
        console.log('[PDF] NanumGothic font loaded and encoded.');
    }

    doc.addFileToVFS('NanumGothic-Regular.ttf', _nanumGothicBase64);
    doc.addFont('NanumGothic-Regular.ttf', FONT_NAME, 'normal');
    doc.addFont('NanumGothic-Regular.ttf', FONT_NAME, 'bold');
    return FONT_NAME;
}

function ensurePdfLibraries() {
    return new Promise((resolve, reject) => {
        if (window.jspdf && window.jspdf.jsPDF) {
            return resolve();
        }
        
        const scriptJsPdf = document.createElement('script');
        scriptJsPdf.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        scriptJsPdf.onload = () => {
            const scriptAutoTable = document.createElement('script');
            scriptAutoTable.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.28/jspdf.plugin.autotable.min.js';
            scriptAutoTable.onload = () => {
                resolve();
            };
            scriptAutoTable.onerror = () => {
                reject(new Error('AutoTable library load failed'));
            };
            document.head.appendChild(scriptAutoTable);
        };
        scriptJsPdf.onerror = () => {
            reject(new Error('jsPDF library load failed'));
        };
        document.head.appendChild(scriptJsPdf);
    });
}

// ── Layout Toggling between Explorer and Comparison ──────────────────────────
let origFileListDisplay = '';

function toggleCompareLayout(isComparing) {
    const fileListContainer = document.getElementById('explorer-container');
    const viewerWrapper = document.getElementById('comparison-container');
    
    if (!fileListContainer || !viewerWrapper) return;

    if (isComparing) {
        origFileListDisplay = fileListContainer.style.display || 'flex';
        fileListContainer.style.display = 'none';
        viewerWrapper.style.display = 'flex';
        viewerWrapper.style.height = '100%';
        viewerWrapper.style.width = '100%';

        // Ensure overlay is hidden and split wrapper is shown on start
        const viewerOverlay = document.getElementById('viewer-overlay');
        if (viewerOverlay) viewerOverlay.style.setProperty('display', 'none', 'important');
        const splitWrapper = document.getElementById('viewer-split-wrapper');
        if (splitWrapper) splitWrapper.style.display = 'flex';
    } else {
        fileListContainer.style.display = origFileListDisplay || 'flex';
        viewerWrapper.style.display = 'none';

        // Restore displays
        const viewerOverlay = document.getElementById('viewer-overlay');
        if (viewerOverlay) viewerOverlay.style.display = '';
        const splitWrapper = document.getElementById('viewer-split-wrapper');
        if (splitWrapper) splitWrapper.style.display = 'none';
    }
    
    window.dispatchEvent(new Event('resize'));
}

// 🚨 버튼 UI 상태 동기화 헬퍼 함수
function updateViewToggleButtons(isOverlayActive) {
    var btnOverlay = document.getElementById('btn-toggle-overlay');
    var btnSplit = document.getElementById('btn-toggle-split');

    // 활성화 상태 (배경색 적용, 어두운 글자)
    var activeStyle = "padding: 4px 12px; font-size: 0.8rem; background: var(--accent-color); color: #0b0f19; border: 1px solid var(--accent-color); cursor: pointer; transition: all 0.2s;";
    
    // 비활성화 상태 (투명 배경, 밝은 글자)
    var inactiveStyle = "padding: 4px 12px; font-size: 0.8rem; background: transparent; color: #e5e7eb; border: 1px solid rgba(255, 255, 255, 0.3); cursor: pointer; transition: all 0.2s;";

    if (btnOverlay) {
        btnOverlay.style.cssText = isOverlayActive ? activeStyle : inactiveStyle;
    }
    if (btnSplit) {
        btnSplit.style.cssText = !isOverlayActive ? activeStyle : inactiveStyle;
    }
}

// 🚨 이슈 추가 버튼 CSS 및 아이콘 주입
function injectIssueButtonStyles() {
    if (!document.getElementById('custom-issue-styles')) {
        var styleEl = document.createElement('style');
        styleEl.id = 'custom-issue-styles';
        styleEl.innerHTML =
            "#viewer-overlay { position: relative !important; display: flex !important; flex: 1 !important; overflow: hidden !important; }" +
            ".adsk-viewing-viewer .adsk-toolbar { z-index: 1000 !important; }" +
            ".my-custom-issue-icon { background-image: url('https://img.icons8.com/material-outlined/24/ffffff/pencil.png') !important; background-repeat: no-repeat !important; background-position: center !important; background-size: 18px !important; }";
        document.head.appendChild(styleEl);
    }
}

// 🚨 완벽한 디자인이 적용된 팝업 UI 및 저장 로직
// 🚨 완벽한 디자인이 적용된 팝업 UI 및 저장 로직
// 🚨 완벽한 디자인이 적용된 팝업 UI 및 저장 로직
window.openSafeIssuePopup = function(imgBeforeUrl, imgAfterUrl, objectId, vBefore, vAfter) {
    if (!vBefore && window.currentVersionA) {
        var numB = window.currentVersionA.versionNumber || window.currentVersionA.versionId || window.currentVersionA.name || "0";
        vBefore = "ver." + (numB < 10 ? "0" + numB : numB);
    }
    if (!vAfter && window.currentVersionB) {
        var numA = window.currentVersionB.versionNumber || window.currentVersionB.versionId || window.currentVersionB.name || "0";
        vAfter = "ver." + (numA < 10 ? "0" + numA : numA);
    }
    var verB = vBefore || "ver.00";
    var verA = vAfter || "ver.00";
    
    var extractedStructure = "";
    var extractedTrade = "";
    
    try {
        var fileName = "";
        var ma = window.overlayContext ? window.overlayContext.modelAfter : null;
        var mb = window.overlayContext ? window.overlayContext.modelBefore : null;
        
        // [1단계] 현재 버전(modelAfter)에서 파일명 탐색
        if (ma) {
            fileName = ma.getData().name || 
                       ((ma && typeof ma.getDocumentNode === 'function' ? ma.getDocumentNode() : null) ? ma.getDocumentNode().name() : "") || 
                       (ma.getData().loadOptions && ma.getData().loadOptions.bubbleNode ? ma.getData().loadOptions.bubbleNode.name() : "");
        }
        
        // [2단계] 만약 현재 버전에서 실패 시 이전 버전(modelBefore)에서 교차 탐색
        if ((!fileName || fileName === "") && mb) {
            fileName = mb.getData().name || 
                       ((mb && typeof mb.getDocumentNode === 'function' ? mb.getDocumentNode() : null) ? mb.getDocumentNode().name() : "") || 
                       (mb.getData().loadOptions && mb.getData().loadOptions.bubbleNode ? mb.getData().loadOptions.bubbleNode.name() : "");
        }

        // [3단계] 이름 문자열 정제 및 파싱
        if (fileName) {
            // 경로 및 확장자 제거
            var cleanName = fileName.split('/').pop().split('\\').pop().split('.')[0];
            var parts = cleanName.split('_');
            
            if (parts.length >= 6) {
                extractedStructure = parts[4]; // 5번째 항목 (구조물명)
                
                var rawTradeCode = parts[5].toUpperCase().trim(); // 6번째 항목 (공종 코드)
                var tradeMap = {
                    'C': '토목',
                    'A': '건축',
                    'M': '기계',
                    'AM': '건축설비',
                    'E': '전기',
                    'AS': '건축 구조'
                };
                extractedTrade = tradeMap[rawTradeCode] || rawTradeCode;
            }
        }
    } catch (e) {
        // 예외 발생 시 방어
    }

    var popup = document.getElementById('issue-popup');
    if (!popup) {
        popup = document.createElement('div');
        popup.id = 'issue-popup';
        document.body.appendChild(popup);
    }
    
    popup.style.cssText = "position: fixed !important; top: 50% !important; left: 50% !important; transform: translate(-50%, -50%) !important; background: #ffffff !important; border-radius: 8px !important; z-index: 1000000 !important; box-shadow: 0 10px 40px rgba(0,0,0,0.5) !important; width: 900px !important; max-width: 90vw !important; display: flex !important; flex-direction: column !important; overflow: hidden !important; font-family: 'Noto Sans KR', sans-serif !important;";

    popup.innerHTML = 
        "<div style='background: #1e2b4d; padding: 10px 20px; display: flex; justify-content: space-between; align-items: center;'>" +
        "  <div style='color: white; font-weight: bold; font-size: 14px;'>새 이슈 작성 (객체 ID: " + objectId + ")</div>" +
        "  <span onclick='document.getElementById(\"issue-popup\").style.display=\"none\"' style='color: white; font-size: 24px; cursor: pointer; line-height: 1;'>&times;</span>" +
        "</div>" +
        
        "<div style='display: flex; background: #f1f5f9; border-bottom: 1px solid #cbd5e1;'>" +
        "  <div style='flex: 1; padding: 15px; border-right: 1px solid #cbd5e1; text-align: center;'>" +
        "    <div style='color: #1e293b; font-size: 14px; margin-bottom: 10px; font-weight: bold;'>변경 전 (Before) - <span style='color: #ef4444;'>" + verB + "</span></div>" +
        "    <img src='" + imgBeforeUrl + "' style='width: 100%; height: auto; max-height: 250px; object-fit: contain; background: #e2e8f0; border-radius: 4px;'>" +
        "  </div>" +
        "  <div style='flex: 1; padding: 15px; text-align: center;'>" +
        "    <div style='color: #1e293b; font-size: 14px; margin-bottom: 10px; font-weight: bold;'>변경 후 (After) - <span style='color: #10b981;'>" + verA + "</span></div>" +
        "    <img src='" + imgAfterUrl + "' style='width: 100%; height: auto; max-height: 250px; object-fit: contain; background: #e2e8f0; border-radius: 4px;'>" +
        "  </div>" +
        "</div>" +
        
        "<div style='display: flex; background: #1e2b4d; padding: 20px; gap: 20px;'>" +
        "  <div style='flex: 1;'>" +
        "    <div style='color: #94a3b8; font-size: 12px; margin-bottom: 8px;'>검토 내용</div>" +
        "    <textarea id='issue-review' placeholder='기존 문제점을 입력하세요...' style='width: 100%; height: 80px; background: #0f172a; color: white; border: 1px solid #334155; padding: 10px; box-sizing: border-box; resize: none; border-radius: 4px;'></textarea>" +
        "  </div>" +
        "  <div style='flex: 1;'>" +
        "    <div style='color: #94a3b8; font-size: 12px; margin-bottom: 8px;'>변경 내용</div>" +
        "    <textarea id='issue-change' placeholder='변경된 내용을 입력하세요...' style='width: 100%; height: 80px; background: #0f172a; color: white; border: 1px solid #334155; padding: 10px; box-sizing: border-box; resize: none; border-radius: 4px;'></textarea>" +
        "  </div>" +
        "</div>" +
        
        "<div style='padding: 20px; background: white; display: flex; flex-direction: column; gap: 15px;'>" +
        "  <div>" +
        "    <div style='color: #64748b; font-size: 12px; margin-bottom: 5px; font-weight: bold;'>제목</div>" +
        "    <input type='text' id='issue-title' placeholder='이슈 제목...' style='width: 100%; padding: 10px; background: #0f172a; color: white; border: none; border-radius: 4px; box-sizing: border-box; outline: none;'>" +
        "  </div>" +
        "  <div style='display: flex; gap: 20px;'>" +
        "    <div style='flex: 1;'>" +
        "      <div style='color: #64748b; font-size: 12px; margin-bottom: 5px; font-weight: bold;'>담당자</div>" +
        "      <select id='issue-assignee' style='width: 100%; padding: 10px; background: #0f172a; color: white; border: none; border-radius: 4px; box-sizing: border-box; outline: none;'>" +
        "      </select>" +
        "    </div>" +
        "    <div style='flex: 1;'>" +
        "      <div style='color: #64748b; font-size: 12px; margin-bottom: 5px; font-weight: bold;'>상태 (Status)</div>" +
        "      <select id='issue-status' style='width: 100%; padding: 10px; background: #f59e0b; color: white; border: none; border-radius: 4px; box-sizing: border-box; outline: none; font-weight: bold;'>" +
        "        <option value='검토중' selected>검토중</option><option value='조치완료'>조치완료</option><option value='반영제외'>반영제외</option>" +
        "      </select>" +
        "    </div>" +
        "  </div>" +
        "  <div style='display: flex; gap: 20px;'>" +
        "    <div style='flex: 1;'>" +
        "      <div style='color: #64748b; font-size: 12px; margin-bottom: 5px; font-weight: bold;'>구조물명</div>" +
        "      <input type='text' id='issue-structure' value='" + extractedStructure + "' style='width: 100%; padding: 10px; background: #0f172a; color: white; border: none; border-radius: 4px; box-sizing: border-box; outline: none;'>" +
        "    </div>" +
        "    <div style='flex: 1;'>" +
        "      <div style='color: #64748b; font-size: 12px; margin-bottom: 5px; font-weight: bold;'>작업 구분</div>" +
        "      <input type='text' id='issue-trade' value='" + extractedTrade + "' style='width: 100%; padding: 10px; background: #0f172a; color: white; border: none; border-radius: 4px; box-sizing: border-box; outline: none;'>" +
        "    </div>" +
        "  </div>" +
        "  <div class='form-group' style='margin-bottom: 12px;'>" +
        "    <div style='color: #64748b; font-size: 12px; margin-bottom: 5px; font-weight: bold;'>유형</div>" +
        "    <select id='compare-issue-type' class='form-control custom-select' style='width: 100%; padding: 10px; background: #0f172a; color: white; border: none; border-radius: 4px; box-sizing: border-box; outline: none;'>" +
        "      <option value='간섭'>간섭</option>" +
        "      <option value='설계이슈'>설계이슈</option>" +
        "      <option value='도면 정합성'>도면 정합성</option>" +
        "      <option value='기타'>기타</option>" +
        "    </select>" +
        "  </div>" +
        "</div>" +
        
        "<div style='padding: 15px 20px; background: white; display: flex; justify-content: flex-end; gap: 20px; border-top: 1px solid #e2e8f0;'>" +
        "  <button onclick='document.getElementById(\"issue-popup\").style.display=\"none\"' style='background: transparent; color: #94a3b8; border: none; font-weight: bold; cursor: pointer; padding: 10px 15px; font-size: 14px;'>취소</button>" +
        "  <button id='btn-save-issue' style='background: #6366f1; color: white; border: none; border-radius: 6px; padding: 10px 30px; font-weight: bold; cursor: pointer; font-size: 14px; box-shadow: 0 4px 6px rgba(99,102,241,0.3);'>저장</button>" +
        "</div>";

    popup.style.display = 'flex';

    var realApiSelect = document.getElementById('dyn-issue-assignee');
    var targetSelect = document.getElementById('issue-assignee');
    if (realApiSelect && targetSelect) {
        targetSelect.innerHTML = realApiSelect.innerHTML;
        targetSelect.value = "미지정";
    }

    document.getElementById('btn-save-issue').onclick = function(evt) {
        if (evt) {
            evt.preventDefault();
            evt.stopPropagation();
        }
        
        console.log("[Direct Save] 단독 고효율 압축 세이브 로직 가동.");
        
        var rBox = document.getElementById('issue-review') || document.getElementById('real-compare-review-text') || document.getElementById('dyn-issue-review');
        var cBox = document.getElementById('issue-change') || document.getElementById('real-compare-change-text') || document.getElementById('dyn-issue-change');
        var tBox = document.getElementById('issue-title') || document.getElementById('dyn-issue-title') || document.getElementById('real-compare-title-input');
        var aBox = document.getElementById('issue-assignee') || document.getElementById('real-compare-assignee-select') || document.getElementById('dyn-issue-assignee');
        var sBox = document.getElementById('issue-status') || document.getElementById('real-compare-status-select');
        var stBox = document.getElementById('issue-structure') || document.getElementById('real-compare-structure-input');
        var trBox = document.getElementById('issue-trade') || document.getElementById('real-compare-trade-input');
        
        var uReview = rBox ? rBox.value.trim() : "";
        var uChange = cBox ? cBox.value.trim() : "";
        
        if (!uReview) uReview = "기록된 검토 내용이 없습니다.";
        if (!uChange) uChange = "기록된 변경 내용이 없습니다.";

        var uTitle = tBox ? tBox.value.trim() : "비교 이슈";
        var uAssignee = aBox ? aBox.value.trim() : "미지정";
        if (uAssignee === "미정" || uAssignee.indexOf('선택하세요') > -1) uAssignee = "미지정";
        var uStatus = sBox ? sBox.value.trim() : "검토중";
        var uStructure = stBox ? stBox.value.trim() : "Revit Document";
        var uTrade = trBox ? trBox.value.trim() : "토목";
        var typeBox = document.getElementById('compare-issue-type');
        var uType = typeBox ? typeBox.value : "간섭";

        // 파일명 추출 폴백 처리
        var viewer = window.viewer || window.NOP_VIEWER || (window.app && window.app.getCurrentViewer ? window.app.getCurrentViewer() : null);
        var realDocName = "";
        if (viewer && viewer.model && typeof viewer.model.getDocumentNode === 'function') {
            var docNode = viewer.model.getDocumentNode();
            if (docNode && docNode.data) realDocName = docNode.data.name || docNode._name || "";
            if (realDocName && (uStructure === "Revit Document" || uStructure === "미상" || !uStructure)) {
                if (realDocName.indexOf('.') > -1) realDocName = realDocName.substring(0, realDocName.lastIndexOf('.'));
                uStructure = realDocName.trim();
            }
        }

        var compCanvas = document.getElementById('global-markup-canvas') || document.getElementById('compare-markup-canvas');
        var compressedImg = window.lastStandaloneMarkupImage || "";

        var onCompressedDone = function(finalImg) {
            compressedImg = finalImg;
            
            var rawImgBefore = window.currentCompareBeforeUrl || imgBeforeUrl || compressedImg;
            var rawImgAfter = window.currentCompareAfterUrl || imgAfterUrl || compressedImg;

            var saveAllIssues = function(compressedBefore, compressedAfter) {
                var newCompareIssue = {
                    id: "COMP-" + Date.now(),
                    objectId: objectId,
                    dbId: objectId || "13181",
                    title: uTitle,
                    reviewContent: uReview,
                    changeContent: uChange,
                    reviewDesc: uReview,
                    changeDesc: uChange,
                    description: uChange,
                    desc: uReview,
                    assignee: uAssignee,
                    status: uStatus,
                    structure: uStructure,
                    trade: uTrade,
                    verBefore: verB,
                    verAfter: verA,
                    _type: "compare",
                    type: uType || "간섭",
                    imgBefore: compressedBefore,
                    imgAfter: compressedAfter,
                    img: compressedImg,
                    date: new Date().toISOString().substring(0, 10)
                };

                var cList = [];
                try { 
                    cList = JSON.parse(localStorage.getItem('my_saved_compare_issues') || '[]'); 
                } catch(err) { 
                    cList = []; 
                }
                cList.push(newCompareIssue);

                try {
                    localStorage.setItem('my_saved_compare_issues', JSON.stringify(cList));
                    console.log("[Scale Optimizer] 데이터 경량화 저장 성사 완료.");
                } catch(qEx) {
                    console.warn("[Scale Optimizer] 공간 부족 임계점 도달! 이미지 프리 스크럽 세이브 실행.");
                    for (var i = 0; i < cList.length; i++) {
                        cList[i].img = ""; cList[i].imgBefore = ""; cList[i].imgAfter = "";
                    }
                    localStorage.setItem('my_saved_compare_issues', JSON.stringify(cList));
                }

                // 🚨 [aps_project_issues 동시 쓰기]
                var pList = [];
                try {
                    pList = JSON.parse(localStorage.getItem('aps_project_issues') || '[]');
                } catch(e) {
                    pList = [];
                }
                pList.push(newCompareIssue);
                try {
                    localStorage.setItem('aps_project_issues', JSON.stringify(pList));
                } catch(qEx2) {
                    for (var j = 0; j < pList.length; j++) {
                        pList[j].img = ""; pList[j].imgBefore = ""; pList[j].imgAfter = "";
                    }
                    try {
                        localStorage.setItem('aps_project_issues', JSON.stringify(pList));
                    } catch(e) {}
                }

                // 🚨 [단독 이슈 배지 중복 데이터 자동 소멸] 메인 이슈 창고('my_saved_issues') 실시간 디톡스
                var rawMain = localStorage.getItem('my_saved_issues');
                if (rawMain) {
                    var parsedMain = JSON.parse(rawMain);
                    if (Array.isArray(parsedMain)) {
                        var cleanedMain = parsedMain.filter(function(item) {
                            return item && String(item.id).indexOf('COMP-') === -1 && String(item._type) !== 'compare';
                        });
                        localStorage.setItem('my_saved_issues', JSON.stringify(cleanedMain));
                    }
                }

                // 모달 닫기
                popup.style.display = 'none';
                if (typeof window.renderIssueList === 'function') window.renderIssueList();
                var issueTabBtn = document.getElementById('tab-btn-issues');
                if (issueTabBtn) issueTabBtn.click();

                setTimeout(function() {
                    if (typeof window.renderIssueTable === 'function') {
                        window.renderIssueTable();
                    }
                }, 50);
            };

            window.compressImg(rawImgBefore, function(compBefore) {
                window.compressImg(rawImgAfter, function(compAfter) {
                    saveAllIssues(compBefore, compAfter);
                });
            });
        };

        if (compCanvas) {
            var shrinkCanvas = document.createElement('canvas');
            var shrinkCtx = shrinkCanvas.getContext('2d');
            var maxW = 1920;
            var width = compCanvas.width;
            var height = compCanvas.height;
            if (width > maxW) {
                height = Math.round((height * maxW) / width);
                width = maxW;
            }
            shrinkCanvas.width = width;
            shrinkCanvas.height = height;
            if (shrinkCtx) {
                shrinkCtx.imageSmoothingEnabled = true;
                shrinkCtx.imageSmoothingQuality = 'high';
                shrinkCtx.drawImage(compCanvas, 0, 0, width, height);
                compressedImg = shrinkCanvas.toDataURL('image/webp', 0.9);
                if (!compressedImg || compressedImg.indexOf('data:image/webp') === -1) {
                    compressedImg = shrinkCanvas.toDataURL('image/jpeg', 0.9);
                }
            } else {
                compressedImg = compCanvas.toDataURL('image/webp', 0.9);
                if (!compressedImg || compressedImg.indexOf('data:image/webp') === -1) {
                    compressedImg = compCanvas.toDataURL('image/jpeg', 0.9);
                }
            }
            onCompressedDone(compressedImg);
        } else if (compressedImg) {
            window.compressImg(compressedImg, onCompressedDone);
        } else {
            onCompressedDone("");
        }
    };
    
    document.getElementById('issue-status').onchange = function(e) {
        var val = e.target.value;
        e.target.style.background = val === '조치완료' ? '#10b981' : (val === '반영제외' ? '#ef4444' : '#f59e0b');
    };
    document.getElementById('issue-status').dispatchEvent(new Event('change'));
};

// 🚨 툴바에 이슈 버튼 추가 (중복 방지 포함)
function addCustomIssueButton(viewer) {
    var toolbar = viewer.toolbar;
    if (!toolbar) return;
    if (toolbar.getControl('issue-add-btn')) return;

    var issueButton = new Autodesk.Viewing.UI.Button('issue-add-btn');
    issueButton.setToolTip('이슈 추가');
    issueButton.icon.style.backgroundImage = "url('https://img.icons8.com/material-outlined/24/ffffff/camera.png')";
    issueButton.icon.style.backgroundRepeat = 'no-repeat';
    issueButton.icon.style.backgroundPosition = 'center';
    issueButton.icon.style.backgroundSize = '20px';
    issueButton.icon.style.width = '24px';
    issueButton.icon.style.height = '24px';

    issueButton.onClick = function() {
        // 기존에 등록된 캡처 이벤트가 있다면 먼저 해제
        if (viewer._issueCaptureHandler) {
            viewer.removeEventListener(Autodesk.Viewing.AGGREGATE_SELECTION_CHANGED_EVENT, viewer._issueCaptureHandler);
            viewer._issueCaptureHandler = null;
        }

        // 1회성 캡처 리스너 정의 및 등록
        viewer._issueCaptureHandler = function(e) {
            if (!e.selections || e.selections.length === 0) return;
            var sel0 = e.selections[0];
            if (!sel0 || !sel0.dbIdArray || sel0.dbIdArray.length === 0) return;
            var selectedId = sel0.dbIdArray[0];

            // 선택 감지 즉시 리스너 제거 (1회성)
            viewer.removeEventListener(Autodesk.Viewing.AGGREGATE_SELECTION_CHANGED_EVENT, viewer._issueCaptureHandler);
            viewer._issueCaptureHandler = null;

            var mBefore = window.overlayModelBefore;
            var mAfter  = window.overlayModelAfter;
            if (!mBefore || !mAfter) {
                alert("모델 데이터를 찾을 수 없습니다.");
                return;
            }

            var w = viewer.container.clientWidth;
            var h = viewer.container.clientHeight;

            // Step 1: After 숨기고 Before만 노출 → 캡처
            viewer.hide(mAfter.getRootId(), mAfter);
            viewer.show(mBefore.getRootId(), mBefore);

            setTimeout(function() {
                viewer.getScreenShot(w, h, function(blobBefore) {

                    // Step 2: Before 숨기고 After만 노출 → 캡처
                    viewer.hide(mBefore.getRootId(), mBefore);
                    viewer.show(mAfter.getRootId(), mAfter);

                    setTimeout(function() {
                        viewer.getScreenShot(w, h, function(blobAfter) {

                            // Step 3: 두 모델 원상 복구 (테마 유지)
                            viewer.show(mBefore.getRootId(), mBefore);
                            viewer.show(mAfter.getRootId(), mAfter);
                            viewer.clearSelection();

                            // Step 4: 팝업 호출
                            if (typeof window.openSafeIssuePopup === 'function') {
                                window.openSafeIssuePopup(blobBefore, blobAfter, selectedId);
                            }
                        });
                    }, 300);
                });
            }, 300);
        };

        viewer.addEventListener(Autodesk.Viewing.AGGREGATE_SELECTION_CHANGED_EVENT, viewer._issueCaptureHandler);
    };

    var group = new Autodesk.Viewing.UI.ControlGroup('custom-issue-group');
    group.addControl(issueButton);
    toolbar.addControl(group);
}

// 🚨 이벤트 기반 툴바 안전 초기화 (TOOLBAR_CREATED_EVENT 대기)
function initializeOverlayToolbar(viewer) {
    injectIssueButtonStyles();
    if (viewer.toolbar) {
        addCustomIssueButton(viewer);
    } else {
        viewer.addEventListener(Autodesk.Viewing.TOOLBAR_CREATED_EVENT, function onToolbarCreated() {
            addCustomIssueButton(viewer);
            viewer.removeEventListener(Autodesk.Viewing.TOOLBAR_CREATED_EVENT, onToolbarCreated);
        });
    }
}

// ── Controls and Global Event Bindings ─────────────────────────────────────
function setupComparisonControls() {
    // 🚨 탭 UI 및 본문 컨테이너 주입 로직
    var headerBar = document.querySelector('.comparison-header') || document.getElementById('panel-header'); 
    if (headerBar) {
        headerBar.style.padding = "16px 20px"; // 기존보다 위아래 여백을 늘려 높이 확장
    }

    var panel = document.getElementById('bottom-result-panel') || document.getElementById('comparison-panel');
    if (panel && !document.getElementById('panel-resizer-handle')) {
        panel.style.position = "fixed";
        panel.style.bottom = "0";
        panel.style.left = "0";
        panel.style.right = "0";
        panel.style.display = "flex";
        panel.style.flexDirection = "column";
        panel.style.zIndex = "9999";

        var listAdded = document.getElementById('list-added');
        var columnsContainer = null;
        if (listAdded) {
            columnsContainer = listAdded.parentElement.parentElement;
        }

        var btnStyle = "padding: 4px 10px; font-size: 0.8rem; background: var(--accent-color); color: #0b0f19; font-weight: 600; display: flex; align-items: center; gap: 4px; border: none; border-radius: 4px; cursor: pointer;";
        
        var tabHtml = 
            // [NEW] 맨 꼭대기 5px짜리 마우스 드래그 인식선
            "<div id='panel-resizer-handle' style='height: 5px; cursor: ns-resize; background: #374151; width: 100%; border-top: 1px solid #4b5563; transition: background 0.2s;' onmouseover='this.style.background=\"#6366f1\"' onmouseout='this.style.background=\"#374151\"'></div>" +
            
            // 최상단 독립 제목 바 영역
            "<div id='panel-title-bar' style='padding: 14px 20px; background: #111827; color: #ffffff; font-size: 14px; font-weight: bold; border-bottom: 1px solid rgba(255,255,255,0.05); display: flex; align-items: center;'>" +
            "  비교 분석 결과" +
            "</div>" +
            
            // 기존 탭 및 PDF 버튼 영역
            "<div id='tab-container' style='display: flex; justify-content: space-between; align-items: center; padding: 10px 20px; border-bottom: 1px solid rgba(255, 255, 255, 0.1); background: #1f2937;'>" +
            "  <div style='display: flex; gap: 10px;'>" +
            "    <button id='tab-btn-results' style='background: var(--accent-color); color: #0b0f19; border: none; padding: 5px 15px; border-radius: 15px; cursor: pointer;'>분석 결과</button>" +
            "    <button id='tab-btn-issues' style='background: transparent; color: #fff; border: 1px solid #555; padding: 5px 15px; border-radius: 15px; cursor: pointer;'>이슈 목록</button>" +
            "  </div>" +
            "  <div id='tab-pdf-actions' style='display: flex; gap: 10px;'>" +
            "    <button id='btn-export-pdf' style='" + btnStyle + "'>" +
            "      <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'></path><polyline points='14 2 14 8 20 8'></polyline><line x1='16' y1='13' x2='8' y2='13'></line><line x1='16' y1='17' x2='8' y2='17'></line></svg>" +
            "      PDF 내보내기" +
            "    </button>" +
            "    <button id='btn-export-pdf-issues' style='" + btnStyle + "; display: none;'>" +
            "      <svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'></path><polyline points='14 2 14 8 20 8'></polyline><line x1='16' y1='13' x2='8' y2='13'></line><line x1='16' y1='17' x2='8' y2='17'></line></svg>" +
            "      이슈 PDF 내보내기" +
            "    </button>" +
            "  </div>" +
            "</div>" +
            "<div id='content-results' style='display: flex; flex-direction: column; flex: 1; overflow: hidden; padding: 0 10px 10px 10px;'></div>" +
            "<div id='content-issues' style='display: none; padding: 10px; color: #9ca3af; text-align: center; margin-top: 20px; flex: 1; overflow-y: auto;'>작성된 이슈가 없습니다.</div>";
            
        panel.innerHTML = tabHtml;

        var contentResults = document.getElementById('content-results');
        if (columnsContainer && contentResults) {
            contentResults.appendChild(columnsContainer);
        }

        // 리사이저 드래그 이벤트 활성화 호출
        initPanelResizable();
    }

    const exitBtn = document.getElementById('btn-exit-comparison');
    if (exitBtn) {
        exitBtn.onclick = () => {
            // 🚨 레이아웃 복구: 파일 목록 원상 복구 및 뷰어 숨김
            toggleCompareLayout(false);

            if (viewers.length > 0) {
                viewers.forEach(v => {
                    try { if (v && typeof v.finish === 'function') v.finish(); } catch (_) {}
                });
                viewers = [];
                window.leftViewer = null;
                window.rightViewer = null;
            }

            if (window.overlayViewer) {
                try {
                    window.overlayViewer.clearThemingColors();
                    window.overlayViewer.isolate([]);
                    window.overlayViewer.showAll();
                } catch (e) {}
                try { if (typeof window.overlayViewer.finish === 'function') window.overlayViewer.finish(); } catch (_) {}
                window.overlayViewer = null;
            }
            window.overlayModelBefore = null;
            window.overlayModelAfter = null;

            const opacityPanel = document.getElementById('overlay-opacity-panel');
            if (opacityPanel) opacityPanel.style.setProperty('display', 'none', 'important');

            document.body.classList.remove('comparison-active');
            document.getElementById('comparison-container')?.style && (document.getElementById('comparison-container').style.display = 'none');
            document.getElementById('comparison-bar')?.style && (document.getElementById('comparison-bar').style.display = 'none');
            document.getElementById('comparison-panel')?.style && (document.getElementById('comparison-panel').style.display = 'none');
            document.getElementById('preview')?.style && (document.getElementById('preview').style.display = 'block');
            
            if (window.currentUrn) {
                initViewer(document.getElementById('preview'), false).then((v) => {
                    loadModel(v, window.currentUrn);
                }).catch((err) => {
                    console.error('[Viewer] Re-initialization failed: ' + err);
                });
            }
        };
    }

    // Toggle overlay vs split view
    const btnOverlay = document.getElementById('btn-toggle-overlay');
    const btnSplit = document.getElementById('btn-toggle-split');
    
    if (btnOverlay && btnSplit) {
        btnOverlay.onclick = async () => {
            updateViewToggleButtons(true);
            
            const wrapper = document.getElementById('viewer-split-wrapper');
            const overlay = document.getElementById('viewer-overlay');
            if (wrapper) wrapper.style.display = 'none';
            if (overlay) overlay.style.setProperty('display', 'block', 'important');
            
            // 🚨 기존 분할 뷰어 정리
            if (viewers.length > 0) {
                viewers.forEach(v => {
                    try { if (v && typeof v.finish === 'function') v.finish(); } catch (_) {}
                });
                viewers = [];
                window.leftViewer = null;
                window.rightViewer = null;
            }

            if (window.overlayViewer) {
                try { window.overlayViewer.finish(); } catch(_) {}
                window.overlayViewer = null;
            }

            const overlayContainer = document.getElementById('viewer-overlay');
            if (overlayContainer) {
                overlayContainer.innerHTML = '';
                showLoading(true, '중첩 뷰어 초기화 및 모델 로드 중...');
                const overlayViewer = await initViewer(overlayContainer, true);
                if (overlayViewer) {
                    window.overlayViewer = overlayViewer;

                    // 🚨 이벤트 기반 툴바 안전 초기화
                    initializeOverlayToolbar(overlayViewer);

                    // 🚨 뷰어 리사이징 트리거
                    setTimeout(function() {
                        overlayViewer.resize();
                    }, 500);

                    // 🚨 비파괴 2연속 캡처 로직 (루트 노드 가시성 임시 제어)
                    overlayViewer.addEventListener(Autodesk.Viewing.OBJECT_SELECTED_EVENT, function(e) {
                        if (overlayViewer.selectMode !== 'issue-capture') return;
                        if (!e.dbIdArray || e.dbIdArray.length === 0) return;

                        var selectedId = e.dbIdArray[0];
                        var w = overlayViewer.container.clientWidth;
                        var h = overlayViewer.container.clientHeight;
                        var mBefore = window.overlayModelBefore;
                        var mAfter = window.overlayModelAfter;

                        if (!mBefore || !mAfter) return;

                        // 1. After 숨기고 Before만 노출 → 캡처
                        overlayViewer.hide(mAfter.getRootId(), mAfter);
                        overlayViewer.show(mBefore.getRootId(), mBefore);

                        setTimeout(function() {
                            overlayViewer.getScreenShot(w, h, function(blobBefore) {

                                // 2. Before 숨기고 After만 노출 → 캡처
                                overlayViewer.hide(mBefore.getRootId(), mBefore);
                                overlayViewer.show(mAfter.getRootId(), mAfter);

                                setTimeout(function() {
                                    overlayViewer.getScreenShot(w, h, function(blobAfter) {

                                        // 3. 두 모델 모두 복구 (테마 유지)
                                        overlayViewer.show(mBefore.getRootId(), mBefore);
                                        overlayViewer.show(mAfter.getRootId(), mAfter);

                                        // 4. 상태 초기화 및 팝업 호출
                                        overlayViewer.selectMode = null;
                                        overlayViewer.clearSelection();
                                        openSafeIssuePopup(blobBefore, blobAfter, selectedId);
                                    });
                                }, 200);
                            });
                        }, 200);
                    });
                    
                    const urnBefore = window.comparisonUrnA;
                    const urnAfter = window.comparisonUrnB;
                    
                    if (urnBefore && urnAfter) {
                        try {
                            const finalUrnBefore = urnBefore.startsWith('urn:') ? urnBefore : 'urn:' + urnBefore;
                            const finalUrnAfter = urnAfter.startsWith('urn:') ? urnAfter : 'urn:' + urnAfter;
                            
                            Autodesk.Viewing.Document.load(finalUrnBefore, (docBefore) => {
                                const viewableBefore = docBefore.getRoot().getDefaultGeometry();
                                overlayViewer.loadDocumentNode(docBefore, viewableBefore, { globalOffset: { x: 0, y: 0, z: 0 } }).then((modelBefore) => {
                                    window.overlayModelBefore = modelBefore;
                                    
                                    Autodesk.Viewing.Document.load(finalUrnAfter, (docAfter) => {
                                        const viewableAfter = docAfter.getRoot().getDefaultGeometry();
                                        const loadOptions = { keepCurrentModels: true, globalOffset: { x: 0, y: 0, z: 0 } };
                                        overlayViewer.loadDocumentNode(docAfter, viewableAfter, loadOptions).then((modelAfter) => {
                                            window.overlayModelAfter = modelAfter;
                                            
                                            // 🚨 익스텐션 로드 안정화: 표준 명칭 시도 후 구 명칭 폴백
                                            var runColoring = function() {
                                                applyOverlayVisuals(overlayViewer, window.currentDiffData, modelBefore, modelAfter);
                                            };

                                            var applyExtAndColor = function(ext) {
                                                if (ext) {
                                                    if (typeof ext.compareModels === 'function') {
                                                        ext.compareModels(modelBefore, modelAfter);
                                                    } else if (typeof ext.execute === 'function') {
                                                        ext.execute(modelBefore, modelAfter);
                                                    }
                                                }
                                                runColoring();
                                                setTimeout(runColoring, 100);
                                                setTimeout(runColoring, 500);
                                                setTimeout(runColoring, 1500);
                                                showLoading(false);
                                            };

                                            overlayViewer.loadExtension('Autodesk.Viewing.Extensions.ModelCompare').then(function(ext) {
                                                applyExtAndColor(ext);
                                            }).catch(function() {
                                                overlayViewer.loadExtension('Autodesk.ModelCompare').then(function(ext) {
                                                    applyExtAndColor(ext);
                                                }).catch(function() {
                                                    runColoring();
                                                    setTimeout(runColoring, 100);
                                                    setTimeout(runColoring, 500);
                                                    setTimeout(runColoring, 1500);
                                                    showLoading(false);
                                                });
                                            });
                                        }).catch((err) => {
                                            console.warn('[Overlay] Load after model failed:', err);
                                            showLoading(false);
                                        });
                                    }, (code, msg) => {
                                        console.warn('[Overlay] Load after doc failed:', msg);
                                        showLoading(false);
                                    });
                                }).catch((err) => {
                                    console.warn('[Overlay] Load before model failed:', err);
                                    showLoading(false);
                                });
                            }, (code, msg) => {
                                console.warn('[Overlay] Load before doc failed:', msg);
                                showLoading(false);
                            });
                        } catch (err) {
                            console.error('[Overlay] Error loading models:', err);
                            showLoading(false);
                        }
                    } else {
                        showLoading(false);
                    }
                } else {
                    showLoading(false);
                }
            }
        };
        
        btnSplit.onclick = async () => {
            const opacityPanel = document.getElementById('overlay-opacity-panel');
            if (opacityPanel) opacityPanel.style.setProperty('display', 'none', 'important');

            updateViewToggleButtons(false);
            
            const wrapper = document.getElementById('viewer-split-wrapper');
            const overlay = document.getElementById('viewer-overlay');
            if (wrapper) wrapper.style.display = 'flex';
            if (overlay) overlay.style.setProperty('display', 'none', 'important');
            
            if (window.overlayViewer) {
                try {
                    window.overlayViewer.clearThemingColors();
                    window.overlayViewer.isolate([]);
                    window.overlayViewer.showAll();
                } catch (e) {}
                try { window.overlayViewer.finish(); } catch (_) {}
                window.overlayViewer = null;
            }
            window.overlayModelBefore = null;
            window.overlayModelAfter = null;

            if (window.comparisonUrnA && window.comparisonUrnB) {
                showLoading(true, '분할 뷰어 재초기화 및 모델 로드 중...');
                await loadVersions(window.comparisonUrnA, window.comparisonUrnB);
                updateDynamicViewerLabels();
                
                const pid = window.currentProjectId || '';
                const result = await runDiff(pid, window.comparisonUrnA, window.comparisonUrnB).catch(() => null);
                if (result && viewers[0] && viewers[1]) {
                    initCameraSync(viewers[0], viewers[1]);
                    visualizeDiff(result);
                }
                showLoading(false);
            }
            
            if (window.leftViewer) window.leftViewer.resize();
            if (window.rightViewer) window.rightViewer.resize();
        };
    }

    // Toggle filter chips (shape, transform, property)
    ['shape', 'transform', 'property'].forEach(filterType => {
        const chip = document.getElementById(`toggle-filter-${filterType}`);
        if (chip) {
            chip.onclick = () => {
                const isActive = chip.classList.toggle('active');
                activeFilters[filterType] = isActive;
                if (isActive) {
                    chip.style.background = 'rgba(245, 158, 11, 0.15)';
                    chip.style.color = '#f59e0b';
                    chip.style.borderColor = 'rgba(245, 158, 11, 0.3)';
                    const icon = chip.querySelector('i');
                    if (icon) icon.style.display = 'inline-block';
                } else {
                    chip.style.background = 'rgba(255, 255, 255, 0.05)';
                    chip.style.color = 'var(--text-muted)';
                    chip.style.borderColor = 'rgba(255, 255, 255, 0.1)';
                    const icon = chip.querySelector('i');
                    if (icon) icon.style.display = 'none';
                }
                
                if (window.currentDiffData) {
                    populateTable('changed', window.currentDiffData.changed, 'list-modified');
                }
            };
        }
    });

    // PDF Export
    const pdfBtn = document.getElementById('btn-export-pdf');
    if (pdfBtn) {
        pdfBtn.onclick = async () => {
            if (!window.currentDiffData) return alert('내보낼 데이터가 없습니다.');
            const total = (window.currentDiffData.added?.length || 0) +
                (window.currentDiffData.removed?.length || 0) +
                (window.currentDiffData.changed?.length || 0);
            if (total === 0) return alert('내보낼 데이터가 없습니다.');

            const sections = [
                { title: `추가된 요소 (Added) — ${(window.currentDiffData.added || []).length}건`, data: window.currentDiffData.added || [], color: [16, 185, 129] },
                { title: `삭제된 요소 (Removed) — ${(window.currentDiffData.removed || []).length}건`, data: window.currentDiffData.removed || [], color: [239, 68, 68] },
                { title: `변경된 요소 (Changed) — ${(window.currentDiffData.changed || []).length}건`, data: window.currentDiffData.changed || [], color: [245, 158, 11] }
            ];

            if (!window.jspdf || !window.jspdf.jsPDF) {
                const origText = pdfBtn.innerHTML;
                pdfBtn.disabled = true;
                pdfBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 라이브러리 로드 중...';
                try {
                    await ensurePdfLibraries();
                } catch (err) {
                    alert('네트워크 오류로 PDF 라이브러리를 불러올 수 없습니다: ' + err.message);
                    pdfBtn.disabled = false;
                    pdfBtn.innerHTML = origText;
                    return;
                }
                pdfBtn.disabled = false;
                pdfBtn.innerHTML = origText;
            }

            const { jsPDF } = window.jspdf || {};
            if (!jsPDF) return alert('PDF 라이브러리가 로드되지 않았습니다.');

            pdfBtn.disabled = true;
            const origText = pdfBtn.innerHTML;
            pdfBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> PDF 생성 중...';

            try {
                const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
                let fontName = 'helvetica';
                try {
                    fontName = await loadNanumGothicFont(doc);
                    doc.setFont(fontName, 'normal');
                } catch (fontErr) {
                    console.warn('[PDF] Failed to load NanumGothic, fallback to helvetica:', fontErr);
                }

                const today = new Date().toLocaleDateString('ko-KR');
                const modelAName = document.getElementById('slot-a-name')?.textContent || '이전 버전';
                const modelBName = document.getElementById('slot-b-name')?.textContent || '비교 대상';

                // Header box
                doc.setFillColor(17, 24, 39);
                doc.rect(0, 0, 210, 30, 'F');
                doc.setTextColor(255, 255, 255);
                
                if (fontName !== 'helvetica') {
                    doc.setFont(fontName, 'bold');
                    doc.setFontSize(14);
                    doc.text('BIM 비교 분석 보고서', 14, 12);
                    doc.setFont(fontName, 'normal');
                    doc.setFontSize(8);
                    doc.text(`출력일: ${today}`, 14, 18);
                    doc.text(`이전 버전: ${modelAName}`, 14, 24);
                    doc.text(`비교 대상: ${modelBName}`, 110, 24);
                } else {
                    doc.setFontSize(14);
                    doc.text('BIM Comparison Report', 14, 12);
                    doc.setFontSize(8);
                    doc.text(`Date: ${today}`, 14, 18);
                    doc.text(`Version A: ${modelAName}`, 14, 24);
                    doc.text(`Version B: ${modelBName}`, 110, 24);
                }

                doc.setTextColor(0, 0, 0);
                let curY = 36;

                for (const section of sections) {
                    doc.setFontSize(10);
                    doc.setFont(fontName, 'bold');
                    doc.setTextColor(...section.color);
                    doc.text(section.title, 14, curY);
                    doc.setTextColor(0, 0, 0);
                    doc.setFont(fontName, 'normal');

                    const isChanged = section.title.includes('Changed') || section.title.includes('변경');
                    const head = isChanged 
                        ? [['이름 (Name)', '카테고리 (Category)', '레벨', '변경 내용 (Changes)']]
                        : [['이름 (Name)', '카테고리 (Category)', '레벨 (Level)']];

                    const rows = (section.data || []).map(obj => {
                        const name = obj.name || 'Unknown';
                        const cat = obj.category || 'Element';
                        const lvl = obj.level || '-';
                        if (isChanged) {
                            const ch = (obj.diffs || []).join('\n').replace(/<b>/g, '').replace(/<\/b>/g, '');
                            return [name, cat, lvl, ch];
                        }
                        return [name, cat, lvl];
                    });

                    doc.autoTable({
                        head: head,
                        body: rows.length ? rows : [['데이터 없음', '', '']],
                        startY: curY + 3,
                        theme: 'grid',
                        headStyles: {
                            fillColor: section.color,
                            textColor: 255,
                            fontStyle: 'bold',
                            font: fontName,
                            fontSize: 8
                        },
                        bodyStyles: {
                            font: fontName,
                            fontSize: 7
                        },
                        margin: { left: 14, right: 14 }
                    });

                    curY = doc.lastAutoTable.finalY + 8;
                }

                const fileDate = new Date().toISOString().slice(0, 10);
                doc.save(`BIM_Comparison_Report_${fileDate}.pdf`);
            } catch (err) {
                console.error('[PDF Export Error]', err);
                alert(`PDF 생성 중 오류 발생: ${err.message}`);
            } finally {
                pdfBtn.disabled = false;
                pdfBtn.innerHTML = origText;
            }
        };
    }


    // 🚨 이슈 작성 팝업 동적 생성
    let issuePopup = document.getElementById('issue-popup');
    if (!issuePopup) {
        issuePopup = document.createElement('div');
        issuePopup.id = 'issue-popup';
        issuePopup.style.cssText = "position: fixed !important; top: 50% !important; left: 50% !important; transform: translate(-50%, -50%) !important; z-index: 1000000 !important; background: rgba(17, 24, 39, 0.98); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 16px; padding: 25px; color: #fff; display: none; flex-direction: column; gap: 15px; box-shadow: 0 10px 30px rgba(0,0,0,0.8); backdrop-filter: blur(10px); width: 420px; max-width: 90vw; box-sizing: border-box;";
        
        issuePopup.innerHTML = 
            "<div style='font-weight: bold; font-size: 16px; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 10px; display: flex; justify-content: space-between; align-items: center;'>" +
            "  <span>이슈 등록</span>" +
            "  <span id='btn-close-issue-popup' style='cursor: pointer; color: #aaa; font-size: 20px;'>&times;</span>" +
            "</div>" +
            "<div style='text-align: center; background: rgba(0,0,0,0.3); border-radius: 8px; padding: 5px; overflow: hidden; height: 180px; display: flex; align-items: center; justify-content: center; border: 1px solid rgba(255,255,255,0.05);'>" +
            "  <img id='issue-preview' style='max-width: 100%; max-height: 100%; border-radius: 4px; object-fit: contain;' />" +
            "</div>" +
            "<div style='font-size: 12px; color: var(--text-muted);'>" +
            "  선택 객체 ID: <span id='issue-dbid-label' style='color: var(--accent-color); font-weight: bold;'>-</span>" +
            "</div>" +
            "<div style='display: flex; flex-direction: column; gap: 5px;'>" +
            "  <label style='font-size: 12px; color: #e5e7eb;'>제목</label>" +
            "  <input type='text' id='issue-title-input' placeholder='이슈 제목을 입력하세요.' style='background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; padding: 8px 12px; color: #fff; outline: none; font-size: 13px;'>" +
            "</div>" +
            "<div style='display: flex; flex-direction: column; gap: 5px;'>" +
            "  <label style='font-size: 12px; color: #e5e7eb;'>설명</label>" +
            "  <textarea id='issue-desc-input' placeholder='상세 내용을 입력하세요.' rows='3' style='background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; padding: 8px 12px; color: #fff; resize: none; outline: none; font-size: 13px;'></textarea>" +
            "</div>" +
            "<div class='form-group mb-4' style='display: flex; flex-direction: column; gap: 5px;'>" +
            "  <label class='block text-sm font-medium text-slate-400 mb-1' style='font-size: 12px; color: #e5e7eb;'>유형</label>" +
            "  <select id='create-issue-type' class='w-full bg-slate-800 text-slate-200 border border-slate-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-sky-500' style='background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; padding: 8px 12px; color: #fff; outline: none; font-size: 13px; cursor: pointer;'>" +
            "    <option value='Coordination'>Coordination (협업)</option>" +
            "    <option value='Clash' selected>Clash (간섭)</option>" +
            "    <option value='Design'>Design (설계 변경)</option>" +
            "  </select>" +
            "</div>" +
            "<div class='grid grid-cols-2 gap-4 mb-4' style='display: flex; gap: 10px;'>" +
            "  <div class='form-group' style='flex: 1; display: flex; flex-direction: column; gap: 5px;'>" +
            "    <label class='block text-sm font-medium text-slate-400 mb-1' style='font-size: 12px; color: #e5e7eb;'>시작 날짜</label>" +
            "    <input type='date' id='create-issue-start-date' class='w-full bg-slate-800 text-slate-200 border border-slate-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-sky-500' style='background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; padding: 8px 12px; color: #fff; outline: none; font-size: 13px;'>" +
            "  </div>" +
            "  <div class='form-group' style='flex: 1; display: flex; flex-direction: column; gap: 5px;'>" +
            "    <label class='block text-sm font-medium text-slate-400 mb-1' style='font-size: 12px; color: #e5e7eb;'>마감일</label>" +
            "    <input type='date' id='create-issue-due-date' class='w-full bg-slate-800 text-slate-200 border border-slate-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-sky-500' style='background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.15); border-radius: 6px; padding: 8px 12px; color: #fff; outline: none; font-size: 13px;'>" +
            "  </div>" +
            "</div>" +
            "<div style='display: flex; gap: 10px; justify-content: flex-end; margin-top: 10px;'>" +
            "  <button id='btn-cancel-issue' style='background: rgba(255,255,255,0.1); color: #fff; border: 1px solid rgba(255,255,255,0.15); padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 500;'>취소</button>" +
            "  <button id='btn-save-issue' style='background: var(--accent-color); color: #0b0f19; border: none; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 600;'>저장</button>" +
            "</div>";
            
        document.body.appendChild(issuePopup);

        var closeIssuePopup = function() {
            issuePopup.style.display = 'none';
            document.getElementById('issue-title-input').value = '';
            document.getElementById('issue-desc-input').value = '';
            document.getElementById('create-issue-type').value = 'Clash';
            document.getElementById('create-issue-start-date').value = '';
            document.getElementById('create-issue-due-date').value = '';
            if (window.overlayViewer) {
                window.overlayViewer.clearSelection();
            }
        };

        document.getElementById('btn-cancel-issue').onclick = closeIssuePopup;
        document.getElementById('btn-close-issue-popup').onclick = closeIssuePopup;
        
        document.getElementById('btn-save-issue').onclick = function() {
            var title = document.getElementById('issue-title-input').value.trim();
            var desc = document.getElementById('issue-desc-input').value.trim();
            var dbId = parseInt(document.getElementById('issue-dbid-label').textContent, 10);
            var imgSrc = document.getElementById('issue-preview').src;
            
            var typeVal = document.getElementById('create-issue-type').value;
            var startDateVal = document.getElementById('create-issue-start-date').value || '-';
            var endDateVal = document.getElementById('create-issue-due-date').value || '-';

            if (!title) {
                alert("이슈 제목을 입력해주세요.");
                return;
            }
            
            var storedIssues = JSON.parse(localStorage.getItem('aps_project_issues') || '[]');
            
            window.compressImg(imgSrc, function(compressedImg) {
                var newIssue = {
                    id: Date.now(),
                    title: title,
                    description: desc,
                    dbId: dbId,
                    image: compressedImg,
                    img: compressedImg,
                    date: new Date().toLocaleString(),
                    issueType: typeVal,
                    startDate: startDateVal,
                    endDate: endDateVal,
                    status: '생성',
                    user: '지정되지 않음',
                    assignee: '지정되지 않음',
                    structure: (function() {
                        var fallbackStructure = '강북_구조물_신설_03';
                        var viewer = window.viewer || window.NOP_VIEWER || window.overlayViewer || (window.app && window.app.getCurrentViewer ? window.app.getCurrentViewer() : null);
                        if (viewer && viewer.model && typeof viewer.model.getDocumentNode === 'function') {
                            var docNode = viewer.model.getDocumentNode();
                            var realDocName = "";
                            if (docNode && docNode.data) realDocName = docNode.data.name || docNode._name || "";
                            if (realDocName) {
                                if (realDocName.indexOf('.') > -1) realDocName = realDocName.substring(0, realDocName.lastIndexOf('.'));
                                fallbackStructure = realDocName.trim();
                            }
                        }
                        return fallbackStructure;
                    })(),
                    file: '강북_구조물_신설_03',
                    version: 'v5'
                };
                
                storedIssues.push(newIssue);
                localStorage.setItem('aps_project_issues', JSON.stringify(storedIssues));
                
                if (!window.createdIssues) window.createdIssues = [];
                window.createdIssues.push(newIssue);
                
                if (typeof window.renderIssueList === 'function') {
                    window.renderIssueList();
                }
                closeIssuePopup();
                alert("이슈가 성공적으로 등록되었습니다.");
                
                var tabBtnIssues = document.getElementById('tab-btn-issues');
                if (tabBtnIssues) {
                    tabBtnIssues.click();
                }
            });
        };
    }
}

// 🚨 탭 전환 이벤트 리스너 (전역 스코프)
document.addEventListener('click', function(e) {
    if (e.target.id === 'tab-btn-results' || e.target.id === 'tab-btn-issues') {
        var isResultTab = e.target.id === 'tab-btn-results';

        // 스타일 토글
        document.getElementById('tab-btn-results').style.background = isResultTab ? 'var(--accent-color)' : 'transparent';
        document.getElementById('tab-btn-results').style.color = isResultTab ? '#0b0f19' : '#fff';
        document.getElementById('tab-btn-issues').style.background = !isResultTab ? 'var(--accent-color)' : 'transparent';
        document.getElementById('tab-btn-issues').style.color = !isResultTab ? '#0b0f19' : '#fff';

        // 내용 토글
        document.getElementById('content-results').style.display = isResultTab ? 'flex' : 'none';
        document.getElementById('content-issues').style.display = isResultTab ? 'none' : 'block';

        // 탭 변경에 따른 PDF 버튼 활성화 스위칭 로직 추가
        var pdfResultsBtn = document.getElementById('btn-export-pdf');
        var pdfIssuesBtn = document.getElementById('btn-export-pdf-issues');

        if (pdfResultsBtn && pdfIssuesBtn) {
            pdfResultsBtn.style.display = isResultTab ? 'flex' : 'none';
            pdfIssuesBtn.style.display = !isResultTab ? 'flex' : 'none';
        }
    }
});

// 🚨 Blob URL -> Base64 변환 유틸리티 (로컬 스토리지 용량 절약을 위해 JPEG 압축)
window.convertBlobToBase64 = function(url, callback) {
    var img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = function() {
        var canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        var ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0);
        // 용량 절약을 위해 WebP 및 0.9 품질로 압축 (JPEG fallback)
        var dataURL = canvas.toDataURL('image/webp', 0.9);
        if (!dataURL || dataURL.indexOf('data:image/webp') === -1) {
            dataURL = canvas.toDataURL('image/jpeg', 0.9);
        }
        callback(dataURL);
    };
    img.onerror = function() {
        callback(url); // 변환 실패 시 원본 반환 (Fallback)
    };
    img.src = url;
};

// 🚨 이슈 목록 렌더링 및 이동 로직
window.createdIssues = window.createdIssues || [];

// 🚨 상세 조회 및 상태 수정 팝업 로직
window.openIssueDetailPopup = function(issueId) {
    var issues = JSON.parse(localStorage.getItem('aps_project_issues') || '[]');
    var target = issues.find(function(item) { return String(item.id) === String(issueId); });
    if (!target) return;

    var savedAssignee = target.assignee || "미지정";
    if (savedAssignee === "미정") savedAssignee = "미지정";

    // Active row styling
    document.querySelectorAll('.issue-table-row').forEach(function(r) {
        if (r.getAttribute('data-id') === String(issueId)) {
            r.classList.add('active-row');
        } else {
            r.classList.remove('active-row');
        }
    });

    window.currentActiveIssue = target;

    // 상세 조회 시 뷰어에서도 자동으로 해당 객체를 포커싱/선택
    if (typeof window.focusOnIssue === 'function' && target.objectId) {
        window.focusOnIssue(target.objectId);
    }

    var verB = target.verBefore || "ver.00";
    var verA = target.verAfter || "ver.00";
    var currentStatus = target.status || '검토중';

    var popup = document.getElementById('issue-detail-popup');
    if (!popup) {
        popup = document.createElement('div');
        popup.id = 'issue-detail-popup';
        document.body.appendChild(popup);
    }

    var fallbackImg = "https://placehold.co/400x250/1e293b/94a3b8?text=Image+Expired";
    popup.style.cssText = "position: fixed !important; top: 50% !important; left: 50% !important; transform: translate(-50%, -50%) !important; background: #ffffff !important; border-radius: 8px !important; z-index: 1000000 !important; box-shadow: 0 10px 40px rgba(0,0,0,0.5) !important; width: 900px !important; max-width: 90vw !important; display: flex !important; flex-direction: column !important; overflow: hidden !important; font-family: 'Noto Sans KR', sans-serif !important;";

    popup.innerHTML = 
        "<div style='background: #1e2b4d; padding: 10px 20px; display: flex; justify-content: space-between; align-items: center;'>" +
        "  <div style='color: white; font-weight: bold; font-size: 14px;'>이슈 상세 정보 (객체 ID: " + (target.objectId || '-') + ")</div>" +
        "  <span onclick='document.getElementById(\"issue-detail-popup\").style.display=\"none\"' style='color: white; font-size: 24px; cursor: pointer; line-height: 1;'>&times;</span>" +
        "</div>" +
        "<div style='display: flex; background: #f1f5f9; border-bottom: 1px solid #cbd5e1;'>" +
        "  <div style='flex: 1; padding: 15px; border-right: 1px solid #cbd5e1; text-align: center;'>" +
        "    <div style='color: #1e293b; font-size: 14px; margin-bottom: 10px; font-weight: bold;'>변경 전 (Before) - <span style='color: #ef4444;'>" + verB + "</span></div>" +
        "    <img src='" + target.imgBefore + "' onerror='this.onerror=null; this.src=\"" + fallbackImg + "\";' style='width: 100%; height: auto; max-height: 250px; object-fit: contain; background: #e2e8f0; border-radius: 4px;'>" +
        "  </div>" +
        "  <div style='flex: 1; padding: 15px; text-align: center;'>" +
        "    <div style='color: #1e293b; font-size: 14px; margin-bottom: 10px; font-weight: bold;'>변경 후 (After) - <span style='color: #10b981;'>" + verA + "</span></div>" +
        "    <img src='" + target.imgAfter + "' onerror='this.onerror=null; this.src=\"" + fallbackImg + "\";' style='width: 100%; height: auto; max-height: 250px; object-fit: contain; background: #e2e8f0; border-radius: 4px;'>" +
        "  </div>" +
        "</div>" +
        "<div style='display: flex; background: #1e2b4d; padding: 20px; gap: 20px;'>" +
        "  <div style='flex: 1;'>" +
        "    <div style='color: #94a3b8; font-size: 12px; margin-bottom: 8px;'>검토 내용</div>" +
        "    <textarea id='detail-issue-review' style='width: 100%; height: 80px; background: #0f172a; color: white; border: 1px solid #334155; padding: 10px; box-sizing: border-box; resize: none; border-radius: 4px;'>" + (target.reviewDesc || target.reviewContent || target.desc || '') + "</textarea>" +
        "  </div>" +
        "  <div style='flex: 1;'>" +
        "    <div style='color: #94a3b8; font-size: 12px; margin-bottom: 8px;'>변경 내용</div>" +
        "    <textarea id='detail-issue-change' style='width: 100%; height: 80px; background: #0f172a; color: white; border: 1px solid #334155; padding: 10px; box-sizing: border-box; resize: none; border-radius: 4px;'>" + (target.changeDesc || target.changeContent || target.description || '') + "</textarea>" +
        "  </div>" +
        "</div>" +
        "<div style='padding: 20px; background: white; display: flex; flex-direction: column; gap: 15px;'>" +
        "  <div>" +
        "    <div style='color: #64748b; font-size: 12px; margin-bottom: 5px; font-weight: bold;'>제목</div>" +
        "    <input type='text' id='detail-issue-title' value='" + (target.title || '') + "' style='width: 100%; padding: 10px; background: #0f172a; color: white; border: none; border-radius: 4px; box-sizing: border-box; outline: none;'>" +
        "  </div>" +
        "  <div class='form-group' style='margin-bottom: 12px;'>" +
        "    <label style='display: block; font-size: 13px; color: #94a3b8; margin-bottom: 4px;'>유형</label>" +
        "    <select id='compare-issue-type' class='form-control custom-select' style='width: 100%; background: #0f172a; border: 1px solid #334155; border-radius: 4px; padding: 10px; color: white; font-size: 13px; box-sizing: border-box;'>" +
        "      <option value='간섭'>간섭</option>" +
        "      <option value='설계 검토'>설계 검토</option>" +
        "      <option value='도면 정합성'>도면 정합성</option>" +
        "    </select>" +
        "  </div>" +
        "  <div style='display: flex; gap: 20px;'>" +
        "    <div style='flex: 1;'>" +
        "      <div style='color: #64748b; font-size: 12px; margin-bottom: 5px; font-weight: bold;'>담당자</div>" +
        "      <select id='detail-issue-assignee' style='width: 100%; padding: 10px; background: #0f172a; color: white; border: none; border-radius: 4px; box-sizing: border-box; outline: none;'>" +
        "        <option value='" + savedAssignee + "'>" + savedAssignee + "</option>" +
        "      </select>" +
        "    </div>" +
        "    <div style='flex: 1;'>" +
        "      <div style='color: #64748b; font-size: 12px; margin-bottom: 5px; font-weight: bold;'>상태 (Status)</div>" +
        "      <select id='detail-issue-status' style='width: 100%; padding: 10px; background: #f59e0b; color: white; border: none; border-radius: 4px; box-sizing: border-box; outline: none; font-weight: bold;'>" +
        "        <option value='검토중' " + (currentStatus === '검토중' ? 'selected' : '') + ">검토중</option>" +
        "        <option value='조치완료' " + (currentStatus === '조치완료' ? 'selected' : '') + ">조치완료</option>" +
        "        <option value='반영제외' " + (currentStatus === '반영제외' ? 'selected' : '') + ">반영제외</option>" +
        "      </select>" +
        "    </div>" +
        "  </div>" +
        "  <div style='display: flex; gap: 20px;'>" +
        "    <div style='flex: 1;'>" +
        "      <div style='color: #64748b; font-size: 12px; margin-bottom: 5px; font-weight: bold;'>구조물명</div>" +
        "      <input type='text' id='detail-issue-structure' value='" + (target.structure || '') + "' style='width: 100%; padding: 10px; background: #0f172a; color: white; border: none; border-radius: 4px; box-sizing: border-box; outline: none;'>" +
        "    </div>" +
        "    <div style='flex: 1;'>" +
        "      <div style='color: #64748b; font-size: 12px; margin-bottom: 5px; font-weight: bold;'>작업 구분</div>" +
        "      <input type='text' id='detail-issue-trade' value='" + (target.trade || '') + "' style='width: 100%; padding: 10px; background: #0f172a; color: white; border: none; border-radius: 4px; box-sizing: border-box; outline: none;'>" +
        "    </div>" +
        "  </div>" +
        "</div>" +

        "<div style='padding: 15px 20px; background: white; display: flex; justify-content: flex-end; gap: 20px; border-top: 1px solid #e2e8f0;'>" +
        "  <button onclick='document.getElementById(\"issue-detail-popup\").style.display=\"none\"' style='background: transparent; color: #94a3b8; border: none; font-weight: bold; cursor: pointer; padding: 10px 15px; font-size: 14px;'>닫기</button>" +
        "  <button id='btn-update-issue' style='background: #10b981; color: white; border: none; border-radius: 6px; padding: 10px 30px; font-weight: bold; cursor: pointer; font-size: 14px; box-shadow: 0 4px 6px rgba(16,185,129,0.3);'>수정 저장</button>" +
        "</div>";

    popup.style.display = 'flex';

    var targetSelect = document.getElementById('detail-issue-assignee');
    if (typeof window.loadProjectMembersIntoSelect === 'function') {
        window.loadProjectMembersIntoSelect(targetSelect, savedAssignee);
    }

    setTimeout(function() {
        var typeSelect = document.getElementById('compare-issue-type');
        var savedType = target.type || "간섭";
        
        // 설계이슈(과거 데이터)가 설계 검토로 변경된 것에 대한 폴백 처리
        if (savedType === "설계이슈") savedType = "설계 검토";
        
        if (typeSelect) {
            typeSelect.value = savedType;
        }
    }, 100);

    document.getElementById('btn-update-issue').onclick = function() {
        var idx = issues.findIndex(function(item) { return String(item.id) === String(issueId); });
        if (idx !== -1) {
            var updatedTitle = document.getElementById('detail-issue-title').value;
            var updatedReview = document.getElementById('detail-issue-review').value;
            var updatedChange = document.getElementById('detail-issue-change').value;
            var updatedAssignee = document.getElementById('detail-issue-assignee').value;
            var updatedStatus = document.getElementById('detail-issue-status').value;
            var updatedStructure = document.getElementById('detail-issue-structure').value;
            var updatedTrade = document.getElementById('detail-issue-trade').value;

            issues[idx].title = updatedTitle;
            issues[idx].reviewDesc = updatedReview;
            issues[idx].changeDesc = updatedChange;
            issues[idx].reviewContent = updatedReview;
            issues[idx].changeContent = updatedChange;
            issues[idx].desc = updatedReview;
            issues[idx].description = updatedChange;
            issues[idx].assignee = updatedAssignee;
            issues[idx].status = updatedStatus;
            issues[idx].structure = updatedStructure;
            issues[idx].trade = updatedTrade;

            try {
                localStorage.setItem('aps_project_issues', JSON.stringify(issues));
            } catch(e) {
                for (var i = 0; i < issues.length; i++) {
                    issues[i].img = ""; issues[i].imgBefore = ""; issues[i].imgAfter = "";
                }
                try { localStorage.setItem('aps_project_issues', JSON.stringify(issues)); } catch(err) {}
            }

            var compListStr = localStorage.getItem('my_saved_compare_issues');
            if (compListStr) {
                try {
                    var compList = JSON.parse(compListStr);
                    var compIdx = compList.findIndex(function(item) { return String(item.id) === String(issueId); });
                    if (compIdx !== -1) {
                        compList[compIdx].title = updatedTitle;
                        compList[compIdx].reviewDesc = updatedReview;
                        compList[compIdx].changeDesc = updatedChange;
                        compList[compIdx].reviewContent = updatedReview;
                        compList[compIdx].changeContent = updatedChange;
                        compList[compIdx].desc = updatedReview;
                        compList[compIdx].description = updatedChange;
                        compList[compIdx].assignee = updatedAssignee;
                        compList[compIdx].status = updatedStatus;
                        compList[compIdx].structure = updatedStructure;
                        compList[compIdx].trade = updatedTrade;

                        try {
                            localStorage.setItem('my_saved_compare_issues', JSON.stringify(compList));
                        } catch(e2) {
                            for (var j = 0; j < compList.length; j++) {
                                compList[j].img = ""; compList[j].imgBefore = ""; compList[j].imgAfter = "";
                            }
                            try { localStorage.setItem('my_saved_compare_issues', JSON.stringify(compList)); } catch(err2) {}
                        }
                    }
                } catch(errComp) {}
            }

            popup.style.display = 'none';
            if (typeof window.renderIssueList === 'function') window.renderIssueList();
            if (typeof window.renderIssueTable === 'function') window.renderIssueTable();
        }
    };

    document.getElementById('detail-issue-status').onchange = function(e) {
        var val = e.target.value;
        e.target.style.background = val === '조치완료' ? '#10b981' : (val === '반영제외' ? '#ef4444' : '#f59e0b');
    };
    document.getElementById('detail-issue-status').dispatchEvent(new Event('change'));
};

window.focusOnIssue = function(dbId) {
    if (window.overlayViewer) {
        window.overlayViewer.select([dbId]);
        window.overlayViewer.fitToView([dbId]);
    }
};

// 🚨 전역 컬럼 상태 및 순서 배열 정의 (최초 1회 설정)
if (typeof window.issueColumnState === 'undefined') {
    window.issueColumnState = { title: true, id: false, status: true, type: false, user: true, dueDate: true, startDate: true, deploy: true };
}
if (typeof window.issueColumnOrder === 'undefined') {
    window.issueColumnOrder = ['title', 'id', 'status', 'type', 'user', 'dueDate', 'startDate', 'deploy'];
}

(function injectIssueGridStyles() {
    var existingStyle = document.getElementById('issue-grid-custom-styles');
    if (existingStyle) { existingStyle.parentNode.removeChild(existingStyle); }

    var style = document.createElement('style');
    style.id = 'issue-grid-custom-styles';
    
    var css = "";
    css = css + ".issue-list-container { width: 100%; background: #0f172a; color: #f8fafc; font-size: 13px; border-collapse: collapse; position: relative; }\n";
    css = css + ".issue-table-header { display: flex; align-items: center; padding: 10px 16px; border-bottom: 2px solid #334155; color: #94a3b8; font-weight: 600; background: #0f172a; text-align: left; position: relative; }\n";
    css = css + ".issue-table-row { display: flex; align-items: center; padding: 12px 16px; border-bottom: 1px solid #1e293b; background: transparent; transition: background 0.2s; text-align: left; }\n";
    css = css + ".issue-table-row:hover { background: #1e293b; }\n";
    css = css + ".issue-table-row.active { background: #1e293b !important; border-left: 3px solid #0284c7 !important; }\n";
    css = css + ".col-check { width: 40px; flex-shrink: 0; display: flex; justify-content: center; align-items: center; }\n";
    css = css + ".col-menu { width: 40px; flex-shrink: 0; text-align: right; color: #64748b; cursor: pointer; display: flex; justify-content: flex-end; font-size: 16px; }\n";
    
    css = css + ".col-title { flex: 2; min-width: 100px; font-weight: 500; color: #f8fafc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n";
    css = css + ".col-id { flex: 0.8; min-width: 60px; color: #64748b; font-weight: 500; }\n";
    css = css + ".col-status { flex: 1; min-width: 80px; display: flex; align-items: center; color: #f97316; font-weight: 500; }\n";
    css = css + ".col-type { flex: 1.2; min-width: 90px; color: #94a3b8; display: flex; align-items: center; }\n";
    css = css + ".col-user { flex: 1.5; min-width: 110px; color: #cbd5e1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n";
    css = css + ".col-duedate { flex: 1.1; min-width: 90px; color: #64748b; }\n";
    css = css + ".col-startdate { flex: 1.1; min-width: 90px; color: #64748b; }\n";
    css = css + ".col-deploy { flex: 2.2; color: #0284c7; display: flex; align-items: center; gap: 8px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n";
    
    css = css + ".status-bar-indicator { width: 2px; height: 12px; background: #f97316; margin-right: 8px; display: inline-block; }\n";
    css = css + ".version-capsule { background: #1e293b; color: #94a3b8; padding: 1px 6px; border-radius: 10px; font-size: 11px; font-weight: 500; flex-shrink: 0; border: 1px solid #334155; }\n";
    
    // 🚨 탭 내부 잘림 방지를 위해 fixed 요소를 body 밀착형으로 격리 및 transform 제거
    css = css + ".column-toggle-backdrop { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.5); z-index: 99998; display: none; }\n";
    css = css + ".column-toggle-popup { position: fixed; background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 20px; z-index: 99999; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.8); display: none; flex-direction: column; gap: 4px; min-width: 260px; }\n";
    
    // 🚨 헤더 영역 마우스 잡기(move) 커서 디자인 적용
    css = css + ".popup-centered-header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155; padding-bottom: 10px; margin-bottom: 10px; font-size: 14px; font-weight: 600; color: #f8fafc; cursor: move; user-select: none; }\n";
    css = css + ".popup-close-x-btn { background: none; border: none; color: #64748b; font-size: 18px; cursor: pointer; line-height: 1; padding: 0 4px; }\n";
    css = css + ".popup-close-x-btn:hover { color: #f8fafc; }\n";
    
    css = css + ".column-toggle-item { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: #cbd5e1; font-size: 12px; padding: 5px 0; border-bottom: 1px solid #273549; }\n";
    css = css + ".column-toggle-item:last-child { border-bottom: none; }\n";
    css = css + ".column-toggle-left { display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; }\n";
    css = css + ".column-toggle-left input { cursor: pointer; accent-color: #0284c7; width: 14px; height: 14px; }\n";
    css = css + ".column-order-btns { display: flex; gap: 4px; }\n";
    css = css + ".column-order-btn { background: #334155; color: #94a3b8; border: none; border-radius: 3px; width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; font-size: 9px; cursor: pointer; transition: all 0.15s; }\n";
    css = css + ".column-order-btn:hover { background: #0284c7; color: #ffffff; }";
    
    style.innerHTML = css;
    document.head.appendChild(style);
})();

// 🚨 활성 행 하이라이트 스타일 추가
(function injectActiveRowStyle() {
    var id = 'issue-active-row-style';
    if (!document.getElementById(id)) {
        var style = document.createElement('style');
        style.id = id;
        style.innerHTML = ".issue-table-row.active-row { background: #1e293b !important; border-left: 4px solid #0284c7 !important; }\n" +
                          ".issue-table-row { border-left: 4px solid transparent; cursor: pointer; }";
        document.head.appendChild(style);
    }
})();

window.renderIssueList = function(issues) {
    var container = document.getElementById('issue-list-tab-panel') || document.querySelector('.issue-list-wrapper') || document.getElementById('content-issues');
    if (!container) return;

    // Reset default container paddings/margins to fit high-density table perfectly
    container.style.padding = "0";
    container.style.margin = "0";
    container.style.width = "100%";

    var rawList = issues && issues.length > 0 ? issues : JSON.parse(localStorage.getItem('my_saved_compare_issues') || '[]');
    var strictCompareList = rawList.filter(function(issue) {
        if (!issue) return false;
        var isCompare = String(issue.id || "").indexOf('COMP-') === 0 || issue._type === 'compare' || issue.type === 'compare';
        return isCompare; // 🚨 단독 이슈(ISSUE-)는 여기서 false로 판정되어 화면 조립에서 완전 탈락됨
    });

    var issueItems = strictCompareList;

    // 🚨 [일괄 출력 치트키] 현재 로드된 이슈 리스트 전체를 글로벌 스코프에 박제 저장
    window.currentIssueList = issueItems;

    // 최초 진입 시 첫 번째 이슈를 기본 활성 이슈로 낙점
    if (!window.currentActiveIssue) {
        window.currentActiveIssue = issueItems[0];
    }

    var state = window.issueColumnState;
    var order = window.issueColumnOrder;
    var labels = { title: "제목", id: "ID", status: "상태", type: "유형", user: "담당자", dueDate: "마감일", startDate: "시작 날짜", deploy: "배치" };
    
    // 🚨 [가시성 탈출] 팝업 레이아웃을 document.body에 상주시켜 탭 밖으로 완전 독립화
    var backdrop = document.getElementById('column-toggle-backdrop');
    var togglePopup = document.getElementById('column-toggle-popup');
    
    if (!backdrop) {
        backdrop = document.createElement('div');
        backdrop.id = 'column-toggle-backdrop';
        backdrop.className = 'column-toggle-backdrop';
        document.body.appendChild(backdrop);
    }
    if (!togglePopup) {
        togglePopup = document.createElement('div');
        togglePopup.id = 'column-toggle-popup';
        togglePopup.className = 'column-toggle-popup';
        document.body.appendChild(togglePopup);
    }

    var popupHtml = "";
    popupHtml = popupHtml + "    <div class='popup-centered-header' id='popup-drag-handle'>";
    popupHtml = popupHtml + "      <span>이슈 목록 항목 설정</span>";
    popupHtml = popupHtml + "      <button id='popup-close-x' class='popup-close-x-btn'>&times;</button>";
    popupHtml = popupHtml + "    </div>";
    
    order.forEach(function(key, idx) {
        var isChecked = state[key] ? "checked" : "";
        popupHtml = popupHtml + "    <div class='column-toggle-item'>";
        popupHtml = popupHtml + "      <label class='column-toggle-left'>";
        popupHtml = popupHtml + "        <input type='checkbox' data-column='" + key + "' " + isChecked + "> " + labels[key];
        popupHtml = popupHtml + "      </label>";
        popupHtml = popupHtml + "      <div class='column-order-btns'>";
        popupHtml = popupHtml + "        <button class='column-order-btn btn-move-up' data-index='" + idx + "'>▲</button>";
        popupHtml = popupHtml + "        <button class='column-order-btn btn-move-down' data-index='" + idx + "'>▼</button>";
        popupHtml = popupHtml + "      </div>";
        popupHtml = popupHtml + "    </div>";
    });
    togglePopup.innerHTML = popupHtml;

    // 테이블 리스트 마크업 생성
    var html = "";
    html = html + "<div class='issue-list-container'>";
    html = html + "  <div class='issue-table-header'>";
    html = html + "    <div class='col-check'><input type='checkbox'></div>";
    order.forEach(function(key) {
        if (state[key]) {
            var className = key === "dueDate" ? "col-duedate" : (key === "startDate" ? "col-startdate" : "col-" + key);
            html = html + "    <div class='" + className + "'>" + labels[key] + "</div>";
        }
    });
    html = html + "    <div class='col-menu' id='issue-cog-trigger'><i class='fas fa-cog'></i></div>";
    html = html + "  </div>";

    issueItems.forEach(function(item, idx) {
        var displayId = item.id ? (String(item.id).indexOf('#') === 0 ? item.id : "#" + item.id) : "#00";
        var displayUser = item.user || item.assignee || "-";
        var normalizeDate = function(dStr) {
            if (!dStr || dStr === "-") return "-";
            var d = dStr;
            if (d.indexOf('T') > -1) {
                d = d.split('T')[0];
            }
            d = d.replace(/\s*(오전|오후|AM|PM)?\s*\d{1,2}:\d{2}(:\d{2})?.*/i, "");
            d = d.trim();
            if (d.indexOf('.') > -1) {
                var pts = d.split('.');
                var cPts = [];
                for (var i = 0; i < pts.length; i++) {
                    var pTrim = pts[i].trim();
                    if (pTrim) cPts.push(pTrim);
                }
                if (cPts.length >= 3) {
                    var y = cPts[0];
                    var m = cPts[1].length === 1 ? "0" + cPts[1] : cPts[1];
                    var day = cPts[2].length === 1 ? "0" + cPts[2] : cPts[2];
                    d = y + "-" + m + "-" + day;
                }
            } else if (d.indexOf('/') > -1) {
                var pts = d.split('/');
                var cPts = [];
                for (var i = 0; i < pts.length; i++) {
                    var pTrim = pts[i].trim();
                    if (pTrim) cPts.push(pTrim);
                }
                if (cPts.length >= 3) {
                    var y = cPts[0];
                    var m = cPts[1].length === 1 ? "0" + cPts[1] : cPts[1];
                    var day = cPts[2].length === 1 ? "0" + cPts[2] : cPts[2];
                    d = y + "-" + m + "-" + day;
                }
            }
            return d;
        };

        var displayStartDate = normalizeDate(item.startDate || item.date || item.createdAt || "-");
        var displayEndDate = normalizeDate(item.endDate || item.date || item.createdAt || "-");
        var displayFile = item.file || item.structure || "알 수 없는 파일";
        var displayVersion = item.versionAfter || item.version || (item.verAfter ? item.verAfter.replace('ver.', 'v').replace(/^v0/, 'v') : "v1");
        var displayType = item.type || item.issueType || "Coordination";
        if (displayType.toLowerCase() === 'clash') {
            displayType = '간섭';
        } else if (displayType.toLowerCase() === 'single') {
            displayType = '단독';
        } else if (displayType.toLowerCase() === 'compare') {
            displayType = '비교';
        } else if (displayType.toLowerCase() === 'coordination') {
            displayType = '협업';
        } else if (displayType.toLowerCase() === 'design') {
            displayType = '설계 변경';
        }

        var isActiveClass = (window.currentActiveIssue && window.currentActiveIssue.id === item.id) ? "active-row" : "";

        html = html + "  <div class='issue-table-row " + isActiveClass + "' data-id='" + (item.id || 0) + "' data-index='" + idx + "' onclick='window.openIssueDetailPopup(\"" + (item.id || 0) + "\")' style='cursor: pointer;'>";
        html = html + "    <div class='col-check' onclick='event.stopPropagation();'><input type='checkbox'></div>";
        
        order.forEach(function(key) {
            if (state[key]) {
                if (key === 'title') html = html + "    <div class='col-title'>" + (item.title || "Clash") + "</div>";
                if (key === 'id') html = html + "    <div class='col-id'>" + displayId + "</div>";
                if (key === 'status') html = html + "    <div class='col-status'><span class='status-bar-indicator'></span>" + (item.status || "생성") + "</div>";
                if (key === 'type') html = html + "    <div class='col-type'>" + displayType + "</div>";
                if (key === 'user') html = html + "    <div class='col-user'>" + displayUser + "</div>";
                if (key === 'dueDate') {
                    html = html + "    <div class='col-duedate' style='display: flex; justify-content: space-between; align-items: center; padding-right: 8px;'>";
                    html = html + "      <span>" + displayEndDate + "</span>";
                    html = html + "      <span class='compare-popup-delete-trigger' data-del-id='" + (item.id || item.dbId || 0) + "' style='color: #ef4444; margin-left: 8px; cursor: pointer; font-weight: bold; padding: 2px 4px;' title='이슈 삭제'>🗑️</span>";
                    html = html + "    </div>";
                }
                if (key === 'startDate') html = html + "    <div class='col-startdate'>" + displayStartDate + "</div>";
                if (key === 'deploy') html = html + "    <div class='col-deploy'>" + displayFile + "</div>";
            }
        });
        
        html = html + "    <div class='col-menu' onclick='event.stopPropagation();'>&#8942;</div>";
        html = html + "  </div>";
    });

    html = html + "</div>";
    container.innerHTML = html;

    // 🚨 [행 클릭 리스너 핵심 결합] 사용자가 선택한 이슈 행의 실제 메타데이터를 전역 동기화
    var rows = container.querySelectorAll('.issue-table-row');
    rows.forEach(function(row) {
        row.addEventListener('click', function() {
            rows.forEach(function(r) { r.classList.remove('active-row'); });
            this.classList.add('active-row');
            var selectedIndex = parseInt(this.getAttribute('data-index'));
            window.currentActiveIssue = issueItems[selectedIndex];
        });
    });

    // E. 🚨 [이동&트래킹] 중앙 정렬 오픈 및 완벽한 마우스 마스터 드래그 시스템 이식
    var cogTrigger = document.getElementById('issue-cog-trigger');
    var closeX = document.getElementById('popup-close-x');

    function openModal() {
        togglePopup.style.display = 'flex';
        backdrop.style.display = 'block';
        // 최초 오픈 시 화면의 완전 정중앙 좌표 수식 연산 고정 (transform 대안)
        if (!togglePopup.style.left) {
            togglePopup.style.left = ((window.innerWidth - togglePopup.offsetWidth) / 2) + 'px';
            togglePopup.style.top = ((window.innerHeight - togglePopup.offsetHeight) / 2) + 'px';
        }
    }

    function closeModal() {
        togglePopup.style.display = 'none';
        backdrop.style.display = 'none';
    }

    if (cogTrigger) { cogTrigger.addEventListener('click', function(e) { e.stopPropagation(); openModal(); }); }
    if (closeX) { closeX.addEventListener('click', function(e) { e.stopPropagation(); closeModal(); }); }
    if (backdrop) { backdrop.addEventListener('click', function(e) { e.stopPropagation(); closeModal(); }); }

    // 🚨 마우스 드래그 이동 기능 실시간 바인딩 엔진
    var dragHandle = document.getElementById('popup-drag-handle');
    if (dragHandle && !dragHandle.dataset.dragBound) {
        dragHandle.dataset.dragBound = "true";
        var isDragging = false;
        var offsetX = 0, offsetY = 0;

        dragHandle.addEventListener('mousedown', function(e) {
            if (e.target.id === 'popup-close-x') return; // X버튼 클릭 시 드래그 방지
            isDragging = true;
            offsetX = e.clientX - togglePopup.offsetLeft;
            offsetY = e.clientY - togglePopup.offsetTop;
            e.preventDefault();
        });

        document.addEventListener('mousemove', function(e) {
            if (!isDragging) return;
            togglePopup.style.left = (e.clientX - offsetX) + 'px';
            togglePopup.style.top = (e.clientY - offsetY) + 'px';
        });

        document.addEventListener('mouseup', function() {
            isDragging = false;
        });
    }

    // 컬럼 체크박스 동적 동기화
    var cbs = togglePopup.querySelectorAll('input[type="checkbox"]');
    cbs.forEach(function(cb) {
        cb.addEventListener('change', function() {
            window.issueColumnState[this.getAttribute('data-column')] = this.checked;
            window.renderIssueList(issues);
            document.getElementById('column-toggle-popup').style.display = 'flex';
            document.getElementById('column-toggle-backdrop').style.display = 'block';
        });
    });

    // ▲ 상하 위치이동 리스너 세트
    togglePopup.querySelectorAll('.btn-move-up').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var idx = parseInt(this.getAttribute('data-index'));
            if (idx > 0) {
                var temp = window.issueColumnOrder[idx];
                window.issueColumnOrder[idx] = window.issueColumnOrder[idx - 1];
                window.issueColumnOrder[idx - 1] = temp;
                window.renderIssueList(issues);
                document.getElementById('column-toggle-popup').style.display = 'flex';
                document.getElementById('column-toggle-backdrop').style.display = 'block';
            }
        });
    });

    togglePopup.querySelectorAll('.btn-move-down').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var idx = parseInt(this.getAttribute('data-index'));
            if (idx < window.issueColumnOrder.length - 1) {
                var temp = window.issueColumnOrder[idx];
                window.issueColumnOrder[idx] = window.issueColumnOrder[idx + 1];
                window.issueColumnOrder[idx + 1] = temp;
                window.renderIssueList(issues);
                document.getElementById('column-toggle-popup').style.display = 'flex';
                document.getElementById('column-toggle-backdrop').style.display = 'block';
            }
        });
    });
};

// 하위 호환성을 위한 헬퍼 에일리어스
window.renderIssuesList = function() {
    if (typeof window.renderIssueList === 'function') {
        window.renderIssueList();
    }
};

window.renderCompareIssueTable = function(issues) {
    if (typeof window.renderIssueList === 'function') {
        window.renderIssueList(issues);
    }
};

// 탭을 처음 열 때 기존 저장된 목록을 불러오기 위해 초기 1회 실행
setTimeout(function() {
    if (typeof window.renderIssueList === 'function') window.renderIssueList();
}, 1000);

function showLoading(show, message = '로딩 중...') {
    const overlay = document.getElementById('overlay');
    if (!overlay) return;
    if (show) {
        overlay.style.display = 'flex';
        overlay.innerHTML = `<div class="notification"><i class="fas fa-spinner fa-spin"></i> ${message}</div>`;
    } else {
        overlay.style.display = 'none';
    }
}

// ── ModelComparison Class ──────────────────────────────────────────────────
class ModelComparison {
    constructor() {
        this._running = false;
        setupComparisonControls();
    }

    async startComparison(versionA, versionB) {
        // 🚨 레이아웃 토글: 파일 목록 숨김 및 뷰어 영역 확장
        toggleCompareLayout(true);

        // 🚨 뷰어 초기화 전 DOM 강제 표시 로직 주입 (clientWidth 0 방지)
        document.body.classList.add('comparison-active');
        const compContainer = document.getElementById('comparison-container');
        if (compContainer) {
            compContainer.style.display = 'flex';
            compContainer.classList.add('active');
        }
        const compBar = document.getElementById('comparison-bar');
        if (compBar) {
            compBar.style.display = 'flex';
            compBar.classList.add('active');
        }
        const compPanel = document.getElementById('comparison-panel');
        if (compPanel) {
            compPanel.style.display = 'flex';
            compPanel.classList.add('active');
        }
        const previewEl = document.getElementById('preview');
        if (previewEl) {
            previewEl.style.display = 'none';
        }

        if (this._running) {
            console.warn('[Comparison] Already running. Ignoring duplicate call.');
            return;
        }
        this._running = true;

        try {
            // 🚨 기존 메인 뷰어 완벽한 파괴 및 WebGL 컨텍스트 해제
            if (window.viewer) {
                try {
                    window.viewer.finish();
                } catch (e) {
                    console.warn('[Viewer] Main viewer cleanup error:', e);
                }
                window.viewer = null;
            }
            if (window.overlayViewer) {
                try {
                    window.overlayViewer.clearThemingColors();
                    window.overlayViewer.isolate([]);
                    window.overlayViewer.showAll();
                } catch (e) {}
                try { window.overlayViewer.finish(); } catch (e) {
                    console.warn('[Viewer] Overlay viewer cleanup error:', e);
                }
                window.overlayViewer = null;
            }
            window.overlayModelBefore = null;
            window.overlayModelAfter = null;

            window.currentVersionA = versionA;
            window.currentVersionB = versionB;

            const compBarTitle = document.getElementById('comparison-bar-title');
            if (compBarTitle) {
                const vBefore = versionA.versionNumber || versionA.versionId || versionA.name || "00";
                const vAfter = versionB.versionNumber || versionB.versionId || versionB.name || "00";
                let textHtml = "<span style='color: #ef4444; font-weight: bold;'>이전 (ver." + vBefore + ")</span>";
                textHtml += "<span style='color: #9ca3af; margin: 0 10px;'>➔</span>";
                textHtml += "<span style='color: #10b981; font-weight: bold;'>현재 (ver." + vAfter + ")</span>";
                compBarTitle.innerHTML = textHtml;
            }

            window.comparisonUrnA = versionA.viewerUrn;
            window.comparisonUrnB = versionB.viewerUrn;

            disposeSplitViewers();
            updateDynamicViewerLabels();
            await new Promise(resolve => requestAnimationFrame(resolve));

            showLoading(true, '분할 뷰어 초기화 및 모델을 로드 중입니다...');
            await loadVersions(versionA.viewerUrn, versionB.viewerUrn);

            showLoading(true, '로컬 버전 비교 분석 진행 중...');
            
            // Check Project ID
            const pid = window.currentProjectId || '';
            const result = await runDiff(pid, versionA.versionUrn, versionB.versionUrn).catch((err) => {
                console.error('[Comparison] runDiff failed:', err);
                return null;
            });

            if (result && viewers[0] && viewers[1]) {
                initCameraSync(viewers[0], viewers[1]);
                visualizeDiff(result);
            }

            updateViewToggleButtons(false);
            showLoading(false);
        } catch (error) {
            showLoading(false);
            console.warn('[Comparison] Bypassed error:', error);
        } finally {
            this._running = false;
        }
    }
}

// ── Singleton Instance Exposure ────────────────────────────────────────────
if (!window.__MODEL_COMPARISON_SINGLETON__) {
    window.__MODEL_COMPARISON_SINGLETON__ = new ModelComparison();
}
const _comparisonInstance = window.__MODEL_COMPARISON_SINGLETON__;
window.modelComparison = _comparisonInstance;
window.comparisonManager = _comparisonInstance;
window.comparison = _comparisonInstance;

export default _comparisonInstance;

// 🚨 전역 Resizable 이벤트 등록 (Event Delegation 활용 및 Glass Pane 도입)
(function() {
    // 1. 투명 방어막 생성 (뷰어가 마우스를 훔쳐가는 것 차단)
    let glassPane = document.getElementById('resizer-glass-pane');
    if (!glassPane) {
        glassPane = document.createElement('div');
        glassPane.id = 'resizer-glass-pane';
        glassPane.style.cssText = "position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; z-index: 99999; cursor: row-resize; display: none; background: transparent;";
        document.body.appendChild(glassPane);
    }

    let isResizing = false;
    let resizablePanel = null;
    let startY = 0;
    let startHeight = 0;

    // 2. 드래그 시작 (핸들 클릭)
    document.addEventListener('mousedown', function(e) {
        if (e.target && e.target.id === 'panel-resizer') {
            isResizing = true;
            resizablePanel = document.getElementById('comparison-panel') || e.target.closest('#comparison-panel'); 
            startY = e.clientY;
            startHeight = resizablePanel.getBoundingClientRect().height;
            
            // 🚨 유리창 활성화하여 뷰어의 마우스 캡처 완벽 차단
            glassPane.style.display = 'block';
            document.body.style.userSelect = 'none'; // 텍스트 선택 방지
            e.preventDefault();
        }
    });

    // 3. 드래그 중 (유리창 위에서 이벤트 발생)
    document.addEventListener('mousemove', function(e) {
        if (!isResizing || !resizablePanel) return;
        
        const dy = startY - e.clientY;
        let newHeight = startHeight + dy;
        const maxHeight = window.innerHeight * 0.85; // 화면 85% 제한
        
        if (newHeight < 80) newHeight = 80;
        if (newHeight > maxHeight) newHeight = maxHeight;
        
        // 패널 높이 강제 적용 (Flex/Min-height 오버라이드)
        resizablePanel.style.setProperty('height', newHeight + 'px', 'important');
        resizablePanel.style.setProperty('flex', '0 0 ' + newHeight + 'px', 'important'); 
        resizablePanel.style.setProperty('max-height', 'none', 'important');
        
        // 🚨 상단 뷰어 컨테이너가 찌그러지며 공간을 내어주도록 허용
        const overlayViewer = document.getElementById('viewer-overlay');
        const splitWrapper = document.getElementById('viewer-split-wrapper');
        if (overlayViewer) {
            overlayViewer.style.setProperty('flex', '1', 'important');
            overlayViewer.style.setProperty('min-height', '0', 'important');
        }
        if (splitWrapper) {
            splitWrapper.style.setProperty('flex', '1', 'important');
            splitWrapper.style.setProperty('min-height', '0', 'important');
        }
        
        // 뷰어 캔버스 리사이징
        window.dispatchEvent(new Event('resize'));
    });

    // 4. 드래그 종료
    document.addEventListener('mouseup', function(e) {
        if (isResizing) {
            isResizing = false;
            resizablePanel = null;
            
            // 🚨 유리창 치우기 및 기본 상태 복구
            glassPane.style.display = 'none';
            document.body.style.userSelect = '';
            
            // 뷰어 최종 리사이징 동기화
            setTimeout(function() { window.dispatchEvent(new Event('resize')); }, 50);
        }
    });
})();

// 🚨 [안전 추가 로직] 기존 코드를 건드리지 않고 파일 최하단에 독립적으로 추가된 이슈 캡처 핸들러
setTimeout(function() {
    var v = window.overlayViewer;
    if (!v) return;

    v.addEventListener(Autodesk.Viewing.AGGREGATE_SELECTION_CHANGED_EVENT, function(e) {
        try {
            if (v.selectMode !== 'issue-capture') return;
            if (!e.selections || e.selections.length === 0) return;

            var sel = e.selections[0];
            if (!sel || !sel.dbIdArray || sel.dbIdArray.length === 0) return;
            var selectedId = sel.dbIdArray[0];

            var mBefore = window.overlayModelBefore;
            var mAfter  = window.overlayModelAfter;

            if (!mBefore || !mAfter) {
                v.selectMode = null;
                return;
            }

            var w = v.container.clientWidth;
            var h = v.container.clientHeight;

            // 1. After 숨기고 Before만 노출 → 캡처
            v.hide(mAfter.getRootId(), mAfter);
            v.show(mBefore.getRootId(), mBefore);

            setTimeout(function() {
                v.getScreenShot(w, h, function(blobBefore) {

                    // 2. Before 숨기고 After만 노출 → 캡처
                    v.hide(mBefore.getRootId(), mBefore);
                    v.show(mAfter.getRootId(), mAfter);

                    setTimeout(function() {
                        v.getScreenShot(w, h, function(blobAfter) {

                            // 3. 두 모델 모두 원상 복구
                            v.show(mBefore.getRootId(), mBefore);
                            v.show(mAfter.getRootId(), mAfter);

                            // 4. 모드 해제 및 팝업 호출
                            v.selectMode = null;
                            v.clearSelection();

                            if (typeof openSafeIssuePopup === 'function') {
                                openSafeIssuePopup(blobBefore, blobAfter, selectedId);
                            }
                        });
                    }, 300);
                });
            }, 300);

        } catch (err) {
            v.selectMode = null;
        }
    });
}, 3000);

// 🚨 이슈 전용 PDF 버튼 독립 이벤트 핸들러 추가
document.addEventListener('click', function(e) {
    var target = e.target;
    if (target && (target.id === 'btn-export-pdf-issues' || target.closest('#btn-export-pdf-issues'))) {
        if (typeof window.exportIssuesToPdf === 'function') {
            window.exportIssuesToPdf();
        } else {
            alert("이슈 PDF 내보내기 기능이 준비 중입니다.");
        }
    }
});

function initPanelResizable() {
    var handle = document.getElementById('panel-resizer-handle');
    var panel = document.getElementById('bottom-result-panel') || document.getElementById('comparison-panel');
    if (!handle || !panel) return;

    var topSibling = panel.previousElementSibling;

    panel.style.setProperty('top', 'auto', 'important');
    panel.style.setProperty('max-height', 'none', 'important');
    panel.style.setProperty('min-height', '150px', 'important');

    function syncLayout(calculatedHeight) {
        if (calculatedHeight > 150 && calculatedHeight < (window.innerHeight * 0.85)) {
            panel.style.setProperty('height', calculatedHeight + "px", 'important');
            
            var isSplitModeActive = false;
            var splitContainer = document.getElementById('split-view-container') || document.querySelector('[id*="split"]');
            if (splitContainer && (splitContainer.offsetWidth > 0 || splitContainer.offsetHeight > 0)) {
                isSplitModeActive = true;
            }

            if (isSplitModeActive) {
                var viewers = document.querySelectorAll('.adsk-viewing-viewer');
                viewers.forEach(function(vEl) {
                    var p1 = vEl.parentElement; 
                    if (p1 && p1 !== document.body && p1 !== panel) {
                        var rect = p1.getBoundingClientRect();
                        var currentTop = rect.top > 0 ? rect.top : 60; 
                        var targetHeight = window.innerHeight - calculatedHeight - currentTop;
                        if (targetHeight > 50) {
                            p1.style.setProperty('height', targetHeight + 'px', 'important');
                            p1.style.setProperty('bottom', 'auto', 'important');
                        }
                    }
                    var p2 = p1 ? p1.parentElement : null;
                    if (p2 && (p2.id.indexOf('split') !== -1 || p2.className.indexOf('split') !== -1 || p2.id.indexOf('viewer') !== -1)) {
                        var rect2 = p2.getBoundingClientRect();
                        var currentTop2 = rect2.top > 0 ? rect2.top : 60;
                        var targetHeight2 = window.innerHeight - calculatedHeight - currentTop2;
                        if (targetHeight2 > 50) {
                            p2.style.setProperty('height', targetHeight2 + 'px', 'important');
                            p2.style.setProperty('bottom', 'auto', 'important');
                        }
                    }
                });
            } else {
                var overlayViewerInstance = (typeof overlayViewer !== 'undefined' && overlayViewer) ? overlayViewer : 
                                            ((typeof viewer !== 'undefined' && viewer) ? viewer : null);
                                            
                if (overlayViewerInstance && overlayViewerInstance.container) {
                    var current = overlayViewerInstance.container;
                    while (current && current !== document.body && current !== panel) {
                        current.style.setProperty('min-height', '0px', 'important');
                        if (current === overlayViewerInstance.container) {
                            current.style.setProperty('height', '100%', 'important');
                            current.style.setProperty('bottom', '0', 'important');
                        } else if (current !== topSibling) {
                            var r = current.getBoundingClientRect();
                            var cTop = (r.top > 0 && r.top < 150) ? r.top : 60;
                            var h = window.innerHeight - calculatedHeight - cTop;
                            if (h > 50) {
                                current.style.setProperty('height', h + 'px', 'important');
                                current.style.setProperty('bottom', 'auto', 'important');
                                current.style.setProperty('max-height', 'none', 'important');
                            }
                        }
                        if (current === topSibling) break;
                        current = current.parentElement;
                    }
                }
                if (topSibling) {
                    var tRect = topSibling.getBoundingClientRect();
                    var tTop = (tRect.top > 0 && tRect.top < 150) ? tRect.top : 60;
                    var tH = window.innerHeight - calculatedHeight - tTop;
                    if (tH > 50) {
                        topSibling.style.setProperty('height', tH + 'px', 'important');
                        topSibling.style.setProperty('bottom', 'auto', 'important');
                        topSibling.style.setProperty('max-height', 'none', 'important');
                        topSibling.style.setProperty('min-height', '0px', 'important');
                    }
                }
            }
            
            window.dispatchEvent(new Event('resize'));
            
            [30, 120, 350].forEach(function(delay) {
                setTimeout(function() {
                    if (typeof viewer !== 'undefined' && viewer && typeof viewer.resize === 'function') viewer.resize();
                    if (typeof overlayViewer !== 'undefined' && overlayViewer && typeof overlayViewer.resize === 'function') overlayViewer.resize();
                    if (typeof splitViewerBefore !== 'undefined' && splitViewerBefore && typeof splitViewerBefore.resize === 'function') splitViewerBefore.resize();
                    if (typeof splitViewerAfter !== 'undefined' && splitViewerAfter && typeof splitViewerAfter.resize === 'function') splitViewerAfter.resize();
                }, delay);
            });
        }
    }

    setTimeout(function() {
        var initialHeight = panel.offsetHeight || 350;
        syncLayout(initialHeight);
    }, 200);

    document.body.addEventListener('click', function(e) {
        var target = e.target;
        if (target) {
            var hasText = target.innerText && typeof target.innerText === 'string';
            var isModeBtn = hasText && (target.innerText.indexOf('Overlay') !== -1 || target.innerText.indexOf('Split') !== -1);
            
            if (isModeBtn || target.closest('button') || target.tagName === 'BUTTON') {
                [50, 150, 400].forEach(function(delay) {
                    setTimeout(function() {
                        var panel = document.getElementById('bottom-result-panel');
                        var currentHeight = panel ? (panel.offsetHeight || 350) : 350;
                        if (typeof syncLayout === 'function') syncLayout(currentHeight);
                    }, delay);
                });
            }
        }
    });

    handle.addEventListener('mousedown', function(e) {
        e.preventDefault();
        var shield = document.getElementById('panel-resize-shield');
        if (!shield) {
            shield = document.createElement('div');
            shield.id = 'panel-resize-shield';
            shield.style.cssText = "position: fixed; top: 0; left: 0; right: 0; bottom: 0; z-index: 99999; cursor: ns-resize; background: transparent;";
            document.body.appendChild(shield);
        }
        handle.style.background = "#6366f1";
        document.addEventListener('mousemove', startDraggingPanel, false);
        document.addEventListener('mouseup', stopDraggingPanel, false);
    });

    function startDraggingPanel(e) {
        var calculatedHeight = window.innerHeight - e.clientY;
        syncLayout(calculatedHeight);
    }

    function stopDraggingPanel() {
        var shield = document.getElementById('panel-resize-shield');
        if (shield) shield.parentNode.removeChild(shield);
        document.removeEventListener('mousemove', startDraggingPanel, false);
        document.removeEventListener('mouseup', stopDraggingPanel, false);
        handle.style.background = "#374151";
        window.dispatchEvent(new Event('resize'));
    }
}
window.exportIssuesToPdf = function() {
    var pdfBtn = document.getElementById('pdf-export-btn') || 
                 document.querySelector('[class*="pdf"]') || 
                 Array.from(document.querySelectorAll('button')).find(function(b) { 
                     return b.innerText && typeof b.innerText === 'string' && b.innerText.indexOf('PDF') !== -1; 
                 });
    if (pdfBtn) {
        pdfBtn.click();
    }
};

function initPdfExport() {
    var pdfBtn = document.getElementById('pdf-export-btn') || 
                 document.querySelector('[class*="pdf"]') || 
                 Array.from(document.querySelectorAll('button')).find(function(b) { 
                     return b.innerText && typeof b.innerText === 'string' && b.innerText.indexOf('PDF') !== -1; 
                 });
    
    if (!pdfBtn) return;
    
    // 무한 루프 중복 복제 방지 잠금장치
    if (pdfBtn.dataset.pdfCleaned) return;

    // 🚨 [치트키] 버튼을 복제하여 교체 부착함으로써 기존에 걸려있던 '준비중 알림' 리스너를 완벽하게 삭제
    var cleanPdfBtn = pdfBtn.cloneNode(true);
    cleanPdfBtn.dataset.pdfCleaned = "true";
    if (pdfBtn.parentNode) {
        pdfBtn.parentNode.replaceChild(cleanPdfBtn, pdfBtn);
    }

    // 깨끗해진 단독 새 버튼에 인쇄 마스터 이벤트 단독 점화
    cleanPdfBtn.onclick = function(e) {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation(); 
        }

        var issueList = window.currentIssueList;
        if (!issueList || issueList.length === 0) {
            alert('내보낼 이슈 목록 데이터가 비어있습니다.');
            return;
        }

        // 화면 상세창의 실시간 입력값 수집
        var liveReviewElem = document.getElementById('detail-issue-review');
        var liveChangeElem = document.getElementById('detail-issue-change');
        
        var liveReviewVal = liveReviewElem ? liveReviewElem.value : "";
        var liveChangeVal = liveChangeElem ? liveChangeElem.value : "";

        // ID 타입 안전 가드를 통해 선택된 이슈 데이터에 실시간 덮어쓰기
        if (window.currentActiveIssue) {
            issueList.forEach(function(issue) {
                if (String(issue.id) === String(window.currentActiveIssue.id)) {
                    issue.reviewDesc = liveReviewVal;
                    issue.changeDesc = liveChangeVal;
                    issue.reviewContent = liveReviewVal;
                    issue.changeContent = liveChangeVal;
                }
            });
        }

        var isSplitModeActive = false;
        var splitContainer = document.getElementById('split-view-container') || document.querySelector('.split-view-container');
        if (splitContainer && window.getComputedStyle(splitContainer).display !== 'none') {
            isSplitModeActive = true;
        }

        // 🚨 [컨텍스트 오염 차단] 이슈에 저장된 이미지가 있으면 라이브 캡처를 완전히 생략
        //    저장 이미지가 아예 없는 이슈가 존재할 때만 폴백용 라이브 스냅샷을 찍음
        var BLANK_1PX = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
        var liveImgBefore = BLANK_1PX;
        var liveImgAfter  = BLANK_1PX;

        // 이슈 목록 전체에서 저장된 이미지가 하나도 없을 때만 라이브 캡처 수행
        var hasAnyStoredImage = issueList.some(function(iss) {
            return !!(iss && (
                iss.imgBefore ||
                iss.imgAfter ||
                iss.img ||
                iss.image ||
                iss.screenshot ||
                (Array.isArray(iss.images) && iss.images.length > 0)
            ));
        });

        if (!hasAnyStoredImage) {
            // 폴백: 저장 이미지가 전혀 없는 경우에만 현재 뷰어 화면 캡처
            function captureCvs(cvs) {
                if (!cvs) return BLANK_1PX;
                try {
                    var sc = document.createElement('canvas');
                    var sx = sc.getContext('2d');
                    var mw = 1920, cw = cvs.width, ch = cvs.height;
                    if (cw > mw) { ch = Math.round((ch * mw) / cw); cw = mw; }
                    sc.width = cw; sc.height = ch;
                    if (sx) {
                        sx.imageSmoothingEnabled = true;
                        sx.imageSmoothingQuality = 'high';
                        sx.drawImage(cvs, 0, 0, cw, ch);
                        var webp = sc.toDataURL('image/webp', 0.9);
                        if (webp && webp.indexOf('data:image/webp') === 0) return webp;
                        return sc.toDataURL('image/jpeg', 0.9);
                    }
                    var webpFallback = cvs.toDataURL('image/webp', 0.9);
                    if (webpFallback && webpFallback.indexOf('data:image/webp') === 0) return webpFallback;
                    return cvs.toDataURL('image/jpeg', 0.9);
                } catch(e) { return BLANK_1PX; }
            }
            var viewerContainers = document.querySelectorAll('.adsk-viewing-viewer');
            if (isSplitModeActive) {
                if (viewerContainers.length >= 2) {
                    liveImgBefore = captureCvs(viewerContainers[0].querySelector('canvas'));
                    liveImgAfter  = captureCvs(viewerContainers[1].querySelector('canvas'));
                } else if (viewerContainers.length === 1) {
                    liveImgBefore = liveImgAfter = captureCvs(viewerContainers[0].querySelector('canvas'));
                }
            } else {
                var viewerContainers2 = document.querySelectorAll('.adsk-viewing-viewer');
                if (viewerContainers2.length > 0) {
                    var mainCanvas = viewerContainers2[0].querySelector('canvas') || document.querySelector('.adsk-viewing-viewer canvas');
                    liveImgBefore = liveImgAfter = captureCvs(mainCanvas);
                }
            }
        }

        buildAndOpenBatchPdf(issueList, liveImgBefore, liveImgAfter);
    };
}

// 🚨 [종합 마스터 인쇄 양식] 4:3 액자 프레임 여백 및 실시간 데이터 100% 매핑 엔진
function buildAndOpenBatchPdf(issueList, liveImgBefore, liveImgAfter) {
    var pWin = window.open('', '_blank', 'width=1100,height=850');
    if (!pWin) {
        alert('팝업 차단이 활성화되어 있어 종합 PDF 보고서를 열 수 없습니다.');
        return;
    }

    var html = "";
    html = html + "<html>\n<head>\n<title>종합 이슈 목록 검토보고서</title>\n";
    html = html + "<style>\n";
    html = html + "  body { font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif; padding: 25px; background: #ffffff; color: #000000; }\n";
    html = html + "  .pdf-report-block { width: 100%; position: relative; page-break-after: always; margin-bottom: 40px; }\n";
    html = html + "  .pdf-report-block:last-child { page-break-after: avoid; margin-bottom: 0; }\n";
    html = html + "  .pdf-table { width: 100%; border-collapse: collapse; table-layout: fixed; margin-top: 5px; }\n";
    html = html + "  .pdf-table th, .pdf-table td { border: 1px solid #000000; padding: 8px 10px; text-align: center; font-size: 15px; vertical-align: middle; line-height: 1.5; }\n";
    html = html + "  .bg-gray { background-color: #E9ECF0 !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; font-weight: bold; width: 15%; font-size: 15px; }\n";
    html = html + "  .text-left { text-align: center !important; font-weight: normal; font-size: 16px; color: #111827; }\n";
    html = html + "  .view-header { background-color: #E9ECF0 !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; font-weight: bold; height: 36px; font-size: 15px; vertical-align: middle; }\n";
    html = html + "  .image-td { padding: 14px !important; margin: 0 !important; background: #ffffff; vertical-align: middle; }\n"; 
    html = html + "  .image-container { width: 100%; aspect-ratio: 4 / 3; display: flex; align-items: center; justify-content: center; overflow: hidden; margin: 0; padding: 0; background: #fafafa; border: 1px solid #e2e8f0; border-radius: 4px; box-sizing: border-box; }\n";
    html = html + "  .image-container img { width: 100%; height: 100%; display: block; object-fit: contain; margin: 0 auto; }\n"; 
    html = html + "  .report-title { font-size: 22px; font-weight: bold; margin-bottom: 20px; color: #111827; text-align: center; border-bottom: 2px solid #111827; padding-bottom: 10px; }\n";
    html = html + "  .pdf-attachment-title { margin: 12px 0 0; padding: 8px 10px; border: 1px solid #000000; border-bottom: 0; background: #E9ECF0; font-size: 16px; font-weight: bold; color: #111827; -webkit-print-color-adjust: exact; print-color-adjust: exact; }\n";
    html = html + "  .pdf-attachment-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border-left: 1px solid #000000; border-top: 1px solid #000000; }\n";
    html = html + "  .pdf-attachment-cell { min-height: 260px; padding: 8px; border-right: 1px solid #000000; border-bottom: 1px solid #000000; box-sizing: border-box; page-break-inside: avoid; background: #ffffff; }\n";
    html = html + "  .pdf-attachment-cell-title { margin-bottom: 6px; color: #334155; font-size: 12px; font-weight: bold; text-align: left; word-break: break-all; }\n";
    html = html + "  .pdf-attachment-cell img { width: 100%; height: 230px; display: block; object-fit: contain; background: #fafafa; }\n";
    html = html + "  @media print { body { padding: 0; } * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } }\n";
    html = html + "</style>\n</head>\n<body>\n";

    html = html + "<div class='report-title'>이슈 목록 종합 검토보고서 (" + issueList.length + "건)</div>\n";

    function escapePdfHtml(value) {
        return String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function normalizePdfImage(value) {
        if (!value) return "";
        var str = String(value).trim();
        if (!str) return "";
        if (str.indexOf('data:image') === 0 || str.indexOf('http') === 0 || str.indexOf('/') === 0 || str.indexOf('.') === 0) {
            return str;
        }
        return "data:image/png;base64," + str;
    }

    function pushPdfImage(list, seen, value) {
        var normalized = normalizePdfImage(value);
        if (!normalized || seen[normalized]) return;
        if (normalized.indexOf('AAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII') > -1) return;
        seen[normalized] = true;
        list.push(normalized);
    }

    function getPdfImageArrayFromIssue(issue) {
        var images = [];
        var seen = {};
        var rawImages = issue && issue.images;

        if (typeof rawImages === 'string') {
            try {
                rawImages = JSON.parse(rawImages);
            } catch (err) {
                rawImages = rawImages ? [rawImages] : [];
            }
        }

        if (Array.isArray(rawImages)) {
            rawImages.forEach(function(img) {
                pushPdfImage(images, seen, img);
            });
        }

        return images;
    }

    function collectPdfIssueImages(issue, mainImage, afterImage) {
        var images = [];
        var seen = {};
        getPdfImageArrayFromIssue(issue).forEach(function(img) {
            pushPdfImage(images, seen, img);
        });

        pushPdfImage(images, seen, issue && issue.image);
        pushPdfImage(images, seen, issue && issue.img);
        pushPdfImage(images, seen, issue && issue.screenshot);
        pushPdfImage(images, seen, issue && issue.resolveImage);
        pushPdfImage(images, seen, mainImage);
        pushPdfImage(images, seen, afterImage);

        return images;
    }

    function getPdfIssueTitle(issue, displayId) {
        return (
            issue.fileName ||
            issue.filename ||
            issue.file ||
            issue.modelName ||
            issue.title ||
            issue.name ||
            displayId ||
            "Issue"
        );
    }

    function renderPdfAttachmentGrid(issue, displayId, images) {
        if (!images || images.length === 0) return "";
        var title = getPdfIssueTitle(issue, displayId);
        var out = "";
        out = out + "<div class='pdf-attachment-title'>" + escapePdfHtml(title) + "</div>\n";
        out = out + "<div class='pdf-attachment-grid'>\n";
        images.forEach(function(img, index) {
            var cellTitle = title + " - " + (index + 1);
            out = out + "  <div class='pdf-attachment-cell'>\n";
            out = out + "    <div class='pdf-attachment-cell-title'>" + escapePdfHtml(cellTitle) + "</div>\n";
            out = out + "    <img src='" + img + "'>\n";
            out = out + "  </div>\n";
        });
        out = out + "</div>\n";
        return out;
    }

    issueList.forEach(function(issue) {
        var idStr = (issue.id || issue.dbId) ? String(issue.id || issue.dbId) : "31";
        var displayId = idStr.indexOf('#') === 0 ? idStr : "#" + idStr;
        // 🔍 [전체 구조 디버그] 비교 이슈의 실제 저장 필드 전체 출력
        if (issue._type === 'compare' || String(issue.id || "").indexOf('COMP-') === 0) {
            console.log("[PDF Issue Full Dump]", JSON.stringify(issue));
        }
        
        var structureName = issue.structure || "강북정수장 (금속여과지)";
        var disciplineName = issue.trade || issue.discipline || issue.공종 || "기계";
        
        var reviewContent = issue.reviewDesc || issue.reviewContent || issue.content || issue.description || "작성된 검토 내용이 없습니다.";
        // 🚨 단독 이슈 종료 시 저장 키: resolveNote (issue-resolve-note DOM에서 읽어 저장됨)
        var changeContent = issue.resolveNote || issue.changeDesc || issue.changeContent || issue.changeDetails || issue.change || "";

        // 🚨 [버전 키 추출] verBefore/verAfter가 number 타입으로 저장될 수 있으므로 String() 강제 변환
        var rawVerBefore = String(issue.verBefore || issue.versionBefore || issue.versionA || "");
        var rawVerAfter  = String(issue.verAfter  || issue.versionAfter  || issue.versionB || "");
        // 팝업 UI와 동일한 포맷: 숫자만 있으면 'ver.' 접두사 추가, 이미 있으면 유지
        var verBefore = rawVerBefore ? (rawVerBefore.indexOf('ver.') === 0 ? rawVerBefore : 'ver.' + rawVerBefore) : "";
        var verAfter  = rawVerAfter  ? (rawVerAfter.indexOf('ver.')  === 0 ? rawVerAfter  : 'ver.' + rawVerAfter)  : "";
        console.log("[PDF Version Debug] id=" + idStr + " | rawVerBefore=" + rawVerBefore + " | rawVerAfter=" + rawVerAfter + " | verBefore=" + verBefore + " | verAfter=" + verAfter);

        // 단독/비교 판단 (실제 객체 속성에 맞게 isCompare 판단)
        // 🚨 [판단 로직 강화] main.js 팝업 분기와 동일: _type, imgBefore, verBefore/versionBefore 포함
        var isCompareIssue = (
            issue._type === 'compare' ||
            issue.type === 'compare' ||
            issue.type === '비교' ||
            issue.isCompare ||
            !!issue.imgBefore ||
            !!(issue.verBefore || issue.versionBefore)
        );
        console.log("[PDF isCompare] id=" + idStr + " isCompare=" + isCompareIssue + " verBefore=" + (issue.verBefore||issue.versionBefore||'') + " verAfter=" + (issue.verAfter||issue.versionAfter||''));

        // 레이아웃 분기 처리 로직
        var isSingleImageLayout = false;
        if (!isCompareIssue) { // 단독 이슈인 경우
            var singleImageStatuses = ['초안', '생성', '지연', '검토중', '검토 중'];
            if (!issue.status || singleImageStatuses.indexOf(issue.status) > -1) {
                isSingleImageLayout = true; // 1장짜리 템플릿
            } else {
                isSingleImageLayout = false; // '종료' 등 2장짜리 템플릿
            }
        } else {
            isSingleImageLayout = false; // 비교 이슈는 무조건 2장짜리 템플릿
        }

        // 이미지 바인딩 및 누락 방지 (단독 이슈 1번째 사진 image/imageBefore/img/imgBefore/screenshot 등 확인)
        var isEndedSingleIssue = !isCompareIssue && !isSingleImageLayout;
        var captureImages = getPdfImageArrayFromIssue(issue);
        var useCapturePairLayout = !isCompareIssue && captureImages.length >= 2;
        if (useCapturePairLayout) {
            isSingleImageLayout = false;
        }

        var rawMainImage = issue.imageBefore || issue.image || issue.img || issue.imgBefore || issue.screenshot || liveImgBefore || "";
        var rawAfterImage = issue.imageAfter || issue.resolveImage || issue.imgAfter || liveImgAfter || "";

        function ensureBase64Prefix(str) {
            if (!str) return "";
            str = str.trim();
            if (str.indexOf('data:') === 0 || str.indexOf('http') === 0 || str.indexOf('/') === 0 || str.indexOf('.') === 0) {
                return str;
            }
            return "data:image/png;base64," + str;
        }

        var mainImage = ensureBase64Prefix(rawMainImage);
        var afterImage = ensureBase64Prefix(rawAfterImage);
        if (useCapturePairLayout) {
            mainImage = captureImages[0];
            afterImage = captureImages[1];
        }
        var attachedImages = collectPdfIssueImages(issue, mainImage, afterImage);
        if (isCompareIssue) {
            // 비교 이슈의 경우, 이미 상단 테이블에 들어간 [변경 전], [변경 후] 이미지는 첨부파일 목록에서 제외하여 중복 출력 방지
            attachedImages = attachedImages.filter(function(img) {
                return img !== mainImage && img !== afterImage;
            });
        } else {
            attachedImages = captureImages.length >= 2 ? captureImages.slice(2) : [];
        }
        var pdfImageFit = useCapturePairLayout ? 'contain' : 'cover';
        var showPdfChangeRow = isCompareIssue || isEndedSingleIssue;

        if (isSingleImageLayout) {
            html = html + "<div class='pdf-report-block'>\n";
            html = html + "  <table class='pdf-table' style='font-size: inherit;'>\n";
            html = html + "    <tr>\n";
            html = html + "      <td class='bg-gray' style='width: 20%;'>구 조 물</td>\n";
            html = html + "      <td style='width: 30%;'>" + structureName + "</td>\n";
            html = html + "      <td class='bg-gray' style='width: 20%;'>공 종</td>\n";
            html = html + "      <td style='width: 30%;'>" + disciplineName + "</td>\n";
            html = html + "    </tr>\n";
            html = html + "    <tr>\n";
            html = html + "      <td class='bg-gray'>검토내용</td>\n";
            html = html + "      <td colspan='3' class='text-left'>" + reviewContent + "</td>\n";
            html = html + "    </tr>\n";
            html = html + "    <tr>\n";
            html = html + "      <td colspan='4' class='view-header'>[이 미 지]</td>\n";
            html = html + "    </tr>\n";
            html = html + "    <tr>\n";
            html = html + "      <td colspan='4' class='image-td' style='height: 400px; vertical-align: middle; text-align: center; page-break-inside: avoid;'>\n";
            if (mainImage) {
                html = html + "        <img src='" + mainImage + "' style='max-width: 100%; max-height: 390px; object-fit: contain; display: inline-block; vertical-align: middle;'>\n";
            } else {
                html = html + "        <span style='color: #64748b;'>등록된 이미지가 없습니다.</span>\n";
            }
            html = html + "      </td>\n";
            html = html + "    </tr>\n";
            html = html + "  </table>\n";
            if (attachedImages.length > 1) {
                html = html + renderPdfAttachmentGrid(issue, displayId, attachedImages);
            }
            html = html + "</div>\n";
        } else {
            html = html + "<div class='pdf-report-block'>\n";
            html = html + "  <table class='pdf-table'>\n";
            html = html + "    <tr>\n";
            html = html + "      <td class='bg-gray'>구 조 물</td>\n";
            html = html + "      <td>" + structureName + "</td>\n";
            html = html + "      <td class='bg-gray'>공 종</td>\n";
            html = html + "      <td>" + disciplineName + "</td>\n";
            html = html + "    </tr>\n";
            html = html + "    <tr>\n";
            html = html + "      <td class='bg-gray'>검토내용</td>\n";
            html = html + "      <td colspan='3' class='text-left'>" + reviewContent + "</td>\n";
            html = html + "    </tr>\n";
            if (showPdfChangeRow) {
            html = html + "    <tr>\n";
            html = html + "      <td class='bg-gray'>변경내용</td>\n";
            if (changeContent) {
                html = html + "      <td colspan='3' class='text-left'>" + changeContent + "</td>\n";
            } else {
                html = html + "      <td colspan='3' class='text-left' style='color: #94a3b8; font-style: italic;'>작성된 변경 내용이 없습니다.</td>\n";
            }
            html = html + "    </tr>\n";
            }
            // 비교 이슈: 버전 정보 포함(값 있을 때만) / 단독 이슈(종료): 버전 정보 없이 라벨만 출력
            html = html + "    <tr>\n";
            if (isCompareIssue) {
                var labelBefore = verBefore ? "[변경 전] (" + verBefore + ")" : "[변경 전]";
                var labelAfter  = verAfter  ? "[변경 후] (" + verAfter  + ")" : "[변경 후]";
                html = html + "      <td colspan='2' class='view-header'>" + labelBefore + "</td>\n";
                html = html + "      <td colspan='2' class='view-header'>" + labelAfter  + "</td>\n";
            } else if (useCapturePairLayout) {
                html = html + "      <td colspan='2' class='view-header'>[캡처 1]</td>\n";
                html = html + "      <td colspan='2' class='view-header'>[캡처 2]</td>\n";
            } else {
                html = html + "      <td colspan='2' class='view-header'>[변경 전]</td>\n";
                html = html + "      <td colspan='2' class='view-header'>[변경 후]</td>\n";
            }
            html = html + "    </tr>\n";
            // 이미지 셀: padding: 10px, object-fit: cover로 테두리 여백 확보
            html = html + "    <tr>\n";
            html = html + "      <td colspan='2' style='border: 1px solid #000; padding: 10px; box-sizing: border-box; height: 350px; vertical-align: middle; overflow: hidden;'>\n";
            if (mainImage) {
                html = html + "        <img src='" + mainImage + "' style='width: 100%; height: 100%; object-fit: " + pdfImageFit + "; object-position: center; display: block;'>\n";
            } else {
                html = html + "        <div style='padding: 10px; text-align: center; color: #64748b;'>이미지 없음</div>\n";
            }
            html = html + "      </td>\n";
            html = html + "      <td colspan='2' style='border: 1px solid #000; padding: 10px; box-sizing: border-box; height: 350px; vertical-align: middle; overflow: hidden;'>\n";
            if (afterImage) {
                html = html + "        <img src='" + afterImage + "' style='width: 100%; height: 100%; object-fit: " + pdfImageFit + "; object-position: center; display: block;'>\n";
            } else {
                html = html + "        <div style='padding: 10px; text-align: center; color: #64748b;'>이미지 없음</div>\n";
            }
            html = html + "      </td>\n";
            html = html + "    </tr>\n";
            html = html + "  </table>\n";
            if (attachedImages.length > 0) {
                html = html + renderPdfAttachmentGrid(issue, displayId, attachedImages);
            }
            html = html + "</div>\n";
        }
    });

    html = html + "<script>\n";
    html = html + "  window.onload = function() {\n";
    html = html + "    setTimeout(function() { window.print(); window.close(); }, 800);\n";
    html = html + "  };\n";
    html = html + "</script>\n";
    html = html + "</body>\n</html>";

    pWin.document.write(html);
    pWin.document.close();
}
window.buildAndOpenBatchPdf = buildAndOpenBatchPdf;

setTimeout(initPdfExport, 1000);

// 🚨 [양방향 동기화 스크럽 엔진] comparison.js 최하단에 안전 주입
(function() {
    window.addEventListener('click', function(e) {
        var btn = e.target;
        if (!btn || !btn.classList.contains('compare-popup-delete-trigger')) return;

        // 상세조회 팝업이 이중으로 열리는 행위를 완전히 차단
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        var issueId = btn.getAttribute('data-del-id');
        if (!issueId || !confirm("이 비교 이슈를 영구 삭제하시겠습니까?")) return;

        console.log("[Compare Popup Delete] 동기화 삭제 기동:", issueId);

        // 🚨 양방향 연동을 위해 세 가지 로컬 스토리지 창고를 전수 조사하여 동시 삭제
        var storageKeys = ['aps_project_issues', 'my_saved_issues', 'my_saved_compare_issues'];
        for (var k = 0; k < storageKeys.length; k++) {
            try {
                var raw = localStorage.getItem(storageKeys[k]);
                if (raw) {
                    var parsed = JSON.parse(raw);
                    if (Array.isArray(parsed)) {
                        var filtered = parsed.filter(function(item) {
                            if (!item) return false;
                            return String(item.id) !== String(issueId) && String(item.dbId) !== String(issueId);
                        });
                        localStorage.setItem(storageKeys[k], JSON.stringify(filtered));
                    }
                }
            } catch(err) {}
        }

        // 인메모리 전역 변수가 존재한다면 함께 동기화하여 지워줌
        if (Array.isArray(window.currentIssueList)) {
            window.currentIssueList = window.currentIssueList.filter(function(item) {
                if (!item) return false;
                return String(item.id) !== String(issueId) && String(item.dbId) !== String(issueId);
            });
        }

        // 🚨 현재 열려있는 버전 비교 팝업 내의 목록 테이블 UI만 즉시 새로고침
        setTimeout(function() {
            // comparison.js 내부의 비교 목록 리로드 함수를 호출하거나 화면 행을 동적으로 지움
            if (typeof window.renderCompareIssueTable === 'function') {
                window.renderCompareIssueTable();
            } else if (typeof window.renderIssueTable === 'function') {
                // 메인 테이블 리로드 함수가 연동되어 있다면 안전하게 호출
                window.renderIssueTable();
            }
            
            // 물리적으로 현재 클릭한 행(tr 또는 div)을 화면에서 즉시 삭제하여 UI 즉각 반영
            var closestTr = btn.closest('.issue-table-row') || btn.closest('tr');
            if (closestTr && closestTr.parentNode) {
                closestTr.parentNode.removeChild(closestTr);
            }
        }, 30);
    }, true);
})();

// 🚨 [담당자 드롭다운 실시간 동기화 가이드 적용]
document.addEventListener('change', function(e) {
    if (e.target && e.target.id === 'issue-assignee') {
        var sourceSelect = e.target;
        var targetSelect = document.getElementById('real-compare-assignee-select');
        if (targetSelect) {
            var selectedValue = sourceSelect.value;
            var isOptionExist = false;
            for (var i = 0; i < targetSelect.options.length; i++) {
                if (targetSelect.options[i].value === selectedValue) {
                    isOptionExist = true;
                    break;
                }
            }
            if (!isOptionExist && selectedValue) {
                var newOption = document.createElement('option');
                newOption.value = selectedValue;
                newOption.text = selectedValue;
                targetSelect.appendChild(newOption);
            }
            targetSelect.value = selectedValue;
            console.log("[Sync] 담당자 값이 동기화되었습니다:", selectedValue);
        }
    }
});
