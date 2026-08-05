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

const GROUP_ORDER = ['created', 'review', 'delayed', 'closed'];
const monthlyIssueChartMode = 'bar'; // Change to 'dumbbell' to preview the dumbbell monthly chart.
let clashStructureChart = null;
const monthlyIssueDrilldownState = { location: '', month: '' };
const dashboardIssueRegistry = new Map();
const CONSTRUCTION_PROGRESS_ITEMS = [
    { id: 'new-01', zone: 'new', name: '신설 수처리동', progress: 68, status: '진행중', startDate: '2026-07-20', endDate: '2026-08-08', color: '#ef4444' },
    { id: 'new-02', zone: 'new', name: '신설 제수밸브실', progress: 46, status: '진행중', startDate: '2026-07-24', endDate: '2026-08-14', color: '#ef4444' },
    { id: 'extension-01', zone: 'extension', name: '증설 여과지', progress: 73, status: '진행중', startDate: '2026-07-29', endDate: '2026-08-20', color: '#06b6d4' },
    { id: 'priority-01', zone: 'priority', name: '우선시공 관로구간', progress: 91, status: '완료임박', startDate: '2026-07-18', endDate: '2026-08-02', color: '#eab308' }
];
const CONSTRUCTION_ZONES = {
    new: { label: '신설', color: '#ef4444' },
    extension: { label: '증설', color: '#06b6d4' },
    priority: { label: '우선시공분', color: '#eab308' }
};
const CONSTRUCTION_ZONE_FOLDER_KEYWORDS = {
    new: ['신설', '신설구조물', '신설 구조물'],
    extension: ['증설', '증설구조물', '증설 구조물'],
    priority: ['우선시공', '우선시공분', '우선 시공']
};
const CONSTRUCTION_TARGET_HUB_ID = 'b.4efd43ab-93fa-4448-918b-091d81dbfd75';
const CONSTRUCTION_TARGET_PROJECT_ID = 'b.374bde3a-83a3-4dd5-80c2-2e01ddeac719';
const CONSTRUCTION_VIEW_STATE_PREFIX = 'gangbuk_construction_progress_view_';

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

