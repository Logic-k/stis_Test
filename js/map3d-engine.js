// js/map3d-engine.js
// STIS 3D Map Engine: 무인증키(Zero-Key) + Overture 3D 건물 PMTiles + 3D DEM 산악 지형 + deck.gl 3D 인터리브드 오버레이 + 드론 오빗 카메라 총괄

import { CATL, CAT_COLORS, GU_COLORS, facilityKey, renderCatIcon } from './constants.js';
import { toLngLat, fmtDist, groupCoLocated, createCircleGeoJSON, createRadarRingsGeoJSON } from './geo-utils.js';
import { GU_OUTLINES_GEOJSON, DONG_OUTLINES_GEOJSON, GU_LABELS_GEOJSON, DONG_LABELS_GEOJSON } from '../data/geo-boundaries.js';
import { TotemMarkerManager } from './markers-totem.js';

/**
 * HEX 색상을 [r, g, b] 배열로 변환
 * @param {string} hex
 * @returns {[number, number, number]}
 */
function resolveCatHex(cat, theme = 'light') {
  const c = CAT_COLORS[cat];
  if (!c) return '#0F6E8C';
  if (typeof c === 'string') return c;
  return (theme === 'dark' ? c.dark : c.light) || c.light || '#0F6E8C';
}

function resolveCatRgb(cat, theme = 'light') {
  const c = CAT_COLORS[cat];
  if (c && typeof c === 'object') {
    const arr = theme === 'dark' ? (c.darkRgb || c.rgb) : c.rgb;
    if (Array.isArray(arr) && arr.length >= 3) return arr;
  }
  return hexToRgb(resolveCatHex(cat, theme));
}

function hexToRgb(hex) {
  if (!hex || typeof hex !== 'string') return [15, 110, 140];
  let h = hex.replace('#', '').trim();
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  const val = parseInt(h, 16);
  if (isNaN(val)) return [15, 110, 140];
  return [(val >> 16) & 255, (val >> 8) & 255, val & 255];
}

/**
 * 원형 다각형 좌표 배열 생성 (deck.gl PolygonLayer 용)
 * @param {number} lon
 * @param {number} lat
 * @param {number} radiusMeters
 * @param {number} steps
 * @returns {Array<[number, number]>}
 */
function createCircleCoordinates(lon, lat, radiusMeters, steps = 24) {
  const coords = [];
  const latRad = (lat * Math.PI) / 180;
  const metersPerDegLat = 111132;
  const metersPerDegLon = 111320 * Math.cos(latRad);

  for (let i = 0; i <= steps; i++) {
    const angle = (i * 2 * Math.PI) / steps;
    const dx = radiusMeters * Math.cos(angle);
    const dy = radiusMeters * Math.sin(angle);
    coords.push([
      lon + dx / metersPerDegLon,
      lat + dy / metersPerDegLat
    ]);
  }
  return coords;
}

/**
 * 다각형 외곽선 좌표 배열로부터 수학적 무게중심(Centroid [lon, lat]) 계산
 * @param {Array<[number, number]>} ring
 * @returns {[number, number]|null} [centerLon, centerLat]
 */
function computePolygonCentroid(ring) {
  if (!ring || ring.length === 0) return null;
  if (ring.length === 1) return [ring[0][0], ring[0][1]];

  let area = 0;
  let cx = 0;
  let cy = 0;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const x0 = ring[j][0], y0 = ring[j][1];
    const x1 = ring[i][0], y1 = ring[i][1];
    const cross = (x0 * y1) - (x1 * y0);
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }

  area = area / 2;
  if (Math.abs(area) < 1e-12) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < ring.length; i++) {
      const [x, y] = ring[i];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return [(minX + maxX) / 2, (minY + maxY) / 2];
  }

  cx = cx / (6 * area);
  cy = cy / (6 * area);
  return [cx, cy];
}

/**
 * OpenFreeMap Positron 테마 보정 및 한국어 전용 카토그래피 정제 헬퍼
 * - 시각적 노이즈(도로 쉴드, 중복 행정구역 라벨, POI) 제거
 * - 모든 라벨 한국어 우선 명칭 및 대문자 방지 강제
 * - 베이스맵 라벨 톤다운을 통한 맞춤지원 시설 시인성 극대화
 * @param {Object} style Positron 원본 스타일 JSON
 * @param {'light'|'dark'} theme
 * @returns {Object} 보정된 스타일 JSON
 */
function customizeBaseStyle(style, theme) {
  const isDark = theme === 'dark';
  const seaColor = isDark ? '#102632' : '#CFE6F0';
  const landColor = isDark ? '#18232B' : '#FFFBF2';
  const bgColor = isDark ? '#0F171B' : '#F3F6F7';

  const layers = (style.layers || []).map(layer => {
    const l = { ...layer, paint: { ...(layer.paint || {}) }, layout: { ...(layer.layout || {}) } };

    // 배경 및 육지
    if (l.id === 'background') {
      l.paint['background-color'] = bgColor;
    } else if (l.id.includes('land') || l.id.includes('landcover') || l.id.includes('park') || l.id.includes('landuse')) {
      if (l.paint['fill-color']) {
        l.paint['fill-color'] = landColor;
      }
    }

    // 바다 / 수계
    if (l.id.includes('water') || l.id.includes('ocean') || l.id.includes('sea')) {
      if (l.paint['fill-color']) {
        l.paint['fill-color'] = seaColor;
      }
    }

    // 기본 평면 건물 레이어 숨김 처리 (우리가 직접 3D 익스트루전으로 렌더링)
    if (l.id === 'building' || (l['source-layer'] === 'building' && l.type === 'fill')) {
      l.layout.visibility = 'none';
    }

    // 도로 쉴드/노선 번호, POI, OFM 중복 동/지명 레이어 숨김 처리 (자체 검증된 동/구 라벨 보유)
    const isRoadShield = l.id.includes('shield') || (l.id.includes('highway-name-path') && !!l.layout['icon-image']);
    const isPoi = l.id.includes('poi');
    const isOfmPlace = l.id.includes('place_suburb') ||
      l.id.includes('place_neighbourhood') ||
      l.id.includes('place_quarter') ||
      l.id.includes('place-suburb') ||
      l.id.includes('place-neighbourhood') ||
      l.id.includes('place_hamlet') ||
      l.id.includes('place_isolated');

    if (isRoadShield || isPoi || isOfmPlace) {
      l.layout.visibility = 'none';
    }

    // 잔여 모든 활성 심볼(라벨) 레이어 정제
    if (l.type === 'symbol' && l.layout.visibility !== 'none') {
      // 1) 한국어 우선 라벨 텍스트 강제
      l.layout['text-field'] = ['coalesce', ['get', 'name:ko'], ['get', 'name_ko'], ['get', 'name:kr'], ['get', 'name']];

      // 2) 영문 대문자 표기(SEODAESIN-DONG 등) 방지
      l.layout['text-transform'] = 'none';

      // 3) 도로/교통 심볼 레이어의 아이콘 제거 (고속도로/국도 [2;77] 박스 방지)
      if (l.id.includes('road') || l.id.includes('transport') || l.id.includes('highway') || l.id.includes('motorway') || l.id.includes('traffic') || l['source-layer'] === 'transportation_name' || l['source-layer'] === 'transportation') {
        delete l.layout['icon-image'];
      }

      // 4) 베이스맵 도로/지명 텍스트 차분하게 톤다운 (복지 시설 및 라벨 부각)
      l.paint['text-color'] = isDark ? '#7E95A4' : '#647783';
      l.paint['text-halo-color'] = isDark ? 'rgba(13,21,26,0.9)' : 'rgba(255,255,255,0.92)';
      l.paint['text-halo-width'] = 1.6;
      l.paint['text-opacity'] = 0.72;
    }

    return l;
  });

  return { ...style, layers };
}

