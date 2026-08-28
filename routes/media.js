/**
 * routes/media.js
 * On-the-fly Video Transcoding and Streaming Router for Autodesk Docs (.avi, .mp4, etc.)
 */
const express = require('express');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { authRefreshMiddleware, getInternalToken, getItemVersions } = require('../services/aps.js');

if (ffmpegStatic) {
    ffmpeg.setFfmpegPath(ffmpegStatic);
}

const router = express.Router();
const hlsJobs = new Map();
const mediaCacheRoot = path.join(os.tmpdir(), 'gangbuk-aps-media-cache');

fs.mkdirSync(mediaCacheRoot, { recursive: true });

router.use(authRefreshMiddleware);

function getMediaCacheKey(projectId, itemId, versionId) {
    return crypto
        .createHash('sha1')
        .update([projectId || '', itemId || '', versionId || ''].join('|'))
        .digest('hex');
}

function waitForFile(filePath, timeoutMs = 20000) {
    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
        const tick = () => {
            fs.stat(filePath, (err, stat) => {
                if (!err && stat.size > 0) {
                    resolve(true);
                    return;
                }
                if (Date.now() - startedAt >= timeoutMs) {
                    reject(new Error('Timed out waiting for HLS playlist'));
                    return;
                }
                setTimeout(tick, 300);
            });
        };
        tick();
    });
}

function startHlsJob(cacheKey, signedUrl, displayName) {
    const existing = hlsJobs.get(cacheKey);
    if (existing && existing.status !== 'failed') return existing;

    const dir = path.join(mediaCacheRoot, cacheKey);
    fs.mkdirSync(dir, { recursive: true });

    const playlistPath = path.join(dir, 'playlist.m3u8');
    const segmentPattern = path.join(dir, 'segment-%05d.ts');
    const job = {
        status: 'starting',
        dir,
        playlistPath,
        error: null,
        command: null
    };
    hlsJobs.set(cacheKey, job);

    const command = ffmpeg(signedUrl)
        .inputOptions([
            '-nostdin',
            '-analyzeduration 100M',
            '-probesize 100M'
        ])
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions([
            '-map 0:v:0',
            '-map 0:a?',
            '-preset veryfast',
            '-crf 24',
            '-profile:v baseline',
            '-level 3.0',
            '-pix_fmt yuv420p',
            '-sc_threshold 0',
            '-g 48',
            '-keyint_min 48',
            '-hls_time 2',
            '-hls_list_size 0',
            '-hls_flags independent_segments+append_list',
            '-hls_segment_type mpegts',
            '-hls_segment_filename',
            segmentPattern
        ])
        .format('hls')
        .output(playlistPath)
        .on('start', cmdLine => {
            job.status = 'running';
            console.log('[Media HLS] FFmpeg spawn:', cmdLine);
        })
        .on('error', (err, stdout, stderr) => {
            job.status = 'failed';
            job.error = err.message;
            console.error(`[Media HLS] FFmpeg error for ${displayName}:`, err.message);
            if (stderr) console.error('[Media HLS] FFmpeg stderr:', String(stderr).slice(-2000));
        })
        .on('end', () => {
            job.status = 'ready';
            console.log(`[Media HLS] Transcoding finished for: ${displayName}`);
        });

    job.command = command;
    command.run();
    return job;
}

