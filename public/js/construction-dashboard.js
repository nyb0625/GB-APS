const STATUS_GROUPS = {
    created: {
        label: '생성',
        color: '#38bdf8',
        statuses: ['초안', '생성', 'draft', 'created', 'create', 'open', 'opened', 'new']
    },
    review: {
        label: '검토',
        color: '#a78bfa',
        statuses: ['진행 중', '진행중', '답변완료', '검토 중', '검토중', '반려', '협의필요', 'inprogress', 'in progress', 'answered', 'review', 'inreview', 'rejected']
    },
    delayed: {
        label: '지연',
        color: '#f59e0b',
        statuses: ['지연', 'overdue', 'delayed', 'late']
    },
    closed: {
        label: '종료',
        color: '#10b981',
        statuses: ['종료', 'closed', 'close', 'ended', 'completed', 'complete', 'done']
    }
};

const GROUP_ORDER = ['created', 'review', 'closed'];
const STATUS_MATCH_ORDER = ['created', 'review', 'delayed', 'closed'];
const monthlyIssueChartMode = 'bar'; // Change to 'dumbbell' to preview the dumbbell monthly chart.
const MONTHLY_ISSUE_START_MONTH = '2026-04';
const MONTHLY_ISSUE_END_MONTH = '2026-12';
let clashStructureChart = null;
const monthlyIssueDrilldownState = { location: '', month: '' };
const dashboardIssueRegistry = new Map();
const CONSTRUCTION_PROGRESS_ITEMS = [
    { id: 'priority-01', zone: 'priority', name: '가설공사', progress: 100, status: '완료', startDate: '2026-07-01', endDate: '2026-07-07', color: '#eab308' },
    { id: 'priority-02', zone: 'priority', name: '안전/환경관리', progress: 100, status: '완료', startDate: '2026-07-01', endDate: '2026-07-31', color: '#eab308' },
    { id: 'priority-03', zone: 'priority', name: '불수성 연결공로', progress: 80, status: '진행중', startDate: '2026-07-08', endDate: '2026-08-08', color: '#eab308' },
    { id: 'priority-04', zone: 'priority', name: '철보/전기/계측설비', progress: 35, status: '진행중', startDate: '2026-08-01', endDate: '2026-08-20', color: '#eab308' },
    { id: 'main-01', zone: 'extension', name: '인허가', progress: 100, status: '완료', startDate: '2026-07-01', endDate: '2026-07-08', color: '#06b6d4' },
    { id: 'main-02', zone: 'extension', name: '흙막이 가시설', progress: 100, status: '완료', startDate: '2026-07-03', endDate: '2026-07-21', color: '#06b6d4' },
    { id: 'main-03', zone: 'extension', name: '착수정 및 혼화지', progress: 90, status: '진행중', startDate: '2026-07-15', endDate: '2026-08-05', color: '#06b6d4' },
    { id: 'main-04', zone: 'extension', name: '정수지(수조부)', progress: 75, status: '진행중', startDate: '2026-07-22', endDate: '2026-08-18', color: '#06b6d4' },
    { id: 'main-05', zone: 'extension', name: '정수지(펌프실)', progress: 70, status: '진행중', startDate: '2026-07-26', endDate: '2026-08-22', color: '#06b6d4' },
    { id: 'main-06', zone: 'extension', name: '역세척펌프동', progress: 55, status: '진행중', startDate: '2026-08-01', endDate: '2026-08-29', color: '#06b6d4' },
    { id: 'main-07', zone: 'extension', name: '응집침전지 #1~#3', progress: 60, status: '진행중', startDate: '2026-08-04', endDate: '2026-09-02', color: '#06b6d4' },
    { id: 'main-08', zone: 'extension', name: '응집침전지 #4~#6', progress: 45, status: '진행중', startDate: '2026-08-08', endDate: '2026-09-08', color: '#06b6d4' },
    { id: 'main-09', zone: 'extension', name: '약품투입동', progress: 35, status: '진행중', startDate: '2026-08-14', endDate: '2026-09-12', color: '#06b6d4' },
    { id: 'main-10', zone: 'extension', name: '구내배관', progress: 30, status: '진행중', startDate: '2026-08-18', endDate: '2026-09-18', color: '#06b6d4' },
    { id: 'main-11', zone: 'extension', name: '토수관로', progress: 25, status: '진행중', startDate: '2026-08-22', endDate: '2026-09-20', color: '#06b6d4' },
    { id: 'main-12', zone: 'extension', name: '활성탄흡착지', progress: 20, status: '진행중', startDate: '2026-08-28', endDate: '2026-09-25', color: '#06b6d4' },
    { id: 'main-13', zone: 'extension', name: '활성탄흡착지동', progress: 15, status: '진행중', startDate: '2026-09-01', endDate: '2026-09-28', color: '#06b6d4' },
    { id: 'main-14', zone: 'extension', name: '후오존접촉지', progress: 10, status: '진행중', startDate: '2026-09-05', endDate: '2026-10-01', color: '#06b6d4' },
    { id: 'main-15', zone: 'extension', name: '후오존접촉지동', progress: 5, status: '진행중', startDate: '2026-09-08', endDate: '2026-10-04', color: '#06b6d4' },
    { id: 'main-16', zone: 'extension', name: '급속여과지', progress: 0, status: '예정', startDate: '2026-09-10', endDate: '2026-10-06', color: '#06b6d4' },
    { id: 'main-17', zone: 'extension', name: '급속여과지동', progress: 0, status: '예정', startDate: '2026-09-12', endDate: '2026-10-08', color: '#06b6d4' },
    { id: 'main-18', zone: 'extension', name: '염차농축조', progress: 0, status: '예정', startDate: '2026-09-15', endDate: '2026-10-10', color: '#06b6d4' },
    { id: 'main-19', zone: 'extension', name: '기계설치/계측제어', progress: 0, status: '예정', startDate: '2026-09-18', endDate: '2026-10-13', color: '#06b6d4' },
    { id: 'main-20', zone: 'extension', name: '접지공사, 전기설비', progress: 0, status: '예정', startDate: '2026-09-22', endDate: '2026-10-16', color: '#06b6d4' },
    { id: 'main-21', zone: 'extension', name: '탈수기동', progress: 0, status: '예정', startDate: '2026-09-25', endDate: '2026-10-19', color: '#06b6d4' },
    { id: 'main-22', zone: 'extension', name: '우오수/포장/조경시설물', progress: 0, status: '예정', startDate: '2026-10-01', endDate: '2026-10-24', color: '#06b6d4' },
    { id: 'main-23', zone: 'extension', name: '종합시운전', progress: 0, status: '예정', startDate: '2026-10-10', endDate: '2026-10-31', color: '#06b6d4' }
];
const CONSTRUCTION_ZONES = {
    new: { label: '신설', color: '#ef4444' },
    extension: { label: '본공사', color: '#06b6d4' },
    priority: { label: '우선시공분', color: '#eab308' }
};
const CONSTRUCTION_ZONE_FOLDER_KEYWORDS = {
    new: ['신설', '신설구조물', '신설 구조물'],
    extension: ['본공사', '증설', '증설구조물', '증설 구조물'],
    priority: ['우선시공', '우선시공분', '우선 시공', '가시설']
};
const CONSTRUCTION_TARGET_HUB_ID = 'b.4efd43ab-93fa-4448-918b-091d81dbfd75';
const CONSTRUCTION_TARGET_PROJECT_ID = 'b.374bde3a-83a3-4dd5-80c2-2e01ddeac719';
const CONSTRUCTION_VIEW_STATE_PREFIX = 'gangbuk_construction_progress_view_';
const CONSTRUCTION_LIVE_MAPS = {
    new: {
        label: '신설 구조물',
        src: '/images/construction-live-new.png?v=20260824-live3',
        alt: '강북정수장 신설 구조물 영역도'
    },
    extension: {
        label: '증설 구조물',
        src: '/images/construction-live-extension.png?v=20260824-live1',
        alt: '강북정수장 증설 구조물 영역도'
    },
    priority: {
        label: '우선 시공분',
        src: '/images/construction-live-priority.png?v=20260824-live1',
        alt: '강북정수장 우선 시공분 영역도'
    }
};
const CONSTRUCTION_SCHEDULE_DATA_URL = '/data/construction-schedule.json?v=20260824-schedule1';
let constructionProgressItems = CONSTRUCTION_PROGRESS_ITEMS.slice();
const CONSTRUCTION_STRUCTURE_MODEL_ALIASES = {
    '착수정': ['착수정', '착수', 'intake'],
    '약품투입동': ['약품투입동', '약품', '투입동', 'chemical'],
    '급속여과지': ['급속여과지', '급속여과', '여과지', 'filter'],
    '후오존접촉지': ['후오존접촉지', '후오존', '오존접촉지', 'ozone'],
    '응집침전지': ['응집침전지', '응집침전', '침전지', 'sedimentation'],
    '역세척펌프동': ['역세척펌프동', '역세척', '펌프동', 'backwash'],
    '정수지': ['정수지', 'clearwell'],
    '활성탄흡착지': ['활성탄흡착지', '활성탄', '흡착지', 'carbon']
};
const CONSTRUCTION_LIVE_STRUCTURES = Object.keys(CONSTRUCTION_STRUCTURE_MODEL_ALIASES);

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function readArrayFromStorage(key) {
    try {
        const parsed = JSON.parse(localStorage.getItem(key) || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        return [];
    }
}

function getIssueKey(issue) {
    return String(issue && (issue.id || issue.displayId || issue.dbId || issue.title) || '');
}

function normalizeText(value) {
    return String(value || '').trim();
}

function displayValue(value) {
    if (value == null) return '';
    if (typeof value === 'string' || typeof value === 'number') return normalizeText(value);
    if (Array.isArray(value)) return value.map(displayValue).filter(Boolean).join(', ');
    if (typeof value === 'object') {
        return normalizeText(
            value.displayValue ||
            value.display_value ||
            value.value ||
            value.name ||
            value.title ||
            value.label ||
            value.text ||
            value.id
        );
    }
    return normalizeText(value);
}

function collectCustomAttributes(source) {
    if (!source || typeof source !== 'object') return [];
    const attrs = source.attributes && typeof source.attributes === 'object' ? source.attributes : {};
    return []
        .concat(Array.isArray(source.customAttributes) ? source.customAttributes : [])
        .concat(Array.isArray(source.custom_attributes) ? source.custom_attributes : [])
        .concat(Array.isArray(attrs.customAttributes) ? attrs.customAttributes : [])
        .concat(Array.isArray(attrs.custom_attributes) ? attrs.custom_attributes : []);
}

function findCustomAttributeValue(source, labels) {
    const labelSet = labels.map(label => String(label).trim().toLowerCase());
    const customAttrs = collectCustomAttributes(source);
    for (const attr of customAttrs) {
        if (!attr || typeof attr !== 'object') continue;
        const names = [
            attr.title,
            attr.name,
            attr.label,
            attr.displayName,
            attr.display_name,
            attr.attributeDefinitionName,
            attr.attribute_definition_name,
            attr.key,
            attr.id
        ].map(value => String(value || '').trim().toLowerCase()).filter(Boolean);
        if (!names.some(name => labelSet.includes(name))) continue;
        const value = displayValue(
            attr.displayValue ||
            attr.display_value ||
            attr.value ||
            attr.values ||
            attr.text ||
            attr.nameValue
        );
        if (value) return value;
    }
    return '';
}

function getIssuePlacementValue(issue) {
    const raw = issue.rawFormaIssue || {};
    const rawAttrs = raw.attributes && typeof raw.attributes === 'object' ? raw.attributes : {};
    return normalizeText(
        issue.placement ||
        issue.placementName ||
        issue.file ||
        issue.fileName ||
        issue.documentName ||
        issue.modelName ||
        findCustomAttributeValue(issue, ['배치', 'Placement', '파일', '파일명', '모델', '모델명']) ||
        findCustomAttributeValue(raw, ['배치', 'Placement', '파일', '파일명', '모델', '모델명']) ||
        raw.placement ||
        raw.placementName ||
        raw.file ||
        raw.fileName ||
        raw.documentName ||
        raw.modelName ||
        rawAttrs.placement ||
        rawAttrs.placementName ||
        rawAttrs.file ||
        rawAttrs.fileName ||
        rawAttrs.documentName ||
        rawAttrs.modelName
    );
}

function getStructureFromPlacement(placement) {
    let name = normalizeText(placement);
    if (!name) return '';

    name = name
        .replace(/\.(rvt|ifc|nwc|nwd|dwg|3dm|zip)$/i, '')
        .replace(/\s*\([^)]*\)\s*$/g, '')
        .replace(/\s+v\d+$/i, '')
        .trim();

    const parts = name.split(/[_/\\]+/).map(part => part.trim()).filter(Boolean);
    if (!parts.length) return '';

    const tradeCodes = new Set([
        'C', 'A', 'AS', 'AM', 'E', 'M', 'S', 'L', 'T',
        '토목', '건축', '건축구조', '건축설비', '전기', '기계',
        '철근', '철근배근', '배근', '가설', '콘크리트', '마감'
    ]);
    if (parts.length > 1 && tradeCodes.has(parts[parts.length - 1].toUpperCase())) {
        parts.pop();
    }

    const last = parts[parts.length - 1] || '';
    const number = parts.length > 1 && /^\d+$/.test(parts[parts.length - 2]) ? parts[parts.length - 2] : '';
    if (number && last && !/^\d+$/.test(last)) return `${number} ${last}`;

    const knownStructure = CONSTRUCTION_LIVE_STRUCTURES.find(structure => name.includes(structure));
    if (knownStructure) return knownStructure;

    if (last && !/^\d+$/.test(last)) return last;

    return parts.slice(-2).join('_') || name;
}

function getFacilityBaseName(facility) {
    return normalizeText(facility).replace(/^\d+\s+/, '');
}

function getIssueLocation(issue) {
    const raw = issue.rawFormaIssue || {};
    const rawAttrs = raw.attributes && typeof raw.attributes === 'object' ? raw.attributes : {};
    const placementStructure = getStructureFromPlacement(getIssuePlacementValue(issue));
    if (placementStructure) return placementStructure;
    return normalizeText(
        issue.customLocation ||
        findCustomAttributeValue(issue, ['위치', '위치명', '구역', 'Location', 'LBS']) ||
        findCustomAttributeValue(raw, ['위치', '위치명', '구역', 'Location', 'LBS']) ||
        issue.lbsLocationName ||
        issue.locationPath ||
        issue.locationDetails ||
        issue.location_details ||
        issue.locationDescription ||
        issue.location_description ||
        issue.locationName ||
        issue.location_name ||
        raw.lbsLocationName ||
        raw.locationPath ||
        raw.locationDetails ||
        raw.location_details ||
        raw.locationDescription ||
        raw.location_description ||
        raw.locationName ||
        raw.location_name ||
        rawAttrs.locationPath ||
        rawAttrs.locationDetails ||
        rawAttrs.location_details ||
        rawAttrs.locationDescription ||
        rawAttrs.location_description ||
        rawAttrs.locationName ||
        rawAttrs.location_name ||
        issue.location ||
        raw.location ||
        rawAttrs.location
    ) || '위치 미지정';
}

function getIssueStatus(issue) {
    return normalizeText(issue.status || issue.statusValue || issue.status_value || issue.state);
}

function getIssueDisplayId(issue) {
    return displayValue(issue.displayId || issue.issueNumber || issue.dbId || issue.id || '-');
}

function getIssueTitle(issue) {
    return displayValue(issue.title || issue.name || issue.subject || issue.summary || issue.description || issue.desc || '제목 없음');
}

function getIssueAssignee(issue) {
    return displayValue(issue.assignee || issue.assignedTo || issue.assigned_to || issue.owner || issue.responsible || '미지정') || '미지정';
}

function getIssueAuthor(issue) {
    const raw = issue && (issue.rawFormaIssue || issue.rawDetailIssue || issue.rawListIssue || issue);
    return displayValue(
        issue.author ||
        issue.creator ||
        issue.createdBy ||
        issue.created_by ||
        issue.reporter ||
        issue.owner ||
        raw?.author ||
        raw?.creator ||
        raw?.createdBy ||
        raw?.created_by ||
        raw?.reporter ||
        raw?.attributes?.author ||
        raw?.attributes?.creator ||
        raw?.attributes?.createdBy ||
        raw?.attributes?.created_by
    ) || getIssueAssignee(issue);
}

function resolveKnownUserName(value) {
    const id = String(value || '').trim();
    if (id === '783606258') return '현대건설';
    if (id.toUpperCase() === '2BTDKKFEB6SF') return '기술연구소(AEC) 박도해';
    return id;
}

function getIssueReviewer(issue) {
    const raw = issue && (issue.rawFormaIssue || issue.rawDetailIssue || issue.rawListIssue || issue);
    const watchers = raw && (raw.watcherObjects || raw.watchers || raw.attributes?.watcherObjects || raw.attributes?.watchers);
    if (Array.isArray(watchers) && watchers.length) {
        const watcher = watchers.find(item => item && (item.name || item.displayName || item.id || item.userId || item.autodeskId || item.email)) || watchers[0];
        if (typeof watcher === 'string') return resolveKnownUserName(watcher) || '미지정';
        return displayValue(watcher.name || watcher.displayName || watcher.fullName || watcher.email) ||
            resolveKnownUserName(watcher.id || watcher.userId || watcher.autodeskId || watcher.accountId || watcher.oxygenId) ||
            '미지정';
    }
    return resolveKnownUserName(issue.reviewer || issue.verifier || issue.reviewedBy || '') || '미지정';
}

function getIssueDescription(issue) {
    return displayValue(issue.description || issue.desc || issue.reviewContent || issue.changeContent || '');
}

function getStatusGroup(issue) {
    const raw = getIssueStatus(issue);
    const compact = raw.toLowerCase().replace(/[\s_-]+/g, '');

    for (const groupKey of STATUS_MATCH_ORDER) {
        const group = STATUS_GROUPS[groupKey];
        const matched = group.statuses.some(status => {
            const key = String(status).toLowerCase().replace(/[\s_-]+/g, '');
            return compact === key;
        });
        if (matched) return groupKey === 'delayed' ? 'review' : groupKey;
    }

    return 'created';
}

function parseIssueDate(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date;
}

function getIssueStart(issue) {
    return parseIssueDate(issue.startDate || issue.start_date || issue.createdAt || issue.created_at || issue.createdDate || issue.date) || new Date();
}

function getIssueEnd(issue, start) {
    const end = parseIssueDate(issue.dueDate || issue.due_date || issue.endDate || issue.end_date || issue.updatedAt || issue.updated_at);
    if (end && end >= start) return end;
    return start;
}

function getIssuePeriodText(issue) {
    const start = getIssueStart(issue);
    const end = getIssueEnd(issue, start);
    return `${formatShortDate(start)} ~ ${formatShortDate(end)}`;
}

function getIssueDurationDays(issue) {
    const start = getIssueStart(issue);
    const end = getIssueEnd(issue, start);
    return Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000) + 1);
}

function getMonthKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
}

function getMonthLabel(monthKey) {
    const parts = monthKey.split('-');
    return `${parts[0]}.${parts[1]}`;
}

function addMonths(date, count) {
    const next = new Date(date.getFullYear(), date.getMonth() + count, 1);
    next.setHours(0, 0, 0, 0);
    return next;
}

function buildMonthRange(issues) {
    const dates = [];
    issues.forEach(issue => {
        const start = getIssueStart(issue);
        const end = getIssueEnd(issue, start);
        dates.push(end);
    });

    const now = new Date();
    const min = dates.length ? new Date(Math.min(...dates.map(date => date.getTime()))) : now;
    const max = dates.length ? new Date(Math.max(...dates.map(date => date.getTime()))) : now;
    const fixedStart = new Date(Number(MONTHLY_ISSUE_START_MONTH.slice(0, 4)), Number(MONTHLY_ISSUE_START_MONTH.slice(5, 7)) - 1, 1);
    const fixedEnd = new Date(Number(MONTHLY_ISSUE_END_MONTH.slice(0, 4)), Number(MONTHLY_ISSUE_END_MONTH.slice(5, 7)) - 1, 1);
    let cursor = min < fixedStart ? new Date(min.getFullYear(), min.getMonth(), 1) : fixedStart;
    const dataLast = new Date(max.getFullYear(), max.getMonth(), 1);
    const last = dataLast > fixedEnd ? dataLast : fixedEnd;
    const months = [];

    while (cursor <= last && months.length < 18) {
        months.push(getMonthKey(cursor));
        cursor = addMonths(cursor, 1);
    }

    if (!months.length) months.push(getMonthKey(now));
    return months;
}

function issueOverlapsMonth(issue, monthKey) {
    const start = getIssueStart(issue);
    const end = getIssueEnd(issue, start);
    const monthStart = new Date(Number(monthKey.slice(0, 4)), Number(monthKey.slice(5, 7)) - 1, 1);
    const monthEnd = addMonths(monthStart, 1);
    monthEnd.setMilliseconds(-1);
    return start <= monthEnd && end >= monthStart;
}

function issueEndsInMonth(issue, monthKey) {
    const start = getIssueStart(issue);
    return getMonthKey(getIssueEnd(issue, start)) === monthKey;
}

function mergeIssues(lists) {
    const seen = new Set();
    const merged = [];
    lists.flat().forEach(issue => {
        if (!issue) return;
        if (!isVisibleIssueForMainTabs(issue)) return;
        const key = getIssueKey(issue);
        if (!key || seen.has(key)) return;
        seen.add(key);
        dashboardIssueRegistry.set(key, issue);
        merged.push(issue);
    });
    return merged;
}

function isVisibleIssueForMainTabs(issue) {
    const typeText = String(issue && (issue.typePath || issue.type || issue.category || '') || '');
    return typeText.indexOf('\uAC74\uD654') === -1;
}

async function loadIssues() {
    // 🚨 [강력 규제] 오직 '이슈' 탭의 Single Source of Truth(window._gangbukFormaSSOT)만 사용
    const ssot = window._gangbukFormaSSOT || window._gangbukFormaCache;
    if (Array.isArray(ssot) && ssot.length) {
        const filtered = ssot.filter(isVisibleIssueForMainTabs);
        return mergeIssues([filtered]);
    }

    let formaIssues = [];
    try {
        if (typeof window.loadFormaIssuesForMainTab === 'function') {
            formaIssues = await window.loadFormaIssuesForMainTab(false);
        } else {
            const resp = await fetch('/api/issues/forma-gangbuk?limit=500', { credentials: 'same-origin' });
            if (resp.ok) {
                const json = await resp.json();
                formaIssues = Array.isArray(json.data) ? json.data : [];
            }
        }
        formaIssues = (Array.isArray(formaIssues) ? formaIssues : []).filter(isVisibleIssueForMainTabs);
        window._gangbukFormaSSOT = formaIssues;
        window._gangbukFormaCache = formaIssues;
        return mergeIssues([formaIssues]);
    } catch (err) {
        console.warn('[Construction BIM Dashboard] Forma issue fetch failed:', err);
    }
    return [];
}

window._monthlyIssueActiveSubTab = 'status';
window._monthlyIssueGroupFilter = 'all';
window._monthlyIssueExpandedGroups = window._monthlyIssueExpandedGroups || {};
window._monthlyIssueMapMode = window._monthlyIssueMapMode || 'overview';
window._monthlyIssueSelectedMonth = window._monthlyIssueSelectedMonth || '';
window._monthlyIssueViewerTarget = window._monthlyIssueViewerTarget || null;

const MONTHLY_ISSUE_STRUCTURE_GROUPS = [
    { key: 'all', label: '전체', title: '전체 구조물' },
    { key: 'temporary', label: '가시설', title: '가시설' },
    { key: 'new', label: '신설', title: '신설 구조물' },
    { key: 'extension', label: '증설', title: '증설 구조물' },
    { key: 'etc', label: '기타', title: '기타 구조물' }
];
const MONTHLY_ISSUE_MATRIX_BASELINE_ROWS = 15;
const MONTHLY_ISSUE_MATRIX_BODY_HEIGHT = 360;
const MONTHLY_ISSUE_MAP_IMAGES = {
    overview: '/images/monthly-issue-map-overview.png?v=20260827-map1',
    hover: '/images/monthly-issue-map-hover.png?v=20260827-map1',
    new: '/images/monthly-issue-map-new.png?v=20260827-map1',
    extension: '/images/monthly-issue-map-extension.png?v=20260827-map1'
};
const MONTHLY_ISSUE_MAP_ZONE_HOTSPOTS = [
    { groupKey: 'new', label: '신설', x: 31, y: 25, w: 25, h: 42, mode: 'new' },
    { groupKey: 'new', label: '신설', x: 29, y: 81, w: 9, h: 12, mode: 'new' },
    { groupKey: 'temporary', label: '가시설', x: 25, y: 59, w: 18, h: 29, zone: 'priority' },
    { groupKey: 'extension', label: '증설', x: 49, y: 82, w: 32, h: 22, mode: 'extension' },
    { groupKey: 'etc', label: '기타', x: 95, y: 91, w: 8, h: 8, zone: 'new' }
];
const MONTHLY_ISSUE_MAP_POSITIONS = {
    new: {
        '09약품투입동': { x: 50, y: 11 },
        '01착수정': { x: 61, y: 16 },
        '03급속여과지': { x: 36, y: 25 },
        '06역세척펌프동': { x: 22, y: 40 },
        '04후오존접촉지': { x: 36, y: 47 },
        '02응집침전지': { x: 50, y: 52 },
        '07정수지': { x: 23, y: 63 },
        '05활성탄흡착지': { x: 36, y: 66 },
        '08일차농축조': { x: 79, y: 64 },
        '10공동구': { x: 84, y: 11 },
        '11유량계실': { x: 84, y: 18 },
        '12밸브실': { x: 84, y: 25 },
        '13구내배관': { x: 94, y: 11 },
        '14기타': { x: 94, y: 18 },
        '00대지': { x: 94, y: 25 }
    },
    extension: {
        '06공급설비': { x: 91, y: 13 },
        '04염소투입동': { x: 84, y: 41 },
        '05배출수지': { x: 26, y: 54 },
        '01송수펌프실': { x: 57, y: 66 },
        '02탈수기동': { x: 10, y: 77 },
        '03GIS실': { x: 49, y: 88 }
    }
};
const MONTHLY_ISSUE_MAP_STRUCTURE_LABELS = {
    new: [
        '09 약품투입동',
        '01 착수정',
        '03 급속여과지',
        '06 역세척펌프동',
        '04 후오존접촉지',
        '02 응집침전지',
        '07 정수지',
        '05 활성탄흡착지',
        '08 일차농축조',
        '10 공동구',
        '11 유량계실',
        '12 밸브실',
        '13 구내배관',
        '14 기타',
        '00 대지'
    ],
    extension: [
        '06 공급설비',
        '04 염소투입동',
        '05 배출수지',
        '01 송수펌프실',
        '02 탈수기동',
        '03 GIS실'
    ]
};

function getMonthlyIssueStructureNumber(location) {
    const match = String(location || '').trim().match(/^(\d{1,2})\b/);
    return match ? parseInt(match[1], 10) : null;
}

function getMonthlyIssueStructureGroup(location, issue = null) {
    const text = `${getIssuePlacementValue(issue || {})} ${location || ''}`.toLowerCase();
    if (text.includes('가시설')) return 'temporary';
    if (text.includes('증설')) return 'extension';
    if (text.includes('신설')) return 'new';
    if (text.includes('기타')) return 'etc';

    const number = getMonthlyIssueStructureNumber(location);
    if (number !== null) {
        if (number <= 2) return 'temporary';
        if (number <= 16) return 'new';
        if (number <= 23) return 'extension';
    }

    return 'etc';
}

function getMonthlyIssueStructureGroupMeta(groupKey) {
    return MONTHLY_ISSUE_STRUCTURE_GROUPS.find(group => group.key === groupKey) || MONTHLY_ISSUE_STRUCTURE_GROUPS[0];
}

function getMonthlyIssueStructureLabelKey(label) {
    return normalizeText(label).replace(/\s+/g, '');
}

function createEmptyMonthlyIssueRow(location, groupKey, months, groupBy = 'status') {
    const monthBuckets = new Map();
    months.forEach(month => monthBuckets.set(month, createMonthlyIssueBucket(groupBy)));
    return {
        location,
        groupKey,
        total: 0,
        closed: 0,
        months: monthBuckets
    };
}

function addMonthlyIssueBaselineRows(rows, months, groupBy = 'status') {
    const baselineByGroup = {
        new: MONTHLY_ISSUE_MAP_STRUCTURE_LABELS.new || []
    };

    Object.entries(baselineByGroup).forEach(([groupKey, labels]) => {
        labels.forEach(label => {
            const labelKey = getMonthlyIssueStructureLabelKey(label);
            const existing = Array.from(rows.values()).find(row => {
                return row.groupKey === groupKey && getMonthlyIssueStructureLabelKey(row.location) === labelKey;
            });
            if (existing) {
                existing.location = label;
                months.forEach(month => {
                    if (!existing.months.has(month)) existing.months.set(month, createMonthlyIssueBucket(groupBy));
                });
                return;
            }
            rows.set(`${groupKey}:${label}`, createEmptyMonthlyIssueRow(label, groupKey, months, groupBy));
        });
    });
}

function createMonthlyIssueBucket(groupBy = 'status') {
    const bucket = {
        total: 0,
        active: { total: 0 },
        ended: { total: 0 }
    };
    const keys = groupBy === 'status' ? GROUP_ORDER : ['clash', 'design', 'work'];
    keys.forEach(key => {
        bucket[key] = 0;
        bucket.active[key] = 0;
        bucket.ended[key] = 0;
    });
    return bucket;
}

function mergeMonthlyIssueBucket(target, source, groupBy = 'status') {
    if (!source) return target;
    const keys = groupBy === 'status' ? GROUP_ORDER : ['clash', 'design', 'work'];
    target.total += source.total || 0;
    target.active.total += source.active?.total || 0;
    target.ended.total += source.ended?.total || 0;
    keys.forEach(key => {
        target[key] += source[key] || 0;
        target.active[key] += source.active?.[key] || 0;
        target.ended[key] += source.ended?.[key] || 0;
    });
    return target;
}

