// js/geo-utils.js
// STIS 3D Spatial & Terrain Intelligence Utilities: 구면 기하 계산, 건물 군집화, 3D 레이더 링 GeoJSON 및 고도/지형 단면 분석

import { facilityKey } from './constants.js';

const EARTH_RADIUS = 6371000; // 지구 반지름 (미터)
const TO_RAD = Math.PI / 180;
const TO_DEG = 180 / Math.PI;

/**
 * 객체에서 [경도, 위도] 배열 추출
 * @param {{ lon?: number, lng?: number, lat: number }} item
 * @returns {[number, number]} [lon, lat]
 */
export function toLngLat(item) {
  if (!item) return [0, 0];
  const lon = item.lon ?? item.lng ?? 0;
  const lat = item.lat ?? 0;
  return [lon, lat];
}

/**
 * 두 좌표 간의 구면 거리(Haversine 공식, 미터) 계산
 * @param {{ lat: number, lon?: number, lng?: number }} a
 * @param {{ lat: number, lon?: number, lng?: number }} b
 * @returns {number} 거리 (미터)
 */
export function distMeters(a, b) {
  if (!a || !b) return 0;
  const lon1 = a.lon ?? a.lng;
  const lat1 = a.lat;
  const lon2 = b.lon ?? b.lng;
  const lat2 = b.lat;
  if (lon1 == null || lat1 == null || lon2 == null || lat2 == null) return 0;

  const dLat = (lat2 - lat1) * TO_RAD;
  const dLon = (lon2 - lon1) * TO_RAD;
  const la1 = lat1 * TO_RAD;
  const la2 = lat2 * TO_RAD;

  const sinDlat = Math.sin(dLat / 2);
  const sinDlon = Math.sin(dLon / 2);
  const h = sinDlat * sinDlat + Math.cos(la1) * Math.cos(la2) * sinDlon * sinDlon;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * 거리(미터)를 사용자 친화적 문자열로 포맷팅
 * 1km 미만: 10m 단위 반올림 (`150m`), 1km 이상: 소수점 1자리 (`1.2km`)
 * @param {number} m 거리 (미터)
 * @returns {string} 포맷팅된 문자열
 */
export function fmtDist(m) {
  return m < 1000 ? `${Math.round(m / 10) * 10}m` : `${(m / 1000).toFixed(1)}km`;
}

/**
 * 평지 도보 소요 시간(분) 계산 (우회계수 1.3, 분속 67m/분 적용, 최소 1분)
 * @param {number} m 직선 거리 (미터)
 * @returns {number} 소요 시간 (분)
 */
export function flatWalkMinutes(m) {
  return Math.max(1, Math.round(((m || 0) * 1.3) / 67));
}

/**
 * 학교 검색 질의 정규화 (공백 제거 및 '학교'/'등학교' 접미사 제거)
 * @param {string} s 검색어
 * @returns {string} 정규화된 검색 문자열
 */
export function normSchoolQuery(s) {
  return (s || '').replace(/\s/g, '').replace(/등학교$|학교$/, '');
}

/**
 * 동일 건물/인접 부지 내 위치한 기관 군집화 (기본 12m 이내)
 * @param {Array<Object>} facilities 시설 객체 배열
 * @param {number} [thresholdMeters=12] 클러스터링 임계 거리 (미터)
 * @returns {Array<{ id: string, lon: number, lat: number, items: Array<Object>, isMulti: boolean, primaryCat: string }>} 클러스터 배열
 */
export function groupCoLocated(facilities, thresholdMeters = 12) {
  if (!Array.isArray(facilities) || facilities.length === 0) {
    return [];
  }

  const clusters = [];
  for (let i = 0; i < facilities.length; i++) {
    const fac = facilities[i];
    if (!fac) continue;
    const fLon = fac.lon ?? fac.lng;
    const fLat = fac.lat;
    if (fLon == null || fLat == null) continue;

    let matchedCluster = null;
    for (let c = 0; c < clusters.length; c++) {
      const cluster = clusters[c];
      if (distMeters({ lon: cluster.lon, lat: cluster.lat }, { lon: fLon, lat: fLat }) <= thresholdMeters) {
        matchedCluster = cluster;
        break;
      }
    }

    if (matchedCluster) {
      matchedCluster.items.push(fac);
      matchedCluster.isMulti = matchedCluster.items.length > 1;
    } else {
      clusters.push({
        id: facilityKey(fac),
        lon: fLon,
        lat: fLat,
        items: [fac],
        isMulti: false,
        primaryCat: fac.cat || ''
      });
    }
  }

  return clusters;
}

/**
 * 특정 기관과 동일 건물(12m 이내)에 위치한 모든 동거 기관 목록 조회 (본인 포함)
 * @param {Array<Object>} allFacilities 전체 기관 목록
 * @param {Object} targetFacility 기준 기관
 * @param {number} [thresholdMeters=12] 인접 거리 (미터)
 * @returns {Array<Object>} 동일 건물 기관 배열
 */
export function getBuildingSiblings(allFacilities, targetFacility, thresholdMeters = 12) {
  if (!targetFacility || !Array.isArray(allFacilities)) {
    return [];
  }
  const tLon = targetFacility.lon ?? targetFacility.lng;
  const tLat = targetFacility.lat;
  if (tLon == null || tLat == null) return [targetFacility];

  return allFacilities.filter(f => {
    if (!f) return false;
    const fLon = f.lon ?? f.lng;
    const fLat = f.lat;
    if (fLon == null || fLat == null) return false;
    return distMeters({ lon: tLon, lat: tLat }, { lon: fLon, lat: fLat }) <= thresholdMeters;
  });
}

/**
 * 구면 기하를 이용한 정확한 원형 다각형 GeoJSON Feature 생성
 * @param {number} lon 중심 경도
 * @param {number} lat 중심 위도
 * @param {number} radiusMeters 반경 (미터)
 * @param {number} [steps=80] 원주 분할 점 수
 * @param {Object} [properties={}] GeoJSON 피처 속성
 * @returns {Object} GeoJSON Polygon Feature
 */
export function createCircleGeoJSON(lon, lat, radiusMeters, steps = 80, properties = {}) {
  const coordinates = [];
  const latRad = lat * TO_RAD;
  const lonRad = lon * TO_RAD;
  const d = radiusMeters / EARTH_RADIUS;

  for (let i = 0; i < steps; i++) {
    const bearing = (i * 360 / steps) * TO_RAD;
    const pLat = Math.asin(
      Math.sin(latRad) * Math.cos(d) +
      Math.cos(latRad) * Math.sin(d) * Math.cos(bearing)
    );
    const pLon = lonRad + Math.atan2(
      Math.sin(bearing) * Math.sin(d) * Math.cos(latRad),
      Math.cos(d) - Math.sin(latRad) * Math.sin(pLat)
    );
    const normLon = ((pLon * TO_DEG + 540) % 360) - 180;
    coordinates.push([Number(normLon.toFixed(7)), Number((pLat * TO_DEG).toFixed(7))]);
  }
  // 닫힌 링 형성
  coordinates.push([coordinates[0][0], coordinates[0][1]]);

  return {
    type: 'Feature',
    properties: { ...properties },
    geometry: {
      type: 'Polygon',
      coordinates: [coordinates]
    }
  };
}

/**
 * 내부 원주 좌표 생성 헬퍼 (bearing = 0 정점부터 시작)
 * @private
 */
function getCircleRingCoords(lon, lat, radiusMeters, steps = 72) {
  const coords = [];
  const latRad = lat * TO_RAD;
  const lonRad = lon * TO_RAD;
  const d = radiusMeters / EARTH_RADIUS;

  for (let i = 0; i < steps; i++) {
    const bearing = (i * 360 / steps) * TO_RAD;
    const pLat = Math.asin(
      Math.sin(latRad) * Math.cos(d) +
      Math.cos(latRad) * Math.sin(d) * Math.cos(bearing)
    );
    const pLon = lonRad + Math.atan2(
      Math.sin(bearing) * Math.sin(d) * Math.cos(latRad),
      Math.cos(d) - Math.sin(latRad) * Math.sin(pLat)
    );
    const normLon = ((pLon * TO_DEG + 540) % 360) - 180;
    coords.push([Number(normLon.toFixed(7)), Number((pLat * TO_DEG).toFixed(7))]);
  }
  coords.push([coords[0][0], coords[0][1]]);
  return coords;
}

/**
 * 3D 지형 위에 표출할 반경 링 레이더 FeatureCollection 생성
 * - 바깥 채우기 폴리곤 (Polygon)
 * - 바깥 외곽선 (LineString)
 * - 내부 보조 링선 (LineString, 500m 또는 1000m 간격)
 * - 북쪽 정점(bearing=0) 거리 라벨 포인트 (Point)
 * @param {number} lon 중심 경도
 * @param {number} lat 중심 위도
 * @param {number} maxRadiusMeters 최대 반경 (미터)
 * @returns {Object} GeoJSON FeatureCollection
 */
export function createRadarRingsGeoJSON(lon, lat, maxRadiusMeters) {
  const features = [];
  const outerCoords = getCircleRingCoords(lon, lat, maxRadiusMeters);

  // 1. 바깥 반경 폴리곤
  features.push({
    type: 'Feature',
    properties: {
      kind: 'outer-fill',
      radius: maxRadiusMeters
    },
    geometry: {
      type: 'Polygon',
      coordinates: [outerCoords]
    }
  });

  // 2. 바깥 반경 외곽선
  features.push({
    type: 'Feature',
    properties: {
      kind: 'outer-line',
      radius: maxRadiusMeters,
      label: fmtDist(maxRadiusMeters)
    },
    geometry: {
      type: 'LineString',
      coordinates: outerCoords
    }
  });

  // 3. 내부 보조 링
  const innerRings = [];
  if (maxRadiusMeters > 500) {
    const step = maxRadiusMeters >= 2000 ? 1000 : 500;
    for (let m = step; m < maxRadiusMeters; m += step) {
      const ringCoords = getCircleRingCoords(lon, lat, m);
      innerRings.push({ radius: m, coords: ringCoords });
      features.push({
        type: 'Feature',
        properties: {
          kind: 'inner-line',
          radius: m,
          label: fmtDist(m)
        },
        geometry: {
          type: 'LineString',
          coordinates: ringCoords
        }
      });
    }
  }

  // 4. 각 링의 북쪽 정점(bearing = 0) 위치 거리 라벨용 Point 피처
  for (let i = 0; i < innerRings.length; i++) {
    const r = innerRings[i];
    features.push({
      type: 'Feature',
      properties: {
        kind: 'ring-label',
        radius: r.radius,
        label: fmtDist(r.radius)
      },
      geometry: {
        type: 'Point',
        coordinates: r.coords[0] // bearing = 0 북쪽 정점
      }
    });
  }

  features.push({
    type: 'Feature',
    properties: {
      kind: 'ring-label',
      radius: maxRadiusMeters,
      label: fmtDist(maxRadiusMeters)
    },
    geometry: {
      type: 'Point',
      coordinates: outerCoords[0] // bearing = 0 북쪽 정점
    }
  });

  return {
    type: 'FeatureCollection',
    features
  };
}

/**
 * 학교와 시설 간의 3D 지형 고도 프로파일 및 경사 보행 시간(Tobler's Hiking Function) 분석
 * @param {Object} school 기준 학교 객체 ({ lon, lat, gu })
 * @param {Object} facility 대상 시설 객체 ({ lon, lat, gu })
 * @param {(lon: number, lat: number) => number|null|undefined} sampleElevFn 고도 샘플링 함수
 * @param {number} [numSamples=28] 보간 구간 수 (기본 28개 구간, 29개 지점)
 * @returns {{
 *   samples: Array<{ ratio: number, dist: number, lon: number, lat: number, elev: number }>,
 *   totalDist: number,
 *   startElev: number,
 *   endElev: number,
 *   minElev: number,
 *   maxElev: number,
 *   gainMeters: number,
 *   lossMeters: number,
 *   flatMinutes: number,
 *   slopeMinutes: number,
 *   maxSlopePct: number,
 *   crossesHarbor: boolean,
 *   terrainReady: boolean
 * }}
 */
export function analyzeTerrainProfile(school, facility, sampleElevFn, numSamples = 28) {
  if (!school || !facility) {
    return {
      samples: [],
      totalDist: 0,
      startElev: 0,
      endElev: 0,
      minElev: 0,
      maxElev: 0,
      gainMeters: 0,
      lossMeters: 0,
      flatMinutes: 1,
      slopeMinutes: 1,
      maxSlopePct: 0,
      crossesHarbor: false,
      terrainReady: false
    };
  }

  const sLon = school.lon ?? school.lng;
  const sLat = school.lat;
  const fLon = facility.lon ?? facility.lng;
  const fLat = facility.lat;

  const straightDist = distMeters({ lon: sLon, lat: sLat }, { lon: fLon, lat: fLat });
  const totalDist = Math.round(straightDist);
  const flatMinutes = flatWalkMinutes(totalDist);

  // 영도구 도서 지역 횡단 여부
  const guCrossing = Boolean(
    (school.gu === '영도구' && facility.gu && facility.gu !== '영도구') ||
    (school.gu && school.gu !== '영도구' && facility.gu === '영도구')
  );

  const sampleCount = Math.max(1, numSamples || 28);
  const pointCount = sampleCount + 1;

  // 1차 선형 보간 샘플링
  const rawPoints = [];
  let validCount = 0;

  for (let i = 0; i < pointCount; i++) {
    const ratio = i / sampleCount;
    const lon = sLon + (fLon - sLon) * ratio;
    const lat = sLat + (fLat - sLat) * ratio;

    let elev = null;
    if (typeof sampleElevFn === 'function') {
      try {
        const val = sampleElevFn(lon, lat);
        if (val !== null && val !== undefined && Number.isFinite(Number(val))) {
          elev = Number(val);
          validCount++;
        }
      } catch {
        elev = null;
      }
    }
    rawPoints.push({ ratio, lon, lat, elev });
  }

  // 지형 타일 데이터 준비 여부 판정 (최소 60% 이상 유효 샘플)
  const minValidNeeded = Math.floor(sampleCount * 0.6);
  const terrainReady = validCount >= minValidNeeded;

  if (!terrainReady) {
    const samples = rawPoints.map(pt => ({
      ratio: Number(pt.ratio.toFixed(4)),
      dist: Math.round(pt.ratio * totalDist),
      lon: Number(pt.lon.toFixed(7)),
      lat: Number(pt.lat.toFixed(7)),
      elev: 0
    }));

    return {
      samples,
      totalDist,
      startElev: 0,
      endElev: 0,
      minElev: 0,
      maxElev: 0,
      gainMeters: 0,
      lossMeters: 0,
      flatMinutes,
      slopeMinutes: flatMinutes,
      maxSlopePct: 0,
      crossesHarbor: guCrossing,
      terrainReady: false
    };
  }

  // 결측 고도값 선형 보간 (Interpolation)
  const elevs = rawPoints.map(pt => pt.elev);
  for (let i = 0; i < elevs.length; i++) {
    if (elevs[i] === null) {
      let prevIdx = -1;
      for (let p = i - 1; p >= 0; p--) {
        if (elevs[p] !== null) { prevIdx = p; break; }
      }
      let nextIdx = -1;
      for (let n = i + 1; n < elevs.length; n++) {
        if (elevs[n] !== null) { nextIdx = n; break; }
      }

      if (prevIdx !== -1 && nextIdx !== -1) {
        const t = (i - prevIdx) / (nextIdx - prevIdx);
        elevs[i] = elevs[prevIdx] + t * (elevs[nextIdx] - elevs[prevIdx]);
      } else if (prevIdx !== -1) {
        elevs[i] = elevs[prevIdx];
      } else if (nextIdx !== -1) {
        elevs[i] = elevs[nextIdx];
      } else {
        elevs[i] = 0;
      }
    }
  }

  // DEM 격자 계단 노이즈 완화 (양 끝점 고도 보존 + 3점 가중 이동평균)
  const smoothedElevs = elevs.map((val, idx) => {
    if (idx === 0 || idx === elevs.length - 1) return val;
    return 0.25 * elevs[idx - 1] + 0.5 * val + 0.25 * elevs[idx + 1];
  });
  const roundedElevs = smoothedElevs.map(e => Math.round(e * 10) / 10);
  const startElev = roundedElevs[0];
  const endElev = roundedElevs[roundedElevs.length - 1];
  const minElev = Math.min(...roundedElevs);
  const maxElev = Math.max(...roundedElevs);

  let gainMeters = 0;
  let lossMeters = 0;
  let maxSlope = 0;
  let totalTimeMinutes = 0;

  for (let i = 0; i < sampleCount; i++) {
    const e1 = roundedElevs[i];
    const e2 = roundedElevs[i + 1];
    const dElev = e2 - e1;

    if (dElev > 0) gainMeters += dElev;
    else if (dElev < 0) lossMeters += Math.abs(dElev);

    const segDist = straightDist / sampleCount;
    const horizDist = Math.max(segDist * 1.3, 18); // 직선 우회계수 1.3 및 최소 수평 세그먼트 보정
    const slope = horizDist > 0 ? (dElev / horizDist) : 0;
    const absSlope = Math.abs(slope);
    if (absSlope > maxSlope) maxSlope = absSlope;

    // 도심 보행자(학생·횡단보도) 기준 경사 보정 Tobler 함수 (slope=0일 때 약 4.02km/h = 67m/분)
    const speedKmh = 4.8 * Math.exp(-3.5 * Math.abs(slope + 0.05));
    if (horizDist > 0 && speedKmh > 0) {
      const segTimeMin = ((segDist * 1.3) / 1000) / speedKmh * 60;
      totalTimeMinutes += segTimeMin;
    }
  }

  const slopeMinutes = Math.max(1, Math.round(totalTimeMinutes));
  const maxSlopePct = Math.round(maxSlope * 100);

  // 부산 항만/해수면 횡단 감지 (terrainReady 시 해수면 체크)
  let waterCrossing = false;
  if (startElev >= 3 && endElev >= 3 && roundedElevs.length >= 5) {
    let consecutiveSea = 0;
    for (let i = 1; i < roundedElevs.length - 1; i++) {
      if (roundedElevs[i] <= 0.8) {
        consecutiveSea++;
        if (consecutiveSea >= 3) {
          waterCrossing = true;
          break;
        }
      } else {
        consecutiveSea = 0;
      }
    }
  }
  const crossesHarbor = Boolean(guCrossing || waterCrossing);

  const samples = rawPoints.map((pt, i) => ({
    ratio: Number(pt.ratio.toFixed(4)),
    dist: Math.round(pt.ratio * totalDist),
    lon: Number(pt.lon.toFixed(7)),
    lat: Number(pt.lat.toFixed(7)),
    elev: roundedElevs[i]
  }));

  return {
    samples,
    totalDist,
    startElev,
    endElev,
    minElev,
    maxElev,
    gainMeters: Math.round(gainMeters),
    lossMeters: Math.round(lossMeters),
    flatMinutes,
    slopeMinutes,
    maxSlopePct,
    crossesHarbor,
    terrainReady: true
  };
}
