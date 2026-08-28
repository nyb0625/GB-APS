/**
 * routes/hubs.js
 * ACC / BIM 360 Hub, Project, Folder contents, Item versions browser endpoints.
 */
const express = require('express');
const {
    authRefreshMiddleware,
    getHubs,
    getProjects,
    getProjectContents,
    getItemVersions,
    getIssueContainerInfo,
    getProjectIssues,
    searchProjectFiles,
    searchProjectRvtFiles
} = require('../services/aps.js');
const axios = require('axios');
const { readMemos } = require('../utils/memo-store.js');

const router = express.Router();

// Apply auth session validation globally to all hub endpoints
router.use(authRefreshMiddleware);

// Extract version number from standard Autodesk IDs
function extractVersionNumber(id) {
    const m = id.match(/[?&]version=(\d+)/i)
           || id.match(/:v(\d+)$/i)
           || id.match(/\.vf\..+v(\d+)$/i);
    return m ? parseInt(m[1], 10) : 1;
}

function getRevisionDisplayLabel(version) {
    const attrs = version?.attributes || {};
    const extData = attrs.extension?.data || {};
    const value = extData.revisionDisplayLabel ?? extData.revisionLabel ?? extData.versionLabel;
    if (value === null || typeof value === 'undefined' || value === '') return null;
    return String(value);
}

function buildVersionMeta(version) {
    const attrs = version?.attributes || {};
    const ext = attrs.extension || {};
    const extData = ext.data || {};
    let vNumber = attrs.versionNumber;
    if (vNumber == null && version?.id) vNumber = extractVersionNumber(version.id);
    const revisionDisplayLabel = getRevisionDisplayLabel(version);
    return {
        vNumber,
        versionNumber: vNumber,
        revisionDisplayLabel,
        formaVersionLabel: revisionDisplayLabel || (vNumber != null ? String(vNumber) : ''),
        versionType: ext.type || '',
        extensionData: {
            revisionDisplayLabel,
            stormAction: extData['storm:action'] || extData.stormAction || '',
            sourceVersion: extData.sourceVersion || extData.sourceVersionUrn || extData.sourceFileVersionUrn || ''
        }
    };
}

// Convert ID string to base64 URN
function toUrnBase64(id) {
    return Buffer.from(id).toString('base64').replace(/=/g, '');
}

function getApsDisplayName(item) {
    const attrs = item.attributes || {};
    const extData = attrs.extension?.data || {};
    return attrs.displayName || attrs.title || extData.name || attrs.name || item.name || 'Unknown';
}

async function listProjectFilesByTree(hubId, projectId, accessToken, extensions, maxFiles = 1200) {
    const allowed = new Set((extensions || []).map(ext => String(ext).replace(/^\./, '').toLowerCase()));
    const topFolders = await getProjectContents(hubId, projectId, null, accessToken);
    const queue = (topFolders || []).filter(item => item.type === 'folders').map(folder => ({
        id: folder.id,
        path: getApsDisplayName(folder)
    }));
    const results = [];
    const visited = new Set();

    while (queue.length && results.length < maxFiles) {
        const folder = queue.shift();
        if (!folder?.id || visited.has(folder.id)) continue;
        visited.add(folder.id);

        let children = [];
        try {
            children = await getProjectContents(hubId, projectId, folder.id, accessToken);
        } catch (err) {
            console.warn(`[Search Files Fallback] Folder skipped ${folder.path}:`, err.message);
            continue;
        }

        for (const item of children || []) {
            const name = getApsDisplayName(item);
            if (item.type === 'folders') {
                queue.push({ id: item.id, path: `${folder.path}/${name}` });
                continue;
            }

            const ext = String(name.split('.').pop() || '').toLowerCase();
            if (allowed.size && !allowed.has(ext)) continue;

            const tipId = item.relationships?.tip?.data?.id || item.id;
            results.push({
                id: item.id,
                displayName: name,
                urn: toUrnBase64(tipId),
                tipId,
                parentFolderName: folder.path.split('/').pop() || '',
                folderPath: folder.path,
                extension: ext,
                source: 'project-tree-fallback'
            });

            if (results.length >= maxFiles) break;
        }
    }

    return results;
}

