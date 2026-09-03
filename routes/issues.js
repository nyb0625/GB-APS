/**
 * Issues Routes — 이슈 보고서 PDF 내보내기 및 CRUD
 */
'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
let handlebars;
try { handlebars = require('handlebars'); } catch (e) {}
const { asyncHandler, AppError, rateLimit } = require('../middleware');
const { authRefreshMiddleware, getHubs, getProjects, getIssueContainerInfo } = require('../services/aps.js');
const pdfRateLimit = rateLimit({
    windowMs: 60_000,
    max: 10,
    message: 'PDF 내보내기 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
});
const hwpxRateLimit = rateLimit({
    windowMs: 60_000,
    max: 10,
    message: '한글 내보내기 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
});

const router = express.Router();
const HWPX_TEMPLATE_PATH = path.join(__dirname, '..', 'issue_report_template.hwpx');
const BIM_REVIEW_OPEN_HWPX_TEMPLATE_PATH = path.join(__dirname, '..', 'bim_review_open_template.hwpx');
const BIM_REVIEW_CLOSED_HWPX_TEMPLATE_PATH = path.join(__dirname, '..', 'bim_review_closed_template.hwpx');

const GANGBUK_HUB_ID = process.env.GANGBUK_HUB_ID || 'b.4efd43ab-93fa-4448-918b-091d81dbfd75';
const GANGBUK_PROJECT_ID = process.env.GANGBUK_PROJECT_ID || 'b.d005cd39-4a35-4843-b350-81da491266ef';
const FORMA_ISSUES_CACHE_TTL_MS = Number(process.env.FORMA_ISSUES_CACHE_TTL_MS || 2 * 60 * 1000);
const FORMA_DETAIL_CACHE_TTL_MS = Number(process.env.FORMA_DETAIL_CACHE_TTL_MS || 5 * 60 * 1000);
const PLACEMENT_LOOKUP_CACHE_TTL_MS = Number(process.env.PLACEMENT_LOOKUP_CACHE_TTL_MS || 10 * 60 * 1000);
const ISSUE_SNAPSHOT_CACHE_TTL_MS = Number(process.env.ISSUE_SNAPSHOT_CACHE_TTL_MS || 10 * 60 * 1000);
const formaIssuesCache = new Map();
const formaIssueDetailCache = new Map();
const placementLookupCache = new Map();
const issueSnapshotCache = new Map();
const FALLBACK_USER_NAMES = new Map([
    ['783606258', '현대건설'],
    ['2BTDKKFEB6SF', '기술연구소(AEC) 박도해']
]);

function stripBPrefix(id) {
    return String(id || '').replace(/^b\./, '');
}

function pick(obj, paths, fallback = '') {
    for (const pathKey of paths) {
        const parts = String(pathKey).split('.');
        let cur = obj;
        for (const part of parts) {
            if (cur == null) break;
            cur = cur[part];
        }
        if (cur !== undefined && cur !== null && String(cur).trim() !== '') return cur;
    }
    return fallback;
}

function deepFindByKey(obj, keys) {
    const wanted = new Set(keys.map(k => String(k).toLowerCase()));
    const seen = new Set();
    function walk(value) {
        if (!value || typeof value !== 'object' || seen.has(value)) return '';
        seen.add(value);
        if (Array.isArray(value)) {
            for (const item of value) {
                const found = walk(item);
                if (found) return found;
            }
            return '';
        }
        for (const [key, val] of Object.entries(value)) {
            if (wanted.has(String(key).toLowerCase()) && val != null && String(val).trim() !== '') return val;
        }
        for (const val of Object.values(value)) {
            const found = walk(val);
            if (found) return found;
        }
        return '';
    }
    return walk(obj);
}

function getCustomValue(issue, names) {
    const attrs = pick(issue, ['customAttributes', 'attributes.customAttributes', 'custom_attributes'], []);
    const candidates = Array.isArray(attrs) ? attrs : Object.entries(attrs || {}).map(([title, value]) => ({ title, name: title, value }));
    const lowered = names.map(n => String(n).toLowerCase());
    for (const item of candidates) {
        const title = String(item.title || item.name || item.key || item.displayName || '').toLowerCase();
        if (lowered.includes(title)) return item.value ?? item.text ?? item.displayValue ?? '';
    }
    return '';
}