// Helper: Resolve S3 Signed Download URL for a file in Docs
async function getSignedDownloadUrl(projectId, itemId, versionId, token) {
    let rawItem = String(itemId || versionId || '').trim();
    let rawVersion = String(versionId || itemId || '').trim();

    // Decode base64 URN if provided
    function tryDecode(val) {
        if (!val.startsWith('urn:') && val.length > 20 && /^[A-Za-z0-9+/=_-]+$/.test(val)) {
            try {
                const dec = Buffer.from(val.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
                if (dec.startsWith('urn:')) return dec;
            } catch (e) {}
        }
        return val;
    }

    rawItem = tryDecode(rawItem);
    rawVersion = tryDecode(rawVersion);

    // If rawItem is a version URN (fs.file:vf...), extract lineage ID or use it directly
    let targetVersion = null;

    try {
        // Fetch all versions of this item
        const versions = await getItemVersions(projectId, rawItem, token);
        if (Array.isArray(versions) && versions.length > 0) {
            targetVersion = (rawVersion && versions.find(v => v.id === rawVersion)) || versions[0];
        }
    } catch (err) {
        console.warn('[Media] getItemVersions with rawItem failed:', err.message);
    }

    // Fallback: If targetVersion not found, try fetching with rawVersion
    if (!targetVersion && rawVersion && rawVersion !== rawItem) {
        try {
            const versions = await getItemVersions(projectId, rawVersion, token);
            if (Array.isArray(versions) && versions.length > 0) {
                targetVersion = versions[0];
            }
        } catch (err) {
            console.warn('[Media] getItemVersions with rawVersion failed:', err.message);
        }
    }

    if (!targetVersion) {
        throw new Error(`Could not locate version record for item: ${rawItem}, version: ${rawVersion}`);
    }

    const storageId = targetVersion.relationships?.storage?.data?.id;
    const displayName = targetVersion.attributes?.displayName || targetVersion.attributes?.name || 'video.avi';

    if (!storageId) {
        throw new Error('Version does not have storage relationship');
    }

    const match = String(storageId).match(/^urn:adsk\.objects:os\.object:([^/]+)\/(.+)$/);
    if (!match) {
        throw new Error(`Unrecognized storage URN format: ${storageId}`);
    }

    const [, bucketKey, objectKey] = match;

    // Call OSS signeds3download to get direct S3 streaming URL
    const signedResp = await axios.get(
        `https://developer.api.autodesk.com/oss/v2/buckets/${encodeURIComponent(bucketKey)}/objects/${encodeURIComponent(objectKey)}/signeds3download?minutesExpiration=60`,
        { headers: { Authorization: `Bearer ${token}` } }
    );

    const signedUrl = signedResp.data?.url || signedResp.data?.signedUrl;
    if (!signedUrl) {
        throw new Error('Failed to obtain signed S3 download URL from OSS');
    }

    return { signedUrl, displayName };
}

/**
 * GET /api/media/stream
 * Stream video file with on-the-fly transcoding for non-web formats (e.g. .avi, .mov, .mkv)
 */
router.get('/stream', async (req, res) => {
    const { project_id, version_id, item_id } = req.query;
    if (!project_id || (!version_id && !item_id)) {
        return res.status(400).json({ error: 'project_id and version_id (or item_id) are required' });
    }

    const token = req.internalOAuthToken?.access_token || await getInternalToken();

    try {
        const { signedUrl, displayName } = await getSignedDownloadUrl(project_id, item_id, version_id, token);
        const ext = String(displayName.split('.').pop() || '').toLowerCase();

        // 1. MP4 / WebM: Direct streaming via proxy without transcoding
        if (ext === 'mp4' || ext === 'webm') {
            const range = req.headers.range;
            const headers = range ? { Range: range } : {};

            const sourceResp = await axios.get(signedUrl, {
                headers,
                responseType: 'stream',
                validateStatus: status => status >= 200 && status < 400
            });

            res.status(sourceResp.status);
            ['content-type', 'content-length', 'content-range', 'accept-ranges'].forEach(header => {
                if (sourceResp.headers[header]) {
                    res.setHeader(header, sourceResp.headers[header]);
                }
            });
            if (!res.getHeader('content-type')) {
                res.setHeader('content-type', ext === 'webm' ? 'video/webm' : 'video/mp4');
            }

            sourceResp.data.pipe(res);
            req.on('close', () => {
                if (sourceResp.data && typeof sourceResp.data.destroy === 'function') {
                    sourceResp.data.destroy();
                }
            });
            return;
        }

        // 2. AVI / Non-native formats: Real-time on-the-fly transcoding to Fragmented MP4 (H.264 + AAC)
        console.log(`[Media Stream] Starting on-the-fly transcoding for: ${displayName} (${ext})`);

        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Cache-Control', 'no-cache, no-store');
        res.setHeader('Transfer-Encoding', 'chunked');

        const command = ffmpeg(signedUrl)
            .inputOptions([
                '-nostdin',
                '-analyzeduration 100M',
                '-probesize 100M'
            ])
            .format('mp4')
            .videoCodec('libx264')
            .audioCodec('aac')
            .outputOptions([
                '-map 0:v:0',
                '-map 0:a?',
                '-movflags +frag_keyframe+empty_moov+default_base_moof',
                '-preset ultrafast',
                '-tune zerolatency',
                '-crf 26',
                '-profile:v baseline',
                '-level 3.0',
                '-pix_fmt yuv420p'
            ])
            .on('start', cmdLine => {
                console.log('[Media Stream] FFmpeg spawn:', cmdLine);
            })
            .on('error', (err, stdout, stderr) => {
                if (err.message && (err.message.includes('SIGKILL') || err.message.includes('Output stream closed') || err.message.includes('premature close'))) {
                    console.log('[Media Stream] Client closed stream.');
                    return;
                }
                console.error('[Media Stream] FFmpeg error:', err.message);
                if (stderr) {
                    console.error('[Media Stream] FFmpeg stderr:', String(stderr).slice(-2000));
                }
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Video transcoding failed', details: err.message });
                }
            })
            .on('end', () => {
                console.log(`[Media Stream] Transcoding finished for: ${displayName}`);
            });

        // Pipe output stream to HTTP response
        command.pipe(res, { end: true });

        // Clean up ffmpeg process immediately if client closes connection/modal
        req.on('close', () => {
            try {
                command.kill('SIGKILL');
            } catch (e) {}
        });

    } catch (err) {
        console.error('[Media Stream Error]', err.message);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to stream video', details: err.message });
        }
    }
});

