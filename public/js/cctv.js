/* ==========================================================================
   cctv.js — CCTV & BIM Monitoring Tab Logic (ES6 Module)
   ========================================================================== */

import { initViewer, loadModel } from './viewer.js';
import { refreshGlobalVisibilityPopup, initModelVisibilityPopupEvents } from './model-visibility.js';

// Predefined camera state corresponding to CCTV camera view angle for model alignment
const CCTV_CAMERA_STATE = {
    position: { x: -120.45, y: 198.32, z: 85.60 },
    target: { x: -10.25, y: 35.12, z: -15.48 },
    up: { x: 0.15, y: 0.25, z: 0.95 }
};

let currentCctvImg = '/img/lapse/lapse_1.jpg';
let activeChannel = null;
let currentHlsInstance = null;
let currentPresetIdx = 0;

const PRESET_VIEWS = [
    { name: '조감도 (ISO)', position: { x: -120, y: 180, z: 90 }, target: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } },
    { name: '평면도 (Top)', position: { x: 0, y: 0, z: 300 }, target: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 } },
    { name: '정면도 (Front)', position: { x: 0, y: -300, z: 0 }, target: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } }
];

export async function initCctvTab() {
    // 1. Initialize Autodesk Viewer
    await initCctvBimViewer();

    // 2. Fetch Live Channels from Backend API
    await fetchLiveCctvChannels();

    // 3. Bind Bottom Sub-Tabs (위치별 실시간 CCTV 관제 vs 현장 이슈)
    initCctvSubTabs();

    // 4. Bind Modal Handlers (이슈 등록 모달 & 캡처 버튼)
    initCctvModalHandlers();

    // 5. Bind Viewpoint Saving & Presets (시점 저장 & 각도 조절)
    initViewpointSaveHandlers();

    // 6. Bind Viewport Camera Sync
    initViewSyncHandler();

    // 7. Bind Model Visibility Popup Events
    initModelVisibilityPopupEvents();

    // 8. Initial Issues Table Render
    refreshCctvIssuesTable();
}

/**
 * Autodesk Viewer Initialization inside CCTV tab
 */
async function initCctvBimViewer() {
    const container = document.getElementById('cctv-viewer');
    const nameLabel = document.getElementById('loaded-model-name');
    if (!container) return;

    const savedUrn = localStorage.getItem('aps_last_urn');
    const savedName = localStorage.getItem('aps_last_urn_name');
    
    // Default fallback URN: 강북_구조물_신설_02_응집침전지_C
    const defaultUrn = 'dXJuOmFkc2sud2lwcHJvZDpmcy5maWxlOnZmLk1EYVFnc1N6UVBheVJHaU53dGl3cUE_dmVyc2lvbj0y';
    const defaultName = '강북_구조물_신설_02_응집침전지_C';
    
    const targetUrn = savedUrn || defaultUrn;
    const targetName = savedName || defaultName;

    if (nameLabel) {
        nameLabel.textContent = targetName;
        nameLabel.title = targetName;
    }

    try {
        console.log(`[CCTV Viewer] Initializing model: ${targetName}`);
        const viewer = await initViewer(container, true);
        if (viewer) {
            window.cctvViewer = viewer;
            await loadModel(viewer, targetUrn);
            console.log('[CCTV Viewer] Model loaded successfully.');
        }
    } catch (err) {
        console.error('[CCTV Viewer] Initialization failed:', err);
    }
}

/**
 * Fetch live CCTV channels from /api/cctv/live
 */
async function fetchLiveCctvChannels() {
    try {
        const resp = await fetch('/api/cctv/live');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        if (data.success && Array.isArray(data.channels) && data.channels.length > 0) {
            console.log(`[CCTV] Loaded ${data.channels.length} live channels from backend.`);
            bindChannelCards(data.channels);
        } else {
            console.warn('[CCTV] Backend returned empty channel list, using static card bindings.');
            initTimelineHandlers();
        }
    } catch (err) {
        console.warn('[CCTV] Failed to fetch /api/cctv/live, using static card fallback:', err.message);
        initTimelineHandlers();
    }
}