function xmlEscape(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function attrEscape(value) {
    return xmlEscape(value);
}

function stripVersionInfo(value) {
    return String(value || '')
        .split(/\r?\n/)
        .filter(line => !isVersionOnlyLine(line))
        .map(line => line
            .replace(/(?:^|\s)(?:이전|현재|작성\s*당시|직전\s*작성|변경\s*전|변경\s*후)?\s*(?:버전|version|ver\.?|v)\s*[:=\-]?\s*\d+(?:\.\d+)?\s*(?:→|->|~|\/|,)?\s*(?:v|ver\.?|version|버전)?\s*\d*(?:\.\d+)?/ig, ' ')
            .replace(/\b[A-Za-z]{1,4}\s*[-:]\s*V?\s*\.?\s*\d+\b/g, ' ')
            .replace(/\bV\s*\.?\s*\d+\s*\.?\b/ig, ' ')
            .replace(/^[\s,;/|~→-]+$/g, '')
            .replace(/\s{2,}/g, ' ')
            .trim())
        .filter(Boolean)
        .join('\n')
        .trim();
}

function stripLeadingBulletMarkers(value) {
    return String(value || '')
        .split(/\r?\n/)
        .map(line => line.replace(/^\s*-\s*/, '').trimEnd())
        .join('\n')
        .trim();
}

function normalizeHwpxDescriptionLine(line) {
    return String(line || '')
        .replace(/\u00a0/g, ' ')
        .replace(/[`*_]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function isVersionOnlyLine(line) {
    const cleaned = normalizeHwpxDescriptionLine(line);
    return !cleaned ||
        /^(?:버전|version|ver\.?|v)\s*[:=\-]?\s*\d+(?:\.\d+)?\.?$/i.test(cleaned) ||
        /^(?:[A-Za-z]{1,6}\s*[-_:]?\s*(?:v|ver\.?|version)?\s*\d+(?:\.\d+)?\s*,?\s*)+$/i.test(cleaned) ||
        /^(?:[A-Za-z0-9가-힣_()\/\s]+?\s*[-_:]?\s*(?:v|ver\.?|version)\s*\d+(?:\.\d+)?\s*,?\s*)+$/i.test(cleaned);
}

function parseUpdateIssueDescription(issue) {
    const source = issue.description || issue.mainChange || issue.desc || '';
    const result = { reason: '', changes: '' };
    const changes = [];

    String(source || '').split(/\r?\n/).forEach(rawLine => {
        if (isVersionOnlyLine(rawLine)) return;
        let line = normalizeHwpxDescriptionLine(rawLine);
        if (!line) return;

        const bulletMatch = line.match(/^(?:[-*•]\s*)?(?:\\?-+\s*)(.+)$/);
        if (bulletMatch) {
            const item = normalizeHwpxDescriptionLine(bulletMatch[1]);
            if (item) changes.push(item);
            return;
        }

        const withoutVersion = stripVersionInfo(line);
        if (!withoutVersion) return;
        if (!result.reason) result.reason = withoutVersion;
    });

    result.changes = changes.join('\n');
    return result;
}

const CRC32_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
        let c = i;
        for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        table[i] = c >>> 0;
    }
    return table;
})();

function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { time, day };
}

function createZip(entries) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    const { time, day } = dosDateTime();
    for (const entry of entries) {
        const name = Buffer.from(entry.name, 'utf8');
        const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8');
        const crc = crc32(data);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0x0800, 6);
        local.writeUInt16LE(0, 8);
        local.writeUInt16LE(time, 10);
        local.writeUInt16LE(day, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(name.length, 26);
        local.writeUInt16LE(0, 28);
        localParts.push(local, name, data);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0x0800, 8);
        central.writeUInt16LE(0, 10);
        central.writeUInt16LE(time, 12);
        central.writeUInt16LE(day, 14);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(data.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(name.length, 28);
        central.writeUInt16LE(0, 30);
        central.writeUInt16LE(0, 32);
        central.writeUInt16LE(0, 34);
        central.writeUInt16LE(0, 36);
        central.writeUInt32LE(0, 38);
        central.writeUInt32LE(offset, 42);
        centralParts.push(central, name);
        offset += local.length + name.length + data.length;
    }
    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(0, 20);
    return Buffer.concat([...localParts, ...centralParts, end]);
}

function contentTypeToImageExt(contentType = '') {
    const type = String(contentType || '').toLowerCase();
    if (type.includes('png')) return 'png';
    if (type.includes('jpg') || type.includes('jpeg')) return 'jpg';
    return '';
}

function imageExtFromBuffer(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 12) return '';
    if (buffer[0] === 0x89 && buffer.slice(1, 4).toString('ascii') === 'PNG') return 'png';
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
    return '';
}

function getImageSize(buffer, ext = '') {
    const type = String(ext || '').toLowerCase();
    if ((type === 'png' || buffer.slice(1, 4).toString('ascii') === 'PNG') && buffer.length >= 24) {
        return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if ((type === 'jpg' || type === 'jpeg' || (buffer[0] === 0xff && buffer[1] === 0xd8)) && buffer.length > 4) {
        let offset = 2;
        while (offset < buffer.length - 9) {
            if (buffer[offset] !== 0xff) {
                offset += 1;
                continue;
            }
            const marker = buffer[offset + 1];
            const length = buffer.readUInt16BE(offset + 2);
            if (marker >= 0xc0 && marker <= 0xc3) {
                return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
            }
            offset += 2 + length;
        }
    }
    return { width: 1200, height: 900 };
}

function dataUrlToImage(dataUrl) {
    const match = String(dataUrl || '').match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
    if (!match) return null;
    const buffer = Buffer.from(match[2], 'base64');
    const ext = contentTypeToImageExt(match[1]) || imageExtFromBuffer(buffer);
    if (!ext) return null;
    return {
        buffer,
        contentType: ext === 'png' ? 'image/png' : 'image/jpeg',
        ext
    };
}

function readZipEntries(buffer) {
    const eocdSig = 0x06054b50;
    let eocd = -1;
    for (let i = buffer.length - 22; i >= 0; i -= 1) {
        if (buffer.readUInt32LE(i) === eocdSig) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0) throw new Error('HWPX ZIP 구조를 읽을 수 없습니다.');
    const count = buffer.readUInt16LE(eocd + 10);
    const centralOffset = buffer.readUInt32LE(eocd + 16);
    const entries = [];
    let ptr = centralOffset;
    for (let i = 0; i < count; i += 1) {
        if (buffer.readUInt32LE(ptr) !== 0x02014b50) throw new Error('HWPX 중앙 디렉터리를 읽을 수 없습니다.');
        const method = buffer.readUInt16LE(ptr + 10);
        const compressedSize = buffer.readUInt32LE(ptr + 20);
        const uncompressedSize = buffer.readUInt32LE(ptr + 24);
        const nameLen = buffer.readUInt16LE(ptr + 28);
        const extraLen = buffer.readUInt16LE(ptr + 30);
        const commentLen = buffer.readUInt16LE(ptr + 32);
        const localOffset = buffer.readUInt32LE(ptr + 42);
        const name = buffer.slice(ptr + 46, ptr + 46 + nameLen).toString('utf8');
        const localNameLen = buffer.readUInt16LE(localOffset + 26);
        const localExtraLen = buffer.readUInt16LE(localOffset + 28);
        const dataStart = localOffset + 30 + localNameLen + localExtraLen;
        const compressed = buffer.slice(dataStart, dataStart + compressedSize);
        let data;
        if (method === 0) {
            data = compressed;
        } else if (method === 8) {
            data = require('zlib').inflateRawSync(compressed);
        } else {
            throw new Error(`지원하지 않는 HWPX 압축 방식입니다: ${method}`);
        }
        if (data.length !== uncompressedSize) throw new Error(`HWPX 엔트리 크기가 맞지 않습니다: ${name}`);
        entries.push({ name, data });
        ptr += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
}

function hpPara(text, style = 0) {
    const lines = String(text || '').split(/\r?\n/);
    return lines.map(line =>
        `<hp:p id="0" paraPrIDRef="0" styleIDRef="0">` +
        `<hp:run charPrIDRef="0"><hp:t>${xmlEscape(line || ' ')}</hp:t></hp:run>` +
        `</hp:p>`
    ).join('');
}

function hwpxTextRun(text, charPrIDRef = '5') {
    return `<hp:run charPrIDRef="${charPrIDRef}"><hp:t>${xmlEscape(text || ' ')}</hp:t></hp:run>`;
}

function findMatchingTagEnd(xml, startIndex, tagName) {
    const tagRe = new RegExp(`<${tagName}(?:\\s|>)|<\\/${tagName}>`, 'g');
    tagRe.lastIndex = startIndex;
    let depth = 0;
    let match;
    while ((match = tagRe.exec(xml))) {
        if (match[0].startsWith('</')) {
            depth -= 1;
            if (depth === 0) return tagRe.lastIndex;
        } else {
            depth += 1;
        }
    }
    return -1;
}

function findMatchingHpParagraphEnd(xml, startIndex) {
    return findMatchingTagEnd(xml, startIndex, 'hp:p');
}

function getTemplateTableParagraph(sectionXml) {
    const tableIndex = sectionXml.indexOf('<hp:tbl');
    if (tableIndex < 0) return null;
    const start = sectionXml.lastIndexOf('<hp:p', tableIndex);
    const end = findMatchingHpParagraphEnd(sectionXml, start);
    if (start < 0 || end < 0) return null;
    return {
        prefix: sectionXml.slice(0, start),
        tableParagraph: sectionXml.slice(start, end),
        suffix: sectionXml.slice(end)
    };
}

function buildHwpxCellParagraphsFromTemplate(emptyParagraphXml, value) {
    const lines = String(value || ' ')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
    const safeLines = lines.length ? lines : [' '];
    const runMatch = emptyParagraphXml.match(/<hp:run\s+charPrIDRef="([^"]+)"\s*\/>/);
    const charPrIDRef = runMatch ? runMatch[1] : '5';
    return safeLines.map(line => emptyParagraphXml.replace(/<hp:run\s+charPrIDRef="[^"]+"\s*\/>/, hwpxTextRun(line, charPrIDRef))).join('');
}

function makeHwpxPicXml(image, widthHu, heightHu, nativeWidthHu, nativeHeightHu) {
    const safeId = attrEscape(image.id);
    const picId = 1000000000 + image.index;
    const centerX = Math.round(widthHu / 2);
    const centerY = Math.round(heightHu / 2);
    const orgWidth = nativeWidthHu || widthHu;
    const orgHeight = nativeHeightHu || heightHu;
    const scaleX = orgWidth ? (widthHu / orgWidth).toFixed(6) : '1';
    const scaleY = orgHeight ? (heightHu / orgHeight).toFixed(6) : '1';
    return `<hp:run charPrIDRef="5"><hp:pic id="${picId}" zOrder="0" numberingType="PICTURE" textWrap="TOP_AND_BOTTOM" textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" href="" groupLevel="0" instid="${picId}" reverse="0">` +
        `<hp:offset x="0" y="0"/>` +
        `<hp:orgSz width="${orgWidth}" height="${orgHeight}"/>` +
        `<hp:curSz width="${widthHu}" height="${heightHu}"/>` +
        `<hp:flip horizontal="0" vertical="0"/>` +
        `<hp:rotationInfo angle="0" centerX="${centerX}" centerY="${centerY}" rotateimage="0"/>` +
        `<hp:renderingInfo><hc:transMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/><hc:scaMatrix e1="${scaleX}" e2="0" e3="0" e4="0" e5="${scaleY}" e6="0"/><hc:rotMatrix e1="1" e2="0" e3="0" e4="0" e5="1" e6="0"/></hp:renderingInfo>` +
        `<hc:img binaryItemIDRef="${safeId}" bright="0" contrast="0" effect="REAL_PIC" alpha="0"/>` +
        `<hp:imgRect><hc:pt0 x="0" y="0"/><hc:pt1 x="${orgWidth}" y="0"/><hc:pt2 x="${orgWidth}" y="${orgHeight}"/><hc:pt3 x="0" y="${orgHeight}"/></hp:imgRect>` +
        `<hp:imgClip left="0" right="${orgWidth}" top="0" bottom="${orgHeight}"/>` +
        `<hp:inMargin left="0" right="0" top="0" bottom="0"/>` +
        `<hp:imgDim dimwidth="${orgWidth}" dimheight="${orgHeight}"/>` +
        `<hp:effects/>` +
        `<hp:sz width="${widthHu}" widthRelTo="ABSOLUTE" height="${heightHu}" heightRelTo="ABSOLUTE" protect="0"/>` +
        `<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0" vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="CENTER" vertOffset="0" horzOffset="0"/>` +
        `<hp:outMargin left="0" right="0" top="0" bottom="0"/>` +
        `</hp:pic><hp:t/></hp:run>`;
}

function buildHwpxImageParagraphFromTemplate(emptyParagraphXml, image, cellWidth = 23101, cellHeight = 13531) {
    if (!image) return emptyParagraphXml;
    const size = getImageSize(image.buffer, image.ext);
    const maxWidth = Math.max(1000, Number(cellWidth) - 800);
    const maxHeight = Math.max(1000, Number(cellHeight) - 800);
    const scale = Math.min(maxWidth / size.width, maxHeight / size.height);
    const widthHu = Math.max(1000, Math.round(size.width * scale));
    const heightHu = Math.max(1000, Math.round(size.height * scale));
    const nativeWidthHu = Math.max(1000, Math.round(size.width * 75));
    const nativeHeightHu = Math.max(1000, Math.round(size.height * 75));
    return emptyParagraphXml.replace(/<hp:run\s+charPrIDRef="[^"]+"\s*\/>/, makeHwpxPicXml(image, widthHu, heightHu, nativeWidthHu, nativeHeightHu));
}

function updateCellsInRowHeight(blockXml, rowAddr, minHeight) {
    const rowToken = `rowAddr="${rowAddr}"`;
    let output = '';
    let cursor = 0;
    let searchFrom = 0;
    while (searchFrom < blockXml.length) {
        const addrIndex = blockXml.indexOf(rowToken, searchFrom);
        if (addrIndex < 0) break;
        const cellStart = blockXml.lastIndexOf('<hp:tc', addrIndex);
        const cellEnd = findMatchingTagEnd(blockXml, cellStart, 'hp:tc');
        if (cellStart < 0 || cellEnd < 0 || cellStart < cursor) {
            searchFrom = addrIndex + rowToken.length;
            continue;
        }
        const cellXml = blockXml.slice(cellStart, cellEnd);
        const nextCellXml = cellXml.replace(/(<hp:cellSz\s+width="[^"]+"\s+height=")(\d+)(")/, (_match, prefix, value, suffix) => {
            return `${prefix}${Math.max(Number(value) || 0, minHeight)}${suffix}`;
        });
        output += blockXml.slice(cursor, cellStart) + nextCellXml;
        cursor = cellEnd;
        searchFrom = cellEnd;
    }
    return cursor ? output + blockXml.slice(cursor) : blockXml;
}

function updateCellImageByAddress(blockXml, rowAddr, colAddr, image) {
    if (!image) return blockXml;
    const addrPattern = `<hp:cellAddr colAddr="${colAddr}" rowAddr="${rowAddr}"`;
    const addrIndex = blockXml.indexOf(addrPattern);
    if (addrIndex < 0) return blockXml;
    const cellStart = blockXml.lastIndexOf('<hp:tc', addrIndex);
    const cellEnd = findMatchingTagEnd(blockXml, cellStart, 'hp:tc');
    if (cellStart < 0 || cellEnd < 0) return blockXml;
    const cellXml = blockXml.slice(cellStart, cellEnd);
    const emptyRunIndex = cellXml.indexOf('<hp:run charPrIDRef="5"/>');
    if (emptyRunIndex < 0) return blockXml;
    const paraStart = cellXml.lastIndexOf('<hp:p', emptyRunIndex);
    const paraEnd = findMatchingHpParagraphEnd(cellXml, paraStart);
    if (paraStart < 0 || paraEnd < 0) return blockXml;
    const cellSize = cellXml.match(/<hp:cellSz width="([^"]+)" height="([^"]+)"/);
    const paragraphXml = cellXml.slice(paraStart, paraEnd);
    const replacement = buildHwpxImageParagraphFromTemplate(paragraphXml, image, cellSize?.[1], cellSize?.[2]);
    const nextCellXml = cellXml.slice(0, paraStart) + replacement + cellXml.slice(paraEnd);
    return blockXml.slice(0, cellStart) + nextCellXml + blockXml.slice(cellEnd);
}

function buildHwpxImageParagraphsFromTemplate(emptyParagraphXml, images, cellWidth = 23101, cellHeight = 13531) {
    const list = Array.isArray(images) ? images.filter(Boolean).slice(0, 2) : [];
    if (!list.length) return emptyParagraphXml;
    const rowHeight = Math.max(1000, Math.floor(Number(cellHeight) || 13531));
    const eachHeight = Math.max(1000, Math.floor((rowHeight - (list.length - 1) * 300) / list.length));
    return list.map(image => {
        const size = getImageSize(image.buffer, image.ext);
        const maxWidth = Math.max(1000, Number(cellWidth) - 800);
        const maxHeight = Math.max(1000, eachHeight - 300);
        const scale = Math.min(maxWidth / size.width, maxHeight / size.height);
        const widthHu = Math.max(1000, Math.round(size.width * scale));
        const heightHu = Math.max(1000, Math.round(size.height * scale));
        const nativeWidthHu = Math.max(1000, Math.round(size.width * 75));
        const nativeHeightHu = Math.max(1000, Math.round(size.height * 75));
        return emptyParagraphXml.replace(/<hp:run\s+charPrIDRef="[^"]+"\s*\/>/, makeHwpxPicXml(image, widthHu, heightHu, nativeWidthHu, nativeHeightHu));
    }).join('');
}

function updateCellImagesByAddress(blockXml, rowAddr, colAddr, images) {
    const list = Array.isArray(images) ? images.filter(Boolean).slice(0, 2) : [];
    if (!list.length) return blockXml;
    const addrPattern = `<hp:cellAddr colAddr="${colAddr}" rowAddr="${rowAddr}"`;
    const addrIndex = blockXml.indexOf(addrPattern);
    if (addrIndex < 0) return blockXml;
    const cellStart = blockXml.lastIndexOf('<hp:tc', addrIndex);
    const cellEnd = findMatchingTagEnd(blockXml, cellStart, 'hp:tc');
    if (cellStart < 0 || cellEnd < 0) return blockXml;
    const cellXml = blockXml.slice(cellStart, cellEnd);
    const emptyRunIndex = cellXml.indexOf('<hp:run charPrIDRef="5"/>');
    if (emptyRunIndex < 0) return blockXml;
    const paraStart = cellXml.lastIndexOf('<hp:p', emptyRunIndex);
    const paraEnd = findMatchingHpParagraphEnd(cellXml, paraStart);
    if (paraStart < 0 || paraEnd < 0) return blockXml;
    const cellSize = cellXml.match(/<hp:cellSz width="([^"]+)" height="([^"]+)"/);
    const paragraphXml = cellXml.slice(paraStart, paraEnd);
    const replacement = buildHwpxImageParagraphsFromTemplate(paragraphXml, list, cellSize?.[1], cellSize?.[2]);
    const nextCellXml = cellXml.slice(0, paraStart) + replacement + cellXml.slice(paraEnd);
    return blockXml.slice(0, cellStart) + nextCellXml + blockXml.slice(cellEnd);
}

function updateCellTextByAddress(blockXml, rowAddr, colAddr, value) {
    const addrPattern = `<hp:cellAddr colAddr="${colAddr}" rowAddr="${rowAddr}"`;
    const addrIndex = blockXml.indexOf(addrPattern);
    if (addrIndex < 0) return blockXml;
    const cellStart = blockXml.lastIndexOf('<hp:tc', addrIndex);
    const cellEnd = findMatchingTagEnd(blockXml, cellStart, 'hp:tc');
    if (cellStart < 0 || cellEnd < 0) return blockXml;
    const cellXml = blockXml.slice(cellStart, cellEnd);
    const emptyRun = '<hp:run charPrIDRef="5"/>';
    const emptyRunIndex = cellXml.indexOf(emptyRun);
    if (emptyRunIndex < 0) return blockXml;
    const paraStart = cellXml.lastIndexOf('<hp:p', emptyRunIndex);
    const paraEnd = findMatchingHpParagraphEnd(cellXml, paraStart);
    if (paraStart < 0 || paraEnd < 0) return blockXml;
    const paragraphXml = cellXml.slice(paraStart, paraEnd);
    const replacement = buildHwpxCellParagraphsFromTemplate(paragraphXml, value || ' ');
    const nextCellXml = cellXml.slice(0, paraStart) + replacement + cellXml.slice(paraEnd);
    return blockXml.slice(0, cellStart) + nextCellXml + blockXml.slice(cellEnd);
}

function replaceHwpxCellLabel(blockXml, fromLabel, toLabel) {
    return String(blockXml || '').replace(`<hp:t>${fromLabel}</hp:t>`, `<hp:t>${toLabel}</hp:t>`);
}

function uniquifyHwpxBlockIds(blockXml, index) {
    let seq = (index + 1) * 100000;
    const nextId = () => String(1100000000 + seq++);
    return String(blockXml || '')
        .replace(/(<hp:p\b[^>]*?\bid=")([^"]*)(")/g, (_match, prefix, _value, suffix) => `${prefix}${nextId()}${suffix}`)
        .replace(/(<hp:tbl\b[^>]*?\bid=")(\d+)(")/g, (_match, prefix, _value, suffix) => `${prefix}${nextId()}${suffix}`)
        .replace(/(\bctrlid=")(\d+)(")/g, (_match, prefix, _value, suffix) => `${prefix}${nextId()}${suffix}`)
        .replace(/(\binstid=")(\d+)(")/g, (_match, prefix, _value, suffix) => `${prefix}${nextId()}${suffix}`);
}

function updateFirstEmptyCellAfterLabel(sectionXml, label, value) {
    const labelIndex = sectionXml.indexOf(`<hp:t>${label}</hp:t>`);
    if (labelIndex < 0) return sectionXml;
    const emptyRun = '<hp:run charPrIDRef="5"/>';
    const emptyIndex = sectionXml.indexOf(emptyRun, labelIndex);
    if (emptyIndex < 0) return sectionXml;
    return sectionXml.slice(0, emptyIndex) + hwpxTextRun(value) + sectionXml.slice(emptyIndex + emptyRun.length);
}

function updateFirstEmptyCellParagraphAfterLabel(sectionXml, label, value) {
    const labelIndex = sectionXml.indexOf(`<hp:t>${label}</hp:t>`);
    if (labelIndex < 0) return sectionXml;
    const emptyRun = '<hp:run charPrIDRef="5"/>';
    const emptyIndex = sectionXml.indexOf(emptyRun, labelIndex);
    if (emptyIndex < 0) return sectionXml;
    const paraStart = sectionXml.lastIndexOf('<hp:p', emptyIndex);
    const paraEnd = findMatchingHpParagraphEnd(sectionXml, paraStart);
    if (paraStart < 0 || paraEnd < 0) return updateFirstEmptyCellAfterLabel(sectionXml, label, value);
    const paragraphXml = sectionXml.slice(paraStart, paraEnd);
    const replacement = buildHwpxCellParagraphsFromTemplate(paragraphXml, value);
    return sectionXml.slice(0, paraStart) + replacement + sectionXml.slice(paraEnd);
}

function removeTableRowContainingLabel(sectionXml, label) {
    const labelIndex = sectionXml.indexOf(`<hp:t>${label}</hp:t>`);
    if (labelIndex < 0) return sectionXml;
    const rowStart = sectionXml.lastIndexOf('<hp:tr', labelIndex);
    const rowEnd = findMatchingTagEnd(sectionXml, rowStart, 'hp:tr');
    if (rowStart < 0 || rowEnd < 0) return sectionXml;
    return removeTableRowAtRange(sectionXml, rowStart, rowEnd);
}

function removeTableRowByCellAddress(sectionXml, rowAddr) {
    const addrIndex = sectionXml.indexOf(`rowAddr="${rowAddr}"`);
    if (addrIndex < 0) return sectionXml;
    const rowStart = sectionXml.lastIndexOf('<hp:tr', addrIndex);
    const rowEnd = findMatchingTagEnd(sectionXml, rowStart, 'hp:tr');
    if (rowStart < 0 || rowEnd < 0) return sectionXml;
    return removeTableRowAtRange(sectionXml, rowStart, rowEnd);
}

function removeTableRowAtRange(sectionXml, rowStart, rowEnd) {
    let nextXml = sectionXml.slice(0, rowStart) + sectionXml.slice(rowEnd);
    const tblStart = sectionXml.lastIndexOf('<hp:tbl', rowStart);
    if (tblStart >= 0) {
        const tblOpenEnd = nextXml.indexOf('>', tblStart);
        if (tblOpenEnd > tblStart) {
            const tblOpen = nextXml.slice(tblStart, tblOpenEnd + 1);
            nextXml = nextXml.slice(0, tblStart) +
                tblOpen.replace(/rowCnt="(\d+)"/, (_match, value) => `rowCnt="${Math.max(0, Number(value) - 1)}"`) +
                nextXml.slice(tblOpenEnd + 1);
        }
    }
    return nextXml;
}

function getIssueSpecialNote(issue) {
    return String(
        issue?.specialNote ||
        issue?.hwpxSpecialNote ||
        issue?.reportSpecialNote ||
        ''
    ).trim();
}

function imageFromIssueDataUrl(issue, keys) {
    for (const key of keys) {
        const value = issue && issue[key];
        if (typeof value === 'string' && value.startsWith('data:image/')) {
            const image = dataUrlToImage(value);
            if (image) return image;
            console.warn('[HWPX Export] unsupported data URL image skipped:', key, String(value).slice(0, 32));
        }
    }
    return null;
}

async function resolveIssueExportImages(issue, index, token) {
    const images = { thumbnail: null, before: null, after: null };
    const baseIndex = index * 3;
    const thumbnailData = imageFromIssueDataUrl(issue, ['thumbnailImage', 'issueThumbnailImage']);
    const beforeData = imageFromIssueDataUrl(issue, ['beforeImage', 'imageBefore', 'imgBefore']);
    const afterData = imageFromIssueDataUrl(issue, ['afterImage', 'imageAfter', 'imgAfter']);
    if (thumbnailData) {
        thumbnailData.id = `image${baseIndex + 1}`;
        thumbnailData.index = baseIndex + 1;
        thumbnailData.name = `BinData/${thumbnailData.id}.${thumbnailData.ext}`;
        images.thumbnail = thumbnailData;
    }
    if (beforeData) {
        beforeData.id = `image${baseIndex + 2}`;
        beforeData.index = baseIndex + 2;
        beforeData.name = `BinData/${beforeData.id}.${beforeData.ext}`;
        images.before = beforeData;
    }
    if (afterData) {
        afterData.id = `image${baseIndex + 3}`;
        afterData.index = baseIndex + 3;
        afterData.name = `BinData/${afterData.id}.${afterData.ext}`;
        images.after = afterData;
    }
    const thumbnailSnapshotUrn = issue.thumbnailSnapshotUrn || issue.snapshotUrn || issue.thumbnailUrn;
    if (!images.thumbnail && thumbnailSnapshotUrn && token) {
        try {
            const fetched = await fetchSnapshotImage(thumbnailSnapshotUrn, token);
            const ext = contentTypeToImageExt(fetched.contentType) || imageExtFromBuffer(fetched.buffer);
            if (!ext) throw new Error(`지원하지 않는 이미지 형식입니다: ${fetched.contentType || 'unknown'}`);
            images.thumbnail = {
                id: `image${baseIndex + 1}`,
                index: baseIndex + 1,
                name: `BinData/image${baseIndex + 1}.${ext}`,
                ext,
                contentType: ext === 'png' ? 'image/png' : 'image/jpeg',
                buffer: fetched.buffer
            };
        } catch (err) {
            console.warn('[HWPX Export] issue thumbnail image skipped:', err.message);
        }
    }
    if (images.thumbnail || images.before || images.after) {
        console.log('[HWPX Export] issue image resolved:', {
            index: index + 1,
            thumbnail: !!images.thumbnail,
            before: !!images.before,
            after: !!images.after,
            thumbnailSnapshotUrn: !!thumbnailSnapshotUrn
        });
    } else {
        console.warn('[HWPX Export] issue image not found:', {
            index: index + 1,
            thumbnailSnapshotUrn: !!thumbnailSnapshotUrn,
            hasToken: !!token
        });
    }
    return images;
}

function isBimReviewIssue(issue) {
    const typeText = [
        issue?.exportIssueType,
        issue?.type,
        issue?.issueType,
        issue?.category,
        issue?.typePath,
        issue?.workScheduleCategory,
        issue?.kind,
        issue?.label
    ].map(value => {
        if (!value) return '';
        if (typeof value === 'object') return value.name || value.text || value.title || '';
        return String(value);
    }).join(' ').toLowerCase();
    return typeText.includes('간섭') || typeText.includes('clash') || typeText.includes('collision') ||
        typeText.includes('설계') || typeText.includes('design');
}

function isClosedIssueStatus(issue) {
    const statusKey = String(issue?.status || issue?.state || '').toLowerCase().replace(/[\s_-]+/g, '');
    return statusKey.includes('종료') || statusKey.includes('완료') ||
        statusKey.includes('closed') || statusKey.includes('complete') ||
        statusKey.includes('completed') || statusKey.includes('done');
}

function getIssueReviewPlan(issue) {
    return String(
        issue?.reviewPlan ||
        issue?.bimReviewPlan ||
        issue?.hwpxReviewPlan ||
        issue?.resolutionPlan ||
        ''
    ).trim();
}

function getIssueBimReviewImageCaption(issue) {
    return String(
        issue?.bimReviewImageCaption ||
        issue?.reviewImageCaption ||
        issue?.bimReviewCaption ||
        issue?.hwpxBimReviewImageCaption ||
        ''
    ).trim();
}

function getIssueResultImageCaption(issue) {
    return String(
        issue?.resultImageCaption ||
        issue?.reflectionResultImageCaption ||
        issue?.bimResultImageCaption ||
        issue?.hwpxResultImageCaption ||
        ''
    ).trim();
}

function normalizeReviewImageList(issue, keys) {
    const result = [];
    for (const key of keys) {
        const value = issue && issue[key];
        const values = Array.isArray(value) ? value : (value ? [value] : []);
        for (const item of values) {
            if (typeof item !== 'string' || !item.startsWith('data:image/')) continue;
            const image = dataUrlToImage(item);
            if (image) result.push(image);
            if (result.length >= 2) return result;
        }
    }
    return result;
}

async function resolveBimReviewIssueImages(issue, index) {
    const baseIndex = index * 4;
    const reviewImages = normalizeReviewImageList(issue, ['bimReviewImages', 'reviewImages', 'bimReviewImage'])
        .map((image, imageIndex) => ({
            ...image,
            id: `reviewImage${baseIndex + imageIndex + 1}`,
            index: baseIndex + imageIndex + 1,
            name: `BinData/reviewImage${baseIndex + imageIndex + 1}.${image.ext}`
        }));
    const resultImages = normalizeReviewImageList(issue, ['resultImages', 'reflectionResultImages', 'bimResultImages', 'resultImage'])
        .map((image, imageIndex) => ({
            ...image,
            id: `reviewImage${baseIndex + reviewImages.length + imageIndex + 1}`,
            index: baseIndex + reviewImages.length + imageIndex + 1,
            name: `BinData/reviewImage${baseIndex + reviewImages.length + imageIndex + 1}.${image.ext}`
        }));
    return { reviewImages, resultImages };
}

function addHwpxImageManifestItems(contentHpf, images) {
    const items = images
        .filter(Boolean)
        .filter(image => !contentHpf.includes(`id="${attrEscape(image.id)}"`))
        .map(image => `<opf:item id="${attrEscape(image.id)}" href="${attrEscape(image.name)}" media-type="${attrEscape(image.contentType || `image/${image.ext}`)}" isEmbeded="1"/>`)
        .join('');
    if (!items) return contentHpf;
    return contentHpf.replace('</opf:manifest>', `${items}</opf:manifest>`);
}

function addHwpxHeaderBinDataItems(headerXml, images) {
    return headerXml;
}

function addHwpxPackageManifestImageEntries(manifestXml, images) {
    const items = images
        .filter(Boolean)
        .filter(image => !manifestXml.includes(`full-path="${attrEscape(image.name)}"`))
        .map(image => `<file-entry full-path="${attrEscape(image.name)}" media-type="${attrEscape(image.contentType || `image/${image.ext}`)}"/>`)
        .join('');
    if (!items) return manifestXml;
    return manifestXml.replace('</manifest>', `${items}</manifest>`);
}

function addHwpxImageEntries(entries, images) {
    const existing = new Set(entries.map(entry => entry.name));
    images.filter(Boolean).forEach(image => {
        if (!existing.has(image.name)) {
            entries.push({ name: image.name, data: image.buffer });
            existing.add(image.name);
        }
    });
    return entries;
}

function setHwpxHeaderSectionCount(headerXml, sectionCount) {
    if (!headerXml || !sectionCount) return headerXml;
    return headerXml.replace(/(<hh:head\b[^>]*\bsecCnt=")(\d+)(")/, (_match, prefix, _value, suffix) => {
        return `${prefix}${sectionCount}${suffix}`;
    });
}

function setHwpxContentSections(contentHpf, sectionCount) {
    if (!contentHpf || sectionCount <= 1) return contentHpf;
    let next = contentHpf;
    const manifestItems = [];
    const spineItems = [];
    for (let i = 1; i < sectionCount; i += 1) {
        const id = `section${i}`;
        manifestItems.push(`<opf:item id="${id}" href="Contents/${id}.xml" media-type="application/xml"/>`);
        spineItems.push(`<opf:itemref idref="${id}" linear="yes"/>`);
    }
    next = next.replace('</opf:manifest>', `${manifestItems.join('')}</opf:manifest>`);
    next = next.replace('</opf:spine>', `${spineItems.join('')}</opf:spine>`);
    return next;
}

function fillIssueTemplateBlock(tableParagraph, issue, index, images = {}) {
    const parsed = parseUpdateIssueDescription(issue);
    const imageNote = issue.imageNote || issue.afterImageNote || issue.hwpxImageNote || issue.reportImageNote || '';
    const specialNote = getIssueSpecialNote(issue);
    let block = tableParagraph;
    block = block.replace(/pageBreak="[^"]*"/, `pageBreak="${index === 0 ? '0' : '1'}"`);
    block = updateFirstEmptyCellParagraphAfterLabel(block, '수정 사유', parsed.reason || ' ');
    block = updateFirstEmptyCellParagraphAfterLabel(block, '주요 수정 사항', parsed.changes || ' ');
    block = updateCellImageByAddress(block, 4, 3, images.thumbnail);
    block = updateCellTextByAddress(block, 5, 0, imageNote || ' ');
    block = updateCellTextByAddress(block, 5, 3, imageNote || ' ');
    if (images.before || images.after) {
        block = updateCellsInRowHeight(block, 6, 17600);
    }
    block = updateCellImageByAddress(block, 6, 0, images.before);
    block = updateCellImageByAddress(block, 6, 3, images.after);
    block = specialNote
        ? updateFirstEmptyCellParagraphAfterLabel(block, '특이 사항', specialNote)
        : removeTableRowByCellAddress(removeTableRowContainingLabel(block, '특이 사항'), 7);
    return uniquifyHwpxBlockIds(block, index);
}

async function createTemplateBasedUpdateIssuesHwpx(issues, title, token) {
    if (!fs.existsSync(HWPX_TEMPLATE_PATH)) return null;
    const templateEntries = readZipEntries(fs.readFileSync(HWPX_TEMPLATE_PATH));
    const issueImages = await Promise.all(issues.map((issue, index) => resolveIssueExportImages(issue, index, token)));
    const allImages = issueImages.flatMap(pair => [pair.thumbnail, pair.before, pair.after]).filter(Boolean);
    console.log('[HWPX Export] image summary:', {
        issues: issues.length,
        images: allImages.length,
        thumbnailImages: issueImages.filter(pair => pair.thumbnail).length,
        beforeImages: issueImages.filter(pair => pair.before).length,
        afterImages: issueImages.filter(pair => pair.after).length
    });
    const previewIssueText = issues.map((issue, index) => {
        const parsed = parseUpdateIssueDescription(issue);
        const specialNote = getIssueSpecialNote(issue);
        return [
            `수정 사유: ${parsed.reason || ''}`,
            `주요 수정 사항: ${parsed.changes || ''}`,
            specialNote ? `특이 사항: ${specialNote}` : ''
        ].filter(Boolean).join('\r\n');
    }).join('\r\n\r\n');
    const hasSpecialNotes = issues.some(issue => !!getIssueSpecialNote(issue));
    const previewText = [
        '<수정 사유><>',
        '<주요 수정 사항><' + previewIssueText + '>',
        '<변경 전><변경 후 >',
        '<><>',
        '<><>',
        '<><>',
        '<><>'
    ].concat(hasSpecialNotes ? [
        '<특이 사항><' + issues.map(issue => getIssueSpecialNote(issue)).filter(Boolean).join('\r\n\r\n') + '>'
    ] : []).join('\r\n');
    const nextEntries = templateEntries.map(entry => {
        if (entry.name === 'Contents/section0.xml') {
            let xml = entry.data.toString('utf8');
            const template = getTemplateTableParagraph(xml);
            if (template) {
                const blocks = issues.map((issue, index) => fillIssueTemplateBlock(template.tableParagraph, issue, index, issueImages[index])).join('');
                xml = template.prefix + blocks + template.suffix;
            } else {
                xml = updateFirstEmptyCellParagraphAfterLabel(xml, '수정 사유', '');
                xml = updateFirstEmptyCellParagraphAfterLabel(xml, '주요 수정 사항', previewIssueText || ' ');
                xml = hasSpecialNotes
                    ? updateFirstEmptyCellParagraphAfterLabel(xml, '특이 사항', issues.map(issue => getIssueSpecialNote(issue)).filter(Boolean).join('\r\n\r\n'))
                    : removeTableRowByCellAddress(removeTableRowContainingLabel(xml, '특이 사항'), 7);
            }
            return { name: entry.name, data: xml };
        }
        if (entry.name === 'Contents/content.hpf') {
            return { name: entry.name, data: addHwpxImageManifestItems(entry.data.toString('utf8'), allImages) };
        }
        if (entry.name === 'Contents/header.xml') {
            return { name: entry.name, data: addHwpxHeaderBinDataItems(entry.data.toString('utf8'), allImages) };
        }
        if (entry.name === 'META-INF/manifest.xml') {
            return { name: entry.name, data: addHwpxPackageManifestImageEntries(entry.data.toString('utf8'), allImages) };
        }
        if (entry.name === 'Preview/PrvText.txt') return { name: entry.name, data: previewText };
        return entry;
    });
    return createZip(addHwpxImageEntries(nextEntries, allImages));
}

function getBimReviewText(issue) {
    return stripLeadingBulletMarkers(stripVersionInfo(issue.description || issue.desc || issue.mainChange || ''));
}

function getBimReviewResultText(issue) {
    return stripLeadingBulletMarkers(stripVersionInfo(
        issue.result ||
        issue.outcome ||
        issue.resolutionResult ||
        issue.reflectionResult ||
        ''
    ));
}

function fillBimReviewTemplateBlock(tableParagraph, issue, index, images = {}, options = {}) {
    const isClosed = isClosedIssueStatus(issue);
    let block = tableParagraph;
    block = block.replace(/pageBreak="[^"]*"/, 'pageBreak="0"');
    block = updateFirstEmptyCellParagraphAfterLabel(block, '검토 사항', getBimReviewText(issue) || ' ');
    const reviewImageCaption = getIssueBimReviewImageCaption(issue);
    block = reviewImageCaption
        ? updateCellTextByAddress(block, 2, 0, reviewImageCaption)
        : removeTableRowByCellAddress(block, 2);
    if (images.reviewImages && images.reviewImages.length) {
        block = updateCellsInRowHeight(block, 3, 16644);
        block = updateCellImagesByAddress(block, 3, 0, images.reviewImages);
    }
    if (isClosed) {
        block = updateFirstEmptyCellParagraphAfterLabel(block, '반영 결과', getBimReviewResultText(issue) || ' ');
        const resultImageCaption = getIssueResultImageCaption(issue);
        block = resultImageCaption
            ? updateCellTextByAddress(block, 5, 0, resultImageCaption)
            : removeTableRowByCellAddress(block, 5);
        if (images.resultImages && images.resultImages.length) {
            block = updateCellsInRowHeight(block, 6, 16078);
            block = updateCellImagesByAddress(block, 6, 0, images.resultImages);
        }
        block = removeTableRowContainingLabel(block, '검토 방안');
    } else {
        if (options.openFromClosedTemplate) {
            block = replaceHwpxCellLabel(block, '반영 결과', '검토 방안');
        }
        block = updateFirstEmptyCellParagraphAfterLabel(block, '검토 방안', getIssueReviewPlan(issue) || ' ');
        block = removeTableRowByCellAddress(removeTableRowByCellAddress(removeTableRowContainingLabel(block, '반영 결과'), 6), 5);
    }
    return uniquifyHwpxBlockIds(block, index);
}

function readBimReviewTemplateParts(templatePath) {
    if (!fs.existsSync(templatePath)) return null;
    const entries = readZipEntries(fs.readFileSync(templatePath));
    const sectionEntry = entries.find(entry => entry.name === 'Contents/section0.xml');
    if (!sectionEntry) return null;
    const sectionXml = sectionEntry.data.toString('utf8');
    const template = getTemplateTableParagraph(sectionXml);
    if (!template) return null;
    return { entries, template };
}

async function createTemplateBasedBimReviewIssuesHwpx(issues, title) {
    const openTemplate = readBimReviewTemplateParts(BIM_REVIEW_OPEN_HWPX_TEMPLATE_PATH);
    const closedTemplate = readBimReviewTemplateParts(BIM_REVIEW_CLOSED_HWPX_TEMPLATE_PATH);
    if (!openTemplate && !closedTemplate) return null;
    const hasClosed = issues.some(isClosedIssueStatus);
    const hasOpen = issues.some(issue => !isClosedIssueStatus(issue));
    const mixedStatuses = hasClosed && hasOpen;
    const baseTemplate = mixedStatuses
        ? (closedTemplate || openTemplate)
        : (hasClosed ? closedTemplate : openTemplate) || closedTemplate || openTemplate;
    const issueImages = await Promise.all(issues.map((issue, index) => resolveBimReviewIssueImages(issue, index)));
    const allImages = issueImages.flatMap(pair => [...pair.reviewImages, ...pair.resultImages]).filter(Boolean);
    const previewText = issues.map(issue => {
        const isClosed = isClosedIssueStatus(issue);
        return [
            `검토 사항: ${getBimReviewText(issue) || ''}`,
            isClosed
                ? `반영 결과: ${getBimReviewResultText(issue) || ''}`
                : `검토 방안: ${getIssueReviewPlan(issue) || ''}`
        ].join('\r\n');
    }).join('\r\n\r\n');
    const blocks = issues.map((issue, index) => {
        const useClosedForOpen = mixedStatuses && !isClosedIssueStatus(issue);
        const perIssueTemplate = mixedStatuses
            ? baseTemplate
            : ((isClosedIssueStatus(issue) ? closedTemplate : openTemplate) || baseTemplate);
        return fillBimReviewTemplateBlock(perIssueTemplate.template.tableParagraph, issue, index, issueImages[index], {
            openFromClosedTemplate: useClosedForOpen
        });
    }).join('');
    const nextEntries = baseTemplate.entries.map(entry => {
        if (entry.name === 'Contents/section0.xml') {
            return {
                name: entry.name,
                data: baseTemplate.template.prefix + blocks + baseTemplate.template.suffix
            };
        }
        if (entry.name === 'Contents/content.hpf') {
            return { name: entry.name, data: addHwpxImageManifestItems(entry.data.toString('utf8'), allImages) };
        }
        if (entry.name === 'Contents/header.xml') {
            return { name: entry.name, data: addHwpxHeaderBinDataItems(entry.data.toString('utf8'), allImages) };
        }
        if (entry.name === 'META-INF/manifest.xml') {
            return { name: entry.name, data: addHwpxPackageManifestImageEntries(entry.data.toString('utf8'), allImages) };
        }
        if (entry.name === 'Preview/PrvText.txt') return { name: entry.name, data: previewText };
        return entry;
    });
    return createZip(addHwpxImageEntries(nextEntries, allImages));
}

async function createBimReviewIssuesHwpx(issues, title) {
    const templated = await createTemplateBasedBimReviewIssuesHwpx(issues, title);
    if (templated) return templated;
    return createZip([
        { name: 'mimetype', data: 'application/hwp+zip' },
        { name: 'version.xml', data: '<?xml version="1.0" encoding="UTF-8"?><ha:HCFVersion xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" targetApplication="WORDPROC" major="5" minor="1" micro="0" buildNumber="0" os="Windows"/>' },
        { name: 'META-INF/manifest.xml', data: '<?xml version="1.0" encoding="UTF-8"?><manifest xmlns="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><file-entry full-path="/" media-type="application/hwp+zip"/><file-entry full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/><file-entry full-path="Contents/header.xml" media-type="application/xml"/><file-entry full-path="Contents/section0.xml" media-type="application/xml"/><file-entry full-path="Contents/settings.xml" media-type="application/xml"/></manifest>' },
        { name: 'META-INF/container.xml', data: '<?xml version="1.0" encoding="UTF-8"?><ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf"><ocf:rootfiles><ocf:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/></ocf:rootfiles></ocf:container>' },
        { name: 'Contents/content.hpf', data: '<?xml version="1.0" encoding="UTF-8"?><opf:package xmlns:opf="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="1.0"><opf:metadata><dc:title>BIM기반 검토 보고서</dc:title><dc:creator>APS AI Platform</dc:creator><dc:language>ko-KR</dc:language></opf:metadata><opf:manifest><opf:item id="header" href="header.xml" media-type="application/xml"/><opf:item id="section0" href="section0.xml" media-type="application/xml"/><opf:item id="settings" href="settings.xml" media-type="application/xml"/></opf:manifest><opf:spine><opf:itemref idref="section0"/></opf:spine></opf:package>' },
        { name: 'Contents/header.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head"><hh:beginNum page="1" footnote="1" endnote="1" pic="1" tbl="1" equation="1"/><hh:refList><hh:fontfaces><hh:fontface lang="HANGUL"><hh:font name="함초롬바탕" type="TTF"/></hh:fontface></hh:fontfaces><hh:borderFills><hh:borderFill id="0"/></hh:borderFills><hh:charProperties><hh:charPr id="0" height="1000" textColor="#000000"/></hh:charProperties><hh:paraProperties><hh:paraPr id="0" align="LEFT"/></hh:paraProperties><hh:styles><hh:style id="0" type="PARA" name="바탕글" paraPrIDRef="0" charPrIDRef="0"/></hh:styles></hh:refList></hh:head>' },
        { name: 'Contents/section0.xml', data: buildHwpxSection(issues.map((issue, index) => ({ ...issue, id: issue.id || index + 1, mainChange: getBimReviewText(issue) })), title || 'BIM기반 검토 보고서') },
        { name: 'Contents/settings.xml', data: '<?xml version="1.0" encoding="UTF-8"?><ha:HWPApplicationSetting xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app"/>' },
        { name: 'Preview/PrvText.txt', data: issues.map(issue => getBimReviewText(issue)).join('\n\n') }
    ]);
}

function buildHwpxSection(issues, title) {
    const today = new Date().toISOString().slice(0, 10);
    const body = issues.map((issue, index) => {
        const mainChange = stripVersionInfo(issue.mainChange || issue.description || issue.desc || '');
        const specialNote = getIssueSpecialNote(issue);
        return [
            hpPara(`${index + 1}. ${issue.title || '업데이트 이슈'}`, 1),
            hpPara(`이슈 ID: ${issue.id || '-'}`),
            hpPara(`상태: ${issue.status || '-'}`),
            hpPara(`담당자: ${issue.assignee || '-'}`),
            hpPara(`확인자: ${issue.reviewer || '-'}`),
            hpPara(`위치: ${issue.location || '-'}`),
            hpPara(`배치: ${issue.placement || '-'}`),
            hpPara('이미지 제목: '),
            hpPara('이미지: '),
            hpPara('수정사유: '),
            hpPara('주요 수정 사항'),
            hpPara(mainChange || ' ')
        ].concat(specialNote ? [
            hpPara('특이 사항: '),
            hpPara(specialNote)
        ] : []).join('');
    }).join('');

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core">
${hpPara(title || '업데이트 이슈 보고서', 1)}
${hpPara(`작성일: ${today}`)}
${hpPara(`대상: 업데이트 이슈 ${issues.length}건`)}
${hpPara(' ')}
${body}
</hs:sec>`;
}

async function createUpdateIssuesHwpx(issues, title, token) {
    const templated = await createTemplateBasedUpdateIssuesHwpx(issues, title, token);
    if (templated) return templated;

    const safeIssues = issues.map((issue, index) => ({
        id: issue.id || issue.displayId || issue.dbId || index + 1,
        title: issue.title || issue.name || '업데이트 이슈',
        status: issue.status || '',
        assignee: issue.assignee || '',
        reviewer: issue.reviewer || issue.verifier || '',
        location: issue.location || issue.locationName || '',
        placement: issue.placement || issue.placementName || issue.file || '',
        mainChange: stripVersionInfo(issue.mainChange || issue.description || issue.desc || ''),
        specialNote: getIssueSpecialNote(issue)
    }));
    const headerXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head">
  <hh:beginNum page="1" footnote="1" endnote="1" pic="1" tbl="1" equation="1"/>
  <hh:refList>
    <hh:fontfaces><hh:fontface lang="HANGUL"><hh:font name="함초롬바탕" type="TTF"/></hh:fontface></hh:fontfaces>
    <hh:borderFills><hh:borderFill id="0"/></hh:borderFills>
    <hh:charProperties><hh:charPr id="0" height="1000" textColor="#000000"/></hh:charProperties>
    <hh:paraProperties><hh:paraPr id="0" align="LEFT"/></hh:paraProperties>
    <hh:styles><hh:style id="0" type="PARA" name="바탕글" paraPrIDRef="0" charPrIDRef="0"/></hh:styles>
    <hh:bullets/>
    <hh:numberings/>
  </hh:refList>
</hh:head>`;
    const entries = [
        { name: 'mimetype', data: 'application/hwp+zip' },
        { name: 'version.xml', data: '<?xml version="1.0" encoding="UTF-8"?><ha:HCFVersion xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app" targetApplication="WORDPROC" major="5" minor="1" micro="0" buildNumber="0" os="Windows"/>' },
        { name: 'META-INF/manifest.xml', data: '<?xml version="1.0" encoding="UTF-8"?><manifest xmlns="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"><file-entry full-path="/" media-type="application/hwp+zip"/><file-entry full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/><file-entry full-path="Contents/header.xml" media-type="application/xml"/><file-entry full-path="Contents/section0.xml" media-type="application/xml"/><file-entry full-path="Contents/settings.xml" media-type="application/xml"/></manifest>' },
        { name: 'META-INF/container.xml', data: '<?xml version="1.0" encoding="UTF-8"?><ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf"><ocf:rootfiles><ocf:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/></ocf:rootfiles></ocf:container>' },
        { name: 'Contents/content.hpf', data: '<?xml version="1.0" encoding="UTF-8"?><opf:package xmlns:opf="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" version="1.0"><opf:metadata><dc:title>업데이트 이슈 보고서</dc:title><dc:creator>APS AI Platform</dc:creator><dc:language>ko-KR</dc:language></opf:metadata><opf:manifest><opf:item id="header" href="header.xml" media-type="application/xml"/><opf:item id="section0" href="section0.xml" media-type="application/xml"/><opf:item id="settings" href="settings.xml" media-type="application/xml"/></opf:manifest><opf:spine><opf:itemref idref="section0"/></opf:spine></opf:package>' },
        { name: 'Contents/header.xml', data: headerXml },
        { name: 'Contents/section0.xml', data: buildHwpxSection(safeIssues, title) },
        { name: 'Contents/settings.xml', data: '<?xml version="1.0" encoding="UTF-8"?><ha:HWPApplicationSetting xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app"/>' },
        { name: 'Preview/PrvText.txt', data: safeIssues.map(issue => [issue.title, issue.mainChange].filter(Boolean).join('\n')).join('\n\n') }
    ];
    return createZip(entries);
}

function textFromValueSafe(value) {
    if (value == null) return '';
    if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
    if (Array.isArray(value)) return value.map(textFromValueSafe).filter(Boolean).join(' > ');
    if (typeof value === 'object') {
        return textFromValueSafe(
            value.name ?? value.displayName ?? value.title ?? value.label ??
            value.value ?? value.text ?? value.displayValue ?? value.description ?? ''
        );
    }
    return String(value || '').trim();
}

function getCustomValueSafe(issue, names) {
    const attrs = pick(issue, [
        'customAttributes',
        'attributes.customAttributes',
        'custom_attributes',
        'customAttributesMap',
        'attributes.customAttributesMap',
        'customAttributeValues',
        'attributes.customAttributeValues'
    ], []);
    const candidates = Array.isArray(attrs) ? attrs : Object.entries(attrs || {}).map(([title, value]) => ({ title, name: title, value }));
    const lowered = names.map(n => String(n).toLowerCase());
    for (const item of candidates) {
        const title = String(
            item.title || item.name || item.key || item.displayName ||
            item.attributeName || item.definitionName || item.attrName ||
            item.attributeDefinition?.title || item.attributeDefinition?.name ||
            item.definition?.title || item.definition?.name || ''
        ).toLowerCase();
        if (lowered.includes(title)) {
            return textFromValueSafe(item.value ?? item.text ?? item.displayValue ?? item.selectedValue ?? item);
        }
    }
    return '';
}

function normalizeStatus(value) {
    const raw = String(value || '').trim();
    const key = raw.toLowerCase().replace(/[\s_-]+/g, '');
    const map = {
        draft: '초안',
        open: '생성',
        created: '생성',
        create: '생성',
        overdue: '지연',
        late: '지연',
        inprogress: '진행 중',
        answerprovided: '답변완료',
        answered: '답변완료',
        inreview: '검토 중',
        review: '검토 중',
        reviewinprogress: '검토 중',
        rejected: '반려',
        reject: '반려',
        needdiscussion: '협의필요',
        needsdiscussion: '협의필요',
        closed: '종료',
        close: '종료',
        completed: '종료',
        done: '종료',
        void: '종료'
    };
    return map[key] || raw || '생성';
}

function displayUser(value, userMap) {
    if (!value) return '';
    if (typeof value === 'string') return userMap.get(value) || userMap.get(value.toLowerCase()) || FALLBACK_USER_NAMES.get(value) || FALLBACK_USER_NAMES.get(value.toUpperCase()) || value;
    const id = value.autodeskId || value.autodesk_id || value.id || value.userId || value.user_id || value.uid || value.accountId || value.account_id || value.oxygenId || value.oxygen_id || value.email;
    const name = value.name || value.displayName || value.fullName || [value.firstName, value.lastName].filter(Boolean).join(' ') || value.email;
    if (name) return name;
    if (id) return userMap.get(String(id)) || userMap.get(String(id).toLowerCase()) || FALLBACK_USER_NAMES.get(String(id)) || FALLBACK_USER_NAMES.get(String(id).toUpperCase()) || String(id);
    return '';
}

function getWatcherReviewer(issue) {
    const watchers = pick(issue, ['watcherObjects', 'attributes.watcherObjects', 'watchers', 'attributes.watchers'], []);
    if (!Array.isArray(watchers) || !watchers.length) return '';
    return watchers.find(item => item && (item.name || item.displayName || item.id || item.userId || item.autodeskId || item.email)) || watchers[0];
}

function getReviewerRaw(issue) {
    const customReviewer = getCustomValue(issue, ['확인자', '검토자', 'Reviewer']);
    if (customReviewer) return customReviewer;
    const watcherReviewer = getWatcherReviewer(issue);
    if (watcherReviewer) return watcherReviewer;
    return pick(issue, ['reviewer', 'reviewedBy', 'verifier', 'attributes.reviewer', 'attributes.reviewedBy', 'attributes.verifier'], '');
}

function getIssueResultValue(issue) {
    const customResult = getCustomValueSafe(issue, [
        '결과',
        '조치결과',
        '처리결과',
        '완료결과',
        '해결결과',
        'Result',
        'Results',
        'Outcome',
        'Resolution'
    ]);
    if (customResult) return customResult;

    return textFromValueSafe(pick(issue, [
        'result',
        'results',
        'outcome',
        'resolution',
        'resolutionResult',
        'resolution.result',
        'attributes.result',
        'attributes.results',
        'attributes.outcome',
        'attributes.resolution',
        'attributes.resolutionResult',
        'attributes.resolution.result'
    ], ''));
}

function getScheduleStartDateValue(issue) {
    return textFromValueSafe(getCustomValueSafe(issue, [
        '작업 시작일',
        '작업시작일',
        '수행 시작일',
        '수행시작일',
        '시작일',
        'Start Date',
        'Start',
        'startDate'
    ])) || textFromValueSafe(pick(issue, [
        'startDate',
        'start_date',
        'attributes.startDate',
        'attributes.start_date',
        'createdAt',
        'attributes.createdAt',
        'createdDate',
        'attributes.createdDate'
    ], ''));
}

function getScheduleDueDateValue(issue) {
    return textFromValueSafe(getCustomValueSafe(issue, [
        '작업 마감일',
        '작업마감일',
        '작업 종료일',
        '작업종료일',
        '수행 마감일',
        '수행마감일',
        '마감일',
        '종료일',
        'Due Date',
        'End Date',
        'Due',
        'dueDate',
        'endDate'
    ])) || textFromValueSafe(pick(issue, [
        'dueDate',
        'due_date',
        'endDate',
        'end_date',
        'attributes.dueDate',
        'attributes.due_date',
        'attributes.endDate',
        'attributes.end_date',
        'updatedAt',
        'attributes.updatedAt'
    ], '')) || getScheduleStartDateValue(issue);
}

function normalizeType(issue, typeMap) {
    const typeId = pick(issue, ['issueTypeId', 'issueSubtypeId', 'attributes.issueTypeId', 'attributes.issueSubtypeId', 'typeId'], '');
    if (typeId && typeMap.get(typeId)) return typeMap.get(typeId);
    const direct = pick(issue, [
        'typePath', 'issueTypePath', 'categoryPath',
        'attributes.typePath', 'attributes.issueTypePath', 'attributes.categoryPath',
        'issueType.name', 'issueSubtype.name', 'type.name',
        'attributes.issueType', 'attributes.type'
    ], '');
    if (Array.isArray(direct)) return direct.filter(Boolean).join(' > ');
    if (direct && typeof direct === 'object') return [direct.parentName, direct.name].filter(Boolean).join(' > ') || direct.name || '';
    return String(direct || '이슈').trim();
}

function normalizeTypeForForma(issue, typeMap) {
    const subtypeId = pick(issue, ['issueSubtypeId', 'attributes.issueSubtypeId', 'subtypeId', 'attributes.subtypeId'], '');
    if (subtypeId && typeMap.get(String(subtypeId))) return typeMap.get(String(subtypeId));

    const typeName = pick(issue, ['issueType.name', 'issueType.title', 'attributes.issueType.name', 'attributes.issueType.title'], '');
    const subtypeName = pick(issue, ['issueSubtype.name', 'issueSubtype.title', 'attributes.issueSubtype.name', 'attributes.issueSubtype.title'], '');
    const composed = [textFromValueSafe(typeName), textFromValueSafe(subtypeName)].filter(Boolean).join(' > ');
    if (composed) return composed;

    const typeId = pick(issue, ['issueTypeId', 'attributes.issueTypeId', 'typeId', 'attributes.typeId'], '');
    if (typeId && subtypeId) {
        const parent = typeMap.get(String(typeId)) || '';
        const child = typeMap.get(String(subtypeId)) || '';
        if (parent && child && child.indexOf(' > ') === -1 && parent !== child) return parent + ' > ' + child;
        if (child) return child;
    }
    if (typeId && typeMap.get(String(typeId))) return typeMap.get(String(typeId));

    const direct = pick(issue, [
        'typePath', 'issueTypePath', 'categoryPath', 'issueCategoryPath',
        'attributes.typePath', 'attributes.issueTypePath', 'attributes.categoryPath', 'attributes.issueCategoryPath',
        'type.name', 'type.title', 'attributes.issueType', 'attributes.type'
    ], '');
    if (Array.isArray(direct)) return direct.map(textFromValueSafe).filter(Boolean).join(' > ');
    if (direct && typeof direct === 'object') {
        const parent = direct.parentName || direct.categoryName || direct.issueTypeName || direct.typeName;
        const name = direct.name || direct.title || direct.displayName;
        return [parent, name].map(textFromValueSafe).filter(Boolean).join(' > ');
    }
    return textFromValueSafe(direct) || '이슈';
}

function normalizeLocation(issue) {
    const location = pick(issue, [
        'location',
        'locationName',
        'locationDetails',
        'location_description',
        'attributes.location',
        'attributes.locationName',
        'attributes.locationDetails',
        'attributes.location_description'
    ], '') || getCustomValue(issue, ['위치', '위치명', '구역', 'Location', 'LBS', '구조물']);
    if (typeof location === 'object') {
        return location.name || location.displayName || location.title || location.value || '';
    }
    return String(location || '').trim();
}

function normalizePlacement(issue) {
    const info = normalizePlacementInfo(issue);
    return formatPlacementInfo(info);
}

function normalizePlacementVersion(value) {
    if (value == null || value === '') return '';
    const text = String(value).trim();
    if (!text || text === '-') return '';
    const match = text.match(/^v?\s*(\d+)$/i);
    return match ? `v${match[1]}` : text;
}

function normalizePlacementUrn(value) {
    if (!value || typeof value !== 'object') return '';
    const direct = textFromValueSafe(pick(value, [
        'placements.0.tipVersionUrn',
        'placements.0.versionUrn',
        'placements.0.lineageUrn',
        'placements.0.viewable.seedURN',
        'placements.0.originContext.entityId',
        'tipVersionUrn',
        'includedVersion.urn',
        'results.0.tipVersionUrn',
        'results.0.includedVersion.urn',
        'details.viewable.urn',
        'details.viewable.versionId',
        'details.viewable.viewableUrn',
        'details.viewable.viewerUrn',
        'details.document.urn',
        'details.document.versionId',
        'details.file.urn',
        'details.file.versionId',
        'linkedDocument.details.viewable.urn',
        'linkedDocument.details.viewable.versionId'
    ], ''))
        || textFromValueSafe(value.urn)
        || textFromValueSafe(value.modelUrn)
        || textFromValueSafe(value.fileUrn)
        || textFromValueSafe(value.targetUrn)
        || textFromValueSafe(value.seedURN)
        || textFromValueSafe(value.viewableUrn)
        || textFromValueSafe(value.viewerUrn)
        || textFromValueSafe(value.versionUrn)
        || textFromValueSafe(value.documentUrn)
        || textFromValueSafe(value.documentVersionUrn)
        || textFromValueSafe(value.itemUrn)
        || textFromValueSafe(value.lineageUrn)
        || textFromValueSafe(value.documentLineageUrn)
        || textFromValueSafe(value.versionId)
        || textFromValueSafe(value.itemId);
    if (direct) return direct;
    for (const [key, val] of Object.entries(value)) {
        if (/urn|versionid|itemid|lineage/i.test(key) && val != null && typeof val !== 'object') {
            const text = textFromValueSafe(val);
            if (text) return text;
        }
    }
    return '';
}

function placementNameFromValue(value) {
    if (value == null || value === '') return '';
    if (typeof value !== 'object') return textFromValueSafe(value);
    const direct = textFromValueSafe(pick(value, [
        'placements.0.name',
        'placements.0.fileName',
        'placements.0.displayName',
        'results.0.name',
        'results.0.includedVersion.name',
        'results.0.includedVersion.uploadFileName',
        'details.viewable.name',
        'details.viewable.displayName',
        'details.viewable.fileName',
        'details.viewable.filename',
        'details.viewable.attributes.name',
        'details.viewable.attributes.displayName',
        'details.document.name',
        'details.document.displayName',
        'details.document.fileName',
        'details.file.name',
        'details.file.displayName',
        'details.file.fileName',
        'details.name',
        'details.displayName',
        'details.fileName',
        'linkedDocument.details.viewable.name',
        'linkedDocument.details.viewable.displayName',
        'linkedDocument.details.viewable.fileName'
    ], ''))
        || textFromValueSafe(value.name)
        || textFromValueSafe(value.displayName)
        || textFromValueSafe(value.title)
        || textFromValueSafe(value.fileName)
        || textFromValueSafe(value.filename)
        || textFromValueSafe(value.file_name)
        || textFromValueSafe(value.itemName)
        || textFromValueSafe(value.documentName)
        || textFromValueSafe(value.documentTitle)
        || textFromValueSafe(value.objectName)
        || textFromValueSafe(pick(value, ['attributes.name', 'attributes.displayName', 'attributes.fileName', 'attributes.file_name', 'attributes.documentName', 'attributes.documentTitle'], ''))
        || textFromValueSafe(pick(value, ['linkedDocument.name', 'linkedDocument.displayName'], ''))
        || textFromValueSafe(pick(value, ['document.name', 'document.displayName'], ''))
        || textFromValueSafe(pick(value, ['item.name', 'item.displayName'], ''))
        || textFromValueSafe(pick(value, ['version.name', 'version.displayName', 'version.attributes.name'], ''));
    if (direct) return direct;
    for (const val of Object.values(value)) {
        if (val != null && typeof val !== 'object') {
            const text = textFromValueSafe(val);
            if (isModelDocumentName(text)) return text;
        }
    }
    return '';
}

function placementVersionFromValue(value) {
    if (!value || typeof value !== 'object') return '';
    const versionFromTip = String(pick(value, ['tipVersionUrn', 'results.0.tipVersionUrn'], '') || '').match(/[?&]version=(\d+)/i);
    const placementVersionFromTip = String(pick(value, ['placements.0.tipVersionUrn', 'placements.0.versionUrn'], '') || '').match(/[?&]version=(\d+)/i);
    return normalizePlacementVersion(value.version)
        || normalizePlacementVersion(placementVersionFromTip && placementVersionFromTip[1])
        || normalizePlacementVersion(versionFromTip && versionFromTip[1])
        || normalizePlacementVersion(value.versionNumber)
        || normalizePlacementVersion(value.versionLabel)
        || normalizePlacementVersion(value.versionName)
        || normalizePlacementVersion(value.versionIndex)
        || normalizePlacementVersion(pick(value, [
            'includedVersion.versionNumber',
            'results.0.includedVersion.versionNumber',
            'results.0.versionNumber',
            'details.version',
            'details.versionNumber',
            'details.versionLabel',
            'details.viewable.version',
            'details.viewable.versionNumber',
            'details.viewable.versionLabel',
            'details.viewable.attributes.version',
            'details.viewable.attributes.versionNumber',
            'attributes.version',
            'attributes.versionNumber',
            'attributes.versionLabel',
            'attributes.versionIndex',
            'linkedDocument.version',
            'linkedDocument.versionNumber',
            'document.version',
            'document.versionNumber',
            'version.versionNumber',
            'version.attributes.versionNumber'
        ], ''));
}

function isModelDocumentName(name) {
    return /\.(rvt|ifc|dwg|nwd|nwc)$/i.test(String(name || '').trim());
}

function isGenericPlacementName(name) {
    const key = String(name || '').normalize('NFKC').trim().toLowerCase();
    return !key
        || key === '-'
        || key === 'docs'
        || key === 'autodesk docs'
        || key === 'documents'
        || key === 'files'
        || key === 'document management'
        || key === 'bim 360 docs';
}

function findModelDocumentText(value) {
    const seen = new Set();
    function walk(current) {
        if (current == null) return '';
        if (typeof current !== 'object') {
            const text = textFromValueSafe(current);
            return isModelDocumentName(text) ? text : '';
        }
        if (seen.has(current)) return '';
        seen.add(current);
        if (Array.isArray(current)) {
            for (const item of current) {
                const found = walk(item);
                if (found) return found;
            }
            return '';
        }
        for (const [key, val] of Object.entries(current)) {
            if (/href|url|link|self|related/i.test(key)) continue;
            const found = walk(val);
            if (found) return found;
        }
        return '';
    }
    return walk(value);
}

function formatPlacementInfo(info) {
    const name = textFromValueSafe(info && info.name);
    if (isGenericPlacementName(name)) return '';
    const version = normalizePlacementVersion(info && info.version);
    return version ? `${name} (${version})` : name;
}

function normalizePlacementInfo(issue) {
    const overrideName = textFromValueSafe(issue && issue.placementName);
    const overrideUrn = textFromValueSafe(issue && issue.placementUrn);
    const overrideVersion = textFromValueSafe(issue && issue.placementVersion);
    if (overrideName || overrideUrn) {
        return {
            name: isGenericPlacementName(overrideName) ? '' : overrideName,
            version: overrideVersion,
            urn: overrideUrn
        };
    }
    const direct = pick(issue, [
        'placement',
        'placementName',
        'file',
        'fileName',
        'snapshotFileName',
        'attributes.placement',
        'attributes.placementName',
        'attributes.fileName',
        'linkedDocument.name'
    ], '') || getCustomValue(issue, ['배치', 'Placement', '파일', '모델', '도면']);
    const directInfo = {
        name: findModelDocumentText(direct) || placementNameFromValue(direct),
        version: placementVersionFromValue(direct),
        urn: normalizePlacementUrn(direct) || textFromValueSafe(pick(issue, [
            'placementUrn',
            'linkedDocumentUrn',
            'documentUrn',
            'modelUrn',
            'fileUrn',
            'targetUrn',
            'versionId',
            'viewableUrn',
            'details.viewable.urn',
            'details.viewable.versionId'
        ], ''))
    };
    if (isGenericPlacementName(directInfo.name)) {
        directInfo.name = '';
    }
    const found = findPlacementInfoDeep(issue);
    if (found.name && (!directInfo.name || isModelDocumentName(found.name) || !isModelDocumentName(directInfo.name))) {
        return found;
    }
    return directInfo.name ? directInfo : found;
}

function findPlacementInfoDeep(issue) {
    const seen = new Set();
    let first = { name: '', version: '', urn: '' };
    let best = { name: '', version: '', urn: '' };
    const likelyContainers = new Set([
        'linkeddocument',
        'linkeddocuments',
        'linked_document',
        'linked_documents',
        'placement',
        'placements',
        'reference',
        'references',
        'document',
        'documents',
        'associateddocument',
        'associateddocuments',
        'attachment',
        'attachments',
        'snapshot',
        'snapshots',
        'viewable',
        'viewables',
        'file',
        'files',
        'item',
        'items'
    ]);

    function readInfo(value) {
        return {
            name: findModelDocumentText(value) || placementNameFromValue(value),
            version: placementVersionFromValue(value),
            urn: normalizePlacementUrn(value)
        };
    }

    function remember(info, key) {
        const loweredKey = String(key || '').toLowerCase();
        const isLikelyKey = likelyContainers.has(loweredKey) || /document|reference|attachment|snapshot|viewable|file|item|placement/i.test(key || '');
        if (!info.name && info.urn && isLikelyKey) {
            if (!first.urn) first = info;
            if (!best.urn) best = info;
            return;
        }
        if (!info.name) return;
        if (isGenericPlacementName(info.name)) {
            if (info.urn && isLikelyKey && !best.urn) best = { name: '', version: info.version, urn: info.urn };
            return;
        }
        if (isModelDocumentName(info.name)) {
            if (!first.name) first = info;
            best = info;
            return;
        }
        if (!isLikelyKey) return;
        if (!first.name) first = info;
        if (!best.name) best = info;
    }

    function walk(value, key = '') {
        if (!value || typeof value !== 'object' || seen.has(value) || best.name && isModelDocumentName(best.name)) return;
        seen.add(value);
        if (Array.isArray(value)) {
            for (const item of value) walk(item, key);
            return;
        }

        remember(readInfo(value), key);
        for (const [childKey, childValue] of Object.entries(value)) {
            const lowered = String(childKey).toLowerCase();
            if (likelyContainers.has(lowered) || /document|reference|attachment|snapshot|viewable|file|item/i.test(childKey)) {
                walk(childValue, childKey);
            }
        }
        for (const [childKey, childValue] of Object.entries(value)) {
            walk(childValue, childKey);
        }
    }

    walk(issue);
    return (best.name || best.urn) ? best : first;
}

function compactDebugValue(value) {
    if (value == null) return value;
    if (typeof value === 'string') return value.length > 220 ? `${value.slice(0, 220)}...` : value;
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    return textFromValueSafe(value);
}

function collectPlacementDebugPaths(issue) {
    const seen = new Set();
    const matches = [];
    const interestingKey = /placement|linked|document|docs|reference|viewable|file|filename|name|urn|version|details|pushpin|position|viewer/i;
    const interestingValue = /\.(rvt|ifc|dwg|nwd|nwc)\b|urn:adsk|adsk\.|docs/i;

    function remember(pathKey, value) {
        if (matches.length >= 120) return;
        matches.push({ path: pathKey, value: compactDebugValue(value) });
    }

    function walk(value, pathKey = '$') {
        if (matches.length >= 120 || value == null) return;
        if (typeof value !== 'object') {
            const text = String(value);
            if (interestingValue.test(text)) remember(pathKey, value);
            return;
        }
        if (seen.has(value)) return;
        seen.add(value);
        if (Array.isArray(value)) {
            value.forEach((item, index) => walk(item, `${pathKey}[${index}]`));
            return;
        }
        for (const [key, child] of Object.entries(value)) {
            const childPath = `${pathKey}.${key}`;
            if (interestingKey.test(key)) {
                if (child == null || typeof child !== 'object') remember(childPath, child);
                else {
                    const text = textFromValueSafe(child);
                    if (text && text.length < 220) remember(childPath, text);
                }
            }
            walk(child, childPath);
        }
    }

    walk(issue);
    return matches;
}

function buildPlacementDebug(issue, normalized) {
    const raw = issue && (issue.rawDetailIssue || issue.rawFormaIssue || issue);
    const detail = issue && (issue.rawDetailIssue?.data || issue.rawDetailIssue?.issue || issue.rawDetailIssue?.result || issue.rawDetailIssue);
    return {
        id: normalized.displayId || normalized.id,
        title: normalized.title,
        normalizedPlacement: normalized.placement,
        placementName: normalized.placementName,
        placementVersion: normalized.placementVersion,
        placementUrn: normalized.placementUrn,
        topLevelKeys: Object.keys(raw || {}).slice(0, 80),
        linkedDocumentsType: Array.isArray(pick(raw, ['linkedDocuments', 'data.linkedDocuments', 'attributes.linkedDocuments'], null)) ? 'array' : typeof pick(raw, ['linkedDocuments', 'data.linkedDocuments', 'attributes.linkedDocuments'], null),
        rawPaths: collectPlacementDebugPaths(raw || {}),
        detailPaths: detail && detail !== raw ? collectPlacementDebugPaths(detail) : []
    };
}

function normalizeLocationForForma(issue, locationMap = new Map()) {
    const direct = pick(issue, [
        'location',
        'locationName',
        'location.name',
        'location.displayName',
        'locationDetails',
        'locationDetail',
        'locationDescription',
        'location_description',
        'locationText',
        'lbsLocation',
        'lbsLocation.name',
        'lbsLocation.displayName',
        'attributes.location',
        'attributes.locationName',
        'attributes.location.name',
        'attributes.location.displayName',
        'attributes.locationDetails',
        'attributes.locationDetail',
        'attributes.locationDescription',
        'attributes.location_description'
    ], '');
    const custom = getCustomValueSafe(issue, ['위치', '위치명', '구역', 'Location', 'LBS', '구조물']);
    const locationId = textFromValueSafe(pick(issue, [
        'locationId',
        'location.id',
        'attributes.locationId',
        'attributes.location.id'
    ], ''));
    const mapped = locationId ? (locationMap.get(locationId) || locationMap.get(locationId.toLowerCase())) : '';
    const deep = deepFindByKey(issue, [
        'locationName',
        'locationDetails',
        'locationDetail',
        'locationDescription',
        'locationText',
        'lbsLocationName'
    ]);
    return textFromValueSafe(direct) || textFromValueSafe(custom) || textFromValueSafe(mapped) || textFromValueSafe(deep);
}

async function fetchJson(url, token, extraHeaders = {}) {
    const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...extraHeaders }
    });
    const text = await resp.text();
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch (_) { json = { raw: text }; }
    if (!resp.ok) {
        const detail = json.detail || json.message || json.error_description || json.error || text || resp.statusText;
        throw new Error(`HTTP ${resp.status}: ${detail}`);
    }
    return json;
}

