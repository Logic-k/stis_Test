// js/app.js
// STIS 3D Digital Twin Map Controller: 상태 관리, UI 이벤트 바인딩 및 3D 지도 엔진/인스펙터 총괄 연동

import { D } from '../data/stis-raw.js';
import {
  CATS,
  CATL,
  CAT_COLORS,
  GUS,
  GUVAR,
  GU_COLORS,
  LV,
  facilityKey,
  renderCatIcon
} from './constants.js';
import {
  toLngLat,
  distMeters,
  fmtDist,
  flatWalkMinutes,
  normSchoolQuery,
  groupCoLocated,
  getBuildingSiblings,
  createCircleGeoJSON,
  createRadarRingsGeoJSON,
  analyzeTerrainProfile
} from './geo-utils.js';
import { Map3DEngine } from './map3d-engine.js';
import { InspectorPanel } from './inspector-panel.js';

/* ==========================================================================
   1. State & Local Storage Initialization
   ========================================================================== */

let inspectorPanel = null;
let mapEngine = null;

const STORAGE_KEY = 'swk-school-finder';

/**
 * 전역 애플리케이션 상태 객체
 */
const S = {
  school: null,
  r: 1000,
  cats: new Set(CATS.map(c => c[0])),
  gu: '전체',
  lv: '전체',
  sel: null,
  hov: null,
  picking: false,
  theme: 'light',
  viewMode: 'diorama'
};

// 로컬 스토리지 상태 복원
try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  if (saved && typeof saved === 'object') {
    if (saved.r && [500, 1000, 2000, 3000].includes(Number(saved.r))) {
      S.r = Number(saved.r);
    }
    if (saved.viewMode && ['diorama', 'satellite', 'flat2d'].includes(saved.viewMode)) {
      S.viewMode = saved.viewMode;
    }
    if (saved.theme && ['light', 'dark'].includes(saved.theme)) {
      S.theme = saved.theme;
    }
    if (saved.school) {
      if (saved.school.custom) {
        S.school = saved.school;
      } else {
        const found = D.schools.find(s => s.name === saved.school.name && (!saved.school.gu || s.gu === saved.school.gu));
        S.school = found || saved.school;
      }
    }
  }
} catch (err) {
  console.warn('[STIS App] LocalStorage restore failed:', err);
}

// 시스템 다크모드 기본 감지 (스토리지에 theme이 명시되지 않았을 때)
if (!localStorage.getItem(STORAGE_KEY) || !S.theme) {
  if (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    S.theme = 'dark';
  }
}

// 기본 학교: 토성초등학교 (부산 서구 토성동 소재)
if (!S.school) {
  S.school = D.schools.find(s => s.name === '토성초등학교') || D.schools[0];
}

/**
 * 상태를 로컬 스토리지에 영구 저장
 */
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      r: S.r,
      school: S.school,
      theme: S.theme,
      viewMode: S.viewMode
    }));
  } catch (err) {
    console.warn('[STIS App] LocalStorage save failed:', err);
  }
}

/* ==========================================================================
   2. DOM References & Toast / Clipboard Utilities
   ========================================================================== */

const DOM = {
  themeBtn: document.getElementById('themeBtn'),
  stRes: document.getElementById('stRes'),
  stSch: document.getElementById('stSch'),
  q: document.getElementById('q'),
  opts: document.getElementById('opts'),
  guChips: document.getElementById('guChips'),
  lvChips: document.getElementById('lvChips'),
  pick: document.getElementById('pick'),
  pickName: document.getElementById('pickName'),
  pickSub: document.getElementById('pickSub'),
  pickBtn: document.getElementById('pickBtn'),
  cancelPickBtn: document.getElementById('cancelPickBtn'),
  pickingBanner: document.getElementById('pickingBanner'),
  seg: document.getElementById('seg'),
  allCats: document.getElementById('allCats'),
  cats: document.getElementById('cats'),
  sumText: document.getElementById('sumText'),
  copyAll: document.getElementById('copyAll'),
  list: document.getElementById('list'),
  map: document.getElementById('map'),
  mapHint: document.getElementById('mapHint'),
  fitBtn: document.getElementById('fitBtn'),
  allBtn: document.getElementById('allBtn'),
  zIn: document.getElementById('zIn'),
  zOut: document.getElementById('zOut'),
  tiltBtn: document.getElementById('tiltBtn'),
  orbitHudBtn: document.getElementById('orbitHudBtn'),
  mapLoading: document.getElementById('mapLoading'),
  inspectorHost: document.getElementById('inspectorHost'),
  legend: document.getElementById('legend'),
  toast: document.getElementById('toast')
};

