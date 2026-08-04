'use strict';

const express  = require('express');
const router   = express.Router();
const axios    = require('axios');
const zlib     = require('zlib');
const readline = require('readline');
const fs       = require('fs');
const path     = require('path');

// 인증 연장 미들웨어
const { authRefreshMiddleware } = require('../services/aps.js');

// ─────────────────────────────────────────────────────────────
// 파일 캐시 디렉터리  (.cache/diffs/{diffId}/)
// ─────────────────────────────────────────────────────────────
const CACHE_ROOT = path.join(__dirname, '..', '.cache', 'diffs');
fs.mkdirSync(CACHE_ROOT, { recursive: true });

function diffCacheDir(diffId) {
  const dir = path.join(CACHE_ROOT, diffId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ─────────────────────────────────────────────────────────────
// 메모리 캐시 (프로세스 생존 기간 유지)
//   diffCache      : cacheKey → { diffId, state }
//   pendingDiffJobs: cacheKey → Promise
// ─────────────────────────────────────────────────────────────
const diffCache       = new Map();   // key → { diffId, state }
const pendingDiffJobs = new Map();   // key → Promise<result>

// ─────────────────────────────────────────────────────────────
// 헬퍼
// ─────────────────────────────────────────────────────────────
function stripB(projectId = '') {
  return String(projectId).trim().replace(/^b\./, '');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getDiffCacheKey(projectId, prevUrn, curUrn) {
  return `${stripB(projectId)}|${prevUrn}|${curUrn}`;
}

function cleanVersionUrn(input = '') {
  let raw = String(input).trim().replace(/[\r\n]+/g, '');
  raw = decodeURIComponent(raw);

  if (raw.startsWith('urn:adsk.wipprod:fs.file:vf.')) {
    if (!raw.includes('?version=')) {
      throw new Error(`Version URN must include ?version=: ${raw}`);
    }
    return raw;
  }

  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    if (decoded.startsWith('urn:adsk.wipprod:fs.file:vf.') && decoded.includes('?version=')) {
      return decoded;
    }
  } catch (_) {}

  throw new Error(
    `Invalid version URN for Model Properties Diff. Received: ${raw.slice(0, 120)}`
  );
}

// ─────────────────────────────────────────────────────────────
// withApsRetry  — 429 처리 + Retry-After / exponential backoff
// ─────────────────────────────────────────────────────────────
function getRetryDelayMs(err, attempt) {
  const retryAfter = err.response?.headers?.['retry-after'];
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (!Number.isNaN(seconds)) return seconds * 1000;
  }
  return Math.min(60000, 3000 * Math.pow(2, attempt));
}

async function withApsRetry(fn, stage, maxRetries = 5) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = err.response?.status;

      if (status === 429 && attempt < maxRetries) {
        const delayMs = getRetryDelayMs(err, attempt);
        console.warn(`[APS Retry] 429 at "${stage}". attempt=${attempt + 1}/${maxRetries}. waiting=${delayMs}ms`, {
          retryAfter: err.response?.headers?.['retry-after'],
          url: `${err.config?.baseURL || ''}${err.config?.url || ''}`,
          response: err.response?.data
        });
        await sleep(delayMs);
        continue;
      }

      err.stage = stage;
      throw err;
    }
  }
}

// ─────────────────────────────────────────────────────────────
// API 베이스
// ─────────────────────────────────────────────────────────────
const APS_INDEX_BASE = 'https://developer.api.autodesk.com/construction/index/v2';

// ─────────────────────────────────────────────────────────────
// createDiff  — 메모리 캐시 확인 후 POST (중복 방지)
// ─────────────────────────────────────────────────────────────
async function createDiff({ token, projectId, prevUrn, curUrn, region }) {
  const pid = stripB(projectId);

  const cleanPrev = cleanVersionUrn(prevUrn);
  const cleanCur  = cleanVersionUrn(curUrn);

  const payload = {
    diffs: [{ prevVersionUrn: cleanPrev, curVersionUrn: cleanCur }]
  };

  console.log('[Diff API] POST createDiff →', {
    url: `${APS_INDEX_BASE}/projects/${pid}/diffs:batch-status`,
    pid, region, payload
  });

  const data = await withApsRetry(async () => {
    const resp = await axios.post(
      `${APS_INDEX_BASE}/projects/${pid}/diffs:batch-status`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(region ? { 'x-ads-region': region } : {})
        },
        timeout: 60000
      }
    );
    return resp.data;
  }, 'createDiff');

  console.log('[Diff API] createDiff response:', data);

  const diff = data?.diffs?.[0];
  if (!diff?.diffId) {
    const e = new Error(`Diff creation returned no diffId: ${JSON.stringify(data)}`);
    e.stage = 'createDiff';
    throw e;
  }

  return diff.diffId;
}