function getIssueTypeKey(issue) {
    const t = getIssueTypeText(issue).toLowerCase();
    if (t.includes('간섭') || t.includes('clash')) return 'clash';
    if (t.includes('설계') || t.includes('design')) return 'design';
    return 'work';
}

function summarizeByLocationAndMonth(issues, months, groupBy = 'status') {
    const rows = new Map();

    issues.forEach(issue => {
        const location = getIssueLocation(issue);
        const groupKey = getMonthlyIssueStructureGroup(location, issue);
        const rowKey = `${groupKey}:${location}`;
        const group = groupBy === 'status' ? getStatusGroup(issue) : getIssueTypeKey(issue);
        const endMonth = getMonthKey(getIssueEnd(issue, getIssueStart(issue)));
        if (!rows.has(rowKey)) {
            rows.set(rowKey, {
                location,
                groupKey,
                total: 0,
                closed: 0,
                months: new Map()
            });
        }

        const row = rows.get(rowKey);
        row.total += 1;
        
        const statusGroup = getStatusGroup(issue);
        if (statusGroup === 'closed') row.closed += 1;

        months.forEach(monthKey => {
            if (!issueEndsInMonth(issue, monthKey)) return;
            if (!row.months.has(monthKey)) {
                const bucket = {
                    total: 0,
                    active: { total: 0 },
                    ended: { total: 0 }
                };
                if (groupBy === 'status') {
                    GROUP_ORDER.forEach(k => {
                        bucket[k] = 0;
                        bucket.active[k] = 0;
                        bucket.ended[k] = 0;
                    });
                } else {
                    ['clash', 'design', 'work'].forEach(k => {
                        bucket[k] = 0;
                        bucket.active[k] = 0;
                        bucket.ended[k] = 0;
                    });
                }
                row.months.set(monthKey, bucket);
            }
            const bucket = row.months.get(monthKey);
            bucket.active[group] = (bucket.active[group] || 0) + 1;
            bucket.active.total += 1;
            if (monthKey === endMonth) {
                bucket.ended[group] = (bucket.ended[group] || 0) + 1;
                bucket.ended.total += 1;
                bucket[group] = (bucket[group] || 0) + 1;
                bucket.total += 1;
            }
        });
    });

    addMonthlyIssueBaselineRows(rows, months, groupBy);
    return Array.from(rows.values()).sort((a, b) => b.total - a.total || a.location.localeCompare(b.location, 'ko'));
}

function summarizeMonthlyIssueRowsForDisplay(rows, months, groupBy = 'status') {
    const groupFilter = window._monthlyIssueGroupFilter || 'all';
    const expanded = window._monthlyIssueExpandedGroups || {};
    const grouped = new Map();

    rows.forEach(row => {
        const groupKey = row.groupKey || getMonthlyIssueStructureGroup(row.location);
        if (groupFilter !== 'all' && groupKey !== groupFilter) return;
        if (!grouped.has(groupKey)) {
            const meta = getMonthlyIssueStructureGroupMeta(groupKey);
            grouped.set(groupKey, {
                key: groupKey,
                label: meta.title,
                total: 0,
                closed: 0,
                count: 0,
                months: new Map(),
                children: []
            });
        }
        const group = grouped.get(groupKey);
        group.total += row.total || 0;
        group.closed += row.closed || 0;
        group.count += 1;
        group.children.push({ ...row, groupKey, isGroup: false });
        months.forEach(month => {
            if (!group.months.has(month)) group.months.set(month, createMonthlyIssueBucket(groupBy));
            mergeMonthlyIssueBucket(group.months.get(month), row.months.get(month), groupBy);
        });
    });

    const orderedKeys = groupFilter === 'all'
        ? MONTHLY_ISSUE_STRUCTURE_GROUPS.filter(group => group.key !== 'all').map(group => group.key)
        : [groupFilter];

    return orderedKeys.flatMap(groupKey => {
        const group = grouped.get(groupKey);
        if (!group) return [];
        group.children.sort((a, b) => {
            const aNo = getMonthlyIssueStructureNumber(a.location) ?? 9999;
            const bNo = getMonthlyIssueStructureNumber(b.location) ?? 9999;
            return aNo - bNo || a.location.localeCompare(b.location, 'ko');
        });
        const groupRow = {
            location: group.label,
            groupKey,
            isGroup: true,
            total: group.total,
            closed: group.closed,
            count: group.count,
            months: group.months
        };
        if (groupFilter === 'all' && !expanded[groupKey]) return [groupRow];
        return [groupRow, ...group.children];
    });
}

function renderGantt(issues) {
    const wrap = document.getElementById('bim-issue-gantt-wrap');
    const total = document.getElementById('bim-dashboard-issue-total');
    if (total) total.textContent = `이슈 ${issues.length}건`;
    window._constructionIssueCache = issues;
    if (!wrap) return;

    if (!issues.length) {
        wrap.innerHTML = '<div class="bim-db-placeholder">표시할 이슈 데이터가 없습니다.</div>';
        return;
    }

    const months = buildMonthRange(issues);
    const rows = summarizeByLocationAndMonth(issues, months);
    const monthWidth = Math.max(62, Math.floor(540 / Math.max(months.length, 1)));
    const chartStyle = `--bim-month-count:${months.length}; --bim-month-width:${monthWidth}px;`;

    const yAxis = rows.map(row => {
        const progress = row.total ? Math.round((row.closed / row.total) * 100) : 0;
        return `
            <div class="bim-chart-yitem bim-chart-clickable" data-location="${escapeHtml(row.location)}" title="${escapeHtml(row.location)} 이슈 목록 보기">
                <div class="bim-structure-name" title="${escapeHtml(row.location)}">${escapeHtml(row.location)}</div>
            </div>
        `;
    }).join('');

    const plot = rows.map(row => {
        const cells = months.map(month => renderChartCell(row.months.get(month), row.location, month)).join('');
        return `<div class="bim-chart-row">${cells}</div>`;
    }).join('');

    const selectedMonth = window._monthlyIssueSelectedMonth || '';
    const xAxis = months.map(month => `<button type="button" class="bim-chart-month monthly-issue-month-button${selectedMonth === month ? ' active' : ''}" data-month="${escapeHtml(month)}" title="${escapeHtml(`${getMonthLabel(month)} 이슈 목록 보기`)}">${getMonthLabel(month)}</button>`).join('');

    wrap.innerHTML = `
        ${renderStatusLegend()}
        <div class="bim-chart" style="${chartStyle}">
            <div class="bim-chart-yaxis">${yAxis}</div>
            <div class="bim-chart-plot">${plot}</div>
            <div class="bim-chart-xaxis-spacer"></div>
            <div class="bim-chart-xaxis">${xAxis}</div>
        </div>
    `;
}

function renderStatusLegend(groupBy = 'status', actionsHtml = '', titleHtml = '') {
    const title = titleHtml ? `<div class="bim-chart-legend-title">${titleHtml}</div>` : '';
    const actions = actionsHtml ? `<div class="bim-chart-legend-actions">${actionsHtml}</div>` : '';
    if (monthlyIssueChartMode === 'dumbbell') {
        return `
            <div class="bim-chart-legend" aria-label="덤벨 차트 범례">
                ${title}
                <span class="bim-chart-legend-item"><span class="bim-chart-legend-dot start"></span><span>시작 이슈</span></span>
                <span class="bim-chart-legend-item"><span class="bim-chart-legend-dot end"></span><span>종료 이슈</span></span>
                <span class="bim-chart-legend-item"><span class="bim-chart-legend-line"></span><span>활성 기간</span></span>
                ${actions}
            </div>
        `;
    }
    
    if (groupBy === 'type') {
        const TYPE_GROUPS = {
            clash: { label: '간섭이슈', color: '#00f2fe' },
            design: { label: '설계이슈', color: '#8b5cf6' },
            work: { label: '업데이트 항목', color: '#f59e0b' }
        };
        const TYPE_ORDER = ['clash', 'design', 'work'];
        const items = TYPE_ORDER.map(groupKey => {
            const group = TYPE_GROUPS[groupKey];
            return `
                <span class="bim-chart-legend-item" title="${escapeHtml(group.label)}">
                    <span class="bim-chart-legend-swatch" style="background:${group.color};"></span>
                    <span>${escapeHtml(group.label)}</span>
                </span>
            `;
        }).join('');

        return `<div class="bim-chart-legend" aria-label="이슈 유형 색상 범례">${title}${items}${actions}</div>`;
    }

    const items = GROUP_ORDER.map(groupKey => {
        const group = STATUS_GROUPS[groupKey];
        return `
            <span class="bim-chart-legend-item" title="${escapeHtml(group.label)} 상태 이슈">
                <span class="bim-chart-legend-swatch" style="background:${group.color};"></span>
                <span>${escapeHtml(group.label)}</span>
            </span>
        `;
    }).join('');

    return `<div class="bim-chart-legend" aria-label="이슈 상태 색상 범례">${title}${items}${actions}</div>`;
}

function renderChartCell(bucket, location = '', month = '', groupBy = 'status') {
    if (monthlyIssueChartMode === 'dumbbell') {
        return renderDumbbellChartCell(bucket, location, month);
    }
    const isMonthActive = !!month && window._monthlyIssueSelectedMonth === month;
    const isStartMonth = month === MONTHLY_ISSUE_START_MONTH;
    const cellClass = `bim-chart-cell${isMonthActive ? ' monthly-issue-cell-active' : ''}${isStartMonth ? ' monthly-issue-start-cell' : ''}`;
    const active = bucket && bucket.active ? bucket.active : bucket;
    const ended = bucket && bucket.ended ? bucket.ended : bucket;
    if (!active || !active.total) {
        return `<div class="${cellClass}" data-month="${escapeHtml(month)}"><div class="bim-chart-empty"></div></div>`;
    }

    let segments = '';
    let label = '';

    if (groupBy === 'status') {
        label = GROUP_ORDER
            .map(groupKey => {
                const activeCount = active[groupKey] || 0;
                const endedCount = ended[groupKey] || 0;
                if (!activeCount) return '';
                return `${STATUS_GROUPS[groupKey].label} 활성 ${activeCount}건${endedCount ? ` · 종료 ${endedCount}건` : ''}`;
            })
            .filter(Boolean)
            .join(' · ');

        segments = GROUP_ORDER.map(groupKey => {
            const activeCount = active[groupKey] || 0;
            const endedCount = ended[groupKey] || 0;
            if (!activeCount) return '';
            const group = STATUS_GROUPS[groupKey];
            const width = Math.max(3, (activeCount / active.total) * 100);
            const segmentClass = endedCount ? 'bim-chart-seg' : 'bim-chart-seg bim-chart-seg-continuing';
            const segmentText = endedCount ? String(endedCount) : '';
            return `<div class="${segmentClass}" title="${escapeHtml(`${group.label} 활성 ${activeCount}건${endedCount ? ` · 종료 ${endedCount}건` : ' · 진행 중'}`)}" style="width:${width}%; background:${group.color};">${segmentText}</div>`;
        }).join('');
    } else {
        const TYPE_GROUPS = {
            clash: { label: '간섭이슈', color: '#00f2fe' },
            design: { label: '설계이슈', color: '#8b5cf6' },
            work: { label: '업데이트 항목', color: '#f59e0b' }
        };
        const TYPE_ORDER = ['clash', 'design', 'work'];

        label = TYPE_ORDER
            .map(groupKey => {
                const activeCount = active[groupKey] || 0;
                const endedCount = ended[groupKey] || 0;
                if (!activeCount) return '';
                return `${TYPE_GROUPS[groupKey].label} 활성 ${activeCount}건${endedCount ? ` · 종료 ${endedCount}건` : ''}`;
            })
            .filter(Boolean)
            .join(' · ');

        segments = TYPE_ORDER.map(groupKey => {
            const activeCount = active[groupKey] || 0;
            const endedCount = ended[groupKey] || 0;
            if (!activeCount) return '';
            const group = TYPE_GROUPS[groupKey];
            const width = Math.max(3, (activeCount / active.total) * 100);
            const segmentClass = endedCount ? 'bim-chart-seg' : 'bim-chart-seg bim-chart-seg-continuing';
            const segmentText = endedCount ? String(endedCount) : '';
            return `<div class="${segmentClass}" title="${escapeHtml(`${group.label} 활성 ${activeCount}건${endedCount ? ` · 종료 ${endedCount}건` : ' · 진행 중'}`)}" style="width:${width}%; background:${group.color};">${segmentText}</div>`;
        }).join('');
    }

    return `
        <div class="${cellClass} bim-chart-clickable" data-location="${escapeHtml(location)}" data-month="${escapeHtml(month)}" title="${escapeHtml(`${getMonthLabel(month)} · ${location} · ${label}`)}">
            <div class="bim-chart-bar">${segments}</div>
        </div>
    `;
}

function renderDumbbellChartCell(bucket, location = '', month = '') {
    const active = bucket && bucket.active ? bucket.active : bucket;
    const started = bucket && bucket.started ? bucket.started : { total: 0 };
    const ended = bucket && bucket.ended ? bucket.ended : { total: 0 };
    if (!active || !active.total) {
        return '<div class="bim-chart-cell bim-dumbbell-cell"><div class="bim-chart-empty"></div></div>';
    }

    const label = [
        `활성 ${active.total}건`,
        started.total ? `시작 ${started.total}건` : '',
        ended.total ? `종료 ${ended.total}건` : ''
    ].filter(Boolean).join(' · ');

    const startDot = started.total ? `
        <span class="bim-dumbbell-dot start" title="${escapeHtml(`시작 ${started.total}건`)}">${started.total}</span>
    ` : '<span class="bim-dumbbell-dot-spacer"></span>';
    const endDot = ended.total ? `
        <span class="bim-dumbbell-dot end" title="${escapeHtml(`종료 ${ended.total}건`)}">${ended.total}</span>
    ` : '<span class="bim-dumbbell-dot-spacer"></span>';

    return `
        <div class="bim-chart-cell bim-chart-clickable bim-dumbbell-cell" data-location="${escapeHtml(location)}" data-month="${escapeHtml(month)}" title="${escapeHtml(`${getMonthLabel(month)} · ${location} · ${label}`)}">
            <div class="bim-dumbbell-track ${started.total || ended.total ? '' : 'continuing'}">
                ${startDot}
                <span class="bim-dumbbell-line" aria-hidden="true"></span>
                ${endDot}
            </div>
        </div>
    `;
}

function getIssuesForStructure(location, month = '') {
    const issues = Array.isArray(window._constructionIssueCache) ? window._constructionIssueCache : [];
    return issues.filter(issue => {
        if (getIssueLocation(issue) !== location) return false;
        return month ? issueEndsInMonth(issue, month) : true;
    });
}

function getClashIssuesForStructure(location) {
    const issues = Array.isArray(window._constructionIssueCache) ? window._constructionIssueCache : [];
    return issues.filter(issue => getIssueLocation(issue) === location && isClashIssue(issue));
}

function openClashStructureIssueModal(location) {
    if (!location) return;
    const issues = getClashIssuesForStructure(location);
    openMonthlyIssueListModal(`${location} 간섭 목록`, issues);
}

function getIssuesForMonth(month = '') {
    const issues = Array.isArray(window._constructionIssueCache) ? window._constructionIssueCache : [];
    return month ? issues.filter(issue => issueEndsInMonth(issue, month)) : issues.slice();
}