// 통계 헤더 수록 건수 표출
if (DOM.stRes) DOM.stRes.textContent = String(D.res.length);
if (DOM.stSch) DOM.stSch.textContent = String(D.schools.length);

let toastTimer = null;
/**
 * 토스트 알림 표출
 * @param {string} msg
 */
function showToast(msg) {
  const t = DOM.toast;
  if (!t) return;
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.hidden = true;
  }, 1800);
}

/**
 * 텍스트 클립보드 복사 유틸리티 (Clipboard API + Fallback)
 * @param {string} text
 * @param {string} successMsg
 */
function copyToClipboard(text, successMsg) {
  const done = () => showToast(successMsg);
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      done();
    } catch {
      showToast('복사하지 못했어요. 글자를 직접 선택해 주세요.');
    }
    ta.remove();
  };

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done, fallback);
  } else {
    fallback();
  }
}

/* ==========================================================================
   3. Theme Management
   ========================================================================== */

/**
 * 테마 적용 및 지도/버튼 동기화
 * @param {'light'|'dark'} theme
 */
function applyTheme(theme) {
  S.theme = theme;
  document.documentElement.dataset.theme = theme;

  if (DOM.themeBtn) {
    DOM.themeBtn.setAttribute('aria-label', theme === 'dark' ? '라이트 테마로 전환' : '다크 테마로 전환');
    DOM.themeBtn.textContent = theme === 'dark' ? '☀️ 라이트' : '🌙 다크';
  }

  mapEngine?.setTheme(theme);
  saveState();
}

// 초기 테마 적용
applyTheme(S.theme);

if (DOM.themeBtn) {
  DOM.themeBtn.addEventListener('click', () => {
    applyTheme(S.theme === 'dark' ? 'light' : 'dark');
  });
}

/* ==========================================================================
   4. Legend & View Mode Segments
   ========================================================================== */

// 범례 구성: 8개 영역 아이콘 + 대략 위치(3D 홀로그램) + 복합 입주 건물(수직 토템)
if (DOM.legend) {
  const catItems = CATS.map(([c, l]) => `<span>${renderCatIcon(c, 16)}${l}</span>`).join('');
  const approxItem = `
    <span>
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style="vertical-align:middle">
        <circle cx="8" cy="8" r="6" fill="none" stroke="var(--focus)" stroke-width="1.8" stroke-dasharray="2.5 2"/>
      </svg>
      대략 위치 (3D 홀로그램)
    </span>
  `;
  const totemItem = `
    <span>
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style="vertical-align:middle">
        <rect x="3" y="2" width="10" height="12" rx="2" fill="none" stroke="var(--accent)" stroke-width="1.8"/>
        <circle cx="8" cy="5" r="1.5" fill="var(--accent)"/>
        <circle cx="8" cy="11" r="1.5" fill="var(--accent)"/>
      </svg>
      복합 입주 건물 (수직 토템)
    </span>
  `;
  DOM.legend.innerHTML = catItems + approxItem + totemItem;
}

/**
 * 뷰 모드 버튼 UI 동기화
 */
function updateModeButtons() {
  document.querySelectorAll('.mode-btn').forEach(btn => {
    const isActive = btn.dataset.mode === S.viewMode;
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

updateModeButtons();

document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    if (mode && mode !== S.viewMode) {
      S.viewMode = mode;
      updateModeButtons();
      mapEngine?.setViewMode(mode);
      saveState();
    }
  });
});

/* ==========================================================================
   5. School Selection, Combobox & Filter Chips
   ========================================================================== */

/**
 * 기준 학교 지정
 * @param {Object} s 학교 객체
 */
function setSchool(s) {
  S.school = s;
  S.sel = null;
  S.hov = null;

  if (DOM.q) DOM.q.value = s.custom ? '' : s.name;
  if (DOM.opts) {
    DOM.opts.hidden = true;
    DOM.q?.setAttribute('aria-expanded', 'false');
  }

  inspectorPanel?.render({ school: S.school, facility: null });
  saveState();
  render();

  mapEngine?.stopOrbit();
  mapEngine?.flyToSchool(S.school, S.r);
}

