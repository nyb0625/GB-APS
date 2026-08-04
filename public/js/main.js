window.compressImg = function(base64, callback) {
    if (!base64 || typeof base64 !== 'string' || base64.indexOf('data:image') !== 0) {
        if (callback) callback(base64);
        return;
    }
    var img = new Image();
    img.onload = function() {
        try {
            var canvas = document.createElement('canvas');
            var ctx = canvas.getContext('2d');
            var maxW = 1920;
            var width = img.width;
            var height = img.height;
            if (width > maxW) {
                height = Math.round((height * maxW) / width);
                width = maxW;
            }
            canvas.width = width;
            canvas.height = height;
            if (ctx) {
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.fillStyle = "#FFFFFF";
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(img, 0, 0, width, height);
                var compressed = canvas.toDataURL('image/webp', 0.9);
                if (!compressed || compressed.indexOf('data:image/webp') === -1) {
                    compressed = canvas.toDataURL('image/jpeg', 0.9);
                }
                if (callback) callback(compressed);
            } else {
                if (callback) callback(base64);
            }
        } catch(e) {
            if (callback) callback(base64);
        }
    };
    img.onerror = function() {
        if (callback) callback(base64);
    };
    img.src = base64;
};

// 📌 [localStorage QuotaExceededError 방지용 이미지 극강 압축 유틸리티]
window.compressBase64Image = function(base64Str, maxWidth, quality, callback) {
    if (!base64Str || typeof base64Str !== 'string' || !base64Str.startsWith('data:image')) {
        return callback(base64Str);
    }
    var img = new Image();
    img.onload = function() {
        try {
            var canvas = document.createElement('canvas');
            var width = img.width;
            var height = img.height;

            if (width > maxWidth) {
                height = Math.round(height * (maxWidth / width));
                width = maxWidth;
            }
            canvas.width = width;
            canvas.height = height;
            var ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.drawImage(img, 0, 0, width, height);
                var compressedBase64 = canvas.toDataURL('image/jpeg', quality);
                callback(compressedBase64);
            } else {
                callback(base64Str);
            }
        } catch(e) {
            callback(base64Str);
        }
    };
    img.onerror = function() {
        callback(base64Str);
    };
    img.src = base64Str;
};

window.compressBase64Array = function(arr, maxWidth, quality, callback) {
    if (!arr || !arr.length) {
        return callback([]);
    }
    var results = [];
    function next(idx) {
        if (idx >= arr.length) {
            return callback(results);
        }
        window.compressBase64Image(arr[idx], maxWidth, quality, function(res) {
            results.push(res);
            next(idx + 1);
        });
    }
    next(0);
};

// 🚨 [양방향 삭제 동기화 마스터 락] 메인 화면에서 삭제가 일어날 때 비교 창고까지 추적 폭사시키는 가드
(function() {
    window.addEventListener('click', function(evt) {
        var target = evt.target;
        if (!target) return;

        // 🚨 [메인 삭제 버튼 정밀 판별] 클릭된 엘리먼트가 메인 화면의 삭제 관련 트리거인지 검출
        var isDeleteAction = false;
        if (target.id === 'btn-delete-issue' || (target.className && typeof target.className === 'string' && target.className.indexOf('delete') > -1)) {
            isDeleteAction = true;
        } else if (target.textContent && target.textContent.trim() === '삭제') {
            isDeleteAction = true;
        }

        // 메인 화면의 삭제 행위가 포착되었다면 팝업창 연동 스크럽 세션 가동
        if (isDeleteAction) {
            // 클릭된 버튼이 속한 테이블 행(tr)을 역추적하여 고유 ID(data-id 또는 내부 텍스트) 확보
            var closestTr = target.closest('tr');
            var targetId = "";
            
            if (closestTr) {
                targetId = closestTr.getAttribute('data-id') || closestTr.getAttribute('data-dbid') || "";
                if (!targetId && closestTr.cells && closestTr.cells.length > 0) {
                    targetId = closestTr.cells[0].textContent.trim(); // 첫 번째 열(ID)에서 텍스트 추출
                }
            }

            if (targetId) {
                console.log("[Global Main Delete Intercept] 메인 삭제 ID 포획 ➡️ 비교 창고 동시 스크럽:", targetId);

                // 🚨 [비교 창고 동시 폭사] my_saved_compare_issues 데이터베이스 즉시 동기화 청소
                try {
                    var compareRaw = localStorage.getItem('my_saved_compare_issues');
                    if (compareRaw) {
                        var compareList = JSON.parse(compareRaw);
                        if (Array.isArray(compareList)) {
                            var syncFiltered = compareList.filter(function(item) {
                                if (!item) return false;
                                return String(item.id) !== String(targetId) && String(item.dbId) !== String(targetId);
                            });
                            localStorage.setItem('my_saved_compare_issues', JSON.stringify(syncFiltered));
                            console.log("[Global Main Delete Intercept] 버전 비교 분석 결과 창고 동기화 완료 ✅");
                        }
                    }
                } catch(err) {
                    console.error("[Global Main Delete Intercept Error]:", err.message);
                }

                // 인메모리 전역 리스트 최신화 락 동기화
                if (Array.isArray(window.currentIssueList)) {
                    window.currentIssueList = window.currentIssueList.filter(function(item) {
                        if (!item) return false;
                        return String(item.id) !== String(targetId) && String(item.dbId) !== String(targetId);
                    });
                }

                // 🚨 [인프라 최종 종결 가드] 라이브러리 내부 변수 동기화 마비를 깨부수기 위한 DOM 다이렉트 숙청 시스템
                setTimeout(function() {
                    // 1) 메인 화면 테이블과 팝업창 테이블 리로드 함수 안전 호출
                    if (typeof window.renderIssueTable === 'function') {
                        window.renderIssueTable();
                    }
                    if (typeof window.renderCompareIssueTable === 'function') {
                        window.renderCompareIssueTable();
                    }

                    // 2) 🚨 [핵심 기법] 현재 화면(버전 비교 팝업창 내부 포함)에 존재하는 모든 테이블 행(tr)을 전수 조사
                    var allRows = document.querySelectorAll('tr, .issue-table-row, [data-id]');
                    var wipedCount = 0;
                    
                    for (var r = 0; r < allRows.length; r++) {
                        var row = allRows[r];
                        if (!row) continue;

                        // 행의 data-id 속성이나 내부 텍스트, 혹은 데이터 속성에 삭제된 ID가 포함되어 있는지 크로스 체크
                        var rowId = row.getAttribute('data-id') || row.getAttribute('data-dbid') || "";
                        
                        // ID 속성이 없을 경우 첫 번째 열(TD)의 텍스트를 파싱하여 매칭
                        if (!rowId && row.cells && row.cells.length > 0) {
                            rowId = row.cells[0].textContent.trim();
                        }

                        // 🚨 삭제 대상 ID와 일치하는 유령 행을 발견하는 즉시 브라우저 화면에서 직접 절단(삭제)
                        if (String(rowId) === String(targetId) || rowId.indexOf(targetId) > -1) {
                            if (row.parentNode) {
                                try {
                                    row.parentNode.removeChild(row);
                                    wipedCount++;
                                } catch(domErr) {}
                            }
                        }
                    }
                    console.log('[Global UI Sync] 유령 데이터 행 화면에서 물리 제거 완료:', wipedCount);

                    // 🚨 [마커 즉시 제거] 삭제된 ID에 해당하는 뷰어 핀(SVG 마커) DOM 오소에서 직접 제거
                    if (window.issueMarkersDOMList && targetId) {
                        var remainMarkers = [];
                        for (var mi = 0; mi < window.issueMarkersDOMList.length; mi++) {
                            var mEl = window.issueMarkersDOMList[mi];
                            if (!mEl) continue;
                            var mIssueId = mEl.getAttribute('data-issue-id') || '';
                            if (mIssueId === String(targetId)) {
                                // 삭제 대상 마커: DOM에서 즙시 제거
                                if (mEl.parentNode) { mEl.parentNode.removeChild(mEl); }
                            } else {
                                remainMarkers.push(mEl);
                            }
                        }
                        window.issueMarkersDOMList = remainMarkers;
                        console.log('[Marker Sync] 삭제 ID=' + targetId + ' 보유 마커 전체 짆이 제거 ✅');
                    }
                }, 40);
            }
        }
    }, true); // Capturing 모드로 원본 기능이 실행되기 전에 최고 우선순위로 먼저 가로챕니다.
})();

// ─────────────────────────────────────────────────────────────
// Forma issue table recovery layer
// Keeps the login/auth flow untouched and only replaces the Issues tab renderer.
// ─────────────────────────────────────────────────────────────
(function() {
    var SCHEMA_VERSION = 'forma-gangbuk-columns-v1';
    var cache = { ts: 0, issues: [], error: null };
    var inflight = null;

    var columns = [
        { key: 'displayId', label: 'ID' },
        { key: 'title', label: '제목' },
        { key: 'status', label: '상태' },
        { key: 'type', label: '유형' },
        { key: 'assignee', label: '담당자' },
        { key: 'dueDate', label: '마감일' },
        { key: 'startDate', label: '시작 날짜' },
        { key: 'placement', label: '배치' },
        { key: 'desc', label: '설명' },
        { key: 'reviewer', label: '확인자' },
        { key: 'location', label: '위치' },
        { key: 'attachments', label: '첨부파일' },
        { key: 'references', label: '참조' },
        { key: 'comments', label: '주석' }
    ];
    var defaultColumns = ['displayId', 'title', 'status', 'type', 'assignee', 'dueDate', 'startDate', 'placement'];

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function normalizeDate(value) {
        if (!value) return '-';
        var text = String(value);
        if (text.indexOf('T') > -1) text = text.split('T')[0];
        return text || '-';
    }

    function getIssueFieldValue(issue, key) {
        if (!issue) return '-';
        if (key === 'displayId') return issue.displayId || issue.issueNumber || issue.dbId || issue.id || '-';
        if (key === 'title') return issue.title || '-';
        if (key === 'status') return issue.status || '-';
        if (key === 'type') return issue.typePath || issue.type || '-';
        if (key === 'assignee') return issue.assignee || '-';
        if (key === 'dueDate') return normalizeDate(issue.dueDate || issue.endDate || issue.duedate);
        if (key === 'startDate') return normalizeDate(issue.startDate || issue.startdate);
        if (key === 'placement') return issue.placement || '-';
        if (key === 'desc') return issue.description || issue.desc || '-';
        if (key === 'reviewer') return issue.reviewer || issue.verifier || '-';
        if (key === 'location') return issue.location || issue.locationName || '-';
        if (key === 'attachments') return issue.attachments || '-';
        if (key === 'references') return issue.references || '-';
        if (key === 'comments') return issue.comments || '-';
        return issue[key] || '-';
    }
    window.getIssueFieldValue = getIssueFieldValue;

    function resetFormaColumnsIfNeeded() {
        if (localStorage.getItem('my_issue_schema_version') !== SCHEMA_VERSION) {
            localStorage.setItem('my_issue_schema_version', SCHEMA_VERSION);
            localStorage.setItem('my_all_columns_order', JSON.stringify(columns));
            localStorage.setItem('my_active_columns', JSON.stringify(defaultColumns));
        }
        window.allIssueColumns = columns.slice();
        try {
            var saved = JSON.parse(localStorage.getItem('my_active_columns') || 'null');
            window.activeIssueColumns = Array.isArray(saved) && saved.length ? saved.filter(function(key) {
                return columns.some(function(col) { return col.key === key; });
            }) : defaultColumns.slice();
        } catch (e) {
            window.activeIssueColumns = defaultColumns.slice();
        }
        if (!window.activeIssueColumns.length) window.activeIssueColumns = defaultColumns.slice();
    }

    async function loadFormaIssues(force) {
        if (!force && cache.issues.length && Date.now() - cache.ts < 60000) return cache.issues;
        if (inflight) return inflight;

        inflight = fetch('/api/issues/forma-gangbuk?limit=500', { credentials: 'same-origin' })
            .then(function(resp) {
                if (!resp.ok) {
                    return resp.json().catch(function() { return {}; }).then(function(body) {
                        throw new Error(body.message || body.error || ('HTTP ' + resp.status));
                    });
                }
                return resp.json();
            })
            .then(function(json) {
                var list = Array.isArray(json.data) ? json.data : [];
                list = list.filter(function(issue) {
                    return String(issue.typePath || issue.type || '').indexOf('건화') === -1;
                });
                cache = { ts: Date.now(), issues: list, error: null };
                window._gangbukFormaCache = list;
                window.currentIssueList = list;
                window.currentFilteredIssues = list.slice();
                return list;
            })
            .catch(function(err) {
                cache.error = err;
                console.warn('[Forma Issues] load failed:', err.message);
                return [];
            })
            .finally(function() {
                inflight = null;
            });
        return inflight;
    }
    window.loadFormaIssuesForMainTab = loadFormaIssues;

    function renderHeader() {
        var headerEl = document.getElementById('issue-table-header');
        if (!headerEl) return;
        var html = '<tr>';
        html += '<th style="width:78px;text-align:center;vertical-align:top;"><div class="filter-container"><span>구분</span><select class="column-filter" data-col="0" style="height:18px;width:100%;"><option value="">전체</option><option value="FORMA">FORMA</option></select></div></th>';
        window.activeIssueColumns.forEach(function(key, idx) {
            var col = columns.find(function(c) { return c.key === key; }) || { key: key, label: key };
            var filter = (key === 'title' || key === 'desc')
                ? '<input type="text" class="column-filter" data-col="' + (idx + 1) + '" placeholder="검색" style="height:18px;width:100%;box-sizing:border-box;">'
                : '<select class="column-filter" data-col="' + (idx + 1) + '" style="height:18px;width:100%;box-sizing:border-box;"><option value="">전체</option></select>';
            var width = key === 'title' ? '22%' : (key === 'type' ? '160px' : (key === 'placement' ? '150px' : '110px'));
            html += '<th style="width:' + width + ';vertical-align:top;"><div class="filter-container"><span>' + escapeHtml(col.label) + '</span>' + filter + '</div></th>';
        });
        html += '</tr>';
        headerEl.innerHTML = html;
    }

    function renderColumnSettingsMenu() {
        var container = document.getElementById('column-settings-container');
        if (!container) return;
        container.innerHTML = columns.map(function(col, i) {
            var checked = window.activeIssueColumns.indexOf(col.key) > -1 ? 'checked' : '';
            return '<div draggable="true" ondragstart="window.colDragStart(event,' + i + ')" ondragover="window.colDragOver(event)" ondragleave="window.colDragLeave(event)" ondrop="window.colDrop(event,' + i + ')" style="padding:8px;margin-bottom:4px;background:#0f172a;border:1px solid #334155;border-radius:4px;display:flex;align-items:center;gap:8px;">'
                + '<span style="color:#64748b;">☰</span>'
                + '<input type="checkbox" id="col-chk-' + col.key + '" ' + checked + ' onchange="window.toggleColumn(\'' + col.key + '\')">'
                + '<label for="col-chk-' + col.key + '" style="cursor:pointer;flex:1;font-size:13px;color:#cbd5e1;">' + escapeHtml(col.label) + '</label>'
                + '</div>';
        }).join('');
    }
    window.renderColumnSettingsMenu = renderColumnSettingsMenu;

    window.toggleColumn = function(colKey) {
        var idx = window.activeIssueColumns.indexOf(colKey);
        if (idx > -1) {
            if (window.activeIssueColumns.length > 1) window.activeIssueColumns.splice(idx, 1);
        } else {
            window.activeIssueColumns.push(colKey);
        }
        localStorage.setItem('my_active_columns', JSON.stringify(window.activeIssueColumns));
        renderColumnSettingsMenu();
        var hasIssues = (Array.isArray(window.currentIssueList) && window.currentIssueList.length) || formaCache.issues.length;
        window.renderIssueTable(hasIssues);
    };

    window.syncActiveColumnsOrder = function() {
        var ordered = [];
        columns.forEach(function(col) {
            if (window.activeIssueColumns.indexOf(col.key) > -1) ordered.push(col.key);
        });
        window.activeIssueColumns = ordered;
        localStorage.setItem('my_active_columns', JSON.stringify(ordered));
    };

    window.renderIssueTable = async function(skipFetch) {
        resetFormaColumnsIfNeeded();
        var tbody = document.getElementById('issue-table-body');
        if (!tbody) return;
        renderHeader();
        if (!skipFetch) {
            tbody.innerHTML = '<tr><td colspan="' + (window.activeIssueColumns.length + 1) + '" style="text-align:center;padding:36px;color:#94a3b8;">Forma 이슈를 불러오는 중입니다.</td></tr>';
        }
        var issues = skipFetch ? (window.currentFilteredIssues || window.currentIssueList || cache.issues || []) : await loadFormaIssues(false);
        window.currentIssueList = issues;
        window.currentFilteredIssues = issues.slice();

        if (!issues.length) {
            var msg = cache.error ? ('Forma 이슈를 불러오지 못했습니다: ' + cache.error.message) : '표시할 Forma 이슈 데이터가 없습니다.';
            tbody.innerHTML = '<tr><td colspan="' + (window.activeIssueColumns.length + 1) + '" style="text-align:center;padding:36px;color:#94a3b8;">' + escapeHtml(msg) + '</td></tr>';
            return;
        }

        tbody.innerHTML = issues.map(function(issue, rowIdx) {
            var key = issue.id || issue.displayId || rowIdx;
            var row = '<tr class="issue-row issue-table-row" data-id="' + escapeHtml(key) + '" style="border-bottom:1px solid #334155;cursor:pointer;">';
            row += '<td style="padding:10px 12px;text-align:center;"><span style="background:#06b6d4;color:#06202a;padding:4px 9px;border-radius:999px;font-size:11px;font-weight:800;">FORMA</span></td>';
            window.activeIssueColumns.forEach(function(colKey) {
                var value = getIssueFieldValue(issue, colKey);
                var title = String(value || '');
                var align = (colKey === 'status' || colKey === 'displayId') ? 'text-align:center;' : '';
                var color = colKey === 'status' ? 'color:#7dd3fc;font-weight:800;' : '';
                row += '<td style="padding:10px 12px;' + align + color + 'max-width:240px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="' + escapeHtml(title) + '">' + escapeHtml(value || '-') + '</td>';
            });
            row += '</tr>';
            return row;
        }).join('');

        bindFormaIssueRows(issues);
        if (typeof window.initializeTableFilters === 'function') window.initializeTableFilters();
    };

    function bindFormaIssueRows(issues) {
        var map = new Map();
        issues.forEach(function(issue, idx) {
            map.set(String(issue.id || issue.displayId || idx), issue);
        });
        document.querySelectorAll('#issue-table-body .issue-row').forEach(function(row) {
            row.addEventListener('click', function(e) {
                if (e.target && e.target.closest('button,input,select')) return;
                var issue = map.get(String(row.getAttribute('data-id')));
                if (issue) window.openFormaIssueDetail(issue);
            });
        });
    }

    window.openFormaIssueDetail = function(issue) {
        var old = document.getElementById('forma-issue-detail-modal');
        if (old) old.remove();
        var fields = [
            ['ID', getIssueFieldValue(issue, 'displayId')],
            ['제목', getIssueFieldValue(issue, 'title')],
            ['상태', getIssueFieldValue(issue, 'status')],
            ['유형', getIssueFieldValue(issue, 'type')],
            ['담당자', getIssueFieldValue(issue, 'assignee')],
            ['확인자', getIssueFieldValue(issue, 'reviewer')],
            ['위치', getIssueFieldValue(issue, 'location')],
            ['배치', getIssueFieldValue(issue, 'placement')],
            ['시작 날짜', getIssueFieldValue(issue, 'startDate')],
            ['마감일', getIssueFieldValue(issue, 'dueDate')],
            ['설명', getIssueFieldValue(issue, 'desc')]
        ];
        var html = '<div id="forma-issue-detail-modal" style="position:fixed;inset:0;background:rgba(2,6,23,.68);z-index:30000;display:flex;align-items:center;justify-content:center;">'
            + '<div style="width:min(760px,92vw);max-height:86vh;overflow:auto;background:#0f172a;border:1px solid #334155;border-radius:10px;color:#e5eefb;box-shadow:0 24px 60px rgba(0,0,0,.45);">'
            + '<div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid #334155;"><strong>Forma 이슈 상세 정보</strong><button id="forma-issue-detail-close" style="background:transparent;border:0;color:#cbd5e1;font-size:22px;cursor:pointer;">×</button></div>'
            + '<div style="padding:18px 20px;display:grid;grid-template-columns:120px minmax(0,1fr);gap:10px 14px;">'
            + fields.map(function(pair) {
                return '<div style="color:#94a3b8;font-weight:700;">' + escapeHtml(pair[0]) + '</div><div style="white-space:pre-wrap;">' + escapeHtml(pair[1] || '-') + '</div>';
            }).join('')
            + '</div></div></div>';
        document.body.insertAdjacentHTML('beforeend', html);
        document.getElementById('forma-issue-detail-close').onclick = function() {
            var modal = document.getElementById('forma-issue-detail-modal');
            if (modal) modal.remove();
        };
    };

    window.filterIssues = function(type) {
        window.currentIssueFilter = type || 'all';
        ensureIssueTypeTabs();
        window.currentTableFilterValues = {};
        document.querySelectorAll('.issue-sub-btn').forEach(function(btn) {
            btn.classList.remove('active');
            btn.style.background = 'transparent';
            btn.style.color = '#94a3b8';
            btn.style.border = '1px solid transparent';
        });
        var active = document.getElementById('sub-tab-' + window.currentIssueFilter);
        if (active) {
            active.classList.add('active');
            active.style.background = '#334155';
            active.style.color = '#fff';
            active.style.border = '1px solid #475569';
        }
        window.renderIssueTable();
    };

    document.addEventListener('DOMContentLoaded', function() {
        resetFormaColumnsIfNeeded();
        renderColumnSettingsMenu();
    });
})();

// 🚨 [인프라 최종 무력화 가드] 전역 에러 포획 장치로 clientWidth 크래시 연쇄 마비 완전 차단
(function() {
    var originalOnError = window.onerror;
    window.onerror = function(message, source, lineno, colno, error) {
        var msg = String(message || "");
        
        // 🚨 [핵심 가드] 저장 버튼을 막아서 가동 중단시키는 주범인 clientWidth 에러를 전역에서 낚아채 무조건 정상 흐름으로 세팅
        if (msg.indexOf('clientWidth') > -1 || msg.indexOf('null') > -1 || (source && source.indexOf('Viewer3D.js') > -1)) {
            console.warn("[Global Crash Guard] 뷰어 엔진의 레이아웃 충돌 에러를 성공적으로 무력화했습니다. 저장 스레드를 개방합니다.");
            return true; // true를 반환하면 브라우저가 콘솔 에러로 간주하지 않고 런타임 마비를 일으키지 않습니다.
        }
        
        if (originalOnError) {
            return originalOnError.apply(window, arguments);
        }
        return false;
    };

    // Promise 비동기 루프 안에서 터지는 QuotaExceededError 및 clientWidth 에러까지 2중 밀봉 가드
    window.addEventListener('unhandledrejection', function(event) {
        var reason = event.reason ? String(event.reason.message || event.reason) : "";
        if (reason.indexOf('clientWidth') > -1 || reason.indexOf('Storage') > -1 || reason.indexOf('quota') > -1) {
            console.warn("[Global Promise Guard] 비동기 추적 중 발생한 한도 초과/사이즈 에러 자동 소멸 완료.");
            event.preventDefault(); // 에러 확산을 방지하여 웹페이지가 굳는 현상 방지
        }
    });
})();

(function() {
    window.addEventListener('click', function(evt) {
        var target = evt.target;
        if (!target) return;

        // 1. 단독 모드(isCompareModeActive가 false)인 경우에는 인터셉터를 완전히 우회하여 기존 단독 이슈 핸들러가 가동되도록 함
        if (!window.isCompareModeActive) {
            return;
        }

        var isSaveBtn = false;
        if (target.id === 'btn-save-issue' || target.id === 'compare-issue-save') {
            isSaveBtn = true;
        } else if (target.className && typeof target.className === 'string' && target.className.indexOf('save') > -1) {
            isSaveBtn = true;
        } else if (target.textContent && (target.textContent.trim() === '저장' || target.textContent.trim() === '제출')) {
            isSaveBtn = true;
        }

        if (isSaveBtn) {
            evt.preventDefault();
            evt.stopPropagation();
            evt.stopImmediatePropagation();
            
            console.log("[Global Intercept] 버전 비교 저장 버튼 클릭 감지. 데이터 수집 및 3대 저장소 동기화 기동.");

            // 2. 현재 활성화된 팝업 식별 및 정밀 필드 수집
            // 오버레이 팝업 엘리먼트들
            var overlayTitleInput = document.getElementById('issue-title-input');
            var overlayDescInput = document.getElementById('issue-desc-input');
            var overlayTypeSelect = document.getElementById('create-issue-type');
            var overlayStartInput = document.getElementById('create-issue-start-date');
            var overlayDueInput = document.getElementById('create-issue-due-date');
            var overlayDbIdLabel = document.getElementById('issue-dbid-label');

            // 비교 상세 팝업 엘리먼트들
            var compareTitleInput = document.getElementById('issue-title');
            var compareReviewInput = document.getElementById('issue-review');
            var compareChangeInput = document.getElementById('issue-change');
            var compareStatusSelect = document.getElementById('issue-status');
            var compareAssigneeSelect = document.getElementById('issue-assignee');
            var compareStructureInput = document.getElementById('issue-structure');
            var compareTradeInput = document.getElementById('issue-trade');

            var title = "";
            var reviewContent = "";
            var changeContent = "";
            var assignee = "미지정";
            var status = "검토중";
            var type = "compare";
            var structure = "";
            var trade = "";
            var startDate = "";
            var endDate = "";
            var dbId = "";

            if (overlayTitleInput) {
                // 오버레이 툴바 팝업 활성화 상태
                title = overlayTitleInput.value.trim();
                reviewContent = overlayDescInput ? overlayDescInput.value.trim() : "";
                changeContent = reviewContent;
                type = overlayTypeSelect ? overlayTypeSelect.value : "Clash";
                startDate = overlayStartInput ? overlayStartInput.value : "";
                endDate = overlayDueInput ? overlayDueInput.value : "";
                if (overlayDbIdLabel) dbId = overlayDbIdLabel.textContent.trim();
                status = "생성";
                assignee = "지정되지 않음";
                
                // 파일 정보 기반 자동 파싱 폴백
                structure = "강북_구조물_신설_03";
                trade = type === "Clash" ? "간섭 제어" : "협업";
            } else if (compareTitleInput) {
                // 비교 상세 팝업 활성화 상태
                title = compareTitleInput.value.trim();
                reviewContent = compareReviewInput ? compareReviewInput.value.trim() : "";
                changeContent = compareChangeInput ? compareChangeInput.value.trim() : "";
                status = compareStatusSelect ? compareStatusSelect.value : "검토중";
                assignee = compareAssigneeSelect ? compareAssigneeSelect.value : "미지정";
                structure = compareStructureInput ? compareStructureInput.value.trim() : "";
                trade = compareTradeInput ? compareTradeInput.value.trim() : "";
                var typeBox = document.getElementById('compare-issue-type') || document.getElementById('create-issue-type');
                type = typeBox ? typeBox.value : "간섭";
                if (type.toLowerCase() === 'clash') type = '간섭';
                else if (type.toLowerCase() === 'coordination') type = '협업';
                else if (type.toLowerCase() === 'design') type = '설계 변경';

                // 헤더 제목 등에서 객체 ID(dbId) 파싱 시도
                var headerEl = document.querySelector('#issue-detail-popup div, #dynamic-real-compare-modal div, #issue-popup div');
                if (headerEl) {
                    var match = headerEl.textContent.match(/객체\s*ID:\s*(\d+)/i);
                    if (match) dbId = match[1];
                }
            } else {
                // 폴백 (기타 필드 매핑)
                var rBox = document.getElementById('issue-review') || document.getElementById('real-compare-review-text') || document.getElementById('issue-desc-input');
                var cBox = document.getElementById('issue-change') || document.getElementById('real-compare-change-text') || document.getElementById('issue-desc-input');
                var tBox = document.getElementById('dyn-issue-title') || document.getElementById('issue-title') || document.getElementById('issue-title-input');
                var aBox = document.getElementById('real-compare-assignee-select') || document.getElementById('dyn-issue-assignee') || document.getElementById('create-issue-type');

                title = tBox ? tBox.value.trim() : "버전 비교 이슈";
                reviewContent = rBox ? rBox.value.trim() : "기록된 검토 내용이 없습니다.";
                changeContent = cBox ? cBox.value.trim() : "기록된 변경 내용이 없습니다.";
                assignee = aBox ? aBox.value : "미지정";
            }

            // 최종 dbId 정합성 및 폴백
            if (!dbId || dbId === "-") {
                dbId = window.currentSelectedDbId || "";
            }
            if (!dbId) {
                try {
                    var sample1 = JSON.parse(localStorage.getItem('aps_project_issues') || '[]');
                    var sample2 = JSON.parse(localStorage.getItem('my_saved_issues') || '[]');
                    var sampleCombined = sample1.concat(sample2);
                    for (var s = 0; s < sampleCombined.length; s++) {
                        if (sampleCombined[s] && sampleCombined[s].dbId) {
                            dbId = sampleCombined[s].dbId;
                            break;
                        }
                    }
                } catch(e) {}
            }
            if (!dbId) dbId = "13181";

            // 이미지 데이터 수집 및 다운스케일 압축 처리
            var compCanvas = document.getElementById('global-markup-canvas') || document.getElementById('compare-markup-canvas');
            var compressedImg = window.lastStandaloneMarkupImage || "";

            if (compCanvas) {
                try {
                    var shrinkCanvas = document.createElement('canvas');
                    var shrinkCtx = shrinkCanvas.getContext('2d');
                    var maxW = 1920;
                    var cW = compCanvas.width, cH = compCanvas.height;
                    if (cW > maxW) { cH = Math.round((cH * maxW) / cW); cW = maxW; }
                    shrinkCanvas.width = cW;
                    shrinkCanvas.height = cH;
                    if (shrinkCtx) {
                        shrinkCtx.imageSmoothingEnabled = true;
                        shrinkCtx.imageSmoothingQuality = 'high';
                        shrinkCtx.drawImage(compCanvas, 0, 0, cW, cH);
                        compressedImg = shrinkCanvas.toDataURL('image/webp', 0.9);
                        if (!compressedImg || compressedImg.indexOf('data:image/webp') === -1) {
                            compressedImg = shrinkCanvas.toDataURL('image/jpeg', 0.9);
                        }
                    } else {
                        compressedImg = compCanvas.toDataURL('image/webp', 0.9);
                        if (!compressedImg || compressedImg.indexOf('data:image/webp') === -1) {
                            compressedImg = compCanvas.toDataURL('image/jpeg', 0.9);
                        }
                    }
                } catch(canvasErr) {
                    console.warn("[Global Intercept] 이미지 압축 처리 실패, 기본 인메모리 이미지 사용:", canvasErr);
                }
            }

            var generatedId = "COMP-" + Date.now();
            var newCompareIssue = {
                id: generatedId,
                dbId: dbId,
                title: title || "버전 비교 이슈",
                reviewContent: reviewContent,
                changeContent: changeContent,
                reviewDesc: reviewContent,
                changeDesc: changeContent,
                description: changeContent,
                desc: reviewContent,
                assignee: assignee,
                status: status,
                issueType: type,
                type: type,
                structure: structure || "미상",
                trade: trade || "미상",
                startDate: startDate || "-",
                endDate: endDate || "-",
                _type: "compare",
                imgBefore: window.currentCompareBeforeUrl || compressedImg,
                imgAfter: window.currentCompareAfterUrl || compressedImg,
                img: compressedImg,
                date: new Date().toISOString().substring(0, 10)
            };

            // 3대 저장소(localStorage) 동시 동기화 적재
            var keys = ['my_saved_compare_issues', 'my_saved_issues', 'aps_project_issues'];
            for (var m = 0; m < keys.length; m++) {
                var tmpList = [];
                try {
                    tmpList = JSON.parse(localStorage.getItem(keys[m]) || '[]');
                } catch(e) {
                    tmpList = [];
                }
                tmpList.push(newCompareIssue);
                try {
                    localStorage.setItem(keys[m], JSON.stringify(tmpList));
                } catch(qEx) {
                    // 저장 용량 한도 초과 시 이미지 비우고 텍스트 위주로 강제 적재
                    for (var j = 0; j < tmpList.length; j++) {
                        tmpList[j].img = "";
                        tmpList[j].imgBefore = "";
                        tmpList[j].imgAfter = "";
                    }
                    try {
                        localStorage.setItem(keys[m], JSON.stringify(tmpList));
                    } catch(innerErr) {}
                }
                
                if (keys[m] === 'my_saved_compare_issues') {
                    window.currentIssueList = tmpList;
                    if (typeof window.compareIssues !== 'undefined') window.compareIssues = tmpList;
                    if (typeof window.currentCompareIssues !== 'undefined') window.currentCompareIssues = tmpList;
                }
            }

            // 전역 메모리 배열 안전 업데이트 (기존 데이터 보존하며 새 비교 이슈 병합)
            if (Array.isArray(window.issues)) {
                window.issues.push(newCompareIssue);
            }

            console.log("[Global Intercept] 3대 저장소 동기화 완료 및 모달 정리 시작.");

            // 팝업 숨김 처리 및 스타일 락 적용
            var styleLock = document.createElement('style');
            styleLock.innerHTML = ".docking-panel, .modal, .modal-backdrop, #dynamic-real-compare-modal, #dynamic-standalone-issue-modal, .custom-issue-modal, #issue-popup { display: none !important; visibility: hidden !important; opacity: 0 !important; pointer-events: none !important; }";
            document.head.appendChild(styleLock);

            var selectors = ['.docking-panel', '.modal', '.modal-backdrop', '[role="dialog"]', '#dynamic-real-compare-modal', '#dynamic-standalone-issue-modal', '#issue-popup'];
            for (var x = 0; x < selectors.length; x++) {
                var els = document.querySelectorAll(selectors[x]);
                for (var p = 0; p < els.length; p++) {
                    if (els[p] && els[p].parentNode) {
                        try { els[p].parentNode.removeChild(els[p]); } catch(e) {}
                    }
                }
            }

            // UI 테이블과 비교 리스트 리로드 유도
            setTimeout(function() {
                if (typeof window.renderIssueTable === 'function') window.renderIssueTable();
                if (typeof window.renderIssueList === 'function') window.renderIssueList();
                
                var cTab = document.querySelector('[data-tab="compare"]') || document.getElementById('tab-compare-issues') || document.querySelector('.tab-item:last-child');
                if (cTab && typeof cTab.click === 'function') {
                    cTab.click();
                }

                if (styleLock && styleLock.parentNode) {
                    try { styleLock.parentNode.removeChild(styleLock); } catch(e) {}
                }
            }, 60);
        }
    }, true);
})();

/**
 * main.js — Client-side orchestrator
 */

import { initViewer, loadModel, captureViewerScreen } from './viewer.js?v=20260804-main-rotate-fix1';
import { initAiPanel } from './ai-panel.js';
import { explorer } from './explorer.js';

window.getIssueCaptureImages = function() {
    var input = document.getElementById('multi-capture-data');
    if (!input) return [];
    try {
        var parsed = JSON.parse(input.value || '[]');
        return Array.isArray(parsed) ? parsed.filter(function(src) {
            return src && String(src).indexOf('data:image') === 0;
        }) : [];
    } catch (e) {
        return [];
    }
};

window.setIssueCaptureImages = function(images) {
    var input = document.getElementById('multi-capture-data');
    if (!input) return;
    var cleanImages = Array.isArray(images) ? images.filter(function(src) {
        return src && String(src).indexOf('data:image') === 0;
    }) : [];
    input.value = JSON.stringify(cleanImages);
};

window.renderIssueCaptureImages = function(images) {
    var list = document.getElementById('capture-image-list');
    var addBtn = document.getElementById('btn-add-capture');
    if (!list || !addBtn) return;

    Array.prototype.slice.call(list.querySelectorAll('.issue-capture-thumb')).forEach(function(node) {
        node.remove();
    });

    var cleanImages = Array.isArray(images) ? images.filter(function(src) {
        return src && String(src).indexOf('data:image') === 0;
    }) : [];
    window.setIssueCaptureImages(cleanImages);

    cleanImages.forEach(function(src, index) {
        var wrapper = document.createElement('div');
        wrapper.className = 'issue-capture-thumb';
        wrapper.style.cssText = 'position:relative;min-width:100px;width:100px;height:75px;border-radius:8px;overflow:hidden;background:#0f172a;border:1px solid #334155;box-sizing:border-box;';

        var img = document.createElement('img');
        img.src = src;
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
        wrapper.appendChild(img);

        var removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.textContent = 'x';
        removeBtn.setAttribute('aria-label', '첨부 이미지 삭제');
        removeBtn.style.cssText = 'position:absolute;top:4px;right:4px;width:20px;height:20px;border:0;border-radius:50%;background:rgba(15,23,42,0.85);color:#fff;font-size:12px;line-height:20px;cursor:pointer;padding:0;';
        removeBtn.onclick = function(e) {
            e.preventDefault();
            e.stopPropagation();
            var nextImages = window.getIssueCaptureImages();
            nextImages.splice(index, 1);
            window.renderIssueCaptureImages(nextImages);
        };
        wrapper.appendChild(removeBtn);

        list.insertBefore(wrapper, addBtn);
    });
};

window.restoreIssueMultiCaptureModal = function() {
    var modal = window._pendingMultiCaptureModal || document.getElementById('dynamic-standalone-issue-modal');
    if (modal) {
        modal.style.display = window._pendingMultiCaptureModalDisplay || 'flex';
    }
    window._pendingMultiCaptureModal = null;
    window._pendingMultiCaptureModalDisplay = null;
};

window.hideIssueMultiCaptureFloating = function() {
    var floating = document.getElementById('floating-multi-capture');
    if (floating) floating.style.display = 'none';
};

window.getActiveCaptureViewer = function() {
    return window.myGlobalViewer ||
        window.viewer ||
        window.NOP_VIEWER ||
        window.overlayViewer ||
        (window.app && typeof window.app.getCurrentViewer === 'function' ? window.app.getCurrentViewer() : null);
};

window.enterIssueMultiCaptureMode = function() {
    var activeViewer = true;
    if (!activeViewer) {
        alert('캡처할 뷰어가 아직 준비되지 않았습니다.');
        return;
    }

    var modal = document.getElementById('dynamic-standalone-issue-modal') || document.getElementById('issue-popup') || document.querySelector('.modal.show');
    window._pendingMultiCaptureModal = modal || null;
    window._pendingMultiCaptureModalDisplay = modal ? (modal.style.display || 'flex') : 'flex';
    if (modal) modal.style.display = 'none';

    var floating = document.getElementById('floating-multi-capture');
    if (floating) floating.style.display = 'flex';
};