async function fetchJsonWithBody(url, token, body, extraHeaders = {}) {
    const resp = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
            ...extraHeaders
        },
        body: JSON.stringify(body || {})
    });
    const text = await resp.text();
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch (_) { json = { raw: text }; }
    if (!resp.ok) {
        const detail = json.detail || json.message || json.error_description || json.error || text || resp.statusText;
        throw new Error(`HTTP ${resp.status}: ${detail}`);
    }
    return json;
}

function getIssueRowsFromResponse(json) {
    return json && (json.results || json.data || json.issues || []);
}

function getNextIssuesPageUrl(json) {
    const next = json && (
        json.next ||
        json.nextUrl ||
        json.pagination?.next ||
        json.pagination?.nextUrl ||
        json.links?.next?.href ||
        json.links?.next
    );
    if (!next) return '';
    if (typeof next === 'string') return next;
    return next.href || next.url || '';
}

function withQueryParam(rawUrl, key, value) {
    const url = new URL(rawUrl);
    url.searchParams.set(key, String(value));
    return url.toString();
}

function issuePageSignature(rows) {
    return rows
        .slice(0, 5)
        .map(row => row && (row.id || row.issueId || row.displayId || row.attributes?.id || row.attributes?.displayId || JSON.stringify(row).slice(0, 120)))
        .join('|');
}

