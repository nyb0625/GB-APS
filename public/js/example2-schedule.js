const STATUS_STYLES = {
    done: { label: '완료', color: '#10b981', bg: 'rgba(16, 185, 129, 0.16)' },
    delayed: { label: '지연', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.16)' },
    active: { label: '진행중', color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.16)' },
    planned: { label: '계획', color: '#a78bfa', bg: 'rgba(167, 139, 250, 0.16)' }
};

let scheduleState = {
    loaded: false,
    loading: false,
    refreshing: false,
    error: '',
    tasks: [],
    status: 'all',
    query: '',
    month: '',
    columnFilters: {
        categoryLabel: '',
        location: '',
        assignee: '',
        statusLabel: ''
    },
    cacheTs: 0
};

let modelUpdateState = {
    loaded: false,
    loading: false,
    error: '',
    tree: null,
    models: [],
    selectedUrn: '',
    selectedModel: null,
    versions: [],
    diffLoading: false,
    diffError: '',
    diff: null,
    hubId: '',
    projectId: '',
    projectName: ''
};

let searchState = {
    query: '',
    filter: 'all',
    isComposing: false
};

let projectSearchState = {
    loaded: false,
    loading: false,
    error: '',
    files: [],
    source: ''
};

let cctvSearchState = {
    loaded: false,
    loading: false,
    error: '',
    channels: []
};

const GUNHWA_SCHEDULE_CACHE_KEY = 'gangbuk_work_schedule_stale_cache_v11_without_gunhwa';
const SCHEDULE_BACKGROUND_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const MODEL_UPDATE_CACHE_KEY = 'example2_bim_model_update_cache_v2_revision_label';

const KOREAN_HOLIDAYS_BY_YEAR = {
    2026: {
        '2026-01-01': '신정',
        '2026-02-16': '설날 연휴',
        '2026-02-17': '설날',
        '2026-02-18': '설날 연휴',
        '2026-03-01': '삼일절',
        '2026-03-02': '삼일절 대체공휴일',
        '2026-05-01': '노동절',
        '2026-05-05': '어린이날',
        '2026-05-24': '부처님 오신 날',
        '2026-05-25': '부처님 오신 날 대체공휴일',
        '2026-06-03': '전국동시지방선거',
        '2026-06-06': '현충일',
        '2026-07-17': '제헌절',
        '2026-08-15': '광복절',
        '2026-08-17': '광복절 대체공휴일',
        '2026-09-24': '추석 연휴',
        '2026-09-25': '추석',
        '2026-09-26': '추석 연휴',
        '2026-10-03': '개천절',
        '2026-10-05': '개천절 대체공휴일',
        '2026-10-09': '한글날',
        '2026-12-25': '성탄절'
    }
};

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function textValue(value) {
    if (value == null) return '';
    if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join(' > ');
    if (typeof value === 'object') {
        return value.path || value.typePath || value.issueTypePath || value.categoryPath ||
            value.parentName || value.categoryName || value.issueTypeName || value.typeName ||
            value.fullName || value.displayName || value.title || value.name || value.text || value.value || '';
    }
    return String(value).trim();
}

function readDeep(source, paths) {
    if (!source || typeof source !== 'object') return '';
    for (const path of paths) {
        let cur = source;
        for (const part of String(path).split('.')) {
            if (!cur || typeof cur !== 'object') {
                cur = null;
                break;
            }
            cur = cur[part];
        }
        const text = textValue(cur);
        if (text) return text;
    }
    return '';
}

function getIssueTypeText(issue) {
    const raw = issue.rawFormaIssue || issue.rawDetailIssue || issue;
    return textValue(issue.typePath || issue.type || issue.category || readDeep(raw, [
        'typePath',
        'issueTypePath',
        'categoryPath',
        'attributes.typePath',
        'attributes.issueTypePath',
        'attributes.categoryPath',
        'attributes.issueType',
        'attributes.type'
    ]));
}

function getIssueCategoryLabel(issue) {
    const rawText = textValue(issue.workScheduleCategory || getIssueTypeText(issue) || issue.type || issue.category || '');
    const segments = rawText
        .split(/\s*[>\/·]\s*/)
        .map(part => part.trim())
        .filter(Boolean);
    if (issue.workScheduleCategory && issue.workScheduleCategory !== '건화') return issue.workScheduleCategory;
    if (segments[0] === '이슈' && segments[1]) return segments[1];
    return segments[0] || '이슈';
}

function getCategoryStyle(label) {
    const text = String(label || '').toLowerCase();
    if (text.includes('업데이트') || text.includes('update')) {
        return { bg: '#f59e0b', color: '#111827' };
    }
    if (text.includes('설계')) {
        return { bg: '#2563eb', color: '#ffffff' };
    }
    if (text.includes('간섭') || text.includes('clash')) {
        return { bg: '#ef4444', color: '#ffffff' };
    }
    if (text.includes('cctv') || text.includes('관제')) {
        return { bg: '#0891b2', color: '#ffffff' };
    }
    if (text.includes('품질') || text.includes('검측')) {
        return { bg: '#16a34a', color: '#ffffff' };
    }
    if (text.includes('공정') || text.includes('일정')) {
        return { bg: '#7c3aed', color: '#ffffff' };
    }
    return { bg: '#475569', color: '#ffffff' };
}

function parseDate(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    date.setHours(0, 0, 0, 0);
    return date;
}