// ─────────────────────────────────────────────────────────────
// pollDiff  — 5초 간격, withApsRetry 적용
// ─────────────────────────────────────────────────────────────
const POLL_INTERVAL_MS = 5000;

async function pollDiff({ token, projectId, diffId, region }) {
  const pid = stripB(projectId);

  while (true) {
    const data = await withApsRetry(async () => {
      const resp = await axios.get(
        `${APS_INDEX_BASE}/projects/${pid}/diffs/${diffId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/json',
            ...(region ? { 'x-ads-region': region } : {})
          },
          timeout: 60000
        }
      );
      return resp.data;
    }, 'pollDiff');

    const state = String(data.state || data.status || '').toUpperCase();
    console.log('[Diff API] pollDiff state:', state);

    if (state === 'FINISHED') return data;
    if (state === 'FAILED') {
      const e = new Error(`Diff job failed on server: ${JSON.stringify(data)}`);
      e.stage = 'pollDiff';
      throw e;
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

// ─────────────────────────────────────────────────────────────
// NDJSON stream 다운로드 — 302 redirect + gzip + cursor paging
// ─────────────────────────────────────────────────────────────
async function downloadNDJSONLines(baseUrl, token, region, stage) {
  const lines   = [];
  let cursor    = null;
  let hasMore   = true;
  let pageIndex = 0;

  while (hasMore) {
    const url = cursor
      ? `${baseUrl}?cursor=${encodeURIComponent(cursor)}`
      : baseUrl;

    // Autodesk 엔드포인트 → 302 redirect 해결
    const resolvedUrl = await withApsRetry(async () => {
      if (!url.startsWith('https://developer.api.autodesk.com')) return url;
      try {
        const r = await axios({
          method: 'get', url,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(region ? { 'x-ads-region': region } : {})
          },
          maxRedirects: 0,
          validateStatus: s => s >= 200 && s < 400
        });
        if ([301, 302, 307].includes(r.status)) return r.headers.location;
        return url;
      } catch (redirectErr) {
        if (redirectErr.response && [301, 302, 307].includes(redirectErr.response.status)) {
          return redirectErr.response.headers.location;
        }
        throw redirectErr;
      }
    }, stage);

    console.log(`[Diff Stream] (${stage}) page=${pageIndex} url=${resolvedUrl.slice(0, 120)}`);

    const response = await withApsRetry(async () => {
      const isAps = resolvedUrl.startsWith('https://developer.api.autodesk.com');
      return await axios({
        method: 'get',
        url: resolvedUrl,
        responseType: 'stream',
        ...(isAps ? {
          headers: {
            Authorization: `Bearer ${token}`,
            ...(region ? { 'x-ads-region': region } : {})
          }
        } : {})
      });
    }, stage);

    const headers = response.headers || {};

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() =>
        reject(new Error(`Stream timeout (180s) at ${stage}`)), 180000);

      const inputStream = response.data;
      const isGzip =
        headers['content-encoding'] === 'gzip' ||
        (headers['content-type'] || '').includes('gzip');

      const stream = isGzip ? inputStream.pipe(zlib.createGunzip()) : inputStream;

      const rl = readline.createInterface({ input: stream, crlfDelay: Infinity, terminal: false });
      rl.on('line', line => {
        const t = line.trim();
        if (!t) return;
        try { lines.push(JSON.parse(t)); } catch (_) {}
      });
      rl.on('close', () => { clearTimeout(timer); resolve(); });
      inputStream.on('error', e => { clearTimeout(timer); reject(e); });
      stream.on('error',      e => { clearTimeout(timer); reject(e); });
    });

    const linkHeader = headers['link'] || headers['Link'] || '';
    const xCursor   = headers['x-cursor'] || headers['x-cursor-token'];

    if (xCursor) {
      cursor = xCursor;
    } else if (linkHeader) {
      const m = linkHeader.match(/cursor=([^&>]+)/);
      cursor  = (m && linkHeader.includes('rel="next"')) ? m[1] : null;
      if (!cursor) hasMore = false;
    } else {
      hasMore = false;
    }
    pageIndex++;
  }

  return lines;
}

// ─────────────────────────────────────────────────────────────
// 파일 캐시 I/O (NDJSON 평문 저장)
// ─────────────────────────────────────────────────────────────
async function readFileCache(filePath) {
  const content = await fs.promises.readFile(filePath, 'utf8');
  const result  = [];
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { result.push(JSON.parse(t)); } catch (_) {}
  }
  return result;
}

async function writeFileCache(filePath, lines) {
  await fs.promises.writeFile(filePath, lines.map(l => JSON.stringify(l)).join('\n'), 'utf8');
}

// ─────────────────────────────────────────────────────────────
// 실제 diff 파이프라인 (createDiff → pollDiff → download → parse)
// ─────────────────────────────────────────────────────────────
async function runDiffPipeline({ token, projectId, prevUrn, curUrn, region, cacheKey }) {
  const pid = stripB(projectId);

  // ── 1. diffId 취득 (메모리 캐시 우선)
  let diffId;
  const memoryCached = diffCache.get(cacheKey);
  if (memoryCached?.diffId && memoryCached?.state === 'FINISHED') {
    console.log('[Diff API] Reusing cached FINISHED diff:', memoryCached.diffId);
    diffId = memoryCached.diffId;
  } else {
    diffId = await createDiff({ token, projectId, prevUrn, curUrn, region });
    diffCache.set(cacheKey, { diffId, state: 'PROCESSING' });
  }

  // ── 2. pollDiff (FINISHED 대기, 메모리 캐시 체크)
  const alreadyFinished = diffCache.get(cacheKey)?.state === 'FINISHED';
  let pollData;
  if (!alreadyFinished) {
    pollData = await pollDiff({ token, projectId, diffId, region });
    diffCache.set(cacheKey, { diffId, state: 'FINISHED' });
  } else {
    // 파일 캐시만 재사용할 것이므로 pollData는 최소값만 사용
    pollData = {};
  }

  // ── 3. fields/properties URL 결정
  let fieldsUrl = `${APS_INDEX_BASE}/projects/${pid}/diffs/${diffId}/fields`;
  let propertiesUrl = `${APS_INDEX_BASE}/projects/${pid}/diffs/${diffId}/properties`;

  if (pollData?.resources) {
    const res = pollData.resources;
    if (Array.isArray(res)) {
      const f = res.find(r => r.type === 'fields');
      const p = res.find(r => r.type === 'properties');
      if (f?.url) fieldsUrl     = f.url;
      if (p?.url) propertiesUrl = p.url;
    } else if (typeof res === 'object') {
      if (res.fields)      fieldsUrl      = res.fields;
      if (res.properties)  propertiesUrl  = res.properties;
    }
  }

  const cacheDir     = diffCacheDir(diffId);
  const fieldsFile   = path.join(cacheDir, 'fields.ndjson');
  const propsFile    = path.join(cacheDir, 'properties.ndjson');

  // ── 4. fields (파일 캐시 우선)
  let rawFields;
  if (fs.existsSync(fieldsFile)) {
    console.log('[Diff Cache] Loading fields from file cache:', fieldsFile);
    rawFields = await readFileCache(fieldsFile);
  } else {
    console.log('[Diff API] Downloading fields...', { fieldsUrl });
    rawFields = await withApsRetry(
      () => downloadNDJSONLines(fieldsUrl, token, region, 'downloadFields'),
      'downloadFields'
    );
    await writeFileCache(fieldsFile, rawFields);
    console.log('[Diff Cache] Fields saved:', fieldsFile);
  }

  const keyMap = {};
  for (const f of rawFields) {
    if (f.key !== undefined) {
      keyMap[String(f.key)] = { name: f.name || '', category: f.category || '' };
    }
  }
  console.log('[Diff API] Fields keyMap size:', Object.keys(keyMap).length);

  // ── 5. properties (파일 캐시 우선)
  let rawProps;
  if (fs.existsSync(propsFile)) {
    console.log('[Diff Cache] Loading properties from file cache:', propsFile);
    rawProps = await readFileCache(propsFile);
  } else {
    console.log('[Diff API] Downloading properties...', { propertiesUrl });
    rawProps = await withApsRetry(
      () => downloadNDJSONLines(propertiesUrl, token, region, 'downloadProperties'),
      'downloadProperties'
    );
    await writeFileCache(propsFile, rawProps);
    console.log('[Diff Cache] Properties saved:', propsFile);
  }

  // ── 6. 파싱
  const rawAdded    = [];
  const rawRemoved  = [];
  const rawModified = [];

  for (const item of rawProps) {
    let name     = item.name || `Element #${item.svf2Id ?? item.objectId ?? item.id ?? '?'}`;
    let category = item.category || 'Other';

    if (item.props) {
      for (const [k, v] of Object.entries(item.props)) {
        const m  = keyMap[String(k)];
        if (!m) continue;
        const mn = (m.name || '').toLowerCase();
        if (mn === 'name' || mn === '__name__') name     = String(v);
        else if (mn === 'category')             category = String(v);
      }
    }

    const svf2Id    = item.svf2Id    ?? item.lmvId  ?? item.lmvid  ?? item.objectId ?? item.id;
    const svf2IdB   = item.svf2IdB   ?? item.lmvIdB ?? item.lmvidB ?? item.objectIdB ?? svf2Id;
    const externalId = item.externalId || item.externalid || '';
    const diffState  = (item.changeType || item.changetype || item.state || item.diffType || item.type || '').toLowerCase();

    if      (diffState === 'added'   || diffState === 'object_added')   rawAdded.push({ dbId: svf2Id, name, category, externalId });
    else if (diffState === 'removed' || diffState === 'object_removed') rawRemoved.push({ dbId: svf2Id, name, category, externalId });
    else if (diffState === 'changed' || diffState === 'modified' || diffState === 'object_changed')
      rawModified.push({ dbId: svf2Id, dbIdA: svf2Id, dbIdB: svf2IdB, name, category, externalId });
  }

  // ── 7. 블랙리스트 필터링
  const blacklist = ['용접', '단열재', '보온재', '뷰', 'hidden', 'xref', 'title', 'dwg', 'sketch', 'system', '시스템', 'project info', 'materials', 'default'];
  const filterItem = item => {
    const combined = `${item.name || ''} ${item.category || ''}`.toLowerCase();
    return !blacklist.some(kw => combined.includes(kw));
  };

  const added    = rawAdded.filter(filterItem);
  const removed  = rawRemoved.filter(filterItem);
  const modified = rawModified.filter(filterItem);

  console.log(`[Diff API] 완료 — added:${added.length} removed:${removed.length} modified:${modified.length}`);

  return {
    ok: true,
    diffId,
    fromCache: fs.existsSync(propsFile),
    state: 'FINISHED',
    added,
    removed,
    modified
  };
}

// ─────────────────────────────────────────────────────────────
// /health
// ─────────────────────────────────────────────────────────────
router.get('/health', (_req, res) => {
  res.json({ ok: true, route: '/api/diff/health', mounted: true, time: new Date().toISOString() });
});

// ─────────────────────────────────────────────────────────────
// POST /run
// ─────────────────────────────────────────────────────────────
router.post('/run', authRefreshMiddleware, async (req, res) => {
  console.log('[Diff API] /api/diff/run entered');
  console.log('[Diff API] request body:', {
    projectId: req.body?.projectId,
    prevUrn: req.body?.prevUrn,
    curUrn: req.body?.curUrn,
    region: req.body?.region
  });

  try {
    const { projectId, prevUrn, curUrn, region } = req.body;
    const token = req.session.internal_token
      || req.session.access_token
      || req.internalOAuthToken?.access_token;

    if (!projectId || !prevUrn || !curUrn) {
      return res.status(400).json({ error: 'Missing parameters: projectId, prevUrn, curUrn' });
    }
    if (!token) {
      return res.status(401).json({ error: 'Not authenticated. Please login first.' });
    }

    const cacheKey = getDiffCacheKey(projectId, prevUrn, curUrn);
    console.log('[Diff API] cacheKey:', cacheKey);

    // ── 진행 중인 동일 요청이 있으면 Promise 재사용 (중복 방지)
    if (pendingDiffJobs.has(cacheKey)) {
      console.log('[Diff API] Reusing pending diff job for key:', cacheKey);
      const result = await pendingDiffJobs.get(cacheKey);
      return res.json(result);
    }

    const jobPromise = runDiffPipeline({ token, projectId, prevUrn, curUrn, region, cacheKey });
    pendingDiffJobs.set(cacheKey, jobPromise);

    let result;
    try {
      result = await jobPromise;
    } finally {
      pendingDiffJobs.delete(cacheKey);
    }

    return res.json(result);

  } catch (err) {
    const stage = err.stage || 'unknown';

    console.error('[Diff Error - FULL DIAGNOSTIC]', {
      stage,
      message:      err.message,
      status:       err.response?.status,
      retryAfter:   err.response?.headers?.['retry-after'],
      method:       err.config?.method,
      baseURL:      err.config?.baseURL,
      url:          err.config?.url,
      fullUrl:      `${err.config?.baseURL || ''}${err.config?.url || ''}`,
      requestBody:  err.config?.data,
      responseData: err.response?.data
    });

    const is429 = err.response?.status === 429;

    return res.status(is429 ? 429 : 500).json({
      error: is429
        ? 'Autodesk API quota limit exceeded. Please retry later.'
        : 'Model comparison failed.',
      stage,
      details:        err.message,
      upstreamStatus: err.response?.status,
      retryAfter:     err.response?.headers?.['retry-after'] ?? null,
      upstreamUrl:    `${err.config?.baseURL || ''}${err.config?.url || ''}`,
      upstreamResponse: err.response?.data
    });
  }
});

module.exports = router;
