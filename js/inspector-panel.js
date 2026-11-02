// js/inspector-panel.js
// STIS 3D Map: Slim Bottom HUD Bar & Inline List Accordion Detail Renderers

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
 * Generates a compact SVG sparkline elevation profile for the dock HUD bar.
 * @param {Object|null} profile - Topographic elevation profile from terrain engine
 * @returns {string} SVG HTML string
 */
export function renderMiniSparklineSvg(profile) {
  const rawSamples = Array.isArray(profile?.samples) ? profile.samples : [];
  const samples = rawSamples.map(s => (typeof s === 'number' ? s : (s.elev ?? s.y ?? 0)));

  if (!profile?.terrainReady || samples.length < 2) {
    return `
      <svg viewBox="0 0 112 28" class="dock-sparkline-svg" role="img" aria-label="고도 프로필 준비 중">
        <line x1="16" y1="14" x2="96" y2="14" stroke="var(--line)" stroke-dasharray="3 3" stroke-width="1.5" stroke-linecap="round" />
      </svg>
    `;
  }

  const viewBoxW = 112;
  const viewBoxH = 28;
  const padL = 6;
  const padR = 6;
  const padT = 4;
  const padB = 4;
  const chartW = viewBoxW - padL - padR;
  const chartH = viewBoxH - padT - padB;

  const minElev = profile.minElev ?? Math.min(...samples);
  const maxElev = profile.maxElev ?? Math.max(...samples);
  const elevRange = Math.max(8, maxElev - minElev);

  const points = samples.map((elev, i) => {
    const x = padL + (i / (samples.length - 1)) * chartW;
    const y = padT + (1 - (elev - minElev) / elevRange) * chartH;
    return { x, y, elev };
  });

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const lastX = points[points.length - 1].x.toFixed(1);
  const firstX = points[0].x.toFixed(1);
  const bottomY = (viewBoxH).toFixed(1);
  const areaD = `${pathD} L ${lastX},${bottomY} L ${firstX},${bottomY} Z`;

  const gradId = 'dock-spark-grad';

  return `
    <svg viewBox="0 0 ${viewBoxW} ${viewBoxH}" class="dock-sparkline-svg" role="img" aria-label="고도 변화 그래프">
      <defs>
        <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.32" />
          <stop offset="100%" stop-color="var(--accent)" stop-opacity="0.02" />
        </linearGradient>
      </defs>
      <path d="${areaD}" fill="url(#${gradId})" />
      <path d="${pathD}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
      <circle cx="${firstX}" cy="${points[0].y.toFixed(1)}" r="2.2" fill="var(--accent)" stroke="#FFFFFF" stroke-width="1" />
      <circle cx="${lastX}" cy="${points[points.length - 1].y.toFixed(1)}" r="2.2" fill="var(--accent)" stroke="#FFFFFF" stroke-width="1" />
    </svg>
  `;
}

/**
 * Generates inline responsive SVG elevation profile chart for Busan topography.
 * @param {Object} school
 * @param {Object} facility
 * @param {Object} profile
 * @returns {string} SVG HTML string
 */
