/**
 * routes/cctv.js
 * 국토교통부 UTIC / ITS OpenAPI 기반 CCTV 스트리밍 연동, 타겟 필터링 및 Path-Based Dynamic Proxy Router
 */
const express = require('express');
const axios = require('axios');
const https = require('https');
const config = require('../config.js');
const router = express.Router();

// 1. API 키 적용
const UTIC_API_KEY = process.env.UTIC_API_KEY || config.UTIC_API_KEY || "4ydVvgYFUHonR2Q0ZysY7MM1MQ5xJ84pwAr3jVMY";

// 2. 미디어 서버 위장 헤더 (Header Spoofing)
const SPOOF_HEADERS = {
    'Referer': 'https://www.utic.go.kr/',
    'Origin': 'https://www.utic.go.kr',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*'
};

// 3. TLS 인증 우회 axios 인스턴스
const tlsBypassAgent = new https.Agent({ rejectUnauthorized: false });
const axiosTls = axios.create({ httpsAgent: tlsBypassAgent });

/**
 * UTIC 6개 지정 CCTV 채널 정의 및 사용자 지정 6개 exact Revit BIM 모델 URN 매핑
 *
 * 1. 강남역   ➔ 강북_구조물_신설_02_응집침전지_C
 *    URN: dXJuOmFkc2sud2lwcHJvZDpmcy5maWxlOnZmLk1EYVFnc1N6UVBheVJHaU53dGl3cUE_dmVyc2lvbj0y
 * 2. 양재역   ➔ 강북_구조물_신설_03_급속여과지_C
 *    URN: dXJuOmFkc2sud2lwcHJvZDpmcy5maWxlOnZmLnVXSjRybjluUjJTTnNBaGZ0OW5aLVE_dmVyc2lvbj0z
 * 3. 강서구청 ➔ 강북_구조물_신설_04_후오존접촉지_C
 *    URN: dXJuOmFkc2sud2lwcHJvZDpmcy5maWxlOnZmLko5dGd0S0hNU19DQ0pSMDEtVVR4R0E_dmVyc2lvbj0y
 * 4. 광화문광장 ➔ 강북_구조물_신설_05_활성탄흡착지_C
 *    URN: dXJuOmFkc2sud2lwcHJvZDpmcy5maWxlOnZmLlVVdkJia3dIU2QyQmt4aEhCaGZKLVE_dmVyc2lvbj0y
 */
const UTIC_CCTV_CHANNELS = [
    {
        id: 'cctv_gangnam_stn',
        name: '강남역',
        title: '강남역',
        streamType: 'hls',
        streamUrl: 'https://strm2.spatic.go.kr/live/207.stream/playlist.m3u8',
        modelName: '강북_구조물_신설_02_응집침전지_C',
        modelUrn: 'dXJuOmFkc2sud2lwcHJvZDpmcy5maWxlOnZmLk1EYVFnc1N6UVBheVJHaU53dGl3cUE_dmVyc2lvbj0y',
        img: '/img/lapse/lapse_1.jpg'
    },
    {
        id: 'cctv_yangjae_stn',
        name: '양재역',
        title: '양재역',
        streamType: 'hls',
        streamUrl: 'https://strm2.spatic.go.kr/live/208.stream/playlist.m3u8',
        modelName: '강북_구조물_신설_03_급속여과지_C',
        modelUrn: 'dXJuOmFkc2sud2lwcHJvZDpmcy5maWxlOnZmLnVXSjRybjluUjJTTnNBaGZ0OW5aLVE_dmVyc2lvbj0z',
        img: '/img/lapse/lapse_2.jpg'
    },
    {
        id: 'cctv_gangseo_gu',
        name: '강서구청',
        title: '강서구청',
        streamType: 'hls',
        streamUrl: 'https://strm1.spatic.go.kr/live/103.stream/playlist.m3u8',
        modelName: '강북_구조물_신설_04_후오존접촉지_C',
        modelUrn: 'dXJuOmFkc2sud2lwcHJvZDpmcy5maWxlOnZmLko5dGd0S0hNU19DQ0pSMDEtVVR4R0E_dmVyc2lvbj0y',
        img: '/img/lapse/lapse_3.jpg'
    },
    {
        id: 'cctv_gwanghwamun',
        name: '광화문광장',
        title: '광화문광장',
        streamType: 'hls',
        streamUrl: 'https://strm3.spatic.go.kr/live/273.stream/playlist.m3u8',
        modelName: '강북_구조물_신설_05_활성탄흡착지_C',
        modelUrn: 'dXJuOmFkc2sud2lwcHJvZDpmcy5maWxlOnZmLlVVdkJia3dIU2QyQmt4aEhCaGZKLVE_dmVyc2lvbj0y',
        img: '/img/lapse/lapse_1.jpg'
    },
    {
        id: 'cctv_hyunchung_won',
        name: '국립현충원',
        title: '국립현충원',
        streamType: 'hls',
        streamUrl: 'https://strm1.spatic.go.kr/live/82.stream/playlist.m3u8',
        modelName: '강북_구조물_신설_06_역세척펌프동_C',
        modelUrn: 'dXJuOmFkc2sud2lwcHJvZDpmcy5maWxlOnZmLjFZR3FvRXZ0U1lXZ29SN19WN016bXc_dmVyc2lvbj08',
        img: '/img/lapse/lapse_2.jpg'
    },
    {
        id: 'cctv_nonhyeon_stn',
        name: '논현역',
        title: '논현역',
        streamType: 'hls',
        streamUrl: 'https://strm2.spatic.go.kr/live/206.stream/playlist.m3u8',
        modelName: '강북_구조물_신설_07_정수지_C',
        modelUrn: 'dXJuOmFkc2sud2lwcHJvZDpmcy5maWxlOnZmLmxWN1cwcnduUnNpTnNJOWFaaF9jR2c_dmVyc2lvbj05',
        img: '/img/lapse/lapse_3.jpg'
    }
];

