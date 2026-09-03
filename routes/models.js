const express = require('express');
const formidable = require('express-formidable');
const { authRefreshMiddleware, getHubs, getProjects, getProjectContents, getItemVersions, listObjects, uploadObject, translateObject, getManifest, urnify } = require('../services/aps.js');

const router = express.Router();
router.use(authRefreshMiddleware);

const GANGBUK_HUB_ID = process.env.GANGBUK_HUB_ID || 'b.4efd43ab-93fa-4448-918b-091d81dbfd75';
const GANGBUK_PROJECT_ID = process.env.GANGBUK_PROJECT_ID || 'b.d005cd39-4a35-4843-b350-81da491266ef';
const GANGBUK_PROJECT_NAME = '강북정수장 증설공사 BIM 용역';
const MODEL_TREE_CACHE_TTL_MS = Number(process.env.MODEL_TREE_CACHE_TTL_MS || 5 * 60 * 1000);
const MODEL_TREE_MAX_DEPTH = Number(process.env.MODEL_TREE_MAX_DEPTH || 8);
const MODEL_TREE_MAX_FOLDERS = Number(process.env.MODEL_TREE_MAX_FOLDERS || 220);
const modelTreeCache = new Map();

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeName(value) {
    return String(value || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[\s_\-()[\]{}<>·.,]/g, '');
}

function itemName(item) {
    const attrs = item?.attributes || {};
    const ext = attrs.extension?.data || {};
    return attrs.displayName || attrs.name || attrs.title || ext.name || item?.name || '';
}

function isFolder(item) {
    return item?.type === 'folders' || item?.folder === true;
}

function isRvtItem(item) {
    return !isFolder(item) && /\.rvt$/i.test(itemName(item));
}

function versionNumberFromId(id) {
    const match = String(id || '').match(/[?&]version=(\d+)/i) || String(id || '').match(/:v(\d+)$/i);
    return match ? Number(match[1]) : 0;
}

function toViewerUrn(versionId) {
    return urnify(versionId);
}

async function optionalRefreshSessionToken(req) {
    if (!req.session?.refresh_token) return null;
    if (req.session.internal_token && req.session.expires_at && req.session.expires_at > Date.now() + 60_000) {
        return req.session.internal_token;
    }
    return new Promise(resolve => {
        const noopRes = {
            status() { return this; },
            json() { resolve(null); return this; }
        };
        authRefreshMiddleware(req, noopRes, () => resolve(req.internalOAuthToken?.access_token || req.session?.internal_token || null));
    });
}

async function getDocsTokens(req) {
    const tokens = [];
    const sessionToken = req.internalOAuthToken?.access_token || await optionalRefreshSessionToken(req).catch(() => null);
    if (sessionToken) {
        tokens.push({ token: sessionToken, source: '3-legged-session' });
    }
    return tokens;
}

async function withRetry(label, fn) {
    let lastError;
    for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;
            const status = err.axiosError?.response?.status || err.response?.status || err.status;
            if (status !== 429 && status !== 503 && status !== 504) break;
            const waitMs = 250 * Math.pow(2, attempt);
            console.warn(`[Models Tree] ${label} retry after HTTP ${status}, waiting ${waitMs}ms`);
            await sleep(waitMs);
        }
    }
    throw lastError;
}

async function getContentsSafe(hubId, projectId, folderId, token, label) {
    await sleep(45);
    return withRetry(label || folderId || 'top-folders', () => getProjectContents(hubId, projectId, folderId, token));
}

async function getLatestVersionInfo(projectId, item, token) {
    const tipId = item?.relationships?.tip?.data?.id;
    if (tipId) {
        return {
            versionId: tipId,
            versionNumber: versionNumberFromId(tipId),
            urn: toViewerUrn(tipId)
        };
    }

    const versions = await withRetry(`versions:${item.id}`, () => getItemVersions(projectId, item.id, token));
    const latest = (versions || [])
        .slice()
        .sort((a, b) => {
            const av = Number(a.attributes?.versionNumber ?? versionNumberFromId(a.id));
            const bv = Number(b.attributes?.versionNumber ?? versionNumberFromId(b.id));
            return bv - av;
        })[0];

    if (!latest?.id) return null;
    return {
        versionId: latest.id,
        versionNumber: Number(latest.attributes?.versionNumber ?? versionNumberFromId(latest.id)),
        urn: toViewerUrn(latest.id)
    };
}

function findProjectByName(projects) {
    const exactKey = normalizeName(GANGBUK_PROJECT_NAME);
    return (projects || []).find(project => normalizeName(project.attributes?.displayName || project.attributes?.name || project.name) === exactKey)
        || (projects || []).find(project => {
            const key = normalizeName(project.attributes?.displayName || project.attributes?.name || project.name);
            return key.includes('강북정수장') && key.includes('증설공사') && key.includes('bim') && key.includes('용역');
        });
}