function renderStructureIssueList(issues, emptyMessage) {
    const sorted = issues.slice().sort((a, b) => {
        return getIssueStart(b).getTime() - getIssueStart(a).getTime() ||
            getIssueTitle(a).localeCompare(getIssueTitle(b), 'ko');
    });
    if (!sorted.length) {
        return `<div class="bim-db-placeholder">${escapeHtml(emptyMessage || '표시할 이슈가 없습니다.')}</div>`;
    }

    const rows = sorted.map(issue => {
        const issueKey = getIssueKey(issue);
        const rawId = issue.id || issue.displayId || issue.dbId || issueKey;
        const groupKey = getStatusGroup(issue);
        const group = STATUS_GROUPS[groupKey] || STATUS_GROUPS.created;
        const desc = getIssueDescription(issue);
        return `
            <tr class="bim-structure-issue-row" data-issue-key="${escapeHtml(issueKey)}" title="이슈 상세 정보 보기">
                <td>${escapeHtml(getIssueDisplayId(issue))}</td>
                <td class="bim-structure-issue-title" title="${escapeHtml(desc || getIssueTitle(issue))}">${escapeHtml(getIssueTitle(issue))}</td>
                <td><span class="bim-status-pill" style="color:${group.color};">${escapeHtml(getIssueStatus(issue) || group.label)}</span></td>
                <td>${escapeHtml(getIssueTypeText(issue) || '이슈')}</td>
                <td>${escapeHtml(formatShortDate(getIssueStart(issue)))}</td>
                <td>${escapeHtml(formatShortDate(getIssueEnd(issue, getIssueStart(issue))))}</td>
                <td>${escapeHtml(getIssueAssignee(issue))}</td>
                <td>
                    <button class="btn-view-3d" data-issue-id="${escapeHtml(rawId)}" style="padding: 4px 8px; font-size: 12px; cursor: pointer; background: transparent; border: 1px solid #4dc4ff; color: #4dc4ff; border-radius: 4px;">🔍 3D 뷰어로 위치 보기</button>
                </td>
            </tr>
        `;
    }).join('');

    return `
        <table class="bim-structure-issue-table">
            <thead>
                <tr>
                    <th style="width:96px;">ID</th>
                    <th>제목</th>
                    <th style="width:92px;">상태</th>
                    <th style="width:130px;">유형</th>
                    <th style="width:92px;">시작일</th>
                    <th style="width:92px;">마감일</th>
                    <th style="width:90px;">담당자</th>
                    <th style="width:140px;">3D 위치</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
}

function bindStructureIssueListEvents(container, issues) {
    if (!container) return;
    issues.forEach(issue => {
        const key = getIssueKey(issue);
        if (key) {
            dashboardIssueRegistry.set(key, issue);
        }
    });

    if (container.dataset.structureIssueEventsBound) {
        return;
    }
    container.dataset.structureIssueEventsBound = 'true';

    container.addEventListener('click', (event) => {
        const btn3d = event.target.closest('.btn-view-3d');
        if (btn3d) {
            event.preventDefault();
            event.stopPropagation();

            const targetIssueId = btn3d.getAttribute('data-issue-id');
            console.log("🚀 3D 뷰어 이동 트리거 - 이슈 ID: ", targetIssueId);

            // ── 이슈 객체 탐색: 행의 data-issue-key → registry 순으로 조회 ──
            const row = btn3d.closest('.bim-structure-issue-row');
            const rowKey = row ? row.getAttribute('data-issue-key') : null;
            const issue = (rowKey && dashboardIssueRegistry.get(rowKey))
                || (targetIssueId && dashboardIssueRegistry.get(targetIssueId));

            if (!issue) {
                console.warn('[btn-view-3d] 이슈 객체를 찾을 수 없습니다. ID:', targetIssueId);
                return;
            }

            if (typeof window.closeIssueViewerPopups === 'function') {
                window.closeIssueViewerPopups();
            }
            if (typeof window.showIssueViewerLoading === 'function') {
                window.showIssueViewerLoading('3D 모델 준비 중', '월간 이슈 위치로 이동할 모델을 찾고 있습니다.');
            }

            // ── 월간 이슈 모달 및 이슈 상세 모달 닫기 ──
            const modal = container.closest('.bim-timeline-modal') || document.getElementById('bim-timeline-modal');
            if (modal) {
                modal.style.display = 'none';
                modal.setAttribute('aria-hidden', 'true');
            }
            const detailModal = document.getElementById('forma-issue-detail-modal');
            if (detailModal && detailModal.parentNode) {
                detailModal.parentNode.removeChild(detailModal);
            }

            // ── URN 비동기 해석 후 focusIssueOnViewer 단 1회 호출 (중복 팝업 방지 및 URN 유실 방지) ──
            (async () => {
                let targetUrn = '';
                if (typeof window.resolveFormaIssueViewerUrn === 'function') {
                    targetUrn = await window.resolveFormaIssueViewerUrn(issue);
                }
                if (typeof window.focusIssueOnViewer === 'function') {
                    window.focusIssueOnViewer(issue, targetUrn);
                } else if (typeof window.openFormaIssueDetail === 'function') {
                    if (typeof window.hideIssueViewerLoading === 'function') window.hideIssueViewerLoading();
                    window.openFormaIssueDetail(issue);
                }
            })();
            return;
        }

        const row = event.target.closest('.bim-structure-issue-row');
        if (row && !event.target.closest('button, a, input, select')) {
            const key = row.getAttribute('data-issue-key') || '';
            const issue = dashboardIssueRegistry.get(key);
            if (!issue) return;
            if (typeof window.openFormaIssueDetail === 'function') {
                window.openFormaIssueDetail(issue);
            } else {
                console.warn('[Construction BIM Dashboard] openFormaIssueDetail is not available.');
                alert('이슈 상세 정보 모듈을 불러오는 중입니다. 잠시 후 다시 시도해 주세요.');
            }
        }
    });
}

async function exportMonthlyIssuesToPdf(issuesToExport) {
    if (!issuesToExport || !issuesToExport.length) {
        alert("내보낼 이슈가 없습니다.");
        return;
    }
    if (typeof window.buildAndOpenBatchPdf !== 'function') {
        try {
            await import('./comparison.js?v=pdf-hide-change-row-20260703-4');
        } catch (err) {
            console.error("[PDF Export] comparison.js 로드 실패:", err);
        }
    }
    
    if (typeof window.buildAndOpenBatchPdf === 'function') {
        var BLANK_1PX = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
        window.buildAndOpenBatchPdf(issuesToExport, BLANK_1PX, BLANK_1PX);
    } else {
        alert("PDF 생성 모듈을 불러올 수 없습니다.");
    }
}

window.exportMonthlyIssueReport = function() {
    const issues = Array.isArray(window._constructionIssueCache) ? window._constructionIssueCache : [];
    const search = document.getElementById('monthly-issue-search')?.value || '';
    const query = String(search || '').trim().toLowerCase();
    const filteredIssues = issues.filter(issue => {
        if (!query) return true;
        return getIssueLocation(issue).toLowerCase().includes(query);
    });
    if (!filteredIssues.length) {
        alert("내보낼 월간 이슈 데이터가 없습니다.");
        return;
    }
    exportMonthlyIssuesToPdf(filteredIssues);
};

function openMonthlyIssueListModal(titleText, issues = []) {
    const modal = document.getElementById('bim-timeline-modal');
    const body = document.getElementById('bim-timeline-modal-body');
    if (!modal || !body) return;
    if (modal.parentElement !== document.body) {
        document.body.appendChild(modal);
    }
    const title = modal.querySelector('.bim-task-dialog-head span');
    if (title) title.textContent = titleText;
    body.innerHTML = `
        <div class="bim-structure-issue-summary">
            <strong>${escapeHtml(titleText)}</strong>
            <span>${issues.length}건</span>
            <button type="button" class="bim-db-refresh monthly-popup-pdf-btn" title="이슈 목록 PDF 내보내기" style="background: rgba(239, 68, 68, 0.15); border-color: rgba(239, 68, 68, 0.38); color: #fca5a5; width: 30px; height: 30px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; border: 1px solid rgba(239, 68, 68, 0.38); outline: none; margin-left: auto; flex-shrink: 0;">
                <i class="fas fa-file-pdf"></i>
            </button>
        </div>
        ${renderStructureIssueList(issues, `${titleText}이 없습니다.`)}
    `;
    bindStructureIssueListEvents(body, issues);
    
    const pdfBtn = body.querySelector('.monthly-popup-pdf-btn');
    if (pdfBtn) {
        pdfBtn.onclick = () => exportMonthlyIssuesToPdf(issues);
    }
    
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
}

function openStructureIssueModal(location, month = '') {
    if (!location) return;
    const modal = document.getElementById('bim-timeline-modal');
    const body = document.getElementById('bim-timeline-modal-body');
    if (!modal || !body) return;
    if (modal.parentElement !== document.body) {
        document.body.appendChild(modal);
    }
    const allIssues = getIssuesForStructure(location);
    const issues = month ? getIssuesForStructure(location, month) : allIssues;
    const months = buildMonthRange(allIssues.length ? allIssues : issues);
    const summary = getStatusSummary(allIssues);
    const completion = summary.total ? Math.round((summary.closed / summary.total) * 100) : 0;
    const monthLabel = month ? `${getMonthLabel(month)} · ` : '';
    const titleText = `${monthLabel}${location} 이슈 목록`;
    const title = modal.querySelector('.bim-task-dialog-head span');
    if (title) title.textContent = titleText;
    body.innerHTML = `
        <div class="monthly-issue-popup-detail">
            <div class="monthly-drilldown-section-head monthly-popup-title-head">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <h3>이슈 상태</h3>
                    <span>${issues.length}건</span>
                </div>
                <button type="button" class="bim-db-refresh monthly-popup-pdf-btn" title="PDF 내보내기" style="background: rgba(239, 68, 68, 0.15); border-color: rgba(239, 68, 68, 0.38); color: #fca5a5; width: 30px; height: 30px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; border: 1px solid rgba(239, 68, 68, 0.38); outline: none; flex-shrink: 0;">
                    <i class="fas fa-file-pdf"></i>
                </button>
            </div>
            <div class="monthly-drilldown-kpis">
                ${renderDrilldownKpi('전체 이슈', summary.total, '#38bdf8')}
                ${renderDrilldownKpi('생성', summary.created, '#38bdf8')}
                ${renderDrilldownKpi('검토', summary.review, '#a78bfa')}
                ${renderDrilldownKpi('종료', summary.closed, '#10b981')}
                ${renderDrilldownKpi('완료율', `${completion}%`, '#10b981')}
            </div>
            <section class="monthly-drilldown-section">
                <div class="monthly-drilldown-section-head">
                    <h3>월별 추이</h3>
                    ${month ? '<button type="button" class="monthly-drilldown-clear-month">전체 보기</button>' : ''}
                </div>
                ${renderMonthlyTrend(location, months, month)}
            </section>
            <section class="monthly-drilldown-section monthly-popup-list-section">
                <div class="monthly-drilldown-section-head">
                    <h3>${month ? `${getMonthLabel(month)} 이슈 목록` : '이슈 목록'}</h3>
                    <span>${issues.length}건</span>
                </div>
                ${renderStructureIssueList(issues, `${titleText}이 없습니다.`)}
            </section>
        </div>
    `;
    bindStructureIssueListEvents(body, issues);
    
    const pdfBtn = body.querySelector('.monthly-popup-pdf-btn');
    if (pdfBtn) {
        pdfBtn.onclick = () => exportMonthlyIssuesToPdf(issues);
    }
    
    body.querySelectorAll('.monthly-drilldown-month[data-drilldown-month]').forEach(button => {
        button.addEventListener('click', () => openStructureIssueModal(location, button.dataset.drilldownMonth || ''));
    });
    const clearMonth = body.querySelector('.monthly-drilldown-clear-month');
    if (clearMonth) clearMonth.addEventListener('click', () => openStructureIssueModal(location, ''));
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
}

function renderMonthStructureSummary(month, issues) {
    const rows = new Map();
    issues.forEach(issue => {
        const location = getIssueLocation(issue);
        if (!rows.has(location)) rows.set(location, { location, total: 0 });
        rows.get(location).total += 1;
    });
    const buttons = Array.from(rows.values())
        .sort((a, b) => b.total - a.total || a.location.localeCompare(b.location, 'ko'))
        .map(row => `
            <button type="button" class="monthly-drilldown-month monthly-popup-structure-filter" data-location="${escapeHtml(row.location)}" data-month="${escapeHtml(month)}" title="${escapeHtml(`${row.location} 이슈 ${row.total}건`)}">
                <span title="${escapeHtml(row.location)}">${escapeHtml(row.location)}</span>
                <strong>${row.total}</strong>
            </button>
        `).join('');
    return `<div class="monthly-drilldown-trend monthly-popup-structure-grid">${buttons || '<div class="monthly-drilldown-empty">표시할 구조물 이슈가 없습니다.</div>'}</div>`;
}

function openMonthIssueModal(month = '') {
    if (!month) return;
    const modal = document.getElementById('bim-timeline-modal');
    const body = document.getElementById('bim-timeline-modal-body');
    if (!modal || !body) return;
    if (modal.parentElement !== document.body) {
        document.body.appendChild(modal);
    }
    const issues = getIssuesForMonth(month);
    const summary = getStatusSummary(issues);
    const completion = summary.total ? Math.round((summary.closed / summary.total) * 100) : 0;
    const titleText = `${getMonthLabel(month)} 이슈 목록`;
    const title = modal.querySelector('.bim-task-dialog-head span');
    if (title) title.textContent = titleText;
    body.innerHTML = `
        <div class="monthly-issue-popup-detail">
            <div class="monthly-drilldown-section-head monthly-popup-title-head">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <h3>이슈 상태</h3>
                    <span>${issues.length}건</span>
                </div>
                <button type="button" class="bim-db-refresh monthly-popup-pdf-btn" title="PDF 내보내기" style="background: rgba(239, 68, 68, 0.15); border-color: rgba(239, 68, 68, 0.38); color: #fca5a5; width: 30px; height: 30px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; border: 1px solid rgba(239, 68, 68, 0.38); outline: none; flex-shrink: 0;">
                    <i class="fas fa-file-pdf"></i>
                </button>
            </div>
            <div class="monthly-drilldown-kpis">
                ${renderDrilldownKpi('전체 이슈', summary.total, '#38bdf8')}
                ${renderDrilldownKpi('생성', summary.created, '#38bdf8')}
                ${renderDrilldownKpi('검토', summary.review, '#a78bfa')}
                ${renderDrilldownKpi('종료', summary.closed, '#10b981')}
                ${renderDrilldownKpi('완료율', `${completion}%`, '#10b981')}
            </div>
            <section class="monthly-drilldown-section">
                <div class="monthly-drilldown-section-head">
                    <h3>구조물별 현황</h3>
                    <span>${escapeHtml(getMonthLabel(month))}</span>
                </div>
                ${renderMonthStructureSummary(month, issues)}
            </section>
            <section class="monthly-drilldown-section monthly-popup-list-section">
                <div class="monthly-drilldown-section-head">
                    <h3>${escapeHtml(titleText)}</h3>
                    <span>${issues.length}건</span>
                </div>
                ${renderStructureIssueList(issues, `${titleText}이 없습니다.`)}
            </section>
        </div>
    `;
    bindStructureIssueListEvents(body, issues);
    
    const pdfBtn = body.querySelector('.monthly-popup-pdf-btn');
    if (pdfBtn) {
        pdfBtn.onclick = () => exportMonthlyIssuesToPdf(issues);
    }
    
    body.querySelectorAll('.monthly-popup-structure-filter[data-location][data-month]').forEach(button => {
        button.addEventListener('click', () => openStructureIssueModal(button.dataset.location || '', button.dataset.month || ''));
    });
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
}

function getStatusSummary(issues) {
    return issues.reduce((acc, issue) => {
        const groupKey = getStatusGroup(issue);
        acc.total += 1;
        acc[groupKey] += 1;
        return acc;
    }, { total: 0, created: 0, review: 0, delayed: 0, closed: 0 });
}

function getTopIssuePeople(issues, getter, limit = 3) {
    const counts = new Map();
    issues.forEach(issue => {
        const name = getter(issue) || '미지정';
        counts.set(name, (counts.get(name) || 0) + 1);
    });
    return Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko'))
        .slice(0, limit);
}

function renderDrilldownKpi(label, value, color) {
    return `
        <div class="monthly-drilldown-kpi" style="--monthly-kpi-color:${color};">
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(value)}</strong>
        </div>
    `;
}

function renderDrilldownPeople(title, rows) {
    const body = rows.length
        ? rows.map(([name, count]) => `
            <div class="monthly-drilldown-person">
                <span title="${escapeHtml(name)}">${escapeHtml(name)}</span>
                <strong>${count}건</strong>
            </div>
        `).join('')
        : '<div class="monthly-drilldown-empty">표시할 담당 정보가 없습니다.</div>';
    return `
        <div class="monthly-drilldown-people">
            <h4>${escapeHtml(title)}</h4>
            ${body}
        </div>
    `;
}

function renderMonthlyTrend(location, months, selectedMonth = '') {
    const buttons = months.map(month => {
        const count = getIssuesForStructure(location, month).length;
        const active = selectedMonth === month ? ' active' : '';
        return `
            <button type="button" class="monthly-drilldown-month${active}" data-drilldown-month="${escapeHtml(month)}" title="${escapeHtml(`${getMonthLabel(month)} 이슈 ${count}건`)}">
                <span>${escapeHtml(getMonthLabel(month))}</span>
                <strong>${count}</strong>
            </button>
        `;
    }).join('');
    return `<div class="monthly-drilldown-trend">${buttons}</div>`;
}

function renderMonthlyIssueDrilldownPanel(location, month, months) {
    if (!location) return '';
    const allIssues = getIssuesForStructure(location);
    const visibleIssues = month ? getIssuesForStructure(location, month) : allIssues;
    const summary = getStatusSummary(allIssues);
    const visibleSummary = getStatusSummary(visibleIssues);
    const completion = summary.total ? Math.round((summary.closed / summary.total) * 100) : 0;
    const title = month ? `${location} · ${getMonthLabel(month)}` : location;
    const assignees = getTopIssuePeople(allIssues, getIssueAssignee);
    const reviewers = getTopIssuePeople(allIssues, getIssueReviewer);

    return `
        <aside class="monthly-issue-drilldown" data-location="${escapeHtml(location)}">
            <div class="monthly-drilldown-head">
                <div>
                    <span>구조물 상세</span>
                    <strong title="${escapeHtml(title)}">${escapeHtml(title)}</strong>
                </div>
                <button type="button" class="bim-icon-btn monthly-drilldown-close" title="닫기" aria-label="닫기">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            <div class="monthly-drilldown-kpis">
                ${renderDrilldownKpi('전체 이슈', summary.total, '#38bdf8')}
                ${renderDrilldownKpi('생성', summary.created, '#38bdf8')}
                ${renderDrilldownKpi('검토', summary.review, '#a78bfa')}
                ${renderDrilldownKpi('종료', summary.closed, '#10b981')}
                ${renderDrilldownKpi('완료율', `${completion}%`, '#10b981')}
            </div>
            <section class="monthly-drilldown-section">
                <div class="monthly-drilldown-section-head">
                    <h3>월별 추이</h3>
                    ${month ? `<button type="button" class="monthly-drilldown-clear-month">전체 보기</button>` : ''}
                </div>
                ${renderMonthlyTrend(location, months, month)}
            </section>
            <section class="monthly-drilldown-section">
                <div class="monthly-drilldown-section-head">
                    <h3>${month ? `${getMonthLabel(month)} 이슈 목록` : '이슈 목록'}</h3>
                    <span>${visibleSummary.total}건</span>
                </div>
                ${renderStructureIssueList(visibleIssues, `${title} 이슈가 없습니다.`)}
            </section>
            <section class="monthly-drilldown-section">
                <div class="monthly-drilldown-people-grid">
                    ${renderDrilldownPeople('주요 담당자', assignees)}
                    ${renderDrilldownPeople('주요 확인자', reviewers)}
                </div>
            </section>
        </aside>
    `;
}

function openMonthlyIssueDrilldown(location, month = '') {
    if (!location) return;
    monthlyIssueDrilldownState.location = location;
    monthlyIssueDrilldownState.month = month || '';
    renderMonthlyIssueStatusTab(Array.isArray(window._constructionIssueCache) ? window._constructionIssueCache : []);
}

function closeMonthlyIssueDrilldown() {
    monthlyIssueDrilldownState.location = '';
    monthlyIssueDrilldownState.month = '';
    renderMonthlyIssueStatusTab(Array.isArray(window._constructionIssueCache) ? window._constructionIssueCache : []);
}

function getMonthlyIssueTabMonth() {
    const input = document.getElementById('monthly-issue-month');
    const value = input && input.value ? input.value : getMonthKey(new Date());
    return /^\d{4}-\d{2}$/.test(value) ? value : getMonthKey(new Date());
}

function getMonthlyIssueRows(issues, monthKey, statusFilter = 'all', search = '') {
    const query = String(search || '').trim().toLowerCase();
    const rows = new Map();
    issues.forEach(issue => {
        if (!issueEndsInMonth(issue, monthKey)) return;
        const groupKey = getStatusGroup(issue);
        if (statusFilter && statusFilter !== 'all' && groupKey !== statusFilter) return;
        const location = getIssueLocation(issue);
        if (query && !String(location || '').toLowerCase().includes(query)) return;

        if (!rows.has(location)) {
            rows.set(location, {
                location,
                total: 0,
                created: 0,
                review: 0,
                delayed: 0,
                closed: 0,
                latest: null,
                issues: []
            });
        }
        const row = rows.get(location);
        row.total += 1;
        row[groupKey] += 1;
        row.issues.push(issue);
        const end = getIssueEnd(issue, getIssueStart(issue));
        if (!row.latest || end > row.latest) row.latest = end;
    });
    return Array.from(rows.values()).sort((a, b) => b.total - a.total || a.location.localeCompare(b.location, 'ko'));
}

function renderMonthlyIssueStatusTableLegacy(issues = []) {
    const root = document.getElementById('monthly-issue-status-root');
    const monthInput = document.getElementById('monthly-issue-month');
    if (!root) return;
    if (monthInput && !monthInput.value) monthInput.value = getMonthKey(new Date());

    const monthKey = getMonthlyIssueTabMonth();
    const statusFilter = document.getElementById('monthly-issue-status-filter')?.value || 'all';
    const search = document.getElementById('monthly-issue-search')?.value || '';
    const rows = getMonthlyIssueRows(issues, monthKey, statusFilter, search);
    const totals = rows.reduce((acc, row) => {
        acc.total += row.total;
        acc.created += row.created;
        acc.review += row.review;
        acc.delayed += row.delayed;
        acc.closed += row.closed;
        return acc;
    }, { total: 0, created: 0, review: 0, delayed: 0, closed: 0 });
    const completion = totals.total ? Math.round((totals.closed / totals.total) * 100) : 0;

    if (!rows.length) {
        root.innerHTML = `
            <div class="monthly-issue-kpis">
                ${renderMonthlyIssueKpi('전체 이슈', totals.total, '#38bdf8')}
                ${renderMonthlyIssueKpi('진행/검토', totals.review, '#a78bfa')}
                ${renderMonthlyIssueKpi('완료율', `${completion}%`, '#10b981')}
            </div>
            <div class="bim-db-placeholder">${escapeHtml(getMonthLabel(monthKey))} 기준으로 표시할 구조물 이슈가 없습니다.</div>
        `;
        return;
    }

    const tableRows = rows.map(row => {
        const progress = row.total ? Math.round((row.closed / row.total) * 100) : 0;
        return `
            <tr class="monthly-issue-row" data-location="${escapeHtml(row.location)}">
                <td>
                    <button type="button" class="monthly-issue-structure" title="${escapeHtml(row.location)} 이슈 목록 보기">${escapeHtml(row.location)}</button>
                </td>
                <td><strong>${row.total}</strong></td>
                <td>${row.created}</td>
                <td>${row.review}</td>
                <td>${row.closed}</td>
                <td>
                    <div class="monthly-issue-progress" title="완료율 ${progress}%">
                        <span style="width:${progress}%;"></span>
                    </div>
                    <em>${progress}%</em>
                </td>
                <td>${escapeHtml(formatShortDate(row.latest))}</td>
                <td><button type="button" class="monthly-issue-open-list">이슈 보기</button></td>
            </tr>
        `;
    }).join('');

    root.innerHTML = `
        <div class="monthly-issue-kpis">
            ${renderMonthlyIssueKpi('전체 이슈', totals.total, '#38bdf8')}
            ${renderMonthlyIssueKpi('진행/검토', totals.review, '#a78bfa')}
            ${renderMonthlyIssueKpi('완료율', `${completion}%`, '#10b981')}
        </div>
        <div class="monthly-issue-table-wrap">
            <table class="monthly-issue-table">
                <thead>
                    <tr>
                        <th>구조물</th>
                        <th>전체</th>
                        <th>생성</th>
                        <th>진행/검토</th>
                        <th>완료</th>
                        <th>완료율</th>
                        <th>최근 변경</th>
                        <th>목록</th>
                    </tr>
                </thead>
                <tbody>${tableRows}</tbody>
            </table>
        </div>
    `;
}

function renderMonthlyIssueKpi(label, value, color, statusKey = '') {
    return `
        <button type="button" class="monthly-issue-kpi" data-status="${escapeHtml(statusKey)}" style="--monthly-kpi-color:${color};" title="${escapeHtml(label)} 이슈 목록 보기">
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(value)}</strong>
        </button>
    `;
}

function getMonthlyIssueMapPositionKey(facility) {
    return normalizeText(facility).replace(/\s+/g, '');
}

function getMonthlyIssueMapRowLookup(rows) {
    const lookup = new Map();
    rows.forEach(row => {
        lookup.set(getMonthlyIssueMapPositionKey(row.facility), row);
    });
    return lookup;
}

function getMonthlyIssueMapMode() {
    const mode = window._monthlyIssueMapMode || 'overview';
    return mode === 'new' || mode === 'extension' ? mode : 'overview';
}

function getMonthlyIssueViewerZoneForGroup(groupKey) {
    if (groupKey === 'temporary') return 'priority';
    if (groupKey === 'extension') return 'extension';
    return 'new';
}

function getMonthlyIssueMapPosition(facility, mode = getMonthlyIssueMapMode()) {
    const key = getMonthlyIssueMapPositionKey(facility);
    const byMode = MONTHLY_ISSUE_MAP_POSITIONS[mode] || {};
    if (byMode[key]) return byMode[key];

    const name = getFacilityBaseName(facility);
    const positions = {
        '착수정': { x: 67, y: 28 },
        '약품투입동': { x: 73, y: 18 },
        '급속여과지': { x: 72, y: 47 },
        '후오존접촉지': { x: 55, y: 54 },
        '응집침전지': { x: 40, y: 30 },
        '역세척펌프동': { x: 22, y: 58 },
        '정수지': { x: 58, y: 76 },
        '활성탄흡착지': { x: 76, y: 72 },
        '공동구': { x: 48, y: 64 }
    };
    if (positions[name]) return positions[name];
    let hash = 0;
    String(facility || '').split('').forEach(char => {
        hash = ((hash << 5) - hash) + char.charCodeAt(0);
        hash |= 0;
    });
    return {
        x: 18 + Math.abs(hash % 64),
        y: 18 + Math.abs((hash >> 3) % 60)
    };
}

function getMonthlyIssueDashboardRows(issues) {
    const rows = new Map();
    issues.forEach(issue => {
        const facility = getIssueLocation(issue);
        const groupKey = getMonthlyIssueStructureGroup(facility, issue);
        const rowKey = `${groupKey}:${facility}`;
        if (!rows.has(rowKey)) rows.set(rowKey, { facility, groupKey, total: 0, issues: [] });
        const row = rows.get(rowKey);
        row.total += 1;
        row.issues.push(issue);
    });
    return Array.from(rows.values()).sort((a, b) => {
        const aNo = parseInt(String(a.facility).match(/^\d+/)?.[0] || '9999', 10);
        const bNo = parseInt(String(b.facility).match(/^\d+/)?.[0] || '9999', 10);
        return aNo - bNo || a.facility.localeCompare(b.facility, 'ko');
    });
}

function renderMonthlyIssueMap(rows, selectedFacility = '') {
    const mode = getMonthlyIssueMapMode();
    const isDetailMode = mode === 'new' || mode === 'extension';
    const viewerTarget = window._monthlyIssueViewerTarget || null;
    const isViewerMode = !!viewerTarget;
    const rowLookup = getMonthlyIssueMapRowLookup(rows);
    const mapRows = isDetailMode
        ? (MONTHLY_ISSUE_MAP_STRUCTURE_LABELS[mode] || []).map(facility => {
            const existing = rowLookup.get(getMonthlyIssueMapPositionKey(facility));
            return existing || { facility, groupKey: mode, total: 0, issues: [] };
        })
        : [];
    const imageSrc = MONTHLY_ISSUE_MAP_IMAGES[mode] || MONTHLY_ISSUE_MAP_IMAGES.overview;
    const markers = mapRows.map(row => {
        const pos = getMonthlyIssueMapPosition(row.facility, mode);
        const active = selectedFacility && selectedFacility === row.facility;
        return `
            <span class="monthly-issue-map-marker-wrap ${active ? 'active' : ''}" style="--marker-x:${pos.x}%; --marker-y:${pos.y}%;">
                <button type="button" class="monthly-issue-map-label monthly-issue-map-marker" data-monthly-facility="${escapeHtml(row.facility)}" data-monthly-map-group="${escapeHtml(row.groupKey)}" title="${escapeHtml(`${row.facility} 3D 뷰어 열기`)}">
                    ${escapeHtml(row.facility)}
                </button>
                <span class="monthly-issue-map-badge ${row.total ? '' : 'is-empty'}" title="${escapeHtml(`${row.facility} 이슈 ${row.total}건`)}">${row.total}</span>
            </span>
        `;
    }).join('');
    const zones = mode === 'overview' ? MONTHLY_ISSUE_MAP_ZONE_HOTSPOTS.map(zone => `
        <button type="button" class="monthly-issue-map-zone monthly-issue-map-zone-${escapeHtml(zone.groupKey)}" data-monthly-map-zone="${escapeHtml(zone.groupKey)}" data-monthly-viewer-zone="${escapeHtml(zone.zone || '')}" data-monthly-map-target="${escapeHtml(zone.mode || '')}" style="left:${zone.x}%; top:${zone.y}%; width:${zone.w}%; height:${zone.h}%;" title="${escapeHtml(`${zone.label} 영역 보기`)}" aria-label="${escapeHtml(`${zone.label} 영역 보기`)}"></button>
    `).join('') : '';
    const back = isDetailMode ? `
        <button type="button" class="monthly-issue-map-back" data-monthly-map-back title="전체 배치도로 돌아가기">
            <i class="fas fa-arrow-left"></i> 전체
        </button>
    ` : '';
    const viewerTitle = viewerTarget?.title || '구조물 3D 뷰';
    const viewerBack = `
        <button type="button" class="monthly-issue-map-back" data-monthly-viewer-close title="배치도로 돌아가기">
            <i class="fas fa-arrow-left"></i> 배치도
        </button>
    `;

    return `
        <section class="monthly-issue-map-panel">
            <div class="monthly-issue-map-head">
                <strong>구조물 3D 뷰</strong>
                <span>${isViewerMode ? escapeHtml(viewerTitle) : (isDetailMode ? getMonthlyIssueStructureGroupMeta(mode).title : '영역별 선택')}</span>
            </div>
            ${isViewerMode ? `
                <div class="monthly-issue-map-view monthly-issue-viewer-view" data-monthly-viewer-mode>
                    <div id="monthly-issue-structure-viewer" class="monthly-issue-structure-viewer"></div>
                    ${viewerBack}
                    <div id="monthly-issue-viewer-status" class="monthly-issue-viewer-status">
                        <i class="fas fa-circle-notch fa-spin"></i>
                        <span>${escapeHtml(viewerTitle)} 모델을 준비하는 중입니다.</span>
                    </div>
                </div>
            ` : `
                <div class="monthly-issue-map-view" data-monthly-map-mode="${escapeHtml(mode)}" data-monthly-map-default="${escapeHtml(MONTHLY_ISSUE_MAP_IMAGES.overview)}" data-monthly-map-hover="${escapeHtml(MONTHLY_ISSUE_MAP_IMAGES.hover)}">
                    <img src="${escapeHtml(imageSrc)}" alt="강북정수장 월간 이슈 구조물 배치도">
                    ${back}
                    ${zones}
                    ${markers}
                    ${isDetailMode && !markers ? '<div class="monthly-issue-map-empty">표시할 이슈가 없습니다.</div>' : ''}
                </div>
            `}
        </section>
    `;
}

function renderMonthlyIssueListTable(issues, emptyMessage = '표시할 이슈가 없습니다.') {
    if (!issues.length) {
        return `<div class="bim-db-placeholder">${escapeHtml(emptyMessage)}</div>`;
    }
    const rows = issues
        .slice()
        .sort((a, b) => getIssueStart(b).getTime() - getIssueStart(a).getTime())
        .map(issue => {
            const issueKey = getIssueKey(issue);
            if (issueKey) dashboardIssueRegistry.set(issueKey, issue);
            const group = STATUS_GROUPS[getStatusGroup(issue)] || STATUS_GROUPS.created;
            return `
                <tr class="monthly-issue-dashboard-row" data-issue-key="${escapeHtml(issueKey)}">
                    <td title="${escapeHtml(getIssueLocation(issue))}">${escapeHtml(getIssueLocation(issue))}</td>
                    <td class="monthly-issue-dashboard-title" title="${escapeHtml(getIssueDescription(issue) || getIssueTitle(issue))}">${escapeHtml(getIssueTitle(issue))}</td>
                    <td>${escapeHtml(getIssuePeriodText(issue))}</td>
                    <td>${escapeHtml(getIssueAuthor(issue))}</td>
                    <td>${escapeHtml(getIssueReviewer(issue))}</td>
                    <td><span class="monthly-issue-status-pill" style="--status-color:${group.color};">${escapeHtml(group.label)}</span></td>
                </tr>
            `;
        }).join('');
    return `
        <div class="monthly-issue-dashboard-table-wrap">
            <table class="monthly-issue-dashboard-table">
                <thead>
                    <tr>
                        <th>시설</th>
                        <th>내용</th>
                        <th>기간</th>
                        <th>작성자</th>
                        <th>검토자</th>
                        <th>상태</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    `;
}

function getMonthlyIssueDashboardVisibleIssues(issues = [], options = {}) {
    const monthKey = window._monthlyIssueSelectedMonth || '';
    const statusFilter = document.getElementById('monthly-issue-status-filter')?.value || 'all';
    const search = document.getElementById('monthly-issue-search')?.value || '';
    const query = String(search || '').trim().toLowerCase();
    const selectedFacility = window._monthlyIssueSelectedFacility || '';
    const activeMapMode = getMonthlyIssueMapMode();
    const activeGroupFilter = window._monthlyIssueGroupFilter || 'all';
    const activeGroup = selectedFacility ? '' : (activeMapMode !== 'overview' ? activeMapMode : (activeGroupFilter !== 'all' ? activeGroupFilter : ''));
    const statusKey = options.statusKey || 'all';

    return (Array.isArray(issues) ? issues : []).filter(issue => {
        if (monthKey && !issueOverlapsMonth(issue, monthKey)) return false;
        const statusGroupKey = getStatusGroup(issue);
        if (statusFilter && statusFilter !== 'all' && statusGroupKey !== statusFilter) return false;
        if (statusKey === 'progress' && statusGroupKey !== 'closed') return false;
        if (statusKey && statusKey !== 'all' && statusKey !== 'progress' && statusGroupKey !== statusKey) return false;
        const facility = getIssueLocation(issue);
        const structureGroupKey = getMonthlyIssueStructureGroup(facility, issue);
        if (activeGroup && structureGroupKey !== activeGroup) return false;
        if (selectedFacility && facility !== selectedFacility) return false;
        if (query) {
            const haystack = [
                facility,
                getIssueTitle(issue),
                getIssueDescription(issue),
                getIssueAuthor(issue),
                getIssueReviewer(issue)
            ].join(' ').toLowerCase();
            if (!haystack.includes(query)) return false;
        }
        return true;
    });
}

function renderMonthlyIssueDashboard(issues = []) {
    const monthKey = window._monthlyIssueSelectedMonth || '';
    const selectedFacility = window._monthlyIssueSelectedFacility || '';
    const visibleIssues = getMonthlyIssueDashboardVisibleIssues(issues);
    const mapRows = getMonthlyIssueDashboardRows((Array.isArray(issues) ? issues : []).filter(issue => !monthKey || issueOverlapsMonth(issue, monthKey)));
    const summary = visibleIssues.reduce((acc, issue) => {
        const groupKey = getStatusGroup(issue);
        acc.total += 1;
        acc[groupKey] += 1;
        return acc;
    }, { total: 0, created: 0, review: 0, delayed: 0, closed: 0 });
    const progressRate = summary.total ? Math.round((summary.closed / summary.total) * 100) : 0;
    const selectedChip = selectedFacility ? `
        <button type="button" class="monthly-issue-selected-chip" data-monthly-clear-facility title="시설 필터 해제">
            ${escapeHtml(selectedFacility)} <i class="fas fa-xmark"></i>
        </button>
    ` : '';
    const listTitle = monthKey ? `${getMonthLabel(monthKey)} 이슈 목록` : '전체 이슈 목록';
    const emptyMessage = monthKey ? `${getMonthLabel(monthKey)} 기준 표시할 이슈가 없습니다.` : '표시할 이슈가 없습니다.';

    return `
        <div class="monthly-issue-dashboard-shell">
            ${renderMonthlyIssueMap(mapRows, selectedFacility)}
            <section class="monthly-issue-dashboard-panel">
                <div class="monthly-issue-dashboard-kpis">
                    ${renderMonthlyIssueKpi('전체', summary.total, '#38bdf8', 'all')}
                    ${renderMonthlyIssueKpi('진행중', summary.review, '#a78bfa', 'review')}
                    ${renderMonthlyIssueKpi('완료', summary.closed, '#10b981', 'closed')}
                    ${renderMonthlyIssueKpi('진행률', `${progressRate}%`, '#8b5cf6', 'progress')}
                </div>
                <div class="monthly-issue-dashboard-subbar">
                    <strong>${escapeHtml(listTitle)}</strong>
                    ${selectedChip}
                    <span>${visibleIssues.length}건</span>
                </div>
                ${renderMonthlyIssueListTable(visibleIssues, emptyMessage)}
            </section>
        </div>
    `;
}

function getMonthlyIssueViewerTargetKey(target = window._monthlyIssueViewerTarget) {
    if (!target) return '';
    return [target.type || 'structure', target.zone || '', target.structureName || '', target.groupKey || ''].join(':');
}

function setMonthlyIssueViewerStatus(message, isLoading = true) {
    const status = document.getElementById('monthly-issue-viewer-status');
    if (!status) return;
    status.innerHTML = `
        ${isLoading ? '<i class="fas fa-circle-notch fa-spin"></i>' : '<i class="fas fa-cube"></i>'}
        <span>${escapeHtml(message)}</span>
    `;
    status.classList.toggle('is-done', !isLoading);
}

function hideMonthlyIssueViewerToolbar(viewer) {
    try {
        if (viewer && viewer.toolbar && viewer.toolbar.container) {
            viewer.toolbar.container.style.display = 'none';
        }
        const container = document.getElementById('monthly-issue-structure-viewer');
        if (container) {
            container.querySelectorAll('.adsk-toolbar, .adsk-control-group').forEach(el => {
                el.style.display = 'none';
            });
        }
    } catch (error) {
        console.warn('[Monthly Issue Viewer] toolbar hide skipped:', error);
    }
}

function disposeMonthlyIssueStructureViewer() {
    const viewer = window.monthlyIssueStructureViewer;
    if (!viewer) return;
    try {
        if (typeof viewer.tearDown === 'function') viewer.tearDown();
        if (typeof viewer.finish === 'function') viewer.finish();
    } catch (error) {
        console.warn('[Monthly Issue Viewer] dispose skipped:', error);
    }
    window.monthlyIssueStructureViewer = null;
    window._monthlyIssueViewerContainer = null;
    window._monthlyIssueLoadedTargetKey = '';
}

async function getMonthlyIssueStructureViewer() {
    const container = document.getElementById('monthly-issue-structure-viewer');
    if (!container) return null;

    if (window.monthlyIssueStructureViewer && window._monthlyIssueViewerContainer !== container) {
        disposeMonthlyIssueStructureViewer();
    }
    if (window.monthlyIssueStructureViewer && window.monthlyIssueStructureViewer.impl) {
        hideMonthlyIssueViewerToolbar(window.monthlyIssueStructureViewer);
        return window.monthlyIssueStructureViewer;
    }

    const viewerModule = await import('./viewer.js');
    if (typeof viewerModule.initViewer !== 'function') return null;
    const viewer = await viewerModule.initViewer(container, true);
    if (!viewer || !viewer.impl) return null;
    window.monthlyIssueStructureViewer = viewer;
    window._monthlyIssueViewerContainer = container;
    hideMonthlyIssueViewerToolbar(viewer);
    if (window.Autodesk && Autodesk.Viewing && Autodesk.Viewing.TOOLBAR_CREATED_EVENT && typeof viewer.addEventListener === 'function') {
        viewer.addEventListener(Autodesk.Viewing.TOOLBAR_CREATED_EVENT, () => hideMonthlyIssueViewerToolbar(viewer));
    }
    return viewer;
}

async function loadMonthlyIssueViewerTarget() {
    const target = window._monthlyIssueViewerTarget;
    if (!target) return false;
    const targetKey = getMonthlyIssueViewerTargetKey(target);
    const title = target.title || '선택 구조물';

    try {
        setMonthlyIssueViewerStatus(`${title} 모델을 찾는 중입니다.`);
        const models = target.type === 'zone'
            ? await getConstructionZoneModels(target.zone)
            : await getConstructionStructureModels(target.structureName, target.zone);

        if (getMonthlyIssueViewerTargetKey() !== targetKey) return false;
        if (!models.length) {
            setMonthlyIssueViewerStatus(`${title}에 연결된 RVT 파일을 찾지 못했습니다.`, false);
            return false;
        }

        const viewer = await getMonthlyIssueStructureViewer();
        if (!viewer || !viewer.impl) {
            setMonthlyIssueViewerStatus('월간 이슈 3D 뷰어를 초기화하지 못했습니다.', false);
            return false;
        }

        if (window._monthlyIssueLoadedTargetKey === targetKey && typeof viewer.fitToView === 'function') {
            if (typeof viewer.resize === 'function') viewer.resize();
            viewer.fitToView();
            setMonthlyIssueViewerStatus(`${title} 모델 ${models.length}개를 표시 중입니다.`, false);
            return true;
        }

        try {
            if (typeof viewer.getAllModels === 'function') {
                viewer.getAllModels().forEach(model => viewer.unloadModel(model));
            } else if (viewer.model && typeof viewer.unloadModel === 'function') {
                viewer.unloadModel(viewer.model);
            }
        } catch (error) {
            console.warn('[Monthly Issue Viewer] failed to clear previous models:', error);
        }

        const viewerModule = await import('./viewer.js');
        setMonthlyIssueViewerStatus(`${title} 공종별 모델 ${models.length}개를 병합하는 중입니다.`);
        if (models.length > 1 && typeof viewerModule.loadAggregated === 'function') {
            await viewerModule.loadAggregated(viewer, models);
        } else if (models.length === 1 && typeof viewerModule.loadModelMulti === 'function') {
            await viewerModule.loadModelMulti(viewer, models[0].urn, { preserveView: false });
        } else {
            setMonthlyIssueViewerStatus('모델 로더를 찾을 수 없습니다.', false);
            return false;
        }

        window._monthlyIssueLoadedTargetKey = targetKey;
        window._monthlyIssueActiveModelNames = models.map(model => model.name).filter(Boolean);
        try {
            if (typeof viewer.resize === 'function') viewer.resize();
            if (typeof viewer.fitToView === 'function') viewer.fitToView();
            if (viewer.impl && typeof viewer.impl.invalidate === 'function') viewer.impl.invalidate(true, true, true);
        } catch (error) {
            console.warn('[Monthly Issue Viewer] fit failed:', error);
        }
        hideMonthlyIssueViewerToolbar(viewer);
        setMonthlyIssueViewerStatus(`${title} 공종별 모델 ${models.length}개를 표시 중입니다.`, false);
        return true;
    } catch (error) {
        console.error('[Monthly Issue Viewer] load failed:', error);
        setMonthlyIssueViewerStatus(`${title} 3D 모델을 불러오지 못했습니다.`, false);
        return false;
    }
}

function openMonthlyIssueStructureViewer(facility, groupKey = 'new') {
    const zone = getMonthlyIssueViewerZoneForGroup(groupKey);
    const structureName = getFacilityBaseName(facility);
    window._monthlyIssueViewerTarget = {
        type: 'structure',
        facility,
        groupKey,
        zone,
        structureName,
        title: `${facility} 3D 뷰`
    };
    renderMonthlyIssueStatusTab(Array.isArray(window._constructionIssueCache) ? window._constructionIssueCache : []);
}

function openMonthlyIssueZoneViewer(groupKey = 'temporary', zone = getMonthlyIssueViewerZoneForGroup(groupKey)) {
    const groupMeta = getMonthlyIssueStructureGroupMeta(groupKey);
    window._monthlyIssueViewerTarget = {
        type: 'zone',
        groupKey,
        zone,
        title: `${groupMeta.title || groupMeta.label} 병합 3D 뷰`
    };
    renderMonthlyIssueStatusTab(Array.isArray(window._constructionIssueCache) ? window._constructionIssueCache : []);
}

function closeMonthlyIssueStructureViewer() {
    window._monthlyIssueViewerTarget = null;
    disposeMonthlyIssueStructureViewer();
}

function renderMonthlyIssueGroupFilter(rows = []) {
    const active = window._monthlyIssueGroupFilter || 'all';
    const counts = rows.reduce((acc, row) => {
        const groupKey = row.groupKey || getMonthlyIssueStructureGroup(row.location);
        acc.all += 1;
        acc[groupKey] = (acc[groupKey] || 0) + 1;
        return acc;
    }, { all: 0, temporary: 0, new: 0, extension: 0, etc: 0 });

    const buttons = MONTHLY_ISSUE_STRUCTURE_GROUPS.map(group => `
        <button type="button" class="monthly-issue-group-filter${active === group.key ? ' active' : ''}" data-monthly-group-filter="${escapeHtml(group.key)}" title="${escapeHtml(`${group.title} 보기`)}">
            <span>${escapeHtml(group.label)}</span>
            <strong>${counts[group.key] || 0}</strong>
        </button>
    `).join('');

    return `<div class="monthly-issue-group-filters" aria-label="구조물 그룹 필터">${buttons}</div>`;
}

function renderMonthlyIssueMatrix(issues = []) {
    const activeSubTab = window._monthlyIssueActiveSubTab || 'status';
    const legendTitle = '<i class="fas fa-calendar-days"></i><span>구조물별 이슈 현황</span>';
    const search = document.getElementById('monthly-issue-search')?.value || '';
    const query = String(search || '').trim().toLowerCase();
    const filteredIssues = (Array.isArray(issues) ? issues : []).filter(issue => {
        if (!query) return true;
        return getIssueLocation(issue).toLowerCase().includes(query);
    });

    const months = buildMonthRange(filteredIssues);
    const rows = summarizeByLocationAndMonth(filteredIssues, months, activeSubTab);
    const displayRows = summarizeMonthlyIssueRowsForDisplay(rows, months, activeSubTab);
    if (!displayRows.length) {
        return `
            <div class="monthly-issue-workspace">
                <div class="monthly-issue-chart-wrap">
                    ${renderStatusLegend(activeSubTab, renderMonthlyIssueGroupFilter(rows), legendTitle)}
                    <div class="bim-db-placeholder">선택한 구조물 그룹에 표시할 이슈가 없습니다.</div>
                </div>
            </div>
        `;
    }
    const totals = filteredIssues.reduce((acc, issue) => {
        const groupKey = activeSubTab === 'status' ? getStatusGroup(issue) : getIssueTypeKey(issue);
        acc.total += 1;
        acc[groupKey] = (acc[groupKey] || 0) + 1;
        if (getStatusGroup(issue) === 'closed') acc.closed += 1;
        return acc;
    }, { total: 0, created: 0, review: 0, closed: 0, clash: 0, design: 0, work: 0 });
    const completion = totals.total ? Math.round((totals.closed / totals.total) * 100) : 0;
    const kpiHtml = activeSubTab === 'status' ? `
        ${renderMonthlyIssueKpi('전체 이슈', totals.total, '#38bdf8', 'all')}
        ${renderMonthlyIssueKpi('생성', totals.created, '#38bdf8', 'created')}
        ${renderMonthlyIssueKpi('검토', totals.review, '#a78bfa', 'review')}
        ${renderMonthlyIssueKpi('종료', totals.closed, '#10b981', 'closed')}
        ${renderMonthlyIssueKpi('완료율', `${completion}%`, '#10b981', 'closed')}
    ` : `
        ${renderMonthlyIssueKpi('전체 이슈', totals.total, '#38bdf8', 'all')}
        ${renderMonthlyIssueKpi('간섭이슈', totals.clash, '#00f2fe', 'clash')}
        ${renderMonthlyIssueKpi('설계이슈', totals.design, '#8b5cf6', 'design')}
        ${renderMonthlyIssueKpi('업데이트 항목', totals.work, '#f59e0b', 'work')}
        ${renderMonthlyIssueKpi('완료율', `${completion}%`, '#10b981', 'closed')}
    `;

    const rowHeight = getMonthlyIssueRowHeight(displayRows.length);
    const axisHeight = rowHeight <= 22 ? 22 : 24;
    const monthWidth = Math.max(64, Math.floor(1040 / Math.max(months.length, 1)));
    const chartStyle = `--bim-month-count:${months.length}; --bim-month-width:${monthWidth}px; --monthly-issue-yaxis-width:220px; --monthly-issue-row-height:${rowHeight}px; --monthly-issue-axis-height:${axisHeight}px; --monthly-issue-body-height:${MONTHLY_ISSUE_MATRIX_BODY_HEIGHT}px;`;
    const yAxis = displayRows.map(row => {
        if (row.isGroup) {
            const expanded = window._monthlyIssueGroupFilter !== 'all' || !!window._monthlyIssueExpandedGroups?.[row.groupKey];
            return `
        <button type="button" class="bim-chart-yitem monthly-issue-yitem monthly-issue-group-row" data-monthly-group="${escapeHtml(row.groupKey)}" title="${escapeHtml(`${row.location} ${expanded ? '접기' : '펼치기'}`)}">
            <span class="monthly-issue-group-label">
                <i class="fas fa-chevron-${expanded ? 'down' : 'right'}"></i>
                <strong title="${escapeHtml(row.location)}">${escapeHtml(row.location)}</strong>
                <small title="${escapeHtml(`${row.count}개 구조물`)}">${row.count}</small>
            </span>
        </button>
            `;
        }
        return `
        <div class="bim-chart-yitem monthly-issue-yitem monthly-issue-structure-cell bim-chart-clickable" data-location="${escapeHtml(row.location)}" title="${escapeHtml(row.location)} 이슈 목록 보기">
            <div class="bim-structure-name" title="${escapeHtml(row.location)}">${escapeHtml(row.location)}</div>
        </div>
        `;
    }).join('');
    const plot = displayRows.map(row => {
        if (row.isGroup) {
            return `
                <div class="bim-chart-row monthly-issue-chart-row monthly-issue-group-chart-row">
                    <div class="monthly-issue-group-fill" aria-hidden="true"></div>
                </div>
            `;
        }
        const cells = months.map(month => {
            return renderChartCell(row.months.get(month), row.location, month, activeSubTab);
        }).join('');
        return `<div class="bim-chart-row monthly-issue-chart-row">${cells}</div>`;
    }).join('');
    const selectedMonth = window._monthlyIssueSelectedMonth || '';
    const xAxis = months.map(month => {
        const isActive = selectedMonth === month;
        const isStartMonth = month === MONTHLY_ISSUE_START_MONTH;
        return `<button type="button" class="bim-chart-month monthly-issue-month-button${isActive ? ' active' : ''}${isStartMonth ? ' monthly-issue-start-month' : ''}" aria-pressed="${isActive ? 'true' : 'false'}" data-month="${escapeHtml(month)}" title="${escapeHtml(`${getMonthLabel(month)} 이슈 목록 보기`)}"><span>${getMonthLabel(month)}</span>${isStartMonth ? '<small>과업 시작</small>' : ''}</button>`;
    }).join('');

    return `
        <div class="monthly-issue-workspace">
            <div class="monthly-issue-chart-wrap">
                ${renderStatusLegend(activeSubTab, renderMonthlyIssueGroupFilter(rows), legendTitle)}
                <div class="bim-chart monthly-issue-chart" style="${chartStyle}">
                    <div class="bim-chart-yaxis">${yAxis}</div>
                    <div class="bim-chart-plot">${plot}</div>
                </div>
                <div class="monthly-issue-axis-row" style="${chartStyle}">
                    <div class="monthly-issue-axis-spacer"></div>
                    <div class="monthly-issue-month-row">${xAxis}</div>
                </div>
            </div>
        </div>
    `;
}

function getMonthlyIssueRowHeight(rowCount) {
    if (!rowCount) return 24;
    const height = Math.max(16, Math.min(40, MONTHLY_ISSUE_MATRIX_BODY_HEIGHT / rowCount));
    return Math.round(height * 100) / 100;
}

function renderMonthlyIssueStatusTab(issues = []) {
    const root = document.getElementById('monthly-issue-status-root');
    if (!root) return;

    root.innerHTML = `
        <div class="monthly-issue-matrix-section">
            ${renderMonthlyIssueMatrix(issues)}
        </div>
        <div class="monthly-issue-lower-section">
            ${renderMonthlyIssueDashboard(issues)}
        </div>
    `;
    if (window._monthlyIssueViewerTarget) {
        setTimeout(loadMonthlyIssueViewerTarget, 0);
    }
}

window.switchMonthlyIssueSubTab = function(subTab) {
    window._monthlyIssueActiveSubTab = subTab;
    
    const statusBtn = document.getElementById('monthly-issue-subtab-status');
    const typeBtn = document.getElementById('monthly-issue-subtab-type');
    
    if (statusBtn && typeBtn) {
        if (subTab === 'status') {
            statusBtn.classList.add('active');
            typeBtn.classList.remove('active');
        } else {
            typeBtn.classList.add('active');
            statusBtn.classList.remove('active');
        }
    }
    
    if (typeof renderMonthlyIssueStatusTab === 'function') {
        renderMonthlyIssueStatusTab(Array.isArray(window._constructionIssueCache) ? window._constructionIssueCache : []);
    }
};

function bindMonthlyIssueStatusTab() {
    const root = document.getElementById('monthly-issue-status-root');
    const month = document.getElementById('monthly-issue-month');
    const status = document.getElementById('monthly-issue-status-filter');
    const search = document.getElementById('monthly-issue-search');
    const refresh = document.getElementById('monthly-issue-refresh');
    if (month && !month.value) month.value = getMonthKey(new Date());

    const rerender = () => renderMonthlyIssueStatusTab(Array.isArray(window._constructionIssueCache) ? window._constructionIssueCache : []);
    [month, status].forEach(el => {
        if (el && !el.dataset.monthlyIssueBound) {
            el.dataset.monthlyIssueBound = 'true';
            el.addEventListener('change', rerender);
        }
    });
    if (search && !search.dataset.monthlyIssueBound) {
        search.dataset.monthlyIssueBound = 'true';
        search.addEventListener('input', rerender);
    }
    if (refresh && !refresh.dataset.monthlyIssueBound) {
        refresh.dataset.monthlyIssueBound = 'true';
        refresh.addEventListener('click', () => refreshMonthlyIssueStatusTab(true));
    }
    if (!window._monthlyIssueResizeBound) {
        window._monthlyIssueResizeBound = true;
        let resizeTimer = null;
        window.addEventListener('resize', () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                const tab = document.getElementById('monthly-issue-status-tab');
                if (tab && tab.style.display !== 'none') rerender();
            }, 120);
        });
    }
    if (root && !root.dataset.monthlyIssueBound) {
        root.dataset.monthlyIssueBound = 'true';
        root.addEventListener('click', event => {
            const mapBack = event.target.closest('[data-monthly-map-back]');
            if (mapBack) {
                window._monthlyIssueMapMode = 'overview';
                window._monthlyIssueSelectedFacility = '';
                window._monthlyIssueGroupFilter = 'all';
                rerender();
                return;
            }
            const viewerClose = event.target.closest('[data-monthly-viewer-close]');
            if (viewerClose) {
                closeMonthlyIssueStructureViewer();
                rerender();
                return;
            }
            const mapZone = event.target.closest('[data-monthly-map-zone]');
            if (mapZone) {
                const groupKey = mapZone.dataset.monthlyMapZone || 'all';
                const targetMode = mapZone.dataset.monthlyMapTarget || '';
                const viewerZone = mapZone.dataset.monthlyViewerZone || getMonthlyIssueViewerZoneForGroup(groupKey);
                window._monthlyIssueSelectedFacility = '';
                window._monthlyIssueGroupFilter = groupKey;
                if (targetMode === 'new' || targetMode === 'extension') {
                    window._monthlyIssueMapMode = targetMode;
                    rerender();
                } else {
                    openMonthlyIssueZoneViewer(groupKey, viewerZone);
                }
                return;
            }
            const facilityBadge = event.target.closest('[data-monthly-facility]');
            if (facilityBadge) {
                window._monthlyIssueSelectedFacility = facilityBadge.dataset.monthlyFacility || '';
                const groupKey = facilityBadge.dataset.monthlyMapGroup || getMonthlyIssueStructureGroup(window._monthlyIssueSelectedFacility);
                window._monthlyIssueGroupFilter = groupKey;
                rerender();
                openMonthlyIssueStructureViewer(window._monthlyIssueSelectedFacility, groupKey);
                return;
            }
            if (event.target.closest('[data-monthly-clear-facility]')) {
                window._monthlyIssueSelectedFacility = '';
                rerender();
                return;
            }
            const groupFilter = event.target.closest('[data-monthly-group-filter]');
            if (groupFilter) {
                window._monthlyIssueGroupFilter = groupFilter.dataset.monthlyGroupFilter || 'all';
                window._monthlyIssueMapMode = window._monthlyIssueGroupFilter === 'new' || window._monthlyIssueGroupFilter === 'extension'
                    ? window._monthlyIssueGroupFilter
                    : 'overview';
                window._monthlyIssueSelectedFacility = '';
                monthlyIssueDrilldownState.location = '';
                monthlyIssueDrilldownState.month = '';
                rerender();
                return;
            }
            const groupRow = event.target.closest('[data-monthly-group]');
            if (groupRow) {
                const groupKey = groupRow.dataset.monthlyGroup || '';
                window._monthlyIssueExpandedGroups = window._monthlyIssueExpandedGroups || {};
                window._monthlyIssueExpandedGroups[groupKey] = !window._monthlyIssueExpandedGroups[groupKey];
                rerender();
                return;
            }
            const dashboardRow = event.target.closest('.monthly-issue-dashboard-row[data-issue-key]');
            if (dashboardRow && !event.target.closest('button, a, input, select')) {
                const issue = dashboardIssueRegistry.get(dashboardRow.dataset.issueKey || '');
                if (issue && typeof window.openFormaIssueDetail === 'function') {
                    window.openFormaIssueDetail(issue);
                }
                return;
            }
            const kpi = event.target.closest('.monthly-issue-kpi[data-status]');
            if (kpi) {
                const statusKey = kpi.dataset.status || 'all';
                const activeSubTab = window._monthlyIssueActiveSubTab || 'status';
                const allIssues = Array.isArray(window._constructionIssueCache) ? window._constructionIssueCache : [];
                const issues = activeSubTab === 'status'
                    ? getMonthlyIssueDashboardVisibleIssues(allIssues, { statusKey })
                    : getMonthlyIssueDashboardVisibleIssues(allIssues).filter(issue => {
                        if (statusKey === 'all') return true;
                        if (statusKey === 'closed') return getStatusGroup(issue) === 'closed';
                        return getIssueTypeKey(issue) === statusKey;
                    });
                
                let title = '이슈 목록';
                if (activeSubTab === 'status') {
                    const titleMap = {
                        all: '전체 이슈 목록',
                        created: '생성 이슈 목록',
                        review: '검토 이슈 목록',
                        closed: '종료 이슈 목록',
                        progress: '완료 이슈 목록'
                    };
                    title = titleMap[statusKey] || '이슈 목록';
                } else {
                    const titleMap = {
                        all: '전체 이슈 목록',
                        clash: '간섭이슈 목록',
                        design: '설계이슈 목록',
                        work: '업데이트 항목 목록',
                        closed: '종료 이슈 목록'
                    };
                    title = titleMap[statusKey] || '이슈 목록';
                }
                openMonthlyIssueListModal(title, issues);
                return;
            }
            const monthButton = event.target.closest('.monthly-issue-month-button[data-month]');
            if (monthButton) {
                const monthValue = monthButton.dataset.month || '';
                window._monthlyIssueSelectedMonth = window._monthlyIssueSelectedMonth === monthValue ? '' : monthValue;
                const monthInput = document.getElementById('monthly-issue-month');
                if (monthInput) monthInput.value = window._monthlyIssueSelectedMonth || getMonthKey(new Date());
                rerender();
                return;
            }
            const target = event.target.closest('.monthly-issue-structure-cell[data-location], .bim-chart-clickable[data-location]');
            if (!target) return;
            openStructureIssueModal(target.dataset.location || '', target.dataset.month || '');
        });
        root.addEventListener('mouseover', event => {
            const mapZone = event.target.closest('[data-monthly-map-zone]');
            if (!mapZone) return;
            const mapView = mapZone.closest('.monthly-issue-map-view[data-monthly-map-mode="overview"]');
            const img = mapView?.querySelector('img');
            if (img && mapView.dataset.monthlyMapHover) img.src = mapView.dataset.monthlyMapHover;
        });
        root.addEventListener('mouseout', event => {
            const mapZone = event.target.closest('[data-monthly-map-zone]');
            if (!mapZone) return;
            const mapView = mapZone.closest('.monthly-issue-map-view[data-monthly-map-mode="overview"]');
            if (!mapView || mapZone.contains(event.relatedTarget)) return;
            const img = mapView.querySelector('img');
            if (img && mapView.dataset.monthlyMapDefault) img.src = mapView.dataset.monthlyMapDefault;
        });
    }
}

function getIssueTypeText(issue) {
    const raw = issue && issue.rawFormaIssue ? issue.rawFormaIssue : {};
    return normalizeText(
        issue.typePath ||
        issue.type_path ||
        issue.typeFullName ||
        issue.type_full_name ||
        issue.issueTypePath ||
        issue.issue_type_path ||
        issue.categoryPath ||
        issue.category_path ||
        issue.typeLabel ||
        issue.type ||
        issue.issueType ||
        issue.issue_type ||
        raw.typePath ||
        raw.type_path ||
        raw.typeFullName ||
        raw.type_full_name ||
        raw.issueTypePath ||
        raw.issue_type_path ||
        raw.categoryPath ||
        raw.category_path ||
        raw.type ||
        raw.issueType ||
        ''
    );
}

function isClashIssue(issue) {
    const text = getIssueTypeText(issue).toLowerCase();
    return text.includes('간섭') || text.includes('clash') || text.includes('collision') || text.includes('interference');
}

function summarizeClashIssuesByStructure(issues) {
    const rows = new Map();
    issues.filter(isClashIssue).forEach(issue => {
        const structure = getIssueLocation(issue);
        const groupKey = getStatusGroup(issue);
        if (!rows.has(structure)) {
            rows.set(structure, { structure, total: 0, created: 0, review: 0, delayed: 0, closed: 0 });
        }
        const row = rows.get(structure);
        row.total += 1;
        row[groupKey] += 1;
    });
    return Array.from(rows.values()).sort((a, b) => b.total - a.total || a.structure.localeCompare(b.structure, 'ko'));
}

function renderClashStructureChart(issues) {
    const canvas = document.getElementById('bim-clash-structure-chart');
    const empty = document.getElementById('bim-clash-empty');
    const totalEl = document.getElementById('bim-clash-total');
    const reviewEl = document.getElementById('bim-clash-review-count');
    const delayedEl = document.getElementById('bim-clash-delayed-count');
    const closedEl = document.getElementById('bim-clash-closed-count');
    if (!canvas || typeof Chart === 'undefined') return;

    const rows = summarizeClashIssuesByStructure(issues);
    const totals = rows.reduce((acc, row) => {
        acc.total += row.total;
        acc.review += row.review;
        acc.delayed += row.delayed;
        acc.closed += row.closed;
        return acc;
    }, { total: 0, review: 0, delayed: 0, closed: 0 });

    if (totalEl) totalEl.textContent = `간섭 ${totals.total}건`;
    if (reviewEl) reviewEl.textContent = totals.review;
    if (delayedEl) delayedEl.textContent = totals.delayed;
    if (closedEl) closedEl.textContent = totals.closed;

    if (clashStructureChart) {
        clashStructureChart.destroy();
        clashStructureChart = null;
    }

    if (!rows.length) {
        canvas.style.display = 'none';
        if (empty) empty.style.display = 'flex';
        return;
    }

    canvas.style.display = 'block';
    if (empty) empty.style.display = 'none';

    const labels = rows.map(row => row.structure);
    const datasets = GROUP_ORDER.map(groupKey => ({
        label: STATUS_GROUPS[groupKey].label,
        data: rows.map(row => row[groupKey] || 0),
        backgroundColor: STATUS_GROUPS[groupKey].color,
        borderColor: 'rgba(15, 23, 42, 0.65)',
        borderWidth: 1,
        borderRadius: 4,
        stack: 'status'
    }));

    clashStructureChart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            onClick(event, elements, chart) {
                const hit = elements && elements[0];
                if (!hit) return;
                const structure = chart.data.labels[hit.index];
                openClashStructureIssueModal(structure);
            },
            onHover(event, elements) {
                const target = event?.native?.target;
                if (target) target.style.cursor = elements && elements.length ? 'pointer' : 'default';
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: { color: '#cbd5e1', boxWidth: 10, boxHeight: 10, font: { size: 11, weight: '700' } }
                },
                tooltip: {
                    callbacks: {
                        title(items) { return items && items[0] ? items[0].label : ''; },
                        label(item) { return `${item.dataset.label}: ${item.parsed.y || 0}건`; },
                        footer(items) {
                            const row = rows[items[0]?.dataIndex || 0];
                            return row ? `합계: ${row.total}건` : '';
                        }
                    }
                }
            },
            scales: {
                x: {
                    stacked: true,
                    grid: { color: 'rgba(148, 163, 184, 0.12)' },
                    ticks: { color: '#cbd5e1', maxRotation: 30, minRotation: 0, autoSkip: false, font: { size: 10, weight: '700' } }
                },
                y: {
                    stacked: true,
                    beginAtZero: true,
                    grid: { color: 'rgba(148, 163, 184, 0.14)' },
                    ticks: { color: '#94a3b8', precision: 0, stepSize: 1 }
                }
            }
        }
    });
}
function calculateScheduleProgress(startDate, endDate, now = new Date()) {
    const start = parseIssueDate(startDate);
    const end = parseIssueDate(endDate);
    if (!start || !end) return 0;
    const startTime = getStartOfDay(start).getTime();
    const endTime = getStartOfDay(end).getTime();
    const nowTime = getStartOfDay(now).getTime();
    if (nowTime < startTime) return 0;
    if (nowTime >= endTime) return 100;
    const total = Math.max(1, endTime - startTime);
    return Math.max(0, Math.min(100, Math.round(((nowTime - startTime) / total) * 100)));
}

function getScheduleStatus(progress) {
    if (progress >= 100) return '완료';
    if (progress <= 0) return '예정';
    return '진행중';
}

function normalizeConstructionScheduleItem(item, index) {
    const zone = item.zone || (String(item.category || '').includes('우선') ? 'priority' : 'extension');
    const progress = calculateScheduleProgress(item.startDate, item.endDate);
    return {
        ...item,
        id: item.id || `${zone}-${index + 1}`,
        zone,
        progress,
        status: item.status || getScheduleStatus(progress),
        color: item.color || (zone === 'priority' ? '#eab308' : '#06b6d4')
    };
}

async function loadConstructionScheduleData() {
    if (window._constructionScheduleDataPromise) return window._constructionScheduleDataPromise;
    window._constructionScheduleDataPromise = fetch(CONSTRUCTION_SCHEDULE_DATA_URL, { credentials: 'same-origin' })
        .then(resp => {
            if (!resp.ok) throw new Error(`construction schedule fetch failed: HTTP ${resp.status}`);
            return resp.json();
        })
        .then(data => {
            const items = Array.isArray(data) ? data : (data.items || []);
            constructionProgressItems = items.map(normalizeConstructionScheduleItem);
            window._constructionScheduleSource = data.source || {};
            renderConstructionGantt(constructionScheduleState.zone || '');
            renderProgressDonuts(constructionScheduleState.zone || '');
            return constructionProgressItems;
        })
        .catch(error => {
            console.warn('[Construction Schedule] failed to load schedule data:', error);
            constructionProgressItems = CONSTRUCTION_PROGRESS_ITEMS.slice();
            return constructionProgressItems;
        });
    return window._constructionScheduleDataPromise;
}

function getProgressItems(zone = '') {
    return zone ? constructionProgressItems.filter(item => item.zone === zone) : constructionProgressItems;
}

function getAverageProgress(items) {
    if (!items.length) return 0;
    return Math.round(items.reduce((sum, item) => sum + Number(item.progress || 0), 0) / items.length);
}

function getStartOfDay(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

function addDays(date, count) {
    const next = new Date(date);
    next.setDate(next.getDate() + count);
    next.setHours(0, 0, 0, 0);
    return next;
}

let constructionScheduleState = {
    zone: '',
    scale: 'week',
    week: formatDateKey(getMonday(new Date())),
    month: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
    year: String(new Date().getFullYear())
};

function getScheduleRange(settings = constructionScheduleState) {
    const scale = settings.scale || 'week';
    if (scale === 'year') {
        const year = Number(settings.year) || new Date().getFullYear();
        const start = new Date(year, 0, 1);
        const end = new Date(year, 11, 31);
        end.setHours(23, 59, 59, 999);
        return {
            scale,
            start,
            end,
            label: `${year}년`,
            cols: Array.from({ length: 12 }, (_, idx) => ({
                key: `${year}-${String(idx + 1).padStart(2, '0')}`,
                label: `${idx + 1}월`,
                start: new Date(year, idx, 1),
                end: new Date(year, idx + 1, 0)
            }))
        };
    }

    if (scale === 'month') {
        const parts = String(settings.month || constructionScheduleState.month).split('-').map(Number);
        const year = parts[0] || new Date().getFullYear();
        const month = parts[1] || (new Date().getMonth() + 1);
        const start = new Date(year, month - 1, 1);
        const end = new Date(year, month, 0);
        end.setHours(23, 59, 59, 999);
        return {
            scale,
            start,
            end,
            label: `${year}년 ${month}월`,
            cols: Array.from({ length: end.getDate() }, (_, idx) => {
                const date = new Date(year, month - 1, idx + 1);
                return {
                    key: formatDateKey(date),
                    label: String(idx + 1),
                    start: date,
                    end: date,
                    weekend: date.getDay() === 0 || date.getDay() === 6
                };
            })
        };
    }

    const start = getMonday(parseIssueDate(settings.week) || new Date());
    const end = addDays(start, 6);
    end.setHours(23, 59, 59, 999);
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    return {
        scale: 'week',
        start,
        end,
        label: `${formatShortDate(start)} ~ ${formatShortDate(end)}`,
        cols: Array.from({ length: 7 }, (_, idx) => {
            const date = addDays(start, idx);
            return {
                key: formatDateKey(date),
                label: `${date.getDate()}일`,
                subLabel: dayNames[date.getDay()],
                start: date,
                end: date,
                weekend: date.getDay() === 0 || date.getDay() === 6
            };
        })
    };
}

function getScheduleColumnIndex(range, value, fallback) {
    const date = getStartOfDay(parseIssueDate(value) || fallback || range.start);
    if (date <= range.start) return 0;
    if (date >= range.end) return Math.max(0, range.cols.length - 1);
    if (range.scale === 'year') return Math.max(0, Math.min(range.cols.length - 1, date.getMonth()));
    const idx = range.cols.findIndex(col => col.key === (range.scale === 'month' ? formatDateKey(date) : formatDateKey(date)));
    if (idx >= 0) return idx;
    return date < range.start ? 0 : Math.max(0, range.cols.length - 1);
}

function isConstructionItemInProgress(item, now = new Date()) {
    const start = parseIssueDate(item.startDate);
    const end = parseIssueDate(item.endDate || item.startDate);
    if (!start || !end) return false;
    const today = getStartOfDay(now).getTime();
    return getStartOfDay(start).getTime() <= today && today <= getStartOfDay(end).getTime();
}

function renderConstructionSchedule(activeZone = '', settings = constructionScheduleState, expanded = false) {
    const wrap = document.getElementById('bim-construction-gantt');
    if (!wrap && !expanded) return '';
    const allItems = getProgressItems(activeZone);
    const items = expanded ? allItems : allItems.filter(item => isConstructionItemInProgress(item));
    if (!items.length) {
        const empty = expanded
            ? '<div class="bim-week-empty">표시할 공정 데이터가 없습니다.</div>'
            : '<div class="bim-week-empty">현재 진행 중인 공사가 없습니다. 전체 일정은 크게 보기에서 확인하세요.</div>';
        if (wrap && !expanded) wrap.innerHTML = empty;
        return empty;
    }

    const range = getScheduleRange(settings);
    const colCount = range.cols.length;
    const controlSuffix = expanded ? '-expanded' : '';
    const scaleTabs = ['week', 'month', 'year'].map(scale => {
        const meta = {
            week: { label: '주간', icon: 'fa-calendar-week' },
            month: { label: '월간', icon: 'fa-calendar-days' },
            year: { label: '연간', icon: 'fa-calendar' }
        }[scale];
        return `
            <button type="button" class="bim-schedule-scale-btn${range.scale === scale ? ' active' : ''}" data-schedule-scale="${scale}" title="${meta.label} 일정 보기" aria-pressed="${range.scale === scale ? 'true' : 'false'}">
                <i class="fas ${meta.icon}"></i><span>${meta.label}</span>
            </button>
        `;
    }).join('');
    const scaleControl = expanded ? `
        <div class="bim-schedule-controls">
            <select id="bim-construction-schedule-scale${controlSuffix}" class="bim-week-select" title="일정 범위">
                <option value="week"${range.scale === 'week' ? ' selected' : ''}>주간</option>
                <option value="month"${range.scale === 'month' ? ' selected' : ''}>월간</option>
                <option value="year"${range.scale === 'year' ? ' selected' : ''}>연간</option>
            </select>
            <input id="bim-construction-schedule-week${controlSuffix}" class="bim-filter-input" type="date" value="${escapeHtml(formatDateKey(range.start))}" style="display:${range.scale === 'week' ? 'block' : 'none'};">
            <input id="bim-construction-schedule-month${controlSuffix}" class="bim-filter-input" type="month" value="${escapeHtml(settings.month)}" style="display:${range.scale === 'month' ? 'block' : 'none'};">
            <input id="bim-construction-schedule-year${controlSuffix}" class="bim-filter-input" type="number" min="2000" max="2100" value="${escapeHtml(settings.year)}" style="display:${range.scale === 'year' ? 'block' : 'none'};">
        </div>
    ` : `
        <div class="bim-schedule-quick-controls" role="group" aria-label="공사 일정 범위">
            ${scaleTabs}
            <button id="bim-construction-schedule-expand" type="button" class="bim-icon-btn" title="공사 일정 크게 보기"><i class="fas fa-up-right-and-down-left-from-center"></i></button>
        </div>
    `;

    const headers = range.cols.map(col => `
        <div class="bim-schedule-cell bim-schedule-head bim-schedule-day${col.weekend ? ' weekend' : ''}">
            <span>${escapeHtml(col.label)}</span>${col.subLabel ? `<small>${escapeHtml(col.subLabel)}</small>` : ''}
        </div>
    `).join('');

    let lastGroup = '';
    const rows = items.map(item => {
        const zoneMeta = CONSTRUCTION_ZONES[item.zone] || {};
        const groupLabel = zoneMeta.label || item.zone || '기타';
        const groupRow = groupLabel !== lastGroup
            ? `<div class="bim-schedule-group-row" style="--group-color:${escapeHtml(zoneMeta.color || item.color || '#38bdf8')};"><span>${escapeHtml(groupLabel)}</span></div>`
            : '';
        lastGroup = groupLabel;
        const itemStart = parseIssueDate(item.startDate);
        const itemEnd = parseIssueDate(item.endDate || item.startDate) || itemStart;
        const overlaps = itemStart <= range.end && itemEnd >= range.start;
        const start = overlaps ? getScheduleColumnIndex(range, item.startDate, range.start) : 0;
        const end = overlaps ? getScheduleColumnIndex(range, item.endDate || item.startDate, itemStart || range.start) : -1;
        const span = Math.max(1, end - start + 1);
        return `
            ${groupRow}
            <div class="bim-schedule-cell bim-schedule-left" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div>
            <div class="bim-schedule-plot" title="${escapeHtml(item.name)} ${escapeHtml(item.startDate)} ~ ${escapeHtml(item.endDate)}">
                ${overlaps ? `<div class="bim-schedule-bar" style="--start:${start}; --span:${span}; --task-color:${item.color};"></div>` : '<div class="bim-schedule-outside">기간 외</div>'}
            </div>
            <div class="bim-schedule-cell bim-schedule-progress">${item.progress}%</div>
        `;
    }).join('');

    const html = `
        <div class="bim-schedule-toolbar">
            <div class="bim-schedule-title">${expanded ? '전체 공사 일정' : '현재 진행 공사'} · ${range.label}</div>
            ${scaleControl}
        </div>
        <div class="bim-construction-schedule${expanded ? ' expanded' : ''}" style="--schedule-days:${colCount};">
            <div class="bim-schedule-cell bim-schedule-left bim-schedule-head">공종</div>
            ${headers}
            <div class="bim-schedule-cell bim-schedule-progress bim-schedule-head">%</div>
            ${rows}
        </div>
    `;
    if (wrap && !expanded) wrap.innerHTML = html;
    return html;
}

function renderConstructionGantt(activeZone = '') {
    constructionScheduleState.zone = activeZone || '';
    constructionScheduleState.scale = constructionScheduleState.scale || 'week';
    renderConstructionSchedule(activeZone, constructionScheduleState, false);
}

function setConstructionScheduleScale(scale) {
    if (!['week', 'month', 'year'].includes(scale)) return;
    constructionScheduleState.scale = scale;
    renderConstructionSchedule(constructionScheduleState.zone || '', constructionScheduleState, false);
}

function openConstructionScheduleModal() {
    const modal = document.getElementById('bim-timeline-modal');
    const body = document.getElementById('bim-timeline-modal-body');
    if (!modal || !body) return;
    constructionScheduleState.scale = constructionScheduleState.scale || 'week';
    body.innerHTML = renderConstructionSchedule(constructionScheduleState.zone, constructionScheduleState, true);
    const title = modal.querySelector('.bim-task-dialog-head span');
    if (title) title.textContent = '간단 공사 일정';
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
}

function updateExpandedConstructionSchedule() {
    const body = document.getElementById('bim-timeline-modal-body');
    if (!body) return;
    constructionScheduleState.scale = document.getElementById('bim-construction-schedule-scale-expanded')?.value || constructionScheduleState.scale || 'week';
    constructionScheduleState.week = formatDateKey(getMonday(parseIssueDate(document.getElementById('bim-construction-schedule-week-expanded')?.value) || new Date()));
    constructionScheduleState.month = document.getElementById('bim-construction-schedule-month-expanded')?.value || constructionScheduleState.month;
    constructionScheduleState.year = document.getElementById('bim-construction-schedule-year-expanded')?.value || constructionScheduleState.year;
    body.innerHTML = renderConstructionSchedule(constructionScheduleState.zone, constructionScheduleState, true);
}

function renderProgressDonuts(activeZone = '') {
    const wrap = document.getElementById('bim-progress-donuts');
    if (!wrap) return;
    const all = getAverageProgress(getProgressItems(''));
    const priority = getAverageProgress(getProgressItems('priority'));
    const extension = getAverageProgress(getProgressItems('extension'));
    const cards = [
        { label: '전체 공사', value: all, color: '#22c55e', zone: '' },
        { label: '우선시공분', value: priority, color: '#eab308', zone: 'priority' },
        { label: '본공사', value: extension, color: '#06b6d4', zone: 'extension' }
    ];
    wrap.innerHTML = cards.map(card => `
        <button type="button" class="bim-progress-donut-card${activeZone && card.zone === activeZone ? ' active' : ''}${card.zone ? ' is-clickable' : ''}" data-zone="${escapeHtml(card.zone)}" ${card.zone ? `title="${escapeHtml(card.label)} 폴더 모델 한 번에 보기"` : ''}>
            <div class="bim-progress-donut-title">${escapeHtml(card.label)}</div>
            <div class="bim-progress-donut" style="--value:${card.value}; --donut-color:${card.color};"><span>${card.value}%</span></div>
        </button>
    `).join('');
}

function normalizeFolderText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[()_\-./]/g, '');
}

function getNodeFolderName(node) {
    return String(node && (node.folderName || node.name || node.displayName || node.title) || '');
}

function collectNodeFiles(node, output = [], path = []) {
    if (!node || typeof node !== 'object') return output;
    const nextPath = getNodeFolderName(node) ? path.concat(getNodeFolderName(node)) : path;
    if (Array.isArray(node.files)) {
        node.files.forEach(file => {
            if (file && file.urn && file.name) {
                output.push({
                    urn: file.urn,
                    name: file.name,
                    id: file.id || '',
                    versionId: file.versionId || '',
                    itemId: file.itemId || '',
                    rawUrn: file.rawUrn || '',
                    versionNumber: file.versionNumber || '',
                    lastModifiedTime: file.lastModifiedTime || '',
                    lastModifiedUserName: file.lastModifiedUserName || '',
                    folderPath: file.folderPath || nextPath.join(' / ')
                });
            }
        });
    }
    if (Array.isArray(node.children)) {
        node.children.forEach(child => collectNodeFiles(child, output, nextPath));
    }
    return output;
}

function findZoneFolderNodes(node, zone, output = []) {
    if (!node || typeof node !== 'object') return output;
    const keywords = CONSTRUCTION_ZONE_FOLDER_KEYWORDS[zone] || [];
    const folderName = normalizeFolderText(getNodeFolderName(node));
    const matched = keywords.some(keyword => folderName.includes(normalizeFolderText(keyword)));
    if (matched) {
        output.push(node);
        return output;
    }
    if (Array.isArray(node.children)) {
        node.children.forEach(child => findZoneFolderNodes(child, zone, output));
    }
    return output;
}

function findZoneModelsFromTree(node, zone) {
    const zoneNodes = findZoneFolderNodes(node, zone);
    let models = zoneNodes.flatMap(folderNode => collectNodeFiles(folderNode, []));
    if (!models.length) {
        models = collectNodeFiles(node, []).filter(model => modelBelongsToZone(model, zone));
    } else {
        models = models.filter(model => modelBelongsToZone(model, zone));
    }
    return dedupeModels(models);
}

function getConstructionStructureAliases(structureName) {
    return CONSTRUCTION_STRUCTURE_MODEL_ALIASES[structureName] || [structureName];
}

const CONSTRUCTION_INSPECTOR_FOLDER_GROUPS = [
    { key: 'temporary', label: '01 가시설', aliases: ['01 가시설', '가시설'] },
    { key: 'new', label: '02 신설구조물', aliases: ['02 신설구조물', '신설구조물'] },
    { key: 'extension', label: '03 증설구조물', aliases: ['03 증설구조물', '증설구조물'] },
    { key: 'etc', label: '04 기타 구조물', aliases: ['04 기타 구조물', '기타 구조물', '기타구조물'] }
];

function findConstructionInspectorGroup(node) {
    if (!node || typeof node !== 'object') return null;
    const nameText = normalizeFolderText(getNodeFolderName(node));
    const pathText = normalizeFolderText(node.path || '');
    return CONSTRUCTION_INSPECTOR_FOLDER_GROUPS.find(group => {
        return group.aliases.some(alias => {
            const normAlias = normalizeFolderText(alias);
            return nameText.includes(normAlias) || pathText.endsWith(normAlias);
        });
    }) || null;
}

function collectConstructionInspectorGroupNodes(node, output = []) {
    if (!node || typeof node !== 'object') return output;
    const group = findConstructionInspectorGroup(node);
    if (group) {
        output.push({ group, node });
        return output;
    }
    if (Array.isArray(node.children)) {
        node.children.forEach(child => collectConstructionInspectorGroupNodes(child, output));
    }
    return output;
}

function getConstructionInspectorChildFolders(folderNode, group) {
    const children = Array.isArray(folderNode?.children) ? folderNode.children : [];
    const folderName = getNodeFolderName(folderNode) || group.label;
    const folders = [{
        key: `${group.key}:${folderNode.folderId || folderNode.path || folderName}:self`,
        name: folderName,
        displayName: `${group.label} 전체`,
        groupKey: group.key,
        groupLabel: group.label,
        path: folderNode.path || folderName,
        folderId: folderNode.folderId || '',
        childCount: children.length,
        files: dedupeModels(collectNodeFiles(folderNode, []))
    }];
    children
        .filter(child => getNodeFolderName(child))
        .forEach((child, index) => {
            const files = dedupeModels(collectNodeFiles(child, []));
            const name = getNodeFolderName(child);
            const path = child.path || [folderNode.path, name].filter(Boolean).join(' / ');
            folders.push({
                key: `${group.key}:${child.folderId || path || name}:${index}`,
                name,
                displayName: name,
                groupKey: group.key,
                groupLabel: group.label,
                path,
                folderId: child.folderId || '',
                childCount: Array.isArray(child.children) ? child.children.length : 0,
                files
            });
        });
    return folders;
}

function collectConstructionStructureFolders(tree) {
    const groups = collectConstructionInspectorGroupNodes(tree, []);
    const seen = new Set();
    const output = [];
    CONSTRUCTION_INSPECTOR_FOLDER_GROUPS.forEach(groupMeta => {
        groups
            .filter(item => item.group.key === groupMeta.key)
            .forEach(item => {
                getConstructionInspectorChildFolders(item.node, groupMeta).forEach(folder => {
                    const dedupeKey = `${folder.groupKey}:${folder.folderId || folder.path || folder.name}`;
                    if (seen.has(dedupeKey)) return;
                    seen.add(dedupeKey);
                    output.push(folder);
                });
            });
    });
    return output;
}

function getTradeLabelFromModelName(fileName) {
    const name = String(fileName || '').toUpperCase();
    if (name.includes('_AM.')) return '건축설비';
    if (name.includes('_C.')) return '토목';
    if (name.includes('_A.')) return '건축';
    if (name.includes('_M.')) return '기계';
    if (name.includes('_E.')) return '전기';
    if (name.includes('_S.')) return '구조';
    if (name.includes('철근')) return '철근';
    return '기타';
}

function getShortModelFileName(fileName) {
    return String(fileName || '').replace(/\.rvt$/i, '');
}

function normalizeConstructionModelUrn(urn) {
    return String(urn || '').replace(/^urn:/i, '');
}

function getConstructionInspectorViewerZoneKey(structure) {
    return structure ? `inspector:${structure.key || structure.name}` : '';
}

function isConstructionInspectorModelLoaded(structure) {
    return !!structure && window._constructionActiveViewerZone === getConstructionInspectorViewerZoneKey(structure);
}

function getConstructionInspectorTradeGroups(structure) {
    const groups = {};
    (structure?.files || []).forEach(file => {
        const trade = getTradeLabelFromModelName(file.name);
        if (!groups[trade]) groups[trade] = [];
        groups[trade].push(file);
    });
    return Object.entries(groups).map(([trade, files]) => ({ trade, files }));
}

function renderConstructionInspectorFiles(structure) {
    const list = document.getElementById('bim-inspector-structure-list');
    if (!list) return;
    if (!structure) {
        list.innerHTML = '<div class="bim-inspector-file-empty">구조물 폴더를 선택하면 하위 폴더와 공종 요약이 표시됩니다.</div>';
        return;
    }
    if (!Array.isArray(structure.files) || !structure.files.length) {
        list.innerHTML = `
            <div class="bim-inspector-folder-card">
                <strong>${escapeHtml(structure.groupLabel || 'Autodesk Docs')}</strong>
                <span>${escapeHtml(structure.name)}</span>
                <small>이 하위 폴더에서 불러올 RVT 파일이 없습니다.</small>
            </div>
        `;
        return;
    }
    const isLoaded = isConstructionInspectorModelLoaded(structure);
    const hiddenUrns = window._constructionInspectorHiddenUrns || {};
    const tradeGroups = getConstructionInspectorTradeGroups(structure);
    list.innerHTML = `
        <div class="bim-inspector-folder-card">
            <strong>${escapeHtml(structure.groupLabel || 'Autodesk Docs')}</strong>
            <span>${escapeHtml(structure.name)}</span>
            <small>하위 폴더 ${structure.childCount || 0}개 · RVT ${structure.files.length}개</small>
        </div>
        ${tradeGroups.map(group => {
        const hiddenCount = group.files.filter(file => hiddenUrns[normalizeConstructionModelUrn(file.urn || '')]).length;
        const isHidden = hiddenCount === group.files.length;
        return `
            <button type="button" class="bim-inspector-file-card ${isLoaded ? 'is-loaded' : ''} ${isHidden ? 'is-hidden' : ''}" data-trade="${escapeHtml(group.trade)}" title="${escapeHtml(group.trade)} 공종 표시/숨김">
                <span class="bim-inspector-file-main">
                    <mark>${escapeHtml(group.trade)}</mark>
                    <strong>${escapeHtml(group.trade)} 공종</strong>
                </span>
                <span class="bim-inspector-file-side">
                    <small>${group.files.length}개 RVT</small>
                    <i class="fas ${isHidden ? 'fa-eye-slash' : 'fa-eye'}" aria-hidden="true"></i>
                </span>
            </button>
        `;
    }).join('')}
    `;
}

function renderConstructionInspectorSelection(structure) {
    const nameEl = document.getElementById('bim-inspector-structure-name');
    const metaEl = document.getElementById('bim-inspector-structure-meta');
    const tagEl = document.getElementById('bim-inspector-trade-tags');
    const openBtn = document.getElementById('bim-inspector-open-model');
    if (!structure) {
        if (nameEl) nameEl.textContent = '모델을 선택해주세요';
        if (metaEl) metaEl.textContent = '상위 폴더 아래 하위 폴더를 선택하면 3D 통합 모델을 확인할 수 있습니다.';
        if (tagEl) tagEl.innerHTML = '';
        if (openBtn) openBtn.disabled = true;
        renderConstructionInspectorFiles(null);
        return;
    }
    const trades = Array.from(new Set((structure.files || []).map(file => getTradeLabelFromModelName(file.name))));
    if (nameEl) nameEl.textContent = structure.name;
    if (metaEl) metaEl.textContent = `${structure.groupLabel || 'Autodesk Docs'} · ${structure.path || structure.name}`;
    if (tagEl) tagEl.innerHTML = trades.map(trade => `<mark>${escapeHtml(trade)}</mark>`).join('');
    if (openBtn) openBtn.disabled = !Array.isArray(structure.files) || !structure.files.length;
    renderConstructionInspectorFiles(structure);
}

function setConstructionInspectorActive(name) {
    const select = document.getElementById('bim-inspector-structure-select');
    if (select && select.value !== name) select.value = name || '';
}

function getSelectedConstructionInspectorStructure() {
    const select = document.getElementById('bim-inspector-structure-select');
    const structures = window._constructionInspectorStructures || [];
    return structures.find(item => item.key === select?.value) || null;
}

function selectConstructionInspectorStructure(key) {
    const select = document.getElementById('bim-inspector-structure-select');
    const structures = window._constructionInspectorStructures || [];
    const structure = structures.find(item => item.key === key) || null;
    if (select) select.value = structure?.key || '';
    renderConstructionInspectorSelection(structure);
    setConstructionInspectorActive(structure?.key || '');
}

function shouldAutoRotateConstructionFile(file) {
    const text = `${file?.folderPath || ''} ${file?.path || ''} ${file?.name || ''}`;
    return [
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
    ].some(target => text.includes(target));
}

function applyConstructionModelAlignmentHints(viewer, files = []) {
    if (!viewer || !Array.isArray(files) || typeof window.applyModelRotation !== 'function') return;
    files.forEach(file => {
        const urn = file?.urn || file?.id || file?.versionId;
        if (!urn) return;
        window.applyModelRotation(viewer, urn, shouldAutoRotateConstructionFile(file));
    });
}

function normalizeConstructionViewerNavigation(viewer) {
    const THREE_NS = window.THREE || (window.Autodesk && Autodesk.Viewing && Autodesk.Viewing.Private && Autodesk.Viewing.Private.THREE);
    if (!viewer || !viewer.navigation || !THREE_NS) return;
    const up = new THREE_NS.Vector3(0, 0, 1);
    try {
        if (typeof viewer.navigation.setWorldUpVector === 'function') {
            viewer.navigation.setWorldUpVector(up, true);
        }
        if (typeof viewer.navigation.setCameraUpVector === 'function') {
            viewer.navigation.setCameraUpVector(up);
        }
        if (typeof viewer.navigation.setUpVector === 'function') {
            viewer.navigation.setUpVector(up);
        }
        if (typeof viewer.navigation.setRequestTransition === 'function') {
            viewer.navigation.setRequestTransition(true);
        }
    } catch (error) {
        console.warn('[Construction Inspector] navigation normalization skipped:', error);
    }
}

function getConstructionThreeNamespace() {
    return window.THREE || (window.Autodesk && Autodesk.Viewing && Autodesk.Viewing.Private && Autodesk.Viewing.Private.THREE) || null;
}

function getConstructionInspectorModels(viewer) {
    if (!viewer) return [];
    if (typeof viewer.getAllModels === 'function') return viewer.getAllModels();
    return viewer.model ? [viewer.model] : [];
}

function clearConstructionInspectorFocus(viewer) {
    if (!viewer) return;
    try {
        getConstructionInspectorModels(viewer).forEach(model => {
            if (typeof viewer.clearThemingColors === 'function') viewer.clearThemingColors(model);
        });
        if (typeof viewer.clearThemingColors === 'function') viewer.clearThemingColors();
        if (typeof viewer.clearSelection === 'function') viewer.clearSelection();
        if (viewer.impl?.visibilityManager && typeof viewer.impl.visibilityManager.aggregateIsolate === 'function') {
            viewer.impl.visibilityManager.aggregateIsolate([]);
        } else if (typeof viewer.isolate === 'function') {
            viewer.isolate([]);
        }
        if (viewer.impl && typeof viewer.impl.invalidate === 'function') viewer.impl.invalidate(true, true, true);
    } catch (error) {
        console.warn('[Construction Inspector] focus reset skipped:', error);
    }
}

function focusConstructionInspectorSearchResults(viewer, results, query) {
    const validResults = (results || []).filter(item => item?.model && Array.isArray(item.dbIds) && item.dbIds.length);
    if (!viewer || !validResults.length) return;

    const THREE_NS = getConstructionThreeNamespace();
    const highlightColor = THREE_NS ? new THREE_NS.Vector4(0.02, 0.72, 1, 1) : null;
    clearConstructionInspectorFocus(viewer);

    try {
        if (viewer.prefs && typeof viewer.prefs.set === 'function') viewer.prefs.set('ghosting', true);
        if (typeof viewer.setGhosting === 'function') viewer.setGhosting(true);
        const aggregateSelection = validResults.map(item => ({ model: item.model, ids: item.dbIds }));
        if (viewer.impl?.visibilityManager && typeof viewer.impl.visibilityManager.aggregateIsolate === 'function') {
            viewer.impl.visibilityManager.aggregateIsolate(aggregateSelection);
        } else if (typeof viewer.isolate === 'function') {
            viewer.isolate(validResults[0].dbIds, validResults[0].model);
        }
        validResults.forEach(item => {
            item.dbIds.forEach(dbId => {
                if (highlightColor && typeof viewer.setThemingColor === 'function') {
                    viewer.setThemingColor(dbId, highlightColor, item.model, true);
                }
            });
        });
        if (typeof viewer.select === 'function') {
            viewer.select(validResults[0].dbIds, validResults[0].model);
        }
        if (typeof viewer.fitToView === 'function') {
            viewer.fitToView(validResults[0].dbIds, validResults[0].model);
        }
        if (viewer.impl && typeof viewer.impl.invalidate === 'function') viewer.impl.invalidate(true, true, true);
        const total = validResults.reduce((sum, item) => sum + item.dbIds.length, 0);
        setConstructionProgressNote(`"${query}" 검색 결과 ${total}개를 격리하고 파란색으로 강조했습니다.`);
    } catch (error) {
        console.warn('[Construction Inspector] search result focus failed:', error);
        setConstructionProgressNote(`"${query}" 검색 결과를 찾았지만 강조 표시 중 오류가 발생했습니다.`);
    }
}

function searchConstructionInspectorModels(viewer, query) {
    const models = getConstructionInspectorModels(viewer);
    if (!models.length) {
        return new Promise(resolve => {
            viewer.search(query, dbIds => resolve([{ model: viewer.model, dbIds: dbIds || [] }]), () => resolve([]), ['name']);
        });
    }

    return Promise.all(models.map(model => new Promise(resolve => {
        const done = dbIds => resolve({ model, dbIds: Array.isArray(dbIds) ? dbIds : [] });
        const fail = () => resolve({ model, dbIds: [] });
        try {
            if (typeof model.search === 'function') {
                model.search(query, done, fail);
            } else if (typeof viewer.search === 'function' && models.length === 1) {
                viewer.search(query, done, fail);
            } else {
                resolve({ model, dbIds: [] });
            }
        } catch (error) {
            console.warn('[Construction Inspector] model search failed:', error);
            fail();
        }
    })));
}

function getConstructionInspectorSelectedPart(viewer) {
    if (!viewer) return null;
    if (typeof viewer.getAggregateSelection === 'function') {
        const aggregate = viewer.getAggregateSelection() || [];
        const first = aggregate.find(item => Array.isArray(item.selection) && item.selection.length);
        if (first) return { model: first.model, dbId: first.selection[0] };
    }
    const selection = typeof viewer.getSelection === 'function' ? viewer.getSelection() : [];
    if (selection.length) return { model: viewer.model || getConstructionInspectorModels(viewer)[0], dbId: selection[0] };
    return null;
}

function getConstructionInspectorInfoPanel() {
    const tools = document.querySelector('.bim-inspector-tools');
    if (!tools) return null;
    let panel = document.getElementById('bim-inspector-part-info');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'bim-inspector-part-info';
        panel.className = 'bim-inspector-part-info';
        tools.insertAdjacentElement('afterend', panel);
    }
    return panel;
}

function renderConstructionInspectorPartInfo(props) {
    const panel = getConstructionInspectorInfoPanel();
    if (!panel) return;
    if (!props) {
        panel.classList.remove('is-collapsed');
        panel.innerHTML = `
            <div class="bim-inspector-part-head">
                <button type="button" class="bim-inspector-part-toggle" title="부재 정보 접기/펼치기" aria-expanded="true">
                    <i class="fas fa-chevron-up"></i>
                </button>
                <div>
                    <span>선택 부재 정보</span>
                    <strong>부재를 선택해주세요</strong>
                </div>
            </div>
            <div class="bim-inspector-part-body">
                <div class="bim-inspector-part-empty">3D 뷰어에서 부재를 선택하면 정보가 표시됩니다.</div>
            </div>
        `;
        return;
    }
    const propertyList = (props.properties || [])
        .filter(item => item && item.displayName && item.displayValue !== undefined && item.displayValue !== null && String(item.displayValue).trim() !== '');
    panel.innerHTML = `
        <div class="bim-inspector-part-head">
            <button type="button" class="bim-inspector-part-toggle" title="부재 정보 접기/펼치기" aria-expanded="${panel.classList.contains('is-collapsed') ? 'false' : 'true'}">
                <i class="fas ${panel.classList.contains('is-collapsed') ? 'fa-chevron-down' : 'fa-chevron-up'}"></i>
            </button>
            <div>
                <span>선택 부재 정보</span>
                <strong>${escapeHtml(props.name || `dbId ${props.dbId}`)}</strong>
            </div>
        </div>
        <div class="bim-inspector-part-body">
            <dl>
                ${propertyList.map(item => `
                    <dt>${escapeHtml(item.displayName)}</dt>
                    <dd>${escapeHtml(String(item.displayValue))}</dd>
                `).join('')}
            </dl>
        </div>
    `;
}

function setConstructionInspectorActiveTool(tool) {
    document.querySelectorAll('.bim-inspector-tools [data-inspector-tool]').forEach(button => {
        const isActive = button.dataset.inspectorTool === tool;
        button.classList.toggle('active', isActive);
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
}

function resetConstructionViewerFocus() {
    const viewer = window.constructionProgressViewer || window.constructionMiniViewer;
    if (!viewer || !viewer.impl) {
        setConstructionProgressNote('초기화할 3D 뷰어가 아직 준비되지 않았습니다.');
        return;
    }
    clearConstructionInspectorFocus(viewer);
    setConstructionInspectorActiveTool('');
    try {
        if (typeof viewer.showAll === 'function') viewer.showAll();
        if (typeof viewer.fitToView === 'function') viewer.fitToView();
        if (viewer.impl && typeof viewer.impl.invalidate === 'function') viewer.impl.invalidate(true, true, true);
        resizeConstructionViewCube();
    } catch (error) {
        console.warn('[Construction Viewer] reset focus failed:', error);
    }
    setConstructionProgressNote('검색 강조, 선택, 격리 상태를 초기화했습니다.');
}

function toggleConstructionInspectorPartInfo() {
    const panel = document.getElementById('bim-inspector-part-info');
    if (!panel) return;
    const collapsed = !panel.classList.contains('is-collapsed');
    panel.classList.toggle('is-collapsed', collapsed);
    const button = panel.querySelector('.bim-inspector-part-toggle');
    const icon = button?.querySelector('i');
    if (button) button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    if (icon) {
        icon.classList.toggle('fa-chevron-down', collapsed);
        icon.classList.toggle('fa-chevron-up', !collapsed);
    }
}

function hideConstructionInspectorPartInfo() {
    const panel = document.getElementById('bim-inspector-part-info');
    if (panel) panel.remove();
    setConstructionInspectorActiveTool('');
    window._constructionInspectorPropertiesOpen = false;
}

function showConstructionInspectorSelectedProperties(viewer) {
    const selected = getConstructionInspectorSelectedPart(viewer);
    if (!selected?.model || !selected.dbId) {
        renderConstructionInspectorPartInfo(null);
        setConstructionProgressNote('부재 정보를 보려면 3D 뷰어에서 부재를 먼저 선택해주세요.');
        return;
    }
    try {
        selected.model.getProperties(selected.dbId, props => {
            renderConstructionInspectorPartInfo(props);
            window._constructionInspectorPropertiesOpen = true;
            if (typeof viewer.fitToView === 'function') viewer.fitToView([selected.dbId], selected.model);
            setConstructionProgressNote(`선택한 부재 정보를 BIM 모델 간편조회 패널에 표시했습니다.`);
        }, error => {
            console.warn('[Construction Inspector] getProperties failed:', error);
            setConstructionProgressNote('선택한 부재의 속성을 불러오지 못했습니다.');
        });
    } catch (error) {
        console.warn('[Construction Inspector] property read failed:', error);
        setConstructionProgressNote('부재 정보 조회 중 오류가 발생했습니다.');
    }
}

function getConstructionInspectorLoadedModel(urn) {
    const key = normalizeConstructionModelUrn(urn);
    const loaded = window._constructionInspectorLoadedModels || {};
    return loaded[key] || null;
}

function setConstructionInspectorFileVisibility(urn, visible, options = {}) {
    const viewer = getConstructionInspectorActiveViewer();
    const model = getConstructionInspectorLoadedModel(urn);
    if (!viewer || !model) {
        if (!options.silent) setConstructionProgressNote('공종별 가시성은 3D 모델 보기로 통합 모델을 불러온 뒤 조절할 수 있습니다.');
        return false;
    }

    try {
        if (visible && typeof viewer.showModel === 'function') {
            viewer.showModel(model.id);
        } else if (!visible && typeof viewer.hideModel === 'function') {
            viewer.hideModel(model.id);
        } else if (model.visibilityManager && typeof model.visibilityManager.setNodeOff === 'function') {
            model.visibilityManager.setNodeOff(1, !visible);
        }
        if (viewer.impl && typeof viewer.impl.invalidate === 'function') {
            viewer.impl.invalidate(true, true, true);
        }
        window._constructionInspectorHiddenUrns = window._constructionInspectorHiddenUrns || {};
        const key = normalizeConstructionModelUrn(urn);
        if (visible) delete window._constructionInspectorHiddenUrns[key];
        else window._constructionInspectorHiddenUrns[key] = true;
        if (!options.silent) {
            renderConstructionInspectorFiles(getSelectedConstructionInspectorStructure());
            setConstructionProgressNote(`${visible ? '표시' : '숨김'} 상태를 공종 카드에 반영했습니다.`);
        }
        return true;
    } catch (error) {
        console.warn('[Construction Inspector] visibility toggle failed:', error);
        if (!options.silent) setConstructionProgressNote('공종 가시성 변경 중 오류가 발생했습니다.');
        return false;
    }
}

function getConstructionInspectorActiveViewer() {
    const viewer = window.constructionProgressViewer || window.constructionMiniViewer;
    if (!viewer || !viewer.impl) {
        setConstructionProgressNote('먼저 BIM 모델 간편조회에서 구조물을 선택하고 3D 모델 보기를 실행해주세요.');
        return null;
    }
    return viewer;
}

async function activateConstructionInspectorExtension(viewer, extensionId, activateArg = null) {
    const current = typeof viewer.getExtension === 'function' ? viewer.getExtension(extensionId) : null;
    const extension = current || (typeof viewer.loadExtension === 'function' ? await viewer.loadExtension(extensionId) : null);
    if (!extension) return null;
    if (typeof extension.activate === 'function') {
        if (activateArg) extension.activate(activateArg);
        else extension.activate();
    }
    return extension;
}

async function runConstructionInspectorTool(tool) {
    const viewer = getConstructionInspectorActiveViewer();
    if (!viewer) return;

    if (tool === 'properties' && window._constructionInspectorPropertiesOpen) {
        hideConstructionInspectorPartInfo();
        setConstructionProgressNote('부재 정보 패널을 닫았습니다.');
        return;
    }

    setConstructionInspectorActiveTool(tool);

    try {
        if (tool === 'search') {
            const query = window.prompt('검색할 부재명 또는 속성값을 입력하세요.');
            if (!query) return;
            const results = await searchConstructionInspectorModels(viewer, query);
            const total = results.reduce((sum, item) => sum + (item.dbIds?.length || 0), 0);
            if (!total) {
                clearConstructionInspectorFocus(viewer);
                setConstructionProgressNote(`"${query}" 검색 결과가 없습니다.`);
                return;
            }
            focusConstructionInspectorSearchResults(viewer, results, query);
            return;
        }

        if (tool === 'measure') {
            await activateConstructionInspectorExtension(viewer, 'Autodesk.Measure');
            setConstructionProgressNote('3D 뷰어 측정 도구를 켰습니다. 모델 위 두 지점을 선택해 거리와 치수를 확인하세요.');
            return;
        }

        if (tool === 'section') {
            await activateConstructionInspectorExtension(viewer, 'Autodesk.Section');
            setConstructionProgressNote('3D 뷰어 단면 도구를 켰습니다. 뷰어 도구막대에서 단면 방향과 위치를 조절하세요.');
            return;
        }

        if (tool === 'properties') {
            showConstructionInspectorSelectedProperties(viewer);
        }
    } catch (error) {
        console.warn('[Construction Inspector] tool activation failed:', tool, error);
        setConstructionProgressNote('3D 뷰어 도구를 실행하지 못했습니다. 모델 로드가 완료된 뒤 다시 시도해주세요.');
    }
}

async function loadConstructionInspectorStructureViewer(structure = null) {
    const target = structure || getSelectedConstructionInspectorStructure();
    if (!target || !Array.isArray(target.files) || !target.files.length) {
        setConstructionProgressNote('선택한 구조물 폴더에서 불러올 RVT 파일을 찾지 못했습니다.');
        return false;
    }

    openConstructionViewerLayer('new');
    setConstructionViewerTitle(`${target.name} 통합 3D Viewer`);
    setConstructionProgressNote(`<강북정수장 증설공사 BIM 용역>의 ${target.name} 폴더 공종 파일 ${target.files.length}개를 병합 로드 중입니다.`);

    const viewer = await getConstructionMiniViewer();
    if (!viewer || !viewer.impl) {
        setConstructionProgressNote('미니맵 3D 뷰어를 초기화하지 못했습니다.');
        return false;
    }

    try {
        if (typeof viewer.getAllModels === 'function') {
            viewer.getAllModels().forEach(model => viewer.unloadModel(model));
        }
    } catch (error) {
        console.warn('[Construction Inspector] failed to clear previous models:', error);
    }

    const viewerModule = await import('./viewer.js');
    const loadedModels = await viewerModule.loadAggregated(viewer, target.files);
    normalizeConstructionViewerNavigation(viewer);
    window._constructionActiveModelUrns = target.files.map(file => file.urn).filter(Boolean);
    window._constructionActiveModelNames = target.files.map(file => file.name).filter(Boolean);
    window._constructionActiveViewerZone = getConstructionInspectorViewerZoneKey(target);
    window._constructionInspectorLoadedModels = {};
    window._constructionInspectorHiddenUrns = {};
    target.files.forEach((file, index) => {
        const urn = file?.urn || file?.id || file?.versionId;
        const model = loadedModels[index];
        if (urn && model) window._constructionInspectorLoadedModels[normalizeConstructionModelUrn(urn)] = model;
    });
    renderConstructionInspectorSelection(target);

    try {
        if (typeof viewer.resize === 'function') viewer.resize();
        if (typeof viewer.fitToView === 'function') viewer.fitToView();
        if (viewer.impl && typeof viewer.impl.invalidate === 'function') viewer.impl.invalidate(true, true, true);
        resizeConstructionViewCube();
    } catch (error) {
        console.warn('[Construction Inspector] viewer fit failed:', error);
    }

    const popup = document.getElementById('model-visibility-popup');
    if (popup) {
        popup.style.display = 'none';
        window._modelVisibilityTargetViewer = null;
    }
    setConstructionProgressNote(`${target.name} 폴더의 공종 파일 ${target.files.length}개를 통합 표시 중입니다. 왼쪽 공종 파일 카드에서 공종별 표시/숨김을 조절할 수 있습니다.`);
    return true;
}

async function initConstructionInspectorPanel() {
    const select = document.getElementById('bim-inspector-structure-select');
    const list = document.getElementById('bim-inspector-structure-list');
    const openBtn = document.getElementById('bim-inspector-open-model');
    if (!select || !list) return;
    if (select.dataset.inspectorBound) return;
    select.dataset.inspectorBound = 'true';

    try {
        const tree = await fetchConstructionRvtTree();
        const structures = collectConstructionStructureFolders(tree)
            .sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }));
        window._constructionInspectorStructures = structures;
        if (!structures.length) {
            select.innerHTML = '<option value="">구조물 폴더 없음</option>';
            list.innerHTML = '<button type="button">표시할 구조물 폴더가 없습니다.</button>';
            renderConstructionInspectorSelection(null);
            return;
        }
        select.innerHTML = '<option value="">모델을 선택해주세요</option>' +
            CONSTRUCTION_INSPECTOR_FOLDER_GROUPS.map(group => {
                const items = structures.filter(item => item.groupKey === group.key);
                if (!items.length) return '';
                return `
                    <optgroup label="${escapeHtml(group.label)}">
                        ${items.map(item => `<option value="${escapeHtml(item.key)}">${escapeHtml(item.displayName || item.name)}</option>`).join('')}
                    </optgroup>
                `;
            }).join('');
        selectConstructionInspectorStructure('');
    } catch (error) {
        console.warn('[Construction Inspector] failed to initialize:', error);
        select.innerHTML = '<option value="">구조물 폴더 로드 실패</option>';
        list.innerHTML = '<button type="button">Autodesk Docs 구조물 폴더를 불러오지 못했습니다.</button>';
        renderConstructionInspectorSelection(null);
    }

    select.addEventListener('change', () => selectConstructionInspectorStructure(select.value));
    list.addEventListener('click', event => {
        const btn = event.target.closest('button.bim-inspector-file-card');
        if (!btn) return;
        const structure = getSelectedConstructionInspectorStructure();
        if (structure && isConstructionInspectorModelLoaded(structure)) {
            const trade = btn.dataset.trade || '';
            const tradeFiles = (structure.files || []).filter(file => getTradeLabelFromModelName(file.name) === trade);
            const hidden = btn.classList.contains('is-hidden');
            tradeFiles.forEach(file => setConstructionInspectorFileVisibility(file.urn || '', hidden, { silent: true }));
            renderConstructionInspectorFiles(structure);
            setConstructionProgressNote(`${trade} 공종 ${tradeFiles.length}개 모델을 ${hidden ? '표시' : '숨김'} 처리했습니다.`);
            return;
        }
        loadConstructionInspectorStructureViewer();
    });
    if (openBtn) {
        openBtn.addEventListener('click', () => loadConstructionInspectorStructureViewer());
    }
    document.querySelectorAll('.bim-inspector-tools [data-inspector-tool]').forEach(button => {
        if (button.dataset.inspectorToolBound) return;
        button.dataset.inspectorToolBound = 'true';
        button.setAttribute('aria-pressed', 'false');
        button.addEventListener('click', () => runConstructionInspectorTool(button.dataset.inspectorTool));
    });
    document.addEventListener('click', event => {
        const toggle = event.target.closest('.bim-inspector-part-toggle');
        if (!toggle) return;
        event.preventDefault();
        toggleConstructionInspectorPartInfo();
    });
}

function scoreConstructionStructureModel(model, structureName, zone = 'new') {
    const aliases = getConstructionStructureAliases(structureName).map(normalizeFolderText).filter(Boolean);
    const nameText = normalizeFolderText(model.name || '');
    const folderText = normalizeFolderText(model.folderPath || '');
    const combined = `${nameText} ${folderText}`;
    let score = 0;
    aliases.forEach(alias => {
        if (nameText.includes(alias)) score += 100;
        if (folderText.includes(alias)) score += 35;
        if (combined.includes(alias)) score += 15;
    });
    if (modelBelongsToZone(model, zone)) score += 25;
    if (/_C\.rvt$/i.test(model.name || '')) score += 20;
    if (/\.rvt$/i.test(model.name || '')) score += 5;
    return score;
}

async function getConstructionStructureModel(structureName, zone = 'new') {
    const cacheKey = `_constructionStructureModel_${zone}_${structureName}`;
    if (window[cacheKey]) return window[cacheKey];
    const tree = await fetchConstructionRvtTree();
    const allModels = collectNodeFiles(tree, []);
    const ranked = allModels
        .map(model => ({ model, score: scoreConstructionStructureModel(model, structureName, zone) }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score);
    const best = ranked[0]?.model || null;
    window[cacheKey] = best;
    if (best) {
        console.log('[Construction Live] structure model:', structureName, best.name, best.urn);
    } else {
        console.warn('[Construction Live] structure model not found:', structureName);
    }
    return best;
}

async function getConstructionStructureModels(structureName, zone = 'new') {
    const cacheKey = `_constructionStructureModels_${zone}_${structureName}`;
    if (window[cacheKey]) return window[cacheKey];
    const tree = await fetchConstructionRvtTree();
    const allModels = collectNodeFiles(tree, []);
    const ranked = allModels
        .map(model => ({ model, score: scoreConstructionStructureModel(model, structureName, zone) }))
        .filter(item => item.score >= 100)
        .sort((a, b) => b.score - a.score || String(a.model.name || '').localeCompare(String(b.model.name || ''), 'ko'));
    const models = dedupeModels(ranked.map(item => item.model));
    window[cacheKey] = models;
    if (models.length) {
        console.log('[Construction Live] structure models:', structureName, models.map(model => model.name));
    } else {
        console.warn('[Construction Live] structure models not found:', structureName);
    }
    return models;
}

function dedupeModels(models) {
    const seen = new Set();
    return models.filter(model => {
        const key = model.urn || model.versionId || model.name;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function modelBelongsToZone(model, zone) {
    const ownKeywords = CONSTRUCTION_ZONE_FOLDER_KEYWORDS[zone] || [];
    const otherKeywords = Object.entries(CONSTRUCTION_ZONE_FOLDER_KEYWORDS)
        .filter(([key]) => key !== zone)
        .flatMap(([, keywords]) => keywords);
    const text = normalizeFolderText(`${model.folderPath || ''} ${model.name || ''}`);
    const hasOwnKeyword = ownKeywords.some(keyword => text.includes(normalizeFolderText(keyword)));
    const hasOtherKeyword = otherKeywords.some(keyword => text.includes(normalizeFolderText(keyword)));
    return hasOwnKeyword && !hasOtherKeyword;
}

async function fetchConstructionRvtTree() {
    if (window._constructionRvtTreeCache) return window._constructionRvtTreeCache;
    const url = '/api/models/tree';
    const resp = await fetch(url, { credentials: 'same-origin' });
    if (!resp.ok) throw new Error(`RVT tree fetch failed: HTTP ${resp.status}`);
    const tree = await resp.json();
    window._constructionRvtTreeCache = tree;
    return tree;
}

async function getConstructionZoneModels(zone) {
    const cacheKey = `_constructionZoneModels_${zone}`;
    if (Array.isArray(window[cacheKey])) return window[cacheKey];
    const tree = await fetchConstructionRvtTree();
    const models = findZoneModelsFromTree(tree, zone);
    console.log('[Construction Progress] zone models:', zone, models.map(model => model.name));
    window[cacheKey] = models;
    return models;
}

function setActiveConstructionZone(zone = '') {
    document.querySelectorAll('.bim-zone').forEach(btn => {
        btn.classList.toggle('active', !!zone && btn.dataset.zone === zone);
    });
    const note = document.getElementById('bim-zone-focus-note');
    const zoneMeta = CONSTRUCTION_ZONES[zone];
    if (note) note.textContent = zoneMeta ? `${zoneMeta.label} 영역 진행 공정을 표시 중입니다.` : '영역을 선택하면 진행 구조물이 강조됩니다.';
    renderConstructionGantt(zone);
    renderProgressDonuts(zone);
}

function setConstructionProgressNote(message) {
    const note = document.getElementById('bim-zone-focus-note');
    if (note && message) note.textContent = message;
}

function setConstructionViewerTitle(message) {
    const title = document.getElementById('bim-progress-viewer-title');
    if (title && message) title.textContent = message;
}

function getConstructionViewStateKey(zone) {
    return CONSTRUCTION_VIEW_STATE_PREFIX + String(zone || 'default');
}

function vectorToConstructionViewArray(vector) {
    if (!vector) return null;
    return [Number(vector.x) || 0, Number(vector.y) || 0, Number(vector.z) || 0];
}

function getConstructionViewerCameraState(viewer) {
    const nav = viewer?.navigation;
    if (!nav) return null;
    try {
        return {
            position: vectorToConstructionViewArray(nav.getPosition && nav.getPosition()),
            target: vectorToConstructionViewArray(nav.getTarget && nav.getTarget()),
            up: vectorToConstructionViewArray(nav.getCameraUpVector && nav.getCameraUpVector()),
            pivot: vectorToConstructionViewArray(nav.getPivotPoint && nav.getPivotPoint())
        };
    } catch (error) {
        console.warn('[Construction Progress] camera state capture skipped:', error);
        return null;
    }
}

function saveConstructionViewerState(zone) {
    const viewer = window.constructionProgressViewer;
    const stateKey = zone || window._constructionActiveViewerZone || 'default';
    const zoneMeta = CONSTRUCTION_ZONES[stateKey];
    if (!viewer || typeof viewer.getState !== 'function') {
        setConstructionProgressNote('저장할 3D 뷰어 시점을 찾지 못했습니다.');
        return false;
    }
    try {
        const state = viewer.getState();
        state.__constructionCamera = getConstructionViewerCameraState(viewer);
        localStorage.setItem(getConstructionViewStateKey(stateKey), JSON.stringify(state));
        setConstructionProgressNote(`${zoneMeta ? zoneMeta.label : '현재'} 뷰 시점을 저장했습니다.`);
        return true;
    } catch (error) {
        console.warn('[Construction Progress] save view state failed:', error);
        setConstructionProgressNote('뷰 시점 저장 중 오류가 발생했습니다.');
        return false;
    }
}

function restoreConstructionViewerState(zone, viewer) {
    if (!viewer) return false;
    try {
        const raw = localStorage.getItem(getConstructionViewStateKey(zone));
        if (!raw) return false;
        const state = JSON.parse(raw);
        const restored = typeof viewer.restoreState === 'function' ? viewer.restoreState(state, null, true) : false;
        const camera = state.__constructionCamera;
        const THREE_NS = window.THREE || (window.Autodesk && Autodesk.Viewing && Autodesk.Viewing.Private && Autodesk.Viewing.Private.THREE);
        if (camera && viewer.navigation && THREE_NS) {
            const toVector = arr => Array.isArray(arr) ? new THREE_NS.Vector3(arr[0], arr[1], arr[2]) : null;
            const position = toVector(camera.position);
            const target = toVector(camera.target);
            const up = toVector(camera.up);
            const pivot = toVector(camera.pivot);
            if (position && target && typeof viewer.navigation.setView === 'function') {
                viewer.navigation.setView(position, target);
            }
            if (up && typeof viewer.navigation.setCameraUpVector === 'function') {
                viewer.navigation.setCameraUpVector(up);
            }
            if (pivot && typeof viewer.navigation.setPivotPoint === 'function') {
                viewer.navigation.setPivotPoint(pivot, true, true);
            }
            if (viewer.impl && typeof viewer.impl.invalidate === 'function') viewer.impl.invalidate(true, true, true);
            return true;
        }
        return !!restored;
    } catch (error) {
        console.warn('[Construction Progress] restore view state failed:', error);
        return false;
    }
}

function hideConstructionMiniViewerToolbar(viewer) {
    try {
        if (viewer && viewer.toolbar && viewer.toolbar.container) {
            viewer.toolbar.container.style.display = 'none';
        }
        const container = document.getElementById('bim-progress-mini-viewer');
        if (container) {
            container.querySelectorAll('.adsk-toolbar, .adsk-control-group').forEach(el => {
                el.style.display = 'none';
            });
        }
    } catch (error) {
        console.warn('[Construction Progress] toolbar hide skipped:', error);
    }
}

function resizeConstructionViewCube() {
    const container = document.getElementById('bim-progress-mini-viewer');
    if (!container) return;
    const cube = container.querySelector('.viewcubeWrapper, .ViewCubeUi, .adsk-viewcube, .viewcube');
    if (!cube) return;
    cube.style.transform = 'scale(0.68)';
    cube.style.transformOrigin = 'top right';
    cube.style.top = '8px';
    cube.style.right = '8px';
    cube.style.left = 'auto';
    ['.viewcube', '.adsk-viewcube'].forEach(selector => {
        cube.querySelectorAll(selector).forEach(child => {
            child.style.transform = '';
            child.style.transformOrigin = '';
        });
    });
}

async function getConstructionMiniViewer() {
    const container = await ensureConstructionViewerHostVisible();
    if (!container) return null;

    if (window.constructionProgressViewer && window.constructionProgressViewer.impl) {
        hideConstructionMiniViewerToolbar(window.constructionProgressViewer);
        resizeConstructionViewCube();
        return window.constructionProgressViewer;
    }

    const viewerModule = await import('./viewer.js');
    if (typeof viewerModule.initViewer !== 'function') return null;

    const viewer = await viewerModule.initViewer(container, true);
    if (!viewer || !viewer.impl) return null;
    hideConstructionMiniViewerToolbar(viewer);
    resizeConstructionViewCube();
    if (window.Autodesk && Autodesk.Viewing && Autodesk.Viewing.TOOLBAR_CREATED_EVENT && typeof viewer.addEventListener === 'function') {
        viewer.addEventListener(Autodesk.Viewing.TOOLBAR_CREATED_EVENT, () => {
            hideConstructionMiniViewerToolbar(viewer);
            resizeConstructionViewCube();
        });
    }
    setTimeout(resizeConstructionViewCube, 500);
    window.constructionProgressViewer = viewer;
    return viewer;
}

async function ensureConstructionViewerHostVisible() {
    let container = document.getElementById('bim-progress-mini-viewer');
    const dashboard = document.getElementById('construction-bim-dashboard');
    const isHidden = (() => {
        try {
            return !dashboard || window.getComputedStyle(dashboard).display === 'none';
        } catch (error) {
            return !!dashboard && dashboard.style.display === 'none';
        }
    })();

    if (isHidden && typeof window.switchTab === 'function') {
        try {
            await Promise.resolve(window.switchTab('construction'));
        } catch (error) {
            console.warn('[Construction Progress] switch to viewer tab failed:', error);
        }
    } else if (dashboard) {
        dashboard.style.display = 'grid';
        dashboard.style.position = 'relative';
        dashboard.style.zIndex = '10';
    }

    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    container = document.getElementById('bim-progress-mini-viewer');
    if (container && typeof container.getBoundingClientRect === 'function') {
        const rect = container.getBoundingClientRect();
        if ((rect.width <= 0 || rect.height <= 0) && dashboard) {
            dashboard.style.display = 'grid';
            await new Promise(resolve => setTimeout(resolve, 80));
        }
    }
    return document.getElementById('bim-progress-mini-viewer');
}

function openConstructionViewerLayer(zone) {
    const map = document.getElementById('bim-progress-map');
    const zoneMeta = CONSTRUCTION_ZONES[zone];
    if (map) map.classList.add('is-viewer-open');
    setConstructionViewerTitle(`${zoneMeta ? zoneMeta.label : '선택 영역'} 3D Viewer`);
}

function closeConstructionViewerLayer() {
    const map = document.getElementById('bim-progress-map');
    if (map) map.classList.remove('is-viewer-open');
    setActiveConstructionZone('');
    const channels = window._constructionLiveCctvChannels || [];
    if (channels.length) renderConstructionLiveCctvCards(channels);
}

async function openConstructionZoneViewer(zone) {
    const zoneMeta = CONSTRUCTION_ZONES[zone];
    if (!zoneMeta) return false;

    openConstructionViewerLayer(zone);
    setConstructionProgressNote(`<강북정수장 증설공사 BIM 용역>의 ${zoneMeta.label} 폴더 파일을 찾는 중입니다.`);
    const models = await getConstructionZoneModels(zone);
    if (!models.length) {
        setConstructionProgressNote(`${zoneMeta.label} 폴더에서 불러올 RVT 파일을 찾지 못했습니다.`);
        return false;
    }

    setConstructionProgressNote(`${zoneMeta.label} 폴더의 모델 ${models.length}개를 미니맵 뷰어에 불러오는 중입니다.`);
    const viewer = await getConstructionMiniViewer();
    if (!viewer || !viewer.impl) {
        setConstructionProgressNote('미니맵 3D 뷰어를 초기화하지 못했습니다.');
        return false;
    }

    if (window._constructionActiveViewerZone === zone && typeof viewer.fitToView === 'function') {
        try {
            if (typeof viewer.resize === 'function') viewer.resize();
            viewer.fitToView();
            setConstructionProgressNote(`${zoneMeta.label} 폴더 모델 ${models.length}개를 표시 중입니다.`);
            return true;
        } catch (error) {
            console.warn('[Construction Progress] fit existing zone failed:', error);
        }
    }

    const viewerModule = await import('./viewer.js');
    if (typeof viewerModule.loadAggregated !== 'function') {
        setConstructionProgressNote('모델 병합 로더를 찾을 수 없습니다.');
        return false;
    }

    if (window._constructionActiveViewerZone && window._constructionActiveViewerZone !== zone && typeof viewer.getAllModels === 'function') {
        try {
            viewer.getAllModels().forEach(model => viewer.unloadModel(model));
        } catch (error) {
            console.warn('[Construction Progress] failed to clear previous mini viewer models:', error);
        }
    }

    await viewerModule.loadAggregated(viewer, models);
    window._constructionActiveModelUrns = models.map(model => model.urn || model.versionId || model.id).filter(Boolean);
    window._constructionActiveModelNames = models.map(model => model.name).filter(Boolean);
    window._constructionActiveViewerZone = zone;

    try {
        if (typeof viewer.resize === 'function') viewer.resize();
        const restored = restoreConstructionViewerState(zone, viewer);
        if (!restored && typeof viewer.fitToView === 'function') viewer.fitToView();
        if (viewer.impl && typeof viewer.impl.invalidate === 'function') {
            viewer.impl.invalidate(true, true, true);
        }
        resizeConstructionViewCube();
    } catch (error) {
        console.warn('[Construction Progress] viewer fit failed:', error);
    }

    setConstructionProgressNote(`${zoneMeta.label} 폴더 모델 ${models.length}개를 표시 중입니다.`);
    return true;
}

async function openConstructionStructureViewer(structureName, zone = 'new') {
    const zoneMeta = CONSTRUCTION_ZONES[zone] || CONSTRUCTION_ZONES.new;
    openConstructionViewerLayer(zone);
    setConstructionViewerTitle(`${structureName} 3D Viewer`);
    setConstructionProgressNote(`<강북정수장 증설공사 BIM 용역>에서 ${structureName} RVT 모델을 찾는 중입니다.`);

    const models = await getConstructionStructureModels(structureName, zone);
    if (!models.length) {
        setConstructionProgressNote(`${structureName}과 일치하는 RVT 파일을 찾지 못해 ${zoneMeta.label} 구역 모델로 이동합니다.`);
        return openConstructionZoneViewer(zone);
    }

    const viewer = await getConstructionMiniViewer();
    if (!viewer || !viewer.impl) {
        setConstructionProgressNote('미니맵 3D 뷰어를 초기화하지 못했습니다.');
        return false;
    }

    try {
        if (typeof viewer.getAllModels === 'function') {
            viewer.getAllModels().forEach(existingModel => viewer.unloadModel(existingModel));
        } else if (viewer.model && typeof viewer.unloadModel === 'function') {
            viewer.unloadModel(viewer.model);
        }
    } catch (error) {
        console.warn('[Construction Live] failed to clear previous structure model:', error);
    }

    const viewerModule = await import('./viewer.js');
    if (models.length > 1 && typeof viewerModule.loadAggregated !== 'function') {
        setConstructionProgressNote('모델 병합 로더를 찾을 수 없습니다.');
        return false;
    }
    if (models.length === 1 && typeof viewerModule.loadModelMulti !== 'function') {
        setConstructionProgressNote('단일 모델 로더를 찾을 수 없습니다.');
        return false;
    }

    setConstructionProgressNote(`<강북정수장 증설공사 BIM 용역>의 ${structureName} 공종별 모델 ${models.length}개를 불러오는 중입니다.`);
    if (models.length > 1) {
        await viewerModule.loadAggregated(viewer, models);
    } else {
        await viewerModule.loadModelMulti(viewer, models[0].urn, { preserveView: false });
    }
    window._constructionActiveModelUrns = models.map(model => model.urn || model.versionId || model.id).filter(Boolean);
    window._constructionActiveModelNames = models.map(model => model.name).filter(Boolean);
    const viewStateKey = `structure:${structureName}`;
    window._constructionActiveViewerZone = viewStateKey;

    try {
        if (typeof viewer.resize === 'function') viewer.resize();
        const restored = restoreConstructionViewerState(viewStateKey, viewer);
        if (!restored && typeof viewer.fitToView === 'function') viewer.fitToView();
        if (viewer.impl && typeof viewer.impl.invalidate === 'function') {
            viewer.impl.invalidate(true, true, true);
        }
        resizeConstructionViewCube();
    } catch (error) {
        console.warn('[Construction Live] structure viewer fit failed:', error);
    }

    setConstructionViewerTitle(`${structureName} 3D Viewer`);
    setConstructionProgressNote(`<강북정수장 증설공사 BIM 용역>의 ${structureName} 공종별 모델 ${models.length}개를 표시 중입니다.`);
    return true;
}

async function reloadActiveConstructionZoneModels() {
    const zone = window._constructionActiveViewerZone || '';
    const zoneMeta = CONSTRUCTION_ZONES[zone];
    if (!zoneMeta) {
        setConstructionProgressNote('먼저 우선시공분 또는 본공사 영역을 선택해 주세요.');
        return;
    }
    const viewer = window.constructionProgressViewer;
    if (viewer && typeof viewer.getAllModels === 'function') {
        try {
            viewer.getAllModels().forEach(model => viewer.unloadModel(model));
        } catch (error) {
            console.warn('[Construction Progress] failed to clear models before merge reload:', error);
        }
    }
    window._constructionActiveViewerZone = '';
    await openConstructionZoneViewer(zone);
}

async function openConstructionMergePanel() {
    const zone = window._constructionActiveViewerZone || '';
    const zoneMeta = CONSTRUCTION_ZONES[zone];
    const viewer = window.constructionProgressViewer;
    if (!zoneMeta || !viewer) {
        setConstructionProgressNote('먼저 우선시공분 또는 본공사 영역을 선택해 주세요.');
        return;
    }

    if (typeof window.refreshGlobalVisibilityPopup === 'function') {
        const mainUrn = Array.isArray(window._constructionActiveModelUrns) ? window._constructionActiveModelUrns[0] : '';
        await window.refreshGlobalVisibilityPopup(mainUrn, [], viewer);
        setConstructionProgressNote(`${zoneMeta.label} 뷰어의 모델 병합 목록을 열었습니다.`);
        return;
    }

    await reloadActiveConstructionZoneModels();
}

async function focusConstructionZone(zone) {
    setActiveConstructionZone(zone);
    const zoneMeta = CONSTRUCTION_ZONES[zone];
    if (!zoneMeta) return;
    try {
        const opened = await openConstructionZoneViewer(zone);
        if (!opened) {
            console.info(`[Construction Progress] ${zoneMeta.label} 영역 선택. Viewer model mapping is not configured.`);
        }
    } catch (error) {
        console.error('[Construction Progress] Failed to open zone viewer:', error);
        setConstructionProgressNote(`${zoneMeta.label} 3D 모델 이동 중 오류가 발생했습니다.`);
    }
}

function updateLinkedCctvPanel(structureName) {
    const grid = document.getElementById('bim-live-cctv-grid');
    if (!grid) return;
    grid.dataset.activeStructure = structureName || '';
    const channels = window._constructionLiveCctvChannels || [];
    if (channels.length) renderConstructionLiveCctvCards(channels, structureName);
}

function getConstructionCctvProxyUrl(rawStreamUrl) {
    if (!rawStreamUrl) return '';
    if (typeof window.getPathProxyUrl === 'function') return window.getPathProxyUrl(rawStreamUrl);
    if (rawStreamUrl.startsWith('/api/cctv/proxy/')) return rawStreamUrl;
    try {
        const url = new URL(rawStreamUrl);
        return `/api/cctv/proxy/${url.protocol.replace(':', '')}/${url.host}${url.pathname}${url.search}`;
    } catch (error) {
        return rawStreamUrl;
    }
}

function inferConstructionCctvStructure(channel, fallbackIndex = 0) {
    const text = normalizeFolderText(`${channel?.modelName || ''} ${channel?.title || ''} ${channel?.name || ''}`);
    const matched = CONSTRUCTION_LIVE_STRUCTURES.find(structure => {
        return getConstructionStructureAliases(structure)
            .map(normalizeFolderText)
            .some(alias => alias && text.includes(alias));
    });
    return matched || CONSTRUCTION_LIVE_STRUCTURES[fallbackIndex % CONSTRUCTION_LIVE_STRUCTURES.length];
}

function normalizeConstructionCctvChannels(channels = []) {
    return channels
        .filter(channel => channel && channel.streamUrl)
        .map((channel, index) => ({
            ...channel,
            structureName: inferConstructionCctvStructure(channel, index)
        }));
}

function findConstructionCctvChannel(channels, structureName) {
    if (!channels.length) return null;
    return channels.find(channel => channel.structureName === structureName) || channels[0];
}

function playConstructionCctvVideo(video, streamUrl) {
    if (!video || !streamUrl) return;
    const proxyUrl = getConstructionCctvProxyUrl(streamUrl);
    if (video._constructionHls) {
        video._constructionHls.destroy();
        video._constructionHls = null;
    }
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;
    video.controls = false;

    if (typeof window.Hls !== 'undefined' && window.Hls.isSupported() && proxyUrl.includes('.m3u8')) {
        const hls = new window.Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 20 });
        video._constructionHls = hls;
        hls.loadSource(proxyUrl);
        hls.attachMedia(video);
        hls.on(window.Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
        hls.on(window.Hls.Events.ERROR, (event, data) => {
            if (data?.fatal) {
                video.closest('figure')?.classList.add('is-offline');
                hls.destroy();
                video._constructionHls = null;
            }
        });
    } else {
        video.src = proxyUrl;
        video.play().catch(() => {});
    }
}

function renderConstructionLiveCctvCards(channels = [], preferredStructure = '') {
    const grid = document.getElementById('bim-live-cctv-grid');
    if (!grid) return;
    const usable = normalizeConstructionCctvChannels(channels);
    if (!usable.length) {
        grid.classList.remove('is-detail');
        grid.innerHTML = '<div class="bim-db-placeholder">연결 가능한 실시간 CCTV 스트림이 없습니다.</div>';
        return;
    }

    if (!preferredStructure) {
        grid.classList.remove('is-detail');
        grid.dataset.activeStructure = '';
        grid.innerHTML = usable.slice(0, 8).map((channel, index) => {
            const title = channel.title || channel.name || channel.structureName;
            const poster = channel.img || '/img/lapse/lapse_1.jpg';
            return `
                <figure data-cctv-structure="${escapeHtml(channel.structureName || '')}" data-cctv-id="${escapeHtml(channel.id || '')}" data-cctv-index="${index}">
                    <video class="bim-live-cctv-video" muted autoplay playsinline poster="${escapeHtml(poster)}"></video>
                    <figcaption>${escapeHtml(channel.structureName || title)} <small>${escapeHtml(title)}</small></figcaption>
                </figure>
            `;
        }).join('');
        grid.querySelectorAll('figure').forEach((card, index) => {
            const channel = usable[index];
            playConstructionCctvVideo(card.querySelector('video'), channel?.streamUrl || '');
            card.addEventListener('click', () => renderConstructionLiveCctvCards(channels, channel?.structureName || ''));
        });
        return;
    }

    grid.classList.add('is-detail');
    const activeStructure = preferredStructure;
    const activeChannel = findConstructionCctvChannel(usable, activeStructure);
    const title = activeChannel.title || activeChannel.name || activeChannel.structureName;
    const poster = activeChannel.img || '/img/lapse/lapse_1.jpg';
    grid.dataset.activeStructure = activeChannel.structureName || activeStructure;
    grid.innerHTML = `
        <div class="bim-live-cctv-feature" data-cctv-structure="${escapeHtml(activeChannel.structureName || '')}" data-cctv-id="${escapeHtml(activeChannel.id || '')}">
            <div class="bim-live-cctv-stage">
                <video class="bim-live-cctv-video" muted autoplay playsinline poster="${escapeHtml(poster)}"></video>
                <span class="bim-live-cctv-source">출처: 경찰청 UTIC</span>
            </div>
            <div class="bim-live-cctv-caption">${escapeHtml(activeChannel.structureName || title)}<small>${escapeHtml(title)}</small></div>
        </div>
        <label class="bim-live-cctv-switch">
            <span>다른 뷰로 이동</span>
            <select id="bim-live-cctv-select" aria-label="CCTV 뷰 선택">
                ${usable.map((channel, index) => `
                    <option value="${index}" ${channel === activeChannel ? 'selected' : ''}>
                        ${escapeHtml(channel.structureName || channel.title || channel.name || `CCTV ${index + 1}`)}
                    </option>
                `).join('')}
            </select>
        </label>
    `;

    playConstructionCctvVideo(grid.querySelector('video'), activeChannel.streamUrl || '');
    const select = grid.querySelector('#bim-live-cctv-select');
    if (select) {
        select.addEventListener('change', event => {
            const next = usable[Number(event.target.value)] || usable[0];
            renderConstructionLiveCctvCards(channels, next.structureName);
        });
    }
}

async function initConstructionLiveCctvPanel() {
    if (window._constructionLiveCctvLoading) return;
    window._constructionLiveCctvLoading = true;
    try {
        const resp = await fetch('/api/cctv/live', { credentials: 'same-origin' });
        if (!resp.ok) throw new Error(`CCTV live fetch failed: HTTP ${resp.status}`);
        const data = await resp.json();
        const channels = Array.isArray(data) ? data : (data.channels || data.data || []);
        window._constructionLiveCctvChannels = channels;
        renderConstructionLiveCctvCards(channels);
    } catch (error) {
        console.warn('[Construction Live] CCTV live fetch failed:', error);
        renderConstructionLiveCctvCards([]);
    } finally {
        window._constructionLiveCctvLoading = false;
    }
}

function preloadConstructionLiveMaps() {
    if (window._constructionLiveMapCache) return window._constructionLiveMapCache;
    window._constructionLiveMapCache = {};
    Object.entries(CONSTRUCTION_LIVE_MAPS).forEach(([zone, mapInfo]) => {
        const image = new Image();
        image.decoding = 'async';
        image.loading = 'eager';
        image.src = mapInfo.src;
        window._constructionLiveMapCache[zone] = image;
    });
    return window._constructionLiveMapCache;
}

function setLiveMapZone(zone) {
    const mapInfo = CONSTRUCTION_LIVE_MAPS[zone] || CONSTRUCTION_LIVE_MAPS.new;
    const map = document.getElementById('bim-progress-map');
    const img = document.getElementById('bim-live-map-img');
    const cache = preloadConstructionLiveMaps();
    if (map) {
        map.dataset.activeLiveZone = zone;
        map.classList.toggle('is-live-new', zone === 'new');
        map.classList.toggle('is-live-extension', zone === 'extension');
        map.classList.toggle('is-live-priority', zone === 'priority');
    }
    document.querySelectorAll('.bim-dashboard-zone-tabs [data-live-zone]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.liveZone === zone);
    });
    if (img) {
        const cachedImage = cache[zone];
        img.src = cachedImage?.complete && cachedImage.naturalWidth ? cachedImage.src : mapInfo.src;
        img.alt = mapInfo.alt;
        img.style.display = '';
        if (img.nextElementSibling) img.nextElementSibling.style.display = 'none';
    }
    document.querySelectorAll('.bim-live-hotspot').forEach(btn => btn.classList.remove('active'));
    updateLinkedCctvPanel('');
    setConstructionProgressNote(`${mapInfo.label} 영역도를 표시 중입니다.`);
}

async function focusLiveStructure(structureName, zone = 'new') {
    if (!structureName) return;
    setLiveMapZone(zone);
    document.querySelectorAll('.bim-live-hotspot').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.structureName === structureName);
    });
    updateLinkedCctvPanel(structureName);
    openConstructionViewerLayer(zone);
    setConstructionViewerTitle(`${structureName} 3D Viewer`);
    setConstructionProgressNote(`${structureName} 구조물 3D 모델과 연계 CCTV를 준비 중입니다.`);
    try {
        await openConstructionStructureViewer(structureName, zone);
        setConstructionViewerTitle(`${structureName} 3D Viewer`);
    } catch (error) {
        console.error('[Construction Live] Failed to focus live structure:', error);
        setConstructionProgressNote(`${structureName} 3D 모델 이동 중 오류가 발생했습니다.`);
    }
}

function initConstructionLivePanel() {
    preloadConstructionLiveMaps();
    const tabs = document.querySelectorAll('.bim-dashboard-zone-tabs [data-live-zone]');
    tabs.forEach(tab => {
        if (tab.dataset.liveBound) return;
        tab.dataset.liveBound = 'true';
        tab.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            const zone = tab.dataset.liveZone || 'new';
            setLiveMapZone(zone);
        });
    });

    document.querySelectorAll('.bim-live-hotspot[data-structure-name]').forEach(btn => {
        if (btn.dataset.liveBound) return;
        btn.dataset.liveBound = 'true';
        btn.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            focusLiveStructure(btn.dataset.structureName, btn.dataset.zone || 'new');
        });
    });

    setLiveMapZone(document.getElementById('bim-progress-map')?.dataset.activeLiveZone || 'new');
    updateLinkedCctvPanel('착수정');
    initConstructionLiveCctvPanel();
}

function initConstructionProgressPanel() {
    renderConstructionGantt('');
    renderProgressDonuts('');
    loadConstructionScheduleData();
    const gantt = document.getElementById('bim-construction-gantt');
    if (gantt && !gantt.dataset.bound) {
        gantt.dataset.bound = 'true';
        gantt.addEventListener('click', event => {
            const scaleBtn = event.target.closest('[data-schedule-scale]');
            if (scaleBtn) {
                setConstructionScheduleScale(scaleBtn.dataset.scheduleScale);
                return;
            }
            if (event.target.closest('#bim-construction-schedule-expand')) openConstructionScheduleModal();
        });
    }
    const timelineModalBody = document.getElementById('bim-timeline-modal-body');
    if (timelineModalBody && !timelineModalBody.dataset.constructionScheduleBound) {
        timelineModalBody.dataset.constructionScheduleBound = 'true';
        timelineModalBody.addEventListener('change', event => {
            if (event.target.id === 'bim-construction-schedule-scale-expanded' ||
                event.target.id === 'bim-construction-schedule-week-expanded' ||
                event.target.id === 'bim-construction-schedule-month-expanded' ||
                event.target.id === 'bim-construction-schedule-year-expanded') {
                updateExpandedConstructionSchedule();
            }
        });
    }
    const map = document.getElementById('bim-progress-map');
    const donuts = document.getElementById('bim-progress-donuts');
    if (donuts && !donuts.dataset.bound) {
        donuts.dataset.bound = 'true';
        donuts.addEventListener('click', event => {
            const zoneBtn = event.target.closest('.bim-progress-donut-card[data-zone]');
            const zone = zoneBtn ? zoneBtn.dataset.zone : '';
            if (zone) focusConstructionZone(zone);
        });
    }
    if (!map || map.dataset.bound) return;
    map.dataset.bound = 'true';
    const backBtn = document.getElementById('bim-progress-viewer-back');
    const saveViewBtn = document.getElementById('bim-progress-viewer-save-view');
    const resetBtn = document.getElementById('bim-progress-viewer-reset');
    if (backBtn) {
        backBtn.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            closeConstructionViewerLayer();
        });
    }
    if (saveViewBtn && !saveViewBtn.dataset.bound) {
        saveViewBtn.dataset.bound = 'true';
        saveViewBtn.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            saveConstructionViewerState(window._constructionActiveViewerZone || '');
        });
    }
    if (resetBtn && !resetBtn.dataset.bound) {
        resetBtn.dataset.bound = 'true';
        resetBtn.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            resetConstructionViewerFocus();
        });
    }
    map.addEventListener('mouseover', event => {
        const zoneBtn = event.target.closest('.bim-zone[data-zone]');
        if (zoneBtn) setActiveConstructionZone(zoneBtn.dataset.zone);
    });
    map.addEventListener('mouseleave', () => setActiveConstructionZone(''));
    map.addEventListener('click', event => {
        const hotspot = event.target.closest('.bim-live-hotspot[data-structure-name]');
        if (hotspot) {
            focusLiveStructure(hotspot.dataset.structureName, hotspot.dataset.zone || 'new');
            return;
        }
        const zoneBtn = event.target.closest('.bim-zone[data-zone]');
        if (zoneBtn) focusConstructionZone(zoneBtn.dataset.zone);
    });
}

const WEEKLY_TASK_STORAGE_KEY = 'gangbuk_construction_weekly_tasks';
const TASK_CATEGORIES = {
    BIM: { color: '#2563eb' },
    '행정': { color: '#64748b' },
    '보고': { color: '#16a34a' },
    '회의': { color: '#9333ea' },
    '기타': { color: '#f97316' }
};
const TASK_STATUSES = {
    '계획': { color: '#93c5fd' },
    '진행중': { color: '#facc15' },
    '완료': { color: '#86efac' },
    '보류': { color: '#fca5a5' }
};
const KOREAN_HOLIDAYS = {
    '2026-01-01': '신정',
    '2026-02-16': '설날',
    '2026-02-17': '설날',
    '2026-02-18': '설날',
    '2026-03-01': '삼일절',
    '2026-03-02': '삼일절 대체공휴일',
    '2026-05-01': '근로자의 날',
    '2026-05-05': '어린이날',
    '2026-05-24': '부처님오신날',
    '2026-05-25': '부처님오신날 대체공휴일',
    '2026-06-03': '지방선거일',
    '2026-06-06': '현충일',
    '2026-07-17': '제헌절',
    '2026-08-15': '광복절',
    '2026-08-17': '광복절 대체공휴일',
    '2026-09-24': '추석',
    '2026-09-25': '추석',
    '2026-09-26': '추석',
    '2026-10-03': '개천절',
    '2026-10-05': '개천절 대체공휴일',
    '2026-10-09': '한글날',
    '2026-12-25': '성탄절'
};
let currentWorkView = 'week';
const MODEL_UPDATE_PROJECT_NAME = '강북정수장 증설공사 BIM 용역';
let modelUpdateState = {
    loading: false,
    loaded: false,
    error: '',
    models: [],
    projectName: MODEL_UPDATE_PROJECT_NAME,
    fetchedAt: ''
};
let timelineRangeState = {
    scale: 'month',
    month: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
    year: String(new Date().getFullYear())
};

function readWeeklyTasks() {
    try {
        const parsed = JSON.parse(localStorage.getItem(WEEKLY_TASK_STORAGE_KEY) || '{}');
        if (Array.isArray(parsed)) return parsed;
        if (parsed && typeof parsed === 'object') {
            const migrated = [];
            Object.keys(parsed).forEach(weekKey => {
                const tasks = Array.isArray(parsed[weekKey]) ? parsed[weekKey] : [];
                tasks.forEach(task => {
                    if (task && typeof task === 'object') migrated.push(task);
                });
            });
            return migrated;
        }
        return [];
    } catch (err) {
        return [];
    }
}

function writeWeeklyTasks(data) {
    localStorage.setItem(WEEKLY_TASK_STORAGE_KEY, JSON.stringify(Array.isArray(data) ? data : []));
}

function getMonday(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay() || 7;
    d.setDate(d.getDate() - day + 1);
    return d;
}

function getWeekMeta(date) {
    const monday = getMonday(date);
    const firstThursday = new Date(monday.getFullYear(), 0, 4);
    const firstMonday = getMonday(firstThursday);
    const diffDays = Math.round((monday - firstMonday) / 86400000);
    const week = Math.floor(diffDays / 7) + 1;
    const year = monday.getFullYear();
    return {
        key: `${year}-W${String(week).padStart(2, '0')}`,
        label: `${year}년 ${week}주차`
    };
}

function addWeeks(date, count) {
    const d = new Date(date);
    d.setDate(d.getDate() + count * 7);
    return d;
}

function getSelectedWeekKey() {
    const select = document.getElementById('bim-week-select');
    return select && select.value ? select.value : getWeekMeta(new Date()).key;
}

function parseWeekKey(weekKey) {
    const match = String(weekKey || '').match(/^(\d{4})-W(\d{2})$/);
    if (!match) return getMonday(new Date());
    const firstThursday = new Date(Number(match[1]), 0, 4);
    const firstMonday = getMonday(firstThursday);
    return addWeeks(firstMonday, Number(match[2]) - 1);
}

function parseTaskDate(value) {
    if (!value) return null;
    const parts = String(value).split('-').map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
    const date = new Date(parts[0], parts[1] - 1, parts[2]);
    date.setHours(0, 0, 0, 0);
    return date;
}

function getSelectedWeekRange() {
    const start = parseWeekKey(getSelectedWeekKey());
    const end = addWeeks(start, 1);
    end.setDate(end.getDate() - 1);
    end.setHours(23, 59, 59, 999);
    return { start, end };
}

function populateWeekSelect() {
    const select = document.getElementById('bim-week-select');
    if (!select) return;

    const current = getMonday(new Date());
    const currentKey = getWeekMeta(current).key;
    if (select.dataset.ready) {
        if (!select.dataset.userSelected) select.value = currentKey;
        return;
    }

    for (let offset = -6; offset <= 12; offset += 1) {
        const meta = getWeekMeta(addWeeks(current, offset));
        const option = document.createElement('option');
        option.value = meta.key;
        option.textContent = meta.label;
        if (meta.key === currentKey) option.selected = true;
        select.appendChild(option);
    }

    select.dataset.ready = 'true';
    select.addEventListener('change', () => {
        select.dataset.userSelected = 'true';
        renderWeeklyTaskBoard();
    });
}

function getTasksForSelectedWeek() {
    const tasks = readWeeklyTasks();
    const week = getSelectedWeekRange();
    return tasks.filter(task => {
        const start = parseTaskDate(task.startDate) || parseTaskDate(task.dueDate) || week.start;
        let due = parseTaskDate(task.dueDate) || start;
        if (due < start) due = start;
        if (task.status === '완료') {
            due = addWeeks(due, 1);
        }
        return start <= week.end && due >= week.start;
    });
}

function getAllWeeklyTasks() {
    return readWeeklyTasks();
}

function setAllWeeklyTasks(tasks) {
    writeWeeklyTasks(tasks);
}

function getTaskCategoryColor(category) {
    return (TASK_CATEGORIES[category] || TASK_CATEGORIES['기타']).color;
}

function sortTasks(tasks) {
    return tasks.slice().sort((a, b) => {
        return String(a.startDate || '').localeCompare(String(b.startDate || '')) ||
            String(a.dueDate || '').localeCompare(String(b.dueDate || ''));
    });
}

function renderTaskTable(tasks, emptyMessage) {
    const sortedTasks = sortTasks(tasks);
    if (!sortedTasks.length) {
        return `<div class="bim-week-empty">${escapeHtml(emptyMessage || '표시할 업무가 없습니다.')}</div>`;
    }

    const rows = sortedTasks.map(task => renderTaskRow(task)).join('');
    return `
        <table class="bim-week-table">
            <thead>
                <tr>
                    <th style="width:76px;">구분</th>
                    <th style="width:82px;">진행 상태</th>
                    <th style="width:88px;">시작일</th>
                    <th style="width:88px;">마감일</th>
                    <th>주요내용</th>
                    <th style="width:96px;">수행인원</th>
                    <th style="width:76px; text-align:center;">관리</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
}

