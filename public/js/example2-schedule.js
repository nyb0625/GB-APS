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
    cacheTs: 0
};

const GUNHWA_SCHEDULE_CACHE_KEY = 'gangbuk_work_schedule_stale_cache_v8';
const SCHEDULE_BACKGROUND_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

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

    if (statusText.includes('완료') || statusText.includes('종료') || statusText.includes('closed') || statusText.includes('done') || statusText.includes('complete')) {
        return 'done';
    }
    if (statusText.includes('지연') || statusText.includes('delay') || statusText.includes('overdue') || (due && due < now)) {
        return 'delayed';
    }
    if (statusText.includes('진행') || statusText.includes('검토') || statusText.includes('review') || statusText.includes('open') || (start && start <= now && (!due || due >= now))) {
        return 'active';
    }
    return 'planned';
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

    return {
        id: issue.id || issue.displayId || issue.dbId || '',
        title: issue.title || issue.name || readDeep(raw, ['attributes.title', 'title', 'name']) || '작업명 없음',
        statusKey,
        statusLabel: STATUS_STYLES[statusKey].label,
        rawStatus: issue.status || issue.state || '-',
        startDate: formatDate(startDate),
        dueDate: formatDate(dueDate),
        durationDays: daysBetween(startDate, dueDate),
        assignee: issue.assignee || issue.assignedTo || readDeep(raw, ['attributes.assignee', 'attributes.assignedTo', 'assignee', 'assignedTo']) || '미지정',
        location: issue.location || issue.locationName || issue.structure || readDeep(raw, ['attributes.location', 'attributes.locationName', 'location', 'locationName']) || '미지정',
        typePath: textValue(typePath) || '업데이트/건화',
        description: issue.description || issue.desc || readDeep(raw, ['attributes.description', 'description']) || ''
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

function getDefaultMonth(tasks) {
    const todayKey = monthKeyFromDate(new Date());
    const months = getAvailableMonths(tasks);
    return months.includes(todayKey) ? todayKey : (months[0] || todayKey);
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

    const months = getAvailableMonths(scheduleState.tasks);
    if (!scheduleState.month || !months.includes(scheduleState.month)) {
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

function getFilteredTasks() {
    const query = scheduleState.query.trim().toLowerCase();
    return scheduleState.tasks.filter(task => {
        if (!taskOverlapsMonth(task, scheduleState.month)) return false;
        if (scheduleState.status !== 'all' && task.statusKey !== scheduleState.status) return false;
        if (!query) return true;
        return [task.title, task.assignee, task.location, task.typePath, task.description, task.rawStatus]
            .some(value => String(value || '').toLowerCase().includes(query));
    });
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
    const taskColumnWidth = 240;
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
        <div title="${escapeHtml(meta.isToday ? '오늘' : (meta.holidayName || (meta.isSunday ? '일요일' : (meta.isSaturday ? '토요일' : ''))))}" style="grid-column:${meta.day} / ${meta.day + 1}; grid-row:1; align-self:stretch; background:${meta.isToday ? 'rgba(250,204,21,0.18)' : (meta.holidayName ? 'rgba(248,113,113,0.16)' : (meta.isSunday ? 'rgba(248,113,113,0.09)' : (meta.isSaturday ? 'rgba(56,189,248,0.08)' : 'transparent')))}; border-left:1px solid rgba(148,163,184,0.08); ${meta.isToday ? 'box-shadow: inset 2px 0 0 #facc15, inset -2px 0 0 #facc15;' : ''}"></div>
    `).join('');
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

    const rows = chartTasks.length
        ? chartTasks.map(task => {
            const style = STATUS_STYLES[task.statusKey] || STATUS_STYLES.planned;
            return `
                <div style="display:grid; grid-template-columns:${taskColumnWidth}px minmax(0,1fr); min-height:38px; border-top:1px solid rgba(148,163,184,0.10);">
                    <div style="min-width:0; padding:7px 10px; color:#e5e7eb; font-size:11px; font-weight:800; line-height:1.35; white-space:normal; word-break:keep-all; overflow-wrap:anywhere;" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</div>
                    <div style="display:grid; grid-template-columns:${gridColumns}; grid-template-rows:1fr; align-items:center; position:relative; padding:5px 0; background:linear-gradient(90deg, rgba(148,163,184,0.08) 1px, transparent 1px); background-size:calc(100% / ${daysInMonth}) 100%;">
                        ${holidayCells}
                        <div title="${escapeHtml(`${task.title} ${task.startDate} ~ ${task.dueDate}`)}" style="grid-column:${task.startDay} / ${task.endDay + 1}; grid-row:1; z-index:1; height:16px; border-radius:999px; background:${style.color}; box-shadow:0 0 0 1px rgba(255,255,255,0.12) inset; min-width:14px;"></div>
                    </div>
                </div>
            `;
        }).join('')
        : `
            <div style="height:86px; display:flex; align-items:center; justify-content:center; color:#94a3b8; font-size:12px; font-weight:800; border-top:1px solid rgba(148,163,184,0.10);">
                선택한 월에 표시할 업무 일정이 없습니다.
            </div>
        `;

    return `
        <div style="border:1px solid rgba(148,163,184,0.16); border-radius:7px; background:rgba(15,23,42,0.72); overflow:hidden;">
            <div style="display:flex; align-items:center; justify-content:space-between; padding:9px 12px; border-bottom:1px solid rgba(148,163,184,0.14);">
                <div style="color:#f8fafc; font-size:12px; font-weight:900;">${escapeHtml(formatMonthLabel(scheduleState.month))} 간트 차트</div>
                <div style="color:#94a3b8; font-size:11px; font-weight:800;">${escapeHtml(chartTasks.length)}건</div>
            </div>
            <div style="overflow-y:auto; overflow-x:hidden; max-height:220px;">
                <div style="width:100%; min-width:0;">
                    <div style="display:grid; grid-template-columns:${taskColumnWidth}px minmax(0,1fr); min-height:34px;">
                        <div style="padding:7px 10px; color:#94a3b8; font-size:11px; font-weight:900;">업무</div>
                        <div style="display:grid; grid-template-columns:${gridColumns}; align-items:stretch; color:#94a3b8; font-size:10px; font-weight:800; text-align:center;">
                            ${dayMeta.map(meta => `
                                <span title="${escapeHtml(meta.isToday ? '오늘' : (meta.holidayName || (meta.isSunday ? '일요일' : (meta.isSaturday ? '토요일' : ''))))}" style="display:flex; flex-direction:column; align-items:center; justify-content:center; gap:0; min-width:0; color:${meta.isToday ? '#facc15' : (meta.holidayName || meta.isSunday ? '#f87171' : (meta.isSaturday ? '#60a5fa' : '#94a3b8'))}; background:${meta.isToday ? 'rgba(250,204,21,0.20)' : (meta.holidayName ? 'rgba(248,113,113,0.18)' : (meta.isSunday ? 'rgba(248,113,113,0.10)' : (meta.isSaturday ? 'rgba(56,189,248,0.09)' : 'transparent')))}; border-left:1px solid rgba(148,163,184,0.08); ${meta.isToday ? 'box-shadow: inset 0 -2px 0 #facc15;' : ''} font-size:9px; line-height:1.05;">
                                    <span>${meta.day}</span>
                                    ${meta.isToday ? '<span style="font-size:8px; font-weight:900;">오늘</span>' : (meta.holidayName ? '<span style="font-size:8px; font-weight:900;">휴</span>' : '')}
                                </span>
                            `).join('')}
                        </div>
                    </div>
                    ${rows}
                </div>
            </div>
        </div>
    `;
}

function renderTaskRows(tasks) {
    if (!tasks.length) {
        return `
            <tr>
                <td colspan="4" style="height:220px; text-align:center; color:#94a3b8; font-weight:800;">
                    선택한 조건에 해당하는 업데이트/건화 업무 일정이 없습니다.
                </td>
            </tr>
        `;
    }

    return tasks.map(task => {
        const style = STATUS_STYLES[task.statusKey] || STATUS_STYLES.planned;
        return `
            <tr style="border-bottom:1px solid rgba(148,163,184,0.12);">
                <td style="min-width:260px; padding:13px 14px; vertical-align:middle;">
                    <div style="color:#f8fafc; font-size:13px; font-weight:900; line-height:1.35;" title="${escapeHtml(task.title)}">${escapeHtml(task.title)}</div>
                </td>
                <td style="width:250px; padding:13px 14px; color:#cbd5e1; font-size:12px; font-weight:800; white-space:nowrap;">
                    ${escapeHtml(task.startDate)} ~ ${escapeHtml(task.dueDate)} (${escapeHtml(task.durationDays)}일)
                </td>
                <td style="width:220px; padding:13px 14px; color:#e5e7eb; font-size:12px; font-weight:800; white-space:nowrap;">${escapeHtml(task.assignee)}</td>
                <td style="width:110px; padding:13px 14px; text-align:center;">
                    <span style="display:inline-flex; align-items:center; justify-content:center; min-width:58px; border-radius:999px; padding:5px 9px; background:${style.bg}; color:${style.color}; font-size:11px; font-weight:900;">${escapeHtml(task.statusLabel)}</span>
                </td>
            </tr>
        `;
    }).join('');
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

    const filtered = getFilteredTasks();
    const availableMonths = getAvailableMonths(scheduleState.tasks);
    const monthOptions = availableMonths.map(month => `<option value="${escapeHtml(month)}">${escapeHtml(formatMonthLabel(month))}</option>`).join('');
    const cacheLabel = scheduleState.cacheTs
        ? `마지막 동기화: ${new Date(scheduleState.cacheTs).toLocaleString('ko-KR')}${scheduleState.refreshing ? ' · 최신화 중' : ''}`
        : (scheduleState.refreshing ? '최신화 중' : '');

    root.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:12px; height:100%; min-height:0; padding:14px;">
            <div style="display:flex; justify-content:space-between; align-items:center; min-height:18px; color:#94a3b8; font-size:11px; font-weight:800;">
                <span>업데이트/건화 Forma 이슈 기반 업무 일정</span>
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
            <div style="flex:1; min-height:0; overflow:auto; border:1px solid rgba(148,163,184,0.16); border-radius:7px; background:rgba(15,23,42,0.78);">
                <table style="width:100%; border-collapse:collapse; table-layout:auto;">
                    <thead style="position:sticky; top:0; z-index:1; background:#111827;">
                        <tr style="border-bottom:1px solid rgba(148,163,184,0.24);">
                            <th style="padding:11px 14px; text-align:left; color:#94a3b8; font-size:11px; font-weight:900;">제목</th>
                            <th style="padding:11px 14px; text-align:left; color:#94a3b8; font-size:11px; font-weight:900;">수행 기간</th>
                            <th style="padding:11px 14px; text-align:left; color:#94a3b8; font-size:11px; font-weight:900;">담당자</th>
                            <th style="padding:11px 14px; text-align:center; color:#94a3b8; font-size:11px; font-weight:900;">상태</th>
                        </tr>
                    </thead>
                    <tbody>${renderTaskRows(filtered)}</tbody>
                </table>
            </div>
        </div>
    `;



    const monthPreset = document.getElementById('example2-schedule-month-preset');
    if (monthPreset) {
        monthPreset.value = availableMonths.includes(scheduleState.month) ? scheduleState.month : (availableMonths[0] || scheduleState.month);
        monthPreset.onchange = () => {
            scheduleState.month = monthPreset.value || '';
            renderSchedule();
        };
    }

    const status = document.getElementById('example2-schedule-status');
    if (status) {
        status.value = scheduleState.status;
        status.onchange = () => {
            scheduleState.status = status.value || 'all';
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
            renderSchedule();
        });
        search.oninput = (e) => {
            scheduleState.query = search.value || '';
            if (search.dataset.isComposing !== 'true' && (!e || !e.isComposing)) {
                renderSchedule();
            }
        };
    }

    const refresh = document.getElementById('example2-schedule-refresh');
    if (refresh) refresh.onclick = () => loadSchedule(true);

    if (activeId === 'example2-schedule-search') {
        const nextSearch = document.getElementById('example2-schedule-search');
        if (nextSearch) {
            nextSearch.focus();
            if (selectionStart != null) nextSearch.setSelectionRange(selectionStart, selectionStart);
        }
    }
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
        scheduleState.error = `업데이트/건화 업무 일정을 불러오지 못했습니다. ${err.message}`;
    } finally {
        scheduleState.loading = false;
        renderSchedule();
    }
}

export function initExample2Schedule() {
    loadSchedule(false);
}

window.initExample2Schedule = initExample2Schedule;