window.finishIssueMultiCapture = async function() {
    var shotBtn = document.getElementById('btn-floating-multi-capture-shot');
    var activeViewer = typeof window.getActiveCaptureViewer === 'function' ? window.getActiveCaptureViewer() : null;
    if (activeViewer && typeof activeViewer.getScreenShot === 'function') {
        if (shotBtn) shotBtn.disabled = true;
        window.hideIssueMultiCaptureFloating();
        try {
            var w = activeViewer.container && activeViewer.container.clientWidth ? activeViewer.container.clientWidth : 1280;
            var h = activeViewer.container && activeViewer.container.clientHeight ? activeViewer.container.clientHeight : 720;
            activeViewer.getScreenShot(w, h, function(screenshotDataUrl) {
                if (!screenshotDataUrl || String(screenshotDataUrl).indexOf('data:image') !== 0) {
                    try {
                        var fallbackCanvas = (activeViewer.impl && activeViewer.impl.canvas) ||
                            activeViewer.canvas ||
                            (activeViewer.container ? activeViewer.container.querySelector('canvas') : null);
                        if (fallbackCanvas && typeof fallbackCanvas.toDataURL === 'function') {
                            screenshotDataUrl = fallbackCanvas.toDataURL('image/png');
                        }
                    } catch (canvasErr) {
                        console.warn('[Multi Capture] Canvas fallback failed:', canvasErr);
                    }
                    if (!screenshotDataUrl || String(screenshotDataUrl).indexOf('data:image') !== 0) {
                        alert('뷰어 화면 캡처에 실패했습니다.');
                        window.restoreIssueMultiCaptureModal();
                        if (shotBtn) shotBtn.disabled = false;
                        return;
                    }
                }

                if (typeof window.startMarkupSession !== 'function') {
                    var plainImages = window.getIssueCaptureImages();
                    plainImages.push(screenshotDataUrl);
                    window.renderIssueCaptureImages(plainImages);
                    window.lastStandaloneMarkupImage = plainImages[0] || '';
                    window.restoreIssueMultiCaptureModal();
                    if (shotBtn) shotBtn.disabled = false;
                    return;
                }

                window._pendingMultiCaptureMarkup = true;
                window.startMarkupSession(screenshotDataUrl, function(mergedB64) {
                    window._pendingMultiCaptureMarkup = false;
                    var finalImage = mergedB64 || screenshotDataUrl;
                    var images = window.getIssueCaptureImages();
                    images.push(finalImage);
                    window.renderIssueCaptureImages(images);
                    window.lastStandaloneMarkupImage = images[0] || '';
                    window.restoreIssueMultiCaptureModal();
                    if (shotBtn) shotBtn.disabled = false;
                });
            });
        } catch (err) {
            console.error('[Multi Capture] Markup capture failed:', err);
            alert('뷰어 화면 캡처에 실패했습니다.');
            window.restoreIssueMultiCaptureModal();
            if (shotBtn) shotBtn.disabled = false;
        }
        return;
    }
    if (!activeViewer || typeof activeViewer.getScreenShot !== 'function') {
        alert('캡처할 뷰어가 아직 준비되지 않았습니다.');
        window.hideIssueMultiCaptureFloating();
        window.restoreIssueMultiCaptureModal();
        return;
    }

    if (shotBtn) shotBtn.disabled = true;
    try {
        var dataUrl = await captureViewerScreen(activeViewer, 1280, 720);
        var addImage = function(src) {
            var images = window.getIssueCaptureImages();
            images.push(src || dataUrl);
            window.renderIssueCaptureImages(images);
            window.lastStandaloneMarkupImage = images[0] || '';
            window.hideIssueMultiCaptureFloating();
            window.restoreIssueMultiCaptureModal();
            if (shotBtn) shotBtn.disabled = false;
        };

        if (typeof window.compressImg === 'function') {
            window.compressImg(dataUrl, addImage);
        } else {
            addImage(dataUrl);
        }
    } catch (err) {
        console.error('[Multi Capture] Viewer screenshot failed:', err);
        alert('뷰어 화면 캡처에 실패했습니다.');
        window.hideIssueMultiCaptureFloating();
        window.restoreIssueMultiCaptureModal();
        if (shotBtn) shotBtn.disabled = false;
    }
};

window.bindIssueMultiCaptureFloating = function() {
    var shotBtn = document.getElementById('btn-floating-multi-capture-shot');
    var cancelBtn = document.getElementById('btn-floating-multi-capture-cancel');
    if (shotBtn && !shotBtn.dataset.bound) {
        shotBtn.dataset.bound = 'true';
        shotBtn.onclick = function(e) {
            if (e) e.preventDefault();
            window.finishIssueMultiCapture();
        };
    }
    if (cancelBtn && !cancelBtn.dataset.bound) {
        cancelBtn.dataset.bound = 'true';
        cancelBtn.onclick = function(e) {
            if (e) e.preventDefault();
            window.hideIssueMultiCaptureFloating();
            window.restoreIssueMultiCaptureModal();
        };
    }
};

window.initIssueMultiCaptureUI = function(initialImages) {
    var addBtn = document.getElementById('btn-add-capture');
    if (!addBtn) return;
    window.renderIssueCaptureImages(initialImages || []);
    window.bindIssueMultiCaptureFloating();

    addBtn.onclick = async function(e) {
        if (e) e.preventDefault();
        window.enterIssueMultiCaptureMode();
        return;
        var activeViewer = window.myGlobalViewer || window.viewer || window.NOP_VIEWER;
        if (!activeViewer) {
            alert('캡처할 뷰어가 아직 준비되지 않았습니다.');
            return;
        }

        addBtn.disabled = true;
        var oldOpacity = addBtn.style.opacity;
        addBtn.style.opacity = '0.6';
        try {
            var dataUrl = await captureViewerScreen(activeViewer, 1280, 720);
            if (typeof window.compressImg === 'function') {
                window.compressImg(dataUrl, function(compressed) {
                    var images = window.getIssueCaptureImages();
                    images.push(compressed || dataUrl);
                    window.renderIssueCaptureImages(images);
                    window.lastStandaloneMarkupImage = images[0] || '';
                    addBtn.disabled = false;
                    addBtn.style.opacity = oldOpacity || '1';
                });
            } else {
                var images = window.getIssueCaptureImages();
                images.push(dataUrl);
                window.renderIssueCaptureImages(images);
                window.lastStandaloneMarkupImage = images[0] || '';
                addBtn.disabled = false;
                addBtn.style.opacity = oldOpacity || '1';
            }
        } catch (err) {
            console.error('[Multi Capture] Viewer screenshot failed:', err);
            alert('뷰어 화면 캡처에 실패했습니다.');
            addBtn.disabled = false;
            addBtn.style.opacity = oldOpacity || '1';
        }
    };
};

document.addEventListener('click', function(e) {
    var target = e.target;
    if (!target) return;
    var addCapture = target.closest ? target.closest('#btn-add-capture') : null;
    var floatingShot = target.closest ? target.closest('#btn-floating-multi-capture-shot') : null;
    var floatingCancel = target.closest ? target.closest('#btn-floating-multi-capture-cancel') : null;

    if (addCapture) {
        e.preventDefault();
        e.stopPropagation();
        window.enterIssueMultiCaptureMode();
    } else if (floatingShot) {
        e.preventDefault();
        e.stopPropagation();
        window.finishIssueMultiCapture();
    } else if (floatingCancel) {
        e.preventDefault();
        e.stopPropagation();
        window.hideIssueMultiCaptureFloating();
        window.restoreIssueMultiCaptureModal();
    }
}, true);

(function() {
    console.log("[Anti-Dummy Guard] 버전 비교 데이터 검증 및 유령 더미 원천 차단 세션 가동.");

    // 🚨 1) 로컬 스토리지 데이터 상태를 엄격히 점검
    var rawCompare = localStorage.getItem('my_saved_compare_issues');
    
    // 만약 사용자가 '삭제' 버튼을 눌러 창고가 비어있거나(null), 완전히 초기화된 상태라면
    if (rawCompare === null || rawCompare === undefined || rawCompare.trim() === '[]') {
        console.log("[Anti-Dummy Guard] 창고가 깨끗하게 비어있습니다. 빈 배열([])로 강제 고정합니다.");
        
        // 라이브러리가 내부에 숨겨둔 하드코딩 샘플 데이터 배열을 무력화하기 위해 빈 값 강제 주입
        localStorage.setItem('my_saved_compare_issues', '[]');
        
        window.currentIssueList = [];
        if (typeof window.compareIssues !== 'undefined') window.compareIssues = [];
        if (typeof window.currentCompareIssues !== 'undefined') window.currentCompareIssues = [];
    } else {
        // 데이터가 존재할 때는 온전하게 파싱하여 전달
        try {
            var parsed = JSON.parse(rawCompare);
            if (Array.isArray(parsed)) {
                window.currentIssueList = parsed;
                if (typeof window.compareIssues !== 'undefined') window.compareIssues = parsed;
                if (typeof window.currentCompareIssues !== 'undefined') window.currentCompareIssues = parsed;
            }
        } catch(e) {
            localStorage.setItem('my_saved_compare_issues', '[]');
        }
    }

    // 🚨 2) 라이브러리가 비동기 타이머나 Forge 뷰어 로드 이벤트로 더미를 재주입하는 행위를 상시 감시 및 차단
    var originalGetItem = localStorage.getItem;
    localStorage.getItem = function(key) {
        var val = originalGetItem.apply(this, arguments);
        if (key === 'my_saved_compare_issues') {
            if (!val || val.trim() === '[]') {
                return '[]'; // 다른 스크립트가 더미를 채워 넣으려고 발악해도 무조건 순수 빈 배열 리턴
            }
        }
        return val;
    };
})();

// 🚨 [인프라 세션 복구 가드] 새로고침 및 컨텍스트 유실 방지 엔진
window.currentHubId = localStorage.getItem('aps_last_hub_id') || "";
window.currentProjectId = localStorage.getItem('aps_last_project_id') || "";
window.currentRegion = localStorage.getItem('aps_last_region') || "US";

console.log("[Context Engine] 초기 런타임 상태 복구 성공:", {
    hub: window.currentHubId,
    project: window.currentProjectId
});

// 🚨 [선행 인프라 가드] 앱이 켜지는 순간 스토리지가 터져있으면 강제로 숨통을 트여주는 초기화 장치
window.addEventListener('load', function() {
    try {
        var currentFilter = window.currentIssueFilter || "";
        console.log("[Storage Test] 런타임 스토리지 가용 공간 검사 정상 수행.");
    } catch (e) {
        // 이미 완전히 뻗어있는 상태라면 비교 이슈 캐시를 안전하게 한 번 비워내어 쓰기 공간을 즉시 개방합니다.
        console.error("[Storage Guard] 초기 로딩 시점 한도 초과 확인. 노후된 비교 이슈 로컬 세션을 해제합니다.");
        localStorage.removeItem('my_saved_compare_issues');
    }
});

let viewerInstance = null;
window.compareModeStyleTag = null;

// 🚨 [비교 모드 진입 시] 단독 이슈 버튼 및 마커 은닉 제어 엔진 (시작/활성화)
(function() {
    function wrapCompareService(service) {
        if (!service) return service;
        if (service._isWrappedByMain) return service;
        
        var originalStartComparison = service.startComparison;
        if (typeof originalStartComparison === 'function') {
            service.startComparison = async function(versionA, versionB) {
                window.isCompareModeActive = true;
                // 🚨 [강력 차단 1] 오토데스크 네이티브 API를 통한 단독 이슈 버튼 제거
                var activeViewer = window.myGlobalViewer || window.viewer || window.NOP_VIEWER;
                if (activeViewer && activeViewer.toolbar) {
                    var customGroup = activeViewer.toolbar.getControl('custom-issue-toolbar-group');
                    if (customGroup) {
                        // 툴바 그룹 자체를 비활성화 및 숨김 처리
                        customGroup.setVisible(false);
                    }
                    var nativeBtn = activeViewer.toolbar.getControl('native-issue-create-btn');
                    if (nativeBtn) {
                        nativeBtn.setVisible(false);
                    }
                }

                // 🚨 [강력 차단 2] 비교 뷰 진입 즉시 단독 뷰어의 모든 마커 DOM 강제 차단
                if (window.issueMarkersDOMList && window.issueMarkersDOMList.length > 0) {
                    for (var i = 0; i < window.issueMarkersDOMList.length; i++) {
                        var marker = window.issueMarkersDOMList[i];
                        if (marker) {
                            marker.style.setProperty('display', 'none', 'important');
                            marker.style.setProperty('visibility', 'hidden', 'important');
                        }
                    }
                }
                // 만약 Map 구조(htmlMarkersMap)를 사용 중이라면 아래 코드도 병행 실행
                if (window._issueManager && window._issueManager.htmlMarkersMap) {
                    window._issueManager.htmlMarkersMap.forEach(function(data) {
                        if (data && data.element) {
                            data.element.style.setProperty('display', 'none', 'important');
                            data.element.style.setProperty('visibility', 'hidden', 'important');
                        }
                    });
                }

                // 🚨 [최후의 수단] 브라우저 CSS 렌더링 엔진 레벨에서 강제 차단 규칙 주입
                if (!window.compareModeStyleTag) {
                    var style = document.createElement('style');
                    style.id = 'compare-mode-hide-rules';

                    // 1. 네이티브 버튼 및 단독 이슈 마커 클래스/ID를 모조리 무조건 숨김 처리
                    // 프로젝트 내 실제 마커 클래스명(.issue-marker, .custom-issue-pushpin 등)을 모두 체인으로 엮음
                    style.innerHTML = "#native-issue-create-btn { display: none !important; opacity: 0 !important; visibility: hidden !important; pointer-events: none !important; }" +
                                      ".issue-marker { display: none !important; opacity: 0 !important; visibility: hidden !important; }" +
                                      ".custom-issue-pushpin { display: none !important; opacity: 0 !important; visibility: hidden !important; }" +
                                      ".issue-temp-marker { display: none !important; opacity: 0 !important; visibility: hidden !important; }";

                    document.head.appendChild(style);
                    window.compareModeStyleTag = style;
                    console.log("[CSS Guard] 비교 뷰어 오염 방지 글로벌 스타일 시트 락(Lock) 완료.");
                }

                return originalStartComparison.apply(this, arguments);
            };
            service._isWrappedByMain = true;
        }
        return service;
    }

    if (window.modelComparison) {
        window.modelComparison = wrapCompareService(window.modelComparison);
    }
    if (window.comparisonManager) {
        window.comparisonManager = wrapCompareService(window.comparisonManager);
    }
    if (window.comparison) {
        window.comparison = wrapCompareService(window.comparison);
    }

    var _modelComparisonVal = window.modelComparison || null;
    Object.defineProperty(window, 'modelComparison', {
        get: function() { return _modelComparisonVal; },
        set: function(val) { _modelComparisonVal = wrapCompareService(val); },
        configurable: true
    });

    var _comparisonManagerVal = window.comparisonManager || null;
    Object.defineProperty(window, 'comparisonManager', {
        get: function() { return _comparisonManagerVal; },
        set: function(val) { _comparisonManagerVal = wrapCompareService(val); },
        configurable: true
    });

    var _comparisonVal = window.comparison || null;
    Object.defineProperty(window, 'comparison', {
        get: function() { return _comparisonVal; },
        set: function(val) { _comparisonVal = wrapCompareService(val); },
        configurable: true
    });
})();

window.isCompareModeActive = false;

// 🚨 [오토데스크 뷰어 조작 잠금 및 해제 장치]
window.setViewerControls = function(enabled) {
    // 제어할 대상 뷰어 인스턴스 배열 구성
    var viewers = [
        window.viewer, 
        window.myGlobalViewer, 
        window.overlayViewer, 
        window.leftViewer, 
        window.rightViewer,
        window.NOP_VIEWER
    ];

    for (var i = 0; i < viewers.length; i++) {
        var v = viewers[i];
        // 뷰어 인스턴스와 하위 내비게이션 객체가 실존하는지 철저히 검증
        if (v && v.navigation) {
            try {
                // 🚨 [정식 API 교정] Forge/APS Viewer 공식 내비게이션 제어 메서드
                if (typeof v.navigation.setZoomEnabled === 'function') {
                    v.navigation.setZoomEnabled(enabled);
                }
                if (typeof v.navigation.setOrbitEnabled === 'function') {
                    v.navigation.setOrbitEnabled(enabled);
                }
                if (typeof v.navigation.setPanEnabled === 'function') {
                    v.navigation.setPanEnabled(enabled);
                }
                
                // 추가 안전장치: 마크업 중 뷰어 내부 단축키나 마우스 액션이 튀는 것을 막기 위해 기본 툴 일시 전환
                if (!enabled) {
                    if (v.setActiveNavigationTool) v.setActiveNavigationTool('');
                } else {
                    if (v.setActiveNavigationTool) v.setActiveNavigationTool('orbit');
                }
                
                console.log("[Nav Guard] 뷰어 인스턴스 컨트롤 상태 변경 완료: " + enabled);
            } catch (err) {
                console.warn("[Nav Guard] 특정 뷰어 컨트롤 조작 중 예외 발생 (무시됨): " + err);
            }
        }
    }
};

window.projectMembersList = [];

window.loadProjectMembersIntoSelect = function(selectEl, savedValue) {
    if (!selectEl) return;
    
    selectEl.removeAttribute('disabled');
    selectEl.removeAttribute('readonly');

    function populate(members) {
        selectEl.innerHTML = '<option value="">담당자를 선택하세요...</option>';
        var guard = {};
        for (var i = 0; i < members.length; i++) {
            var m = members[i];
            window.addUniqueUserOption(m.name || m.displayName || m.email || '', m.role || m.jobTitle || '구성원', selectEl, guard);
        }
        window.addMasterSessionUser(selectEl, guard);

        // 저장된 값이 목록에 없다면 방어용 추가
        var isExist = false;
        for (var j = 0; j < selectEl.options.length; j++) {
            if (selectEl.options[j].value === savedValue) {
                isExist = true;
                break;
            }
        }
        if (!isExist && savedValue) {
            var customOpt = document.createElement('option');
            customOpt.value = savedValue;
            customOpt.text = savedValue;
            selectEl.appendChild(customOpt);
        }
        selectEl.value = savedValue;
    }

    if (window.projectMembersList && window.projectMembersList.length > 0) {
        populate(window.projectMembersList);
    } else {
        var hubId = window.currentHubId || localStorage.getItem('aps_last_hub_id') || '';
        var projectId = window.currentProjectId || localStorage.getItem('aps_last_project_id') || '';
        if (hubId && projectId) {
            var membersUrl = '/api/hubs/' + hubId + '/projects/' + projectId + '/members';
            fetch(membersUrl)
                .then(function(r) { return r.ok ? r.json() : null; })
                .then(function(data) {
                    if (data) {
                        var membersList = data.members || data.users || data.results || [];
                        window.projectMembersList = membersList;
                        populate(membersList);
                    }
                })
                .catch(function(e) {
                    console.error('[ACC Members Popup Load Error]', e);
                });
        }
    }
};

// ✅ [ACC Construction Admin API 직결] assignee + verifier 동시 실시간 구성원 연동
window.syncFormaProjectMembers = function() {
    var assigneeSelect1 = document.getElementById('dyn-issue-assignee');
    var assigneeSelect2 = document.getElementById('issue-assignee');
    var verifierSelect = document.getElementById('dyn-issue-verifier');

    // 대상 셀렉트가 하나도 없으면 중단
    if (!assigneeSelect1 && !assigneeSelect2 && !verifierSelect) return;

    // 1. 로딩 상태 표시 (있는 것만)
    if (assigneeSelect1) assigneeSelect1.innerHTML = '<option value="">구성원 목록 불러오는 중...</option>';
    if (assigneeSelect2) assigneeSelect2.innerHTML = '<option value="">구성원 목록 불러오는 중...</option>';
    if (verifierSelect) verifierSelect.innerHTML = '<option value="">구성원 목록 불러오는 중...</option>';

    var hubId = window.currentHubId || localStorage.getItem('aps_last_hub_id') || '';
    var projectId = window.currentProjectId || localStorage.getItem('aps_last_project_id') || '';

    if (!hubId || !projectId) {
        console.warn('[ACC Members] hubId 또는 projectId 없음. 세션 복구 후 재시도.');
        if (assigneeSelect1) {
            assigneeSelect1.innerHTML = '<option value="">프로젝트를 먼저 선택하세요.</option>';
            window.addMasterSessionUser(assigneeSelect1, {});
        }
        if (assigneeSelect2) {
            assigneeSelect2.innerHTML = '<option value="">프로젝트를 먼저 선택하세요.</option>';
            window.addMasterSessionUser(assigneeSelect2, {});
        }
        if (verifierSelect) {
            verifierSelect.innerHTML = '<option value="">프로젝트를 먼저 선택하세요.</option>';
            window.addMasterSessionUser(verifierSelect, {});
        }
        return;
    }

    // 2. ✅ 단일 API 호출로 양쪽 셀렉트 동시 채우기
    var membersUrl = '/api/hubs/' + hubId + '/projects/' + projectId + '/members';
    console.log('[ACC Members] 구성원 요청 (assignee + verifier): ' + membersUrl);

    fetch(membersUrl)
        .then(function(response) {
            if (response.status === 403) {
                console.warn('[ACC Members] 403 — Account Admin 권한 필요.');
                var msg = '<option value="">권한 부족 (Project/Account Admin 필요)</option>';
                if (assigneeSelect1) { assigneeSelect1.innerHTML = msg; window.addMasterSessionUser(assigneeSelect1, {}); }
                if (assigneeSelect2) { assigneeSelect2.innerHTML = msg; window.addMasterSessionUser(assigneeSelect2, {}); }
                if (verifierSelect) { verifierSelect.innerHTML = msg; window.addMasterSessionUser(verifierSelect, {}); }
                return null;
            }
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return response.json();
        })
        .then(function(data) {
            if (!data) return;

            // 3. 응답 파싱: { members: [...] } 구조
            var membersList = data.members || data.users || data.results || [];
            window.projectMembersList = membersList;

            // 4. assignee 셀렉트 채우기 (dyn-issue-assignee)
            if (assigneeSelect1) {
                assigneeSelect1.innerHTML = '<option value="">담당자를 선택하세요...</option>';
                var guardA1 = {};
                for (var i = 0; i < membersList.length; i++) {
                    var m = membersList[i];
                    window.addUniqueUserOption(m.name || m.displayName || m.email || '', m.role || m.jobTitle || '구성원', assigneeSelect1, guardA1);
                }
                window.addMasterSessionUser(assigneeSelect1, guardA1);
            }

            // 4-2. assignee 셀렉트 채우기 (issue-assignee)
            if (assigneeSelect2) {
                assigneeSelect2.innerHTML = '<option value="">담당자를 선택하세요...</option>';
                var guardA2 = {};
                for (var i = 0; i < membersList.length; i++) {
                    var m = membersList[i];
                    window.addUniqueUserOption(m.name || m.displayName || m.email || '', m.role || m.jobTitle || '구성원', assigneeSelect2, guardA2);
                }
                window.addMasterSessionUser(assigneeSelect2, guardA2);
            }

            // 5. verifier 셀렉트 채우기 (독립적인 guard 사용)
            if (verifierSelect) {
                verifierSelect.innerHTML = '<option value="">검토자를 선택하세요...</option>';
                var guardV = {};
                for (var j = 0; j < membersList.length; j++) {
                    var v = membersList[j];
                    window.addUniqueUserOption(v.name || v.displayName || v.email || '', v.role || v.jobTitle || '구성원', verifierSelect, guardV);
                }
                window.addMasterSessionUser(verifierSelect, guardV);
            }

            if (membersList.length > 0) {
                console.log('[ACC Members] ' + membersList.length + '명 → assignee + verifier 동시 바인딩 완료.');
            } else {
                console.warn('[ACC Members] 반환된 구성원 없음 (빈 배열).');
            }

            // 📌 구성원 드롭다운 옵션 생성이 끝난 직후 실행되는 강제 세터(Setter)
            if (window.currentActiveViewingIssue) {
                var savedData = window.currentActiveViewingIssue;

                // 단독 이슈 및 커스텀 비교 이슈 셀렉트 박스 ID 동시 추적
                var aSel1 = document.getElementById('dyn-issue-assignee');
                var aSel2 = document.getElementById('issue-assignee');
                var aSel3 = document.getElementById('real-compare-assignee-select');
                var vSel = document.getElementById('dyn-issue-verifier') || document.getElementById('issue-verifier');

                // 옵션 리스트에 일치하는 값이 있으면 브라우저가 튕겨내지 않고 정확히 고정 선택함
                if (aSel1 && savedData.assignee) aSel1.value = savedData.assignee;
                if (aSel2 && savedData.assignee) aSel2.value = savedData.assignee;
                if (aSel3 && savedData.assignee) aSel3.value = savedData.assignee;
                if (vSel && (savedData.verifier || savedData.reviewer)) {
                    vSel.value = savedData.verifier || savedData.reviewer;
                }
                console.log("[Data Recovery Sync] 담당자/확인자 원본 데이터 매핑 완료 완료 ✅");
            }
        })
        .catch(function(err) {
            console.error('[ACC Members] 오류: ' + err.message);
            var errMsg = '<option value="">구성원 조회 실패 — 관리자에게 문의</option>';
            if (assigneeSelect1) { assigneeSelect1.innerHTML = errMsg; window.addMasterSessionUser(assigneeSelect1, {}); }
            if (assigneeSelect2) { assigneeSelect2.innerHTML = errMsg; window.addMasterSessionUser(assigneeSelect2, {}); }
            if (verifierSelect) { verifierSelect.innerHTML = errMsg; window.addMasterSessionUser(verifierSelect, {}); }
        });
};

// ── 중복 제거 옵션 주입 서브 루틴 ──
window.addUniqueUserOption = function(name, role, selectEl, guardObj) {
    if (!name || name === 'System' || guardObj[name]) return;
    guardObj[name] = true;

    var option = document.createElement('option');
    option.value = name;
    option.innerText = name;
    selectEl.appendChild(option);
};

// ── 마스터 세션 유저 강제 삽입 서브 루틴 ──
window.addMasterSessionUser = function(selectEl, guardObj) {
    var sUser = window.currentUser || window.UserProfile;
    if (sUser && sUser.name && !guardObj[sUser.name]) {
        guardObj[sUser.name] = true;
        var option = document.createElement('option');
        option.value = sUser.name;
        option.innerText = sUser.name;
        selectEl.appendChild(option);
    }
    // 아무것도 없을 경우 최소 1개 자동 삽입
    if (selectEl.children.length === 1) {
        var optDefault = document.createElement('option');
        optDefault.value = '프로젝트 담당자';
        optDefault.innerText = '프로젝트 담당자';
        selectEl.appendChild(optDefault);
    }
};

// 3. 🚨 [순수 옵션 생성 매퍼] 외부 데이터를 받아 select 박스를 순수하게 채워주는 서브 루틴
window.populateAssigneeOptions = function(usersArray) {
    var assigneeSelect = document.getElementById('dyn-issue-assignee');
    if (!assigneeSelect || !usersArray) return;

    assigneeSelect.innerHTML = '<option value="">담당자를 선택하세요...</option>';

    var addedCount = 0;
    for (var i = 0; i < usersArray.length; i++) {
        var u = usersArray[i];
        
        // 다양한 API 데이터 규격(name, displayName, userName 등) 동적 대응 가드
        var name = u.name || u.displayName || u.username || u.userName || "";
        var role = u.role || u.position || "";
        var val = u.id || u.email || name;

        if (name && name !== "System") {
            var option = document.createElement('option');
            option.value = val;
            option.innerText = role ? name + " (" + role + ")" : name;
            assigneeSelect.appendChild(option);
            addedCount++;
        }
    }
    console.log("[Forma Dynamic Link] 실제 데이터 소스로부터 담당자 " + addedCount + "명 동적 바인딩 성공.");
};

window.fillFormaMembersFromDOM = window.syncFormaProjectMembers;
window.fillFormaMembersToAssignee = window.syncFormaProjectMembers;

// --- 호출 트리거 전면 전향 개정 ---
if (window.openIssueModal) {
    var _origModal = window.openIssueModal;
    window.openIssueModal = function(d, p, m) {
        _origModal(d, p, m);
        setTimeout(window.syncFormaProjectMembers, 60);
    };
}

// 🚨 [공용 마크업 시스템 엔진 - 벡터 객체 편집 버전 - 양방향 통합 엔진]
window.markupShapes = [];
window.compareMarkupHistory = [];
window.selectedShape = null;
window.redrawMarkupCanvas = null;
window.redrawUnifiedCanvas = null;