/**
 * STIS 3D Map Engine 메인 클래스
 */
export class Map3DEngine {
  static _pmtilesRegistered = false;

  /**
   * @param {Object} options
   * @param {HTMLElement|string} options.container 지도가 마운트될 DOM 컨테이너
   * @param {Function} [options.onSelectFacility] 시설 선택 콜백
   * @param {Function} [options.onHoverFacility] 시설 호버 콜백
   * @param {Function} [options.onPickLocation] 좌표 직접 지정 모드 콜백
   * @param {Function} [options.onOrbitChange] 드론 오빗 상태 변경 콜백
   * @param {Function} [options.onTerrainReady] 3D 지형 로드 완료 콜백
   */
  constructor({
    container,
    onSelectFacility,
    onHoverFacility,
    onPickLocation,
    onOrbitChange,
    onTerrainReady
  } = {}) {
    this.container = typeof container === 'string' ? document.getElementById(container) : container;
    this.onSelectFacility = onSelectFacility;
    this.onHoverFacility = onHoverFacility;
    this.onPickLocation = onPickLocation;
    this.onOrbitChange = onOrbitChange;
    this.onTerrainReady = onTerrainReady;

    /** @type {maplibregl.Map|null} */
    this.map = null;
    this._deckOverlay = null;
    this._totemManager = null;

    // 상태
    this.theme = 'light';
    this.viewMode = 'diorama'; // 'diorama' | 'satellite' | 'flat2d'
    this.school = null;
    this.radius = 1000;
    this.facilities = [];
    this.selectedFacility = null;
    this.hoveredFacility = null;
    this.picking = false;

    // 드론 오빗 제어
    this.isOrbiting = false;
    this._orbitRaf = null;
    this._orbitCenter = null;
    this._orbitLastTime = 0;

    // 소나 스캔 애니메이션 제어
    this._sonarRaf = null;
    this._firstSymbolId = null;
    this._isMapLoaded = false;
    this._facilityClusters = [];

    // 실제 3D 건물 스냅 및 중심점 캐시 (성능 극대화 & 마커 정확도 보장)
    this._buildingSnapCache = new Map();
  }

  /**
   * 지도 초기화
   * @param {Object} params
   * @param {Object} [params.initialSchool] 초기 기준 학교 객체
   * @param {number} [params.initialRadius=1000] 초기 검색 반경 (m)
   * @param {'light'|'dark'} [params.theme='light'] 테마
   * @param {'diorama'|'satellite'|'flat2d'} [params.viewMode='diorama'] 지도 뷰 모드
   */
  async init({
    initialSchool = null,
    initialRadius = 1000,
    theme = 'light',
    viewMode = 'diorama'
  } = {}) {
    this.theme = theme;
    this.viewMode = viewMode;
    this.school = initialSchool;
    this.radius = initialRadius;

    // 1) PMTiles 프로토콜 등록
    if (!Map3DEngine._pmtilesRegistered && window.pmtiles && window.maplibregl) {
      try {
        const protocol = new window.pmtiles.Protocol();
        window.maplibregl.addProtocol('pmtiles', protocol.tile);
        Map3DEngine._pmtilesRegistered = true;
      } catch (err) {
        console.warn('[Map3DEngine] PMTiles protocol registration note:', err);
      }
    }

    // 2) OpenFreeMap Positron 베이스 스타일 fetch 및 테마 커스텀 변형
    let baseStyle;
    try {
      const resp = await fetch('https://tiles.openfreemap.org/styles/positron');
      if (resp.ok) {
        const rawStyle = await resp.json();
        baseStyle = customizeBaseStyle(rawStyle, this.theme);
      } else {
        throw new Error(`Style fetch status ${resp.status}`);
      }
    } catch (e) {
      console.warn('[Map3DEngine] Positron style fetch fallback:', e);
      baseStyle = {
        version: 8,
        sources: {
          openmaptiles: {
            type: 'vector',
            url: 'https://tiles.openfreemap.org/planet'
          }
        },
        layers: [
          {
            id: 'background',
            type: 'background',
            paint: { 'background-color': this.theme === 'dark' ? '#0F171B' : '#F3F6F7' }
          }
        ]
      };
    }

    // 3) 첫 번째 symbol(라벨) 레이어 id 탐색
    this._firstSymbolId = (baseStyle.layers || []).find(l => l.type === 'symbol')?.id || undefined;

    // 초기 중심 좌표 및 시점
    const center = initialSchool && initialSchool.lon != null && initialSchool.lat != null
      ? [initialSchool.lon, initialSchool.lat]
      : [129.02, 35.09]; // 부산 서구·중구 중심 권역

    const initialPitch = this.viewMode === 'flat2d' ? 0 : 56;
    const initialBearing = this.viewMode === 'flat2d' ? 0 : -16;

    // 4) MapLibre Map 인스턴스 생성
    const maplibregl = window.maplibregl;
    if (!maplibregl) {
      throw new Error('[Map3DEngine] window.maplibregl is not loaded.');
    }

    this.map = new maplibregl.Map({
      container: this.container,
      style: baseStyle,
      center,
      zoom: 14.7,
      pitch: initialPitch,
      bearing: initialBearing,
      maxPitch: 78,
      canvasContextAttributes: { antialias: true },
      attributionControl: false
    });

    // 어트리뷰션 컨트롤 컴팩트 배치
    this.map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

    // 지도 로드 완료 대기
    await new Promise((resolve) => {
      this.map.once('load', () => {
        this._isMapLoaded = true;
        this._setupMapLayers();
        this._bindEventListeners();
        resolve();
      });
    });

    // 지형 타일 안정화 콜백
    this.map.once('idle', () => {
      this.onTerrainReady?.();
    });

    // 초기 상태 강제 동기화
    const initSchoolRef = this.school;
    this.school = null;
    this.updateState({
      school: initSchoolRef,
      radius: this.radius,
      facilities: this.facilities,
      theme: this.theme,
      viewMode: this.viewMode
    });
  }

  /**
   * 맵 로드 후 레이어 및 소스 구성
   * @private
   */
  _setupMapLayers() {
    const map = this.map;
    const beforeId = this._firstSymbolId;

    // 1) 3D 산악 지형(DEM) 소스 등록 (AWS S3 Terrarium)
    map.addSource('terrain-dem', {
      type: 'raster-dem',
      tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: 15
    });

    // 2) 음영기복(Hillshade) 소스 및 레이어 등록
    map.addSource('hillshade-dem', {
      type: 'raster-dem',
      tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: 15
    });

    map.addLayer(
      {
        id: 'terrain-hillshade',
        type: 'hillshade',
        source: 'hillshade-dem',
        paint: {
          'hillshade-exaggeration': 0.45,
          'hillshade-shadow-color': this.theme === 'dark' ? '#09151e' : '#475d6b',
          'hillshade-highlight-color': this.theme === 'dark' ? '#273c49' : '#ffffff'
        }
      },
      beforeId
    );

    // 3D 지형 활성화 (뷰모드에 따라)
    if (this.viewMode !== 'flat2d') {
      map.setTerrain({ source: 'terrain-dem', exaggeration: 1.35 });
    }

    // 하늘 및 태양광 설정
    this._updateSkyAndLight();

    // 3) Esri 위성 하이브리드 래스터 소스 및 레이어 등록
    map.addSource('esri-satellite', {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 18
    });

    map.addLayer(
      {
        id: 'satellite-raster',
        type: 'raster',
        source: 'esri-satellite',
        layout: {
          visibility: this.viewMode === 'satellite' ? 'visible' : 'none'
        },
        paint: {
          'raster-opacity': 0.95
        }
      },
      'terrain-hillshade'
    );

    // 4) 4개 구 및 49개 행정동 입체 경계선 소스 & 레이어
    this._setupBoundariesLayers(beforeId);

    // 5) 지형 밀착 반경 레이더 링 및 소나 웨이브 소스 & 레이어
    this._setupRadarAndSonarLayers(beforeId);

    // 6) 3D 건물 익스트루전 레이어 등록
    this._setup3DBuildingLayers(beforeId);

    // 7) 타깃 기관 & 학교 스포트라이트 발광 프리즘 레이어
    this._setupSpotlightLayers(beforeId);

    // 8) WebGL 한국어 기관 충돌 방지 라벨 레이어 등록 (beforeId 없이 3D 건물 위 최상단 렌더링)
    this._setupFacilityLabelLayer();

    // 9) deck.gl MapboxOverlay 등록 (MapLibre v5 호환 오버레이 모드)
    if (window.deck && window.deck.MapboxOverlay) {
      try {
        this._deckOverlay = new window.deck.MapboxOverlay({
          interleaved: false,
          layers: []
        });
        map.addControl(this._deckOverlay);
      } catch (err) {
        console.warn('[Map3DEngine] deck.MapboxOverlay initialization warning:', err);
      }
    }

    // 10) TotemMarkerManager 인스턴스화 (실제 3D 건물 스냅 연동)
    this._totemManager = new TotemMarkerManager(this.map, {
      onSelectFacility: (fac, center) => this.onSelectFacility?.(fac, center),
      onHoverFacility: (fac) => this.onHoverFacility?.(fac),
      getSnappedBuilding: (lon, lat) => this.getSnappedBuilding(lon, lat)
    });
  }

