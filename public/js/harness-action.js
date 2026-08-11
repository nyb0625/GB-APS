/**
 * [Harness Engineering] Layer 2: Actionable Intelligence (The "Hands")
 * harness-action.js - AI 명령 파싱 및 APS API 실행 엔진 (Action Dispatcher)
 */

(function () {
    'use strict';

    const ActionHarness = {
        _resolveViewer: function (viewer) {
            return viewer || window.viewer || window._viewer || window.NOP_VIEWER || window.viewerLeft || window.myGlobalViewer || null;
        },

        _resolveCategoryAlias: function (target, categories) {
            const raw = String(target || '').trim();
            const lower = raw.toLowerCase();
            if (!raw || !Array.isArray(categories) || categories.length === 0) return raw;

            const exact = categories.find((cat) => String(cat).trim().toLowerCase() === lower);
            if (exact) return exact;

            const includes = categories.find((cat) => {
                const catLower = String(cat).trim().toLowerCase();
                return catLower.includes(lower) || lower.includes(catLower);
            });
            if (includes) return includes;

            const aliasGroups = [
                { keys: ['벽', '벽체', 'wall', 'walls'], hints: ['벽', '벽체', 'wall'] },
                { keys: ['바닥', 'floor', 'floors', 'slab', '슬래브'], hints: ['바닥', 'floor', 'slab', '슬래브'] },
                { keys: ['기둥', 'column', 'columns'], hints: ['기둥', 'column'] },
                { keys: ['보', 'beam', 'beams'], hints: ['보', 'beam'] },
                { keys: ['계단', 'stair', 'stairs'], hints: ['계단', 'stair'] },
                { keys: ['배관', '파이프', 'pipe', 'pipes'], hints: ['배관', '파이프', 'pipe'] },
                { keys: ['문', 'door', 'doors'], hints: ['문', 'door'] },
                { keys: ['창', '창문', 'window', 'windows'], hints: ['창', 'window'] }
            ];

            const group = aliasGroups.find((item) => item.keys.some((key) => lower.includes(key)));
            if (!group) return raw;

            return categories.find((cat) => {
                const catLower = String(cat).toLowerCase();
                return group.hints.some((hint) => catLower.includes(hint.toLowerCase()));
            }) || raw;
        },

        /**
         * AI가 생성한 JSON 명령을 분석하여 실행합니다.
         * @param {Object} commandObj 
         */
        dispatch: async function (commandObj, viewer) {
            viewer = this._resolveViewer(viewer);
            if (!commandObj) return { success: false, error: '유효하지 않은 실행 요청' };

            const { action, target, params } = commandObj;
            const actionName = String(action || '').trim().toLowerCase();
            console.log(`[Action-Harness] 명령 수신: ${actionName}`, { target, params });

            const requiresViewer = ['select', 'highlight', 'select_material', 'hide', 'isolate', 'showall', 'focus', 'flyto', 'count', 'theme'];
            if (requiresViewer.includes(actionName) && (!viewer || !viewer.model)) {
                return { success: false, error: '해당 명령은 3D 모델 객체가 뷰어에 로드되어야 가능합니다.' };
            }

            try {
                switch (actionName) {
                    case 'select':
                    case 'highlight':
                        return await this._handleSearchAndAction(viewer, target, (ids) => {
                            viewer.isolate(ids);
                            viewer.fitToView(ids);
                            viewer.select(ids);
                        }, actionName);

                    case 'select_material':
                        return await this._handleMaterialSearchAndAction(viewer, target, (ids) => {
                            viewer.isolate(ids);
                            viewer.fitToView(ids);
                            viewer.select(ids);
                        });

                    case 'hide':
                        return await this._handleSearchAndAction(viewer, target, (ids) => viewer.hide(ids), action);

                    case 'isolate':
                        return await this._handleSearchAndAction(viewer, target, (ids) => viewer.isolate(ids), action);

                    case 'showall':
                        viewer.showAll();
                        viewer.fitToView();
                        return { success: true, message: '모든 객체가 표시되었습니다.' };

                    case 'focus':
                    case 'flyto':
                        return await this._handleSearchAndAction(viewer, target, (ids) => viewer.fitToView(ids), action);

                    case 'count':
                        const countResult = await this._performSearch(viewer, target);
                        return { success: true, count: countResult.length, ids: countResult };

                    case 'theme':
                        return await this._applyThemingColors(viewer, target, params?.color);

                    case 'reset_viewer':
                        if (viewer) {
                            if (typeof viewer.clearThemingColors === 'function') viewer.clearThemingColors();
                            if (typeof viewer.clearSelection === 'function') viewer.clearSelection();
                            if (typeof viewer.showAll === 'function') viewer.showAll();
                            if (typeof viewer.isolate === 'function') viewer.isolate();
                            if (viewer.impl && typeof viewer.impl.invalidate === 'function') viewer.impl.invalidate(true, true, true);
                        }
                        console.log('[Viewer-Reset] 모든 테밍 및 선택이 초기화되었습니다.');
                        return { success: true, message: '뷰어가 원래 상태로 초기화되었습니다.' };

                    case 'export_issues_pdf':
                        console.log('[Action-Harness] PDF 내보내기 시작 (Row-by-Row 정밀 필터링)');

                        // ── 1. 사이드바 열기 ──────────────────────────────────────────
                        const rbSidebar = document.getElementById('sidebar-right');
                        if (!rbSidebar || window.getComputedStyle(rbSidebar).display === 'none' || rbSidebar.offsetWidth === 0) {
                            const rbToggle = document.getElementById('ai-collapse-btn');
                            if (rbToggle) { rbToggle.click(); await new Promise(r => setTimeout(r, 700)); }
                        }

                        // 이슈 목록 렌더링 대기 (최대 2초)
                        let rbWait = 0;
                        while (document.querySelectorAll('.issue-item').length === 0 && rbWait < 5) {
                            await new Promise(r => setTimeout(r, 400));
                            rbWait++;
                        }

                        const rbExportBtn = document.querySelector('#bulk-pdf-btn');
                        const rbAllItems = document.querySelectorAll('.issue-item');

                        if (rbAllItems.length === 0 || !rbExportBtn) {
                            return { success: false, error: '이슈 목록이 준비되지 않았습니다. 이슈 패널을 열고 다시 시도해 주세요.' };
                        }

                        // ── 2. 파라미터 추출 ─────────────────────────────────────────
                        const rbParams = params || {};
                        // [Variable Alignment] 모든 가능성 체크 (target, targetStructure, 구조물)
                        const rbStruct = target || rbParams.targetStructure || rbParams.structure || rbParams.구조물 || null;
                        // [Work Type] 공종 키워드 추가 매핑 (targetWorkType, discipline, 공종)
                        const rbDisc = rbParams.targetWorkType || rbParams.workType || rbParams.discipline || rbParams.targetDiscipline || rbParams.공종 || null;
                        const rbAuthor = rbParams.author || rbParams.targetAuthor || null;
                        const rbStatus = rbParams.targetStatus || rbParams.status || null;

                        console.log(`[Action-Harness] Row-by-Row 파라미터: 구조물="${rbStruct}", 공종="${rbDisc}", 상태="${rbStatus}"`);

                        // 🛡️ [Strict Filtering] 구조물 또는 공종 중 최소 하나는 있어야 함
                        if (!rbStruct && !rbDisc) {
                            console.error('[Action-Harness] 필터링 중단: 필터 조건(구조물 또는 공종)이 누락되었습니다.');
                            return { success: false, error: '필터링할 구조물 또는 공종을 지정해 주세요. (예: "급속여과지" 혹은 "기계 공종")' };
                        }

                        const rbTotal = rbAllItems.length;

                        // ── 2.5 필터 정보 전달 (issue-manager.js용) ──────────────────
                        if (window._issueManager) {
                            window._issueManager.lastTargetStructure = rbStruct;
                            window._issueManager.lastTargetWorkType = rbDisc; // [New] 공종 전달
                            window._issueManager.lastTargetStatus = rbStatus;
                            console.log(`[Action-Harness] IssueManager 필터 예약: 구조물=${rbStruct}, 공종=${rbDisc}`);
                        }

                        // ── 3. Step 1: 전체 초기화 ───────────────────────────────────
                        // 모든 체크박스를 unchecked 상태로 리셋 (전체선택 간섭 차단)
                        rbAllItems.forEach(item => {

                            const cb = item.querySelector('.issue-check');
                            if (cb && cb.checked) {
                                cb.checked = false; // click() 대신 property 직접 변경 (이벤트 중복 방지)
                            }
                        });
                        await new Promise(r => setTimeout(r, 100));

                        // ── 4. Step 2~5: 행 순회 → 텍스트 추출 → 비교 → 정밀 선택 ──
                        let rbSelected = 0;
                        const rbLog = [];
                        const rbMatchedData = []; // [New] 물리적 필터링을 위한 실제 데이터 수집

                        // 원본 데이터 소스 확보 (IssueManager 내부 데이터)
                        const rbSourceIssues = window._issueManager?.issues || [];

                        rbAllItems.forEach(item => {
                            // Step 2: 행 순회 (.issue-item 개별 접근)
                            const cb = item.querySelector('.issue-check');
                            if (!cb) return;

                            const issueId = item.dataset.id; // DOM에서 ID 추출

                            // Step 3: 텍스트 추출
                            const structAttr = (item.dataset.structure || '').trim();
                            const rowText = (item.innerText || item.textContent || '').trim();
                            const workAttr = (item.dataset.workType || item.dataset.discipline || '').trim();
                            const assigneeAttr = (item.dataset.assignee || '').trim();
                            const statusAttr = (item.dataset.status || '').trim();

                            // Step 4: includes() 조건부 매칭
                            let match = true;
                            if (rbStruct && !structAttr.includes(rbStruct) && !rowText.includes(rbStruct)) match = false;
                            if (rbDisc && !workAttr.includes(rbDisc) && !rowText.includes(rbDisc)) match = false;
                            if (rbAuthor && !assigneeAttr.includes(rbAuthor) && !rowText.includes(rbAuthor)) match = false;
                            if (rbStatus && !statusAttr.includes(rbStatus) && !rowText.includes(rbStatus)) match = false;

                            // Step 5: 정밀 선택 및 페이로드 데이터 동기화
                            if (match) {
                                cb.checked = true;
                                rbSelected++;
                                rbLog.push(`✓ ID=${issueId} 구조물="${structAttr}"`);

                                // 물리적 페이로드 동기화: 원본 배열에서 해당 ID의 객체를 찾아 수집
                                const matchedObj = rbSourceIssues.find(i => String(i.id) === String(issueId));
                                if (matchedObj) rbMatchedData.push(matchedObj);
                            }
                        });

                        // ── 4.5 페이로드 강제 동기화 (Payload Sync) ────────────────
                        if (window._issueManager) {
                            window._issueManager.forcePayloadIssues = rbMatchedData;
                            // [Verification] Payload Sync 개수 검증
                            const syncCount = rbMatchedData.length;
                            console.log(`[Action-Harness] Payload Sync 완료: ${syncCount}개 이슈가 물리적으로 동기화됨. (검증: ${rbSelected === syncCount ? '일치' : '불일치'})`);
                        }

                        console.log(`[Action-Harness] 최종 실행 보고: ${rbSelected}/${rbTotal} (선택된 이슈/전체 이슈)`);

                        // ── 5. 가드레일: 0개 선택 시 내보내기 중단 ──────────────────
                        if (rbSelected === 0) {
                            const rbDesc = [rbStruct, rbDisc, rbAuthor].filter(Boolean).join(' / ');
                            return {
                                success: false,
                                error: `일치하는 구조물의 이슈를 찾지 못했습니다. "[${rbDesc}]" 조건에 해당하는 이슈가 없습니다. (전체 ${rbTotal}개 조회)`
                            };
                        }

                        // ── 6. 내보내기 팝업 호출 (선택 항목 확인 후에만) ────────────
                        console.log(`[Action-Harness] ✅ ${rbSelected}개 확인됨. 내보내기 팝업 호출`);
                        await new Promise(resolve => {
                            setTimeout(async () => {
                                rbExportBtn.click();
                                let rbGenRetry = 0;
                                let rbGenBtn = document.querySelector('#run-pdf-export-btn');
                                while (!rbGenBtn && rbGenRetry < 4) {
                                    await new Promise(r => setTimeout(r, 500));
                                    rbGenBtn = document.querySelector('#run-pdf-export-btn');
                                    rbGenRetry++;
                                }
                                if (rbGenBtn) setTimeout(() => rbGenBtn.click(), 500);
                                resolve();
                            }, 400);
                        });

                        const rbLabel = [rbStruct, rbDisc, rbAuthor].filter(Boolean).join(' / ') || '전체';
                        return {
                            success: true,
                            message: `요청하신 [${rbLabel}] 이슈 ${rbSelected}개를 선택하여 PDF 생성을 시작합니다. (전체 ${rbTotal}개 중 ${rbSelected}개 해당)`,
                            count: rbSelected
                        };


                    default:
                        console.warn(`[Action-Harness] 미지원 액션: ${action}`);
                        return { success: false, error: '지원되지 않는 기능입니다.' };
                }
            } catch (err) {
                console.error('[Action-Harness] 실행 중 에러:', err);
                return { success: false, error: err.message };
            }
        },

        /**
         * 검색 후 특정 동작 수행 (공통 로직)
         */
        _handleSearchAndAction: async function (viewer, target, actionFn, command) {
            const dbIds = await this._performSearch(viewer, target);
            if (dbIds && dbIds.length > 0) {
                // [Log] 정밀 객체 필터링 로그 (사용자 요청 사항)
                console.log(`[Action-Harness] Selecting Category: '${target}' (Count: ${dbIds.length})`);

                // [Threshold] 임계값 검증 (100개 이상 시 경고)
                if (dbIds.length > 100) {
                    console.warn(`[Action-Harness] ⚠️ 임계값 초과: ${dbIds.length}개 객체가 검색됨. 실행을 중단합니다.`);
                    return {
                        success: false,
                        isThresholdError: true,
                        count: dbIds.length,
                        target: target,
                        error: `너무 많은 객체(${dbIds.length}개)가 검색되었습니다. 과부하 방지를 위해 바로 선택하지 않았습니다. 모두 선택할까요?`
                    };
                }

                const cmd = (command || '').toLowerCase();
                if (cmd === 'select' || cmd === 'highlight' || cmd === 'isolate') {
                    viewer.isolate(dbIds);
                    viewer.fitToView(dbIds);
                    viewer.select(dbIds);
                } else if (cmd === 'hide') {
                    actionFn(dbIds);
                } else {
                    actionFn(dbIds);
                }

                return { success: true, count: dbIds.length, target: target };
            } else {
                return { success: false, error: `모델에서 '${target}'을(를) 찾을 수 없습니다. 공식 카테고리명을 확인해 주세요.` };
            }
        },

        _handleMaterialSearchAndAction: async function (viewer, target, actionFn) {
            if (!target || target.trim() === '') {
                return { success: false, error: '재료 검색어가 비어 있습니다.' };
            }

            const dbIds = await this._fuzzyScan(viewer, target, [
                'Material', 'Material Name', 'Structural Material', 'Finish', '재료', '구조 재료', '마감'
            ]);
            if (!dbIds || dbIds.length === 0) {
                return { success: false, error: `모델에서 재료 '${target}'을(를) 적용한 객체를 찾을 수 없습니다.` };
            }
            if (dbIds.length > 100) {
                return {
                    success: false,
                    isThresholdError: true,
                    count: dbIds.length,
                    target,
                    error: `재료 '${target}'에 대해 너무 많은 객체(${dbIds.length}개)가 검색되었습니다.`
                };
            }

            actionFn(dbIds);
            return { success: true, count: dbIds.length, target };
        },

        _searchWithViewerApi: function (viewer, target) {
            return new Promise((resolve) => {
                if (!viewer || typeof viewer.search !== 'function') {
                    resolve([]);
                    return;
                }

                viewer.search(
                    target,
                    (ids) => resolve(Array.isArray(ids) ? ids : []),
                    () => resolve([]),
                    ['Name', 'Category', 'Type', 'Family', 'Material']
                );
            });
        },

        _scanPropertiesForTarget: function (viewer, target) {
            return new Promise((resolve) => {
                const model = viewer && viewer.model;
                const pdb = model && typeof model.getPropertyDb === 'function' ? model.getPropertyDb() : null;
                if (!pdb || typeof pdb.executeUserFunction !== 'function') {
                    resolve([]);
                    return;
                }

                const targetNorm = String(target || '').replace(/\s+/g, '').toLowerCase();
                const targetLower = String(target || '').toLowerCase();
                pdb.executeUserFunction(function (pdb, data) {
                    var foundIds = [];
                    var attrIds = [];
                    var fields = data.fields.map(function (name) { return String(name).toLowerCase(); });

                    pdb.enumAttributes(function (attrId, attrDef) {
                        var attrName = String((attrDef && attrDef.name) || '').toLowerCase();
                        if (fields.some(function (field) { return attrName.indexOf(field) !== -1; })) {
                            attrIds.push(attrId);
                        }
                    });

                    pdb.enumObjects(function (dbId) {
                        var matched = false;
                        pdb.enumObjectProperties(dbId, function (propId, valueId) {
                            if (matched || attrIds.indexOf(propId) === -1) return;
                            var raw = String(pdb.getAttrValue(propId, valueId) || '');
                            var norm = raw.replace(/\s+/g, '').toLowerCase();
                            var lower = raw.toLowerCase();
                            matched = norm.indexOf(data.targetNorm) !== -1 ||
                                data.targetNorm.indexOf(norm) !== -1 ||
                                lower.indexOf(data.targetLower) !== -1;
                        });
                        if (matched) foundIds.push(dbId);
                    });

                    return foundIds;
                }, {
                    targetNorm,
                    targetLower,
                    fields: ['category', 'revit category', 'name', 'type', 'type name', 'family', 'material']
                }).then((ids) => resolve(Array.isArray(ids) ? ids : [])).catch(() => resolve([]));
            });
        },

        /**
         * [SSOT Architecture] window.categoryInstancesMap을 직접 참조하여 dbId 배열을 반환합니다.
         * harness-context.js가 모델 초기 스캔 시 구축한 중앙 데이터를 사용하므로,
         * 독자적인 트리 탐색(getInstanceTree, enumNodeChildren 등)을 일절 수행하지 않습니다.
         */
        _performSearch: async function (viewer, target, retryCount = 0) {
            if (!target || target.trim() === "") {
                console.warn('[Action-Harness] 검색어가 비어 있습니다.');
                return [];
            }

            viewer = this._resolveViewer(viewer);
            const normalizedTarget = target.trim();
            const lowerTarget = normalizedTarget.toLowerCase();
            const ssotMap = window.categoryInstancesMap || {};
            const ssotKeys = Object.keys(ssotMap);
            const dynCats = Array.from(new Set([...(window.dynamicCategories || []), ...ssotKeys])).filter(Boolean);
            const aliasTarget = this._resolveCategoryAlias(normalizedTarget, dynCats);
            const aliasLowerTarget = aliasTarget.toLowerCase();

            const exactMatch = dynCats.find((cat) => String(cat).trim().toLowerCase() === aliasLowerTarget);
            const fuzzyMatch = !exactMatch && dynCats.find((cat) => {
                const catLower = String(cat).trim().toLowerCase();
                return catLower.includes(aliasLowerTarget) || aliasLowerTarget.includes(catLower);
            });
            const resolvedTarget = (exactMatch || fuzzyMatch || aliasTarget).trim();

            let targetIds = ssotMap[resolvedTarget];
            if (!targetIds && ssotKeys.length > 0) {
                const matchedKey = ssotKeys.find((key) => String(key).trim().toLowerCase() === resolvedTarget.toLowerCase());
                if (matchedKey) targetIds = ssotMap[matchedKey];
            }

            if (targetIds && targetIds.length > 0) {
                console.log(`[Action-Harness] [SSOT] 캐시 히트: '${resolvedTarget}' -> ${targetIds.length}개 dbId`);
                return [...new Set(targetIds.map(Number).filter(Number.isFinite))];
            }

            if (retryCount < 2 && ssotKeys.length === 0) {
                await new Promise((resolve) => setTimeout(resolve, 500));
                return this._performSearch(viewer, target, retryCount + 1);
            }

            const viewerSearchIds = await this._searchWithViewerApi(viewer, resolvedTarget);
            if (viewerSearchIds.length > 0) {
                console.log(`[Action-Harness] [viewer.search] '${resolvedTarget}' -> ${viewerSearchIds.length}개 dbId`);
                return [...new Set(viewerSearchIds.map(Number).filter(Number.isFinite))];
            }

            const scannedIds = await this._scanPropertiesForTarget(viewer, resolvedTarget);
            if (scannedIds.length > 0) {
                console.log(`[Action-Harness] [PDB scan] '${resolvedTarget}' -> ${scannedIds.length}개 dbId`);
                return [...new Set(scannedIds.map(Number).filter(Number.isFinite))];
            }

            console.warn(`[Action-Harness] '${target}' 검색 결과 없음. 사용 가능한 카테고리:`, dynCats);
            return [];
        },
        /**
         * [THEME] 카테고리의 객체들에 색상을 적용하는 헬퍼
         */
        _applyThemingColors: async function (viewer, target, colorName) {
            const ThreeVector4 = (window.THREE && window.THREE.Vector4) || (typeof THREE !== 'undefined' && THREE.Vector4);
            if (!ThreeVector4) {
                return { success: false, error: 'THREE.Vector4 is not available.' };
            }

            const COLOR_MAP = {
                red:     new ThreeVector4(1, 0, 0, 1),
                blue:    new ThreeVector4(0, 0.4, 1, 1),
                green:   new ThreeVector4(0, 0.8, 0.2, 1),
                yellow:  new ThreeVector4(1, 0.9, 0, 1),
                orange:  new ThreeVector4(1, 0.5, 0, 1),
                cyan:    new ThreeVector4(0, 0.9, 1, 1),
                magenta: new ThreeVector4(1, 0, 1, 1),
                white:   new ThreeVector4(1, 1, 1, 1),
                gray:    new ThreeVector4(0.55, 0.55, 0.55, 1),
                grey:    new ThreeVector4(0.55, 0.55, 0.55, 1),
                '\ube68\uac15': new ThreeVector4(1, 0, 0, 1),
                '\ube68\uac04\uc0c9': new ThreeVector4(1, 0, 0, 1),
                '\ud30c\ub791': new ThreeVector4(0, 0.4, 1, 1),
                '\ud30c\ub780\uc0c9': new ThreeVector4(0, 0.4, 1, 1),
                '\ucd08\ub85d': new ThreeVector4(0, 0.8, 0.2, 1),
                '\ub179\uc0c9': new ThreeVector4(0, 0.8, 0.2, 1),
                '\ub178\ub791': new ThreeVector4(1, 0.9, 0, 1),
                '\ub178\ub780\uc0c9': new ThreeVector4(1, 0.9, 0, 1),
                '\uc8fc\ud669': new ThreeVector4(1, 0.5, 0, 1),
                '\uc8fc\ud669\uc0c9': new ThreeVector4(1, 0.5, 0, 1),
                '\ud558\ub298\uc0c9': new ThreeVector4(0, 0.9, 1, 1),
                '\ubd84\ud64d': new ThreeVector4(1, 0, 1, 1),
                '\ud770\uc0c9': new ThreeVector4(1, 1, 1, 1),
                '\ud68c\uc0c9': new ThreeVector4(0.55, 0.55, 0.55, 1)
            };

            const colorVector = COLOR_MAP[(colorName || '').toLowerCase().trim()];
            if (!colorVector) {
                return { success: false, error: `지원하지 않는 색상입니다: '${colorName}'. (red, blue, green, yellow, orange, cyan, magenta, white, gray 중 하나를 사용하세요.)` };
            }

            const dbIds = await this._performSearch(viewer, target);
            if (!dbIds || dbIds.length === 0) {
                return { success: false, error: `모델에서 '${target}'을(를) 찾을 수 없습니다.` };
            }

            dbIds.forEach(dbId => {
                viewer.setThemingColor(dbId, colorVector, viewer.model);
            });
            if (viewer.impl && typeof viewer.impl.invalidate === 'function') {
                viewer.impl.invalidate(true, true, true);
            }

            console.log(`[Action-Harness] [THEME] '${target}' ${dbIds.length}개 객체에 '${colorName}' 적용 완료.`);
            return { success: true, count: dbIds.length, target, color: colorName };
        },
        /**
         * [캐녀스 하단] 뷰어 초기화 아이콘 버튼 주입
         */
        _injectResetButton: function () {
            if (document.getElementById('viewer-reset-btn')) return;
            const viewer = window._viewer || window.NOP_VIEWER;
            if (!viewer || !viewer.container) {
                // 뷰어 준비 전이면 500ms 후 재시도
                setTimeout(() => this._injectResetButton(), 500);
                return;
            }

            const btn = document.createElement('button');
            btn.id = 'viewer-reset-btn';
            btn.className = 'custom-viewer-btn';
            btn.title = '뷰어 초기화 (색상/선택 해제)';
            btn.innerHTML = '<i class="fas fa-sync-alt"></i> 뷰어 초기화';
            
            if (!document.getElementById('custom-viewer-btn-style')) {
                const style = document.createElement('style');
                style.id = 'custom-viewer-btn-style';
                style.textContent = `
                    .custom-viewer-btn {
                        display: inline-flex;
                        align-items: center;
                        gap: 6px;
                        padding: 8px 14px;
                        margin-left: auto;
                        margin-right: 10px;
                        height: fit-content;
                        background-color: rgba(30, 30, 40, 0.85);
                        color: #ffffff;
                        border: 1px solid rgba(255, 255, 255, 0.15);
                        border-radius: 6px;
                        font-size: 13px;
                        font-weight: 600;
                        cursor: pointer;
                        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
                        transition: all 0.2s ease;
                        font-family: 'Inter', sans-serif;
                    }
                    .custom-viewer-btn:hover {
                        background-color: rgba(80, 120, 255, 0.9);
                        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
                        transform: translateY(-2px);
                    }
                    .custom-viewer-btn:active {
                        transform: translateY(0);
                    }
                `;
                document.head.appendChild(style);
            }
            btn.onclick = (e) => {
                e.stopPropagation();
                const v = window._viewer || window.NOP_VIEWER;
                if (v) {
                    v.clearThemingColors();
                    v.clearSelection();
                    console.log('[Viewer-Reset] 뷰어 시각 상태가 초기화되었습니다.');
                    window.showToast && window.showToast('🔄 뷰어가 초기화되었습니다.', 'success');
                }
            };

            const topBar = document.getElementById('viewer-top-bar');
            if (topBar) {
                topBar.appendChild(btn);
            } else {
                viewer.container.style.position = 'relative';
                viewer.container.appendChild(btn);
            }
            console.log('[Action-Harness] 뷰어 초기화 버튼 주입 완료.');
        },

        /**
         * 모델의 상위 20개 카테고리 명칭을 추출하여 로그로 출력 (디버깅용)
         */
        _logTopCategories: function (viewer) {
            if (!viewer.model) return;
            const pdb = viewer.model.getPropertyDb();

            // User Function을 사용하여 프로퍼티 명칭 수집
            pdb.executeUserFunction(function (pdb) {
                var categories = {};
                var catPropId = -1;

                // 'Category'와 유사한 프로퍼티 이름 찾기
                // [Fix] 대소문자/공백 무시하여 Category, Revit Category 속성 탐색 동기화
                pdb.enumAttributes(function (attrId, attrDef) {
                    var name = (attrDef.name || '').toLowerCase().trim();
                    if (name === 'category' || name === 'revit category') {
                        catPropId = attrId;
                    }
                });

                if (catPropId === -1) return "Category 프로퍼티를 찾을 수 없습니다.";

                pdb.enumObjects(function (dbId) {
                    pdb.enumObjectProperties(dbId, function (propId, valueId) {
                        if (propId === catPropId) {
                            var val = pdb.getAttrValue(propId, valueId);
                            categories[val] = (categories[val] || 0) + 1;
                        }
                    });
                });

                return categories;
            }).then(result => {
                if (typeof result === 'string') {
                    console.log(`[DEBUG] ${result}`);
                } else {
                    const sorted = Object.entries(result).sort((a, b) => b[1] - a[1]);
                    // [Fix] 콘솔에서 개발자가 한눈에 복사할 수 있도록 [DEBUG] 포맷 통일
                    const categoriesList = sorted.map(x => x[0]);
                    console.log(`[DEBUG] Available Categories: [${categoriesList.join(', ')}]`);
                }
            });
        },

        /**
         * 정규식 또는 includes를 이용한 수동 Fuzzy 스캔
         */
        _fuzzyScan: function (viewer, target, fields) {
            return new Promise((resolve) => {
                // [Fix] targetLower 변수 미정의 오류 수정 및 정밀 정규화 동시 적용
                const targetLower = target.toLowerCase();
                const targetNorm = target.replace(/\s+/g, '').toLowerCase();

                viewer.model.getPropertyDb().executeUserFunction(function (pdb, data) {
                    var foundIds = [];
                    var targetNorm = data.targetNorm;
                    var targetLower = data.targetLower;
                    // [Fix] fields를 소문자로 변환하여 내부 비교
                    var fields = data.fields.map(function (f) { return f.toLowerCase().trim(); });
                    var attrIds = [];

                    // [Fix] RegExp 동적 생성
                    var regex = null;
                    try { regex = new RegExp(targetNorm, 'i'); } catch (e) { }

                    // 속성명을 대소문자 무시 처리하여 fields와 비교
                    pdb.enumAttributes(function (id, def) {
                        var name = (def.name || '').toLowerCase().trim();
                        if (fields.indexOf(name) !== -1) attrIds.push(id);
                    });

                    pdb.enumObjects(function (dbId) {
                        var matched = false;
                        pdb.enumObjectProperties(dbId, function (propId, valueId) {
                            if (matched) return;
                            if (attrIds.indexOf(propId) !== -1) {
                                // [Fix] 데이터 역시 공백 완전 제거 후 소문자 처리하여 완벽히 일치시키기
                                var rawVal = String(pdb.getAttrValue(propId, valueId) || '');
                                var valNorm = rawVal.replace(/\s+/g, '').toLowerCase();
                                var valLower = rawVal.toLowerCase();

                                if (regex && regex.test(valNorm)) {
                                    matched = true;
                                } else if (valNorm.indexOf(targetNorm) !== -1) {
                                    matched = true;
                                } else if (valLower.indexOf(targetLower) !== -1) {
                                    matched = true;
                                }
                            }
                        });
                        if (matched) foundIds.push(dbId);
                    });
                    return foundIds;
                }, { targetLower, targetNorm, fields }).then(ids => {
                    resolve(ids || []);
                }).catch(() => resolve([]));
            });
        }
    };

    // 글로벌 노출
    window.ActionHarness = ActionHarness;

    // 뷰어 준비 후 초기화 버튼 주입 (GEOMETRY_LOADED 이벤트 대기)
    const _waitAndInjectReset = () => {
        const viewer = window._viewer || window.NOP_VIEWER;
        if (viewer && viewer.container) {
            ActionHarness._injectResetButton();
        } else {
            setTimeout(_waitAndInjectReset, 800);
        }
    };
    _waitAndInjectReset();
})();