function dedupeIssueRows(rows) {
    const seen = new Set();
    return rows.filter(row => {
        const key = row && (row.id || row.issueId || row.displayId || row.attributes?.id || row.attributes?.displayId);
        if (!key) return true;
        const text = String(key);
        if (seen.has(text)) return false;
        seen.add(text);
        return true;
    });
}

function normalizeSnapshotUrn(issue) {
    return textFromValueSafe(pick(issue, [
        'snapshotUrn',
        'snapshotURN',
        'snapshot.urn',
        'attributes.snapshotUrn',
        'attributes.snapshotURN',
        'thumbnailUrn',
        'thumbnail.urn'
    ], ''));
}

function ossUrlFromSnapshotUrn(urn) {
    const text = String(urn || '').trim();
    const match = text.match(/^urn:adsk\.objects:os\.object:([^/]+)\/(.+)$/i);
    if (!match) return '';
    return {
        bucketKey: match[1],
        objectKey: match[2],
        objectUrl: `https://developer.api.autodesk.com/oss/v2/buckets/${encodeURIComponent(match[1])}/objects/${encodeURIComponent(match[2])}`,
        signedDownloadUrl: `https://developer.api.autodesk.com/oss/v2/buckets/${encodeURIComponent(match[1])}/objects/${encodeURIComponent(match[2])}/signeds3download?minutesExpiration=10`
    };
}

