const DEFAULT_HUB_ID = 'b.4efd43ab-93fa-4448-918b-091d81dbfd75';
const DEFAULT_PROJECT_ID = 'b.d005cd39-4a35-4843-b350-81da491266ef';

const TASK_STORE_KEY = 'example2_local_workflow_tasks_v3';
const WORKFLOW_API_URL = '/api/tasks/workflow';
const CACHE_TTL_MS = 5 * 60 * 1000;

const STATUS_META = {
    request_to_manager: { label: '관리자 검토 대기', color: '#38bdf8', icon: 'fa-user-tie' },
    returned_to_requester: { label: '요청자 확인 필요', color: '#f97316', icon: 'fa-rotate-left' },
    assigned_to_worker: { label: '작업자 진행 중', color: '#10b981', icon: 'fa-person-digging' },
    returned_to_worker: { label: '작업자 보완 요청', color: '#f59e0b', icon: 'fa-rotate-left' },
    review_to_manager: { label: '관리자 최종 검토', color: '#a78bfa', icon: 'fa-magnifying-glass' },
    final_to_requester: { label: '요청자 종료 대기', color: '#22d3ee', icon: 'fa-flag-checkered' },
    closed: { label: '종료', color: '#94a3b8', icon: 'fa-circle-check' }
};

let state = {
    currentUser: { id: '', name: 'ACC 사용자', email: '' },
    members: [],
    tasks: [],
    editingId: '',
    workflowView: 'active',
    docsCache: new Map(),
    docsStack: []
};

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function todayKey() {
    return new Date().toISOString().slice(0, 10);
}

function formatDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function userKey(user) {
    if (typeof user === 'string') return user.trim().toLowerCase();
    return String(user?.email || user?.id || user?.name || '').trim().toLowerCase();
}

function userTokens(user) {
    if (!user) return [];
    if (typeof user === 'string') return [user.trim().toLowerCase()].filter(Boolean);
    return [user.email, user.id, user.name]
        .map(value => String(value || '').trim().toLowerCase())
        .filter(Boolean);
}

function sameUser(a, b) {
    const left = userTokens(a);
    const right = new Set(userTokens(b));
    return left.some(value => right.has(value));
}

function memberName(value) {
    if (!value) return '';
    if (typeof value === 'string') return value;
    return value.name || value.email || '';
}

function uniqueMembers(rows) {
    const map = new Map();
    rows.filter(Boolean).forEach(row => {
        const member = typeof row === 'string'
            ? { id: row, name: row, email: '' }
            : { id: row.id || row.autodeskId || row.email || row.name || '', name: row.name || row.displayName || row.email || '', email: row.email || '' };
        const key = userKey(member);
        if (key && member.name) map.set(key, member);
    });
    return [...map.values()].sort((a, b) => memberName(a).localeCompare(memberName(b), 'ko'));
}

function personOptions(selectedValue = '') {
    const selected = selectedValue || state.currentUser;
    const rows = state.members.length ? state.members : [state.currentUser];
    return rows.map(member => {
        const name = memberName(member);
        const key = userKey(member);
        const selectedAttr = sameUser(member, selected) || key === userKey(selected) ? 'selected' : '';
        return `<option value="${escapeHtml(key)}" data-name="${escapeHtml(name)}" data-email="${escapeHtml(member.email || '')}" data-id="${escapeHtml(member.id || '')}" ${selectedAttr}>${escapeHtml(name)}${member.email ? ` (${escapeHtml(member.email)})` : ''}</option>`;
    }).join('');
}

function selectedMember(selectId) {
    const select = document.getElementById(selectId);
    const option = select?.selectedOptions?.[0];
    if (!select || !option) return { key: '', name: '' };
    return {
        key: select.value || option.dataset.email || option.dataset.id || option.dataset.name || '',
        name: option.dataset.name || option.textContent.replace(/\s*\([^)]*\)\s*$/, '').trim() || select.value,
        email: option.dataset.email || '',
        id: option.dataset.id || ''
    };
}

function personRef(name, key) {
    const value = String(key || '').trim();
    return {
        name: name || value,
        id: value && !value.includes('@') ? value : '',
        email: value.includes('@') ? value : ''
    };
}

function findMemberByNameOrKey(name, key) {
    const ref = personRef(name, key);
    return state.members.find(member => sameUser(member, ref) || sameUser(member.name, name)) || null;
}

function fillTaskIdentityKeys(task) {
    const requester = findMemberByNameOrKey(task.requester, task.requesterKey);
    const manager = findMemberByNameOrKey(task.manager, task.managerKey);
    const worker = findMemberByNameOrKey(task.worker, task.workerKey);
    if (!task.requesterKey) task.requesterKey = requester ? userKey(requester) : task.requester || '';
    if (!task.managerKey) task.managerKey = manager ? userKey(manager) : task.manager || '';
    if (!task.workerKey) task.workerKey = worker ? userKey(worker) : task.worker || '';
    if (!task.assignedToKey) {
        if (sameUser(task.assignedTo, task.manager)) task.assignedToKey = task.managerKey || task.assignedTo;
        else if (sameUser(task.assignedTo, task.worker)) task.assignedToKey = task.workerKey || task.assignedTo;
        else if (sameUser(task.assignedTo, task.requester)) task.assignedToKey = task.requesterKey || task.assignedTo;
        else task.assignedToKey = task.assignedTo || '';
    }
    return task;
}