function renderTaskRow(task) {
    const category = task.category || '기타';
    const status = task.status || '계획';
    const categoryColor = getTaskCategoryColor(category);
    const statusColor = (TASK_STATUSES[status] || TASK_STATUSES['계획']).color;
    return `
        <tr data-task-id="${escapeHtml(task.id)}">
            <td><span class="bim-work-badge" style="background:${categoryColor};">${escapeHtml(category)}</span></td>
            <td><span class="bim-status-pill" style="color:${statusColor};">${escapeHtml(status)}</span></td>
            <td>${escapeHtml(task.startDate || '-')}</td>
            <td>${escapeHtml(task.dueDate || '-')}</td>
            <td class="bim-week-content-cell" style="min-width:190px; white-space:normal; line-height:1.45;">${escapeHtml(task.content || '-')}</td>
            <td>${escapeHtml(task.people || '-')}</td>
            <td style="white-space:nowrap;">
                <button type="button" class="bim-icon-btn bim-task-edit" title="수정"><i class="fas fa-pen"></i></button>
                <button type="button" class="bim-icon-btn danger bim-task-delete" title="삭제"><i class="fas fa-trash"></i></button>
            </td>
        </tr>
    `;
}

function getCheckedValues(selector) {
    return Array.from(document.querySelectorAll(selector + ':checked')).map(input => input.value);
}

