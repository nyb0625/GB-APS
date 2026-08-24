/**
 * public/js/explorer.js
 * FolderExplorer component for Autodesk Docs tree browsing.
 */

function getProjectVersionNumber(version) {
    const direct = version?.versionNumber ?? version?.vNumber ?? version?.attributes?.versionNumber;
    if (direct !== null && typeof direct !== 'undefined' && direct !== '') {
        const parsed = Number(direct);
        if (Number.isFinite(parsed)) return parsed;
    }
    const text = String(version?.id || version?.urn || '');
    const match = text.match(/[?&]version=(\d+)/i)
        || text.match(/:v(\d+)$/i)
        || text.match(/\.vf\..+v(\d+)$/i);
    return match ? Number(match[1]) : null;
}

function getProjectVersionValue(version) {
    const value = version?.formaVersionLabel
        ?? version?.revisionDisplayLabel
        ?? version?.extensionData?.revisionDisplayLabel
        ?? version?.attributes?.extension?.data?.revisionDisplayLabel;
    if (value !== null && typeof value !== 'undefined' && String(value).trim() !== '') {
        return String(value).trim();
    }
    const versionNumber = getProjectVersionNumber(version);
    return versionNumber !== null ? String(versionNumber) : '';
}

function getProjectVersionLabel(version) {
    const value = getProjectVersionValue(version);
    if (!value) return 'v-';
    return /^v/i.test(value) ? value : `v${value}`;
}