/**
 * 필터 칩 렌더러
 * @param {HTMLElement} host
 * @param {Array<string>} values
 * @param {'gu'|'lv'} key
 */
function renderChips(host, values, key) {
  if (!host) return;
  host.innerHTML = '';
  ['전체', ...values].forEach(v => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.textContent = (key === 'lv' && v !== '전체') ? (LV[v] || v) : v;
    btn.setAttribute('aria-pressed', S[key] === v ? 'true' : 'false');
    btn.addEventListener('click', () => {
      S[key] = v;
      host.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', c === btn ? 'true' : 'false'));
      showOpts(true);
      DOM.q?.focus();
    });
    host.appendChild(btn);
  });
}

renderChips(DOM.guChips, GUS, 'gu');
renderChips(DOM.lvChips, ['초', '중', '고'], 'lv');

let optSelIndex = -1;
let currentOpts = [];

/**
 * 학교 자동완성 옵션 목록 표출
 * @param {boolean} force
 */
function showOpts(force) {
  const q = DOM.q;
  const opts = DOM.opts;
  if (!q || !opts) return;

  const query = normSchoolQuery(q.value);
  currentOpts = D.schools.filter(s => {
    const matchGu = (S.gu === '전체' || s.gu === S.gu);
    const matchLv = (S.lv === '전체' || s.lv === S.lv);
    const matchQuery = (!query || normSchoolQuery(s.name).includes(query) || s.name.includes(q.value.trim()));
    return matchGu && matchLv && matchQuery;
  });
  currentOpts.sort((a, b) => a.name.localeCompare(b.name, 'ko'));

  if (!force && !query) {
    opts.hidden = true;
    q.setAttribute('aria-expanded', 'false');
    return;
  }

  opts.innerHTML = currentOpts.length
    ? ''
    : '<div class="opt" aria-disabled="true" style="color:var(--muted);cursor:default">맞는 학교가 없어요. 지도에서 위치를 골라 보세요.</div>';

  currentOpts.forEach((s, idx) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'opt';
    b.setAttribute('role', 'option');
    b.id = `opt-${idx}`;
    b.innerHTML = `<span>${s.name}</span><small>${s.gu} · ${LV[s.lv] || s.lv}</small>`;
    b.addEventListener('mousedown', e => e.preventDefault());
    b.addEventListener('click', () => {
      setSchool(s);
    });
    opts.appendChild(b);
  });

  optSelIndex = -1;
  opts.hidden = false;
  q.setAttribute('aria-expanded', 'true');
}

if (DOM.q) {
  DOM.q.value = S.school.custom ? '' : S.school.name;
  DOM.q.addEventListener('input', () => showOpts(false));
  DOM.q.addEventListener('focus', () => showOpts(true));
  DOM.q.addEventListener('blur', () => {
    setTimeout(() => {
      if (DOM.opts) DOM.opts.hidden = true;
      DOM.q?.setAttribute('aria-expanded', 'false');
    }, 160);
  });
  DOM.q.addEventListener('keydown', e => {
    if (!DOM.opts) return;
    const items = [...DOM.opts.querySelectorAll('.opt[role="option"]')];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (DOM.opts.hidden) showOpts(true);
      if (!items.length) return;
      optSelIndex = Math.max(0, Math.min(items.length - 1, optSelIndex + (e.key === 'ArrowDown' ? 1 : -1)));
      items.forEach((it, i) => it.classList.toggle('on', i === optSelIndex));
      items[optSelIndex]?.scrollIntoView({ block: 'nearest' });
      DOM.q.setAttribute('aria-activedescendant', items[optSelIndex]?.id || '');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const chosen = currentOpts[optSelIndex >= 0 ? optSelIndex : 0];
      if (chosen) setSchool(chosen);
    } else if (e.key === 'Escape') {
      DOM.opts.hidden = true;
      DOM.q.setAttribute('aria-expanded', 'false');
    }
  });
}

/* ==========================================================================
   6. Radius & Category Filter Controls
   ========================================================================== */

if (DOM.seg) {
  DOM.seg.querySelectorAll('button[data-r]').forEach(btn => {
    btn.addEventListener('click', () => {
      S.r = Number(btn.dataset.r);
      saveState();
      render();
      mapEngine?.stopOrbit();
      mapEngine?.flyToSchool(S.school, S.r);
    });
  });
}

