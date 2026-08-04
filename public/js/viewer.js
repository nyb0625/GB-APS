/**
 * viewer.js — Autodesk Viewer Client Wrapper (ES6 Module)
 */

let _initializerPromise = null;

async function getAccessToken(callback) {
    try {
        const resp = await fetch('/api/auth/token');
        if (!resp.ok) throw new Error(await resp.text());
        const { access_token, expires_in } = await resp.json();
        callback(access_token, expires_in);
    } catch (err) {
        console.error('[Viewer] Could not obtain access token:', err);
    }
}

function ensureInitialized() {
    if (!_initializerPromise) {
        _initializerPromise = new Promise((resolve) => {
            const options = {
                env: 'AutodeskProduction',
                api: 'derivativeV2',
                getAccessToken: getAccessToken
            };
            Autodesk.Viewing.Initializer(options, () => {
                resolve();
            });
        });
    }
    return _initializerPromise;
}

/**
 * Initialize Autodesk Viewer in the specified container.
 * @param {HTMLElement} container  - DOM element to render the viewer into
 * @param {boolean}     [isComparisonViewer=false]  - If true, do NOT tear down window.viewer
 *                                                     (used for split/overlay comparison panes)
 */
export function initViewer(container, isComparisonViewer = false, retryCount = 0) {
    return new Promise(async (resolve, reject) => {
        try {
            await ensureInitialized();

            // 1. 기존 뷰어 완벽한 파괴 (고스트 인스턴스 방지)
            if (!isComparisonViewer && window.viewer) {
                try {
                    window.viewer.tearDown();
                    window.viewer.finish();
                } catch (e) {
                    console.warn('[Viewer] Cleanup error:', e);
                }
                window.viewer = null;
            }

            // 2. DOM 컨테이너 유효성 검사 (display:none 상태에서 초기화 방지) - Polling 대기 로직 적용
            if (!container || container.clientWidth === 0) {
                const retries = retryCount || 0;
                if (retries < 15) { // 최대 3초 대기 (200ms * 15번)
                    setTimeout(() => {
                        initViewer(container, isComparisonViewer, retries + 1).then(resolve).catch(reject);
                    }, 200);
                } else {
                    console.warn('[Viewer] 컨테이너가 계속 숨겨져 있어 초기화를 중단합니다.');
                    resolve(null); // 에러를 throw 하지 않고 조용히 resolve(null)하여 크래시 방지
                }
                return;
            }

            // 3. 뷰어 생성
            const viewer = new Autodesk.Viewing.GuiViewer3D(container, { extensions: [] });

            // Track in window.viewer only when it is the main (non-comparison) viewer
            if (!isComparisonViewer) {
                window.viewer = viewer;
            }

            // 4. start() 결과 동기적 확인
            const startedCode = viewer.start();
            if (startedCode > 0) {
                console.error('[Viewer] 초기화 실패. 에러 코드:', startedCode);
                resolve(null);
                return;
            }

            // 5. impl이 완전히 준비되었는지 확인 후 로드 진행
            for (let i = 0; i < 50; i++) {
                if (viewer.impl) break;
                await new Promise(r => setTimeout(r, 100));
            }
            if (!viewer.impl) {
                console.error('[Viewer] viewer.impl이 준비되지 않았습니다.');
                resolve(null);
                return;
            }

            applyLightBackground(viewer);
            viewer.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, () => {
                applyLightBackground(viewer);
                try {
                    // 1. 조명 세팅 (밝게 유지)
                    viewer.setLightPreset(1); 
                    
                    // 2. 환경 맵 스카이박스 배경 완전 제거 및 배경색 수동 제어
                    viewer.setEnvMapBackground(false); 
                    viewer.prefs.set('envMapBackground', false);
                    viewer.setBackgroundColor(255, 255, 255, 245, 245, 245); // 흰색 ~ 연회색 그라데이션
                    
                    // 3. 왜곡을 방지하기 위한 바닥 반사 비활성화 (그림자는 유지)
                    viewer.prefs.set('groundReflection', false);
                    if (typeof viewer.setGroundReflection === 'function') viewer.setGroundReflection(false);
                    if (typeof viewer.setGroundShadow === 'function') viewer.setGroundShadow(true);
                    
                    viewer.prefs.set('edgeRendering', true);
                    viewer.prefs.set('ambientShadows', true);
                    viewer.setQualityLevel(true, true); 
                    viewer.prefs.set('ghosting', true);
                } catch(e) {
                    console.warn('[Viewer] Docs default custom theme event apply error:', e);
                }
            });

            // WebGL 렌더러가 완전히 안착할 수 있도록 약간의 딜레이(Event Loop 양보) 추가
            setTimeout(() => {
                resolve(viewer);
            }, 150);
        } catch (err) {
            console.warn('[Viewer] initViewer error caught silently:', err);
            resolve(null);
        }
    });
}