// GET /api/hubs/diagnostic/check-all - Diagnostic check for translation status of all files in 01 분배조
router.get('/diagnostic/check-all', async (req, res, next) => {
    try {
        const token = req.internalOAuthToken.access_token;
        
        // 1. Get Hubs
        const hubs = await getHubs(token);
        if (!hubs || hubs.length === 0) {
            return res.json({ error: 'No hubs found' });
        }
        const hubId = hubs[0].id;

        // 2. Get Projects
        const projects = await getProjects(hubId, token);
        if (!projects || projects.length === 0) {
            return res.json({ error: 'No projects found' });
        }
        
        // Find target project
        const project = projects.find(p => p.name.includes('강북정수장')) || projects[0];
        const projectId = project.id;

        // Helper to find folder by name path
        const findFolderByPath = async (parentFolderId, pathSegments) => {
            let currentFolderId = parentFolderId;
            for (const segment of pathSegments) {
                const contents = await getProjectContents(hubId, projectId, currentFolderId, token);
                const found = contents.find(c => c.folder && c.name.includes(segment));
                if (!found) return null;
                currentFolderId = found.id;
            }
            return currentFolderId;
        };

        // Get project root contents to find Project Files
        const rootContents = await getProjectContents(hubId, projectId, null, token);
        const projectFilesFolder = rootContents.find(c => c.folder && c.name.toLowerCase().replace(/\s+/g, '') === 'projectfiles');
        if (!projectFilesFolder) {
            return res.json({ error: 'Project Files folder not found' });
        }

        // Find "01 Revit/02 신설 구조물/01 분배조"
        const folderId = await findFolderByPath(projectFilesFolder.id, ['01 Revit', '02 신설 구조물', '01 분배조']);
        if (!folderId) {
            return res.json({ error: '01 분배조 folder not found' });
        }

        // List files in "01 분배조"
        const files = await getProjectContents(hubId, projectId, folderId, token);
        const results = [];

        for (const item of files) {
            if (item.folder) continue;
            
            // Get versions
            const versions = await getItemVersions(projectId, item.id, token);
            const verDetails = [];

            for (const v of versions) {
                let vNumber = v.attributes.versionNumber;
                if (vNumber == null) vNumber = extractVersionNumber(v.id);
                const urn = toUrnBase64(v.id);
                
                // Call Autodesk Model Derivative manifest endpoint directly with URL-encoded URN
                let manifest = null;
                let status = 'unknown';
                try {
                    const mdUrl = `https://developer.api.autodesk.com/modelderivative/v2/designdata/${encodeURIComponent(urn)}/manifest`;
                    const resp = await axios.get(mdUrl, {
                        headers: { Authorization: `Bearer ${token}` }
                    });
                    status = resp.data.status;
                } catch (err) {
                    if (err.response?.status === 404) {
                        status = '404';
                    } else {
                        status = `error-${err.response?.status || err.message}`;
                    }
                }
                
                verDetails.push({
                    vNumber,
                    id: v.id,
                    urn,
                    status
                });
            }

            results.push({
                fileName: item.name,
                itemId: item.id,
                versions: verDetails
            });
        }

        res.json({
            project: project.name,
            folder: '01 Revit/02 신설 구조물/01 분배조',
            files: results
        });
    } catch (err) {
        next(err);
    }
});

// GET /api/hubs - List user's hubs
router.get('/', async (req, res, next) => {
    try {
        const hubs = await getHubs(req.internalOAuthToken.access_token);
        res.json(hubs.map(h => ({
            id: h.id,
            name: h.attributes.displayName || h.attributes.name
        })));
    } catch (err) {
        next(err);
    }
});

