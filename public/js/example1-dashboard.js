const SCHEDULE_URL = '/data/construction-schedule.json?v=20260825-example1';
const MODEL_TREE_URL = '/api/models/tree';
const PROJECT_LABEL = '강북정수장 증설공사 BIM 용역';
const MODEL_CACHE_KEY = 'aps_example1_merged_models_v1';
const VIEWER_PREVIEW_KEY = 'aps_example1_merged_preview_v1';
const VIEWER_HOLD_KEY = 'aps_example1_hold_preview_until_refresh_v1';
const VIEWER_VIEW_STATE_KEY = 'aps_example1_saved_view_state_v1';
const MODEL_CACHE_TTL = 1000 * 60 * 60 * 24 * 7;

let initialized = false;
let mergedViewer = null;
let loadingModels = false;
let currentViewerMode = 'new';
const optionalLoadedModels = new Map();

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function currentMonthKey() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(monthKey) {
    const month = Number(String(monthKey).split('-')[1] || 0);
    return `${month || new Date().getMonth() + 1}월`;
}

function overlapsMonth(item, monthKey) {
    return String(item.startMonth || '') <= monthKey && String(item.endMonth || '') >= monthKey;
}

function readJsonCache(key, maxAge = MODEL_CACHE_TTL) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !parsed.savedAt || Date.now() - parsed.savedAt > maxAge) return null;
        return parsed.value;
    } catch (err) {
        return null;
    }
}

function writeJsonCache(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), value }));
    } catch (err) {}
}

function readTextCache(key) {
    try {
        return localStorage.getItem(key) || '';
    } catch (err) {
        return '';
    }
}

function writeTextCache(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch (err) {}
}

function getHoldPreviewState() {
    try {
        return localStorage.getItem(VIEWER_HOLD_KEY) === 'true';
    } catch (err) {
        return false;
    }
}

function setHoldPreviewState(enabled) {
    try {
        if (enabled) {
            localStorage.setItem(VIEWER_HOLD_KEY, 'true');
        } else {
            localStorage.removeItem(VIEWER_HOLD_KEY);
        }
    } catch (err) {}
}

function updateDDay() {
    const target = new Date('2029-05-16T00:00:00');
    const diffDays = Math.max(0, Math.ceil((target - new Date()) / 86400000));
    const el = document.getElementById('example1-dday-val');
    if (el) el.textContent = `D-${diffDays} 일`;
}

async function updateWeather() {
    const lat = 37.5755;
    const lon = 127.1652;
    const apply = info => {
        const pairs = [
            ['example1-weather-temp', info.temp],
            ['example1-weather-desc', info.desc],
            ['example1-weather-humidity', `${info.humidity}%`],
            ['example1-weather-wind', `${info.windSpeed}m/s`],
            ['example1-weather-feels', `${info.feelsLike}°C`]
        ];
        pairs.forEach(([id, value]) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        });
        const icon = document.getElementById('example1-weather-icon');
        if (icon && info.icon) icon.src = info.icon;
    };

    try {
        const resp = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        const cw = data.current_weather || {};
        const temp = Math.round(Number(cw.temperature || 24.5) * 10) / 10;
        apply({
            temp,
            feelsLike: Math.round((temp + 0.8) * 10) / 10,
            humidity: 62,
            windSpeed: Math.round(Number(cw.windspeed || 2.1) * 10) / 10,
            desc: Number(cw.cloudcover || 0) > 60 ? '흐림' : '온흐림',
            icon: 'https://openweathermap.org/img/wn/02d@2x.png'
        });
    } catch (err) {
        console.warn('[Example1] weather update failed:', err.message);
    }
}