/**
 * Apply clean gradient background and setup optimal Docs-like rendering without Skybox
 */
function applyLightBackground(viewer) {
    try {
        // 배경 이미지 제거 및 고유 그라데이션 지정 (상단: 흰색, 하단: 밝은 회색)
        viewer.setEnvMapBackground(false);
        viewer.setBackgroundColor(255, 255, 255, 245, 245, 245);
        
        if (typeof viewer.setLightPreset === 'function') {
            viewer.setLightPreset(1); // 1: Sharp Highlights (가장 밝고 선명함)
        }
        if (typeof viewer.setGroundShadow === 'function') {
            viewer.setGroundShadow(true); // 지면 그림자는 자연스러움을 위해 활성화
        }
        if (typeof viewer.setGroundReflection === 'function') {
            viewer.setGroundReflection(false); // 바닥 반사는 왜곡 방지를 위해 비활성화
        }
        
        if (viewer.prefs) {
            viewer.prefs.set('edgeRendering', true); // 선명한 외곽선
            viewer.prefs.set('envMapBackground', false); // Skybox 로드 차단
            viewer.prefs.set('groundReflection', false);
            viewer.prefs.set('ambientShadows', true);
            viewer.prefs.set('ghosting', true);
        }
        if (typeof viewer.setQualityLevel === 'function') {
            viewer.setQualityLevel(true, true); // (ambientShadows, antialiasing)
        }
    } catch(e) {
        console.warn('[Viewer] Could not apply ACC Docs solid theme configurations:', e);
    }
}

/**
 * Load a model by its Base64 URN
 */
export function loadModel(viewer, urn) {
    if (!viewer) {
        console.warn('loadModel 실패: viewer가 없습니다.');
        return Promise.resolve(null);
    }

    // 🧹 다른 모델(파일)로 이동/오픈할 경우 이전 가시성 병합 상태 초기화 및 메인 URN 등록
    if (typeof window.resetVisibilityState === 'function') {
        window.resetVisibilityState(viewer);
    }
    window._currentMainModelUrn = urn;

    return new Promise(async (resolve, reject) => {
        // 5. impl이 완전히 준비되었는지 확인 후 로드 진행
        for (let i = 0; i < 50; i++) {
            if (viewer.impl) break;
            await new Promise(r => setTimeout(r, 100));
        }

        if (!viewer.impl) {
            console.error('[Viewer] viewer.impl이 준비되지 않았습니다.');
            reject(new Error('viewer.impl이 준비되지 않았습니다.'));
            return;
        }

        // 6. 안전하게 URN 로드 시작
        const finalUrn = urn.startsWith('urn:') ? urn : 'urn:' + urn;
        
        function onDocumentLoadSuccess(doc) {
            // 비동기 콜백 도중 탭을 닫아 뷰어가 파괴되었을 경우 방어
            if (!viewer || !viewer.impl) {
                console.warn('[Viewer] 렌더러가 파괴되었습니다. 로드를 취소합니다.');
                return; 
            }
            const viewables = doc.getRoot().getDefaultGeometry();
            if (!viewables) {
                return reject(new Error('Document contains no viewable geometry.'));
            }
            viewer.loadDocumentNode(doc, viewables, { globalOffset: { x: 0, y: 0, z: 0 } }).then((model) => {
                // Re-apply background after node loads (light preset may reset it)
                applyLightBackground(viewer);

                // Register the currently opened main model so the visibility popup can rotate it too.
                try {
                    window._currentMainModelUrn = urn;
                    if (window.loadedModels) {
                        window.loadedModels[urn] = model;
                    }
                    if (window.applyModelRotation && window.rotationState) {
                        const normalizeForVisibility = value => String(value || '').replace(/^urn:/, '').replace(/=/g, '').trim();
                        const currentUrn = normalizeForVisibility(urn);
                        const rotateOn = Object.keys(window.rotationState).some(key => normalizeForVisibility(key) === currentUrn && window.rotationState[key]);
                        window.applyModelRotation(viewer, urn, rotateOn);
                    }
                } catch (visibilityRegisterError) {
                    console.warn('[Viewer] main model visibility registration skipped:', visibilityRegisterError.message);
                }
                // 🎯 3D 뷰어 모델이 정상 로드되었을 때만 3D 뷰어 상단에 가시성/병합 아이콘 표시
                const mainControls = document.getElementById('main-viewer-controls');
                if (mainControls) mainControls.style.display = 'flex';
                resolve(model);
            }).catch(reject);
        }
        
        function onDocumentLoadFailure(code, message, errors) {
            reject({ code, message, errors });
        }
        
        try {
            if (viewer && typeof viewer.setLightPreset === 'function' && viewer.impl) {
                viewer.setLightPreset(0); // Preset 0 = Simple Gray (neutral, light friendly)
            }
        } catch (e) {
            console.warn('[Viewer] setLightPreset skipped:', e.message);
        }
        Autodesk.Viewing.Document.load(finalUrn, onDocumentLoadSuccess, onDocumentLoadFailure);
    });
}