function readLocalTasks() {
    try {
        const rows = JSON.parse(localStorage.getItem(TASK_STORE_KEY) || '[]');
        if (Array.isArray(rows)) return rows;
    } catch (err) {
        console.warn('[Example2 Workflow] localStorage read failed:', err);
    }
    return [];
}

async function readTasks() {
    try {
        const resp = await fetch(WORKFLOW_API_URL, { credentials: 'same-origin' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        const serverTasks = Array.isArray(data.tasks) ? data.tasks : [];
        const localTasks = readLocalTasks();
        if (!serverTasks.length && localTasks.length) {
            state.tasks = localTasks;
            await writeTasks();
            return localTasks;
        }
        localStorage.setItem(TASK_STORE_KEY, JSON.stringify(serverTasks));
        return serverTasks;
    } catch (err) {
        console.warn('[Example2 Workflow] server read failed, using local backup:', err.message);
        return readLocalTasks();
    }
}

async function writeTasks() {
    localStorage.setItem(TASK_STORE_KEY, JSON.stringify(state.tasks));
    try {
        const resp = await fetch(WORKFLOW_API_URL, {
            method: 'PUT',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tasks: state.tasks })
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    } catch (err) {
        console.warn('[Example2 Workflow] server save failed; local backup kept:', err.message);
    }
}

function taskStatus(task) {
    return STATUS_META[task.status] || STATUS_META.request_to_manager;
}

function isCurrentAssignee(task) {
    return sameUser(personRef(task.assignedTo, task.assignedToKey), state.currentUser);
}

function isParticipant(task) {
    return isCurrentAssignee(task) ||
        sameUser(personRef(task.requester, task.requesterKey), state.currentUser) ||
        sameUser(personRef(task.manager, task.managerKey), state.currentUser) ||
        sameUser(personRef(task.worker, task.workerKey), state.currentUser);
}

function isRequester(task) {
    return sameUser(personRef(task.requester, task.requesterKey), state.currentUser);
}

function visibleTasks() {
    return state.tasks
        .filter(task => isParticipant(task))
        .filter(task => state.workflowView === 'closed' ? task.status === 'closed' : task.status !== 'closed')
        .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

function taskRole(task) {
    if (sameUser(personRef(task.requester, task.requesterKey), state.currentUser)) return '요청자';
    if (sameUser(personRef(task.manager, task.managerKey), state.currentUser)) return '관리자';
    if (sameUser(personRef(task.worker, task.workerKey), state.currentUser)) return '작업자';
    return '참조';
}

function newTask() {
    const now = new Date().toISOString();
    return {
        id: `WORK-${Date.now()}`,
        title: '',
        requester: state.currentUser.name || 'ACC 사용자',
        requesterKey: userKey(state.currentUser),
        manager: '',
        managerKey: '',
        worker: '',
        workerKey: '',
        createdDate: todayKey(),
        dueDate: '',
        workStartDate: '',
        workDueDate: '',
        managerMemo: '',
        workerMemo: '',
        deliverable: null,
        status: 'request_to_manager',
        assignedTo: '',
        assignedToKey: '',
        createdAt: now,
        updatedAt: now,
        history: []
    };
}

function currentTask() {
    return state.tasks.find(task => task.id === state.editingId) || newTask();
}

function addHistory(task, action, note = '') {
    task.history = Array.isArray(task.history) ? task.history : [];
    task.history.unshift({
        at: new Date().toISOString(),
        by: state.currentUser.name,
        action,
        note
    });
}

function renderTaskCard(task) {
    const meta = taskStatus(task);
    const role = taskRole(task);
    const due = task.workDueDate || task.dueDate;
    const deliverableName = task.deliverable?.name || '';
    return `
        <button type="button" class="workflow-task-card" data-task-id="${escapeHtml(task.id)}">
            <div class="workflow-task-head">
                <div class="workflow-task-title">${escapeHtml(task.title || '제목 없음')}</div>
                <span class="workflow-status" style="color:${meta.color}; border-color:${meta.color}; background:${meta.color}22;">
                    <i class="fas ${meta.icon}"></i> ${escapeHtml(meta.label)}
                </span>
            </div>
            <div class="workflow-task-grid">
                <span><i class="fas fa-id-badge"></i> ${escapeHtml(role)}</span>
                <span><i class="fas fa-calendar"></i> ${escapeHtml(formatDate(due))}</span>
                <span><i class="fas fa-user-tie"></i> 관리자 ${escapeHtml(task.manager || '미지정')}</span>
                <span><i class="fas fa-user"></i> 작업자 ${escapeHtml(task.worker || '미지정')}</span>
            </div>
            <div class="workflow-task-doc">
                <i class="fas fa-paperclip"></i>
                ${deliverableName ? escapeHtml(deliverableName) : '결과물 미지정'}
            </div>
        </button>
    `;
}

function renderMain() {
    const root = document.getElementById('example2-cde-tasks');
    if (!root) return;
    const tasks = visibleTasks();
    root.innerHTML = `
        <style>
            #example2-cde-tasks * { box-sizing: border-box; }
            .workflow-shell { height: 100%; min-height: 0; display: flex; flex-direction: column; gap: 12px; padding: 14px; color: #e5e7eb; }
            .workflow-top { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
            .workflow-title { color: #f8fafc; font-size: 13px; font-weight: 900; }
            .workflow-sub { margin-top: 3px; color: #94a3b8; font-size: 11px; font-weight: 800; }
            .workflow-top-actions { display:flex; align-items:center; gap:7px; flex:0 0 auto; }
            .workflow-add { width: 34px; height: 34px; border: 1px solid rgba(16,185,129,0.38); border-radius: 7px; background: rgba(16,185,129,0.14); color: #6ee7b7; cursor: pointer; }
            .workflow-closed { width: 34px; height: 34px; border: 1px solid rgba(148,163,184,0.28); border-radius: 7px; background: rgba(148,163,184,0.10); color: #cbd5e1; cursor: pointer; position: relative; }
            .workflow-closed.active { border-color: rgba(34,211,238,0.45); background: rgba(34,211,238,0.14); color: #67e8f9; }
            .workflow-closed-count { position:absolute; right:-5px; top:-5px; min-width:16px; height:16px; padding:0 4px; border-radius:999px; background:#ef4444; color:white; font-size:9px; font-weight:900; display:flex; align-items:center; justify-content:center; }
            .workflow-user { display: flex; align-items: center; gap: 8px; padding: 9px 10px; border: 1px solid rgba(148,163,184,0.16); border-radius: 7px; background: rgba(15,23,42,0.64); }
            .workflow-user-name { min-width: 0; flex: 1; color: #f8fafc; font-size: 12px; font-weight: 900; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .workflow-count { color: #38bdf8; font-size: 11px; font-weight: 900; white-space: nowrap; }
            .workflow-list { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 8px; padding-right: 2px; }
            .workflow-empty { height: 100%; min-height: 180px; display: flex; align-items: center; justify-content: center; border: 1px dashed rgba(148,163,184,0.22); border-radius: 8px; color: #94a3b8; font-size: 12px; font-weight: 900; text-align: center; line-height: 1.7; }
            .workflow-task-card { width: 100%; text-align: left; border: 1px solid rgba(148,163,184,0.16); border-radius: 7px; background: rgba(15,23,42,0.78); padding: 12px; cursor: pointer; }
            .workflow-task-card:hover { border-color: rgba(56,189,248,0.45); background: rgba(15,23,42,0.95); }
            .workflow-task-head { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; }
            .workflow-task-title { min-width: 0; color: #f8fafc; font-size: 13px; font-weight: 900; line-height: 1.35; word-break: keep-all; overflow-wrap: anywhere; }
            .workflow-status { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 4px; border: 1px solid; border-radius: 999px; padding: 3px 7px; font-size: 10px; font-weight: 900; }
            .workflow-task-grid { margin-top: 9px; display: grid; grid-template-columns: 1fr 1fr; gap: 6px; color: #cbd5e1; font-size: 11px; font-weight: 800; }
            .workflow-task-grid i, .workflow-task-doc i { color: #38bdf8; margin-right: 5px; }
            .workflow-task-doc { margin-top: 8px; color: #94a3b8; font-size: 11px; font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .workflow-field { display: flex; flex-direction: column; gap: 5px; color: #94a3b8; font-size: 11px; font-weight: 900; }
            .workflow-field input, .workflow-field select, .workflow-field textarea { width: 100%; background: #020617; color: #e5e7eb; border: 1px solid rgba(148,163,184,0.28); border-radius: 6px; padding: 0 10px; font-size: 12px; }
            .workflow-field input, .workflow-field select { height: 34px; }
            .workflow-field textarea { height: 82px; padding: 10px; resize: none; }
            .workflow-field input[readonly] { background: #111827; color: #cbd5e1; cursor: not-allowed; }
            .workflow-actions { display: flex; justify-content: flex-end; gap: 8px; padding-top: 2px; }
            .workflow-btn { min-width: 74px; height: 34px; border-radius: 6px; border: 1px solid rgba(148,163,184,0.24); background: rgba(148,163,184,0.10); color: #cbd5e1; font-weight: 900; cursor: pointer; }
            .workflow-btn.primary { border: 0; background: #10b981; color: #052e2b; }
            .workflow-btn.warn { border-color: rgba(249,115,22,0.45); background: rgba(249,115,22,0.13); color: #fdba74; }
            .workflow-btn.danger { border-color: rgba(248,113,113,0.45); background: rgba(248,113,113,0.13); color: #fca5a5; }
            .workflow-doc-box { display: flex; align-items: center; gap: 8px; min-height: 38px; border: 1px solid rgba(148,163,184,0.22); border-radius: 7px; background: #020617; padding: 8px 10px; color: #cbd5e1; font-size: 12px; font-weight: 800; }
            .workflow-doc-name { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .docs-row { width: 100%; min-height: 34px; display: flex; align-items: center; gap: 8px; border: 0; border-bottom: 1px solid rgba(148,163,184,0.12); background: transparent; color: #e5e7eb; text-align: left; padding: 7px 4px; cursor: pointer; }
            .docs-row:hover { background: rgba(56,189,248,0.09); }
        </style>
        <div class="workflow-shell">
            <div class="workflow-top">
                <div style="min-width:0;">
                    <div class="workflow-title">나에게 할당된 업무</div>
                    <div class="workflow-sub">요청자 → 관리자 → 작업자 → 관리자 → 요청자 흐름으로 진행됩니다.</div>
                </div>
                <div class="workflow-top-actions">
                    <button id="workflow-closed-toggle" type="button" class="workflow-closed ${state.workflowView === 'closed' ? 'active' : ''}" title="${state.workflowView === 'closed' ? '진행 업무 보기' : '종료된 업무'}">
                        <i class="fas ${state.workflowView === 'closed' ? 'fa-list-check' : 'fa-box-archive'}"></i>
                        ${state.tasks.filter(task => task.status === 'closed' && isParticipant(task)).length ? `<span class="workflow-closed-count">${state.tasks.filter(task => task.status === 'closed' && isParticipant(task)).length}</span>` : ''}
                    </button>
                    <button id="workflow-add-task" type="button" class="workflow-add" title="업무 추가"><i class="fas fa-plus"></i></button>
                </div>
            </div>
            <div class="workflow-user">
                <i class="fas fa-circle-user" style="color:#10b981;"></i>
                <div class="workflow-user-name">${escapeHtml(state.currentUser.name || 'ACC 로그인 필요')}</div>
                <div class="workflow-count">${tasks.length}건</div>
            </div>
            <div class="workflow-list">
                ${tasks.length ? tasks.map(renderTaskCard).join('') : `<div class="workflow-empty">${state.workflowView === 'closed' ? '종료된 업무가 없습니다.' : '나에게 할당된 업무가 없습니다.<br>+ 버튼으로 새 업무를 생성하세요.'}</div>`}
            </div>
        </div>
    `;
    document.getElementById('workflow-add-task')?.addEventListener('click', () => openTaskModal(''));
    document.getElementById('workflow-closed-toggle')?.addEventListener('click', () => {
        state.workflowView = state.workflowView === 'closed' ? 'active' : 'closed';
        renderMain();
    });
    root.querySelectorAll('[data-task-id]').forEach(button => {
        button.addEventListener('click', () => openTaskModal(button.dataset.taskId));
    });
}

function modalShell(title, bodyHtml, actionHtml) {
    const overlay = document.createElement('div');
    overlay.id = 'example2-workflow-modal';
    overlay.style.cssText = 'position:fixed; inset:0; z-index:4200; display:flex; align-items:center; justify-content:center; background:rgba(2,6,23,0.72); backdrop-filter:blur(3px);';
    overlay.innerHTML = `
        <div role="dialog" aria-modal="true" style="width:min(760px,calc(100vw - 32px)); max-height:calc(100vh - 48px); overflow:auto; border:1px solid rgba(56,189,248,0.24); border-radius:8px; background:#0f172a; box-shadow:0 24px 80px rgba(0,0,0,0.45);">
            <div style="height:46px; display:flex; align-items:center; justify-content:space-between; gap:10px; padding:0 16px; border-bottom:1px solid rgba(148,163,184,0.16);">
                <div style="color:#f8fafc; font-size:14px; font-weight:900;">${escapeHtml(title)}</div>
                <button data-modal-close type="button" class="workflow-btn" style="min-width:30px; width:30px;"><i class="fas fa-times"></i></button>
            </div>
            <div style="display:flex; flex-direction:column; gap:12px; padding:16px;">
                ${bodyHtml}
                <div class="workflow-actions">${actionHtml}</div>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelectorAll('[data-modal-close]').forEach(btn => btn.addEventListener('click', closeTaskModal));
    return overlay;
}

function closeTaskModal() {
    state.editingId = '';
    document.getElementById('example2-workflow-modal')?.remove();
    document.getElementById('example2-doc-picker-modal')?.remove();
}

function openTaskModal(id = '') {
    state.editingId = id;
    renderTaskModal();
}

function baseInfoFields(task) {
    return `
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
            <label class="workflow-field">업무명
                <input id="wf-title" value="${escapeHtml(task.title)}" ${task.id && state.editingId ? 'readonly' : ''}>
            </label>
            <label class="workflow-field">요청자
                <input id="wf-requester" value="${escapeHtml(task.requester || state.currentUser.name)}" readonly>
            </label>
            <label class="workflow-field">관리자
                ${task.id && state.editingId ? `<input id="wf-manager" value="${escapeHtml(task.manager)}" readonly>` : `<select id="wf-manager">${personOptions(task.managerKey || task.manager)}</select>`}
            </label>
            <label class="workflow-field">생성일
                <input id="wf-created" type="date" value="${escapeHtml(task.createdDate || todayKey())}" readonly>
            </label>
            <label class="workflow-field">마감일
                <input id="wf-due" type="date" value="${escapeHtml(task.dueDate || '')}" ${task.id && state.editingId ? 'readonly' : ''}>
            </label>
        </div>
    `;
}

function managerAssignFields(task) {
    return `
        ${baseInfoFields(task)}
        <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px;">
            <label class="workflow-field">작업자
                <select id="wf-worker">${personOptions(task.workerKey || task.worker)}</select>
            </label>
            <label class="workflow-field">작업 시작일
                <input id="wf-work-start" type="date" value="${escapeHtml(task.workStartDate || todayKey())}">
            </label>
            <label class="workflow-field">작업 마감일
                <input id="wf-work-due" type="date" value="${escapeHtml(task.workDueDate || task.dueDate || '')}">
            </label>
        </div>
        <label class="workflow-field">비고
            <textarea id="wf-manager-memo">${escapeHtml(task.managerMemo || '')}</textarea>
        </label>
    `;
}

function workerFields(task) {
    const doc = task.deliverable;
    return `
        ${baseInfoFields(task)}
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
            <label class="workflow-field">작업자
                <input id="wf-worker-readonly" value="${escapeHtml(task.worker || '')}" readonly>
            </label>
            <label class="workflow-field">작업 기한
                <input value="${escapeHtml(`${formatDate(task.workStartDate)} ~ ${formatDate(task.workDueDate)}`)}" readonly>
            </label>
        </div>
        <label class="workflow-field">관리자 비고
            <textarea readonly>${escapeHtml(task.managerMemo || '')}</textarea>
        </label>
        <div class="workflow-field">결과물
            <div class="workflow-doc-box">
                <i class="fas fa-file-lines" style="color:#38bdf8;"></i>
                <div id="wf-doc-name" class="workflow-doc-name">${doc ? escapeHtml(doc.name) : '선택된 결과물이 없습니다.'}</div>
                <button id="wf-pick-doc" type="button" class="workflow-btn" style="min-width:96px;"><i class="fas fa-folder-open"></i> 선택</button>
            </div>
            <input id="wf-doc-json" type="hidden" value="${escapeHtml(JSON.stringify(doc || null))}">
        </div>
        <label class="workflow-field">비고2
            <textarea id="wf-worker-memo">${escapeHtml(task.workerMemo || '')}</textarea>
        </label>
    `;
}

function reviewFields(task) {
    const doc = task.deliverable;
    return `
        ${baseInfoFields(task)}
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
            <label class="workflow-field">작업자
                <input value="${escapeHtml(task.worker || '')}" readonly>
            </label>
            <label class="workflow-field">작업 기한
                <input value="${escapeHtml(`${formatDate(task.workStartDate)} ~ ${formatDate(task.workDueDate)}`)}" readonly>
            </label>
        </div>
        <label class="workflow-field">관리자 비고
            <textarea readonly>${escapeHtml(task.managerMemo || '')}</textarea>
        </label>
        <div class="workflow-field">결과물
            <div class="workflow-doc-box">
                <i class="fas fa-paperclip" style="color:#f59e0b;"></i>
                <div class="workflow-doc-name">${doc ? escapeHtml(`${doc.path ? `${doc.path} / ` : ''}${doc.name}`) : '결과물이 지정되지 않았습니다.'}</div>
                ${doc?.urn ? `<button id="wf-view-doc" type="button" class="workflow-btn" style="min-width:74px;"><i class="fas fa-eye"></i> 보기</button>` : ''}
            </div>
        </div>
        <label class="workflow-field">작업자 비고
            <textarea readonly>${escapeHtml(task.workerMemo || '')}</textarea>
        </label>
    `;
}

function finalRequesterFields(task) {
    return `${reviewFields(task)}
        <div style="border:1px solid rgba(34,211,238,0.18); border-radius:7px; padding:10px; background:rgba(34,211,238,0.06); color:#bae6fd; font-size:12px; font-weight:800;">
            관리자 검토가 완료되었습니다. 결과물을 확인한 뒤 업무를 종료할 수 있습니다.
        </div>`;
}

function renderHistory(task) {
    const history = Array.isArray(task.history) ? task.history : [];
    const rows = history.length ? history.map(item => `
        <div style="display:grid; grid-template-columns:126px 110px 1fr; gap:8px; padding:7px 0; border-bottom:1px solid rgba(148,163,184,0.10); color:#cbd5e1; font-size:11px; font-weight:800;">
            <span style="color:#94a3b8;">${escapeHtml(formatDate(item.at))}</span>
            <span style="color:#38bdf8; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(item.by || '-')}</span>
            <span>${escapeHtml(item.action || item.note || '-')}</span>
        </div>
    `).join('') : '<div style="padding:10px 0; color:#94a3b8; font-size:11px; font-weight:800;">처리 내역이 없습니다.</div>';
    return `
        <div style="border:1px solid rgba(148,163,184,0.16); border-radius:7px; background:rgba(2,6,23,0.34); padding:10px;">
            <div style="color:#f8fafc; font-size:12px; font-weight:900; margin-bottom:4px;"><i class="fas fa-clock-rotate-left" style="color:#38bdf8;"></i> 처리 내역</div>
            ${rows}
        </div>
    `;
}

function readOnlyBanner(task) {
    const meta = taskStatus(task);
    return `
        <div style="border:1px solid rgba(148,163,184,0.18); border-radius:7px; background:rgba(148,163,184,0.08); padding:10px; color:#cbd5e1; font-size:12px; font-weight:800;">
            <i class="fas fa-eye" style="color:${meta.color}; margin-right:6px;"></i>
            현재 단계는 <span style="color:${meta.color};">${escapeHtml(meta.label)}</span>입니다. 이 업무는 보기 전용으로 표시됩니다.
        </div>
    `;
}

function renderTaskModal() {
    document.getElementById('example2-workflow-modal')?.remove();
    const task = currentTask();
    const isNew = !state.editingId;
    let title = '업무 생성';
    let body = baseInfoFields(task);
    let actions = `
        <button type="button" class="workflow-btn" data-modal-close>닫기</button>
        <button type="button" class="workflow-btn primary" id="wf-create"><i class="fas fa-paper-plane"></i> 요청</button>
    `;

    if (!isNew) {
        const status = task.status;
        const canAct = isCurrentAssignee(task) && status !== 'closed';
        if (canAct && status === 'request_to_manager' && sameUser(personRef(task.manager, task.managerKey), state.currentUser)) {
            title = '관리자 업무 전달';
            body = managerAssignFields(task);
            actions = `
                <button type="button" class="workflow-btn" data-modal-close>닫기</button>
                <button type="button" class="workflow-btn danger" id="wf-reject-requester"><i class="fas fa-rotate-left"></i> 반려</button>
                <button type="button" class="workflow-btn primary" id="wf-forward-worker"><i class="fas fa-share"></i> 전달</button>
            `;
        } else if (canAct && (status === 'assigned_to_worker' || status === 'returned_to_worker') && sameUser(personRef(task.worker, task.workerKey), state.currentUser)) {
            title = '작업자 업무 진행';
            body = workerFields(task);
            actions = `
                <button type="button" class="workflow-btn" data-modal-close>닫기</button>
                <button type="button" class="workflow-btn primary" id="wf-request-review"><i class="fas fa-share-from-square"></i> 검토 요청</button>
            `;
        } else if (canAct && status === 'review_to_manager' && sameUser(personRef(task.manager, task.managerKey), state.currentUser)) {
            title = '관리자 결과물 검토';
            body = reviewFields(task);
            actions = `
                <button type="button" class="workflow-btn" data-modal-close>닫기</button>
                <button type="button" class="workflow-btn danger" id="wf-return-worker"><i class="fas fa-rotate-left"></i> 반려</button>
                <button type="button" class="workflow-btn primary" id="wf-approve"><i class="fas fa-check"></i> 검토 완료</button>
            `;
        } else if (canAct && (status === 'final_to_requester' || status === 'returned_to_requester') && sameUser(personRef(task.requester, task.requesterKey), state.currentUser)) {
            title = status === 'returned_to_requester' ? '반려 업무 확인' : '요청자 최종 확인';
            body = status === 'returned_to_requester' ? baseInfoFields(task) : finalRequesterFields(task);
            actions = `
                <button type="button" class="workflow-btn" data-modal-close>닫기</button>
                <button type="button" class="workflow-btn primary" id="wf-close-task"><i class="fas fa-circle-check"></i> 종료</button>
            `;
        } else {
            title = status === 'closed' ? '종료 업무 내역' : '업무 상세 보기';
            body = `${readOnlyBanner(task)}${reviewFields(task)}`;
            actions = `<button type="button" class="workflow-btn" data-modal-close>닫기</button>`;
        }
        body += renderHistory(task);
        if (isRequester(task)) {
            actions = `<button type="button" class="workflow-btn danger" id="wf-delete-task"><i class="fas fa-trash"></i> 삭제</button>${actions}`;
        }
    }

    const overlay = modalShell(title, body, actions);
    bindWorkflowActions(task, isNew, overlay);
}
function updateTask(task, patch, action, note = '') {
    Object.assign(task, patch, { updatedAt: new Date().toISOString() });
    addHistory(task, action, note);
    writeTasks();
    closeTaskModal();
    renderMain();
}

function deleteTask(task) {
    state.tasks = state.tasks.filter(item => item.id !== task.id);
    writeTasks();
    closeTaskModal();
    renderMain();
}

function readDocValue() {
    try {
        return JSON.parse(document.getElementById('wf-doc-json')?.value || 'null');
    } catch (_err) {
        return null;
    }
}

async function waitForProjectViewer(timeoutMs = 7000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        const viewer = window.projectViewer || window._viewer || window.viewer;
        if (viewer && viewer.impl) return viewer;
        await new Promise(resolve => setTimeout(resolve, 120));
    }
    return window.projectViewer || window._viewer || window.viewer || null;
}

async function openDeliverableInProjectViewer(task) {
    const doc = task.deliverable || {};
    const urn = doc.urn || doc.rawUrn || doc.versionId || '';
    if (!urn) {
        alert('선택된 결과물에 뷰어 URN 정보가 없습니다.');
        return;
    }

    closeTaskModal();
    if (typeof window.switchTab === 'function') {
        window.switchTab('project');
    }

    try {
        await new Promise(resolve => setTimeout(resolve, 180));
        if (window.explorer && typeof window.explorer.loadIntoViewer === 'function') {
            await window.explorer.loadIntoViewer(urn, doc.name || '업무 결과물');
            return;
        }

        const viewer = await waitForProjectViewer();
        if (!viewer) {
            throw new Error('프로젝트 3D 뷰어를 찾지 못했습니다.');
        }

        window.viewer = viewer;
        window.myGlobalViewer = viewer;
        window.projectViewer = viewer;
        window.currentUrn = urn;
        window.currentUrnName = doc.name || '';
        window.currentModelName = doc.name || '';

        if (typeof window.loadModel === 'function') {
            await window.loadModel(viewer, urn);
        } else {
            throw new Error('모델 로드 함수가 준비되지 않았습니다.');
        }
    } catch (err) {
        console.error('[Example2 Workflow] deliverable viewer open failed:', err);
        alert(`결과물 모델을 열지 못했습니다. ${err.message || err}`);
    }
}

function bindWorkflowActions(task, isNew, overlay) {
    overlay.querySelector('#wf-delete-task')?.addEventListener('click', () => {
        if (!isRequester(task)) return alert('요청자만 업무를 삭제할 수 있습니다.');
        const title = task.title || '이 업무';
        if (!confirm(`'${title}' 업무를 삭제할까요? 삭제하면 모든 참여자의 대시보드에서 사라집니다.`)) return;
        deleteTask(task);
    });

    overlay.querySelector('#wf-create')?.addEventListener('click', () => {
        const title = overlay.querySelector('#wf-title')?.value?.trim();
        const managerMember = selectedMember('wf-manager');
        if (!title || !managerMember.name || !managerMember.key) return alert('업무명과 관리자를 입력해주세요.');
        const created = {
            ...newTask(),
            title,
            manager: managerMember.name,
            managerKey: managerMember.key,
            requester: state.currentUser.name,
            requesterKey: userKey(state.currentUser),
            createdDate: overlay.querySelector('#wf-created')?.value || todayKey(),
            dueDate: overlay.querySelector('#wf-due')?.value || '',
            assignedTo: managerMember.name,
            assignedToKey: managerMember.key
        };
        addHistory(created, '요청자가 업무를 생성했습니다.');
        state.tasks.unshift(created);
        writeTasks();
        closeTaskModal();
        renderMain();
    });

    overlay.querySelector('#wf-forward-worker')?.addEventListener('click', () => {
        const workerMember = selectedMember('wf-worker');
        if (!workerMember.name || !workerMember.key) return alert('작업자를 지정해주세요.');
        updateTask(task, {
            worker: workerMember.name,
            workerKey: workerMember.key,
            workStartDate: overlay.querySelector('#wf-work-start')?.value || '',
            workDueDate: overlay.querySelector('#wf-work-due')?.value || '',
            managerMemo: overlay.querySelector('#wf-manager-memo')?.value?.trim() || '',
            status: 'assigned_to_worker',
            assignedTo: workerMember.name,
            assignedToKey: workerMember.key
        }, '관리자가 작업자에게 전달했습니다.');
    });

    overlay.querySelector('#wf-reject-requester')?.addEventListener('click', () => {
        updateTask(task, {
            status: 'returned_to_requester',
            assignedTo: task.requester,
            assignedToKey: task.requesterKey || task.requester
        }, '관리자가 요청자에게 반려했습니다.');
    });

    overlay.querySelector('#wf-pick-doc')?.addEventListener('click', () => openDocsPicker(selected => {
        const input = document.getElementById('wf-doc-json');
        const name = document.getElementById('wf-doc-name');
        if (input) input.value = JSON.stringify(selected);
        if (name) name.textContent = selected.name;
    }));

    overlay.querySelector('#wf-request-review')?.addEventListener('click', () => {
        const deliverable = readDocValue();
        if (!deliverable) return alert('결과물 파일을 선택해주세요.');
        updateTask(task, {
            deliverable,
            workerMemo: overlay.querySelector('#wf-worker-memo')?.value?.trim() || '',
            status: 'review_to_manager',
            assignedTo: task.manager,
            assignedToKey: task.managerKey || task.manager
        }, '작업자가 검토를 요청했습니다.');
    });

    overlay.querySelector('#wf-return-worker')?.addEventListener('click', () => {
        updateTask(task, {
            status: 'returned_to_worker',
            assignedTo: task.worker,
            assignedToKey: task.workerKey || task.worker
        }, '관리자가 작업자에게 반려했습니다.');
    });

    overlay.querySelector('#wf-approve')?.addEventListener('click', () => {
        updateTask(task, {
            status: 'final_to_requester',
            assignedTo: task.requester,
            assignedToKey: task.requesterKey || task.requester
        }, '관리자가 검토를 완료했습니다.');
    });

    overlay.querySelector('#wf-close-task')?.addEventListener('click', () => {
        updateTask(task, {
            status: 'closed',
            assignedTo: task.requester,
            assignedToKey: task.requesterKey || task.requester
        }, '요청자가 업무를 종료했습니다.');
    });

    overlay.querySelector('#wf-view-doc')?.addEventListener('click', () => {
        openDeliverableInProjectViewer(task);
    });
}

function docsCacheKey(folderId) {
    return folderId || '__root__';
}

async function fetchDocs(folderId = '') {
    const key = docsCacheKey(folderId);
    const cached = state.docsCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.rows;
    const url = `/api/hubs/${encodeURIComponent(DEFAULT_HUB_ID)}/projects/${encodeURIComponent(DEFAULT_PROJECT_ID)}/contents${folderId ? `?folder_id=${encodeURIComponent(folderId)}` : ''}`;
    const resp = await fetch(url, { credentials: 'same-origin' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const rows = await resp.json();
    state.docsCache.set(key, { rows, expiresAt: Date.now() + CACHE_TTL_MS });
    return rows;
}

function openDocsPicker(onSelect) {
    document.getElementById('example2-doc-picker-modal')?.remove();
    state.docsStack = [{ id: '', name: 'Project Files' }];
    const overlay = document.createElement('div');
    overlay.id = 'example2-doc-picker-modal';
    overlay.style.cssText = 'position:fixed; inset:0; z-index:4300; display:flex; align-items:center; justify-content:center; background:rgba(2,6,23,0.76);';
    overlay.innerHTML = `
        <div style="width:min(760px,calc(100vw - 32px)); height:min(640px,calc(100vh - 48px)); display:flex; flex-direction:column; border:1px solid rgba(56,189,248,0.24); border-radius:8px; background:#0f172a; box-shadow:0 24px 80px rgba(0,0,0,0.45);">
            <div style="height:46px; display:flex; align-items:center; justify-content:space-between; gap:10px; padding:0 16px; border-bottom:1px solid rgba(148,163,184,0.16);">
                <div style="color:#f8fafc; font-size:14px; font-weight:900;"><i class="fas fa-folder-tree" style="color:#38bdf8;"></i> ACC Docs 결과물 선택</div>
                <button id="docs-picker-close" type="button" class="workflow-btn" style="min-width:30px; width:30px;"><i class="fas fa-times"></i></button>
            </div>
            <div style="display:flex; align-items:center; gap:8px; padding:10px 14px; border-bottom:1px solid rgba(148,163,184,0.12);">
                <button id="docs-picker-up" type="button" class="workflow-btn" style="min-width:72px;"><i class="fas fa-arrow-up"></i> 상위</button>
                <div id="docs-picker-path" style="min-width:0; flex:1; color:#94a3b8; font-size:12px; font-weight:800; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"></div>
            </div>
            <div id="docs-picker-list" style="flex:1; min-height:0; overflow:auto; padding:8px 14px;"></div>
        </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#docs-picker-close')?.addEventListener('click', () => overlay.remove());
    overlay.querySelector('#docs-picker-up')?.addEventListener('click', () => {
        if (state.docsStack.length > 1) {
            state.docsStack.pop();
            renderDocsPicker(onSelect);
        }
    });
    renderDocsPicker(onSelect);
}

async function renderDocsPicker(onSelect) {
    const list = document.getElementById('docs-picker-list');
    const path = document.getElementById('docs-picker-path');
    const current = state.docsStack[state.docsStack.length - 1] || { id: '', name: 'Project Files' };
    if (path) path.textContent = state.docsStack.map(item => item.name).join(' / ');
    if (!list) return;
    list.innerHTML = '<div style="height:100%; display:flex; align-items:center; justify-content:center; color:#94a3b8; font-size:12px; font-weight:900;">폴더를 불러오는 중...</div>';
    try {
        const rows = await fetchDocs(current.id);
        const sorted = rows.slice().sort((a, b) => Number(b.folder) - Number(a.folder) || String(a.name || '').localeCompare(String(b.name || ''), 'ko'));
        if (!sorted.length) {
            list.innerHTML = '<div style="padding:24px; text-align:center; color:#94a3b8; font-size:12px; font-weight:900;">이 폴더에는 선택할 항목이 없습니다.</div>';
            return;
        }
        list.innerHTML = sorted.map(item => `
            <button type="button" class="docs-row" data-id="${escapeHtml(item.id)}" data-folder="${item.folder ? '1' : '0'}" data-name="${escapeHtml(item.name)}" data-urn="${escapeHtml(item.urn || '')}">
                <i class="fas ${item.folder ? 'fa-folder' : 'fa-file-lines'}" style="width:18px; color:${item.folder ? '#f59e0b' : '#38bdf8'};"></i>
                <span style="min-width:0; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(item.name || '이름 없음')}</span>
                ${item.folder ? '<i class="fas fa-chevron-right" style="color:#64748b;"></i>' : '<span style="color:#64748b; font-size:11px; font-weight:800;">선택</span>'}
            </button>
        `).join('');
        list.querySelectorAll('.docs-row').forEach(row => {
            row.addEventListener('click', () => {
                const isFolder = row.dataset.folder === '1';
                if (isFolder) {
                    state.docsStack.push({ id: row.dataset.id, name: row.dataset.name });
                    renderDocsPicker(onSelect);
                    return;
                }
                onSelect({
                    id: row.dataset.id,
                    name: row.dataset.name,
                    urn: row.dataset.urn || '',
                    path: state.docsStack.map(item => item.name).join(' / '),
                    selectedAt: new Date().toISOString()
                });
                document.getElementById('example2-doc-picker-modal')?.remove();
            });
        });
    } catch (err) {
        list.innerHTML = `<div style="padding:24px; text-align:center; color:#fca5a5; font-size:12px; font-weight:900;">ACC Docs 폴더를 불러오지 못했습니다.<br>${escapeHtml(err.message)}</div>`;
    }
}

async function loadCurrentUser() {
    try {
        const resp = await fetch('/api/auth/profile', { credentials: 'same-origin' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const profile = await resp.json();
        if (profile?.name) {
            state.currentUser = {
                id: profile.id || profile.email || profile.name,
                name: profile.name,
                email: profile.email || ''
            };
        }
    } catch (err) {
        console.warn('[Example2 Workflow] ACC profile lookup skipped:', err.message);
    }
}

async function loadMembers() {
    const fallback = [
        state.currentUser,
        { id: 'manager', name: '관리자', email: '' },
        { id: 'worker', name: '작업자', email: '' }
    ];
    try {
        const url = `/api/hubs/${encodeURIComponent(DEFAULT_HUB_ID)}/projects/${encodeURIComponent(DEFAULT_PROJECT_ID)}/members`;
        const resp = await fetch(url, { credentials: 'same-origin' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        state.members = uniqueMembers([state.currentUser, ...(data.members || [])]);
        if (!state.members.length) state.members = uniqueMembers(fallback);
    } catch (err) {
        console.warn('[Example2 Workflow] ACC members lookup skipped:', err.message);
        state.members = uniqueMembers(fallback);
    }
}

export async function initExample2CdeTasks() {
    await loadCurrentUser();
    state.tasks = (await readTasks()).map(fillTaskIdentityKeys);
    renderMain();
    loadMembers()
        .then(() => {
            state.tasks = state.tasks.map(fillTaskIdentityKeys);
            writeTasks();
            renderMain();
        })
        .catch(() => renderMain());
}

window.initExample2CdeTasks = initExample2CdeTasks;