/**
 * GET /api/media/hls-session
 * Start an HLS transcoding session for AVI/non-native videos and return a playable playlist URL.
 */
router.get('/hls-session', async (req, res) => {
    const { project_id, version_id, item_id } = req.query;
    if (!project_id || (!version_id && !item_id)) {
        return res.status(400).json({ error: 'project_id and version_id (or item_id) are required' });
    }

    const token = req.internalOAuthToken?.access_token || await getInternalToken();

    try {
        const { signedUrl, displayName } = await getSignedDownloadUrl(project_id, item_id, version_id, token);
        const cacheKey = getMediaCacheKey(project_id, item_id, version_id);
        const job = startHlsJob(cacheKey, signedUrl, displayName);

        if (job.status === 'failed') {
            return res.status(500).json({ error: 'HLS transcoding failed', details: job.error || 'Unknown error' });
        }

        await waitForFile(job.playlistPath, 25000);

        res.json({
            mode: 'hls',
            status: job.status,
            fileName: displayName,
            playlistUrl: `/api/media/hls/${encodeURIComponent(cacheKey)}/playlist.m3u8`
        });
    } catch (err) {
        console.error('[Media HLS Session Error]', err.message);
        res.status(500).json({ error: 'Failed to start HLS playback session', details: err.message });
    }
});

/**
 * GET /api/media/hls/:cacheKey/:fileName
 * Serve generated HLS playlist and MPEG-TS segments.
 */
router.get('/hls/:cacheKey/:fileName', (req, res) => {
    const cacheKey = String(req.params.cacheKey || '');
    const fileName = String(req.params.fileName || '');
    if (!/^[a-f0-9]{40}$/i.test(cacheKey) || !/^(playlist\.m3u8|segment-\d{5}\.ts)$/.test(fileName)) {
        return res.status(400).json({ error: 'Invalid HLS asset path' });
    }

    const filePath = path.join(mediaCacheRoot, cacheKey, fileName);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'HLS asset is not ready yet' });
    }

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Content-Type', fileName.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t');
    res.sendFile(filePath);
});

/**
 * GET /api/media/download-url
 * Get direct S3 signed download URL for user download
 */
router.get('/download-url', async (req, res) => {
    const { project_id, version_id, item_id } = req.query;
    if (!project_id || (!version_id && !item_id)) {
        return res.status(400).json({ error: 'project_id and version_id (or item_id) are required' });
    }

    const token = req.internalOAuthToken?.access_token || await getInternalToken();

    try {
        const { signedUrl, displayName } = await getSignedDownloadUrl(project_id, item_id, version_id, token);
        res.json({ url: signedUrl, fileName: displayName });
    } catch (err) {
        console.error('[Media Download URL Error]', err.message);
        res.status(500).json({ error: 'Failed to obtain download URL', details: err.message });
    }
});

module.exports = router;