async function resolveTargetProject(hubId, preferredProjectId, token, allowNameFallback = false) {
    const projects = await withRetry('hub-projects', () => getProjects(hubId, token));
    const byId = (projects || []).find(project => project.id === preferredProjectId || project.id === preferredProjectId.replace(/^b\./, '') || `b.${project.id}` === preferredProjectId);
    const byName = allowNameFallback ? findProjectByName(projects) : null;
    const project = byId || byName;
    if (!project) {
        throw new Error(`Target project not found in hub ${hubId}: ${preferredProjectId}`);
    }
    return {
        id: project.id,
        name: project.attributes?.displayName || project.attributes?.name || project.name || GANGBUK_PROJECT_NAME
    };
}

function findProjectFilesFolder(topFolders) {
    return (topFolders || []).find(folder => {
        const key = normalizeName(itemName(folder));
        return key === 'projectfiles' || key.includes('projectfiles') || key.includes('프로젝트파일');
    }) || (topFolders || [])[0];
}

async function findRevitFolder(hubId, projectId, projectFilesFolder, token) {
    const queue = [{ folder: projectFilesFolder, path: [itemName(projectFilesFolder) || 'Project Files'], depth: 0 }];
    let visited = 0;
    let firstBimData = null;

    while (queue.length && visited < MODEL_TREE_MAX_FOLDERS) {
        const current = queue.shift();
        visited += 1;
        const currentName = itemName(current.folder);
        const currentKey = normalizeName(currentName);
        const joinedPath = current.path.join(' / ');
        const pathKey = normalizeName(joinedPath);

        if ((currentKey.includes('01revit') || currentKey === 'revit' || currentKey.includes('revit')) && pathKey.includes('projectfiles')) {
            return { folder: current.folder, path: current.path, visited };
        }
        if (!firstBimData && (currentKey.includes('02bimdata') || currentKey.includes('bimdata') || currentKey.includes('bim'))) {
            firstBimData = { folder: current.folder, path: current.path, visited };
        }
        if (current.depth >= 4) continue;

        const contents = await getContentsSafe(hubId, projectId, current.folder.id, token, `find-folder:${joinedPath}`);
        for (const child of contents || []) {
            if (!isFolder(child)) continue;
            const childName = itemName(child);
            const childKey = normalizeName(childName);
            if (childKey.includes('permissioncache') || childKey.includes('backup')) continue;
            queue.push({ folder: child, path: current.path.concat(childName), depth: current.depth + 1 });
        }
    }

    if (firstBimData) {
        const contents = await getContentsSafe(hubId, projectId, firstBimData.folder.id, token, `bim-data:${firstBimData.path.join('/')}`);
        const revit = (contents || []).find(child => isFolder(child) && normalizeName(itemName(child)).includes('revit'));
        if (revit) return { folder: revit, path: firstBimData.path.concat(itemName(revit)), visited };
    }

    throw new Error(`01 Revit folder not found under ${itemName(projectFilesFolder) || projectFilesFolder.id}; visited ${visited} folders`);
}

async function buildRvtTree(hubId, projectId, folder, folderPath, token, depth = 0, stats = { folders: 0, files: 0 }) {
    if (depth > MODEL_TREE_MAX_DEPTH) return null;
    stats.folders += 1;

    const contents = await getContentsSafe(hubId, projectId, folder.id, token, `tree:${folderPath.join('/')}`);
    const node = {
        folderName: itemName(folder) || folderPath[folderPath.length - 1] || 'Folder',
        folderId: folder.id,
        path: folderPath.join(' / '),
        children: [],
        files: []
    };

    for (const item of contents || []) {
        const name = itemName(item);
        const key = normalizeName(name);
        if (!name || key.includes('permissioncache') || key.includes('backup')) continue;

        if (isFolder(item)) {
            const child = await buildRvtTree(hubId, projectId, item, folderPath.concat(name), token, depth + 1, stats);
            if (child && (child.children.length || child.files.length)) node.children.push(child);
            continue;
        }

        if (!isRvtItem(item)) continue;
        const latest = await getLatestVersionInfo(projectId, item, token).catch(err => {
            console.warn(`[Models Tree] Failed to resolve latest version for ${name}:`, err.message);
            return null;
        });
        if (!latest?.urn) continue;

        stats.files += 1;
        node.files.push({
            name,
            urn: latest.urn,
            rawUrn: latest.versionId,
            versionId: latest.versionId,
            versionNumber: latest.versionNumber,
            itemId: item.id,
            folderId: folder.id,
            folderPath: folderPath.join(' / '),
            lastModifiedTime: item.attributes?.lastModifiedTime || null,
            lastModifiedUserName: item.attributes?.lastModifiedUserName || null,
            source: 'autodesk-docs-live'
        });
    }

    node.children.sort((a, b) => a.folderName.localeCompare(b.folderName, 'ko'));
    node.files.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    return node;
}