function taskOverlapsRange(task, fromValue, toValue) {
    const from = parseTaskDate(fromValue);
    const to = parseTaskDate(toValue);
    if (!from && !to) return true;
    const taskStart = parseTaskDate(task.startDate) || parseTaskDate(task.dueDate);
    let taskDue = parseTaskDate(task.dueDate) || taskStart;
    if (!taskStart) return false;
    if (taskDue < taskStart) taskDue = taskStart;
    if (from && taskDue < from) return false;
    if (to && taskStart > to) return false;
    return true;
}

function getFilteredTasks() {
    const people = String(document.getElementById('bim-filter-people')?.value || '').trim().toLowerCase();
    const from = document.getElementById('bim-filter-from')?.value || '';
    const to = document.getElementById('bim-filter-to')?.value || '';
    const categories = getCheckedValues('.bim-filter-category');
    const statuses = getCheckedValues('.bim-filter-status');

    return getAllWeeklyTasks().filter(task => {
        if (!taskOverlapsRange(task, from, to)) return false;
        if (people && String(task.people || '').toLowerCase().indexOf(people) === -1) return false;
        if (categories.length && !categories.includes(task.category || '기타')) return false;
        if (statuses.length && !statuses.includes(task.status || '계획')) return false;
        return true;
    });
}