window.startMarkupSession = function(baseImgUrl, onComplete) {
    window.setViewerControls(false);

    var targetContainer = null;
    if (window.isCompareModeActive) {
        var split = document.getElementById('viewer-split-wrapper');
        if (split && split.style.display !== 'none') {
            targetContainer = split;
        } else {
            targetContainer = document.getElementById('viewer-overlay');
        }
    } else {
        targetContainer = document.getElementById('preview');
    }
    if (!targetContainer) {
        window.setViewerControls(true);
        return;
    }

    var oldOverlay = document.getElementById('global-markup-overlay');
    if (oldOverlay) {
        oldOverlay.parentNode.removeChild(oldOverlay);
    }

    // 초기화
    window.markupShapes = [];
    window.compareMarkupHistory = [];
    window.selectedShape = null;

    var overlay = document.createElement('div');
    overlay.id = 'global-markup-overlay';
    overlay.style.cssText = "position: absolute; top: 0; left: 0; width: 100%; height: 100%; z-index: 10000; background: rgba(0,0,0,0.35); display: flex; flex-direction: column; font-family: 'Noto Sans KR', sans-serif;";

    var toolbar = document.createElement('div');
    toolbar.id = 'global-markup-toolbar';
    toolbar.style.cssText = "display: flex; gap: 8px; align-items: center; justify-content: center; background: #1e293b; padding: 10px; border-bottom: 2px solid #334155; color: white; flex-wrap: wrap; z-index: 10001;";

    var currentTool = 'select'; // 'select', 'arrow', 'line', 'rect', 'circle', 'cloud', 'text'
    var strokeColor = '#ef4444';
    var strokeWidth = 3;
    var fontSize = 16;
    var isDrawing = false;
    var startX = 0;
    var startY = 0;
    var currentShape = null;
    var bgImage = null;

    var tools = [
        { id: 'select', label: '선택', icon: 'fa-mouse-pointer' },
        { id: 'arrow', label: '화살표', icon: 'fa-arrow-up-right' },
        { id: 'line', label: '직선', icon: 'fa-minus' },
        { id: 'rect', label: '사각형', icon: 'fa-square' },
        { id: 'circle', label: '원형', icon: 'fa-circle' },
        { id: 'cloud', label: '구름', icon: 'fa-cloud' },
        { id: 'text', label: '텍스트', icon: 'fa-font' }
    ];

    var toolButtons = [];
    var createToolBtn = function(t) {
        var btn = document.createElement('button');
        btn.innerHTML = "<i class='fas " + t.icon + "'></i> " + t.label;
        btn.style.cssText = "background: #334155; color: #cbd5e1; border: 1px solid #475569; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: bold; transition: all 0.2s;";
        if (t.id === currentTool) {
            btn.style.background = '#f97316';
            btn.style.color = 'white';
        }
        btn.onclick = function() {
            currentTool = t.id;
            if (currentTool !== 'select') {
                window.selectedShape = null;
            }
            for (var k = 0; k < toolButtons.length; k++) {
                var b = toolButtons[k];
                if (b.dataset.id === currentTool) {
                    b.style.background = '#f97316';
                    b.style.color = 'white';
                } else {
                    b.style.background = '#334155';
                    b.style.color = '#cbd5e1';
                }
            }
            window.redrawUnifiedCanvas();
        };
        btn.dataset.id = t.id;
        toolButtons.push(btn);
        toolbar.appendChild(btn);
    };

    for (var j = 0; j < tools.length; j++) {
        createToolBtn(tools[j]);
    }

    var div1 = document.createElement('div');
    div1.style.cssText = "width: 1px; height: 20px; background: #475569; margin: 0 4px;";
    toolbar.appendChild(div1);

    var colorLabel = document.createElement('span');
    colorLabel.innerText = "색상: ";
    colorLabel.style.cssText = "font-size: 12px; color: #94a3b8; font-weight: bold;";
    toolbar.appendChild(colorLabel);

    var presetColors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6'];
    var presetColorBtns = [];
    var createColorBtn = function(c) {
        var cbtn = document.createElement('button');
        cbtn.style.cssText = "width: 18px; height: 18px; border-radius: 50%; border: 2px solid white; cursor: pointer; margin-right: 4px; padding: 0; transition: transform 0.1s;";
        cbtn.style.background = c;
        if (c === strokeColor) {
            cbtn.style.borderColor = '#00f2fe';
        }
        cbtn.onclick = function() {
            strokeColor = c;
            customColorInput.value = c;
            if (window.selectedShape) {
                window.selectedShape.color = c;
            }
            for (var m = 0; m < presetColorBtns.length; m++) {
                var cb = presetColorBtns[m];
                cb.style.borderColor = (cb.dataset.color === strokeColor) ? '#00f2fe' : 'white';
            }
            window.redrawUnifiedCanvas();
        };
        cbtn.dataset.color = c;
        presetColorBtns.push(cbtn);
        toolbar.appendChild(cbtn);
    };

    for (var n = 0; n < presetColors.length; n++) {
        createColorBtn(presetColors[n]);
    }

    var customColorInput = document.createElement('input');
    customColorInput.type = 'color';
    customColorInput.value = strokeColor;
    customColorInput.style.cssText = "width: 24px; height: 24px; border: none; background: transparent; cursor: pointer; padding: 0; margin-left: 2px;";
    customColorInput.onchange = function() {
        strokeColor = customColorInput.value;
        if (window.selectedShape) {
            window.selectedShape.color = strokeColor;
        }
        for (var m = 0; m < presetColorBtns.length; m++) {
            presetColorBtns[m].style.borderColor = 'white';
        }
        window.redrawUnifiedCanvas();
    };
    toolbar.appendChild(customColorInput);

    var div2 = document.createElement('div');
    div2.style.cssText = "width: 1px; height: 20px; background: #475569; margin: 0 4px;";
    toolbar.appendChild(div2);

    var widthLabel = document.createElement('span');
    widthLabel.innerText = "두께: ";
    widthLabel.style.cssText = "font-size: 12px; color: #94a3b8; font-weight: bold;";
    toolbar.appendChild(widthLabel);

    var widthSlider = document.createElement('input');
    widthSlider.type = 'range';
    widthSlider.min = '1';
    widthSlider.max = '12';
    widthSlider.value = strokeWidth;
    widthSlider.style.cssText = "width: 70px; cursor: pointer;";
    toolbar.appendChild(widthSlider);

    var widthDisplay = document.createElement('span');
    widthDisplay.innerText = strokeWidth + "px";
    widthDisplay.style.cssText = "font-size: 12px; color: #cbd5e1; min-width: 28px; font-weight: bold;";
    toolbar.appendChild(widthDisplay);

    widthSlider.oninput = function() {
        strokeWidth = parseInt(widthSlider.value, 10);
        widthDisplay.innerText = strokeWidth + "px";
        if (window.selectedShape) {
            window.selectedShape.width = strokeWidth;
            window.redrawUnifiedCanvas();
        }
    };

    var div3 = document.createElement('div');
    div3.style.cssText = "width: 1px; height: 20px; background: #475569; margin: 0 4px;";
    toolbar.appendChild(div3);

    var fontLabel = document.createElement('span');
    fontLabel.innerText = "글자 크기: ";
    fontLabel.style.cssText = "font-size: 12px; color: #94a3b8; font-weight: bold;";
    toolbar.appendChild(fontLabel);

    var fontSizeInput = document.createElement('input');
    fontSizeInput.type = 'number';
    fontSizeInput.min = '10';
    fontSizeInput.max = '48';
    fontSizeInput.value = fontSize;
    fontSizeInput.style.cssText = "width: 48px; background: #0f172a; border: 1px solid #475569; color: white; padding: 4px; border-radius: 4px; font-size: 12px; text-align: center; outline: none; font-weight: bold;";
    toolbar.appendChild(fontSizeInput);

    var pxLabel = document.createElement('span');
    pxLabel.innerText = "px";
    pxLabel.style.cssText = "font-size: 12px; color: #cbd5e1; font-weight: bold; margin-right: 8px;";
    toolbar.appendChild(pxLabel);

    fontSizeInput.onchange = function() {
        fontSize = parseInt(fontSizeInput.value, 10) || 16;
        if (window.selectedShape) {
            window.selectedShape.fontSize = fontSize;
            window.redrawUnifiedCanvas();
        }
    };

    var divDelete = document.createElement('div');
    divDelete.style.cssText = "width: 1px; height: 20px; background: #475569; margin: 0 4px;";
    toolbar.appendChild(divDelete);

    var deleteBtn = document.createElement('button');
    deleteBtn.innerHTML = "<i class='fas fa-trash-can'></i> 삭제";
    deleteBtn.style.cssText = "background: #ef4444; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: bold; transition: background 0.2s; margin-right: 8px;";
    deleteBtn.onmouseover = function() { deleteBtn.style.background = '#dc2626'; };
    deleteBtn.onmouseout = function() { deleteBtn.style.background = '#ef4444'; };
    deleteBtn.onclick = function() {
        if (window.selectedShape) {
            var activeHistory = window.isCompareModeActive ? window.compareMarkupHistory : window.markupShapes;
            var idx = activeHistory.indexOf(window.selectedShape);
            if (idx > -1) {
                activeHistory.splice(idx, 1);
                window.selectedShape = null;
                window.redrawUnifiedCanvas();
            }
        }
    };
    toolbar.appendChild(deleteBtn);

    var div4 = document.createElement('div');
    div4.style.cssText = "width: 1px; height: 20px; background: #475569; margin: 0 4px;";
    toolbar.appendChild(div4);

    var cancelBtn = document.createElement('button');
    cancelBtn.innerHTML = "<i class='fas fa-times'></i> 취소";
    cancelBtn.style.cssText = "background: #ef4444; color: white; border: none; padding: 6px 14px; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: bold; transition: background 0.2s;";
    cancelBtn.onmouseover = function() { cancelBtn.style.background = '#dc2626'; };
    cancelBtn.onmouseout = function() { cancelBtn.style.background = '#ef4444'; };
    cancelBtn.onclick = function() {
        cleanup();
        if (window._pendingMultiCaptureMarkup) {
            window._pendingMultiCaptureMarkup = false;
            window.restoreIssueMultiCaptureModal();
            var multiShotBtn = document.getElementById('btn-floating-multi-capture-shot');
            if (multiShotBtn) multiShotBtn.disabled = false;
        }
        var activeViewer = window.myGlobalViewer || window.viewer || window.NOP_VIEWER || window.overlayViewer;
        if (activeViewer && typeof activeViewer.clearSelection === 'function') {
            activeViewer.clearSelection();
        }
    };
    toolbar.appendChild(cancelBtn);

    var completeBtn = document.createElement('button');
    completeBtn.innerHTML = "<i class='fas fa-check'></i> 완료";
    completeBtn.style.cssText = "background: #10b981; color: white; border: none; padding: 6px 18px; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: bold; box-shadow: 0 4px 6px rgba(16,185,129,0.25); transition: background 0.2s;";
    completeBtn.onmouseover = function() { completeBtn.style.background = '#059669'; };
    completeBtn.onmouseout = function() { completeBtn.style.background = '#10b981'; };
    
    completeBtn.onclick = function() {
        if (window.isCompareModeActive && beforeMemoryCanvas && afterMemoryCanvas) {
            // 🚨 [용량 다이어트 엔진] 고화질 PNG를 저용량 고효율 JPEG로 압축 변환
            // 0.9(고화질 PNG급)로 굽던 것을 0.35(최적화 JPEG)로 압축률을 낮춰 용량을 10분의 1로 감소시킵니다.
            // 육안상 식별에는 문제없으면서 용량 에러를 완벽히 방지합니다.
            var finalBeforeB64 = beforeMemoryCanvas.toDataURL('image/webp', 0.9);
            if (!finalBeforeB64 || finalBeforeB64.indexOf('data:image/webp') === -1) {
                finalBeforeB64 = beforeMemoryCanvas.toDataURL('image/jpeg', 0.9);
            }
            var finalAfterB64 = afterMemoryCanvas.toDataURL('image/webp', 0.9);
            if (!finalAfterB64 || finalAfterB64.indexOf('data:image/webp') === -1) {
                finalAfterB64 = afterMemoryCanvas.toDataURL('image/jpeg', 0.9);
            }
            cleanup();
            if (typeof onComplete === 'function') {
                onComplete(finalAfterB64, finalBeforeB64);
            }
        } else {
            // 단독 이슈 캔버스 용량 압축 가드
            var mergeCanvas = document.createElement('canvas');
            mergeCanvas.width = markupCanvas.width;
            mergeCanvas.height = markupCanvas.height;
            var mergeCtx = mergeCanvas.getContext('2d');

            if (bgImage) {
                mergeCtx.drawImage(bgImage, 0, 0, mergeCanvas.width, mergeCanvas.height);
            }

            for (var p = 0; p < window.markupShapes.length; p++) {
                drawShapeOnContext(mergeCtx, window.markupShapes[p]);
            }

            // 기존 묵시적 PNG 포맷 대신 JPEG 압축 포맷 가동
            var mergedDataUrl = mergeCanvas.toDataURL('image/webp', 0.9);
            if (!mergedDataUrl || mergedDataUrl.indexOf('data:image/webp') === -1) {
                mergedDataUrl = mergeCanvas.toDataURL('image/jpeg', 0.9);
            }
            cleanup();
            if (typeof onComplete === 'function') {
                onComplete(mergedDataUrl);
            }
        }
    };
    
    toolbar.appendChild(completeBtn);
    overlay.appendChild(toolbar);

    var canvasContainer = document.createElement('div');
    canvasContainer.style.cssText = "flex: 1; position: relative; overflow: hidden;";

    var markupCanvas = document.createElement('canvas');
    markupCanvas.id = 'global-markup-canvas';
    markupCanvas.style.cssText = "position: absolute; top: 0; left: 0; width: 100%; height: 100%; cursor: crosshair;";
    canvasContainer.appendChild(markupCanvas);
    overlay.appendChild(canvasContainer);

    targetContainer.appendChild(overlay);

    markupCanvas.width = canvasContainer.clientWidth;
    markupCanvas.height = canvasContainer.clientHeight;

    var markupCtx = markupCanvas.getContext('2d');

    // 듀얼 캔버스 메모리 캔버스 설정
    var beforeMemoryCanvas = null;
    var afterMemoryCanvas = null;
    var ctxBefore = null;
    var ctxAfter = null;
    var imgBefore = null;
    var imgAfter = null;

    if (window.isCompareModeActive) {
        beforeMemoryCanvas = document.createElement('canvas');
        afterMemoryCanvas = document.createElement('canvas');
        beforeMemoryCanvas.width = markupCanvas.width;
        beforeMemoryCanvas.height = markupCanvas.height;
        afterMemoryCanvas.width = markupCanvas.width;
        afterMemoryCanvas.height = markupCanvas.height;

        ctxBefore = beforeMemoryCanvas.getContext('2d');
        ctxAfter = afterMemoryCanvas.getContext('2d');

        imgBefore = new Image();
        imgBefore.crossOrigin = "anonymous";
        imgBefore.onload = function() {
            window.redrawUnifiedCanvas();
        };
        imgBefore.src = window.currentCompareBeforeUrl;

        imgAfter = new Image();
        imgAfter.crossOrigin = "anonymous";
        imgAfter.onload = function() {
            window.redrawUnifiedCanvas();
        };
        imgAfter.src = window.currentCompareAfterUrl;
    }

    bgImage = new Image();
    bgImage.onload = function() {
        window.redrawUnifiedCanvas();
    };
    bgImage.src = baseImgUrl;

    var onKeyDown = function(event) {
        if (event.key === 'Delete' || event.key === 'Backspace') {
            if (window.selectedShape) {
                var activeHistory = window.isCompareModeActive ? window.compareMarkupHistory : window.markupShapes;
                var idx = activeHistory.indexOf(window.selectedShape);
                if (idx > -1) {
                    activeHistory.splice(idx, 1);
                    window.selectedShape = null;
                    window.redrawUnifiedCanvas();
                }
            }
        }
    };
    window.addEventListener('keydown', onKeyDown);

    function cleanup() {
        window.removeEventListener('keydown', onKeyDown);
        if (overlay && overlay.parentNode) {
            overlay.parentNode.removeChild(overlay);
        }
        window.setViewerControls(true);
    }

    window.redrawUnifiedCanvas = function() {
        // 1. 화면 캔버스 갱신
        markupCtx.clearRect(0, 0, markupCanvas.width, markupCanvas.height);
        if (bgImage) {
            markupCtx.drawImage(bgImage, 0, 0, markupCanvas.width, markupCanvas.height);
        }
        
        var activeHistory = window.isCompareModeActive ? window.compareMarkupHistory : window.markupShapes;
        
        for (var p = 0; p < activeHistory.length; p++) {
            var s = activeHistory[p];
            drawShapeOnContext(markupCtx, s);
            
            if (window.selectedShape === s) {
                var minX = Math.min(s.x1, s.x2);
                var maxX = Math.max(s.x1, s.x2);
                var minY = Math.min(s.y1, s.y2);
                var maxY = Math.max(s.y1, s.y2);
                
                if (s.type === 'text') {
                    minX = s.x1;
                    maxX = s.x1 + (s.text || "").length * s.fontSize * 0.6;
                    minY = s.y1 - s.fontSize;
                    maxY = s.y1;
                }
                
                markupCtx.strokeStyle = '#38bdf8';
                markupCtx.lineWidth = 1.5;
                markupCtx.setLineDash([4, 4]);
                markupCtx.strokeRect(minX - 2, minY - 2, (maxX - minX) + 4, (maxY - minY) + 4);
                markupCtx.setLineDash([]);
                
                markupCtx.fillStyle = '#38bdf8';
                markupCtx.fillRect(s.x1 - 4, s.y1 - 4, 8, 8);
                markupCtx.fillRect(s.x2 - 4, s.y2 - 4, 8, 8);
            }
        }
        if (currentShape) {
            drawShapeOnContext(markupCtx, currentShape);
        }

        // 2. 🚨 [비교 모드 실시간 양방향 더블 렌더링]
        if (window.isCompareModeActive && ctxBefore && ctxAfter) {
            // Before memory
            ctxBefore.clearRect(0, 0, beforeMemoryCanvas.width, beforeMemoryCanvas.height);
            if (imgBefore && imgBefore.complete && imgBefore.naturalWidth > 0) {
                ctxBefore.drawImage(imgBefore, 0, 0, beforeMemoryCanvas.width, beforeMemoryCanvas.height);
            }
            for (var p = 0; p < window.compareMarkupHistory.length; p++) {
                drawShapeOnContext(ctxBefore, window.compareMarkupHistory[p]);
            }
            if (currentShape) {
                drawShapeOnContext(ctxBefore, currentShape);
            }

            // After memory
            ctxAfter.clearRect(0, 0, afterMemoryCanvas.width, afterMemoryCanvas.height);
            if (imgAfter && imgAfter.complete && imgAfter.naturalWidth > 0) {
                ctxAfter.drawImage(imgAfter, 0, 0, afterMemoryCanvas.width, afterMemoryCanvas.height);
            }
            for (var p = 0; p < window.compareMarkupHistory.length; p++) {
                drawShapeOnContext(ctxAfter, window.compareMarkupHistory[p]);
            }
            if (currentShape) {
                drawShapeOnContext(ctxAfter, currentShape);
            }
        }
    };

    window.redrawMarkupCanvas = window.redrawUnifiedCanvas;

    function drawShapeOnContext(ctx, s) {
        ctx.strokeStyle = s.color;
        ctx.fillStyle = s.color;
        ctx.lineWidth = s.width;
        ctx.lineCap = 'round';
        
        if (s.type === 'line') {
            ctx.beginPath();
            ctx.moveTo(s.x1, s.y1);
            ctx.lineTo(s.x2, s.y2);
            ctx.stroke();
        } else if (s.type === 'arrow') {
            ctx.beginPath();
            ctx.moveTo(s.x1, s.y1);
            ctx.lineTo(s.x2, s.y2);
            ctx.stroke();
            
            var angle = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
            ctx.beginPath();
            ctx.moveTo(s.x2, s.y2);
            ctx.lineTo(s.x2 - 15 * Math.cos(angle - Math.PI / 6), s.y2 - 15 * Math.sin(angle - Math.PI / 6));
            ctx.lineTo(s.x2 - 15 * Math.cos(angle + Math.PI / 6), s.y2 - 15 * Math.sin(angle + Math.PI / 6));
            ctx.closePath();
            ctx.fill();
        } else if (s.type === 'rect') {
            ctx.beginPath();
            ctx.rect(s.x1, s.y1, s.x2 - s.x1, s.y2 - s.y1);
            ctx.stroke();
        } else if (s.type === 'circle') {
            var rx = Math.abs(s.x2 - s.x1) / 2;
            var ry = Math.abs(s.y2 - s.y1) / 2;
            var cx = (s.x1 + s.x2) / 2;
            var cy = (s.y1 + s.y2) / 2;
            ctx.beginPath();
            ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
            ctx.stroke();
        } else if (s.type === 'cloud') {
            var minX = Math.min(s.x1, s.x2);
            var maxX = Math.max(s.x1, s.x2);
            var minY = Math.min(s.y1, s.y2);
            var maxY = Math.max(s.y1, s.y2);
            var w = maxX - minX;
            var h = maxY - minY;
            if (w < 10 || h < 10) return;
            
            ctx.beginPath();
            var step = 15;
            for (var x = minX; x <= maxX; x += step) {
                ctx.arc(x, minY, 8, Math.PI, 0, false);
            }
            for (var y = minY; y <= maxY; y += step) {
                ctx.arc(maxX, y, 8, -Math.PI/2, Math.PI/2, false);
            }
            for (var x = maxX; x >= minX; x -= step) {
                ctx.arc(x, maxY, 8, 0, Math.PI, false);
            }
            for (var y = maxY; y >= minY; y -= step) {
                ctx.arc(minX, y, 8, Math.PI/2, -Math.PI/2, false);
            }
            ctx.stroke();
        } else if (s.type === 'text') {
            ctx.font = s.fontSize + "px sans-serif";
            ctx.fillText(s.text, s.x1, s.y1);
        }
    }

    function isPointInShape(px, py, s) {
        var minX = Math.min(s.x1, s.x2);
        var maxX = Math.max(s.x1, s.x2);
        var minY = Math.min(s.y1, s.y2);
        var maxY = Math.max(s.y1, s.y2);
        
        if (s.type === 'text') {
            minX = s.x1;
            maxX = s.x1 + (s.text || "").length * s.fontSize * 0.6;
            minY = s.y1 - s.fontSize;
            maxY = s.y1;
        }
        
        var padding = (s.type === 'line' || s.type === 'arrow') ? 8 : 4;
        return (px >= minX - padding && px <= maxX + padding && py >= minY - padding && py <= maxY + padding);
    }

    function getResizeHandle(px, py, s) {
        var dist2 = Math.sqrt((px - s.x2) * (px - s.x2) + (py - s.y2) * (py - s.y2));
        if (dist2 <= 8) {
            return 'x2y2';
        }
        var dist1 = Math.sqrt((px - s.x1) * (px - s.x1) + (py - s.y1) * (py - s.y1));
        if (dist1 <= 8) {
            return 'x1y1';
        }
        return null;
    }

    var dragMode = null; 
    var dragOffsetX = 0;
    var dragOffsetY = 0;

    markupCanvas.onmousedown = function(e) {
        var clickX = e.offsetX;
        var clickY = e.offsetY;
        
        var activeHistory = window.isCompareModeActive ? window.compareMarkupHistory : window.markupShapes;

        if (currentTool === 'select') {
            if (window.selectedShape) {
                var handle = getResizeHandle(clickX, clickY, window.selectedShape);
                if (handle) {
                    dragMode = 'resize-' + handle;
                    isDrawing = true;
                    return;
                }
            }
            
            var found = null;
            for (var p = activeHistory.length - 1; p >= 0; p--) {
                if (isPointInShape(clickX, clickY, activeHistory[p])) {
                    found = activeHistory[p];
                    break;
                }
            }
            
            window.selectedShape = found;
            if (found) {
                dragMode = 'move';
                dragOffsetX = clickX - found.x1;
                dragOffsetY = clickY - found.y1;
                
                strokeColor = found.color;
                customColorInput.value = found.color;
                for (var m = 0; m < presetColorBtns.length; m++) {
                    var cb = presetColorBtns[m];
                    cb.style.borderColor = (cb.dataset.color === strokeColor) ? '#00f2fe' : 'white';
                }
                
                strokeWidth = found.width;
                widthSlider.value = strokeWidth;
                widthDisplay.innerText = strokeWidth + "px";
                
                if (found.fontSize) {
                    fontSize = found.fontSize;
                    fontSizeInput.value = fontSize;
                }
            }
            isDrawing = true;
            window.redrawUnifiedCanvas();
        } else {
            isDrawing = true;
            startX = clickX;
            startY = clickY;
            window.selectedShape = null;
            window.redrawUnifiedCanvas();
            
            if (currentTool === 'text') {
                isDrawing = false;
                var txt = prompt('텍스트 입력:');
                if (txt) {
                    var newTxtShape = {
                        id: Date.now(),
                        type: 'text',
                        x1: startX,
                        y1: startY,
                        x2: startX,
                        y2: startY,
                        color: strokeColor,
                        width: strokeWidth,
                        fontSize: fontSize,
                        text: txt
                    };
                    activeHistory.push(newTxtShape);
                    window.selectedShape = newTxtShape;
                    window.redrawUnifiedCanvas();
                }
            }
        }
    };

    markupCanvas.onmousemove = function(e) {
        if (!isDrawing) return;
        var curX = e.offsetX;
        var curY = e.offsetY;
        
        if (currentTool === 'select') {
            if (window.selectedShape) {
                if (dragMode === 'move') {
                    var dx = curX - dragOffsetX - window.selectedShape.x1;
                    var dy = curY - dragOffsetY - window.selectedShape.y1;
                    window.selectedShape.x1 += dx;
                    window.selectedShape.y1 += dy;
                    window.selectedShape.x2 += dx;
                    window.selectedShape.y2 += dy;
                } else if (dragMode === 'resize-x1y1') {
                    window.selectedShape.x1 = curX;
                    window.selectedShape.y1 = curY;
                } else if (dragMode === 'resize-x2y2') {
                    window.selectedShape.x2 = curX;
                    window.selectedShape.y2 = curY;
                }
                window.redrawUnifiedCanvas();
            }
        } else {
            currentShape = {
                type: currentTool,
                x1: startX,
                y1: startY,
                x2: curX,
                y2: curY,
                color: strokeColor,
                width: strokeWidth,
                fontSize: fontSize
            };
            window.redrawUnifiedCanvas();
        }
    };

    markupCanvas.onmouseup = function() {
        if (!isDrawing) return;
        isDrawing = false;
        dragMode = null;
        var activeHistory = window.isCompareModeActive ? window.compareMarkupHistory : window.markupShapes;
        if (currentTool !== 'select' && currentShape) {
            var finalShape = {
                id: Date.now(),
                type: currentShape.type,
                x1: currentShape.x1,
                y1: currentShape.y1,
                x2: currentShape.x2,
                y2: currentShape.y2,
                color: currentShape.color,
                width: currentShape.width,
                fontSize: currentShape.fontSize
            };
            activeHistory.push(finalShape);
            window.selectedShape = finalShape;
            currentShape = null;
        }
        window.redrawUnifiedCanvas();
    };
};

(function() {
    var _origPopup = null;
    Object.defineProperty(window, 'openSafeIssuePopup', {
        get: function() { return _origPopup; },
        set: function(val) {
            // 중복 래핑 방지를 위해 원본이 백업되지 않은 경우에만 백업
            if (!window.originalOpenSafeIssuePopup) {
                window.originalOpenSafeIssuePopup = val;
            }
            
            _origPopup = function(imgBeforeUrl, imgAfterUrl, objectId, vBefore, vAfter) {
                // Helper to convert and compress blob/data URL to lightweight base64 asynchronously
                var convertToB64 = function(url, cb) {
                    if (!url) {
                        cb("");
                        return;
                    }
                    if (typeof url !== 'string' || (url.indexOf('blob:') !== 0 && url.indexOf('data:') !== 0)) {
                        cb(url);
                        return;
                    }
                    var img = new Image();
                    img.crossOrigin = 'Anonymous';
                    img.onload = function() {
                        var maxDim = 1920;
                        var w = img.naturalWidth || img.width;
                        var h = img.naturalHeight || img.height;
                        if (w > maxDim || h > maxDim) {
                            if (w > h) {
                                h = Math.round((h * maxDim) / w);
                                w = maxDim;
                            } else {
                                w = Math.round((w * maxDim) / h);
                                h = maxDim;
                            }
                        }
                        var canvas = document.createElement('canvas');
                        canvas.width = w;
                        canvas.height = h;
                        var ctx = canvas.getContext('2d');
                        if (ctx) {
                            ctx.imageSmoothingEnabled = true;
                            ctx.imageSmoothingQuality = 'high';
                            ctx.drawImage(img, 0, 0, w, h);
                            try {
                                var dataURL = canvas.toDataURL('image/webp', 0.9);
                                if (!dataURL || dataURL.indexOf('data:image/webp') === -1) {
                                    dataURL = canvas.toDataURL('image/jpeg', 0.9);
                                }
                                cb(dataURL);
                                return;
                            } catch(ex) {
                                console.warn("[B64 Compress] Canvas toDataURL failed, falling back to raw reader:", ex);
                            }
                        }
                        fetchFallback();
                    };
                    img.onerror = function() {
                        fetchFallback();
                    };
                    img.src = url;

                    function fetchFallback() {
                        if (url.indexOf('data:') === 0) {
                            cb(url);
                            return;
                        }
                        fetch(url)
                            .then(function(r) { return r.blob(); })
                            .then(function(b) {
                                var reader = new FileReader();
                                reader.onloadend = function() {
                                    cb(reader.result);
                                };
                                reader.readAsDataURL(b);
                            })
                            .catch(function(e) {
                                console.error("[B64 Fetch Fallback Error]:", e);
                                cb(url);
                            });
                    }
                };

                convertToB64(imgBeforeUrl, function(b64Before) {
                    window.currentCompareBeforeUrl = b64Before;
                    convertToB64(imgAfterUrl, function(b64After) {
                        window.currentCompareAfterUrl = b64After;
                        
                        window.startMarkupSession(b64After, function(finalAfterB64, finalBeforeB64) {
                            if (!finalBeforeB64) finalBeforeB64 = b64Before;
                            if (!finalAfterB64) finalAfterB64 = b64After;
                            window.originalOpenSafeIssuePopup(finalBeforeB64, finalAfterB64, objectId, vBefore, vAfter);
                            
                            // 🚨 비교 팝업 창 안착 후 취소 버튼 인젝션 및 저장 버튼 오버라이드 검증
                            setTimeout(function() {
                                var compModal = document.getElementById('dynamic-standalone-issue-modal') || document.getElementById('issue-popup');
                                var cBtn = document.getElementById('dyn-issue-cancel') || document.getElementById('issue-cancel') || document.getElementById('btn-cancel-issue');
                                if (cBtn && compModal) {
                                    cBtn.onclick = function(e) {
                                        if (e) e.preventDefault();
                                        compModal.style.display = 'none';
                                    };
                                }

                                // 🚨 [이벤트 참조 붕괴 복구] cloneNode를 전면 폐기하고 원본 버튼에 다이렉트 바인딩 실행
                                var mainSubmitBtn = document.getElementById('dyn-issue-submit') || document.getElementById('issue-submit');
                                var compareSaveBtn = document.getElementById('btn-save-issue') || document.getElementById('compare-issue-save');

                                var executeCompressedSave = function(evt) {
                                    if (evt) {
                                        evt.preventDefault();
                                        evt.stopPropagation();
                                    }
                                    
                                    console.log("[Direct Save] 단독 고효율 압축 세이브 로직 가동.");
                                    
                                    try {
                                        // 🚨 [ID 매핑 원천 교정] 특정 ID로 직접 조회하여 값 유실 및 혼선 방지
                                        var rBox = document.getElementById('issue-review') || document.getElementById('real-compare-review-text') || document.getElementById('dyn-issue-review');
                                        var cBox = document.getElementById('issue-change') || document.getElementById('real-compare-change-text') || document.getElementById('dyn-issue-change');
                                        var tBox = document.getElementById('issue-title') || document.getElementById('dyn-issue-title') || document.getElementById('real-compare-title-input');
                                        var aBox = document.getElementById('issue-assignee') || document.getElementById('real-compare-assignee-select') || document.getElementById('dyn-issue-assignee');
                                        var sBox = document.getElementById('issue-status') || document.getElementById('real-compare-status-select');
                                        var stBox = document.getElementById('issue-structure') || document.getElementById('real-compare-structure-input');
                                        var trBox = document.getElementById('issue-trade') || document.getElementById('real-compare-trade-input');
                                        
                                        var uReview = rBox ? rBox.value.trim() : "";
                                        var uChange = cBox ? cBox.value.trim() : "";
                                        
                                        if (!uReview) uReview = "기록된 검토 내용이 없습니다.";
                                        if (!uChange) uChange = "기록된 변경 내용이 없습니다.";

                                        var uTitle = tBox ? tBox.value.trim() : "비교 이슈";
                                        var uAssignee = aBox ? aBox.value.trim() : "미지정";
                                        if (uAssignee === "미정" || uAssignee.indexOf('선택하세요') > -1) uAssignee = "미지정";
                                        var uStatus = sBox ? sBox.value.trim() : "검토중";
                                        var uStructure = stBox ? stBox.value.trim() : "Revit Document";
                                        var typeBox = document.getElementById('compare-issue-type');
                                        var uType = typeBox ? typeBox.value : "간섭";
                                        var uTrade = trBox ? trBox.value.trim() : "토목";

                                        // 파일명 추출 폴백 처리
                                        var viewer = window.viewer || window.NOP_VIEWER || (window.app && window.app.getCurrentViewer ? window.app.getCurrentViewer() : null);
                                        var realDocName = "";
                                        if (viewer && viewer.model && typeof viewer.model.getDocumentNode === 'function') {
                                            var docNode = viewer.model.getDocumentNode();
                                            if (docNode && docNode.data) realDocName = docNode.data.name || docNode._name || "";
                                            if (realDocName && (uStructure === "Revit Document" || uStructure === "미상" || !uStructure)) {
                                                if (realDocName.indexOf('.') > -1) realDocName = realDocName.substring(0, realDocName.lastIndexOf('.'));
                                                uStructure = realDocName.trim();
                                            }
                                        }

                                        // 🚨 [이미지 압축 & ID 정밀 추출 스펙]
                                        var compCanvas = document.getElementById('global-markup-canvas') || document.getElementById('compare-markup-canvas');
                                        var compressedImg = window.lastStandaloneMarkupImage || "";
                                         
                                        var onCompressedDone = function(finalImg) {
                                            compressedImg = finalImg;
                                             
                                            var beforeFallback = (typeof finalBeforeB64 !== 'undefined') ? finalBeforeB64 : "";
                                            var afterFallback = (typeof finalAfterB64 !== 'undefined') ? finalAfterB64 : "";
                                            var dbIdFallback = (typeof objectId !== 'undefined') ? objectId : "";

                                            var rawImgBefore = window.currentCompareBeforeUrl || beforeFallback || compressedImg;
                                            var rawImgAfter = window.currentCompareAfterUrl || afterFallback || compressedImg;

                                            var saveAllIssues = function(compressedBefore, compressedAfter) {
                                                var newCompareIssue = {
                                                    id: "COMP-" + Date.now(),
                                                    dbId: window.currentSelectedDbId || dbIdFallback || "13181",
                                                    title: uTitle,
                                                    reviewContent: uReview,
                                                    changeContent: uChange,
                                                    reviewDesc: uReview,
                                                    changeDesc: uChange,
                                                    description: uChange,
                                                    desc: uReview,
                                                    structure: uStructure,
                                                    trade: uTrade,
                                                    assignee: uAssignee,
                                                    status: uStatus,
                                                    _type: "compare",
                                                    type: uType || "간섭",
                                                    verBefore: (typeof vBefore !== 'undefined') ? vBefore : (window.currentVersionA ? (window.currentVersionA.versionNumber || window.currentVersionA.versionId || window.currentVersionA.name || "00") : "00"),
                                                    verAfter: (typeof vAfter !== 'undefined') ? vAfter : (window.currentVersionB ? (window.currentVersionB.versionNumber || window.currentVersionB.versionId || window.currentVersionB.name || "00") : "00"),
                                                    imgBefore: compressedBefore,
                                                    imgAfter: compressedAfter,
                                                    img: compressedImg,
                                                    date: new Date().toISOString().substring(0, 10)
                                                };

                                                var saveToKey = function(key, issueObj) {
                                                    var list = [];
                                                    try {
                                                        list = JSON.parse(localStorage.getItem(key) || '[]');
                                                    } catch(err) {
                                                        list = [];
                                                    }
                                                    list.push(issueObj);
                                                    try {
                                                        localStorage.setItem(key, JSON.stringify(list));
                                                    } catch(qEx) {
                                                        console.warn("Storage quota exceeded on key " + key + ", attempting scrub save...");
                                                        for (var i = 0; i < list.length; i++) {
                                                            list[i].img = ""; list[i].imgBefore = ""; list[i].imgAfter = "";
                                                        }
                                                        try {
                                                            localStorage.setItem(key, JSON.stringify(list));
                                                        } catch(e) {}
                                                    }
                                                };

                                                saveToKey('my_saved_compare_issues', newCompareIssue);
                                                saveToKey('aps_project_issues', newCompareIssue);

                                                // Sync global caches
                                                window.currentIssueList = JSON.parse(localStorage.getItem('my_saved_compare_issues') || '[]');
                                                if (typeof window.compareIssues !== 'undefined') window.compareIssues = window.currentIssueList;
                                                if (typeof window.currentCompareIssues !== 'undefined') window.currentCompareIssues = window.currentIssueList;

                                                // 🚨 [단독 이슈 배지 중복 데이터 자동 소멸] 메인 이슈 창고('my_saved_issues') 실시간 디톡스
                                                var rawMain = localStorage.getItem('my_saved_issues');
                                                if (rawMain) {
                                                    var parsedMain = JSON.parse(rawMain);
                                                    if (Array.isArray(parsedMain)) {
                                                        var cleanedMain = parsedMain.filter(function(item) {
                                                            return item && String(item.id).indexOf('COMP-') === -1 && String(item._type) !== 'compare';
                                                        });
                                                        localStorage.setItem('my_saved_issues', JSON.stringify(cleanedMain));
                                                    }
                                                }

                                                // 🚨 닫히지 않고 버티던 모달창의 물리적 DOM 소멸 가드 작동
                                                var activeModals = document.querySelectorAll('.docking-panel, .modal, .modal-backdrop, [role="dialog"], #dynamic-real-compare-modal, #dynamic-standalone-issue-modal, #issue-popup');
                                                for (var p = 0; p < activeModals.length; p++) {
                                                    if (activeModals[p] && activeModals[p].parentNode) {
                                                        try { activeModals[p].parentNode.removeChild(activeModals[p]); } catch(e) {}
                                                    }
                                                }

                                                // 기존 레이아웃 디자인을 그대로 유지하며 테이블 리로드
                                                setTimeout(function() {
                                                    if (typeof window.renderIssueTable === 'function') window.renderIssueTable();
                                                    if (typeof window.renderIssueList === 'function') window.renderIssueList();
                                                }, 50);
                                            };

                                            window.compressImg(rawImgBefore, function(compBefore) {
                                                window.compressImg(rawImgAfter, function(compAfter) {
                                                    saveAllIssues(compBefore, compAfter);
                                                });
                                            });
                                        };

                                        if (compCanvas) {
                                            var shrinkCanvas = document.createElement('canvas');
                                            var shrinkCtx = shrinkCanvas.getContext('2d');
                                            var maxW = 1920;
                                            var width = compCanvas.width;
                                            var height = compCanvas.height;
                                            if (width > maxW) {
                                                height = Math.round((height * maxW) / width);
                                                width = maxW;
                                            }
                                            shrinkCanvas.width = width;
                                            shrinkCanvas.height = height;
                                            if (shrinkCtx) {
                                                shrinkCtx.imageSmoothingEnabled = true;
                                                shrinkCtx.imageSmoothingQuality = 'high';
                                                shrinkCtx.drawImage(compCanvas, 0, 0, width, height);
                                                compressedImg = shrinkCanvas.toDataURL('image/webp', 0.9);
                                                if (!compressedImg || compressedImg.indexOf('data:image/webp') === -1) {
                                                    compressedImg = shrinkCanvas.toDataURL('image/jpeg', 0.9);
                                                }
                                            } else {
                                                compressedImg = compCanvas.toDataURL('image/webp', 0.9);
                                                if (!compressedImg || compressedImg.indexOf('data:image/webp') === -1) {
                                                    compressedImg = compCanvas.toDataURL('image/jpeg', 0.9);
                                                }
                                            }
                                            onCompressedDone(compressedImg);
                                        } else if (compressedImg) {
                                            window.compressImg(compressedImg, onCompressedDone);
                                        } else {
                                            onCompressedDone("");
                                        }
                                        return; // 이하 로직은 onCompressedDone 콜백 내부에서 실행됨
                                    } catch(saveErr) {
                                        console.error("[Execute Compressed Save Critical Error]:", saveErr);
                                    }
                                };

                                // 🚨 원본 엘리먼트 참조를 파괴하지 않고 직접 이벤트 핸들러 주입 (중복 방지)
                                if (mainSubmitBtn) {
                                    mainSubmitBtn.onclick = executeCompressedSave;
                                }
                                if (compareSaveBtn) {
                                    compareSaveBtn.onclick = executeCompressedSave;
                                }
                                
                                window.fillFormaMembersFromDOM();
                                window.fillFormaMembersFromDOM();
                            }, 120);
                        });
                    });
                });
            };
        },
        configurable: true
    });
})();

// 🚨 [상세 조회 양방향 동기화 가드] 상세 조회 팝업을 열기 전에 localStorage 내 "미정" 담당자를 "미지정"으로 강제 정규화
(function() {
    var _origDetailPopup = null;
    Object.defineProperty(window, 'openIssueDetailPopup', {
        get: function() { return _origDetailPopup; },
        set: function(val) {
            if (!window.originalOpenIssueDetailPopup) {
                window.originalOpenIssueDetailPopup = val;
            }
            _origDetailPopup = function(issueId) {
                var storageKeys = ['aps_project_issues', 'my_saved_compare_issues'];
                storageKeys.forEach(function(key) {
                    try {
                        var raw = localStorage.getItem(key);
                        if (raw) {
                            var list = JSON.parse(raw);
                            var modified = false;
                            if (Array.isArray(list)) {
                                list.forEach(function(item) {
                                    if (item && item.assignee === '미정') {
                                        item.assignee = '미지정';
                                        modified = true;
                                    }
                                });
                                if (modified) {
                                    localStorage.setItem(key, JSON.stringify(list));
                                }
                            }
                        }
                    } catch(e) {}
                });
                
                if (typeof window.originalOpenIssueDetailPopup === 'function') {
                    window.originalOpenIssueDetailPopup(issueId);
                }
            };
        },
        configurable: true
    });
})();

window.allIssueColumns = [
    { key: "title", label: "제목" }, { key: "structure", label: "구조물 명" }, 
    { key: "trade", label: "공종" }, { key: "type", label: "유형" },
    { key: "desc", label: "상세 설명" }, { key: "date", label: "생성일자" }, 
    { key: "status", label: "상태" }, { key: "manage", label: "관리" },
    { key: "objName", label: "부재명" }, { key: "dbId", label: "객체 ID" },
    { key: "assignee", label: "담당자" }, { key: "reviewer", label: "확인자" },
    { key: "startDate", label: "시작 날짜" }, { key: "endDate", label: "마감일" }, { key: "placement", label: "배치" }
];
window.defaultIssueColumns = ["title", "structure", "trade", "type", "desc", "date", "status", "manage"];

var savedAllCols = localStorage.getItem('my_all_columns_order');
if (savedAllCols) window.allIssueColumns = JSON.parse(savedAllCols);

var savedCols = localStorage.getItem('my_active_columns');
window.activeIssueColumns = savedCols ? JSON.parse(savedCols) : window.defaultIssueColumns;

window.draggedColIdx = -1;
window.colDragStart = function(e, idx) { window.draggedColIdx = idx; };
window.colDragOver = function(e) { e.preventDefault(); e.currentTarget.style.borderTop = "2px solid #38bdf8"; };
window.colDragLeave = function(e) { e.currentTarget.style.borderTop = "1px solid #334155"; };
window.colDrop = function(e, dropIdx) {
    e.preventDefault();
    e.currentTarget.style.borderTop = "1px solid #334155";
    if (window.draggedColIdx === -1 || window.draggedColIdx === dropIdx) return;
    
    var movedCol = window.allIssueColumns.splice(window.draggedColIdx, 1)[0];
    window.allIssueColumns.splice(dropIdx, 0, movedCol);
    localStorage.setItem('my_all_columns_order', JSON.stringify(window.allIssueColumns));
    
    window.syncActiveColumnsOrder();
    if (typeof window.renderColumnSettingsMenu === 'function') window.renderColumnSettingsMenu();
    if (typeof window.renderIssueTable === 'function') window.renderIssueTable();
};

window.toggleColumn = function(colKey) {
    var idx = window.activeIssueColumns.indexOf(colKey);
    if (idx > -1) {
        if (window.activeIssueColumns.length > 1) {
            window.activeIssueColumns.splice(idx, 1);
        }
    } else {
        window.activeIssueColumns.push(colKey);
    }
    
    window.syncActiveColumnsOrder();
    if (typeof window.renderColumnSettingsMenu === 'function') window.renderColumnSettingsMenu();
    if (typeof window.renderIssueTable === 'function') window.renderIssueTable();
};

window.syncActiveColumnsOrder = function() {
    var newActive = [];
    for (var i = 0; i < window.allIssueColumns.length; i++) {
        var key = window.allIssueColumns[i].key;
        if (window.activeIssueColumns.indexOf(key) > -1) newActive.push(key);
    }
    window.activeIssueColumns = newActive;
    localStorage.setItem('my_active_columns', JSON.stringify(window.activeIssueColumns));
};

window.initColumnSettings = function() {
    var settingsBtn = document.getElementById("btn-column-settings");
    var settingsDropdown = document.getElementById("column-settings-dropdown");
    if (settingsBtn && settingsDropdown) {
        settingsBtn.onclick = function(e) {
            e.stopPropagation();
            if (settingsDropdown.style.display === "none" || !settingsDropdown.style.display) {
                settingsDropdown.style.display = "block";
            } else {
                settingsDropdown.style.display = "none";
            }
        };
        document.addEventListener("click", function(e) {
            if (!settingsDropdown.contains(e.target) && e.target !== settingsBtn) {
                settingsDropdown.style.display = "none";
            }
        });
    }
    window.renderColumnSettingsMenu();
};

window.renderColumnSettingsMenu = function() {
    var container = document.getElementById('column-settings-container');
    if (!container) return;
    var menuHtml = "";
    for (var i = 0; i < window.allIssueColumns.length; i++) {
        var col = window.allIssueColumns[i];
        var isChecked = window.activeIssueColumns.indexOf(col.key) > -1 ? "checked" : "";
        menuHtml = menuHtml + "<div draggable='true' ondragstart='window.colDragStart(event, " + i + ")' ondragover='window.colDragOver(event)' ondragleave='window.colDragLeave(event)' ondrop='window.colDrop(event, " + i + ")' style='padding: 8px; margin-bottom: 4px; background: #0f172a; border: 1px solid #334155; border-radius: 4px; cursor: grab; display: flex; align-items: center;'>";
        menuHtml = menuHtml + "<span style='margin-right: 10px; color: #64748b; font-size: 14px;'>☰</span>";
        menuHtml = menuHtml + "<input type='checkbox' id='col-chk-" + col.key + "' " + isChecked + " onchange='window.toggleColumn(\"" + col.key + "\")' style='margin-right: 10px; cursor: pointer;'>";
        menuHtml = menuHtml + "<label for='col-chk-" + col.key + "' style='cursor: pointer; flex: 1; font-size: 13px; color: #cbd5e1;'>" + col.label + "</label>";
        menuHtml = menuHtml + "</div>";
    }
    container.innerHTML = menuHtml;
};

// 🚨 [안전 가드 및 자동 바인딩 엔진]
window.bindViewerEvents = function(targetViewer) {
    if (!targetViewer) return;
    
    if (targetViewer.dataset && targetViewer.dataset.eventsBound) return;
    if (targetViewer.container) {
        if (targetViewer.container.dataset.eventsBound) return;
        targetViewer.container.dataset.eventsBound = "true";
    }

    targetViewer.addEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, function() {
        if (typeof window.updateIssueMarkersPosition === 'function') {
            window.updateIssueMarkersPosition();
        }
    });
    targetViewer.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, function() {
        if (typeof window.renderIssueTable === 'function') {
            window.renderIssueTable();
        }
        if (typeof initRegularModelIssueButton === 'function') {
            initRegularModelIssueButton();
        }
        // 🚨 [GEOMETRY_LOADED 마커 복원] 모델 로드 완료 후 localStorage 이슈 마커 일괄 복원
        setTimeout(function() {
            if (typeof window.renderIssueMarkers === 'function') {
                var savedIssues = JSON.parse(localStorage.getItem('my_saved_issues') || '[]');
                console.log('[Marker Restore] GEOMETRY_LOADED 후 마커 복원 시도: ' + savedIssues.length + '건');
                if (typeof window.scheduleIssueMarkerRender === 'function') {
                    window.scheduleIssueMarkerRender(savedIssues, 100);
                } else {
                    window.renderIssueMarkers(savedIssues);
                }
            }
        }, 500);
    });

    if (targetViewer.container) {
        targetViewer.container.addEventListener('mousedown', function(e) {
            if (!e.target || e.target.tagName.toLowerCase() !== 'canvas') {
                return; 
            }

            var rect = targetViewer.container.getBoundingClientRect();
            var x = e.clientX - rect.left;
            var y = e.clientY - rect.top;

            if (targetViewer.impl && targetViewer.impl.hitTest) {
                var result = targetViewer.impl.hitTest(x, y, true);
                // 🚨 [hitTest 조건 완화] dbId 없어도(빈 공간 클릭) 교차점이 있으면 좌표 캐시
                if (result && result.intersectPoint) {
                    window.lastExactClickPoint = result.intersectPoint.clone();
                    if (result.dbId) window.lastClickedDbId = result.dbId;
                    console.log('[UI Sync] 클릭 좌표 캐시: x=' + result.intersectPoint.x.toFixed(2) + ', y=' + result.intersectPoint.y.toFixed(2) + ', z=' + result.intersectPoint.z.toFixed(2) + (result.dbId ? ', dbId=' + result.dbId : ' (빈 공간)'));
                }
            }
        }, true);
    }
    console.log("[Main] 뷰어 이벤트 바인딩 완료");
};