function getProxiedStreamUrl(url) {
    if (!url) return '';
    if (url.startsWith('/api/cctv/proxy/')) return url;
    if (url.startsWith('https://')) {
        return '/api/cctv/proxy/https/' + url.replace('https://', '');
    }
    if (url.startsWith('http://')) {
        return '/api/cctv/proxy/http/' + url.replace('http://', '');
    }
    return url;
}

/**
 * Play official HLS stream or standard video file
 */
export function playOfficialHlsStream(rawStreamUrl, title) {
    const streamUrl = getProxiedStreamUrl(rawStreamUrl);
    const video = document.getElementById('cctv-video-player');
    const fallbackImg = document.getElementById('cctv-fallback-img');
    const titleEl = document.getElementById('cctv-live-title');

    if (titleEl && title) {
        titleEl.innerHTML = `<i class="fas fa-video"></i> 실시간 CCTV 영상 (${title})`;
    }

    if (!video) return;

    if (currentHlsInstance) {
        currentHlsInstance.destroy();
        currentHlsInstance = null;
    }
    if (window.currentHls) {
        window.currentHls.destroy();
        window.currentHls = null;
    }

    const showFallback = () => {
        if (fallbackImg) {
            video.style.display = 'none';
            fallbackImg.style.display = 'block';
            if (currentCctvImg) fallbackImg.src = currentCctvImg;
        }
    };

    const showVideo = () => {
        if (fallbackImg) {
            fallbackImg.style.display = 'none';
            video.style.display = 'block';
        }
    };

    if (!streamUrl) {
        console.warn('[CCTV Player] Stream URL is empty, showing fallback img.');
        showFallback();
        return;
    }

    showVideo();
    console.log(`[CCTV Player] Playing proxied stream: ${streamUrl}`);

    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;

    if (typeof Hls !== 'undefined' && Hls.isSupported() && (streamUrl.includes('.m3u8') || streamUrl.includes('/proxy/'))) {
        const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: true,
            backBufferLength: 90
        });
        currentHlsInstance = hls;
        window.currentHls = hls;

        hls.loadSource(streamUrl);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            const playPromise = video.play();
            if (playPromise !== undefined) {
                playPromise.catch(err => {
                    console.warn('[CCTV Autoplay retry with muted]', err);
                    video.muted = true;
                    video.play().catch(() => {
                        showFallback();
                    });
                });
            }
        });

        hls.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) {
                console.warn('[CCTV HLS Error]:', data.type, data.details);
                if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                    hls.startLoad();
                } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                    hls.recoverMediaError();
                } else {
                    hls.destroy();
                    showFallback();
                }
            }
        });
    } else {
        video.src = streamUrl;
        video.play().catch(() => {
            video.muted = true;
            video.play().catch(() => {
                showFallback();
            });
        });
    }
}

/**
 * Bind Channel Cards dynamically & restore saved viewpoint
 */
