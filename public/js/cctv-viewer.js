/* ==========================================================================
   cctv-viewer.js — Path-Based Dynamic HLS Proxy Player & Exception UI
   ========================================================================== */

export * from './cctv.js';
import { playOfficialHlsStream } from './cctv.js';

let currentHls = null;
let fatalErrorCount = 0;

/**
 * 원본 Stream URL -> Path-Based Proxy URL 변환
 * 원본 예시: http://cctvsec.ktict.co.kr/1010/live.m3u8
 * 변환 예시: /api/cctv/proxy/http/cctvsec.ktict.co.kr/1010/live.m3u8
 */
export function getPathProxyUrl(rawStreamUrl) {
    if (!rawStreamUrl) return '';
    if (rawStreamUrl.startsWith('/api/cctv/proxy/')) return rawStreamUrl;

    try {
        const urlObj = new URL(rawStreamUrl);
        const protocol = urlObj.protocol.replace(':', ''); // 'http' 또는 'https'
        const host = urlObj.host;
        const path = urlObj.pathname + urlObj.search;

        return `/api/cctv/proxy/${protocol}/${host}${path}`;
    } catch (_) {
        return rawStreamUrl;
    }
}

/**
 * 📌 [에이전트 적용 가이드: HLS URL 변환 및 Dead Camera 404 예외 처리 UI]
 */
export function playTargetCctv(targetStreamUrl, title, img) {
    const video = document.getElementById('cctv-video-player');
    const liveTitle = document.getElementById('cctv-live-title');

    // 에러 카운터 및 오프라인 오버레이 초기화
    fatalErrorCount = 0;
    const offlineNotice = document.getElementById('cctv-offline-notice');
    if (offlineNotice) {
        offlineNotice.style.display = 'none';
    }

    if (liveTitle && title) {
        liveTitle.innerHTML = `<i class="fas fa-video"></i> 실시간 CCTV 영상 (${title})`;
    }

    if (!video) return;

    // 경로 기반(Path-Based) 프록시 주소로 변환
    const proxyStreamUrl = getPathProxyUrl(targetStreamUrl);
    console.log(`[Path Proxy HLS] Loading stream: ${proxyStreamUrl}`);

    // 기존 HLS 인스턴스 완전 파기
    if (currentHls) {
        currentHls.destroy();
        currentHls = null;
    }
    if (window.currentHls) {
        window.currentHls.destroy();
        window.currentHls = null;
    }
    if (window.hlsEngine) {
        window.hlsEngine.destroy();
        window.hlsEngine = null;
    }

    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
        currentHls = new Hls({
            enableWorker: true,
            lowLatencyMode: true,
            backBufferLength: 90
        });
        window.currentHls = currentHls;
        window.hlsEngine = currentHls;

        currentHls.loadSource(proxyStreamUrl);
        currentHls.attachMedia(video);

        currentHls.on(Hls.Events.MANIFEST_PARSED, () => {
            console.log('[Path Proxy HLS] Manifest parsed. Autoplay starting...');
            video.play().catch(e => {
                console.warn('[Path Proxy HLS] Autoplay blocked, muted playback fallback:', e.message);
                video.muted = true;
                video.play().catch(() => {});
            });
        });

        // 📌 [에이전트 적용 가이드: Dead Camera 404/에러 예외 처리 UI]
        currentHls.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) {
                fatalErrorCount++;
                console.warn(`[Path Proxy HLS] Fatal Error (${fatalErrorCount}/3): ${data.type} - ${data.details}`);

                if (fatalErrorCount >= 3) {
                    console.error('[Path Proxy HLS] 3 Consecutive fatal errors reached. Destroying HLS & displaying offline UI...');
                    if (currentHls) {
                        currentHls.destroy();
                        currentHls = null;
                    }

                    // 1. 헤더 타이틀 오프라인 상태 표시
                    if (liveTitle) {
                        liveTitle.innerHTML = `<i class="fas fa-exclamation-triangle" style="color:#ef4444;"></i> 해당 구간 카메라 오프라인 (점검 중) — ${title || ''}`;
                    }

                    // 2. 비디오 플레이어 오프라인 오버레이 UI 렌더링
                    const videoWrapper = video.closest('.video-wrapper') || video.parentElement;
                    let noticeEl = document.getElementById('cctv-offline-notice');
                    if (!noticeEl && videoWrapper) {
                        noticeEl = document.createElement('div');
                        noticeEl.id = 'cctv-offline-notice';
                        noticeEl.style.cssText = 'position:absolute; top:0; left:0; width:100%; height:100%; background:rgba(15,23,42,0.92); z-index:8; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; color:#f87171; border-radius:4px; font-weight:600; text-align:center; padding:20px;';
                        videoWrapper.appendChild(noticeEl);
                    }
                    if (noticeEl) {
                        noticeEl.innerHTML = `
                            <i class="fas fa-video-slash" style="font-size: 2.5rem; color: #ef4444;"></i>
                            <span style="font-size: 1.1rem; color: #f87171;">해당 구간 카메라 오프라인 (점검 중)</span>
                            <span style="font-size: 0.85rem; color: #94a3b8;">지자체 관제 서버 점검 중이거나 미디어 네트워크 연결이 원활하지 않습니다.</span>
                        `;
                        noticeEl.style.display = 'flex';
                    }
                } else {
                    try {
                        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                            currentHls.startLoad();
                        } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                            currentHls.recoverMediaError();
                        }
                    } catch (_) {}
                }
            }
        });
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = proxyStreamUrl;
        video.play().catch(() => {
            video.muted = true;
            video.play().catch(() => {});
        });
    } else {
        video.src = proxyStreamUrl;
    }
}

export function playCctvWithProxy(cctv) {
    if (!cctv) return;
    const rawStreamUrl = cctv.streamUrl || cctv.cctvurl || cctv.url || '';
    const title = cctv.name || cctv.title || cctv.cctvname || '';
    playTargetCctv(rawStreamUrl, title, cctv.img);
}

if (typeof window !== 'undefined') {
    window.getPathProxyUrl = getPathProxyUrl;
    window.playTargetCctv = playTargetCctv;
    window.playCctvWithProxy = playCctvWithProxy;
}
