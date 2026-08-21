/* ==========================================================================
   weekly-3d-viewer.js — 예시1 탭 [강북_구조물_신설_07_정수지_C] 3D BIM Viewer
   - 흰 바탕 배경 렌더링 적용 (다른 뷰어 미영향)
   - 뷰어 내부 오버레이를 제거하고, 뷰어 하단 독자 패널 영역에 4D 시공 시뮬레이션 패널 배치
   - 🚨 [FEATURE INTEGRATION] 4D Construction Phasing Simulation UI
     - LocalStorage 영구 저장 (새로고침 시 영구 유지)
     - ▶ 1단계 / ▶ 2단계 / ▶ 3단계 버튼 클릭 시만 노란색/파란색/초록색 시뮬레이션 착색 작동
   ========================================================================== */

(function () {
  "use strict";

  // 1. 전역 상태 변수 & LocalStorage 키
  const STORAGE_KEY = 'weekly_4d_phase_data';
  let phaseData = { 1: [], 2: [], 3: [] };
  let isPanelExpanded = false;

  // LocalStorage 데이터 복원
  function loadPhaseDataFromStorage() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          phaseData = {
            1: Array.isArray(parsed[1]) ? parsed[1] : [],
            2: Array.isArray(parsed[2]) ? parsed[2] : [],
            3: Array.isArray(parsed[3]) ? parsed[3] : []
          };
          console.log('[Weekly4DSim] Restored phaseData from localStorage:', phaseData);
        }
      }
    } catch (e) {
      console.warn('[Weekly4DSim] Failed to load phaseData from storage:', e);
    }
  }

  // LocalStorage 데이터 저장
  function savePhaseDataToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(phaseData));
      console.log('[Weekly4DSim] Saved phaseData to localStorage:', phaseData);
    } catch (e) {
      console.warn('[Weekly4DSim] Failed to save phaseData to storage:', e);
    }
  }

  // 초기화 시 데이터 복원 실행
  loadPhaseDataFromStorage();

  async function getAccessToken(callback) {
    try {
      const resp = await fetch('/api/auth/token');
      if (!resp.ok) throw new Error(await resp.text());
      const { access_token, expires_in } = await resp.json();
      callback(access_token, expires_in);
    } catch (err) {
      console.error('[Weekly3DViewer] Access token fetch failed:', err);
    }
  }

  function ensureAutodeskInitialized() {
    if (window._autodeskInitPromise) return window._autodeskInitPromise;
    window._autodeskInitPromise = new Promise((resolve, reject) => {
      let checkInterval = null;
      const timeout = setTimeout(() => {
        if (checkInterval) clearInterval(checkInterval);
        reject(new Error('Autodesk Viewer SDK 로딩 시간이 초과되었습니다.'));
      }, 15000);

      const finish = () => {
        clearTimeout(timeout);
        resolve();
      };

      if (typeof Autodesk !== 'undefined' && Autodesk.Viewing) {
        const options = {
          env: 'AutodeskProduction',
          api: 'derivativeV2',
          getAccessToken: getAccessToken
        };
        Autodesk.Viewing.Initializer(options, finish);
      } else {
        checkInterval = setInterval(() => {
          if (typeof Autodesk !== 'undefined' && Autodesk.Viewing) {
            clearInterval(checkInterval);
            const options = {
              env: 'AutodeskProduction',
              api: 'derivativeV2',
              getAccessToken: getAccessToken
            };
            Autodesk.Viewing.Initializer(options, finish);
          }
        }, 100);
      }
    });
    return window._autodeskInitPromise;
  }

  function showWeeklyViewerMessage(container, message, color) {
    if (!container) return;
    container.innerHTML = `<div style="padding:16px; color:${color || '#ef4444'}; font-size:0.8rem; text-align:center; background:#ffffff; height:100%; min-height:350px; display:flex; align-items:center; justify-content:center; box-sizing:border-box;">${message}</div>`;
  }

  function findTargetModel(node) {
    if (!node) return null;
    if (Array.isArray(node.files)) {
      for (const file of node.files) {
        const name = String(file.name || '').normalize('NFC');
        if (name.includes('07_정수지_C') || name.includes('정수지_C') || (name.includes('07_정수지') && name.includes('C'))) {
          return file;
        }
      }
      for (const file of node.files) {
        const name = String(file.name || '').normalize('NFC');
        if (name.includes('정수지') && (name.includes('_C') || name.includes('C.'))) {
          return file;
        }
      }
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        const found = findTargetModel(child);
        if (found) return found;
      }
    }
    return null;
  }

  // 🔍 슬라브 부재 인덱싱기 (시뮬레이션 1단계 바닥 자동 할당용, 초기 자동 착색은 끔)
  function executeSlabSearchAndHighlight(viewer, model) {
    if (!viewer) return;
    const targetModel = model || viewer.model;
    if (!targetModel) return;

    if (viewer._weeklySlabHighlightDone) return;
    viewer._weeklySlabHighlightDone = true;

    console.log('[Weekly3DViewer] Indexing Slab elements for simulation...');

    const searchKeywords = ['슬라브', '슬래브', 'Slab', 'slab', '바닥', 'Floor', 'floor', '상부', '하부'];
    const foundDbIds = new Set();
    let pendingCount = searchKeywords.length;

    const onSearchFinished = () => {
      let finalIds = Array.from(foundDbIds);

      const bindSlabsToPhase1 = (ids) => {
        if (Array.isArray(ids) && ids.length > 0) {
          if (!phaseData[1] || phaseData[1].length === 0) {
            phaseData[1] = ids;
            savePhaseDataToStorage();
            updateAssignedBadge();
          }
        }
        // 💡 초기 진입 시 기본 깨끗한 형상 표출 (자동 착색/유령화 실행 안 함)
        if (typeof viewer.clearThemingColors === 'function') {
          viewer.clearThemingColors(targetModel);
        }
        if (typeof viewer.showAll === 'function') {
          viewer.showAll();
        }
        if (viewer.impl && typeof viewer.impl.invalidate === 'function') {
          viewer.impl.invalidate(true, true, true);
        }
      };

      if (finalIds.length === 0 && typeof targetModel.getObjectTree === 'function') {
        targetModel.getObjectTree((tree) => {
          const directIds = [];
          tree.enumNodeChildren(tree.getRootId(), (dbId) => {
            const name = String(tree.getNodeName(dbId) || '').toLowerCase();
            if (name.includes('슬라브') || name.includes('슬래브') || name.includes('slab') || name.includes('바닥') || name.includes('floor')) {
              directIds.push(dbId);
            }
          }, true);

          bindSlabsToPhase1(directIds);
        });
      } else {
        bindSlabsToPhase1(finalIds);
      }
    };

    searchKeywords.forEach(keyword => {
      viewer.search(
        keyword,
        (ids) => {
          if (Array.isArray(ids)) {
            ids.forEach(id => foundDbIds.add(id));
          }
          pendingCount--;
          if (pendingCount === 0) onSearchFinished();
        },
        () => {
          pendingCount--;
          if (pendingCount === 0) onSearchFinished();
        },
        null
      );
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 🚨 [FEATURE INTEGRATION] 4D Construction Phasing Simulation UI & Logic
  // ──────────────────────────────────────────────────────────────────────────
  function updateAssignedBadge() {
    const badge = document.getElementById('sim-assigned-badge');
    if (!badge) return;
    const totalCount = (phaseData[1].length + phaseData[2].length + phaseData[3].length);
    badge.textContent = `지정: ${totalCount}개 (1단계:${phaseData[1].length}, 2단계:${phaseData[2].length}, 3단계:${phaseData[3].length})`;
  }

  function assignPhase(viewer, phaseNum) {
    if (!viewer) return;
    const selection = viewer.getSelection();
    if (!Array.isArray(selection) || selection.length === 0) {
      alert("선택된 객체가 없습니다. 뷰어에서 3D 부재를 먼저 클릭한 후 지정해주세요.");
      return;
    }

    const currentList = phaseData[phaseNum] || [];
    const set = new Set([...currentList, ...selection]);
    phaseData[phaseNum] = Array.from(set);

    // 💾 영구 저장
    savePhaseDataToStorage();
    updateAssignedBadge();

    alert(`${phaseNum}단계에 ${selection.length}개 객체가 할당되었습니다. (해당 단계 총 ${phaseData[phaseNum].length}개)`);
    viewer.clearSelection();
  }

  function playPhase(viewer, phaseNum) {
    if (!viewer) return;
    const THREE_NS = window.THREE || (typeof Autodesk !== 'undefined' && Autodesk.Viewing && Autodesk.Viewing.Private && Autodesk.Viewing.Private.THREE);
    if (!THREE_NS || !THREE_NS.Vector4) return;

    // 🎨 단계별 선명하고 뚜렷한 착색 색상 정의
    // 🟡 1단계 (하부 슬래브/바닥): 선명한 노란색 (R:1.0, G:0.8, B:0.0, A:0.95)
    // 🔵 2단계 (벽체): 선명한 파란색 (R:0.0, G:0.45, B:1.0, A:0.95)
    // 🟢 3단계 (상부 슬래브): 선명한 초록색 (R:0.15, G:0.85, B:0.25, A:0.95)
    const colors = {
      1: new THREE_NS.Vector4(1.0, 0.8, 0.0, 0.95),  // 1단계 (바닥): 노랑
      2: new THREE_NS.Vector4(0.0, 0.45, 1.0, 0.95), // 2단계 (벽체): 파랑
      3: new THREE_NS.Vector4(0.15, 0.85, 0.25, 0.95) // 3단계 (상부): 초록
    };

    const targetModel = viewer.model;

    // 1. 뷰어 기존 착색 및 선택 해제
    if (typeof viewer.clearThemingColors === 'function') {
      viewer.clearThemingColors(targetModel);
    }
    viewer.clearSelection();

    // 2. 전체 모델 유령화(Ghosting) 활성화
    if (typeof viewer.setGhosting === 'function') {
      viewer.setGhosting(true);
    }
    if (viewer.prefs) {
      viewer.prefs.set('ghosting', true);
    }

    // 3. 1단계부터 선택한 단계(phaseNum) 이하까지 모든 객체 착색
    const accumulatedDbIds = [];
    for (let i = 1; i <= phaseNum; i++) {
      const ids = phaseData[i] || [];
      const color = colors[i];
      ids.forEach(dbId => {
        accumulatedDbIds.push(dbId);
        try {
          if (typeof viewer.setThemingColor === 'function') {
            viewer.setThemingColor(dbId, color, targetModel, true);
          }
        } catch (e) {}
      });
    }

    if (accumulatedDbIds.length > 0) {
      // 4. 누적 부재들 isolate & show로 뚜렷하게 강조 표출
      if (typeof viewer.isolate === 'function') {
        viewer.isolate(accumulatedDbIds);
      }
      accumulatedDbIds.forEach(dbId => {
        try {
          if (typeof viewer.show === 'function') viewer.show(dbId);
        } catch (e) {}
      });
      console.log(`[Weekly4DSim] Played phase ${phaseNum} with ${accumulatedDbIds.length} colored elements.`);
    } else {
      alert(`${phaseNum}단계 이하에 지정된 객체가 없습니다. [설정 ⚙️] 버튼을 누른 후 객체를 1/2/3단계에 먼저 지정해 주세요.`);
    }

    if (viewer.impl && typeof viewer.impl.invalidate === 'function') {
      viewer.impl.invalidate(true, true, true);
    }
  }

  function resetViewerSim(viewer) {
    if (!viewer) return;
    phaseData = { 1: [], 2: [], 3: [] };
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {}

    if (typeof viewer.clearThemingColors === 'function') {
      viewer.clearThemingColors();
    }
    if (typeof viewer.showAll === 'function') {
      viewer.showAll();
    }
    viewer.clearSelection();
    updateAssignedBadge();
    if (viewer.impl && typeof viewer.impl.invalidate === 'function') {
      viewer.impl.invalidate(true, true, true);
    }
    alert("시뮬레이션 객체 할당 정보가 초기화되었습니다.");
  }

  function render4DSimulationPanel(viewer, container) {
    if (!container || document.getElementById('weekly-4d-sim-panel')) return;

    const panel = document.createElement('div');
    panel.id = 'weekly-4d-sim-panel';
    panel.style.cssText = `
      position: relative;
      width: 100%;
      margin-top: 10px;
      background: rgba(15, 23, 42, 0.95);
      border: 1px solid rgba(56, 189, 248, 0.35);
      border-radius: 8px;
      padding: 10px 12px;
      box-sizing: border-box;
      color: #e2e8f0;
      font-family: inherit;
      user-select: none;
    `;

    panel.innerHTML = `
      <!-- 헤더 (4D 시공 시뮬레이션 & 설정 버튼) -->
      <div style="font-size:0.8rem; font-weight:800; color:#38bdf8; display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
        <span style="display:flex; align-items:center; gap:6px;">
          <i class="fas fa-play-circle" style="color:#38bdf8;"></i> 4D 시공 시뮬레이션
        </span>
        <button id="toggle-sim-panel-btn" title="패널 확장/축소" style="background:rgba(56,189,248,0.15); border:1px solid rgba(56,189,248,0.4); color:#7dd3fc; font-size:0.7rem; padding:3px 8px; border-radius:4px; cursor:pointer; font-weight:bold;">
          <span id="toggle-sim-panel-text">설정 ⚙️</span>
        </button>
      </div>

      <!-- [기본/축소 상태] 이미지 구성과 100% 동일한 선명한 카드형 재생 버튼 3개 -->
      <div id="sim-folded-body" style="display:block;">
        <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:8px;">
          <button id="quick-play-1" style="background:#0f172a; border:2px solid #f59e0b; color:#fbbf24; font-size:0.75rem; padding:8px 4px; border-radius:6px; cursor:pointer; font-weight:bold; transition:all 0.2s;">▶ 1단계</button>
          <button id="quick-play-2" style="background:#0f172a; border:2px solid #3b82f6; color:#60a5fa; font-size:0.75rem; padding:8px 4px; border-radius:6px; cursor:pointer; font-weight:bold; transition:all 0.2s;">▶ 2단계</button>
          <button id="quick-play-3" style="background:#0f172a; border:2px solid #22c55e; color:#4ade80; font-size:0.75rem; padding:8px 4px; border-radius:6px; cursor:pointer; font-weight:bold; transition:all 0.2s;">▶ 3단계</button>
        </div>
      </div>

      <!-- [확장 상태] 상세 설정 패널 (기본 숨김) -->
      <div id="sim-expanded-body" style="margin-top:8px; display:none; border-top:1px solid rgba(255,255,255,0.1); padding-top:8px;">
        <div id="sim-assigned-badge" style="font-size:0.7rem; background:rgba(56,189,248,0.15); color:#7dd3fc; padding:4px 8px; border-radius:4px; margin-bottom:8px; text-align:center;">
          지정: 0개 (1단계:0, 2단계:0, 3단계:0)
        </div>

        <!-- A. 객체 지정 그룹 (Assign) -->
        <div style="margin-bottom:8px; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:8px;">
          <div style="font-size:0.7rem; color:#94a3b8; margin-bottom:4px; font-weight:700;">[A. 객체 지정 (Assign)]</div>
          <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:6px;">
            <button id="assign-phase-1" style="background:rgba(245,158,11,0.2); border:1px solid #f59e0b; color:#fbbf24; font-size:0.7rem; padding:6px 2px; border-radius:4px; cursor:pointer; font-weight:bold;">1단계(하부)</button>
            <button id="assign-phase-2" style="background:rgba(59,130,246,0.2); border:1px solid #3b82f6; color:#60a5fa; font-size:0.7rem; padding:6px 2px; border-radius:4px; cursor:pointer; font-weight:bold;">2단계(벽체)</button>
            <button id="assign-phase-3" style="background:rgba(34,197,94,0.2); border:1px solid #22c55e; color:#4ade80; font-size:0.7rem; padding:6px 2px; border-radius:4px; cursor:pointer; font-weight:bold;">3단계(상부)</button>
          </div>
        </div>

        <!-- B. 시뮬레이션 재생 그룹 (Play) -->
        <div>
          <div style="font-size:0.7rem; color:#94a3b8; margin-bottom:4px; font-weight:700;">[B. 단계별 재생 (Play)]</div>
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:6px; margin-bottom:6px;">
            <button id="play-phase-1" style="background:#1e293b; border:1px solid #f59e0b; color:#fbbf24; font-size:0.7rem; padding:6px; border-radius:4px; cursor:pointer; font-weight:bold;">▶ 1단계 보기</button>
            <button id="play-phase-2" style="background:#1e293b; border:1px solid #3b82f6; color:#60a5fa; font-size:0.7rem; padding:6px; border-radius:4px; cursor:pointer; font-weight:bold;">▶ 2단계 보기</button>
          </div>
          <div style="display:grid; grid-template-columns: 1fr 1fr; gap:6px;">
            <button id="play-phase-3" style="background:#1e293b; border:1px solid #22c55e; color:#4ade80; font-size:0.7rem; padding:6px; border-radius:4px; cursor:pointer; font-weight:bold;">▶ 3단계 보기</button>
            <button id="reset-viewer" style="background:rgba(239,68,68,0.2); border:1px solid #ef4444; color:#fca5a5; font-size:0.7rem; padding:6px; border-radius:4px; cursor:pointer; font-weight:bold;">🧹 초기화</button>
          </div>
        </div>
      </div>
    `;

    container.appendChild(panel);

    // 초기 지정 배지 갱신
    updateAssignedBadge();

    // 확장/축소 토글 이벤트
    const toggleBtn = document.getElementById('toggle-sim-panel-btn');
    const toggleText = document.getElementById('toggle-sim-panel-text');
    const foldedBody = document.getElementById('sim-folded-body');
    const expandedBody = document.getElementById('sim-expanded-body');

    toggleBtn.onclick = () => {
      isPanelExpanded = !isPanelExpanded;
      if (isPanelExpanded) {
        foldedBody.style.display = 'none';
        expandedBody.style.display = 'block';
        toggleText.textContent = '축소 ▲';
      } else {
        foldedBody.style.display = 'block';
        expandedBody.style.display = 'none';
        toggleText.textContent = '설정 ⚙️';
      }
    };

    // 빠른 재생 이벤트 (축소 상태)
    document.getElementById('quick-play-1').onclick = () => playPhase(viewer, 1);
    document.getElementById('quick-play-2').onclick = () => playPhase(viewer, 2);
    document.getElementById('quick-play-3').onclick = () => playPhase(viewer, 3);

    // 상세 이벤트 (확장 상태)
    document.getElementById('assign-phase-1').onclick = () => assignPhase(viewer, 1);
    document.getElementById('assign-phase-2').onclick = () => assignPhase(viewer, 2);
    document.getElementById('assign-phase-3').onclick = () => assignPhase(viewer, 3);

    document.getElementById('play-phase-1').onclick = () => playPhase(viewer, 1);
    document.getElementById('play-phase-2').onclick = () => playPhase(viewer, 2);
    document.getElementById('play-phase-3').onclick = () => playPhase(viewer, 3);

    document.getElementById('reset-viewer').onclick = () => resetViewerSim(viewer);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // 🚀 메인 뷰어 초기화
  // ──────────────────────────────────────────────────────────────────────────
  async function initWeekly3DViewer(containerId) {
    const container = document.getElementById(containerId || 'weekly-3d-viewer');
    if (!container) return false;

    container.style.width = '100%';
    container.style.height = container.style.height || '350px';
    container.style.minHeight = '350px';
    container.style.display = 'block';
    container.style.position = container.style.position || 'relative';

    if (container._weeklyViewerInstance) {
      setTimeout(() => {
        if (typeof container._weeklyViewerInstance.resize === 'function') {
          container._weeklyViewerInstance.resize();
        }
      }, 100);
      return true;
    }

    container.innerHTML = '<div style="padding:16px; color:#0f172a; font-size:0.85rem; font-weight:bold; display:flex; align-items:center; justify-content:center; height:100%; background:#ffffff;"><i class="fas fa-spinner fa-spin" style="margin-right:8px; color:#0284c7;"></i> 강북정수장 [강북_구조물_신설_07_정수지_C] 3D BIM 모델 로딩 중...</div>';

    try {
      await ensureAutodeskInitialized();

      container.innerHTML = '';
      const viewer = new Autodesk.Viewing.GuiViewer3D(container, { extensions: [] });
      container._weeklyViewerInstance = viewer;

      const startCode = viewer.start();
      if (startCode > 0) {
        console.error('[Weekly3DViewer] Viewer start failed code:', startCode);
        container._weeklyViewerInstance = null;
        window._weekly3DInited = false;
        showWeeklyViewerMessage(container, `3D Viewer 시작에 실패했습니다. (code: ${startCode})`);
        return false;
      }

      // 🎨 지오메트리 로드 완료 시 뷰어 흰 바탕 배경 적용 (다른 뷰어 미영향)
      const applyWhiteTheme = () => {
        try {
          viewer.setEnvMapBackground(false);
          viewer.setBackgroundColor(255, 255, 255, 245, 245, 245);
          if (typeof viewer.setLightPreset === 'function') viewer.setLightPreset(1);
          if (typeof viewer.setGroundShadow === 'function') viewer.setGroundShadow(true);
        } catch (e) {}
      };

      // 🚨 [4D Simulation Panel 구축] (뷰어의 부모 노드 외곽 아래에 부착)
      const viewerOuterWrap = container.closest('div[style*="flex-direction: column"]') || container.parentElement;
      render4DSimulationPanel(viewer, viewerOuterWrap);

      // 🚨 [OBJECT_TREE_CREATED_EVENT 및 GEOMETRY_LOADED_EVENT 바인딩]
      viewer.addEventListener(Autodesk.Viewing.OBJECT_TREE_CREATED_EVENT, (evt) => {
        console.log('[Weekly3DViewer] OBJECT_TREE_CREATED_EVENT triggered.');
        executeSlabSearchAndHighlight(viewer, evt.model || viewer.model);
      });

      viewer.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, (evt) => {
        applyWhiteTheme();
        setTimeout(() => {
          executeSlabSearchAndHighlight(viewer, evt.model || viewer.model);
        }, 300);
      });

      // 프로젝트 모델 트리에서 [강북_구조물_신설_07_정수지_C] 검색
      let treeData = window._globalRvtModelsCache;
      if (!treeData && typeof window.fetchGlobalRvtModels === 'function') {
        treeData = await window.fetchGlobalRvtModels();
      } else if (!treeData) {
        const resp = await fetch('/api/models/tree');
        treeData = await resp.json();
      }

      const targetFile = findTargetModel(treeData);
      if (!targetFile || !targetFile.urn) {
        console.warn('[Weekly3DViewer] 정수지 C 모델을 찾지 못했습니다.');
        container._weeklyViewerInstance = null;
        window._weekly3DInited = false;
        showWeeklyViewerMessage(container, '[강북_구조물_신설_07_정수지_C] 모델 정보를 불러올 수 없습니다.');
        return false;
      }

      console.log('[Weekly3DViewer] Target file:', targetFile.name, targetFile.urn);

      // Document URN 로드
      const finalUrn = targetFile.urn.startsWith('urn:') ? targetFile.urn : 'urn:' + targetFile.urn;
      Autodesk.Viewing.Document.load(finalUrn, (doc) => {
        const viewable = doc.getRoot().getDefaultGeometry();
        viewer.loadDocumentNode(doc, viewable, { globalOffset: { x: 0, y: 0, z: 0 } }).then((model) => {
          console.log('[Weekly3DViewer] 강북_구조물_신설_07_정수지_C 로드 성공 ✅');
          applyWhiteTheme();

          // -90도 회전 보정 주입
          if (window.applyModelRotation) {
            window.applyModelRotation(viewer, targetFile.urn, true);
          }

          setTimeout(() => {
            executeSlabSearchAndHighlight(viewer, model);
          }, 400);
        }).catch(err => {
          console.error('[Weekly3DViewer] loadDocumentNode error:', err);
          container._weeklyViewerInstance = null;
          window._weekly3DInited = false;
          showWeeklyViewerMessage(container, '3D 모델 노드 로드에 실패했습니다. 탭을 다시 열어 재시도할 수 있습니다.');
        });
      }, (code, msg) => {
        console.error('[Weekly3DViewer] Document load failure:', code, msg);
        container._weeklyViewerInstance = null;
        window._weekly3DInited = false;
        showWeeklyViewerMessage(container, `3D 모델 문서 로드에 실패했습니다. (${code || 'unknown'})`);
      });

      // ResizeObserver 바인딩
      const ro = new ResizeObserver(() => {
        if (viewer && typeof viewer.resize === 'function') {
          viewer.resize();
        }
      });
      ro.observe(container);
      return true;

    } catch (err) {
      console.error('[Weekly3DViewer] 초기화 실패:', err);
      container._weeklyViewerInstance = null;
      window._autodeskInitPromise = null;
      window._weekly3DInited = false;
      showWeeklyViewerMessage(container, err.message || '3D Viewer 초기화에 실패했습니다.');
      return false;
    }
  }

  window.initWeekly3DViewer = initWeekly3DViewer;
})();