/**
 * Helper to get all categories and element properties from the active model database
 */
export function getModelMetadata(viewer) {
    return new Promise((resolve) => {
        if (!viewer || !viewer.model) {
            return resolve(null);
        }
        
        viewer.model.getBulkProperties([], ['Category', 'Type', 'Name', '층', '구조'], (properties) => {
            const metadata = {
                categories: new Set(),
                elementsCount: properties.length,
                elements: []
            };
            
            properties.forEach(prop => {
                let category = 'Other';
                prop.properties.forEach(p => {
                    if (p.displayName === 'Category' || p.attributeName === 'Category') {
                        category = p.displayValue;
                    }
                });
                
                metadata.categories.add(category);
                metadata.elements.push({
                    dbId: prop.dbId,
                    name: prop.name,
                    category: category
                });
            });
            
            metadata.categories = Array.from(metadata.categories);
            resolve(metadata);
        }, () => {
            resolve(null);
        });
    });
}

/**
 * Helper to select and focus nodes in the viewer
 */
export function selectAndFocusNodes(viewer, dbIds) {
    if (!viewer || !dbIds || dbIds.length === 0) return;
    viewer.select(dbIds);
    viewer.fitToView(dbIds);
}

/**
 * Helper to isolate specific nodes
 */
export function isolateNodes(viewer, dbIds) {
    if (!viewer) return;
    viewer.isolate(dbIds);
    if (dbIds && dbIds.length > 0) {
        viewer.fitToView(dbIds);
    }
}

export function captureViewerScreen(viewer, width = 1280, height = 720) {
    return new Promise((resolve, reject) => {
        if (!viewer || typeof viewer.getScreenShot !== 'function') {
            reject(new Error('Viewer screenshot API is not available.'));
            return;
        }

        try {
            viewer.getScreenShot(width, height, (dataUrl) => {
                if (dataUrl && String(dataUrl).indexOf('data:image') === 0) {
                    resolve(dataUrl);
                } else {
                    reject(new Error('Viewer screenshot returned empty image data.'));
                }
            });
        } catch (err) {
            reject(err);
        }
    });
}

/**
 * Helper to color / theme specific nodes
 * colorName is a standard CSS color or color string
 */
export function setNodesColor(viewer, dbIds, colorName) {
    if (!viewer || !dbIds || dbIds.length === 0) return;
    
    // Map standard colors to RGB vector (Vector4)
    const colorMap = {
        red: { r: 1.0, g: 0.0, b: 0.0 },
        blue: { r: 0.0, g: 0.0, b: 1.0 },
        green: { r: 0.0, g: 1.0, b: 0.0 },
        yellow: { r: 1.0, g: 1.0, b: 0.0 },
        orange: { r: 1.0, g: 0.5, b: 0.0 },
        cyan: { r: 0.0, g: 1.0, b: 1.0 },
        magenta: { r: 1.0, g: 0.0, b: 1.0 },
        white: { r: 1.0, g: 1.0, b: 1.0 }
    };
    
    const rgb = colorMap[String(colorName).toLowerCase()] || { r: 0.0, g: 1.0, b: 1.0 }; // Fallback cyan
    const vec4 = new window.THREE.Vector4(rgb.r, rgb.g, rgb.b, 0.7); // 70% opacity override
    
    dbIds.forEach(dbId => {
        viewer.setThemingColor(dbId, vec4);
    });
}

/**
 * Reset all visual overrides (selections, isolations, hidden, colors)
 */
export function resetViewerOverrides(viewer) {
    if (!viewer) return;
    viewer.clearSelection();
    viewer.showAll();
    viewer.clearThemingColors();
}

/**
 * Load a model by its Base64 URN with custom options (e.g. keepCurrentModels)
 */
