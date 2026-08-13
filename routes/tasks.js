/**
 * Shared task APIs.
 * - /api/tasks keeps the older schedule task shape.
 * - /api/tasks/workflow stores Example2 approval workflow tasks for all browsers.
 */
const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

const DATA_DIR = path.join(__dirname, '../data');
const LEGACY_TASK_FILE = path.join(DATA_DIR, 'tasks.json');
const WORKFLOW_TASK_FILE = path.join(DATA_DIR, 'workflow_tasks.json');

function ensureDataFile(filePath, fallback) {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2), 'utf8');
    }
}

function readJson(filePath, fallback = []) {
    try {
        ensureDataFile(filePath, fallback);
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw || '[]');
        return Array.isArray(parsed) ? parsed : fallback;
    } catch (err) {
        console.error(`[Tasks] Failed to read ${path.basename(filePath)}:`, err.message);
        return fallback;
    }
}

function writeJson(filePath, value) {
    ensureDataFile(filePath, []);
    fs.writeFileSync(filePath, JSON.stringify(value || [], null, 2), 'utf8');
}

function normalizeWorkflowTask(task) {
    const now = new Date().toISOString();
    return {
        ...task,
        id: task.id || `WORK-${Date.now()}`,
        title: String(task.title || '').trim(),
        requester: String(task.requester || '').trim(),
        requesterKey: String(task.requesterKey || '').trim(),
        manager: String(task.manager || '').trim(),
        managerKey: String(task.managerKey || '').trim(),
        worker: String(task.worker || '').trim(),
        workerKey: String(task.workerKey || '').trim(),
        assignedTo: String(task.assignedTo || '').trim(),
        assignedToKey: String(task.assignedToKey || '').trim(),
        updatedAt: task.updatedAt || now,
        createdAt: task.createdAt || now
    };
}

router.get('/workflow', (_req, res) => {
    res.json({ status: 'success', tasks: readJson(WORKFLOW_TASK_FILE, []) });
});

router.put('/workflow', (req, res) => {
    try {
        const tasks = Array.isArray(req.body?.tasks) ? req.body.tasks.map(normalizeWorkflowTask) : [];
        writeJson(WORKFLOW_TASK_FILE, tasks);
        res.json({ status: 'success', tasks });
    } catch (err) {
        console.error('[Tasks] Workflow save failed:', err);
        res.status(500).json({ error: 'Failed to save workflow tasks', message: err.message });
    }
});

router.post('/workflow', (req, res) => {
    try {
        const tasks = readJson(WORKFLOW_TASK_FILE, []);
        const task = normalizeWorkflowTask(req.body || {});
        const existingIdx = tasks.findIndex(item => item.id === task.id);
        if (existingIdx >= 0) tasks[existingIdx] = task;
        else tasks.unshift(task);
        writeJson(WORKFLOW_TASK_FILE, tasks);
        res.json({ status: 'success', task, tasks });
    } catch (err) {
        console.error('[Tasks] Workflow upsert failed:', err);
        res.status(500).json({ error: 'Failed to save workflow task', message: err.message });
    }
});

router.delete('/workflow/:taskId', (req, res) => {
    try {
        const tasks = readJson(WORKFLOW_TASK_FILE, []);
        const next = tasks.filter(task => String(task.id) !== String(req.params.taskId));
        writeJson(WORKFLOW_TASK_FILE, next);
        res.json({ status: 'success', tasks: next });
    } catch (err) {
        console.error('[Tasks] Workflow delete failed:', err);
        res.status(500).json({ error: 'Failed to delete workflow task', message: err.message });
    }
});

router.get('/', (_req, res) => {
    res.json({ status: 'success', tasks: readJson(LEGACY_TASK_FILE, []) });
});

router.post('/', (req, res) => {
    try {
        const { name, planStart, planEnd, actualStart, actualEnd, assignee, progress } = req.body;
        if (!name) return res.status(400).json({ error: 'Task name is required' });

        const tasks = readJson(LEGACY_TASK_FILE, []);
        const taskItem = {
            id: req.body.id || `TASK-${Date.now()}`,
            name,
            planStart: planStart || null,
            planEnd: planEnd || null,
            actualStart: actualStart || null,
            actualEnd: actualEnd || null,
            progress: Number(progress || 0),
            assignee: assignee || '',
            updatedAt: new Date().toISOString()
        };

        const existingIdx = tasks.findIndex(task => task.id === taskItem.id);
        if (existingIdx >= 0) tasks[existingIdx] = taskItem;
        else tasks.push(taskItem);

        writeJson(LEGACY_TASK_FILE, tasks);
        res.json({ status: 'success', task: taskItem });
    } catch (err) {
        console.error('[API /api/tasks Save Error]', err);
        res.status(500).json({ error: 'Failed to save task', message: err.message });
    }
});

module.exports = router;