  /**
   * 하늘 및 입체 조명 설정
   * @private
   */
  _updateSkyAndLight() {
    if (!this.map) return;
    const isDark = this.theme === 'dark';

    // 하늘 (MapLibre setSky)
    if (typeof this.map.setSky === 'function') {
      this.map.setSky({
        'sky-color': isDark ? '#0d1821' : '#b2d8eb',
        'horizon-color': isDark ? '#152530' : '#eaf4f8',
        'fog-color': isDark ? '#101c24' : '#d4e7ee',
        'horizon-fog-blend': 0.8
      });
    }

    // 건축 모형 조명 (setLight)
    if (typeof this.map.setLight === 'function') {
      this.map.setLight({
        anchor: 'viewport',
        position: [1.35, 210, 38],
        intensity: 0.45,
        color: isDark ? '#ccd5e0' : '#ffffff'
      });
    }
  }

  /**
   * 4개 구 & 49개 동 경계선 및 라벨 레이어 구성
   * @private
   */
  _setupBoundariesLayers(beforeId) {
    const map = this.map;

    // 소스 등록
    map.addSource('gu-outlines', { type: 'geojson', data: GU_OUTLINES_GEOJSON });
    map.addSource('dong-outlines', { type: 'geojson', data: DONG_OUTLINES_GEOJSON });
    map.addSource('gu-labels', { type: 'geojson', data: GU_LABELS_GEOJSON });
    map.addSource('dong-labels', { type: 'geojson', data: DONG_LABELS_GEOJSON });

    // 1) 구 외곽선 글로우 (은은한 발광)
    map.addLayer(
      {
        id: 'gu-outlines-glow',
        type: 'line',
        source: 'gu-outlines',
        paint: {
          'line-width': 6.5,
          'line-blur': 3.5,
          'line-color': this.theme === 'dark' ? '#5CB8D6' : '#0F6E8C',
          'line-opacity': 0.28
        }
      },
      beforeId
    );

    // 2) 구 외곽선 고유 컬러 라인
    map.addLayer(
      {
        id: 'gu-outlines-line',
        type: 'line',
        source: 'gu-outlines',
        paint: {
          'line-width': 2.4,
          'line-color': [
            'match',
            ['coalesce', ['get', 'gu'], ['get', 'name'], ''],
            '서구', '#E35D4F',
            '중구', '#7556BE',
            '영도구', '#2E7FC0',
            '사하구', '#2C8A5A',
            '#0F6E8C'
          ],
          'line-opacity': 0.85
        }
      },
      beforeId
    );

    // 3) 동 행정 경계 점선
    map.addLayer(
      {
        id: 'dong-outlines-line',
        type: 'line',
        source: 'dong-outlines',
        minzoom: 12.0,
        paint: {
          'line-dasharray': [2, 3],
          'line-width': 1.2,
          'line-color': this.theme === 'dark' ? '#3B4F5C' : '#C9C2B1',
          'line-opacity': 0.75
        }
      },
      beforeId
    );

    // 4) 동 이름 라벨 (고배율 - 은은하게 톤다운하여 시설 라벨 공존)
    map.addLayer({
      id: 'dong-labels-symbol',
      type: 'symbol',
      source: 'dong-labels',
      minzoom: 12.5,
      layout: {
        'text-field': ['coalesce', ['get', 'nm'], ['get', 'name'], ''],
        'text-font': ['Noto Sans Regular'],
        'text-size': 11.5,
        'text-anchor': 'center',
        'text-allow-overlap': false
      },
      paint: {
        'text-color': this.theme === 'dark' ? '#A3B4BE' : '#697B84',
        'text-halo-color': this.theme === 'dark' ? 'rgba(16,38,50,0.85)' : 'rgba(255,255,255,0.85)',
        'text-halo-width': 1.6,
        'text-opacity': 0.75
      }
    });

    // 5) 구 이름 라벨 (광역 조망)
    map.addLayer({
      id: 'gu-labels-symbol',
      type: 'symbol',
      source: 'gu-labels',
      maxzoom: 14.2,
      layout: {
        'text-field': ['coalesce', ['get', 'gu'], ['get', 'name'], ''],
        'text-font': ['Noto Sans Regular'],
        'text-size': 15,
        'text-anchor': 'center'
      },
      paint: {
        'text-color': this.theme === 'dark' ? '#E1EBF0' : '#1F343E',
        'text-halo-color': this.theme === 'dark' ? 'rgba(16,38,50,0.9)' : 'rgba(255,255,255,0.9)',
        'text-halo-width': 2.2,
        'text-opacity': 0.85
      }
    });
  }

  /**
   * 레이더 링 및 소나 웨이브 레이어 구성
   * @private
   */
  _setupRadarAndSonarLayers(beforeId) {
    const map = this.map;

    // 반경 링 GeoJSON 소스
    map.addSource('radar-rings', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });

    // 링 내부 은은한 반투명 채우기
    map.addLayer(
      {
        id: 'radar-rings-fill',
        type: 'fill',
        source: 'radar-rings',
        filter: ['==', '$type', 'Polygon'],
        paint: {
          'fill-color': '#0F6E8C',
          'fill-opacity': 0.04
        }
      },
      beforeId
    );

    // 링 동심선 (점선)
    map.addLayer(
      {
        id: 'radar-rings-line',
        type: 'line',
        source: 'radar-rings',
        paint: {
          'line-color': this.theme === 'dark' ? '#5CB8D6' : '#0F6E8C',
          'line-width': 1.8,
          'line-dasharray': [3, 2],
          'line-opacity': 0.65
        }
      },
      beforeId
    );

