const express = require('express');
const formidable = require('express-formidable');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const router = express.Router();

const SCHEDULE_FILE_NAME = '정수처리시설_공정표.xlsx';
const SCHEDULE_FILE_PATH = path.resolve(__dirname, '..', 'public', 'data', SCHEDULE_FILE_NAME);
const SCHEDULE_JSON_PATH = path.resolve(__dirname, '..', 'public', 'data', 'construction-schedule.json');
const SCHEDULE_META_PATH = path.resolve(__dirname, '..', 'public', 'data', 'schedule-source-meta.json');

function decodeXml(value = '') {
    return String(value)
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&');
}

function decodeMimeFileName(value = '') {
    const text = String(value || '');
    const match = text.match(/^=\?utf-8\?B\?(.+)\?=$/i);
    if (!match) return text;
    try {
        return Buffer.from(match[1], 'base64').toString('utf8');
    } catch (err) {
        return text;
    }
}

function readZipEntries(buffer) {
    const entries = new Map();
    let offset = buffer.length - 22;
    while (offset >= 0 && buffer.readUInt32LE(offset) !== 0x06054b50) offset -= 1;
    if (offset < 0) throw new Error('엑셀 파일 ZIP 구조를 읽을 수 없습니다.');

    const totalEntries = buffer.readUInt16LE(offset + 10);
    const centralDirectoryOffset = buffer.readUInt32LE(offset + 16);
    let cursor = centralDirectoryOffset;
    for (let i = 0; i < totalEntries; i += 1) {
        if (buffer.readUInt32LE(cursor) !== 0x02014b50) break;
        const method = buffer.readUInt16LE(cursor + 10);
        const compressedSize = buffer.readUInt32LE(cursor + 20);
        const fileNameLength = buffer.readUInt16LE(cursor + 28);
        const extraLength = buffer.readUInt16LE(cursor + 30);
        const commentLength = buffer.readUInt16LE(cursor + 32);
        const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
        const fileName = buffer.slice(cursor + 46, cursor + 46 + fileNameLength).toString('utf8');

        const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
        const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
        const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
        const compressed = buffer.slice(dataStart, dataStart + compressedSize);
        const data = method === 0 ? compressed : zlib.inflateRawSync(compressed);
        entries.set(fileName.replace(/\\/g, '/'), data);

        cursor += 46 + fileNameLength + extraLength + commentLength;
    }
    return entries;
}

function getSharedStrings(entries) {
    const xml = entries.get('xl/sharedStrings.xml')?.toString('utf8') || '';
    return [...xml.matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)].map(match => {
        const parts = [...match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(part => part[1]).join('');
        return decodeXml(parts);
    });
}

function columnNumber(label) {
    return [...label].reduce((acc, ch) => acc * 26 + ch.charCodeAt(0) - 64, 0);
}

function readSheetRows(entries, sheetPath, sharedStrings) {
    const xml = entries.get(sheetPath)?.toString('utf8') || '';
    return [...xml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)].map(rowMatch => {
        const cells = {};
        for (const cellMatch of rowMatch[2].matchAll(/<c[^>]*r="([A-Z]+)(\d+)"([^>]*)>([\s\S]*?)<\/c>/g)) {
            const attrs = cellMatch[3] || '';
            const body = cellMatch[4] || '';
            const raw = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1] || '';
            const inline = (body.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/) || [])[1] || '';
            const value = attrs.includes('t="s"') ? sharedStrings[Number(raw)] : (inline || raw);
            cells[columnNumber(cellMatch[1])] = decodeXml(value || '');
        }
        return cells;
    });
}

function getWorkbookSheetPath(entries, sheetName = '공정표_통합') {
    const workbook = entries.get('xl/workbook.xml')?.toString('utf8') || '';
    const rels = entries.get('xl/_rels/workbook.xml.rels')?.toString('utf8') || '';
    const sheetMatch = [...workbook.matchAll(/<sheet\b([^>]*)\/?>/g)]
        .map(match => match[1])
        .find(attrs => new RegExp(`name="${sheetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`).test(attrs));
    if (!sheetMatch) return 'xl/worksheets/sheet1.xml';
    const rid = (sheetMatch.match(/r:id="([^"]+)"/) || [])[1];
    const relMatch = rid && [...rels.matchAll(/<Relationship\b([^>]*)\/?>/g)]
        .map(match => match[1])
        .find(attrs => attrs.includes(`Id="${rid}"`));
    const target = (relMatch?.match(/Target="([^"]+)"/) || [])[1];
    return target ? `xl/${target.replace(/^\/?xl\//, '')}` : 'xl/worksheets/sheet1.xml';
}