// GET /api/hubs/:hub_id/projects - List projects within hub
router.get('/:hub_id/projects', async (req, res, next) => {
    try {
        const projects = await getProjects(req.params.hub_id, req.internalOAuthToken.access_token);
        res.json(projects.map(p => ({
            id: p.id,
            name: p.attributes.displayName || p.attributes.name,
            created: p.attributes.createTime || ''
        })));
    } catch (err) {
        next(err);
    }
});

// GET /api/hubs/:hub_id/projects/:project_id/contents - List folder contents
router.get('/:hub_id/projects/:project_id/contents', async (req, res, next) => {
    try {
        const entries = await getProjectContents(
            req.params.hub_id,
            req.params.project_id,
            req.query.folder_id,
            req.internalOAuthToken.access_token
        );
        
        const responseItems = await Promise.all(entries.map(async item => {
            const isFolder = item.type === 'folders';
            let vNumber = 1;
            let urn = null;
            let versionMeta = {};
            if (!isFolder && item.relationships?.tip) {
                const tipId = item.relationships.tip.data.id;
                vNumber = extractVersionNumber(tipId);
                urn = toUrnBase64(tipId);
                try {
                    const versions = await getItemVersions(
                        req.params.project_id,
                        item.id,
                        req.internalOAuthToken.access_token
                    );
                    const tipVersion = (versions || []).find(version => version.id === tipId)
                        || (versions || []).find(version => toUrnBase64(version.id) === urn);
                    versionMeta = buildVersionMeta(tipVersion || { id: tipId, attributes: { versionNumber: vNumber } });
                    vNumber = versionMeta.vNumber || vNumber;
                } catch (versionErr) {
                    console.warn('[Contents] Failed to enrich version label:', versionErr.message);
                    versionMeta = buildVersionMeta({ id: tipId, attributes: { versionNumber: vNumber } });
                }
            }
            
            const attrs = item.attributes || {};
            const extData = (attrs.extension && attrs.extension.data) ? attrs.extension.data : {};
            const displayName = attrs.displayName || attrs.title || extData.name || attrs.name || 'Unknown';
            
            const tipVersionId = (!isFolder && item.relationships?.tip?.data?.id) ? item.relationships.tip.data.id : null;
            return {
                id: item.id,
                name: displayName,
                folder: isFolder,
                vNumber,
                versionNumber: vNumber,
                versionId: tipVersionId,
                revisionDisplayLabel: versionMeta.revisionDisplayLabel || null,
                formaVersionLabel: versionMeta.formaVersionLabel || (vNumber != null ? String(vNumber) : ''),
                versionType: versionMeta.versionType || '',
                extensionData: versionMeta.extensionData || null,
                urn,
                lastModifiedTime: attrs.lastModifiedTime || null,
                lastModifiedUserName: attrs.lastModifiedUserName || null
            };
        }));
        res.json(responseItems);
    } catch (err) {
        next(err);
    }
});

// GET /api/hubs/:hub_id/projects/:project_id/search-rvt - Global Search API for project-wide RVT files
router.get('/:hub_id/projects/:project_id/search-rvt', async (req, res, next) => {
    try {
        const { hub_id, project_id } = req.params;
        const token = req.internalOAuthToken.access_token;
        const rootFolderId = req.query.root_folder_id || req.query.folder_id;

        const files = await searchProjectRvtFiles(project_id, rootFolderId, token);
        res.json(files);
    } catch (err) {
        console.error('[Search RVT Route Error]', err);
        next(err);
    }
});

// GET /api/hubs/:hub_id/projects/:project_id/search-files - Global Search API for project files
router.get('/:hub_id/projects/:project_id/search-files', async (req, res, next) => {
    try {
        const { project_id } = req.params;
        const token = req.internalOAuthToken.access_token;
        const rootFolderId = req.query.root_folder_id || req.query.folder_id;
        const extensions = String(req.query.extensions || 'rvt,dwg,pdf,doc,docx,xls,xlsx,ppt,pptx')
            .split(',')
            .map(ext => ext.trim())
            .filter(Boolean);

        let files = await searchProjectFiles(project_id, rootFolderId, token, extensions);
        if (!files.length) {
            files = await listProjectFilesByTree(hub_id, project_id, token, extensions);
        }
        res.json(files);
    } catch (err) {
        console.error('[Search Files Route Error]', err);
        next(err);
    }
});

