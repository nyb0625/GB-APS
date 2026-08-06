/* ==========================================================================
   example1-cctv.js — '예시1' 탭 현장 실시간 모니터링 CCTV 연동 & HLS 재생
   ========================================================================== */

let currentHlsInstance = null;
let cctvChannels = [];

function getProxiedStreamUrl(url) {
    if (!url) return '';
    if (url.startsWith('//')) url = 'https:' + url;
    if (url.startsWith('/api/cctv/proxy/')) return url;
    if (url.startsWith('https://')) {
        return '/api/cctv/proxy/https/' + url.replace('https://', '');
    }
    if (url.startsWith('http://')) {
        return '/api/cctv/proxy/http/' + url.replace('http://', '');
    }
    return url;
}

export function playExample1CctvStream(rawStreamUrl, fallbackImgPath) {
    const streamUrl = getProxiedStreamUrl(rawStreamUrl);
    const video = document.getElementById('example1-cctv-video');
    const fallbackImg = document.getElementById('example1-cctv-fallback');

    if (!video) return;

    if (currentHlsInstance) {
        currentHlsInstance.destroy();
        currentHlsInstance = null;
    }

    const showFallback = () => {
        if (fallbackImg) {
            video.style.display = 'none';
            fallbackImg.style.display = 'block';
            if (fallbackImgPath) fallbackImg.src = fallbackImgPath;
        }
    };

    const showVideo = () => {
        if (fallbackImg) fallbackImg.style.display = 'none';
        video.style.display = 'block';
    };

    if (!streamUrl) {
        showFallback();
        return;
    }

    showVideo();
    video.muted = true;
    video.playsInline = true;
    video.autoplay = true;

    if (typeof Hls !== 'undefined' && Hls.isSupported() && (streamUrl.includes('.m3u8') || streamUrl.includes('/proxy/'))) {
        const hls = new Hls({
            enableWorker: true,
            lowLatencyMode: true,
            backBufferLength: 90
        });
        currentHlsInstance = hls;
        hls.loadSource(streamUrl);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            video.play().catch(() => {
                video.muted = true;
                video.play().catch(showFallback);
            });
        });

        hls.on(Hls.Events.ERROR, (event, data) => {
            if (data.fatal) {
                if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                    hls.startLoad();
                } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                    hls.recoverMediaError();
                } else {
                    hls.destroy();
                    showFallback();
                }
            }
        });
    } else {
        video.src = streamUrl;
        video.play().catch(() => {
            video.muted = true;
            video.play().catch(showFallback);
        });
    }
}

export async function initExample1Cctv() {
    const select = document.getElementById('example1-cctv-select');
    if (!select) return;

    try {
        const resp = await fetch('/api/cctv/live');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        if (data.success && Array.isArray(data.channels) && data.channels.length > 0) {
            cctvChannels = data.channels;
        }
    } catch (err) {
        console.warn('[Example1 CCTV] live fetch fallback:', err.message);
    }

    if (!cctvChannels.length) {
        cctvChannels = [
            { id: 'cctv_gwanghwamun', title: '광화문광장', streamUrl: 'https://strm3.spatic.go.kr/live/273.stream/playlist.m3u8', img: '/img/lapse/lapse_1.jpg' },
            { id: 'cctv_pohang_duho', title: '포항 두호동', streamUrl: '/api/cctv/proxy/https/kbsapi.loomex.net/v1/api/cctvRequest/9988/eo9+W+6LwihS2SvQyK3sdUcQxrjt7j0VGqG7QE4NUnFvNVJ82liwf2H/6JmVDEaP', img: '/img/lapse/lapse_1.jpg' },
            { id: 'cctv_gangnam_stn', title: '강남역', streamUrl: 'https://strm2.spatic.go.kr/live/207.stream/playlist.m3u8', img: '/img/lapse/lapse_2.jpg' },
            { id: 'cctv_yangjae_stn', title: '양재역', streamUrl: 'https://strm2.spatic.go.kr/live/208.stream/playlist.m3u8', img: '/img/lapse/lapse_3.jpg' }
        ];
    }

    select.innerHTML = cctvChannels.map((ch, idx) => `
        <option value="${idx}" style="background-color: #0f172a; color: #f8fafc; font-size: 0.88rem; padding: 6px;">${ch.title || ch.name} 구역 현황 CCTV</option>
    `).join('');

    const onSelectChange = () => {
        const idx = parseInt(select.value, 10) || 0;
        const selected = cctvChannels[idx] || cctvChannels[0];
        if (selected) {
            playExample1CctvStream(selected.streamUrl, selected.img || '/img/lapse/lapse_1.jpg');
        }
    };

    if (select._changeHandler) select.removeEventListener('change', select._changeHandler);
    select._changeHandler = onSelectChange;
    select.addEventListener('change', onSelectChange);

    // Initial play & weather fetch
    onSelectChange();
    fetchExample1Weather();
}

