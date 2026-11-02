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
 * OpenFreeMap Positron 테마 보정 헬퍼
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

    // 8) deck.gl MapboxOverlay 인터리브드 등록
    if (window.deck && window.deck.MapboxOverlay) {
      try {
        this._deckOverlay = new window.deck.MapboxOverlay({
          interleaved: true,
          layers: []
        });
        map.addControl(this._deckOverlay);
      } catch (err) {
        console.warn('[Map3DEngine] deck.MapboxOverlay initialization warning:', err);
      }
    }

    // 9) TotemMarkerManager 인스턴스화
    this._totemManager = new TotemMarkerManager(this.map, {
      onSelectFacility: (fac, center) => this.onSelectFacility?.(fac, center),
      onHoverFacility: (fac) => this.onHoverFacility?.(fac)
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

    // 4) 동 이름 라벨 (고배율)
    map.addLayer({
      id: 'dong-labels-symbol',
      type: 'symbol',
      source: 'dong-labels',
      minzoom: 12.5,
      layout: {
        'text-field': ['coalesce', ['get', 'nm'], ['get', 'name'], ''],
        'text-size': 11.5,
        'text-anchor': 'center',
        'text-allow-overlap': false
      },
      paint: {
        'text-color': this.theme === 'dark' ? '#A3B4BE' : '#697B84',
        'text-halo-color': this.theme === 'dark' ? 'rgba(16,38,50,0.85)' : 'rgba(255,255,255,0.85)',
        'text-halo-width': 1.6
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
        'text-size': 15,
        'text-anchor': 'center'
      },
      paint: {
        'text-color': this.theme === 'dark' ? '#E1EBF0' : '#1F343E',
        'text-halo-color': this.theme === 'dark' ? 'rgba(16,38,50,0.9)' : 'rgba(255,255,255,0.9)',
        'text-halo-width': 2.2
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
          minzoom: 12.6,
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
          minzoom: 13.8,
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

    // 테마 변경 감지
    if (theme && theme !== this.theme) {
      this.setTheme(theme);
    }

    // 뷰모드 변경 감지
    if (viewMode && viewMode !== this.viewMode) {
      this.setViewMode(viewMode);
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
    }

    // 선택/호버 시설 변경
    if (selectedFacility !== undefined && selectedFacility !== this.selectedFacility) {
      this.selectedFacility = selectedFacility;
      shouldUpdateDeck = true;
      shouldUpdateSpotlight = true;
    }

    if (hoveredFacility !== undefined && hoveredFacility !== this.hoveredFacility) {
      this.hoveredFacility = hoveredFacility;
      shouldUpdateDeck = true;
      shouldUpdateSpotlight = true;
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
   * 기관 및 학교 스포트라이트 발광 프리즘 갱신
   * @private
   */
  _updateSpotlightFootprints() {
    if (!this.map || !this.map.getSource('spotlight-footprints')) return;

    const features = [];
    const selKey = this.selectedFacility ? facilityKey(this.selectedFacility) : null;
    const hovKey = this.hoveredFacility ? facilityKey(this.hoveredFacility) : null;

    // 1) 기준 학교 프리즘 (주황색 앰버)
    if (this.school && this.school.lon != null && this.school.lat != null) {
      const schoolPrism = createCircleGeoJSON(this.school.lon, this.school.lat, 22, 8, {
        id: 'school',
        color: '#F2A43A',
        height: 42,
        base: 0,
        opacity: 0.95
      });
      features.push(schoolPrism);
    }

    // 2) 기관별 프리즘
    const facilities = this.facilities || [];
    for (let i = 0; i < facilities.length; i++) {
      const f = facilities[i];
      if (f.lon == null || f.lat == null) continue;

      const fKey = facilityKey(f);
      const isSelected = selKey === fKey;
      const isHovered = hovKey === fKey;
      const catColor = resolveCatHex(f.cat, this.theme);

      const radius = isSelected ? 22 : (isHovered ? 18 : 14);
      const height = isSelected ? 48 : (isHovered ? 34 : 22);
      const opacity = isSelected ? 0.95 : (isHovered ? 0.9 : 0.75);

      const prism = createCircleGeoJSON(f.lon, f.lat, radius, 8, {
        id: fKey,
        color: catColor,
        height,
        base: 0,
        opacity,
        isSelected,
        isHovered
      });
      features.push(prism);
    }

    this.map.getSource('spotlight-footprints').setData({
      type: 'FeatureCollection',
      features
    });
  }

  /**
   * deck.gl 인터리브드 레이어 (3D 아크 + 대략위치 홀로그램) 갱신
   * @private
   */
  _updateDeckLayers() {
    if (!this._deckOverlay || !window.deck) return;

    const { ArcLayer, PolygonLayer } = window.deck;
    const layers = [];

    const school = this.school;
    const facilities = this.facilities || [];
    const selKey = this.selectedFacility ? facilityKey(this.selectedFacility) : null;
    const hovKey = this.hoveredFacility ? facilityKey(this.hoveredFacility) : null;

    // 1) 3D 포물선 연결 아크 (학교 -> 기관)
    if (school && school.lon != null && school.lat != null && facilities.length > 0) {
      const schoolElevation = this.sampleElevation(school.lon, school.lat) || 0;
      const sourcePos = [school.lon, school.lat, schoolElevation + 12];

      const arcLayer = new ArcLayer({
        id: 'facility-arcs-3d',
        data: facilities,
        pickable: false,
        greatCircle: false,
        getSourcePosition: () => sourcePos,
        getTargetPosition: (d) => {
          const elev = this.sampleElevation(d.lon, d.lat) || 0;
          return [d.lon, d.lat, elev + 8];
        },
        getSourceColor: (d) => {
          const fKey = facilityKey(d);
          const isSel = selKey === fKey;
          const isHov = hovKey === fKey;
          return [242, 164, 58, (isSel || isHov) ? 255 : 140];
        },
        getTargetColor: (d) => {
          const fKey = facilityKey(d);
          const isSel = selKey === fKey;
          const isHov = hovKey === fKey;
          const rgb = resolveCatRgb(d.cat, this.theme);
          const alpha = isSel ? 255 : (isHov ? 240 : 115);
          return [rgb[0], rgb[1], rgb[2], alpha];
        },
        getWidth: (d) => {
          const fKey = facilityKey(d);
          if (selKey === fKey) return 5.5;
          if (hovKey === fKey) return 4.5;
          return 2.0;
        },
        getHeight: (d) => {
          const fKey = facilityKey(d);
          return (selKey === fKey || hovKey === fKey) ? 0.45 : 0.28;
        },
        updateTriggers: {
          getSourceColor: [selKey, hovKey],
          getTargetColor: [selKey, hovKey],
          getWidth: [selKey, hovKey],
          getHeight: [selKey, hovKey]
        }
      });

      layers.push(arcLayer);
    }

    // 2) ap === 1 대략 위치 기관용 3D 불확실성 홀로그램 원기둥
    const approxFacilities = facilities.filter(r => r.ap && r.lon != null && r.lat != null);
    if (approxFacilities.length > 0) {
      const hologramData = approxFacilities.map(r => ({
        ...r,
        polygon: createCircleCoordinates(r.lon, r.lat, 75, 24)
      }));

      const hologramLayer = new PolygonLayer({
        id: 'approx-hologram-cylinders',
        data: hologramData,
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
  }

  /**
   * 특정 기관으로 클로즈업 포커스
   * @param {Object} school 기준 학교
   * @param {Object} facility 대상 기관
   */
  focusFacility(school, facility) {
    if (!this.map || !facility || facility.lon == null || facility.lat == null) return;

    let bearing = 0;
    if (this.viewMode !== 'flat2d' && school && school.lon != null && school.lat != null) {
      const dx = facility.lon - school.lon;
      const dy = facility.lat - school.lat;
      bearing = Math.atan2(dx, dy) * (180 / Math.PI);
    }

    const pitch = this.viewMode === 'flat2d' ? 0 : 65;

    this.map.flyTo({
      center: [facility.lon, facility.lat],
      zoom: 17.3,
      pitch,
      bearing,
      duration: 1000,
      essential: true
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

    // 2) 3D 지형 on/off
    if (isFlat) {
      this.map.setTerrain(null);
      this.map.easeTo({ pitch: 0, bearing: 0, duration: 600 });
    } else {
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