// GET /api/hubs/:hub_id/projects/:project_id/contents/:item_id/versions - List file versions
router.get('/:hub_id/projects/:project_id/contents/:item_id/versions', async (req, res, next) => {
    try {
        const versions = await getItemVersions(
            req.params.project_id,
            req.params.item_id,
            req.internalOAuthToken.access_token
        );
        const memos = readMemos();
        res.json(versions.map(v => {
            const attrs = v.attributes || {};
            const versionMeta = buildVersionMeta(v);
            const vNumber = versionMeta.vNumber;
            const urn = toUrnBase64(v.id);
            return {
                id: v.id,
                name: attrs.createTime,
                displayName: attrs.displayName || attrs.createTime,
                ...versionMeta,
                createUserName: attrs.createUserName,
                createTime: attrs.createTime || '',
                lastModifiedTime: attrs.lastModifiedTime || '',
                lastModifiedUserName: attrs.lastModifiedUserName || '',
                urn,
                memo: memos[urn] || ''
            };
        }));
    } catch (err) {
        next(err);
    }
});

// GET /api/hubs/:hub_id/projects/:project_id/issues - List ACC project issues
router.get('/:hub_id/projects/:project_id/issues', async (req, res, next) => {
    try {
        const { hub_id, project_id } = req.params;
        const token = req.internalOAuthToken.access_token;

        const containerId = await getIssueContainerInfo(hub_id, project_id, token);
        if (!containerId) return res.json([]);

        const issues = await getProjectIssues(containerId, token);

        const findAttr = (attrs, ...titles) =>
            attrs?.find?.((a) => titles.includes(a.title))?.value || '-';

        res.json(issues.map((i) => ({
            id: i.id,
            title: i.title || i.attributes?.title || 'No Title',
            status: i.attributes?.status || 'Open',
            description: i.attributes?.description || '',
            structure_name: findAttr(i.attributes?.customAttributes, 'Structure', '건물명'),
            work_type: findAttr(i.attributes?.customAttributes, '공종', 'Work Type'),
            createdDate: i.attributes?.createdAt || i.attributes?.createdDate || '',
            assignee: i.attributes?.assignee || ''
        })));
    } catch (err) {
        next(err);
    }
});