function renderFilterView() {
    const categories = Object.keys(TASK_CATEGORIES).map(category => (
        `<label><input type="checkbox" class="bim-filter-category" value="${escapeHtml(category)}" checked> ${escapeHtml(category)}</label>`
    )).join('');
    const statuses = Object.keys(TASK_STATUSES).map(status => (
        `<label><input type="checkbox" class="bim-filter-status" value="${escapeHtml(status)}" checked> ${escapeHtml(status)}</label>`
    )).join('');

    return `
        <div class="bim-filter-grid">
            <div class="bim-filter-field">
                <label for="bim-filter-from">시작일 이후</label>
                <input id="bim-filter-from" class="bim-filter-input" type="date">
            </div>
            <div class="bim-filter-field">
                <label for="bim-filter-to">마감일 이전</label>
                <input id="bim-filter-to" class="bim-filter-input" type="date">
            </div>
            <div class="bim-filter-field">
                <label for="bim-filter-people">수행인원</label>
                <input id="bim-filter-people" class="bim-filter-input" type="text" placeholder="이름 검색">
            </div>
            <div class="bim-filter-field">
                <label>구분</label>
                <div class="bim-filter-checks">${categories}</div>
            </div>
            <div class="bim-filter-field" style="grid-column:1 / -1;">
                <label>진행 상태</label>
                <div class="bim-filter-checks">${statuses}</div>
            </div>
        </div>
        <div id="bim-filter-results">${renderTaskTable(getAllWeeklyTasks(), '검색 조건에 맞는 업무가 없습니다.')}</div>
    `;
}

