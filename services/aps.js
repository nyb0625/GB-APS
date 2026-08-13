const { AuthenticationClient, ResponseType, Scopes } = require('@aps_sdk/authentication');
const { OssClient, Region, PolicyKey } = require('@aps_sdk/oss');
const { ModelDerivativeClient, View, OutputType } = require('@aps_sdk/model-derivative');
const { DataManagementClient } = require('@aps_sdk/data-management');
const axios = require('axios');
const https = require('https');
const dns = require('dns');
try {
    dns.setDefaultResultOrder('ipv4first');
} catch (e) {}

const { 
    APS_CLIENT_ID, 
    APS_CLIENT_SECRET, 
    APS_CALLBACK_URL,
    INTERNAL_TOKEN_SCOPES,
    PUBLIC_TOKEN_SCOPES 
} = require('../config.js');

const authenticationClient = new AuthenticationClient();
const ossClient = new OssClient();
const modelDerivativeClient = new ModelDerivativeClient();
const dataManagementClient = new DataManagementClient();

const APS_BUCKET = process.env.APS_BUCKET || (APS_CLIENT_ID ? APS_CLIENT_ID.toLowerCase() + '-gangbuk-bucket' : 'gangbuk-default-bucket');

const service = module.exports = {};

// Cache internal 2-legged token to avoid redundant API calls
let _twoLeggedCache = null;
let _twoLeggedInflight = null;
const _SKEW_MS = 60 * 1000; // 60 seconds buffer

/**
 * 2-Legged OAuth Token for internal server usage
 */
async function getInternalToken() {
    const now = Date.now();
    if (_twoLeggedCache && _twoLeggedCache.expiresAt - _SKEW_MS > now) {
        return _twoLeggedCache.token;
    }
    if (_twoLeggedInflight) return _twoLeggedInflight;

    _twoLeggedInflight = authenticationClient
        .getTwoLeggedToken(APS_CLIENT_ID, APS_CLIENT_SECRET, INTERNAL_TOKEN_SCOPES)
        .then((credentials) => {
            _twoLeggedCache = {
                token: credentials.access_token,
                expiresAt: Date.now() + credentials.expires_in * 1000,
            };
            return credentials.access_token;
        })
        .finally(() => { _twoLeggedInflight = null; });

    return _twoLeggedInflight;
}

service.getInternalToken = getInternalToken;

/**
 * 2-Legged OAuth Token for public Viewer usage (ViewablesRead scope only)
 */
service.getViewerToken = async () => {
    const credentials = await authenticationClient.getTwoLeggedToken(APS_CLIENT_ID, APS_CLIENT_SECRET, PUBLIC_TOKEN_SCOPES);
    return {
        access_token: credentials.access_token,
        expires_in: credentials.expires_in
    };
};

/**
 * Ensure OSS Bucket exists in Autodesk Platform Services
 */
service.ensureBucketExists = async (bucketKey) => {
    const accessToken = await getInternalToken();
    try {
        await ossClient.getBucketDetails(bucketKey, { accessToken });
    } catch (err) {
        const status = err.axiosError?.response?.status || err.response?.status;
        if (status === 404) {
            await ossClient.createBucket(Region.Us, {
                bucketKey: bucketKey,
                policyKey: PolicyKey.Persistent
            }, { accessToken });
        } else {
            throw err;
        }
    }
};

/**
 * List all objects within the bucket
 */
service.listObjects = async () => {
    await service.ensureBucketExists(APS_BUCKET);
    const accessToken = await getInternalToken();
    let resp = await ossClient.getObjects(APS_BUCKET, { limit: 64, accessToken });
    let objects = resp.items || [];
    
    while (resp.next) {
        const startAt = new URL(resp.next).searchParams.get('startAt');
        resp = await ossClient.getObjects(APS_BUCKET, { limit: 64, startAt, accessToken });
        objects = objects.concat(resp.items || []);
    }
    return objects;
};

/**
 * Upload local file to APS bucket
 */
service.uploadObject = async (objectName, filePath) => {
    await service.ensureBucketExists(APS_BUCKET);
    const accessToken = await getInternalToken();
    const obj = await ossClient.uploadObject(APS_BUCKET, objectName, filePath, { accessToken });
    return obj;
};

/**
 * Request translation of the uploaded design to SVF2 format
 */