function bindChannelCards(channels) {
    const thumbsContainer = document.getElementById('thumbs-container');
    if (!thumbsContainer) return;

    thumbsContainer.innerHTML = channels.map((ch, idx) => `
        <div class="thumb-card ${idx === 0 ? 'active' : ''}" 
             data-cctv-id="${ch.id}" 
             data-stream-url="${ch.streamUrl}" 
             data-img="${ch.img || `/img/lapse/lapse_${(idx % 3) + 1}.jpg`}" 
             data-title="${ch.title || ch.name}"
             data-model-name="${ch.modelName || ''}"
             data-model-urn="${ch.modelUrn || ''}">
            <img src="${ch.img || `/img/lapse/lapse_${(idx % 3) + 1}.jpg`}" alt="${ch.title || ch.name}">
            <div class="thumb-info">${ch.title || ch.name}</div>
        </div>
    `).join('');

    const cards = thumbsContainer.querySelectorAll('.thumb-card');
    cards.forEach((card, idx) => {
        card.addEventListener('click', async () => {
            cards.forEach(c => c.classList.remove('active'));
            card.classList.add('active');

            const ch = channels[idx] || {};
            const streamUrl = card.dataset.streamUrl || ch.streamUrl;
            const title = card.dataset.title || ch.title || ch.name;
            const imgPath = card.dataset.img || ch.img;
            const modelName = card.dataset.modelName || ch.modelName;
            const modelUrn = card.dataset.modelUrn || ch.modelUrn;

            currentCctvImg = imgPath;
            activeChannel = ch;

            console.log(`[CCTV Click] Channel: ${title} | Stream: ${streamUrl} | Model URN: ${modelUrn}`);

            playOfficialHlsStream(streamUrl, title);

            // Load & switch 3D BIM model in cctvViewer
            if (window.cctvViewer && modelUrn) {
                const nameLabel = document.getElementById('loaded-model-name');
                if (nameLabel) {
                    nameLabel.textContent = `${modelName} (${title})`;
                    nameLabel.title = `${modelName} (${title})`;
                }
                try {
                    await loadModel(window.cctvViewer, modelUrn);
                    console.log(`[CCTV BIM Model Sync] Successfully loaded model: ${modelName}`);

                    // Restore saved viewpoint if available
                    const savedState = localStorage.getItem(`cctv_saved_view_${ch.id}`);
                    if (savedState) {
                        window.cctvViewer.restoreState(JSON.parse(savedState));
                        console.log(`[CCTV Viewpoint Restored] Restored saved camera angle for channel ${ch.id}`);
                    }
                } catch (err) {
                    console.warn(`[CCTV BIM Model Sync] Failed to load model ${modelUrn}:`, err);
                }
            }
        });
    });

    if (cards.length > 0) {
        cards[0].click();
    }
}

/**
 * Fallback static timeline card handlers (from index.html DOM)
 */
function initTimelineHandlers() {
    const thumbs = document.querySelectorAll('.thumb-card');

    thumbs.forEach(card => {
        card.addEventListener('click', async () => {
            thumbs.forEach(t => t.classList.remove('active'));
            card.classList.add('active');

            const streamUrl = card.dataset.streamUrl;
            const title = card.dataset.title || card.querySelector('.thumb-info')?.textContent || 'CCTV';
            const imgPath = card.dataset.img || '/img/lapse/lapse_1.jpg';
            const modelName = card.dataset.modelName;
            const modelUrn = card.dataset.modelUrn;
            const cctvId = card.dataset.cctvId || 'default';

            currentCctvImg = imgPath;

            if (streamUrl) {
                playOfficialHlsStream(streamUrl, title);
            }

            if (window.cctvViewer && modelUrn) {
                const nameLabel = document.getElementById('loaded-model-name');
                if (nameLabel) {
                    nameLabel.textContent = `${modelName} (${title})`;
                    nameLabel.title = `${modelName} (${title})`;
                }
                try {
                    await loadModel(window.cctvViewer, modelUrn);

                    const savedState = localStorage.getItem(`cctv_saved_view_${cctvId}`);
                    if (savedState) {
                        window.cctvViewer.restoreState(JSON.parse(savedState));
                    }
                } catch (err) {
                    console.warn(`[CCTV Static BIM Sync] Failed to load model ${modelUrn}:`, err);
                }
            }
        });
    });

    const activeCard = document.querySelector('.thumb-card.active');
    if (activeCard) {
        activeCard.click();
    }
}

/**
 * 📸 3D 시점 저장 및 각도 조절 핸들러 (Save Viewpoint & Presets)
 */