function renderShell() {
    const root = document.getElementById('example1-tab');
    if (!root) return;

    root.style.display = 'block';
    root.style.width = '100%';
    root.style.height = 'calc(100vh - 70px)';
    root.style.minHeight = '0';
    root.style.padding = '8px 10px 10px';
    root.style.overflow = 'hidden';
    root.style.boxSizing = 'border-box';
    root.style.background = 'var(--ex1-page-bg)';
    root.style.color = 'var(--ex1-text)';

    root.innerHTML = `
        <div style="width:100%; height:100%; min-height:0; display:grid; grid-template-columns:minmax(430px,0.52fr) minmax(620px,1fr); grid-template-rows:190px minmax(0,1fr); gap:10px;">
            <section class="bim-db-panel" style="grid-column:1; grid-row:1; min-width:0; min-height:0; display:flex; flex-direction:column; gap:10px; padding:14px 16px; border:1px solid var(--ex1-border); border-radius:8px; background:var(--ex1-panel-bg); overflow:hidden;">
                <div style="display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid var(--ex1-soft-border); padding-bottom:9px;">
                    <h3 style="margin:0; color:var(--ex1-text); font-size:1.02rem; font-weight:950;"><i class="fas fa-stopwatch" style="color:var(--ex1-accent);"></i> 실시간 공정 D-Day</h3>
                    <span style="font-size:0.72rem; color:#34d399; background:rgba(16,185,129,0.18); border:1px solid rgba(52,211,153,0.34); padding:3px 10px; border-radius:999px; font-weight:900;">정상 순항 중</span>
                </div>
                <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
                    <div style="padding:12px; border:1px solid var(--ex1-border); border-radius:7px; background:var(--ex1-card-bg); text-align:center;">
                        <div style="color:var(--ex1-muted); font-size:0.72rem; font-weight:800;">공사 기간 (2026.04.01 ~ 2029.05.16)</div>
                        <div id="example1-dday-val" style="margin-top:7px; color:var(--ex1-accent); font-size:1.45rem; line-height:1; font-weight:950;">D-000 일</div>
                    </div>
                    <div style="padding:12px; border:1px solid var(--ex1-border); border-radius:7px; background:var(--ex1-card-bg); text-align:center;">
                        <div style="color:var(--ex1-muted); font-size:0.72rem; font-weight:800;">종합 공정률</div>
                        <div style="margin-top:7px; color:var(--ex1-text); font-size:1.45rem; line-height:1; font-weight:950;">42.8% <span style="color:#10b981; font-size:0.72rem;">+1.3%</span></div>
                    </div>
                </div>
                <div style="margin-top:auto; background:var(--ex1-card-strong-bg); border-left:3px solid var(--ex1-accent); padding:8px 12px; color:var(--ex1-soft-text); font-size:0.78rem; font-weight:800;">
                    <i class="fas fa-hammer" style="color:#f59e0b;"></i> 현재 공종: 응집침전지 철근배근 및 슬래브 타설 단계
                </div>
            </section>

            <section style="grid-column:2; grid-row:1; min-width:0; min-height:0; display:grid; grid-template-columns:minmax(340px,0.46fr) minmax(380px,0.54fr); gap:10px;">
                <div class="bim-db-panel" style="min-width:0; min-height:0; display:flex; flex-direction:column; gap:8px; padding:12px 16px; border:1px solid var(--ex1-border); border-radius:8px; background:var(--ex1-panel-bg); overflow:hidden;">
                    <div style="display:flex; align-items:center; justify-content:space-between; border-bottom:1px solid var(--ex1-soft-border); padding-bottom:8px;">
                        <h3 style="margin:0; color:var(--ex1-text); font-size:1.02rem; font-weight:950;"><i class="fas fa-cloud-sun" style="color:var(--ex1-accent);"></i> 현장 상황</h3>
                        <span style="color:var(--ex1-subtle); font-size:0.7rem; font-weight:800;">Open-Meteo</span>
                    </div>
                    <div style="display:flex; align-items:center; justify-content:space-between;">
                        <div style="min-width:0;">
                            <div style="color:var(--ex1-accent); font-size:0.78rem; font-weight:900; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"><i class="fas fa-location-dot"></i> 남양주시 강북정수장 현장</div>
                            <div style="margin-top:6px;"><span id="example1-weather-temp" style="color:var(--ex1-text); font-size:2.05rem; line-height:1; font-weight:950;">--</span><span style="color:var(--ex1-soft-text); font-weight:900;"> °C</span></div>
                        </div>
                        <div style="text-align:right; flex:0 0 auto;">
                            <div id="example1-weather-desc" style="color:var(--ex1-soft-text); font-size:0.84rem; font-weight:900;">불러오는 중</div>
                            <img id="example1-weather-icon" src="https://openweathermap.org/img/wn/02d@2x.png" alt="날씨 아이콘" style="width:46px; height:46px; filter:drop-shadow(0 0 6px var(--ex1-accent-border));">
                        </div>
                    </div>
                    <div style="margin-top:auto; display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:6px; padding:7px 10px; border:1px solid var(--ex1-border); border-radius:7px; background:var(--ex1-card-bg); color:var(--ex1-soft-text); font-size:0.68rem; line-height:1.1; font-weight:800;">
                        <span title="습도" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"><i class="fas fa-droplet" style="color:var(--ex1-accent);"></i> 습도 <strong id="example1-weather-humidity" style="color:var(--ex1-text);">--</strong></span>
                        <span title="풍속" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"><i class="fas fa-wind" style="color:var(--ex1-accent);"></i> 풍속 <strong id="example1-weather-wind" style="color:var(--ex1-text);">--</strong></span>
                        <span title="체감온도" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"><i class="fas fa-temperature-half" style="color:#f59e0b;"></i> 체감 <strong id="example1-weather-feels" style="color:var(--ex1-text);">--</strong></span>
                        <span title="대기 상태" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"><i class="fas fa-leaf" style="color:#10b981;"></i> 대기 <strong style="color:#10b981;">좋음</strong></span>
                    </div>
                </div>

                <div class="bim-db-panel" style="min-width:0; min-height:0; padding:0; border:1px solid var(--ex1-border); border-radius:8px; background:var(--ex1-panel-bg); overflow:hidden;">
                    <div style="height:46px; display:flex; align-items:center; gap:10px; padding:0 14px; border-bottom:1px solid var(--ex1-soft-border); background:var(--ex1-header-bg);">
                        <i class="fas fa-calendar-days" style="color:var(--ex1-accent); font-size:1.2rem;"></i>
                        <h2 id="example1-month-title" style="margin:0; color:var(--ex1-text); font-size:1.02rem; line-height:1; font-weight:950;">00월 예정 공사</h2>
                        <span id="example1-schedule-source" style="margin-left:auto; color:var(--ex1-subtle); font-size:0.7rem; font-weight:800;">공정표 기준</span>
                    </div>
                    <div id="example1-month-kpis" style="height:calc(100% - 46px); display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px; padding:10px; box-sizing:border-box;">
                        ${renderKpiSkeleton()}
                    </div>
                </div>
            </section>

            <section class="bim-db-panel" style="grid-column:1; grid-row:2; min-height:0; display:flex; flex-direction:column; padding:14px 16px; border:1px solid var(--ex1-border); border-radius:8px; background:var(--ex1-panel-bg); overflow:hidden;">
                <div style="display:flex; align-items:center; gap:8px; border-bottom:1px solid var(--ex1-soft-border); padding-bottom:10px;">
                    <h3 style="margin:0; color:var(--ex1-text); font-size:1.05rem; font-weight:950;"><i class="fas fa-circle-info" style="color:var(--ex1-accent);"></i> 공사 개요</h3>
                </div>
                <div style="margin-top:12px; border:1px solid var(--ex1-table-border); border-radius:7px; overflow:hidden; background:var(--ex1-card-bg);">
                    <img src="/images/example1-overview.png" alt="공사 개요 조감도" style="width:100%; height:255px; object-fit:cover; display:block;">
                </div>
                <div style="min-height:0; overflow:auto; margin-top:12px;">
                    <table style="width:100%; border-collapse:collapse; font-size:0.78rem; color:var(--ex1-soft-text); border:1px solid var(--ex1-table-border);">
                        <tbody>
                            ${renderOverviewRow('사업위치', '경기도 남양주시 고산로 171 강북아리수정수센터 内')}
                            ${renderOverviewRow('사업목적', '노후 정수장 순차 재정비에 따른 강북정수장 증설(Q=25만m³/일)로 용수 공급량 확보')}
                            ${renderOverviewRow('과업규모', '시설용량증설 Q = 25만m³/일 | 부지면적 A = 약 50,000m² · 정수처리시설 1식')}
                            ${renderOverviewRow('추정공사비', '257,800 백만원')}
                            ${renderOverviewRow('시행기관', '서울특별시 아리수본부')}
                        </tbody>
                    </table>
                </div>
            </section>

            <section class="bim-db-panel" style="grid-column:2; grid-row:2; min-height:0; padding:0; border:1px solid var(--ex1-border); border-radius:8px; background:var(--ex1-panel-bg); overflow:hidden; display:flex; flex-direction:column;">
                <div style="height:50px; flex:0 0 50px; display:flex; align-items:center; gap:12px; padding:0 14px; border-bottom:1px solid var(--ex1-soft-border); background:var(--ex1-header-bg);">
                    <h3 style="margin:0; color:var(--ex1-text); font-size:1.02rem; font-weight:950; flex:0 0 auto;">강북정수장 3D</h3>
                    <div id="example1-model-mode-controls" style="display:flex; align-items:center; gap:6px; min-width:0;">
                        <button type="button" id="example1-viewer-fit" style="height:28px; padding:0 10px; border-radius:6px; border:1px solid rgba(34,197,94,0.38); background:rgba(34,197,94,0.12); color:#86efac; font-size:0.72rem; font-weight:900; cursor:pointer;">화면 맞춤</button>
                        <button type="button" id="example1-view-save" title="현재 뷰 시점 저장" aria-label="현재 뷰 시점 저장" style="width:30px; height:28px; padding:0; border-radius:6px; border:1px solid rgba(45,212,191,0.38); background:rgba(20,184,166,0.12); color:#99f6e4; font-size:0.78rem; font-weight:900; cursor:pointer;"><i class="fas fa-bookmark"></i></button>
                        <button type="button" id="example1-model-visibility-toggle" title="모델 가시성 조절" aria-label="모델 가시성 조절" style="width:30px; height:28px; padding:0; border-radius:6px; border:1px solid rgba(96,165,250,0.38); background:rgba(37,99,235,0.14); color:#bfdbfe; font-size:0.78rem; font-weight:900; cursor:pointer;"><i class="fas fa-layer-group"></i></button>
                    </div>
                    <span id="example1-merged-viewer-status" style="margin-left:auto; color:var(--ex1-subtle); font-size:0.76rem; font-weight:800; white-space:nowrap;">대표 통합 뷰 준비 중</span>
                </div>
                <div id="example1-merged-viewer" style="flex:1; min-height:0; position:relative; background:var(--ex1-viewer-bg);">
                    <div style="height:100%; display:flex; align-items:center; justify-content:center; color:var(--ex1-subtle); font-weight:900;">전체 모델 병합 뷰를 불러오는 중입니다.</div>
                </div>
            </section>
        </div>
    `;
}

