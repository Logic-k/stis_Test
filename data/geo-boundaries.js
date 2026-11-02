import { D } from './stis-raw.js';

/**
 * Projects SVG coordinates (x, y) back to WGS84 geographic coordinates [longitude, latitude].
 * Forward projection in index.html:
 *   x = (lon - pr.minlon) * pr.k * pr.s
 *   y = (pr.maxlat - lat) * pr.s
 * Inverse projection:
 *   lon = x / (pr.k * pr.s) + pr.minlon
 *   lat = pr.maxlat - y / pr.s
 *
 * @param {number} x
 * @param {number} y
 * @param {object} pr Projection parameters { minlon, maxlat, k, s }
 * @returns {[number, number]} [lon, lat]
 */
export function projectInverse(x, y, pr) {
  const lon = x / (pr.k * pr.s) + pr.minlon;
  const lat = pr.maxlat - y / pr.s;
  return [lon, lat];
}

/**
 * Parses an SVG path string into an array of subpaths with coordinates in WGS84 [lon, lat].
 * Handles M, L, Z commands, implicit line-tos, and closes subpaths on Z.
 *
 * @param {string} dStr SVG path data
 * @param {object} pr Projection parameters
 * @returns {Array<Array<[number, number]>>} MultiLineString coordinates
 */
export function svgPathToMultiLineCoords(dStr, pr) {
  if (!dStr) return [];
  const tokens = dStr.match(/[a-zA-Z]|[-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?/g) || [];
  const subpaths = [];
  let curSubpath = [];
  let i = 0;

  while (i < tokens.length) {
    const token = tokens[i];
    if (/[a-zA-Z]/.test(token)) {
      const cmd = token.toUpperCase();
      if (cmd === 'Z') {
        if (curSubpath.length > 0) {
          const first = curSubpath[0];
          const last = curSubpath[curSubpath.length - 1];
          if (first[0] !== last[0] || first[1] !== last[1]) {
            curSubpath.push([first[0], first[1]]);
          }
          subpaths.push(curSubpath);
          curSubpath = [];
        }
        i++;
        continue;
      }
      if (cmd === 'M') {
        if (curSubpath.length > 0) {
          subpaths.push(curSubpath);
          curSubpath = [];
        }
        i++;
        continue;
      }
      if (cmd === 'L') {
        i++;
        continue;
      }
      i++;
    } else {
      const x = parseFloat(token);
      const y = parseFloat(tokens[i + 1]);
      i += 2;
      curSubpath.push(projectInverse(x, y, pr));
    }
  }

  if (curSubpath.length > 0) {
    subpaths.push(curSubpath);
  }

  return subpaths;
}

const pr = D.proj;
const GUS = ['서구', '중구', '영도구', '사하구'];

// 1. GU_OUTLINES_GEOJSON: 4개 구(서구, 중구, 영도구, 사하구) FeatureCollection
export const GU_OUTLINES_GEOJSON = {
  type: 'FeatureCollection',
  features: GUS.filter(gu => D.outlines && D.outlines[gu]).map(gu => ({
    type: 'Feature',
    properties: { gu },
    geometry: {
      type: 'MultiLineString',
      coordinates: svgPathToMultiLineCoords(D.outlines[gu], pr)
    }
  }))
};

// 2. DONG_OUTLINES_GEOJSON: D.dongs 49개 동 FeatureCollection
export const DONG_OUTLINES_GEOJSON = {
  type: 'FeatureCollection',
  features: (D.dongs || []).map(d => ({
    type: 'Feature',
    properties: { nm: d.nm },
    geometry: {
      type: 'MultiLineString',
      coordinates: svgPathToMultiLineCoords(d.d, pr)
    }
  }))
};

// 3. GU_LABELS_GEOJSON: D.gulabels 4개 구 중심점 FeatureCollection
export const GU_LABELS_GEOJSON = {
  type: 'FeatureCollection',
  features: GUS.filter(gu => D.gulabels && D.gulabels[gu]).map(gu => ({
    type: 'Feature',
    properties: { gu },
    geometry: {
      type: 'Point',
      coordinates: projectInverse(D.gulabels[gu][0], D.gulabels[gu][1], pr)
    }
  }))
};

// 4. DONG_LABELS_GEOJSON: D.dongs 각 d.c 중심점 FeatureCollection
export const DONG_LABELS_GEOJSON = {
  type: 'FeatureCollection',
  features: (D.dongs || []).map(d => ({
    type: 'Feature',
    properties: { nm: d.nm },
    geometry: {
      type: 'Point',
      coordinates: projectInverse(d.c[0], d.c[1], pr)
    }
  }))
};