function initViewpointSaveHandlers() {
    const btnSaveView = document.getElementById('btn-cctv-save-viewpoint');
    const btnPresetView = document.getElementById('btn-cctv-preset-view');

    if (btnSaveView) {
        btnSaveView.addEventListener('click', () => {
            const viewer = window.cctvViewer;
            if (!viewer) {
                alert('APS 3D 모델 뷰어가 아직 초기화되지 않았습니다.');
                return;
            }
            try {
                const state = viewer.getState({ viewport: true });
                const activeCard = document.querySelector('.thumb-card.active');
                const chId = activeCard ? activeCard.dataset.cctvId : (activeChannel ? activeChannel.id : 'default');
                const chTitle = activeCard ? activeCard.dataset.title : (activeChannel ? activeChannel.title : '현재 관제');

                localStorage.setItem(`cctv_saved_view_${chId}`, JSON.stringify(state));
                alert(`📷 [3D 시점 저장 완료]\n'${chTitle}' 위치의 3D 모델 카메라 시점 및 각도가 저장되었습니다.`);
                console.log(`[CCTV Viewpoint Saved] Channel: ${chId}`, state);
            } catch (err) {
                console.error('[CCTV Viewpoint Save Error]', err);
                alert('시점 저장 중 오류가 발생했습니다.');
            }
        });
    }

    if (btnPresetView) {
        btnPresetView.addEventListener('click', () => {
            const viewer = window.cctvViewer;
            if (!viewer) return;

            currentPresetIdx = (currentPresetIdx + 1) % PRESET_VIEWS.length;
            const preset = PRESET_VIEWS[currentPresetIdx];

            if (typeof THREE !== 'undefined') {
                viewer.navigation.setView(
                    new THREE.Vector3(preset.position.x, preset.position.y, preset.position.z),
                    new THREE.Vector3(preset.target.x, preset.target.y, preset.target.z)
                );
                viewer.navigation.setUpVector(
                    new THREE.Vector3(preset.up.x, preset.up.y, preset.up.z)
                );
                viewer.impl.invalidate(true, true, true);
                console.log(`[CCTV Viewpoint Preset] Switched to preset angle: ${preset.name}`);
            }
        });
    }
}

/**
 * ⚡ 하단 서브탭 전환 핸들러 (위치별 실시간 CCTV 관제 vs 현장 이슈)
 */
function initCctvSubTabs() {
    const btnChannels = document.getElementById('btn-subtab-cctv-channels');
    const btnIssues = document.getElementById('btn-subtab-field-issues');
    const contentChannels = document.getElementById('subtab-content-channels');
    const contentIssues = document.getElementById('subtab-content-issues');
    const btnCaptureIssue = document.getElementById('btn-cctv-capture-issue');
    const btnExportPdf = document.getElementById('btn-export-cctv-pdf');

    if (btnChannels && btnIssues) {
        btnChannels.addEventListener('click', () => {
            btnChannels.classList.add('active');
            btnChannels.style.background = 'rgba(56, 189, 248, 0.2)';
            btnChannels.style.color = '#38bdf8';
            btnChannels.style.borderColor = 'rgba(56, 189, 248, 0.4)';

            btnIssues.classList.remove('active');
            btnIssues.style.background = 'rgba(255, 255, 255, 0.05)';
            btnIssues.style.color = '#94a3b8';
            btnIssues.style.borderColor = 'rgba(255, 255, 255, 0.1)';

            if (contentChannels) contentChannels.style.display = 'block';
            if (contentIssues) contentIssues.style.display = 'none';
            if (btnCaptureIssue) btnCaptureIssue.style.display = 'none';
            if (btnExportPdf) btnExportPdf.style.display = 'none';
        });

        btnIssues.addEventListener('click', () => {
            btnIssues.classList.add('active');
            btnIssues.style.background = 'rgba(56, 189, 248, 0.2)';
            btnIssues.style.color = '#38bdf8';
            btnIssues.style.borderColor = 'rgba(56, 189, 248, 0.4)';

            btnChannels.classList.remove('active');
            btnChannels.style.background = 'rgba(255, 255, 255, 0.05)';
            btnChannels.style.color = '#94a3b8';
            btnChannels.style.borderColor = 'rgba(255, 255, 255, 0.1)';

            if (contentChannels) contentChannels.style.display = 'none';
            if (contentIssues) contentIssues.style.display = 'block';
            if (btnCaptureIssue) btnCaptureIssue.style.display = 'inline-flex';
            if (btnExportPdf) btnExportPdf.style.display = 'inline-flex';

            refreshCctvIssuesTable();
        });
    }

    if (btnExportPdf) {
        btnExportPdf.addEventListener('click', () => {
            exportCctvFieldIssuesPdf();
        });
    }

    if (btnCaptureIssue) {
        btnCaptureIssue.addEventListener('click', captureCctvStreamAndOpenModal);
    }
}