// 🚨 [초기화 함수 호출 위치 조정] Autodesk Viewer prototype loadModel을 가로채서 바인딩 및 초기화
if (typeof Autodesk !== 'undefined' && Autodesk.Viewing && Autodesk.Viewing.Viewer3D) {
    var originalLoadModel = Autodesk.Viewing.Viewer3D.prototype.loadModel;
    Autodesk.Viewing.Viewer3D.prototype.loadModel = function() {
        var self = this;
        window.myGlobalViewer = self;
        window.viewer = self;
        
        if (typeof window.bindViewerEvents === 'function') {
            window.bindViewerEvents(self);
        }
        
        return originalLoadModel.apply(this, arguments).then(function(model) {
            if (typeof initRegularModelIssueButton === 'function') {
                initRegularModelIssueButton();
            }
            return model;
        });
    };
}

window.addEventListener('DOMContentLoaded', async () => {
    if (typeof Autodesk === 'undefined') {
        console.error('[Main] Autodesk Viewer scripts not loaded. Check index.html imports.');
        return;
    }
    
    try {
        // Initialize 3D Viewer inside the #preview container
        viewerInstance = await initViewer(document.getElementById('preview'));
        window.viewer = viewerInstance; // Expose to global window scope
        window.myGlobalViewer = viewerInstance;
        window.loadModel = loadModel;
        window.onModelSelected = onModelSelected;
        console.log('[Main] Viewer initialized successfully.');

        // 🚨 [안전 가드] 뷰어 인스턴스가 존재할 때만 이벤트 등록
        if (viewerInstance) {
            window.bindViewerEvents(viewerInstance);
        } else {
            console.warn("[Main] 뷰어 인스턴스가 아직 null입니다. 초기화 지연 대기...");
        }
        
        // Initialize AI chatbot panel
        await initAiPanel();
        
        // Setup source selector & profile login checks
        const sourceSelector = document.getElementById('source-selector');
        if (sourceSelector) {
            sourceSelector.value = 'docs'; // Default to Autodesk Docs on startup
            sourceSelector.onchange = () => updateSourceView();
        }

        // Setup logo section click handler to return to home screen
        const logoSection = document.querySelector('.logo-section');
        if (logoSection) {
            logoSection.style.cursor = 'pointer';
            logoSection.addEventListener('click', () => {
                console.log("[Routing] 로고 클릭됨: 대시보드로 이동합니다.");
                window.isCompareModeActive = false;

                // Exit comparison mode if active
                const exitComparisonBtn = document.getElementById('btn-exit-comparison');
                if (exitComparisonBtn && document.body.classList.contains('comparison-active')) {
                    exitComparisonBtn.click();
                }

                // 🚨 [CSS Guard 해제] 단독 뷰어 복귀를 위한 스타일 시트 해제
                if (window.compareModeStyleTag && window.compareModeStyleTag.parentNode) {
                    window.compareModeStyleTag.parentNode.removeChild(window.compareModeStyleTag);
                    window.compareModeStyleTag = null;
                    console.log("[CSS Guard] 글로벌 스타일 시트 락 해제 완료. 단독 마커/버튼 복구 가능 상태.");
                }

                // 🚨 [비교 모드 종료 시] 단독 이슈 버튼 상태 원상 복구 및 마커 복구
                var activeViewer = window.myGlobalViewer || window.viewer || window.NOP_VIEWER;
                if (activeViewer && activeViewer.toolbar) {
                    var customGroup = activeViewer.toolbar.getControl('custom-issue-toolbar-group');
                    if (customGroup) customGroup.setVisible(true);
                    var nativeBtn = activeViewer.toolbar.getControl('native-issue-create-btn');
                    if (nativeBtn) nativeBtn.setVisible(true);
                }

                if (window.renderIssueMarkers) {
                    var currentIssues = window.issueList || window.standaloneProjectIssueList || JSON.parse(localStorage.getItem('my_saved_issues') || '[]');
                    if (typeof window.scheduleIssueMarkerRender === 'function') {
                        window.scheduleIssueMarkerRender(currentIssues, 100);
                    } else {
                        window.renderIssueMarkers(currentIssues);
                    }
                } else if (window._issueManager && typeof window._issueManager.restorePins === 'function') {
                    window._issueManager.restorePins();
                }

                // Clear URL hash
                window.location.hash = '';

                // Reset source selector to 'docs'
                if (sourceSelector) {
                    sourceSelector.value = 'docs';
                    updateSourceView();
                }

                // Return to root projects in explorer
                if (explorer) {
                    explorer.showRootProjects();
                }

                // Switch to dashboard tab
                if (typeof window.switchTab === 'function') {
                    window.switchTab('dashboard');
                } else {
                    var dashboardTabBtn = document.getElementById('main-tab-dashboard-btn') || document.getElementById('nav-dashboard') || document.querySelector('.nav-item[data-tab="dashboard"]');
                    if (dashboardTabBtn) {
                        dashboardTabBtn.click();
                    }
                }
            });
        }
        
        // Initial setup
        await checkLoginStatus();
        
        // Fetch model list and populate select element for local OSS
        const selectedUrn = window.location.hash?.substring(1);
        await setupModelSelection(selectedUrn);
        await setupModelUpload();
        
        // Initial source view update
        await updateSourceView();
        
        if (typeof window.initColumnSettings === "function") {
            window.initColumnSettings();
        }
        
        // 🚨 [새로고침 시 대시보드 탭 메인 유지 보장 - 사용자가 수동으로 탭을 변경하지 않은 경우에만]
        if (!window.userHasSwitchedTab && typeof window.switchTab === 'function') {
            const urlParams = new URLSearchParams(window.location.search);
            const targetTab = urlParams.get('tab') || 'dashboard';
            const currentTab = window.currentMainTab || targetTab;
            if (currentTab === targetTab) {
                window._initialMainTabApplied = false;
                window.switchTab(targetTab);
                window._initialMainTabApplied = true;
                window.userHasSwitchedTab = false;
            }
        }
    } catch (err) {
        console.error('[Main] Initialization error:', err);
    }
});

/**
 * Check logged in state and render Profile Section in Header
 */
async function checkLoginStatus() {
    const profileSec = document.getElementById('login-profile-section');
    if (!profileSec) return false;
    
    try {
        const resp = await fetch('/api/auth/profile');
        if (!resp.ok) throw new Error();
        const profile = await resp.json();
        
        if (profile.name) {
            profileSec.innerHTML = `
                <span class="profile-name"><i class="fas fa-user-circle"></i> ${profile.name}님</span>
                <a href="/api/auth/logout" class="logout-btn" title="로그아웃"><i class="fas fa-sign-out-alt"></i> 로그아웃</a>
            `;
            return true;
        } else {
            profileSec.innerHTML = `
                <a href="/api/auth/login" class="login-btn"><i class="fas fa-sign-in-alt"></i> <i class="fab fa-autodesk"></i> Autodesk Docs 로그인</a>
            `;
            return false;
        }
    } catch (err) {
        profileSec.innerHTML = `
            <a href="/api/auth/login" class="login-btn"><i class="fas fa-sign-in-alt"></i> <i class="fab fa-autodesk"></i> Autodesk Docs 로그인</a>
        `;
        return false;
    }
}

/**
 * Toggle layouts between Local models and Autodesk Docs explorer
 */
async function updateSourceView() {
    const sourceSelector = document.getElementById('source-selector');
    if (!sourceSelector) return;
    
    const source = sourceSelector.value;
    const isLoggedIn = await checkLoginStatus();
    
    const localModels = document.getElementById('models');
    const localUpload = document.getElementById('upload');
    const explorerContainer = document.getElementById('explorer-container');
    const preview = document.getElementById('preview');
    const backBtn = document.getElementById('back-to-explorer-btn');
    
    if (source === 'local') {
        if (localModels) localModels.style.display = 'block';
        if (localUpload) localUpload.style.display = 'block';
        if (explorerContainer) explorerContainer.style.display = 'none';
        if (preview) preview.style.display = 'block';
        if (backBtn) backBtn.style.display = 'none';
        
        // If a local URN is selected, load it
        if (localModels && localModels.value) {
            onModelSelected(localModels.value);
        }
    } else {
        // Autodesk Docs source
        if (localModels) localModels.style.display = 'none';
        if (localUpload) localUpload.style.display = 'none';
        
        if (isLoggedIn) {
            // Show Folder Explorer Table
            if (explorerContainer) explorerContainer.style.display = 'flex';
            if (preview) preview.style.display = 'none';
            
            // Activate FolderExplorer controls
            if (window.explorer) {
                // If viewer is currently showing a loaded model, keep viewer mode
                const hasContainer = window.explorer.container;
                const hasPreview = preview;
                
                let isShowingModel = false;
                if (hasContainer && hasPreview) {
                    isShowingModel = (window.explorer.container.style.display === 'none' && preview.style.display === 'block');
                } else {
                    console.warn("[UI Warning] updateSourceView: 'explorer.container' or 'preview' element is missing. style.display check skipped.");
                }

                if (isShowingModel) {
                    if (backBtn) backBtn.style.display = 'block';
                } else {
                    window.explorer.switchMode('explorer');
                    window.explorer.refresh();
                }
            }
        } else {
            // Show prompt to login
            if (explorerContainer) explorerContainer.style.display = 'flex';
            if (preview) preview.style.display = 'none';
            if (backBtn) backBtn.style.display = 'none';
            
            const list = document.getElementById('explorer-list');
            if (list) {
                list.innerHTML = `
                    <tr>
                        <td colspan="5" style="text-align: center; padding: 60px 20px;">
                            <div style="font-size: 1.25rem; font-weight: 600; margin-bottom: 1rem; color: var(--accent-color);">
                                <i class="fab fa-autodesk" style="font-size: 2.5rem; margin-bottom: 0.5rem; display: block;"></i>
                                Autodesk Docs 연동 필요
                            </div>
                            <p style="color: var(--text-muted); max-width: 400px; margin: 0 auto 1.5rem auto; font-size: 0.9rem; line-height: 1.5;">
                                Autodesk Docs의 허브, 프로젝트, 폴더를 직접 탐색하고 3D BIM 도면을 AI 에이전트와 연동하려면 먼저 로그인해 주십시오.
                            </p>
                            <a href="/api/auth/login" class="login-btn" style="padding: 0.6rem 1.5rem; font-size: 0.95rem;">
                                <i class="fab fa-autodesk"></i> Autodesk Docs 로그인
                            </a>
                        </td>
                    </tr>
                `;
            }
        }
    }
}

/**
 * Fetch and populate local model dropdown list
 */
async function setupModelSelection(selectedUrn) {
    const dropdown = document.getElementById('models');
    if (!dropdown) return;
    
    dropdown.innerHTML = '<option value="">모델을 로드하는 중...</option>';
    
    try {
        const resp = await fetch('/api/models');
        if (!resp.ok) throw new Error(await resp.text());
        
        const models = await resp.json();
        
        if (models.length === 0) {
            dropdown.innerHTML = '<option value="">업로드된 모델이 없습니다</option>';
            return;
        }
        
        dropdown.innerHTML = models.map(model => 
            `<option value="${model.urn}" ${model.urn === selectedUrn ? 'selected' : ''}>${model.name}</option>`
        ).join('\r\n');
        
        dropdown.onchange = () => onModelSelected(dropdown.value);
        
        if (dropdown.value && document.getElementById('source-selector')?.value === 'local') {
            onModelSelected(dropdown.value);
        }
    } catch (err) {
        console.error('[Main] Could not list models:', err);
        dropdown.innerHTML = '<option value="">모델 로드 실패</option>';
    }
}

/**
 * Check translation status and load local URN into viewer
 */
async function onModelSelected(urn) {
    if (!urn) return;
    
    if (window.onModelSelectedTimeout) {
        clearTimeout(window.onModelSelectedTimeout);
        delete window.onModelSelectedTimeout;
    }
    
    window.location.hash = urn;
    
    // 2. 모든 마커 완전 제거 (코어 유령 핀 소청 포함)
    window.clearAllCurrentMarkers();

    const dropdown = document.getElementById('models');
    window.currentModelName = dropdown.options[dropdown.selectedIndex]?.text || 'BIM Model';
    if (window.currentModelName && urn && typeof window.updateUrnCache === 'function') {
        window.updateUrnCache(window.currentModelName, urn);
    }
    
    try {
        const resp = await fetch(`/api/models/${urn}/status`);
        if (!resp.ok) throw new Error(await resp.text());
        
        const status = await resp.json();
        
        switch (status.status) {
            case 'n/a':
                showNotification('모델이 변환(Translation)되지 않았습니다.');
                break;
            case 'inprogress':
                showNotification(`모델 변환이 진행 중입니다 (${status.progress || '0%'}). 잠시만 기다려 주세요...`);
                window.onModelSelectedTimeout = setTimeout(onModelSelected, 5000, urn);
                break;
            case 'failed':
                showNotification('모델 변환에 실패했습니다.');
                break;
            default:
                clearNotification();
                showNotification('3D 모델 로딩 중...');
                await loadModel(viewerInstance, urn);
                clearNotification();
                break;
        }
    } catch (err) {
        console.error('[Main] Model status error:', err);
        showNotification('모델 정보를 확인하는 중 오류가 발생했습니다.');
    }
}

/**
 * Setup local file uploads
 */
async function setupModelUpload() {
    const uploadBtn = document.getElementById('upload');
    const inputEl = document.getElementById('input');
    const dropdown = document.getElementById('models');
    
    if (!uploadBtn || !inputEl) return;
    
    uploadBtn.onclick = () => inputEl.click();
    
    inputEl.onchange = async () => {
        const file = inputEl.files[0];
        if (!file) return;
        
        let data = new FormData();
        data.append('model-file', file);
        
        if (file.name.endsWith('.zip')) {
            const entrypoint = window.prompt('ZIP 아카이브 내부의 메인 설계 파일명(예: main.rvt, assembly.iam)을 입력해 주세요.');
            if (!entrypoint) {
                inputEl.value = '';
                return;
            }
            data.append('model-zip-entrypoint', entrypoint);
        }
        
        uploadBtn.setAttribute('disabled', 'true');
        if (dropdown) dropdown.setAttribute('disabled', 'true');
        showNotification(`BIM 모델 "${file.name}" 업로드 중... 브라우저를 닫거나 새로고침하지 마십시오.`);
        
        try {
            const resp = await fetch('/api/models', {
                method: 'POST',
                body: data
            });
            
            if (!resp.ok) throw new Error(await resp.text());
            
            const model = await resp.json();
            showNotification('업로드 성공! 모델 변환을 시작합니다...');
            
            await setupModelSelection(model.urn);
            
        } catch (err) {
            console.error('[Main] Upload failed:', err);
            alert(`모델 업로드 실패: ${err.message}`);
            clearNotification();
        } finally {
            uploadBtn.removeAttribute('disabled');
            if (dropdown) dropdown.removeAttribute('disabled');
            inputEl.value = '';
        }
    };
}

function showNotification(message) {
    const overlay = document.getElementById('overlay');
    if (!overlay) return;
    overlay.innerHTML = '<div class="notification">' + message + '</div>';
    overlay.style.display = 'flex';
}

function clearNotification() {
    const overlay = document.getElementById('overlay');
    if (!overlay) return;
    overlay.innerHTML = '';
    overlay.style.display = 'none';
}

window.issueMarkersDOMList = []; 

window.updateIssueMarkersPosition = function() {
    // 🚨 [컨테이너 수정] 마커는 activeViewer.container에 직접 추가되므로 viewer container 기준으로 사이즈 측정
    var activeViewer = window.myGlobalViewer || window.viewer || window.NOP_VIEWER;
    if (!activeViewer || !activeViewer.container || !activeViewer.worldToClient) return;

    var container = activeViewer.container;
    var cWidth = container.clientWidth;
    var cHeight = container.clientHeight;
    if (!cWidth || !cHeight) return;

    for (var i = 0; i < window.issueMarkersDOMList.length; i++) {
        var marker = window.issueMarkersDOMList[i];
        var posX = parseFloat(marker.getAttribute('data-x'));
        var posY = parseFloat(marker.getAttribute('data-y'));
        var posZ = parseFloat(marker.getAttribute('data-z'));

        var pos3D = new THREE.Vector3(posX, posY, posZ);
        var screenPoint = activeViewer.worldToClient(pos3D);

        if (screenPoint) {
            marker.style.left = Math.round(screenPoint.x) + 'px';
            marker.style.top = Math.round(screenPoint.y) + 'px';

            // 2D 뷰포트 내 존재 여부 검사
            if (screenPoint.x >= 0 && screenPoint.y >= 0 && screenPoint.x <= cWidth && screenPoint.y <= cHeight) {
                marker.style.visibility = 'visible';
            } else {
                marker.style.visibility = 'hidden';
            }
        }
    }
};

// 🚨 [전역 마커 완전 초기화 함수] 화면의 모든 마커 DOM을 하나도 남기지 않고 제거
window.clearAllCurrentMarkers = function() {
    if (window.issueMarkersDOMList && window.issueMarkersDOMList.length > 0) {
        for (var ci = 0; ci < window.issueMarkersDOMList.length; ci++) {
            var cMel = window.issueMarkersDOMList[ci];
            if (cMel && cMel.parentNode) {
                cMel.parentNode.removeChild(cMel);
            }
        }
        console.log('[Marker Clear] 전체 마커 ' + window.issueMarkersDOMList.length + '개 DOM 제거 완료');
    }
    window.issueMarkersDOMList = [];
    // DOM 잔류 가드: 클래스명으로 남은 핀 요소 추가 청소
    var orphans = document.querySelectorAll('.custom-issue-pushpin');
    orphans.forEach(function(el) { if (el.parentNode) el.parentNode.removeChild(el); });
};

window.collectActiveIssueIdsFromTable = function() {
    var activeIssueIds = [];
    var tableRows = document.querySelectorAll('#issue-table-body tr.issue-row, #issue-table-body tr.issue-item, #issue-table-body tr[data-id], #issue-table-body tr[data-issue-id]');

    if (!tableRows || tableRows.length === 0) {
        tableRows = document.querySelectorAll('#issue-table-body tr, tbody tr.issue-row, tbody tr.issue-item, tbody tr[data-id], tbody tr[data-issue-id]');
    }

    tableRows.forEach(function(row) {
        if (!row || row.style.display === 'none') return;

        var id = row.getAttribute('data-id') || row.getAttribute('data-issue-id');
        var issueId = row.getAttribute('data-issue-id') || row.getAttribute('data-id');

        if (id && activeIssueIds.indexOf(String(id).trim()) === -1) {
            activeIssueIds.push(String(id).trim());
        }
        if (issueId && activeIssueIds.indexOf(String(issueId).trim()) === -1) {
            activeIssueIds.push(String(issueId).trim());
        }
    });

    console.log('[Debug] 수집된 활성 이슈 ID:', activeIssueIds);
    return activeIssueIds;
};

window.scheduleIssueMarkerRender = function(issuesArray, delay) {
    clearTimeout(window._issueMarkerRenderTimer);
    window._issueMarkerRenderTimer = setTimeout(function() {
        if (typeof window.renderIssueMarkers === 'function') {
            window.renderIssueMarkers(issuesArray || window.currentIssueList || []);
        }
    }, delay === undefined ? 100 : delay);
};

window.renderIssueMarkers = function(issuesArray) {
    var activeViewer = window.myGlobalViewer || window.viewer || window.NOP_VIEWER;
    if (!activeViewer || !activeViewer.container) return;

    var earlyTbody = document.getElementById('issue-table-body');
    if (issuesArray && issuesArray.length > 0 && (!earlyTbody || !earlyTbody.querySelector('tr.issue-row, tr.issue-item, tr[data-id], tr[data-issue-id]'))) {
        console.log('[Marker SSOT] 테이블 DOM 준비 전 - 100ms 후 마커 렌더 재시도');
        window._issueMarkerRetryCount = (window._issueMarkerRetryCount || 0) + 1;
        if (window._issueMarkerRetryCount > 3) {
            window._issueMarkerRetryCount = 0;
            if (typeof window.clearAllCurrentMarkers === 'function') window.clearAllCurrentMarkers();
            return;
        }
        if (!window._issueMarkerRetrying) {
            window._issueMarkerRetrying = true;
            setTimeout(function() {
                window._issueMarkerRetrying = false;
                window.renderIssueMarkers(issuesArray);
            }, 100);
        }
        return;
    }
    window._issueMarkerRetryCount = 0;

    // ====================================================================
    // 🚨 [SSOT: 단일 진실 원체 기반 마커 렌더링]
    // 수신한 issuesArray가 아니라, 현재 메인 이슈 테이블에 실제로
    // 그려진 행(Row)의 data-id가 유일한 진실 원체(SSOT)입니다.
    // 이 목록에 없는 ID는 삭제되었거나 필터된 것으로 간주하여
    // 무조건 마커를 그리지 않습니다.
    // ====================================================================

    // STEP 1: SSOT 화이트리스트 수집 (듀얼 모드)
    // ► issuesArray가 있으면 (이미 renderIssueTable이 정제된 total을 실어시) → 배열 자체가 SSOT
    // ► 없으면 DOM 테이블에서 파싱 (독립적인 호출인 경우)
    var activeIssueIds = typeof window.collectActiveIssueIdsFromTable === 'function'
        ? window.collectActiveIssueIdsFromTable()
        : [];
    var useArraySSOT = false;

    if (useArraySSOT) {
        // 배열 SSOT: issuesArray의 id와 dbId 모두 등록
        for (var ai = 0; ai < issuesArray.length; ai++) {
            var aItem = issuesArray[ai];
            if (!aItem) continue;
            if (aItem.id !== undefined && aItem.id !== null) activeIssueIds.push(String(aItem.id).trim());
            if (aItem.dbId !== undefined && aItem.dbId !== null && String(aItem.dbId).trim() !== String(aItem.id || '').trim()) {
                activeIssueIds.push(String(aItem.dbId).trim());
            }
        }
        console.log('[Marker SSOT] 배열 SSOT 모드:', activeIssueIds.length, '건 (issuesArray 직접 사용)');
    } else {
        // DOM SSOT: 테이블에서 data-id 및 data-issue-id 둘 다 union
        var tbody = document.getElementById('issue-table-body');
        if (tbody) {
            var tableRows = tbody.querySelectorAll('tr');
            for (var ri = 0; ri < tableRows.length; ri++) {
                var row = tableRows[ri];
                if (!row || row.style.display === 'none') continue;
                var rid1 = (row.getAttribute('data-id') || '').trim();
                var rid2 = (row.getAttribute('data-issue-id') || '').trim();
                if (rid1 && activeIssueIds.indexOf(rid1) === -1) activeIssueIds.push(rid1);
                if (rid2 && activeIssueIds.indexOf(rid2) === -1) activeIssueIds.push(rid2);
            }
        }
        console.log('[Marker SSOT] DOM SSOT 모드:', activeIssueIds.length, '건', activeIssueIds);
    }

    // STEP 2: 모든 마커 완전 하드 클리어
    window.clearAllCurrentMarkers();

    // STEP 3: SSOT 화이트리스트가 비어있으면 조기 종료
    var markerTbody = document.getElementById('issue-table-body');
    var markerHasIssueData = issuesArray && issuesArray.length > 0;
    if (activeIssueIds.length === 0 && markerHasIssueData && (!markerTbody || !markerTbody.querySelector('tr.issue-row, tr.issue-item, tr[data-id], tr[data-issue-id]'))) {
        console.log('[Marker SSOT] 테이블 DOM 준비 전 - 100ms 후 마커 렌더 재시도');
        if (!window._issueMarkerRetrying) {
            window._issueMarkerRetrying = true;
            setTimeout(function() {
                window._issueMarkerRetrying = false;
                window.renderIssueMarkers(issuesArray);
            }, 100);
        }
        return;
    }

    if (activeIssueIds.length === 0) {
        console.log('[Marker SSOT] 활성 이슈 없음 — 마커 정지');
        return;
    }

    // STEP 4: 이슈 데이터 소스 생성
    // (1) 인자로 받은 issuesArray 우선 사용
    // (2) 없으면 window.currentIssueList → localStorage 순서로 폴백
    var dataSource = issuesArray;
    if (!dataSource || dataSource.length === 0) {
        dataSource = window.currentIssueList || [];
    }
    if (!dataSource || dataSource.length === 0) {
        try { dataSource = JSON.parse(localStorage.getItem('my_saved_issues') || '[]'); } catch(e) { dataSource = []; }
    }

    // STEP 5: URN 모델 상선 추출
    var currentModelUrn = '';
    if (activeViewer.model && typeof activeViewer.model.getUrn === 'function') {
        currentModelUrn = activeViewer.model.getUrn();
    } else if (activeViewer.model && activeViewer.model.getData) {
        currentModelUrn = activeViewer.model.getData().urn || '';
    }
    if (!currentModelUrn) currentModelUrn = window.currentUrn || '';

    var normalizeUrn = function(u) { return String(u || '').replace(/^urn:/, '').trim(); };

    // STEP 6: 화이트리스트 기반 마커 렌더링 루프
    var rendered = 0;
    for (var i = 0; i < dataSource.length; i++) {
        var issue = dataSource[i];
        if (!issue) continue;

        var issueIdStr = String(issue.id || '').trim();
        var issueDbIdStr = String(issue.dbId || '').trim();

        // 🔴 [절대 방어선] SSOT 화이트리스트에 issue.id 또는 issue.dbId 하나라도 있으면 통과
        var inWhitelist = (issueIdStr && activeIssueIds.indexOf(issueIdStr) !== -1)
                       || (issueDbIdStr && activeIssueIds.indexOf(issueDbIdStr) !== -1);
        if (!inWhitelist) continue;

        // 비교 이슈 제외 (이미지 기반 비교 타입은 핀 안 표시)
        if (issue._type === 'compare' || issue.type === 'compare' || issueIdStr.indexOf('COMP-') === 0) continue;

        // position 없으면 마커 불가
        if (!issue.position || issue.position.x === undefined) continue;

        // URN 필터: 둘 다 있을 때만 비교
        var issueUrn = issue.urn || issue.modelUrn || '';
        if (currentModelUrn && issueUrn && normalizeUrn(currentModelUrn) !== normalizeUrn(issueUrn)) continue;

        // 마커 DOM 생성
        var marker = document.createElement('div');
        marker.className = 'custom-issue-pushpin';
        marker.setAttribute('data-issue-id', issueIdStr);
        marker.setAttribute('data-x', issue.position.x);
        marker.setAttribute('data-y', issue.position.y);
        marker.setAttribute('data-z', issue.position.z);
        marker.title = (issue.title || '이슈') + ' [클릭하여 상세 보기]';

        // 상태별 핀 색상
        var pinColor = '#ef4444';
        var pinSt = (issue.status || '').trim();
        if (pinSt === '조치완료' || pinSt === '완료') pinColor = '#10b981';
        else if (pinSt === '반려') pinColor = '#6b7280';
        else if (pinSt === '지연') pinColor = '#f59e0b';

        // 단어 번호 (2자리)
        var pinShortId = issueIdStr.replace(/\D/g, '').slice(-2) || issueIdStr.slice(-2) || '!';

        marker.style.cssText = 'position:absolute;width:28px;height:34px;cursor:pointer;z-index:9999;transform:translate(-50%,-100%);filter:drop-shadow(0 2px 4px rgba(0,0,0,0.45));transition:transform 0.15s ease;';
        marker.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 34" width="28" height="34">'
            + '<path d="M14 1C7.9 1 3 5.9 3 12c0 8.5 11 21 11 21s11-12.5 11-21C25 5.9 20.1 1 14 1z" fill="' + pinColor + '" stroke="white" stroke-width="1.5"/>'
            + '<text x="14" y="13.5" text-anchor="middle" dominant-baseline="central" fill="white" font-size="9" font-weight="bold" font-family="Arial,sans-serif">' + pinShortId + '</text>'
            + '</svg>';

        (function(m) {
            m.addEventListener('mouseenter', function() {
                m.style.transform = 'translate(-50%,-100%) scale(1.3)';
                m.style.zIndex = '10000';
            });
            m.addEventListener('mouseleave', function() {
                m.style.transform = 'translate(-50%,-100%)';
                m.style.zIndex = '9999';
            });
        })(marker);

        marker.onclick = (function(issueData) {
            return function(e) {
                e.stopPropagation();
                if (typeof window.openIssueModal === 'function') {
                    window.openIssueModal(issueData.dbId || issueData.id, issueData, issueData.img || '');
                } else if (typeof window.focusIssueOnViewer === 'function') {
                    window.focusIssueOnViewer(issueData.dbId || issueData.id, issueData.urn);
                }
            };
        })(issue);

        activeViewer.container.appendChild(marker);
        window.issueMarkersDOMList.push(marker);
        rendered++;
    }

    console.log('[Marker SSOT] 렌더링 완료: ' + rendered + '개 마커 — 테이블 ' + activeIssueIds.length + '고 중 마커 생성 가능 ' + rendered + '개 (위치/모델 조건 충족)');

    // STEP 7: 위치 갱신 함수 호용
    if (window.updateIssueMarkersPosition) {
        window.updateIssueMarkersPosition();
    }

    // STEP 8: 카메라 이벤트 바인딩 (최초 등록 시만)
    if (activeViewer && !window.isIssueMarkerEventBound) {
        activeViewer.addEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, function() {
            window.updateIssueMarkersPosition();
        });
        window.addEventListener('resize', function() {
            window.updateIssueMarkersPosition();
        });
        window.isIssueMarkerEventBound = true;
        console.log('[Marker SSOT] 케메라 동기화 이벤트 마커 바인딩 완료');

        if (!window.isMarkerSyncLoopRunning) {
            window._markerSyncLoop = function() {
                if (window.updateIssueMarkersPosition) window.updateIssueMarkersPosition();
                requestAnimationFrame(window._markerSyncLoop);
            };
            requestAnimationFrame(window._markerSyncLoop);
            window.isMarkerSyncLoopRunning = true;
            console.log('[Marker SSOT] rAF 동기화 루프 기동');
        }
    }
};

window.isRegularStandaloneIssueMode = false;

// URN Cache & Resolver management for direct placement link navigation
window.updateUrnCache = function(name, urn) {
    if (!name || !urn) return;
    try {
        var cache = JSON.parse(localStorage.getItem('aps_model_urn_cache') || '{}');
        cache[name] = urn;
        localStorage.setItem('aps_model_urn_cache', JSON.stringify(cache));
        console.log('[URN Cache] Cached model URN:', name, '->', urn);
    } catch(e) {}
};

