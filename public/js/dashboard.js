/**
 * dashboard.js — 강북정수장 APS 시공관리자 대시보드
 * LocalStorage 기반 데이터 연동 + Chart.js 차트 렌더링
 */

/* ─────────────────────────────────────────────
   전역 상태
───────────────────────────────────────────── */
const LS_SCHEDULES   = 'project_schedules';
const LS_MANUAL_CREW = 'dashboard_manual_crew';

// 한국 법정 공휴일 데이터 (2026년 기준)
const koreanHolidays = [
    '2026-01-01', // 신정
    '2026-02-16', '2026-02-17', '2026-02-18', // 설날 연휴
    '2026-03-01', // 삼일절
    '2026-05-05', // 어린이날
    '2026-05-24', // 부처님오신날
    '2026-06-06', // 현충일
    '2026-07-17', // 제헌절
    '2026-08-15', // 광복절
    '2026-09-24', '2026-09-25', '2026-09-26', // 추석 연휴
    '2026-10-03', // 개천절
    '2026-10-09', // 한글날
    '2026-12-25'  // 성탄절
];

let donutChart = null;
let barChart   = null;
let dashboardFormaIssues = [];
let dashboardFormaLoading = false;

/* ─────────────────────────────────────────────
   초기화 진입점
───────────────────────────────────────────── */
export function initDashboard() {
    console.log('[Dashboard] initDashboard() 호출');
    renderKpi();
    renderGantt();
    renderDonut();
    renderBar();
    renderIssueList();
    loadDashboardFormaIssues();
    bindScheduleModal();
    bindGanttSlider();
}

/* ─────────────────────────────────────────────
   데이터 헬퍼
───────────────────────────────────────────── */
function getAllIssues() {
    const forma = Array.isArray(window._gangbukFormaCache) && window._gangbukFormaCache.length
        ? window._gangbukFormaCache
        : dashboardFormaIssues;
    let l1 = [], l2 = [], l3 = [];
    try { l1 = JSON.parse(localStorage.getItem('aps_project_issues')      || '[]'); } catch(e) {}
    try { l2 = JSON.parse(localStorage.getItem('my_saved_issues')         || '[]'); } catch(e) {}
    try { l3 = JSON.parse(localStorage.getItem('my_saved_compare_issues') || '[]'); } catch(e) {}
    const raw = (Array.isArray(forma) ? forma : []).concat(l1).concat(l2).concat(l3);
    const seen = {};
    return raw.filter(item => {
        if (!item) return false;
        const id = String(item.id || item.displayId || item.dbId || item.title || '');
        if (!id) return false;
        if (seen[id]) return false;
        seen[id] = true;
        return true;
    });
}