/**
 * 📸 CCTV 실시간 비디오 프레임 캡처 & 이슈 생성 모달 연동
 */
function captureCctvStreamAndOpenModal() {
    const video = document.getElementById('cctv-video-player');
    let dataUrl = '/img/lapse/lapse_1.jpg';

    if (video && video.videoWidth > 0 && video.videoHeight > 0) {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            dataUrl = canvas.toDataURL('image/png');
        } catch (e) {
            console.warn('[CCTV Frame Capture] Canvas drawImage cross-origin restriction, fallback to static img:', e.message);
            dataUrl = currentCctvImg;
        }
    } else {
        dataUrl = currentCctvImg;
    }

    const modal = document.getElementById('dynamic-issue-modal');
    if (modal) {
        modal.style.display = 'flex';
        modal.setAttribute('aria-hidden', 'false');

        const activeCard = document.querySelector('.thumb-card.active');
        const channelTitle = activeCard ? activeCard.dataset.title : (activeChannel ? activeChannel.title : '강북정수장 현장관제');

        const titleInput = document.getElementById('issue-title');
        const structInput = document.getElementById('issue-structure');
        const descInput = document.getElementById('issue-desc');
        const hiddenData = document.getElementById('multi-capture-data');
        const imgList = document.getElementById('capture-image-list');

        if (titleInput) titleInput.value = `[CCTV 관제] ${channelTitle} 특이사항 확인`;
        if (structInput) structInput.value = channelTitle;
        if (descInput) descInput.value = `${channelTitle} 실시간 CCTV 모니터링 중 특이사항이 포착되어 이슈 등록함.`;
        if (hiddenData) hiddenData.value = JSON.stringify([dataUrl]);

        if (imgList) {
            imgList.innerHTML = `
                <div style="position:relative; min-width:100px; height:75px; border-radius:8px; overflow:hidden; border:2px solid #38bdf8;">
                    <img src="${dataUrl}" style="width:100%; height:100%; object-fit:cover;">
                    <span style="position:absolute; bottom:2px; right:2px; background:rgba(0,0,0,0.7); color:#38bdf8; font-size:9px; padding:1px 4px; border-radius:3px;">CCTV 캡처</span>
                </div>
            `;
        }
    }
}

/**
 * 🔒 현장 관제 이슈 등록 모달 핸들러 바인딩
 */
function initCctvModalHandlers() {
    const btnRegister = document.getElementById('btn-issue-register');
    if (btnRegister) {
        btnRegister.addEventListener('click', captureCctvStreamAndOpenModal);
    }

    const modal = document.getElementById('dynamic-issue-modal');
    const btnCancel = document.getElementById('btn-modal-cancel');
    const btnSave = document.getElementById('btn-modal-save');

    if (btnCancel && modal) {
        btnCancel.addEventListener('click', () => {
            modal.style.display = 'none';
        });
    }

    if (btnSave && modal) {
        btnSave.addEventListener('click', () => {
            const title = (document.getElementById('issue-title')?.value || '').trim();
            if (!title) {
                alert('이슈 제목을 입력해주세요.');
                return;
            }

            const status = document.getElementById('issue-status')?.value || 'Open';
            const type = document.getElementById('issue-type')?.value || '설계 이슈';
            const description = document.getElementById('issue-desc')?.value || '';
            const location = document.getElementById('issue-structure')?.value || '강북정수장';
            const trade = document.getElementById('issue-trade')?.value || '기계';
            const author = document.getElementById('issue-assignee')?.value || '현장관제자';
            const verifier = document.getElementById('issue-verifier')?.value || '';
            const startDate = document.getElementById('issue-startdate')?.value || new Date().toISOString().slice(0, 10);
            const dueDate = document.getElementById('issue-duedate')?.value || '';

            let cctvSnapshot = currentCctvImg;
            const hiddenData = document.getElementById('multi-capture-data')?.value;
            if (hiddenData) {
                try {
                    const parsed = JSON.parse(hiddenData);
                    if (Array.isArray(parsed) && parsed[0]) cctvSnapshot = parsed[0];
                } catch(e) {}
            }

            const newIssue = {
                id: 'cctv_issue_' + Date.now(),
                title,
                status,
                type,
                location,
                structureName: location,
                trade,
                description,
                author,
                assignee: author,
                verifier,
                startDate,
                dueDate,
                cctvSnapshot,
                createdAt: new Date().toISOString()
            };

            // 1. CCTV 현장 이슈 저장
            const cctvIssues = JSON.parse(localStorage.getItem('cctv_field_issues') || '[]');
            cctvIssues.unshift(newIssue);
            localStorage.setItem('cctv_field_issues', JSON.stringify(cctvIssues));

            // 2. 전체 이슈 저장소에도 반영하여 대시보드/이슈 탭에 노출
            const allIssues = JSON.parse(localStorage.getItem('aps_issues') || '[]');
            allIssues.unshift(newIssue);
            localStorage.setItem('aps_issues', JSON.stringify(allIssues));

            alert(`✅ [이슈 등록 완료]\n"${title}" 이슈가 정상 등록되었습니다.`);
            modal.style.display = 'none';

            refreshCctvIssuesTable();
        });
    }
}