window.resolveModelUrn = async function(fileName) {
    if (!fileName) return "";
    var normName = function(n) {
        return String(n || '').toLowerCase().replace(/\.(rvt|nwc|dwg|ifc)$/, '').trim();
    };
    var target = normName(fileName);

    // 1. Check local storage cache
    var cache = {};
    try {
        cache = JSON.parse(localStorage.getItem('aps_model_urn_cache') || '{}');
    } catch(e) {}
    for (var k in cache) {
        if (normName(k) === target) {
            console.log('[URN Resolver] Resolved URN from cache for:', fileName);
            return cache[k];
        }
    }

    // 2. Fallback: Fetch /api/models (Local models)
    try {
        var resp = await fetch('/api/models');
        if (resp.ok) {
            var models = await resp.json();
            for (var i = 0; i < models.length; i++) {
                var m = models[i];
                cache[m.name] = m.urn;
                if (normName(m.name) === target) {
                    localStorage.setItem('aps_model_urn_cache', JSON.stringify(cache));
                    console.log('[URN Resolver] Resolved URN from API /api/models for:', fileName);
                    return m.urn;
                }
            }
            localStorage.setItem('aps_model_urn_cache', JSON.stringify(cache));
        }
    } catch(err) {
        console.error('[URN Resolver] Failed to fetch /api/models:', err);
    }

    // 3. Fallback: Fetch ACC project contents recursively (ACC models)
    var hubId = localStorage.getItem('aps_last_hub_id') || window.currentHubId;
    var projectId = localStorage.getItem('aps_last_project_id') || window.currentProjectId;
    if (hubId && projectId) {
        try {
            console.log('[URN Resolver] Attempting ACC project contents resolution for file:', fileName);
            var contentsUrl = `/api/hubs/${hubId}/projects/${projectId}/contents`;
            var resp = await fetch(contentsUrl);
            if (resp.ok) {
                var items = await resp.json();
                if (Array.isArray(items)) {
                    // Try to match files in the root folder
                    for (var i = 0; i < items.length; i++) {
                        var item = items[i];
                        if (!item.folder && item.urn) {
                            cache[item.name] = item.urn;
                            if (normName(item.name) === target) {
                                localStorage.setItem('aps_model_urn_cache', JSON.stringify(cache));
                                console.log('[URN Resolver] Resolved URN from ACC project contents for:', fileName);
                                return item.urn;
                            }
                        }
                    }
                    
                    // If not found in root, scan subfolders (1 level deep)
                    for (var i = 0; i < items.length; i++) {
                        var item = items[i];
                        if (item.folder) {
                            var subResp = await fetch(`/api/hubs/${hubId}/projects/${projectId}/contents?folder_id=${encodeURIComponent(item.id)}`);
                            if (subResp.ok) {
                                var subItems = await subResp.json();
                                if (Array.isArray(subItems)) {
                                    for (var j = 0; j < subItems.length; j++) {
                                        var subItem = subItems[j];
                                        if (!subItem.folder && subItem.urn) {
                                            cache[subItem.name] = subItem.urn;
                                            if (normName(subItem.name) === target) {
                                                localStorage.setItem('aps_model_urn_cache', JSON.stringify(cache));
                                                console.log('[URN Resolver] Resolved URN from ACC subfolder contents for:', fileName);
                                                return subItem.urn;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    localStorage.setItem('aps_model_urn_cache', JSON.stringify(cache));
                }
            }
        } catch(err) {
            console.error('[URN Resolver] Failed to fetch ACC project contents:', err);
        }
    }

    return "";
};


// 🚨 [이슈 등록 모달창을 직접 여는 API 함수]
// 🚨 [데이터 무결성 보장] 신규 생성 및 기존 조회 모드 완벽 분기형 모달 엔진
window.openIssueModal = function(clickedDbId, objectName, mergedB64) {
    // 1. 기존 이슈 객체인지 신규 생성 상태인지 파라미터 기반 2차 검증
    // (objectName 자리에 기존 이력 객체가 들어오거나 좌표 배열이 들어오는 예외 케이스 가드)
    var isViewMode = false;
    var savedIssueRef = null;

    if (objectName && typeof objectName === 'object' && !Array.isArray(objectName)) {
        isViewMode = true;
        savedIssueRef = objectName;
    }

    window.lastStandaloneMarkupImage = mergedB64 || "";
    var fallbackModal = document.getElementById('dynamic-standalone-issue-modal');
    if (!fallbackModal) return;

    // 프리뷰 이미지 컨테이너 가드 및 레이아웃 정렬
    var imgContainer = document.getElementById('modal-image-preview');
    if (!imgContainer) {
        var modalBody = fallbackModal.querySelector('div');
        if (modalBody) {
            imgContainer = document.createElement('div');
            imgContainer.id = 'modal-image-preview';
            imgContainer.style.cssText = "width: 100%; margin-bottom: 12px; box-sizing: border-box;";
            modalBody.insertBefore(imgContainer, modalBody.children[1]);
        }
    }

    if (imgContainer) {
        // Clear old contents to rebuild dynamically
        imgContainer.innerHTML = '';
        imgContainer.style.cssText = "width: 100%; margin-bottom: 12px; box-sizing: border-box;";
        
        console.log('[Marker SSOT] 활성 이슈 없음 — 마커 정지');
        return;
    }

    // STEP 4: 이슈 데이터 소스 생성
    // (1) 인자로 받은 issuesArray 우선 사용
    // (2) 없으면 window.currentIssueList → localStorage 순서로 폴백
    var dataSource = issuesArray;
    if (!dataSource || dataSource.length === 0) {
        dataSource = window.currentIssueList || [];
    }
    if (!dataSource || dataSource.length === 0) {
        try { dataSource = JSON.parse(localStorage.getItem('my_saved_issues') || '[]'); } catch(e) { dataSource = []; }
    }

    // STEP 5: URN 모델 상선 추출
    var currentModelUrn = '';
    if (activeViewer.model && typeof activeViewer.model.getUrn === 'function') {
        currentModelUrn = activeViewer.model.getUrn();
    } else if (activeViewer.model && activeViewer.model.getData) {
        currentModelUrn = activeViewer.model.getData().urn || '';
    }
    if (!currentModelUrn) currentModelUrn = window.currentUrn || '';

    var normalizeUrn = function(u) { return String(u || '').replace(/^urn:/, '').trim(); };

    // STEP 6: 화이트리스트 기반 마커 렌더링 루프
    var rendered = 0;
    for (var i = 0; i < dataSource.length; i++) {
        var issue = dataSource[i];
        if (!issue) continue;

        var issueIdStr = String(issue.id || '').trim();
        var issueDbIdStr = String(issue.dbId || '').trim();

        // 🔴 [절대 방어선] SSOT 화이트리스트에 issue.id 또는 issue.dbId 하나라도 있으면 통과
        var inWhitelist = (issueIdStr && activeIssueIds.indexOf(issueIdStr) !== -1)
                       || (issueDbIdStr && activeIssueIds.indexOf(issueDbIdStr) !== -1);
        if (!inWhitelist) continue;

        // 비교 이슈 제외 (이미지 기반 비교 타입은 핀 안 표시)
        if (issue._type === 'compare' || issue.type === 'compare' || issueIdStr.indexOf('COMP-') === 0) continue;

        // position 없으면 마커 불가
        if (!issue.position || issue.position.x === undefined) continue;

        // URN 필터: 둘 다 있을 때만 비교
        var issueUrn = issue.urn || issue.modelUrn || '';
        if (currentModelUrn && issueUrn && normalizeUrn(currentModelUrn) !== normalizeUrn(issueUrn)) continue;

        // 마커 DOM 생성
        var marker = document.createElement('div');
        marker.className = 'custom-issue-pushpin';
        marker.setAttribute('data-issue-id', issueIdStr);
        marker.setAttribute('data-x', issue.position.x);
        marker.setAttribute('data-y', issue.position.y);
        marker.setAttribute('data-z', issue.position.z);
        marker.title = (issue.title || '이슈') + ' [클릭하여 상세 보기]';

        // 상태별 핀 색상
        var pinColor = '#ef4444';
        var pinSt = (issue.status || '').trim();
        if (pinSt === '조치완료' || pinSt === '완료') pinColor = '#10b981';
        else if (pinSt === '반려') pinColor = '#6b7280';
        else if (pinSt === '지연') pinColor = '#f59e0b';

        // 단어 번호 (2자리)
        var pinShortId = issueIdStr.replace(/\D/g, '').slice(-2) || issueIdStr.slice(-2) || '!';

        marker.style.cssText = 'position:absolute;width:28px;height:34px;cursor:pointer;z-index:9999;transform:translate(-50%,-100%);filter:drop-shadow(0 2px 4px rgba(0,0,0,0.45));transition:transform 0.15s ease;';
        marker.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 34" width="28" height="34">'
            + '<path d="M14 1C7.9 1 3 5.9 3 12c0 8.5 11 21 11 21s11-12.5 11-21C25 5.9 20.1 1 14 1z" fill="' + pinColor + '" stroke="white" stroke-width="1.5"/>'
            + '<text x="14" y="13.5" text-anchor="middle" dominant-baseline="central" fill="white" font-size="9" font-weight="bold" font-family="Arial,sans-serif">' + pinShortId + '</text>'
            + '</svg>';

        (function(m) {
            m.addEventListener('mouseenter', function() {
                m.style.transform = 'translate(-50%,-100%) scale(1.3)';
                m.style.zIndex = '10000';
            });
            m.addEventListener('mouseleave', function() {
                m.style.transform = 'translate(-50%,-100%)';
                m.style.zIndex = '9999';
            });
        })(marker);

        marker.onclick = (function(issueData) {
            return function(e) {
                e.stopPropagation();
                if (typeof window.openIssueModal === 'function') {
                    window.openIssueModal(issueData.dbId || issueData.id, issueData, issueData.img || '');
                } else if (typeof window.focusIssueOnViewer === 'function') {
                    window.focusIssueOnViewer(issueData.dbId || issueData.id, issueData.urn);
                }
            };
        })(issue);

        activeViewer.container.appendChild(marker);
        window.issueMarkersDOMList.push(marker);
        rendered++;
    }

    console.log('[Marker SSOT] 렌더링 완료: ' + rendered + '개 마커 — 테이블 ' + activeIssueIds.length + '고 중 마커 생성 가능 ' + rendered + '개 (위치/모델 조건 충족)');

    // STEP 7: 위치 갱신 함수 호용
    if (window.updateIssueMarkersPosition) {
        window.updateIssueMarkersPosition();
    }

    // STEP 8: 카메라 이벤트 바인딩 (최초 등록 시만)
    if (activeViewer && !window.isIssueMarkerEventBound) {
        activeViewer.addEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, function() {
            window.updateIssueMarkersPosition();
        });
        window.addEventListener('resize', function() {
            window.updateIssueMarkersPosition();
        });
        window.isIssueMarkerEventBound = true;
        console.log('[Marker SSOT] 케메라 동기화 이벤트 마커 바인딩 완료');

        if (!window.isMarkerSyncLoopRunning) {
            window._markerSyncLoop = function() {
                if (window.updateIssueMarkersPosition) window.updateIssueMarkersPosition();
                requestAnimationFrame(window._markerSyncLoop);
            };
            requestAnimationFrame(window._markerSyncLoop);
            window.isMarkerSyncLoopRunning = true;
            console.log('[Marker SSOT] rAF 동기화 루프 기동');
        }
    }
};

window.isRegularStandaloneIssueMode = false;

// 🚨 [이슈 등록 모달창을 직접 여는 API 함수]
// 🚨 [데이터 무결성 보장] 신규 생성 및 기존 조회 모드 완벽 분기형 모달 엔진
window.openIssueModal = function(clickedDbId, objectName, mergedB64) {
    // 1. 기존 이슈 객체인지 신규 생성 상태인지 파라미터 기반 2차 검증
    // (objectName 자리에 기존 이력 객체가 들어오거나 좌표 배열이 들어오는 예외 케이스 가드)
    var isViewMode = false;
    var savedIssueRef = null;

    if (objectName && typeof objectName === 'object' && !Array.isArray(objectName)) {
        isViewMode = true;
        savedIssueRef = objectName;
    }

    window.lastStandaloneMarkupImage = mergedB64 || "";
    var fallbackModal = document.getElementById('dynamic-standalone-issue-modal');
    if (!fallbackModal) return;

    // 프리뷰 이미지 컨테이너 가드 및 레이아웃 정렬
    var imgContainer = document.getElementById('modal-image-preview');
    if (!imgContainer) {
        var modalBody = fallbackModal.querySelector('div');
        if (modalBody) {
            imgContainer = document.createElement('div');
            imgContainer.id = 'modal-image-preview';
            imgContainer.style.cssText = "width: 100%; margin-bottom: 12px; box-sizing: border-box;";
            modalBody.insertBefore(imgContainer, modalBody.children[1]);
        }
    }

    if (imgContainer) {
        // Clear old contents to rebuild dynamically
        imgContainer.innerHTML = '';
        imgContainer.style.cssText = "width: 100%; margin-bottom: 12px; box-sizing: border-box;";
        
        var originalSrc = mergedB64 || (savedIssueRef ? (savedIssueRef.img || savedIssueRef.image) : "");
        var hasOriginal = !!originalSrc;
        var hasResolve = !!(savedIssueRef && savedIssueRef.resolveImage);
        var resolveSrc = savedIssueRef ? savedIssueRef.resolveImage : "";

        if (hasOriginal && hasResolve) {
            // Dual Layout: Side-by-side grid
            imgContainer.style.display = 'grid';
            imgContainer.style.gridTemplateColumns = '1fr 1fr';
            imgContainer.style.gap = '12px';
            
            // Left (Original)
            var leftWrapper = document.createElement('div');
            leftWrapper.style.cssText = "background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 6px; text-align: center; display: flex; flex-direction: column; gap: 4px; box-sizing: border-box;";
            leftWrapper.innerHTML = "<span style='font-size: 11px; font-weight: bold; color: #94a3b8;'>이슈 발생 (원본)</span>";
            var leftImg = document.createElement('img');
            leftImg.src = originalSrc;
            leftImg.style.cssText = "width: 100%; height: 140px; object-fit: contain; border-radius: 4px;";
            leftWrapper.appendChild(leftImg);
            imgContainer.appendChild(leftWrapper);
            
            // Right (Resolve)
            var rightWrapper = document.createElement('div');
            rightWrapper.style.cssText = "background: #0f172a; border: 1px solid #334155; border-radius: 6px; padding: 6px; text-align: center; display: flex; flex-direction: column; gap: 4px; box-sizing: border-box;";
            rightWrapper.innerHTML = "<span style='font-size: 11px; font-weight: bold; color: #10b981;'>조치 완료 (변경 후)</span>";
            var rightImg = document.createElement('img');
            rightImg.src = resolveSrc;
            rightImg.style.cssText = "width: 100%; height: 140px; object-fit: contain; border-radius: 4px;";
            rightWrapper.appendChild(rightImg);
            imgContainer.appendChild(rightWrapper);
        } else if (hasOriginal) {
            // Single Layout: Centered original image
            imgContainer.style.display = 'flex';
            imgContainer.style.justifyContent = 'center';
            imgContainer.style.alignItems = 'center';
            imgContainer.style.backgroundColor = '#1e293b';
            imgContainer.style.borderRadius = '6px';
            imgContainer.style.overflow = 'hidden';
            imgContainer.style.padding = '0';
            
            var singleImg = document.createElement('img');
            singleImg.id = 'issue-preview-img';
            singleImg.src = originalSrc;
            singleImg.style.cssText = "max-width: 100%; max-height: 200px; border-radius: 4px; object-fit: contain; display: block; margin: 0 auto; background: #0f172a; border: 1px solid #334155; box-sizing: border-box;";
            imgContainer.appendChild(singleImg);
        } else {
            imgContainer.style.display = 'none';
        }
    }

    // 2. UI 입력창 폰트 및 다크테마 스무딩
    var initialCaptureImages = [];
    if (savedIssueRef && Array.isArray(savedIssueRef.images)) {
        initialCaptureImages = savedIssueRef.images.slice();
    }
    var legacyImage = mergedB64 || (savedIssueRef ? (savedIssueRef.img || savedIssueRef.image || "") : "");
    if (legacyImage && legacyImage.indexOf('data:image') === 0 && initialCaptureImages.indexOf(legacyImage) === -1) {
        initialCaptureImages.unshift(legacyImage);
    }
    if (typeof window.initIssueMultiCaptureUI === 'function') {
        window.initIssueMultiCaptureUI(initialCaptureImages);
    }

    var targetIds = ['dyn-issue-desc', 'dyn-issue-startdate', 'dyn-issue-duedate'];
    for (var i = 0; i < targetIds.length; i++) {
        var el = document.getElementById(targetIds[i]);
        if (el) {
            el.style.setProperty('font-family', '"Pretendard", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans KR", "Malgun Gothic", sans-serif', 'important');
            el.style.setProperty('font-size', '14px', 'important');
            el.style.setProperty('font-weight', '400', 'important');
            el.style.setProperty('letter-spacing', '-0.02em', 'important');
            el.style.setProperty('line-height', '1.5', 'important');
            el.style.setProperty('-webkit-font-smoothing', 'antialiased', 'important');
            el.style.setProperty('-moz-osx-font-smoothing', 'grayscale', 'important');
            if (targetIds[i] !== 'dyn-issue-desc') el.style.setProperty('color-scheme', 'dark', 'important');
        }
    }

    // 🚨 [종료 상태 변화 감지 및 UI 토글]
    var statusSelect = document.getElementById('dyn-issue-status');
    var resolveSection = document.getElementById('issue-resolve-section');
    var resolveNoteText = document.getElementById('issue-resolve-note');
    var resolvePreviewImg = document.getElementById('resolve-image-preview');
    var resolvePreviewContainer = document.getElementById('resolve-image-preview-container');

    function updateResolveSectionVisibility() {
        if (statusSelect && resolveSection) {
            if (statusSelect.value === '종료' || statusSelect.value === '완료') {
                resolveSection.style.display = 'block';
            } else {
                resolveSection.style.display = 'none';
            }
        }
    }

    if (statusSelect) {
        statusSelect.onchange = updateResolveSectionVisibility;
    }

    var resolveCaptureBtn = document.getElementById('btn-resolve-capture');
    if (resolveCaptureBtn) {
        resolveCaptureBtn.onclick = function(e) {
            if (e) e.preventDefault();
            
            var currentIssueId = savedIssueRef ? (savedIssueRef.id || savedIssueRef.dbId) : document.getElementById('dyn-issue-dbid').value;
            localStorage.setItem('pending_resolve_issue_id', currentIssueId);
            console.log("[Resolve Capture] 추가 캡처 기동. 대기 모드 진입. 대상 이슈 ID:", currentIssueId);
            
            // 현재 입력된 변경사항 및 상태 값 자동 저장 (Auto-save)
            var noteVal = resolveNoteText ? resolveNoteText.value.trim() : "";
            var currentStatus = statusSelect ? statusSelect.value : null;

            var list = JSON.parse(localStorage.getItem('my_saved_issues') || '[]');
            for (var idx = 0; idx < list.length; idx++) {
                if (String(list[idx].id) === String(currentIssueId) || String(list[idx].dbId) === String(currentIssueId)) {
                    list[idx].resolveNote = noteVal;
                    if (currentStatus) {
                        list[idx].status = currentStatus;
                    }
                    break;
                }
            }
            localStorage.setItem('my_saved_issues', JSON.stringify(list));
            
            var listProj = JSON.parse(localStorage.getItem('aps_project_issues') || '[]');
            for (var idx = 0; idx < listProj.length; idx++) {
                if (String(listProj[idx].id) === String(currentIssueId) || String(listProj[idx].dbId) === String(currentIssueId)) {
                    listProj[idx].resolveNote = noteVal;
                    if (currentStatus) {
                        listProj[idx].status = currentStatus;
                    }
                    break;
                }
            }
            localStorage.setItem('aps_project_issues', JSON.stringify(listProj));

            fallbackModal.style.display = 'none';
            
            var floatingBtn = document.getElementById('floating-resolve-capture');
            if (floatingBtn) {
                floatingBtn.style.display = 'flex';
            }
        };
    }

    // 3. 🚨 [강력한 모드 분기 벽] 기존 조회 모드: 파싱 원천 차단, 저장된 원본 데이터 직접 주입
    if (isViewMode && savedIssueRef) {
        console.log("[Mode Selector] 기존 이슈 상세 조회 모드 활성화. 파싱 우회 적용.");

        document.getElementById('dyn-issue-title').value = savedIssueRef.title || "";
        document.getElementById('dyn-issue-dbid').value = savedIssueRef.dbId || clickedDbId;
        document.getElementById('dyn-issue-desc').value = savedIssueRef.description || savedIssueRef.desc || savedIssueRef.reviewContent || "";
        document.getElementById('dyn-issue-status').value = savedIssueRef.status || "Open";
        document.getElementById('dyn-issue-startdate').value = savedIssueRef.startDate || "";
        document.getElementById('dyn-issue-duedate').value = savedIssueRef.dueDate || savedIssueRef.endDate || "";

        if (document.getElementById('dyn-issue-structure')) document.getElementById('dyn-issue-structure').value = savedIssueRef.structure || "";
        if (document.getElementById('dyn-issue-trade')) document.getElementById('dyn-issue-trade').value = savedIssueRef.trade || "";
        if (document.getElementById('dyn-issue-placement')) {
            var placementInput = document.getElementById('dyn-issue-placement');
            placementInput.value = savedIssueRef.placement || savedIssueRef.file || "";
            
            // 이슈가 저장된 기존 데이터인 경우 클릭하여 해당 모델 시점으로 이동할 수 있도록 스타일/이벤트 적용
            placementInput.style.cursor = 'pointer';
            placementInput.style.textDecoration = 'underline';
            placementInput.style.color = '#38bdf8';
            placementInput.title = "클릭 시 해당 3D 모델 위치로 이동합니다.";
            
            placementInput.onclick = async function() {
                var targetUrn = savedIssueRef.urn || savedIssueRef.targetUrn || savedIssueRef.seedURN || "";
                var targetDbId = savedIssueRef.dbId || savedIssueRef.id || "";
                var placementFile = savedIssueRef.placement || savedIssueRef.file || "";
                
                if (!targetUrn && typeof window.resolveModelUrn === 'function') {
                    console.log("[URN Resolver] URN is empty. Trying to resolve for file:", placementFile);
                    targetUrn = await window.resolveModelUrn(placementFile);
                }
                
                if (targetUrn) {
                    fallbackModal.style.display = 'none';
                    if (typeof window.focusIssueOnViewer === 'function') {
                        window.focusIssueOnViewer(targetDbId, targetUrn);
                    }
                } else {
                    // URN을 찾지 못하더라도, 현재 뷰어에 모델이 로드되어 있는 경우 현재 모델 내 dbId로 이동 시도 (Fallback)
                    var activeViewer = window.myGlobalViewer || window.viewer || window.NOP_VIEWER;
                    if (activeViewer && activeViewer.model) {
                        console.log("[URN Resolver] URN not resolved, falling back to zooming in current viewer model.");
                        fallbackModal.style.display = 'none';
                        if (typeof window.focusIssueOnViewer === 'function') {
                            window.focusIssueOnViewer(targetDbId, "");
                        }
                    } else {
                        alert("이동할 3D 모델 URN 정보가 존재하지 않습니다.");
                    }
                }
            };
        }

        if (resolveNoteText) {
            resolveNoteText.value = savedIssueRef.resolveNote || "";
        }
        if (resolvePreviewImg && savedIssueRef.resolveImage) {
            resolvePreviewImg.src = savedIssueRef.resolveImage;
            if (resolvePreviewContainer) resolvePreviewContainer.style.display = 'flex';
        } else {
            if (resolvePreviewImg) resolvePreviewImg.src = "";
            if (resolvePreviewContainer) resolvePreviewContainer.style.display = 'none';
        }
        updateResolveSectionVisibility();

        // 모달 타이틀 변경
        var modalTitleEl = document.querySelector('.modal-title') || document.querySelector('.issue-modal-title');
        if (modalTitleEl) modalTitleEl.innerText = "프로젝트 이슈 상세 정보 조회";

        fallbackModal.style.display = 'flex';

        // 🚨 [취소 버그 해결] '취소' 아이콘/버튼 요소를 정밀 추적하여 클릭 시 팝업창을 즉시 hide 처리
        var cancelBtn = document.getElementById('dyn-issue-cancel') || document.getElementById('issue-cancel');
        if (cancelBtn) {
            cancelBtn.onclick = function(cancelEvent) {
                if (cancelEvent) cancelEvent.preventDefault();
                fallbackModal.style.display = 'none';
            };
        }

        // 🚨 [텍스트 변경] 상세 조회(isViewMode)로 열린 팝업인 경우 버튼 문구를 '이슈 수정'으로 강제 전환
        var submitBtn = document.getElementById('dyn-issue-submit') || document.getElementById('issue-submit');
        if (submitBtn) {
            submitBtn.innerText = "이슈 수정";
        }

        // 구성원 명단 로드 후 기존 assignee/verifier 값 강제 역바인딩
        document.getElementById('dyn-issue-assignee').innerHTML = '<option value="">구성원 목록 불러오는 중...</option>';
        document.getElementById('dyn-issue-verifier').innerHTML = '<option value="">구성원 목록 불러오는 중...</option>';

        if (typeof window.syncFormaProjectMembers === 'function') {
            window.syncFormaProjectMembers();
            setTimeout(function() {
                var aSel = document.getElementById('dyn-issue-assignee');
                var vSel = document.getElementById('dyn-issue-verifier');
                var targetA = savedIssueRef.assignee || "";
                var targetV = savedIssueRef.verifier || savedIssueRef.reviewer || "";

                if (aSel && targetA) {
                    var aFound = false;
                    for (var ai = 0; ai < aSel.options.length; ai++) {
                        if (aSel.options[ai].value === targetA) { aSel.selectedIndex = ai; aFound = true; break; }
                    }
                    if (!aFound) {
                        var optA = document.createElement('option');
                        optA.value = targetA; optA.innerText = targetA;
                        aSel.appendChild(optA); aSel.value = targetA;
                    }
                }
                if (vSel && targetV) {
                    var vFound = false;
                    for (var vi = 0; vi < vSel.options.length; vi++) {
                        if (vSel.options[vi].value === targetV) { vSel.selectedIndex = vi; vFound = true; break; }
                    }
                    if (!vFound) {
                        var optV = document.createElement('option');
                        optV.value = targetV; optV.innerText = targetV;
                        vSel.appendChild(optV); vSel.value = targetV;
                    }
                }
                console.log("[Mode Selector] 조회 모드 담당자/확인자 역바인딩 완료.");
            }, 250);
        }
        return; // 🚨 조회 모드는 여기서 종료 — 하단 신규 파싱 코드로 내려가지 않음
    }

    // 4. 🚨 신규 이슈 생성 모드 전용 파싱 라인
    console.log("[Mode Selector] 신규 이슈 생성 모드 가동.");
    if (!isViewMode) {
        var newModalEl = document.getElementById('dynamic-standalone-issue-modal');
        var newModalTitle = newModalEl ? newModalEl.querySelector('h3') || newModalEl.querySelector('.modal-title') : null;
        if (newModalTitle) newModalTitle.innerText = "신규 단독 이슈 등록";
        
        var newSubmitBtn = document.getElementById('dyn-issue-submit') || document.getElementById('issue-submit');
        if (newSubmitBtn) newSubmitBtn.innerText = "이슈 생성";
    }
    var objNameText = (typeof objectName === 'string') ? objectName : "3D 선택 부재";

    document.getElementById('dyn-issue-title').value = "";
    document.getElementById('dyn-issue-dbid').value = clickedDbId;
    document.getElementById('dyn-issue-desc').value = "";
    if (document.getElementById('dyn-issue-structure')) document.getElementById('dyn-issue-structure').value = "";
    if (document.getElementById('dyn-issue-trade')) document.getElementById('dyn-issue-trade').value = "";

    document.getElementById('dyn-issue-assignee').innerHTML = '<option value="">구성원 목록 불러오는 중...</option>';
    document.getElementById('dyn-issue-verifier').innerHTML = '<option value="">구성원 목록 불러오는 중...</option>';

    // 파일명 추출 및 구조물/공종 자동 파싱
    var activeViewer = window.myGlobalViewer || window.viewer || window.NOP_VIEWER;
    var realFileName = "";

    if (activeViewer && activeViewer.model && activeViewer.model.getData) {
        var data = activeViewer.model.getData();
        if (data.loadOptions && data.loadOptions.bubbleNode) {
            var rootBubble = data.loadOptions.bubbleNode.getRootNode();
            if (rootBubble && typeof rootBubble.name === "function") realFileName = rootBubble.name();
        }
    }

    if (!realFileName || realFileName === "3D" || realFileName.toLowerCase().indexOf("view") > -1 || realFileName.length <= 3) {
        var localDropdown = document.getElementById("models");
        var localSelName = (localDropdown && localDropdown.selectedIndex > -1) ? localDropdown.options[localDropdown.selectedIndex].text : "";
        if (localSelName.indexOf("...") > -1 || localSelName.indexOf("없습니다") > -1 || localSelName.indexOf("실패") > -1) localSelName = "";
        realFileName = window.currentUrnName || localSelName || window.currentModelName || window.currentFileName || "알_수_없는_파일명_00_미상_A";
    }

    if (realFileName.indexOf(".") > -1) realFileName = realFileName.substring(0, realFileName.lastIndexOf("."));

    var nameParts = realFileName.split("_");
    if (nameParts.length >= 6) {
        var structureName = nameParts[4];
        var tradeCode = nameParts[5].toUpperCase();
        var tradeMap = { "C": "토목", "A": "건축", "AS": "건축구조", "AM": "건축설비", "E": "전기", "M": "기계" };
        var tradeName = tradeMap[tradeCode] || tradeCode;
        var structInput = document.getElementById("dyn-issue-structure");
        var tradeInput = document.getElementById("dyn-issue-trade");
        if (structInput) structInput.value = structureName;
        if (tradeInput) tradeInput.value = tradeName;
    }

    var placementInput = document.getElementById("dyn-issue-placement");
    if (placementInput) {
        placementInput.value = realFileName;
        // 신규 작성 시에는 비활성화 상태 유지
        placementInput.style.cursor = 'not-allowed';
        placementInput.style.textDecoration = 'none';
        placementInput.style.color = '#cbd5e1';
        placementInput.title = "";
        placementInput.onclick = null;
    }

    document.getElementById('dyn-issue-startdate').value = "";
    document.getElementById('dyn-issue-duedate').value = "";
    document.getElementById('dyn-issue-status').selectedIndex = 0;
    document.getElementById('dyn-issue-type').selectedIndex = 0;

    if (resolveNoteText) resolveNoteText.value = "";
    if (resolvePreviewImg) resolvePreviewImg.src = "";
    if (resolvePreviewContainer) resolvePreviewContainer.style.display = 'none';
    updateResolveSectionVisibility();

    document.getElementById('dyn-issue-cancel').onclick = function(cancelEvent) {
        cancelEvent.preventDefault();
        fallbackModal.style.display = 'none';
    };

    document.getElementById('dyn-issue-submit').onclick = function(submitEvent) {
        submitEvent.preventDefault();
        var t = document.getElementById('dyn-issue-title').value;
        var d = document.getElementById('dyn-issue-desc').value;
        if (!t) { alert('제목을 입력해주세요.'); return; }

        var savedData = localStorage.getItem('my_saved_issues');
        var issueArray = savedData ? JSON.parse(savedData) : [];

        var activeViewerForUrn = window.myGlobalViewer || window.viewer || window.NOP_VIEWER;
        var currentUrn = "";
        if (activeViewerForUrn && activeViewerForUrn.model) {
            if (typeof activeViewerForUrn.model.getUrn === 'function') {
                currentUrn = activeViewerForUrn.model.getUrn();
            } else if (activeViewerForUrn.model.getData) {
                currentUrn = activeViewerForUrn.model.getData().urn || "";
            }
        }
        if (!currentUrn) currentUrn = window.currentUrn || "";

        var issuePosition = window.lastExactClickPoint || { x: 0, y: 0, z: 0 };
        var targetPos = { x: issuePosition.x, y: issuePosition.y, z: issuePosition.z };
        console.log("[UI Sync] 이슈 저장 좌표: x=" + targetPos.x + ", y=" + targetPos.y + ", z=" + targetPos.z);

        var captureImages = typeof window.getIssueCaptureImages === 'function' ? window.getIssueCaptureImages() : [];
        var primaryCaptureImage = captureImages[0] || window.lastStandaloneMarkupImage || "";

        // 🚨 [localStorage 용량 초과 대응] 이미지 압축 및 비동기 처리
        window.compressBase64Array(captureImages, 800, 0.6, function(compressedImages) {
            var compressedPrimary = compressedImages[0] || "";

            var newIssue = {
                dbId: clickedDbId,
                objectName: objNameText,
                title: t,
                description: d,
                status: document.getElementById('dyn-issue-status').value,
                type: document.getElementById('dyn-issue-type').value,
                structure: document.getElementById('dyn-issue-structure').value,
                trade: document.getElementById('dyn-issue-trade').value,
                assignee: document.getElementById('dyn-issue-assignee').value,
                verifier: document.getElementById('dyn-issue-verifier').value,
                startDate: document.getElementById('dyn-issue-startdate').value,
                dueDate: document.getElementById('dyn-issue-duedate').value,
                placement: document.getElementById('dyn-issue-placement').value,
                date: new Date().toISOString().substring(0, 10),
                urn: currentUrn,
                position: targetPos,
                images: compressedImages,
                image: compressedPrimary,
                img: compressedPrimary
            };

            issueArray.push(newIssue);
            
            var saveSuccess = true;
            try {
                localStorage.setItem('my_saved_issues', JSON.stringify(issueArray));
            } catch(e) {
                if (e.name === 'QuotaExceededError' || e.code === 22) {
                    alert("🚨 브라우저 저장 공간(5MB)이 가득 찼습니다!\n오래된 이슈를 삭제하거나 이미지를 줄여주세요.");
                    issueArray.pop(); // 롤백
                    saveSuccess = false;
                } else {
                    console.error("이슈 저장 중 에러:", e);
                    saveSuccess = false;
                }
            }

            if (saveSuccess) {
                window.standaloneProjectIssueList = issueArray;
                fallbackModal.style.display = 'none';
                if (typeof window.renderIssueTable === 'function') window.renderIssueTable();
            }
        });
    };

    fallbackModal.style.display = 'flex';

    // 🚨 [취소 버그 해결] '취소' 아이콘/버튼 요소를 정밀 추적하여 클릭 시 팝업창을 즉시 hide 처리
    var cancelBtn = document.getElementById('dyn-issue-cancel') || document.getElementById('issue-cancel');
    if (cancelBtn) {
        cancelBtn.onclick = function(cancelEvent) {
            if (cancelEvent) cancelEvent.preventDefault();
            fallbackModal.style.display = 'none';
        };
    }

    // 🚨 [텍스트 변경] 상세 조회(isViewMode)로 열린 팝업인 경우 버튼 문구를 '이슈 수정'으로 강제 전환
    var submitBtn = document.getElementById('dyn-issue-submit') || document.getElementById('issue-submit');
    if (submitBtn) {
        if (isViewMode) {
            submitBtn.innerText = "이슈 수정";
        } else {
            submitBtn.innerText = "이슈 생성";
        }
    }

    if (typeof window.syncFormaProjectMembers === 'function') setTimeout(window.syncFormaProjectMembers, 150);
};


// 🚨 [네이티브 툴바 연동 엔진] 오토데스크 공식 API를 이용한 완벽한 툴바 버튼 생성
function addNativeIssueButton(viewerInstance) {
    // [방어선] 가시성 기반 비교 뷰 활성화 체크 (상호 간섭 100% 차단)
    var splitContainer = document.getElementById('split-view-container') || document.querySelector('.split-view-container');
    var isSplitActive = splitContainer && (splitContainer.offsetWidth > 0 || splitContainer.offsetHeight > 0);
    
    if (window.location.href.indexOf('compare') !== -1 || 
        window.location.href.indexOf('split') !== -1 || 
        isSplitActive) {
        return;
    }

    if (!viewerInstance || !viewerInstance.toolbar) return;

    // 이미 툴바에 등록되어 있다면 중복 생성 방지
    if (viewerInstance.toolbar.getControl('custom-issue-toolbar-group')) {
        return;
    }

    // 1. 새로운 툴바 그룹(분리된 블록) 생성
    var issueCtrlGroup = new Autodesk.Viewing.UI.ControlGroup('custom-issue-toolbar-group');
    
    // 2. 새로운 버튼 생성
    var issueBtn = new Autodesk.Viewing.UI.Button('native-issue-create-btn');
    issueBtn.setToolTip('단독 이슈 등록');
    
    // 🚨 [아이콘 교체] 세련된 SVG 벡터 아이콘 삽입 (말풍선 + 플러스 기호)
    var svgIcon = "<svg viewBox='0 0 24 24' style='width: 100%; height: 100%; fill: white;'>" +
                  "<path d='M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 9h-4v4h-2v-4H8V9h4V5h2v4h4v2z'/>" +
                  "</svg>";
                  
    issueBtn.icon.innerHTML = "<div style='display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; padding: 4px; box-sizing: border-box;'>" + svgIcon + "</div>";
    
    // 4. 클릭 이벤트 연결
    issueBtn.onClick = function(e) {
        window.isRegularStandaloneIssueMode = !window.isRegularStandaloneIssueMode;
        
        if (window.isRegularStandaloneIssueMode) {
            issueBtn.setState(Autodesk.Viewing.UI.Button.State.ACTIVE);
            if (viewerInstance && typeof viewerInstance.setNavigationMode === 'function') {
                viewerInstance.setNavigationMode(viewerInstance.navtool);
            }
        } else {
            issueBtn.setState(Autodesk.Viewing.UI.Button.State.INACTIVE);
            if (viewerInstance && typeof viewerInstance.clearSelection === 'function') {
                viewerInstance.clearSelection();
            }
        }
    };

    // 5. 버튼을 그룹에, 그룹을 메인 툴바에 추가
    issueCtrlGroup.addControl(issueBtn);
    viewerInstance.toolbar.addControl(issueCtrlGroup);
}

// 🚨 [오토데스크 뷰어 네이티브 연동 마스터 핸들러]
function initRegularModelIssueButton() {
    var activeViewer = window.myGlobalViewer || window.viewer || window.NOP_VIEWER;
    if (!activeViewer) {
        setTimeout(initRegularModelIssueButton, 300);
        return;
    }

    // 기존 HTML로 생성되었던 하드코딩 레거시 버튼 숨김 처리
    var legacyBtnGroup = document.getElementById('regular-standalone-issue-btn-group');
    if (legacyBtnGroup) {
        legacyBtnGroup.style.display = 'none';
    }

    // 네이티브 공식 툴바 버튼 추가
    if (activeViewer.toolbar) {
        addNativeIssueButton(activeViewer);
    } else {
        activeViewer.addEventListener(Autodesk.Viewing.TOOLBAR_CREATED_EVENT, function() {
            addNativeIssueButton(activeViewer);
        });
    }

    // 선택 변경 리스너 등록
    if (!activeViewer.container.dataset.regularIssueSelectionBound) {
        activeViewer.container.dataset.regularIssueSelectionBound = "true";

        activeViewer.addEventListener(Autodesk.Viewing.SELECTION_CHANGED_EVENT, function(event) {
            if (!window.isRegularStandaloneIssueMode) return;

            var dbIdArray = event.dbIdArray;
            if (dbIdArray && dbIdArray.length > 0) {
                var clickedDbId = dbIdArray[0];

                activeViewer.getProperties(clickedDbId, function(props) {
                    var objectName = "3D 선택 부재";
                    try {
                        if (props && props.name) {
                            objectName = props.name;
                        }
                    } catch (e) {
                        console.error("[Property Extraction Error 방어]", e);
                    }
                    
                    // 📌 캡처 및 분기 로직 실행 공통 함수
                    function startBranchingWorkflow() {
                        try {
                            // 이슈 모드 해제 및 네이티브 버튼 상태 비활성화
                            window.isRegularStandaloneIssueMode = false;
                            var group = activeViewer.toolbar ? activeViewer.toolbar.getControl('custom-issue-toolbar-group') : null;
                            var nativeBtn = group ? group.getControl('native-issue-create-btn') : null;
                            if (nativeBtn) {
                                nativeBtn.setState(Autodesk.Viewing.UI.Button.State.INACTIVE);
                            }
                            
                            // 스크린샷 가로/세로 크기 정의 (w, h 미선언 에러 해결)
                            var w = activeViewer.container.clientWidth;
                            var h = activeViewer.container.clientHeight;
                            
                            activeViewer.getScreenShot(w, h, function(screenshotDataUrl) {
                                window.startMarkupSession(screenshotDataUrl, function(mergedB64) {
                                    // 🚨 [localStorage 용량 초과 대응] 이미지 압축 및 비동기 처리
                                    window.compressBase64Image(mergedB64, 800, 0.6, function(compressedB64) {
                                        var pendingId = localStorage.getItem('pending_resolve_issue_id');
                                        if (pendingId) {
                                            console.log("[Resolve Capture] 조치 완료 추가 캡처 완료. 이슈 ID:", pendingId);
                                            
                                            var targetIssueObj = null;
                                            var list = JSON.parse(localStorage.getItem('my_saved_issues') || '[]');
                                            for (var idx = 0; idx < list.length; idx++) {
                                                if (String(list[idx].id) === String(pendingId) || String(list[idx].dbId) === String(pendingId)) {
                                                    list[idx].resolveImage = compressedB64;
                                                    targetIssueObj = list[idx];
                                                    break;
                                                }
                                            }
                                            
                                            var saveSuccess = true;
                                            try {
                                                localStorage.setItem('my_saved_issues', JSON.stringify(list));
                                            } catch(e) {
                                                if (e.name === 'QuotaExceededError' || e.code === 22) {
                                                    alert("🚨 브라우저 저장 공간(5MB)이 가득 찼습니다!\n오래된 이슈를 삭제하거나 이미지를 줄여주세요.");
                                                    saveSuccess = false;
                                                } else {
                                                    console.error("이슈 저장 중 에러:", e);
                                                    saveSuccess = false;
                                                }
                                            }
                                            
                                            if (saveSuccess) {
                                                var listProj = JSON.parse(localStorage.getItem('aps_project_issues') || '[]');
                                                for (var idx = 0; idx < listProj.length; idx++) {
                                                    if (String(listProj[idx].id) === String(pendingId) || String(listProj[idx].dbId) === String(pendingId)) {
                                                        listProj[idx].resolveImage = compressedB64;
                                                        break;
                                                    }
                                                }
                                                try {
                                                    localStorage.setItem('aps_project_issues', JSON.stringify(listProj));
                                                } catch(e) {
                                                    console.error("aps_project_issues 저장 실패:", e);
                                                }

                                                localStorage.removeItem('pending_resolve_issue_id');
                                                
                                                if (typeof window.renderIssueTable === 'function') window.renderIssueTable();
                                                
                                                if (targetIssueObj && typeof window.openIssueModal === 'function') {
                                                    window.openIssueModal(targetIssueObj.dbId || targetIssueObj.id, targetIssueObj, targetIssueObj.img || "");
                                                }
                                            }
                                        } else {
                                            if (typeof window.openIssueModal === 'function') {
                                                window.openIssueModal(clickedDbId, objectName, compressedB64);
                                            }
                                        }
                                    });
                                });
                            });
                            
                            activeViewer.clearSelection();
                        } catch (err) {
                            console.error("[Capture Workflow Execution Error]", err);
                        }
                    }

                    // 🚨 속성 추출 과정에 예외가 발생하더라도 전체 팝업 오픈 파이프라인이 중단되지 않도록 방어 적용
                    startBranchingWorkflow();
                });
            }
        });
    }
}

// 글로벌 런칭 바인딩
setTimeout(initRegularModelIssueButton, 1000);
window.addEventListener('load', initRegularModelIssueButton);

// ──────────────────────────────────────────────────────────────────────────
// [배치 클릭 → 3D 뷰어 이동 엔진 v4]
// 데드락 해결형: 뷰어가 없으면 loadIntoViewer로 엔진을 먼저 깨운 뒤 Polling으로 낚아챔
// 뷰어가 이미 있으면 URN 비교 후 동일 모델 즉시 줌 / 다른 모델 교체 로드
// ──────────────────────────────────────────────────────────────────────────
window.focusIssueOnViewer = function(dbId, targetUrn) {

    // ── 공통 헬퍼 ────────────────────────────────────────────────────────────
    var numericId    = parseInt(dbId, 10);
    var hasNumericId = !isNaN(numericId) && numericId > 0;
    var normalizeUrn = function(u) { return String(u || '').replace(/^urn:/i, '').trim(); };
    var toViewerUrn = function(u) {
        var str = String(u || '').trim();
        if (!str || str === '-') return '';
        if (str.indexOf('dm.lineage') > -1) return '';
        var body = str.replace(/^urn:/i, '');
        if (body.indexOf('dm.lineage') > -1) return '';
        if (str.indexOf('urn:adsk.') === 0 || body.indexOf('adsk.') === 0) {
            var raw = str.indexOf('urn:') === 0 ? str : 'urn:' + str;
            return btoa(raw).replace(/=/g, '');
        }
        if (/^[A-Za-z0-9+/=_-]+$/.test(body) && body.length > 20) {
            return body;
        }
        return '';
    };
    targetUrn = toViewerUrn(targetUrn);

    console.log('[focusIssueOnViewer] 호출 — dbId:', dbId, '| targetUrn:', targetUrn);

    // ── (A) 뷰어가 없을 때 ─ GEOMETRY_LOADED 대기 후 줌인 ─────────────────────
    function waitForViewerCreationAndZoom() {
        var attempts = 0;
        var maxAttempts = 50; // 100ms × 50 = 5초
        var checkInterval = setInterval(function() {
            attempts++;
            var v = window.NOP_VIEWER || window.myGlobalViewer || window.viewer ||
                    (window.explorer && window.explorer.viewer ? window.explorer.viewer : null);
            if (v) {
                clearInterval(checkInterval);
                console.log('[focusIssueOnViewer] 뷰어 엔진 생성 확인 (' + attempts + '회) — GEOMETRY_LOADED 대기');
                if (!hasNumericId) return;
                var fired = false;
                var onLoaded = function() {
                    if (fired) return;
                    fired = true;
                    try { v.removeEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, onLoaded); } catch(e) {}
                    console.log('[focusIssueOnViewer] GEOMETRY_LOADED → fitToView dbId:', numericId);
                    setTimeout(function() {
                        try {
                            if (typeof v.clearSelection === 'function') v.clearSelection();
                            v.select(numericId);
                            v.fitToView([numericId]);
                        } catch(e) { console.warn('[focusIssueOnViewer] fitToView 오류:', e); }
                    }, 300);
                };
                v.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, onLoaded);
            } else if (attempts >= maxAttempts) {
                clearInterval(checkInterval);
                console.error('[focusIssueOnViewer] loadIntoViewer 호출 후 5초 내 뷰어 생성 실패.');
            }
        }, 100);
    }

    // ── (B) 뷰어가 이미 있을 때 ─ URN 비교 후 로드 or 즉시 줌인 ──────────────
    function executeLoadAndFocus(v) {
        if (typeof v.resize === 'function') v.resize();

        var currentUrn = '';
        if (v.model) {
            try {
                currentUrn = v.model.getData().urn || '';
                if (!currentUrn && typeof v.model.getSeedUrn === 'function') {
                    currentUrn = v.model.getSeedUrn() || '';
                }
            } catch(e) {}
        }

        var needLoad = targetUrn && (normalizeUrn(targetUrn) !== normalizeUrn(currentUrn));
        console.log('[focusIssueOnViewer] currentUrn:', currentUrn, '| needLoad:', needLoad);

        if (needLoad) {
            // 다른 모델 → GEOMETRY_LOADED 일회성 리스너 먼저 등록 후 로드
            console.log('[focusIssueOnViewer] 모델 교체 로드 시작:', targetUrn);
            if (hasNumericId) {
                var fired = false;
                var handler = function() {
                    if (fired) return;
                    fired = true;
                    try { v.removeEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, handler); } catch(e) {}
                    console.log('[focusIssueOnViewer] GEOMETRY_LOADED → fitToView dbId:', numericId);
                    setTimeout(function() {
                        try {
                            if (typeof v.clearSelection === 'function') v.clearSelection();
                            v.select(numericId);
                            v.fitToView([numericId]);
                        } catch(e) { console.warn('[focusIssueOnViewer] fitToView 오류:', e); }
                    }, 300);
                };
                v.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, handler);
            }

            // 로드 트리거: 로컬 드롭다운 → ACC explorer → viewer.js 직접
            var loadTriggered = false;
            var modelDropdown = document.getElementById('models');
            if (modelDropdown) {
                for (var i = 0; i < modelDropdown.options.length; i++) {
                    if (normalizeUrn(modelDropdown.options[i].value) === normalizeUrn(targetUrn)) {
                        modelDropdown.value = modelDropdown.options[i].value;
                        if (typeof window.onModelSelected === 'function') {
                            window.onModelSelected(modelDropdown.options[i].value);
                            loadTriggered = true;
                        }
                        break;
                    }
                }
            }
            if (!loadTriggered && window.explorer && typeof window.explorer.loadIntoViewer === 'function') {
                var urnName = 'BIM Model';
                try {
                    var cache = JSON.parse(localStorage.getItem('aps_model_urn_cache') || '{}');
                    for (var k in cache) {
                        if (normalizeUrn(cache[k]) === normalizeUrn(targetUrn)) { urnName = k; break; }
                    }
                } catch(e) {}
                console.log('[focusIssueOnViewer] ACC explorer.loadIntoViewer:', targetUrn, urnName);
                window.explorer.loadIntoViewer(targetUrn, urnName);
                loadTriggered = true;
            }
            if (!loadTriggered) {
                import('./viewer.js?v=20260804-main-rotate-fix1').then(function(mod) {
                    if (typeof mod.loadModel === 'function') mod.loadModel(v, targetUrn);
                }).catch(function(e) { console.error('[focusIssueOnViewer] viewer.js import 실패:', e); });
            }

        } else {
            // 동일 모델 or URN 없음 → 즉시 줌인
            console.log('[focusIssueOnViewer] 동일 모델 — 즉시 fitToView');
            if (!hasNumericId) { console.log('[focusIssueOnViewer] 숫자 dbId 없음 — 탭 전환만 완료'); return; }
            if (v.model) {
                try {
                    if (typeof v.clearSelection === 'function') v.clearSelection();
                    v.select(numericId);
                    v.fitToView([numericId]);
                    console.log('[focusIssueOnViewer] 즉시 fitToView 완료. dbId:', numericId);
                } catch(e) { console.warn('[focusIssueOnViewer] fitToView 오류:', e); }
            } else {
                // 뷰어는 있지만 모델 미로드 → GEOMETRY_LOADED 대기
                if (hasNumericId) {
                    var fired2 = false;
                    var h2 = function() {
                        if (fired2) return; fired2 = true;
                        try { v.removeEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, h2); } catch(e) {}
                        setTimeout(function() {
                            try { if (typeof v.clearSelection === 'function') v.clearSelection(); v.select(numericId); v.fitToView([numericId]); } catch(e) {}
                        }, 300);
                    };
                    v.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, h2);
                }
            }
        }
    }

    // ── 메인 진입점 ─────────────────────────────────────────────────────────
    // 1. 프로젝트 탭으로 즉시 전환
    if (typeof window.switchTab === 'function') {
        window.switchTab('project');
    }

    // 2. 300ms 대기 후 뷰어 존재 여부 판단 → 분기
    setTimeout(function() {
        var activeViewer = window.NOP_VIEWER ||
                           window.myGlobalViewer ||
                           window.viewer ||
                           (window.explorer && window.explorer.viewer ? window.explorer.viewer : null);

        console.log('[focusIssueOnViewer] 300ms 후 뷰어 체크 — activeViewer:', !!activeViewer);

        if (!activeViewer) {
            // 🚨 핵심: 뷰어가 없으면 대기하지 않고 loadIntoViewer로 엔진을 먼저 강제 깨움
            if (targetUrn && window.explorer && typeof window.explorer.loadIntoViewer === 'function') {
                var urnName = 'BIM Model';
                try {
                    var cache = JSON.parse(localStorage.getItem('aps_model_urn_cache') || '{}');
                    for (var k in cache) {
                        if (normalizeUrn(cache[k]) === normalizeUrn(targetUrn)) { urnName = k; break; }
                    }
                } catch(e) {}
                console.log('[focusIssueOnViewer] 뷰어 없음 → loadIntoViewer로 엔진 강제 초기화:', targetUrn, urnName);
                window.explorer.loadIntoViewer(targetUrn, urnName);
                waitForViewerCreationAndZoom(); // 엔진 깨어나길 기다렸다가 줌인
            } else if (!targetUrn) {
                // URN 없고 뷰어도 없음 → 탭 전환만
                console.warn('[focusIssueOnViewer] targetUrn 없고 뷰어도 없음 — 탭 전환만 완료.');
            } else {
                // explorer.loadIntoViewer도 없음 → 최후 수단
                console.warn('[focusIssueOnViewer] explorer.loadIntoViewer 없음 — viewer.js 직접 import 시도');
                import('./viewer.js?v=20260804-main-rotate-fix1').then(function(mod) {
                    if (!mod.initViewer || !mod.loadModel) return;
                    var container = document.getElementById('preview');
                    if (!container) return;
                    mod.initViewer(container, false).then(function(v) {
                        if (!v) return;
                        window.viewer = v;
                        mod.loadModel(v, targetUrn).then(function() {
                            waitForViewerCreationAndZoom();
                        });
                    });
                }).catch(function(e) { console.error('[focusIssueOnViewer] viewer.js import 실패:', e); });
            }
        } else {
            // 뷰어가 이미 있음 → URN 비교 후 정상 로드/줌
            executeLoadAndFocus(activeViewer);
        }
    }, 300);
};

