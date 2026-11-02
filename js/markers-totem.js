// js/markers-totem.js
// STIS 3D Totem Marker Manager: 입체 비콘 마커 및 복합 건물 3D 수직 토템 스택 렌더러

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
 * MapLibre HTML 마커 관리자
 * - 기준 학교 3D 비콘 마커 (.stis-school-beacon)
 * - 단일 기관 3D 핀 마커 (.stis-pin-3d)
 * - 동일 건물 2~3개 기관 수직 토템 스택 (.stis-totem-stack)
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
    /** @type {Array<{ type: 'single'|'totem', el: HTMLElement, keys: string[], pillMap?: Map<string, HTMLElement> }>} */
    this._markerRecords = [];
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
      // 학교 클릭 시 맵 센터링 또는 포커스 유지
    });

    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
      }
    });

    this._schoolMarker = new maplibregl.Marker({
      element: el,
      anchor: 'bottom'
    })
      .setLngLat([school.lon, school.lat])
      .addTo(this.map);

    this._schoolKey = schoolKey;
  }

  /**
   * 기관 마커 및 수직 토템 스택 동기화
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

    // 시설 목록이 동일하면 DOM 재생성 없이 선택/호버 클래스만 즉시 갱신 (클릭 유실 및 깜빡임 원천 차단)
    if (sig === this._facilitiesSig && this._markerRecords.length > 0) {
      for (let i = 0; i < this._markerRecords.length; i++) {
        const rec = this._markerRecords[i];
        if (rec.type === 'single') {
          const fKey = rec.keys[0];
          rec.el.classList.toggle('is-selected', selectedKey === fKey);
          rec.el.classList.toggle('is-hovered', hoveredKey === fKey);
        } else if (rec.type === 'totem') {
          const hasSel = rec.keys.includes(selectedKey);
          const hasHov = rec.keys.includes(hoveredKey);
          rec.el.classList.toggle('has-selected', hasSel);
          rec.el.classList.toggle('has-hovered', hasHov);
          rec.pillMap.forEach((pillEl, fKey) => {
            pillEl.classList.toggle('is-selected', selectedKey === fKey);
            pillEl.classList.toggle('is-hovered', hoveredKey === fKey);
          });
        }
      }
      return;
    }

    this._clearFacilityMarkers();
    this._facilitiesSig = sig;

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
        // 동일 건물 복합 기관 수직 토템 스택 (.stis-totem-stack)
        const { marker, record } = this._createTotemStackMarker(cluster, lngLat, selectedKey, hoveredKey);
        this._facilityMarkers.push(marker);
        this._markerRecords.push(record);
      }
    }
  }

  /**
   * 단일 기관 3D 핀 마커 생성
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
        ${renderCatIcon(facility.cat, 26)}
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
      anchor: 'bottom'
    })
      .setLngLat(lngLat)
      .addTo(this.map);

    return { marker, record: { type: 'single', el, keys: [fKey] } };
  }

  /**
   * 복합 건물 3D 수직 토템 스택 마커 생성
   * @private
   */
  _createTotemStackMarker(cluster, lngLat, selectedKey, hoveredKey) {
    const maplibregl = window.maplibregl;
    const items = cluster.items;

    const hasSelected = items.some(item => selectedKey === facilityKey(item));
    const hasHovered = items.some(item => hoveredKey === facilityKey(item));

    const el = document.createElement('div');
    el.className = 'stis-totem-stack';
    if (hasSelected) el.classList.add('has-selected');
    if (hasHovered) el.classList.add('has-hovered');

    // 최상단 헤더 배지
    const headEl = document.createElement('div');
    headEl.className = 'totem-head';
    headEl.innerHTML = `<span class="totem-head-icon" aria-hidden="true">🏢</span> 복합 ${items.length}곳`;
    el.appendChild(headEl);

    // 층별 캡슐 컨테이너
    const pillsWrap = document.createElement('div');
    pillsWrap.className = 'totem-pills';
    const pillMap = new Map();
    const keys = [];

    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      const fKey = facilityKey(item);
      keys.push(fKey);
      const isSelected = selectedKey === fKey;
      const isHovered = hoveredKey === fKey;
      const catColor = getCatColorCss(item.cat);

      const pill = document.createElement('div');
      pill.className = 'totem-pill';
      if (isSelected) pill.classList.add('is-selected');
      if (isHovered) pill.classList.add('is-hovered');
      if (item.ap) pill.classList.add('is-approx');

      pill.setAttribute('role', 'button');
      pill.setAttribute('tabindex', '0');
      pill.setAttribute('aria-label', `${item.name} (${CATL[item.cat] || item.cat})`);
      pill.setAttribute('data-fkey', fKey);
      pill.style.setProperty('--cat-color', catColor);

      const distText = item.m != null ? fmtDist(item.m) : '';

      pill.innerHTML = `
        <span class="totem-tag">#${idx + 1}</span>
        <span class="totem-icon">${renderCatIcon(item.cat, 20)}</span>
        <span class="totem-name">${escapeHtml(item.name)}</span>
        ${distText ? `<span class="totem-dist">${distText}</span>` : ''}
      `;

      // 개별 기관 캡슐 클릭 시 완벽하게 해당 기관만 선택
      pill.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onSelectFacility?.(item, true);
      });

      pill.addEventListener('mouseenter', () => {
        this.onHoverFacility?.(item);
      });

      pill.addEventListener('mouseleave', () => {
        this.onHoverFacility?.(null);
      });

      pill.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          this.onSelectFacility?.(item, true);
        }
      });

      pillMap.set(fKey, pill);
      pillsWrap.appendChild(pill);
    }

    el.appendChild(pillsWrap);

    // 수직 척추(스파인) 및 베이스 링
    const spine = document.createElement('div');
    spine.className = 'totem-spine';
    spine.setAttribute('aria-hidden', 'true');
    el.appendChild(spine);

    const baseRing = document.createElement('div');
    baseRing.className = 'totem-base-ring';
    baseRing.setAttribute('aria-hidden', 'true');
    el.appendChild(baseRing);

    // 전체 마커 클릭 시 전파 차단
    el.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    const marker = new maplibregl.Marker({
      element: el,
      anchor: 'bottom'
    })
      .setLngLat(lngLat)
      .addTo(this.map);

    return { marker, record: { type: 'totem', el, keys, pillMap } };
  }
}