function countBy(tasks, getter) {
    const map = new Map();
    tasks.forEach(task => {
        const key = getter(task) || '-';
        map.set(key, (map.get(key) || 0) + 1);
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'ko'));
}

function renderMiniBars(items, colorGetter) {
    const max = Math.max(1, ...items.map(item => item[1]));
    return items.map(item => {
        const width = Math.max(4, Math.round((item[1] / max) * 100));
        return `
            <div class="bim-mini-bar-row">
                <div title="${escapeHtml(item[0])}">${escapeHtml(item[0])}</div>
                <div class="bim-mini-bar-track"><div class="bim-mini-bar-fill" style="width:${width}%; background:${colorGetter(item[0])};"></div></div>
                <div>${item[1]}건</div>
            </div>
        `;
    }).join('');
}

function getTaskDurationDays(task) {
    const start = parseTaskDate(task.startDate);
    const due = parseTaskDate(task.dueDate) || start;
    if (!start || !due) return 0;
    return Math.max(1, Math.round((due - start) / 86400000) + 1);
}

function formatShortDate(date) {
    return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
}

function formatDateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getKoreanHolidayName(date) {
    const key = formatDateKey(date);
    if (KOREAN_HOLIDAYS[key]) return KOREAN_HOLIDAYS[key];
    const fixedKey = `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const fixedHolidays = {
        '01-01': '신정',
        '03-01': '삼일절',
        '05-01': '근로자의 날',
        '05-05': '어린이날',
        '06-06': '현충일',
        '07-17': '제헌절',
        '08-15': '광복절',
        '10-03': '개천절',
        '10-09': '한글날',
        '12-25': '성탄절'
    };
    return fixedHolidays[fixedKey] || '';
}

function getTimelineDayClass(date) {
    const holiday = getKoreanHolidayName(date);
    if (holiday) return 'holiday';
    const day = date.getDay();
    if (day === 0 || day === 6) return 'weekend';
    return '';
}

function renderTimelineBackground(range) {
    if (range.scale !== 'month') {
        return Array.from({ length: range.cols }, () => '<div class="bim-timeline-bg-cell"></div>').join('');
    }
    return Array.from({ length: range.cols }, (_, idx) => {
        const date = addDays(range.start, idx);
        const cls = getTimelineDayClass(date);
        const holiday = getKoreanHolidayName(date);
        const title = holiday || (cls === 'weekend' ? '주말' : '');
        return `<div class="bim-timeline-bg-cell ${cls}" title="${escapeHtml(title)}"></div>`;
    }).join('');
}

function getDaysInclusive(start, end) {
    return Math.max(1, Math.round((end - start) / 86400000) + 1);
}

function getTimelineControlValue(id, fallback) {
    const el = document.getElementById(id);
    return el && el.value ? el.value : fallback;
}

function getTimelineSettings(expanded = false) {
    const suffix = expanded ? '-expanded' : '';
    timelineRangeState.scale = getTimelineControlValue(`bim-timeline-scale${suffix}`, timelineRangeState.scale);
    timelineRangeState.month = getTimelineControlValue(`bim-timeline-month${suffix}`, timelineRangeState.month);
    timelineRangeState.year = getTimelineControlValue(`bim-timeline-year${suffix}`, timelineRangeState.year);
    return { ...timelineRangeState };
}

function getTimelineRange(settings) {
    if (settings.scale === 'year') {
        const year = Number(settings.year) || new Date().getFullYear();
        const start = new Date(year, 0, 1);
        const end = new Date(year, 11, 31);
        end.setHours(23, 59, 59, 999);
        return {
            start,
            end,
            scale: 'year',
            label: `${year}년`,
            cols: 12,
            axis: Array.from({ length: 12 }, (_, idx) => {
                return `<div class="bim-timeline-day">${idx + 1}월</div>`;
            })
        };
    }

    const parts = String(settings.month || timelineRangeState.month).split('-').map(Number);
    const year = parts[0] || new Date().getFullYear();
    const month = parts[1] || (new Date().getMonth() + 1);
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0);
    end.setHours(23, 59, 59, 999);
    const cols = end.getDate();
    const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
    return {
        start,
        end,
        scale: 'month',
        label: `${year}년 ${month}월`,
        cols,
        axis: Array.from({ length: cols }, (_, idx) => {
            const d = new Date(year, month - 1, idx + 1);
            const cls = getTimelineDayClass(d);
            const holiday = getKoreanHolidayName(d);
            return `<div class="bim-timeline-day ${cls}" title="${escapeHtml(holiday || '')}">${idx + 1}<small>${holiday || dayNames[d.getDay()]}</small></div>`;
        })
    };
}

function getTasksForTimeline(range) {
    return getAllWeeklyTasks().filter(task => {
        const start = parseTaskDate(task.startDate) || parseTaskDate(task.dueDate);
        let due = parseTaskDate(task.dueDate) || start;
        if (!start) return false;
        if (due < start) due = start;
        return start <= range.end && due >= range.start;
    });
}

function renderTimelineAxis(range, expanded) {
    return `
        <div class="bim-timeline-axis">
            <div class="bim-timeline-axis-label">${expanded ? '기준' : ''}</div>
            <div class="bim-timeline-days">${range.axis.join('')}</div>
        </div>
    `;
}

function parseModelDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function formatModelDate(value) {
    const date = parseModelDate(value);
    if (!date) return '-';
    return date.toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getModelSortTime(model) {
    const date = parseModelDate(model.lastModifiedTime);
    return date ? date.getTime() : 0;
}

function getSortedModelUpdates() {
    return modelUpdateState.models
        .slice()
        .sort((a, b) => getModelSortTime(b) - getModelSortTime(a) || String(a.name || '').localeCompare(String(b.name || ''), 'ko'));
}

function getMonthlyModelUpdateCutoff() {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 1);
    return cutoff;
}

function getMonthlyModelUpdates() {
    const cutoffTime = getMonthlyModelUpdateCutoff().getTime();
    return getSortedModelUpdates().filter(model => getModelSortTime(model) >= cutoffTime);
}

function getModelUpdatePeriodLabel() {
    return `최근 1개월 (${formatModelDate(getMonthlyModelUpdateCutoff())} 이후)`;
}

async function loadModelUpdateStats(force = false) {
    if (modelUpdateState.loading) return modelUpdateState;
    if (!force && modelUpdateState.loaded) return modelUpdateState;

    modelUpdateState = { ...modelUpdateState, loading: true, error: '' };
    try {
        const url = `/api/models/tree${force ? '?force=1' : ''}`;
        const resp = await fetch(url, { credentials: 'same-origin' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const tree = await resp.json();
        modelUpdateState = {
            loading: false,
            loaded: true,
            error: '',
            models: dedupeModels(collectNodeFiles(tree, [])),
            projectName: tree.projectName || MODEL_UPDATE_PROJECT_NAME,
            fetchedAt: tree.fetchedAt || new Date().toISOString()
        };
    } catch (err) {
        console.warn('[Construction BIM Dashboard] Model update stats failed:', err);
        modelUpdateState = {
            ...modelUpdateState,
            loading: false,
            loaded: true,
            error: '모델 업데이트 정보를 불러오지 못했습니다.'
        };
    }

    if (currentWorkView === 'stats') renderWeeklyTaskBoard();
    return modelUpdateState;
}

function ensureModelUpdateStats() {
    if (!modelUpdateState.loaded && !modelUpdateState.loading) {
        loadModelUpdateStats(false);
    }
}

function renderModelUpdateStatCard() {
    ensureModelUpdateStats();
    const monthlyModels = getMonthlyModelUpdates();
    const countText = modelUpdateState.loading ? '...' : `${monthlyModels.length}건`;
    const latest = monthlyModels[0];
    const subText = modelUpdateState.error || (latest
        ? `최근: ${latest.name || '-'}`
        : modelUpdateState.loading ? 'Autodesk Docs 조회 중' : '최근 1개월 업데이트 없음');
    const fetched = modelUpdateState.fetchedAt ? getModelUpdatePeriodLabel() : MODEL_UPDATE_PROJECT_NAME;
    return `
        <button type="button" class="bim-stat-card bim-model-update-card" title="최근 1개월 업데이트 모델 목록 보기">
            <div class="bim-stat-label">모델 업데이트 건수</div>
            <div class="bim-stat-value">${escapeHtml(countText)}</div>
            <div class="bim-stat-sub" title="${escapeHtml(subText)}">${escapeHtml(subText)}</div>
            <div class="bim-stat-sub muted" title="${escapeHtml(fetched)}">${escapeHtml(fetched)}</div>
        </button>
    `;
}

function renderModelUpdateSummary(count) {
    return `
        <div class="bim-model-update-summary">
            <strong>${escapeHtml(modelUpdateState.projectName || MODEL_UPDATE_PROJECT_NAME)}</strong>
            <span>최근 1개월 업데이트 ${count}건</span>
            <button id="bim-model-update-refresh" type="button" class="bim-icon-btn" title="새로고침"><i class="fas fa-sync-alt"></i></button>
        </div>
    `;
}

function renderModelUpdateList() {
    const models = getMonthlyModelUpdates();
    const summary = renderModelUpdateSummary(models.length);
    if (modelUpdateState.loading) {
        return `${summary}<div class="bim-db-placeholder">모델 업데이트 목록을 불러오는 중입니다.</div>`;
    }
    if (modelUpdateState.error) {
        return `${summary}<div class="bim-db-placeholder">${escapeHtml(modelUpdateState.error)}</div>`;
    }
    if (!models.length) {
        return `${summary}<div class="bim-db-placeholder">최근 1개월 사이 업데이트된 모델이 없습니다.</div>`;
    }

    const rows = models.map(model => `
        <tr class="bim-model-update-row" data-model-urn="${escapeHtml(model.urn || '')}" data-model-name="${escapeHtml(model.name || '-')}">
            <td class="bim-model-name-cell" title="${escapeHtml(model.name || '-')}">
                <button type="button" class="bim-model-open-btn" title="3D 뷰어에서 열기">${escapeHtml(model.name || '-')}</button>
            </td>
            <td>${escapeHtml(model.versionNumber ? `v${model.versionNumber}` : '-')}</td>
            <td title="${escapeHtml(model.folderPath || '-')}">${escapeHtml(model.folderPath || '-')}</td>
            <td>${escapeHtml(formatModelDate(model.lastModifiedTime))}</td>
            <td>${escapeHtml(model.lastModifiedUserName || '-')}</td>
        </tr>
    `).join('');

    return `
        ${summary}
        <table class="bim-model-update-table">
            <thead>
                <tr>
                    <th>모델명</th>
                    <th>버전</th>
                    <th>폴더</th>
                    <th>업데이트 일시</th>
                    <th>수정자</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
}