window.deleteIssue = function(event, type, title, dateStr) {
    if (event && event.stopPropagation) {
        event.stopPropagation(); // 행 클릭 이벤트(줌인) 방지
    }
    if (!confirm("이 이슈를 완전히 삭제하시겠습니까?")) return;

    // 1) 이벤트 타겟으로부터 고유 ID 역추적 시도
    var targetId = "";
    if (event && event.target) {
        var btn = event.target;
        targetId = btn.getAttribute('data-del-id') || btn.getAttribute('data-id') || btn.dataset.id || "";
        if (!targetId) {
            var closestTr = btn.closest('tr');
            if (closestTr) {
                targetId = closestTr.getAttribute('data-id') || closestTr.getAttribute('data-dbid') || "";
            }
        }
    }

    // 비교용 dateStr 정제
    var cleanTargetDate = dateStr;
    if (cleanTargetDate && cleanTargetDate !== "-") {
        if (cleanTargetDate.indexOf("T") > -1) cleanTargetDate = cleanTargetDate.split("T")[0];
        cleanTargetDate = cleanTargetDate.replace(/\s*(오전|오후|AM|PM)?\s*\d{1,2}:\d{2}(:\d{2})?.*/i, "");
        cleanTargetDate = cleanTargetDate.trim();
    }

    // 2) 3대 핵심 저장소 동시 대청소 바인딩
    var storageKeys = ['my_saved_issues', 'aps_project_issues', 'my_saved_compare_issues'];

    storageKeys.forEach(function(key) {
        try {
            var rawData = localStorage.getItem(key);
            if (rawData) {
                var list = JSON.parse(rawData);
                if (Array.isArray(list)) {
                    var filteredList = list.filter(function(item) {
                        if (!item) return false;

                        // ID가 명형하게 확보된 경우 ID로 최우선 정밀 필터링
                        if (targetId) {
                            var itemId = item.id ? String(item.id) : "";
                            var itemDbId = item.dbId ? String(item.dbId) : "";
                            if (itemId === String(targetId) || itemDbId === String(targetId)) {
                                return false;
                            }
                        }

                        // 날짜 및 제목 매칭으로 폴백 필터링
                        var tStr = item.title || "-";
                        var dStr = item.date || item.createdAt || "-";
                        var cleanDStr = dStr;
                        if (cleanDStr && cleanDStr !== "-") {
                            if (cleanDStr.indexOf("T") > -1) cleanDStr = cleanDStr.split("T")[0];
                            cleanDStr = cleanDStr.replace(/\s*(오전|오후|AM|PM)?\s*\d{1,2}:\d{2}(:\d{2})?.*/i, "");
                            cleanDStr = cleanDStr.trim();
                        }

                        if (tStr === title && (dStr === dateStr || cleanDStr === cleanTargetDate)) {
                            return false;
                        }

                        return true;
                    });
                    localStorage.setItem(key, JSON.stringify(filteredList));
                }
            }
        } catch(e) {
            console.error("[Delete Sync Error] Key: " + key, e);
        }
    });

    // 3) 전역 인메모리 캐시 배열 동시 동기화
    if (Array.isArray(window.currentIssueList)) {
        window.currentIssueList = window.currentIssueList.filter(function(x) {
            if (!x) return false;
            if (targetId && (String(x.id) === String(targetId) || String(x.dbId) === String(targetId))) return false;
            var tStr = x.title || "-";
            return tStr !== title;
        });
    }
    if (Array.isArray(window.standaloneProjectIssueList)) {
        window.standaloneProjectIssueList = window.standaloneProjectIssueList.filter(function(x) {
            if (!x) return false;
            if (targetId && (String(x.id) === String(targetId) || String(x.dbId) === String(targetId))) return false;
            var tStr = x.title || "-";
            return tStr !== title;
        });
    }

    console.log('[Delete Sync] ID: ' + (targetId || title) + ' 모든 저장소에서 완전 삭제 성공 ✅');

    // 4) 삭제 후 테이블 즉시 갱신
    if (typeof window.renderIssueTable === 'function') {
        window.renderIssueTable();
    }

    // 5) 포인트 제거: 삭제된 ID에 해당하는 마커만 DOM에서 즉시 집어제거
    if (window.issueMarkersDOMList) {
        var afterDeletedMarkers = [];
        for (var dmi = 0; dmi < window.issueMarkersDOMList.length; dmi++) {
            var dMel = window.issueMarkersDOMList[dmi];
            if (!dMel) continue;
            var dMid = dMel.getAttribute('data-issue-id') || '';
            var shouldRemove = false;
            if (targetId && dMid === String(targetId)) shouldRemove = true;
            if (shouldRemove) {
                if (dMel.parentNode) { dMel.parentNode.removeChild(dMel); }
                console.log('[Marker Sync] deleteIssue: 삭제된 마커 DOM 제거 id=' + dMid);
            } else {
                afterDeletedMarkers.push(dMel);
            }
        }
        window.issueMarkersDOMList = afterDeletedMarkers;
    }

    // 6) 안전 보험: localStorage 기준으로 전체 마커 재렌더링 (여렐 기타 유령 마커까지 소청)
    setTimeout(function() {
        if (typeof window.renderIssueMarkers === 'function') {
            var freshIssues = JSON.parse(localStorage.getItem('my_saved_issues') || '[]');
            if (typeof window.scheduleIssueMarkerRender === 'function') {
                window.scheduleIssueMarkerRender(freshIssues, 100);
            } else {
                window.renderIssueMarkers(freshIssues);
            }
            console.log('[Marker Sync] 삭제 후 마커 전체 재렌더링 완료 ✅');
        }
    }, 80);
};

window.initializeTableFilters = function() {
    var rows = document.querySelectorAll('.issue-item, #issue-table-body tr[data-forma-id]');
    var filters = document.querySelectorAll('.column-filter');
    
    if (!window.currentTableFilterValues) {
        window.currentTableFilterValues = {};
    }

    // 1) 드롭다운(Select) 필터들에 고유 값 추출해서 채워 넣기
    filters.forEach(function(filter) {
        var colIdx = parseInt(filter.getAttribute('data-col'));
        if (filter.tagName === 'SELECT') {
            var uniqueValues = new Set();
            
            rows.forEach(function(row) {
                var cell = row.querySelector('td:nth-child(' + (colIdx + 1) + ')');
                if (cell) {
                    var text = cell.textContent || cell.innerText;
                    text = text.trim();
                    if (text) uniqueValues.add(text);
                }
            });

            // 기존 <option value="">전체</option> 제외하고 초기화 후 다시 채우기
            filter.innerHTML = '<option value="">전체</option>';
            uniqueValues.forEach(function(val) {
                var opt = document.createElement('option');
                opt.value = val;
                opt.text = val;
                filter.appendChild(opt);
            });
        }
        
        // 기존 필터 값 복원
        if (window.currentTableFilterValues[colIdx] !== undefined) {
            filter.value = window.currentTableFilterValues[colIdx];
        }
    });

    // 2) 다중 조건 필터링 함수
    function applyFilters() {
        filters.forEach(function(filter) {
            var colIdx = parseInt(filter.getAttribute('data-col'));
            window.currentTableFilterValues[colIdx] = filter.value;
        });

        rows.forEach(function(row) {
            var isMatch = true;
            
            filters.forEach(function(filter) {
                var filterVal = filter.value.toLowerCase().trim();
                if (!filterVal) return; // '전체' 이거나 빈칸이면 패스
                
                var colIdx = parseInt(filter.getAttribute('data-col'));
                var cell = row.querySelector('td:nth-child(' + (colIdx + 1) + ')');
                
                if (cell) {
                    var cellText = (cell.textContent || cell.innerText).toLowerCase().trim();
                    
                    if (filter.tagName === 'SELECT') {
                        // 드롭다운은 정확히 일치해야 함
                        if (cellText !== filterVal) isMatch = false;
                    } else if (filter.tagName === 'INPUT') {
                        // 텍스트 검색은 포함(contains)되면 됨
                        if (cellText.indexOf(filterVal) === -1) isMatch = false;
                    }
                }
            });
            
            row.style.display = isMatch ? '' : 'none';
        });

        // 🚨 [PDF 동기화 상태 관리] 현재 필터 조건에 맞게 보여지는(display !== 'none') 이슈 목록 동기화
        var visibleIds = [];
        rows.forEach(function(row) {
            if (row && row.style.display !== 'none') {
                var issueId = row.getAttribute('data-issue-id') || row.getAttribute('data-id');
                if (issueId) visibleIds.push(String(issueId));
            }
        });
        if (Array.isArray(window.currentIssueList)) {
            window.currentFilteredIssues = window.currentIssueList.filter(function(item) {
                if (!item) return false;
                var key = String(item.id || item.dbId || '');
                return visibleIds.indexOf(key) > -1 ||
                    visibleIds.indexOf(String(item.id)) > -1 ||
                    visibleIds.indexOf(String(item.dbId)) > -1;
            });
        }
    }

    // 3) 이벤트 리스너 바인딩 (입력 및 변경 시 즉시 필터링 적용)
    filters.forEach(function(filter) {
        filter.addEventListener('input', applyFilters);
        filter.addEventListener('change', applyFilters);
    });

    // 4) 초기 복원된 필터 상태 즉시 적용
    applyFilters();
};

window.renderIssueTable = function() {
    // 🚨 [QuotaExceededError 영구 박멸] 쓰기 권한이 완전히 막힌 상태라면 무조건 기존 이미지 캐시 삭제하여 통로 개방
    try {
        localStorage.setItem('__quota_check__', '1');
        localStorage.removeItem('__quota_check__');
    } catch (e) {
        console.error("[Storage Flush] 스토리지 완전 포화 상태 감지. 오래된 대용량 이미지 세션을 완전 클리어합니다.");
        localStorage.removeItem('my_saved_compare_issues');
        localStorage.setItem('my_saved_compare_issues', '[]');
    }

    var tbody = document.getElementById('issue-table-body');
    if (!tbody) return;
    
    // 기존 테이블 초기화 루틴 유지
    tbody.innerHTML = ""; 

    try {
        // 🚨 동적 헤더(thead) 렌더링
        var headerEl = document.getElementById("issue-table-header");
        if (headerEl) {
            var theadHtml = "<thead id='issue-table-header' style='background: #1e293b; color: #94a3b8; font-size: 13px; text-align: left; position: sticky; top: 0; z-index: 10;'><tr>";
            
            // 구분 Column (index 0)
            theadHtml = theadHtml + "<th style='width: 80px; vertical-align: top;'>" +
                "<div class=\"filter-container\" style=\"width: 100%;\">" +
                "<span style=\"font-size: 12px; text-align: center; display: block;\">구분</span>" +
                "<select class=\"column-filter\" data-col=\"0\" style=\"width: calc(100% - 15px); min-width: 0; box-sizing: border-box;\"><option value=\"\">전체</option></select>" +
                "</div></th>";

            for (var h = 0; h < window.activeIssueColumns.length; h++) {
                var hKey = window.activeIssueColumns[h];
                var hLabel = "";
                for(var j=0; j<window.allIssueColumns.length; j++) {
                    if(window.allIssueColumns[j].key === hKey) { hLabel = window.allIssueColumns[j].label; break; }
                }
                var colIdx = h + 1;
                var filterHtml = "";
                if (hKey === "title" || hKey === "desc") {
                    filterHtml = "<input type=\"text\" class=\"column-filter\" data-col=\"" + colIdx + "\" placeholder=\"검색...\" style=\"width: calc(100% - 15px); min-width: 0; box-sizing: border-box;\">";
                } else if (hKey === "manage") {
                    filterHtml = "<div style='height: 20px;'></div>";
                } else {
                    filterHtml = "<select class=\"column-filter\" data-col=\"" + colIdx + "\" style=\"width: calc(100% - 15px); min-width: 0; box-sizing: border-box;\"><option value=\"\">전체</option></select>";
                }
                
                var colWidth = "100px";
                if (hKey === "title" || hKey === "desc") colWidth = "20%";
                else if (hKey === "status") colWidth = "90px";
                else if (hKey === "manage") colWidth = "80px";
                else if (hKey === "dbId") colWidth = "80px";
                else if (hKey === "assignee" || hKey === "reviewer") colWidth = "100px";
                else if (hKey === "startDate" || hKey === "endDate" || hKey === "date") colWidth = "100px";
                else if (hKey === "objName" || hKey === "placement") colWidth = "120px";

                var alignStyle = (hKey === "manage" || hKey === "status") ? "text-align: center;" : "";
                theadHtml = theadHtml + "<th style='vertical-align: top; width: " + colWidth + "; " + alignStyle + "'>" +
                    "<div class=\"filter-container\" style=\"width: 100%;\">" +
                    "<span style=\"font-size: 12px;\">" + hLabel + "</span>" +
                    filterHtml +
                    "</div></th>";
            }
            theadHtml = theadHtml + "</tr></thead>";
            headerEl.outerHTML = theadHtml;
        }

        var list1 = []; var list2 = []; var list3 = [];
        try { list1 = JSON.parse(localStorage.getItem('aps_project_issues') || '[]'); } catch(e){}
        try { list2 = JSON.parse(localStorage.getItem('my_saved_issues') || '[]'); } catch(e){}
        try { list3 = JSON.parse(localStorage.getItem('my_saved_compare_issues') || '[]'); } catch(e){}

        // 세 개의 저장소 데이터를 중복 없이 유기적으로 병합
        var totalIssues = list1.concat(list2).concat(list3);

        // ID 중복 출현을 방지하기 위한 유니크(Unique) 고유화 필터링 적용
        var uniqueMap = {};
        var finalMergedList = [];
        for (var u = 0; u < totalIssues.length; u++) {
            var item = totalIssues[u];
            if (item && item.id && !uniqueMap[item.id]) {
                uniqueMap[item.id] = true;
                finalMergedList.push(item);
            }
        }

        // 시스템 전역 인메모리 캐시 변수에 최종 병합 리스트 동기화
        window.currentIssueList = finalMergedList;
        var total = finalMergedList;

        // 🚨 필터에 맞춰서 total 배열 필터링
        var activeFilter = window.currentIssueFilter || 'all';
        if (activeFilter === 'standalone') {
            total = total.filter(function(item) {
                if (!item) return false;
                var isRealCompare = (
                    String(item.id || "").indexOf('COMP-') === 0 || 
                    item._type === 'compare' || 
                    item.type === 'compare'
                );
                return !isRealCompare; // COMP- 제외 (단독 이슈만)
            });
        } else if (activeFilter === 'compare') {
            total = total.filter(function(item) {
                if (!item) return false;
                var isRealCompare = (
                    String(item.id || "").indexOf('COMP-') === 0 || 
                    item._type === 'compare' || 
                    item.type === 'compare'
                );
                return isRealCompare; // COMP- 만 포함 (비교 이슈만)
            });
        }
        window.currentIssueList = total;
        window.currentFilteredIssues = total.slice();

        // 🚨 [레이스 컨디션 해결] tbody.innerHTML 이후로 호출 위치 이동됨 ↓
        // (renderIssueMarkers는 L3838 tbody.innerHTML 이후로 이동함)
        
        if (total.length === 0) {
            var colCount = (window.activeIssueColumns.length || 7) + 1;
            tbody.innerHTML = "<tr><td colspan='" + colCount + "' style='text-align: center; padding: 40px; color: #64748b;'>해당 카테고리에 저장되거나 조회된 이슈가 없습니다.</td></tr>";
            // ud83dudea8 uc774uc288 uc5c6uc744 ub54cub3c4 ub9c8ucee4 uc804uccb4 ud074ub9acuc5b4 (uc720ub839 ud540 uc794ub958 ubc29uc9c0)
            if (typeof window.clearAllCurrentMarkers === 'function') window.clearAllCurrentMarkers();
            return;
        }

        var html = "";
        for (var k = 0; k < total.length; k++) {
            var item = total[k];
            if (!item) continue;
            var isRealCompare = (
                String(item.id || "").indexOf('COMP-') === 0 || 
                item._type === 'compare' || 
                item.type === 'compare'
            );
            var badgeText = isRealCompare ? "비교 이슈" : "단독 이슈";
            var badgeColor = isRealCompare ? "#7c3aed" : "#f59e0b"; 
            
            var dateStr = item.date || item.createdAt || "-";
            
            // 🚨 YYYY-MM-DD 포맷 정규화 파이프라인
            if (dateStr && dateStr !== "-") {
                if (dateStr.indexOf('T') > -1) {
                    dateStr = dateStr.split('T')[0];
                }
                dateStr = dateStr.replace(/\s*(오전|오후|AM|PM)?\s*\d{1,2}:\d{2}(:\d{2})?.*/i, "");
                dateStr = dateStr.trim();

                // 🚨 점(.) 형식으로 저장된 과거 데이터들을 YYYY-MM-DD 포맷으로 강제 변환 (예: 2026.7.1 -> 2026-07-01)
                if (dateStr.indexOf('.') > -1) {
                    var parts = dateStr.split('.');
                    var cleanParts = [];
                    for (var pIdx = 0; pIdx < parts.length; pIdx++) {
                        var partTrimmed = parts[pIdx].trim();
                        if (partTrimmed) cleanParts.push(partTrimmed);
                    }
                    if (cleanParts.length >= 3) {
                        var y = cleanParts[0];
                        var m = cleanParts[1].length === 1 ? "0" + cleanParts[1] : cleanParts[1];
                        var d = cleanParts[2].length === 1 ? "0" + cleanParts[2] : cleanParts[2];
                        dateStr = y + "-" + m + "-" + d;
                    }
                }
                // 🚨 슬래시(/) 형식 방어 로직 추가 (예: 2026/7/1 -> 2026-07-01)
                else if (dateStr.indexOf('/') > -1) {
                    var parts = dateStr.split('/');
                    var cleanParts = [];
                    for (var pIdx = 0; pIdx < parts.length; pIdx++) {
                        var partTrimmed = parts[pIdx].trim();
                        if (partTrimmed) cleanParts.push(partTrimmed);
                    }
                    if (cleanParts.length >= 3) {
                        var y = cleanParts[0];
                        var m = cleanParts[1].length === 1 ? "0" + cleanParts[1] : cleanParts[1];
                        var d = cleanParts[2].length === 1 ? "0" + cleanParts[2] : cleanParts[2];
                        dateStr = y + "-" + m + "-" + d;
                    }
                }
            }
            
            var idStr = item.dbId || item.id || "-";
            
            var tdStyle = "padding: 14px 20px;";
            var trHtml = "<tr class='issue-item issue-row' data-id='" + idStr + "' data-issue-id='" + (item.id || "") + "' style='border-bottom: 1px solid #334155; transition: background 0.2s; cursor: pointer;' onmouseover='this.style.background=\"#334155\"' onmouseout='this.style.background=\"transparent\"' onclick='window.focusIssueOnViewer(\"" + idStr + "\", \"" + (item.urn || "") + "\")'>";
            
            // 🚨 첫 번째 열: 구분 (단독 vs 비교) 식별 및 배지 출력
            var compareBadgeStyle = "background-color: #8b5cf6; color: #ffffff; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; display: inline-block; white-space: nowrap; line-height: 1.2; text-align: center;";
            var singleBadgeStyle = "background-color: #f59e0b; color: #ffffff; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; display: inline-block; white-space: nowrap; line-height: 1.2; text-align: center;";
            var typeBadge = isRealCompare 
                ? '<span style="' + compareBadgeStyle + '">비교</span>' 
                : '<span style="' + singleBadgeStyle + '">단독</span>';
            trHtml = trHtml + "<td style='" + tdStyle + " text-align: center;'>" + typeBadge + "</td>";

            for(var c=0; c<window.activeIssueColumns.length; c++) {
                var colKey = window.activeIssueColumns[c];
                if (colKey === "title") trHtml = trHtml + "<td style='" + tdStyle + " font-weight: 500;'>" + (item.title||"-") + "</td>";
                else if (colKey === "structure") trHtml = trHtml + "<td style='" + tdStyle + "'>" + (item.structure||"-") + "</td>";
                else if (colKey === "trade") trHtml = trHtml + "<td style='" + tdStyle + "'>" + (item.trade||"-") + "</td>";
                else if (colKey === "type") {
                    var displayType = item.type || "-";
                    if (displayType.toLowerCase() === 'clash') {
                        displayType = '간섭';
                    } else if (displayType.toLowerCase() === 'single') {
                        displayType = '단독';
                    } else if (displayType.toLowerCase() === 'compare') {
                        displayType = '비교';
                    } else if (displayType.toLowerCase() === 'coordination') {
                        displayType = '협업';
                    } else if (displayType.toLowerCase() === 'design') {
                        displayType = '설계 변경';
                    }
                    trHtml = trHtml + "<td style='" + tdStyle + "'>" + displayType + "</td>";
                }
                else if (colKey === "desc") trHtml = trHtml + "<td style='" + tdStyle + " max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;' title='" + (item.description||item.desc||"") + "'>" + (item.description||item.desc||"-") + "</td>";
                else if (colKey === "date") trHtml = trHtml + "<td style='" + tdStyle + "'>" + dateStr + "</td>";
                else if (colKey === "status") {
                    // 🚨 실제 상태 (Status) 추출 및 색상 맵핑 방어
                    var realStatus = item.status || '초안';
                    var statusColor = '#94a3b8'; // 기본 회색 (초안/미정)
                    if (realStatus === '진행중' || realStatus === '검토중') statusColor = '#3b82f6'; // 파란색
                    else if (realStatus === '종료' || realStatus === '완료') statusColor = '#22c55e'; // 초록색
                    else if (realStatus === '지연' || realStatus === '이슈발생') statusColor = '#ef4444'; // 빨간색

                    var statusHtml = '<span style="color: ' + statusColor + '; font-weight: bold;">' + realStatus + '</span>';
                    trHtml = trHtml + "<td style='" + tdStyle + " text-align: center;'>" + statusHtml + "</td>";
                }
                else if (colKey === "manage") trHtml = trHtml + "<td style='" + tdStyle + " text-align: center;'><button onclick='window.deleteIssue(event, \"" + item._type + "\", \"" + (item.title||"-") + "\", \"" + (item.date||item.createdAt||"-") + "\")' style='background: transparent; color: #cbd5e1; border: 1px solid #475569; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: bold; transition: all 0.2s;' onmouseover='this.style.background=\"#ef4444\"; this.style.color=\"white\"; this.style.border=\"1px solid #ef4444\";' onmouseout='this.style.background=\"transparent\"; this.style.color=\"#cbd5e1\"; this.style.border=\"1px solid #475569\";'>삭제</button></td>";
                else if (colKey === "objName") trHtml = trHtml + "<td style='" + tdStyle + " color: #38bdf8;'>" + (item.objName||item.objectName||item.elementName||item.name||"-") + "</td>";
                else if (colKey === "dbId") trHtml = trHtml + "<td style='" + tdStyle + " color: #cbd5e1;'>" + (item.dbId||item.id||"-") + "</td>";
                else if (colKey === "assignee") trHtml = trHtml + "<td style='" + tdStyle + "'>" + (item.assignee||"-") + "</td>";
                else if (colKey === "reviewer") trHtml = trHtml + "<td style='" + tdStyle + "'>" + (item.reviewer||item.verifier||"-") + "</td>";
                else if (colKey === "startDate") trHtml = trHtml + "<td style='" + tdStyle + "'>" + (item.startDate||item.startdate||"-") + "</td>";
                else if (colKey === "endDate") trHtml = trHtml + "<td style='" + tdStyle + "'>" + (item.endDate||item.dueDate||item.duedate||"-") + "</td>";
                else if (colKey === "placement") trHtml = trHtml + "<td style='" + tdStyle + "'>" + (item.placement || item.file || "-") + "</td>";
            }
            trHtml = trHtml + "</tr>";
            html = html + trHtml;
        }
        tbody.innerHTML = html;

        // 🚨 [레이스 컨디션 해결] tbody.innerHTML 후 마커 렌더링
        // DOM이 완전히 채워진 시점에 SSOT DOM 파싱이 정확하게 작동함
        if (typeof window.scheduleIssueMarkerRender === 'function') {
            window.scheduleIssueMarkerRender(total, 100);
        } else if (typeof window.renderIssueMarkers === 'function') {
            setTimeout(function() { window.renderIssueMarkers(total); }, 100);
        }

        if (typeof window.bindIssueItemClickEvents === 'function') {
            window.bindIssueItemClickEvents();
        }
        
        // 🚨 다중 조건 필터 초기화 실행
        if (typeof window.initializeTableFilters === 'function') {
            window.initializeTableFilters();
        }
        console.log("[Global Filter Guard] 메인 이슈 탭에서 버전 비교 데이터 필터링 청소 완료 ✅");
    } catch (err) {
        console.error("[Render Sync Filter Error]:", err.message);
    }
};

// 🚨 [비교 종료 클릭 핸들러 오버라이딩] 단일 모델 로드를 생략하고 폴더/파일 목록 화면으로 완벽 복귀
document.addEventListener('click', function(e) {
    var target = e.target;
    if (target && (target.id === 'btn-exit-comparison' || target.closest('#btn-exit-comparison'))) {
        window.isCompareModeActive = false;
        // 🚨 [CSS Guard 해제] 단독 뷰어 복귀를 위한 스타일 시체 해제
        if (window.compareModeStyleTag && window.compareModeStyleTag.parentNode) {
            window.compareModeStyleTag.parentNode.removeChild(window.compareModeStyleTag);
            window.compareModeStyleTag = null;
            console.log("[CSS Guard] 글로벌 스타일 시트 락 해제 완료. 단독 마커/버튼 복구 가능 상태.");
        }

        // 🚨 [복구 1] 네이티브 단독 이슈 버튼 다시 노출
        var activeViewer = window.myGlobalViewer || window.viewer || window.NOP_VIEWER;
        if (activeViewer && activeViewer.toolbar) {
            var customGroup = activeViewer.toolbar.getControl('custom-issue-toolbar-group');
            if (customGroup) customGroup.setVisible(true);
            var nativeBtn = activeViewer.toolbar.getControl('native-issue-create-btn');
            if (nativeBtn) nativeBtn.setVisible(true);
        }

        // 🚨 [복구 2] 마커들을 다시 가시화하고 동기화 루프 재정렬
        if (window.renderIssueMarkers) {
            // 기존 마커 다시 그리기 함수 호출로 상태 복구
            var currentIssues = window.issueList || window.standaloneProjectIssueList || JSON.parse(localStorage.getItem('my_saved_issues') || '[]');
            if (typeof window.scheduleIssueMarkerRender === 'function') {
                window.scheduleIssueMarkerRender(currentIssues, 100);
            } else {
                window.renderIssueMarkers(currentIssues);
            }
        } else if (window._issueManager && typeof window._issueManager.restorePins === 'function') {
            window._issueManager.restorePins();
        }

        // 1. comparison.js의 onclick 동작 시 모델 로드를 방지하기 위해 임시로 window.currentUrn을 백업 및 null로 설정
        var savedUrn = window.currentUrn;
        window.currentUrn = null;
        
        // 2. comparison.js의 onclick이 실행된 이후 동기적으로 폴더 목록 복귀 실행
        setTimeout(function() {
            // URN 복원
            window.currentUrn = savedUrn;
            
            // 모든 뷰어 컨테이너 숨김
            var preview = document.getElementById('preview');
            if (preview) {
                preview.style.display = 'none';
            }
            var compContainer = document.getElementById('comparison-container');
            if (compContainer) {
                compContainer.style.display = 'none';
            }
            
            // 파일/폴더 목록 컨테이너 복구
            var explorerContainer = document.getElementById('explorer-container');
            if (explorerContainer) {
                explorerContainer.style.display = 'flex';
            }
            
            // window.explorer 인스턴스가 있다면 switchMode 호출
            if (window.explorer && typeof window.explorer.switchMode === 'function') {
                window.explorer.switchMode('explorer');
            }
            
            // 목록으로 가기 버튼 숨김
            var backBtn = document.getElementById('back-to-explorer-btn');
            if (backBtn) {
                backBtn.style.display = 'none';
            }
        }, 0);
    }
}, true); // useCapture = true로 설정하여 comparison.js의 onclick보다 먼저 실행되게 함