function renderOverviewRow(label, value) {
    return `
        <tr style="border-bottom:1px solid var(--ex1-table-border);">
            <td style="width:118px; padding:10px 12px; text-align:center; font-weight:900; background:var(--ex1-table-label-bg); border-right:1px solid var(--ex1-table-border); color:var(--ex1-text);">${escapeHtml(label)}</td>
            <td style="padding:10px 12px; line-height:1.48; color:var(--ex1-soft-text);">${escapeHtml(value)}</td>
        </tr>
    `;
}

function renderKpiSkeleton() {
    return [0, 1, 2, 3].map(() => `
        <div style="border:1px solid var(--ex1-border); border-radius:8px; background:var(--ex1-card-bg); display:flex; align-items:center; justify-content:center; color:var(--ex1-muted); font-weight:900;">불러오는 중</div>
    `).join('');
}

function renderScheduleKpis(items, monthKey) {
    const target = document.getElementById('example1-month-kpis');
    const title = document.getElementById('example1-month-title');
    const source = document.getElementById('example1-schedule-source');
    if (title) title.textContent = `${monthLabel(monthKey)} 예정 공사`;
    if (source) source.textContent = `${PROJECT_LABEL} · 공정표 기준`;
    if (!target) return;

    const structures = new Set(items.map(item => item.name).filter(Boolean));
    const categories = new Set(items.map(item => item.category).filter(Boolean));
    const zones = new Set(items.map(item => item.zone).filter(Boolean));
    const longRunning = items.filter(item => String(item.startMonth) < monthKey && String(item.endMonth) > monthKey).length;
    const cards = [
        { icon: 'fa-building', label: '대상 구조물', value: structures.size, unit: '개소', sub: [...zones].join(' · ') || '월간 대상' },
        { icon: 'fa-calendar-check', label: `${monthLabel(monthKey)} 예정 공정`, value: items.length, unit: '건', sub: '공정표 월간 겹침 기준' },
        { icon: 'fa-screwdriver-wrench', label: '주요 공종', value: categories.size, unit: '종', sub: [...categories].map(v => v.replace(/^[0-9.]+/, '')).join(' · ') },
        { icon: 'fa-arrows-rotate', label: '계속 진행 공정', value: longRunning, unit: '건', sub: '전월부터 이어지는 작업' }
    ];

    target.innerHTML = cards.map(card => `
        <div style="min-width:0; display:flex; flex-direction:column; justify-content:space-between; gap:7px; padding:10px; border:1px solid var(--ex1-border); border-radius:8px; background:var(--ex1-kpi-bg); box-shadow:0 0 16px rgba(14,165,233,0.08) inset;">
            <div style="width:34px; height:34px; border-radius:999px; display:flex; align-items:center; justify-content:center; color:var(--ex1-accent); border:1px solid var(--ex1-accent-border); background:var(--ex1-kpi-icon-bg); font-size:0.94rem;">
                <i class="fas ${card.icon}"></i>
            </div>
            <div style="min-width:0;">
                <div style="color:var(--ex1-text); font-size:0.74rem; font-weight:900; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(card.label)}">${escapeHtml(card.label)}</div>
                <div style="margin-top:4px; color:var(--ex1-accent); font-size:1.58rem; line-height:1; font-weight:950;">${card.value}<span style="margin-left:3px; color:var(--ex1-text); font-size:0.78rem;">${escapeHtml(card.unit)}</span></div>
                <div style="margin-top:5px; color:var(--ex1-subtle); font-size:0.68rem; font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(card.sub)}">${escapeHtml(card.sub)}</div>
            </div>
        </div>
    `).join('');
}