export function loadModelMulti(viewer, urn, options = {}) {
    // [보안/생명주기] 기존 전역 뷰어 자원 해제 및 WebGL 메모리 릴리즈
    const safeTearDown = (v) => {
        if (!v) return;
        try {
            if (typeof v.tearDown === 'function') v.tearDown();
            if (typeof v.finish === 'function') v.finish();
            if (typeof v.uninitialize === 'function') v.uninitialize();
        } catch (e) {
            console.warn('[Viewer Teardown] Error:', e);
        }
    };

    [
        'viewerLeft', 'viewerRight', 'leftViewer', 'rightViewer', 
        'viewer', '_viewer', '_viewerLeft', '_viewerRight'
    ].forEach(prop => {
        if (window[prop] && window[prop] !== viewer) {
            safeTearDown(window[prop]);
            window[prop] = null;
        }
    });

    return new Promise(async (resolve, reject) => {
        if (!urn) {
            const msg = '왼쪽 뷰어 로드 실패: URN 값이 없습니다.';
            console.error('[Viewer]', msg);
            return reject(new Error(msg));
        }

        // 5. impl이 완전히 준비되었는지 확인 후 로드 진행
        for (let i = 0; i < 50; i++) {
            if (viewer && viewer.impl) break;
            await new Promise(r => setTimeout(r, 100));
        }

        if (!viewer || !viewer.impl) {
            console.error('[Viewer] viewer.impl이 준비되지 않았습니다.');
            reject(new Error('viewer.impl이 준비되지 않았습니다.'));
            return;
        }

        const finalUrn = urn.startsWith('urn:') ? urn : 'urn:' + urn;

        function onDocumentLoadSuccess(doc) {
            // 비동기 콜백 도중 탭을 닫아 뷰어가 파괴되었을 경우 방어
            if (!viewer || !viewer.impl) {
                console.warn('[Viewer] 렌더러가 준비되지 않았거나 파괴되었습니다. 렌더링을 취소합니다.');
                return; 
            }
            const viewables = doc.getRoot().getDefaultGeometry();
            if (!viewables) {
                const msg = '왼쪽 뷰어 로드 실패: 뷰어블 지오메트리가 없습니다. URN=' + finalUrn;
                console.error('[Viewer]', msg);
                return reject(new Error(msg));
            }
            const loadOptions = Object.assign({}, options, { globalOffset: { x: 0, y: 0, z: 0 } });
            viewer.loadDocumentNode(doc, viewables, loadOptions).then((model) => {
                applyLightBackground(viewer);
                resolve(model);
            }).catch((err) => {
                console.error('[Viewer] 왼쪽 뷰어 로드 실패: loadDocumentNode 오류 — ' + err);
                reject(err);
            });
        }

        function onDocumentLoadFailure(code, message, errors) {
            console.error('[Viewer] 왼쪽 뷰어 로드 실패: Document.load 오류 — code=' + code + ', message=' + message, errors);
            reject({ code, message, errors });
        }

        try {
            if (viewer && typeof viewer.setLightPreset === 'function' && viewer.impl) {
                viewer.setLightPreset(0);
            }
        } catch (e) {
            console.warn('[Viewer] setLightPreset skipped:', e.message);
        }
        Autodesk.Viewing.Document.load(finalUrn, onDocumentLoadSuccess, onDocumentLoadFailure);
    });
}

export async function loadAggregated(viewer, models = []) {
    if (!viewer || !viewer.impl) {
        throw new Error('Viewer is not ready.');
    }

    const list = Array.isArray(models) ? models : [];
    const loadedModels = [];

    for (let i = 0; i < list.length; i++) {
        const item = list[i] || {};
        const urn = item.urn || item.id || item.versionId || item;
        if (!urn) continue;

        const model = await loadModelMulti(viewer, urn, {
            keepCurrentModels: i > 0,
            preserveView: true
        });
        loadedModels.push(model);
    }

    return loadedModels;
}

/**
 * 🌐 [Global Model Search] Scan project-wide RVT models using Data Management Search API
 */
export async function scanGlobalProjectModels(hubId, projectId, rootFolderId) {
    try {
        let url = `/api/models/tree`;
        if (hubId && projectId) {
            url = `/api/hubs/${hubId}/projects/${projectId}/search-rvt`;
            if (rootFolderId) url += `?root_folder_id=${encodeURIComponent(rootFolderId)}`;
        }
        const resp = await fetch(url);
        if (resp.ok) {
            return await resp.json();
        }
    } catch (err) {
        console.warn('[Viewer] Global model scan failed:', err);
    }
    return null;
}
