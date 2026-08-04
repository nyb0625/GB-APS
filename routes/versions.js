const express = require('express');
const router = express.Router();
const axios = require('axios');
const zlib = require('zlib');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const { readMemos, writeMemos } = require('../utils/memo-store.js');
const { authRefreshMiddleware } = require('../services/aps.js');

const CACHE_PATH = path.join(__dirname, '../data/diff-cache.json');

// Helper to read cache
function readDiffCache() {
    try {
        if (fs.existsSync(CACHE_PATH)) {
            const data = fs.readFileSync(CACHE_PATH, 'utf-8');
            return JSON.parse(data);
        }
    } catch (e) {
        console.error('[Cache] Error reading diff cache:', e.message);
    }
    return {};
}

// Helper to write cache (Atomic Write via temp file)
function writeDiffCache(cache) {
    try {
        const dir = path.dirname(CACHE_PATH);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        const tempPath = CACHE_PATH + '.tmp';
        fs.writeFileSync(tempPath, JSON.stringify(cache, null, 2), 'utf-8');
        fs.renameSync(tempPath, CACHE_PATH);
    } catch (e) {
        console.error('[Cache] Error writing diff cache:', e.message);
    }
}

// Helper: axios wrapper with automatic 429 retry (5 retries, backoff)
async function axiosWithRetry(options, retries = 5, delay = 6000) {
    try {
        return await axios(options);
    } catch (err) {
        if (err.response?.status === 429 && retries > 0) {
            const retryAfterHeader = err.response.headers?.['retry-after'];
            let waitTime = delay;
            if (retryAfterHeader) {
                const parsed = parseInt(retryAfterHeader, 10);
                if (!isNaN(parsed)) {
                    waitTime = parsed * 1000 + 1000;
                }
            }
            console.warn(`[Diff Retry] 429 Too Many Requests received. Waiting ${waitTime}ms before retry. Retries remaining: ${retries}`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            return axiosWithRetry(options, retries - 1, delay * 1.5);
        }
        throw err;
    }
}

// ─────────────────────────────────────────────────────────────
// APS Model Properties API — Version Diff  (reference:
//   github.com/autodesk-platform-services/aps-model.properties-versions.difference)
//
// Flow (all server-side — client gets final result in ONE call):
//   POST /diff/run  →  batchStatus → poll GET /diffs/:id → download /fields + /properties → parse → respond
// ─────────────────────────────────────────────────────────────

const APS_INDEX_BASE = 'https://developer.api.autodesk.com/construction/index/v2/projects';

// Helper: strip "b." prefix Autodesk Docs adds to project IDs
function cleanProject(projectId) {
    return projectId.startsWith('b.') ? projectId.slice(2) : projectId;
}

// Helper: decode Base64-encoded "urn:adsk..." version URNs that front-end may send
function decodeUrn(urn) {
    if (!urn || urn.startsWith('urn:')) return urn;
    try {
        const decoded = Buffer.from(urn, 'base64').toString('utf-8');
        if (decoded.startsWith('urn:')) return decoded;
    } catch (_) {}
    return urn;
}

// Helper: fetch a URL with auth, returns a raw Buffer (handles gzip transparently)
async function fetchBuffer(url, accessToken) {
    const resp = await axios.get(url, {
        responseType: 'arraybuffer',
        headers: { Authorization: `Bearer ${accessToken}` }
    });
    const buf = Buffer.from(resp.data);
    // Decompress if gzip magic bytes
    if (buf.length > 1 && buf[0] === 0x1f && buf[1] === 0x8b) {
        return zlib.gunzipSync(buf);
    }
    return buf;
}

// Helper: parse NDJSON (newline-delimited JSON) into array of objects
function parseNDJSON(text) {
    const results = [];
    for (const line of text.split('\n')) {
        const t = line.trim();
        if (!t) continue;
        try { results.push(JSON.parse(t)); } catch (_) {}
    }
    return results;
}

// Helper: download and parse NDJSON data as stream (handles paging and gzip decompression)
async function downloadAndParseNDJSONStream(baseUrl, accessToken, onLineCallback) {
    let cursor = null;
    let hasMore = true;

    while (hasMore) {
        const url = cursor ? `${baseUrl}?cursor=${encodeURIComponent(cursor)}` : baseUrl;
        
        if (url.startsWith('https://developer.api.autodesk.com')) {
            console.log(`[Diff Stream] Resolving 302 redirect for: ${url}`);
            let redirectUrl = null;
            try {
                const redirectCheck = await axios({
                    method: 'get',
                    url: url,
                    headers: { Authorization: `Bearer ${accessToken}` },
                    maxRedirects: 0,
                    validateStatus: (status) => status >= 200 && status < 400
                });
                if (redirectCheck.status === 302 || redirectCheck.status === 307 || redirectCheck.status === 301) {
                    redirectUrl = redirectCheck.headers.location;
                } else {
                    console.log(`[Diff Stream] Endpoint returned ${redirectCheck.status} directly. Proceeding with stream download.`);
                    redirectUrl = url;
                }
            } catch (err) {
                if (err.response && (err.response.status === 302 || err.response.status === 307 || err.response.status === 301)) {
                    redirectUrl = err.response.headers.location;
                } else {
                    throw err;
                }
            }

            console.log('[Diff Stream] Resolved Redirect Location:', redirectUrl);
            if (!redirectUrl || redirectUrl === url) {
                redirectUrl = url;
            }
            return downloadAndParseNDJSONStream(redirectUrl, accessToken, onLineCallback);
        }

        console.log(`[Diff Stream] Requesting Stream: ${url}`);
        let response;
        const isAutodeskEndpoint = url.startsWith('https://developer.api.autodesk.com');
        try {
            const requestOptions = {
                method: 'get',
                url: url,
                responseType: 'stream'
            };
            if (isAutodeskEndpoint) {
                requestOptions.headers = { Authorization: `Bearer ${accessToken}` };
            }
            response = await axiosWithRetry(requestOptions);
        } catch (err) {
            if (isAutodeskEndpoint) {
                console.warn(`[Diff Stream] Request failed with auth, trying fallback without Auth...`, err.message);
                response = await axiosWithRetry({
                    method: 'get',
                    url: url,
                    responseType: 'stream'
                });
            } else {
                throw err;
            }
        }

        const headers = response.headers || {};

        await new Promise((resolve, reject) => {
            const safetyTimeout = setTimeout(() => {
                reject(new Error('Stream pipeline hung up - 180s Timeout triggered'));
            }, 180000);

            const inputStream = response.data;
            const stream = zlib.createGunzip();

            inputStream.pipe(stream);

            const lineReader = readline.createInterface({
                input: stream,
                crlfDelay: Infinity,
                terminal: false
            });

            lineReader.on('line', (line) => {
                const t = line.trim();
                if (!t) return;
                try {
                    const obj = JSON.parse(t);
                    onLineCallback(obj);
                } catch (e) {
                    console.error('[Backend] Line parse error:', e.message);
                }
            });

            lineReader.on('close', () => {
                clearTimeout(safetyTimeout);
                resolve();
            });

            inputStream.on('error', (err) => {
                clearTimeout(safetyTimeout);
                reject(err);
            });

            stream.on('error', (err) => {
                clearTimeout(safetyTimeout);
                reject(err);
            });
        });

        // Extract cursor from headers
        const link = headers['link'] || headers['Link'];
        const xCursor = headers['x-cursor'] || headers['x-cursor-token'];
        
        if (xCursor) {
            cursor = xCursor;
        } else if (link) {
            const match = link.match(/cursor=([^&>]+)/);
            if (match && link.includes('rel="next"')) {
                cursor = match[1];
            } else {
                hasMore = false;
            }
        } else {
            hasMore = false;
        }
    }
}

// Helper: 페이징을 처리하여 모든 properties/fields NDJSON 데이터를 병합 후 반환
async function fetchAllDiffData(baseUrl, accessToken) {
    let allData = [];
    let cursor = null;
    let hasMore = true;

    while (hasMore) {
        // cursor가 있으면 쿼리 파라미터로 추가
        const url = cursor ? `${baseUrl}?cursor=${encodeURIComponent(cursor)}` : baseUrl;
        
        console.log(`[Diff] Requesting API: ${url}`);
        
        let buf;
        let headers = {};
        try {
            const resp = await axios.get(url, {
                responseType: 'arraybuffer',
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            buf = Buffer.from(resp.data);
            headers = resp.headers || {};
        } catch (err) {
            console.warn(`[Diff] Request failed with auth, trying fallback without Auth...`, err.message);
            const fallbackResp = await axios.get(url, { responseType: 'arraybuffer' });
            buf = Buffer.from(fallbackResp.data);
            headers = fallbackResp.headers || {};
        }
        
        // Decompress if gzip magic bytes
        if (buf.length > 1 && buf[0] === 0x1f && buf[1] === 0x8b) {
            buf = zlib.gunzipSync(buf);
        }
        
        const parsed = parseNDJSON(buf.toString('utf-8'));
        allData = allData.concat(parsed);
        console.log(`[Diff] Loaded ${parsed.length} rows. Total accumulated: ${allData.length}`);

        // Link 헤더 또는 cursor 정보 추출
        const link = headers['link'] || headers['Link'];
        const xCursor = headers['x-cursor'] || headers['x-cursor-token'];
        
        if (xCursor) {
            cursor = xCursor;
        } else if (link) {
            // Match cursor from link header: <url?cursor=xxx>; rel="next"
            const match = link.match(/cursor=([^&>]+)/);
            if (match && link.includes('rel="next"')) {
                cursor = match[1];
            } else {
                hasMore = false;
            }
        } else {
            hasMore = false;
        }
    }

    return allData;
}

// ─────────────────────────────────────────────────────────────
// POST /api/versions/diff/run
//   Body: { projectId, prevUrn, curUrn }
//   Does everything server-side: create job → poll → download → parse → respond
// ─────────────────────────────────────────────────────────────
router.post('/diff/run', authRefreshMiddleware, async (req, res) => {
    const { projectId, prevUrn, curUrn } = req.body;
    if (!projectId || !prevUrn || !curUrn) {
        return res.status(400).json({ error: 'projectId, prevUrn, curUrn are required.' });
    }

    const pid = cleanProject(projectId);
    const token = req.internalOAuthToken.access_token;
    const rawPrev = decodeUrn(prevUrn);
    const rawCur  = decodeUrn(curUrn);

    // ── Cache Lookup ────────────────────────────────────────────────
    const cacheKey = `${pid}_${rawPrev}_${rawCur}`;
    const cache = readDiffCache();
    if (cache[cacheKey]) {
        console.log(`[Cache Hit] Returning cached diff results for key: ${cacheKey}`);
        return res.status(200).json(cache[cacheKey]);
    }

    try {
        // ── 1. Create / look up diff job via batch-status ──────────────────
        console.log(`[Diff] Creating diff job — project:${pid}`);
        const batchResp = await axiosWithRetry({
            method: 'post',
            url: `${APS_INDEX_BASE}/${pid}/diffs:batch-status`,
            data: { diffs: [{ prevVersionUrn: rawPrev, curVersionUrn: rawCur }] },
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
        });

        const diffInfo = batchResp.data?.diffs?.[0];
        if (!diffInfo) throw new Error('Autodesk API returned no diff info.');

        const diffId = diffInfo.diffId;
        let status = (diffInfo.status || diffInfo.state || '').toLowerCase();
        console.log(`[Diff] diffId=${diffId}  initial status=${status}`);

        // ── 2. Poll until finished or success ──────────────────────
        let polls = 0;
        let statusResp = null;
        
        while (status !== 'finished' && status !== 'success') {
            if (status === 'failed') {
                throw new Error(`Diff job FAILED on Autodesk side.`);
            }

            if (polls > 60) { // 최대 60회까지 폴링 보장 (60 * 6초 = 360초)
                throw new Error(`Diff job timed out after ${polls} polls. Last status: ${status}`);
            }

            await new Promise(resolve => setTimeout(resolve, 6000)); // Polling interval increased to 6s
            polls++;

            statusResp = await axiosWithRetry({
                method: 'get',
                url: `${APS_INDEX_BASE}/${pid}/diffs/${diffId}`,
                headers: { Authorization: `Bearer ${token}` }
            });

            const data = statusResp.data || {};
            status = (data.status || data.state || '').toLowerCase();
            console.log(`[Diff] poll #${polls} — status=${status}`);

            if (status === 'finished' || status === 'success') {
                break;
            }

            if (status === 'failed') {
                const errorDetail = data.error || data.message || 'Unknown Autodesk error';
                throw new Error(`Diff job FAILED on Autodesk side. Reason: ${errorDetail}`);
            }
        }

        // ── 3. Determine download URLs ──────────────────
        let fieldsUrl = `${APS_INDEX_BASE}/${pid}/diffs/${diffId}/fields`;
        let propertiesUrl = `${APS_INDEX_BASE}/${pid}/diffs/${diffId}/properties`;

        const finalData = statusResp?.data || diffInfo;
        if (finalData?.resources) {
            const resObj = finalData.resources;
            if (typeof resObj === 'object') {
                if (Array.isArray(resObj)) {
                    const fItem = resObj.find(r => r.type === 'fields');
                    const pItem = resObj.find(r => r.type === 'properties');
                    if (fItem?.url) fieldsUrl = fItem.url;
                    if (pItem?.url) propertiesUrl = pItem.url;
                } else {
                    if (resObj.fields) fieldsUrl = resObj.fields;
                    if (resObj.properties) propertiesUrl = resObj.properties;
                }
            }
        }

        // ── 4. Download /fields  (key → { name, category } mapping) ───────
        console.log(`[Diff] Downloading fields via stream…`);
        const keyMap = {};
        await downloadAndParseNDJSONStream(fieldsUrl, token, (f) => {
            if (f.key !== undefined) {
                keyMap[String(f.key)] = { name: f.name || '', category: f.category || '' };
            }
        });
        console.log(`[Diff] Fields loaded: ${Object.keys(keyMap).length} keys`);

        // ── 5. Download /properties & Parse into { added, removed, modified } ────────────
        console.log(`[Diff] Downloading and parsing properties via stream…`);
        const added    = [];
        const removed  = [];
        const modified = [];

        await downloadAndParseNDJSONStream(propertiesUrl, token, (item) => {
            // Resolve readable name + category from props map
            let name     = item.name || `Element #${item.svf2Id ?? item.objectId ?? item.id ?? '?'}`;
            let category = item.category || 'Other';

            if (item.props) {
                for (const [k, v] of Object.entries(item.props)) {
                    const m = keyMap[String(k)];
                    if (!m) continue;
                    const mn = (m.name || '').toLowerCase();
                    if (mn === 'name' || mn === '__name__') name     = String(v);
                    else if (mn === 'category')             category = String(v);
                }
            }

            const svf2Id     = item.svf2Id    ?? item.lmvId    ?? item.lmvid    ?? item.objectId    ?? item.id;
            const svf2IdB    = item.svf2IdB   ?? item.lmvIdB   ?? item.lmvidB   ?? item.objectIdB   ?? svf2Id;
            const externalId = item.externalId || item.externalid || '';
            const diffState  = (item.changeType || item.changetype || item.state || item.diffType || item.type || '').toLowerCase();

            if (diffState === 'added' || diffState === 'object_added') {
                added.push({ dbId: svf2Id, name, category, externalId });
            } else if (diffState === 'removed' || diffState === 'object_removed') {
                removed.push({ dbId: svf2Id, name, category, externalId });
            } else if (diffState === 'changed' || diffState === 'modified' || diffState === 'object_changed') {
                modified.push({ dbIdA: svf2Id, dbIdB: svf2IdB, name, category, externalId, details: '속성 또는 지오메트리 변경됨' });
            }
        });

        console.log(`[Diff] Done — added:${added.length}  removed:${removed.length}  modified:${modified.length}`);
        
        // Save to cache
        const responseData = { added, removed, modified, diffId, cachedAt: new Date().toISOString() };
        const updatedCache = readDiffCache();
        updatedCache[cacheKey] = responseData;
        writeDiffCache(updatedCache);
        console.log(`[Cache Save] Successfully saved diff results for key: ${cacheKey}`);

        res.status(200).json(responseData);

    } catch (err) {
        console.error("APS API 상세 에러: ", JSON.stringify(err.response ? err.response.data : err, null, 2));
        const errMsg = err.response?.data?.message || err.response?.data?.error || err.message || 'Diff job failed.';
        res.status(err.response?.status || 500).json({
            error: 'Diff job failed.',
            details: errMsg
        });
    }
});

// ─────────────────────────────────────────────────────────────
// Keep the old single-step routes for backward compatibility
// ─────────────────────────────────────────────────────────────

// POST /api/versions/diff/create — returns diffId + initial state only
router.post('/diff/create', authRefreshMiddleware, async (req, res) => {
    const { projectId, prevUrn, curUrn } = req.body;
    if (!projectId || !prevUrn || !curUrn) {
        return res.status(400).json({ error: 'projectId, prevUrn, curUrn are required.' });
    }
    const pid   = cleanProject(projectId);
    const token = req.internalOAuthToken.access_token;
    try {
        const resp = await axios.post(
            `${APS_INDEX_BASE}/${pid}/diffs:batch-status`,
            { diffs: [{ prevVersionUrn: decodeUrn(prevUrn), curVersionUrn: decodeUrn(curUrn) }] },
            { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
        );
        const info = resp.data?.diffs?.[0];
        if (!info) throw new Error('No diff info returned.');
        const state = (info.state || info.status || '').toUpperCase();
        res.json({ diffId: info.diffId, status: (state === 'SUCCESS' || state === 'FINISHED') ? 'FINISHED' : state });
    } catch (err) {
        console.error("APS API 상세 에러: ", JSON.stringify(err.response ? err.response.data : err, null, 2));
        res.status(err.response?.status || 500).json({ error: 'Failed to create diff job.', details: err.response?.data || err.message });
    }
});

// GET /api/versions/diff/:diffId/status
router.get('/diff/:diffId/status', authRefreshMiddleware, async (req, res) => {
    const { diffId } = req.params;
    const { projectId } = req.query;
    if (!projectId) return res.status(400).json({ error: 'projectId is required.' });
    const pid   = cleanProject(projectId);
    const token = req.internalOAuthToken.access_token;
    try {
        const resp = await axios.get(
            `${APS_INDEX_BASE}/${pid}/diffs/${diffId}`,
            { headers: { Authorization: `Bearer ${token}` } }
        );
        const state = (resp.data?.state || resp.data?.status || '').toUpperCase();
        res.json({ status: (state === 'SUCCESS' || state === 'FINISHED') ? 'FINISHED' : state });
    } catch (err) {
        console.error("APS API 상세 에러: ", JSON.stringify(err.response ? err.response.data : err, null, 2));
        res.status(err.response?.status || 500).json({ error: 'Failed to get diff status.', details: err.response?.data || err.message });
    }
});

// GET /api/versions/diff/:diffId/results — download + parse fields & properties
router.get('/diff/:diffId/results', authRefreshMiddleware, async (req, res) => {
    const { diffId } = req.params;
    const { projectId } = req.query;
    if (!projectId) return res.status(400).json({ error: 'projectId is required.' });
    const pid   = cleanProject(projectId);
    const token = req.internalOAuthToken.access_token;
    try {
        let fieldsUrl = `${APS_INDEX_BASE}/${pid}/diffs/${diffId}/fields`;
        let propertiesUrl = `${APS_INDEX_BASE}/${pid}/diffs/${diffId}/properties`;

        // Attempt to get resources from diff status if available
        try {
            const statusResp = await axios.get(
                `${APS_INDEX_BASE}/${pid}/diffs/${diffId}`,
                { headers: { Authorization: `Bearer ${token}` } }
            );
            if (statusResp.data?.resources) {
                const resObj = statusResp.data.resources;
                if (typeof resObj === 'object') {
                    if (Array.isArray(resObj)) {
                        const fItem = resObj.find(r => r.type === 'fields');
                        const pItem = resObj.find(r => r.type === 'properties');
                        if (fItem?.url) fieldsUrl = fItem.url;
                        if (pItem?.url) propertiesUrl = pItem.url;
                    } else {
                        if (resObj.fields) fieldsUrl = resObj.fields;
                        if (resObj.properties) propertiesUrl = resObj.properties;
                    }
                }
            }
        } catch (_) {}

        // Fields
        const keyMap = {};
        await downloadAndParseNDJSONStream(fieldsUrl, token, (f) => {
            if (f.key !== undefined) keyMap[String(f.key)] = { name: f.name || '', category: f.category || '' };
        });

        // Properties
        const added = [], removed = [], modified = [];
        await downloadAndParseNDJSONStream(propertiesUrl, token, (item) => {
            let name = item.name || `Element #${item.svf2Id ?? '?'}`;
            let category = item.category || 'Other';
            if (item.props) {
                for (const [k, v] of Object.entries(item.props)) {
                    const m = keyMap[String(k)];
                    if (!m) continue;
                    const mn = (m.name || '').toLowerCase();
                    if (mn === 'name' || mn === '__name__') name = String(v);
                    else if (mn === 'category') category = String(v);
                }
            }
            const svf2Id = item.svf2Id ?? item.objectId ?? item.id;
            const svf2IdB = item.svf2IdB ?? svf2Id;
            const externalId = item.externalId || '';
            const diffState = (item.changeType || item.changetype || item.state || item.diffType || item.type || '').toLowerCase();
            if (diffState === 'added' || diffState === 'object_added')           added.push({ dbId: svf2Id, name, category, externalId });
            else if (diffState === 'removed' || diffState === 'object_removed')    removed.push({ dbId: svf2Id, name, category, externalId });
            else if (diffState === 'changed' || diffState === 'modified' || diffState === 'object_changed')
                modified.push({ dbIdA: svf2Id, dbIdB: svf2IdB, name, category, externalId, details: '속성 또는 지오메트리 변경됨' });
        });
        
        console.log(`[Diff Results] added:${added.length} removed:${removed.length} modified:${modified.length}`);
        res.json({ added, removed, modified });
    } catch (err) {
        console.error("APS API 상세 에러: ", JSON.stringify(err.response ? err.response.data : err, null, 2));
        res.status(err.response?.status || 500).json({ error: 'Failed to retrieve diff results.', details: err.response?.data || err.message });
    }
});

// ─────────────────────────────────────────────────────────────
// Memo routes (unchanged)
// ─────────────────────────────────────────────────────────────
router.get(/^\/(.+)\/memo$/, (req, res) => {
    const version_urn = req.params[0];
    const memos = readMemos();
    res.json({ memo: memos[version_urn] || '' });
});

router.post(/^\/(.+)\/memo$/, (req, res) => {
    const version_urn = req.params[0];
    const { memo } = req.body;
    if (memo === undefined) return res.status(400).json({ error: 'Memo content is required.' });
    const memos = readMemos();
    memos[version_urn] = memo.trim();
    writeMemos(memos);
    res.json({ success: true, memo: memos[version_urn] });
});

module.exports = router;