async function fetchSnapshotImage(urn, token) {
    const oss = ossUrlFromSnapshotUrn(urn);
    if (!oss) throw new Error('Unsupported snapshot URN');
    const cached = issueSnapshotCache.get(urn);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const signedResp = await fetch(oss.signedDownloadUrl, {
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json'
        }
    });
    if (!signedResp.ok) {
        const text = await signedResp.text().catch(() => '');
        throw new Error(`signeds3download HTTP ${signedResp.status}: ${text || signedResp.statusText}`);
    }
    const signedJson = await signedResp.json();
    const signedUrl = signedJson.url || signedJson.signedUrl || signedJson.signedURL || signedJson.urls?.[0];
    if (!signedUrl) throw new Error('signeds3download response did not include a URL');

    const resp = await fetch(signedUrl, {
        headers: { Accept: 'image/*,*/*' }
    });
    if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        throw new Error(`S3 HTTP ${resp.status}: ${text || resp.statusText}`);
    }
    const contentType = resp.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await resp.arrayBuffer());
    const value = { buffer, contentType };
    issueSnapshotCache.set(urn, { value, expiresAt: Date.now() + ISSUE_SNAPSHOT_CACHE_TTL_MS });
    return value;
}

async function fetchProjectMembers(projectId, token) {
    const cleanProjectId = stripBPrefix(projectId);
    const urls = [
        `https://developer.api.autodesk.com/construction/admin/v1/projects/${cleanProjectId}/users?limit=200`,
        `https://developer.api.autodesk.com/bim360/admin/v1/projects/${cleanProjectId}/users?limit=200`
    ];
    const map = new Map();
    for (const url of urls) {
        try {
            const json = await fetchJson(url, token);
            const rows = json.results || json.data || json.users || [];
            rows.forEach(u => {
                const name = u.name || u.displayName || [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || '';
                [u.autodeskId, u.autodesk_id, u.id, u.userId, u.user_id, u.uid, u.accountId, u.account_id, u.oxygenId, u.oxygen_id, u.email].filter(Boolean).forEach(id => {
                    map.set(String(id), name);
                    map.set(String(id).toLowerCase(), name);
                    map.set(String(id).toUpperCase(), name);
                });
            });
            if (map.size) return map;
        } catch (err) {
            console.warn('[Forma Issues] member fetch skipped:', err.message);
        }
    }
    FALLBACK_USER_NAMES.forEach((name, id) => {
        map.set(id, name);
        map.set(id.toLowerCase(), name);
        map.set(id.toUpperCase(), name);
    });
    return map;
}

function projectIdCandidates(projectId) {
    const original = String(projectId || '').trim();
    const clean = stripBPrefix(original);
    return Array.from(new Set([original, clean].filter(Boolean)));
}

async function fetchIssueTypeMap(projectId, containerId, token) {
    const projectIds = projectIdCandidates(projectId);
    const cleanContainerId = stripBPrefix(containerId);
    const regions = ['', 'US', 'EMEA'];
    const urls = [
        ...(cleanContainerId ? [{ url: `https://developer.api.autodesk.com/issues/v1/containers/${encodeURIComponent(cleanContainerId)}/issue-types` }] : []),
        ...projectIds.flatMap(id => regions.map(region => ({
            url: `https://developer.api.autodesk.com/construction/issues/v1/projects/${encodeURIComponent(id)}/issue-types?include=subtypes&limit=100`,
            region
        })))
    ];
    const map = new Map();
    for (const candidate of urls) {
        try {
            const headers = candidate.region ? { 'x-ads-region': candidate.region } : {};
            const json = await fetchJson(candidate.url, token, headers);
            const rows = json.results || json.data || json.issueTypes || [];
            rows.forEach(t => {
                const id = t.id || t.issueTypeId || t.attributes?.id;
                const parent = t.parentName || t.rootCauseCategory || t.attributes?.parentName || t.attributes?.categoryName || t.attributes?.parent?.name || '';
                const name = t.name || t.title || t.attributes?.name || t.attributes?.title || '';
                const pathName = t.path || t.fullName || [parent, name].filter(Boolean).join(' > ') || name;
                if (id && pathName) {
                    map.set(String(id), pathName);
                    map.set(String(id).toLowerCase(), pathName);
                }
                const subtypes = t.subtypes || t.issueSubtypes || t.attributes?.subtypes || t.attributes?.issueSubtypes || t.relationships?.subtypes?.data || [];
                subtypes.forEach(st => {
                    const subId = st.id || st.issueSubtypeId || st.attributes?.id;
                    const subName = st.name || st.title || st.attributes?.name || st.attributes?.title || '';
                    const subPath = st.path || st.fullName || [pathName || name, subName].filter(Boolean).join(' > ');
                    if (subId && subPath) {
                        map.set(String(subId), subPath);
                        map.set(String(subId).toLowerCase(), subPath);
                    }
                });
            });
        } catch (err) {
            console.warn('[Forma Issues] issue type fetch skipped:', err.message);
        }
    }
    return map;
}

async function fetchLocationMap(hubId, projectId, token) {
    const map = new Map();
    try {
        const project = await fetchJson(`https://developer.api.autodesk.com/project/v1/hubs/${encodeURIComponent(hubId)}/projects/${encodeURIComponent(projectId)}`, token);
        const rel = project.data?.relationships?.locations;
        const href = rel?.links?.related?.href || rel?.meta?.link?.href || '';
        const locationUrls = [
            href,
            `https://developer.api.autodesk.com/project/v1/hubs/${encodeURIComponent(hubId)}/projects/${encodeURIComponent(projectId)}/locations`,
            `https://developer.api.autodesk.com/project/v1/hubs/${encodeURIComponent(hubId)}/projects/${encodeURIComponent(projectId)}/topFolders`
        ].filter(Boolean);
        for (const url of locationUrls) {
            try {
                const json = await fetchJson(url, token);
                const rows = json.data || json.results || json.locations || [];
                const walk = (node, parents = []) => {
                    if (!node) return;
                    if (Array.isArray(node)) {
                        node.forEach(item => walk(item, parents));
                        return;
                    }
                    const id = node.id || node.locationId || node.attributes?.id;
                    const name = node.name || node.displayName || node.title || node.attributes?.name || node.attributes?.displayName || node.attributes?.title;
                    const pathName = [...parents, name].filter(Boolean).join(' > ');
                    if (id && pathName) {
                        map.set(String(id), pathName);
                        map.set(String(id).toLowerCase(), pathName);
                    }
                    walk(node.children || node.locations || node.data || node.attributes?.children, pathName ? [...parents, name] : parents);
                };
                walk(rows);
                if (map.size) return map;
            } catch (err) {
                console.warn('[Forma Issues] location fetch skipped:', err.message);
            }
        }
    } catch (err) {
        console.warn('[Forma Issues] project location relationship skipped:', err.message);
    }
    return map;
}

async function fetchFormaIssues(projectId, containerId, token, limit) {
    const projectIds = projectIdCandidates(projectId);
    const cleanContainerId = stripBPrefix(containerId);
    const totalLimit = Math.min(Math.max(parseInt(limit, 10) || 300, 1), 1000);
    const pageLimit = Math.min(totalLimit, 100);
    const regions = ['', 'US', 'EMEA'];
    const candidates = [
        ...(cleanContainerId ? [
            { url: `https://developer.api.autodesk.com/issues/v1/containers/${encodeURIComponent(cleanContainerId)}/issues?limit=${pageLimit}` },
            { url: `https://developer.api.autodesk.com/issues/v2/containers/${encodeURIComponent(cleanContainerId)}/issues?limit=${pageLimit}` }
        ] : []),
        ...projectIds.flatMap(id => regions.map(region => ({
            url: `https://developer.api.autodesk.com/construction/issues/v1/projects/${encodeURIComponent(id)}/issues?limit=${pageLimit}`,
            region
        }))),
        ...projectIds.flatMap(id => regions.map(region => ({
            url: `https://developer.api.autodesk.com/construction/issues/v2/projects/${encodeURIComponent(id)}/issues?limit=${pageLimit}`,
            region
        })))
    ];
    let lastError = null;
    for (const candidate of candidates) {
        try {
            const headers = candidate.region ? { 'x-ads-region': candidate.region } : {};
            const rows = [];
            const signatures = new Set();
            let url = candidate.url;
            let offset = 0;
            for (let page = 0; rows.length < totalLimit && page < Math.ceil(totalLimit / pageLimit) + 3; page += 1) {
                const json = await fetchJson(url, token, headers);
                const pageRows = getIssueRowsFromResponse(json);
                if (!Array.isArray(pageRows) || !pageRows.length) break;
                const signature = issuePageSignature(pageRows);
                if (signature && signatures.has(signature)) break;
                signatures.add(signature);
                rows.push(...pageRows);
                if (rows.length >= totalLimit) break;

                const nextUrl = getNextIssuesPageUrl(json);
                if (nextUrl) {
                    url = nextUrl.startsWith('http') ? nextUrl : new URL(nextUrl, url).toString();
                    continue;
                }
                if (pageRows.length < pageLimit) break;
                offset += pageLimit;
                url = withQueryParam(candidate.url, 'offset', offset);
            }
            return dedupeIssueRows(rows).slice(0, totalLimit);
        } catch (err) {
            lastError = err;
            console.warn('[Forma Issues] issue fetch failed:', candidate.url, candidate.region || 'default', err.message);
        }
    }
    throw lastError || new Error('Unable to fetch Forma issues.');
}

function mergeIssueDetail(listIssue, detailIssue) {
    if (!detailIssue || typeof detailIssue !== 'object') return listIssue;
    const detail = detailIssue.data || detailIssue.issue || detailIssue.result || detailIssue;
    if (!detail || typeof detail !== 'object') return listIssue;
    const keepListValue = (...paths) => {
        for (const pathKey of paths) {
            const value = pick(listIssue, [pathKey], '');
            if (value !== undefined && value !== null && String(value).trim() !== '') return value;
        }
        return undefined;
    };
    const listTypeId = keepListValue('issueTypeId', 'attributes.issueTypeId', 'typeId', 'attributes.typeId');
    const listSubtypeId = keepListValue('issueSubtypeId', 'attributes.issueSubtypeId', 'subtypeId', 'attributes.subtypeId');
    const listTypePath = keepListValue('typePath', 'issueTypePath', 'categoryPath', 'attributes.typePath', 'attributes.issueTypePath', 'attributes.categoryPath');
    return {
        ...listIssue,
        ...detail,
        ...(listTypeId ? { issueTypeId: listTypeId } : {}),
        ...(listSubtypeId ? { issueSubtypeId: listSubtypeId } : {}),
        ...(listTypePath ? { typePath: listTypePath } : {}),
        attributes: {
            ...(listIssue.attributes || {}),
            ...(detail.attributes || {}),
            ...(listTypeId ? { issueTypeId: listTypeId } : {}),
            ...(listSubtypeId ? { issueSubtypeId: listSubtypeId } : {}),
            ...(listTypePath ? { typePath: listTypePath } : {})
        },
        rawListIssue: listIssue,
        rawDetailIssue: detailIssue
    };
}

async function fetchFormaIssueDetail(issue, projectId, containerId, token) {
    const id = issue.id || issue.issueId || issue.attributes?.id;
    if (!id) return null;
    const cacheKey = `${projectId}|${containerId || ''}|${id}`;
    const cached = formaIssueDetailCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const projectIds = projectIdCandidates(projectId);
    const regions = ['', 'US', 'EMEA'];
    const candidates = [
        ...projectIds.flatMap(projectCandidate => regions.flatMap(region => [
            {
                url: `https://developer.api.autodesk.com/construction/issues/v1/projects/${encodeURIComponent(projectCandidate)}/issues/${encodeURIComponent(id)}`,
                region
            },
            {
                url: `https://developer.api.autodesk.com/construction/issues/v1/projects/${encodeURIComponent(projectCandidate)}/issues/${encodeURIComponent(id)}?include=linkedDocuments,references,attachments`,
                region
            },
            {
                url: `https://developer.api.autodesk.com/construction/issues/v2/projects/${encodeURIComponent(projectCandidate)}/issues/${encodeURIComponent(id)}`,
                region
            },
            {
                url: `https://developer.api.autodesk.com/construction/issues/v2/projects/${encodeURIComponent(projectCandidate)}/issues/${encodeURIComponent(id)}?include=linkedDocuments,references,attachments`,
                region
            }
        ])),
        ...(containerId ? [
            { url: `https://developer.api.autodesk.com/issues/v2/containers/${encodeURIComponent(containerId)}/issues/${encodeURIComponent(id)}?include=linkedDocuments,references,attachments` },
            { url: `https://developer.api.autodesk.com/issues/v2/containers/${encodeURIComponent(containerId)}/issues/${encodeURIComponent(id)}` },
            { url: `https://developer.api.autodesk.com/issues/v1/containers/${encodeURIComponent(containerId)}/issues/${encodeURIComponent(id)}?include=linkedDocuments,references,attachments` },
            { url: `https://developer.api.autodesk.com/issues/v1/containers/${encodeURIComponent(containerId)}/issues/${encodeURIComponent(id)}` }
        ] : [])
    ];

    for (const candidate of candidates) {
        try {
            const headers = candidate.region ? { 'x-ads-region': candidate.region } : {};
            const json = await fetchJson(candidate.url, token, headers);
            formaIssueDetailCache.set(cacheKey, { value: json, expiresAt: Date.now() + FORMA_DETAIL_CACHE_TTL_MS });
            return json;
        } catch (_) {
            // Try the next supported issues detail endpoint.
        }
    }
    return null;
}

function projectIdForDataManagement(projectId) {
    const id = String(projectId || '').trim();
    if (!id) return id;
    return id.startsWith('b.') ? id : `b.${id}`;
}

function isAutodeskDataUrn(value) {
    const text = String(value || '').trim();
    return /^urn:adsk\./i.test(text) || /^adsk\./i.test(text);
}

function dataManagementResourceType(urn) {
    const text = String(urn || '');
    if (/fs\.file|versions/i.test(text) || /[?&]version=/i.test(text)) return 'versions';
    if (/dm\.lineage|items/i.test(text)) return 'items';
    return /version/i.test(text) ? 'versions' : 'items';
}

function dataManagementNameFromJson(json) {
    const data = json && (Array.isArray(json.results) ? json.results[0] : (json.data || json));
    return textFromValueSafe(pick(data, [
        'name',
        'uploadFileName',
        'includedVersion.name',
        'includedVersion.uploadFileName',
        'attributes.displayName',
        'attributes.name',
        'attributes.extension.data.name',
        'attributes.extension.data.fileName',
        'displayName'
    ], ''));
}

function dataManagementVersionFromJson(json) {
    const data = json && (Array.isArray(json.results) ? json.results[0] : (json.data || json));
    const versionFromTip = String(pick(data, ['tipVersionUrn'], '') || '').match(/[?&]version=(\d+)/i);
    return normalizePlacementVersion(versionFromTip && versionFromTip[1])
        || normalizePlacementVersion(pick(data, [
        'attributes.versionNumber',
        'attributes.version',
        'includedVersion.versionNumber',
        'versionNumber',
        'version'
    ], ''));
}

function dataManagementUrnFromJson(json, fallbackUrn) {
    const data = json && (Array.isArray(json.results) ? json.results[0] : (json.data || json));
    return textFromValueSafe(pick(data, [
        'tipVersionUrn',
        'includedVersion.urn',
        'attributes.extension.data.versionUrn',
        'id',
        'urn'
    ], '')) || fallbackUrn;
}

async function resolvePlacementNameFromDataManagement(urn, projectId, token) {
    if (!isAutodeskDataUrn(urn)) return null;
    const project = projectIdForDataManagement(projectId);
    const rawUrn = String(urn).startsWith('urn:') ? String(urn) : `urn:${urn}`;
    const cacheKey = `${project}|${rawUrn}`;
    const cached = placementLookupCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const encoded = encodeURIComponent(rawUrn);
    const type = dataManagementResourceType(rawUrn);
    const lineageQuery = encodeURIComponent(rawUrn);
    const candidates = [
        `https://developer.api.autodesk.com/construction/files/v1/projects/${encodeURIComponent(stripBPrefix(project))}/items:batch-get`,
        `https://developer.api.autodesk.com/construction/files/v1/projects/${encodeURIComponent(project)}/items:batch-get`,
        `https://developer.api.autodesk.com/construction/files/v1/projects/${encodeURIComponent(stripBPrefix(project))}/items?filter[urn]=${lineageQuery}`,
        `https://developer.api.autodesk.com/construction/files/v1/projects/${encodeURIComponent(project)}/items?filter[urn]=${lineageQuery}`,
        `https://developer.api.autodesk.com/construction/files/v1/projects/${encodeURIComponent(stripBPrefix(project))}/items?lineageUrn=${lineageQuery}`,
        `https://developer.api.autodesk.com/construction/files/v1/projects/${encodeURIComponent(project)}/items?lineageUrn=${lineageQuery}`,
        `https://developer.api.autodesk.com/data/v1/projects/${encodeURIComponent(project)}/${type}/${encoded}`,
        type === 'versions'
            ? `https://developer.api.autodesk.com/data/v1/projects/${encodeURIComponent(project)}/versions/${encoded}/item`
            : `https://developer.api.autodesk.com/data/v1/projects/${encodeURIComponent(project)}/items/${encoded}/tip`
    ];

    for (const url of candidates) {
        try {
            const isBatch = url.includes('items:batch-get');
            const json = isBatch
                ? await fetchJsonWithBody(url, token, { urns: [rawUrn] })
                : await fetchJson(url, token, { Accept: 'application/vnd.api+json, application/json' });
            const name = dataManagementNameFromJson(json);
            if (name && !isGenericPlacementName(name)) {
                const result = {
                    name,
                    version: dataManagementVersionFromJson(json),
                    urn: dataManagementUrnFromJson(json, rawUrn)
                };
                placementLookupCache.set(cacheKey, { value: result, expiresAt: Date.now() + PLACEMENT_LOOKUP_CACHE_TTL_MS });
                return result;
            }
        } catch (err) {
            console.warn('[Forma Issues] placement DM lookup skipped:', err.message);
        }
    }
    placementLookupCache.set(cacheKey, { value: null, expiresAt: Date.now() + Math.min(60_000, PLACEMENT_LOOKUP_CACHE_TTL_MS) });
    return null;
}

async function enrichFormaIssuesWithDetails(issues, projectId, containerId, token) {
    const rows = Array.isArray(issues) ? issues : [];
    const enriched = new Array(rows.length);
    let cursor = 0;
    const workerCount = Math.min(6, Math.max(1, rows.length));

    async function worker() {
        while (cursor < rows.length) {
            const index = cursor++;
            const issue = rows[index];
            const detail = await fetchFormaIssueDetail(issue, projectId, containerId, token);
            const merged = detail ? mergeIssueDetail(issue, detail) : issue;
            const placementInfo = normalizePlacementInfo(merged);
            if (process.env.FORMA_PLACEMENT_DEBUG === '1') {
                const issueId = merged.displayId || merged.id || merged.issueId || issue.displayId || issue.id;
                console.log('[Forma Issues] placement candidate:', {
                    issueId,
                    name: placementInfo.name || '',
                    urn: placementInfo.urn || '',
                    version: placementInfo.version || '',
                    hasPlacements: Array.isArray(merged.placements),
                    placementsCount: Array.isArray(merged.placements) ? merged.placements.length : 0,
                    hasLinkedDocuments: Array.isArray(merged.linkedDocuments),
                    linkedDocumentsCount: Array.isArray(merged.linkedDocuments) ? merged.linkedDocuments.length : 0
                });
            }
            if (!formatPlacementInfo(placementInfo) && placementInfo.urn) {
                const dmInfo = await resolvePlacementNameFromDataManagement(placementInfo.urn, projectId, token);
                enriched[index] = dmInfo
                    ? { ...merged, placementName: dmInfo.name, placementVersion: dmInfo.version, placementUrn: dmInfo.urn }
                    : merged;
            } else if (placementInfo.urn && !isModelDocumentName(placementInfo.name)) {
                const dmInfo = await resolvePlacementNameFromDataManagement(placementInfo.urn, projectId, token);
                enriched[index] = dmInfo
                    ? { ...merged, placementName: dmInfo.name, placementVersion: dmInfo.version || placementInfo.version, placementUrn: dmInfo.urn }
                    : merged;
            } else {
                enriched[index] = merged;
            }
        }
    }

    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    return enriched.map((issue, index) => issue || rows[index]);
}

function normalizeFormaIssue(issue, typeMap, userMap) {
    const attrs = issue.attributes || {};
    const typePath = normalizeTypeForForma(issue, typeMap);
    const placementInfo = normalizePlacementInfo(issue);
    const assigneeRaw = pick(issue, ['assignedTo', 'assignee', 'assignedToUser', 'attributes.assignedTo', 'attributes.assignee', 'attributes.assignedToUser'], '');
    const creatorRaw = pick(issue, ['createdBy', 'createdByUser', 'creator', 'attributes.createdBy', 'attributes.createdByUser', 'attributes.creator'], '');
    const reviewerRaw = getReviewerRaw(issue);
    const attachments = pick(issue, ['attachments', 'attributes.attachments'], []);
    const refs = pick(issue, ['references', 'attributes.references', 'linkedDocuments'], []);
    const comments = pick(issue, ['comments', 'attributes.comments'], []);
    const id = issue.id || attrs.id || issue.issueId || issue.displayId || attrs.displayId;
    const displayId = issue.displayId || attrs.displayId || issue.issueNumber || attrs.identifier || id;

    return {
        _source: 'forma',
        _type: 'forma',
        id,
        displayId,
        dbId: displayId,
        title: pick(issue, ['title', 'attributes.title', 'name', 'attributes.name'], '제목 없음'),
        status: normalizeStatus(pick(issue, ['status', 'attributes.status', 'state', 'attributes.state'], '생성')),
        type: typePath,
        typePath,
        category: typePath,
        description: pick(issue, ['description', 'attributes.description', 'details', 'attributes.details'], ''),
        result: getIssueResultValue(issue),
        location: normalizeLocation(issue),
        assignee: displayUser(assigneeRaw, userMap),
        creator: displayUser(creatorRaw, userMap),
        reviewer: displayUser(reviewerRaw, userMap),
        createdAt: pick(issue, ['createdAt', 'attributes.createdAt', 'createdDate', 'attributes.createdDate'], ''),
        dueDate: getScheduleDueDateValue(issue),
        startDate: getScheduleStartDateValue(issue),
        placement: formatPlacementInfo(placementInfo),
        placementName: placementInfo.name,
        placementVersion: placementInfo.version,
        placementUrn: placementInfo.urn,
        snapshotUrn: normalizeSnapshotUrn(issue),
        attachments: Array.isArray(attachments) ? attachments.length : (attachments ? String(attachments) : ''),
        references: Array.isArray(refs) ? refs.length : (refs ? String(refs) : ''),
        comments: Array.isArray(comments) ? comments.length : (comments ? String(comments) : ''),
        rawFormaIssue: issue
    };
}

// Handlebars 헬퍼
function normalizeFormaIssueForTable(issue, typeMap, userMap, locationMap = new Map()) {
    const attrs = issue.attributes || {};
    const typePath = normalizeTypeForForma(issue, typeMap);
    const placementInfo = normalizePlacementInfo(issue);
    const assigneeRaw = pick(issue, ['assignedTo', 'assignee', 'assignedToUser', 'attributes.assignedTo', 'attributes.assignee', 'attributes.assignedToUser'], '');
    const creatorRaw = pick(issue, ['createdBy', 'createdByUser', 'creator', 'attributes.createdBy', 'attributes.createdByUser', 'attributes.creator'], '');
    const reviewerRaw = getReviewerRaw(issue);
    const attachments = pick(issue, ['attachments', 'attributes.attachments'], []);
    const refs = pick(issue, ['references', 'attributes.references', 'linkedDocuments'], []);
    const comments = pick(issue, ['comments', 'attributes.comments'], []);
    const id = issue.id || attrs.id || issue.issueId || issue.displayId || attrs.displayId;
    const displayId = issue.displayId || attrs.displayId || issue.issueNumber || attrs.identifier || id;
    const linkedDocDetails = (issue.linkedDocuments && issue.linkedDocuments[0] && issue.linkedDocuments[0].details) || {};
    const objectId = linkedDocDetails.objectId || pick(issue, ['objectId', 'elementId'], null);

    return {
        _source: 'forma',
        _type: 'forma',
        id,
        displayId,
        objectId,
        dbId: objectId || displayId,
        title: pick(issue, ['title', 'attributes.title', 'name', 'attributes.name'], '제목 없음'),
        status: normalizeStatus(pick(issue, ['status', 'attributes.status', 'state', 'attributes.state'], '생성')),
        type: typePath,
        typePath,
        category: typePath,
        description: pick(issue, ['description', 'attributes.description', 'details', 'attributes.details'], ''),
        result: getIssueResultValue(issue),
        location: normalizeLocationForForma(issue, locationMap),
        assignee: displayUser(assigneeRaw, userMap),
        creator: displayUser(creatorRaw, userMap),
        reviewer: displayUser(reviewerRaw, userMap),
        createdAt: pick(issue, ['createdAt', 'attributes.createdAt', 'createdDate', 'attributes.createdDate'], ''),
        dueDate: getScheduleDueDateValue(issue),
        startDate: getScheduleStartDateValue(issue),
        placement: formatPlacementInfo(placementInfo),
        placementName: placementInfo.name,
        placementVersion: placementInfo.version,
        placementUrn: placementInfo.urn,
        snapshotUrn: normalizeSnapshotUrn(issue),
        attachments: Array.isArray(attachments) ? attachments.length : (attachments ? String(attachments) : ''),
        references: Array.isArray(refs) ? refs.length : (refs ? String(refs) : ''),
        comments: Array.isArray(comments) ? comments.length : (comments ? String(comments) : ''),
        rawFormaIssue: issue
    };
}

if (handlebars) {
    handlebars.registerHelper('eq', (a, b) => a === b);
}

// GET: Fetch all issues
router.get('/api/issues', (req, res) => {
    try {
        const dataPath = path.join(__dirname, '..', 'data', 'issues.json');
        if (!fs.existsSync(dataPath)) {
            return res.json([]);
        }
        const data = fs.readFileSync(dataPath, 'utf8');
        res.json(JSON.parse(data || '[]'));
    } catch (err) {
        res.status(500).json({ error: 'Failed to read issues' });
    }
});

// GET: Forma/ACC issues for Gangbuk project, normalized for the main Issues tab.
router.get('/api/issues/forma-gangbuk', authRefreshMiddleware, async (req, res) => {
    const token = req.internalOAuthToken && req.internalOAuthToken.access_token;
    const hubId = req.query.hubId || req.query.hub_id || GANGBUK_HUB_ID;
    const projectId = req.query.projectId || req.query.project_id || GANGBUK_PROJECT_ID;
    const limit = req.query.limit || 300;
    const debugPlacement = req.query.debugPlacement === '1' || req.query.debug_placement === '1';
    const forceRefresh = req.query.refresh === '1' || req.query.force === '1' || debugPlacement;
    const categoryFilter = String(req.query.category || req.query.type || '').trim().toLowerCase();
    const gunhwaOnly = req.query.gunhwa === '1' || categoryFilter === 'gunhwa' || categoryFilter === '\uac74\ud654';
    const workScheduleOnly = req.query.workSchedule === '1' || req.query.work_schedule === '1';
    const includeGunhwa = gunhwaOnly || req.query.includeGunhwa === '1' || req.query.include_gunhwa === '1';
    const cacheKey = `${hubId}|${projectId}|${limit}|${includeGunhwa ? 'with-gunhwa' : 'without-gunhwa'}|${gunhwaOnly ? 'gunhwa-only' : 'all-visible'}|${workScheduleOnly ? 'work-schedule-fast-v8-without-gunhwa' : 'main'}`;
    const cacheTtlMs = workScheduleOnly ? Math.max(FORMA_ISSUES_CACHE_TTL_MS, 10 * 60 * 1000) : FORMA_ISSUES_CACHE_TTL_MS;

    try {
        const cached = formaIssuesCache.get(cacheKey);
        if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
            return res.json({
                ...cached.value,
                meta: {
                    ...(cached.value.meta || {}),
                    cache: true,
                    cacheExpiresAt: new Date(cached.expiresAt).toISOString()
                }
            });
        }
        const containerId = await getIssueContainerInfo(hubId, projectId, token).catch(err => {
            console.warn('[Forma Issues] issue container lookup failed:', err.message);
            return null;
        });
        const [userMap, typeMap, locationMap, rawIssues] = workScheduleOnly
            ? await Promise.all([
                fetchProjectMembers(projectId, token),
                fetchIssueTypeMap(projectId, containerId, token),
                fetchLocationMap(hubId, projectId, token),
                fetchFormaIssues(projectId, containerId, token, limit)
            ])
            : await Promise.all([
                fetchProjectMembers(projectId, token),
                fetchIssueTypeMap(projectId, containerId, token),
                fetchLocationMap(hubId, projectId, token),
                fetchFormaIssues(projectId, containerId, token, limit)
            ]);
        // 업무 일정 표에는 목록 API의 필드만 필요하므로 상세/배치명 조회를 건너뛰어 초기 로딩을 줄인다.
        const sourceIssues = workScheduleOnly
            ? rawIssues
            : await enrichFormaIssuesWithDetails(rawIssues, projectId, containerId, token);
        const toCategoryText = (value) => {
            if (!value) return '';
            if (Array.isArray(value)) return value.map(toCategoryText).filter(Boolean).join(' > ');
            if (typeof value === 'object') {
                return value.path || value.typePath || value.issueTypePath || value.categoryPath ||
                    value.parentName || value.categoryName || value.issueTypeName || value.typeName ||
                    value.fullName || value.displayName || value.title || value.name || value.text || value.value || '';
            }
            return String(value).trim();
        };
        const getPathValue = (source, path) => {
            let cur = source;
            for (const part of String(path).split('.')) {
                if (!cur || typeof cur !== 'object') return '';
                cur = cur[part];
            }
            return toCategoryText(cur);
        };
        const categoryCandidatesForSchedule = (issue, normalizedIssue) => {
            const raw = issue && (issue.rawDetailIssue || issue.rawFormaIssue || issue);
            const paths = [
                'typePath', 'issueTypePath', 'categoryPath', 'issueCategoryPath',
                'attributes.typePath', 'attributes.issueTypePath', 'attributes.categoryPath', 'attributes.issueCategoryPath',
                'type.name', 'type.title', 'issueType.name', 'issueType.title',
                'category.name', 'category.title', 'issueCategory.name', 'issueCategory.title',
                'attributes.type.name', 'attributes.type.title', 'attributes.issueType.name', 'attributes.issueType.title',
                'attributes.category.name', 'attributes.category.title', 'attributes.issueCategory.name', 'attributes.issueCategory.title'
            ];
            const nested = [];
            const seen = new Set();
            const collectNestedCategoryValues = (value, keyHint = '') => {
                if (!value || typeof value !== 'object' || seen.has(value)) return;
                seen.add(value);
                if (Array.isArray(value)) {
                    value.forEach(item => collectNestedCategoryValues(item, keyHint));
                    return;
                }
                Object.entries(value).forEach(([key, child]) => {
                    const keyLower = String(key || '').toLowerCase();
                    const nextHint = keyHint || (/categorypath|issuecategory|category|typepath|issuetypepath/.test(keyLower) ? keyLower : '');
                    if (nextHint) {
                        const text = toCategoryText(child);
                        if (text) nested.push(text);
                    }
                    if (child && typeof child === 'object') collectNestedCategoryValues(child, nextHint);
                });
            };
            collectNestedCategoryValues(raw);
            return [
                normalizedIssue && normalizedIssue.typePath,
                normalizedIssue && normalizedIssue.category,
                normalizeTypeForForma(issue, typeMap),
                ...paths.map(path => getPathValue(raw, path)),
                ...nested
            ].map(toCategoryText).filter(Boolean);
        };
        const categorySegments = (text) => String(text || '')
            .normalize('NFC')
            .split(/\s*>\s*|\s*\/\s*/)
            .map(part => part.trim().toLowerCase())
            .filter(Boolean);
        const isGunhwaIssueServer = (issue, normalizedIssue) => {
            return categoryCandidatesForSchedule(issue, normalizedIssue).some(text => {
                const segments = categorySegments(text);
                return segments[0] === '\uac74\ud654';
            });
        };
        const isUpdateIssueServer = (issue, normalizedIssue) => {
            return categoryCandidatesForSchedule(issue, normalizedIssue).some(text => {
                const segments = categorySegments(text);
                return segments[0] === '\uc774\uc288' &&
                    (segments[1] === '\uc5c5\ub370\uc774\ud2b8' || segments[1] === 'update');
            });
        };

        const scheduleCandidates = workScheduleOnly
            ? sourceIssues
                .map(issue => {
                    const normalizedIssue = normalizeFormaIssueForTable(issue, typeMap, userMap, locationMap);
                    return {
                        issue,
                        isGunhwa: isGunhwaIssueServer(issue, normalizedIssue),
                        isUpdate: isUpdateIssueServer(issue, normalizedIssue)
                    };
                })
                .filter(item => !item.isGunhwa)
            : [];
        const normalizedSourceIssues = workScheduleOnly
            ? await enrichFormaIssuesWithDetails(scheduleCandidates.map(item => item.issue), projectId, containerId, token)
            : sourceIssues;
        const normalized = normalizedSourceIssues
            .map((issue, index) => {
                const normalizedIssue = normalizeFormaIssueForTable(issue, typeMap, userMap, locationMap);
                const scheduleCandidate = workScheduleOnly ? scheduleCandidates[index] : null;
                return {
                    normalizedIssue,
                    isGunhwa: scheduleCandidate ? scheduleCandidate.isGunhwa : isGunhwaIssueServer(issue, normalizedIssue),
                    isUpdate: scheduleCandidate ? scheduleCandidate.isUpdate : isUpdateIssueServer(issue, normalizedIssue)
                };
            })
            .filter(item => {
                const isGunhwa = item.isGunhwa;
                if (workScheduleOnly) return !isGunhwa;
                if (gunhwaOnly) return isGunhwa;
                return includeGunhwa || !isGunhwa;
            })
            .map(item => ({
                ...item.normalizedIssue,
                workScheduleCategory: item.isGunhwa ? '건화' : (item.isUpdate ? '업데이트' : ''),
                rawCategoryMatched: item.isGunhwa
            }));
        const placementDebug = debugPlacement
            ? sourceIssues
                .map((issue, index) => buildPlacementDebug(issue, normalizeFormaIssueForTable(issue, typeMap, userMap, locationMap)))
                .filter(item => item.normalizedPlacement === '-' || !item.normalizedPlacement || item.normalizedPlacement === 'Docs' || item.rawPaths.length || item.detailPaths.length)
                .slice(0, 25)
            : undefined;

        const payload = {
            data: normalized,
            meta: {
                hubId,
                projectId,
                containerId,
                count: normalized.length,
                rawCount: rawIssues.length,
                enrichedCount: normalizedSourceIssues.filter(issue => issue && issue.rawDetailIssue).length,
                fastMode: workScheduleOnly,
                cache: false,
                fetchedAt: new Date().toISOString(),
                ...(debugPlacement ? { placementDebug } : {}),
                categoryFilter: workScheduleOnly ? 'workSchedule' : (gunhwaOnly ? '건화' : 'default'),
                excludedCategory: includeGunhwa ? null : '건화'
            }
        };
        if (!debugPlacement) {
            formaIssuesCache.set(cacheKey, { value: payload, expiresAt: Date.now() + cacheTtlMs });
        }
        res.json(payload);
    } catch (err) {
        console.error('[Forma Issues] fetch failed:', err.message);
        res.status(502).json({
            error: 'Failed to fetch Forma issues',
            message: err.message,
            data: []
        });
    }
});