function getIssueLocation(issue) {
    const raw = issue.rawFormaIssue || {};
    const rawAttrs = raw.attributes && typeof raw.attributes === 'object' ? raw.attributes : {};
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

    for (const groupKey of GROUP_ORDER) {
        const group = STATUS_GROUPS[groupKey];
        const matched = group.statuses.some(status => {
            const key = String(status).toLowerCase().replace(/[\s_-]+/g, '');
            return compact === key;
        });
        if (matched) return groupKey;
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
    let cursor = new Date(min.getFullYear(), min.getMonth(), 1);
    const last = new Date(max.getFullYear(), max.getMonth(), 1);
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
    let formaIssues = [];
    try {
        const resp = await fetch('/api/issues/forma-gangbuk?limit=500', { credentials: 'same-origin' });
        if (resp.ok) {
            const json = await resp.json();
            formaIssues = (Array.isArray(json.data) ? json.data : []).filter(isVisibleIssueForMainTabs);
            window._gangbukFormaCache = formaIssues;
            return mergeIssues([formaIssues]);
        }
    } catch (err) {
        console.warn('[Construction BIM Dashboard] Forma issue fetch failed:', err);
    }

    if (Array.isArray(window._gangbukFormaCache) && window._gangbukFormaCache.length) {
        return mergeIssues([window._gangbukFormaCache]);
    }
    return [];
}

function summarizeByLocationAndMonth(issues, months) {
    const rows = new Map();

    issues.forEach(issue => {
        const location = getIssueLocation(issue);
        const group = getStatusGroup(issue);
        const endMonth = getMonthKey(getIssueEnd(issue, getIssueStart(issue)));
        if (!rows.has(location)) {
            rows.set(location, {
                location,
                total: 0,
                closed: 0,
                months: new Map()
            });
        }

        const row = rows.get(location);
        row.total += 1;
        if (group === 'closed') row.closed += 1;

        months.forEach(monthKey => {
            if (!issueEndsInMonth(issue, monthKey)) return;
            if (!row.months.has(monthKey)) {
                row.months.set(monthKey, {
                    created: 0,
                    review: 0,
                    delayed: 0,
                    closed: 0,
                    total: 0,
                    active: { created: 0, review: 0, delayed: 0, closed: 0, total: 0 },
                    started: { created: 0, review: 0, delayed: 0, closed: 0, total: 0 },
                    ended: { created: 0, review: 0, delayed: 0, closed: 0, total: 0 }
                });
            }
            const bucket = row.months.get(monthKey);
            bucket.active[group] += 1;
            bucket.active.total += 1;
            if (monthKey === endMonth) {
                bucket.ended[group] += 1;
                bucket.ended.total += 1;
                bucket[group] += 1;
                bucket.total += 1;
            }
        });
    });

    return Array.from(rows.values()).sort((a, b) => b.total - a.total || a.location.localeCompare(b.location, 'ko'));
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
                <div class="bim-structure-summary">${row.total}건 · 종료 ${row.closed} · ${progress}%</div>
            </div>
        `;
    }).join('');

    const plot = rows.map(row => {
        const cells = months.map(month => renderChartCell(row.months.get(month), row.location, month)).join('');
        return `<div class="bim-chart-row">${cells}</div>`;
    }).join('');

    const xAxis = months.map(month => `<button type="button" class="bim-chart-month monthly-issue-month-button" data-month="${escapeHtml(month)}" title="${escapeHtml(`${getMonthLabel(month)} 전체 이슈 분석 보기`)}">${getMonthLabel(month)}</button>`).join('');

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

function renderStatusLegend() {
    if (monthlyIssueChartMode === 'dumbbell') {
        return `
            <div class="bim-chart-legend" aria-label="덤벨 차트 범례">
                <span class="bim-chart-legend-item"><span class="bim-chart-legend-dot start"></span><span>시작 이슈</span></span>
                <span class="bim-chart-legend-item"><span class="bim-chart-legend-dot end"></span><span>종료 이슈</span></span>
                <span class="bim-chart-legend-item"><span class="bim-chart-legend-line"></span><span>활성 기간</span></span>
            </div>
        `;
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

    return `<div class="bim-chart-legend" aria-label="이슈 상태 색상 범례">${items}</div>`;
}

function renderChartCell(bucket, location = '', month = '') {
    if (monthlyIssueChartMode === 'dumbbell') {
        return renderDumbbellChartCell(bucket, location, month);
    }
    const active = bucket && bucket.active ? bucket.active : bucket;
    const ended = bucket && bucket.ended ? bucket.ended : bucket;
    if (!active || !active.total) {
        return '<div class="bim-chart-cell"><div class="bim-chart-empty"></div></div>';
    }

    const label = GROUP_ORDER
        .map(groupKey => {
            const activeCount = active[groupKey] || 0;
            const endedCount = ended[groupKey] || 0;
            if (!activeCount) return '';
            return `${STATUS_GROUPS[groupKey].label} 활성 ${activeCount}건${endedCount ? ` · 종료 ${endedCount}건` : ''}`;
        })
        .filter(Boolean)
        .join(' · ');

    const segments = GROUP_ORDER.map(groupKey => {
        const activeCount = active[groupKey] || 0;
        const endedCount = ended[groupKey] || 0;
        if (!activeCount) return '';
        const group = STATUS_GROUPS[groupKey];
        const width = Math.max(3, (activeCount / active.total) * 100);
        const segmentClass = endedCount ? 'bim-chart-seg' : 'bim-chart-seg bim-chart-seg-continuing';
        const segmentText = endedCount ? String(endedCount) : '';
        return `<div class="${segmentClass}" title="${escapeHtml(`${group.label} 활성 ${activeCount}건${endedCount ? ` · 종료 ${endedCount}건` : ' · 진행 중'}`)}" style="width:${width}%; background:${group.color};">${segmentText}</div>`;
    }).join('');

    return `
        <div class="bim-chart-cell bim-chart-clickable" data-location="${escapeHtml(location)}" data-month="${escapeHtml(month)}" title="${escapeHtml(`${getMonthLabel(month)} · ${location} · ${label}`)}">
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
                    <th style="width:150px;">유형</th>
                    <th style="width:92px;">시작일</th>
                    <th style="width:92px;">마감일</th>
                    <th style="width:110px;">담당자</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    `;
}

function bindStructureIssueListEvents(container, issues) {
    if (!container) return;
    const localMap = new Map();
    issues.forEach(issue => {
        const key = getIssueKey(issue);
        if (key) {
            localMap.set(key, issue);
            dashboardIssueRegistry.set(key, issue);
        }
    });
    container.querySelectorAll('.bim-structure-issue-row').forEach(row => {
        row.addEventListener('click', () => {
            const key = row.getAttribute('data-issue-key') || '';
            const issue = localMap.get(key) || dashboardIssueRegistry.get(key);
            if (!issue) return;
            if (typeof window.openFormaIssueDetail === 'function') {
                window.openFormaIssueDetail(issue);
            } else {
                console.warn('[Construction BIM Dashboard] openFormaIssueDetail is not available.');
                alert('이슈 상세 정보 모듈을 불러오는 중입니다. 잠시 후 다시 시도해 주세요.');
            }
        });
    });
}

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
        </div>
        ${renderStructureIssueList(issues, `${titleText}이 없습니다.`)}
    `;
    bindStructureIssueListEvents(body, issues);
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
                <h3>이슈 상태</h3>
                <span>${issues.length}건</span>
            </div>
            <div class="monthly-drilldown-kpis">
                ${renderDrilldownKpi('전체 이슈', summary.total, '#38bdf8')}
                ${renderDrilldownKpi('생성', summary.created, '#38bdf8')}
                ${renderDrilldownKpi('검토', summary.review, '#a78bfa')}
                ${renderDrilldownKpi('지연', summary.delayed, '#f59e0b')}
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
                <h3>이슈 상태</h3>
                <span>${issues.length}건</span>
            </div>
            <div class="monthly-drilldown-kpis">
                ${renderDrilldownKpi('전체 이슈', summary.total, '#38bdf8')}
                ${renderDrilldownKpi('생성', summary.created, '#38bdf8')}
                ${renderDrilldownKpi('검토', summary.review, '#a78bfa')}
                ${renderDrilldownKpi('지연', summary.delayed, '#f59e0b')}
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
                ${renderDrilldownKpi('지연', summary.delayed, '#f59e0b')}
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
                ${renderMonthlyIssueKpi('지연', totals.delayed, '#f59e0b')}
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
                <td>${row.delayed}</td>
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
            ${renderMonthlyIssueKpi('지연', totals.delayed, '#f59e0b')}
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
                        <th>지연</th>
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

function renderMonthlyIssueStatusTab(issues = []) {
    const root = document.getElementById('monthly-issue-status-root');
    if (!root) return;

    const search = document.getElementById('monthly-issue-search')?.value || '';
    const query = String(search || '').trim().toLowerCase();
    const filteredIssues = (Array.isArray(issues) ? issues : []).filter(issue => {
        if (!query) return true;
        return getIssueLocation(issue).toLowerCase().includes(query);
    });

    if (!filteredIssues.length) {
        root.innerHTML = '<div class="bim-db-placeholder">표시할 월간 이슈 데이터가 없습니다.</div>';
        return;
    }

    const months = buildMonthRange(filteredIssues);
    const rows = summarizeByLocationAndMonth(filteredIssues, months);
    const totals = filteredIssues.reduce((acc, issue) => {
        const groupKey = getStatusGroup(issue);
        acc.total += 1;
        acc[groupKey] += 1;
        return acc;
    }, { total: 0, created: 0, review: 0, delayed: 0, closed: 0 });
    const completion = totals.total ? Math.round((totals.closed / totals.total) * 100) : 0;
    const monthWidth = Math.max(84, Math.floor(980 / Math.max(months.length, 1)));
    const chartStyle = `--bim-month-count:${months.length}; --bim-month-width:${monthWidth}px;`;
    const yAxis = rows.map(row => {
        const progress = row.total ? Math.round((row.closed / row.total) * 100) : 0;
        return `
            <div class="bim-chart-yitem monthly-issue-yitem monthly-issue-structure-cell bim-chart-clickable" data-location="${escapeHtml(row.location)}" title="${escapeHtml(row.location)} 이슈 목록 보기">
                <div class="bim-structure-name" title="${escapeHtml(row.location)}">${escapeHtml(row.location)}</div>
            </div>
        `;
    }).join('');

    const plot = rows.map(row => {
        const cells = months.map(month => renderChartCell(row.months.get(month), row.location, month)).join('');
        return `<div class="bim-chart-row monthly-issue-chart-row">${cells}</div>`;
    }).join('');
    const xAxis = months.map(month => `<button type="button" class="bim-chart-month monthly-issue-month-button" data-month="${escapeHtml(month)}" title="${escapeHtml(`${getMonthLabel(month)} 전체 이슈 분석 보기`)}">${getMonthLabel(month)}</button>`).join('');

    root.innerHTML = `
        <div class="monthly-issue-kpis monthly-issue-kpis-compact">
            ${renderMonthlyIssueKpi('전체 이슈', totals.total, '#38bdf8', 'all')}
            ${renderMonthlyIssueKpi('생성', totals.created, '#38bdf8', 'created')}
            ${renderMonthlyIssueKpi('검토', totals.review, '#a78bfa', 'review')}
            ${renderMonthlyIssueKpi('지연', totals.delayed, '#f59e0b', 'delayed')}
            ${renderMonthlyIssueKpi('종료', totals.closed, '#10b981', 'closed')}
            ${renderMonthlyIssueKpi('완료율', `${completion}%`, '#10b981', 'closed')}
        </div>
        <div class="monthly-issue-workspace">
            <div class="monthly-issue-chart-wrap">
                ${renderStatusLegend()}
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
    if (root && !root.dataset.monthlyIssueBound) {
        root.dataset.monthlyIssueBound = 'true';
        root.addEventListener('click', event => {
            const kpi = event.target.closest('.monthly-issue-kpi[data-status]');
            if (kpi) {
                const statusKey = kpi.dataset.status || 'all';
                const searchValue = document.getElementById('monthly-issue-search')?.value || '';
                const query = String(searchValue || '').trim().toLowerCase();
                const issues = (Array.isArray(window._constructionIssueCache) ? window._constructionIssueCache : []).filter(issue => {
                    if (query && !getIssueLocation(issue).toLowerCase().includes(query)) return false;
                    return statusKey === 'all' || getStatusGroup(issue) === statusKey;
                });
                const titleMap = {
                    all: '전체 이슈 목록',
                    created: '생성 이슈 목록',
                    review: '검토 이슈 목록',
                    delayed: '지연 이슈 목록',
                    closed: '종료 이슈 목록'
                };
                openMonthlyIssueListModal(titleMap[statusKey] || '이슈 목록', issues);
                return;
            }
            const monthButton = event.target.closest('.monthly-issue-month-button[data-month]');
            if (monthButton) {
                openMonthIssueModal(monthButton.dataset.month || '');
                return;
            }
            const target = event.target.closest('.monthly-issue-structure-cell[data-location], .bim-chart-clickable[data-location]');
            if (!target) return;
            openStructureIssueModal(target.dataset.location || '', target.dataset.month || '');
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
function getProgressItems(zone = '') {
    return zone ? CONSTRUCTION_PROGRESS_ITEMS.filter(item => item.zone === zone) : CONSTRUCTION_PROGRESS_ITEMS;
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
    if (range.scale === 'year') return Math.max(0, Math.min(range.cols.length - 1, date.getMonth()));
    const idx = range.cols.findIndex(col => col.key === (range.scale === 'month' ? formatDateKey(date) : formatDateKey(date)));
    if (idx >= 0) return idx;
    return date < range.start ? 0 : Math.max(0, range.cols.length - 1);
}

function renderConstructionSchedule(activeZone = '', settings = constructionScheduleState, expanded = false) {
    const wrap = document.getElementById('bim-construction-gantt');
    if (!wrap && !expanded) return '';
    const items = getProgressItems(activeZone);
    if (!items.length) {
        const empty = '<div class="bim-week-empty">표시할 공정 데이터가 없습니다.</div>';
        if (wrap && !expanded) wrap.innerHTML = empty;
        return empty;
    }

    const range = getScheduleRange(settings);
    const colCount = range.cols.length;
    const controlSuffix = expanded ? '-expanded' : '';
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
    ` : `<button id="bim-construction-schedule-expand" type="button" class="bim-icon-btn" title="공사 일정 크게 보기"><i class="fas fa-up-right-and-down-left-from-center"></i></button>`;

    const headers = range.cols.map(col => `
        <div class="bim-schedule-cell bim-schedule-head bim-schedule-day${col.weekend ? ' weekend' : ''}">
            <span>${escapeHtml(col.label)}</span>${col.subLabel ? `<small>${escapeHtml(col.subLabel)}</small>` : ''}
        </div>
    `).join('');

    const rows = items.map(item => {
        const itemStart = parseIssueDate(item.startDate);
        const itemEnd = parseIssueDate(item.endDate || item.startDate) || itemStart;
        const overlaps = itemStart <= range.end && itemEnd >= range.start;
        const start = overlaps ? getScheduleColumnIndex(range, item.startDate, range.start) : 0;
        const end = overlaps ? getScheduleColumnIndex(range, item.endDate || item.startDate, itemStart || range.start) : -1;
        const span = Math.max(1, end - start + 1);
        return `
            <div class="bim-schedule-cell bim-schedule-left" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div>
            <div class="bim-schedule-plot" title="${escapeHtml(item.name)} ${escapeHtml(item.startDate)} ~ ${escapeHtml(item.endDate)}">
                ${overlaps ? `<div class="bim-schedule-bar" style="--start:${start}; --span:${span}; --task-color:${item.color};"></div>` : '<div class="bim-schedule-outside">기간 외</div>'}
            </div>
            <div class="bim-schedule-cell bim-schedule-progress">${item.progress}%</div>
        `;
    }).join('');

    const html = `
        <div class="bim-schedule-toolbar">
            <div class="bim-schedule-title">${expanded ? '간단 공사 일정' : '주간 일정'} · ${range.label}</div>
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
    constructionScheduleState.scale = 'week';
    renderConstructionSchedule(activeZone, constructionScheduleState, false);
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
    const all = getAverageProgress(CONSTRUCTION_PROGRESS_ITEMS);
    const fresh = getAverageProgress(getProgressItems('new'));
    const extension = getAverageProgress(getProgressItems('extension'));
    const cards = [
        { label: '전체 공사', value: all, color: '#22c55e', zone: '' },
        { label: '신설 공사', value: fresh, color: '#ef4444', zone: 'new' },
        { label: '증설 공사', value: extension, color: '#06b6d4', zone: 'extension' }
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

function saveConstructionViewerState(zone) {
    const viewer = window.constructionProgressViewer;
    const zoneMeta = CONSTRUCTION_ZONES[zone];
    if (!viewer || typeof viewer.getState !== 'function') {
        setConstructionProgressNote('저장할 3D 뷰어 시점을 찾지 못했습니다.');
        return false;
    }
    try {
        const state = viewer.getState({ viewport: true });
        localStorage.setItem(getConstructionViewStateKey(zone), JSON.stringify(state));
        setConstructionProgressNote(`${zoneMeta ? zoneMeta.label : '현재'} 뷰 시점을 저장했습니다.`);
        return true;
    } catch (error) {
        console.warn('[Construction Progress] save view state failed:', error);
        setConstructionProgressNote('뷰 시점 저장 중 오류가 발생했습니다.');
        return false;
    }
}

function restoreConstructionViewerState(zone, viewer) {
    if (!viewer || typeof viewer.restoreState !== 'function') return false;
    try {
        const raw = localStorage.getItem(getConstructionViewStateKey(zone));
        if (!raw) return false;
        const state = JSON.parse(raw);
        return viewer.restoreState(state, null, true);
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
    const container = document.getElementById('bim-progress-mini-viewer');
    if (!container) return null;

    if (window.constructionProgressViewer && window.constructionProgressViewer.impl) {
        hideConstructionMiniViewerToolbar(window.constructionProgressViewer);
        resizeConstructionViewCube();
        return window.constructionProgressViewer;
    }

    const viewerModule = await import('./viewer.js');
    if (typeof viewerModule.initViewer !== 'function') return null;

    const viewer = await viewerModule.initViewer(container, true);
    hideConstructionMiniViewerToolbar(viewer);
    resizeConstructionViewCube();
    if (window.Autodesk && Autodesk.Viewing && Autodesk.Viewing.TOOLBAR_CREATED_EVENT) {
        viewer.addEventListener(Autodesk.Viewing.TOOLBAR_CREATED_EVENT, () => {
            hideConstructionMiniViewerToolbar(viewer);
            resizeConstructionViewCube();
        });
    }
    setTimeout(resizeConstructionViewCube, 500);
    window.constructionProgressViewer = viewer;
    return viewer;
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

async function reloadActiveConstructionZoneModels() {
    const zone = window._constructionActiveViewerZone || '';
    const zoneMeta = CONSTRUCTION_ZONES[zone];
    if (!zoneMeta) {
        setConstructionProgressNote('먼저 신설 또는 증설 영역을 선택해 주세요.');
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
        setConstructionProgressNote('먼저 신설 또는 증설 영역을 선택해 주세요.');
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

function initConstructionProgressPanel() {
    renderConstructionGantt('');
    renderProgressDonuts('');
    const gantt = document.getElementById('bim-construction-gantt');
    if (gantt && !gantt.dataset.bound) {
        gantt.dataset.bound = 'true';
        gantt.addEventListener('click', event => {
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
    const mergeBtn = document.getElementById('bim-progress-viewer-merge');
    const saveViewBtn = document.getElementById('bim-progress-viewer-save-view');
    if (backBtn) {
        backBtn.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            closeConstructionViewerLayer();
        });
    }
    if (mergeBtn && !mergeBtn.dataset.bound) {
        mergeBtn.dataset.bound = 'true';
        mergeBtn.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            openConstructionMergePanel();
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
    map.addEventListener('mouseover', event => {
        const zoneBtn = event.target.closest('.bim-zone[data-zone]');
        if (zoneBtn) setActiveConstructionZone(zoneBtn.dataset.zone);
    });
    map.addEventListener('mouseleave', () => setActiveConstructionZone(''));
    map.addEventListener('click', event => {
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
        import('./viewer.js?v=20260804-main-rotate-fix1')
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

function saveTaskFromModal() {
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
    const saveBtn = document.getElementById('bim-task-save-btn');
    if (closeBtn && !closeBtn.dataset.bound) {
        closeBtn.dataset.bound = 'true';
        closeBtn.addEventListener('click', closeTaskModal);
    }
    if (cancelBtn && !cancelBtn.dataset.bound) {
        cancelBtn.dataset.bound = 'true';
        cancelBtn.addEventListener('click', closeTaskModal);
    }
    if (saveBtn && !saveBtn.dataset.bound) {
        saveBtn.dataset.bound = 'true';
        saveBtn.addEventListener('click', saveTaskFromModal);
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
    if (root && (!window._constructionIssueCache || force)) {
        root.innerHTML = '<div class="bim-db-placeholder">월간 이슈 데이터를 불러오는 중입니다.</div>';
    }
    const issues = !force && Array.isArray(window._constructionIssueCache) && window._constructionIssueCache.length
        ? mergeIssues([window._constructionIssueCache])
        : await loadIssues();
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
    bindMonthlyIssueStatusTab();
    refreshConstructionBimDashboard();
}

window.refreshConstructionBimDashboard = refreshConstructionBimDashboard;
window.refreshMonthlyIssueStatusTab = refreshMonthlyIssueStatusTab;