service.translateObject = async (urn, rootFilename) => {
    const accessToken = await getInternalToken();
    const job = await modelDerivativeClient.startJob({
        input: {
            urn,
            compressedUrn: !!rootFilename,
            rootFilename
        },
        output: {
            formats: [{
                views: [View._2d, View._3d],
                type: OutputType.Svf2
            }]
        }
    }, { accessToken });
    return job.result;
};

/**
 * Get manifest status of the model translation
 */
service.getManifest = async (urn) => {
    const accessToken = await getInternalToken();
    try {
        const manifest = await modelDerivativeClient.getManifest(urn, { accessToken });
        return manifest;
    } catch (err) {
        const status = err.axiosError?.response?.status || err.response?.status;
        if (status === 404) {
            return null;
        } else {
            throw err;
        }
    }
};

/**
 * Encode object ID to Base64 (ignoring trailing equal signs) to create a URN
 */
service.urnify = (id) => Buffer.from(id).toString('base64').replace(/=/g, '');


// ─────────────────────────────────────────────────────────────
// 3-Legged OAuth & Data Management (Autodesk Docs / ACC)
// ─────────────────────────────────────────────────────────────

// 3-legged scopes used by the 20260720 baseline Autodesk Docs login flow.
const THREE_LEGGED_SCOPES = [Scopes.DataRead, Scopes.ViewablesRead, Scopes.AccountRead];
const APS_TOKEN_URL = 'https://developer.api.autodesk.com/authentication/v2/token';

function normalizeScope(scope) {
    return String(scope || '')
        .replace(/^Scopes\./, '')
        .replace(/([a-z])([A-Z])/g, '$1:$2')
        .replace(/_/g, ':')
        .toLowerCase();
}

function scopeString(scopes) {
    return (scopes || []).map(normalizeScope).join(' ');
}

function httpsPostToken(urlStr, basicAuth, bodyStr) {
    return new Promise((resolve, reject) => {
        const u = new URL(urlStr);
        const req = https.request({
            hostname: u.hostname,
            port: u.port || 443,
            path: u.pathname + u.search,
            method: 'POST',
            headers: {
                'Authorization': `Basic ${basicAuth}`,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json',
                'Content-Length': Buffer.byteLength(bodyStr)
            },
            family: 4 // Force IPv4 to prevent EACCES socket binding errors on Windows
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, text: data }));
        });
        req.on('error', err => reject(err));
        req.write(bodyStr);
        req.end();
    });
}

async function requestOAuthToken(params) {
    const body = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') body.set(key, value);
    });

    const basic = Buffer.from(`${APS_CLIENT_ID}:${APS_CLIENT_SECRET}`).toString('base64');
    const bodyStr = body.toString();

    try {
        const response = await axios.post(APS_TOKEN_URL, bodyStr, {
            headers: {
                'Authorization': `Basic ${basic}`,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json'
            },
            timeout: 15000
        });
        return response.data;
    } catch (error) {
        const status = error.response?.status;
        const detail = error.response?.data?.error_description ||
            error.response?.data?.error ||
            error.response?.data ||
            error.cause?.message ||
            error.message;
        console.warn(`[APS Token] Axios token request failed${status ? ` HTTP ${status}` : ''}:`, detail);
    }

    let httpsResponse;
    try {
        httpsResponse = await httpsPostToken(APS_TOKEN_URL, basic, bodyStr);
    } catch (error) {
        const networkDetail = [error.code, error.address, error.port].filter(Boolean).join(' ');
        throw new Error(`APS token direct HTTPS error: ${error.message}${networkDetail ? ` (${networkDetail})` : ''}`);
    }

    let payload = {};
    try {
        payload = httpsResponse.text ? JSON.parse(httpsResponse.text) : {};
    } catch (error) {
        payload = { raw: httpsResponse.text };
    }

    if (!httpsResponse.ok) {
        const detail = payload.error_description || payload.error || payload.raw || httpsResponse.status;
        throw new Error(`APS token HTTP ${httpsResponse.status}: ${detail}`);
    }

    return payload;
}

async function exchangeCodeForToken(code, redirectUri) {
    try {
        return await requestOAuthToken({
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri
        });
    } catch (error) {
        console.warn('[APS Token] Direct authorization_code exchange failed. Falling back to APS SDK:', error.message);
        try {
            return await authenticationClient.getThreeLeggedToken(
                APS_CLIENT_ID,
                code,
                redirectUri,
                { clientSecret: APS_CLIENT_SECRET }
            );
        } catch (sdkError) {
            throw new Error(`${error.message}; SDK fallback failed: ${sdkError.message || sdkError}`);
        }
    }
}