router.get('/api/issues/forma-gangbuk/:issueId/placement-debug', authRefreshMiddleware, async (req, res) => {
    const token = req.internalOAuthToken && req.internalOAuthToken.access_token;
    const hubId = req.query.hubId || req.query.hub_id || GANGBUK_HUB_ID;
    const projectId = req.query.projectId || req.query.project_id || GANGBUK_PROJECT_ID;
    const issueId = req.params.issueId;

    try {
        const containerId = await getIssueContainerInfo(hubId, projectId, token).catch(() => null);
        const detail = await fetchFormaIssueDetail({ id: issueId }, projectId, containerId, token);
        const issue = detail && (detail.data || detail.issue || detail.result || detail);
        const placementInfo = normalizePlacementInfo(issue || {});
        let dmInfo = null;
        if (placementInfo.urn) {
            dmInfo = await resolvePlacementNameFromDataManagement(placementInfo.urn, projectId, token).catch(err => ({
                error: err.message
            }));
        }
        const merged = dmInfo && !dmInfo.error
            ? { ...(issue || {}), placementName: dmInfo.name, placementVersion: dmInfo.version, placementUrn: dmInfo.urn }
            : (issue || {});
        const normalized = normalizeFormaIssueForTable(merged, new Map(), new Map(), new Map());
        res.json({
            issueId,
            projectId,
            containerId,
            placementInfo,
            dmInfo,
            normalized: {
                placement: normalized.placement,
                placementName: normalized.placementName,
                placementVersion: normalized.placementVersion,
                placementUrn: normalized.placementUrn,
                type: normalized.type,
                typePath: normalized.typePath
            },
            placements: issue && issue.placements,
            linkedDocuments: issue && issue.linkedDocuments,
            rawPaths: collectPlacementDebugPaths(issue || {})
        });
    } catch (err) {
        res.status(502).json({
            error: 'Failed to debug Forma placement',
            message: err.message
        });
    }
});

