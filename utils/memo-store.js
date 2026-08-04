const fs = require('fs');
const path = require('path');
const MEMO_FILE = path.join(__dirname, '../data/memos.json');

/**
 * Read all memos from JSON file
 */
function readMemos() {
    try {
        if (!fs.existsSync(MEMO_FILE)) {
            const dir = path.dirname(MEMO_FILE);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(MEMO_FILE, JSON.stringify({}));
            return {};
        }
        const data = fs.readFileSync(MEMO_FILE, 'utf8');
        return JSON.parse(data || '{}');
    } catch (e) {
        console.error('[MemoStore] Failed to read memos:', e);
        return {};
    }
}

/**
 * Write all memos back to JSON file
 */
function writeMemos(memos) {
    try {
        const dir = path.dirname(MEMO_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(MEMO_FILE, JSON.stringify(memos, null, 2));
    } catch (e) {
        console.error('[MemoStore] Failed to write memos:', e);
    }
}

module.exports = {
    readMemos,
    writeMemos
};