async function refreshOAuthToken(refreshToken, scopes) {
    try {
        return await requestOAuthToken({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            scope: scopeString(scopes)
        });
    } catch (error) {
        console.warn('[APS Token] Direct refresh_token failed. Falling back to APS SDK:', error.message);
        try {
            return await authenticationClient.refreshToken(
                refreshToken,
                APS_CLIENT_ID,
                { clientSecret: APS_CLIENT_SECRET, scopes }
            );
        } catch (sdkError) {
            throw new Error(`${error.message}; SDK fallback failed: ${sdkError.message || sdkError}`);
        }
    }
}

/**
 * Generate Autodesk Authorize URL
 */
service.getAuthorizationUrl = (callbackUrl, options = {}) => {
    const redirectUri = callbackUrl || APS_CALLBACK_URL;
    let url = authenticationClient.authorize(
        APS_CLIENT_ID,
        ResponseType.Code,
        redirectUri,
        THREE_LEGGED_SCOPES
    );
    if (options.forceLogin) {
        try {
            const parsed = new URL(url);
            parsed.searchParams.set('prompt', 'login');
            parsed.searchParams.set('max_age', '0');
            url = parsed.toString();
        } catch (_err) {
            const joiner = url.includes('?') ? '&' : '?';
            url = `${url}${joiner}prompt=login&max_age=0`;
        }
    }
    // Replace "+" with "%20" to avoid issues with strict OAuth servers
    return url.replace(/\+/g, '%20');
};

/**
 * Handle Auth Callback and exchange code for 3-legged tokens
 */
service.authCallbackMiddleware = async (req, res, next, callbackUrl) => {
    const redirectUri = callbackUrl || APS_CALLBACK_URL;
    
    if (req.query.error) {
        return next(new Error(`Autodesk OAuth error: ${req.query.error} - ${req.query.error_description || ''}`));
    }
    if (!req.query.code) {
        return next(new Error('Authorization code not received. Please try logging in again.'));
    }

    try {
        const internalCredentials = await exchangeCodeForToken(req.query.code, redirectUri);
        const publicCredentials = await refreshOAuthToken(internalCredentials.refresh_token, PUBLIC_TOKEN_SCOPES);
        
        req.session.public_token = publicCredentials.access_token;
        req.session.internal_token = internalCredentials.access_token;
        req.session.refresh_token = publicCredentials.refresh_token;
        req.session.expires_at = Date.now() + internalCredentials.expires_in * 1000;
        
        next();
    } catch (err) {
        console.error('[APS] Token exchange failed:', err.message);
        next(err);
    }
};

/**
 * Auto Token Refresh Middleware
 */
service.authRefreshMiddleware = async (req, res, next) => {
    const { refresh_token, expires_at } = req.session || {};
    if (!refresh_token) {
        return res.status(401).json({ error: 'Not authenticated. Please login first.' });
    }

    try {
        if (expires_at < Date.now()) {
            console.log('[APS] Token expired, refreshing 3-legged tokens...');
            const internalCredentials = await refreshOAuthToken(refresh_token, THREE_LEGGED_SCOPES);
            const publicCredentials = await refreshOAuthToken(internalCredentials.refresh_token, PUBLIC_TOKEN_SCOPES);
            
            req.session.public_token = publicCredentials.access_token;
            req.session.internal_token = internalCredentials.access_token;
            req.session.refresh_token = publicCredentials.refresh_token;
            req.session.expires_at = Date.now() + internalCredentials.expires_in * 1000;
        }
        
        req.internalOAuthToken = {
            access_token: req.session.internal_token,
            expires_in: Math.round((req.session.expires_at - Date.now()) / 1000),
        };
        req.publicOAuthToken = {
            access_token: req.session.public_token,
            expires_in: Math.round((req.session.expires_at - Date.now()) / 1000),
        };
        
        next();
    } catch (err) {
        console.error('[APS] Token refresh failed:', err.message);
        req.session.destroy();
        return res.status(401).json({ error: 'Session expired. Please login again.' });
    }
};