async function loadMonthlyScheduleKpis() {
    const monthKey = currentMonthKey();
    try {
        const resp = await fetch(SCHEDULE_URL, { cache: 'no-store' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        const items = (data.items || []).filter(item => overlapsMonth(item, monthKey));
        renderScheduleKpis(items, monthKey);
    } catch (err) {
        console.warn('[Example1] schedule KPI load failed:', err.message);
        const target = document.getElementById('example1-month-kpis');
        if (target) target.innerHTML = `<div style="grid-column:1 / -1; display:flex; align-items:center; justify-content:center; color:#fca5a5; font-weight:900;">월간 공정표를 불러오지 못했습니다.</div>`;
    }
}

function collectModels(node, result = []) {
    if (!node) return result;
    if (Array.isArray(node.files)) {
        node.files.forEach(file => {
            if (file && (file.urn || file.versionId || file.id)) result.push(file);
        });
    }
    ['children', 'folders', 'items', 'contents'].forEach(key => {
        if (Array.isArray(node[key])) node[key].forEach(child => collectModels(child, result));
    });
    return result;
}

function dedupeModels(models) {
    const seen = new Set();
    return models.filter(model => {
        const key = model.urn || model.versionId || model.id || model.name;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function getModelName(model) {
    return String(model?.name || model?.displayName || model?.fileName || '');
}

function getModelKey(model) {
    return String(model?.urn || model?.versionId || model?.id || getModelName(model));
}

function getViewerModeLabel(mode) {
    if (mode === 'all') return '전체 병합';
    if (mode === 'temporary') return '가시설';
    return '대표 통합';
}

function filterModelsByMode(models, mode) {
    const list = Array.isArray(models) ? models : [];
    if (mode === 'all') return list;
    if (mode === 'temporary') {
        return list.filter(model => getModelName(model).includes('가시설'));
    }
    return list.filter(isRepresentativeModel).sort((a, b) => {
        const aIsSite = getModelName(a).includes('대지');
        const bIsSite = getModelName(b).includes('대지');
        if (aIsSite === bIsSite) return getModelName(a).localeCompare(getModelName(b), 'ko');
        return aIsSite ? 1 : -1;
    });
}

function isRepresentativeModel(model) {
    const name = getModelName(model);
    return name.includes('신설') && (name.includes('대지') || name.includes('_C'));
}

function getOptionalModels(models) {
    return (Array.isArray(models) ? models : [])
        .filter(model => !isRepresentativeModel(model))
        .sort((a, b) => getModelName(a).localeCompare(getModelName(b), 'ko'));
}

function setActiveViewerMode(mode) {
    document.querySelectorAll('[data-example1-model-mode]').forEach(button => {
        const active = button.dataset.example1ModelMode === mode;
        button.style.borderColor = active ? 'rgba(56,189,248,0.52)' : 'rgba(148,163,184,0.24)';
        button.style.background = active ? 'var(--ex1-accent-soft)' : 'var(--ex1-card-strong-bg)';
        button.style.color = active ? 'var(--ex1-accent)' : 'var(--ex1-soft-text)';
    });
    const allButton = document.querySelector('[data-example1-model-mode="all"]');
    if (allButton && mode !== 'all') {
        allButton.style.borderColor = 'rgba(245,158,11,0.42)';
        allButton.style.background = 'rgba(245,158,11,0.12)';
        allButton.style.color = '#fbbf24';
    }
}

function bindViewerModeControls() {
    const controls = document.getElementById('example1-model-mode-controls');
    if (!controls || controls.dataset.bound === 'true') return;
    controls.dataset.bound = 'true';
    controls.addEventListener('click', event => {
        const button = event.target.closest('[data-example1-model-mode]');
        if (!button || loadingModels) return;
        const mode = button.dataset.example1ModelMode || 'new';
        loadMergedViewer(mode, { force: mode !== currentViewerMode });
    });
    const fitButton = document.getElementById('example1-viewer-fit');
    if (fitButton) {
        fitButton.addEventListener('click', event => {
            event.preventDefault();
            fitExample1Viewer();
        });
    }
    const saveViewButton = document.getElementById('example1-view-save');
    if (saveViewButton) {
        saveViewButton.addEventListener('click', event => {
            event.preventDefault();
            saveExample1ViewState();
        });
    }
    const visibilityButton = document.getElementById('example1-model-visibility-toggle');
    if (visibilityButton) {
        visibilityButton.addEventListener('click', event => {
            event.preventDefault();
            toggleModelVisibilityPanel();
        });
    }
}

async function loadCachedOrFreshModels(status) {
    const cached = readJsonCache(MODEL_CACHE_KEY);
    if (Array.isArray(cached) && cached.length) {
        if (status) status.textContent = `저장된 모델 목록 ${cached.length}개 복원 중`;
        refreshModelCacheInBackground();
        return cached;
    }

    if (status) status.textContent = '모델 목록 불러오는 중';
    const treeResp = await fetch(MODEL_TREE_URL, { credentials: 'same-origin' });
    if (!treeResp.ok) throw new Error(`모델 트리 HTTP ${treeResp.status}`);
    const tree = await treeResp.json();
    const models = dedupeModels(collectModels(tree));
    writeJsonCache(MODEL_CACHE_KEY, models);
    return models;
}

async function refreshModelCacheInBackground() {
    try {
        const treeResp = await fetch(MODEL_TREE_URL, { credentials: 'same-origin' });
        if (!treeResp.ok) return;
        const tree = await treeResp.json();
        const models = dedupeModels(collectModels(tree));
        if (models.length) writeJsonCache(MODEL_CACHE_KEY, models);
    } catch (err) {
        console.warn('[Example1] model cache refresh skipped:', err.message);
    }
}

function closeModelVisibilityPanel() {
    const panel = document.getElementById('example1-model-visibility-panel');
    if (panel) panel.remove();
}

async function toggleModelVisibilityPanel() {
    const existing = document.getElementById('example1-model-visibility-panel');
    if (existing) {
        existing.remove();
        return;
    }
    const container = document.getElementById('example1-merged-viewer');
    const status = document.getElementById('example1-merged-viewer-status');
    if (!container) return;
    const models = await loadCachedOrFreshModels(status);
    renderModelVisibilityPanel(container, models);
}

function renderModelVisibilityPanel(container, models) {
    closeModelVisibilityPanel();
    const list = Array.isArray(models) ? models : [];
    const representativeCount = list.filter(isRepresentativeModel).length;
    const panel = document.createElement('div');
    panel.id = 'example1-model-visibility-panel';
    panel.style.cssText = 'position:absolute; top:12px; right:12px; z-index:10000; width:min(360px,calc(100% - 24px)); max-height:calc(100% - 24px); display:flex; flex-direction:column; border:1px solid var(--ex1-border); border-radius:8px; background:var(--ex1-panel-bg); color:var(--ex1-text); box-shadow:0 18px 42px rgba(0,0,0,0.18); backdrop-filter:blur(10px); overflow:hidden;';
    panel.innerHTML = `
        <div style="height:38px; flex:0 0 auto; display:flex; align-items:center; gap:8px; padding:0 11px; border-bottom:1px solid rgba(148,163,184,0.18);">
            <i class="fas fa-layer-group" style="color:#38dfff;"></i>
            <strong style="font-size:0.82rem;">모델 가시성</strong>
            <span style="margin-left:auto; color:var(--ex1-muted); font-size:0.7rem; font-weight:800;">${list.length}개</span>
            <button type="button" id="example1-model-visibility-close" aria-label="닫기" style="width:26px; height:26px; border-radius:6px; border:1px solid var(--ex1-soft-border); background:var(--ex1-card-bg); color:var(--ex1-text); cursor:pointer;"><i class="fas fa-xmark"></i></button>
        </div>
        <div style="padding:8px 10px; color:var(--ex1-muted); font-size:0.68rem; font-weight:800; border-bottom:1px solid var(--ex1-soft-border);">
            대표 통합 ${representativeCount}개는 이미 표시 중이며, 나머지는 폴더별로 선택해 추가합니다.
        </div>
        <div id="example1-model-visibility-list" style="overflow:auto; min-height:0; padding:6px;">
            ${renderModelFolderGroups(list)}
        </div>
    `;
    container.appendChild(panel);
    const close = panel.querySelector('#example1-model-visibility-close');
    if (close) close.addEventListener('click', closeModelVisibilityPanel);
    panel.querySelectorAll('[data-example1-optional-model]').forEach(input => {
        if (input.disabled) return;
        input.addEventListener('change', () => toggleOptionalModel(input));
    });
    panel.querySelectorAll('[data-example1-folder-toggle]').forEach(button => {
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            toggleModelFolderVisibility(button);
        });
    });
}

function renderModelFolderGroups(models) {
    const groups = new Map();
    models.forEach(model => {
        const rawPath = model.folderPath || model.path || '기타';
        const compactPath = String(rawPath).replace(/^Project Files\s*\/\s*02 BIM Data\s*\/\s*01 Revit\s*\/?\s*/, '') || '01 Revit';
        if (!groups.has(compactPath)) groups.set(compactPath, []);
        groups.get(compactPath).push(model);
    });

    return [...groups.entries()].map(([folderPath, items]) => {
        const shown = items.filter(model => isRepresentativeModel(model) || optionalLoadedModels.has(getModelKey(model))).length;
        const optionalItems = items.filter(model => !isRepresentativeModel(model));
        const optionalShown = optionalItems.filter(model => optionalLoadedModels.has(getModelKey(model))).length;
        const allOptionalShown = optionalItems.length > 0 && optionalShown === optionalItems.length;
        return `
            <details open style="border:1px solid var(--ex1-soft-border); border-radius:7px; margin-bottom:6px; overflow:hidden; background:var(--ex1-card-bg);">
                <summary style="height:32px; display:flex; align-items:center; gap:7px; padding:0 8px; cursor:pointer; color:var(--ex1-text); font-size:0.72rem; font-weight:900; list-style:none;">
                    <i class="fas fa-folder" style="color:var(--ex1-accent);"></i>
                    <span style="min-width:0; flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(folderPath)}">${escapeHtml(folderPath)}</span>
                    <span style="color:var(--ex1-muted); font-size:0.66rem;">${shown}/${items.length}</span>
                    <button type="button" data-example1-folder-toggle="${escapeHtml(folderPath)}" data-folder-target="${allOptionalShown ? 'off' : 'on'}" title="${allOptionalShown ? '폴더 모델 끄기' : '폴더 모델 켜기'}" aria-label="${allOptionalShown ? '폴더 모델 끄기' : '폴더 모델 켜기'}" style="width:24px; height:24px; display:inline-flex; align-items:center; justify-content:center; border-radius:6px; border:1px solid var(--ex1-accent-border); background:${allOptionalShown ? 'var(--ex1-accent-soft)' : 'var(--ex1-card-strong-bg)'}; color:${allOptionalShown ? 'var(--ex1-accent)' : 'var(--ex1-text)'}; cursor:pointer;">
                        <i class="fas ${allOptionalShown ? 'fa-eye' : 'fa-eye-slash'}" style="font-size:0.68rem;"></i>
                    </button>
                </summary>
                <div style="padding:3px 4px 5px 12px; border-top:1px solid var(--ex1-soft-border);">
                    ${items.map(model => renderOptionalModelRow(model)).join('')}
                </div>
            </details>
        `;
    }).join('') || '<div style="padding:14px; color:var(--ex1-muted); font-size:0.76rem; font-weight:800; text-align:center;">표시할 모델이 없습니다.</div>';
}

function renderOptionalModelRow(model) {
    const key = getModelKey(model);
    const name = getModelName(model) || '이름 없는 모델';
    const representative = isRepresentativeModel(model);
    const checked = representative || optionalLoadedModels.has(key) ? 'checked' : '';
    const disabled = representative ? 'disabled' : '';
    const badge = representative ? '<span style="color:var(--ex1-accent); font-size:0.64rem; font-weight:900;">대표</span>' : '';
    return `
        <label style="height:30px; display:flex; align-items:center; gap:8px; padding:0 8px; border-radius:6px; cursor:${representative ? 'default' : 'pointer'}; color:${representative ? 'var(--ex1-muted)' : 'var(--ex1-text)'}; font-size:0.7rem; font-weight:800; opacity:${representative ? '0.82' : '1'};">
            <input type="checkbox" data-example1-optional-model="${escapeHtml(key)}" ${checked} ${disabled} style="width:14px; height:14px; accent-color:var(--ex1-accent);">
            <span style="min-width:0; flex:1; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
            ${badge}
        </label>
    `;
}

async function toggleModelFolderVisibility(button) {
    const details = button.closest('details');
    if (!details || loadingModels) return;
    const targetOn = button.dataset.folderTarget !== 'off';
    const inputs = [...details.querySelectorAll('[data-example1-optional-model]')].filter(input => !input.disabled);
    button.disabled = true;
    try {
        for (const input of inputs) {
            if (input.checked === targetOn) continue;
            input.checked = targetOn;
            await toggleOptionalModel(input, { silent: true });
        }
        const panel = document.getElementById('example1-model-visibility-panel');
        if (panel) {
            const models = await loadCachedOrFreshModels(document.getElementById('example1-merged-viewer-status'));
            const container = document.getElementById('example1-merged-viewer');
            if (container) renderModelVisibilityPanel(container, models);
        }
        const status = document.getElementById('example1-merged-viewer-status');
        if (status) status.textContent = `추가 모델 ${optionalLoadedModels.size}개 표시 중`;
    } finally {
        button.disabled = false;
    }
}

function getViewerGlobalOffset(viewer) {
    try {
        const models = typeof viewer.getAllModels === 'function' ? viewer.getAllModels() : [];
        for (const model of models) {
            const offset = model?.getData?.()?.globalOffset;
            if (offset) return offset;
        }
    } catch (err) {}
    return null;
}

async function ensureInteractiveViewer() {
    if (mergedViewer) return true;
    setHoldPreviewState(false);
    await loadMergedViewer(currentViewerMode || 'new', { force: true });
    return !!mergedViewer;
}

async function toggleOptionalModel(input, options = {}) {
    const key = input.dataset.example1OptionalModel;
    const status = document.getElementById('example1-merged-viewer-status');
    const container = document.getElementById('example1-merged-viewer');
    if (!key || !container) return;

    if (!input.checked) {
        const model = optionalLoadedModels.get(key);
        if (model && mergedViewer) {
            try {
                if (typeof mergedViewer.unloadModel === 'function') mergedViewer.unloadModel(model);
                else if (mergedViewer.impl && typeof mergedViewer.impl.unloadModel === 'function') mergedViewer.impl.unloadModel(model);
            } catch (err) {
                console.warn('[Example1] optional model unload skipped:', err.message);
            }
        }
        optionalLoadedModels.delete(key);
        if (!options.silent && status) status.textContent = `추가 모델 ${optionalLoadedModels.size}개 표시 중`;
        return;
    }

    input.disabled = true;
    try {
        const ready = await ensureInteractiveViewer();
        if (!ready) throw new Error('뷰어가 준비되지 않았습니다.');
        const [{ loadModelMulti }, allModels] = await Promise.all([
            import('./viewer.js?v=20260825-example1-merged'),
            loadCachedOrFreshModels(status)
        ]);
        const target = allModels.find(model => getModelKey(model) === key);
        if (!target) throw new Error('모델 정보를 찾지 못했습니다.');
        if (!options.silent && status) status.textContent = `${getModelName(target)} 추가 로드 중`;
        const model = await loadModelMulti(mergedViewer, target.urn || target.id || target.versionId, {
            keepCurrentModels: true,
            preserveView: true,
            applyRefPoint: true,
            globalOffset: getViewerGlobalOffset(mergedViewer)
        });
        optionalLoadedModels.set(key, model);
        normalizeExample1ViewerOrientation(mergedViewer);
        if (!options.silent && status) status.textContent = `추가 모델 ${optionalLoadedModels.size}개 표시 중`;
    } catch (err) {
        console.error('[Example1] optional model toggle failed:', err);
        input.checked = false;
        if (status) status.textContent = '추가 모델 로드 실패';
    } finally {
        input.disabled = false;
    }
}

function renderCachedViewerPreview(container, status) {
    const preview = readTextCache(VIEWER_PREVIEW_KEY);
    if (!preview || !container) return false;
    container.innerHTML = `
        <div style="position:absolute; inset:0; background:var(--ex1-viewer-bg);">
            <img src="${preview}" alt="이전 3D 병합 화면" style="width:100%; height:100%; object-fit:cover; display:block;">
            <div style="position:absolute; left:12px; bottom:12px; padding:6px 10px; border-radius:6px; background:var(--ex1-panel-bg); color:var(--ex1-text); font-size:0.74rem; font-weight:900; border:1px solid var(--ex1-soft-border);">
                이전 병합 화면 표시 중 · 3D 뷰어 재연결 중
            </div>
        </div>
    `;
    if (status) status.textContent = '이전 병합 화면 표시 중';
    return true;
}

function saveViewerPreview(viewer, container) {
    if (!viewer || typeof viewer.getScreenShot !== 'function' || !container) return;
    const width = Math.max(640, Math.min(1280, Math.floor(container.clientWidth || 960)));
    const height = Math.max(360, Math.min(760, Math.floor(container.clientHeight || 540)));
    try {
        viewer.getScreenShot(width, height, dataUrl => {
            if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) {
                writeTextCache(VIEWER_PREVIEW_KEY, dataUrl);
                setHoldPreviewState(true);
            }
        });
    } catch (err) {
        console.warn('[Example1] viewer preview save skipped:', err.message);
    }
}

function setViewerLoadingOverlay(container, info = {}) {
    if (!container) return null;
    if (window.getComputedStyle && window.getComputedStyle(container).position === 'static') {
        container.style.position = 'relative';
    }
    let overlay = document.getElementById('example1-viewer-loading-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'example1-viewer-loading-overlay';
        overlay.style.cssText = 'position:absolute; inset:0; z-index:9999; display:flex; align-items:center; justify-content:center; overflow:hidden; background:#e5e7eb; color:#f8fafc; pointer-events:none;';
        container.appendChild(overlay);
    }
    const percent = info.total ? Math.round((info.loaded / info.total) * 100) : 0;
    overlay.innerHTML = `
        <img src="/images/example1-3d-loading-preview.png" alt="강북정수장 3D 임시 화면" style="position:absolute; inset:0; width:100%; height:100%; object-fit:cover; display:block;">
        <div style="position:absolute; inset:0; background:linear-gradient(180deg, rgba(15,23,42,0.08), rgba(15,23,42,0.22));"></div>
        <div style="position:relative; width:min(430px,calc(100% - 42px)); padding:15px 17px; border-radius:8px; border:1px solid rgba(56,189,248,0.38); background:rgba(15,23,42,0.86); box-shadow:0 18px 44px rgba(0,0,0,0.32); backdrop-filter:blur(8px);">
            <div style="display:flex; align-items:center; gap:9px; font-size:0.9rem; font-weight:950;">
                <i class="fas fa-spinner fa-spin" style="color:#38dfff;"></i>
                <span>${escapeHtml(info.label || '3D 모델')} 병합중...</span>
                <span style="margin-left:auto; color:#38dfff;">${info.loaded || 0}/${info.total || 0}</span>
            </div>
            <div style="margin-top:10px; height:6px; border-radius:999px; background:rgba(148,163,184,0.25); overflow:hidden;">
                <div style="width:${percent}%; height:100%; background:linear-gradient(90deg,#38bdf8,#22c55e);"></div>
            </div>
            <div style="margin-top:8px; color:#cbd5e1; font-size:0.72rem; font-weight:800; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                ${escapeHtml(info.current || '모델을 병합하고 저장된 시점으로 이동하는 중입니다.')}
            </div>
            ${info.failed ? `<div style="margin-top:6px; color:#fca5a5; font-size:0.7rem; font-weight:900;">일부 모델 ${info.failed}개는 건너뛰고 계속 진행 중입니다.</div>` : ''}
        </div>
    `;
    return overlay;
}

function clearViewerLoadingOverlay() {
    const overlay = document.getElementById('example1-viewer-loading-overlay');
    if (overlay) overlay.remove();
}

function setViewerResultBadge(container, info = {}) {
    if (!container) return;
    let badge = document.getElementById('example1-viewer-result-badge');
    if (!badge) {
        badge = document.createElement('div');
        badge.id = 'example1-viewer-result-badge';
        badge.style.cssText = 'position:absolute; left:14px; top:14px; z-index:9998; max-width:min(560px,calc(100% - 28px)); padding:8px 11px; border-radius:8px; border:1px solid rgba(34,197,94,0.34); background:var(--ex1-panel-bg); color:var(--ex1-text); font-size:0.74rem; font-weight:900; box-shadow:0 12px 28px rgba(0,0,0,0.16); backdrop-filter:blur(8px); pointer-events:none;';
        container.appendChild(badge);
    }
    const failedText = info.failed ? ` · 실패 ${info.failed}개` : '';
    badge.innerHTML = `<i class="fas fa-check-circle" style="color:#22c55e;"></i> ${escapeHtml(info.label || '3D 모델')} ${info.loaded || 0}개 로드 완료${failedText} · 비어 보이면 상단의 화면 맞춤을 눌러주세요.`;
}

function clearViewerResultBadge() {
    const badge = document.getElementById('example1-viewer-result-badge');
    if (badge) badge.remove();
}

function fitExample1Viewer() {
    const viewer = mergedViewer || window.example1MergedViewer;
    if (!viewer) return;
    try {
        normalizeExample1ViewerOrientation(viewer);
        viewer.resize();
        const models = typeof viewer.getAllModels === 'function' ? viewer.getAllModels() : [];
        if (models.length && typeof viewer.fitToView === 'function') {
            viewer.fitToView();
        }
    } catch (err) {
        console.warn('[Example1] viewer fit skipped:', err.message);
    }
}

function saveExample1ViewState() {
    const viewer = mergedViewer || window.example1MergedViewer;
    const status = document.getElementById('example1-merged-viewer-status');
    if (!viewer || !viewer.navigation) {
        if (status) status.textContent = '저장할 3D 뷰가 없습니다';
        return;
    }
    try {
        const nav = viewer.navigation;
        const camera = typeof nav.getCamera === 'function' ? nav.getCamera() : null;
        const position = camera?.position || (typeof nav.getPosition === 'function' ? nav.getPosition() : null);
        const target = typeof nav.getTarget === 'function' ? nav.getTarget() : null;
        const up = camera?.up || null;
        if (!position || !target) throw new Error('카메라 정보를 읽을 수 없습니다.');
        const state = {
            position: { x: position.x, y: position.y, z: position.z },
            target: { x: target.x, y: target.y, z: target.z },
            up: up ? { x: up.x, y: up.y, z: up.z } : { x: 0, y: 0, z: 1 },
            pivot: typeof nav.getPivotPoint === 'function' ? vectorToPlain(nav.getPivotPoint()) : null,
            fov: camera?.fov,
            isPerspective: camera?.isPerspective
        };
        localStorage.setItem(VIEWER_VIEW_STATE_KEY, JSON.stringify({
            savedAt: Date.now(),
            state
        }));
        const button = document.getElementById('example1-view-save');
        if (button) {
            button.style.borderColor = 'rgba(34,197,94,0.55)';
            button.style.color = '#86efac';
            setTimeout(() => {
                button.style.borderColor = 'rgba(45,212,191,0.38)';
                button.style.color = '#99f6e4';
            }, 900);
        }
        if (status) status.textContent = '현재 뷰 시점 저장됨';
    } catch (err) {
        console.warn('[Example1] view state save failed:', err.message);
        if (status) status.textContent = '뷰 시점 저장 실패';
    }
}

function restoreExample1ViewState(viewer) {
    if (!viewer || !viewer.navigation || typeof THREE === 'undefined') return false;
    try {
        const raw = localStorage.getItem(VIEWER_VIEW_STATE_KEY);
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        if (!parsed || !parsed.state) return false;
        const state = parsed.state;
        const position = plainToVector(state.position);
        const target = plainToVector(state.target);
        const up = plainToVector(state.up || { x: 0, y: 0, z: 1 });
        if (viewer.navigation && typeof viewer.navigation.setView === 'function') {
            viewer.navigation.setView(position, target);
        } else if (typeof viewer.setViewFromArray === 'function') {
            viewer.setViewFromArray([position.x, position.y, position.z, target.x, target.y, target.z, up.x, up.y, up.z]);
        }
        const camera = typeof viewer.navigation.getCamera === 'function' ? viewer.navigation.getCamera() : null;
        if (camera?.up && typeof camera.up.copy === 'function') camera.up.copy(up);
        if (state.pivot && typeof viewer.navigation.setPivotPoint === 'function') {
            viewer.navigation.setPivotPoint(plainToVector(state.pivot));
        }
        if (typeof viewer.impl?.invalidate === 'function') viewer.impl.invalidate(true, true, true);
        return true;
    } catch (err) {
        console.warn('[Example1] view state restore failed:', err.message);
        return false;
    }
}

function vectorToPlain(vector) {
    if (!vector) return null;
    return { x: vector.x, y: vector.y, z: vector.z };
}

function plainToVector(value) {
    return new THREE.Vector3(Number(value?.x || 0), Number(value?.y || 0), Number(value?.z || 0));
}

function normalizeExample1ViewerOrientation(viewer) {
    if (!viewer || typeof THREE === 'undefined') return;
    try {
        const up = new THREE.Vector3(0, 0, 1);
        if (viewer.navigation && typeof viewer.navigation.setWorldUpVector === 'function') {
            viewer.navigation.setWorldUpVector(up, true);
        }
        if (viewer.navigation && typeof viewer.navigation.getCamera === 'function') {
            const camera = viewer.navigation.getCamera();
            if (camera && camera.up && typeof camera.up.copy === 'function') {
                camera.up.copy(up);
            }
        }
        if (typeof viewer.setViewCube === 'function') {
            viewer.setViewCube('front top right');
        }
    } catch (err) {
        console.warn('[Example1] viewer orientation normalize skipped:', err.message);
    }
}

async function loadModelsWithProgress(viewer, models, loadModelMulti, onProgress) {
    const loadedModels = [];
    const failedModels = [];
    let sharedGlobalOffset = null;
    for (let i = 0; i < models.length; i++) {
        const item = models[i] || {};
        const urn = item.urn || item.id || item.versionId || item;
        if (!urn) continue;
        onProgress?.({ index: i, loaded: loadedModels.length, failed: failedModels.length, current: getModelName(item) || `모델 ${i + 1}` });
        try {
            const model = await loadModelMulti(viewer, urn, {
                keepCurrentModels: loadedModels.length > 0,
                preserveView: true,
                applyRefPoint: true,
                globalOffset: sharedGlobalOffset || null
            });
            loadedModels.push(model);
            if (!sharedGlobalOffset && model?.getData && model.getData()?.globalOffset) {
                sharedGlobalOffset = model.getData().globalOffset;
            }
            try {
                normalizeExample1ViewerOrientation(viewer);
                viewer.resize();
                if (loadedModels.length === 1) viewer.fitToView();
            } catch (err) {}
            onProgress?.({ index: i, loaded: loadedModels.length, failed: failedModels.length, current: getModelName(item) || `모델 ${i + 1}` });
        } catch (err) {
            console.warn('[Example1] model skipped:', getModelName(item), err);
            failedModels.push({ model: item, error: err });
            onProgress?.({ index: i, loaded: loadedModels.length, failed: failedModels.length, current: `${getModelName(item) || `모델 ${i + 1}`} 로드 실패, 다음 모델 시도` });
        }
    }
    if (!loadedModels.length) {
        throw new Error(failedModels.length ? '모든 모델 로드에 실패했습니다.' : '로드된 모델이 없습니다.');
    }
    return { loadedModels, failedModels };
}

function clearViewerModels(viewer) {
    if (!viewer) return;
    try {
        const models = typeof viewer.getAllModels === 'function' ? viewer.getAllModels() : [];
        models.forEach(model => {
            if (typeof viewer.unloadModel === 'function') {
                viewer.unloadModel(model);
            } else if (viewer.impl && typeof viewer.impl.unloadModel === 'function') {
                viewer.impl.unloadModel(model);
            }
        });
    } catch (err) {
        console.warn('[Example1] previous models cleanup skipped:', err.message);
    }
}

async function loadMergedViewer(mode = 'new', options = {}) {
    if (loadingModels) return;
    if (mergedViewer && mode === currentViewerMode && !options.force) {
        try {
            mergedViewer.resize();
        } catch (err) {}
        return;
    }
    const container = document.getElementById('example1-merged-viewer');
    const status = document.getElementById('example1-merged-viewer-status');
    if (!container) return;
    loadingModels = true;
    currentViewerMode = mode;
    setActiveViewerMode(mode);
    try {
        clearViewerResultBadge();
        if (!mergedViewer) renderCachedViewerPreview(container, status);
        const [{ initViewer, loadModelMulti }, allModels] = await Promise.all([
            import('./viewer.js?v=20260825-example1-merged'),
            loadCachedOrFreshModels(status)
        ]);
        const models = filterModelsByMode(allModels, mode);
        if (!models.length) throw new Error('로드할 모델이 없습니다.');

        const label = getViewerModeLabel(mode);
        if (status) status.textContent = `${label} ${models.length}개 병합 중`;
        setViewerLoadingOverlay(container, { label, loaded: 0, failed: 0, total: models.length, current: '뷰어를 준비하고 있습니다.' });
        if (!mergedViewer) {
            container.innerHTML = '';
            setViewerLoadingOverlay(container, { label, loaded: 0, failed: 0, total: models.length, current: '뷰어를 초기화하고 있습니다.' });
            mergedViewer = await initViewer(container, true);
            if (!mergedViewer) throw new Error('뷰어 초기화 실패');
            setViewerLoadingOverlay(container, { label, loaded: 0, failed: 0, total: models.length, current: '첫 번째 모델을 불러오는 중입니다.' });
        } else {
            clearViewerModels(mergedViewer);
            optionalLoadedModels.clear();
            closeModelVisibilityPanel();
        }
        window.example1MergedViewer = mergedViewer;
        const result = await loadModelsWithProgress(mergedViewer, models, loadModelMulti, progress => {
            const loaded = progress.loaded || 0;
            const failed = progress.failed || 0;
            const current = progress.current || '';
            if (status) status.textContent = `${label} ${loaded}/${models.length}개 표시 중${failed ? ` · 실패 ${failed}` : ''}`;
            setViewerLoadingOverlay(container, { label, loaded, failed, total: models.length, current });
        });
        if (status) status.textContent = `${label} ${result.loadedModels.length}개 표시 중${result.failedModels.length ? ` · 실패 ${result.failedModels.length}` : ''}`;
        setTimeout(() => {
            try {
                mergedViewer.resize();
                restoreExample1ViewState(mergedViewer);
                setTimeout(() => {
                    try {
                        mergedViewer.resize();
                        saveViewerPreview(mergedViewer, container);
                        clearViewerLoadingOverlay();
                        setViewerResultBadge(container, {
                            label,
                            loaded: result.loadedModels.length,
                            failed: result.failedModels.length
                        });
                    } catch (err) {}
                }, 450);
            } catch (err) {
                clearViewerLoadingOverlay();
                setViewerResultBadge(container, {
                    label,
                    loaded: result.loadedModels.length,
                    failed: result.failedModels.length
                });
            }
        }, 450);
    } catch (err) {
        console.error('[Example1] merged viewer failed:', err);
        if (status) status.textContent = `${getViewerModeLabel(mode)} 로드 실패`;
        clearViewerLoadingOverlay();
        if (!mergedViewer) {
            container.innerHTML = `<div style="height:100%; display:flex; align-items:center; justify-content:center; color:#ef4444; font-weight:900; text-align:center; padding:24px;">3D 병합 뷰를 불러오지 못했습니다.<br>${escapeHtml(err.message)}</div>`;
        }
    } finally {
        loadingModels = false;
    }
}

function initMergedViewer() {
    bindViewerModeControls();
    setActiveViewerMode(currentViewerMode);
    const container = document.getElementById('example1-merged-viewer');
    const status = document.getElementById('example1-merged-viewer-status');
    if (getHoldPreviewState() && renderCachedViewerPreview(container, status)) {
        clearViewerLoadingOverlay();
        setViewerResultBadge(container, {
            label: getViewerModeLabel(currentViewerMode),
            loaded: '저장된 화면',
            failed: 0
        });
        if (status) status.textContent = '마지막 3D 화면 유지 중';
        return Promise.resolve();
    }
    return loadMergedViewer('new');
}

export function initExample1Dashboard() {
    if (!initialized) {
        renderShell();
        initialized = true;
    }
    updateDDay();
    updateWeather();
    loadMonthlyScheduleKpis();
    setTimeout(initMergedViewer, 80);
}

if (typeof window !== 'undefined') {
    window.initExample1Dashboard = initExample1Dashboard;
}
