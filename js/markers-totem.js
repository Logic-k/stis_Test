// js/markers-totem.js
// STIS 3D Totem Marker Manager: 입체 비콘 마커 및 컴팩트 클러스터 핀 + 앵커 팝오버 렌더러

import { CATL, CAT_COLORS, GU_COLORS, facilityKey, renderCatIcon } from './constants.js';
import { toLngLat, fmtDist, groupCoLocated } from './geo-utils.js';

function getCatColorCss(cat) {
  const entry = CAT_COLORS[cat];
  if (typeof entry === 'string') return entry;
  return `var(--${cat}, ${entry?.light || '#0F6E8C'})`;
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 컴팩트 핀 및 클러스터 팝오버 전용 고대비 HUD 스타일 주입
 */
function ensureClusterStyles() {
  if (typeof document === 'undefined') return;
  const styleId = 'stis-totem-cluster-injected-css';
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    /* (A) 단일 시설 컴팩트 30px 원형 핀 (루트 transform 건드리지 않음 — MapLibre 좌표계 보호) */
    .stis-pin-3d {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      cursor: pointer;
      pointer-events: auto;
      user-select: none;
    }
    .stis-pin-3d .pin-badge {
      width: 30px !important;
      height: 30px !important;
      border-radius: 50%;
      border: 2px solid #FFFFFF !important;
      box-shadow: 0 3px 8px rgba(0, 0, 0, 0.26);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #FFFFFF;
      transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease;
    }
    .stis-pin-3d .pin-badge svg {
      width: 18px !important;
      height: 18px !important;
    }
    .stis-pin-3d .pin-stem {
      width: 2.5px;
      height: 8px;
      background: #FFFFFF;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
    }
    .stis-pin-3d .pin-shadow {
      position: absolute;
      bottom: -3px;
      left: 50%;
      width: 16px;
      height: 6px;
      margin-left: -8px;
      border-radius: 50%;
      background: rgba(0, 0, 0, 0.28);
      filter: blur(1.5px);
      pointer-events: none;
      transform: rotateX(60deg);
    }
    .stis-pin-3d .pin-callout {
      position: absolute;
      bottom: calc(100% + 6px);
      left: 50%;
      transform: translateX(-50%) translateY(4px);
      opacity: 0;
      pointer-events: none;
      padding: 4px 9px;
      border-radius: 7px;
      background: rgba(15, 23, 27, 0.94);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      color: #FFFFFF;
      font-size: 12px;
      font-weight: 700;
      white-space: nowrap;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
      border: 1px solid rgba(255, 255, 255, 0.16);
      transition: opacity 0.18s ease, transform 0.18s ease;
      z-index: 20;
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .stis-pin-3d:hover .pin-callout,
    .stis-pin-3d.is-hovered .pin-callout,
    .stis-pin-3d.is-selected .pin-callout {
      opacity: 1 !important;
      pointer-events: auto !important;
      transform: translateX(-50%) translateY(0) !important;
    }
    .stis-pin-3d.is-selected {
      z-index: 35 !important;
    }
    .stis-pin-3d:hover .pin-badge,
    .stis-pin-3d.is-hovered .pin-badge {
      transform: scale(1.12);
    }
    .stis-pin-3d.is-selected .pin-badge {
      transform: scale(1.18);
      box-shadow: 0 0 0 3px #F2A43A, 0 6px 18px rgba(242, 164, 58, 0.6) !important;
    }

    /* (B) 동일 건물 복합 시설 컴팩트 34px 클러스터 핀 (루트 transform 보호) */
    .stis-cluster-pin {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      cursor: pointer;
      pointer-events: auto;
      user-select: none;
      z-index: 15;
    }
    .stis-cluster-pin:hover,
    .stis-cluster-pin.has-hovered {
      z-index: 40 !important;
    }
    .stis-cluster-pin.has-selected {
      z-index: 45 !important;
    }
    .stis-cluster-pin:hover .cluster-badge,
    .stis-cluster-pin.has-hovered .cluster-badge {
      transform: scale(1.08);
    }
    .stis-cluster-pin .cluster-badge {
      position: relative;
      width: 34px;
      height: 34px;
      border-radius: 50%;
      border: 2.5px solid #FFFFFF;
      box-shadow: 0 3px 10px rgba(0, 0, 0, 0.28);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #FFFFFF;
      transition: transform 0.18s ease, box-shadow 0.18s ease;
    }
    .stis-cluster-pin .cluster-badge svg {
      width: 20px;
      height: 20px;
    }
    .stis-cluster-pin.has-selected .cluster-badge {
      box-shadow: 0 0 0 3.5px #F2A43A, 0 6px 18px rgba(242, 164, 58, 0.6);
      border-color: #FFFFFF;
    }
    .stis-cluster-pin .cluster-count {
      position: absolute;
      top: -5px;
      right: -7px;
      min-width: 18px;
      height: 18px;
      padding: 0 4px;
      border-radius: 999px;
      background: #0F171B;
      color: #FFFFFF;
      border: 1.5px solid #FFFFFF;
      font-size: 10px;
      font-weight: 800;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 5px rgba(0, 0, 0, 0.35);
      letter-spacing: -0.02em;
    }
    .stis-cluster-pin.has-selected .cluster-count {
      background: #F2A43A;
      color: #0F171B;
    }
    .stis-cluster-pin .pin-stem {
      width: 2.5px;
      height: 9px;
      background: #FFFFFF;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
    }
    .stis-cluster-pin .pin-shadow {
      position: absolute;
      bottom: -4px;
      left: 50%;
      width: 20px;
      height: 8px;
      margin-left: -10px;
      border-radius: 50%;
      background: rgba(0, 0, 0, 0.28);
      filter: blur(1.5px);
      pointer-events: none;
      transform: rotateX(60deg);
    }

    /* 앵커드 고대비 팝오버 리스트 (호버 시 전개, 선택 상태에서는 컴팩트 콜아웃 표시) */
    .stis-cluster-pin .pin-callout {
      position: absolute;
      bottom: calc(100% + 7px);
      left: 50%;
      transform: translateX(-50%) translateY(4px);
      opacity: 0;
      pointer-events: none;
      padding: 5px 10px;
      border-radius: 8px;
      background: rgba(15, 25, 32, 0.96);
      color: #FFFFFF;
      font-size: 12px;
      font-weight: 700;
      white-space: nowrap;
      box-shadow: 0 5px 16px rgba(0, 0, 0, 0.38);
      border: 1px solid rgba(242, 164, 58, 0.65);
      transition: opacity 0.18s ease, transform 0.18s ease;
      z-index: 25;
      display: flex;
      align-items: center;
      gap: 5px;
    }
    .stis-cluster-pin.has-selected:not(:hover):not(.has-hovered) .pin-callout {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
    .stis-cluster-pin .cluster-popover {
      position: absolute;
      bottom: calc(100% + 8px);
      left: 50%;
      transform: translateX(-50%) translateY(6px);
      opacity: 0;
      pointer-events: none;
      visibility: hidden;
      transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), visibility 0.2s;
      z-index: 50;
      background: rgba(14, 23, 29, 0.96);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 11px;
      box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
      padding: 6px;
      width: max-content;
      min-width: 195px;
      max-width: 340px;
    }
    .stis-cluster-pin .cluster-popover::after {
      content: '';
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      height: 12px;
    }
    .stis-cluster-pin .cluster-popover::before {
      content: '';
      position: absolute;
      top: 100%;
      left: 50%;
      margin-left: -5px;
      border-width: 5px;
      border-style: solid;
      border-color: rgba(14, 23, 29, 0.96) transparent transparent transparent;
    }
    .stis-cluster-pin:hover .cluster-popover,
    .stis-cluster-pin.has-hovered .cluster-popover {
      opacity: 1;
      pointer-events: auto;
      visibility: visible;
      transform: translateX(-50%) translateY(0);
    }
    .cluster-popover-head {
      font-size: 11px;
      font-weight: 700;
      color: #9BB0BE;
      padding: 3px 6px 6px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      margin-bottom: 5px;
      display: flex;
      align-items: center;
      gap: 4px;
      letter-spacing: -0.01em;
    }
    .cluster-popover-list {
      display: flex;
      flex-direction: column;
      gap: 3px;
      max-height: 230px;
      overflow-x: hidden;
      overflow-y: auto;
    }
    .cluster-popover-item {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 5px 8px;
      border-radius: 7px;
      background: rgba(255, 255, 255, 0.05);
      color: #E8F0F5;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s ease, transform 0.15s ease, border-color 0.15s ease;
      white-space: nowrap;
      text-align: left;
      border: 1px solid transparent;
    }
    .cluster-popover-item:hover,
    .cluster-popover-item.is-hovered {
      background: rgba(255, 255, 255, 0.15);
      color: #FFFFFF;
      transform: translateX(2px);
    }
    .cluster-popover-item.is-selected {
      background: rgba(242, 164, 58, 0.22);
      border-color: rgba(242, 164, 58, 0.6);
      color: #FFD599;
      font-weight: 700;
      transform: translateX(3px);
    }
    .cluster-row-tag {
      font-size: 10px;
      font-weight: 700;
      color: #8A9CA8;
      background: rgba(0, 0, 0, 0.28);
      padding: 1px 4px;
      border-radius: 4px;
      flex-shrink: 0;
    }
    .cluster-popover-item.is-selected .cluster-row-tag {
      color: #FFD599;
      background: rgba(242, 164, 58, 0.25);
    }
    .cluster-row-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .cluster-row-name {
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
      min-width: 0;
      max-width: 140px;
    }
    .cluster-row-dist {
      font-size: 11px;
      color: #7E9EAF;
      font-weight: 500;
      flex-shrink: 0;
      margin-left: auto;
    }
    .cluster-popover-item.is-selected .cluster-row-dist {
      color: #F2A43A;
    }
  `;
  document.head.appendChild(style);
}

/**
 * MapLibre HTML 마커 관리자
 * - 기준 학교 3D 비콘 마커 (.stis-school-beacon)
 * - 단일 기관 3D 컴팩트 핀 마커 (.stis-pin-3d)
 * - 동일 건물 2~3개 기관 컴팩트 클러스터 핀 + 앵커 팝오버 (.stis-cluster-pin)
 */
export class TotemMarkerManager {
  /**
   * @param {maplibregl.Map} map MapLibre 지도 인스턴스
   * @param {Object} callbacks
   * @param {Function} callbacks.onSelectFacility 시설 선택 콜백 (facility, shouldCenter)
   * @param {Function} callbacks.onHoverFacility 시설 호버 콜백 (facility | null)
   */
  constructor(map, { onSelectFacility, onHoverFacility } = {}) {
    this.map = map;
    this.onSelectFacility = onSelectFacility;
    this.onHoverFacility = onHoverFacility;

    this._schoolMarker = null;
    this._schoolKey = null;

    /** @type {Array<maplibregl.Marker>} */
    this._facilityMarkers = [];
    this._facilitiesSig = '';
    /** @type {Array<Object>} */
    this._markerRecords = [];

    this._currentSelectedKey = null;
    this._currentHoveredKey = null;

    ensureClusterStyles();
  }

  /**
   * 학교 및 시설 마커 동기화
   * @param {Object} params
   * @param {Object|null} params.school 기준 학교 객체
   * @param {Array<Object>} params.facilities 시설 목록
   * @param {Object|null} params.selectedFacility 현재 선택된 시설
   * @param {Object|null} params.hoveredFacility 현재 호버된 시설
   */
  sync({ school, facilities = [], selectedFacility = null, hoveredFacility = null } = {}) {
    this._syncSchoolMarker(school);
    this._syncFacilityMarkers(facilities, selectedFacility, hoveredFacility);
  }

  /**
   * 모든 마커 제거
   */
  clear() {
    if (this._schoolMarker) {
      this._schoolMarker.remove();
      this._schoolMarker = null;
      this._schoolKey = null;
    }
    this._clearFacilityMarkers();
  }

  /**
   * 내부: 기존 시설 마커들 정리
   * @private
   */
  _clearFacilityMarkers() {
    for (let i = 0; i < this._facilityMarkers.length; i++) {
      this._facilityMarkers[i].remove();
    }
    this._facilityMarkers = [];
    this._markerRecords = [];
    this._facilitiesSig = '';
  }

  /**
   * 기준 학교 3D 비콘 마커 동기화
   * @private
   */
  _syncSchoolMarker(school) {
    if (!school || school.lon == null || school.lat == null) {
      if (this._schoolMarker) {
        this._schoolMarker.remove();
        this._schoolMarker = null;
        this._schoolKey = null;
      }
      return;
    }

    const schoolKey = `${school.name || ''}_${school.lon}_${school.lat}`;
    const maplibregl = window.maplibregl;
    if (!maplibregl) return;

    if (this._schoolMarker && this._schoolKey === schoolKey) {
      // 기존 마커 유지
      return;
    }

    if (this._schoolMarker) {
      this._schoolMarker.remove();
      this._schoolMarker = null;
    }

    // 마커 엘리먼트 생성
    const el = document.createElement('div');
    el.className = 'stis-school-beacon';
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', `${school.name || '기준 학교'} (기준 학교)`);

    el.innerHTML = `
      <span class="beacon-pulse" aria-hidden="true"></span>
      <span class="beacon-pulse beacon-pulse--delay" aria-hidden="true"></span>
      <div class="beacon-head" title="${escapeHtml(school.name)}">
        <svg class="beacon-icon" width="28" height="28" viewBox="-16 -16 32 32" aria-hidden="true">
          <use href="#g-school"/>
        </svg>
      </div>
      <span class="beacon-stem" aria-hidden="true"></span>
      <span class="beacon-base-ring" aria-hidden="true"></span>
      <span class="beacon-label">${escapeHtml(school.name)}</span>
    `;

    el.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
      }
    });

    this._schoolMarker = new maplibregl.Marker({
      element: el,
      anchor: 'bottom',
      opacityWhenCovered: '0.95'
    })
      .setLngLat([school.lon, school.lat])
      .addTo(this.map);

    this._schoolKey = schoolKey;
  }

  /**
   * 기관 마커 및 컴팩트 클러스터 핀 동기화
   * @private
   */
  _syncFacilityMarkers(facilities, selectedFacility, hoveredFacility) {
    const maplibregl = window.maplibregl;
    if (!maplibregl || !facilities || facilities.length === 0) {
      this._clearFacilityMarkers();
      return;
    }

    const selectedKey = selectedFacility ? facilityKey(selectedFacility) : null;
    const hoveredKey = hoveredFacility ? facilityKey(hoveredFacility) : null;
    const sig = facilities.map(r => `${facilityKey(r)}:${Math.round(r.m || 0)}`).join('|');

    // 시설 목록이 동일하면 DOM 재생성 없이 클래스 및 배지 상태만 즉시 갱신 (클릭 유실 및 깜빡임 원천 차단)
    if (sig === this._facilitiesSig && this._markerRecords.length > 0) {
      for (let i = 0; i < this._markerRecords.length; i++) {
        const rec = this._markerRecords[i];
        if (rec.type === 'single') {
          const fKey = rec.keys[0];
          rec.el.classList.toggle('is-selected', selectedKey === fKey);
          rec.el.classList.toggle('is-hovered', hoveredKey === fKey);
        } else if (rec.type === 'cluster' || rec.type === 'totem') {
          const hasSel = rec.keys.includes(selectedKey);
          const hasHov = rec.keys.includes(hoveredKey);
          rec.el.classList.toggle('has-selected', hasSel);
          rec.el.classList.toggle('has-hovered', hasHov);

          // 선택된 시설에 맞춰 배지 색상, 아이콘 및 컴팩트 콜아웃 텍스트 즉각 반영
          const activeItem = (rec.items || []).find(it => facilityKey(it) === selectedKey) || (rec.items && rec.items[0]);
          if (rec.badgeEl && activeItem) {
            rec.badgeEl.style.background = getCatColorCss(activeItem.cat);
            if (rec.badgeIconEl) {
              rec.badgeIconEl.innerHTML = renderCatIcon(activeItem.cat, 20);
            }
          }
          if (rec.calloutNameEl && activeItem && rec.items) {
            rec.calloutNameEl.textContent = `${activeItem.name} 외 ${rec.items.length - 1}곳`;
          }

          const itemMap = rec.rowMap || rec.pillMap;
          if (itemMap) {
            itemMap.forEach((rowEl, fKey) => {
              rowEl.classList.toggle('is-selected', selectedKey === fKey);
              rowEl.classList.toggle('is-hovered', hoveredKey === fKey);
            });
          }
        }
      }
      this._currentSelectedKey = selectedKey;
      this._currentHoveredKey = hoveredKey;
      return;
    }

    this._clearFacilityMarkers();
    this._facilitiesSig = sig;
    this._currentSelectedKey = selectedKey;
    this._currentHoveredKey = hoveredKey;

    // 동일 건물 복수 기관 클러스터링 (12m 이내)
    const clusters = groupCoLocated(facilities, 12);

    for (let cIdx = 0; cIdx < clusters.length; cIdx++) {
      const cluster = clusters[cIdx];
      const lngLat = [cluster.lon, cluster.lat];

      if (!cluster.isMulti && cluster.items.length === 1) {
        // 단일 기관 마커 (.stis-pin-3d)
        const { marker, record } = this._createSinglePinMarker(cluster.items[0], lngLat, selectedKey, hoveredKey);
        this._facilityMarkers.push(marker);
        this._markerRecords.push(record);
      } else if (cluster.items.length > 0) {
        // 동일 건물 복수 기관 컴팩트 클러스터 핀 (.stis-cluster-pin)
        const { marker, record } = this._createClusterMarker(cluster, lngLat, selectedKey, hoveredKey);
        this._facilityMarkers.push(marker);
        this._markerRecords.push(record);
      }
    }
  }

  /**
   * 단일 기관 3D 컴팩트 핀 마커 생성 (.stis-pin-3d)
   * @private
   */
  _createSinglePinMarker(facility, lngLat, selectedKey, hoveredKey) {
    const maplibregl = window.maplibregl;
    const fKey = facilityKey(facility);
    const isSelected = selectedKey === fKey;
    const isHovered = hoveredKey === fKey;
    const catColor = getCatColorCss(facility.cat);

    const el = document.createElement('div');
    el.className = 'stis-pin-3d';
    if (isSelected) el.classList.add('is-selected');
    if (isHovered) el.classList.add('is-hovered');
    if (facility.ap) el.classList.add('is-approx');

    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', `${facility.name} (${CATL[facility.cat] || facility.cat})`);
    el.style.setProperty('--cat-color', catColor);

    const distText = facility.m != null ? fmtDist(facility.m) : '';

    el.innerHTML = `
      <div class="pin-callout" aria-hidden="true">
        <span class="pin-callout-name">${escapeHtml(facility.name)}</span>
        ${distText ? `<em class="pin-callout-dist">${distText}</em>` : ''}
      </div>
      <div class="pin-badge" style="background:${catColor}">
        ${renderCatIcon(facility.cat, 20)}
      </div>
      <span class="pin-stem" aria-hidden="true"></span>
      <span class="pin-shadow" aria-hidden="true"></span>
    `;

    // 이벤트 리스너
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onSelectFacility?.(facility, true);
    });

    el.addEventListener('mouseenter', () => {
      this.onHoverFacility?.(facility);
    });

    el.addEventListener('mouseleave', () => {
      this.onHoverFacility?.(null);
    });

    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        this.onSelectFacility?.(facility, true);
      }
    });

    const marker = new maplibregl.Marker({
      element: el,
      anchor: 'bottom',
      opacityWhenCovered: '0.92'
    })
      .setLngLat(lngLat)
      .addTo(this.map);

    return { marker, record: { type: 'single', el, keys: [fKey] } };
  }

  /**
   * 클러스터 배지 클릭 시 다음 순환 대상 시설 반환
   * @private
   */
  _getNextClusterItem(items, currentSelectedKey) {
    if (!items || items.length === 0) return null;
    if (!currentSelectedKey) return items[0];

    const idx = items.findIndex(it => facilityKey(it) === currentSelectedKey);
    if (idx === -1) return items[0];
    return items[(idx + 1) % items.length];
  }

  /**
   * 동일 건물 복수 기관 컴팩트 클러스터 핀 생성 (.stis-cluster-pin)
   * 기본 상태에서는 34px 서큘러 배지 + 상단 카운트 배지만 노출, 호버/선택 시 앵커 팝오버 부드럽게 전개
   * @private
   */
  _createClusterMarker(cluster, lngLat, selectedKey, hoveredKey) {
    const maplibregl = window.maplibregl;
    const items = cluster.items;

    const hasSelected = items.some(item => selectedKey === facilityKey(item));
    const hasHovered = items.some(item => hoveredKey === facilityKey(item));
    const activeItem = items.find(item => selectedKey === facilityKey(item)) || items[0];
    const catColor = getCatColorCss(activeItem.cat);

    const el = document.createElement('div');
    el.className = 'stis-cluster-pin';
    if (hasSelected) el.classList.add('has-selected');
    if (hasHovered) el.classList.add('has-hovered');

    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', `동일 건물 시설 ${items.length}곳`);

    // 0) 선택 상태에서 건물 시야를 가리지 않는 슬림 원줄 콜아웃 (.pin-callout)
    const activeDist = activeItem.m != null ? fmtDist(activeItem.m) : '';
    const calloutEl = document.createElement('div');
    calloutEl.className = 'pin-callout';
    calloutEl.setAttribute('aria-hidden', 'true');
    const calloutNameEl = document.createElement('span');
    calloutNameEl.className = 'pin-callout-name';
    calloutNameEl.textContent = `${activeItem.name} 외 ${items.length - 1}곳`;
    calloutEl.appendChild(calloutNameEl);
    if (activeDist) {
      const calloutDistEl = document.createElement('em');
      calloutDistEl.className = 'pin-callout-dist';
      calloutDistEl.textContent = activeDist;
      calloutEl.appendChild(calloutDistEl);
    }
    el.appendChild(calloutEl);

    // 1) 앵커 팝오버 리스트 (.cluster-popover) - 핀 호버 시에만 위쪽 전개 (bottom: calc(100% + 8px))
    const popover = document.createElement('div');
    popover.className = 'cluster-popover';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', `동일 건물 ${items.length}곳 목록`);

    const headEl = document.createElement('div');
    headEl.className = 'cluster-popover-head';
    headEl.innerHTML = `🏢 동일 건물 ${items.length}곳`;
    popover.appendChild(headEl);

    const listWrap = document.createElement('div');
    listWrap.className = 'cluster-popover-list';
    const rowMap = new Map();
    const keys = [];

    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      const fKey = facilityKey(item);
      keys.push(fKey);
      const isSelected = selectedKey === fKey;
      const isHovered = hoveredKey === fKey;

      const row = document.createElement('div');
      row.className = 'cluster-popover-item';
      if (isSelected) row.classList.add('is-selected');
      if (isHovered) row.classList.add('is-hovered');

      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '0');
      row.setAttribute('aria-label', `${item.name} (${CATL[item.cat] || item.cat})`);
      row.setAttribute('data-fkey', fKey);

      const distText = item.m != null ? fmtDist(item.m) : '';

      row.innerHTML = `
        <span class="cluster-row-tag">#${idx + 1}</span>
        <span class="cluster-row-icon">${renderCatIcon(item.cat, 18)}</span>
        <span class="cluster-row-name">${escapeHtml(item.name)}</span>
        ${distText ? `<span class="cluster-row-dist">· ${distText}</span>` : ''}
      `;

      row.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onSelectFacility?.(item, true);
      });

      row.addEventListener('mouseenter', () => {
        this.onHoverFacility?.(item);
      });

      row.addEventListener('mouseleave', () => {
        this.onHoverFacility?.(null);
      });

      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          this.onSelectFacility?.(item, true);
        }
      });

      rowMap.set(fKey, row);
      listWrap.appendChild(row);
    }

    popover.appendChild(listWrap);
    el.appendChild(popover);

    // 2) 컴팩트 34px 서큘러 배지 (.cluster-badge) + 카운트 배지 (.cluster-count)
    const badgeEl = document.createElement('div');
    badgeEl.className = 'cluster-badge';
    badgeEl.style.background = catColor;
    badgeEl.setAttribute('role', 'button');
    badgeEl.setAttribute('tabindex', '0');
    badgeEl.setAttribute('aria-label', `동일 건물 ${items.length}곳 시설 핀`);

    const badgeIconEl = document.createElement('span');
    badgeIconEl.className = 'cluster-badge-icon';
    badgeIconEl.innerHTML = renderCatIcon(activeItem.cat, 20);
    badgeEl.appendChild(badgeIconEl);

    const countEl = document.createElement('span');
    countEl.className = 'cluster-count';
    countEl.textContent = `×${items.length}`;
    badgeEl.appendChild(countEl);

    el.appendChild(badgeEl);

    // 3) 스템 및 그림자
    const stem = document.createElement('span');
    stem.className = 'pin-stem';
    stem.setAttribute('aria-hidden', 'true');
    el.appendChild(stem);

    const shadow = document.createElement('span');
    shadow.className = 'pin-shadow';
    shadow.setAttribute('aria-hidden', 'true');
    el.appendChild(shadow);

    // 배지 클릭 시: 첫 번째 선택 또는 다음 형제 순환 선택
    const handleBadgeClick = (e) => {
      e.stopPropagation();
      const nextItem = this._getNextClusterItem(items, this._currentSelectedKey);
      this.onSelectFacility?.(nextItem, true);
    };

    badgeEl.addEventListener('click', handleBadgeClick);
    badgeEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleBadgeClick(e);
      }
    });

    // 호버 상태 유지
    el.addEventListener('mouseenter', () => {
      el.classList.add('has-hovered');
    });
    el.addEventListener('mouseleave', () => {
      el.classList.remove('has-hovered');
    });

    const marker = new maplibregl.Marker({
      element: el,
      anchor: 'bottom',
      opacityWhenCovered: '0.92'
    })
      .setLngLat(lngLat)
      .addTo(this.map);

    return {
      marker,
      record: {
        type: 'cluster',
        el,
        keys,
        rowMap,
        pillMap: rowMap,
        items,
        badgeEl,
        badgeIconEl,
        calloutNameEl
      }
    };
  }
}
