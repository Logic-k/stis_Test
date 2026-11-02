import { CATL, GUVAR, facilityKey, renderCatIcon } from './constants.js';
import { fmtDist } from './geo-utils.js';

/**
 * Escapes special HTML characters to prevent XSS.
 * @param {unknown} val
 * @returns {string}
 */
function escHtml(val) {
  if (val == null) return '';
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * InspectorPanel: Facility Verification & 3D Topographic Intelligence Card.
 * Allows educators and support coordinators to inspect welfare facilities in 3D,
 * evaluate elevation/slope walking conditions, verify signage via Roadview,
 * and seamlessly connect via phone and map navigation.
 */
export class InspectorPanel {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.container - Host container element (e.g. .inspector-host)
   * @param {() => void} [options.onClose] - Close panel callback
   * @param {(facility: Object, fromMap: boolean) => void} [options.onSelectFacility] - Sibling facility selection callback
   * @param {() => void} [options.onToggleOrbit] - 360-degree orbit rotation toggle callback
   * @param {(phone: string) => void} [options.onCopyPhone] - Copy phone number callback
   */
  constructor({ container, onClose, onSelectFacility, onToggleOrbit, onCopyPhone }) {
    this.container = container;
    this.onClose = onClose;
    this.onSelectFacility = onSelectFacility;
    this.onToggleOrbit = onToggleOrbit;
    this.onCopyPhone = onCopyPhone;
    this.state = null;

    this.bindEvents();
  }

  /**
   * Sets up delegated event listeners on the container.
   */
  bindEvents() {
    if (!this.container) return;

    this.container.addEventListener('click', (e) => {
      const target = /** @type {HTMLElement} */ (e.target);

      // Close button
      const closeBtn = target.closest('[data-action="close"]');
      if (closeBtn) {
        e.preventDefault?.();
        this.onClose?.();
        return;
      }

      // 360° Orbit toggle
      const orbitBtn = target.closest('[data-action="toggle-orbit"]');
      if (orbitBtn) {
        e.preventDefault?.();
        this.onToggleOrbit?.();
        return;
      }

      // Phone copy button
      const copyBtn = target.closest('[data-action="copy-phone"]');
      if (copyBtn) {
        e.preventDefault?.();
        const ph = copyBtn.getAttribute('data-copy-ph');
        if (ph) this.onCopyPhone?.(ph);
        return;
      }

      // Sibling facility chip click
      const siblingChip = target.closest('[data-action="select-sibling"]');
      if (siblingChip) {
        e.preventDefault?.();
        const key = siblingChip.getAttribute('data-key');
        if (key && this.state?.siblings) {
          const match = this.state.siblings.find(s => String(facilityKey(s)) === key);
          if (match) {
            this.onSelectFacility?.(match, true);
          }
        }
      }
    });
  }

  /**
   * Generates inline responsive SVG elevation profile chart for Busan topography.
   * @param {Object} school
   * @param {Object} facility
   * @param {Object} profile
   * @returns {string} SVG HTML string
   */
  renderElevationSvg(school, facility, profile) {
    const rawSamples = Array.isArray(profile.samples) ? profile.samples : [];
    const samples = rawSamples.map(s => (typeof s === 'number' ? s : (s.elev ?? s.y ?? 0)));

    if (samples.length < 2) {
      return '';
    }

    const viewBoxW = 320;
    const viewBoxH = 78;
    const padL = 36;
    const padR = 36;
    const padT = 18;
    const padB = 22;
    const chartW = viewBoxW - padL - padR;
    const chartH = viewBoxH - padT - padB;

    const minElev = profile.minElev ?? Math.min(...samples);
    const maxElev = profile.maxElev ?? Math.max(...samples);
    const startElev = profile.startElev ?? samples[0];
    const endElev = profile.endElev ?? samples[samples.length - 1];

    // Maintain a minimum scale range (12m) to avoid flat zero-division lines
    const elevRange = Math.max(12, maxElev - minElev);

    const points = samples.map((elev, i) => {
      const x = padL + (i / (samples.length - 1)) * chartW;
      const y = padT + (1 - (elev - minElev) / elevRange) * chartH;
      return { x, y, elev };
    });

    const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const lastX = points[points.length - 1].x.toFixed(1);
    const firstX = points[0].x.toFixed(1);
    const bottomY = (padT + chartH).toFixed(1);
    const areaD = `${pathD} L ${lastX},${bottomY} L ${firstX},${bottomY} Z`;

    // Locate the peak elevation point
    let peakIdx = 0;
    let peakVal = -Infinity;
    samples.forEach((val, i) => {
      if (val > peakVal) {
        peakVal = val;
        peakIdx = i;
      }
    });
    const peak = points[peakIdx];
    const peakLabelY = Math.max(11, peak.y - 6).toFixed(1);

    const gradId = `stis-elev-grad-${facilityKey(facility) || 'default'}`;

    return `
      <div class="elev-chart-wrap" aria-label="학교와 기관 간 지형 고도 단면도">
        <svg viewBox="0 0 ${viewBoxW} ${viewBoxH}" class="elev-chart-svg" role="img">
          <defs>
            <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.38" />
              <stop offset="100%" stop-color="var(--accent)" stop-opacity="0.04" />
            </linearGradient>
          </defs>

          <!-- Baseline dashed guide -->
          <line x1="${padL}" y1="${bottomY}" x2="${viewBoxW - padR}" y2="${bottomY}"
                stroke="var(--line)" stroke-dasharray="3 3" stroke-width="1" />

          <!-- Elevation gradient area -->
          <path d="${areaD}" fill="url(#${gradId})" />

          <!-- Topographic slope profile line -->
          <path d="${pathD}" fill="none" stroke="var(--accent)" stroke-width="2.6"
                stroke-linecap="round" stroke-linejoin="round" />

          <!-- Peak elevation indicator -->
          <circle cx="${peak.x.toFixed(1)}" cy="${peak.y.toFixed(1)}" r="3.2"
                  fill="var(--focus)" stroke="#FFFFFF" stroke-width="1.5" />
          <text x="${peak.x.toFixed(1)}" y="${peakLabelY}" font-size="9.5" font-weight="700"
                fill="var(--ink)" text-anchor="middle">▲ ${Math.round(peak.elev)}m</text>

          <!-- Start Point: School -->
          <circle cx="${firstX}" cy="${points[0].y.toFixed(1)}" r="3.5"
                  fill="var(--accent)" stroke="#FFFFFF" stroke-width="1.5" />
          <text x="${padL}" y="73" font-size="10" font-weight="600"
                fill="var(--muted)" text-anchor="start">학교 ${Math.round(startElev)}m</text>

          <!-- End Point: Facility -->
          <circle cx="${lastX}" cy="${points[points.length - 1].y.toFixed(1)}" r="3.5"
                  fill="var(--accent)" stroke="#FFFFFF" stroke-width="1.5" />
          <text x="${viewBoxW - padR}" y="73" font-size="10" font-weight="600"
                fill="var(--muted)" text-anchor="end">기관 ${Math.round(endElev)}m</text>
        </svg>
      </div>
    `;
  }

  /**
   * Renders the verification inspector panel.
   * @param {Object} data
   * @param {Object} data.school - Currently selected reference school
   * @param {Object} data.facility - Currently inspected facility
   * @param {Array<Object>} [data.siblings] - Other facilities located in the exact same building
   * @param {Object|null} [data.profile] - Topographic elevation profile from terrain engine
   * @param {boolean} [data.isOrbiting] - Whether 360° orbit rotation is currently running
   */
  render({ school, facility, siblings = [], profile = null, isOrbiting = false }) {
    if (!facility || !school) {
      this.state = null;
      if (this.container) {
        this.container.hidden = true;
        this.container.innerHTML = '';
      }
      return;
    }

    this.state = { school, facility, siblings, profile, isOrbiting };
    this.container.hidden = false;

    const currentKey = facilityKey(facility);
    const guVar = (facility.gu && GUVAR[facility.gu]) ? GUVAR[facility.gu] : '--accent';
    const catLabel = CATL[facility.cat] || '도움 기관';

    // Telephone cleanup
    const hasPhone = Boolean(facility.ph && facility.ph !== '-');
    const cleanPh = hasPhone ? facility.ph.replace(/[^0-9]/g, '') : '';

    // Direct Verification External URLs (API keys not needed, 100% direct deep-links)
    const roadviewUrl = `https://map.kakao.com/link/roadview/${facility.lat},${facility.lon}`;
    const kakaoRouteUrl = `https://map.kakao.com/link/from/${encodeURIComponent(school.name)},${school.lat},${school.lon}/to/${encodeURIComponent(facility.name)},${facility.lat},${facility.lon}`;
    const naverSearchQuery = encodeURIComponent(`부산 ${facility.gu || ''} ${facility.name}`);
    const naverSearchUrl = `https://map.naver.com/p/search/${naverSearchQuery}`;

    // Elevation box rendering
    let elevBoxHtml = '';
    const crossesHarbor = Boolean(profile?.crossesHarbor);
    const isTerrainReady = Boolean(profile?.terrainReady);

    let harborBanner = '';
    if (crossesHarbor) {
      harborBanner = `
        <div class="harbor-warn" role="alert">
          <span>🌊</span>
          <span><b>바다(항만) 횡단 구간</b> — 직선 반경 내에 있으나 영도대교·남항대교 등을 우회해야 합니다.</span>
        </div>
      `;
    }

    if (isTerrainReady) {
      const svgChart = this.renderElevationSvg(school, facility, profile);
      const gainMeters = Math.round(profile.gainMeters || 0);
      const maxSlopePct = Math.round(profile.maxSlopePct || 0);
      const isSteep = (gainMeters >= 28 || (gainMeters >= 12 && maxSlopePct >= 12));

      const slopeMins = profile.slopeMinutes ?? Math.max(1, Math.round(facility.m / 67));
      const flatMins = profile.flatMinutes ?? Math.max(1, Math.round(facility.m / 67));
      const hasSlopeDelta = Math.abs(slopeMins - flatMins) >= 2;

      elevBoxHtml = `
        <div class="elev-box">
          ${harborBanner}
          ${svgChart}
          <div class="elev-stats">
            <div class="elev-stat-item">
              <span class="elev-stat-lbl">직선거리</span>
              <span class="elev-stat-val">${fmtDist(facility.m)}</span>
            </div>
            <div class="elev-stat-item">
              <span class="elev-stat-lbl">누적 오르막</span>
              <span class="elev-stat-val">+${gainMeters}m</span>
              ${isSteep ? '<span class="slope-pill">⛰️ 급경사 주의</span>' : ''}
            </div>
            <div class="elev-stat-item">
              <span class="elev-stat-lbl">예상 도보</span>
              <span class="elev-stat-val">약 ${slopeMins}분</span>
              ${hasSlopeDelta ? `<span class="elev-stat-sub">(평지 ${flatMins}분 → 경사 보정)</span>` : ''}
            </div>
          </div>
        </div>
      `;
    } else {
      // Topographic profile is loading or unavailable
      const estMins = Math.max(1, Math.round(facility.m / 67));
      elevBoxHtml = `
        <div class="elev-box">
          ${harborBanner}
          <div style="font-size:12.5px;color:var(--muted);display:flex;align-items:center;gap:6px;">
            <span class="map-loading-spinner" style="width:12px;height:12px;border-width:1.5px;"></span>
            <span>지형 고도 데이터를 불러오는 중...</span>
          </div>
          <div class="elev-stats" style="border-top:0;padding-top:0;">
            <div class="elev-stat-item">
              <span class="elev-stat-lbl">직선거리</span>
              <span class="elev-stat-val">${fmtDist(facility.m)}</span>
            </div>
            <div class="elev-stat-item">
              <span class="elev-stat-lbl">도보 시간</span>
              <span class="elev-stat-val">약 ${estMins}분</span>
            </div>
          </div>
        </div>
      `;
    }

    // Sibling Facilities section (if more than 1 facility in building)
    let siblingsHtml = '';
    if (siblings && siblings.length > 1) {
      const chips = siblings.map(sib => {
        const key = facilityKey(sib);
        const isActive = (key === currentKey);
        return `
          <button type="button" class="sibling-chip ${isActive ? 'is-active' : ''}"
                  data-action="select-sibling" data-key="${escHtml(key)}"
                  aria-pressed="${isActive}">
            ${renderCatIcon(sib.cat, 15)}
            <span>${escHtml(sib.name)}</span>
          </button>
        `;
      }).join('');

      siblingsHtml = `
        <div class="sibling-section">
          <div class="sibling-title">
            <span>🏢</span>
            <span>이 건물에 함께 입주한 도움 기관 (${siblings.length}곳)</span>
          </div>
          <div class="sibling-chips">${chips}</div>
        </div>
      `;
    }

    // Approximate address warning notice
    const approxHtml = facility.ap ? `
      <div class="facility-approx-warn" role="note">
        ⚠️ 대략 위치 (방문·연계 전 전화로 정확한 층·호수 확인 권장)
      </div>
    ` : '';

    // Action buttons bar
    const phoneActions = hasPhone ? `
      <a class="vbtn vbtn-primary" href="tel:${cleanPh}" aria-label="${escHtml(facility.name)} 전화 걸기">
        📞 ${escHtml(facility.ph)} 전화
      </a>
      <button type="button" class="vbtn vbtn-copy" data-action="copy-phone" data-copy-ph="${escHtml(facility.ph)}">
        📋 번호 복사
      </button>
    ` : '';

    this.container.innerHTML = `
      <div class="inspector-card" role="dialog" aria-label="${escHtml(facility.name)} 상세 및 현장 검증">
        <div class="inspector-scroll-area">
          <!-- Top Header Bar -->
          <div class="inspector-head-bar">
            <div class="inspector-meta-row">
              <span class="inspector-cat-tag">
                ${renderCatIcon(facility.cat, 26)}
                <span>${escHtml(catLabel)}</span>
              </span>
              <span class="gu" style="background:var(${guVar})">${escHtml(facility.gu)} ${escHtml(facility.no)}</span>
            </div>

            <div class="inspector-controls-row">
              <button type="button" class="inspector-orbit-btn ${isOrbiting ? 'is-active' : ''}"
                      data-action="toggle-orbit" aria-pressed="${isOrbiting}">
                <span class="hud-spin-icon ${isOrbiting ? 'is-spinning' : ''}">🔄</span>
                <span>360° 회전 ${isOrbiting ? '정지' : '보기'}</span>
              </button>
              <button type="button" class="inspector-close-btn" data-action="close" aria-label="상세창 닫기">✕</button>
            </div>
          </div>

          <!-- Facility Core Info -->
          <div>
            <h3 class="facility-title">${escHtml(facility.name)}</h3>
            ${facility.desc ? `<p class="facility-desc">${escHtml(facility.desc)}</p>` : ''}
            <div class="facility-addr" style="margin-top:4px;">
              <span>📍</span>
              <span>${escHtml(facility.addr || '주소 정보 없음')}</span>
            </div>
          </div>

          ${approxHtml}
          ${siblingsHtml}
          ${elevBoxHtml}

          <!-- Verification Actions Grid -->
          <div class="verify-actions">
            ${phoneActions}
            <a class="vbtn" target="_blank" rel="noopener noreferrer" href="${roadviewUrl}">
              📷 로드뷰로 외관·간판 확인
            </a>
            <a class="vbtn" target="_blank" rel="noopener noreferrer" href="${kakaoRouteUrl}">
              🚶 카카오 도보 길찾기
            </a>
            <a class="vbtn" target="_blank" rel="noopener noreferrer" href="${naverSearchUrl}" style="grid-column: span 2;">
              🟢 네이버 지도 검색
            </a>
          </div>
        </div>
      </div>
    `;
  }
}
