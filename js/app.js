/* OhMyGlobalMap — карта для ВПИ-сервера.
 * Стороны → страны → территории, которые передаются рисованием от руки. Эпохи, стили карты, города, флаги.
 * Данные: Natural Earth (сегодня), CShapes 2.0 (1900–2019), historical-basemaps (до 1900). */
(() => {
  'use strict';

  const STORE_KEY = 'omgm.v1';
  const PREFS_KEY = 'omgm.prefs';
  const PALETTE = ['#d97757', '#6a9bcc', '#788c5d', '#b07aa1', '#c9a227', '#4e9a9a', '#c25b5b', '#8b7ec8', '#9a8c6c', '#5b8a72'];

  const BM_YEARS = [-1000, -500, -323, 100, 300, 500, 800, 1000, 1200, 1300, 1400, 1600, 1700, 1783, 1815, 1880];
  const ERAS = [
    ...BM_YEARS.map((y) => ({ id: String(y), year: y, kind: 'bm', label: y < 0 ? `${-y} до н. э.` : String(y) })),
    ...Array.from({ length: 120 }, (_, i) => ({ id: 'c' + (1900 + i), year: 1900 + i, kind: 'cs', label: String(1900 + i) })),
    { id: 'now', year: 2026, kind: 'now', label: '2026' },
  ];
  const eraIndex = (id) => Math.max(0, ERAS.findIndex((e) => e.id === id));
  const ERA_NOTE = { bm: 'исторические границы · приблизительно', cs: 'CShapes 2.0 · границы на 1 января', now: 'современные границы' };
  const STATUS_RU = { c: 'колония', p: 'протекторат', o: 'оккупация', m: 'мандат' };

  const MAP_STYLES = {
    dark: { label: 'Тёмная', theme: 'dark', layers: [], backdrop: '#242321',
      neutral: { color: '#46453f', weight: 0.7, opacity: 1, fillColor: '#2d2c29', fillOpacity: 1 },
      hover: { fillColor: '#3b3a36', color: '#5a5952', weight: 1 }, region: { fill: 0.74, line: 0.55 } },
    relief: { label: 'Рельеф', theme: 'dark',
      layers: [
        { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', opt: { maxNativeZoom: 16 }, attr: 'Основа: Esri' },
        { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}', opt: { maxNativeZoom: 15, className: 'hillshade', opacity: 0.8 }, attr: 'Рельеф: Esri' },
      ],
      neutral: { color: '#d8d4c6', weight: 0.7, opacity: 0.42, fillColor: '#fff', fillOpacity: 0.001 },
      hover: { fillColor: '#fff', fillOpacity: 0.1, weight: 1, opacity: 0.75 }, region: { fill: 0.58, line: 0.8 } },
    sat: { label: 'Спутник', theme: 'dark',
      layers: [{ url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', opt: { maxNativeZoom: 17 }, attr: 'Снимки: Esri, Maxar, Earthstar Geographics' }],
      neutral: { color: '#ffffff', weight: 0.8, opacity: 0.5, fillColor: '#fff', fillOpacity: 0.001 },
      hover: { fillColor: '#fff', fillOpacity: 0.2, weight: 1.2, opacity: 0.8 }, region: { fill: 0.55, line: 0.85 } },
  };

  const DEFAULT_PREFS = { style: 'dark', era: 'now', rough: 40, tool: 'line', fill: 'color', fold: { panel: false, timeline: false }, cities: { show: true, labels: true, caps: false, density: 40, size: 100 } };
  let P = JSON.parse(JSON.stringify(DEFAULT_PREFS));

  // ---------- helpers ----------
  const $ = (s) => document.querySelector(s);
  const uid = () => Math.random().toString(36).slice(2, 9);

  const h = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'style') e.style.cssText = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
    return e;
  };

  const ICONS = {
    chev: 'M9 6l6 6-6 6',
    trash: 'M5 7h14M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3',
    give: 'M4 12h14M13 6l6 6-6 6M4 5v14',
    brush: 'M18.4 2.6l3 3-9.6 9.6-3-3 9.6-9.6zM8.8 12.2c-2 0-3.300 1.400-3.300 3.300 0 1.400-.8 2.500-2 3.100 3.800 1 7.800-.4 7.800-3.600l-2.500-2.800z',
    bucket: 'M5 11l7-7 7 7-7 7-7-7zM3 21h6M19 14c1.500 1.800 2 3 2 4a2 2 0 11-4 0c0-1 .5-2.200 2-4z',
  };
  const icon = (n, s = 14) => {
    const w = document.createElement('span');
    w.style.display = 'inline-grid';
    w.innerHTML = `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${ICONS[n]}"/></svg>`;
    return w;
  };

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 2800);
  }

  // ---------- геометрия ----------
  const pc = window.polygonClipping;
  const toMulti = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);
  const asGeom = (mp) => ({ type: 'MultiPolygon', coordinates: mp });
  function bbox(mp) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const poly of mp) for (const [x, y] of poly[0]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return [x0, y0, x1, y1];
  }
  const bbHit = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

  function inRing(r, x, y) {
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      if ((r[i][1] > y) !== (r[j][1] > y) && x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
    }
    return c;
  }
  const inMulti = (mp, x, y) => mp.some((poly) => inRing(poly[0], x, y) && !poly.slice(1).some((hole) => inRing(hole, x, y)));

  // центр самого крупного куска (для подписей)
  function labelPoint(geom) {
    let best = null, bestA = -1;
    for (const p of toMulti(geom)) {
      const r = p[0]; let a = 0, cx = 0, cy = 0;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const f = r[j][0] * r[i][1] - r[i][0] * r[j][1];
        a += f; cx += (r[j][0] + r[i][0]) * f; cy += (r[j][1] + r[i][1]) * f;
      }
      const area = Math.abs(a / 2);
      if (area > bestA) { bestA = area; best = a ? [cx / (3 * a), cy / (3 * a)] : r[0]; }
    }
    return L.latLng(best[1], best[0]);
  }

  // Полигоны, пересекающие 180-й меридиан, в части данных замыкаются прыжком через весь мир:
  // разворачиваем долготы и режем по меридиану на два куска.
  const WORLD_E = [[[[-180, -90], [180, -90], [180, 90], [-180, 90], [-180, -90]]]];
  const WORLD_W = [[[[180, -90], [540, -90], [540, 90], [180, 90], [180, -90]]]];
  function fixAntimeridian(geom) {
    const out = [];
    let touched = false;
    for (const poly of toMulti(geom)) {
      const jumps = poly.some((ring) => ring.some((p, i) => i && Math.abs(p[0] - ring[i - 1][0]) > 180));
      if (!jumps) { out.push(poly); continue; }
      touched = true;
      const un = poly.map((ring) => ring.map(([x, y]) => [x < 0 ? x + 360 : x, y]));
      out.push(...pc.intersection([un], WORLD_E));
      for (const west of pc.intersection([un], WORLD_W)) out.push(west.map((ring) => ring.map(([x, y]) => [x - 360, y])));
    }
    return touched ? asGeom(out) : geom;
  }

  // ---------- «живая» линия ----------
  // Смещение середины отрезка с затуханием — как у береговой линии или реки.
  function wobble(a, b, amp, depth, out) {
    if (depth === 0) return;
    const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
    if (len < 1e-5) return;
    const off = (Math.random() * 2 - 1) * amp * len;
    const m = [(a[0] + b[0]) / 2 - (dy / len) * off, (a[1] + b[1]) / 2 + (dx / len) * off];
    wobble(a, m, amp * 0.72, depth - 1, out);
    out.push(m);
    wobble(m, b, amp * 0.72, depth - 1, out);
  }
  function roughen(ring, amp) {
    if (amp <= 0) return ring;
    const out = [];
    for (let i = 0; i < ring.length; i++) {
      out.push(ring[i]);
      wobble(ring[i], ring[(i + 1) % ring.length], amp, 3, out);
    }
    return out;
  }
  function smooth(ring) { // проход Чайкина — убирает острые «зубцы»
    const out = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    return out;
  }

  const roughenOpen = (pts, amp) => {
    if (amp <= 0 || pts.length < 2) return pts;
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) { out.push(pts[i]); wobble(pts[i], pts[i + 1], amp, 3, out); }
    out.push(pts[pts.length - 1]);
    return out;
  };
  const smoothOpen = (pts) => {
    if (pts.length < 3) return pts;
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    out.push(pts[pts.length - 1]);
    return out;
  };

  // ---------- данные ----------
  const eraData = {};            // id -> {list:[{key,name,sub,flag,geometry,named,mp,bb}], byKey:Map}
  let modernTopo = null, csTopo = null, csFeats = null, histRu = {}, ruByEng = {}, gwA2 = {}, flagSet = new Set(), cities = [];

  const STABLE_FLAG = new Set([2, 200, 220, 210, 225, 380, 385, 390, 740, 160, 155]);
  function csFlag(gw, status, year) {
    if (gw === 365) return year < 1917 ? 'ru-imp' : year >= 1922 && year <= 1991 ? 'su' : year >= 1992 ? 'ru' : null;
    if (gw === 255) return year <= 1918 ? 'de-imp' : year <= 1932 ? 'de' : null;
    if (gw === 260) return 'de';
    if (gw === 345) return year >= 1946 && year <= 1991 ? 'yu' : null;
    if (gw === 315) return 'cs';
    if (gw === 640) return 'tr';
    const a2 = gwA2[gw];
    if (!a2 || !flagSet.has(a2)) return null;
    return status === 'i' && (year >= 1990 || STABLE_FLAG.has(gw)) ? a2 : null;
  }

  async function loadEra(id) {
    if (eraData[id]) return eraData[id];
    const kind = ERAS[eraIndex(id)].kind;
    const list = [];
    if (kind === 'now') {
      for (const f of topojson.feature(modernTopo, modernTopo.objects.countries).features) {
        const p = f.properties;
        ruByEng[p.n] = p.r;
        list.push({ key: p.k, name: p.r, flag: p.a && flagSet.has(p.a) ? p.a : null, geometry: f.geometry, named: true });
      }
    } else if (kind === 'cs') {
      if (!csFeats) {
        csTopo = await fetch('data/cshapes.json').then((r) => r.json());
        csFeats = topojson.feature(csTopo, csTopo.objects.shapes).features.map((f) => ({ ...f.properties, geometry: fixAntimeridian(f.geometry) }));
      }
      const year = ERAS[eraIndex(id)].year, d = year * 10000 + 101;
      const used = new Set(), byGw = new Map();
      csFeats.forEach((f, i) => {
        if (f.s > d || f.e < d) return;
        const key = used.has(String(f.g)) ? `${f.g}#${i}` : String(f.g);
        used.add(key);
        const e = { key, name: histRu[f.n] || ruByEng[f.n] || f.n, flag: csFlag(f.g, f.t, year), geometry: f.geometry, named: true, gw: f.g, owner: f.o, status: f.t };
        byGw.set(f.g, e); list.push(e);
      });
      for (const e of list) if (e.status !== 'i' && STATUS_RU[e.status]) {
        const o = byGw.get(e.owner);
        e.sub = STATUS_RU[e.status] + (o && o !== e ? ` · ${o.name}` : '');
      }
    } else {
      const res = await fetch(`data/eras/${id}.json`);
      if (!res.ok) throw new Error('era ' + id);
      const used = new Set();
      (await res.json()).features.forEach((f, i) => {
        const eng = f.properties.NAME;
        let key = null, name = '';
        if (eng) { key = used.has(eng) ? `${eng}#${i}` : eng; used.add(key); name = histRu[eng] || ruByEng[eng] || eng; }
        list.push({ key, name, flag: null, geometry: fixAntimeridian(f.geometry), named: !!eng });
      });
    }
    const byKey = new Map();
    for (const e of list) { e.mp = toMulti(e.geometry); e.bb = bbox(e.mp); if (e.key != null) byKey.set(e.key, e); }
    return (eraData[id] = { list, byKey });
  }

  // ---------- state ----------
  /** side: {id,name,color,regions:[{id,name,era,code|null,geometry,edited}]} */
  let state = { sides: [] };
  const ui = { open: new Set(), mode: null };
  let cur = 'now';
  const history = [];

  const sideById = (id) => state.sides.find((s) => s.id === id);
  const findRegion = (rid) => {
    for (const s of state.sides) { const r = s.regions.find((x) => x.id === rid); if (r) return { side: s, region: r }; }
    return null;
  };
  const findByCode = (code) => {
    for (const s of state.sides) { const r = s.regions.find((x) => x.era === cur && x.code === code); if (r) return { side: s, region: r }; }
    return null;
  };
  const eraRegions = () => state.sides.flatMap((s) => s.regions.filter((r) => r.era === cur).map((r) => ({ side: s, region: r })));
  const entryOf = (region) => (eraData[region.era] ? eraData[region.era].byKey.get(region.code) : null);

  function serialize() {
    return {
      v: 3,
      sides: state.sides.map((s) => ({
        id: s.id, name: s.name, color: s.color,
        regions: s.regions.map((r) => ({
          id: r.id, name: r.name, era: r.era, code: r.code,
          // оригинальную геометрию не храним — только то, что нарисовано или изменено
          ...(r.edited || !r.code ? { geometry: r.geometry, edited: true } : {}),
        })),
      })),
    };
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(serialize())); }
    catch (e) { toast('Не удалось сохранить в браузере — сделай экспорт'); }
  }
  function savePrefs() {
    P.era = cur;
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(P)); } catch (e) { /* без настроек */ }
  }
  function hydrate(raw) {
    const sides = [];
    for (const s of raw.sides || []) {
      const regions = (s.regions || []).map((r) => ({
        id: r.id || uid(), name: r.name || 'Территория', era: r.era || 'now', code: r.code || null,
        geometry: r.geometry || null, edited: !!r.geometry && !!r.edited,
      })).filter((r) => r.geometry || r.code);
      sides.push({ id: s.id || uid(), name: s.name || 'Сторона', color: s.color || PALETTE[0], regions });
    }
    return { sides };
  }
  function load() {
    try { const raw = localStorage.getItem(STORE_KEY); if (raw) state = hydrate(JSON.parse(raw)); } catch (e) { /* пустое состояние */ }
  }

  // отмена
  const undoBtn = $('#undoBtn');
  function snapshot() {
    history.push(JSON.stringify(serialize()));
    if (history.length > 40) history.shift();
    undoBtn.disabled = false;
  }
  function undo() {
    const snap = history.pop();
    undoBtn.disabled = history.length === 0;
    if (!snap) { toast('Нечего отменять'); return; }
    state = hydrate(JSON.parse(snap));
    save(); rebuildRegions(); renderSides();
    if (ui.mode) renderBanner();
    toast('Отменено');
  }
  undoBtn.disabled = true;
  undoBtn.addEventListener('click', undo);

  // ---------- map ----------
  const map = L.map('map', {
    zoomControl: false, minZoom: 2, maxZoom: 10, zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 90,
    maxBounds: [[-62, -200], [88, 200]], maxBoundsViscosity: 0.85, worldCopyJump: false,
  });
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  map.attributionControl.setPrefix(false);
  map.attributionControl.addAttribution('Natural Earth · CShapes 2.0 (CC BY-NC-SA) · historical-basemaps');
  map.createPane('backdrop').style.zIndex = 250;
  map.createPane('neutral').style.zIndex = 300;
  map.createPane('regions').style.zIndex = 400;
  map.createPane('cities').style.zIndex = 450;
  map.createPane('draw').style.zIndex = 500;
  map.getPane('cities').style.pointerEvents = 'none';
  map.fitBounds([[-50, -150], [78, 170]]);

  const backdropGroup = L.featureGroup().addTo(map);
  const neutralGroup = L.featureGroup().addTo(map);
  const regionsGroup = L.featureGroup().addTo(map);
  const labelsGroup = L.layerGroup().addTo(map);
  const layerByRid = new Map();
  const neutralCanvas = L.canvas({ pane: 'neutral' });
  const backdropCanvas = L.canvas({ pane: 'backdrop' });
  const svgR = L.svg({ pane: 'regions' }).addTo(map);
  const S = () => MAP_STYLES[P.style];

  // флаги как заливка: SVG-паттерны
  const NS = 'http://www.w3.org/2000/svg';
  const defs = document.createElementNS(NS, 'defs');
  svgR._container.prepend(defs);
  const patterns = new Set();
  function flagFill(id) {
    if (!patterns.has(id)) {
      const p = document.createElementNS(NS, 'pattern');
      p.id = 'fl-' + id;
      for (const [k, v] of Object.entries({ patternUnits: 'objectBoundingBox', patternContentUnits: 'objectBoundingBox', width: '1', height: '1' })) p.setAttribute(k, v);
      const im = document.createElementNS(NS, 'image');
      for (const [k, v] of Object.entries({ href: `flags/${id}.svg`, width: '1', height: '1', preserveAspectRatio: 'none' })) im.setAttribute(k, v);
      p.append(im); defs.append(p); patterns.add(id);
    }
    return `url(#fl-${id})`;
  }

  function neutralTip(e) {
    return h('div', {}, e.name, e.sub ? h('small', {}, e.sub) : null);
  }

  function rebuildNeutral() {
    neutralGroup.clearLayers(); backdropGroup.clearLayers();
    const data = eraData[cur];
    if (ERAS[eraIndex(cur)].kind === 'cs' && S().backdrop && eraData.now) {
      for (const e of eraData.now.list) {
        backdropGroup.addLayer(L.geoJSON({ type: 'Feature', geometry: e.geometry, properties: {} }, {
          pane: 'backdrop', renderer: backdropCanvas, interactive: false, style: () => ({ stroke: false, fillColor: S().backdrop, fillOpacity: 1 }),
        }));
      }
    }
    for (const e of data.list) {
      const l = L.geoJSON({ type: 'Feature', geometry: e.geometry, properties: {} }, {
        pane: 'neutral', renderer: neutralCanvas, style: () => S().neutral, interactive: e.named,
      });
      if (e.named) {
        l.bindTooltip(neutralTip(e), { sticky: true, className: 'hover-tip', direction: 'top', offset: [0, -6] });
        l.on('mouseover', () => { if (!ui.mode) l.setStyle(S().hover); });
        l.on('mouseout', () => l.setStyle(S().neutral));
        l.on('click', (ev) => onNeutralClick(e, ev));
      }
      neutralGroup.addLayer(l);
    }
  }

  function regionStyle(side, region, hover) {
    const r = S().region;
    const en = P.fill === 'flag' ? entryOf(region) : null;
    const flag = en && en.flag;
    const fill = flag ? 0.94 : r.fill;
    return {
      color: '#ffffff', opacity: hover ? 1 : r.line, weight: hover ? 1.8 : 1.1, lineJoin: 'round',
      fillColor: flag ? flagFill(flag) : side.color, fillOpacity: Math.min(1, hover ? fill + 0.1 : fill),
    };
  }

  function rebuildRegions() {
    regionsGroup.clearLayers(); labelsGroup.clearLayers(); layerByRid.clear();
    const data = eraData[cur];
    for (const { side, region } of eraRegions()) {
      if (!region.geometry) {
        const e = data.byKey.get(region.code);
        if (!e) continue;
        region.geometry = e.geometry;
      }
      const layer = L.geoJSON({ type: 'Feature', geometry: region.geometry, properties: {} }, { pane: 'regions', renderer: svgR, style: () => regionStyle(side, region) }).getLayers()[0];
      layer.on('mouseover', () => { if (!ui.mode) layer.setStyle(regionStyle(side, region, true)); });
      layer.on('mouseout', () => layer.setStyle(regionStyle(side, region)));
      layer.on('click', (e) => onRegionClick(region.id, e));
      regionsGroup.addLayer(layer);
      layerByRid.set(region.id, layer);
      labelsGroup.addLayer(L.tooltip({ permanent: true, direction: 'center', className: 'map-label', interactive: false })
        .setLatLng(labelPoint(region.geometry)).setContent(region.name));
    }
    updateLabelVisibility();
  }
  const updateLabelVisibility = () => map.getContainer().classList.toggle('labels-hidden', map.getZoom() < 3);
  map.on('zoomend', updateLabelVisibility);

  // ---------- города ----------
  const ZOOM_POP = { 2: 6e6, 3: 2.5e6, 4: 9e5, 5: 3e5, 6: 1.1e5, 7: 4e4, 8: 1.2e4 };
  const CityLayer = L.Layer.extend({
    onAdd(m) {
      this._c = L.DomUtil.create('canvas', 'city-canvas');
      m.getPane('cities').appendChild(this._c);
      m.on('moveend zoomend resize viewreset', this.redraw, this);
      this.redraw();
    },
    onRemove(m) { L.DomUtil.remove(this._c); m.off('moveend zoomend resize viewreset', this.redraw, this); },
    redraw() {
      const m = this._map, c = this._c;
      if (!m || !c) return;
      const sz = m.getSize(), dpr = window.devicePixelRatio || 1;
      c.width = sz.x * dpr; c.height = sz.y * dpr; c.style.width = sz.x + 'px'; c.style.height = sz.y + 'px';
      L.DomUtil.setPosition(c, m.containerPointToLayerPoint([0, 0]));
      const ctx = c.getContext('2d');
      ctx.scale(dpr, dpr);
      const o = P.cities;
      if (!o.show || !cities.length) return;
      const z = m.getZoom(), zi = Math.max(2, Math.min(9, Math.floor(z)));
      const factor = Math.pow(2, (50 - o.density) / 22);
      const thr = (ZOOM_POP[zi] || 0) * factor;
      const k = o.size / 100;
      ctx.font = `${Math.round(11 * k * 10) / 10}px ${getComputedStyle(document.body).fontFamily}`;
      ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      const used = [];
      const bounds = m.getBounds().pad(0.05);
      for (const [lon, lat, pop, flag, name] of cities) {
        if (o.caps ? !(flag === 1 && (z >= 3 || pop >= 3e6 * factor)) : !(pop >= thr || (flag === 1 && pop >= thr * 0.15))) continue;
        if (!bounds.contains([lat, lon])) continue;
        const p = m.latLngToContainerPoint([lat, lon]);
        const r = (flag === 1 ? 3.4 : 2.4) * k;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 6.2832);
        ctx.fillStyle = '#fff'; ctx.fill();
        ctx.lineWidth = flag === 1 ? 2 : 1.2; ctx.strokeStyle = flag === 1 ? '#d97757' : 'rgba(0,0,0,.65)'; ctx.stroke();
        if (!o.labels) continue;
        const w = ctx.measureText(name).width, x = p.x + r + 4, y = p.y;
        const box = [x - 2, y - 7 * k, x + w + 2, y + 7 * k];
        if (used.some((u) => box[0] < u[2] && box[2] > u[0] && box[1] < u[3] && box[3] > u[1])) continue;
        used.push(box);
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8,8,8,.78)'; ctx.strokeText(name, x, y);
        ctx.fillStyle = flag === 1 ? '#fff' : 'rgba(255,255,255,.92)'; ctx.fillText(name, x, y);
      }
    },
  });
  const cityLayer = new CityLayer().addTo(map);

  // ---------- стиль карты ----------
  let tileLayers = [], tileErrorShown = false;
  function setStyle(id, quiet) {
    P.style = id;
    const st = S();
    document.body.dataset.style = id;
    document.body.dataset.theme = st.theme;
    tileLayers.forEach((l) => map.removeLayer(l));
    tileLayers = st.layers.map((cfg) => {
      const l = L.tileLayer(cfg.url, { attribution: cfg.attr, maxZoom: 10, noWrap: true, keepBuffer: 4, ...cfg.opt }).addTo(map);
      l.on('tileerror', () => { if (!tileErrorShown) { tileErrorShown = true; toast('Не удалось загрузить подложку — проверь интернет'); } });
      return l;
    });
    if (eraData[cur]) { rebuildNeutral(); rebuildRegions(); }
    document.querySelectorAll('#styleBar button').forEach((b) => b.classList.toggle('on', b.dataset.id === id));
    if (!quiet) savePrefs();
  }
  $('#styleBar').replaceChildren(...Object.entries(MAP_STYLES).map(([id, s]) => h('button', { 'data-id': id, onclick: () => setStyle(id) }, s.label)));

  function setFill(mode, quiet) {
    P.fill = mode;
    document.querySelectorAll('#fillBar button').forEach((b) => b.classList.toggle('on', b.dataset.id === mode));
    if (eraData[cur]) rebuildRegions();
    if (!quiet) savePrefs();
  }
  $('#fillBar').replaceChildren(...[['color', 'Цвет'], ['flag', 'Флаг']].map(([id, l]) => h('button', { 'data-id': id, title: id === 'flag' ? 'Заливка флагом страны (где он известен)' : 'Заливка цветом стороны', onclick: () => setFill(id) }, l)));

  // настройки городов
  const cityPop = $('#cityPop');
  function syncCityUi() {
    const o = P.cities;
    $('#cShow').checked = o.show; $('#cLabels').checked = o.labels; $('#cCaps').checked = o.caps;
    $('#cDensity').value = o.density; $('#cSize').value = o.size;
    $('#citiesBtn').classList.toggle('on', o.show);
  }
  for (const [id, key, num] of [['#cShow', 'show'], ['#cLabels', 'labels'], ['#cCaps', 'caps'], ['#cDensity', 'density', 1], ['#cSize', 'size', 1]]) {
    $(id).addEventListener('input', (e) => { P.cities[key] = num ? +e.target.value : e.target.checked; syncCityUi(); cityLayer.redraw(); savePrefs(); });
  }
  $('#citiesBtn').addEventListener('click', (e) => { e.stopPropagation(); cityPop.hidden = !cityPop.hidden; });
  document.addEventListener('click', (e) => { if (!cityPop.hidden && !cityPop.contains(e.target) && !e.target.closest('#citiesBtn')) cityPop.hidden = true; });

  // панели сворачиваются вниз
  function setFold(which, on, quiet) {
    P.fold[which] = on;
    const el = which === 'panel' ? $('#panel') : $('#timeline');
    el.classList.toggle('collapsed', on);
    document.body.classList.toggle(which === 'panel' ? 'panel-collapsed' : 'tl-collapsed', on);
    if (!quiet) savePrefs();
  }
  $('#panelFold').addEventListener('click', (e) => { e.stopPropagation(); setFold('panel', !P.fold.panel); });
  document.querySelector('#panel .brand').addEventListener('click', (e) => { if (P.fold.panel && !e.target.closest('button')) setFold('panel', false); });
  $('#tlFold').addEventListener('click', () => setFold('timeline', !P.fold.timeline));

  // режим без интерфейса
  function setClean(on) {
    document.body.classList.toggle('clean', on);
    $('#cleanBack').hidden = !on;
    if (on) { endMode(); cityPop.hidden = true; map.closePopup(); }
  }
  $('#cleanBtn').addEventListener('click', () => setClean(true));
  $('#cleanBack').addEventListener('click', () => setClean(false));

  // ---------- эпохи ----------
  const eraRange = $('#eraRange'), eraYear = $('#eraYear'), eraNote = $('#eraNote');
  eraRange.max = ERAS.length - 1;
  let eraToken = 0, eraTimer;

  function showEraUi(id) {
    const i = eraIndex(id);
    eraRange.value = i;
    eraYear.value = ERAS[i].label;
    eraNote.textContent = ERA_NOTE[ERAS[i].kind];
    $('#eraPrev').disabled = i === 0;
    $('#eraNext').disabled = i === ERAS.length - 1;
  }
  async function setEra(id) {
    const token = ++eraToken;
    showEraUi(id);
    try {
      if (!eraData[id]) toast('Загружаю границы…');
      await loadEra(id);
    } catch (err) { console.error(err); toast('Не удалось загрузить эту эпоху'); showEraUi(cur); return; }
    if (token !== eraToken) return;
    endMode();
    map.closePopup();
    cur = id;
    rebuildNeutral();
    rebuildRegions();
    renderSides();
    savePrefs();
  }
  eraRange.addEventListener('input', () => {
    const e = ERAS[+eraRange.value];
    eraYear.value = e.label; eraNote.textContent = ERA_NOTE[e.kind];
    clearTimeout(eraTimer);
    eraTimer = setTimeout(() => setEra(e.id), 140);
  });
  const stepEra = (d) => { const i = Math.min(ERAS.length - 1, Math.max(0, eraIndex(cur) + d)); if (i !== eraIndex(cur)) setEra(ERAS[i].id); };
  $('#eraPrev').addEventListener('click', () => stepEra(-1));
  $('#eraNext').addEventListener('click', () => stepEra(1));
  eraYear.addEventListener('focus', () => eraYear.select());
  eraYear.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { showEraUi(cur); eraYear.blur(); }
    if (e.key !== 'Enter') return;
    const m = eraYear.value.match(/\d+/);
    eraYear.blur();
    if (!m) { showEraUi(cur); return; }
    const y = /до|bc|-/i.test(eraYear.value) ? -parseInt(m[0], 10) : parseInt(m[0], 10);
    const best = ERAS.reduce((a, b) => (Math.abs(b.year - y) < Math.abs(a.year - y) ? b : a));
    setEra(y >= 2020 ? 'now' : best.id);
  });
  eraYear.addEventListener('blur', () => showEraUi(cur));

  // ---------- режимы: paint / fill ----------
  const banner = $('#banner'), bannerText = $('#bannerText'), bannerTools = $('#bannerTools');

  function showBanner(text, tools) {
    bannerText.replaceChildren(...[].concat(text).map((n) => (n.nodeType ? n : document.createTextNode(n))));
    bannerTools.replaceChildren(...tools);
    banner.hidden = false;
  }

  function endMode() {
    const m = ui.mode;
    if (!m) return;
    if (m.cleanup) m.cleanup();
    ui.mode = null;
    banner.hidden = true;
    map.dragging.enable();
    map.getContainer().classList.remove('drawing');
    map.getContainer().style.cursor = '';
    rebuildRegions();
    renderSides();
  }
  function setMode(m) { endMode(); ui.mode = m; }

  function startMode(m) {
    const need = m.kind === 'give' ? 2 : 1;
    if (eraRegions().length < need) { toast('Добавь ещё хотя бы одну страну, чтобы передать ей территорию'); return; }
    setMode(m);
    map.closePopup();
    if (m.kind === 'fill') {
      map.getContainer().style.cursor = 'crosshair';
      map.on('click', onFillClick);
      m.cleanup = () => map.off('click', onFillClick);
    } else {
      map.dragging.disable();
      map.getContainer().classList.add('drawing');
      m.cleanup = attachFreehand();
    }
    renderBanner();
  }

  function renderBanner() {
    const m = ui.mode;
    if (!m) return;
    const tools = [];
    let text;
    if (m.kind === 'give') {
      const src = findRegion(m.source);
      const others = eraRegions().filter((x) => x.region.id !== m.source);
      if (!src || !others.length) { endMode(); return; }
      if (!others.some((x) => x.region.id === m.target)) m.target = others[0].region.id;
      text = P.tool === 'line'
        ? ['Проведи линию через «', h('b', {}, src.region.name), '» от границы до границы, затем кликни по части, которая перейдёт к:']
        : ['Обведи от руки участок «', h('b', {}, src.region.name), '» — он перейдёт к:'];
      tools.push(h('div', { class: 'seg' }, [['line', 'Линия'], ['loop', 'Обвести']].map(([id, label]) =>
        h('button', { class: P.tool === id ? 'on' : '', title: id === 'line' ? 'Разрезать страну линией и выбрать часть' : 'Обвести участок контуром', onclick: () => { P.tool = id; clearPending(); savePrefs(); renderBanner(); } }, label))));
      const sel = h('select', { onchange: () => { m.target = sel.value; refreshPending(); } });
      for (const s of state.sides) {
        const opts = others.filter((x) => x.side === s);
        if (opts.length) sel.append(h('optgroup', { label: s.name }, opts.map((x) => h('option', { value: x.region.id, selected: x.region.id === m.target }, x.region.name))));
      }
      tools.push(sel);
    } else {
      const t = findRegion(m.target);
      if (!t) { endMode(); return; }
      text = m.kind === 'fill'
        ? ['Кликай по странам и областям — они целиком отойдут к «', h('b', {}, t.region.name), '».']
        : ['Обведи любую землю — она отойдёт к «', h('b', {}, t.region.name), '», а у соседей отберётся.'];
    }
    if (m.kind !== 'fill') {
      const rough = h('input', { type: 'range', min: 0, max: 100, value: P.rough, title: 'Насколько неровной будет граница' });
      rough.addEventListener('input', () => { P.rough = +rough.value; savePrefs(); });
      tools.push(h('label', {}, 'Неровность', rough));
    }
    tools.push(h('span', { class: 'grow' }));
    tools.push(h('button', { class: 'btn', onclick: undo }, 'Отменить шаг'));
    tools.push(h('button', { class: 'btn primary', onclick: endMode }, 'Готово'));
    showBanner(text, tools);
  }

  // рисование от руки поверх карты
  function attachFreehand() {
    const c = map.getContainer();
    let pts = null, line = null, closer = null;
    const down = (e) => {
      if ((e.pointerType === 'mouse' && e.button !== 0) || e.target.closest('.leaflet-control, .leaflet-popup, .pick-piece')) return;
      try { c.setPointerCapture(e.pointerId); } catch (err) { /* не критично */ }
      clearPending();
      pts = [map.mouseEventToLatLng(e)];
      line = L.polyline(pts, { pane: 'draw', color: '#fff', weight: 3, opacity: 0.95, interactive: false, lineCap: 'round', lineJoin: 'round' }).addTo(map);
      closer = L.polyline([], { pane: 'draw', color: '#fff', weight: 1.5, dashArray: '3 7', opacity: 0.7, interactive: false }).addTo(map);
      e.preventDefault();
    };
    const move = (e) => {
      if (!pts) return;
      const ll = map.mouseEventToLatLng(e);
      if (map.latLngToContainerPoint(ll).distanceTo(map.latLngToContainerPoint(pts[pts.length - 1])) < 2.5) return;
      pts.push(ll);
      line.setLatLngs(pts);
      closer.setLatLngs([pts[pts.length - 1], pts[0]]);
    };
    const up = () => {
      if (!pts) return;
      const done = pts; pts = null;
      map.removeLayer(line); map.removeLayer(closer); line = closer = null;
      finishStroke(done);
    };
    c.addEventListener('pointerdown', down); c.addEventListener('pointermove', move);
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    return () => {
      c.removeEventListener('pointerdown', down); c.removeEventListener('pointermove', move);
      c.removeEventListener('pointerup', up); c.removeEventListener('pointercancel', up);
      if (line) { map.removeLayer(line); map.removeLayer(closer); }
      clearPending();
    };
  }

  // Прилипание: точки контура рядом с существующей границей садятся на неё, чтобы не оставалось щелей и «заусенцев».
  function snapRing(ring) {
    const tol = 6, z = map.getZoom();
    const pad = (tol * 360) / (256 * Math.pow(2, z)) * 1.5;
    const rb = bbox([[ring]]);
    const box = [rb[0] - pad, rb[1] - pad, rb[2] + pad, rb[3] + pad];
    const cand = [];
    const take = (mp) => {
      for (const poly of mp) for (const r of poly) for (const p of r) if (p[0] >= box[0] && p[0] <= box[2] && p[1] >= box[1] && p[1] <= box[3]) cand.push(p);
    };
    for (const e of eraData[cur].list) if (bbHit(e.bb, box)) take(e.mp);
    for (const { region } of eraRegions()) if (region.edited && region.geometry) take(toMulti(region.geometry));
    if (!cand.length || cand.length > 120000) return ring;
    const grid = new Map(), cell = tol;
    const px = (p) => map.latLngToContainerPoint([p[1], p[0]]);
    for (const p of cand) {
      const q = px(p), key = Math.floor(q.x / cell) + ',' + Math.floor(q.y / cell);
      (grid.get(key) || grid.set(key, []).get(key)).push([p, q]);
    }
    return ring.map((p) => {
      const q = px(p), cx = Math.floor(q.x / cell), cy = Math.floor(q.y / cell);
      let best = null, bd = tol * tol;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        for (const [pp, qq] of grid.get(cx + dx + ',' + (cy + dy)) || []) {
          const d = (qq.x - q.x) ** 2 + (qq.y - q.y) ** 2;
          if (d < bd) { bd = d; best = pp; }
        }
      }
      return best || p;
    });
  }

  // --- разрез линией: проводим линию, страна делится на две части, кликом выбираем, какую передать ---
  function clearPending() {
    const m = ui.mode;
    if (m && m.pending) { m.pending.layers.forEach((l) => map.removeLayer(l)); m.pending = null; }
  }
  function refreshPending() {
    const m = ui.mode;
    if (!m || !m.pending) return;
    const pieces = m.pending.pieces;
    clearPending();
    showPieces(pieces);
  }
  function showPieces(pieces) {
    const m = ui.mode;
    const src = findRegion(m.source), target = findRegion(m.target);
    if (!src || !target) return;
    const layers = pieces.map((piece) => {
      const base = { color: '#ffffff', weight: 2, dashArray: '5 4', opacity: 0.95, fillColor: '#ffffff', fillOpacity: 0.16, className: 'pick-piece' };
      const l = L.geoJSON({ type: 'Feature', geometry: asGeom(piece), properties: {} }, { pane: 'draw', style: () => base }).addTo(map);
      l.bindTooltip(`Передать эту часть → ${target.region.name}`, { sticky: true, className: 'hover-tip', direction: 'top', offset: [0, -4] });
      l.on('mouseover', () => l.setStyle({ fillColor: target.side.color, fillOpacity: 0.78, dashArray: null }));
      l.on('mouseout', () => l.setStyle(base));
      l.on('click', (ev) => {
        L.DomEvent.stopPropagation(ev);
        const cur2 = findRegion(m.target);
        clearPending();
        try { commit(cur2, piece, [findRegion(m.source)], `Передано: ${src.region.name} → ${cur2.region.name}`); }
        catch (err) { console.error(err); toast('Не получилось передать эту часть'); }
      });
      return l;
    });
    m.pending = { layers, pieces };
  }

  function finishLine(latlngs) {
    const m = ui.mode, src = findRegion(m.source);
    if (!src) return;
    if (latlngs.length < 3) { toast('Проведи линию подлиннее — зажми кнопку и веди'); return; }
    const px = latlngs.map((l) => map.latLngToLayerPoint(l));
    const simple = L.LineUtil.simplify(px, 2).map((p) => map.layerPointToLatLng(p));
    let pts = simple.map((l) => [l.lng, l.lat]);
    pts = smoothOpen(roughenOpen(pts, (P.rough / 100) * 0.5));
    // продлеваем концы далеко за пределы страны — разрез проходит сквозь неё целиком
    const D = 40, unit = (a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], n = Math.hypot(dx, dy) || 1; return [dx / n, dy / n]; };
    const u0 = unit(pts[1], pts[0]), u1 = unit(pts[pts.length - 2], pts[pts.length - 1]);
    const e0 = [pts[0][0] + u0[0] * D, pts[0][1] + u0[1] * D], e1 = [pts[pts.length - 1][0] + u1[0] * D, pts[pts.length - 1][1] + u1[1] * D];
    const line = [e0, ...pts, e1];
    const n0 = unit(line[0], line[1]), n1 = unit(line[line.length - 2], line[line.length - 1]);
    // «левая» сторона линии: сама линия + две далёкие точки слева
    const left = [...line, [e1[0] - n1[1] * D, e1[1] + n1[0] * D], [e0[0] - n0[1] * D, e0[1] + n0[0] * D], e0];
    try {
      const sm = toMulti(src.region.geometry);
      const a = pc.intersection(sm, [[left]]);
      const b = pc.difference(sm, [[left]]);
      if (!a.length || !b.length) { toast('Линия не разрезала страну — проведи её от одной границы до другой'); return; }
      showPieces([a, b]);
      toast('Кликни по части, которую нужно передать');
    } catch (err) {
      console.error(err);
      toast('Не получилось разрезать — проведи линию без петель');
    }
  }

  function finishStroke(latlngs) {
    if (ui.mode && ui.mode.kind === 'give' && P.tool === 'line') { finishLine(latlngs); return; }
    if (latlngs.length < 6) { toast('Зажми кнопку и обведи участок, не отпуская'); return; }
    const px = latlngs.map((l) => map.latLngToLayerPoint(l));
    const simple = L.LineUtil.simplify(px, 2.5).map((p) => map.layerPointToLatLng(p));
    if (simple.length < 3) { toast('Слишком маленький контур'); return; }
    let ring = simple.map((l) => [l.lng, l.lat]);
    ring = snapRing(smooth(roughen(ring, (P.rough / 100) * 0.5)));
    ring.push(ring[0]);
    applyStroke(ring);
  }

  // общий коммит: piece отходит target, у victims вычитается
  function commit(target, piece, victims, doneMsg) {
    snapshot();
    const pb = bbox(piece);
    const removed = [];
    for (const v of victims) {
      const geom = toMulti(v.region.geometry);
      if (!bbHit(bbox(geom), pb)) continue;
      const left = pc.difference(geom, piece);
      if (!left.length) removed.push(v);
      else { v.region.geometry = asGeom(left); v.region.edited = true; }
    }
    for (const v of removed) v.side.regions.splice(v.side.regions.indexOf(v.region), 1);
    target.region.geometry = asGeom(pc.union(toMulti(target.region.geometry), piece));
    target.region.edited = true;
    if (doneMsg) toast(doneMsg);
    save(); rebuildRegions(); renderSides(); renderBanner();
  }

  function applyStroke(ring) {
    const m = ui.mode;
    if (!m || (m.kind !== 'give' && m.kind !== 'take')) return;
    const drawn = [[ring]];
    const db = bbox(drawn);
    try {
      const target = findRegion(m.target);
      if (!target) return;
      if (m.kind === 'give') {
        const src = findRegion(m.source);
        if (!src) return;
        const piece = pc.intersection(toMulti(src.region.geometry), drawn);
        if (!piece.length) { toast('Обведи участок внутри этой страны'); return; }
        commit(target, piece, [src], `Передано: ${src.region.name} → ${target.region.name}`);
      } else {
        const parts = []; // только суша: океан не раздаём
        for (const e of eraData[cur].list) if (bbHit(e.bb, db)) parts.push(pc.intersection(e.mp, drawn));
        const flat = parts.filter((p) => p.length);
        if (!flat.length) { toast('Здесь нечего занять — обведи сушу'); return; }
        commit(target, pc.union(...flat), eraRegions().filter((x) => x.region.id !== m.target));
      }
    } catch (err) {
      console.error(err);
      toast('Контур пересёкся сам с собой — попробуй обвести ещё раз');
    }
  }

  function onFillClick(ev) {
    const m = ui.mode;
    if (!m || m.kind !== 'fill') return;
    const { lng, lat } = ev.latlng;
    const hit = eraData[cur].list.find((e) => e.named && bbHit(e.bb, [lng, lat, lng, lat]) && inMulti(e.mp, lng, lat));
    const target = findRegion(m.target);
    if (!target) return;
    if (!hit) { toast('Здесь нет суши'); return; }
    try {
      commit(target, hit.mp, eraRegions().filter((x) => x.region.id !== m.target), `${hit.name} → ${target.region.name}`);
    } catch (err) { console.error(err); toast('Не получилось залить эту область'); }
  }

  // ---------- операции ----------
  function assignCountry(code, sid, opts = {}) {
    const side = sideById(sid), e = eraData[cur].byKey.get(code);
    if (!side || !e) return false;
    const ex = findByCode(code);
    if (ex && ex.side.id === sid) { toast(`${ex.region.name} уже в «${side.name}»`); return false; }
    snapshot();
    if (ex) {
      ex.side.regions.splice(ex.side.regions.indexOf(ex.region), 1);
      side.regions.push(ex.region);
    } else {
      side.regions.push({ id: uid(), name: e.name, era: cur, code, geometry: e.geometry, edited: false });
    }
    ui.open.add(sid);
    save(); rebuildRegions(); renderSides();
    if (opts.fly) {
      const l = layerByRid.get(side.regions[side.regions.length - 1].id);
      if (l) map.flyToBounds(l.getBounds(), { maxZoom: 5, padding: [60, 60], duration: 0.9 });
    }
    return true;
  }
  function moveRegion(rid, toSid) {
    const f = findRegion(rid), to = sideById(toSid);
    if (!f || !to || f.side === to) return;
    snapshot();
    f.side.regions.splice(f.side.regions.indexOf(f.region), 1);
    to.regions.push(f.region);
    save(); rebuildRegions(); renderSides();
  }
  function removeRegion(rid) {
    const f = findRegion(rid);
    if (!f) return;
    snapshot();
    f.side.regions.splice(f.side.regions.indexOf(f.region), 1);
    map.closePopup();
    save(); rebuildRegions(); renderSides();
    if (ui.mode) renderBanner();
  }
  function deleteSide(sid) {
    const s = sideById(sid);
    if (!s) return;
    if (s.regions.length && !confirm(`Удалить сторону «${s.name}» вместе с ${s.regions.length} терр.?`)) return;
    snapshot();
    state.sides.splice(state.sides.indexOf(s), 1);
    save(); rebuildRegions(); renderSides();
  }
  function flyToRegion(rid) {
    const l = layerByRid.get(rid);
    if (l) map.flyToBounds(l.getBounds(), { maxZoom: 6, padding: [80, 80], duration: 0.8 });
  }

  // ---------- popups ----------
  const chip = (side, label, fn, cls = '') =>
    h('button', { class: 'pop-chip ' + cls, onclick: fn }, side ? h('i', { style: `background:${side.color}` }) : null, label);

  function onNeutralClick(e, ev) {
    if (ui.mode) return; // рисуем — событие идёт к карте
    L.DomEvent.stopPropagation(ev);
    const box = h('div', {}, h('div', { class: 'pop-title' }, e.name), e.sub ? h('div', { class: 'pop-sub' }, e.sub) : null);
    if (!state.sides.length) {
      box.append(h('div', { class: 'pop-note' }, 'Сначала создай сторону кнопкой «+» слева.'));
    } else {
      const ex = findByCode(e.key);
      box.append(h('div', { class: 'pop-sub' }, ex ? 'Часть уже занята. Добавить целиком в:' : 'Добавить в сторону:'));
      box.append(h('div', { class: 'pop-list' }, state.sides.map((s) => chip(s, s.name, () => { map.closePopup(); assignCountry(e.key, s.id); }))));
    }
    L.popup({ offset: [0, -2] }).setLatLng(ev.latlng).setContent(box).openOn(map);
  }

  function onRegionClick(rid, ev) {
    if (ui.mode) return;
    const f = findRegion(rid);
    if (!f) return;
    L.DomEvent.stopPropagation(ev);
    const box = h('div', {},
      h('div', { class: 'pop-title' }, f.region.name),
      h('div', { class: 'pop-sub' }, h('i', { style: `background:${f.side.color}` }), f.side.name),
      h('div', { class: 'pop-list' },
        chip(null, 'Передать часть другой стране…', () => startMode({ kind: 'give', source: rid })),
        chip(null, 'Нарисовать территорию', () => startMode({ kind: 'take', target: rid })),
        chip(null, 'Залить страну целиком', () => startMode({ kind: 'fill', target: rid })),
        ...state.sides.filter((s) => s !== f.side).map((s) => chip(s, `Передать сторону: ${s.name}`, () => { map.closePopup(); moveRegion(rid, s.id); })),
        chip(null, 'Убрать со стороны', () => removeRegion(rid), 'danger')));
    L.popup({ offset: [0, -2] }).setLatLng(ev.latlng).setContent(box).openOn(map);
  }

  // ---------- sidebar ----------
  const sidesEl = $('#sides'), emptyEl = $('#empty');

  function editableName(el, current, commitName) {
    el.contentEditable = 'true';
    el.focus();
    const range = document.createRange(); range.selectNodeContents(el);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
    const done = (ok) => {
      el.removeEventListener('blur', onBlur); el.removeEventListener('keydown', onKey);
      el.contentEditable = 'false';
      const v = el.textContent.trim().slice(0, 40);
      if (ok && v && v !== current) commitName(v); else el.textContent = current;
    };
    const onBlur = () => done(true);
    const onKey = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
      if (e.key === 'Escape') { e.stopPropagation(); done(false); }
    };
    el.addEventListener('blur', onBlur); el.addEventListener('keydown', onKey);
  }

  let focusSearch = null;
  function renderSides() {
    emptyEl.hidden = state.sides.length > 0;
    sidesEl.replaceChildren(...state.sides.map(sideCard));
    if (focusSearch) {
      const inp = sidesEl.querySelector(`[data-search="${focusSearch.sid}"]`);
      if (inp) { inp.focus(); }
      focusSearch = null;
    }
  }

  function sideCard(side) {
    const open = ui.open.has(side.id);
    const here = side.regions.filter((r) => r.era === cur);
    const nameEl = h('div', { class: 'side-name', title: 'Двойной клик — переименовать' }, side.name);
    nameEl.addEventListener('dblclick', (e) => { e.stopPropagation(); editableName(nameEl, side.name, (v) => { snapshot(); side.name = v; save(); rebuildRegions(); renderSides(); }); });

    const colorInput = h('input', { type: 'color', value: side.color, title: 'Цвет стороны' });
    colorInput.addEventListener('change', () => { snapshot(); side.color = colorInput.value; save(); rebuildRegions(); renderSides(); });
    const dot = h('span', { class: 'dot', style: `background:${side.color}`, onclick: (e) => e.stopPropagation() }, colorInput);

    const top = h('div', { class: 'side-top', onclick: () => { ui.open.has(side.id) ? ui.open.delete(side.id) : ui.open.add(side.id); renderSides(); } },
      dot, nameEl, h('span', { class: 'count' }, String(here.length)),
      h('button', { class: 'icon-btn danger', title: 'Удалить сторону', onclick: (e) => { e.stopPropagation(); deleteSide(side.id); } }, icon('trash')),
      h('span', { class: 'chev' }, icon('chev')));

    const body = h('div', { class: 'side-body' }, searchBox(side));
    const elsewhere = side.regions.length - here.length;
    body.append(here.length
      ? h('ul', { class: 'regions' }, here.map((r) => regionRow(r)))
      : h('div', { class: 'none' }, elsewhere ? `В этом году пусто · в других эпохах: ${elsewhere}` : 'Пока пусто'));

    return h('div', { class: 'side' + (open ? ' open' : '') }, top, body);
  }

  function regionRow(r) {
    const nameEl = h('span', { class: 'rn', title: 'Показать на карте · двойной клик — переименовать' }, r.name);
    nameEl.addEventListener('click', () => flyToRegion(r.id));
    nameEl.addEventListener('dblclick', () => editableName(nameEl, r.name, (v) => { snapshot(); r.name = v; save(); rebuildRegions(); renderSides(); }));
    return h('li', { class: 'region' },
      nameEl,
      r.code ? (r.edited ? h('span', { class: 'tag' }, 'изм.') : null) : h('span', { class: 'tag' }, 'своя'),
      h('span', { class: 'acts' },
        h('button', { class: 'icon-btn', title: 'Передать часть другой стране', onclick: () => startMode({ kind: 'give', source: r.id }) }, icon('give')),
        h('button', { class: 'icon-btn', title: 'Нарисовать территорию', onclick: () => startMode({ kind: 'take', target: r.id }) }, icon('brush')),
        h('button', { class: 'icon-btn', title: 'Залить страну целиком', onclick: () => startMode({ kind: 'fill', target: r.id }) }, icon('bucket')),
        h('button', { class: 'icon-btn danger', title: 'Убрать', onclick: () => removeRegion(r.id) }, icon('trash'))));
  }

  function searchBox(side) {
    const input = h('input', { type: 'text', placeholder: '＋ Добавить страну…', autocomplete: 'off', 'data-search': side.id });
    const results = h('div', { class: 'results' });
    let idx = 0, list = [];
    const refresh = () => {
      const q = input.value.trim().toLowerCase();
      results.hidden = !q;
      list = !q ? [] : eraData[cur].list.filter((e) => e.named && e.name.toLowerCase().includes(q))
        .sort((a, b) => a.name.localeCompare(b.name, 'ru')).slice(0, 60);
      idx = Math.min(idx, Math.max(list.length - 1, 0));
      results.replaceChildren(...(list.length ? list.map((e, i) => {
        const ex = findByCode(e.key);
        const same = ex && ex.side.id === side.id;
        return h('button', { type: 'button', class: 'result' + (i === idx ? ' active' : ''), disabled: same, onclick: () => pickResult(e) },
          e.name, ex ? h('small', {}, h('i', { style: `background:${ex.side.color}` }), same ? 'уже здесь' : ex.side.name) : null);
      }) : [h('div', { class: 'no-res' }, 'Ничего не найдено')]));
    };
    const pickResult = (e) => { focusSearch = { sid: side.id }; assignCountry(e.key, side.id, { fly: true }); };
    input.addEventListener('input', () => { idx = 0; refresh(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { idx = Math.min(idx + 1, list.length - 1); refresh(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { idx = Math.max(idx - 1, 0); refresh(); e.preventDefault(); }
      else if (e.key === 'Enter' && list[idx]) { e.preventDefault(); pickResult(list[idx]); }
      else if (e.key === 'Escape') { input.value = ''; refresh(); input.blur(); }
    });
    refresh();
    return h('div', { class: 'search' }, input, results);
  }

  // ---------- новая сторона ----------
  const sideForm = $('#sideForm'), sideName = $('#sideName'), swatches = $('#swatches');
  let chosenColor = PALETTE[0];
  function renderSwatches() {
    const custom = h('label', { class: 'swatch custom' + (PALETTE.includes(chosenColor) ? '' : ' on'), title: 'Свой цвет' },
      h('input', { type: 'color', value: chosenColor, onchange: (e) => { chosenColor = e.target.value; renderSwatches(); } }));
    swatches.replaceChildren(
      ...PALETTE.map((c) => h('button', { type: 'button', class: 'swatch' + (c === chosenColor ? ' on' : ''), style: `background:${c}`, 'aria-label': c, onclick: () => { chosenColor = c; renderSwatches(); } })),
      custom);
  }
  $('#addSideBtn').addEventListener('click', () => {
    sideForm.hidden = !sideForm.hidden;
    if (!sideForm.hidden) {
      const used = new Set(state.sides.map((s) => s.color));
      chosenColor = PALETTE.find((c) => !used.has(c)) || PALETTE[state.sides.length % PALETTE.length];
      renderSwatches(); sideName.value = ''; sideName.focus();
    }
  });
  $('#cancelSide').addEventListener('click', () => (sideForm.hidden = true));
  sideForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = sideName.value.trim();
    if (!name) return;
    snapshot();
    const side = { id: uid(), name, color: chosenColor, regions: [] };
    state.sides.push(side);
    ui.open.add(side.id);
    sideForm.hidden = true;
    focusSearch = { sid: side.id };
    save(); renderSides();
  });

  // ---------- экспорт / импорт / сброс ----------
  $('#exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(serialize(), null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: 'ohmyglobalmap.json' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  $('#importBtn').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text());
      if (!Array.isArray(raw.sides)) throw new Error('bad');
      if (state.sides.length && !confirm('Заменить текущую карту импортированной?')) return;
      endMode(); snapshot();
      state = hydrate(raw); ui.open.clear();
      save(); rebuildRegions(); renderSides();
      toast('Карта загружена');
    } catch (err) { toast('Не получилось прочитать файл'); }
  });
  $('#resetBtn').addEventListener('click', () => {
    if (!confirm('Стереть все стороны и границы?')) return;
    endMode(); snapshot();
    state = { sides: [] }; ui.open.clear();
    save(); rebuildRegions(); renderSides();
  });

  // ---------- прочее ----------
  const typing = () => /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (document.body.classList.contains('clean')) setClean(false);
      else if (ui.mode) endMode();
      cityPop.hidden = true;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing()) { e.preventDefault(); undo(); }
    if ((e.key === 'h' || e.key === 'H' || e.key === 'р' || e.key === 'Р') && !typing() && !e.ctrlKey && !e.metaKey) setClean(!document.body.classList.contains('clean'));
  });
  $('#panelToggle').addEventListener('click', () => document.body.classList.add('panel-open'));
  map.on('click', () => { if (window.innerWidth <= 760 && !ui.mode) document.body.classList.remove('panel-open'); });

  // ---------- запуск ----------
  async function boot() {
    try {
      const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
      P = { ...DEFAULT_PREFS, ...saved, cities: { ...DEFAULT_PREFS.cities, ...(saved.cities || {}) }, fold: { ...DEFAULT_PREFS.fold, ...(saved.fold || {}) } };
    } catch (e) { /* по умолчанию */ }
    if (!MAP_STYLES[P.style]) P.style = 'dark';
    syncCityUi();
    setFold('panel', P.fold.panel, true); setFold('timeline', P.fold.timeline, true);
    setStyle(P.style, true);
    setFill(P.fill === 'flag' ? 'flag' : 'color', true);
    try {
      const [topo, hist, a2, flags, cts] = await Promise.all([
        fetch('data/countries10.json').then((r) => r.json()),
        fetch('data/names-hist-ru.json').then((r) => r.json()),
        fetch('data/gw-a2.json').then((r) => r.json()),
        fetch('data/flags.json').then((r) => r.json()),
        fetch('data/cities.json').then((r) => r.json()),
      ]);
      modernTopo = topo; histRu = hist; gwA2 = a2; flagSet = new Set(flags); cities = cts;
      await loadEra('now');
    } catch (err) {
      toast('Не удалось загрузить данные карты. Открой сайт через веб-сервер.');
      console.error(err);
      return;
    }
    load();
    state.sides.forEach((s) => ui.open.add(s.id));
    const startEra = ERAS.some((e) => e.id === P.era) ? P.era : 'now';
    await loadEra(startEra).catch(() => null);
    cur = eraData[startEra] ? startEra : 'now';
    showEraUi(cur);
    rebuildNeutral();
    rebuildRegions();
    renderSides();
    cityLayer.redraw();
  }
  boot();
})();