function formatDate(value) {
    const date = parseDate(value);
    if (!date) return '-';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString('ko-KR', {
        year: '2-digit',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function extractApsVersionNumber(value) {
    const text = String(value || '');
    const match = text.match(/[?&]version=(\d+)/i)
        || text.match(/:v(\d+)$/i)
        || text.match(/\.vf\..+v(\d+)$/i);
    return match ? Number(match[1]) : null;
}

function decodeApsUrn(value) {
    const text = String(value || '');
    if (!text || text.includes(':') || text.includes('?')) return text;
    try {
        const padded = text + '='.repeat((4 - (text.length % 4)) % 4);
        return atob(padded);
    } catch (err) {
        return text;
    }
}

function getVersionNumber(version) {
    const direct = version?.versionNumber ?? version?.vNumber ?? version?.attributes?.versionNumber;
    if (direct !== null && typeof direct !== 'undefined' && direct !== '') {
        const parsed = Number(direct);
        if (Number.isFinite(parsed)) return parsed;
    }
    return extractApsVersionNumber(version?.id)
        ?? extractApsVersionNumber(version?.urn)
        ?? extractApsVersionNumber(decodeApsUrn(version?.urn))
        ?? null;
}

function getFormaVersionValue(version) {
    const direct = version?.formaVersionLabel
        ?? version?.revisionDisplayLabel
        ?? version?.extensionData?.revisionDisplayLabel
        ?? version?.attributes?.extension?.data?.revisionDisplayLabel;
    if (direct !== null && typeof direct !== 'undefined' && String(direct).trim() !== '') {
        return String(direct).trim();
    }
    const versionNumber = getVersionNumber(version);
    return versionNumber !== null ? String(versionNumber) : '';
}

function compareVersionsDesc(a, b) {
    const av = getVersionNumber(a);
    const bv = getVersionNumber(b);
    if (av !== null && bv !== null && av !== bv) return bv - av;
    if (av !== null && bv === null) return -1;
    if (av === null && bv !== null) return 1;
    const at = new Date(a?.createTime || a?.name || a?.displayName || 0).getTime() || 0;
    const bt = new Date(b?.createTime || b?.name || b?.displayName || 0).getTime() || 0;
    return bt - at;
}

function getVersionLabel(version) {
    const displayValue = getFormaVersionValue(version);
    if (!displayValue) return 'v-';
    return /^v/i.test(displayValue) ? displayValue : `v${displayValue}`;
}

function monthKeyFromDate(value) {
    const date = parseDate(value);
    if (!date) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function dateKeyFromParts(year, month, day) {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getKoreanHolidayName(year, month, day) {
    const key = dateKeyFromParts(year, month, day);
    const fixedHolidayMap = {
        '01-01': '신정',
        '03-01': '삼일절',
        '05-01': '노동절',
        '05-05': '어린이날',
        '06-06': '현충일',
        '08-15': '광복절',
        '10-03': '개천절',
        '10-09': '한글날',
        '12-25': '성탄절'
    };
    return KOREAN_HOLIDAYS_BY_YEAR[year]?.[key] || fixedHolidayMap[`${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`] || '';
}

function formatMonthLabel(monthKey) {
    const [year, month] = String(monthKey || '').split('-');
    return year && month ? `${year}년 ${Number(month)}월` : '전체 월';
}

function daysBetween(start, end) {
    const s = parseDate(start);
    const e = parseDate(end);
    if (!s || !e) return 0;
    return Math.max(1, Math.round((e - s) / 86400000) + 1);
}

function classifyStatus(issue, startDate, dueDate) {
    const statusText = textValue(issue.status || issue.state || issue.statusName || '').toLowerCase();
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const start = parseDate(startDate);
    const due = parseDate(dueDate);
    const hasExplicitStatus = Boolean(statusText);

    if (statusText.includes('완료') || statusText.includes('종료') || statusText.includes('closed') || statusText.includes('done') || statusText.includes('complete')) {
        return 'done';
    }
    if (statusText.includes('검토') || statusText.includes('review')) {
        return 'active';
    }
    if (statusText.includes('지연') || statusText.includes('delay') || statusText.includes('overdue') || (!hasExplicitStatus && due && due < now)) {
        return 'delayed';
    }
    if (statusText.includes('진행') || statusText.includes('검토') || statusText.includes('review') || statusText.includes('open') || (start && start <= now && (!due || due >= now))) {
        return 'active';
    }
    return 'planned';
}

function getDisplayStatusLabel(issue, statusKey) {
    const statusText = textValue(issue.status || issue.state || issue.statusName || '');
    const lowered = statusText.toLowerCase();
    if (statusText.includes('검토') || lowered.includes('review')) return '검토';
    if (statusText.includes('진행') || lowered.includes('open')) return '진행중';
    return STATUS_STYLES[statusKey]?.label || statusText || '계획';
}

function normalizeScheduleTask(issue) {
    const raw = issue.rawFormaIssue || issue.rawDetailIssue || issue;
    const startDate = issue.startDate || issue.start_date || issue.createdAt || readDeep(raw, [
        'attributes.startDate',
        'attributes.createdAt',
        'createdAt',
        'createdDate'
    ]);
    const dueDate = issue.dueDate || issue.endDate || issue.due_date || readDeep(raw, [
        'attributes.dueDate',
        'attributes.endDate',
        'dueDate',
        'endDate',
        'updatedAt'
    ]) || startDate;
    const statusKey = classifyStatus(issue, startDate, dueDate);
    const typePath = issue.workScheduleCategory
        ? `${issue.workScheduleCategory} · ${getIssueTypeText(issue) || ''}`.trim()
        : getIssueTypeText(issue);
    const location = issue.location || issue.locationName || issue.locationDetails || issue.locationDetail ||
        issue.locationDescription || issue.structure || readDeep(raw, [
            'attributes.location',
            'attributes.locationName',
            'attributes.location.name',
            'attributes.location.displayName',
            'attributes.locationDetails',
            'attributes.locationDetail',
            'attributes.locationDescription',
            'attributes.locationText',
            'attributes.lbsLocation',
            'attributes.lbsLocation.name',
            'attributes.lbsLocation.displayName',
            'location',
            'locationName',
            'location.name',
            'location.displayName',
            'locationDetails',
            'locationDetail',
            'locationDescription',
            'locationText',
            'lbsLocation',
            'lbsLocation.name',
            'lbsLocation.displayName'
        ]);

    return {
        id: issue.id || issue.displayId || issue.dbId || '',
        title: issue.title || issue.name || readDeep(raw, ['attributes.title', 'title', 'name']) || '작업명 없음',
        categoryLabel: getIssueCategoryLabel(issue),
        statusKey,
        statusLabel: getDisplayStatusLabel(issue, statusKey),
        rawStatus: issue.status || issue.state || '-',
        startDate: formatDate(startDate),
        dueDate: formatDate(dueDate),
        durationDays: daysBetween(startDate, dueDate),
        assignee: issue.assignee || issue.assignedTo || readDeep(raw, ['attributes.assignee', 'attributes.assignedTo', 'assignee', 'assignedTo']) || '미지정',
        location: textValue(location) || '미지정',
        typePath: textValue(typePath) || getIssueCategoryLabel(issue),
        description: issue.description || issue.desc || readDeep(raw, ['attributes.description', 'description']) || '',
        rawIssue: issue
    };
}

async function fetchScheduleTasks() {
    const resp = await fetch('/api/issues/forma-gangbuk?limit=1000&workSchedule=1', { credentials: 'same-origin' });
    if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
    }
    const json = await resp.json();
    const issues = Array.isArray(json.data) ? json.data : [];
    return issues.map(normalizeScheduleTask).sort((a, b) => {
        return String(a.startDate).localeCompare(String(b.startDate)) ||
            String(a.dueDate).localeCompare(String(b.dueDate)) ||
            String(a.title).localeCompare(String(b.title), 'ko');
    });
}

function collectModelFiles(node, inherited = {}) {
    if (!node || typeof node !== 'object') return [];
    const meta = {
        hubId: node.hubId || inherited.hubId || '',
        projectId: node.projectId || inherited.projectId || '',
        projectName: node.projectName || inherited.projectName || '',
        folderPath: node.path || inherited.folderPath || ''
    };
    const files = Array.isArray(node.files)
        ? node.files.map(file => ({
            ...file,
            hubId: file.hubId || meta.hubId,
            projectId: file.projectId || meta.projectId,
            projectName: file.projectName || meta.projectName,
            folderPath: file.folderPath || meta.folderPath
        }))
        : [];
    const children = Array.isArray(node.children)
        ? node.children.flatMap(child => collectModelFiles(child, meta))
        : [];
    return files.concat(children);
}

function dedupeModels(models) {
    const seen = new Set();
    return (models || []).filter(model => {
        const key = model.urn || model.versionId || model.itemId || model.name;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function getModelTime(model) {
    const date = new Date(model?.lastModifiedTime || model?.modifiedAt || model?.updatedAt || 0);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function getRecentModelCutoff() {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 1);
    return cutoff;
}

function getSortedModels() {
    return modelUpdateState.models
        .slice()
        .sort((a, b) => getModelTime(b) - getModelTime(a) || String(a.name || '').localeCompare(String(b.name || ''), 'ko'));
}

function getRecentModels() {
    const cutoff = getRecentModelCutoff().getTime();
    return getSortedModels().filter(model => getModelTime(model) >= cutoff);
}

function countByCategory(items) {
    return (items || []).reduce((acc, item) => {
        const key = item.category || item.typePath || item.name || 'Other';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
    }, {});
}

function getChangedItems(diff) {
    return diff?.changed || diff?.modified || [];
}

function topCategoryRows(diff) {
    const merged = []
        .concat((diff?.added || []).map(item => ({ ...item, _kind: 'Added' })))
        .concat(getChangedItems(diff).map(item => ({ ...item, _kind: 'Modified' })))
        .concat((diff?.removed || []).map(item => ({ ...item, _kind: 'Removed' })));
    const counts = countByCategory(merged);
    return Object.entries(counts)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
        .slice(0, 5);
}

async function loadModelUpdates(force = false) {
    if (modelUpdateState.loading) return;
    if (modelUpdateState.loaded && !force) {
        renderModelUpdatePanel();
        return;
    }
    modelUpdateState.loading = true;
    modelUpdateState.error = '';
    renderModelUpdatePanel();
    try {
        let cached = null;
        if (!force) {
            try {
                cached = JSON.parse(localStorage.getItem(MODEL_UPDATE_CACHE_KEY) || 'null');
            } catch (cacheErr) {
                localStorage.removeItem(MODEL_UPDATE_CACHE_KEY);
            }
        }
        if (cached && Array.isArray(cached.models) && Date.now() - Number(cached.ts || 0) < SCHEDULE_BACKGROUND_REFRESH_INTERVAL_MS) {
            modelUpdateState = { ...modelUpdateState, ...cached, loaded: true, loading: false, error: '', selectedUrn: '', selectedModel: null, versions: [], diff: null, diffError: '' };
            renderModelUpdatePanel();
            loadProjectSearchFiles(false);
            return;
        }

        const resp = await fetch(`/api/models/tree${force ? '?force=1' : ''}`, { credentials: 'same-origin' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const tree = await resp.json();
        const models = dedupeModels(collectModelFiles(tree)).sort((a, b) => getModelTime(b) - getModelTime(a));
        modelUpdateState = {
            ...modelUpdateState,
            loaded: true,
            loading: false,
            error: '',
            tree,
            models,
            hubId: tree.hubId || '',
            projectId: tree.projectId || '',
            projectName: tree.projectName || ''
        };
        modelUpdateState.selectedUrn = '';
        modelUpdateState.selectedModel = null;
        modelUpdateState.versions = [];
        modelUpdateState.diff = null;
        modelUpdateState.diffError = '';
        localStorage.setItem(MODEL_UPDATE_CACHE_KEY, JSON.stringify({
            ts: Date.now(),
            tree,
            models,
            hubId: modelUpdateState.hubId,
            projectId: modelUpdateState.projectId,
            projectName: modelUpdateState.projectName
        }));
    } catch (err) {
        console.warn('[Example2 BIM] model update load failed:', err);
        modelUpdateState = {
            ...modelUpdateState,
            loaded: true,
            loading: false,
            error: `모델 업데이트 정보를 불러오지 못했습니다. ${err.message}`
        };
    }
    renderModelUpdatePanel();
    loadProjectSearchFiles(false);
    renderProjectSearchPanel();
}

async function compareSelectedModel() {
    const model = modelUpdateState.selectedModel;
    if (!model) {
        modelUpdateState.versions = [];
        modelUpdateState.diffError = '';
        modelUpdateState.diff = null;
        renderModelUpdatePanel();
        return;
    }
    if (!model || !model.itemId || !model.projectId || !model.hubId) {
        modelUpdateState.diffError = '비교할 모델 버전 정보를 찾을 수 없습니다.';
        renderModelUpdatePanel();
        return;
    }
    modelUpdateState.diffLoading = true;
    modelUpdateState.diffError = '';
    modelUpdateState.diff = null;
    renderModelUpdatePanel();
    try {
        const versionResp = await fetch(`/api/hubs/${encodeURIComponent(model.hubId)}/projects/${encodeURIComponent(model.projectId)}/contents/${encodeURIComponent(model.itemId)}/versions`, { credentials: 'same-origin' });
        if (!versionResp.ok) throw new Error(`versions HTTP ${versionResp.status}`);
        const versions = await versionResp.json();
        const sorted = (Array.isArray(versions) ? versions : [])
            .slice()
            .sort(compareVersionsDesc);
        modelUpdateState.versions = sorted;
        if (sorted.length < 2) {
            throw new Error('직전 버전이 없어 비교할 수 없습니다.');
        }
        const cur = sorted[0];
        const prev = sorted[1];
        const diff = await runActualComparisonForModelUpdate(model, prev, cur);
        modelUpdateState.diff = normalizeComparisonResult(diff, prev, cur);
    } catch (err) {
        console.warn('[Example2 BIM] model diff failed:', err);
        modelUpdateState.diffError = err.message || '모델 비교에 실패했습니다.';
    } finally {
        modelUpdateState.diffLoading = false;
        renderModelUpdatePanel();
    }
}

function buildComparisonVersionPayload(model, version) {
    const modelName = model?.name || 'BIM Model';
    return {
        versionUrn: version.id,
        viewerUrn: version.urn,
        name: modelName,
        versionNumber: getFormaVersionValue(version) || getVersionNumber(version) || version.vNumber || version.versionNumber
    };
}

function snapshotElementState(id) {
    const el = document.getElementById(id);
    if (!el) return null;
    return {
        id,
        className: el.className,
        style: el.getAttribute('style')
    };
}

function restoreElementState(snapshot) {
    if (!snapshot) return;
    const el = document.getElementById(snapshot.id);
    if (!el) return;
    el.className = snapshot.className || '';
    if (snapshot.style === null || typeof snapshot.style === 'undefined') {
        el.removeAttribute('style');
    } else {
        el.setAttribute('style', snapshot.style);
    }
}

function ensureSilentComparisonStyle() {
    let styleEl = document.getElementById('example2-silent-comparison-style');
    if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = 'example2-silent-comparison-style';
        styleEl.textContent = `
            body.example2-silent-comparison #comparison-container,
            body.example2-silent-comparison #comparison-bar,
            body.example2-silent-comparison #comparison-panel,
            body.example2-silent-comparison #overlay {
                visibility: hidden !important;
                opacity: 0 !important;
                pointer-events: none !important;
            }
        `;
        document.head.appendChild(styleEl);
    }
}

function normalizeComparisonResult(diff, prevVersion, curVersion) {
    const changed = diff?.changed || diff?.modified || [];
    return {
        ...diff,
        added: Array.isArray(diff?.added) ? diff.added : [],
        removed: Array.isArray(diff?.removed) ? diff.removed : [],
        changed: Array.isArray(changed) ? changed : [],
        modified: Array.isArray(changed) ? changed : [],
        prevVersion,
        curVersion
    };
}

async function runActualComparisonForModelUpdate(model, prevVersion, curVersion) {
    const snapshots = [
        'explorer-container',
        'comparison-container',
        'comparison-bar',
        'comparison-panel',
        'preview',
        'viewer-overlay',
        'viewer-split-wrapper',
        'tab-content-project',
        'overlay'
    ].map(snapshotElementState);
    const previousWindowState = {
        hubId: window.currentHubId,
        projectId: window.currentProjectId,
        itemId: window.currentItemId,
        versionId: window.currentVersionId,
        comparisonData: window.comparisonData,
        currentDiffData: window.currentDiffData,
        hadComparisonClass: document.body.classList.contains('comparison-active'),
        hadSilentClass: document.body.classList.contains('example2-silent-comparison')
    };

    ensureSilentComparisonStyle();
    document.body.classList.add('example2-silent-comparison');

    try {
        window.currentHubId = model.hubId;
        window.currentProjectId = model.projectId;
        window.currentItemId = model.itemId;
        window.currentVersionId = curVersion.id;
        window.comparisonData = null;
        window.currentDiffData = null;

        const comparisonModule = await import('./comparison.js?v=example2-actual-precompare-20260821');
        const compareService = comparisonModule.default || window.modelComparison || window.comparisonManager || window.comparison;
        if (!compareService || typeof compareService.startComparison !== 'function') {
            throw new Error('버전 비교 모듈을 초기화하지 못했습니다.');
        }

        await compareService.startComparison(
            buildComparisonVersionPayload(model, prevVersion),
            buildComparisonVersionPayload(model, curVersion)
        );

        const diff = window.comparisonData || window.currentDiffData;
        if (!diff) {
            throw new Error('실제 비교 결과를 가져오지 못했습니다.');
        }
        return normalizeComparisonResult(diff, prevVersion, curVersion);
    } finally {
        window.currentHubId = previousWindowState.hubId;
        window.currentProjectId = previousWindowState.projectId;
        window.currentItemId = previousWindowState.itemId;
        window.currentVersionId = previousWindowState.versionId;

        if (!previousWindowState.comparisonData && !previousWindowState.currentDiffData) {
            window.comparisonData = null;
            window.currentDiffData = null;
        }
        if (!previousWindowState.hadComparisonClass) {
            document.body.classList.remove('comparison-active');
        }
        if (!previousWindowState.hadSilentClass) {
            document.body.classList.remove('example2-silent-comparison');
        }
        snapshots.forEach(restoreElementState);
    }
}

async function runApiDiffForModel(projectId, prevUrn, curUrn) {
    const diffResp = await fetch('/api/diff/run', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                projectId,
                prevUrn,
                curUrn
            })
        });
    if (!diffResp.ok) {
        const errorText = await diffResp.text();
        throw new Error(errorText || `diff HTTP ${diffResp.status}`);
    }
    return diffResp.json();
}

async function getSelectedModelVersionsForCompare() {
    const model = modelUpdateState.selectedModel;
    if (!model?.itemId || !model?.projectId || !model?.hubId) {
        throw new Error('선택한 모델의 버전 정보를 찾을 수 없습니다.');
    }
    let versions = Array.isArray(modelUpdateState.versions) && modelUpdateState.versions.length
        ? modelUpdateState.versions
        : null;
    if (!versions) {
        const versionResp = await fetch(`/api/hubs/${encodeURIComponent(model.hubId)}/projects/${encodeURIComponent(model.projectId)}/contents/${encodeURIComponent(model.itemId)}/versions`, { credentials: 'same-origin' });
        if (!versionResp.ok) throw new Error(`버전 목록을 불러오지 못했습니다. HTTP ${versionResp.status}`);
        versions = await versionResp.json();
    }
    const sortedDesc = (Array.isArray(versions) ? versions : [])
        .slice()
        .sort(compareVersionsDesc);
    if (sortedDesc.length < 2) {
        throw new Error('직전 버전이 없어 비교 뷰를 열 수 없습니다.');
    }
    modelUpdateState.versions = sortedDesc;
    return {
        previous: sortedDesc[1],
        current: sortedDesc[0],
        model
    };
}

async function openSelectedModelVersionComparison() {
    try {
        const { previous, current, model } = await getSelectedModelVersionsForCompare();
        if (typeof window.switchTab === 'function') window.switchTab('project');

        window.currentHubId = model.hubId;
        window.currentProjectId = model.projectId;
        window.currentItemId = model.itemId;
        window.currentVersionId = current.id;

        await import('./comparison.js?v=example2-bim-compare-20260821');
        const compareService = window.modelComparison || window.comparisonManager || window.comparison;
        if (!compareService || typeof compareService.startComparison !== 'function') {
            throw new Error('버전 비교 모듈을 초기화하지 못했습니다.');
        }

        await compareService.startComparison(
            buildComparisonVersionPayload(model, previous),
            buildComparisonVersionPayload(model, current)
        );
        if (window.comparisonData) {
            modelUpdateState.diff = normalizeComparisonResult(window.comparisonData, previous, current);
            renderModelUpdatePanel();
        }
    } catch (err) {
        console.warn('[Example2 BIM] open comparison failed:', err);
        alert(err.message || '모델 버전 비교 뷰를 열지 못했습니다.');
    }
}

function normalizeProjectFileSearchItem(file) {
    const title = file.displayName || file.name || '프로젝트 파일';
    const extension = String(file.extension || title.split('.').pop() || '').toLowerCase();
    const isKnownDocument = /\.(dwg|pdf|xlsx?|docx?|pptx?)$/i.test(title);
    const isModel = extension === 'rvt' || /\.rvt$/i.test(title) || (file.urn && !isKnownDocument);
    return {
        category: isModel ? 'model' : 'doc',
        title,
        subtitle: file.parentFolderName || file.folderPath || '강북정수장 증설공사 BIM 용역',
        text: `${title} ${file.parentFolderName || ''} ${file.folderPath || ''} ${extension}`,
        urn: file.urn || '',
        itemId: file.itemId || file.id || '',
        tipId: file.tipId || '',
        extension,
        raw: file,
        source: file.source || projectSearchState.source || ''
    };
}

function normalizeCctvSearchItem(channel) {
    const title = channel.title || channel.name || channel.cctvName || '현장관제 CCTV';
    const modelName = channel.modelName || channel.linkedModelName || channel.structureName || channel.location || '';
    return {
        category: 'cctv',
        title,
        subtitle: modelName ? `연결 모델: ${modelName}` : '현장관제 탭 연결 CCTV',
        text: `${title} ${modelName} ${channel.id || ''} ${channel.cctvId || ''}`,
        url: channel.streamUrl || channel.url || '',
        pageUrl: channel.pageUrl || '',
        img: channel.img || '',
        raw: channel
    };
}

async function loadCctvSearchChannels(force = false) {
    if (cctvSearchState.loading) return;
    if (cctvSearchState.loaded && !force) return;

    cctvSearchState = { ...cctvSearchState, loading: true, error: '' };
    renderProjectSearchPanel();

    try {
        const resp = await fetch('/api/cctv/live', { credentials: 'same-origin' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        const channels = Array.isArray(data) ? data : (data.channels || data.cctvs || data.items || []);
        cctvSearchState = {
            loaded: true,
            loading: false,
            error: '',
            channels: Array.isArray(channels) ? channels : []
        };
    } catch (err) {
        console.warn('[Example2 BIM] CCTV channel search failed:', err);
        cctvSearchState = {
            loaded: true,
            loading: false,
            error: '현장관제 CCTV 목록을 불러오지 못했습니다.',
            channels: []
        };
    }

    renderProjectSearchPanel();
}

async function loadProjectSearchFiles(force = false) {
    if (projectSearchState.loading) return;
    if (projectSearchState.loaded && !force && projectSearchState.source !== 'model-tree-fallback') return;

    const hubId = modelUpdateState.hubId;
    const projectId = modelUpdateState.projectId;
    if (!hubId || !projectId) {
        projectSearchState = {
            ...projectSearchState,
            loaded: true,
            loading: false,
            source: 'model-tree-fallback',
            files: modelUpdateState.models || []
        };
        renderProjectSearchPanel();
        return;
    }

    projectSearchState = { ...projectSearchState, loading: true, error: '' };
    renderProjectSearchPanel();

    try {
        const extensions = 'rvt,dwg,pdf,doc,docx,xls,xlsx,ppt,pptx';
        const resp = await fetch(`/api/hubs/${encodeURIComponent(hubId)}/projects/${encodeURIComponent(projectId)}/search-files?extensions=${encodeURIComponent(extensions)}`, { credentials: 'same-origin' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const files = await resp.json();
        const treeModels = (modelUpdateState.models || []).map(model => ({
            ...model,
            displayName: model.displayName || model.name,
            extension: 'rvt',
            source: 'model-tree'
        }));
        projectSearchState = {
            loaded: true,
            loading: false,
            error: '',
            files: dedupeProjectSearchFiles((Array.isArray(files) ? files : []).concat(treeModels)),
            source: 'project-search-files'
        };
    } catch (err) {
        console.warn('[Example2 BIM] project file search failed, using model tree fallback:', err);
        projectSearchState = {
            loaded: true,
            loading: false,
            error: '프로젝트 파일 검색 API 대신 모델 트리 목록으로 검색합니다.',
            files: modelUpdateState.models || [],
            source: 'model-tree-fallback'
        };
    }

    renderProjectSearchPanel();
}

function dedupeProjectSearchFiles(files) {
    const seen = new Set();
    return (files || []).filter(file => {
        const key = file.id || file.urn || file.tipId || file.displayName || file.name;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function readScheduleCache() {
    try {
        const cached = JSON.parse(localStorage.getItem(GUNHWA_SCHEDULE_CACHE_KEY) || 'null');
        if (cached && Array.isArray(cached.tasks)) return cached;
    } catch (e) {}
    return null;
}

function writeScheduleCache(tasks) {
    try {
        localStorage.setItem(GUNHWA_SCHEDULE_CACHE_KEY, JSON.stringify({
            ts: Date.now(),
            tasks: tasks || []
        }));
    } catch (err) {
        console.warn('[Example2 Schedule] cache save failed:', err);
    }
}

function shouldRefreshSchedule(ts) {
    return !ts || Date.now() - Number(ts || 0) > SCHEDULE_BACKGROUND_REFRESH_INTERVAL_MS;
}

function getAvailableMonths(tasks) {
    const months = new Set();
    (tasks || []).forEach(task => {
        const start = parseDate(task.startDate);
        const end = parseDate(task.dueDate) || start;
        if (!start) return;
        const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
        const last = new Date(end.getFullYear(), end.getMonth(), 1);
        while (cursor <= last) {
            months.add(monthKeyFromDate(cursor));
            cursor.setMonth(cursor.getMonth() + 1);
        }
    });
    return Array.from(months).sort();
}

function getTodayMonthKey() {
    return monthKeyFromDate(new Date());
}

function getScheduleMonthOptions(tasks) {
    return Array.from(new Set([getTodayMonthKey(), ...getAvailableMonths(tasks)])).sort();
}

function getDefaultMonth(tasks) {
    return getTodayMonthKey();
}

function taskOverlapsMonth(task, monthKey) {
    if (!monthKey) return true;
    const [year, month] = String(monthKey).split('-').map(Number);
    if (!year || !month) return true;
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);
    const start = parseDate(task.startDate);
    const end = parseDate(task.dueDate) || start;
    if (!start || !end) return false;
    return start <= monthEnd && end >= monthStart;
}

function applyScheduleTasks(tasks, ts = Date.now()) {
    scheduleState.tasks = Array.isArray(tasks) ? tasks : [];
    scheduleState.cacheTs = ts || Date.now();
    scheduleState.loaded = true;

    if (!scheduleState.month) {
        scheduleState.month = getDefaultMonth(scheduleState.tasks);
    }
}

async function refreshScheduleInBackground() {
    if (scheduleState.refreshing) return;
    scheduleState.refreshing = true;
    renderSchedule();
    try {
        const tasks = await fetchScheduleTasks();
        applyScheduleTasks(tasks);
        writeScheduleCache(tasks);
    } catch (err) {
        console.warn('[Example2 Schedule] background refresh failed:', err);
    } finally {
        scheduleState.refreshing = false;
        renderSchedule();
    }
}

function getBaseFilteredTasks() {
    const query = scheduleState.query.trim().toLowerCase();
    return scheduleState.tasks.filter(task => {
        if (!taskOverlapsMonth(task, scheduleState.month)) return false;
        if (scheduleState.status !== 'all' && task.statusKey !== scheduleState.status) return false;
        if (!query) return true;
        return [task.title, task.assignee, task.location, task.typePath, task.description, task.rawStatus]
            .some(value => String(value || '').toLowerCase().includes(query));
    });
}

function getFilteredTasks(baseTasks = getBaseFilteredTasks()) {
    const filters = scheduleState.columnFilters || {};
    return baseTasks.filter(task => {
        return ['categoryLabel', 'location', 'assignee', 'statusLabel'].every(key => {
            const selected = String(filters[key] || '').trim();
            if (!selected) return true;
            return String(task[key] || '').trim() === selected;
        });
    });
}

function resetScheduleColumnFilters() {
    scheduleState.columnFilters = {
        categoryLabel: '',
        location: '',
        assignee: '',
        statusLabel: ''
    };
}

function getUniqueScheduleValues(tasks, key) {
    return Array.from(new Set((tasks || [])
        .map(task => String(task[key] || '').trim())
        .filter(Boolean)))
        .sort((a, b) => a.localeCompare(b, 'ko'));
}

function renderScheduleColumnFilter(key, label, tasks) {
    const selected = String((scheduleState.columnFilters || {})[key] || '');
    const options = getUniqueScheduleValues(tasks, key)
        .map(value => `<option value="${escapeHtml(value)}"${value === selected ? ' selected' : ''}>${escapeHtml(value)}</option>`)
        .join('');
    return `
        <div style="display:flex; flex-direction:column; gap:5px; min-width:0;">
            <span>${escapeHtml(label)}</span>
            <select class="example2-schedule-column-filter" data-filter-key="${escapeHtml(key)}" title="${escapeHtml(label)} 필터" style="width:100%; height:22px; min-width:0; box-sizing:border-box; border:1px solid rgba(148,163,184,0.24); border-radius:5px; background:#0f172a; color:#e5e7eb; font-size:10px; font-weight:800; padding:0 4px; outline:none;">
                <option value="">전체</option>
                ${options}
            </select>
        </div>
    `;
}

function renderKpis(tasks) {
    const counts = tasks.reduce((acc, task) => {
        acc[task.statusKey] = (acc[task.statusKey] || 0) + 1;
        return acc;
    }, {});
    const avgDuration = tasks.length
        ? Math.round(tasks.reduce((sum, task) => sum + Number(task.durationDays || 0), 0) / tasks.length)
        : 0;
    const items = [
        ['전체', tasks.length, '#38bdf8'],
        ['진행중', counts.active || 0, '#38bdf8'],
        ['완료', counts.done || 0, '#10b981'],
        ['평균기간', `${avgDuration}일`, '#a78bfa']
    ];
    return items.map(([label, value, color]) => `
        <div style="min-width:0; border:1px solid rgba(148,163,184,0.18); border-radius:6px; background:rgba(30,41,59,0.58); padding:10px;">
            <div style="color:#94a3b8; font-size:11px; font-weight:800;">${escapeHtml(label)}</div>
            <div style="margin-top:4px; color:${color}; font-size:20px; font-weight:900;">${escapeHtml(value)}</div>
        </div>
    `).join('');
}

function findScheduleTaskById(id) {
    return (scheduleState.tasks || []).find(task => String(task.id || '') === String(id || ''));
}

function openScheduleTaskDetailById(id) {
    const task = findScheduleTaskById(id);
    if (!task) return;
    openIssueSearchDetail({
        category: 'issue',
        title: task.title,
        subtitle: `${task.categoryLabel || '이슈'} · ${task.location || '미지정'} · ${task.statusLabel || '-'}`,
        issue: task.rawIssue || task,
        raw: task
    });
}

function renderMonthlyGantt(tasks) {
    const [year, month] = String(scheduleState.month || '').split('-').map(Number);
    if (!year || !month) {
        return `
            <div style="border:1px solid rgba(148,163,184,0.16); border-radius:7px; background:rgba(15,23,42,0.72); padding:12px; color:#94a3b8; font-size:12px; font-weight:800;">
                월을 선택하면 간트 차트가 표시됩니다.
            </div>
        `;
    }

    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);
    const daysInMonth = monthEnd.getDate();
    const days = Array.from({ length: daysInMonth }, (_, index) => index + 1);
    const locationColumnWidth = 128;
    const taskColumnWidth = 210;
    const gridColumns = `repeat(${daysInMonth}, minmax(0, 1fr))`;
    const today = new Date();
    const todayDay = today.getFullYear() === year && today.getMonth() + 1 === month ? today.getDate() : 0;
    const dayMeta = days.map(day => {
        const date = new Date(year, month - 1, day);
        const dayOfWeek = date.getDay();
        const holidayName = getKoreanHolidayName(year, month, day);
        return {
            day,
            dayOfWeek,
            holidayName,
            isSunday: dayOfWeek === 0,
            isSaturday: dayOfWeek === 6,
            isToday: day === todayDay,
            isHoliday: Boolean(holidayName) || dayOfWeek === 0
        };
    });
    const holidayCells = dayMeta.map(meta => `
        <div title="${escapeHtml(meta.isToday ? '오늘' : (meta.holidayName || (meta.isSunday ? '일요일' : (meta.isSaturday ? '토요일' : ''))))}" style="grid-column:${meta.day} / ${meta.day + 1}; grid-row:1; align-self:stretch; position:relative; background:${meta.holidayName ? 'rgba(248,113,113,0.16)' : (meta.isSunday ? 'rgba(248,113,113,0.09)' : (meta.isSaturday ? 'rgba(56,189,248,0.08)' : 'transparent'))}; border-left:1px solid rgba(148,163,184,0.08);">
        </div>
    `).join('');
    const todayLine = todayDay ? `
        <div style="position:absolute; inset:0; display:grid; grid-template-columns:${locationColumnWidth}px ${taskColumnWidth}px ${gridColumns}; pointer-events:none; z-index:3;">
            <span style="grid-column:${todayDay + 2}; justify-self:center; align-self:stretch; width:1px; background:#22d3ee; box-shadow:0 0 8px rgba(34,211,238,0.58);"></span>
        </div>
    ` : '';
    const chartTasks = tasks
        .map(task => {
            const start = parseDate(task.startDate);
            const end = parseDate(task.dueDate) || start;
            if (!start || !end || start > monthEnd || end < monthStart) return null;
            const visibleStart = start < monthStart ? monthStart : start;
            const visibleEnd = end > monthEnd ? monthEnd : end;
            return {
                ...task,
                startDay: visibleStart.getDate(),
                endDay: visibleEnd.getDate()
            };
        })
        .filter(Boolean);

    const groupedTasks = chartTasks
        .slice()
        .sort((a, b) => {
            return String(a.location || '').localeCompare(String(b.location || ''), 'ko') ||
                String(a.startDate || '').localeCompare(String(b.startDate || '')) ||
                String(a.dueDate || '').localeCompare(String(b.dueDate || '')) ||
                String(a.title || '').localeCompare(String(b.title || ''), 'ko');
        })
        .reduce((groups, task) => {
            const location = String(task.location || '미지정 위치').trim() || '미지정 위치';
            if (!groups.has(location)) groups.set(location, []);
            groups.get(location).push(task);
            return groups;
        }, new Map());

    const rows = chartTasks.length
        ? Array.from(groupedTasks.entries()).map(([location, groupTasks]) => {
            const rowCount = groupTasks.length;
            const taskRows = groupTasks.map((task, index) => {
                const style = STATUS_STYLES[task.statusKey] || STATUS_STYLES.planned;
                const taskId = escapeHtml(task.id || '');
                return `
                    <div style="display:contents;">
                        ${index === 0 ? `
                            <div style="grid-column:1; grid-row:1 / span ${rowCount}; min-width:0; display:flex; align-items:center; padding:5px 8px; border-top:1px solid rgba(148,163,184,0.14); border-right:1px solid rgba(148,163,184,0.12); background:rgba(30,41,59,0.54); color:#bae6fd; font-size:10px; font-weight:900; line-height:1.25; word-break:keep-all; overflow-wrap:anywhere;" title="${escapeHtml(location)}">
                                <span>${escapeHtml(location)}</span>
                            </div>
                        ` : ''}
                        <button type="button" data-schedule-task-id="${taskId}" style="grid-column:2; min-width:0; min-height:30px; padding:5px 8px; border:0; border-top:1px solid rgba(148,163,184,0.10); border-right:1px solid rgba(148,163,184,0.12); background:transparent; color:#e5e7eb; font-size:10px; font-weight:800; line-height:1.25; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-align:left; display:flex; align-items:center; cursor:pointer;" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</button>
                        <div style="grid-column:3; min-height:30px; display:grid; grid-template-columns:${gridColumns}; grid-template-rows:1fr; align-items:center; position:relative; padding:4px 0; border-top:1px solid rgba(148,163,184,0.10); background:linear-gradient(90deg, rgba(148,163,184,0.08) 1px, transparent 1px); background-size:calc(100% / ${daysInMonth}) 100%;">
                            ${holidayCells}
                            <button type="button" data-schedule-task-id="${taskId}" title="${escapeHtml(`${task.title} ${task.startDate} ~ ${task.dueDate}`)}" style="grid-column:${task.startDay} / ${task.endDay + 1}; grid-row:1; z-index:1; height:12px; border:0; border-radius:999px; background:${style.color}; box-shadow:0 0 0 1px rgba(255,255,255,0.12) inset; min-width:12px; cursor:pointer;"></button>
                        </div>
                    </div>
                `;
            }).join('');
            return `
                <div style="display:grid; grid-template-columns:${locationColumnWidth}px ${taskColumnWidth}px minmax(0,1fr); grid-auto-rows:minmax(30px, auto);">
                    ${taskRows}
                </div>
            `;
        }).join('')
        : `
            <div style="height:86px; display:flex; align-items:center; justify-content:center; color:#94a3b8; font-size:12px; font-weight:800; border-top:1px solid rgba(148,163,184,0.10);">
                선택한 월에 표시할 업무 일정이 없습니다.
            </div>
        `;

    return `
        <div style="border:1px solid rgba(148,163,184,0.16); border-radius:7px; background:rgba(15,23,42,0.72); overflow:hidden; flex:0 0 auto;">
            <div style="display:flex; align-items:center; justify-content:space-between; padding:7px 12px; border-bottom:1px solid rgba(148,163,184,0.14);">
                <div style="color:#f8fafc; font-size:12px; font-weight:900;">${escapeHtml(formatMonthLabel(scheduleState.month))} 간트 차트</div>
                <div style="color:#94a3b8; font-size:11px; font-weight:800;">${escapeHtml(chartTasks.length)}건</div>
            </div>
            <div style="overflow-y:auto; overflow-x:hidden; max-height:360px;">
                <div style="width:100%; min-width:0;">
                    <div style="display:grid; grid-template-columns:${locationColumnWidth}px ${taskColumnWidth}px minmax(0,1fr); min-height:28px;">
                        <div style="padding:6px 8px; color:#94a3b8; font-size:10px; font-weight:900; border-right:1px solid rgba(148,163,184,0.12);">위치</div>
                        <div style="padding:6px 8px; color:#94a3b8; font-size:10px; font-weight:900; border-right:1px solid rgba(148,163,184,0.12);">업무</div>
                        <div style="display:grid; grid-template-columns:${gridColumns}; align-items:stretch; color:#94a3b8; font-size:10px; font-weight:800; text-align:center;">
                            ${dayMeta.map(meta => `
                                <span title="${escapeHtml(meta.isToday ? '오늘' : (meta.holidayName || (meta.isSunday ? '일요일' : (meta.isSaturday ? '토요일' : ''))))}" style="display:flex; flex-direction:column; align-items:center; justify-content:center; gap:0; min-width:0; color:${meta.isToday ? '#22d3ee' : (meta.holidayName || meta.isSunday ? '#f87171' : (meta.isSaturday ? '#60a5fa' : '#94a3b8'))}; background:${meta.holidayName ? 'rgba(248,113,113,0.18)' : (meta.isSunday ? 'rgba(248,113,113,0.10)' : (meta.isSaturday ? 'rgba(56,189,248,0.09)' : 'transparent'))}; border-left:1px solid rgba(148,163,184,0.08); ${meta.isToday ? 'box-shadow: inset 0 -1px 0 #22d3ee;' : ''} font-size:9px; line-height:1.05; font-weight:${meta.isToday ? '950' : '800'};">
                                    <span>${meta.isToday ? `${month}/${meta.day}` : meta.day}</span>
                                    ${!meta.isToday && meta.holidayName ? '<span style="font-size:8px; font-weight:900;">휴</span>' : ''}
                                </span>
                            `).join('')}
                        </div>
                    </div>
                    <div style="position:relative;">
                        ${todayLine}
                        ${rows}
                    </div>
                </div>
            </div>
        </div>
    `;
}

function renderTaskRows(tasks) {
    if (!tasks.length) {
        return `
            <tr>
                <td colspan="6" style="height:220px; text-align:center; color:#94a3b8; font-weight:800;">
                    선택한 조건에 해당하는 업무 일정이 없습니다.
                </td>
            </tr>
        `;
    }

    return tasks.map(task => {
        const style = STATUS_STYLES[task.statusKey] || STATUS_STYLES.planned;
        const categoryStyle = getCategoryStyle(task.categoryLabel);
        return `
            <tr data-schedule-task-id="${escapeHtml(task.id || '')}" style="border-bottom:1px solid rgba(148,163,184,0.12); cursor:pointer;">
                <td style="width:82px; padding:9px 6px; text-align:center; white-space:nowrap; overflow:hidden;">
                    <span style="display:inline-flex; align-items:center; justify-content:center; max-width:70px; border-radius:999px; padding:4px 8px; background:${categoryStyle.bg}; color:${categoryStyle.color}; font-size:10px; font-weight:950; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(task.categoryLabel || '이슈')}">
                        ${escapeHtml(task.categoryLabel || '이슈')}
                    </span>
                </td>
                <td style="width:112px; padding:9px 8px; color:#cbd5e1; font-size:11px; font-weight:850; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(task.location)}">
                    ${escapeHtml(task.location || '-')}
                </td>
                <td style="padding:9px 8px; vertical-align:middle; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                    <div style="color:#f8fafc; font-size:12px; font-weight:900; line-height:1.25; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</div>
                </td>
                <td style="width:154px; padding:9px 8px; color:#cbd5e1; font-size:11px; font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(`${task.startDate} ~ ${task.dueDate} (${task.durationDays}일)`)}">
                    ${escapeHtml(task.startDate)} ~ ${escapeHtml(task.dueDate)} (${escapeHtml(task.durationDays)}일)
                </td>
                <td style="width:82px; padding:9px 8px; color:#e5e7eb; font-size:11px; font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(task.assignee)}">${escapeHtml(task.assignee)}</td>
                <td style="width:62px; padding:9px 6px; text-align:center; white-space:nowrap; overflow:hidden;">
                    <span style="display:inline-flex; align-items:center; justify-content:center; min-width:42px; border-radius:999px; padding:4px 7px; background:${style.bg}; color:${style.color}; font-size:10px; font-weight:900; white-space:nowrap;">${escapeHtml(task.statusLabel)}</span>
                </td>
            </tr>
        `;
    }).join('');
}

function renderModelUpdatePanel() {
    const root = document.getElementById('example2-model-updates');
    if (!root) return;
    root.style.display = 'block';
    root.style.alignItems = '';
    root.style.justifyContent = '';
    root.style.width = '100%';
    root.style.height = '100%';
    root.style.overflow = 'hidden';
    const recentModels = getRecentModels();
    const selectableModels = recentModels;
    const selected = modelUpdateState.selectedUrn && modelUpdateState.selectedModel && selectableModels.some(model => model.urn === modelUpdateState.selectedModel.urn)
        ? modelUpdateState.selectedModel
        : (modelUpdateState.selectedUrn ? selectableModels.find(model => model.urn === modelUpdateState.selectedUrn) : null);
    const diff = modelUpdateState.diff;
    const addedCount = diff?.added?.length || 0;
    const modifiedCount = getChangedItems(diff).length || 0;
    const removedCount = diff?.removed?.length || 0;
    const categoryRows = diff ? topCategoryRows(diff) : [];
    const prevLabel = diff?.prevVersion ? getVersionLabel(diff.prevVersion) : 'v-';
    const curLabel = diff?.curVersion ? getVersionLabel(diff.curVersion) : 'v-';

    root.innerHTML = `
        <div style="height:100%; min-height:0; display:flex; flex-direction:column; border:1px solid rgba(148,163,184,0.18); border-radius:8px; background:linear-gradient(180deg, rgba(15,23,42,0.92), rgba(10,16,28,0.96)); box-sizing:border-box; overflow:hidden;">
            <div style="height:36px; flex:0 0 36px; display:flex; align-items:center; justify-content:space-between; padding:0 14px; border-bottom:1px solid rgba(148,163,184,0.16); background:rgba(2,6,23,0.22);">
                <div style="color:#f8fafc; font-size:15px; font-weight:950;">최근 모델 업데이트 건수</div>
                <div style="color:#64748b; font-size:11px; font-weight:800;">강북정수장 증설공사 BIM 용역</div>
            </div>
            <div style="display:grid; grid-template-columns:minmax(132px, 0.36fr) minmax(260px, 1fr); gap:14px; align-items:end; padding:8px 12px; border-bottom:1px solid rgba(148,163,184,0.14);">
                <div>
                    <div style="color:#94a3b8; font-size:12px; font-weight:900;">최근 1개월 업데이트 모델</div>
                    <div style="margin-top:6px; color:#67e8f9; font-size:40px; line-height:1; font-weight:950; letter-spacing:0;">${modelUpdateState.loading ? '...' : `${recentModels.length}건`}</div>
                    <div style="margin-top:6px; color:#64748b; font-size:10px; font-weight:800;">최근 1개월 · ${escapeHtml(formatDate(getRecentModelCutoff()))} 이후</div>
                </div>
                <label style="display:flex; flex-direction:column; gap:7px; color:#cbd5e1; font-size:12px; font-weight:800;">
                    <span style="display:flex; align-items:center; gap:6px;"><i class="fas fa-cube" style="color:#7dd3fc;"></i> 모델 선택</span>
                    <select id="example2-model-select" style="height:36px; width:100%; background:#111827; color:#f8fafc; border:1px solid rgba(148,163,184,0.45); border-radius:6px; padding:0 12px; font-size:13px; font-weight:800; outline:none;">
                        <option value="">모델을 선택하세요</option>
                        ${selectableModels.map(model => `<option value="${escapeHtml(model.urn || '')}">${escapeHtml(model.name || '이름 없는 모델')}</option>`).join('') || '<option value="" disabled>최근 업데이트 모델 없음</option>'}
                    </select>
                </label>
            </div>
            <div style="display:grid; grid-template-columns:0.88fr 1.12fr; gap:10px; min-height:0; flex:1; padding:6px 10px 10px;">
                <div style="display:flex; flex-direction:column; gap:6px; min-width:0; min-height:0;">
                    <div style="border:1px solid rgba(148,163,184,0.16); border-radius:7px; background:rgba(2,6,23,0.36); padding:9px; text-align:center;">
                        <div style="font-size:28px; font-weight:950; color:#e5e7eb;">${escapeHtml(prevLabel)} <span style="color:#38bdf8; margin:0 14px;">→</span> <span style="color:#7dd3fc;">${escapeHtml(curLabel)}</span></div>
                        <div style="margin-top:5px; color:#94a3b8; font-size:11px; font-weight:800;">최근 비교 결과</div>
                    </div>
                    <div style="display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:6px; min-height:0;">
                        <div style="border:1px solid rgba(52,211,153,0.22); border-radius:7px; background:rgba(6,78,59,0.14); padding:7px; text-align:center; min-height:0;">
                            <div style="color:#6ee7b7; font-size:10px; font-weight:900;">Added</div>
                            <i class="fas fa-cube" style="margin:5px 0; color:#34d399; font-size:18px;"></i>
                            <div style="color:#6ee7b7; font-size:24px; line-height:1; font-weight:950;">+${addedCount}</div>
                        </div>
                        <div style="border:1px solid rgba(251,146,60,0.24); border-radius:7px; background:rgba(124,45,18,0.12); padding:7px; text-align:center; min-height:0;">
                            <div style="color:#fdba74; font-size:10px; font-weight:900;">Removed</div>
                            <i class="fas fa-trash-alt" style="margin:5px 0; color:#fb923c; font-size:18px;"></i>
                            <div style="color:#fdba74; font-size:24px; line-height:1; font-weight:950;">-${removedCount}</div>
                        </div>
                        <div style="border:1px solid rgba(96,165,250,0.22); border-radius:7px; background:rgba(30,64,175,0.12); padding:7px; text-align:center; min-height:0;">
                            <div style="color:#93c5fd; font-size:10px; font-weight:900;">Modified</div>
                            <i class="fas fa-pencil-alt" style="margin:5px 0; color:#60a5fa; font-size:18px;"></i>
                            <div style="color:#93c5fd; font-size:24px; line-height:1; font-weight:950;">${modifiedCount}</div>
                        </div>
                    </div>
                </div>
                <div style="min-width:0; min-height:0; border:1px solid rgba(148,163,184,0.14); border-radius:7px; background:rgba(2,6,23,0.34); padding:8px; display:flex; flex-direction:column;">
                    <div style="display:flex; align-items:center; gap:8px; color:#f8fafc; font-size:13px; font-weight:900; margin-bottom:8px;">
                        <i class="fas fa-list-ul" style="color:#0ea5e9;"></i> 최근 변경 객체
                    </div>
                    <div style="flex:1; min-height:0; overflow:auto;">
                        ${modelUpdateState.diffLoading ? '<div style="height:100%; display:flex; align-items:center; justify-content:center; color:#94a3b8; font-weight:800;">직전 버전과 비교 중입니다.</div>' : ''}
                        ${modelUpdateState.diffError ? `<div style="color:#fca5a5; font-size:12px; line-height:1.5; font-weight:800;">${escapeHtml(modelUpdateState.diffError)}</div>` : ''}
                        ${!modelUpdateState.diffLoading && !modelUpdateState.diffError && categoryRows.length ? categoryRows.map(([name, count], index) => `
                            <div style="display:grid; grid-template-columns:24px minmax(110px,1fr) minmax(90px,0.9fr) 34px; gap:8px; align-items:center; padding:6px 0; color:#dbeafe; font-size:12px; font-weight:800;">
                                <span style="width:18px; height:18px; border-radius:999px; display:inline-flex; align-items:center; justify-content:center; color:#38bdf8; background:rgba(14,165,233,0.12); border:1px solid rgba(14,165,233,0.45); font-size:10px;">${index + 1}</span>
                                <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
                                <span style="height:7px; border-radius:999px; background:rgba(30,41,59,0.9); overflow:hidden;"><span style="display:block; width:${Math.min(100, Math.max(8, count / Math.max(1, categoryRows[0][1]) * 100))}%; height:100%; background:#38bdf8;"></span></span>
                                <span style="text-align:right; color:#f8fafc;">${count}</span>
                            </div>
                        `).join('') : ''}
                        ${!modelUpdateState.diffLoading && !modelUpdateState.diffError && !categoryRows.length ? '<div style="height:100%; display:flex; align-items:center; justify-content:center; color:#64748b; font-size:12px; font-weight:800; text-align:center;">모델을 선택하면 직전 버전과 비교합니다.</div>' : ''}
                    </div>
                    <button id="example2-open-project-model" type="button" ${selected ? '' : 'disabled'} style="height:30px; flex:0 0 30px; margin-top:6px; border:1px solid ${selected ? 'rgba(56,189,248,0.28)' : 'rgba(148,163,184,0.14)'}; border-radius:6px; background:${selected ? 'rgba(14,165,233,0.18)' : 'rgba(30,41,59,0.42)'}; color:${selected ? '#e0f2fe' : '#64748b'}; font-size:13px; font-weight:900; cursor:${selected ? 'pointer' : 'not-allowed'};">
                        버전 비교 뷰로 이동 →
                    </button>
                </div>
            </div>
        </div>
    `;

    const select = document.getElementById('example2-model-select');
    if (select) {
        select.value = selected?.urn || '';
        select.onchange = () => {
            modelUpdateState.selectedUrn = select.value;
            modelUpdateState.selectedModel = selectableModels.find(model => model.urn === select.value) || null;
            compareSelectedModel();
        };
    }
    const moveBtn = document.getElementById('example2-open-project-model');
    if (moveBtn) {
        moveBtn.onclick = openSelectedModelVersionComparison;
    }
}

function getSearchItems() {
    const taskItems = (scheduleState.tasks || []).map(task => ({
        category: 'issue',
        id: task.id || '',
        title: task.title,
        subtitle: `${task.categoryLabel || '이슈'} · ${task.location || '미지정'} · ${task.statusLabel || '-'}`,
        text: `${task.title} ${task.categoryLabel} ${task.location} ${task.assignee} ${task.description}`,
        issue: task.rawIssue || task,
        raw: task
    }));
    const fileItems = (projectSearchState.files || []).map(normalizeProjectFileSearchItem);
    const cctvItems = (cctvSearchState.channels || []).map(normalizeCctvSearchItem);
    return taskItems.concat(fileItems, cctvItems);
}

function filterSearchItems() {
    const query = searchState.query.trim().toLowerCase();
    const filter = searchState.filter;
    return getSearchItems().filter(item => {
        if (filter !== 'all' && item.category !== filter) {
            if (!(filter === 'schedule' && item.category === 'issue')) return false;
        }
        if (!query) return true;
        return String(item.text || '').toLowerCase().includes(query);
    }).slice(0, 8);
}

function pickFirst(items, fallback = null) {
    return Array.isArray(items) && items.length ? items[0] : fallback;
}

function includesSearchText(item) {
    const query = searchState.query.trim().toLowerCase();
    if (!query) return true;
    return String(item?.text || item?.title || '').toLowerCase().includes(query);
}

function getProjectSearchGroups() {
    const hasQuery = Boolean(searchState.query.trim());
    const items = hasQuery ? getSearchItems().filter(includesSearchText) : [];
    const models = items.filter(item => item.category === 'model');
    const docs = items.filter(item => item.category === 'doc');
    const cctv = items.filter(item => item.category === 'cctv');
    const issues = items.filter(item => item.category === 'issue');
    const schedule = [];
    const allGroups = {
        items,
        models,
        docs,
        cctv,
        schedule,
        issues
    };
    if (searchState.filter === 'model') return { ...allGroups, docs: [], cctv: [], schedule: [], issues: [] };
    if (searchState.filter === 'doc') return { ...allGroups, models: [], cctv: [], schedule: [], issues: [] };
    if (searchState.filter === 'cctv') return { ...allGroups, models: [], docs: [], schedule: [], issues: [] };
    if (searchState.filter === 'schedule') return { ...allGroups, models: [], docs: [], cctv: [], issues: [] };
    if (searchState.filter === 'issue') return { ...allGroups, models: [], docs: [], cctv: [], schedule: [] };
    return allGroups;
}

function getSearchActionType(item) {
    if (item.category === 'model') return 'model';
    if (item.category === 'doc') return 'doc';
    if (item.category === 'cctv') return 'cctv';
    if (item.category === 'issue') return 'issue';
    return '';
}

function setSearchActionItems(groups) {
    const items = []
        .concat(groups.models || [])
        .concat(groups.docs || [])
        .concat(groups.cctv || [])
        .concat(groups.schedule || [])
        .concat(groups.issues || []);
    window._example2SearchActionItems = items;
    return items;
}

function navigateToProjectFile(item) {
    const urn = item?.urn || item?.raw?.urn || item?.raw?.versionId || '';
    if (!urn) {
        alert('이 파일의 뷰어 URN을 찾을 수 없습니다.');
        return;
    }
    const title = item.title || item.raw?.displayName || item.raw?.name || '프로젝트 파일';
    if (typeof window.switchTab === 'function') window.switchTab('project');
    setTimeout(() => {
        if (window.explorer && typeof window.explorer.loadIntoViewer === 'function') {
            window.explorer.loadIntoViewer(urn, title);
        } else if (typeof window.onModelSelected === 'function') {
            window.onModelSelected(urn);
        } else if (typeof window.loadModel === 'function') {
            const viewer = window.myGlobalViewer || window.viewer || window.NOP_VIEWER;
            window.loadModel(viewer, urn);
        }
    }, 250);
}

function closeExample2CctvPopup() {
    const video = document.getElementById('example2-cctv-video');
    if (video && video._example2Hls) {
        video._example2Hls.destroy();
        video._example2Hls = null;
    }
    const modal = document.getElementById('example2-cctv-popup');
    if (modal) modal.remove();
}

function openCctvPopup(item) {
    closeExample2CctvPopup();
    const title = item?.title || 'CCTV';
    const streamUrl = item?.url || item?.raw?.streamUrl || '';
    const pageUrl = item?.pageUrl || item?.raw?.pageUrl || '';
    const img = item?.img || item?.raw?.img || '';
    const proxyUrl = streamUrl && typeof window.getPathProxyUrl === 'function'
        ? window.getPathProxyUrl(streamUrl)
        : streamUrl;

    document.body.insertAdjacentHTML('beforeend', `
        <div id="example2-cctv-popup" style="position:fixed; inset:0; z-index:40000; display:flex; align-items:center; justify-content:center; padding:24px; background:rgba(2,6,23,0.72); backdrop-filter:blur(6px);">
            <div style="width:min(860px,94vw); max-height:88vh; display:flex; flex-direction:column; overflow:hidden; border:1px solid rgba(148,163,184,0.24); border-radius:10px; background:#0f172a; color:#e5eefb; box-shadow:0 28px 70px rgba(0,0,0,0.5);">
                <div style="height:44px; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:0 14px; border-bottom:1px solid rgba(148,163,184,0.22);">
                    <div style="min-width:0; display:flex; align-items:center; gap:8px; color:#f8fafc; font-size:14px; font-weight:950; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                        <i class="fas fa-video" style="color:#60a5fa;"></i>${escapeHtml(title)}
                    </div>
                    <button id="example2-cctv-close" type="button" style="width:32px; height:32px; border:1px solid rgba(148,163,184,0.24); border-radius:6px; background:rgba(15,23,42,0.86); color:#cbd5e1; cursor:pointer;"><i class="fas fa-times"></i></button>
                </div>
                <div style="height:min(56vh,480px); background:#020617; position:relative;">
                    ${proxyUrl ? `<video id="example2-cctv-video" controls autoplay muted playsinline poster="${escapeHtml(img)}" style="width:100%; height:100%; object-fit:contain; background:#000;"></video>` :
                        (pageUrl ? `<iframe src="${escapeHtml(pageUrl)}" title="${escapeHtml(title)}" style="width:100%; height:100%; border:0; background:#020617;"></iframe>` :
                            '<div style="height:100%; display:flex; align-items:center; justify-content:center; color:#94a3b8; font-size:13px; font-weight:800;">연결 가능한 CCTV 스트림이 없습니다.</div>')}
                </div>
            </div>
        </div>
    `);

    document.getElementById('example2-cctv-close').onclick = closeExample2CctvPopup;
    document.getElementById('example2-cctv-popup').addEventListener('click', event => {
        if (event.target.id === 'example2-cctv-popup') closeExample2CctvPopup();
    });

    const video = document.getElementById('example2-cctv-video');
    if (!video || !proxyUrl) return;
    if (typeof window.Hls !== 'undefined' && window.Hls.isSupported()) {
        const hls = new window.Hls({ enableWorker: true, lowLatencyMode: true });
        hls.loadSource(proxyUrl);
        hls.attachMedia(video);
        hls.on(window.Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
        video._example2Hls = hls;
    } else {
        video.src = proxyUrl;
        video.play().catch(() => {});
    }
}

function openIssueSearchDetail(item) {
    const issue = item?.issue || item?.raw || item;
    if (typeof window.openFormaIssueDetail === 'function') {
        window.openFormaIssueDetail(issue);
        return;
    }
    document.body.insertAdjacentHTML('beforeend', `
        <div id="example2-issue-popup" style="position:fixed; inset:0; z-index:40000; display:flex; align-items:center; justify-content:center; padding:24px; background:rgba(2,6,23,0.72);">
            <div style="width:min(680px,94vw); max-height:82vh; overflow:auto; border:1px solid rgba(148,163,184,0.24); border-radius:10px; background:#0f172a; color:#e5eefb; box-shadow:0 28px 70px rgba(0,0,0,0.5);">
                <div style="display:flex; justify-content:space-between; gap:12px; padding:18px 20px; border-bottom:1px solid rgba(148,163,184,0.2);">
                    <div>
                        <div style="color:#7dd3fc; font-size:12px; font-weight:900;">이슈 상세</div>
                        <div style="margin-top:6px; color:#f8fafc; font-size:18px; font-weight:950;">${escapeHtml(item?.title || issue?.title || '제목 없음')}</div>
                    </div>
                    <button onclick="document.getElementById('example2-issue-popup').remove()" type="button" style="width:32px; height:32px; border:1px solid rgba(148,163,184,0.24); border-radius:6px; background:rgba(15,23,42,0.86); color:#cbd5e1; cursor:pointer;"><i class="fas fa-times"></i></button>
                </div>
                <div style="padding:18px 20px; color:#cbd5e1; font-size:13px; line-height:1.7;">
                    <div><strong>구분:</strong> ${escapeHtml(issue?.categoryLabel || issue?.typePath || '-')}</div>
                    <div><strong>위치:</strong> ${escapeHtml(issue?.location || '-')}</div>
                    <div><strong>담당자:</strong> ${escapeHtml(issue?.assignee || '-')}</div>
                    <div><strong>상태:</strong> ${escapeHtml(issue?.statusLabel || issue?.status || '-')}</div>
                    <div style="margin-top:12px;">${escapeHtml(issue?.description || issue?.desc || '등록된 설명이 없습니다.')}</div>
                </div>
            </div>
        </div>
    `);
}

function handleSearchResultClick(event) {
    const target = event.target.closest('[data-search-action]');
    if (!target) return;
    const index = Number(target.dataset.index);
    const item = (window._example2SearchActionItems || [])[index];
    if (!item) return;
    const action = target.dataset.searchAction || getSearchActionType(item);
    if (action === 'model' || action === 'doc') navigateToProjectFile(item);
    if (action === 'cctv') openCctvPopup(item);
    if (action === 'issue') openIssueSearchDetail(item);
}

function renderCategoryResultList(items, emptyText, color) {
    if (!searchState.query.trim()) {
        return `<div style="height:100%; display:flex; align-items:center; justify-content:center; text-align:center; color:#64748b; font-size:11px; font-weight:800; line-height:1.45;">검색어를 입력하면<br>관련 결과가 표시됩니다.</div>`;
    }
    if (!items.length) {
        return `<div style="height:100%; display:flex; align-items:center; justify-content:center; text-align:center; color:#64748b; font-size:11px; font-weight:800;">${escapeHtml(emptyText)}</div>`;
    }
    return `
        <div style="height:100%; min-height:0; display:flex; flex-direction:column; gap:6px; overflow-y:auto; overflow-x:hidden; padding-right:2px;">
            ${items.map(item => `
                <button type="button" data-search-action="${escapeHtml(getSearchActionType(item))}" data-index="${(window._example2SearchActionItems || []).indexOf(item)}" style="width:100%; min-width:0; text-align:left; border:1px solid rgba(${color},0.18); border-radius:6px; background:rgba(2,6,23,0.28); padding:6px 8px; cursor:pointer;">
                    <div style="color:#f8fafc; font-size:11px; font-weight:950; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(item.title || '')}">${escapeHtml(item.title || '이름 없음')}</div>
                    <div style="margin-top:3px; color:#94a3b8; font-size:10px; font-weight:750; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(item.subtitle || '')}">${escapeHtml(item.subtitle || '-')}</div>
                </button>
            `).join('')}
        </div>
    `;
}

function renderSearchTile({ title, icon, color, items, emptyText }) {
    const border = `rgba(${color},0.36)`;
    const bg = searchState.query.trim()
        ? `linear-gradient(135deg, rgba(${color},0.12), rgba(2,6,23,0.30))`
        : 'rgba(2,6,23,0.26)';
    return `
        <div style="min-width:0; height:100%; min-height:0; border:1px solid ${searchState.query.trim() ? border : 'rgba(148,163,184,0.14)'}; border-radius:8px; background:${bg}; padding:9px; display:flex; flex-direction:column; gap:7px; overflow:hidden;">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; color:rgb(${color}); font-size:11px; font-weight:950;">
                <span style="display:flex; align-items:center; gap:6px;"><i class="fas ${icon}"></i> ${escapeHtml(title)}</span>
                <span style="color:#94a3b8;">${items.length}건</span>
            </div>
            <div style="flex:1; min-height:0; overflow:hidden;">${renderCategoryResultList(items, emptyText, color)}</div>
        </div>
    `;
}

function renderSearchSummary(groups) {
    const rows = [
        ['BIM 모델', groups.models.length, '56,189,248', 'fa-cube'],
        ['도면/문서', groups.docs.length, '167,139,250', 'fa-file-lines'],
        ['CCTV', groups.cctv.length, '96,165,250', 'fa-video'],
        ['공사일정', groups.schedule.length, '245,158,11', 'fa-person-digging'],
        ['이슈', groups.issues.length, '244,114,182', 'fa-circle-exclamation']
    ];
    const total = rows.reduce((sum, row) => sum + row[1], 0);
    return `
        <div style="min-width:0; height:100%; min-height:0; border:1px solid rgba(148,163,184,0.20); border-radius:8px; background:linear-gradient(135deg, rgba(15,23,42,0.82), rgba(2,6,23,0.34)); padding:9px; display:flex; flex-direction:column; gap:7px; overflow:hidden;">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; color:#cbd5e1; font-size:11px; font-weight:950;">
                <span style="display:flex; align-items:center; gap:6px;"><i class="fas fa-chart-simple" style="color:#94a3b8;"></i> 검색 결과 요약</span>
                <span style="color:#f8fafc;">${total}건</span>
            </div>
            <div style="display:flex; flex-direction:column; gap:5px; min-height:0; overflow:auto;">
                ${rows.map(([label, count, color, icon]) => `
                    <div style="display:grid; grid-template-columns:18px minmax(0,1fr) 36px; gap:7px; align-items:center; color:#cbd5e1; font-size:11px; font-weight:850;">
                        <i class="fas ${icon}" style="color:rgb(${color}); text-align:center;"></i>
                        <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(label)}</span>
                        <span style="text-align:right; color:#f8fafc;">${count}건</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function renderSearchTiles(groups) {
    const tiles = [
        {
            filter: 'model',
            title: 'BIM 모델',
            icon: 'fa-cube',
            color: '56,189,248',
            items: groups.models,
            emptyText: '관련 BIM 모델 없음'
        },
        {
            filter: 'doc',
            title: '도면/문서',
            icon: 'fa-file-lines',
            color: '167,139,250',
            items: groups.docs,
            emptyText: '관련 도면/문서 없음'
        },
        {
            filter: 'cctv',
            title: 'CCTV',
            icon: 'fa-video',
            color: '96,165,250',
            items: groups.cctv,
            emptyText: '관련 CCTV 결과 없음'
        },
        {
            filter: 'schedule',
            title: '공사일정',
            icon: 'fa-person-digging',
            color: '245,158,11',
            items: groups.schedule,
            emptyText: '관련 공사일정 없음'
        },
        {
            filter: 'issue',
            title: '이슈',
            icon: 'fa-circle-exclamation',
            color: '244,114,182',
            items: groups.issues,
            emptyText: '관련 이슈 없음'
        }
    ];
    const visibleTiles = searchState.filter === 'all'
        ? tiles
        : tiles.filter(tile => tile.filter === searchState.filter);
    const columns = searchState.filter === 'all' ? 'repeat(3,minmax(0,1fr))' : 'minmax(0,1fr)';
    const rows = searchState.filter === 'all' ? 'repeat(2,minmax(0,1fr))' : 'minmax(0,1fr)';
    return `
        <div style="height:100%; min-height:0; display:grid; grid-template-columns:${columns}; grid-template-rows:${rows}; gap:8px;">
            ${visibleTiles.map(tile => renderSearchTile(tile)).join('')}
            ${searchState.filter === 'all' ? renderSearchSummary(groups) : ''}
        </div>
    `;
}

function renderProjectSearchPanel() {
    const root = document.getElementById('example2-project-search');
    if (!root) return;
    root.style.display = 'block';
    root.style.alignItems = '';
    root.style.justifyContent = '';
    root.style.width = '100%';
    root.style.height = '100%';
    root.style.overflow = 'hidden';
    const activeId = document.activeElement?.id || '';
    const selectionStart = activeId === 'example2-search-input'
        ? document.activeElement.selectionStart
        : null;
    const groups = getProjectSearchGroups();
    setSearchActionItems(groups);
    const visibleCategoryCount = groups.models.length + groups.docs.length + groups.cctv.length + groups.schedule.length + groups.issues.length;
    const projectFileCount = projectSearchState.files.length;
    const cctvCount = cctvSearchState.channels.length;
    const sourceText = projectSearchState.loading
        ? '프로젝트 파일 검색 중'
        : projectSearchState.source === 'project-search-files'
            ? '<강북정수장 증설공사 BIM 용역> 프로젝트 파일 검색'
            : projectSearchState.source === 'model-tree-fallback'
                ? '<강북정수장 증설공사 BIM 용역> 모델 트리 기반 검색'
                : '프로젝트 파일 검색 대기';
    const filters = [
        ['all', '전체'],
        ['model', 'BIM 모델'],
        ['doc', '도면/문서'],
        ['cctv', 'CCTV'],
        ['schedule', '공사일정'],
        ['issue', '이슈']
    ];
    root.innerHTML = `
        <div style="height:100%; min-height:0; display:flex; flex-direction:column; border:1px solid rgba(148,163,184,0.18); border-radius:8px; background:linear-gradient(180deg, rgba(15,23,42,0.92), rgba(10,16,28,0.96)); overflow:hidden;">
            <div style="height:40px; display:flex; align-items:center; justify-content:space-between; gap:10px; padding:0 14px; color:#f8fafc; border-bottom:1px solid rgba(148,163,184,0.14);">
                <span style="font-size:16px; font-weight:950;">프로젝트 통합 검색</span>
                <span style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#64748b; font-size:11px; font-weight:800;" title="${escapeHtml(sourceText)}">${escapeHtml(sourceText)}</span>
            </div>
            <div style="padding:10px 14px 8px; display:flex; flex-direction:column; gap:9px; min-height:0; flex:1;">
                <div style="display:flex; height:38px; border:1px solid rgba(148,163,184,0.38); border-radius:7px; background:#020617; overflow:hidden;">
                    <input id="example2-search-input" type="search" value="${escapeHtml(searchState.query)}" style="flex:1; min-width:0; border:0; outline:none; background:transparent; color:#f8fafc; padding:0 12px; font-size:14px; font-weight:800;">
                    <button id="example2-search-button" type="button" title="검색" style="width:52px; border:0; border-left:1px solid rgba(148,163,184,0.20); background:#111827; color:#7dd3fc; font-size:18px; cursor:pointer;"><i class="fas fa-search"></i></button>
                </div>
                <div style="display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:8px;">
                    ${filters.map(([value, label]) => `
                        <button type="button" class="example2-search-filter" data-filter="${value}" style="height:32px; border:1px solid ${searchState.filter === value ? 'rgba(125,211,252,0.45)' : 'rgba(148,163,184,0.18)'}; border-radius:6px; background:${searchState.filter === value ? 'rgba(14,165,233,0.14)' : 'rgba(15,23,42,0.62)'}; color:${searchState.filter === value ? '#e0f2fe' : '#cbd5e1'}; font-size:12px; font-weight:900; cursor:pointer;">${escapeHtml(label)}</button>
                    `).join('')}
                </div>
                <div style="flex:1; min-height:0; overflow:hidden;">
                    ${projectSearchState.loading || cctvSearchState.loading ? '<div style="height:100%; display:flex; align-items:center; justify-content:center; color:#94a3b8; font-size:12px; font-weight:800;">프로젝트 검색 대상을 불러오는 중입니다.</div>' : ''}
                    ${!projectSearchState.loading && !cctvSearchState.loading ? renderSearchTiles(groups) : ''}
                </div>
                <div style="height:26px; display:flex; align-items:center; justify-content:space-between; padding:0 10px; border-radius:999px; background:rgba(148,163,184,0.08); color:#64748b; font-size:11px; font-weight:800;">
                    <span><i class="fas fa-folder-tree"></i> 프로젝트 파일 ${projectFileCount}건 · CCTV ${cctvCount}건 · 이슈 ${(scheduleState.tasks || []).length}건</span>
                    <span>표시 ${visibleCategoryCount}건</span>
                </div>
            </div>
        </div>
    `;

    const input = document.getElementById('example2-search-input');
    if (input) {
        input.addEventListener('compositionstart', () => {
            searchState.isComposing = true;
        });
        input.addEventListener('compositionend', () => {
            searchState.isComposing = false;
            searchState.query = input.value || '';
            renderProjectSearchPanel();
        });
        input.oninput = event => {
            searchState.query = input.value || '';
            if (searchState.isComposing || event.isComposing) return;
            renderProjectSearchPanel();
        };
        if (activeId === 'example2-search-input') {
            input.focus();
            if (selectionStart != null) input.setSelectionRange(selectionStart, selectionStart);
        }
    }
    document.querySelectorAll('.example2-search-filter').forEach(btn => {
        btn.onclick = () => {
            searchState.filter = btn.dataset.filter || 'all';
            renderProjectSearchPanel();
        };
    });
    root.querySelectorAll('[data-search-action]').forEach(btn => {
        btn.onclick = handleSearchResultClick;
    });
}

function renderSchedule() {
    const root = document.getElementById('example2-work-schedule');
    if (!root) return;

    const activeId = document.activeElement?.id || '';
    const selectionStart = document.activeElement && document.activeElement.id === 'example2-schedule-search'
        ? document.activeElement.selectionStart
        : null;

    if (scheduleState.loading) {
        root.innerHTML = '<div style="height:100%; display:flex; align-items:center; justify-content:center; color:#94a3b8; font-weight:800;">업무 일정을 불러오는 중입니다.</div>';
        return;
    }
    if (scheduleState.error) {
        root.innerHTML = `<div style="height:100%; display:flex; align-items:center; justify-content:center; color:#fca5a5; font-weight:800;">${escapeHtml(scheduleState.error)}</div>`;
        return;
    }

    const baseFiltered = getBaseFilteredTasks();
    const filtered = getFilteredTasks(baseFiltered);
    const availableMonths = getScheduleMonthOptions(scheduleState.tasks);
    const monthOptions = availableMonths.map(month => `<option value="${escapeHtml(month)}">${escapeHtml(formatMonthLabel(month))}</option>`).join('');
    const cacheLabel = scheduleState.cacheTs
        ? `마지막 동기화: ${new Date(scheduleState.cacheTs).toLocaleString('ko-KR')}${scheduleState.refreshing ? ' · 최신화 중' : ''}`
        : (scheduleState.refreshing ? '최신화 중' : '');

    root.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:12px; height:100%; min-height:0; padding:14px;">
            <div style="display:flex; justify-content:space-between; align-items:center; min-height:18px; color:#94a3b8; font-size:11px; font-weight:800;">
                <span>건화 제외 전체 Forma 이슈 기반 업무 일정</span>
                <span>${escapeHtml(cacheLabel)}</span>
            </div>
            <div style="display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px;">${renderKpis(filtered)}</div>
            ${renderMonthlyGantt(filtered)}
            <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                <select id="example2-schedule-month-preset" style="height:32px; background:#0f172a; color:#e5e7eb; border:1px solid rgba(148,163,184,0.28); border-radius:6px; padding:0 9px; font-weight:800;">
                    ${monthOptions || `<option value="${escapeHtml(scheduleState.month)}">${escapeHtml(formatMonthLabel(scheduleState.month))}</option>`}
                </select>
                <select id="example2-schedule-status" style="height:32px; background:#0f172a; color:#e5e7eb; border:1px solid rgba(148,163,184,0.28); border-radius:6px; padding:0 9px; font-weight:800;">
                    <option value="all">전체 상태</option>
                    <option value="active">진행중</option>
                    <option value="planned">계획</option>
                    <option value="done">완료</option>
                    <option value="delayed">지연</option>
                </select>
                <input id="example2-schedule-search" type="search" placeholder="제목, 담당자, 위치 검색" value="${escapeHtml(scheduleState.query)}" style="height:32px; flex:1; min-width:180px; background:#0f172a; color:#e5e7eb; border:1px solid rgba(148,163,184,0.28); border-radius:6px; padding:0 10px; font-size:12px;">
                <button id="example2-schedule-refresh" type="button" title="새로고침" style="height:32px; width:34px; border-radius:6px; border:1px solid rgba(56,189,248,0.32); background:rgba(56,189,248,0.12); color:#7dd3fc; cursor:pointer;"><i class="fas fa-sync-alt"></i></button>
            </div>
            <div style="flex:1; min-height:0; overflow-y:auto; overflow-x:hidden; border:1px solid rgba(148,163,184,0.16); border-radius:7px; background:rgba(15,23,42,0.78);">
                <table style="width:100%; border-collapse:collapse; table-layout:fixed;">
                    <thead style="position:sticky; top:0; z-index:1; background:#111827;">
                        <tr style="border-bottom:1px solid rgba(148,163,184,0.24);">
                            <th style="width:92px; padding:7px 6px; text-align:center; color:#94a3b8; font-size:10px; font-weight:900; white-space:nowrap;">${renderScheduleColumnFilter('categoryLabel', '구분', baseFiltered)}</th>
                            <th style="width:128px; padding:7px 8px; text-align:left; color:#94a3b8; font-size:10px; font-weight:900; white-space:nowrap;">${renderScheduleColumnFilter('location', '구조물', baseFiltered)}</th>
                            <th style="padding:9px 8px; text-align:left; color:#94a3b8; font-size:10px; font-weight:900; white-space:nowrap;">제목</th>
                            <th style="width:154px; padding:9px 8px; text-align:left; color:#94a3b8; font-size:10px; font-weight:900; white-space:nowrap;">수행 기간</th>
                            <th style="width:96px; padding:7px 8px; text-align:left; color:#94a3b8; font-size:10px; font-weight:900; white-space:nowrap;">${renderScheduleColumnFilter('assignee', '담당자', baseFiltered)}</th>
                            <th style="width:78px; padding:7px 6px; text-align:center; color:#94a3b8; font-size:10px; font-weight:900; white-space:nowrap;">${renderScheduleColumnFilter('statusLabel', '상태', baseFiltered)}</th>
                        </tr>
                    </thead>
                    <tbody>${renderTaskRows(filtered)}</tbody>
                </table>
            </div>
        </div>
    `;



    const monthPreset = document.getElementById('example2-schedule-month-preset');
    if (monthPreset) {
        monthPreset.value = scheduleState.month || getDefaultMonth(scheduleState.tasks);
        monthPreset.onchange = () => {
            scheduleState.month = monthPreset.value || '';
            resetScheduleColumnFilters();
            renderSchedule();
        };
    }

    const status = document.getElementById('example2-schedule-status');
    if (status) {
        status.value = scheduleState.status;
        status.onchange = () => {
            scheduleState.status = status.value || 'all';
            resetScheduleColumnFilters();
            renderSchedule();
        };
    }

    const search = document.getElementById('example2-schedule-search');
    if (search) {
        search.addEventListener('compositionstart', () => {
            search.dataset.isComposing = 'true';
        });
        search.addEventListener('compositionend', () => {
            search.dataset.isComposing = 'false';
            scheduleState.query = search.value || '';
            resetScheduleColumnFilters();
            renderSchedule();
        });
        search.oninput = (e) => {
            scheduleState.query = search.value || '';
            if (search.dataset.isComposing !== 'true' && (!e || !e.isComposing)) {
                resetScheduleColumnFilters();
                renderSchedule();
            }
        };
    }

    root.querySelectorAll('.example2-schedule-column-filter').forEach(select => {
        select.onchange = event => {
            event.preventDefault();
            event.stopPropagation();
            const key = select.dataset.filterKey;
            if (!scheduleState.columnFilters) resetScheduleColumnFilters();
            scheduleState.columnFilters[key] = select.value || '';
            renderSchedule();
        };
    });

    const refresh = document.getElementById('example2-schedule-refresh');
    if (refresh) refresh.onclick = () => loadSchedule(true);

    root.querySelectorAll('[data-schedule-task-id]').forEach(el => {
        el.onclick = event => {
            event.preventDefault();
            event.stopPropagation();
            openScheduleTaskDetailById(el.dataset.scheduleTaskId);
        };
    });

    if (activeId === 'example2-schedule-search') {
        const nextSearch = document.getElementById('example2-schedule-search');
        if (nextSearch) {
            nextSearch.focus();
            if (selectionStart != null) nextSearch.setSelectionRange(selectionStart, selectionStart);
        }
    }
    renderProjectSearchPanel();
}

async function loadSchedule(force = false) {
    if (scheduleState.loading) return;
    if (scheduleState.loaded && !force) {
        renderSchedule();
        if (shouldRefreshSchedule(scheduleState.cacheTs)) {
            refreshScheduleInBackground();
        }
        return;
    }

    if (!force) {
        const cached = readScheduleCache();
        if (cached && cached.tasks.length) {
            applyScheduleTasks(cached.tasks, cached.ts);
            renderSchedule();
            if (shouldRefreshSchedule(cached.ts)) {
                refreshScheduleInBackground();
            }
            return;
        }
    }

    scheduleState.loading = true;
    scheduleState.error = '';
    renderSchedule();
    try {
        const tasks = await fetchScheduleTasks();
        applyScheduleTasks(tasks);
        writeScheduleCache(tasks);
    } catch (err) {
        scheduleState.error = `업무 일정을 불러오지 못했습니다. ${err.message}`;
    } finally {
        scheduleState.loading = false;
        renderSchedule();
    }
}

export function initExample2Schedule() {
    loadSchedule(false);
    renderModelUpdatePanel();
    renderProjectSearchPanel();
    loadCctvSearchChannels(false);
    loadModelUpdates(false);
}

window.initExample2Schedule = initExample2Schedule;