async function loadDashboardFormaIssues(force = false) {
    if (dashboardFormaLoading) return;
    if (!force && Array.isArray(window._gangbukFormaCache) && window._gangbukFormaCache.length) {
        dashboardFormaIssues = window._gangbukFormaCache;
        refreshIssueWidgets();
        return;
    }
    dashboardFormaLoading = true;
    try {
        const resp = await fetch('/api/issues/forma-gangbuk?limit=500', { credentials: 'same-origin' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const json = await resp.json();
        dashboardFormaIssues = Array.isArray(json.data) ? json.data : [];
        window._gangbukFormaCache = dashboardFormaIssues;
        window.currentIssueList = dashboardFormaIssues;
        window.currentFilteredIssues = dashboardFormaIssues.slice();
        refreshIssueWidgets();
    } catch (err) {
        console.warn('[Dashboard] Forma issue sync skipped:', err.message);
    } finally {
        dashboardFormaLoading = false;
    }
}

function refreshIssueWidgets() {
    renderKpi();
    renderDonut();
    renderBar();
    renderIssueList();
}

function getSchedules() {
    try { return JSON.parse(localStorage.getItem(LS_SCHEDULES) || '[]'); } catch(e) { return []; }
}

function saveSchedules(arr) {
    localStorage.setItem(LS_SCHEDULES, JSON.stringify(arr));
}

function getThisWeekRange() {
    const now  = new Date();
    const day  = now.getDay(); // 0=일
    const mon  = new Date(now);
    mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
    mon.setHours(0, 0, 0, 0);
    const sun  = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    sun.setHours(23, 59, 59, 999);
    return { mon, sun };
}

function isThisWeek(dateStr) {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    const { mon, sun } = getThisWeekRange();
    return d >= mon && d <= sun;
}

function isCompare(issue) {
    return String(issue.id || '').startsWith('COMP-') ||
           issue._type === 'compare' || issue.type === 'compare';
}

function getIssueType(issue) {
    const t = (issue.issueType || issue.type || '').toLowerCase();
    if (t.includes('간섭') || t.includes('clash')) return '간섭 이슈';
    if (t.includes('설계') || t.includes('design')) return '설계 이슈';
    return '업무 이슈';
}

function isOverdue(schedule) {
    const end = new Date(schedule.endDate || schedule.dueDate || '');
    return !isNaN(end) && end < new Date() && Number(schedule.progress || 0) < 100;
}

/* ─────────────────────────────────────────────
   KPI 카드
───────────────────────────────────────────── */
function renderKpi() {
    const issues    = getAllIssues();
    const schedules = getSchedules();
    const { mon, sun } = getThisWeekRange();

    /* ① 금주 발생 이슈 */
    const weekIssues   = issues.filter(i => isThisWeek(i.date || i.startDate));
    document.getElementById('kpi-week-issues').textContent = weekIssues.length + '건';

    /* ② 금주 이슈 해결률 */
    const weekClosed   = weekIssues.filter(i => {
        const s = (i.status || '').toLowerCase();
        return s.includes('종료') || s.includes('closed') || s.includes('완료') || s.includes('resolved');
    });
    const rate = weekIssues.length > 0
        ? Math.round((weekClosed.length / weekIssues.length) * 100)
        : 0;
    document.getElementById('kpi-week-resolve').textContent = rate + '%';

    /* ③ 금주 투입 인원 — 수동 수정 지원 */
    const manualCrew = localStorage.getItem(LS_MANUAL_CREW);
    if (manualCrew) {
        document.getElementById('kpi-crew').textContent = manualCrew;
    } else {
        const assigneeSet = new Set();
        schedules.forEach(s => { if (s.assignee) assigneeSet.add(s.assignee); });
        weekIssues.forEach(i => { if (i.assignee) assigneeSet.add(i.assignee); });
        const autoCount = assigneeSet.size;
        document.getElementById('kpi-crew').textContent = autoCount + '명';
    }

    /* ④ 진행중 업무 */
    const today = new Date(); today.setHours(0,0,0,0);
    const inProgress = schedules.filter(s => {
        const progress = Number(s.progress || 0);
        const end      = new Date(s.endDate || s.dueDate || '');
        return progress < 100 && (!s.endDate || end >= today);
    });
    document.getElementById('kpi-inprogress').textContent = inProgress.length + '건';
}

/* ─────────────────────────────────────────────
   간트 차트 렌더링
───────────────────────────────────────────── */
function renderGantt() {
    const schedules = getSchedules();
    const tableBody = document.getElementById('gantt-table-body');
    const timeline  = document.getElementById('gantt-timeline-body');
    const headerRow = document.getElementById('gantt-header-days');

    if (!tableBody || !timeline || !headerRow) return;

    /* 타임라인 범위 계산 */
    const today  = new Date(); today.setHours(0,0,0,0);
    const dayMs  = 86400000;
    const CELL_W = 28; // px per day

    let minDate = new Date(today);
    let maxDate = new Date(today);
    minDate.setDate(today.getDate() - 7);
    maxDate.setDate(today.getDate() + 30);

    schedules.forEach(s => {
        [s.planStart, s.planEnd, s.actualStart, s.actualEnd, s.startDate, s.endDate, s.start, s.end].forEach(dStr => {
            if (dStr) {
                const d = new Date(dStr);
                if (!isNaN(d.getTime())) {
                    if (d < minDate) minDate = new Date(d);
                    if (d > maxDate) maxDate = new Date(d);
                }
            }
        });
    });
    maxDate.setDate(maxDate.getDate() + 3);

    const totalDays = Math.round((maxDate - minDate) / dayMs) + 1;

    /* 날짜 헤더 및 본문 배경 그리드 생성 */
    headerRow.innerHTML = '';
    const gridBg = document.createElement('div');
    gridBg.className = 'gantt-grid-background';
    gridBg.style.minWidth = (totalDays * CELL_W) + 'px';

    for (let i = 0; i < totalDays; i++) {
        const d = new Date(minDate); d.setDate(minDate.getDate() + i);
        const isToday = d.toDateString() === today.toDateString();

        // 날짜 포맷팅 YYYY-MM-DD
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const dateVal = String(d.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${dateVal}`;

        // 요일 및 공휴일 검사
        const dayOfWeek = d.getDay(); // 0: 일요일, 6: 토요일
        const isSat = dayOfWeek === 6;
        const isSun = dayOfWeek === 0;
        const isHol = koreanHolidays.includes(dateStr);

        let highlightClass = '';
        if (isSun || isHol) {
            highlightClass = 'col-holiday';
        } else if (isSat) {
            highlightClass = 'col-saturday';
        }

        // 헤더 날짜 셀
        const cell = document.createElement('div');
        cell.className = 'gantt-day-cell' + (isToday ? ' today' : '') + (highlightClass ? ' ' + highlightClass : '');
        cell.style.minWidth = CELL_W + 'px';
        cell.textContent = (d.getMonth()+1) + '/' + d.getDate();
        headerRow.appendChild(cell);

        // 본문 배경 그리드 열
        const gridCol = document.createElement('div');
        gridCol.className = 'gantt-grid-col' + (highlightClass ? ' ' + highlightClass : '');
        gridCol.style.minWidth = CELL_W + 'px';
        gridBg.appendChild(gridCol);
    }

    /* 오늘 선 */
    const existingLine = document.getElementById('gantt-today-line');
    if (existingLine) existingLine.remove();
    const todayOffset = Math.round((today - minDate) / dayMs);
    const todayLine = document.createElement('div');
    todayLine.id = 'gantt-today-line';
    todayLine.className = 'gantt-today-line';
    todayLine.style.left = (todayOffset * CELL_W + CELL_W / 2) + 'px';
    timeline.appendChild(todayLine);

    /* 데이터 없는 경우 */
    if (schedules.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="6" class="gantt-empty" style="text-align:center; padding:32px; color:#64748b; font-size:0.85rem;">등록된 일정이 없습니다. [+ 일정 추가]를 눌러 추가하세요.</td></tr>`;
        timeline.innerHTML  = '';
        timeline.appendChild(gridBg);
        const todayLine2 = document.createElement('div');
        todayLine2.className = 'gantt-today-line';
        todayLine2.style.left = (todayOffset * CELL_W + CELL_W/2) + 'px';
        timeline.appendChild(todayLine2);
        return;
    }

    /* 행 렌더링 */
    tableBody.innerHTML = '';
    timeline.innerHTML  = '';

    // 배경 그리드 먼저 삽입 (맨 아래 레이어)
    timeline.appendChild(gridBg);

    // 오늘 선 재삽입
    const todayLineNew = document.createElement('div');
    todayLineNew.className = 'gantt-today-line';
    todayLineNew.style.left = (todayOffset * CELL_W + CELL_W/2) + 'px';
    timeline.appendChild(todayLineNew);

    schedules.forEach((s, idx) => {
        const planStartStr   = s.planStart || s.startDate || '';
        const planEndStr     = s.planEnd || s.planDate || s.endDate || '';
        const actualStartStr = (s.actualStart !== undefined && s.actualStart !== null) ? String(s.actualStart).trim() : '';
        const actualEndStr   = (s.actualEnd !== undefined && s.actualEnd !== null) ? String(s.actualEnd).trim() : '';

        const pStartDate = planStartStr ? new Date(planStartStr) : null;
        const pEndDate   = planEndStr   ? new Date(planEndStr)   : null;
        const aStartDate = actualStartStr ? new Date(actualStartStr) : null;
        const aEndDate   = actualEndStr ? new Date(actualEndStr) : null;

        const todayDate = new Date();
        todayDate.setHours(0,0,0,0);

        /* ─────────────────────────────────────────────
           진행률(Progress) 및 실행 기간 렌더링 산출
        ───────────────────────────────────────────── */
        let progress = 0;
        let actualPeriodText = '-';
        let dualTooltip = '';

        if (!aStartDate || isNaN(aStartDate.getTime())) {
            // 0) 착수 전 (actualStart === null / ""): 미착수 상태 -> 실행기간 '-', 진행률 0%
            progress = 0;
            actualPeriodText = '-';
            dualTooltip = `${s.name || ''}\n[계획 일정] ${planStartStr || '-'} ~ ${planEndStr || '-'}\n[실행 일정] - (0%)`;
        } else {
            // 착수된 경우
            if (aEndDate !== null && !isNaN(aEndDate.getTime())) {
                // 실행 종료일(actualEnd)이 입력된 경우 (완료 상태)
                if (pEndDate && !isNaN(pEndDate.getTime()) && aEndDate.getTime() <= pEndDate.getTime()) {
                    // 조기 완료 및 정상 완료 (actualEnd <= planEnd): 무조건 100% 강제
                    progress = 100;
                } else if (pStartDate && pEndDate && !isNaN(pStartDate.getTime()) && !isNaN(pEndDate.getTime())) {
                    // 지연 완료 (actualEnd > planEnd): actualEnd 기준 진행률 > 100%
                    const planDur = Math.max(86400000, pEndDate.getTime() - pStartDate.getTime() + 86400000);
                    const actDur  = Math.max(86400000, aEndDate.getTime() - aStartDate.getTime() + 86400000);
                    if (planDur > 0 && actDur >= 0) {
                        progress = Math.round((actDur / planDur) * 100);
                    }
                } else {
                    progress = 100;
                }
                actualPeriodText = `${actualStartStr} ~ ${actualEndStr}`;
            } else {
                // 진행중 (actualEnd === null / ""): 오늘 날짜 기준 계산
                if (pStartDate && pEndDate && !isNaN(pStartDate.getTime()) && !isNaN(pEndDate.getTime())) {
                    const evalDate = todayDate;
                    const planDur = Math.max(86400000, pEndDate.getTime() - pStartDate.getTime() + 86400000);
                    const currDur = Math.max(86400000, evalDate.getTime() - aStartDate.getTime() + 86400000);
                    if (planDur > 0 && currDur >= 0) {
                        progress = Math.round((currDur / planDur) * 100);
                    }
                } else {
                    progress = Number(s.progress || 0);
                }
                actualPeriodText = `${actualStartStr} ~ 진행 중`;
            }
            dualTooltip = `${s.name || ''}\n[계획 일정] ${planStartStr || '-'} ~ ${planEndStr || '-'}\n[실행 일정] ${actualPeriodText} (${progress}%)`;
        }

        const start = aStartDate || (pStartDate || todayDate);
        const end   = aEndDate || (pEndDate || todayDate);

        const planPeriodText = (planStartStr || planEndStr)
            ? `${planStartStr || '-'} ~ ${planEndStr || '-'}`
            : '-';

        /* 상태 클래스 및 진행률 텍스트 스타일 결정 */
        const isOverProgress = progress > 100;
        let fillClass = isOverProgress ? 'overdue' : (progress >= 100 ? 'done' : (end < todayDate ? 'warn' : ''));
        const progressHtml = isOverProgress
            ? `<span style="color: #EF4444; font-weight: bold;">${progress}%</span>`
            : `${progress}%`;

        /* 테이블 행 (업무명 | 계획 기간 | 실행 기간 | 진행률 | 담당자) */
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td title="${s.name || ''}">${s.name || '-'}</td>
            <td style="font-size:0.78rem; white-space:nowrap; color:#e2e8f0;">${planPeriodText}</td>
            <td style="font-size:0.78rem; white-space:nowrap; color:#00f2fe;">${actualPeriodText}</td>
            <td>
                <div class="gantt-progress-bar">
                    <div class="gantt-progress-fill ${fillClass}" style="width:${Math.min(progress, 100)}%"></div>
                </div>
                ${progressHtml}
            </td>
            <td title="${s.assignee || ''}">${s.assignee || '-'}</td>
        `;
        // 삭제 (우클릭), 수정 (클릭)
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', e => {
            openScheduleModal(s, idx);
        });
        tr.addEventListener('contextmenu', e => {
            e.preventDefault();
            e.stopPropagation();
            if (confirm(`"${s.name}" 일정을 삭제하시겠습니까?`)) {
                const arr = getSchedules().filter((_, i) => i !== idx);
                saveSchedules(arr);
                renderGantt(); renderKpi();
            }
        });
        tableBody.appendChild(tr);

        /* 타임라인 행 — 두꺼운 계획 막대 + 얇은 실행/진행 막대 포개기 렌더링 */
        const rowDiv = document.createElement('div');
        rowDiv.className = 'gantt-row';
        rowDiv.style.minWidth = (totalDays * CELL_W) + 'px';

        // ① 두꺼운 계획 막대 (Thick Plan Bar: height 20px, top 10px)
        if (pStartDate && pEndDate && !isNaN(pStartDate.getTime()) && !isNaN(pEndDate.getTime())) {
            const pStartOff = Math.max(0, Math.round((pStartDate - minDate) / dayMs));
            const pDurDays  = Math.max(1, Math.round((pEndDate - pStartDate) / dayMs) + 1);

            const planBar = document.createElement('div');
            planBar.className = 'gantt-thick-plan-bar';
            planBar.style.left  = (pStartOff * CELL_W) + 'px';
            planBar.style.width = Math.max(8, (pDurDays * CELL_W - 4)) + 'px';
            planBar.title = dualTooltip;
            rowDiv.appendChild(planBar);
        }

        // ② 얇은 실행 막대 (Thin Actual Bar: height 10px, top 15px - 계획 막대 내부 포개짐)
        if (aStartDate && !isNaN(aStartDate.getTime())) {
            const aEnd = aEndDate || (progress >= 100 && pEndDate ? pEndDate : todayDate);
            if (aEnd && !isNaN(aEnd.getTime())) {
                const aStartOff = Math.max(0, Math.round((aStartDate - minDate) / dayMs));
                const aDurDays  = Math.max(1, Math.round((aEnd - aStartDate) / dayMs) + 1);

                let actualClass = 'gantt-thin-actual-bar';
                if (isOverProgress || (pEndDate && aEnd > pEndDate)) actualClass += ' overdue';
                else if (progress >= 100) actualClass += ' done';
                else if (progress < 50) actualClass += ' warn';

                const actualBar = document.createElement('div');
                actualBar.className = actualClass;
                actualBar.style.left  = (aStartOff * CELL_W) + 'px';
                actualBar.style.width = Math.max(8, (aDurDays * CELL_W - 4)) + 'px';
                actualBar.title = dualTooltip;
                rowDiv.appendChild(actualBar);
            }
        }

        timeline.appendChild(rowDiv);
    });

    updateSliderRange();
}

/* ─────────────────────────────────────────────
   도넛 차트 (멀티메트릭 동적 스왑 지원)
───────────────────────────────────────────── */
let activeMainMetric = 'type'; // 'type', 'status', 'structure', 'trade'
let subCharts = [];

function renderDonut() {
    const issues = getAllIssues();
    const total  = issues.length;

    // 1. 기존 차트 인스턴스 정리 (메모리 누수 방지)
    if (donutChart) {
        donutChart.destroy();
        donutChart = null;
    }
    subCharts.forEach(c => { if (c) c.destroy(); });
    subCharts = [];

    // 2. 4가지 차원 데이터 계산
    // A. 유형별 (type)
    let typeData = { clash: 0, design: 0, work: 0 };
    issues.forEach(i => {
        const t = getIssueType(i);
        if (t === '간섭 이슈')      typeData.clash++;
        else if (t === '설계 이슈') typeData.design++;
        else                        typeData.work++;
    });

    // B. 상태별 (status)
    let statusData = {};
    issues.forEach(i => {
        const s = (i.status || '미지정').trim();
        statusData[s] = (statusData[s] || 0) + 1;
    });

    // C. 구조물별 (structure)
    let structData = {};
    issues.forEach(i => {
        const s = (i.location || i.locationName || i.structure || '미지정').trim();
        structData[s] = (structData[s] || 0) + 1;
    });

    // D. 공종별 (trade)
    let tradeData = {};
    issues.forEach(i => {
        const t = (i.trade || '미지정').trim();
        tradeData[t] = (tradeData[t] || 0) + 1;
    });

    // 3. 메트릭별 도넛 구성 정보 헬퍼
    const getMetricConfig = (metric) => {
        let labels = [];
        let data = [];
        let colors = [];
        let name = '';
        let totalCount = total;

        if (metric === 'type') {
            name = '이슈 유형별';
            labels = ['간섭 이슈', '설계 이슈', '업무 이슈'];
            data = [typeData.clash, typeData.design, typeData.work];
            colors = ['#00f2fe', '#8b5cf6', '#f59e0b'];
        } else if (metric === 'status') {
            name = '상태별';
            // 정렬된 상태 목록
            const sorted = Object.entries(statusData).sort((a,b) => b[1] - a[1]);
            labels = sorted.map(x => x[0]);
            data = sorted.map(x => x[1]);
            // 색상 팔레트
            const palette = ['#00f2fe', '#f59e0b', '#8b5cf6', '#10b981', '#64748b'];
            colors = labels.map((_, idx) => palette[idx % palette.length]);
        } else if (metric === 'structure') {
            name = '구조물별';
            // 상위 3개 + 기타
            const sorted = Object.entries(structData).sort((a,b) => b[1] - a[1]);
            const top3 = sorted.slice(0, 3);
            const others = sorted.slice(3);
            labels = top3.map(x => x[0]);
            data = top3.map(x => x[1]);
            if (others.length > 0) {
                labels.push('기타');
                data.push(others.reduce((sum, x) => sum + x[1], 0));
            }
            const palette = ['#00f2fe', '#4facfe', '#8b5cf6', '#10b981', '#64748b'];
            colors = labels.map((_, idx) => palette[idx % palette.length]);
        } else if (metric === 'trade') {
            name = '공종별';
            // 상위 3개 + 기타
            const sorted = Object.entries(tradeData).sort((a,b) => b[1] - a[1]);
            const top3 = sorted.slice(0, 3);
            const others = sorted.slice(3);
            labels = top3.map(x => x[0]);
            data = top3.map(x => x[1]);
            if (others.length > 0) {
                labels.push('기타');
                data.push(others.reduce((sum, x) => sum + x[1], 0));
            }
            const palette = ['#f59e0b', '#00f2fe', '#8b5cf6', '#ef4444', '#64748b'];
            colors = labels.map((_, idx) => palette[idx % palette.length]);
        }

        // 데이터가 전부 0이면 플레이스홀더 구성
        if (totalCount === 0) {
            labels = ['데이터 없음'];
            data = [1];
            colors = ['rgba(100,116,139,0.25)'];
        }

        return { name, labels, data, colors, totalCount };
    };

    // 4. 메인 차트 렌더링
    const mainConfig = getMetricConfig(activeMainMetric);
    document.getElementById('main-chart-title').textContent = mainConfig.name;
    document.getElementById('donut-total').textContent = total + '건';

    const mainCtx = document.getElementById('donut-chart');
    if (mainCtx) {
        donutChart = new Chart(mainCtx, {
            type: 'doughnut',
            data: {
                labels: mainConfig.labels,
                datasets: [{
                    data: mainConfig.data,
                    backgroundColor: mainConfig.colors,
                    borderWidth: 0,
                    hoverOffset: 4
                }]
            },
            options: {
                cutout: '78%',
                responsive: true,
                maintainAspectRatio: false, // 꽉 찬 크기 반영
                layout: {
                    padding: 0 // 캔버스 내부 여백을 제거하여 물리적 원형 센터 고정
                },
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: ctx => ` ${ctx.label}: ${total > 0 ? ctx.raw : 0}건`
                        }
                    }
                },
                animation: { duration: 500, easing: 'easeInOutQuart' }
            }
        });
    }

    // 5. 메인 차트 우측 상세 범례 카드 동적 생성 (3개 이하: 1열 배치 / 3개 초과: 자동 2열 그리드 배치)
    const legendContainer = document.getElementById('donut-main-legends');
    if (legendContainer) {
        legendContainer.innerHTML = '';
        const validLabels = mainConfig.labels.filter(l => l && l !== '데이터 없음');
        
        // 3개 초과 시 2열 모드로 전환, 그 외에는 1열 세로 배치
        if (validLabels.length > 3) {
            legendContainer.classList.add('grid-2col');
        } else {
            legendContainer.classList.remove('grid-2col');
        }

        validLabels.forEach((labelStr, i) => {
            const valCount = total > 0 ? (mainConfig.data[i] ?? 0) : 0;
            const bgCol    = mainConfig.colors[i] || 'rgba(100,116,139,0.1)';

            const card = document.createElement('div');
            card.className = 'donut-legend-card';
            card.style.background = bgCol;
            card.style.color = '#0b0f19';
            card.innerHTML = `
                <div class="legend-card-title">${labelStr}</div>
                <div class="legend-card-value">${valCount}건</div>
            `;
            legendContainer.appendChild(card);
        });
    }

    // 6. 하단 서브 차트 3개 정렬 & 렌더링
    const allMetrics = ['type', 'status', 'structure', 'trade'];
    const subMetrics = allMetrics.filter(m => m !== activeMainMetric);

    const subTitles = { type: '이슈 유형별', status: '상태별', structure: '구조물별', trade: '공종별' };

    subMetrics.forEach((metric, idx) => {
        const sIndex = idx + 1;
        const subItem = document.getElementById(`sub-item-${sIndex}`);
        const subTitleEl = document.getElementById(`sub-title-${sIndex}`);
        const subTotalEl = document.getElementById(`sub-total-${sIndex}`);
        const subCanvas = document.getElementById(`sub-chart-${sIndex}`);

        if (!subItem || !subCanvas) return;

        // 속성 매핑 정보 저장
        subItem.setAttribute('data-metric', metric);
        subTitleEl.textContent = subTitles[metric];
        subTotalEl.textContent = total + '건';

        const config = getMetricConfig(metric);

        // 클릭 이벤트 핸들러 바인딩 (클릭 시 메인 ➔ 메인과 스왑)
        subItem.onclick = (e) => {
            e.stopPropagation();
            activeMainMetric = metric;
            console.log('[Dashboard] 메인 메트릭 변경 ➔', metric);
            renderDonut();
        };

        // 미니 차트 생성
        const subChartInst = new Chart(subCanvas, {
            type: 'doughnut',
            data: {
                labels: config.labels,
                datasets: [{
                    data: config.data,
                    backgroundColor: config.colors,
                    borderWidth: 0,
                    hoverOffset: 2
                }]
            },
            options: {
                cutout: '76%',
                responsive: true,
                maintainAspectRatio: false, // 꽉 찬 크기 반영
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: ctx => ` ${ctx.label}: ${total > 0 ? ctx.raw : 0}건`
                        }
                    }
                },
                animation: { duration: 400, easing: 'easeInOutQuart' }
            }
        });
        subCharts.push(subChartInst);
    });
}

/* ─────────────────────────────────────────────
   막대 차트 (주차별 구조물 Stacked Bar)
───────────────────────────────────────────── */
let activeBarMetric = 'weekly_status';

function normalizeStatus(statusStr) {
    if (!statusStr) return 'Open';
    const s = statusStr.toLowerCase();
    if (s.includes('close') || s.includes('완료') || s.includes('종료') || s.includes('resolved') || s.includes('해결')) {
        return '완료';
    }
    if (s.includes('progress') || s.includes('진행') || s.includes('작업')) {
        return '진행중';
    }
    if (s.includes('pending') || s.includes('보류') || s.includes('대기')) {
        return '보류';
    }
    return 'Open';
}

function renderBar() {
    const issues = getAllIssues();
    const ctx    = document.getElementById('bar-chart');
    if (!ctx) return;
    if (barChart) barChart.destroy();

    // 드롭다운 이벤트 핸들러 바인딩 (최초 1회)
    const selector = document.getElementById('bar-metric-selector');
    if (selector && !selector.dataset.bound) {
        selector.dataset.bound = "true";
        selector.addEventListener('change', function() {
            activeBarMetric = this.value;
            renderBar();
        });
        selector.value = activeBarMetric;
    }

    // 카드 타이틀 변경
    const titleEl = document.getElementById('bar-chart-title');
    if (titleEl) {
        if (activeBarMetric === 'weekly_status') titleEl.textContent = '주차별 이슈 발생 현황';
        else if (activeBarMetric === 'assignee_status') titleEl.textContent = '이슈 담당자별 현황';
        else if (activeBarMetric === 'structure_status') titleEl.textContent = '구조물별 이슈 현황';
        else if (activeBarMetric === 'by_status') titleEl.textContent = '상태별 이슈 현황';
    }

    let labels = [];
    let datasets = [];

    const statusColors = {
        'Open': '#00f2fe',
        '진행중': '#8b5cf6',
        '보류': '#64748b',
        '완료': '#10b981'
    };

    if (activeBarMetric === 'weekly_status') {
        /* 주차별 집계 (단일 바) */
        const weekMap = {};
        issues.forEach(i => {
            const dateStr = i.date || i.startDate || '';
            if (!dateStr) return;
            const d   = new Date(dateStr);
            if (isNaN(d)) return;
            const yr  = d.getFullYear();
            const wk  = getWeekNumber(d);
            const key = `${yr}-W${String(wk).padStart(2,'0')}`;
            weekMap[key] = (weekMap[key] || 0) + 1;
        });

        labels = Object.keys(weekMap).sort().slice(-8); // 최근 8주
        datasets = [{
            label: '이슈 수',
            data: labels.map(wk => weekMap[wk] || 0),
            backgroundColor: '#00f2fecc',
            borderColor: '#00f2fe',
            borderWidth: 1,
            borderRadius: 3
        }];
    } else if (activeBarMetric === 'assignee_status') {
        /* 담당자별 집계 (단일 바) */
        const assigneeMap = {};
        issues.forEach(i => {
            const assignee = i.assignee || '미지정';
            assigneeMap[assignee] = (assigneeMap[assignee] || 0) + 1;
        });

        const sortedAssignees = Object.keys(assigneeMap)
            .sort((a, b) => assigneeMap[b] - assigneeMap[a])
            .slice(0, 8);

        labels = sortedAssignees;
        datasets = [{
            label: '이슈 수',
            data: labels.map(ass => assigneeMap[ass] || 0),
            backgroundColor: '#8b5cf6cc',
            borderColor: '#8b5cf6',
            borderWidth: 1,
            borderRadius: 3
        }];
    } else if (activeBarMetric === 'structure_status') {
        /* 구조물별 집계 (단일 바) */
        const structureMap = {};
        issues.forEach(i => {
            const struct = i.location || i.locationName || i.structure || i.structureName || '미지정';
            structureMap[struct] = (structureMap[struct] || 0) + 1;
        });

        const sortedStructures = Object.keys(structureMap)
            .sort((a, b) => structureMap[b] - structureMap[a])
            .slice(0, 8);

        labels = sortedStructures;
        datasets = [{
            label: '이슈 수',
            data: labels.map(str => structureMap[str] || 0),
            backgroundColor: '#f59e0bcc',
            borderColor: '#f59e0b',
            borderWidth: 1,
            borderRadius: 3
        }];
    } else if (activeBarMetric === 'by_status') {
        /* 상태별 집계 (고유 상태 색상 사용) */
        const statusMap = { 'Open': 0, '진행중': 0, '보류': 0, '완료': 0 };
        issues.forEach(i => {
            const normStatus = normalizeStatus(i.status);
            statusMap[normStatus]++;
        });

        labels = ['Open', '진행중', '보류', '완료'];
        datasets = [{
            label: '이슈 수',
            data: labels.map(cat => statusMap[cat]),
            backgroundColor: labels.map(cat => statusColors[cat] + 'cc'),
            borderColor: labels.map(cat => statusColors[cat]),
            borderWidth: 1,
            borderRadius: 3
        }];
    }

    if (datasets.length === 0 || labels.length === 0) {
        labels = ['데이터 없음'];
        datasets = [{
            label: '이슈 수',
            data: [0],
            backgroundColor: 'rgba(100,116,139,0.3)',
            borderColor: 'rgba(100,116,139,0.5)',
            borderWidth: 1,
            borderRadius: 3
        }];
    }

    barChart = new Chart(ctx, {
        type: 'bar',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: {
                    stacked: false,
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: {
                        color: '#64748b',
                        font: { size: 11 },
                        autoSkip: true,
                        maxTicksLimit: 14
                    }
                },
                y: {
                    stacked: false,
                    beginAtZero: true,
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#64748b', font: { size: 11 }, stepSize: 1 }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(15,21,32,0.95)',
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1,
                    titleColor: '#e2e8f0',
                    bodyColor:  '#94a3b8',
                    padding: 10
                }
            },
            animation: { duration: 600, easing: 'easeInOutQuart' }
        }
    });
}

function getWeekNumber(d) {
    const oneJan = new Date(d.getFullYear(), 0, 1);
    return Math.ceil((((d - oneJan) / 86400000) + oneJan.getDay() + 1) / 7);
}

function renderIssueList() {
    const issues  = getAllIssues();
    const active  = issues.filter(i => {
        const s = (i.status || '').toLowerCase();
        return !(s.includes('종료') || s.includes('closed') || s.includes('완료') || s.includes('resolved'));
    });

    const tbody = document.getElementById('db-issue-table-body');
    if (!tbody) return;

    if (active.length === 0) {
        tbody.innerHTML = `<tr class="no-data"><td colspan="5">진행 중인 이슈가 없습니다.</td></tr>`;
        return;
    }

    tbody.innerHTML = active.slice(0, 100).map(i => {
        const statusCls = (() => {
            const s = (i.status || '').toLowerCase();
            if (s.includes('검토') || s.includes('review')) return 'status-review';
            return 'status-open';
        })();
        const desc = (i.description || i.desc || i.reviewContent || '').substring(0, 30);
        return `<tr>
            <td title="${i.title || ''}">${i.title || '-'}</td>
            <td>${(i.location || i.locationName || i.structure || '-').substring(0, 10)}</td>
            <td>${(i.trade || '-').substring(0, 8)}</td>
            <td>${(i.assignee || '-').substring(0, 8)}</td>
            <td title="${desc}">${desc || '-'}</td>
        </tr>`;
    }).join('');
}

function bindScheduleModal() {
    const addBtn = document.getElementById('btn-add-schedule');
    if (!addBtn) return;
    addBtn.addEventListener('click', e => {
        e.stopPropagation();
        e.stopImmediatePropagation();
        openScheduleModal();
    });
}

function openScheduleModal(prefill = null, editIndex = null) {
    const existing = document.getElementById('schedule-modal-backdrop');
    if (existing) existing.remove();

    const isEdit = editIndex !== null;
    const today = new Date().toISOString().slice(0,10);
    const backdrop = document.createElement('div');
    backdrop.id = 'schedule-modal-backdrop';
    backdrop.className = 'db-modal-backdrop';

    const planStartVal   = prefill?.planStart || prefill?.startDate || today;
    const planEndVal     = prefill?.planEnd || prefill?.planDate || prefill?.endDate || '';
    const actualStartVal = prefill?.actualStart || '';
    const actualEndVal   = prefill?.actualEnd || '';

    backdrop.innerHTML = `
        <div class="db-modal" id="schedule-modal">
            <h3><i class="fas ${isEdit ? 'fa-calendar-alt' : 'fa-calendar-plus'}"></i> ${isEdit ? '일정 수정' : '일정 추가'}</h3>
            <div class="db-form-group">
                <label>업무명 <span style="color:#ef4444">*</span></label>
                <input id="sch-name" type="text" placeholder="업무명을 입력하세요" value="${prefill?.name || ''}">
            </div>
            <div class="db-form-row">
                <div class="db-form-group">
                    <label>계획 시작일</label>
                    <input id="sch-plan-start" type="date" value="${planStartVal}">
                </div>
                <div class="db-form-group">
                    <label>계획 종료일</label>
                    <input id="sch-plan-end" type="date" value="${planEndVal}">
                </div>
            </div>
            <div class="db-form-row">
                <div class="db-form-group">
                    <label>실행 시작일 <span style="color:#94a3b8; font-size:0.75rem;">(선택/미착수 시 빈값)</span></label>
                    <input id="sch-actual-start" type="date" value="${actualStartVal}">
                </div>
                <div class="db-form-group">
                    <label>실행 종료일 <span style="color:#94a3b8; font-size:0.75rem;">(미입력 시 진행 중)</span></label>
                    <input id="sch-actual-end" type="date" value="${actualEndVal}">
                </div>
            </div>
            <div class="db-form-group">
                <label>담당자</label>
                <input id="sch-assignee" type="text" placeholder="담당자를 입력하세요" value="${prefill?.assignee || ''}">
            </div>
            <div class="db-modal-actions">
                ${isEdit ? `<button class="db-btn db-btn-danger" id="sch-delete-btn" type="button" style="margin-right: auto;"><i class="fas fa-trash-alt"></i> 삭제</button>` : ''}
                <button class="db-btn db-btn-ghost" id="sch-cancel-btn" type="button">취소</button>
                <button class="db-btn db-btn-primary" id="sch-save-btn" type="button"><i class="fas fa-floppy-disk"></i> 일정 저장</button>
            </div>
        </div>
    `;

    document.body.appendChild(backdrop);

    // 🚨 모달 내부 클릭은 모두 전파 차단 (main.js 전역 핸들러 방지)
    const modal = document.getElementById('schedule-modal');
    modal.addEventListener('click', e => {
        e.stopPropagation();
        e.stopImmediatePropagation();
    });

    document.getElementById('sch-cancel-btn').addEventListener('click', e => {
        e.stopPropagation();
        e.stopImmediatePropagation();
        backdrop.remove();
    });

    backdrop.addEventListener('click', e => {
        if (e.target === backdrop) backdrop.remove();
    });

    // 🚨 삭제 버튼 이벤트 (수정 모드일 때만 존재)
    if (isEdit) {
        const deleteBtn = document.getElementById('sch-delete-btn');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', e => {
                e.stopPropagation();
                e.stopImmediatePropagation();
                if (confirm(`"${prefill.name}" 일정을 삭제하시겠습니까?`)) {
                    const arr = getSchedules().filter((_, i) => i !== editIndex);
                    saveSchedules(arr);
                    backdrop.remove();
                    renderGantt();
                    renderKpi();
                    renderBar();
                }
            });
        }
    }

    document.getElementById('sch-save-btn').addEventListener('click', e => {
        // 🚨 이벤트 전파를 가장 먼저 차단 — main.js 전역 '저장' 인터셉터 완전 차단
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        const name = document.getElementById('sch-name').value.trim();
        if (!name) { alert('업무명을 입력해주세요.'); return; }

        const planStartVal   = document.getElementById('sch-plan-start').value.trim();
        const planEndVal     = document.getElementById('sch-plan-end').value.trim();
        const actualStartVal = document.getElementById('sch-actual-start').value.trim();
        const actualEndVal   = document.getElementById('sch-actual-end').value.trim();

        let progress = 0;

        const pSVal = planStartVal || null;
        const pEVal = planEndVal || null;
        const aSVal = actualStartVal || null;
        const aEVal = actualEndVal || null;

        const pS = pSVal ? new Date(pSVal) : null;
        const pE = pEVal ? new Date(pEVal) : null;
        const aS = aSVal ? new Date(aSVal) : null;
        const aE = aEVal ? new Date(aEVal) : null;
        const todayDate = new Date(); todayDate.setHours(0,0,0,0);

        if (!aS || isNaN(aS.getTime())) {
            // 착수 전
            progress = 0;
        } else if (aE !== null && !isNaN(aE.getTime())) {
            // 조기 완료 / 정상 완료 (actualEnd <= planEnd): 무조건 100% 강제
            if (pE && !isNaN(pE.getTime()) && aE.getTime() <= pE.getTime()) {
                progress = 100;
            } else if (pS && pE && !isNaN(pS.getTime()) && !isNaN(pE.getTime())) {
                // 지연 완료 (actualEnd > planEnd): actualEnd 기준 진행률 > 100%
                const planDur = Math.max(86400000, pE.getTime() - pS.getTime() + 86400000);
                const actDur  = Math.max(86400000, aE.getTime() - aS.getTime() + 86400000);
                if (planDur > 0 && actDur >= 0) {
                    progress = Math.round((actDur / planDur) * 100);
                }
            } else {
                progress = 100;
            }
        } else {
            // 진행중 (actualEnd === null): 오늘 날짜 기준 계산
            if (pS && pE && !isNaN(pS.getTime()) && !isNaN(pE.getTime())) {
                const planDur = Math.max(86400000, pE.getTime() - pS.getTime() + 86400000);
                const currDur = Math.max(86400000, todayDate.getTime() - aS.getTime() + 86400000);
                if (planDur > 0 && currDur >= 0) {
                    progress = Math.round((currDur / planDur) * 100);
                }
            }
        }

        const newSchedule = {
            _dashboardSchedule: true,          // 대시보드 전용 마커 (이슈와 구분)
            name,
            planStart:   planStartVal || null,
            planEnd:     planEndVal || null,
            actualStart: actualStartVal || null, // 🚨 미입력 시 null 보존 (오늘 날짜/계획날짜 덮어쓰기 금지)
            actualEnd:   actualEndVal || null,   // 🚨 미입력 시 null 보존 (오늘 날짜 덮어쓰기 금지)
            // 하위 호환성 유지
            startDate:   actualStartVal || planStartVal,
            planDate:    planEndVal || planStartVal,
            endDate:     actualEndVal || planEndVal || planStartVal,
            progress:    progress,
            assignee:    document.getElementById('sch-assignee').value.trim(),
            createdAt:   prefill?.createdAt || new Date().toISOString()
        };

        const arr = getSchedules();
        if (isEdit) {
            arr[editIndex] = newSchedule;
            console.log('[Dashboard] 일정 수정 완료 → idx:', editIndex);
        } else {
            arr.push(newSchedule);
            console.log('[Dashboard] 일정 추가 완료');
        }
        saveSchedules(arr);

        backdrop.remove();
        renderGantt();
        renderKpi();
        renderBar();
    });

    // 포커스
    setTimeout(() => document.getElementById('sch-name').focus(), 100);
}

/* ─────────────────────────────────────────────
   프로젝트 구성원 비동기 바인딩 헬퍼
───────────────────────────────────────────── */
function bindAssigneeSelect(selectEl, prefillValue) {
    if (!selectEl) return;

    function populateSelect(membersList) {
        selectEl.innerHTML = '<option value="">담당자를 선택하세요...</option>';
        const seen = {};
        membersList.forEach(m => {
            const name = m.name || m.displayName || m.email || '';
            if (!name || seen[name]) return;
            seen[name] = true;
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = `${name} (${m.role || m.jobTitle || '구성원'})`;
            if (name === prefillValue) opt.selected = true;
            selectEl.appendChild(opt);
        });

        // 만약 prefillValue가 목록에 존재하지 않는다면 수동 옵션 추가
        if (prefillValue && !seen[prefillValue]) {
            const opt = document.createElement('option');
            opt.value = prefillValue;
            opt.textContent = prefillValue;
            opt.selected = true;
            selectEl.appendChild(opt);
        }
    }

    const hubId = window.currentHubId || localStorage.getItem('aps_last_hub_id') || 'dummy-hub';
    const projectId = window.currentProjectId || localStorage.getItem('aps_last_project_id') || 'b.374bde3a-83a3-4dd5-80c2-2e01ddeac719';

    if (window.dashboardProjectMembersCache && window.dashboardProjectMembersCache.projectId === projectId && window.dashboardProjectMembersCache.list.length > 0) {
        populateSelect(window.dashboardProjectMembersCache.list);
    } else {
        const membersUrl = `/api/hubs/${hubId}/projects/${projectId}/members`;
        fetch(membersUrl)
            .then(r => {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(data => {
                const list = data.members || data.users || data.results || [];
                window.dashboardProjectMembersCache = { projectId, list };
                window.projectMembersList = list;
                populateSelect(list);
            })
            .catch(e => {
                console.error('[Dashboard ACC Members Fetch Error]', e);
                selectEl.innerHTML = '<option value="">구성원 로드 실패 (수동 선택)</option>';
                if (prefillValue) {
                    const opt = document.createElement('option');
                    opt.value = prefillValue;
                    opt.textContent = prefillValue;
                    opt.selected = true;
                    selectEl.appendChild(opt);
                }
            });
    }
}

/* ─────────────────────────────────────────────
   간트 차트 스크롤 슬라이더 연동
───────────────────────────────────────────── */
function updateSliderRange() {
    const timelineWrap = document.querySelector('.gantt-timeline-wrap');
    const slider = document.getElementById('gantt-scroll-slider');
    if (!timelineWrap || !slider) return;

    const maxScroll = timelineWrap.scrollWidth - timelineWrap.clientWidth;
    slider.max = maxScroll;
    slider.value = timelineWrap.scrollLeft;

    if (maxScroll <= 0) {
        slider.style.opacity = '0.5';
        slider.disabled = true;
    } else {
        slider.style.opacity = '1';
        slider.disabled = false;
    }
}

function bindGanttSlider() {
    const timelineWrap = document.querySelector('.gantt-timeline-wrap');
    const tableWrap = document.querySelector('.gantt-table-wrap');
    const slider = document.getElementById('gantt-scroll-slider');
    if (!timelineWrap || !slider) return;

    slider.addEventListener('input', function() {
        timelineWrap.scrollLeft = Number(this.value);
    });

    timelineWrap.addEventListener('scroll', function() {
        slider.value = this.scrollLeft;
    });

    // 🚨 세로 스크롤 동기화 추가 (Gantt 테이블과 Gantt 타임라인 연동)
    if (tableWrap) {
        let isSyncingTableScroll = false;
        let isSyncingTimelineScroll = false;

        tableWrap.addEventListener('scroll', function() {
            if (!isSyncingTimelineScroll) {
                isSyncingTableScroll = true;
                timelineWrap.scrollTop = this.scrollTop;
                isSyncingTableScroll = false;
            }
        }, { passive: true });

        timelineWrap.addEventListener('scroll', function() {
            if (!isSyncingTableScroll) {
                isSyncingTimelineScroll = true;
                tableWrap.scrollTop = this.scrollTop;
                isSyncingTimelineScroll = false;
            }
        }, { passive: true });
    }

    window.addEventListener('resize', updateSliderRange);
}

/* ─────────────────────────────────────────────
   KPI 금주 투입인원 수동 수정
───────────────────────────────────────────── */
window.dashboardEditCrew = function() {
    const kpiEl = document.getElementById('kpi-crew');
    const current = kpiEl.textContent.replace(/[^0-9]/g, '') || '0';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'db-kpi-inline-input';
    input.value = kpiEl.textContent;
    input.style.color = 'var(--db-warning)';

    kpiEl.replaceWith(input);
    input.focus(); input.select();

    const commit = () => {
        const val = input.value.trim() || '0';
        localStorage.setItem(LS_MANUAL_CREW, val);
        const span = document.createElement('span');
        span.id = 'kpi-crew';
        span.className = 'db-kpi-value warning';
        span.textContent = val;
        input.replaceWith(span);
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { input.value = kpiEl.textContent; commit(); } });
};

/* ─────────────────────────────────────────────
   외부에서 새로고침 트리거 가능하도록 window에 등록
───────────────────────────────────────────── */
window.refreshDashboard = function() {
    renderKpi();
    renderGantt();
    renderDonut();
    renderBar();
    renderIssueList();
};