/**
 * 📋 현장 이슈 테이블 실시간 동기화 렌더링
 */
function refreshCctvIssuesTable() {
    const tbody = document.getElementById('cctv-issues-table-body');
    if (!tbody) return;

    const saved = JSON.parse(localStorage.getItem('cctv_field_issues') || '[]');
    if (saved.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="padding: 16px; text-align: center; color: #94a3b8;">
                    등록된 현장 CCTV 관제 이슈가 없습니다. 상단 [📸 CCTV 캡처 & 이슈 등록] 버튼을 눌러 새 이슈를 추가하세요.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = saved.map((iss, idx) => `
        <tr style="border-bottom: 1px solid rgba(255,255,255,0.06);">
            <td style="padding: 6px 10px; text-align: center; font-weight: bold; color: #64748b;">#${idx + 1}</td>
            <td style="padding: 6px 10px;">
                <img src="${iss.cctvSnapshot || iss.thumbnail || '/img/lapse/lapse_1.jpg'}" style="width: 50px; height: 35px; object-fit: cover; border-radius: 4px; border: 1px solid #334155;">
            </td>
            <td style="padding: 6px 10px; font-weight: bold; color: #f8fafc;">${iss.title}</td>
            <td style="padding: 6px 10px; color: #38bdf8;">${iss.location || iss.structureName || '강북정수장'}</td>
            <td style="padding: 6px 10px; color: #cbd5e1; max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${iss.description || '-'}</td>
            <td style="padding: 6px 10px; text-align: center; color: #94a3b8;">${iss.author || '현장관제자'}</td>
            <td style="padding: 6px 10px; text-align: center; font-size: 0.7rem; color: #64748b;">${new Date(iss.createdAt || Date.now()).toLocaleDateString()}</td>
        </tr>
    `).join('');
}

/**
 * Viewport camera sync with CCTV angle
 */
function initViewSyncHandler() {
    const btnSync = document.getElementById('btn-view-sync');

    if (!btnSync) return;

    btnSync.addEventListener('click', () => {
        const viewer = window.cctvViewer;
        if (!viewer) {
            alert('APS 3D 뷰어가 아직 활성화되지 않았습니다.');
            return;
        }

        if (typeof Autodesk !== 'undefined' && typeof THREE !== 'undefined') {
            try {
                viewer.navigation.setView(
                    new THREE.Vector3(CCTV_CAMERA_STATE.position.x, CCTV_CAMERA_STATE.position.y, CCTV_CAMERA_STATE.position.z),
                    new THREE.Vector3(CCTV_CAMERA_STATE.target.x, CCTV_CAMERA_STATE.target.y, CCTV_CAMERA_STATE.target.z)
                );
                viewer.navigation.setUpVector(
                    new THREE.Vector3(CCTV_CAMERA_STATE.up.x, CCTV_CAMERA_STATE.up.y, CCTV_CAMERA_STATE.up.z)
                );
                
                viewer.impl.invalidate(true, true, true);
                console.log('[CCTV View Sync] Viewport cameras aligned.');
            } catch (err) {
                console.warn('[CCTV View Sync] Failed to align camera vector: ', err);
            }
        }
    });
}

/**
 * ── CCTV 현장 관제 이슈 PDF 보고서 생성 엔진 ──────────────────────
 * (사진 20% 확대 적용: 385px max-height, 4:3 화질)
 */
export function exportCctvFieldIssuesPdf(fieldIssues) {
    if (!fieldIssues || fieldIssues.length === 0) {
        const saved = JSON.parse(localStorage.getItem('cctv_field_issues') || '[]');
        fieldIssues = saved;
    }

    if (!fieldIssues || fieldIssues.length === 0) {
        alert('내보낼 강북정수장 CCTV 현장 관제 이슈가 없습니다.');
        return;
    }

    let summaryRowsHtml = '';
    fieldIssues.forEach((issue, idx) => {
        summaryRowsHtml += `
            <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 8px 10px; font-weight: bold; text-align: center; color: #475569; width: 40px;">
                    #${idx + 1}
                </td>
                <td style="padding: 8px 10px; color: #0f172a; font-weight: 600; min-width: 140px;">
                    ${issue.title}
                </td>
                <td style="padding: 8px 10px; color: #0284c7; font-weight: 600; min-width: 130px;">
                    ${issue.location || issue.structureName || '강북정수장 현장관제 구간'}
                </td>
                <td style="padding: 8px 10px; color: #334155; line-height: 1.4; max-width: 220px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                    ${issue.description || '상세 내용 없음'}
                </td>
                <td style="padding: 8px 10px; color: #475569; width: 90px; text-align: center;">
                    ${issue.author || '현장관제자'}
                </td>
                <td style="padding: 8px 10px; color: #64748b; font-size: 11px; width: 120px; text-align: center;">
                    ${new Date(issue.createdAt || Date.now()).toLocaleString()}
                </td>
            </tr>
        `;
    });

    let detailPagesHtml = '';
    fieldIssues.forEach((issue, idx) => {
        const bimModelDisplay = issue.modelUrn
            ? '02_응집침전지_구조_C.rvt (APS 3D 모델 연동)'
            : '강북정수장 공종별 통합 Revit 모델';

        detailPagesHtml += `
            <div class="issue-detail-page" style="page-break-before: always; padding: 20px; box-sizing: border-box;">
                <div style="display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #0369a1; padding-bottom: 3px; margin-bottom: 6px;">
                    <div>
                        <span style="background: #0284c7; color: white; padding: 2px 8px; border-radius: 6px; font-size: 10px; font-weight: bold; margin-bottom: 2px; display: inline-block;">
                            이슈 상세 보고서 #${idx + 1} / ${fieldIssues.length}
                        </span>
                        <h2 style="margin: 2px 0 0 0; font-size: 16px; font-weight: bold; color: #0f172a;">
                            ${issue.title}
                        </h2>
                    </div>
                    <div style="font-size: 10.5px; color: #64748b; text-align: right;">
                        <div><strong>작성자:</strong> ${issue.author || '현장 관제자'}</div>
                        <div><strong>작성일시:</strong> ${new Date(issue.createdAt || Date.now()).toLocaleString()}</div>
                    </div>
                </div>

                <div style="margin-bottom: 6px; background: #0f172a; border-radius: 6px; padding: 4px; border: 1px solid #94a3b8; text-align: center;">
                    <img src="${issue.cctvSnapshot || issue.thumbnail || '/img/lapse/lapse_1.jpg'}"
                         style="width: 100%; max-height: 385px; aspect-ratio: 4 / 3; object-fit: contain; border-radius: 4px; display: block; margin: 0 auto;">
                    <div style="margin-top: 2px; font-size: 9.5px; color: #94a3b8; text-align: right;">📸 CCTV 실시간 라이브 프레임 캡처 (4:3 비율)</div>
                </div>

                <table style="width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 6px;">
                    <tr>
                        <th style="width: 15%; background: #f1f5f9; padding: 6px; border: 1px solid #cbd5e1; color: #334155; text-align: left;">관제 위치</th>
                        <td style="width: 35%; padding: 6px; border: 1px solid #cbd5e1; color: #0f172a; font-weight: 600;">${issue.location || issue.structureName || '강북정수장 현장관제 구간'}</td>
                        <th style="width: 15%; background: #f1f5f9; padding: 6px; border: 1px solid #cbd5e1; color: #334155; text-align: left;">BIM 연동 모델</th>
                        <td style="width: 35%; padding: 6px; border: 1px solid #cbd5e1; color: #0f172a;">${bimModelDisplay}</td>
                    </tr>
                    <tr>
                        <th style="background: #f1f5f9; padding: 6px; border: 1px solid #cbd5e1; color: #334155; text-align: left;">상세 내용</th>
                        <td colspan="3" style="padding: 8px; border: 1px solid #cbd5e1; color: #1e293b; line-height: 1.5;">${issue.description || '상세 검토 내용 없음'}</td>
                    </tr>
                </table>
            </div>
        `;
    });

    const fullReportHtml = `
        <!DOCTYPE html>
        <html lang="ko">
        <head>
            <meta charset="UTF-8">
            <title>강북정수장 현장 CCTV 관제 이슈 보고서</title>
            <style>
                @page { size: A4 portrait; margin: 10mm; }
                body { font-family: 'Noto Sans KR', sans-serif; color: #0f172a; margin: 0; padding: 0; background: #fff; }
                .report-container { width: 100%; max-width: 800px; margin: 0 auto; }
            </style>
        </head>
        <body>
            <div class="report-container">
                <div style="text-align: center; border-bottom: 3px double #0284c7; padding-bottom: 12px; margin-bottom: 20px;">
                    <h1 style="margin: 0; font-size: 22px; color: #0369a1;">🌊 강북정수장 현장 CCTV 실시간 관제 보고서</h1>
                    <div style="font-size: 11px; color: #64748b; margin-top: 4px;">출력일시: ${new Date().toLocaleString()} | 총 이슈 ${fieldIssues.length}건</div>
                </div>

                <h3 style="font-size: 14px; color: #0f172a; border-left: 4px solid #0284c7; padding-left: 8px;">1. 현장 관제 이슈 요약 목록</h3>
                <table style="width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 20px;">
                    <thead>
                        <tr style="background: #0284c7; color: white;">
                            <th style="padding: 8px; text-align: center;">NO</th>
                            <th style="padding: 8px; text-align: left;">제목</th>
                            <th style="padding: 8px; text-align: left;">관제 위치</th>
                            <th style="padding: 8px; text-align: left;">설명</th>
                            <th style="padding: 8px; text-align: center;">작성자</th>
                            <th style="padding: 8px; text-align: center;">작성일시</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${summaryRowsHtml}
                    </tbody>
                </table>

                ${detailPagesHtml}
            </div>
            <script>
                window.onload = function() {
                    window.print();
                };
            </script>
        </body>
        </html>
    `;

    const printWin = window.open('', '_blank', 'width=900,height=1000');
    if (printWin) {
        printWin.document.write(fullReportHtml);
        printWin.document.close();
    } else {
        alert('팝업 차단이 활성화되어 있어 보고서 창을 열지 못했습니다. 팝업을 허용해주세요.');
    }
}

if (typeof window !== 'undefined') {
    window.playOfficialHlsStream = playOfficialHlsStream;
    window.exportCctvFieldIssuesPdf = exportCctvFieldIssuesPdf;
    window.refreshCctvIssuesTable = refreshCctvIssuesTable;
}

if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initCctvTab();
} else {
    document.addEventListener('DOMContentLoaded', initCctvTab);
}