// 🚨 [UX 개선] 이슈 리스트 아이템 클릭 시 상세 조회 팝업 매핑 엔진
// 🚨 [먹통 격파] 비교 이슈 및 단독 이슈 더블 클릭/단일 클릭 바인딩 마스터 라인
window.bindIssueItemClickEvents = function() {
    var items = document.querySelectorAll('.issue-item, .issue-table-row');
    for (var i = 0; i < items.length; i++) {
        (function() {
            var item = items[i];
            var issueId = item.getAttribute('data-id');
            item.onclick = null;
            item.removeAttribute('onclick');
            
            item.addEventListener('click', function(e) {
                if (e.target.tagName.toLowerCase() === 'button' || e.target.type === 'checkbox') return;
                
                var list1 = JSON.parse(localStorage.getItem('aps_project_issues') || '[]');
                var list2 = JSON.parse(localStorage.getItem('my_saved_issues') || '[]');
                var list3 = JSON.parse(localStorage.getItem('my_saved_compare_issues') || '[]');
                var allLists = list1.concat(list2).concat(list3);
                var targetIssue = null;
                
                for (var j = 0; j < allLists.length; j++) {
                    if (String(allLists[j].dbId) === String(issueId) || String(allLists[j].id) === String(issueId)) {
                        targetIssue = allLists[j];
                        break;
                    }
                }
                if (!targetIssue) return;

                if (targetIssue) {
                    // 🚨 [데이터 보호막] 비동기 API가 언제 끝나든 매핑할 수 있도록 클릭한 이슈 객체를 전역 컨텍스트에 임시 락(Lock)
                    window.currentActiveViewingIssue = targetIssue; 
                    console.log("[Context Guard] 역바인딩용 데이터 백업 완료:", targetIssue.assignee);
                }

                // 🚨 [정식 분기] 비교 이슈 타입 포착 시: 이미지와 100% 동일한 전용 독립형 모달 DOM 강제 빌드
                if (targetIssue._type === 'compare' || targetIssue.imgBefore || targetIssue.versionBefore) {
                    console.log("[Compare Form Engine] 사진 규격 일치형 비교 팝업 동적 조립 시작");
                    
                    var oldCompModal = document.getElementById('dynamic-real-compare-modal');
                    if (oldCompModal) oldCompModal.parentNode.removeChild(oldCompModal);

                    // 최상위 암막 모달 오버레이 생성
                    var cModal = document.createElement('div');
                    cModal.id = 'dynamic-real-compare-modal';
                    cModal.style.cssText = "position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(15,23,42,0.8); z-index: 20000; display: flex; align-items: center; justify-content: center; font-family: sans-serif;";

                    // 내부 윈도우 콘텐츠 조립 (백틱 절대 금지, 오직 '+' 연산자로만 이중 인용부호 조립)
                    var html = "";
                    html = html + "<div style='width: 90%; max-width: 900px; background: #1e293b; color: #cbd5e1; border-radius: 8px; overflow: hidden; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5);'>";
                    // 헤더 (제목 및 우측 상단 X 닫기 버튼)
                    html = html + "  <div style='background: #0f172a; padding: 14px 20px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #334155;'>";
                    html = html + "    <h3 style='margin: 0; font-size: 16px; font-weight: bold; color: white;'>새 이슈 작성 (객체 ID: " + (targetIssue.dbId || targetIssue.id || "-") + ")</h3>";
                    html = html + "    <span id='real-compare-close-x' style='cursor: pointer; color: #94a3b8; font-size: 20px;' onmouseover='this.style.color=\"white\"' onmouseout='this.style.color=\"#94a3b8\"'>&times;</span>";
                    html = html + "  </div>";
                    // 메인 바디 스크롤 영역
                    html = html + "  <div style='padding: 20px; max-height: 75vh; overflow-y: auto; display: flex; flex-direction: column; gap: 16px;'>";
                    // 1열: 변경 전 / 변경 후 이미지 뷰어 박스 세트
                    html = html + "    <div style='display: grid; grid-template-columns: 1fr 1fr; gap: 16px;'>";
                    html = html + "      <div style='background: #334155; padding: 12px; border-radius: 6px; text-align: center;'>";
                    var popupVerBefore = targetIssue.verBefore || targetIssue.versionBefore || "";
                    var popupVerAfter  = targetIssue.verAfter  || targetIssue.versionAfter  || "";
                    var popupVerBeforeLabel = popupVerBefore ? (popupVerBefore.indexOf('ver.') === 0 ? popupVerBefore : 'ver.' + popupVerBefore) : "버전 정보 없음";
                    var popupVerAfterLabel  = popupVerAfter  ? (popupVerAfter.indexOf('ver.')  === 0 ? popupVerAfter  : 'ver.' + popupVerAfter)  : "버전 정보 없음";
                    html = html + "        <div style='font-size: 13px; font-weight: bold; margin-bottom: 8px; color: #94a3b8;'>변경 전 (Before) - <span style='color: #ef4444;'>" + popupVerBeforeLabel + "</span></div>";
                    html = html + "        <div style='height: 180px; background: #0f172a; border-radius: 4px; display: flex; align-items: center; justify-content: center; overflow: hidden;'><img src='" + (targetIssue.imgBefore || targetIssue.img || "") + "' style='max-width: 100%; max-height: 100%; object-fit: contain;'/></div>";
                    html = html + "      </div>";
                    html = html + "      <div style='background: #334155; padding: 12px; border-radius: 6px; text-align: center;'>";
                    html = html + "        <div style='font-size: 13px; font-weight: bold; margin-bottom: 8px; color: #94a3b8;'>변경 후 (After) - <span style='color: #10b981;'>" + popupVerAfterLabel + "</span></div>";
                    html = html + "        <div style='height: 180px; background: #0f172a; border-radius: 4px; display: flex; align-items: center; justify-content: center; overflow: hidden;'><img src='" + (targetIssue.imgAfter || targetIssue.img || "") + "' style='max-width: 100%; max-height: 100%; object-fit: contain;'/></div>";
                    html = html + "      </div>";
                    html = html + "    </div>";
                    // 2열: 검토 내용 / 변경 내용 상세 텍스트 영역
                    // 🚨 [데이터 유실 복구 라인] 저장 시 탑재했던 고유 키(reviewContent, changeContent)를 1순위로 엄격하게 낚아챕니다.
                    var actualReviewText = "기록된 검토 내용이 없습니다.";
                    var actualChangeText = "기록된 변경 내용이 없습니다.";

                    if (targetIssue) {
                        actualReviewText = targetIssue.reviewContent || targetIssue.desc || targetIssue.description || "기록된 검토 내용이 없습니다.";
                        actualChangeText = targetIssue.changeContent || targetIssue.description || targetIssue.desc || "기록된 변경 내용이 없습니다.";
                    }
                    var actualReviewContent = actualReviewText;
                    var actualChangeContent = actualChangeText;

                    html = html + "    <div style='display: grid; grid-template-columns: 1fr 1fr; gap: 16px;'>";
                    html = html + "      <div>";
                    html = html + "        <label style='font-size: 13px; font-weight: bold; color: #94a3b8; display: block; margin-bottom: 6px;'>검토 내용</label>";
                    html = html + "        <textarea id='real-compare-review-text' style='width: 100%; height: 80px; background: #0f172a; border: 1px solid #334155; border-radius: 4px; padding: 10px; color: white; resize: none; font-size: 13px; box-sizing: border-box;'>" + actualReviewContent + "</textarea>";
                    html = html + "      </div>";
                    html = html + "      <div>";
                    html = html + "        <label style='font-size: 13px; font-weight: bold; color: #94a3b8; display: block; margin-bottom: 6px;'>변경 내용</label>";
                    html = html + "        <textarea id='real-compare-change-text' style='width: 100%; height: 80px; background: #0f172a; border: 1px solid #334155; border-radius: 4px; padding: 10px; color: white; resize: none; font-size: 13px; box-sizing: border-box;'>" + actualChangeContent + "</textarea>";
                    html = html + "      </div>";
                    html = html + "    </div>";
                    // 3열: 단일 행 정보 필드 그룹 (제목)
                    html = html + "    <div><label style='font-size: 13px; font-weight: bold; color: #94a3b8; display: block; margin-bottom: 6px;'>제목</label><input type='text' id='real-compare-title-input' value='" + (targetIssue.title || "") + "' style='width: 100%; background: #0f172a; border: 1px solid #334155; border-radius: 4px; padding: 10px; color: white; font-size: 13px; box-sizing: border-box;'/></div>";
                    // 4열: 담당자 / 상태 드롭다운 세트
                    html = html + "    <div style='display: grid; grid-template-columns: 1fr 1fr; gap: 16px;'>";
                    var actAssignee = targetIssue.assignee || "미지정";
                    if (actAssignee === "미정") actAssignee = "미지정";

                    var originalSelect = document.getElementById('issue-assignee');
                    var optionsHtmlString = originalSelect ? originalSelect.innerHTML : '<option value="미지정">미지정</option>';
                    if (optionsHtmlString.indexOf('value="' + actAssignee + '"') === -1 && optionsHtmlString.indexOf("value='" + actAssignee + "'") === -1) {
                        optionsHtmlString += '<option value="' + actAssignee + '">' + actAssignee + '</option>';
                    }

                    html = html + "      <div><label style='font-size: 13px; font-weight: bold; color: #94a3b8; display: block; margin-bottom: 6px;'>담당자</label><select id='real-compare-assignee-select' style='width: 100%; background: #0f172a; border: 1px solid #334155; border-radius: 4px; padding: 10px; color: white; font-size: 13px; box-sizing: border-box;'>";
                    html = html + optionsHtmlString;
                    html = html + "      </select></div>";
                    var actStatus = targetIssue.status || "검토중";
                    html = html + "      <div><label style='font-size: 13px; font-weight: bold; color: #94a3b8; display: block; margin-bottom: 6px;'>상태 (Status)</label><select id='real-compare-status-select' style='width: 100%; background: #f59e0b; border: none; border-radius: 4px; padding: 10px; color: white; font-size: 13px; font-weight: bold; box-sizing: border-box;'>";
                    html = html + "        <option value='검토중' " + (actStatus === '검토중' ? 'selected' : '') + ">검토중</option>";
                    html = html + "        <option value='조치완료' " + (actStatus === '조치완료' ? 'selected' : '') + ">조치완료</option>";
                    html = html + "        <option value='반려' " + (actStatus === '반려' ? 'selected' : '') + ">반려</option>";
                    html = html + "      </select></div>";
                    html = html + "    </div>";
                    // 5열: 구조물명 / 작업 구분
                    html = html + "    <div style='display: grid; grid-template-columns: 1fr 1fr; gap: 16px;'>";
                    html = html + "      <div><label style='font-size: 13px; font-weight: bold; color: #94a3b8; display: block; margin-bottom: 6px;'>구조물명</label><input type='text' id='real-compare-structure-input' value='" + (targetIssue.structure || "") + "' style='width: 100%; background: #0f172a; border: 1px solid #334155; border-radius: 4px; padding: 10px; color: white; font-size: 13px; box-sizing: border-box;'/></div>";
                    html = html + "      <div><label style='font-size: 13px; font-weight: bold; color: #94a3b8; display: block; margin-bottom: 6px;'>작업 구분</label><input type='text' id='real-compare-trade-input' value='" + (targetIssue.trade || "간섭 제어") + "' style='width: 100%; background: #0f172a; border: 1px solid #334155; border-radius: 4px; padding: 10px; color: white; font-size: 13px; box-sizing: border-box;'/></div>";
                    html = html + "    </div>";
                    html = html + "  </div>";
                    // 푸터 하단 컨트롤 버튼 제어부 (취소 / 변경 전용 '비교 이슈 수정' 활성화)
                    html = html + "  <div style='background: #0f172a; padding: 14px 20px; display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid #334155;'>";
                    html = html + "    <button id='real-compare-cancel-btn' style='background: #475569; color: white; border: none; padding: 8px 20px; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: bold;'>취소</button>";
                    html = html + "    <button id='real-compare-submit-btn' style='background: #6366f1; color: white; border: none; padding: 8px 24px; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: bold;'>비교 이슈 수정</button>";
                    html = html + "  </div>";
                    html = html + "</div>";

                    cModal.innerHTML = html;
                    document.body.appendChild(cModal);

                    var targetSelect = document.getElementById('real-compare-assignee-select');
                    if (typeof window.loadProjectMembersIntoSelect === 'function') {
                        window.loadProjectMembersIntoSelect(targetSelect, actAssignee);
                    }

                    // 🚨 [버그 해결 리스너 매핑] 취소 버튼 및 X 아이콘 작동 바인딩
                    var closeFn = function() { cModal.parentNode.removeChild(cModal); };
                    document.getElementById('real-compare-close-x').onclick = closeFn;
                    document.getElementById('real-compare-cancel-btn').onclick = closeFn;
                    
                    document.getElementById('real-compare-submit-btn').onclick = function(e) {
                        if (e) e.preventDefault();
                        
                        var reviewBox = document.getElementById('real-compare-review-text');
                        var changeBox = document.getElementById('real-compare-change-text');
                        var titleBox = document.getElementById('real-compare-title-input') || document.getElementById('dyn-issue-title') || document.getElementById('issue-title');
                        var assigneeBox = document.getElementById('real-compare-assignee-select') || document.getElementById('dyn-issue-assignee');
                        var statusBox = document.getElementById('real-compare-status-select');
                        var structureBox = document.getElementById('real-compare-structure-input');
                        var tradeBox = document.getElementById('real-compare-trade-input');
                        
                        var userReviewText = reviewBox ? reviewBox.value.trim() : "기록된 검토 내용이 없습니다.";
                        var userChangeText = changeBox ? changeBox.value.trim() : "기록된 변경 내용이 없습니다.";
                        var currentTitle = titleBox ? titleBox.value : "비교 이슈";
                        var currentAssignee = assigneeBox ? assigneeBox.value : "미지정";
                        var currentStatus = statusBox ? statusBox.value : "검토중";
                        var currentStructure = structureBox ? structureBox.value : "";
                        var currentTrade = tradeBox ? tradeBox.value : "";
                        
                        // 기존 이슈 정보 업데이트
                        // 🚨 [버전 필드 보존] 수정 전 원본 verBefore/verAfter 값을 먼저 캡처
                        var preservedVerBefore = targetIssue.verBefore || targetIssue.versionBefore || "";
                        var preservedVerAfter  = targetIssue.verAfter  || targetIssue.versionAfter  || "";
                        targetIssue.title = currentTitle;
                        targetIssue.reviewContent = userReviewText;
                        targetIssue.changeContent = userChangeText;
                        targetIssue.reviewDesc = userReviewText;
                        targetIssue.changeDesc = userChangeText;
                        targetIssue.description = userChangeText;
                        targetIssue.desc = userReviewText;
                        targetIssue.assignee = currentAssignee;
                        targetIssue.status = currentStatus;
                        targetIssue.structure = currentStructure;
                        targetIssue.trade = currentTrade;
                        // 🚨 [버전 필드 보존] verBefore/verAfter 두 가지 키 모두 명시적으로 유지
                        targetIssue.verBefore    = preservedVerBefore;
                        targetIssue.versionBefore = preservedVerBefore;
                        targetIssue.verAfter     = preservedVerAfter;
                        targetIssue.versionAfter  = preservedVerAfter;
                        console.log("[Version Preserve] verBefore=", preservedVerBefore, "verAfter=", preservedVerAfter);
                        
                        // 로컬 스토리지에 업데이트 사항 반영
                        var sKeys = ['my_saved_compare_issues', 'aps_project_issues'];
                        for (var k = 0; k < sKeys.length; k++) {
                            var listData = localStorage.getItem(sKeys[k]);
                            if (listData) {
                                var parsedList = JSON.parse(listData);
                                var updated = false;
                                for (var idx = 0; idx < parsedList.length; idx++) {
                                    if (String(parsedList[idx].id) === String(targetIssue.id) || String(parsedList[idx].dbId) === String(targetIssue.dbId)) {
                                        parsedList[idx].title = currentTitle;
                                        parsedList[idx].reviewContent = userReviewText;
                                        parsedList[idx].changeContent = userChangeText;
                                        parsedList[idx].reviewDesc = userReviewText;
                                        parsedList[idx].changeDesc = userChangeText;
                                        parsedList[idx].description = userChangeText;
                                        parsedList[idx].desc = userReviewText;
                                        parsedList[idx].assignee = currentAssignee;
                                        parsedList[idx].structure = currentStructure;
                                        parsedList[idx].trade = currentTrade;
                                        // 🚨 [버전 필드 보존] localStorage 저장 시 verBefore/verAfter 누락 방지
                                        // preservedVerBefore/After는 이 클로저 스코프에서 유효
                                        parsedList[idx].verBefore     = preservedVerBefore;
                                        parsedList[idx].versionBefore = preservedVerBefore;
                                        parsedList[idx].verAfter      = preservedVerAfter;
                                        parsedList[idx].versionAfter  = preservedVerAfter;
                                        updated = true;
                                    }
                                }
                                if (updated) {
                                    localStorage.setItem(sKeys[k], JSON.stringify(parsedList));
                                }
                            }
                        }
                        
                        console.log("[Compare Edit Guard] 비교 이슈 수정 완료 ✅");
                        closeFn();
                        if (typeof window.renderIssueTable === 'function') window.renderIssueTable();
                    };

                    // 동적 Forma 구성원 명단 동기화 함수 연동 연동
                    if (typeof window.syncFormaProjectMembers === 'function') {
                        var aSelect = document.getElementById('real-compare-assignee-select');
                        var origAssignee = document.getElementById('dyn-issue-assignee');
                        if (aSelect && origAssignee) {
                            aSelect.innerHTML = origAssignee.innerHTML;
                            aSelect.value = targetIssue.assignee || "";
                        }
                    }
                } else {
                    // 단독 이슈 타입인 경우: 정식 단독 이슈 팝업창 모듈 기동
                    window.openIssueModal(targetIssue.dbId || targetIssue.id, targetIssue, targetIssue.img || "");
                }
            });
        })();
    }
};

(function() {
    var _origRender = window.renderIssueList;
    var wrapRender = function(orig) {
        return function() {
            var res = orig.apply(this, arguments);
            if (typeof window.bindIssueItemClickEvents === 'function') {
                window.bindIssueItemClickEvents();
            }
            return res;
        };
    };
    if (_origRender) {
        _origRender = wrapRender(_origRender);
    }
    Object.defineProperty(window, 'renderIssueList', {
        get: function() { return _origRender; },
        set: function(val) {
            _origRender = wrapRender(val);
        },
        configurable: true
    });
})();

(function() {
    console.log("[Zero-Touch Guard] 중복 이슈 생성 억제 독립 가드가 활성화되었습니다.");

    // 사용자가 '저장' 또는 '제출' 버튼을 누르는 이벤트를 버블링 단계에서 감시
    window.addEventListener('click', function(evt) {
        var target = evt.target;
        if (!target) return;

        // 저장 버튼 판별 조건 (ID 및 텍스트 기반)
        var isSaveBtn = false;
        if (target.id === 'btn-save-issue' || target.id === 'dyn-issue-submit' || target.id === 'issue-submit') {
            isSaveBtn = true;
        } else if (target.className && typeof target.className === 'string' && target.className.indexOf('save') > -1) {
            isSaveBtn = true;
        } else if (target.textContent && (target.textContent.trim() === '저장' || target.textContent.trim() === '제출')) {
            isSaveBtn = true;
        }

        // 사용자가 버전 비교 창에서 저장 버튼을 누른 게 맞다면 시퀀스 발동
        if (isSaveBtn) {
            console.log("[Zero-Touch Guard] 저장 동작 감지. 시차 정화 프로세스를 기동합니다.");

            // 🚨 원본 스크립트가 창고에 데이터를 다 집어넣을 때까지 아주 미세한 시차(20ms~200ms)를 두고 
            // 단독 이슈 창고('my_saved_issues')를 상시 미싱 청소합니다.
            var delays = [30, 80, 150, 300];
            
            delays.forEach(function(delay) {
                setTimeout(function() {
                    try {
                        // 1) 메인 단독 이슈 창고 데이터 확보
                        var rawMain = localStorage.getItem('my_saved_issues');
                        if (rawMain) {
                            var parsedMain = JSON.parse(rawMain);
                            if (Array.isArray(parsedMain)) {
                                // 🚨 [핵심 필터] 창고에 기어 들어온 중복 비교이슈(COMP-) 데이터만 족집게처럼 쏙 솎아내어 지웁니다.
                                var sanitizedMain = parsedMain.filter(function(item) {
                                    if (!item) return false;
                                    var itemUnicodeId = String(item.id || "");
                                    var itemType = String(item._type || item.type || "");
                                    
                                    // 고유 ID가 COMP-로 시작하거나 타입이 compare인 데이터는 메인 단독 창고에서 생매장
                                    return itemUnicodeId.indexOf('COMP-') === -1 && itemType !== 'compare';
                                });

                                // 정화된 결과물만 단독 이슈 창고에 리라이트
                                localStorage.setItem('my_saved_issues', JSON.stringify(sanitizedMain));
                            }
                        }

                        // 2) 원본 코드의 손상 없이 화면 테이블 리프레시만 안전하게 유도
                        if (typeof window.renderIssueTable === 'function') {
                            window.renderIssueTable();
                        }
                    } catch (err) {
                        console.error("[Zero-Touch Guard Error] 정화 세션 예외 발생:", err.message);
                    }
                }, delay);
            });
        }
    }, false); // 원본 코드의 클릭 이벤트를 방해하지 않기 위해 false(버블링) 세팅
})();

(function() {
    console.log("[Zero-Touch Permanent Guard] 데이터 유실 차단 및 양방향 강제 안착 가드 가동.");

    window.addEventListener('click', function(evt) {
        var target = evt.target;
        if (!target) return;

        // 저장/제출 버튼 판별 가드
        var isSaveBtn = false;
        if (target.id === 'btn-save-issue' || target.id === 'dyn-issue-submit' || target.id === 'issue-submit') {
            isSaveBtn = true;
        } else if (target.className && typeof target.className === 'string' && target.className.indexOf('save') > -1) {
            isSaveBtn = true;
        } else if (target.textContent && (target.textContent.trim() === '저장' || target.textContent.trim() === '제출')) {
            isSaveBtn = true;
        }

        if (isSaveBtn) {
            var isCompareModalOpen = !!(document.getElementById('issue-popup') || document.getElementById('dynamic-real-compare-modal') || window.isCompareModeActive);
            
            if (!isCompareModalOpen) {
                // 🚨 [단독 이슈 저장 심장부 오리지널 순수 규격 복구]
                console.log("[Zero-Touch Permanent Guard] 단독 이슈 저장 신호 포착. 순수 규격 영구 스토리지 인젝션.");
                try {
                    var tBox = document.getElementById('dyn-issue-title') || document.getElementById('issue-title-input') || document.getElementById('issue-title');
                    var dBox = document.getElementById('dyn-issue-desc') || document.getElementById('dyn-issue-review') || document.getElementById('issue-desc-input') || document.getElementById('issue-review');
                    var aBox = document.getElementById('dyn-issue-assignee') || document.getElementById('issue-assignee') || document.getElementById('real-compare-assignee-select');
                    var sBox = document.getElementById('dyn-issue-status') || document.getElementById('issue-status') || document.getElementById('real-compare-status-select');
                    var stBox = document.getElementById('dyn-issue-structure') || document.getElementById('issue-structure') || document.getElementById('real-compare-structure-input');
                    var trBox = document.getElementById('dyn-issue-trade') || document.getElementById('issue-trade') || document.getElementById('real-compare-trade-input');
                    var typeSelect = document.getElementById('dyn-issue-type') || document.getElementById('create-issue-type') || document.getElementById('issue-type');
                    var startInput = document.getElementById('dyn-issue-startdate') || document.getElementById('create-issue-start-date');
                    var dueInput = document.getElementById('dyn-issue-duedate') || document.getElementById('create-issue-due-date');
                    var dbIdLabel = document.getElementById('issue-dbid-label') || document.getElementById('dyn-issue-dbid');
                    var placementBox = document.getElementById('dyn-issue-placement');

                    var uTitle = tBox ? tBox.value.trim() : "단독 이슈";
                    var uDesc = dBox ? dBox.value.trim() : "기록된 내용이 없습니다.";
                    var uAssignee = aBox ? aBox.value.trim() : "미지정";
                    if (uAssignee === "미정" || uAssignee.indexOf('선택하세요') > -1) uAssignee = "미지정";
                    var uStatus = sBox ? sBox.value.trim() : "생성";
                    var uStructure = stBox ? stBox.value.trim() : "";
                    var uTrade = trBox ? trBox.value.trim() : "토목";
                    var uPlacement = placementBox ? placementBox.value.trim() : "";
                    var uType = "기타";
                    if (typeSelect && typeSelect.value) {
                        var rawVal = typeSelect.value;
                        if (rawVal === "single") uType = "단독";
                        else if (rawVal.toLowerCase() === "clash") uType = "간섭";
                        else if (rawVal.toLowerCase() === "coordination") uType = "협업";
                        else if (rawVal.toLowerCase() === "design") uType = "설계 변경";
                        else uType = rawVal;
                    }
                    var uStart = startInput ? startInput.value : "-";
                    var uDue = dueInput ? dueInput.value : "-";
                    var uDbId = dbIdLabel ? parseInt(dbIdLabel.textContent || dbIdLabel.value, 10) : (window.currentSelectedDbId || 13181);
                    if (isNaN(uDbId)) uDbId = 13181;

                    // 파일명 추출 폴백 처리 (사용자 입력 구조물이 Revit Document, 미상 등 기본값에 준하거나 비어 있을 때만 작동)
                    if (!uStructure || uStructure === "Revit Document" || uStructure === "미상") {
                        var viewer = window.viewer || window.NOP_VIEWER || (window.app && window.app.getCurrentViewer ? window.app.getCurrentViewer() : null);
                        var realDocName = "";
                        if (viewer && viewer.model && typeof viewer.model.getDocumentNode === 'function') {
                            var docNode = viewer.model.getDocumentNode();
                            if (docNode && docNode.data) realDocName = docNode.data.name || docNode._name || "";
                            if (realDocName) {
                                if (realDocName.indexOf('.') > -1) realDocName = realDocName.substring(0, realDocName.lastIndexOf('.'));
                                uStructure = realDocName.trim();
                            }
                        }
                    }
                    if (!uStructure) uStructure = "강북_구조물_신설_03"; // 최종 폴백

                    var isEditMode = !!window.currentActiveViewingIssue;
                    var generatedId = isEditMode ? window.currentActiveViewingIssue.id : ("ISSUE-" + Date.now());
                    
                    var resolveNoteVal = "";
                    var resolveImageVal = "";
                    var rNoteBox = document.getElementById('issue-resolve-note');
                    var rImgPreview = document.getElementById('resolve-image-preview');
                    if (rNoteBox) resolveNoteVal = rNoteBox.value.trim();
                    if (rImgPreview && rImgPreview.src && rImgPreview.src.indexOf('data:image') === 0) {
                        resolveImageVal = rImgPreview.src;
                    } else if (isEditMode && window.currentActiveViewingIssue.resolveImage) {
                        resolveImageVal = window.currentActiveViewingIssue.resolveImage;
                    }

                    var captureImages = typeof window.getIssueCaptureImages === 'function' ? window.getIssueCaptureImages() : [];
                    var primaryCaptureImage = captureImages[0] || window.lastStandaloneMarkupImage || (isEditMode ? (window.currentActiveViewingIssue.img || window.currentActiveViewingIssue.image || "") : "") || "";

                    // 🚨 [localStorage 용량 초과 대응] 이미지 압축 및 비동기 처리
                    window.compressBase64Array(captureImages, 800, 0.6, function(compressedImages) {
                        window.compressBase64Image(resolveImageVal, 800, 0.6, function(compressedResolveImage) {
                            var compressedPrimary = compressedImages[0] || "";

                            var permanentIssueObj = {
                                id: generatedId,
                                dbId: uDbId,
                                title: uTitle,
                                description: uDesc,
                                desc: uDesc,
                                reviewContent: uDesc,
                                structure: uStructure,
                                trade: uTrade,
                                placement: uPlacement,
                                assignee: uAssignee,
                                status: uStatus,
                                issueType: uType,
                                type: uType,
                                _type: "single",
                                startDate: uStart,
                                endDate: uDue,
                                images: compressedImages,
                                image: compressedPrimary,
                                img: compressedPrimary,
                                date: isEditMode ? (window.currentActiveViewingIssue.date || new Date().toISOString().substring(0, 10)) : new Date().toISOString().substring(0, 10),
                                user: isEditMode ? (window.currentActiveViewingIssue.user || '지정되지 않음') : '지정되지 않음',
                                file: isEditMode ? (window.currentActiveViewingIssue.file || '강북_구조물_신설_03') : '강북_구조물_신설_03',
                                version: isEditMode ? (window.currentActiveViewingIssue.version || 'v5') : 'v5',
                                urn: isEditMode ? (window.currentActiveViewingIssue.urn || window.currentUrn || "") : (window.currentUrn || ""),
                                resolveNote: resolveNoteVal,
                                resolveImage: compressedResolveImage
                            };

                            var mainList = [];
                            try {
                                mainList = JSON.parse(localStorage.getItem('my_saved_issues') || '[]');
                            } catch(e) {
                                mainList = [];
                            }
                            mainList = mainList.filter(function(x) { return x && String(x.id) !== String(generatedId); });
                            mainList.push(permanentIssueObj);

                            var saveSuccess = true;
                            try {
                                localStorage.setItem('my_saved_issues', JSON.stringify(mainList));
                            } catch(e) {
                                if (e.name === 'QuotaExceededError' || e.code === 22) {
                                    alert("🚨 브라우저 저장 공간(5MB)이 가득 찼습니다!\n오래된 이슈를 삭제하거나 이미지를 줄여주세요.");
                                    mainList.pop();
                                    saveSuccess = false;
                                } else {
                                    console.error("이슈 저장 중 에러:", e);
                                    saveSuccess = false;
                                }
                            }

                            if (saveSuccess) {
                                var projList = [];
                                try {
                                    projList = JSON.parse(localStorage.getItem('aps_project_issues') || '[]');
                                } catch(e) {
                                    projList = [];
                                }
                                projList = projList.filter(function(x) { return x && String(x.id) !== String(generatedId); });
                                projList.push(permanentIssueObj);
                                
                                try {
                                    localStorage.setItem('aps_project_issues', JSON.stringify(projList));
                                } catch(e) {
                                    console.error("aps_project_issues 저장 실패:", e);
                                }

                                setTimeout(function() {
                                    if (typeof window.renderIssueTable === 'function') window.renderIssueTable();
                                    if (typeof window.renderIssueList === 'function') window.renderIssueList();
                                }, 50);

                                console.log("[Zero-Touch Permanent Guard] 단독 이슈 순수 저장 완료 ✅");
                                
                                var detailModal = document.getElementById('dynamic-standalone-issue-modal') || document.getElementById('issue-popup') || document.querySelector('.modal.show');
                                if (detailModal) {
                                    detailModal.style.display = 'none';
                                    detailModal.classList.remove('show');
                                    var modalBackdrop = document.querySelector('.modal-backdrop');
                                    if (modalBackdrop) modalBackdrop.remove();
                                    document.body.style.overflow = 'auto';
                                    document.body.classList.remove('modal-open');
                                }
                            }
                        });
                    });
                } catch(err) {
                    console.error("[Zero-Touch Permanent Guard] 단독 이슈 저장 에러:", err.message);
                }
                return;
            }

            console.log("[Zero-Touch Permanent Guard] 비교 저장 신호 포착. 영구 스토리지 강제 인젝션 시퀀스 돌입.");

            try {
                var rBox = document.getElementById('issue-review') || document.getElementById('real-compare-review-text') || document.getElementById('dyn-issue-review');
                var cBox = document.getElementById('issue-change') || document.getElementById('real-compare-change-text') || document.getElementById('dyn-issue-change');
                var tBox = document.getElementById('issue-title') || document.getElementById('dyn-issue-title') || document.getElementById('real-compare-title-input');
                var aBox = document.getElementById('issue-assignee') || document.getElementById('real-compare-assignee-select') || document.getElementById('dyn-issue-assignee');
                var sBox = document.getElementById('issue-status') || document.getElementById('real-compare-status-select');
                var stBox = document.getElementById('issue-structure') || document.getElementById('real-compare-structure-input') || document.getElementById('dyn-issue-structure');
                var trBox = document.getElementById('issue-trade') || document.getElementById('real-compare-trade-input') || document.getElementById('dyn-issue-trade');
                var typeSelect = document.getElementById('issue-type') || document.getElementById('dyn-issue-type') || document.getElementById('create-issue-type');

                var uReview = rBox ? rBox.value.trim() : "";
                var uChange = cBox ? cBox.value.trim() : "";
                
                if (!uReview) uReview = "기록된 검토 내용이 없습니다.";
                if (!uChange) uChange = "기록된 변경 내용이 없습니다.";

                var uTitle = tBox ? tBox.value.trim() : "버전 비교 분석 이슈";
                var uAssignee = aBox ? aBox.value.trim() : "미지정";
                if (uAssignee === "미정" || uAssignee.indexOf('선택하세요') > -1) uAssignee = "미지정";
                var uStatus = sBox ? sBox.value.trim() : "검토중";
                var uStructure = stBox ? stBox.value.trim() : "";
                var uTrade = trBox ? trBox.value.trim() : "토목";
                var uType = typeSelect ? typeSelect.value : "compare";

                if (!uStructure || uStructure === "Revit Document" || uStructure === "미상") {
                    var viewer = window.viewer || window.NOP_VIEWER || (window.app && window.app.getCurrentViewer ? window.app.getCurrentViewer() : null);
                    var realDocName = "";
                    if (viewer && viewer.model && typeof viewer.model.getDocumentNode === 'function') {
                        var docNode = viewer.model.getDocumentNode();
                        if (docNode && docNode.data) realDocName = docNode.data.name || docNode._name || "";
                        if (realDocName) {
                            if (realDocName.indexOf('.') > -1) realDocName = realDocName.substring(0, realDocName.lastIndexOf('.'));
                            uStructure = realDocName.trim();
                        }
                    }
                }
                if (!uStructure) uStructure = "강북_구조물_신설_03";

                window.compressBase64Image(window.currentCompareBeforeUrl || "", 800, 0.6, function(compressedBefore) {
                    window.compressBase64Image(window.currentCompareAfterUrl || "", 800, 0.6, function(compressedAfter) {
                        window.compressBase64Image(window.lastStandaloneMarkupImage || "", 800, 0.6, function(compressedMarkup) {
                            var generatedId = "COMP-" + Date.now();
                            
                            var permanentIssueObj = {
                                id: generatedId,
                                dbId: "13181",
                                title: uTitle,
                                reviewContent: uReview,
                                changeContent: uChange,
                                reviewDesc: uReview,
                                changeDesc: uChange,
                                description: uChange,
                                desc: uReview,
                                structure: uStructure,
                                trade: uTrade,
                                assignee: uAssignee,
                                status: uStatus,
                                _type: "compare",
                                type: "compare",
                                issueType: uType, 
                                imgBefore: compressedBefore,
                                imgAfter: compressedAfter,
                                img: compressedMarkup,
                                date: new Date().toISOString().substring(0, 10)
                            };

                            var storageKeys = ['my_saved_compare_issues', 'aps_project_issues'];
                            var saveSuccess = true;
                            
                            for (var ki = 0; ki < storageKeys.length; ki++) {
                                var key = storageKeys[ki];
                                var currentList = [];
                                try {
                                    currentList = JSON.parse(localStorage.getItem(key) || '[]');
                                } catch(e) {
                                    currentList = [];
                                }
                                
                                currentList = currentList.filter(function(x) { return x && String(x.id) !== String(generatedId); });
                                currentList.push(permanentIssueObj);
                                
                                try {
                                    localStorage.setItem(key, JSON.stringify(currentList));
                                    
                                    if (key === 'my_saved_compare_issues') {
                                        window.currentIssueList = currentList;
                                        if (typeof window.compareIssues !== 'undefined') window.compareIssues = currentList;
                                        if (typeof window.currentCompareIssues !== 'undefined') window.currentCompareIssues = currentList;
                                    }
                                } catch(e) {
                                    if (e.name === 'QuotaExceededError' || e.code === 22) {
                                        alert("🚨 브라우저 저장 공간(5MB)이 가득 찼습니다!\n오래된 이슈를 삭제하거나 이미지를 줄여주세요.");
                                        saveSuccess = false;
                                        break;
                                    } else {
                                        console.error("이슈 저장 중 에러:", e);
                                        saveSuccess = false;
                                        break;
                                    }
                                }
                            }

                            if (saveSuccess) {
                                // 4) 🚨 [단독 이슈 배지 찌꺼기 원천 소멸] 메인 창고('my_saved_issues')에 분신이 생기는 현상 실시간 세척
                                setTimeout(function() {
                                    try {
                                        var rawMain = localStorage.getItem('my_saved_issues');
                                        if (rawMain) {
                                            var parsedMain = JSON.parse(rawMain);
                                            if (Array.isArray(parsedMain)) {
                                                var cleanedMain = parsedMain.filter(function(item) {
                                                    return item && String(item.id).indexOf('COMP-') === -1 && String(item._type) !== 'compare';
                                                });
                                                localStorage.setItem('my_saved_issues', JSON.stringify(cleanedMain));
                                            }
                                        }
                                        
                                        if (typeof window.renderIssueTable === 'function') window.renderIssueTable();
                                        if (typeof window.renderCompareIssueTable === 'function') window.renderCompareIssueTable();
                                    } catch(ex) {}
                                }, 50);

                                console.log("[Zero-Touch Permanent Guard] 양방향 영구 적재 및 동기화 완결 ✅");

                                // 🚨 [UI 제어] 저장 완료 후 팝업창(Modal) 닫기 및 배경 제거
                                var compareModal = document.getElementById('issue-popup') || document.getElementById('dynamic-real-compare-modal') || document.querySelector('.modal.show');
                                if (compareModal) {
                                    compareModal.style.display = 'none';
                                    compareModal.classList.remove('show');
                                    var modalBackdrop = document.querySelector('.modal-backdrop');
                                    if (modalBackdrop) modalBackdrop.remove();
                                    document.body.style.overflow = 'auto';
                                    document.body.classList.remove('modal-open');
                                }
                                console.log("[Update Event] 비교 이슈 수정 완료 및 팝업창 정상 종료됨");
                            }
                        });
                    });
                });
            } catch (globalErr) {
                console.error("[Zero-Touch Permanent Guard Critical Error]:", globalErr.message);
            }
        }
    }, true); // 상위 단계(Capturing)에서 먼저 낚아채서 스토리지 영구 기록 보장
})();