/**
 * KB kind CCTV: UTIC 내부 API 호출로 실제 kbsapi.loomex.net HLS URL 획득
 */
async function resolveKbStreamUrl(cctvIp) {
    try {
        const apiUrl = `https://www.utic.go.kr/map/getGyeonggiCctvUrl.do?cctvIp=${cctvIp}`;
        const resp = await axiosTls.get(apiUrl, {
            headers: SPOOF_HEADERS,
            timeout: 4000
        });
        const raw = String(resp.data || '').trim();
        if (!raw || raw === 'null') return null;

        let resolved = raw;
        if (resolved.startsWith('//')) {
            resolved = 'https:' + resolved;
        }
        return resolved;
    } catch (e) {
        console.warn(`[KB CCTV] resolveKbStreamUrl(${cctvIp}) failed:`, e.message);
        return null;
    }
}

/**
 * UTIC JSP 페이지 파싱으로 실제 HLS source URL 추출
 */
async function resolveUticPageStreamUrl(pageUrl) {
    try {
        const resp = await axiosTls.get(pageUrl, {
            headers: { ...SPOOF_HEADERS, 'Accept': 'text/html' },
            timeout: 5000
        });
        const html = resp.data || '';
        const sourceMatch = html.match(/<source\s+src="([^"]+)"/i);
        if (sourceMatch) return sourceMatch[1];
        const m3u8Match = html.match(/https?:\/\/[^\s'"<>]+\.m3u8[^\s'"<>\-]*/i);
        if (m3u8Match) return m3u8Match[0];
        return null;
    } catch (e) {
        console.warn('[UTIC JSP] resolveUticPageStreamUrl failed:', e.message);
        return null;
    }
}

/**
 * GET /api/cctv/filtered-list
 * 6개 지정 UTIC CCTV 채널의 실제 HLS 스트림 URL 및 지정 3D BIM 모델 URN 반환
 */
router.get('/filtered-list', async (req, res) => {
    try {
        console.log('[UTIC CCTV] Resolving 6 CCTV channels with 100% User-Specified Revit Model URNs...');

        const resolvedChannels = await Promise.all(UTIC_CCTV_CHANNELS.map(async (ch) => {
            let streamUrl = null;

            if (ch.streamType === 'hls') {
                streamUrl = ch.streamUrl;
            } else if (ch.streamType === 'kb') {
                streamUrl = await resolveKbStreamUrl(ch.cctvIp);
            } else if (ch.streamType === 'utic_page') {
                streamUrl = await resolveUticPageStreamUrl(ch.pageUrl);
            }

            return {
                id: ch.id,
                name: ch.name,
                streamUrl: streamUrl || null,
                pageUrl: ch.pageUrl || null,
                streamType: ch.streamType,
                modelName: ch.modelName,
                modelUrn: ch.modelUrn,
                img: ch.img,
                online: !!streamUrl
            };
        }));

        const online = resolvedChannels.filter(c => c.online).length;
        console.log(`[UTIC CCTV] Resolved ${online}/${resolvedChannels.length} channels with User-Specified Revit models.`);

        return res.json({
            success: true,
            count: resolvedChannels.length,
            data: resolvedChannels
        });
    } catch (err) {
        console.error('🚨 [UTIC CCTV API Error]:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * 📌 [경로 기반(Path-Based) 다이내믹 프록시 구축]
 * Route: /api/cctv/proxy/:protocol/:host
 */
router.use('/proxy/:protocol/:host', async (req, res) => {
    try {
        const { protocol, host } = req.params;
        const subPath = req.url || '/';

        let targetUrl = `${protocol}://${host}${subPath}`;

        if (host.includes('utic.go.kr') || host.includes('its.go.kr')) {
            try {
                const parsed = new URL(targetUrl);
                if (!parsed.searchParams.has('key')) {
                    parsed.searchParams.set('key', UTIC_API_KEY);
                }
                targetUrl = parsed.toString();
            } catch (_) {}
        }

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
        res.setHeader('Access-Control-Allow-Headers', '*');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

        if (req.method === 'OPTIONS') {
            return res.status(200).end();
        }

        const isM3u8 = subPath.includes('.m3u8');

        let response = null;
        try {
            response = await axiosTls({
                method: req.method,
                url: targetUrl,
                headers: SPOOF_HEADERS,
                responseType: isM3u8 ? 'text' : 'arraybuffer',
                timeout: 12000,
                validateStatus: status => status < 500
            });
        } catch (err1) {
            console.warn(`[Path Proxy] Fetch warning (${err1.message}).`);
            res.setHeader('Access-Control-Allow-Origin', '*');
            return res.status(502).json({ success: false, error: `Upstream fetch failed: ${err1.message}` });
        }

        if (isM3u8) {
            res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
            let manifest = typeof response.data === 'string' ? response.data : Buffer.from(response.data).toString('utf8');

            const baseUrl = `${protocol}://${host}${subPath.substring(0, subPath.lastIndexOf('/') + 1)}`;

            // 1. Rewrite absolute http/https URLs to proxy
            manifest = manifest.replace(/(https?:\/\/[^\s"'#]+)/g, (match) => {
                if (match.startsWith('https://')) {
                    return '/api/cctv/proxy/https/' + match.replace('https://', '');
                } else {
                    return '/api/cctv/proxy/http/' + match.replace('http://', '');
                }
            });

            // 2. Rewrite relative segment URLs (e.g. 207-0.ts or sub-manifests) to proxy
            manifest = manifest.split('\n').map(line => {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('/api/cctv/proxy/')) {
                    if (trimmed.startsWith('/')) {
                        return `/api/cctv/proxy/${protocol}/${host}${trimmed}`;
                    } else {
                        const fullUrl = baseUrl + trimmed;
                        const p = fullUrl.startsWith('https://') ? 'https' : 'http';
                        return `/api/cctv/proxy/${p}/${fullUrl.replace(/^https?:\/\//, '')}`;
                    }
                }
                return line;
            }).join('\n');

            return res.status(response.status || 200).send(manifest);
        } else {
            const contentType = response.headers['content-type'] || (subPath.endsWith('.ts') ? 'video/mp2t' : 'application/octet-stream');
            res.setHeader('Content-Type', contentType);
            return res.status(response.status || 200).send(Buffer.from(response.data));
        }
    } catch (err) {
        console.error(`🚨 [Path Proxy Error]:`, err.message);
        res.setHeader('Access-Control-Allow-Origin', '*');
        return res.status(502).json({ success: false, error: `Path Proxy Error: ${err.message}` });
    }
});

/**
 * GET /api/cctv/live
 */
router.get('/live', async (req, res) => {
    try {
        const channels = UTIC_CCTV_CHANNELS.map((ch, idx) => ({
            id: ch.id,
            title: ch.name,
            streamUrl: ch.streamUrl || '',
            format: 'HLS',
            modelName: ch.modelName || '',
            modelUrn: ch.modelUrn || '',
            img: ch.img || `/img/lapse/lapse_${(idx % 3) + 1}.jpg`
        }));

        return res.json({
            success: true,
            source: 'utic-designated-channels',
            count: channels.length,
            channels
        });
    } catch (err) {
        console.error('🚨 [CCTV Live Error]:', err.message);
        return res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
