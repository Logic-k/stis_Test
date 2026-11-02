// js/constants.js
// STIS 3D Map Constants & Theme Palette: 부산 원도심 4개 구 학생맞춤통합지원 시설 분류 체계 및 시각화 상수

/**
 * 8대 지원 영역 분류 코드 및 한국어 레이블 목록
 * @type {Array<[string, string]>}
 */
export const CATS = [
  ['wel', '복지·가족'],
  ['care', '돌봄'],
  ['mind', '상담'],
  ['safe', '보호·안전'],
  ['shelter', '생활시설'],
  ['med', '의료·보건'],
  ['youth', '청소년·진로'],
  ['edu', '교육·학습']
];

/**
 * 분류 코드 -> 레이블 맵
 * @type {Record<string, string>}
 */
export const CATL = Object.fromEntries(CATS);

/**
 * 색상 객체 생성 헬퍼 (템플릿 리터럴 문자열 보간 시 light hex 자동 반환)
 * @private
 */
function createColorToken(light, dark, rgb, darkRgb) {
  return {
    light,
    dark,
    rgb,
    darkRgb,
    toString() {
      return this.light;
    }
  };
}

/**
 * 8대 카테고리 테마 색상 팔레트 (라이트/다크 및 Deck.gl/WebGL용 RGB 배열 제공)
 */
export const CAT_COLORS = {
  wel: createColorToken('#C85E14', '#EA8A45', [200, 94, 20], [234, 138, 69]),
  care: createColorToken('#B8336F', '#E0679C', [184, 51, 111], [224, 103, 156]),
  mind: createColorToken('#7A4DC4', '#A385E8', [122, 77, 196], [163, 133, 232]),
  safe: createColorToken('#C42F25', '#EE6A60', [196, 47, 37], [238, 106, 96]),
  shelter: createColorToken('#7A5C43', '#B5937A', [122, 92, 67], [181, 147, 122]),
  med: createColorToken('#0F8576', '#3DBBA9', [15, 133, 118], [61, 187, 169]),
  youth: createColorToken('#3F8524', '#74B957', [63, 133, 36], [116, 185, 87]),
  edu: createColorToken('#2468BF', '#5B9BE8', [36, 104, 191], [91, 155, 232])
};

/**
 * 지원 자치구 목록 (서부교육지원청 관할 원도심 4개 구)
 */
export const GUS = ['서구', '중구', '영도구', '사하구'];

/**
 * 자치구별 CSS 변수명 맵
 */
export const GUVAR = {
  '서구': '--seo',
  '중구': '--jg',
  '영도구': '--yd',
  '사하구': '--saha'
};

/**
 * 자치구별 테마 색상
 */
export const GU_COLORS = {
  '서구': {
    light: '#E35D4F',
    dark: '#F07A6D',
    toString() { return this.light; }
  },
  '영도구': {
    light: '#2E7FC0',
    dark: '#5AA6E0',
    toString() { return this.light; }
  },
  '사하구': {
    light: '#2C8A5A',
    dark: '#4FB383',
    toString() { return this.light; }
  },
  '중구': {
    light: '#7556BE',
    dark: '#9B82E0',
    toString() { return this.light; }
  }
};

/**
 * 학교급 코드 및 레이블
 */
export const LV = {
  '초': '초등학교',
  '중': '중학교',
  '고': '고등학교'
};

/**
 * 기관 고유 키 생성 (`구-번호`)
 * @param {{ gu: string, no: number|string }} r
 * @returns {string}
 */
export function facilityKey(r) {
  if (!r) return '';
  return `${r.gu}-${r.no}`;
}

/**
 * 카테고리 SVG 아이콘 마크업 렌더러
 * @param {string} cat 카테고리 코드 (wel, care, mind 등)
 * @param {number} [size=26] 아이콘 크기 (픽셀)
 * @returns {string} SVG 마크업 문자열
 */
export function renderCatIcon(cat, size = 26) {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="var(--${cat})"/><use href="#g-${cat}" x="0" y="0" width="32" height="32"/></svg>`;
}