function monthToDate(value, endOfMonth = false) {
    const match = String(value || '').trim().match(/^(\d{4})[-./년\s]*(\d{1,2})/);
    if (!match) return '';
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = endOfMonth ? new Date(year, month, 0).getDate() : 1;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function scheduleZone(category) {
    const text = String(category || '');
    if (text.includes('우선') || text.includes('가시설')) return 'priority';
    return 'extension';
}

function scheduleColor(zone) {
    return zone === 'priority' ? '#eab308' : '#06b6d4';
}

function parseScheduleWorkbook(filePath, sourceName = '') {
    const entries = readZipEntries(fs.readFileSync(filePath));
    const sharedStrings = getSharedStrings(entries);
    const sheetPath = getWorkbookSheetPath(entries);
    const rows = readSheetRows(entries, sheetPath, sharedStrings);
    const headerIndex = rows.findIndex(row => ['구분', 'NO', '공종', '작업내용', '시작', '종료']
        .every((label, idx) => String(row[idx + 1] || '').trim() === label));
    if (headerIndex < 0) throw new Error('공정표_통합 시트의 헤더를 찾지 못했습니다.');

    const items = rows.slice(headerIndex + 1)
        .map((row, index) => {
            const category = String(row[1] || '').trim();
            const no = Number(row[2]);
            const name = String(row[3] || '').trim();
            const description = String(row[4] || '').trim();
            const startMonth = String(row[5] || '').trim();
            const endMonth = String(row[6] || '').trim();
            if (!category || !name || !startMonth || !endMonth) return null;
            const zone = scheduleZone(category);
            return {
                id: `${zone}-${String(index + 1).padStart(2, '0')}`,
                zone,
                category,
                no: Number.isFinite(no) ? no : index + 1,
                name,
                description,
                startMonth,
                endMonth,
                startDate: monthToDate(startMonth, false),
                endDate: monthToDate(endMonth, true),
                color: scheduleColor(zone)
            };
        })
        .filter(Boolean);

    return {
        source: {
            file: SCHEDULE_FILE_NAME,
            originalFileName: sourceName || SCHEDULE_FILE_NAME,
            sheet: '공정표_통합',
            title: String(rows[0]?.[1] || '임시 예정공정표').trim(),
            extractedAt: new Date().toISOString()
        },
        items
    };
}

async function rebuildScheduleJson(sourceName = '') {
    const schedule = parseScheduleWorkbook(SCHEDULE_FILE_PATH, sourceName);
    await fs.promises.writeFile(SCHEDULE_JSON_PATH, `${JSON.stringify(schedule, null, 2)}\n`, 'utf8');
    return schedule;
}

async function readScheduleSourceMeta() {
    try {
        const raw = await fs.promises.readFile(SCHEDULE_META_PATH, 'utf8');
        const meta = JSON.parse(raw);
        if (meta && typeof meta === 'object') return meta;
    } catch (err) {}

    try {
        const raw = await fs.promises.readFile(SCHEDULE_JSON_PATH, 'utf8');
        const schedule = JSON.parse(raw);
        return schedule.source || {};
    } catch (err) {
        return {};
    }
}

async function writeScheduleSourceMeta(meta) {
    await fs.promises.writeFile(SCHEDULE_META_PATH, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
}

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function withBusyRetry(action, label) {
    let lastError;
    for (let attempt = 0; attempt < 6; attempt += 1) {
        try {
            return await action();
        } catch (err) {
            lastError = err;
            if (!['EBUSY', 'EPERM', 'EACCES'].includes(err.code) || attempt === 5) break;
            await wait(120 * (attempt + 1));
        }
    }
    if (lastError) {
        lastError.message = `${label}: ${lastError.message}`;
        throw lastError;
    }
    return null;
}

async function replaceScheduleWorkbook(tempPath) {
    const uploadedBuffer = await withBusyRetry(
        () => fs.promises.readFile(tempPath),
        '업로드 임시 파일을 읽지 못했습니다'
    );
    await withBusyRetry(
        () => fs.promises.writeFile(SCHEDULE_FILE_PATH, uploadedBuffer),
        '기준 엑셀 파일을 저장하지 못했습니다'
    );
}

router.get('/status', async (req, res, next) => {
    try {
        const stat = await fs.promises.stat(SCHEDULE_FILE_PATH);
        const meta = await readScheduleSourceMeta();
        const sourceName = meta.originalFileName || meta.sourceName || SCHEDULE_FILE_NAME;
        res.json({
            ok: true,
            fileName: SCHEDULE_FILE_NAME,
            sourceName,
            size: stat.size,
            updatedAt: stat.mtime.toISOString(),
            url: `/data/${encodeURIComponent(SCHEDULE_FILE_NAME)}`
        });
    } catch (err) {
        next(err);
    }
});

function getUploadedFile(req) {
    const file = req.files?.file || req.files?.['schedule-file'] || Object.values(req.files || {})[0];
    return Array.isArray(file) ? file[0] : file;
}

router.post('/replace', formidable({ maxFileSize: 30 * 1024 * 1024 }), async (req, res, next) => {
    try {
        const file = getUploadedFile(req);
        if (!file) {
            res.status(400).json({ error: '교체할 엑셀 파일을 선택해 주세요.' });
            return;
        }

        const originalName = decodeMimeFileName(file.name || file.originalFilename || file.newFilename || '');
        const mimeType = file.type || file.mimetype || '';
        const looksLikeXlsx = /\.xlsx$/i.test(originalName) || /spreadsheetml\.sheet/i.test(mimeType);
        if (originalName && !looksLikeXlsx) {
            res.status(400).json({ error: '기준 파일은 .xlsx 형식만 업로드할 수 있습니다.' });
            return;
        }

        const tempPath = file.path || file.filepath;
        if (!tempPath) {
            res.status(400).json({ error: '업로드 임시 파일을 찾을 수 없습니다.' });
            return;
        }

        await fs.promises.mkdir(path.dirname(SCHEDULE_FILE_PATH), { recursive: true });
        await replaceScheduleWorkbook(tempPath);
        const schedule = await rebuildScheduleJson(originalName || SCHEDULE_FILE_NAME);

        const stat = await fs.promises.stat(SCHEDULE_FILE_PATH);
        const sourceName = schedule.source.originalFileName;
        await writeScheduleSourceMeta({
            fileName: SCHEDULE_FILE_NAME,
            sourceName,
            size: stat.size,
            updatedAt: stat.mtime.toISOString(),
            itemCount: schedule.items.length
        });

        res.json({
            ok: true,
            fileName: SCHEDULE_FILE_NAME,
            sourceName,
            itemCount: schedule.items.length,
            size: stat.size,
            updatedAt: stat.mtime.toISOString(),
            url: `/data/${encodeURIComponent(SCHEDULE_FILE_NAME)}`
        });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