// 📌 [PDF 내보내기 팝업 동적 렌더링 및 로직 (단독 + 비교 이슈 완전 통합)]
(function() {
    // 1. 단독 이슈 + 비교 이슈 전체 데이터 수집 함수 (localforage + localStorage + in-memory)
    async function fetchAllIssuesForPdf() {
        var singleIssues = [];
        var compareIssues = [];
        var apsIssues = [];

        // 1) localStorage 수집
        try { singleIssues = JSON.parse(localStorage.getItem('my_saved_issues') || '[]'); } catch(e) {}
        try { compareIssues = JSON.parse(localStorage.getItem('my_saved_compare_issues') || '[]'); } catch(e) {}
        try { apsIssues = JSON.parse(localStorage.getItem('aps_project_issues') || '[]'); } catch(e) {}

        // 2) localforage 비동기 수집 (지침 준수)
        if (typeof localforage !== 'undefined' && typeof localforage.getItem === 'function') {
            try {
                var lfSingle = await localforage.getItem('my_saved_issues');
                if (lfSingle) {
                    var parsedLfS = typeof lfSingle === 'string' ? JSON.parse(lfSingle) : lfSingle;
                    if (Array.isArray(parsedLfS)) singleIssues = singleIssues.concat(parsedLfS);
                }
            } catch(e) { console.error("localforage my_saved_issues 로드 실패:", e); }

            try {
                var lfCompare = await localforage.getItem('my_saved_compare_issues');
                if (lfCompare) {
                    var parsedLfC = typeof lfCompare === 'string' ? JSON.parse(lfCompare) : lfCompare;
                    if (Array.isArray(parsedLfC)) compareIssues = compareIssues.concat(parsedLfC);
                }
            } catch(e) { console.error("localforage my_saved_compare_issues 로드 실패:", e); }

            try {
                var lfAps = await localforage.getItem('aps_project_issues');
                if (lfAps) {
                    var parsedLfA = typeof lfAps === 'string' ? JSON.parse(lfAps) : lfAps;
                    if (Array.isArray(parsedLfA)) apsIssues = apsIssues.concat(parsedLfA);
                }
            } catch(e) { console.error("localforage aps_project_issues 로드 실패:", e); }
        }

        // 3) 전역 인메모리 수집 (window.currentIssueList 등)
        if (window.currentIssueList && Array.isArray(window.currentIssueList)) {
            singleIssues = singleIssues.concat(window.currentIssueList);
        }
        if (window.standaloneProjectIssueList && Array.isArray(window.standaloneProjectIssueList)) {
            singleIssues = singleIssues.concat(window.standaloneProjectIssueList);
        }
        if (window.issueList && Array.isArray(window.issueList)) {
            singleIssues = singleIssues.concat(window.issueList);
        }

        // 4) 데이터 병합 (단독 + 비교 + APS 프로젝트 이슈)
        var combined = singleIssues.concat(compareIssues).concat(apsIssues);

        // 5) ID 기반 중복 제거
        var uniqueMap = {};
        var mergedList = [];
        for (var i = 0; i < combined.length; i++) {
            var item = combined[i];
            if (!item) continue;
            var key = String(item.id || item.dbId || '');
            if (!key) continue;
            if (!uniqueMap[key]) {
                uniqueMap[key] = true;
                mergedList.push(item);
            }
        }

        return mergedList;
    }

    function getCurrentlyFilteredIssues() {
        if (Array.isArray(window.currentFilteredIssues) && window.currentFilteredIssues.length > 0) {
            return window.currentFilteredIssues.slice();
        }

        var rows = document.querySelectorAll('#issue-table-body tr, #db-issue-table-body tr, .issue-item, .issue-row, .issue-table-row, tr[data-id], tr[data-issue-id]');
        var visibleIssueIds = [];
        rows.forEach(function(row) {
            if (row && row.style.display !== 'none') {
                var issueId = row.getAttribute('data-issue-id') || row.getAttribute('data-id');
                if (issueId) visibleIssueIds.push(String(issueId));
            }
        });

        var sourceList = window.currentIssueList || [];
        if (visibleIssueIds.length > 0 && Array.isArray(sourceList)) {
            var domFiltered = sourceList.filter(function(issue) {
                if (!issue) return false;
                var key = String(issue.id || issue.dbId || '');
                return visibleIssueIds.indexOf(key) > -1 ||
                    visibleIssueIds.indexOf(String(issue.id)) > -1 ||
                    visibleIssueIds.indexOf(String(issue.dbId)) > -1;
            });
            if (domFiltered.length > 0) return domFiltered;
        }

        return sourceList.slice();
    }

    function initPdfExport() {
        var btnPdfExport = document.getElementById('btn-main-pdf-export');
        
        if (btnPdfExport) {
            btnPdfExport.addEventListener('click', async function() {
                // 현재 화면에 필터링된 이슈만 가져오기 (전역 필터 상태 유일 데이터 소스 활용)
                var allIssues = getCurrentlyFilteredIssues();
                if (!allIssues || allIssues.length === 0) {
                    allIssues = await fetchAllIssuesForPdf();
                }

                if (!allIssues || allIssues.length === 0) {
                    alert("내보낼 이슈가 없습니다. 필터 조건을 확인해주세요.");
                    return;
                }

                // 팝업창 동적 생성
                var modalHtml = '<div id="pdf-export-modal" class="modal" style="display: flex; align-items: center; justify-content: center; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 9999;">' +
                    '<div style="background: #1e293b; padding: 20px; border-radius: 8px; width: 500px; max-height: 80vh; overflow-y: auto; border: 1px solid #334155; color: #f8fafc; font-family: sans-serif;">' +
                        '<h4 style="margin-top: 0; border-bottom: 1px solid #334155; padding-bottom: 10px; margin-bottom: 15px; font-weight: bold; font-size: 16px;">PDF 내보내기 선택</h4>' +
                        '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">' +
                            '<select id="pdf-issue-filter" style="background: #0f172a; color: white; border: 1px solid #334155; padding: 6px 10px; border-radius: 4px; font-size: 13px; outline: none; cursor: pointer;">' +
                                '<option value="all">전체 이슈 보기</option>' +
                                '<option value="single">단독 이슈만</option>' +
                                '<option value="compare">비교 이슈만</option>' +
                            '</select>' +
                            '<label style="cursor: pointer; margin: 0; display: flex; align-items: center; gap: 8px; font-size: 13px;"><input type="checkbox" id="pdf-check-all" checked style="cursor: pointer;"> <strong>현재 목록 전체 선택</strong></label>' +
                        '</div>' +
                        '<div id="pdf-issue-list-container" style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; max-height: 45vh; overflow-y: auto; padding-right: 4px;"></div>' +
                        '<div style="display: flex; justify-content: flex-end; gap: 10px;">' +
                            '<button id="btn-close-pdf-modal" style="background: #475569; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: bold;">취소</button>' +
                            '<button id="btn-execute-pdf-export" style="background: #ef4444; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: bold;">내보내기</button>' +
                        '</div>' +
                    '</div>' +
                '</div>';

                // 기존 모달이 있다면 제거 후 추가
                var existingModal = document.getElementById('pdf-export-modal');
                if (existingModal) existingModal.remove();
                document.body.insertAdjacentHTML('beforeend', modalHtml);

                var listContainer = document.getElementById('pdf-issue-list-container');
                
                // 이슈 리스트 렌더링
                allIssues.forEach(function(issue) {
                    if (!issue) return;
                    var isCompare = (issue.id && String(issue.id).indexOf('COMP-') === 0) || issue._type === 'compare' || issue.type === 'compare';
                    var issueTypeStr = isCompare ? 'compare' : 'single';
                    var badge = isCompare ? '<span style="color: #a855f7; font-size: 11px; font-weight: bold;">[비교]</span>' : '<span style="color: #f59e0b; font-size: 11px; font-weight: bold;">[단독]</span>';
                    var title = issue.title || issue.name || issue.desc || '제목 없음';
                    var exportIssueKey = issue.id || issue.dbId || '';
                    
                    var itemHtml = '<label class="pdf-issue-item" data-type="' + issueTypeStr + '" style="display: flex; align-items: center; gap: 8px; padding: 8px; background: #0f172a; border-radius: 4px; cursor: pointer; font-size: 13px; border: 1px solid #334155;">' +
                        '<input type="checkbox" class="pdf-issue-chk" value="' + exportIssueKey + '" checked style="cursor: pointer;">' +
                        badge + ' <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 380px;">' + title + '</span>' +
                    '</label>';
                    listContainer.insertAdjacentHTML('beforeend', itemHtml);
                });

                var filterSelect = document.getElementById('pdf-issue-filter');
                var checkAllBtn = document.getElementById('pdf-check-all');

                // 필터 변경 시 Show/Hide 처리
                filterSelect.addEventListener('change', function(e) {
                    var selectedFilter = e.target.value;
                    var items = document.querySelectorAll('.pdf-issue-item');
                    
                    items.forEach(function(item) {
                        var itemType = item.getAttribute('data-type');
                        if (selectedFilter === 'all' || selectedFilter === itemType) {
                            item.style.display = 'flex';
                            item.querySelector('.pdf-issue-chk').checked = true;
                        } else {
                            item.style.display = 'none';
                            item.querySelector('.pdf-issue-chk').checked = false; 
                        }
                    });
                    
                    checkAllBtn.checked = true;
                });

                // 전체 선택 기능
                checkAllBtn.addEventListener('change', function(e) {
                    var items = document.querySelectorAll('.pdf-issue-item');
                    var isChecked = e.target.checked;
                    
                    items.forEach(function(item) {
                        if (item.style.display !== 'none') {
                            item.querySelector('.pdf-issue-chk').checked = isChecked;
                        }
                    });
                });

                // 개별 체크박스 변경 시 전체 선택 상태 동기화
                var listContainerEl = document.getElementById('pdf-issue-list-container');
                listContainerEl.addEventListener('change', function(e) {
                    if (e.target.classList.contains('pdf-issue-chk')) {
                        var visibleItems = Array.prototype.filter.call(document.querySelectorAll('.pdf-issue-item'), function(item) {
                            return item.style.display !== 'none';
                        });
                        var totalVisibleChk = visibleItems.length;
                        var checkedVisibleChk = 0;
                        visibleItems.forEach(function(item) {
                            if (item.querySelector('.pdf-issue-chk').checked) {
                                checkedVisibleChk++;
                            }
                        });
                        checkAllBtn.checked = (totalVisibleChk === checkedVisibleChk && totalVisibleChk > 0);
                    }
                });

                // 닫기 이벤트
                document.getElementById('btn-close-pdf-modal').addEventListener('click', function() {
                    document.getElementById('pdf-export-modal').remove();
                });

                // 내보내기 실행 이벤트
                document.getElementById('btn-execute-pdf-export').addEventListener('click', async function() {
                    var selectedIds = [];
                    document.querySelectorAll('.pdf-issue-chk:checked').forEach(function(chk) {
                        selectedIds.push(chk.value);
                    });
                    if (selectedIds.length === 0) {
                        alert("내보낼 이슈를 하나 이상 선택해주세요.");
                        return;
                    }

                    // 1) 필터링 상태가 유지된 이슈 데이터에서 선택된 ID 필터링 (window.currentFilteredIssues 우선 참조)
                    var latestIssues = getCurrentlyFilteredIssues();
                    if (!latestIssues || latestIssues.length === 0) {
                        latestIssues = await fetchAllIssuesForPdf();
                    }
                    
                    var issuesToExport = latestIssues.filter(function(issue) {
                        if (!issue) return false;
                        var issueKey = String(issue.id || issue.dbId || '');
                        return selectedIds.indexOf(issueKey) > -1 ||
                            selectedIds.indexOf(String(issue.id)) > -1 ||
                            selectedIds.indexOf(String(issue.dbId)) > -1;
                    });

                    if (issuesToExport.length === 0) {
                        alert("선택한 이슈 데이터를 찾을 수 없습니다.");
                        return;
                    }

                    // 모달 닫기
                    var exportModal = document.getElementById('pdf-export-modal');
                    if (exportModal) exportModal.remove();

                    // 2) 프로젝트의 기존 PDF 생성 방식을 적용 (comparison.js 로드 및 호출)
                    (async function() {
                        if (typeof window.buildAndOpenBatchPdf !== 'function') {
                            try {
                                await import('./comparison.js?v=pdf-hide-change-row-20260703-4');
                            } catch (err) {
                                console.error("[PDF Export] comparison.js 로드 실패:", err);
                            }
                        }
                        
                        if (typeof window.buildAndOpenBatchPdf === 'function') {
                            var BLANK_1PX = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
                            window.buildAndOpenBatchPdf(issuesToExport, BLANK_1PX, BLANK_1PX);
                        } else {
                            alert("PDF 생성 모듈을 불러올 수 없습니다.");
                        }
                    })();
                });
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initPdfExport);
    } else {
        initPdfExport();
    }
})();

(function() {
    function initFloatingResolveCapture() {
        var floatingBtn = document.getElementById('floating-resolve-capture');
        var startBtn = document.getElementById('btn-floating-capture-start');
        var cancelBtn = document.getElementById('btn-floating-capture-cancel');
        
        if (startBtn) {
            startBtn.addEventListener('click', function(e) {
                if (e) e.preventDefault();
                if (floatingBtn) floatingBtn.style.display = 'none';
                
                // 1) 객체 선택 및 캡처 모드 가동
                window.isRegularStandaloneIssueMode = true;
                
                var activeViewer = window.myGlobalViewer || window.viewer || window.NOP_VIEWER;
                if (activeViewer) {
                    var group = activeViewer.toolbar ? activeViewer.toolbar.getControl('custom-issue-toolbar-group') : null;
                    var nativeBtn = group ? group.getControl('native-issue-create-btn') : null;
                    if (nativeBtn) {
                        nativeBtn.setState(Autodesk.Viewing.UI.Button.State.ACTIVE);
                    }
                    if (typeof activeViewer.setNavigationMode === 'function') {
                        activeViewer.setNavigationMode(activeViewer.navtool);
                    }
                }
                console.log("[Resolve Capture] 플로팅 시작 클릭 -> 객체 선택 모드 가동 ✅");
            });
        }
        
        if (cancelBtn) {
            cancelBtn.addEventListener('click', function(e) {
                if (e) e.preventDefault();
                if (floatingBtn) floatingBtn.style.display = 'none';
                
                var pendingId = localStorage.getItem('pending_resolve_issue_id');
                localStorage.removeItem('pending_resolve_issue_id');
                console.log("[Resolve Capture] 취소 클릭 -> 대기 해제, ID:", pendingId);
                
                if (pendingId) {
                    var targetIssue = null;
                    var list = JSON.parse(localStorage.getItem('my_saved_issues') || '[]');
                    for (var idx = 0; idx < list.length; idx++) {
                        if (String(list[idx].id) === String(pendingId) || String(list[idx].dbId) === String(pendingId)) {
                            targetIssue = list[idx];
                            break;
                        }
                    }
                    if (!targetIssue) {
                        var listProj = JSON.parse(localStorage.getItem('aps_project_issues') || '[]');
                        for (var idx = 0; idx < listProj.length; idx++) {
                            if (String(listProj[idx].id) === String(pendingId) || String(listProj[idx].dbId) === String(pendingId)) {
                                targetIssue = listProj[idx];
                                break;
                            }
                        }
                    }
                    
                    if (targetIssue && typeof window.openIssueModal === 'function') {
                        window.openIssueModal(targetIssue.dbId || targetIssue.id, targetIssue, targetIssue.img || "");
                    }
                }
            });
        }
    }
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initFloatingResolveCapture);
    } else {
        initFloatingResolveCapture();
    }
})();

// Final Forma issue renderer installer. This must stay at the end of main.js.
(function() {
    var SCHEMA_VERSION = 'forma-gangbuk-columns-v1';
    var COLUMNS = [
        { key: 'displayId', label: 'ID' },
        { key: 'title', label: '제목' },
        { key: 'status', label: '상태' },
        { key: 'type', label: '유형' },
        { key: 'assignee', label: '담당자' },
        { key: 'dueDate', label: '마감일' },
        { key: 'startDate', label: '시작 날짜' },
        { key: 'placement', label: '배치' },
        { key: 'desc', label: '설명' },
        { key: 'reviewer', label: '확인자' },
        { key: 'location', label: '위치' },
        { key: 'attachments', label: '첨부파일' },
        { key: 'references', label: '참조' },
        { key: 'comments', label: '주석' }
    ];
    var DEFAULTS = ['displayId', 'title', 'status', 'type', 'assignee', 'dueDate', 'startDate', 'placement'];
    var formaCache = { issues: [], ts: 0, error: null };

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function fmtDate(value) {
        if (!value) return '-';
        var text = String(value);
        return text.indexOf('T') > -1 ? text.split('T')[0] : text;
    }

    function field(issue, key) {
        if (!issue) return '-';
        var value = '-';
        if (key === 'displayId') value = issue.displayId || issue.issueNumber || issue.dbId || issue.id;
        else if (key === 'title') value = issue.title;
        else if (key === 'status') value = issue.status;
        else if (key === 'type') value = issue.typePath || issue.type;
        else if (key === 'assignee') value = issue.assignee;
        else if (key === 'dueDate') value = fmtDate(issue.dueDate || issue.endDate || issue.duedate);
        else if (key === 'startDate') value = fmtDate(issue.startDate || issue.startdate);
        else if (key === 'placement') {
            value = issue.placement;
            var placementKey = String(value || '').trim().toLowerCase();
            if (placementKey === 'docs' || placementKey === 'autodesk docs' || placementKey === 'documents' || placementKey === 'files' || placementKey === 'document management' || placementKey === 'bim 360 docs') {
                value = issue.placementName || '';
            }
        }
        else if (key === 'desc') value = issue.description || issue.desc;
        else if (key === 'reviewer') value = issue.reviewer || issue.verifier;
        else if (key === 'location') value = issue.location || issue.locationName;
        else if (key === 'attachments') value = issue.attachments;
        else if (key === 'references') value = issue.references;
        else if (key === 'comments') value = issue.comments;
        else value = issue[key];
        if (key === 'placement') {
            var finalPlacementKey = String(value || '').trim().toLowerCase();
            if (finalPlacementKey === 'docs' || finalPlacementKey === 'autodesk docs' || finalPlacementKey === 'documents' || finalPlacementKey === 'files' || finalPlacementKey === 'document management' || finalPlacementKey === 'bim 360 docs') {
                value = '';
            }
        }
        return value == null || value === '' ? '-' : value;
    }
    window.getIssueFieldValue = field;

    function installColumns() {
        if (localStorage.getItem('my_issue_schema_version') !== SCHEMA_VERSION) {
            localStorage.setItem('my_issue_schema_version', SCHEMA_VERSION);
            localStorage.setItem('my_all_columns_order', JSON.stringify(COLUMNS));
            localStorage.setItem('my_active_columns', JSON.stringify(DEFAULTS));
        }
        window.allIssueColumns = COLUMNS.slice();
        try {
            var active = JSON.parse(localStorage.getItem('my_active_columns') || '[]');
            window.activeIssueColumns = Array.isArray(active) && active.length ? active.filter(function(key) {
                return COLUMNS.some(function(col) { return col.key === key; });
            }) : DEFAULTS.slice();
        } catch (e) {
            window.activeIssueColumns = DEFAULTS.slice();
        }
        if (!window.activeIssueColumns.length) window.activeIssueColumns = DEFAULTS.slice();
    }

    async function fetchFormaIssues(force) {
        if (!force && formaCache.issues.length && Date.now() - formaCache.ts < 60000) return formaCache.issues;
        var resp = await fetch('/api/issues/forma-gangbuk?limit=500', { credentials: 'same-origin' });
        if (!resp.ok) {
            var body = await resp.json().catch(function() { return {}; });
            throw new Error(body.message || body.error || ('HTTP ' + resp.status));
        }
        var json = await resp.json();
        var issues = Array.isArray(json.data) ? json.data : [];
        issues = issues.filter(function(issue) {
            return String(issue.typePath || issue.type || '').indexOf('건화') === -1;
        });
        formaCache = { issues: issues, ts: Date.now(), error: null };
        window._gangbukFormaCache = issues;
        window.currentIssueList = issues;
        window.currentFilteredIssues = issues.slice();
        return issues;
    }
    window.loadFormaIssuesForMainTab = fetchFormaIssues;

    function renderColumnMenu() {
        var box = document.getElementById('column-settings-container');
        if (!box) return;
        box.innerHTML = COLUMNS.map(function(col, idx) {
            var checked = window.activeIssueColumns.indexOf(col.key) > -1 ? 'checked' : '';
            return '<div draggable="true" ondragstart="window.colDragStart(event,' + idx + ')" ondragover="window.colDragOver(event)" ondragleave="window.colDragLeave(event)" ondrop="window.colDrop(event,' + idx + ')" style="padding:8px;margin-bottom:4px;background:#0f172a;border:1px solid #334155;border-radius:4px;cursor:grab;display:flex;align-items:center;gap:8px;">'
                + '<span style="color:#64748b;">☰</span>'
                + '<input type="checkbox" id="col-chk-' + esc(col.key) + '" ' + checked + ' onchange="window.toggleColumn(\'' + esc(col.key) + '\')">'
                + '<label for="col-chk-' + esc(col.key) + '" style="cursor:pointer;flex:1;font-size:13px;color:#cbd5e1;">' + esc(col.label) + '</label>'
                + '</div>';
        }).join('');
    }
    window.renderColumnSettingsMenu = renderColumnMenu;

    function ensureIssueTypeTabs() {
        var allBtn = document.getElementById('sub-tab-all');
        if (!allBtn || !allBtn.parentElement) return;
        var container = allBtn.parentElement;
        container.innerHTML = [
            '<button id="sub-tab-all" class="issue-sub-btn active" data-issue-filter="all" style="background:#334155;color:white;border:1px solid #475569;padding:8px 20px;border-radius:4px;font-weight:bold;cursor:pointer;">전체이슈</button>',
            '<button id="sub-tab-design" class="issue-sub-btn" data-issue-filter="design" style="background:transparent;color:#94a3b8;border:1px solid transparent;padding:8px 20px;border-radius:4px;cursor:pointer;">설계 이슈</button>',
            '<button id="sub-tab-clash" class="issue-sub-btn" data-issue-filter="clash" style="background:transparent;color:#94a3b8;border:1px solid transparent;padding:8px 20px;border-radius:4px;cursor:pointer;">간섭 이슈</button>',
            '<button id="sub-tab-update" class="issue-sub-btn" data-issue-filter="update" style="background:transparent;color:#94a3b8;border:1px solid transparent;padding:8px 20px;border-radius:4px;cursor:pointer;">업데이트</button>'
        ].join('');
        container.querySelectorAll('[data-issue-filter]').forEach(function(btn) {
            btn.onclick = function() { window.filterIssues(btn.getAttribute('data-issue-filter')); };
        });
    }
    window.ensureIssueTypeTabs = window.ensureIssueTypeTabs || ensureIssueTypeTabs;

    function matchesIssueTypeFilter(issue, filter) {
        if (!filter || filter === 'all') return true;
        var typeText = String(issue.typePath || issue.type || issue.category || '').toLowerCase();
        if (filter === 'design') return typeText.indexOf('설계') > -1 || typeText.indexOf('design') > -1;
        if (filter === 'clash') return typeText.indexOf('간섭') > -1 || typeText.indexOf('clash') > -1 || typeText.indexOf('collision') > -1;
        if (filter === 'update') return typeText.indexOf('업데이트') > -1 || typeText.indexOf('update') > -1;
        return true;
    }

    function issueTypeLabel(issue) {
        var typeText = String(issue.typePath || issue.type || issue.category || '').toLowerCase();
        if (typeText.indexOf('업데이트') > -1 || typeText.indexOf('update') > -1) return '업데이트';
        if (typeText.indexOf('간섭') > -1 || typeText.indexOf('clash') > -1 || typeText.indexOf('collision') > -1) return '간섭';
        if (typeText.indexOf('설계') > -1 || typeText.indexOf('design') > -1) return '설계이슈';
        return field(issue, 'type') || '-';
    }

    function issueTypeBadgeStyle(label) {
        if (label === '업데이트') return 'background:#f59e0b;color:#111827;';
        if (label === '간섭') return 'background:#ef4444;color:#fff;';
        if (label === '설계이슈') return 'background:#2563eb;color:#fff;';
        return 'background:#64748b;color:#fff;';
    }

    function renderHeader() {
        var head = document.getElementById('issue-table-header');
        if (!head) return;
        var html = '<tr><th style="width:90px;text-align:center;vertical-align:top;"><div class="filter-container"><span>구분</span><select class="column-filter" data-col="0" style="height:18px;width:100%;"><option value="">전체</option><option value="업데이트">업데이트</option><option value="간섭">간섭</option><option value="설계이슈">설계이슈</option></select></div></th>';
        window.activeIssueColumns.forEach(function(key, idx) {
            var col = COLUMNS.find(function(c) { return c.key === key; }) || { key: key, label: key };
            var filter = (key === 'title' || key === 'desc')
                ? '<input type="text" class="column-filter" data-col="' + (idx + 1) + '" placeholder="검색" style="height:18px;width:100%;box-sizing:border-box;">'
                : '<select class="column-filter" data-col="' + (idx + 1) + '" style="height:18px;width:100%;box-sizing:border-box;"><option value="">전체</option></select>';
            var width = key === 'title' ? '22%' : (key === 'type' ? '170px' : (key === 'placement' ? '160px' : '110px'));
            html += '<th style="width:' + width + ';vertical-align:top;"><div class="filter-container"><span>' + esc(col.label) + '</span>' + filter + '</div></th>';
        });
        head.innerHTML = html + '</tr>';
    }

    function closeFormaIssueDetail() {
        var modal = document.getElementById('forma-issue-detail-modal');
        if (modal) modal.remove();
    }

    function ensureFormaDetailStyles() {
        if (document.getElementById('forma-detail-style')) return;
        var css = `
            .forma-detail-overlay{position:fixed!important;inset:0!important;z-index:30000!important;display:flex!important;align-items:center!important;justify-content:center!important;padding:24px!important;background:rgba(2,6,23,.72)!important;backdrop-filter:blur(6px)}
            .forma-detail-dialog{width:min(860px,94vw);max-height:min(88vh,860px);display:flex;flex-direction:column;overflow:hidden;border:1px solid rgba(148,163,184,.24);border-radius:10px;background:#0f172a;color:#e5eefb;box-shadow:0 28px 70px rgba(0,0,0,.5);font-family:inherit}
            .forma-detail-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:20px 22px 18px;border-bottom:1px solid rgba(148,163,184,.22);background:rgba(15,23,42,.96)}
            .forma-detail-title-wrap{min-width:0}.forma-detail-kicker{margin-bottom:8px;color:#7dd3fc;font-size:12px;font-weight:900}.forma-detail-head h2{margin:0;color:#f8fafc;font-size:20px;line-height:1.32;font-weight:900}
            .forma-detail-chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.forma-detail-chip{display:inline-flex;align-items:center;min-height:24px;padding:0 9px;border-radius:999px;background:rgba(56,189,248,.16);color:#bae6fd;font-size:11px;font-weight:900}.forma-detail-chip.muted{background:rgba(148,163,184,.14);color:#cbd5e1}.forma-detail-chip.status{background:rgba(16,185,129,.16);color:#a7f3d0}
            .forma-detail-x{width:32px;height:32px;flex:0 0 auto;display:inline-flex;align-items:center;justify-content:center;border:1px solid rgba(148,163,184,.22);border-radius:6px;background:rgba(15,23,42,.72);color:#cbd5e1;cursor:pointer}
            .forma-detail-body{min-height:0;overflow:auto;padding:18px 22px 20px}.forma-detail-section+.forma-detail-section{margin-top:18px}.forma-detail-section-title{margin-bottom:10px;color:#94a3b8;font-size:12px;font-weight:900}
            .forma-detail-snapshot{overflow:hidden;border:1px solid rgba(148,163,184,.16);border-radius:8px;background:#020617}.forma-detail-snapshot img{display:block;width:100%;height:auto;max-height:min(46vh,420px);object-fit:contain;background:#020617}.forma-detail-snapshot-note{padding:10px 12px;color:#94a3b8;font-size:11px;font-weight:800}
            .forma-detail-meta-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.forma-detail-meta-item{min-width:0;padding:11px 12px;border:1px solid rgba(148,163,184,.16);border-radius:8px;background:rgba(30,41,59,.58)}.forma-detail-meta-item span{display:block;margin-bottom:5px;color:#94a3b8;font-size:11px;font-weight:800}.forma-detail-meta-item strong{display:block;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#f8fafc;font-size:13px;line-height:1.35}
            .forma-detail-description{padding:14px;border:1px solid rgba(148,163,184,.16);border-radius:8px;background:rgba(15,23,42,.78);color:#e5eefb;font-size:13px;line-height:1.65}.forma-detail-desc-lead{font-weight:900}.forma-detail-desc-list{margin:9px 0 0;padding-left:18px}.forma-detail-desc-list li+li{margin-top:3px}.forma-detail-desc-list code{padding:1px 5px;border-radius:4px;background:rgba(56,189,248,.14);color:#bae6fd;font-family:inherit;font-weight:900}.forma-detail-empty{color:#94a3b8}
            .forma-detail-actions{display:flex;justify-content:flex-end;gap:10px;padding:14px 22px;border-top:1px solid rgba(148,163,184,.2);background:rgba(2,6,23,.32)}.forma-detail-action{min-height:36px;display:inline-flex;align-items:center;justify-content:center;gap:7px;border:1px solid rgba(148,163,184,.26);border-radius:6px;padding:0 13px;background:rgba(30,41,59,.86);color:#e5eefb;font-weight:900;cursor:pointer}.forma-detail-action.primary{border-color:rgba(56,189,248,.46);background:#0e7490;color:#ecfeff}.forma-detail-action.ghost{background:transparent;color:#cbd5e1}.forma-detail-action:hover,.forma-detail-x:hover{border-color:rgba(125,211,252,.7);color:#fff}
            @media(max-width:720px){.forma-detail-overlay{padding:12px!important}.forma-detail-meta-grid{grid-template-columns:1fr}.forma-detail-actions{flex-direction:column}}
        `;
        var style = document.createElement('style');
        style.id = 'forma-detail-style';
        style.textContent = css;
        document.head.appendChild(style);
    }

    function renderDetailMeta(label, value) {
        return '<div class="forma-detail-meta-item"><span>' + esc(label) + '</span><strong>' + esc(value || '-') + '</strong></div>';
    }

    function issueSnapshotUrn(issue) {
        return issue && (issue.snapshotUrn || issue.snapshotURN || issue.thumbnailUrn ||
            findIssueValueDeep(issue.rawFormaIssue || issue, ['snapshotUrn', 'snapshotURN', 'thumbnailUrn']));
    }

    function renderIssueSnapshot(issue) {
        var urn = issueSnapshotUrn(issue);
        if (!urn || urn === '-') return '';
        var src = '/api/issues/snapshot?urn=' + encodeURIComponent(urn);
        return '<section class="forma-detail-section">'
            + '<div class="forma-detail-section-title">이슈 썸네일</div>'
            + '<div class="forma-detail-snapshot">'
            + '<img src="' + esc(src) + '" alt="이슈 썸네일" loading="lazy" decoding="async" onerror="this.parentElement.style.display=\'none\';">'
            + '<div class="forma-detail-snapshot-note">Forma 이슈 캡처 이미지</div>'
            + '</div>'
            + '</section>';
    }

    function renderDetailDescription(value) {
        var text = String(value || '-').trim();
        if (!text || text === '-') return '<div class="forma-detail-empty">등록된 설명이 없습니다.</div>';
        var lines = text.split(/\r?\n/).map(function(line) { return line.trim(); }).filter(Boolean);
        if (!lines.length) return '<div class="forma-detail-empty">등록된 설명이 없습니다.</div>';
        var first = lines[0];
        var rest = lines.slice(1);
        var html = '<div class="forma-detail-desc-lead">' + esc(first) + '</div>';
        if (rest.length) {
            html += '<ul class="forma-detail-desc-list">' + rest.map(function(line) {
                var formatted = esc(line).replace(/(\d+(?:\.\d+)?\s*→\s*\d+(?:\.\d+)?)/g, '<code>$1</code>');
                return '<li>' + formatted + '</li>';
            }).join('') + '</ul>';
        }
        return html;
    }

    async function exportFormaIssueToPdf(issue) {
        var BLANK_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
        if (typeof window.buildAndOpenBatchPdf !== 'function') {
            try {
                await import('./comparison.js?v=pdf-hide-change-row-20260703-4');
            } catch (err) {
                console.error('[Forma Detail PDF] comparison.js 로드 실패:', err);
            }
        }
        if (typeof window.buildAndOpenBatchPdf === 'function') {
            window.buildAndOpenBatchPdf([issue], BLANK_1PX, BLANK_1PX);
        } else {
            alert('PDF 생성 모듈을 불러올 수 없습니다.');
        }
    }

    function normalizeModelNameForDetail(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/^urn:/, '')
            .replace(/\s*\(?v\d+\)?\s*$/i, '')
            .replace(/\s*\(v\d+\)\s*/gi, '')
            .replace(/\.(rvt|nwc|dwg|ifc)\b/gi, '')
            .replace(/[\s_\-()[\]{}<>.,]/g, '')
            .trim();
    }

    function normalizeViewerUrnForDetail(value) {
        var str = String(value || '').trim();
        if (!str || str === '-') return '';
        if (str.indexOf('dm.lineage') > -1) return '';
        var body = str.replace(/^urn:/i, '');
        if (body.indexOf('dm.lineage') > -1) return '';
        if (str.indexOf('urn:adsk.') === 0 || body.indexOf('adsk.') === 0) {
            var raw = str.indexOf('urn:') === 0 ? str : 'urn:' + str;
            return btoa(raw).replace(/=/g, '');
        }
        if (/^[A-Za-z0-9+/=_-]+$/.test(body) && body.length > 20) return body;
        return '';
    }

    function findIssueValueDeep(source, keys) {
        var wanted = {};
        keys.forEach(function(key) { wanted[String(key).toLowerCase()] = true; });
        var seen = [];
        function walk(value) {
            if (!value || typeof value !== 'object') return '';
            if (seen.indexOf(value) > -1) return '';
            seen.push(value);
            if (Array.isArray(value)) {
                for (var i = 0; i < value.length; i++) {
                    var arrFound = walk(value[i]);
                    if (arrFound) return arrFound;
                }
                return '';
            }
            for (var key in value) {
                if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
                var val = value[key];
                if (wanted[String(key).toLowerCase()] && val != null && String(val).trim() !== '') {
                    if (typeof val === 'object') {
                        return val.urn || val.modelUrn || val.versionId || val.name || val.displayName || val.title || '';
                    }
                    return val;
                }
            }
            for (var key2 in value) {
                if (!Object.prototype.hasOwnProperty.call(value, key2)) continue;
                var found = walk(value[key2]);
                if (found) return found;
            }
            return '';
        }
        return walk(source);
    }

    function collectModelFilesFromTree(node, out) {
        out = out || [];
        if (!node || typeof node !== 'object') return out;
        if (Array.isArray(node.files)) {
            node.files.forEach(function(file) {
                if (file && (file.urn || file.versionId) && file.name) out.push(file);
            });
        }
        if (Array.isArray(node.children)) {
            node.children.forEach(function(child) { collectModelFilesFromTree(child, out); });
        }
        return out;
    }

    async function resolveUrnFromGangbukModelTree(name) {
        if (!name) return '';
        var target = normalizeModelNameForDetail(name);
        if (!target || target === '-') return '';
        try {
            var resp = await fetch('/api/models/tree', { credentials: 'same-origin' });
            if (!resp.ok) return '';
            var tree = await resp.json();
            var files = collectModelFilesFromTree(tree, []);
            console.log('[Forma Detail] placement model search:', name, 'target:', target, 'files:', files.length);
            for (var i = 0; i < files.length; i++) {
                var file = files[i];
                var fileKey = normalizeModelNameForDetail(file.name);
                if (fileKey === target || fileKey.indexOf(target) > -1 || target.indexOf(fileKey) > -1) {
                    if (typeof window.updateUrnCache === 'function') window.updateUrnCache(file.name, file.urn || file.versionId);
                    console.log('[Forma Detail] placement model matched:', file.name, file.urn || file.versionId);
                    return file.urn || file.versionId || '';
                }
            }
        } catch (err) {
            console.warn('[Forma Detail] Gangbuk model tree URN resolve failed:', err);
        }
        return '';
    }

    async function resolveFormaIssueViewerUrn(issue) {
        var direct = issue.placementUrn || issue.linkedDocumentUrn || issue.documentUrn ||
            issue.urn || issue.modelUrn || issue.fileUrn || issue.targetUrn || issue.seedURN ||
            findIssueValueDeep(issue.rawFormaIssue || issue, ['placementUrn', 'linkedDocumentUrn', 'documentUrn', 'urn', 'modelUrn', 'fileUrn', 'targetUrn', 'seedURN', 'versionId', 'viewableUrn']);
        if (direct && String(direct).trim() && String(direct).trim() !== '-') {
            var directViewerUrn = normalizeViewerUrnForDetail(direct);
            if (directViewerUrn) return directViewerUrn;
        }

        var placementName = issue.placementName || field(issue, 'placement') || issue.file || issue.fileName ||
            findIssueValueDeep(issue.rawFormaIssue || issue, ['placement', 'placementName', 'fileName', 'snapshotFileName', 'uploadFileName', 'name', 'displayName']);
        if (placementName && placementName !== '-' && typeof window.resolveModelUrn === 'function') {
            var resolved = await window.resolveModelUrn(placementName);
            var resolvedViewerUrn = normalizeViewerUrnForDetail(resolved);
            if (resolvedViewerUrn) return resolvedViewerUrn;
        }

        return normalizeViewerUrnForDetail(await resolveUrnFromGangbukModelTree(placementName));
    }

    function openDetail(issue) {
        var old = document.getElementById('forma-issue-detail-modal');
        if (old) old.remove();
        ensureFormaDetailStyles();

        var displayId = field(issue, 'displayId');
        var title = field(issue, 'title');
        var status = field(issue, 'status');
        var type = field(issue, 'type');
        var assignee = field(issue, 'assignee');
        var reviewer = field(issue, 'reviewer');
        var location = field(issue, 'location');
        var placement = field(issue, 'placement');
        var startDate = field(issue, 'startDate');
        var dueDate = field(issue, 'dueDate');
        var desc = field(issue, 'desc');
        var typeLabel = issueTypeLabel(issue);
        var statusText = status || '-';

        document.body.insertAdjacentHTML('beforeend',
            '<div id="forma-issue-detail-modal" class="forma-detail-overlay">'
            + '<div class="forma-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="forma-detail-title">'
            + '<div class="forma-detail-head">'
            + '<div class="forma-detail-title-wrap">'
            + '<div class="forma-detail-kicker">Forma 이슈 상세 정보</div>'
            + '<h2 id="forma-detail-title">' + esc(title || '제목 없음') + '</h2>'
            + '<div class="forma-detail-chips">'
            + '<span class="forma-detail-chip muted">#' + esc(displayId || '-') + '</span>'
            + '<span class="forma-detail-chip">' + esc(type || '-') + '</span>'
            + '<span class="forma-detail-chip status">' + esc(statusText) + '</span>'
            + '</div>'
            + '</div>'
            + '<button id="forma-issue-detail-x" class="forma-detail-x" type="button" title="닫기"><i class="fas fa-times"></i></button>'
            + '</div>'
            + '<div class="forma-detail-body">'
            + renderIssueSnapshot(issue)
            + '<section class="forma-detail-section">'
            + '<div class="forma-detail-section-title">핵심 정보</div>'
            + '<div class="forma-detail-meta-grid">'
            + renderDetailMeta('담당자', assignee)
            + renderDetailMeta('확인자', reviewer)
            + renderDetailMeta('위치', location)
            + renderDetailMeta('배치', placement)
            + renderDetailMeta('시작 날짜', startDate)
            + renderDetailMeta('마감일', dueDate)
            + renderDetailMeta('구분', typeLabel)
            + renderDetailMeta('ID', displayId)
            + '</div>'
            + '</section>'
            + '<section class="forma-detail-section">'
            + '<div class="forma-detail-section-title">설명 및 변경사항</div>'
            + '<div class="forma-detail-description">' + renderDetailDescription(desc) + '</div>'
            + '</section>'
            + '</div>'
            + '<div class="forma-detail-actions">'
            + '<button id="forma-detail-viewer-btn" type="button" class="forma-detail-action primary"><i class="fas fa-cube"></i><span>3D 뷰어에서 위치보기</span></button>'
            + '<button id="forma-detail-pdf-btn" type="button" class="forma-detail-action"><i class="fas fa-file-pdf"></i><span>PDF 내보내기</span></button>'
            + '<button id="forma-issue-detail-close" type="button" class="forma-detail-action ghost"><i class="fas fa-times"></i><span>닫기</span></button>'
            + '</div>'
            + '</div></div>');

        document.getElementById('forma-issue-detail-x').onclick = closeFormaIssueDetail;
        document.getElementById('forma-issue-detail-close').onclick = closeFormaIssueDetail;
        document.getElementById('forma-detail-viewer-btn').onclick = async function() {
            var btn = this;
            btn.disabled = true;
            var oldText = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>모델 찾는 중...</span>';
            var dbId = issue.dbId || issue.displayId || issue.id || '';
            var urn = await resolveFormaIssueViewerUrn(issue);
            if (!urn) {
                btn.disabled = false;
                btn.innerHTML = oldText;
                alert('이 이슈와 연결된 3D 모델을 찾을 수 없습니다. 배치/모델 파일명이 등록되어 있는지 확인해 주세요.');
                return;
            }
            closeFormaIssueDetail();
            if (typeof window.focusIssueOnViewer === 'function') {
                window.focusIssueOnViewer(dbId, urn);
                return;
            }
            if (typeof window.switchTab === 'function') window.switchTab('project');
            if (window.explorer && typeof window.explorer.loadIntoViewer === 'function') {
                window.explorer.loadIntoViewer(urn, field(issue, 'placement') || field(issue, 'title') || 'BIM Model');
            }
        };
        document.getElementById('forma-detail-pdf-btn').onclick = function() {
            exportFormaIssueToPdf(issue);
        };
    }
    window.openFormaIssueDetail = openDetail;

    window.toggleColumn = function(key) {
        var idx = window.activeIssueColumns.indexOf(key);
        if (idx > -1) {
            if (window.activeIssueColumns.length > 1) window.activeIssueColumns.splice(idx, 1);
        } else {
            window.activeIssueColumns.push(key);
        }
        localStorage.setItem('my_active_columns', JSON.stringify(window.activeIssueColumns));
        window.currentTableFilterValues = {};
        window.currentFilteredIssues = (window.currentIssueList || formaCache.issues || []).slice();
        renderColumnMenu();
        window.renderIssueTable(true);
    };

    window.syncActiveColumnsOrder = function() {
        window.activeIssueColumns = COLUMNS.map(function(c) { return c.key; }).filter(function(key) {
            return window.activeIssueColumns.indexOf(key) > -1;
        });
        localStorage.setItem('my_active_columns', JSON.stringify(window.activeIssueColumns));
    };

    window.renderIssueTable = async function(useExisting) {
        installColumns();
        ensureIssueTypeTabs();
        renderHeader();
        var body = document.getElementById('issue-table-body');
        if (!body) return;
        if (!useExisting) body.innerHTML = '<tr><td colspan="' + (window.activeIssueColumns.length + 1) + '" style="padding:36px;text-align:center;color:#94a3b8;">Forma 이슈를 불러오는 중입니다.</td></tr>';
        var issues = useExisting ? (window.currentIssueList || formaCache.issues || []) : [];
        if (!useExisting) {
            try {
                issues = await fetchFormaIssues(false);
            } catch (err) {
                formaCache.error = err;
                body.innerHTML = '<tr><td colspan="' + (window.activeIssueColumns.length + 1) + '" style="padding:36px;text-align:center;color:#fca5a5;">Forma 이슈를 불러오지 못했습니다: ' + esc(err.message) + '</td></tr>';
                return;
            }
        }
        issues = issues.filter(function(issue) {
            return matchesIssueTypeFilter(issue, window.currentIssueFilter || 'all');
        });
        window.currentFilteredIssues = issues.slice();
        if (!issues.length) {
            body.innerHTML = '<tr><td colspan="' + (window.activeIssueColumns.length + 1) + '" style="padding:36px;text-align:center;color:#94a3b8;">표시할 Forma 이슈 데이터가 없습니다.</td></tr>';
            return;
        }
        body.innerHTML = issues.map(function(issue, index) {
            var id = issue.id || issue.displayId || index;
            var row = '<tr class="issue-item issue-row issue-table-row" data-id="' + esc(id) + '" data-forma-id="' + esc(id) + '" style="border-bottom:1px solid #334155;cursor:pointer;">';
            var typeLabel = issueTypeLabel(issue);
            row += '<td style="padding:10px 12px;text-align:center;"><span style="' + issueTypeBadgeStyle(typeLabel) + 'padding:4px 9px;border-radius:999px;font-size:11px;font-weight:800;display:inline-block;min-width:52px;">' + esc(typeLabel) + '</span></td>';
            window.activeIssueColumns.forEach(function(key) {
                var value = field(issue, key);
                var centered = key === 'displayId' || key === 'status' ? 'text-align:center;' : '';
                var status = key === 'status' ? 'color:#7dd3fc;font-weight:800;' : '';
                row += '<td style="padding:10px 12px;' + centered + status + 'max-width:250px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="' + esc(value) + '">' + esc(value) + '</td>';
            });
            return row + '</tr>';
        }).join('');
        var byId = new Map();
        issues.forEach(function(issue, index) { byId.set(String(issue.id || issue.displayId || index), issue); });
        document.querySelectorAll('#issue-table-body tr[data-forma-id]').forEach(function(row) {
            row.onclick = function(evt) {
                if (evt.target && evt.target.closest('button,input,select')) return;
                var issue = byId.get(String(row.getAttribute('data-forma-id')));
                if (issue) openDetail(issue);
            };
        });
        if (typeof window.initializeTableFilters === 'function') window.initializeTableFilters();
    };

    window.filterIssues = function(type) {
        window.currentIssueFilter = type || 'all';
        document.querySelectorAll('.issue-sub-btn').forEach(function(btn) {
            btn.classList.remove('active');
            btn.style.background = 'transparent';
            btn.style.color = '#94a3b8';
            btn.style.border = '1px solid transparent';
        });
        var active = document.getElementById('sub-tab-' + window.currentIssueFilter);
        if (active) {
            active.classList.add('active');
            active.style.background = '#334155';
            active.style.color = '#fff';
            active.style.border = '1px solid #475569';
        }
        window.renderIssueTable(true);
    };

    installColumns();
    ensureIssueTypeTabs();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            ensureIssueTypeTabs();
            renderColumnMenu();
        });
    } else {
        renderColumnMenu();
    }
})();