function escapeSelectorValue(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') {
        return window.CSS.escape(String(value || ''));
    }
    return String(value || '').replace(/["\\]/g, '\\$&');
}

class FolderExplorer {
    constructor() {
        this.container = document.getElementById('explorer-container');
        this.breadcrumb = document.getElementById('explorer-breadcrumb');
        this.list = document.getElementById('explorer-list');
        this.viewerContainer = document.getElementById('preview');
        this.refreshBtn = document.getElementById('refresh-explorer-btn');
        this.backBtn = document.getElementById('back-to-explorer-btn');

        this.currentHubId = null;
        this.currentProjectId = null;
        this.currentFolderId = null;
        this.history = []; // Breadcrumb stack
        this.currentVersions = [];
        this.versionBadgeBatch = 0;

        // Properties for sequential version comparison
        this.compareSelectMode = false;
        this.selectedCompareVersions = [];

        this.init();
    }

    init() {
        if (this.refreshBtn) {
            this.refreshBtn.onclick = () => this.refresh();
        }
        if (this.backBtn) {
            this.backBtn.onclick = () => this.handleBackToExplorer();
        }

        // Setup version modal closing handlers
        const modal = document.getElementById('version-modal');
        const closeBtn = document.getElementById('close-version-modal');
        const closeBtn2 = document.getElementById('close-version-btn');
        
        const closeModal = () => {
            if (modal) modal.style.display = 'none';
            this.resetCompareSelectMode();
        };

        if (modal && closeBtn) closeBtn.onclick = closeModal;
        if (modal && closeBtn2) closeBtn2.onclick = closeModal;

        // Version Compare main action button handler
        const compareMainBtn = document.getElementById('btn-start-select-compare');
        if (compareMainBtn) {
            compareMainBtn.onclick = () => this.toggleCompareSelectMode();
        }

        // Always show root projects on init, removing stored session auto-drilldown
        this.showRootProjects();
    }

    async showRootProjects() {
        this.currentHubId = null;
        this.currentProjectId = null;
        this.currentFolderId = null;
        this.history = [{ id: 'projects-root', name: 'Root', type: 'projects-root' }];
        this.updateBreadcrumbs();
        this.switchMode('explorer');
        this.renderLoading();

        try {
            const hubsResponse = await fetch('/api/hubs');
            if (!hubsResponse.ok) {
                this.renderError(`서버 오류 (${hubsResponse.status})`);
                return;
            }
            const hubs = await hubsResponse.json();
            if (!Array.isArray(hubs) || hubs.length === 0) {
                this.renderError('허브 정보를 찾을 수 없습니다.');
                return;
            }

            // Fetch projects for all hubs in parallel
            const projectPromises = hubs.map(async (hub) => {
                try {
                    const projectsResponse = await fetch(`/api/hubs/${hub.id}/projects`);
                    if (projectsResponse.ok) {
                        const projects = await projectsResponse.json();
                        return projects.map(p => ({ ...p, hubName: hub.name, hubId: hub.id }));
                    }
                } catch (e) {
                    console.warn(`Failed to fetch projects for hub ${hub.id}:`, e);
                }
                return [];
            });

            const results = await Promise.all(projectPromises);
            const allProjects = results.flat();
            allProjects.sort((a, b) => new Date(b.created || 0) - new Date(a.created || 0));

            this.renderProjects(allProjects);
        } catch (err) {
            console.error('[Explorer] Failed to load projects:', err);
            this.renderError('프로젝트 목록을 가져오지 못했습니다.');
        }
    }

    renderProjects(projects) {
        if (!projects || projects.length === 0) {
            this.list.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:40px; color:var(--text-muted);">프로젝트가 존재하지 않습니다.</td></tr>';
            return;
        }

        this.list.innerHTML = '';
        projects.forEach(project => {
            const tr = document.createElement('tr');
            tr.style.cursor = 'pointer';
            const createdDate = project.created ? new Date(project.created).toLocaleDateString() : '-';

            // Represent projects as Folders to fulfill Scenario A (Hub -> Folder flow)
            tr.innerHTML = `
                <td>
                    <span class="explorer-icon icon-folder" style="color: var(--accent-color, #0078d4);">
                        <i class="fas fa-folder"></i>
                    </span>
                    <span style="font-weight:600;">${project.name}</span>
                </td>
                <td>-</td>
                <td><span class="text-date">${createdDate}</span></td>
                <td>-</td>
                <td style="text-align: right;"></td>
            `;

            tr.onclick = () => {
                const finalHubId = project.hubId || this.currentHubId;
                this.showFolder(finalHubId, project.id, null, project.name);
            };
            this.list.appendChild(tr);
        });
    }

    async showFolder(hubId, projectId, folderId, folderName = 'Root') {
        this.currentHubId = hubId;
        this.currentProjectId = projectId;
        this.currentFolderId = folderId;

        // Rebuild history list for breadcrumbs
        const hasRoot = this.history.some(h => h.type === 'projects-root');
        if (!hasRoot) {
            this.history = [{ id: 'projects-root', name: 'Root', type: 'projects-root' }];
        }

        if (!folderId) {
            this.history = this.history.slice(0, 1);
            this.history.push({ id: projectId, name: folderName, type: 'project', hubId, projectId });
        } else {
            const lastIdx = this.history.findIndex(h => h.id === folderId);
            if (lastIdx !== -1) {
                this.history = this.history.slice(0, lastIdx + 1);
            } else {
                this.history.push({ id: folderId, name: folderName, type: 'folder', hubId, projectId });
            }
        }

        this.updateBreadcrumbs();
        this.switchMode('explorer');
        this.renderLoading();

        try {
            let apiUrl = `/api/hubs/${hubId}/projects/${projectId}/contents`;
            if (folderId) {
                apiUrl += `?folder_id=${encodeURIComponent(folderId)}`;
            }
            const response = await fetch(apiUrl);

            if (!response.ok) {
                this.renderError(`서버 오류 (${response.status}) - 권한이 없거나 상위 폴더로 이동해 주세요.`);
                return;
            }

            const items = await response.json();
            if (!Array.isArray(items)) {
                this.renderError('데이터 형식 오류');
                return;
            }

            // Auto-skip "Project Files" folder if we are at the root level (folderId is null)
            if (!folderId) {
                const projectFilesFolder = items.find(
                    item => item.folder && item.name.toLowerCase().replace(/\s+/g, '') === 'projectfiles'
                );
                if (projectFilesFolder) {
                    // Update breadcrumb history item to point to Project Files folder ID
                    // This ensures breadcrumb clicks route back directly inside Project Files.
                    const projIdx = this.history.findIndex(h => h.type === 'project');
                    if (projIdx !== -1) {
                        this.history[projIdx].id = projectFilesFolder.id;
                        this.history[projIdx].type = 'folder';
                    }
                    
                    // Directly query and show Project Files folder contents
                    this.showFolder(hubId, projectId, projectFilesFolder.id, folderName);
                    return;
                }
            }

            this.renderTable(items);
        } catch (err) {
            console.error('[Explorer] Failed to load folder:', err);
            this.renderError('폴더 정보를 가져오지 못했습니다.');
        }
    }

    renderTable(items) {
        if (!items || items.length === 0) {
            this.list.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:40px; color:var(--text-muted);">이 폴더는 비어 있습니다.</td></tr>';
            return;
        }

        this.list.innerHTML = '';
        items.forEach(item => {
            if (item.urn && item.name && typeof window.updateUrnCache === 'function') {
                window.updateUrnCache(item.name, item.urn);
            }
            const tr = document.createElement('tr');
            const iconClass = item.folder ? 'icon-folder' : 'icon-file';
            const iconHtml = item.folder ? '<i class="fas fa-folder"></i>' : '<i class="fas fa-file-alt"></i>';
            const dateStr = item.lastModifiedTime ? new Date(item.lastModifiedTime).toLocaleDateString() : '-';

            tr.innerHTML = `
                <td>
                    <span class="explorer-icon ${iconClass}">
                        ${iconHtml}
                    </span>
                    <span class="item-name">${item.name}</span>
                </td>
                <td>
                    ${item.folder ? '-' : `<span class="badge-version" data-item-id="${item.id}" data-item-name="${item.name}" data-item-urn="${item.urn || ''}" title="버전 이력 보기">${getProjectVersionLabel(item)}</span>`}
                </td>
                <td><span class="text-date">${dateStr}</span></td>
                <td><span class="text-user">${item.lastModifiedUserName || 'Unknown'}</span></td>
                <td style="text-align: right;">
                    ${item.folder ? '' : '<button class="tool-btn">로드</button>'}
                </td>
            `;

            if (item.folder) {
                tr.onclick = () => this.showFolder(this.currentHubId, this.currentProjectId, item.id, item.name);
            } else {
                tr.onclick = (e) => {
                    if (e.target.classList.contains('badge-version')) return; // Ignore version badge clicks
                    
                    window.currentHubId = this.currentHubId;
                    window.currentProjectId = this.currentProjectId;
                    window.currentItemId = item.id;
                    window.currentVersionId = item.id;

                    this.loadIntoViewer(item.urn, item.name);
                };

                const badge = tr.querySelector('.badge-version');
                if (badge) {
                    badge.onclick = (e) => {
                        e.stopPropagation();
                        this.handleVersionClick(item.id, item.name);
                    };
                }
            }

            this.list.appendChild(tr);
        });
        this.hydrateCurrentVersionBadges(items);
    }

    findCurrentVersionForItem(item, versions) {
        const list = Array.isArray(versions) ? versions : [];
        if (!list.length) return null;
        const byUrn = item?.urn
            ? list.find(version => version.urn === item.urn)
            : null;
        if (byUrn) return byUrn;
        const byId = item?.versionId
            ? list.find(version => version.id === item.versionId)
            : null;
        if (byId) return byId;
        return list
            .slice()
            .sort((a, b) => (getProjectVersionNumber(b) || 0) - (getProjectVersionNumber(a) || 0))[0];
    }

    async hydrateCurrentVersionBadges(items) {
        const batch = ++this.versionBadgeBatch;
        const files = (items || []).filter(item => !item.folder && item.id);
        if (!files.length || !this.currentHubId || !this.currentProjectId) return;

        await Promise.all(files.map(async item => {
            try {
                const url = `/api/hubs/${this.currentHubId}/projects/${this.currentProjectId}/contents/${encodeURIComponent(item.id)}/versions`;
                const response = await fetch(url);
                if (!response.ok || batch !== this.versionBadgeBatch) return;
                const versions = await response.json();
                const currentVersion = this.findCurrentVersionForItem(item, versions);
                if (!currentVersion) return;
                const label = getProjectVersionLabel(currentVersion);
                const badge = this.list.querySelector(`.badge-version[data-item-id="${escapeSelectorValue(item.id)}"]`);
                if (badge && batch === this.versionBadgeBatch) {
                    badge.textContent = label;
                    badge.title = `버전 이력 보기 · 현재 ${label}`;
                }
            } catch (err) {
                console.warn('[Explorer] Failed to hydrate Forma version label:', item.name, err);
            }
        }));
    }

    async handleVersionClick(itemId, itemName) {
        const modal = document.getElementById('version-modal');
        const filenameLabel = document.getElementById('version-modal-filename');
        const listBody = document.getElementById('version-list-body');

        if (!modal || !listBody) return;

        filenameLabel.textContent = itemName;
        listBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px;">버전 정보를 불러오는 중...</td></tr>';
        modal.style.display = 'flex';

        try {
            const url = `/api/hubs/${this.currentHubId}/projects/${this.currentProjectId}/contents/${encodeURIComponent(itemId)}/versions`;
            const response = await fetch(url);
            if (!response.ok) throw new Error('Failed to fetch versions');
            const versions = await response.json();

            this.currentVersions = versions;
            this.renderVersionTable(listBody, versions, itemName, itemId);
        } catch (err) {
            console.error('[Explorer] Version fetch error:', err);
            listBody.innerHTML = '<tr><td colspan="4" style="text-align:center; padding:20px; color:#ef4444;">버전을 불러올 수 없습니다.</td></tr>';
        }
    }

    renderVersionTable(container, versions, itemName, itemId) {
        container.innerHTML = '';
        const saveIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>`;

        versions.forEach(v => {
            const tr = document.createElement('tr');
            const dateStr = v.name ? new Date(v.name).toLocaleString() : '-';
            const versionLabel = getProjectVersionLabel(v);
            const sortVersionNumber = getProjectVersionNumber(v) || 0;

            const isCurrent = (v.urn === window.currentUrn);
            const currentBadge = isCurrent 
                ? `<span style="font-size: 0.8rem; color: var(--text-muted); margin-left: 8px; font-weight: 500;">현재 버전</span>`
                : ``;

            tr.innerHTML = `
                <td><span class="badge-version" title="버전 ID: ${v.id}">${versionLabel}</span></td>
                <td class="text-cell" title="${dateStr}">${dateStr}</td>
                <td class="text-cell" title="${v.createUserName || 'Unknown'}">${v.createUserName || 'Unknown'}</td>
                <td>
                    <div class="memo-container" style="display: flex; gap: 0.35rem; align-items: center; width: 100%;">
                        <input type="text" class="memo-input" placeholder="메모 추가..." value="${v.memo || ''}" data-urn="${v.urn}" style="flex: 1; min-width: 0; width: 100%; box-sizing: border-box; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.1); border-radius: 4px; color: #fff; padding: 0.25rem 0.5rem; font-size: 0.8rem; outline: none; transition: border-color 0.2s;">
                        <button class="btn-save-memo" title="메모 저장" style="background: transparent; border: none; cursor: pointer; padding: 0.25rem; flex-shrink: 0;">${saveIconSvg}</button>
                    </div>
                </td>
                <td style="text-align: right; white-space: nowrap;">
                    <button class="btn-view-v" title="이 버전 열기">보기</button>
                    ${currentBadge}
                </td>
            `;

            tr.setAttribute('data-urn', v.urn);
            tr.setAttribute('data-version-number', sortVersionNumber);

            tr.onclick = (e) => {
                // Ignore click if clicking internal interactive components like input/buttons
                if (e.target.closest('.memo-container') || e.target.closest('.btn-view-v')) {
                    return;
                }
                
                if (this.compareSelectMode) {
                    const versionObj = {
                        versionUrn: v.id,        // Diff API용 (raw URN)
                        viewerUrn: v.urn,        // Viewer loadModel용 (base64 URN)
                        name: itemName,
                        versionNumber: getProjectVersionValue(v) || sortVersionNumber,
                        sortVersionNumber
                    };
                    this.handleVersionRowClickForCompare(tr, versionObj);
                }
            };

            const viewBtn = tr.querySelector('.btn-view-v');
            viewBtn.onclick = () => {
                document.getElementById('version-modal').style.display = 'none';
                
                window.currentHubId = this.currentHubId;
                window.currentProjectId = this.currentProjectId;
                window.currentItemId = itemId;
                window.currentVersionId = v.id;

                this.loadIntoViewer(v.urn, `${itemName} (${versionLabel})`);
            };

            const memoInput = tr.querySelector('.memo-input');
            const saveBtn = tr.querySelector('.btn-save-memo');

            // 테두리 포커스 핸들러
            memoInput.onfocus = () => {
                memoInput.style.borderColor = 'var(--accent-color)';
            };
            memoInput.onblur = () => {
                memoInput.style.borderColor = 'rgba(255,255,255,0.1)';
            };

            // 저장 버튼 클릭 이벤트
            saveBtn.onclick = async () => {
                const memoValue = memoInput.value.trim();
                saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                saveBtn.disabled = true;

                try {
                    const response = await fetch(`/api/versions/${encodeURIComponent(v.urn)}/memo`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ memo: memoValue })
                    });

                    if (!response.ok) throw new Error('Failed to save memo');
                    
                    // 저장 성공 피드백
                    saveBtn.innerHTML = '<i class="fas fa-check" style="color: #10b981;"></i>';
                    setTimeout(() => {
                        saveBtn.innerHTML = saveIconSvg;
                        saveBtn.disabled = false;
                    }, 1500);

                    // 로컬 데이터 동기화
                    v.memo = memoValue;

                } catch (err) {
                    console.error('[Explorer] Memo save error:', err);
                    saveBtn.innerHTML = '<i class="fas fa-exclamation-triangle" style="color: #ef4444;"></i>';
                    setTimeout(() => {
                        saveBtn.innerHTML = saveIconSvg;
                        saveBtn.disabled = false;
                    }, 2000);
                }
            };

            container.appendChild(tr);
        });

        // 컬럼 크기 조절 초기화
        const table = container.closest('table');
        if (table) {
            this.initResizableColumns(table);
        }
    }

    /**
     * Initialize resizable columns for a table
     */
    initResizableColumns(table) {
        const cols = table.querySelectorAll('th');
        cols.forEach((col, idx) => {
            // 마지막 열(작업 열)은 크기 조절에서 제외
            if (idx === cols.length - 1) return;

            // 중복 생성 방지
            if (col.querySelector('.resizer')) return;

            const resizer = document.createElement('div');
            resizer.classList.add('resizer');
            col.appendChild(resizer);

            let startX = 0;
            let startWidth = 0;

            const onMouseMove = (e) => {
                const deltaX = e.pageX - startX;
                const width = startWidth + deltaX;
                const minWidth = parseInt(col.style.minWidth || '80', 10);
                if (width >= minWidth) {
                    col.style.width = `${width}px`;
                }
            };

            const onMouseUp = () => {
                resizer.classList.remove('resizing');
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            };

            resizer.addEventListener('mousedown', (e) => {
                e.preventDefault();
                startX = e.pageX;
                startWidth = col.getBoundingClientRect().width;
                resizer.classList.add('resizing');

                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });
        });
    }

    updateBreadcrumbs() {
        if (!this.breadcrumb) return;
        this.breadcrumb.innerHTML = '';
        this.history.forEach((h, i) => {
            const item = document.createElement('span');
            item.className = `breadcrumb-item ${i === this.history.length - 1 ? 'active' : ''}`;
            item.textContent = h.name;
            item.onclick = () => {
                if (i === this.history.length - 1) return;

                if (h.type === 'projects-root') {
                    this.showRootProjects();
                } else if (h.type === 'project') {
                    this.showFolder(h.hubId, h.projectId, null, h.name);
                } else if (h.type === 'folder') {
                    this.showFolder(h.hubId, h.projectId, h.id, h.name);
                }
            };

            this.breadcrumb.appendChild(item);

            if (i < this.history.length - 1) {
                const sep = document.createElement('span');
                sep.className = 'breadcrumb-separator';
                sep.textContent = ' / ';
                this.breadcrumb.appendChild(sep);
            }
        });
    }

    switchMode(mode) {
        if (mode === 'explorer') {
            this.container.style.display = 'flex';
            this.viewerContainer.style.display = 'none';
            if (this.backBtn) this.backBtn.style.display = 'none';
            this.hideViewerFloatingControls();
        } else if (mode === 'viewer') {
            this.container.style.display = 'none';
            this.viewerContainer.style.display = 'block';
            if (this.backBtn) this.backBtn.style.display = 'block';
        }
    }

    hideViewerFloatingControls() {
        const mainControls = document.getElementById('main-viewer-controls');
        if (mainControls) mainControls.style.display = 'none';
        if (typeof window.closeModelVisibilityPopup === 'function') {
            window.closeModelVisibilityPopup();
        }
        window._modelVisibilityTargetViewer = null;
    }

    handleBackToExplorer() {
        this.switchMode('explorer');
    }

    renderLoading() {
        this.list.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:40px; color:var(--text-muted);"><i class="fas fa-spinner fa-spin"></i> 데이터를 불러오는 중...</td></tr>';
    }

    renderError(msg) {
        this.list.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:40px; color:#ef4444;">${msg}</td></tr>`;
    }

    async loadIntoViewer(urn, name) {
        this.switchMode('viewer');
        const overlay = document.getElementById('overlay');
        if (overlay) {
            overlay.style.display = 'flex';
            overlay.innerHTML = '<div class="notification"><i class="fas fa-spinner fa-spin"></i> Autodesk Docs 모델 로딩 중...</div>';
        }

        try {
            // Import and call view load function dynamically from viewer.js
            const { initViewer, loadModel } = await import('./viewer.js?v=20260813-runtime-merge-rotation1');
            if (!window.projectViewer || window.projectViewer === window.cctvViewer) {
                window.projectViewer = await initViewer(document.getElementById('preview'), false);
            }
            if (!window.viewer || window.viewer === window.cctvViewer) {
                window.viewer = window.projectViewer;
                window.myGlobalViewer = window.projectViewer;
            }
            if (window.projectViewer) {
                // Clean up current model if exists
                if (window.projectViewer.model) {
                    window.projectViewer.unloadModel(window.projectViewer.model);
                }
                
                await loadModel(window.projectViewer, urn);
                window.viewer = window.projectViewer;
                window.myGlobalViewer = window.projectViewer;
                console.log(`[Explorer] Model loaded: ${name}`);
                window.currentUrn = urn;
                window.currentUrnName = name;
                localStorage.setItem('aps_last_urn', urn);
                localStorage.setItem('aps_last_urn_name', name);
            }
        } catch (err) {
            console.error('[Explorer] Failed to load model:', err);
            alert('모델을 로드하는 중 오류가 발생했습니다.');
        } finally {
            if (overlay) overlay.style.display = 'none';
        }
    }

    refresh() {
        const lastName = this.history[this.history.length - 1]?.name || 'Root';
        if (this.currentFolderId) {
            this.showFolder(this.currentHubId, this.currentProjectId, this.currentFolderId, lastName);
        } else if (this.currentProjectId) {
            this.showFolder(this.currentHubId, this.currentProjectId, null, lastName);
        } else {
            this.showRootProjects();
        }
    }

    toggleCompareSelectMode() {
        this.compareSelectMode = !this.compareSelectMode;
        const compareBtn = document.getElementById('btn-start-select-compare');
        const table = document.querySelector('.version-history-table');

        if (this.compareSelectMode) {
            this.selectedCompareVersions = [];
            if (compareBtn) {
                compareBtn.innerHTML = '<i class="fas fa-check-double"></i> 비교 버전 선택 (0/2)';
                compareBtn.style.background = '#0696D7';
                compareBtn.style.color = '#fff';
            }
            if (table) table.classList.add('compare-selecting');
        } else {
            this.resetCompareSelectMode();
        }
    }

    resetCompareSelectMode() {
        this.compareSelectMode = false;
        this.selectedCompareVersions = [];
        const compareBtn = document.getElementById('btn-start-select-compare');
        const table = document.querySelector('.version-history-table');

        if (compareBtn) {
            compareBtn.innerHTML = '<i class="fas fa-columns"></i> 버전 비교';
            compareBtn.style.background = 'var(--accent-color)';
            compareBtn.style.color = '#0b0f19';
        }
        if (table) {
            table.classList.remove('compare-selecting');
            table.querySelectorAll('tbody tr').forEach(tr => {
                tr.classList.remove('selected-compare-row');
            });
        }
    }

    async handleVersionRowClickForCompare(rowElement, vObj) {
        const existingIndex = this.selectedCompareVersions.findIndex(x => x.versionUrn === vObj.versionUrn);
        
        if (existingIndex !== -1) {
            this.selectedCompareVersions.splice(existingIndex, 1);
            rowElement.classList.remove('selected-compare-row');
        } else {
            if (this.selectedCompareVersions.length >= 2) {
                return;
            }
            this.selectedCompareVersions.push(vObj);
            rowElement.classList.add('selected-compare-row');
        }

        const compareBtn = document.getElementById('btn-start-select-compare');
        if (compareBtn) {
            compareBtn.innerHTML = `<i class="fas fa-check-double"></i> 비교 버전 선택 (${this.selectedCompareVersions.length}/2)`;
        }

        if (this.selectedCompareVersions.length === 2) {
            // Sort selected versions by versionNumber asc (Older version as verA, newer version as verB)
            this.selectedCompareVersions.sort((x, y) => Number(x.sortVersionNumber ?? x.versionNumber) - Number(y.sortVersionNumber ?? y.versionNumber));
            
            const verA = this.selectedCompareVersions[0];
            const verB = this.selectedCompareVersions[1];
            
            this.resetCompareSelectMode();
            const modal = document.getElementById('version-modal');
            if (modal) modal.style.display = 'none';

            await import('./comparison.js?v=render-source-check-20260619');
            const compareService = window.modelComparison || window.comparisonManager || window.comparison;
            if (compareService) {
                await compareService.startComparison(verA, verB);
            } else {
                console.error('[Explorer] ModelComparison instance is not initialized on window object yet.');
            }
        }
    }
}

export const explorer = new FolderExplorer();
window.explorer = explorer;