if (DOM.cats) {
  DOM.cats.innerHTML = '';
  CATS.forEach(([c, l]) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cat';
    btn.dataset.c = c;
    btn.setAttribute('aria-pressed', S.cats.has(c) ? 'true' : 'false');
    btn.innerHTML = `${renderCatIcon(c, 22)}<span>${l}</span><span class="n">0</span>`;
    btn.addEventListener('click', () => {
      if (S.cats.has(c)) {
        S.cats.delete(c);
      } else {
        S.cats.add(c);
      }
      btn.setAttribute('aria-pressed', S.cats.has(c) ? 'true' : 'false');
      render();
    });
    DOM.cats.appendChild(btn);
  });
}

if (DOM.allCats) {
  DOM.allCats.addEventListener('click', () => {
    CATS.forEach(([c]) => S.cats.add(c));
    DOM.cats?.querySelectorAll('.cat').forEach(b => b.setAttribute('aria-pressed', 'true'));
    render();
  });
}

/* ==========================================================================
   7. Interactive Picking Mode (지도에서 위치 고르기)
   ========================================================================== */

/**
 * 좌표 직접 선택 모드 토글
 * @param {boolean} on
 */
function setPicking(on) {
  S.picking = on;
  if (DOM.pickingBanner) DOM.pickingBanner.hidden = !on;
  if (DOM.pickBtn) DOM.pickBtn.textContent = on ? '고르기 취소' : '지도에서 위치 고르기';
  if (DOM.mapHint) {
    DOM.mapHint.textContent = on
      ? '지도 위 원하는 지점을 클릭해 기준 위치를 지정하세요.'
      : '핀을 누르면 기관 정보가 목록과 3D 상세 카드에서 표시돼요.';
  }

  mapEngine?.updateState({ picking: S.picking });

  if (on && window.innerWidth <= 900) {
    DOM.map?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

if (DOM.pickBtn) {
  DOM.pickBtn.addEventListener('click', () => {
    setPicking(!S.picking);
  });
}

if (DOM.cancelPickBtn) {
  DOM.cancelPickBtn.addEventListener('click', () => {
    setPicking(false);
  });
}

/* ==========================================================================
   8. Facility Results Rendering & List State
   ========================================================================== */

let currentFacilities = [];
let allFacilitiesWithDist = [];

/**
 * 목록 내 선택 하이라이트 동기화
 */
function updateListSelection() {
  const selKey = S.sel ? facilityKey(S.sel) : null;
  document.querySelectorAll('.item').forEach(it => {
    it.classList.toggle('on', Boolean(selKey && it.dataset.key === selKey));
  });
}

/**
 * 인스펙터 상세 정보 카드 갱신 (지형 프로파일 및 동일 건물 동거 기관)
 */
function refreshInspector() {
  if (!S.sel || !S.school || !inspectorPanel) return;

  const siblings = getBuildingSiblings(allFacilitiesWithDist, S.sel);
  const profile = analyzeTerrainProfile(
    S.school,
    S.sel,
    (lon, lat) => mapEngine?.sampleElevation(lon, lat)
  );

  inspectorPanel.render({
    school: S.school,
    facility: S.sel,
    siblings,
    profile,
    isOrbiting: Boolean(mapEngine?.isOrbiting)
  });
}

/**
 * 기관 선택/해제 처리
 * @param {Object} r 시설 객체
 * @param {boolean} fromMap 지도 마커/클릭에서 발생했는지 여부
 */
function selectFacility(r, fromMap) {
  if (!r) return;

  // 동일 기관 재클릭 시 선택 해제
  if (S.sel && facilityKey(S.sel) === facilityKey(r)) {
    S.sel = null;
    mapEngine?.stopOrbit();
    mapEngine?.updateState({ selectedFacility: null });
    inspectorPanel?.render({ school: S.school, facility: null });
    updateListSelection();
    return;
  }

  // 시설 객체 정규화 (.m 거리 보장)
  const targetFacility = allFacilitiesWithDist.find(f => facilityKey(f) === facilityKey(r)) || r;
  if (targetFacility.m == null && S.school) {
    targetFacility.m = distMeters(S.school, targetFacility);
  }

  S.sel = targetFacility;
  mapEngine?.stopOrbit();
  mapEngine?.updateState({ selectedFacility: S.sel });
  mapEngine?.focusFacility(S.school, S.sel);
  updateListSelection();

  // 스크롤 동기화
  if (fromMap) {
    const it = document.querySelector(`.item[data-key="${facilityKey(targetFacility)}"]`);
    it?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } else if (window.innerWidth <= 900) {
    document.querySelector('.mapcard')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // 인스펙터 패널 즉시 렌더링
  refreshInspector();

  // 3D 카메라 비행 완료(1.15초) 후 고해상도 DEM 타일 로드 반영을 위해 재샘플링
  setTimeout(() => {
    if (S.sel && facilityKey(S.sel) === facilityKey(targetFacility)) {
      refreshInspector();
    }
  }, 1150);
}

/**
 * 주 화면 전체 렌더링 함수
 */
function render() {
  const sc = S.school;
  if (!sc) return;

  // 1) 기준 학교 카드 갱신
  if (DOM.pickName) DOM.pickName.textContent = sc.name;
  if (DOM.pickSub) {
    DOM.pickSub.textContent = sc.custom
      ? `위도 ${sc.lat.toFixed(4)}, 경도 ${sc.lon.toFixed(4)} (사용자 지정 위치)`
      : `${sc.gu} · ${LV[sc.lv] || sc.lv}` + (sc.ap ? ' · 대략 위치' : '');
  }

  // 2) 반경 세그먼트 버튼 상태 갱신
  if (DOM.seg) {
    DOM.seg.querySelectorAll('button[data-r]').forEach(btn => {
      btn.setAttribute('aria-pressed', Number(btn.dataset.r) === S.r ? 'true' : 'false');
    });
  }

  // 3) 거리 계산 및 정렬
  allFacilitiesWithDist = D.res.map(r => ({
    ...r,
    m: distMeters(sc, r)
  })).sort((a, b) => a.m - b.m);

  const inRadius = allFacilitiesWithDist.filter(r => r.m <= S.r);

  // 4) 카테고리별 건수 뱃지 갱신
  if (DOM.cats) {
    DOM.cats.querySelectorAll('.cat').forEach(btn => {
      const c = btn.dataset.c;
      btn.setAttribute('aria-pressed', S.cats.has(c) ? 'true' : 'false');
      const countEl = btn.querySelector('.n');
      if (countEl) countEl.textContent = String(inRadius.filter(r => r.cat === c).length);
    });
  }

  // 활성 카테고리 필터링
  currentFacilities = inRadius.filter(r => S.cats.has(r.cat));

  // 5) 결과 요약 문구 표출
  if (DOM.sumText) {
    const offCats = CATS.length - S.cats.size;
    DOM.sumText.innerHTML = `<em>${sc.name}</em> 반경 ${fmtDist(S.r)} 안에 기관 <em>${currentFacilities.length}곳</em>` +
      (offCats > 0 ? ` <span style="font-weight:500;color:var(--muted);font-size:14px">(분류 ${offCats}개 숨김)</span>` : '');
  }

  // 6) 결과 목록 HTML 생성
  if (DOM.list) {
    DOM.list.innerHTML = '';

    if (!currentFacilities.length) {
      const nearest = allFacilitiesWithDist.filter(r => S.cats.has(r.cat))[0];
      DOM.list.innerHTML = `
        <div class="empty">
          이 범위 안에는 기관이 없어요.
          ${nearest ? `<br>가장 가까운 곳은 <b>${nearest.name}</b> (${fmtDist(nearest.m)})이에요. 범위를 넓혀 보세요.` : ''}
        </div>
      `;
    } else {
      currentFacilities.forEach(r => {
        const itemEl = document.createElement('div');
        const key = facilityKey(r);
        const isSel = S.sel && facilityKey(S.sel) === key;
        itemEl.className = 'item' + (isSel ? ' on' : '');
        itemEl.tabIndex = 0;
        itemEl.dataset.key = key;
        itemEl.setAttribute('role', 'button');
        itemEl.setAttribute('aria-label', `${r.name}, ${fmtDist(r.m)}`);

        // 복합 입주 건물 감지
        const siblings = getBuildingSiblings(D.res, r);
        const multiBuildingBadge = siblings.length > 1
          ? `<span class="tag" style="color:var(--accent)" title="동일 건물에 다른 도움 기관 ${siblings.length}곳 입주">🏢 복합건물</span>`
          : '';

        // 영도구↔내륙 간 항만 횡단 우회 감지
        const crossesHarbor = Boolean(
          (sc.gu === '영도구' && r.gu && r.gu !== '영도구') ||
          (sc.gu && sc.gu !== '영도구' && r.gu === '영도구')
        );
        const harborBadge = crossesHarbor
          ? `<span class="tag" style="color:var(--focus)" title="영도구↔내륙 간 항만 횡단 (영도·남항대교 우회 필요)">🌊 대교우회</span>`
          : '';

        const approxBadge = r.ap
          ? `<span class="tag" style="color:var(--muted)" title="정확한 상세주소 미확인 (대략 위치 표출)">대략 위치</span>`
          : '';

        const phoneMarkup = (r.ph && r.ph !== '-')
          ? `
            <a class="call" href="tel:${r.ph.replace(/[^0-9]/g, '')}" target="_top" aria-label="${r.name}에 전화 걸기">
              <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z" fill="currentColor"/></svg>
              <span class="ph">${r.ph}</span>
            </a>
            <button class="copy" type="button" data-ph="${r.ph}" aria-label="전화번호 복사">번호 복사</button>
          `
          : `<span class="addr">전화번호 없음</span>`;

        itemEl.innerHTML = `
          ${renderCatIcon(r.cat, 30)}
          <div class="t">
            ${r.name}
            <span class="gu" style="background:var(${GUVAR[r.gu] || '--accent'})">${r.gu} ${r.no}</span>
            ${multiBuildingBadge}
            ${harborBadge}
          </div>
          <div class="dist">
            ${fmtDist(r.m)}
            <small>도보 약 ${flatWalkMinutes(r.m)}분</small>
          </div>
          <div class="d">${CATL[r.cat] || ''} · ${r.desc || ''}</div>
          <div class="meta">
            ${phoneMarkup}
            <span class="addr">${r.addr || ''}</span>
            ${approxBadge}
          </div>
        `;

        // 마우스 호버 시 3D 포물선 아크 및 건물 프리즘 실시간 발광
        itemEl.addEventListener('mouseenter', () => {
          S.hov = r;
          mapEngine?.updateState({ hoveredFacility: S.hov });
        });
        itemEl.addEventListener('mouseleave', () => {
          if (S.hov && facilityKey(S.hov) === key) {
            S.hov = null;
            mapEngine?.updateState({ hoveredFacility: null });
          }
        });

        // 클릭 및 키보드 선택
        itemEl.addEventListener('click', (e) => {
          if (e.target.closest('.copy, .call')) return;
          selectFacility(r, false);
        });
        itemEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            if (e.target.closest('.copy, .call')) return;
            e.preventDefault();
            selectFacility(r, false);
          }
        });

        DOM.list.appendChild(itemEl);
      });

      // 개별 전화번호 복사 버튼 이벤트 바인딩
      DOM.list.querySelectorAll('.copy').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const ph = btn.dataset.ph;
          if (ph) copyToClipboard(ph, `${ph} 복사했어요`);
        });
      });
    }
  }

  // 7) 3D 지도 엔진 상태 동기화
  mapEngine?.updateState({
    school: S.school,
    radius: S.r,
    facilities: currentFacilities,
    selectedFacility: S.sel,
    hoveredFacility: S.hov,
    picking: S.picking
  });
}