/**
 * Get profile info of the logged-in user
 */
service.getUserProfile = async (accessToken) => {
    return await authenticationClient.getUserInfo(accessToken);
};

/**
 * Fetch list of hubs
 */
service.getHubs = async (accessToken) => {
    const resp = await dataManagementClient.getHubs({ accessToken });
    return resp.data;
};

/**
 * Fetch projects within a hub
 */
service.getProjects = async (hubId, accessToken) => {
    const resp = await dataManagementClient.getHubProjects(hubId, { accessToken });
    return resp.data;
};

/**
 * Fetch top folders or subfolder contents
 */
service.getProjectContents = async (hubId, projectId, folderId, accessToken) => {
    if (!folderId) {
        const resp = await dataManagementClient.getProjectTopFolders(hubId, projectId, { accessToken });
        return resp.data;
    } else {
        const resp = await dataManagementClient.getFolderContents(projectId, folderId, { accessToken });
        return resp.data;
    }
};

/**
 * Fetch history versions of a item
 */
service.getItemVersions = async (projectId, itemId, accessToken) => {
    const resp = await dataManagementClient.getItemVersions(projectId, itemId, { accessToken });
    return resp.data;
};

/**
 * Fetch project issues container ID
 */
service.getIssueContainerInfo = async (hubId, projectId, accessToken) => {
    const response = await fetch(`https://developer.api.autodesk.com/project/v1/hubs/${hubId}/projects/${projectId}`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (!response.ok) {
        throw new Error(`Failed to get project info: ${response.statusText}`);
    }
    const data = await response.json();
    const issuesRel = data.data?.relationships?.issues;
    if (issuesRel && issuesRel.data && issuesRel.data.id) {
        return issuesRel.data.id;
    }
    return null;
};

/**
 * Fetch project issues from APS Issues API (v2)
 */
service.getProjectIssues = async (containerId, accessToken) => {
    const response = await fetch(`https://developer.api.autodesk.com/issues/v2/containers/${containerId}/issues?limit=100`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (!response.ok) {
        throw new Error(`Failed to fetch project issues: ${response.statusText}`);
    }
    const data = await response.json();
    return data.data || [];
};

/**
 * Global Search API for project-wide RVT files under a root folder
 * Endpoint: GET /data/v1/projects/{projectId}/folders/{rootFolderId}/search?filter[extension]=rvt
 */
service.searchProjectRvtFiles = async (projectId, rootFolderId, accessToken) => {
    if (!rootFolderId) {
        try {
            const topFoldersResp = await dataManagementClient.getProjectTopFolders(null, projectId, { accessToken });
            const topFolders = topFoldersResp.data || [];
            const pFiles = topFolders.find(f => {
                const name = (f.attributes?.displayName || f.attributes?.name || f.name || '').toLowerCase().replace(/\s+/g, '');
                return name === 'projectfiles' || name.includes('projectfiles');
            });
            if (pFiles) {
                rootFolderId = pFiles.id;
            } else if (topFolders[0]) {
                rootFolderId = topFolders[0].id;
            }
        } catch (e) {
            console.warn('[APS Service] Top folders fetch warning:', e.message);
        }
    }

    if (!rootFolderId) return [];

    const url = `https://developer.api.autodesk.com/data/v1/projects/${projectId}/folders/${encodeURIComponent(rootFolderId)}/search?filter[extension]=rvt`;
    const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!response.ok) {
        console.warn(`[APS Service] Search API HTTP ${response.status}: ${response.statusText}`);
        return [];
    }

    const resJson = await response.json();
    const items = resJson.data || [];
    const included = resJson.included || [];

    const folderMap = new Map();
    included.forEach(inc => {
        if (inc.type === 'folders' || inc.type === 'items') {
            folderMap.set(inc.id, inc.attributes?.displayName || inc.attributes?.name || '');
        }
    });

    const results = [];
    for (const item of items) {
        const displayName = item.attributes?.displayName || item.attributes?.name || item.name || '';
        const tipId = item.relationships?.tip?.data?.id || item.id;
        const urn = service.urnify(tipId);

        const parentId = item.relationships?.parent?.data?.id;
        const parentFolderName = parentId ? (folderMap.get(parentId) || '') : '';

        results.push({
            id: item.id,
            displayName,
            urn,
            tipId,
            parentFolderName
        });
    }

    return results;
};
