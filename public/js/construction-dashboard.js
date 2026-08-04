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
let clashStructureChart = null;
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
        dates.push(start, end);
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

function mergeIssues(lists) {
    const seen = new Set();
    const merged = [];
    lists.flat().forEach(issue => {
        if (!issue) return;
        const key = getIssueKey(issue);
        if (!key || seen.has(key)) return;
        seen.add(key);
        merged.push(issue);
    });
    return merged;
}

async function loadIssues() {
    let formaIssues = [];
    try {
        const resp = await fetch('/api/issues/forma-gangbuk?limit=500', { credentials: 'same-origin' });
        if (resp.ok) {
            const json = await resp.json();
            formaIssues = Array.isArray(json.data) ? json.data : [];
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
            if (!issueOverlapsMonth(issue, monthKey)) return;
            if (!row.months.has(monthKey)) {
                row.months.set(monthKey, { created: 0, review: 0, delayed: 0, closed: 0, total: 0 });
            }
            const bucket = row.months.get(monthKey);
            bucket[group] += 1;
            bucket.total += 1;
        });
    });

    return Array.from(rows.values()).sort((a, b) => b.total - a.total || a.location.localeCompare(b.location, 'ko'));
}

function renderGantt(issues) {
    const wrap = document.getElementById('bim-issue-gantt-wrap');
    const total = document.getElementById('bim-dashboard-issue-total');
    if (total) total.textContent = `이슈 ${issues.length}건`;
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
            <div class="bim-chart-yitem">
                <div class="bim-structure-name" title="${escapeHtml(row.location)}">${escapeHtml(row.location)}</div>
                <div class="bim-structure-summary">${row.total}건 · 종료 ${row.closed} · ${progress}%</div>
            </div>
        `;
    }).join('');

    const plot = rows.map(row => {
        const cells = months.map(month => renderChartCell(row.months.get(month))).join('');
        return `<div class="bim-chart-row">${cells}</div>`;
    }).join('');

    const xAxis = months.map(month => `<div class="bim-chart-month">${getMonthLabel(month)}</div>`).join('');

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

function renderChartCell(bucket) {
    if (!bucket || !bucket.total) {
        return '<div class="bim-chart-cell"><div class="bim-chart-empty"></div></div>';
    }

    const label = GROUP_ORDER
        .map(groupKey => {
            const count = bucket[groupKey] || 0;
            return count ? `${STATUS_GROUPS[groupKey].label} ${count}` : '';
        })
        .filter(Boolean)
        .join(' · ');

    const segments = GROUP_ORDER.map(groupKey => {
        const count = bucket[groupKey] || 0;
        if (!count) return '';
        const group = STATUS_GROUPS[groupKey];
        const width = Math.max(3, (count / bucket.total) * 100);
        return `<div class="bim-chart-seg" title="${escapeHtml(group.label)} ${count}건" style="width:${width}%; background:${group.color};">${count}</div>`;
    }).join('');

    return `
        <div class="bim-chart-cell" title="${escapeHtml(label)}">
            <div class="bim-chart-bar">${segments}</div>
        </div>
    `;
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
        { label: '전체 공사', value: all, color: '#22c55e' },
        { label: '신설 공사', value: fresh, color: '#ef4444' },
        { label: '증설 공사', value: extension, color: '#06b6d4' }
    ];
    wrap.innerHTML = cards.map(card => `
        <div class="bim-progress-donut-card${activeZone && card.label.indexOf(CONSTRUCTION_ZONES[activeZone]?.label || '') > -1 ? ' active' : ''}">
            <div class="bim-progress-donut-title">${escapeHtml(card.label)}</div>
            <div class="bim-progress-donut" style="--value:${card.value}; --donut-color:${card.color};"><span>${card.value}%</span></div>
        </div>
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
                    folderPath: nextPath.join(' / ')
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
    const hubId = window.currentHubId || CONSTRUCTION_TARGET_HUB_ID;
    const projectId = window.currentProjectId || CONSTRUCTION_TARGET_PROJECT_ID;
    const url = `/api/hubs/${encodeURIComponent(hubId)}/projects/${encodeURIComponent(projectId)}/rvt-files?strict=1`;
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
    const zoneNodes = findZoneFolderNodes(tree, zone);
    const models = dedupeModels(zoneNodes.flatMap(node => collectNodeFiles(node, [])).filter(model => modelBelongsToZone(model, zone)));
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

async function getConstructionMiniViewer() {
    const container = document.getElementById('bim-progress-mini-viewer');
    if (!container) return null;

    if (window.constructionProgressViewer && window.constructionProgressViewer.impl) {
        hideConstructionMiniViewerToolbar(window.constructionProgressViewer);
        return window.constructionProgressViewer;
    }

    const viewerModule = await import('./viewer.js');
    if (typeof viewerModule.initViewer !== 'function') return null;

    const viewer = await viewerModule.initViewer(container, true);
    hideConstructionMiniViewerToolbar(viewer);
    if (window.Autodesk && Autodesk.Viewing && Autodesk.Viewing.TOOLBAR_CREATED_EVENT) {
        viewer.addEventListener(Autodesk.Viewing.TOOLBAR_CREATED_EVENT, () => hideConstructionMiniViewerToolbar(viewer));
    }
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
    window._constructionActiveViewerZone = zone;

    try {
        if (typeof viewer.resize === 'function') viewer.resize();
        if (typeof viewer.fitToView === 'function') viewer.fitToView();
        if (viewer.impl && typeof viewer.impl.invalidate === 'function') {
            viewer.impl.invalidate(true, true, true);
        }
    } catch (error) {
        console.warn('[Construction Progress] viewer fit failed:', error);
    }

    setConstructionProgressNote(`${zoneMeta.label} 폴더 모델 ${models.length}개를 표시 중입니다.`);
    return true;
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
    if (!map || map.dataset.bound) return;
    map.dataset.bound = 'true';
    const backBtn = document.getElementById('bim-progress-viewer-back');
    if (backBtn) {
        backBtn.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            closeConstructionViewerLayer();
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

function renderStatsView() {
    const tasks = getAllWeeklyTasks();
    const completed = tasks.filter(task => task.status === '완료').length;
    const active = tasks.filter(task => task.status === '진행중').length;
    const peopleCounts = countBy(tasks, task => task.people || '미지정');
    const longest = tasks.slice().sort((a, b) => getTaskDurationDays(b) - getTaskDurationDays(a))[0];
    const categoryCounts = countBy(tasks, task => task.category || '기타');
    const statusCounts = countBy(tasks, task => task.status || '계획');

    return `
        <div class="bim-stats-grid">
            <div class="bim-stat-card"><div class="bim-stat-label">전체 업무</div><div class="bim-stat-value">${tasks.length}건</div></div>
            <div class="bim-stat-card"><div class="bim-stat-label">진행중</div><div class="bim-stat-value">${active}건</div></div>
            <div class="bim-stat-card"><div class="bim-stat-label">완료</div><div class="bim-stat-value">${completed}건</div></div>
            <div class="bim-stat-card"><div class="bim-stat-label">최다 수행인원</div><div class="bim-stat-value" title="${escapeHtml(peopleCounts[0]?.[0] || '-')}">${escapeHtml(peopleCounts[0]?.[0] || '-')}</div></div>
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

async function refreshConstructionBimDashboard() {
    populateWeekSelect();
    renderWeeklyTaskBoard();
    const wrap = document.getElementById('bim-issue-gantt-wrap');
    if (wrap) wrap.innerHTML = '<div class="bim-db-placeholder">이슈 데이터를 불러오는 중입니다.</div>';
    const issues = await loadIssues();
    renderGantt(issues);
    renderClashStructureChart(issues);
}

export function initConstructionBimDashboard() {
    const refreshBtn = document.getElementById('bim-dashboard-refresh');
    if (refreshBtn && !refreshBtn.dataset.bound) {
        refreshBtn.dataset.bound = 'true';
        refreshBtn.addEventListener('click', refreshConstructionBimDashboard);
    }
    initWeeklyTaskBoard();
    initConstructionProgressPanel();
    refreshConstructionBimDashboard();
}

window.refreshConstructionBimDashboard = refreshConstructionBimDashboard;





