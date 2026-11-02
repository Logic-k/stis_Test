// js/markers-totem.js
// STIS 3D Totem Marker Manager: 입체 비콘 마커 및 옥상 스마트 엠블럼 POI 핀 + 앵커 팝오버 렌더러

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
 * 3D 옥상 스마트 엠블럼 POI 핀 및 클러스터 팝오버 전용 고대비 HUD 스타일 주입
 */
function ensureClusterStyles() {
  if (typeof document === 'undefined') return;
  const styleId = 'stis-totem-cluster-injected-css';
  if (document.getElementById(styleId)) return;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    /* ==========================================================================
       3D 건물 옥상 스마트 엠블럼 배지 및 일체형 명칭 칩 (.stis-pin-3d, .stis-cluster-pin)
       - 웹GL 분리 라벨의 40px 이격 오차를 원천 제거하고, 아이콘과 기관명을 한 몸으로 결합
       - 옥상 무게중심(Centroid)에 삼각 앵커 포인터가 정확히 안착
       ========================================================================== */

    .stis-pin-3d.maplibregl-marker-covered,
    .stis-cluster-pin.maplibregl-marker-covered {
      opacity: 0.88 !important;
    }
    .stis-pin-3d.is-selected,
    .stis-cluster-pin.has-selected {
      opacity: 1 !important;
      z-index: 100 !important;
    }

    /* (A) 단일 시설 스마트 옥상 엠블럼 핀 (.stis-pin-3d) */
    .stis-pin-3d {
      position: relative;
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      cursor: pointer;
      pointer-events: auto;
      user-select: none;
      filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.38));
      transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), z-index 0.2s ease;
      z-index: 10;
    }

    .stis-pin-3d .pin-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      height: 28px;
      padding: 2px 8px 2px 3px;
      background: rgba(13, 22, 29, 0.94);
      border: 1.5px solid rgba(255, 255, 255, 0.25);
      border-radius: 999px;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.38);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      color: #FFFFFF;
      white-space: nowrap;
      transition: all 0.2s ease;
    }

    .stis-pin-3d .pin-badge {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      border: 1.5px solid #FFFFFF;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      color: #FFFFFF;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
    }
    .stis-pin-3d .pin-badge svg {
      width: 14px;
      height: 14px;
    }

    .stis-pin-3d .pin-title {
      font-size: 11.5px;
      font-weight: 700;
      color: #FFFFFF;
      max-width: 125px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      letter-spacing: -0.2px;
    }

    .stis-pin-3d .pin-dist-pill {
      font-size: 10px;
      font-weight: 600;
      color: #F2A43A;
      margin-left: 1px;
      flex-shrink: 0;
    }

    /* 건물 옥상 정확한 착지를 안내하는 삼각 앵커 포인터 */
    .stis-pin-3d .pin-pointer {
      width: 0;
      height: 0;
      border-left: 5px solid transparent;
      border-right: 5px solid transparent;
      border-top: 6px solid rgba(13, 22, 29, 0.94);
      margin-top: -1px;
      transition: border-top-color 0.2s ease, transform 0.2s ease;
    }

    /* 호버 반응 */
    .stis-pin-3d:hover,
    .stis-pin-3d.is-hovered {
      transform: translateY(-3px) scale(1.06);
      z-index: 40 !important;
    }
    .stis-pin-3d:hover .pin-pill,
    .stis-pin-3d.is-hovered .pin-pill {
      background: rgba(18, 32, 44, 0.98);
      border-color: rgba(255, 255, 255, 0.5);
    }
    .stis-pin-3d:hover .pin-pointer,
    .stis-pin-3d.is-hovered .pin-pointer {
      border-top-color: rgba(18, 32, 44, 0.98);
    }

    /* 선택 반응 (황금 아우라) */
    .stis-pin-3d.is-selected {
      transform: translateY(-4px) scale(1.14);
      z-index: 50 !important;
    }
    .stis-pin-3d.is-selected .pin-pill {
      background: #0D1922;
      border-color: #F2A43A;
      box-shadow: 0 0 0 3px #F2A43A, 0 8px 24px rgba(242, 164, 58, 0.65);
    }
    .stis-pin-3d.is-selected .pin-pointer {
      border-top-color: #F2A43A;
      transform: scale(1.2);
    }

    /* (B) 동일 건물 복합 시설 스마트 옥상 클러스터 핀 (.stis-cluster-pin) */
    .stis-cluster-pin {
      position: relative;
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      cursor: pointer;
      pointer-events: auto;
      user-select: none;
      z-index: 15;
      filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.38));
      transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), z-index 0.2s ease;
    }

    .stis-cluster-pin .cluster-pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      height: 28px;
      padding: 2px 7px 2px 3px;
      background: rgba(13, 22, 29, 0.94);
      border: 1.5px solid rgba(255, 255, 255, 0.25);
      border-radius: 999px;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.38);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      color: #FFFFFF;
      white-space: nowrap;
      transition: all 0.2s ease;
    }

    .stis-cluster-pin .cluster-badge {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      border: 1.5px solid #FFFFFF;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      color: #FFFFFF;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
    }
    .stis-cluster-pin .cluster-badge svg {
      width: 14px;
      height: 14px;
    }

    .stis-cluster-pin .cluster-title {
      font-size: 11.5px;
      font-weight: 700;
      color: #FFFFFF;
      max-width: 120px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      letter-spacing: -0.2px;
    }

    .stis-cluster-pin .cluster-count-tag {
      font-size: 10px;
      font-weight: 800;
      background: #F2A43A;
      color: #0F171B;
      border-radius: 999px;
      padding: 1px 5px;
      margin-left: 1px;
      flex-shrink: 0;
      line-height: 1.3;
    }

    .stis-cluster-pin .pin-pointer {
      width: 0;
      height: 0;
      border-left: 5px solid transparent;
      border-right: 5px solid transparent;
      border-top: 6px solid rgba(13, 22, 29, 0.94);
      margin-top: -1px;
      transition: border-top-color 0.2s ease, transform 0.2s ease;
    }

    .stis-cluster-pin:hover,
    .stis-cluster-pin.has-hovered {
      transform: translateY(-3px) scale(1.06);
      z-index: 40 !important;
    }
    .stis-cluster-pin:hover .cluster-pill,
    .stis-cluster-pin.has-hovered .cluster-pill {
      background: rgba(18, 32, 44, 0.98);
      border-color: rgba(255, 255, 255, 0.5);
    }

    .stis-cluster-pin.has-selected {
      transform: translateY(-4px) scale(1.14);
      z-index: 50 !important;
    }
    .stis-cluster-pin.has-selected .cluster-pill {
      background: #0D1922;
      border-color: #F2A43A;
      box-shadow: 0 0 0 3px #F2A43A, 0 8px 24px rgba(242, 164, 58, 0.65);
    }
    .stis-cluster-pin.has-selected .pin-pointer {
      border-top-color: #F2A43A;
      transform: scale(1.2);
    }

    /* 앵커드 고대비 팝오버 리스트 (호버 시 전개) */
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
      border: 1px solid rgba(255, 255, 255, 0.22);
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
      left: 50%;
      transform: translateX(-50%);
      border-left: 6px solid transparent;
      border-right: 6px solid transparent;
      border-top: 6px solid rgba(14, 23, 29, 0.96);
    }
    .stis-cluster-pin:hover .cluster-popover,
    .stis-cluster-pin.has-hovered .cluster-popover {
      opacity: 1;
      visibility: visible;
      pointer-events: auto;
      transform: translateX(-50%) translateY(0);
    }
    .cluster-popover-head {
      font-size: 11px;
      font-weight: 800;
      color: #F2A43A;
      padding: 4px 8px 6px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.12);
      margin-bottom: 4px;
      display: flex;
      align-items: center;
      gap: 5px;
      letter-spacing: -0.01em;
    }
    .cluster-popover-list {
      display: flex;
      flex-direction: column;
      gap: 3px;
      max-height: 220px;
      overflow-y: auto;
    }
    .cluster-popover-item {
      display: flex;
      align-items: center;
      gap: 7px;
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
    /* 라이트 테마 고대비 스마트 엠블럼 칩 스타일 */
    [data-theme="light"] .stis-pin-3d .pin-pill,
    [data-theme="light"] .stis-cluster-pin .cluster-pill {
      background: rgba(255, 255, 255, 0.96);
      border-color: rgba(15, 25, 33, 0.22);
      color: #122430;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.16);
    }
    [data-theme="light"] .stis-pin-3d .pin-title,
    [data-theme="light"] .stis-cluster-pin .cluster-title {
      color: #122430;
    }
    [data-theme="light"] .stis-pin-3d .pin-pointer,
    [data-theme="light"] .stis-cluster-pin .pin-pointer {
      border-top-color: rgba(255, 255, 255, 0.96);
    }
    [data-theme="light"] .stis-pin-3d .pin-dist-pill {
      color: #D97706;
    }
    [data-theme="light"] .stis-pin-3d:hover .pin-pill,
    [data-theme="light"] .stis-cluster-pin:hover .cluster-pill {
      background: #FFFFFF;
      border-color: rgba(15, 25, 33, 0.45);
    }
    [data-theme="light"] .stis-pin-3d:hover .pin-pointer,
    [data-theme="light"] .stis-cluster-pin:hover .pin-pointer {
      border-top-color: #FFFFFF;
    }
    [data-theme="light"] .stis-pin-3d.is-selected .pin-pill,
    [data-theme="light"] .stis-cluster-pin.has-selected .cluster-pill {
      background: #11202C;
      border-color: #F2A43A;
      box-shadow: 0 0 0 3px #F2A43A, 0 8px 24px rgba(242, 164, 58, 0.65);
    }
    [data-theme="light"] .stis-pin-3d.is-selected .pin-title,
    [data-theme="light"] .stis-cluster-pin.has-selected .cluster-title {
      color: #FFFFFF;
    }
    [data-theme="light"] .stis-pin-3d.is-selected .pin-pointer,
    [data-theme="light"] .stis-cluster-pin.has-selected .pin-pointer {
      border-top-color: #F2A43A;
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
 * - 단일 기관 3D 옥상 스마트 엠블럼 핀 (.stis-pin-3d)
 * - 동일 건물 2~3개 기관 스마트 클러스터 핀 + 앵커 팝오버 (.stis-cluster-pin)
 */
export class TotemMarkerManager {
  /**
   * @param {maplibregl.Map} map MapLibre 지도 인스턴스
   * @param {Object} callbacks
   * @param {Function} callbacks.onSelectFacility 시설 선택 콜백 (facility, shouldCenter)
   * @param {Function} callbacks.onHoverFacility 시설 호버 콜백 (facility | null)
   * @param {Function} [callbacks.getSnappedBuilding] 실제 3D 건물 스냅 좌표 조회 콜백
   */
  constructor(map, { onSelectFacility, onHoverFacility, getSnappedBuilding } = {}) {
    this.map = map;
    this.onSelectFacility = onSelectFacility;
    this.onHoverFacility = onHoverFacility;
    this.getSnappedBuilding = getSnappedBuilding;

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
      return;
    }

    if (this._schoolMarker) {
      this._schoolMarker.remove();
      this._schoolMarker = null;
    }

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

    const snapped = this.getSnappedBuilding?.(school.lon, school.lat);
    const schoolPos = (snapped && snapped.centroid) ? snapped.centroid : [school.lon, school.lat];

    this._schoolMarker = new maplibregl.Marker({
      element: el,
      anchor: 'bottom',
      opacityWhenCovered: 0.95
    })
      .setLngLat(schoolPos)
      .addTo(this.map);

    this._schoolKey = schoolKey;
  }

  /**
   * 기관 마커 및 컴팩트 클러스터 핀 동기화
   * - 실제 3D 건물 스냅 좌표를 적용하여 건물 지붕 정중앙에 배지 안착
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

          const activeItem = (rec.items || []).find(it => facilityKey(it) === selectedKey) || (rec.items && rec.items[0]);
          if (rec.badgeEl && activeItem) {
            rec.badgeEl.style.background = getCatColorCss(activeItem.cat);
            if (rec.badgeIconEl) {
              rec.badgeIconEl.innerHTML = renderCatIcon(activeItem.cat, 14);
            }
          }
          if (rec.titleEl && activeItem) {
            rec.titleEl.textContent = activeItem.name;
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
      // 실제 3D 건물의 무게중심(Centroid) 좌표로 마커 스냅
      const snapped = this.getSnappedBuilding?.(cluster.lon, cluster.lat);
      const lngLat = (snapped && snapped.centroid) ? snapped.centroid : [cluster.lon, cluster.lat];

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
   * 단일 기관 3D 옥상 스마트 엠블럼 핀 생성 (.stis-pin-3d)
   * - 배지와 명칭 칩이 일체형으로 결합되어 분리 이격 없는 직관적 UI 제공
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
      <div class="pin-pill">
        <span class="pin-badge" style="background:${catColor}">
          ${renderCatIcon(facility.cat, 14)}
        </span>
        <span class="pin-title">${escapeHtml(facility.name)}</span>
        ${distText ? `<span class="pin-dist-pill">${distText}</span>` : ''}
      </div>
      <span class="pin-pointer" aria-hidden="true"></span>
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
      opacityWhenCovered: 0.9
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
   * 동일 건물 복수 기관 스마트 옥상 클러스터 핀 생성 (.stis-cluster-pin)
   * - 일체형 명칭 칩과 카운트 태그(+N)를 함께 제공하여 건물의 다중 입주 기관을 직관적으로 확인
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

    // 1) 앵커 팝오버 리스트 (.cluster-popover) - 핀 호버 시에만 위쪽 전개
    const popover = document.createElement('div');
    popover.className = 'cluster-popover';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', `동일 건물 ${items.length}곳 목록`);

    const headEl = document.createElement('div');
    headEl.className = 'cluster-popover-head';
    headEl.innerHTML = `🏢 동일 건물 ${items.length}곳 입주`;
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
        <span class="cluster-row-icon">${renderCatIcon(item.cat, 16)}</span>
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

    // 2) 일체형 클러스터 칩 (.cluster-pill)
    const pillEl = document.createElement('div');
    pillEl.className = 'cluster-pill';

    const badgeEl = document.createElement('span');
    badgeEl.className = 'cluster-badge';
    badgeEl.style.background = catColor;

    const badgeIconEl = document.createElement('span');
    badgeIconEl.className = 'cluster-badge-icon';
    badgeIconEl.innerHTML = renderCatIcon(activeItem.cat, 14);
    badgeEl.appendChild(badgeIconEl);
    pillEl.appendChild(badgeEl);

    const titleEl = document.createElement('span');
    titleEl.className = 'cluster-title';
    titleEl.textContent = activeItem.name;
    pillEl.appendChild(titleEl);

    const countTag = document.createElement('span');
    countTag.className = 'cluster-count-tag';
    countTag.textContent = `+${items.length - 1}`;
    pillEl.appendChild(countTag);

    el.appendChild(pillEl);

    // 3) 옥상 삼각 착지 앵커 포인터
    const pointer = document.createElement('span');
    pointer.className = 'pin-pointer';
    pointer.setAttribute('aria-hidden', 'true');
    el.appendChild(pointer);

    // 배지 클릭 시: 첫 번째 선택 또는 다음 형제 순환 선택
    const handleBadgeClick = (e) => {
      e.stopPropagation();
      const nextItem = this._getNextClusterItem(items, this._currentSelectedKey);
      this.onSelectFacility?.(nextItem, true);
    };

    el.addEventListener('click', handleBadgeClick);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleBadgeClick(e);
      }
    });

    // 호버 상태 유지
    el.addEventListener('mouseenter', () => {
      el.classList.add('has-hovered');
      this.onHoverFacility?.(activeItem);
    });
    el.addEventListener('mouseleave', () => {
      el.classList.remove('has-hovered');
      this.onHoverFacility?.(null);
    });

    const marker = new maplibregl.Marker({
      element: el,
      anchor: 'bottom',
      opacityWhenCovered: 0.9
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
        titleEl
      }
    };
  }
}