// ✅ [ACC Construction Admin API] acc.autodesk.com Members 페이지와 동일한 공식 엔드포인트 사용
const getProjectMembersHandler = async function (req, res) {
    // 1. 인증 토큰 추출 (3-legged, account:read 스코프 필요)
    var token = (req.internalOAuthToken && req.internalOAuthToken.access_token) || (req.session && req.session.internal_token) || null;
    if (!token) {
        return res.status(401).json({ error: 'Unauthorized: No valid access token in session.' });
    }

    // 2. Project ID 정제: Data Management API는 'b.' 접두사 포함, Construction Admin API는 순수 UUID만 허용
    var projectIdParam = req.params.project_id || req.params.projectId || '';
    var projectIdClean = projectIdParam.indexOf('b.') === 0 ? projectIdParam.substring(2) : projectIdParam;

    if (!projectIdClean) {
        return res.status(400).json({ error: 'Project ID is required.' });
    }

    var authHeader = 'Bearer ' + token;

    // 3. ✅ [1차 시도] ACC Construction Admin API — acc.autodesk.com/docs/members 와 동일한 공식 API
    //    엔드포인트: /construction/admin/v1/projects/{projectId}/users
    //    필요 스코프: account:read (현재 세션에 이미 포함됨)
    var primaryUrl = 'https://developer.api.autodesk.com/construction/admin/v1/projects/' + projectIdClean + '/users?limit=200';
    console.log('[ACC Members] Construction Admin API 호출: ' + primaryUrl);

    try {
        var primaryResp = await fetch(primaryUrl, {
            method: 'GET',
            headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' }
        });

        if (primaryResp.ok) {
            var primaryJson = await primaryResp.json();
            // Construction Admin API 응답 구조: { results: [...], pagination: {...} }
            var rawList = primaryJson.results || primaryJson.data || primaryJson.users || [];
            var members = [];
            for (var i = 0; i < rawList.length; i++) {
                var u = rawList[i];
                members.push({
                    name: u.name || u.displayName || (u.firstName ? u.firstName + ' ' + u.lastName : '') || u.email || '',
                    email: u.email || '',
                    role: u.role || u.jobTitle || u.accessLevel || '구성원',
                    id: u.autodeskId || u.id || u.email || ''
                });
            }
            console.log('[ACC Members] 구성원 ' + members.length + '명 조회 성공.');
            return res.json({ members: members });
        }

        // 403이면 권한 부족 메시지 반환 (스코프 또는 Admin 권한 필요)
        if (primaryResp.status === 403) {
            console.warn('[ACC Members] 403 Forbidden — Account Admin 권한 또는 앱 권한 설정 확인 필요.');
            return res.status(403).json({
                error: 'Permission denied',
                detail: 'Construction Admin API requires Account Admin or Project Admin role. Status: 403'
            });
        }

        console.warn('[ACC Members] Construction Admin API 응답 오류: ' + primaryResp.status);

    } catch (primaryErr) {
        console.warn('[ACC Members] Construction Admin API 호출 실패: ' + primaryErr.message);
    }

    // 4. [2차 폴백] BIM 360 Admin API (레거시 프로젝트 대응)
    var fallbackUrl = 'https://developer.api.autodesk.com/bim360/admin/v1/projects/' + projectIdClean + '/users?limit=200';
    console.log('[ACC Members] BIM360 Admin API 폴백 시도: ' + fallbackUrl);

    try {
        var fallbackResp = await fetch(fallbackUrl, {
            method: 'GET',
            headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' }
        });

        if (fallbackResp.ok) {
            var fallbackJson = await fallbackResp.json();
            var fbList = fallbackJson.results || fallbackJson.data || fallbackJson.users || [];
            var fbMembers = [];
            for (var j = 0; j < fbList.length; j++) {
                var fu = fbList[j];
                fbMembers.push({
                    name: fu.name || fu.displayName || (fu.firstName ? fu.firstName + ' ' + fu.lastName : '') || fu.email || '',
                    email: fu.email || '',
                    role: fu.role || fu.jobTitle || fu.accessLevel || '구성원',
                    id: fu.autodeskId || fu.id || fu.email || ''
                });
            }
            console.log('[ACC Members] BIM360 폴백 성공: ' + fbMembers.length + '명.');
            return res.json({ members: fbMembers });
        }
        console.warn('[ACC Members] BIM360 폴백도 실패: ' + fallbackResp.status);

    } catch (fallbackErr) {
        console.warn('[ACC Members] BIM360 폴백 호출 실패: ' + fallbackErr.message);
    }

    // 5. 모든 시도 실패 시 — 빈 배열 반환 (프론트엔드가 addMasterSessionUser로 자체 처리)
    console.error('[ACC Members] 모든 API 채널 실패. 빈 배열로 응답합니다.');
    return res.json({ members: [] });
};

// 기존 /users 경로 (하위 호환)
router.get('/api/hubs/:hub_id/projects/:project_id/users', getProjectMembersHandler);
router.get('/hubs/:hub_id/projects/:project_id/users', getProjectMembersHandler);
router.get('/:hub_id/projects/:project_id/users', getProjectMembersHandler);

// 신규 /members 경로 (명시적 경로)
router.get('/api/hubs/:hub_id/projects/:project_id/members', getProjectMembersHandler);
router.get('/hubs/:hub_id/projects/:project_id/members', getProjectMembersHandler);
router.get('/:hub_id/projects/:project_id/members', getProjectMembersHandler);

module.exports = router;