async function buildLiveGangbukModelTree(req, options = {}) {
    const requestedHubId = options.hubId || req.query.hubId || req.query.hub_id || '';
    const requestedProjectId = options.projectId || req.query.projectId || req.query.project_id || '';
    const hubId = requestedHubId || GANGBUK_HUB_ID;
    const preferredProjectId = requestedProjectId || GANGBUK_PROJECT_ID;
    const allowNameFallback = !requestedProjectId;
    const tokens = await getDocsTokens(req);
    const errors = [];

    for (const candidate of tokens) {
        try {
            const project = await resolveTargetProject(hubId, preferredProjectId, candidate.token, allowNameFallback);
            const topFolders = await getContentsSafe(hubId, project.id, null, candidate.token, 'top-folders');
            const projectFiles = findProjectFilesFolder(topFolders);
            if (!projectFiles) throw new Error(`Project Files folder not found in project ${project.id}`);

            const revitRoot = await findRevitFolder(hubId, project.id, projectFiles, candidate.token);
            const stats = { folders: 0, files: 0 };
            const tree = await buildRvtTree(hubId, project.id, revitRoot.folder, revitRoot.path, candidate.token, 0, stats);
            if (!tree || (!tree.children.length && !tree.files.length)) {
                throw new Error(`No RVT files found under ${revitRoot.path.join(' / ')}`);
            }

            return {
                ...tree,
                projectId: project.id,
                projectName: project.name,
                hubId,
                rootFolderId: revitRoot.folder.id,
                rootPath: revitRoot.path.join(' / '),
                tokenSource: candidate.source,
                live: true,
                source: 'autodesk-docs-live',
                stats,
                fetchedAt: new Date().toISOString()
            };
        } catch (err) {
            errors.push(`${candidate.source}: ${err.message}`);
            console.warn(`[Models Tree] ${candidate.source} failed:`, err.message);
        }
    }

    throw new Error(errors.length ? errors.join(' | ') : 'No Autodesk token available. Please login first.');
}

// GET /api/models/tree - Live Autodesk Docs RVT model tree for the selected project.
router.get('/tree', async (req, res) => {
    const force = req.query.force === '1' || req.query.refresh === '1';
    const now = Date.now();
    const hubId = req.query.hubId || req.query.hub_id || GANGBUK_HUB_ID;
    const projectId = req.query.projectId || req.query.project_id || GANGBUK_PROJECT_ID;
    const cacheKey = `${hubId}:${projectId}`;
    const cached = modelTreeCache.get(cacheKey);
    if (!force && cached && cached.expiresAt > now) {
        return res.json({ ...cached.data, cache: true });
    }

    try {
        const data = await buildLiveGangbukModelTree(req);
        modelTreeCache.set(cacheKey, { data, expiresAt: now + MODEL_TREE_CACHE_TTL_MS });
        return res.json({ ...data, cache: false });
    } catch (err) {
        console.error('[Models Tree] Live Autodesk Docs model tree failed:', err.message);
        return res.status(502).json({
            error: 'AutodeskDocsModelTreeFailed',
            message: err.message,
            projectName: req.query.projectName || GANGBUK_PROJECT_NAME,
            hubId,
            projectId,
            live: false,
            fallbackUsed: false
        });
    }
});
// GET /api/models - List objects in bucket
router.get('/', async (req, res, next) => {
    try {
        const objects = await listObjects();
        res.json(objects.map(o => ({
            name: o.objectKey,
            urn: urnify(o.objectId)
        })));
    } catch (err) {
        next(err);
    }
});

// GET /api/models/:urn/status - Check translation manifest status
router.get('/:urn/status', async (req, res, next) => {
    try {
        const manifest = await getManifest(req.params.urn);
        if (manifest) {
            let messages = [];
            if (manifest.derivatives) {
                for (const derivative of manifest.derivatives) {
                    if (derivative.messages) {
                        messages = messages.concat(derivative.messages || []);
                    }
                }
            }
            res.json({ 
                status: manifest.status, 
                progress: manifest.progress, 
                messages 
            });
        } else {
            res.json({ status: 'n/a' });
        }
    } catch (err) {
        next(err);
    }
});

// POST /api/models - Upload object and trigger SVF2 translation
router.post('/', formidable(), async (req, res, next) => {
    const file = req.files['model-file'];
    if (!file) {
        res.status(400).send('Must upload a file.');
        return;
    }
    try {
        console.log(`[Models] Uploading: ${file.name} (temp path: ${file.path})`);
        const obj = await uploadObject(file.name, file.path);
        const urn = urnify(obj.objectId);
        const rootFilename = req.fields['model-zip-entrypoint'];
        
        console.log(`[Models] Upload complete. Starting translation for URN: ${urn}`);
        await translateObject(urn, rootFilename);
        
        res.json({
            name: obj.objectKey,
            urn
        });
    } catch (err) {
        console.error('[Models] Upload/Translation error:', err.message);
        next(err);
    }
});

module.exports = router;