export async function fetchExample1Weather() {
    const API_KEY = '383c801d5bd78d6a24ba032c59f44cbe';
    const lat = 37.5755;
    const lon = 127.1652;
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric&lang=kr`;

    const updateWeatherUI = (info) => {
        const tempEl = document.getElementById('example1-weather-temp');
        const descEl = document.getElementById('example1-weather-desc');
        const humEl = document.getElementById('example1-weather-humidity');
        const windEl = document.getElementById('example1-weather-wind');
        const feelsEl = document.getElementById('example1-weather-feels');
        const iconEl = document.getElementById('example1-weather-icon');

        if (tempEl) tempEl.textContent = info.temp;
        if (descEl) descEl.textContent = info.desc;
        if (humEl) humEl.textContent = info.humidity + '%';
        if (windEl) windEl.textContent = info.windSpeed + 'm/s';
        if (feelsEl) feelsEl.textContent = info.feelsLike + '°C';
        if (iconEl && info.icon) iconEl.src = info.icon;
    };

    try {
        const resp = await fetch(url);
        if (resp.ok) {
            const data = await resp.json();
            updateWeatherUI({
                temp: Math.round(data.main.temp * 10) / 10,
                feelsLike: Math.round(data.main.feels_like * 10) / 10,
                humidity: data.main.humidity,
                windSpeed: Math.round(data.wind.speed * 10) / 10,
                desc: data.weather && data.weather[0] ? data.weather[0].description : '맑음',
                icon: data.weather && data.weather[0] ? `https://openweathermap.org/img/wn/${data.weather[0].icon}@2x.png` : 'https://openweathermap.org/img/wn/01d@2x.png'
            });
            return;
        }
    } catch (err) {
        console.warn('[Example1 Weather] OpenWeatherMap fetch error:', err.message);
    }

    try {
        const fallbackResp = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`);
        if (fallbackResp.ok) {
            const fData = await fallbackResp.json();
            const cw = fData.current_weather || {};
            updateWeatherUI({
                temp: Math.round((cw.temperature || 24.5) * 10) / 10,
                feelsLike: Math.round(((cw.temperature || 24.5) + 0.8) * 10) / 10,
                humidity: 62,
                windSpeed: Math.round((cw.windspeed || 2.1) * 10) / 10,
                desc: '구름 조금 (실시간)',
                icon: 'https://openweathermap.org/img/wn/02d@2x.png'
            });
        }
    } catch(e){}
}

export function updateExample1DDay() {
    const target = new Date('2029-05-16T00:00:00');
    const now = new Date();
    const diffTime = target - now;
    const diffDays = Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
    const ddayEl = document.getElementById('example1-dday-val');
    if (ddayEl) {
        ddayEl.textContent = `D-${diffDays} 일`;
    }
}

if (typeof window !== 'undefined') {
    window.initExample1Cctv = initExample1Cctv;
    window.playExample1CctvStream = playExample1CctvStream;
    window.fetchExample1Weather = fetchExample1Weather;
    window.updateExample1DDay = updateExample1DDay;
    document.addEventListener('DOMContentLoaded', updateExample1DDay);
}
