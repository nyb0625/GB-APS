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

const router = express.Router();

const GANGBUK_HUB_ID = process.env.GANGBUK_HUB_ID || 'b.4efd43ab-93fa-4448-918b-091d81dbfd75';
const GANGBUK_PROJECT_ID = process.env.GANGBUK_PROJECT_ID || 'b.d005cd39-4a35-4843-b350-81da491266ef';

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
    if (typeof value === 'string') return userMap.get(value) || userMap.get(value.toLowerCase()) || (value === '783606258' ? '현대건설' : value);
    const id = value.autodeskId || value.id || value.userId || value.uid || value.accountId || value.email;
    const name = value.name || value.displayName || value.fullName || [value.firstName, value.lastName].filter(Boolean).join(' ') || value.email;
    return name || userMap.get(id) || id || '';
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
    const value = pick(issue, [
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
    if (typeof value === 'object') return value.name || value.displayName || value.title || '';
    return String(value || '').trim();
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
                [u.autodeskId, u.id, u.userId, u.uid, u.email].filter(Boolean).forEach(id => {
                    map.set(String(id), name);
                    map.set(String(id).toLowerCase(), name);
                });
            });
            if (map.size) return map;
        } catch (err) {
            console.warn('[Forma Issues] member fetch skipped:', err.message);
        }
    }
    map.set('783606258', '현대건설');
    map.set('783606258', '현대건설');
    return map;
}

function projectIdCandidates(projectId) {
    const original = String(projectId || '').trim();
    const clean = stripBPrefix(original);
    return Array.from(new Set([original, clean].filter(Boolean)));
}

async function fetchIssueTypeMap(projectId, containerId, token) {
    const projectIds = projectIdCandidates(projectId);
    const regions = ['', 'US', 'EMEA'];
    const urls = [
        ...(containerId ? [{ url: `https://developer.api.autodesk.com/issues/v1/containers/${encodeURIComponent(containerId)}/issue-types` }] : []),
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
                    const subPath = st.path || st.fullName || [name, subName].filter(Boolean).join(' > ');
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
    const totalLimit = Math.min(Math.max(parseInt(limit, 10) || 300, 1), 1000);
    const pageLimit = Math.min(totalLimit, 100);
    const regions = ['', 'US', 'EMEA'];
    const candidates = [
        ...(containerId ? [{ url: `https://developer.api.autodesk.com/issues/v1/containers/${encodeURIComponent(containerId)}/issues?limit=${pageLimit}` }] : []),
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
            const json = await fetchJson(candidate.url, token, headers);
            const rows = json.results || json.data || json.issues || [];
            return rows.slice(0, totalLimit);
        } catch (err) {
            lastError = err;
            console.warn('[Forma Issues] issue fetch failed:', candidate.url, candidate.region || 'default', err.message);
        }
    }
    throw lastError || new Error('Unable to fetch Forma issues.');
}

function normalizeFormaIssue(issue, typeMap, userMap) {
    const attrs = issue.attributes || {};
    const typePath = normalizeTypeForForma(issue, typeMap);
    const assigneeRaw = pick(issue, ['assignedTo', 'assignee', 'assignedToUser', 'attributes.assignedTo', 'attributes.assignee', 'attributes.assignedToUser'], '');
    const creatorRaw = pick(issue, ['createdBy', 'createdByUser', 'creator', 'attributes.createdBy', 'attributes.createdByUser', 'attributes.creator'], '');
    const reviewerRaw = pick(issue, ['reviewer', 'reviewedBy', 'attributes.reviewer', 'attributes.reviewedBy'], '') || getCustomValue(issue, ['확인자', '검토자', 'Reviewer']);
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
        location: normalizeLocation(issue),
        assignee: displayUser(assigneeRaw, userMap),
        creator: displayUser(creatorRaw, userMap),
        reviewer: displayUser(reviewerRaw, userMap),
        createdAt: pick(issue, ['createdAt', 'attributes.createdAt', 'createdDate', 'attributes.createdDate'], ''),
        dueDate: pick(issue, ['dueDate', 'attributes.dueDate', 'endDate', 'attributes.dueDate'], ''),
        startDate: pick(issue, ['startDate', 'attributes.startDate'], ''),
        placement: normalizePlacement(issue),
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
    const assigneeRaw = pick(issue, ['assignedTo', 'assignee', 'assignedToUser', 'attributes.assignedTo', 'attributes.assignee', 'attributes.assignedToUser'], '');
    const creatorRaw = pick(issue, ['createdBy', 'createdByUser', 'creator', 'attributes.createdBy', 'attributes.createdByUser', 'attributes.creator'], '');
    const reviewerRaw = pick(issue, ['reviewer', 'reviewedBy', 'attributes.reviewer', 'attributes.reviewedBy'], '') || getCustomValue(issue, ['확인자', '검토자', 'Reviewer']);
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
        location: normalizeLocationForForma(issue, locationMap),
        assignee: displayUser(assigneeRaw, userMap),
        creator: displayUser(creatorRaw, userMap),
        reviewer: displayUser(reviewerRaw, userMap),
        createdAt: pick(issue, ['createdAt', 'attributes.createdAt', 'createdDate', 'attributes.createdDate'], ''),
        dueDate: pick(issue, ['dueDate', 'attributes.dueDate', 'endDate'], ''),
        startDate: pick(issue, ['startDate', 'attributes.startDate'], ''),
        placement: normalizePlacement(issue),
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

    try {
        const containerId = await getIssueContainerInfo(hubId, projectId, token).catch(err => {
            console.warn('[Forma Issues] issue container lookup failed:', err.message);
            return null;
        });
        const [userMap, typeMap, locationMap, rawIssues] = await Promise.all([
            fetchProjectMembers(projectId, token),
            fetchIssueTypeMap(projectId, containerId, token),
            fetchLocationMap(hubId, projectId, token),
            fetchFormaIssues(projectId, containerId, token, limit)
        ]);
        const normalized = rawIssues
            .map(issue => normalizeFormaIssueForTable(issue, typeMap, userMap, locationMap))
            .filter(issue => !String(issue.typePath || issue.type || '').includes('\uAC74\uD654'))
            .filter(issue => !String(issue.typePath || issue.type || '').includes('건화'))
            .filter(issue => !String(issue.typePath || issue.type || '').includes('건화'));

        res.json({
            data: normalized,
            meta: {
                hubId,
                projectId,
                containerId,
                count: normalized.length,
                rawCount: rawIssues.length,
                excludedCategory: '건화'
            }
        });
    } catch (err) {
        console.error('[Forma Issues] fetch failed:', err.message);
        res.status(502).json({
            error: 'Failed to fetch Forma issues',
            message: err.message,
            data: []
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

module.exports = router;