router.get('/api/issues/snapshot', authRefreshMiddleware, async (req, res) => {
    const token = req.internalOAuthToken && req.internalOAuthToken.access_token;
    const urn = String(req.query.urn || '').trim();
    if (!urn) return res.status(400).json({ error: 'snapshot urn is required' });

    try {
        const image = await fetchSnapshotImage(urn, token);
        res.setHeader('Content-Type', image.contentType);
        res.setHeader('Cache-Control', 'private, max-age=600');
        res.send(image.buffer);
    } catch (err) {
        console.warn('[Forma Issues] snapshot fetch failed:', err.message);
        res.status(404).json({
            error: 'SnapshotNotFound',
            message: err.message
        });
    }
});

// POST: Add or Update issue
router.post('/api/issues', (req, res) => {
    try {
        const dataPath = path.join(__dirname, '..', 'data', 'issues.json');
        const issues = fs.existsSync(dataPath) ? JSON.parse(fs.readFileSync(dataPath, 'utf8') || '[]') : [];

        const newIssue = req.body;
        const index = issues.findIndex(i => i.id === newIssue.id);

        if (index !== -1) {
            issues[index] = { ...issues[index], ...newIssue, updatedAt: new Date().toISOString() };
        } else {
            issues.push({ ...newIssue, createdAt: new Date().toISOString() });
        }

        fs.writeFileSync(dataPath, JSON.stringify(issues, null, 2), 'utf8');
        res.status(201).json(newIssue);
    } catch (err) {
        console.error('[Issues API] Save error:', err);
        res.status(500).json({ error: 'Failed to save issue' });
    }
});