// 전체 목록 복사 버튼
if (DOM.copyAll) {
  DOM.copyAll.addEventListener('click', () => {
    if (!S.school) return;
    const lines = [`[${S.school.name}] 반경 ${fmtDist(S.r)} 안 도움 기관 ${currentFacilities.length}곳 (직선거리 순)`];
    currentFacilities.forEach((r, idx) => {
      lines.push(`${idx + 1}. ${r.name} (${CATL[r.cat]}) ${fmtDist(r.m)} · ${r.ph || '-'} · ${r.addr}`);
    });
    lines.push('출처: 2026 학생맞춤통합지원 복지 서비스별 자원 목록(부산서부교육지원청)');
    copyToClipboard(lines.join('\n'), `${currentFacilities.length}곳 목록을 복사했어요`);
  });
}

/* ==========================================================================
   9. HUD Navigation Buttons
   ========================================================================== */

/**
 * HUD 360° 오빗 버튼 상태 동기화
 * @param {boolean} isOrbiting
 */
function updateOrbitHud(isOrbiting) {
  if (DOM.orbitHudBtn) {
    DOM.orbitHudBtn.setAttribute('aria-pressed', isOrbiting ? 'true' : 'false');
    DOM.orbitHudBtn.classList.toggle('is-orbiting', isOrbiting);
    const spinIcon = DOM.orbitHudBtn.querySelector('.hud-spin-icon');
    if (spinIcon) spinIcon.classList.toggle('is-spinning', isOrbiting);
  }
}