export function renderElevationSvg(school, facility, profile) {
  if (!profile) return '';
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

  const key = facility ? facilityKey(facility) : 'default';
  const gradId = `stis-elev-grad-${String(key).replace(/[^a-zA-Z0-9_-]/g, '_')}`;

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
 * Renders the inline detail accordion HTML for the left sidebar's selected item card.
 * @param {Object} options
 * @param {Object} options.school - Selected reference school
 * @param {Object} options.facility - Selected facility
 * @param {Array<Object>} [options.siblings] - Co-located facilities in the same building
 * @param {Object|null} [options.profile] - Topographic elevation profile
 * @returns {string} Accordion HTML string
 */
export function renderInlineDetailHtml({ school, facility, siblings = [], profile = null }) {
  if (!facility || !school) return '';

  const currentKey = facilityKey(facility);

  // Direct Verification External URLs
  const roadviewUrl = `https://map.kakao.com/link/roadview/${facility.lat},${facility.lon}`;
  const kakaoRouteUrl = `https://map.kakao.com/link/from/${encodeURIComponent(school.name)},${school.lat},${school.lon}/to/${encodeURIComponent(facility.name)},${facility.lat},${facility.lon}`;
  const naverSearchQuery = encodeURIComponent(`부산 ${facility.gu || ''} ${facility.name}`);
  const naverSearchUrl = `https://map.naver.com/p/search/${naverSearchQuery}`;

  // Harbor-crossing warning banner
  const crossesHarbor = Boolean(
    profile?.crossesHarbor ||
    (school?.gu && facility.gu && ((school.gu === '영도구' && facility.gu !== '영도구') || (school.gu !== '영도구' && facility.gu === '영도구')))
  );

  let harborBanner = '';
  if (crossesHarbor) {
    harborBanner = `
      <div class="harbor-warn" role="alert">
        <span>🌊</span>
        <span><b>바다(항만) 횡단 구간</b> — 직선 반경 내에 있으나 영도대교·남항대교 등을 우회해야 합니다.</span>
      </div>
    `;
  }

  // Approximate location note
  const approxHtml = facility.ap ? `
    <div class="facility-approx-warn" role="note">
      ⚠️ 대략 위치 (방문·연계 전 전화로 정확한 층·호수 확인 권장)
    </div>
  ` : '';

  // Sibling agencies switcher chips
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

  // Elevation profile box
  let elevBoxHtml = '';
  const isTerrainReady = Boolean(profile?.terrainReady);

  if (isTerrainReady) {
    const svgChart = renderElevationSvg(school, facility, profile);
    const gainMeters = Math.round(profile.gainMeters || 0);
    const maxSlopePct = Math.round(profile.maxSlopePct || 0);
    const isSteep = (gainMeters >= 28 || (gainMeters >= 12 && maxSlopePct >= 12));

    const slopeMins = profile.slopeMinutes ?? Math.max(1, Math.round(facility.m / 67));
    const flatMins = profile.flatMinutes ?? Math.max(1, Math.round(facility.m / 67));
    const hasSlopeDelta = Math.abs(slopeMins - flatMins) >= 2;

    elevBoxHtml = `
      <div class="elev-box">
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
    const estMins = Math.max(1, Math.round(facility.m / 67));
    elevBoxHtml = `
      <div class="elev-box">
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

  return `
    <div class="item-accordion">
      ${harborBanner}
      ${approxHtml}
      ${siblingsHtml}
      ${elevBoxHtml}
      <div class="accordion-verify-grid">
        <a class="vbtn" href="${roadviewUrl}" target="_blank" rel="noopener noreferrer">📷 로드뷰 외관 확인</a>
        <a class="vbtn" href="${kakaoRouteUrl}" target="_blank" rel="noopener noreferrer">🚶 카카오 도보 길찾기</a>
        <a class="vbtn" href="${naverSearchUrl}" target="_blank" rel="noopener noreferrer">🟢 네이버 지도 검색</a>
      </div>
    </div>
  `;
}

/**
 * InspectorPanel: Slim Bottom Docked HUD Bar for 3D Viewport Intelligence.
 * Renders along the bottom edge of .map-stage to keep 90%+ of the 3D map viewport open,
 * providing one-click access to verification links, orbit toggle, phone dialing, and
 * rapid sibling switching.
 */
export class InspectorPanel {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.container - Host container element (e.g. #inspectorHost)
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
    return renderElevationSvg(school, facility, profile);
  }

  /**
   * Generates a compact SVG sparkline elevation profile for the dock HUD bar.
   * @param {Object|null} profile
   * @returns {string} SVG HTML string
   */
  renderMiniSparklineSvg(profile) {
    return renderMiniSparklineSvg(profile);
  }

  /**
   * Renders the slim bottom docked HUD bar (.map-dock-bar).
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
    if (this.container) {
      this.container.hidden = false;
    }

    const currentKey = facilityKey(facility);
    const guVar = (facility.gu && GUVAR[facility.gu]) ? GUVAR[facility.gu] : '--accent';

    // Telephone cleanup
    const hasPhone = Boolean(facility.ph && facility.ph !== '-');
    const cleanPh = hasPhone ? facility.ph.replace(/[^0-9]/g, '') : '';

    // Direct Verification External URLs
    const roadviewUrl = `https://map.kakao.com/link/roadview/${facility.lat},${facility.lon}`;
    const kakaoRouteUrl = `https://map.kakao.com/link/from/${encodeURIComponent(school.name)},${school.lat},${school.lon}/to/${encodeURIComponent(facility.name)},${facility.lat},${facility.lon}`;
    const naverSearchQuery = encodeURIComponent(`부산 ${facility.gu || ''} ${facility.name}`);
    const naverSearchUrl = `https://map.naver.com/p/search/${naverSearchQuery}`;

    // Status / Alert flags
    const crossesHarbor = Boolean(
      profile?.crossesHarbor ||
      (school?.gu && facility.gu && ((school.gu === '영도구' && facility.gu !== '영도구') || (school.gu !== '영도구' && facility.gu === '영도구')))
    );
    const isTerrainReady = Boolean(profile?.terrainReady);
    const gainMeters = Math.round(profile?.gainMeters || 0);
    const maxSlopePct = Math.round(profile?.maxSlopePct || 0);
    const isSteep = Boolean(isTerrainReady && (gainMeters >= 28 || (gainMeters >= 12 && maxSlopePct >= 12)));

    const slopeMins = profile?.slopeMinutes ?? Math.max(1, Math.round(facility.m / 67));
    const estMins = Math.max(1, Math.round(facility.m / 67));

    // Status/Alert micro-pills
    const alertPills = [];
    if (crossesHarbor) {
      alertPills.push('<span class="dock-alert dock-alert--harbor" title="영도대교·남항대교 우회 필요">🌊 항만우회</span>');
    }
    if (isSteep) {
      alertPills.push('<span class="dock-alert dock-alert--steep">⛰️ 급경사</span>');
    }
    if (facility.ap) {
      alertPills.push('<span class="dock-alert dock-alert--approx">⚠️ 대략위치</span>');
    }
    const alertPillsHtml = alertPills.join(' ');

    // Inline compact sibling switcher pills
    let siblingsDockHtml = '';
    if (siblings && siblings.length > 1) {
      const chips = siblings.map((sib, idx) => {
        const key = facilityKey(sib);
        const isActive = (key === currentKey);
        return `<button type="button" class="dock-sib-chip ${isActive ? 'is-active' : ''}" data-action="select-sibling" data-key="${escHtml(key)}">#${idx + 1} ${escHtml(sib.name)}</button>`;
      }).join('');
      siblingsDockHtml = `
        <div class="dock-siblings">
          <span class="dock-sib-label">🏢 입주기관(${siblings.length}):</span>
          ${chips}
        </div>
      `;
    }

    // Centered telemetry metrics: 도보 소요 시간 최우선 강조
    const displayMins = isTerrainReady ? slopeMins : estMins;
    const metricsHtml = `
      <div class="dock-walk-badge">
        <span class="dock-walk-icon">🚶</span>
        <span class="dock-walk-val">도보 <strong>약 ${displayMins}분</strong></span>
      </div>
      <div class="dock-dist-sub">
        <span>직선 <b>${fmtDist(facility.m)}</b></span>
        ${isTerrainReady && gainMeters > 0 ? `<span class="dock-climb">오르막 <b>+${gainMeters}m</b></span>` : ''}
      </div>
    `;

    const phoneBtnHtml = hasPhone
      ? `<a class="dock-btn dock-btn--primary" href="tel:${cleanPh}" title="${escHtml(facility.ph)} 전화 걸기">📞 <span class="dock-btn-txt">${escHtml(facility.ph)}</span></a>`
      : '';

    this.container.innerHTML = `
      <div class="map-dock-bar" role="region" aria-label="${escHtml(facility.name)} 선택 기관 요약 바">
        <div class="dock-main">
          ${renderCatIcon(facility.cat, 26)}
          <div class="dock-title-wrap">
            <div class="dock-title-row">
              <strong class="dock-name">${escHtml(facility.name)}</strong>
              <span class="gu" style="background:var(${guVar})">${escHtml(facility.gu)} ${escHtml(facility.no)}</span>
              ${alertPillsHtml}
            </div>
            ${siblingsDockHtml}
          </div>
        </div>

        <div class="dock-telemetry">
          ${renderMiniSparklineSvg(profile)}
          <div class="dock-metrics">
            ${metricsHtml}
          </div>
        </div>

        <div class="dock-actions">
          ${phoneBtnHtml}
          <a class="dock-btn" href="${roadviewUrl}" target="_blank" rel="noopener noreferrer" title="카카오 로드뷰로 실제 건물·간판 확인">📷 <span class="dock-btn-txt">로드뷰</span></a>
          <a class="dock-btn" href="${kakaoRouteUrl}" target="_blank" rel="noopener noreferrer" title="학교에서 기관까지 카카오 도보 길찾기">🚶 <span class="dock-btn-txt">길찾기</span></a>
          <a class="dock-btn" href="${naverSearchUrl}" target="_blank" rel="noopener noreferrer" title="네이버 지도 검색">🟢 <span class="dock-btn-txt">네이버</span></a>
          <button type="button" class="dock-btn ${isOrbiting ? 'is-active' : ''}" data-action="toggle-orbit" aria-pressed="${isOrbiting}" title="건물 360° 회전 보기">🔄 <span class="dock-btn-txt">360°</span></button>
          <button type="button" class="dock-close" data-action="close" aria-label="선택 해제">✕</button>
        </div>
      </div>
    `;
  }
}