// DELETE: Remove issue
router.delete('/api/issues/:id', (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const dataPath = path.join(__dirname, '..', 'data', 'issues.json');
        if (!fs.existsSync(dataPath)) return res.status(404).json({ error: 'Not found' });

        let issues = JSON.parse(fs.readFileSync(dataPath, 'utf8') || '[]');
        issues = issues.filter(i => i.id !== id);

        fs.writeFileSync(dataPath, JSON.stringify(issues, null, 2), 'utf8');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete issue' });
    }
});

// ── POST /api/issues/export-hwpx ────────────────────────────────
router.post('/api/issues/export-hwpx', hwpxRateLimit, authRefreshMiddleware, asyncHandler(async (req, res) => {
    const data = req.body || {};
    const issuesRaw = Array.isArray(data.issues) ? data.issues : [];
    if (!issuesRaw.length) throw new AppError('내보낼 이슈가 없습니다.', 400, 'VALIDATION_ERROR');

    const exportKind = String(data.reportKind || data.filter || '').toLowerCase();
    const isUpdateExportRequest = exportKind === 'update';
    const isBimReviewExportRequest = exportKind === 'bim-review' || exportKind === 'review';
    const updateIssues = isUpdateExportRequest ? issuesRaw : issuesRaw.filter(issue => {
        const typeText = [
            issue.exportIssueType,
            issue.type,
            issue.issueType,
            issue.category,
            issue.typePath,
            issue.workScheduleCategory,
            issue.kind,
            issue.label
        ].map(value => {
            if (!value) return '';
            if (typeof value === 'object') return value.name || value.text || value.title || '';
            return String(value);
        }).join(' ').toLowerCase();
        return typeText.includes('업데이트') || typeText.includes('update');
    });
    const bimReviewIssues = isBimReviewExportRequest ? issuesRaw : issuesRaw.filter(isBimReviewIssue);

    const token = req.internalOAuthToken && req.internalOAuthToken.access_token;
    let hwpxBuffer;
    let filenameBase;
    if (isBimReviewExportRequest) {
        if (!bimReviewIssues.length) throw new AppError('설계 이슈 또는 간섭 이슈가 없습니다.', 400, 'VALIDATION_ERROR');
        hwpxBuffer = await createBimReviewIssuesHwpx(bimReviewIssues, data.title || 'BIM기반 검토 보고서');
        filenameBase = 'BIM기반_검토_보고서';
    } else {
        if (!updateIssues.length) throw new AppError('업데이트 구분 이슈가 없습니다.', 400, 'VALIDATION_ERROR');
        hwpxBuffer = await createUpdateIssuesHwpx(updateIssues, data.title || 'BIM 모델 작성 보고서', token);
        filenameBase = 'BIM_모델_작성_보고서';
    }
    const filename = encodeURIComponent(`${filenameBase}_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.hwpx`);
    res.setHeader('Content-Type', 'application/hwp+zip');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    res.setHeader('Content-Length', String(hwpxBuffer.length));
    res.send(hwpxBuffer);
}));

// ── POST /api/issues/export-pdf ────────────────────────────────
router.post('/api/issues/export-pdf', pdfRateLimit, asyncHandler(async (req, res) => {
    const data = req.body || {};
    console.log('[Issues PDF] Export requested.');

    // Normalize: support both single-issue and array-of-issues
    const issuesRaw = Array.isArray(data.issues) ? data.issues : [data];
    if (!issuesRaw.length) throw new AppError('이슈 데이터가 비어 있습니다.', 400, 'VALIDATION_ERROR');

    const title = data.title || '이슈 해결 결과 보고서';
    const logoBase64 = data.logoBase64 || '';

    // [Field Selector] Build field visibility flags
    const rawSf = data.selectedFields || data.sf || {};
    const sf = {
        no: rawSf.no !== false && String(rawSf.no) !== 'false',
        structure: rawSf.structure !== false && String(rawSf.structure) !== 'false',
        work_type: rawSf.work_type !== false && String(rawSf.work_type) !== 'false',
        description: rawSf.description !== false && String(rawSf.description) !== 'false',
        resolution: rawSf.resolution !== false && String(rawSf.resolution) !== 'false',
        screenshot: rawSf.screenshot !== false && String(rawSf.screenshot) !== 'false'
    };

    // Pre-compute combined flag for use in HBS
    sf.hasMetaRow = sf.no || sf.structure || sf.work_type;

    // Calculate layout properties
    let totalColsCount = 0;
    if (sf.no) totalColsCount += 2;
    if (sf.structure) totalColsCount += 2;
    if (sf.work_type) totalColsCount += 2;

    sf.colspan = Math.max(1, totalColsCount - 1);
    sf.totalCols = Math.max(1, totalColsCount);
    sf.halfCols = Math.max(1, Math.floor(totalColsCount / 2));

    // Map each raw issue to the template fields
    const issues = issuesRaw.map((issue, idx) => {
        // [Greedy Extraction Strategy]
        const rawStruct = (issue.structure_name || issue.structureName || issue.structure || issue.struct || issue.Structure || '').toString().trim();
        const rawWork = (issue.work_type || issue.workType || issue.work_Type || issue.worktype || issue.WorkType || '').toString().trim();

        const valStruct = rawStruct || '-';
        const valWork = rawWork || '-';
        const valIssueNum = (issue.issue_number || issue.issueNumber || issue.dbId || issue.id || (idx + 1)).toString().trim();

        return {
            issueId: valIssueNum,
            status: issue.status || 'Open',
            pdf_structure: valStruct,
            pdf_work_type: valWork,
            description: issue.description || '내용 없음',
            resolution_description: issue.resolutionDesc || issue.resolution_description || '내용 없음',
            thumbnail: issue.thumbnail || '',
            after_snapshot_url: issue.afterThumbnail || issue.after_snapshot_url || '',
            isDualImage: (issue.isComparison === true || issue.isComparison === 'true') || (issue.status === 'Closed'),
            versionA: issue.versionA || 'Before',
            versionB: issue.versionB || 'After',
            imageTableRows: issue.imageTableRows || ''
        };
    });

    const templateData = { title, logoBase64, issues, sf };
    const templatePath = path.join(__dirname, '..', 'views', 'issue-report.hbs');

    const templateHtml = fs.readFileSync(templatePath, 'utf8');
    const template = handlebars.compile(templateHtml);
    const html = template(templateData);

    // Puppeteer: Windows/ngrok 환경 호환성 유지, 안전한 타임아웃
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        timeout: 90000
    });

    try {
        const page = await browser.newPage();
        page.setDefaultNavigationTimeout(90000);
        await page.setContent(html, { waitUntil: 'networkidle0', timeout: 90000 });

        const pdfBuffer = await page.pdf({
            format: 'A4',
            landscape: true,
            printBackground: true,
            margin: { top: '0', right: '0', bottom: '0', left: '0' },
        });

        const filename = issues.length === 1
            ? `issue_report_${issuesRaw[0].id || 'export'}.pdf`
            : `issue_report_batch_${Date.now()}.pdf`;

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(Buffer.from(pdfBuffer));
    } finally {
        await browser.close().catch(() => {});
    }
}));



async function getGangbukIssuesCache() {
    try {
        for (const [key, cached] of formaIssuesCache.entries()) {
            if (cached && cached.value && Array.isArray(cached.value.data) && cached.value.data.length > 0) {
                return cached.value.data;
            }
        }
        const dataPath = path.join(__dirname, '..', 'data', 'issues.json');
        if (fs.existsSync(dataPath)) {
            const data = fs.readFileSync(dataPath, 'utf8');
            const parsed = JSON.parse(data || '[]');
            if (Array.isArray(parsed) && parsed.length > 0) {
                return parsed;
            }
        }
    } catch (err) {
        console.warn('[Issues] getGangbukIssuesCache error:', err.message);
    }
    return [];
}

router.getGangbukIssuesCache = getGangbukIssuesCache;
module.exports = router;
module.exports.getGangbukIssuesCache = getGangbukIssuesCache;