if (DOM.zIn) DOM.zIn.addEventListener('click', () => mapEngine?.zoomBy(1));
if (DOM.zOut) DOM.zOut.addEventListener('click', () => mapEngine?.zoomBy(-1));
if (DOM.tiltBtn) DOM.tiltBtn.addEventListener('click', () => mapEngine?.resetNorthTilt());

if (DOM.orbitHudBtn) {
  DOM.orbitHudBtn.addEventListener('click', () => {
    mapEngine?.toggleOrbit(S.sel || S.school);
  });
}

if (DOM.fitBtn) {
  DOM.fitBtn.addEventListener('click', () => {
    mapEngine?.stopOrbit();
    mapEngine?.flyToSchool(S.school, S.r);
  });
}

if (DOM.allBtn) {
  DOM.allBtn.addEventListener('click', () => {
    mapEngine?.stopOrbit();
    mapEngine?.fitAllDistricts();
  });
}

/* ==========================================================================
   10. InspectorPanel & Map3DEngine Instantiation & Lifecycle
   ========================================================================== */

inspectorPanel = new InspectorPanel({
  container: DOM.inspectorHost,
  onClose: () => {
    S.sel = null;
    mapEngine?.stopOrbit();
    mapEngine?.updateState({ selectedFacility: null });
    inspectorPanel.render({ school: S.school, facility: null });
    updateListSelection();
  },
  onSelectFacility: (fac, fromMap) => {
    selectFacility(fac, fromMap);
  },
  onToggleOrbit: () => {
    mapEngine?.toggleOrbit(S.sel || S.school);
  },
  onCopyPhone: (ph) => {
    copyToClipboard(ph, `${ph} 복사했어요`);
  }
});