    // 링 거리 라벨 (500m, 1km 등)
    map.addLayer({
      id: 'radar-rings-label',
      type: 'symbol',
      source: 'radar-rings',
      filter: ['==', ['get', 'kind'], 'ring-label'],
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 12,
        'symbol-placement': 'point',
        'text-offset': [0, -0.5]
      },
      paint: {
        'text-color': this.theme === 'dark' ? '#5CB8D6' : '#0F6E8C',
        'text-halo-color': this.theme === 'dark' ? 'rgba(16,38,50,0.9)' : 'rgba(255,255,255,0.9)',
        'text-halo-width': 1.5
      }
    });

    // 소나 스캔 파동 소스 및 레이어
    map.addSource('sonar-wave', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });

    map.addLayer(
      {
        id: 'sonar-wave-line',
        type: 'line',
        source: 'sonar-wave',
        paint: {
          'line-color': '#F2A43A',
          'line-width': 3.2,
          'line-blur': 2.0,
          'line-opacity': ['coalesce', ['get', 'opacity'], 0.8]
        }
      },
      beforeId
    );
  }

  /**
   * 3D 건물 익스트루전 레이어 구성
   * @private
   */
  _setup3DBuildingLayers(beforeId) {
    const map = this.map;

    // GitHub Pages 서브패스 호환 PMTiles URL 생성
    const buildingsPmtilesUrl = 'pmtiles://' + new URL('./data/busan-west-buildings.pmtiles', window.location.href).href;

    // 1) Overture 3D 건물 벡터 소스 등록
    try {
      map.addSource('busan-buildings', {
        type: 'vector',
        url: buildingsPmtilesUrl
      });
    } catch (err) {
      console.warn('[Map3DEngine] busan-buildings source add warning:', err);
    }

    // 건물 높이 & 베이스 표현식
    const buildingHeightExpr = [
      'coalesce',
      ['get', 'height'],
      ['*', ['get', 'num_floors'], 3.3],
      [
        'match',
        ['get', 'subtype'],
        'education', 15,
        'medical', 18,
        'civic', 16,
        'commercial', 12,
        8
      ]
    ];

    const buildingMinHeightExpr = [
      'coalesce',
      ['get', 'min_height'],
      ['*', ['get', 'min_floor'], 3.3],
      0
    ];

    // 레이어 A: overture-3d-buildings
    const isDark = this.theme === 'dark';
    const buildingColorExpr = isDark
      ? ['interpolate', ['linear'], ['coalesce', ['get', 'height'], 10], 0, '#23333E', 40, '#364E5E', 120, '#4B6B80']
      : ['interpolate', ['linear'], ['coalesce', ['get', 'height'], 10], 0, '#EAE5DC', 40, '#D5DCE2', 120, '#BAC6D0'];

    const buildingOpacity = this.viewMode === 'satellite' ? 0.62 : 0.92;

    if (map.getSource('busan-buildings')) {
      map.addLayer(
        {
          id: 'overture-3d-buildings',
          type: 'fill-extrusion',
          source: 'busan-buildings',
          'source-layer': 'building',
          minzoom: 14,
          paint: {
            'fill-extrusion-color': buildingColorExpr,
            'fill-extrusion-height': buildingHeightExpr,
            'fill-extrusion-base': buildingMinHeightExpr,
            'fill-extrusion-opacity': buildingOpacity
          }
        },
        beforeId
      );

      map.addLayer(
        {
          id: 'overture-3d-building-parts',
          type: 'fill-extrusion',
          source: 'busan-buildings',
          'source-layer': 'building_part',
          minzoom: 14,
          paint: {
            'fill-extrusion-color': buildingColorExpr,
            'fill-extrusion-height': buildingHeightExpr,
            'fill-extrusion-base': buildingMinHeightExpr,
            'fill-extrusion-opacity': buildingOpacity
          }
        },
        beforeId
      );
    }

    // 레이어 B: ofm-3d-buildings-fallback (오픈프리맵 베이스의 빌딩 폴백/원경)
    if (map.getSource('openmaptiles')) {
      map.addLayer(
        {
          id: 'ofm-3d-buildings-fallback',
          type: 'fill-extrusion',
          source: 'openmaptiles',
          'source-layer': 'building',
          minzoom: 13.0,
          paint: {
            'fill-extrusion-color': isDark ? '#1E2B35' : '#E2DDD4',
            'fill-extrusion-height': ['coalesce', ['get', 'render_height'], ['*', ['get', 'render_min_height'], 1], 8],
            'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
            'fill-extrusion-opacity': 0.65
          }
        },
        beforeId
      );
    }
  }

  /**
   * 타깃 기관 및 기준 학교 발광 스포트라이트 프리즘 레이어 구성
   * @private
   */
  _setupSpotlightLayers(beforeId) {
    const map = this.map;

    map.addSource('spotlight-footprints', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] }
    });

    map.addLayer(
      {
        id: 'facility-spotlight-buildings',
        type: 'fill-extrusion',
        source: 'spotlight-footprints',
        paint: {
          'fill-extrusion-color': ['get', 'color'],
          'fill-extrusion-height': ['get', 'height'],
          'fill-extrusion-base': ['get', 'base'],
          'fill-extrusion-opacity': 0.86
        }
      },
      beforeId
    );
  }

  /**
   * 네이티브 MapLibre 충돌 방지 한국어 기관 라벨 레이어 구성
   * 3D 건물 익스트루전 상단에 최상단 심볼 레이어로 렌더링 (beforeId 미지정)
   * @private
   */
  _setupFacilityLabelLayer() {
    // 옥상 스마트 POI 엠블럼 핀이 기관명과 아이콘을 일체형으로 렌더링하므로
    // 텍스트 분리 이격(40px 오차) 및 렌더링 렉을 유발하던 WebGL 중복 심볼 레이어 완전 제거
  }

  /**
   * 한국어 시설 라벨 GeoJSON 갱신 (스마트 POI 엠블럼 마커로 일체화되어 no-op 유지)
   * @private
   */
  _updateFacilityLabels() {
  }

  /**
   * 시설 라벨 페인트 속성 동기화 (no-op)
   * @private
   */
  _updateFacilityLabelPaint() {
  }

  /**
   * 화면에 렌더링된 실제 3D 건물 폴리곤 정밀 검색
   * - 거대 병합 폴리곤(MultiPolygon) 오인식 및 원거리(>22m) 도약 차단 안전 알고리즘 적용
   * - 실제 건물 외곽선(bestRing)을 단일 다각형으로 분리하여 마커 배지와 스포트라이트 100% 동기화
   * @param {number} lon
   * @param {number} lat
   * @returns {Object|null}
   * @private
   */
  _findRenderedBuildingFeature(lon, lat) {
    if (!this.map || lon == null || lat == null) return null;
    const cacheKey = `${lon.toFixed(5)}_${lat.toFixed(5)}`;
    if (this._buildingSnapCache && this._buildingSnapCache.has(cacheKey)) {
      return this._buildingSnapCache.get(cacheKey).feature;
    }

    const buildingLayers = ['overture-3d-buildings', 'overture-3d-building-parts', 'ofm-3d-buildings-fallback']
      .filter(id => this.map.getLayer(id));
    if (buildingLayers.length === 0) return null;

    try {
      const canvas = this.map.getCanvas();
      const p = this.map.project([lon, lat]);
      if (p.x < -64 || p.y < -64 || p.x > canvas.clientWidth + 64 || p.y > canvas.clientHeight + 64) {
        return null;
      }

      const bbox = [
        [p.x - 32, p.y - 32],
        [p.x + 32, p.y + 32]
      ];
      const rendered = this.map.queryRenderedFeatures(bbox, { layers: buildingLayers });
      if (!rendered || rendered.length === 0) return null;

      let bestRing = null;
      let bestFeature = null;
      let bestDistM = Infinity;

      for (let i = 0; i < rendered.length; i++) {
        const f = rendered[i];
        if (!f.geometry) continue;

        const ringsList = [];
        if (f.geometry.type === 'Polygon' && Array.isArray(f.geometry.coordinates)) {
          ringsList.push(f.geometry.coordinates[0]);
        } else if (f.geometry.type === 'MultiPolygon' && Array.isArray(f.geometry.coordinates)) {
          for (let m = 0; m < f.geometry.coordinates.length; m++) {
            if (f.geometry.coordinates[m]?.[0]) ringsList.push(f.geometry.coordinates[m][0]);
          }
        }

        for (let rIdx = 0; rIdx < ringsList.length; rIdx++) {
          const ring = ringsList[rIdx];
          if (!ring || ring.length < 4) continue;

          let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
          for (let j = 0; j < ring.length; j++) {
            const rx = ring[j][0];
            const ry = ring[j][1];
            if (rx < minLon) minLon = rx;
            if (rx > maxLon) maxLon = rx;
            if (ry < minLat) minLat = ry;
            if (ry > maxLat) maxLat = ry;
          }

          // 거대 병합 블록/행정구역 배제 (한 변 > 100m)
          const spanM = Math.max((maxLon - minLon) * 89800, (maxLat - minLat) * 111320);
          if (spanM > 100) continue;

          // 좌표에서 바운딩 박스가 25m 이상 떨어진 폴리곤 제외
          if (lon < minLon - 0.00030 || lon > maxLon + 0.00030 || lat < minLat - 0.00025 || lat > maxLat + 0.00025) {
            continue;
          }

          // 1) Ray-casting Point-in-Polygon 검사
          let inside = false;
          for (let j = 0, k = ring.length - 1; j < ring.length; k = j++) {
            const xi = ring[j][0], yi = ring[j][1];
            const xk = ring[k][0], yk = ring[k][1];
            const intersect = ((yi > lat) !== (yk > lat)) &&
              (lon < (xk - xi) * (lat - yi) / ((yk - yi) || 1e-12) + xi);
            if (intersect) inside = !inside;
          }

          if (inside) {
            bestDistM = 0;
            bestRing = ring;
            bestFeature = f;
            break;
          }

          // 2) 도로명 출입구/대문 오차 보정 (건물 외벽에서 20m 이내 최단거리 건물)
          let minEdgeSq = Infinity;
          for (let j = 0, k = ring.length - 1; j < ring.length; k = j++) {
            const ax = (ring[k][0] - lon) * 89800;
            const ay = (ring[k][1] - lat) * 111320;
            const bx = (ring[j][0] - lon) * 89800;
            const by = (ring[j][1] - lat) * 111320;
            const dx = bx - ax;
            const dy = by - ay;
            const lenSq = dx * dx + dy * dy;
            let t = lenSq > 0 ? -(ax * dx + ay * dy) / lenSq : 0;
            if (t < 0) t = 0;
            else if (t > 1) t = 1;
            const px = ax + t * dx;
            const py = ay + t * dy;
            const dSq = px * px + py * py;
            if (dSq < minEdgeSq) minEdgeSq = dSq;
          }

          const edgeDistM = Math.sqrt(minEdgeSq);
          if (edgeDistM <= 20 && edgeDistM < bestDistM) {
            bestDistM = edgeDistM;
            bestRing = ring;
            bestFeature = f;
          }
        }
        if (bestDistM === 0) break;
      }

      if (bestRing && bestFeature) {
        const centroid = computePolygonCentroid(bestRing);
        if (centroid) {
          const cDistM = Math.sqrt(Math.pow((centroid[0] - lon) * 89800, 2) + Math.pow((centroid[1] - lat) * 111320, 2));
          if (cDistM <= 22) {
            const height = Math.max(Number(bestFeature.properties?.height || bestFeature.properties?.render_height) || 18, 16);
            const isolatedFeature = {
              type: 'Feature',
              properties: bestFeature.properties || {},
              geometry: {
                type: 'Polygon',
                coordinates: [bestRing]
              }
            };
            this._buildingSnapCache.set(cacheKey, {
              feature: isolatedFeature,
              centroid,
              height
            });
            return isolatedFeature;
          }
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * 해당 좌표에 해당하는 실제 3D 건물 스냅 정보({ centroid: [lon, lat], height, feature }) 조회
   * - 마커 배지를 건물 지붕 정중앙에 정확히 올리고 3D 포물선 아크를 옥상에 착륙시키는데 사용
   * @param {number} lon
   * @param {number} lat
   * @returns {{ centroid: [number, number], height: number, feature: Object|null }}
   */
  getSnappedBuilding(lon, lat) {
    if (lon == null || lat == null) return { centroid: [lon, lat], height: 0, feature: null };
    const cacheKey = `${lon.toFixed(5)}_${lat.toFixed(5)}`;
    if (this._buildingSnapCache && this._buildingSnapCache.has(cacheKey)) {
      return this._buildingSnapCache.get(cacheKey);
    }
    const feat = this._findRenderedBuildingFeature(lon, lat);
    if (this._buildingSnapCache && this._buildingSnapCache.has(cacheKey)) {
      return this._buildingSnapCache.get(cacheKey);
    }
    return { centroid: [lon, lat], height: 0, feature: feat };
  }

  /**
   * 사용자 인터랙션 이벤트 리스너 바인딩
   * @private
   */
  _bindEventListeners() {
    const map = this.map;
    if (!map) return;

    // 사용자 조작 시 오빗 자동 정지
    const stopOrbitHandler = () => {
      if (this.isOrbiting) {
        this.stopOrbit();
      }
    };

    const canvas = map.getCanvas();
    canvas.addEventListener('mousedown', stopOrbitHandler, { passive: true });
    canvas.addEventListener('touchstart', stopOrbitHandler, { passive: true });
    canvas.addEventListener('wheel', stopOrbitHandler, { passive: true });

    // 좌표 직접 지정(picking) 모드 클릭
    map.on('click', (e) => {
      if (this.picking) {
        this.onPickLocation?.({ lat: e.lngLat.lat, lon: e.lngLat.lng });
      }
    });

    // 3D 건물 타일 로드/렌더링 완료 시 마커 배지 옥상 위치 및 스포트라이트 자동 동기화 (디바운스 80ms)
    let idleSyncTimer = null;
    map.on('idle', () => {
      if (idleSyncTimer) clearTimeout(idleSyncTimer);
      idleSyncTimer = setTimeout(() => {
        if (!this.map) return;
        this._updateSpotlightFootprints();
        this._updateDeckLayers();
        this._totemManager?.sync({
          school: this.school,
          facilities: this.facilities,
          selectedFacility: this.selectedFacility,
          hoveredFacility: this.hoveredFacility
        });
      }, 80);
    });
  }

  /**
   * 상태 일괄 업데이트
   */
  updateState({
    school,
    radius,
    facilities,
    selectedFacility,
    hoveredFacility,
    picking,
    theme,
    viewMode
  } = {}) {
    let shouldUpdateDeck = false;
    let shouldUpdateSpotlight = false;
    let shouldUpdateRings = false;
    let shouldTriggerSonar = false;
    let shouldUpdateLabels = false;

    // 테마 변경 감지
    if (theme && theme !== this.theme) {
      this.setTheme(theme);
      shouldUpdateLabels = true;
    }

    // 뷰모드 변경 감지
    if (viewMode && viewMode !== this.viewMode) {
      this.setViewMode(viewMode);
      shouldUpdateLabels = true;
    }

    // 학교 변경 감지
    if (school !== undefined && school !== this.school) {
      this.school = school;
      shouldUpdateDeck = true;
      shouldUpdateSpotlight = true;
      shouldUpdateRings = true;
      shouldTriggerSonar = true;
    }

    // 반경 변경 감지
    if (radius !== undefined && radius !== this.radius) {
      this.radius = radius;
      shouldUpdateRings = true;
      shouldTriggerSonar = true;
    }

    // 시설 목록 변경
    if (facilities !== undefined && facilities !== this.facilities) {
      this.facilities = facilities || [];
      shouldUpdateDeck = true;
      shouldUpdateSpotlight = true;
      shouldUpdateLabels = true;
    }

    // 선택/호버 시설 변경
    if (selectedFacility !== undefined) {
      const prevKey = this.selectedFacility ? facilityKey(this.selectedFacility) : null;
      const nextKey = selectedFacility ? facilityKey(selectedFacility) : null;
      if (prevKey !== nextKey || selectedFacility !== this.selectedFacility) {
        this.selectedFacility = selectedFacility;
        shouldUpdateDeck = true;
        shouldUpdateSpotlight = true;
        shouldUpdateLabels = true;
      }
    }

    if (hoveredFacility !== undefined) {
      const prevHovKey = this.hoveredFacility ? facilityKey(this.hoveredFacility) : null;
      const nextHovKey = hoveredFacility ? facilityKey(hoveredFacility) : null;
      if (prevHovKey !== nextHovKey || hoveredFacility !== this.hoveredFacility) {
        this.hoveredFacility = hoveredFacility;
        shouldUpdateDeck = true;
        shouldUpdateSpotlight = true;
        shouldUpdateLabels = true;
      }
    }

    // 좌표 지정 모드 변경
    if (picking !== undefined && picking !== this.picking) {
      this.picking = !!picking;
      if (this.map) {
        this.map.getCanvas().style.cursor = this.picking ? 'crosshair' : '';
      }
    }

    if (!this._isMapLoaded || !this.map) return;

    // 소나 스캔 애니메이션 트리거
    if (shouldTriggerSonar && this.school) {
      this._triggerSonarAnimation(this.school, this.radius);
    }

    // 반경 링 GeoJSON 업데이트
    if (shouldUpdateRings) {
      this._updateRadarRings();
    }

    // 스포트라이트 발광 프리즘 업데이트
    if (shouldUpdateSpotlight) {
      this._updateSpotlightFootprints();
    }

    // deck.gl 인터리브드 오버레이 업데이트
    if (shouldUpdateDeck) {
      this._updateDeckLayers();
    }

    // WebGL 한국어 기관 충돌 방지 라벨 업데이트
    if (shouldUpdateLabels) {
      this._updateFacilityLabels();
    }

    // HTML 토템 및 비콘 마커 동기화
    this._totemManager?.sync({
      school: this.school,
      facilities: this.facilities,
      selectedFacility: this.selectedFacility,
      hoveredFacility: this.hoveredFacility
    });
  }

  /**
   * 반경 링 GeoJSON 갱신
   * @private
   */
  _updateRadarRings() {
    if (!this.map || !this.map.getSource('radar-rings')) return;

    if (!this.school || this.school.lon == null || this.school.lat == null) {
      this.map.getSource('radar-rings').setData({ type: 'FeatureCollection', features: [] });
      return;
    }

    const ringsGeoJSON = createRadarRingsGeoJSON(this.school.lon, this.school.lat, this.radius);
    this.map.getSource('radar-rings').setData(ringsGeoJSON);
  }

  /**
   * 3D 소나 스캔 파동 애니메이션 (0m -> radius)
   * @private
   */
  _triggerSonarAnimation(school, targetRadius) {
    if (!this.map || !this.map.getSource('sonar-wave')) return;

    // 움직임 감소 모드 감지 시 스킵
    const prefersReducedMotion = typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      this.map.getSource('sonar-wave').setData({ type: 'FeatureCollection', features: [] });
      return;
    }

    if (this._sonarRaf) {
      cancelAnimationFrame(this._sonarRaf);
      this._sonarRaf = null;
    }

    const duration = 1400; // 1.4초
    const startTime = performance.now();
    const lon = school.lon;
    const lat = school.lat;

    const animate = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1.0);

      // easeOutCubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const currentRadius = Math.max(targetRadius * eased, 10);
      const opacity = (1 - progress) * 0.85;

      const circleFeature = createCircleGeoJSON(lon, lat, currentRadius, 36, { opacity });
      if (this.map && this.map.getSource('sonar-wave')) {
        this.map.getSource('sonar-wave').setData({
          type: 'FeatureCollection',
          features: [circleFeature]
        });
      }

      if (progress < 1.0) {
        this._sonarRaf = requestAnimationFrame(animate);
      } else {
        this._sonarRaf = null;
        if (this.map && this.map.getSource('sonar-wave')) {
          this.map.getSource('sonar-wave').setData({ type: 'FeatureCollection', features: [] });
        }
      }
    };

    this._sonarRaf = requestAnimationFrame(animate);
  }

  /**
   * 기관 및 기준 학교 스포트라이트 발광 프리즘/폴리곤 갱신
   * 화면 내 렌더링된 실제 3D 건물 폴리곤(Overture/OFM)을 탐색하여 일치 시 직사각형 실제 건물을 그대로 하이라이트하고,
   * 미매칭 시 정밀 원형 프리즘으로 깔끔하게 폴백
   * - 미선택 시설에 대한 수백 개 불필요 원통 생성을 제거하여 프레임 드랍 원천 차단
   * @private
   */
  _updateSpotlightFootprints() {
    if (!this.map || !this.map.getSource('spotlight-footprints')) return;

    const features = [];
    const selKey = this.selectedFacility ? facilityKey(this.selectedFacility) : null;
    const hovKey = this.hoveredFacility ? facilityKey(this.hoveredFacility) : null;

    // 1) 기준 학교: 실제 건물 폴리곤 매칭 시도, 미매칭 시 radius 14 원형 프리즘 폴백
    if (this.school && this.school.lon != null && this.school.lat != null) {
      const schoolBuilding = this._findRenderedBuildingFeature(this.school.lon, this.school.lat);
      if (schoolBuilding && schoolBuilding.geometry) {
        const height = Math.max(Number(schoolBuilding.properties?.height) || 18, 16) + 1.5;
        features.push({
          type: 'Feature',
          properties: {
            id: 'school',
            color: '#F2A43A',
            height,
            base: 0,
            opacity: 0.95
          },
          geometry: schoolBuilding.geometry
        });
      } else {
        features.push(createCircleGeoJSON(this.school.lon, this.school.lat, 14, 24, {
          id: 'school',
          color: '#F2A43A',
          height: 28,
          base: 0,
          opacity: 0.95
        }));
      }
    }

    // 2) 선택된 시설 및 호버된 시설만 실제 건물 3D 하이라이트 (미선택 시설 138개 루프 완전 제거)
    const activeTargets = [];
    if (this.selectedFacility) activeTargets.push(this.selectedFacility);
    if (this.hoveredFacility && facilityKey(this.hoveredFacility) !== selKey) {
      activeTargets.push(this.hoveredFacility);
    }

    for (let i = 0; i < activeTargets.length; i++) {
      const f = activeTargets[i];
      if (f.lon == null || f.lat == null) continue;

      const fKey = facilityKey(f);
      const isSelected = selKey === fKey;
      const catColor = resolveCatHex(f.cat, this.theme);

      const buildingFeat = this._findRenderedBuildingFeature(f.lon, f.lat);
      if (buildingFeat && buildingFeat.geometry) {
        const height = Math.max(Number(buildingFeat.properties?.height) || 18, 16) + 1.8;
        features.push({
          type: 'Feature',
          properties: {
            id: fKey,
            color: catColor,
            height,
            base: 0,
            opacity: isSelected ? 0.96 : 0.88,
            isSelected
          },
          geometry: buildingFeat.geometry
        });
      } else {
        features.push(createCircleGeoJSON(f.lon, f.lat, 12, 24, {
          id: fKey,
          color: catColor,
          height: isSelected ? 36 : 24,
          base: 0,
          opacity: isSelected ? 0.96 : 0.88,
          isSelected
        }));
      }
    }

    this.map.getSource('spotlight-footprints').setData({
      type: 'FeatureCollection',
      features
    });
  }

  /**
   * deck.gl 인터리브드 레이어 (3D 아크 + 대략위치 홀로그램) 갱신
   * - 거미줄처럼 펼쳐지던 수십 개 아크를 오직 선택된(또는 호버된) 기관 1개로 단일화
   * - 실제 건물 옥상 높이에 아크가 착륙하도록 정밀화 및 렉 완벽 제거
   * @private
   */
  _updateDeckLayers() {
    if (!this._deckOverlay || !window.deck) return;

    const { ArcLayer, PolygonLayer } = window.deck;
    const layers = [];

    const school = this.school;
    const targetFacility = this.selectedFacility || this.hoveredFacility;
    const isSel = Boolean(this.selectedFacility);

    // 1) 3D 포물선 연결 아크: 오직 집중 대상 기관 1개에만 발사
    if (school && school.lon != null && school.lat != null && targetFacility && targetFacility.lon != null && targetFacility.lat != null) {
      const schoolElevation = this.sampleElevation(school.lon, school.lat) || 0;
      const schoolSnapped = this.getSnappedBuilding(school.lon, school.lat);
      const schoolPos = [
        schoolSnapped.centroid[0],
        schoolSnapped.centroid[1],
        schoolElevation + (schoolSnapped.height || 18) + 2
      ];

      const facSnapped = this.getSnappedBuilding(targetFacility.lon, targetFacility.lat);
      const facElevation = this.sampleElevation(facSnapped.centroid[0], facSnapped.centroid[1]) || 0;
      const targetPos = [
        facSnapped.centroid[0],
        facSnapped.centroid[1],
        facElevation + (facSnapped.height || 18) + 2
      ];

      const catRgb = resolveCatRgb(targetFacility.cat, this.theme);

      const arcLayer = new ArcLayer({
        id: 'facility-focus-arc-3d',
        data: [{ id: facilityKey(targetFacility), cat: targetFacility.cat }],
        pickable: false,
        greatCircle: false,
        getSourcePosition: () => schoolPos,
        getTargetPosition: () => targetPos,
        getSourceColor: () => [242, 164, 58, 255],
        getTargetColor: () => [catRgb[0], catRgb[1], catRgb[2], 255],
        getWidth: isSel ? 6.0 : 4.5,
        getHeight: 0.42
      });

      layers.push(arcLayer);
    }

    // 2) ap === 1 대략 위치 기관용 3D 불확실성 홀로그램 원기둥 (대상 시설일 때만 렌더링)
    if (targetFacility && targetFacility.ap && targetFacility.lon != null && targetFacility.lat != null) {
      const hologramLayer = new PolygonLayer({
        id: 'approx-hologram-cylinder',
        data: [{
          polygon: createCircleCoordinates(targetFacility.lon, targetFacility.lat, 75, 24),
          cat: targetFacility.cat
        }],
        pickable: false,
        stroked: true,
        filled: true,
        extruded: true,
        wireframe: true,
        getPolygon: d => d.polygon,
        getElevation: 35,
        getFillColor: d => {
          const rgb = resolveCatRgb(d.cat, this.theme);
          return [rgb[0], rgb[1], rgb[2], 45];
        },
        getLineColor: d => {
          const rgb = resolveCatRgb(d.cat, this.theme);
          return [rgb[0], rgb[1], rgb[2], 195];
        },
        getLineWidth: 2
      });
      layers.push(hologramLayer);
    }

    this._deckOverlay.setProps({ layers });
  }

  /**
   * 기준 학교로 카메라 비행
   * @param {Object} school 기준 학교 객체
   * @param {number} [radiusMeters=1000] 반경 (m)
   */
  flyToSchool(school, radiusMeters = 1000) {
    if (!this.map || !school || school.lon == null || school.lat == null) return;

    let zoom = 14.7;
    if (radiusMeters <= 500) zoom = 15.6;
    else if (radiusMeters <= 1000) zoom = 14.7;
    else if (radiusMeters <= 2000) zoom = 13.7;
    else zoom = 13.1;

    const pitch = this.viewMode === 'flat2d' ? 0 : 56;
    const bearing = this.viewMode === 'flat2d' ? 0 : -16;

    this.map.flyTo({
      center: [school.lon, school.lat],
      zoom,
      pitch,
      bearing,
      duration: 1100,
      essential: true
    });

    this.map.once('idle', () => {
      this._updateSpotlightFootprints();
      this._updateDeckLayers();
      this._totemManager?.sync({
        school: this.school,
        facilities: this.facilities,
        selectedFacility: this.selectedFacility,
        hoveredFacility: this.hoveredFacility
      });
    });
  }

  /**
   * 특정 기관으로 클로즈업 포커스
   * - 실제 3D 건물 중심점으로 카메라 착지하여 건물과 배지가 시야 정중앙에 배치
   * @param {Object} school 기준 학교
   * @param {Object} facility 대상 기관
   */
  focusFacility(school, facility) {
    if (!this.map || !facility || facility.lon == null || facility.lat == null) return;

    const snapped = this.getSnappedBuilding(facility.lon, facility.lat);
    const centerLon = snapped.centroid ? snapped.centroid[0] : facility.lon;
    const centerLat = snapped.centroid ? snapped.centroid[1] : facility.lat;

    let bearing = 0;
    if (this.viewMode !== 'flat2d' && school && school.lon != null && school.lat != null) {
      const dx = centerLon - school.lon;
      const dy = centerLat - school.lat;
      bearing = Math.atan2(dx, dy) * (180 / Math.PI);
    }

    const pitch = this.viewMode === 'flat2d' ? 0 : 58;

    this.map.flyTo({
      center: [centerLon, centerLat],
      zoom: 16.6,
      pitch,
      bearing,
      padding: { top: 60, bottom: 140, left: 32, right: 32 },
      duration: 1000,
      essential: true
    });

    // 고배율 줌 전환 후 고해상도 Overture 건물 폴리곤 로드 완료 시 스포트라이트 및 마커 위치 자동 재정렬
    this.map.once('idle', () => {
      this._updateSpotlightFootprints();
      this._updateDeckLayers();
      this._totemManager?.sync({
        school: this.school,
        facilities: this.facilities,
        selectedFacility: this.selectedFacility,
        hoveredFacility: this.hoveredFacility
      });
    });
  }

  /**
   * 부산 서부 4개 구 전체 조망
   */
  fitAllDistricts() {
    if (!this.map) return;

    const bounds = [[128.93, 35.04], [129.085, 35.14]];
    const pitch = this.viewMode === 'flat2d' ? 0 : 46;
    const bearing = this.viewMode === 'flat2d' ? 0 : -14;

    this.map.fitBounds(bounds, {
      pitch,
      bearing,
      padding: 40,
      duration: 1200
    });
  }

  /**
   * 줌 인/아웃
   * @param {number} delta (+1 or -1)
   */
  zoomBy(delta) {
    if (!this.map) return;
    this.map.zoomTo(this.map.getZoom() + delta, { duration: 300 });
  }

  /**
   * 북향 및 기본 입체 각도 복귀
   */
  resetNorthTilt() {
    if (!this.map) return;

    const pitch = this.viewMode === 'flat2d' ? 0 : 56;
    const bearing = this.viewMode === 'flat2d' ? 0 : -16;

    this.map.easeTo({
      pitch,
      bearing,
      duration: 600
    });
  }

  /**
   * 지도 뷰 모드 설정 ('diorama' | 'satellite' | 'flat2d')
   * @param {'diorama'|'satellite'|'flat2d'} mode
   */
  setViewMode(mode) {
    if (!mode || mode === this.viewMode) return;
    this.viewMode = mode;

    if (!this.map) return;

    const isSatellite = mode === 'satellite';
    const isFlat = mode === 'flat2d';

    // 1) 위성 래스터 레이어 가시성 토글
    if (this.map.getLayer('satellite-raster')) {
      this.map.setLayoutProperty('satellite-raster', 'visibility', isSatellite ? 'visible' : 'none');
    }

    // 2) 3D 지형 on/off (이미 활성화된 지형 재호출 시 MapLibre v5 타일 키 캐시 초기화 방지)
    if (isFlat) {
      if (this.map.getTerrain()) {
        this.map.setTerrain(null);
      }
      this.map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
    } else if (!this.map.getTerrain()) {
      this.map.setTerrain({ source: 'terrain-dem', exaggeration: 1.35 });
    }

    // 3) 3D 건물 투명도 조절 (위성 모드 시 실제 항공사진 지붕과 공존하도록 0.62로 설정)
    const buildingOpacity = isSatellite ? 0.62 : 0.92;
    if (this.map.getLayer('overture-3d-buildings')) {
      this.map.setPaintProperty('overture-3d-buildings', 'fill-extrusion-opacity', buildingOpacity);
    }
    if (this.map.getLayer('overture-3d-building-parts')) {
      this.map.setPaintProperty('overture-3d-building-parts', 'fill-extrusion-opacity', buildingOpacity);
    }

    // 4) WebGL 시설 라벨 헤일로 페인트 갱신 (위성 모드 진입 시 다크 헤일로 적용)
    this._updateFacilityLabelPaint();
  }

  /**
   * 테마 전환 ('light' | 'dark')
   * @param {'light'|'dark'} theme
   */
  setTheme(theme) {
    if (!theme || theme === this.theme) return;
    this.theme = theme;

    if (!this.map) return;
    const isDark = theme === 'dark';

    // 배경 및 레이어 색상 갱신
    this._updateSkyAndLight();

    if (this.map.getLayer('terrain-hillshade')) {
      this.map.setPaintProperty('terrain-hillshade', 'hillshade-shadow-color', isDark ? '#09151e' : '#475d6b');
      this.map.setPaintProperty('terrain-hillshade', 'hillshade-highlight-color', isDark ? '#273c49' : '#ffffff');
    }

    if (this.map.getLayer('gu-outlines-glow')) {
      this.map.setPaintProperty('gu-outlines-glow', 'line-color', isDark ? '#5CB8D6' : '#0F6E8C');
    }

    if (this.map.getLayer('dong-outlines-line')) {
      this.map.setPaintProperty('dong-outlines-line', 'line-color', isDark ? '#3B4F5C' : '#C9C2B1');
    }

    if (this.map.getLayer('dong-labels-symbol')) {
      this.map.setPaintProperty('dong-labels-symbol', 'text-color', isDark ? '#A3B4BE' : '#697B84');
      this.map.setPaintProperty('dong-labels-symbol', 'text-halo-color', isDark ? 'rgba(16,38,50,0.85)' : 'rgba(255,255,255,0.85)');
    }

    if (this.map.getLayer('gu-labels-symbol')) {
      this.map.setPaintProperty('gu-labels-symbol', 'text-color', isDark ? '#E1EBF0' : '#1F343E');
      this.map.setPaintProperty('gu-labels-symbol', 'text-halo-color', isDark ? 'rgba(16,38,50,0.9)' : 'rgba(255,255,255,0.9)');
    }

    if (this.map.getLayer('radar-rings-line')) {
      this.map.setPaintProperty('radar-rings-line', 'line-color', isDark ? '#5CB8D6' : '#0F6E8C');
    }

    if (this.map.getLayer('overture-3d-buildings')) {
      const colorExpr = isDark
        ? ['interpolate', ['linear'], ['coalesce', ['get', 'height'], 10], 0, '#23333E', 40, '#364E5E', 120, '#4B6B80']
        : ['interpolate', ['linear'], ['coalesce', ['get', 'height'], 10], 0, '#EAE5DC', 40, '#D5DCE2', 120, '#BAC6D0'];
      this.map.setPaintProperty('overture-3d-buildings', 'fill-extrusion-color', colorExpr);
      if (this.map.getLayer('overture-3d-building-parts')) {
        this.map.setPaintProperty('overture-3d-building-parts', 'fill-extrusion-color', colorExpr);
      }
    }

    if (this.map.getLayer('ofm-3d-buildings-fallback')) {
      this.map.setPaintProperty('ofm-3d-buildings-fallback', 'fill-extrusion-color', isDark ? '#1E2B35' : '#E2DDD4');
    }

    // 베이스맵 심볼 레이어 도로/지명 텍스트 톤다운 갱신
    const baseTextColor = isDark ? '#7E95A4' : '#647783';
    const baseHaloColor = isDark ? 'rgba(13,21,26,0.9)' : 'rgba(255,255,255,0.92)';
    const styleLayers = this.map.getStyle()?.layers || [];
    for (const l of styleLayers) {
      if (l.type === 'symbol' && !l.id.includes('dong-') && !l.id.includes('gu-') && !l.id.includes('facility-') && !l.id.includes('radar-')) {
        try {
          this.map.setPaintProperty(l.id, 'text-color', baseTextColor);
          this.map.setPaintProperty(l.id, 'text-halo-color', baseHaloColor);
        } catch {
          // ignore
        }
      }
    }

    // WebGL 한국어 기관 라벨 페인트 및 데이터 갱신
    this._updateFacilityLabelPaint();
    this._updateFacilityLabels();
  }

  /**
   * 360° 드론 오빗 시작/정지 토글
   * @param {Object} [targetLngLat] 오빗 중심 좌표 { lat, lon|lng }
   */
  toggleOrbit(targetLngLat) {
    if (this.isOrbiting) {
      this.stopOrbit();
    } else {
      this.startOrbit(targetLngLat);
    }
  }

  /**
   * 360° 드론 오빗 회전 시작
   * @param {Object} [targetLngLat]
   */
  startOrbit(targetLngLat) {
    if (this.isOrbiting || !this.map) return;

    let center;
    if (targetLngLat && (targetLngLat.lon != null || targetLngLat.lng != null)) {
      center = [targetLngLat.lon ?? targetLngLat.lng, targetLngLat.lat];
    } else if (this.school && this.school.lon != null && this.school.lat != null) {
      center = [this.school.lon, this.school.lat];
    } else {
      const mapCenter = this.map.getCenter();
      center = [mapCenter.lng, mapCenter.lat];
    }

    this._orbitCenter = center;
    this.isOrbiting = true;
    this.onOrbitChange?.(true);

    const pitch = this.viewMode === 'flat2d' ? 0 : 58;
    this.map.easeTo({ center: this._orbitCenter, pitch, duration: 600 });

    this._orbitLastTime = performance.now();

    const orbitLoop = (now) => {
      if (!this.isOrbiting || !this.map) return;

      const dt = (now - this._orbitLastTime) / 1000;
      this._orbitLastTime = now;

      // 초당 9도 회전
      const currentBearing = this.map.getBearing();
      const nextBearing = (currentBearing + 9 * dt) % 360;

      this.map.setBearing(nextBearing);
      this.map.setCenter(this._orbitCenter);

      this._orbitRaf = requestAnimationFrame(orbitLoop);
    };

    this._orbitRaf = requestAnimationFrame(orbitLoop);
  }

  /**
   * 드론 오빗 정지
   */
  stopOrbit() {
    if (!this.isOrbiting) return;

    this.isOrbiting = false;
    if (this._orbitRaf) {
      cancelAnimationFrame(this._orbitRaf);
      this._orbitRaf = null;
    }
    this.onOrbitChange?.(false);
  }

  /**
   * 고도 단면도 샘플링 (queryTerrainElevation)
   * @param {number} lon
   * @param {number} lat
   * @returns {number|null} 고도 (미터)
   */
  sampleElevation(lon, lat) {
    if (!this.map || typeof this.map.queryTerrainElevation !== 'function') {
      return null;
    }
    try {
      const elev = this.map.queryTerrainElevation([lon, lat], { exaggerated: false });
      return typeof elev === 'number' && !isNaN(elev) ? elev : null;
    } catch {
      return null;
    }
  }
}
