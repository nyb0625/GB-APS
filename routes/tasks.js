/**
 * routes/tasks.js — 대시보드 업무 일정 CRUD API
 * actualEnd 미입력 시 null 상태 보존
 */
const express = require('express');
const router = express.Router();

let taskMemoryStore = [];

/**
 * GET /api/tasks
 * 일정 목록 조회
 */
router.get('/', (req, res) => {
    res.json({ status: 'success', tasks: taskMemoryStore });
});

/**
 * POST /api/tasks
 * 일정 추가 / 수정 (actualEnd 미입력 시 null 보존)
 */
router.post('/', (req, res) => {
    try {
        const { name, planStart, planEnd, actualStart, actualEnd, assignee, progress } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Task name is required' });
        }

        const taskItem = {
            id: req.body.id || `TASK-${Date.now()}`,
            name,
            planStart: planStart || null,
            planEnd: planEnd || null,
            actualStart: actualStart || null,
            actualEnd: actualEnd || null, // 빈 값 발생 시 null 보존 (오늘 날짜 덮어쓰기 금지)
            progress: Number(progress || 0),
            assignee: assignee || '',
            updatedAt: new Date().toISOString()
        };

        const existingIdx = taskMemoryStore.findIndex(t => t.id === taskItem.id);
        if (existingIdx >= 0) {
            taskMemoryStore[existingIdx] = taskItem;
        } else {
            taskMemoryStore.push(taskItem);
        }

        res.json({ status: 'success', task: taskItem });
    } catch (err) {
        console.error('[API /api/tasks Save Error]', err);
        res.status(500).json({ error: 'Failed to save task', message: err.message });
    }
});

module.exports = router;