mapEngine = new Map3DEngine({
  container: 'map',
  onSelectFacility: (fac) => {
    selectFacility(fac, true);
  },
  onHoverFacility: (fac) => {
    S.hov = fac;
    mapEngine.updateState({ hoveredFacility: S.hov });
  },
  onPickLocation: ({ lat, lon }) => {
    setPicking(false);
    setSchool({
      name: '지도에서 고른 위치',
      gu: '',
      lv: '',
      lat,
      lon,
      custom: true
    });
  },
  onOrbitChange: (isOrbiting) => {
    updateOrbitHud(isOrbiting);
    if (S.sel) refreshInspector();
  },
  onTerrainReady: () => {
    if (S.sel) refreshInspector();
  }
});

/**
 * 3D 지도 엔진 비동기 초기화 루틴
 */
async function initApplication() {
  // 1차 동기 렌더링: 지도 타일 로딩 전에도 좌측 검색 UI와 기관 목록 즉시 표시
  render();

  try {
    await mapEngine.init({
      initialSchool: S.school,
      initialRadius: S.r,
      theme: S.theme,
      viewMode: S.viewMode
    });

    if (DOM.mapLoading) {
      DOM.mapLoading.classList.add('is-hidden');
      DOM.mapLoading.hidden = true;
    }

    // 지도 타일 유휴(idle) 시점마다 고도 타일 데이터가 갱신되었으면 인스펙터 자동 업데이트
    mapEngine.map?.on('idle', () => {
      if (S.sel) {
        refreshInspector();
      }
    });

    // 맵 로드 완료 후 3D 레이어 및 토템 핀 전체 동기화
    render();
  } catch (err) {
    console.error('[STIS App] 3D Map Engine WebGL initialization failed:', err);
    if (DOM.mapLoading) {
      DOM.mapLoading.innerHTML = `
        <span style="font-size:16px;">⚠️</span>
        <span>WebGL 3D 가속 초기화 실패. 좌측 목록 검색 기능은 정상 이용 가능합니다.</span>
      `;
      DOM.mapLoading.classList.remove('is-hidden');
      DOM.mapLoading.hidden = false;
    }
  }
}

// 애플리케이션 시작
initApplication();