function openModelUpdateInViewer(urn, name) {
    if (!urn) return;
    const modelName = name || 'BIM Model';
    if (typeof window.updateUrnCache === 'function') {
        window.updateUrnCache(modelName, urn);
    }
    window.currentModelName = modelName;
    window.currentUrnName = modelName;
    window.currentUrn = urn;
    closeTimelineModal();

    if (typeof window.switchTab === 'function') {
        window.switchTab('project');
    }

    setTimeout(() => {
        if (window.explorer && typeof window.explorer.loadIntoViewer === 'function') {
            window.explorer.loadIntoViewer(urn, modelName);
            return;
        }
        if (typeof window.focusIssueOnViewer === 'function') {
            window.focusIssueOnViewer('', urn);
            return;
        }
        import('./viewer.js?v=20260825-viewer-fixed-sdk1')
            .then(async mod => {
                const container = document.getElementById('preview');
                if (!container || !mod.initViewer || !mod.loadModel) return;
                const viewer = window.viewer || await mod.initViewer(container, false);
                if (!viewer) return;
                window.viewer = viewer;
                await mod.loadModel(viewer, urn);
            })
            .catch(err => console.error('[Construction BIM Dashboard] Model update viewer open failed:', err));
    }, 120);
}

async function openModelUpdateModal(force = false) {
    const modal = document.getElementById('bim-timeline-modal');
    const body = document.getElementById('bim-timeline-modal-body');
    if (!modal || !body) return;
    const title = modal.querySelector('.bim-task-dialog-head span');
    if (title) title.textContent = '모델 업데이트 목록';
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
    const shouldLoad = force || !modelUpdateState.loaded;
    const pending = shouldLoad ? loadModelUpdateStats(force) : Promise.resolve(modelUpdateState);
    body.innerHTML = renderModelUpdateList();
    await pending;
    if (modal.style.display === 'flex') body.innerHTML = renderModelUpdateList();
}

function getTasksForStatsType(type) {
    const tasks = getAllWeeklyTasks();
    if (type === 'active') return tasks.filter(task => task.status === '진행중');
    if (type === 'completed') return tasks.filter(task => task.status === '완료');
    return tasks;
}

function getTaskStatsTitle(type) {
    if (type === 'active') return '진행중 업무 목록';
    if (type === 'completed') return '완료 업무 목록';
    return '전체 업무 목록';
}

function renderTaskStatCard(type, label, count) {
    return `
        <button type="button" class="bim-stat-card bim-task-stat-card" data-task-stat="${escapeHtml(type)}" title="${escapeHtml(label)} 목록 보기">
            <div class="bim-stat-label">${escapeHtml(label)}</div>
            <div class="bim-stat-value">${count}건</div>
        </button>
    `;
}

function renderTaskStatsList(tasks, emptyMessage) {
    const sortedTasks = sortTasks(tasks);
    if (!sortedTasks.length) {
        return `<div class="bim-db-placeholder">${escapeHtml(emptyMessage || '표시할 업무가 없습니다.')}</div>`;
    }

    const rows = sortedTasks.map(task => {
        const category = task.category || '기타';
        const status = task.status || '계획';
        const categoryColor = getTaskCategoryColor(category);
        const statusColor = (TASK_STATUSES[status] || TASK_STATUSES['계획']).color;
        return `
            <tr>
                <td><span class="bim-work-badge" style="background:${categoryColor};">${escapeHtml(category)}</span></td>
                <td><span class="bim-status-pill" style="color:${statusColor};">${escapeHtml(status)}</span></td>
                <td>${escapeHtml(task.startDate || '-')}</td>
                <td>${escapeHtml(task.dueDate || '-')}</td>
                <td class="bim-week-content-cell">${escapeHtml(task.content || '-')}</td>
                <td>${escapeHtml(task.people || '-')}</td>
            </tr>
        `;
    }).join('');

    return `
        <table class="bim-week-table bim-task-stats-table">
            <thead>
                <tr>
                    <th style="width:76px;">구분</th>
                    <th style="width:82px;">진행 상태</th>
                    <th style="width:88px;">시작일</th>
                    <th style="width:88px;">마감일</th>
                    <th>주요내용</th>
                    <th style="width:96px;">수행인원</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
}

function openTaskStatsModal(type) {
    const modal = document.getElementById('bim-timeline-modal');
    const body = document.getElementById('bim-timeline-modal-body');
    if (!modal || !body) return;
    const tasks = getTasksForStatsType(type);
    const titleText = getTaskStatsTitle(type);
    const title = modal.querySelector('.bim-task-dialog-head span');
    if (title) title.textContent = titleText;
    body.innerHTML = `
        <div class="bim-task-stats-summary">
            <strong>${escapeHtml(titleText)}</strong>
            <span>${tasks.length}건</span>
        </div>
        ${renderTaskStatsList(tasks, `${titleText}이 없습니다.`)}
    `;
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
}

function renderStatsView() {
    const tasks = getAllWeeklyTasks();
    const completed = tasks.filter(task => task.status === '완료').length;
    const active = tasks.filter(task => task.status === '진행중').length;
    const longest = tasks.slice().sort((a, b) => getTaskDurationDays(b) - getTaskDurationDays(a))[0];
    const categoryCounts = countBy(tasks, task => task.category || '기타');
    const statusCounts = countBy(tasks, task => task.status || '계획');

    return `
        <div class="bim-stats-grid">
            ${renderTaskStatCard('all', '전체 업무', tasks.length)}
            ${renderTaskStatCard('active', '진행중', active)}
            ${renderTaskStatCard('completed', '완료', completed)}
            ${renderModelUpdateStatCard()}
        </div>
        <div class="bim-stats-grid" style="grid-template-columns:1fr 1fr; padding-top:0;">
            <div class="bim-stat-card"><div class="bim-stat-label">구분별 업무</div><div class="bim-mini-bars">${renderMiniBars(categoryCounts, getTaskCategoryColor) || '<div class="bim-week-empty">업무가 없습니다.</div>'}</div></div>
            <div class="bim-stat-card"><div class="bim-stat-label">상태별 업무</div><div class="bim-mini-bars">${renderMiniBars(statusCounts, key => (TASK_STATUSES[key] || TASK_STATUSES['계획']).color) || '<div class="bim-week-empty">업무가 없습니다.</div>'}</div></div>
        </div>
        <div class="bim-stats-grid" style="grid-template-columns:1fr; padding-top:0;">
            <div class="bim-stat-card"><div class="bim-stat-label">가장 오래 걸린 업무</div><div class="bim-stat-value" title="${escapeHtml(longest?.content || '-')}">${escapeHtml(longest ? `${getTaskDurationDays(longest)}일 · ${longest.content || '-'}` : '-')}</div></div>
        </div>
    `;
}

function renderTimelineView(expanded = false, selectedMode = '') {
    const settings = getTimelineSettings(expanded);
    const range = getTimelineRange(settings);
    const tasks = getTasksForTimeline(range);
    const mode = selectedMode || document.getElementById(expanded ? 'bim-timeline-mode-expanded' : 'bim-timeline-mode')?.value || 'people';
    const modeId = expanded ? 'bim-timeline-mode-expanded' : 'bim-timeline-mode';
    const suffix = expanded ? '-expanded' : '';
    const totalDays = getDaysInclusive(range.start, range.end);
    const timelineBackground = renderTimelineBackground(range);
    const groups = countBy(tasks, task => mode === 'category' ? (task.category || '기타') : (task.people || '미지정')).map(item => item[0]);
    const rows = groups.map(group => {
        const groupTasks = sortTasks(tasks.filter(task => (mode === 'category' ? (task.category || '기타') : (task.people || '미지정')) === group));
        const taskRows = groupTasks.map(task => {
            const start = parseTaskDate(task.startDate) || range.start;
            let due = parseTaskDate(task.dueDate) || start;
            if (due < start) due = start;
            const clippedStart = start < range.start ? range.start : start;
            const clippedDue = due > range.end ? range.end : due;
            let left;
            let width;
            if (range.scale === 'year') {
                const startMonth = clippedStart.getMonth();
                const endMonth = clippedDue.getMonth();
                left = (startMonth / 12) * 100;
                width = Math.max(2.5, ((endMonth - startMonth + 1) / 12) * 100);
            } else {
                const leftDays = Math.max(0, Math.floor((clippedStart - range.start) / 86400000));
                const barDays = getDaysInclusive(clippedStart, clippedDue);
                left = (leftDays / totalDays) * 100;
                width = Math.max(2.5, (barDays / totalDays) * 100);
            }
            const category = task.category || '기타';
            const content = task.content || '-';
            const label = mode === 'category' ? (task.people || '미지정') : content;
            return `
                <div class="bim-timeline-row">
                    <div class="bim-timeline-label" title="${escapeHtml(content)}">
                        <div class="bim-timeline-task-label">
                            <span class="bim-work-badge" style="background:${getTaskCategoryColor(category)};">${escapeHtml(category)}</span>
                            <span class="bim-timeline-task-title">${escapeHtml(label)}</span>
                        </div>
                    </div>
                    <div class="bim-timeline-track">
                        <div class="bim-timeline-track-bg">${timelineBackground}</div>
                        <div class="bim-timeline-bar" data-task-id="${escapeHtml(task.id)}" title="${escapeHtml(content)}" aria-label="${escapeHtml(content)}" style="left:${left}%; width:${width}%; background:${getTaskCategoryColor(category)};"></div>
                    </div>
                </div>
            `;
        }).join('');
        return `
            <div class="bim-timeline-group-row">
                <div class="bim-timeline-group-label" title="${escapeHtml(group)}">${escapeHtml(group)}</div>
                <div class="bim-timeline-group-summary">${groupTasks.length}건</div>
            </div>
            ${taskRows}
        `;
    }).join('');

    return `
        <div class="bim-timeline-toolbar">
            <div class="bim-timeline-range">${range.label} · ${formatShortDate(range.start)} ~ ${formatShortDate(range.end)}</div>
            <select id="bim-timeline-scale${suffix}" class="bim-week-select" title="타임라인 범위">
                <option value="month"${settings.scale === 'month' ? ' selected' : ''}>월간</option>
                <option value="year"${settings.scale === 'year' ? ' selected' : ''}>연간</option>
            </select>
            <input id="bim-timeline-month${suffix}" class="bim-filter-input" type="month" value="${escapeHtml(settings.month)}" style="width:126px; display:${settings.scale === 'month' ? 'block' : 'none'};">
            <input id="bim-timeline-year${suffix}" class="bim-filter-input" type="number" min="2000" max="2100" value="${escapeHtml(settings.year)}" style="width:82px; display:${settings.scale === 'year' ? 'block' : 'none'};">
            <select id="${modeId}" class="bim-week-select" title="타임라인 기준">
                <option value="people"${mode === 'people' ? ' selected' : ''}>수행인원 기준</option>
                <option value="category"${mode === 'category' ? ' selected' : ''}>구분 기준</option>
            </select>
            ${expanded ? '' : '<button id="bim-timeline-expand-btn" type="button" class="bim-icon-btn" title="타임라인 크게 보기"><i class="fas fa-up-right-and-down-left-from-center"></i></button>'}
        </div>
        <div class="bim-timeline${expanded ? ' expanded' : ''}" style="--bim-timeline-cols:${range.cols};">
            ${renderTimelineAxis(range, expanded)}
            ${rows || '<div class="bim-week-empty">선택한 범위에 표시할 업무가 없습니다.</div>'}
        </div>
    `;
}

function openTimelineModal() {
    const modal = document.getElementById('bim-timeline-modal');
    const body = document.getElementById('bim-timeline-modal-body');
    if (!modal || !body) return;
    const mode = document.getElementById('bim-timeline-mode')?.value || 'people';
    body.innerHTML = renderTimelineView(true, mode);
    const title = modal.querySelector('.bim-task-dialog-head span');
    if (title) title.textContent = '업무 타임라인';
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
}

function closeTimelineModal() {
    const modal = document.getElementById('bim-timeline-modal');
    if (!modal) return;
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
}

function updateWorkTabs() {
    document.querySelectorAll('.bim-work-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.workView === currentWorkView);
    });
}

function renderWeeklyTaskBoard() {
    const board = document.getElementById('bim-week-board');
    if (!board) return;
    updateWorkTabs();

    if (currentWorkView === 'filter') {
        board.innerHTML = renderFilterView();
    } else if (currentWorkView === 'stats') {
        board.innerHTML = renderStatsView();
    } else if (currentWorkView === 'timeline') {
        board.innerHTML = renderTimelineView();
    } else {
        board.innerHTML = renderTaskTable(getTasksForSelectedWeek(), '선택한 주차에 등록된 업무가 없습니다.');
    }
}

function refreshFilterResults() {
    const target = document.getElementById('bim-filter-results');
    if (!target) return;
    target.innerHTML = renderTaskTable(getFilteredTasks(), '검색 조건에 맞는 업무가 없습니다.');
}

function getTaskFormValues() {
    const people = document.getElementById('bim-task-people');
    const category = document.getElementById('bim-task-category');
    const status = document.getElementById('bim-task-status');
    const startDate = document.getElementById('bim-task-start');
    const dueDate = document.getElementById('bim-task-due');
    const content = document.getElementById('bim-task-content');
    return {
        people: people ? people.value.trim() : '',
        category: category ? category.value : 'BIM',
        status: status ? status.value : '계획',
        startDate: startDate ? startDate.value : '',
        dueDate: dueDate ? dueDate.value : '',
        content: content ? content.value.trim() : ''
    };
}

function setTaskFormValues(task) {
    const values = task || {};
    const people = document.getElementById('bim-task-people');
    const category = document.getElementById('bim-task-category');
    const status = document.getElementById('bim-task-status');
    const startDate = document.getElementById('bim-task-start');
    const dueDate = document.getElementById('bim-task-due');
    const content = document.getElementById('bim-task-content');
    if (people) people.value = values.people || '';
    if (category) category.value = values.category || 'BIM';
    if (status) status.value = values.status || '계획';
    if (startDate) startDate.value = values.startDate || '';
    if (dueDate) dueDate.value = values.dueDate || '';
    if (content) content.value = values.content || '';
}

function openTaskModal(taskId) {
    const modal = document.getElementById('bim-task-modal');
    const title = document.getElementById('bim-task-modal-title');
    const saveBtn = document.getElementById('bim-task-save-btn');
    if (!modal) return;

    const tasks = getAllWeeklyTasks();
    const task = taskId ? tasks.find(item => item.id === taskId) : null;
    modal.dataset.mode = task ? 'edit' : 'add';
    modal.dataset.taskId = task ? task.id : '';
    setTaskFormValues(task || {});

    if (title) title.textContent = task ? '업무 수정' : '업무 추가';
    if (saveBtn) {
        saveBtn.innerHTML = task ? '<i class="fas fa-floppy-disk"></i> 저장' : '<i class="fas fa-plus"></i> 추가';
    }
    modal.style.display = 'flex';
    modal.setAttribute('aria-hidden', 'false');
}

function closeTaskModal() {
    const modal = document.getElementById('bim-task-modal');
    if (!modal) return;
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
    modal.dataset.mode = '';
    modal.dataset.taskId = '';
}

let isSavingWeeklyTask = false;
function saveTaskFromModal() {
    if (isSavingWeeklyTask) return;
    isSavingWeeklyTask = true;
    try {
        const modal = document.getElementById('bim-task-modal');
        const values = getTaskFormValues();
        const tasks = getAllWeeklyTasks();
        const mode = modal ? modal.dataset.mode : 'add';
        const taskId = modal ? modal.dataset.taskId : '';

        if (mode === 'edit' && taskId) {
            const idx = tasks.findIndex(task => task.id === taskId);
            if (idx > -1) tasks[idx] = { ...tasks[idx], ...values };
        } else {
            tasks.push({
                id: `task-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                ...values
            });
        }

        setAllWeeklyTasks(tasks);
        renderWeeklyTaskBoard();
        refreshTimelineModal();
        closeTaskModal();
    } finally {
        isSavingWeeklyTask = false;
    }
}

function deleteTask(taskId) {
    if (!taskId) return;
    const tasks = getAllWeeklyTasks().filter(task => task.id !== taskId);
    setAllWeeklyTasks(tasks);
    renderWeeklyTaskBoard();
    refreshTimelineModal();
}

function refreshTimelineModal() {
    const modal = document.getElementById('bim-timeline-modal');
    const body = document.getElementById('bim-timeline-modal-body');
    if (!modal || !body || modal.style.display !== 'flex') return;
    const mode = document.getElementById('bim-timeline-mode-expanded')?.value || document.getElementById('bim-timeline-mode')?.value || 'people';
    body.innerHTML = renderTimelineView(true, mode);
}

function initWeeklyTaskBoard() {
    populateWeekSelect();
    renderWeeklyTaskBoard();

    const addBtn = document.getElementById('bim-task-add-btn');
    if (addBtn && !addBtn.dataset.bound) {
        addBtn.dataset.bound = 'true';
        addBtn.addEventListener('click', () => openTaskModal());
    }

    const closeBtn = document.getElementById('bim-task-close-btn');
    const cancelBtn = document.getElementById('bim-task-cancel-btn');
    if (closeBtn && !closeBtn.dataset.bound) {
        closeBtn.dataset.bound = 'true';
        closeBtn.addEventListener('click', closeTaskModal);
    }
    if (cancelBtn && !cancelBtn.dataset.bound) {
        cancelBtn.dataset.bound = 'true';
        cancelBtn.addEventListener('click', closeTaskModal);
    }
    const timelineCloseBtn = document.getElementById('bim-timeline-close-btn');
    if (timelineCloseBtn && !timelineCloseBtn.dataset.bound) {
        timelineCloseBtn.dataset.bound = 'true';
        timelineCloseBtn.addEventListener('click', closeTimelineModal);
    }

    const form = document.getElementById('bim-task-form');
    if (form && !form.dataset.bound) {
        form.dataset.bound = 'true';
        form.addEventListener('submit', event => {
            event.preventDefault();
            saveTaskFromModal();
        });
    }

    const board = document.getElementById('bim-week-board');
    if (board && !board.dataset.bound) {
        board.dataset.bound = 'true';
        board.addEventListener('click', event => {
            const taskStatCard = event.target.closest('.bim-task-stat-card[data-task-stat]');
            if (taskStatCard) {
                openTaskStatsModal(taskStatCard.dataset.taskStat || 'all');
                return;
            }
            if (event.target.closest('.bim-model-update-card')) {
                openModelUpdateModal(false);
                return;
            }
            if (event.target.closest('#bim-timeline-expand-btn')) {
                openTimelineModal();
                return;
            }
            const row = event.target.closest('tr[data-task-id]');
            const timelineBar = event.target.closest('.bim-timeline-bar[data-task-id]');
            if (timelineBar) {
                openTaskModal(timelineBar.dataset.taskId);
                return;
            }
            if (!row) return;
            const taskId = row.dataset.taskId;
            if (event.target.closest('.bim-task-edit')) {
                openTaskModal(taskId);
            } else if (event.target.closest('.bim-task-delete')) {
                deleteTask(taskId);
            }
        });
        board.addEventListener('input', event => {
            if (event.target.closest('.bim-filter-grid')) refreshFilterResults();
        });
        board.addEventListener('change', event => {
            if (event.target.closest('.bim-filter-grid')) refreshFilterResults();
            if (event.target.id === 'bim-timeline-mode' || event.target.id === 'bim-timeline-scale' || event.target.id === 'bim-timeline-month' || event.target.id === 'bim-timeline-year') renderWeeklyTaskBoard();
        });
    }

    const timelineModalBody = document.getElementById('bim-timeline-modal-body');
    if (timelineModalBody && !timelineModalBody.dataset.bound) {
        timelineModalBody.dataset.bound = 'true';
        timelineModalBody.addEventListener('click', event => {
            const modelRow = event.target.closest('.bim-model-update-row[data-model-urn]');
            if (modelRow) {
                openModelUpdateInViewer(modelRow.dataset.modelUrn, modelRow.dataset.modelName);
                return;
            }
            if (event.target.closest('#bim-model-update-refresh')) {
                openModelUpdateModal(true);
                return;
            }
            const timelineBar = event.target.closest('.bim-timeline-bar[data-task-id]');
            if (timelineBar) openTaskModal(timelineBar.dataset.taskId);
        });
        timelineModalBody.addEventListener('change', event => {
            if (event.target.id === 'bim-timeline-mode-expanded' || event.target.id === 'bim-timeline-scale-expanded' || event.target.id === 'bim-timeline-month-expanded' || event.target.id === 'bim-timeline-year-expanded') {
                const mode = document.getElementById('bim-timeline-mode-expanded')?.value || 'people';
                timelineModalBody.innerHTML = renderTimelineView(true, mode);
            }
        });
    }

    const tabs = document.getElementById('bim-work-tabs');
    if (tabs && !tabs.dataset.bound) {
        tabs.dataset.bound = 'true';
        tabs.addEventListener('click', event => {
            const btn = event.target.closest('.bim-work-tab[data-work-view]');
            if (!btn) return;
            currentWorkView = btn.dataset.workView || 'week';
            renderWeeklyTaskBoard();
        });
    }
}

function initStructureIssueBoard() {
    const wrap = document.getElementById('bim-issue-gantt-wrap');
    if (!wrap || wrap.dataset.issueListBound) return;
    wrap.dataset.issueListBound = 'true';
    wrap.addEventListener('click', event => {
        const target = event.target.closest('.bim-chart-clickable[data-location]');
        if (!target) return;
        openStructureIssueModal(target.dataset.location, target.dataset.month || '');
    });
}

async function refreshConstructionBimDashboard() {
    populateWeekSelect();
    if (currentWorkView === 'stats') {
        modelUpdateState = { ...modelUpdateState, loaded: false, error: '' };
        loadModelUpdateStats(true);
    }
    renderWeeklyTaskBoard();
    const wrap = document.getElementById('bim-issue-gantt-wrap');
    if (wrap) wrap.innerHTML = '<div class="bim-db-placeholder">이슈 데이터를 불러오는 중입니다.</div>';
    const issues = await loadIssues();
    renderGantt(issues);
    renderClashStructureChart(issues);
    renderMonthlyIssueStatusTab(issues);
}

async function refreshMonthlyIssueStatusTab(force = false) {
    bindMonthlyIssueStatusTab();
    const root = document.getElementById('monthly-issue-status-root');
    if (root && (!window._gangbukFormaCache || force)) {
        root.innerHTML = '<div class="bim-db-placeholder">월간 이슈 데이터를 불러오는 중입니다.</div>';
    }
    // 🚨 [강력 규제] 오직 '이슈' 탭 캐시(_gangbukFormaCache) 기반으로만 월간 이슈 현황 구성
    const issues = await loadIssues();
    window._constructionIssueCache = issues;
    renderMonthlyIssueStatusTab(issues);
}

export function initConstructionBimDashboard() {
    const refreshBtn = document.getElementById('bim-dashboard-refresh');
    if (refreshBtn && !refreshBtn.dataset.bound) {
        refreshBtn.dataset.bound = 'true';
        refreshBtn.addEventListener('click', refreshConstructionBimDashboard);
    }
    initWeeklyTaskBoard();
    initStructureIssueBoard();
    initConstructionProgressPanel();
    initConstructionLivePanel();
    initConstructionInspectorPanel();
    bindMonthlyIssueStatusTab();
    refreshConstructionBimDashboard();
}

window.refreshConstructionBimDashboard = refreshConstructionBimDashboard;
window.refreshMonthlyIssueStatusTab = refreshMonthlyIssueStatusTab;





