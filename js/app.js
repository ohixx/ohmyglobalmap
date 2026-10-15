/* OhMyGlobalMap — карта для ВПИ-сервера.
 * Стороны → страны → территории, которые передаются рисованием от руки. Эпохи, стили карты, localStorage + экспорт в JSON. */
(() => {
  'use strict';

  const STORE_KEY = 'omgm.v1';
  const PREFS_KEY = 'omgm.prefs';
  const PALETTE = ['#d97757', '#6a9bcc', '#788c5d', '#b07aa1', '#c9a227', '#4e9a9a', '#c25b5b', '#8b7ec8', '#9a8c6c', '#5b8a72'];
  const RU_FALLBACK = {
    'Somaliland': 'Сомалиленд', 'Kosovo': 'Косово', 'N. Cyprus': 'Северный Кипр',
    'Indian Ocean Ter.': 'Территории в Индийском океане', 'Siachen Glacier': 'Ледник Сиачен',
  };

  const ERAS = [
    ['-1000', '1000 до н. э.'], ['-500', '500 до н. э.'], ['-323', '323 до н. э.'], ['100', '100 г.'], ['300', '300 г.'], ['500', '500 г.'],
    ['800', '800 г.'], ['1000', '1000 г.'], ['1200', '1200 г.'], ['1300', '1300 г.'], ['1400', '1400 г.'], ['1600', '1600 г.'],
    ['1700', '1700 г.'], ['1783', '1783 г.'], ['1815', '1815 г.'], ['1880', '1880 г.'], ['1914', '1914 г.'], ['1920', '1920 г.'],
    ['1938', '1938 г.'], ['1945', '1945 г.'], ['1960', '1960 г.'], ['1994', '1994 г.'], ['now', 'Сегодня'],
  ].map(([id, label]) => ({ id, label }));
  const eraIndex = (id) => Math.max(0, ERAS.findIndex((e) => e.id === id));

  const MAP_STYLES = {
    dark: { label: 'Тёмная', theme: 'dark', tiles: null,
      neutral: { color: '#46453f', weight: 0.7, opacity: 1, fillColor: '#2d2c29', fillOpacity: 1 },
      hover: { fillColor: '#3b3a36', color: '#5a5952', weight: 1 }, region: { fill: 0.74, line: 0.55 } },
    relief: { label: 'Рельеф', theme: 'light',
      tiles: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}', attr: 'Рельеф: Esri', native: 13 },
      neutral: { color: '#4c4b44', weight: 0.8, opacity: 0.55, fillColor: '#fff', fillOpacity: 0.001 },
      hover: { fillColor: '#fff', fillOpacity: 0.3, weight: 1.2, opacity: 0.8 }, region: { fill: 0.62, line: 0.8 } },
    sat: { label: 'Спутник', theme: 'dark',
      tiles: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attr: 'Снимки: Esri, Maxar, Earthstar Geographics', native: 17 },
      neutral: { color: '#ffffff', weight: 0.8, opacity: 0.5, fillColor: '#fff', fillOpacity: 0.001 },
      hover: { fillColor: '#fff', fillOpacity: 0.2, weight: 1.2, opacity: 0.8 }, region: { fill: 0.55, line: 0.85 } },
  };

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
    plus: 'M12 5v14M5 12h14',
    trash: 'M5 7h14M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3',
    pen: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z',
    cursor: 'M5 3l14 7-6 2-2 6L5 3z',
    give: 'M4 12h14M13 6l6 6-6 6M4 5v14',
    brush: 'M18.4 2.6l3 3-9.6 9.6-3-3 9.6-9.6zM8.8 12.2c-2 0-3.3 1.4-3.3 3.3 0 1.4-.8 2.5-2 3.1 3.8 1 7.8-.4 7.8-3.6l-2.5-2.8z',
  };
  const icon = (n, s = 16) => {
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

  const pc = window.polygonClipping;
  const toMulti = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);
  const asGeom = (mp) => ({ type: 'MultiPolygon', coordinates: mp });
  function bbox(mp) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const poly of mp) for (const [x, y] of poly[0]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return [x0, y0, x1, y1];
  }
  const bbHit = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

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

  // Полигоны, пересекающие 180-й меридиан (Россия, Фиджи, США…), в исходных данных замыкаются прыжком через весь мир.
  // Разворачиваем долготы и режем по меридиану на два куска.
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
  function smooth(ring) { // один проход Чайкина — убирает острые «зубцы»
    const out = [];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    return out;
  }

  // ---------- данные эпох ----------
  const eraData = {};            // id -> {list:[{key,name,geometry,named,mp,bb}], byKey:Map}
  let ruNames = {}, histRu = {}, ruByEng = {}, modernTopo = null;

  async function loadEra(id) {
    if (eraData[id]) return eraData[id];
    const list = [];
    if (id === 'now') {
      const feats = topojson.feature(modernTopo, modernTopo.objects.countries).features.filter((f) => f.id !== '010'); // без Антарктиды
      feats.forEach((f, i) => {
        const key = f.id || 'x' + i;
        const eng = f.properties.name;
        const name = ruNames[f.id] || RU_FALLBACK[eng] || eng;
        ruByEng[eng] = name;
        list.push({ key, name, geometry: f.geometry, named: true });
      });
    } else {
      const res = await fetch(`data/eras/${id}.json`);
      if (!res.ok) throw new Error('era ' + id);
      const data = await res.json();
      const used = new Set();
      data.features.forEach((f, i) => {
        const eng = f.properties.NAME;
        let key = null, name = '';
        if (eng) {
          key = used.has(eng) ? `${eng}#${i}` : eng; used.add(key);
          name = histRu[eng] || ruByEng[eng] || eng;
        }
        list.push({ key, name, geometry: f.geometry, named: !!eng });
      });
    }
    const byKey = new Map();
    for (const e of list) { e.geometry = fixAntimeridian(e.geometry); e.mp = toMulti(e.geometry); e.bb = bbox(e.mp); if (e.key != null) byKey.set(e.key, e); }
    return (eraData[id] = { list, byKey });
  }

  // ---------- state ----------
  /** side: {id,name,color,regions:[{id,name,era,code|null,geometry,edited}]} */
  let state = { sides: [] };
  const ui = { open: new Set(), search: null, mode: null, rough: 40 };
  let cur = 'now', styleId = 'dark';
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

  function serialize() {
    return {
      v: 2,
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
    try { localStorage.setItem(PREFS_KEY, JSON.stringify({ style: styleId, era: cur, rough: ui.rough })); } catch (e) { /* без настроек */ }
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
    if (ui.mode && ui.mode.type === 'paint') renderPaintBanner();
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
  map.attributionControl.addAttribution('Natural Earth · historical-basemaps');
  map.createPane('neutral').style.zIndex = 300;
  map.createPane('regions').style.zIndex = 400;
  map.createPane('draw').style.zIndex = 500;
  map.fitBounds([[-50, -150], [78, 170]]);

  const neutralGroup = L.featureGroup().addTo(map);
  const regionsGroup = L.featureGroup().addTo(map);
  const labelsGroup = L.layerGroup().addTo(map);
  const layerByRid = new Map();
  const canvas = L.canvas({ pane: 'neutral' });
  const S = () => MAP_STYLES[styleId];

  function rebuildNeutral() {
    neutralGroup.clearLayers();
    for (const e of eraData[cur].list) {
      const l = L.geoJSON({ type: 'Feature', geometry: e.geometry, properties: {} }, {
        pane: 'neutral', renderer: canvas, style: () => S().neutral, interactive: e.named,
      });
      if (e.named) {
        l.bindTooltip(e.name, { sticky: true, className: 'hover-tip', direction: 'top', offset: [0, -6] });
        l.on('mouseover', () => { if (!ui.mode || ui.mode.type === 'pick') l.setStyle(S().hover); });
        l.on('mouseout', () => l.setStyle(S().neutral));
        l.on('click', (ev) => onNeutralClick(e, ev));
      }
      neutralGroup.addLayer(l);
    }
  }

  function regionStyle(side, hover) {
    const r = S().region;
    return { color: '#ffffff', opacity: hover ? 1 : r.line, weight: hover ? 1.8 : 1.1, fillColor: side.color, fillOpacity: Math.min(1, hover ? r.fill + 0.14 : r.fill), lineJoin: 'round' };
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
      const layer = L.geoJSON({ type: 'Feature', geometry: region.geometry, properties: {} }, { pane: 'regions', style: () => regionStyle(side) }).getLayers()[0];
      layer.on('mouseover', () => { if (!ui.mode) layer.setStyle(regionStyle(side, true)); });
      layer.on('mouseout', () => layer.setStyle(regionStyle(side)));
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

  // ---------- стиль карты ----------
  let tileLayer = null, tileErrorShown = false;
  function setStyle(id, quiet) {
    styleId = id;
    const st = S();
    document.body.dataset.style = id;
    document.body.dataset.theme = st.theme;
    if (tileLayer) { map.removeLayer(tileLayer); tileLayer = null; }
    if (st.tiles) {
      tileLayer = L.tileLayer(st.tiles.url, { attribution: st.tiles.attr, maxNativeZoom: st.tiles.native, maxZoom: 10, noWrap: true, keepBuffer: 4 }).addTo(map);
      tileLayer.on('tileerror', () => { if (!tileErrorShown) { tileErrorShown = true; toast('Не удалось загрузить подложку — проверь интернет'); } });
    }
    neutralGroup.eachLayer((g) => g.setStyle(st.neutral));
    if (eraData[cur]) rebuildRegions();
    document.querySelectorAll('#styleBar button').forEach((b) => b.classList.toggle('on', b.dataset.id === id));
    if (!quiet) savePrefs();
  }
  $('#styleBar').replaceChildren(...Object.entries(MAP_STYLES).map(([id, s]) => h('button', { 'data-id': id, onclick: () => setStyle(id) }, s.label)));

  // ---------- эпохи ----------
  const eraRange = $('#eraRange'), eraLabelEl = $('#eraLabel'), eraNote = $('#eraNote');
  eraRange.max = ERAS.length - 1;
  let eraToken = 0, eraTimer;

  function showEraUi(id) {
    const i = eraIndex(id);
    eraRange.value = i;
    eraLabelEl.textContent = ERAS[i].label;
    eraNote.textContent = id === 'now' ? 'современные границы' : 'исторические границы · приблизительно';
    $('#eraPrev').disabled = i === 0;
    $('#eraNext').disabled = i === ERAS.length - 1;
  }
  async function setEra(id) {
    const token = ++eraToken;
    showEraUi(id);
    try {
      if (!eraData[id]) toast('Загружаю границы…');
      await loadEra(id);
    } catch (err) { toast('Не удалось загрузить эту эпоху'); showEraUi(cur); return; }
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
    const id = ERAS[+eraRange.value].id;
    eraLabelEl.textContent = ERAS[+eraRange.value].label;
    clearTimeout(eraTimer);
    eraTimer = setTimeout(() => setEra(id), 140);
  });
  const stepEra = (d) => { const i = Math.min(ERAS.length - 1, Math.max(0, eraIndex(cur) + d)); if (i !== eraIndex(cur)) setEra(ERAS[i].id); };
  $('#eraPrev').addEventListener('click', () => stepEra(-1));
  $('#eraNext').addEventListener('click', () => stepEra(1));

  // ---------- режимы: pick / paint ----------
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

  function startPick(sid) {
    setMode({ type: 'pick', sid });
    const side = sideById(sid);
    map.getContainer().style.cursor = 'crosshair';
    showBanner(['Кликай по странам — они попадут в ', h('b', {}, side.name)], [h('button', { class: 'btn primary', onclick: endMode }, 'Готово')]);
  }

  function startPaint(m) {
    if (m.kind !== 'new' && eraRegions().length < (m.kind === 'give' ? 2 : 1)) {
      toast('Добавь ещё хотя бы одну страну, чтобы передать ей территорию');
      return;
    }
    setMode({ type: 'paint', ...m });
    map.closePopup();
    map.dragging.disable();
    map.getContainer().classList.add('drawing');
    ui.mode.cleanup = attachFreehand();
    renderPaintBanner();
  }

  function renderPaintBanner() {
    const m = ui.mode;
    if (!m || m.type !== 'paint') return;
    const tools = [];
    let text;
    if (m.kind === 'give') {
      const src = findRegion(m.source);
      const others = eraRegions().filter((x) => x.region.id !== m.source);
      if (!src || !others.length) { endMode(); return; }
      if (!others.some((x) => x.region.id === m.target)) m.target = others[0].region.id;
      text = ['Обведи от руки участок «', h('b', {}, src.region.name), '» — он перейдёт к:'];
      const sel = h('select', { onchange: () => { m.target = sel.value; } });
      for (const s of state.sides) {
        const opts = others.filter((x) => x.side === s);
        if (opts.length) sel.append(h('optgroup', { label: s.name }, opts.map((x) => h('option', { value: x.region.id, selected: x.region.id === m.target }, x.region.name))));
      }
      tools.push(sel);
    } else if (m.kind === 'take') {
      const t = findRegion(m.target);
      if (!t) { endMode(); return; }
      text = ['Обведи землю, которую займёт «', h('b', {}, t.region.name), '». Она отберётся у соседей.'];
    } else {
      const side = sideById(m.sid);
      if (!side) { endMode(); return; }
      text = ['Новая территория для «', h('b', {}, side.name), '» — обведи область на карте.'];
    }
    const rough = h('input', { type: 'range', min: 0, max: 100, value: ui.rough, title: 'Насколько неровной будет граница' });
    rough.addEventListener('input', () => { ui.rough = +rough.value; savePrefs(); });
    tools.push(h('label', {}, 'Неровность', rough));
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
      if ((e.pointerType === 'mouse' && e.button !== 0) || e.target.closest('.leaflet-control, .leaflet-popup')) return;
      try { c.setPointerCapture(e.pointerId); } catch (err) { /* не критично */ }
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
    };
  }

  function finishStroke(latlngs) {
    if (latlngs.length < 6) { toast('Зажми кнопку и обведи участок, не отпуская'); return; }
    const px = latlngs.map((l) => map.latLngToLayerPoint(l));
    const simple = L.LineUtil.simplify(px, 3).map((p) => map.layerPointToLatLng(p));
    if (simple.length < 3) { toast('Слишком маленький контур'); return; }
    let ring = simple.map((l) => [l.lng, l.lat]);
    ring = smooth(roughen(ring, (ui.rough / 100) * 0.5));
    ring.push(ring[0]);
    applyStroke(ring);
  }

  function applyStroke(ring) {
    const m = ui.mode;
    if (!m || m.type !== 'paint') return;
    const drawn = [[ring]];
    const db = bbox(drawn);
    try {
      let piece, victims = [], target = null;
      if (m.kind === 'new') {
        piece = pc.union(drawn);
      } else if (m.kind === 'give') {
        const src = findRegion(m.source); target = findRegion(m.target);
        if (!src || !target) return;
        piece = pc.intersection(toMulti(src.region.geometry), drawn);
        victims = [src];
      } else {
        target = findRegion(m.target);
        if (!target) return;
        const parts = []; // только суша: не раздаём океан
        for (const e of eraData[cur].list) if (bbHit(e.bb, db)) parts.push(pc.intersection(e.mp, drawn));
        const flat = parts.filter((p) => p.length);
        piece = flat.length ? pc.union(...flat) : [];
        victims = eraRegions().filter((x) => x.region.id !== m.target);
      }
      if (!piece.length) { toast(m.kind === 'give' ? 'Обведи участок внутри этой страны' : 'Здесь нечего занять — обведи сушу'); return; }

      snapshot();
      const srcName = m.kind === 'give' ? findRegion(m.source).region.name : '';
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

      if (m.kind === 'new') {
        const side = sideById(m.sid);
        const n = side.regions.filter((r) => !r.code && r.era === cur).length + 1;
        side.regions.push({ id: uid(), name: `Территория ${n}`, era: cur, code: null, geometry: asGeom(piece), edited: true });
        ui.open.add(side.id);
      } else {
        target.region.geometry = asGeom(pc.union(toMulti(target.region.geometry), piece));
        target.region.edited = true;
        if (m.kind === 'give') toast(`Передано: ${srcName} → ${target.region.name}`);
      }
      save(); rebuildRegions(); renderSides(); renderPaintBanner();
    } catch (err) {
      console.error(err);
      toast('Контур пересёкся сам с собой — попробуй обвести ещё раз');
    }
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
    if (ui.mode && ui.mode.type === 'paint') renderPaintBanner();
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
    const m = ui.mode;
    if (m && m.type !== 'pick') return;
    L.DomEvent.stopPropagation(ev);
    if (m) { assignCountry(e.key, m.sid); return; }
    const box = h('div', {}, h('div', { class: 'pop-title' }, e.name));
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
    const m = ui.mode;
    const f = findRegion(rid);
    if (!f) return;
    if (m && m.type === 'pick') {
      L.DomEvent.stopPropagation(ev);
      if (f.region.code) assignCountry(f.region.code, m.sid);
      return;
    }
    if (m) return;
    L.DomEvent.stopPropagation(ev);
    const box = h('div', {},
      h('div', { class: 'pop-title' }, f.region.name),
      h('div', { class: 'pop-sub' }, h('i', { style: `background:${f.side.color}` }), f.side.name),
      h('div', { class: 'pop-list' },
        chip(null, 'Передать часть другой стране…', () => startPaint({ kind: 'give', source: rid })),
        chip(null, 'Расширить границы рисованием', () => startPaint({ kind: 'take', target: rid })),
        ...state.sides.filter((s) => s !== f.side).map((s) => chip(s, `Передать сторону: ${s.name}`, () => { map.closePopup(); moveRegion(rid, s.id); })),
        chip(null, 'Убрать со стороны', () => removeRegion(rid), 'danger')));
    L.popup({ offset: [0, -2] }).setLatLng(ev.latlng).setContent(box).openOn(map);
  }

  // ---------- sidebar ----------
  const sidesEl = $('#sides'), emptyEl = $('#empty');

  function editableName(el, current, commit) {
    el.contentEditable = 'true';
    el.focus();
    const range = document.createRange(); range.selectNodeContents(el);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
    const done = (ok) => {
      el.removeEventListener('blur', onBlur); el.removeEventListener('keydown', onKey);
      el.contentEditable = 'false';
      const v = el.textContent.trim().slice(0, 40);
      if (ok && v && v !== current) commit(v); else el.textContent = current;
    };
    const onBlur = () => done(true);
    const onKey = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
      if (e.key === 'Escape') { e.stopPropagation(); done(false); }
    };
    el.addEventListener('blur', onBlur); el.addEventListener('keydown', onKey);
  }

  function renderSides() {
    emptyEl.hidden = state.sides.length > 0;
    sidesEl.replaceChildren(...state.sides.map(sideCard));
    const inp = sidesEl.querySelector('.search input');
    if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
  }

  function sideCard(side) {
    const open = ui.open.has(side.id);
    const here = side.regions.filter((r) => r.era === cur);
    const nameEl = h('div', { class: 'side-name', title: 'Двойной клик — переименовать' }, side.name);
    const rename = () => editableName(nameEl, side.name, (v) => { snapshot(); side.name = v; save(); rebuildRegions(); renderSides(); });
    nameEl.addEventListener('dblclick', (e) => { e.stopPropagation(); rename(); });

    const colorInput = h('input', { type: 'color', value: side.color, title: 'Цвет стороны' });
    colorInput.addEventListener('change', () => { snapshot(); side.color = colorInput.value; save(); rebuildRegions(); renderSides(); });
    const dot = h('span', { class: 'dot', style: `background:${side.color}`, onclick: (e) => e.stopPropagation() }, colorInput);

    const top = h('div', { class: 'side-top', onclick: () => { ui.open.has(side.id) ? ui.open.delete(side.id) : ui.open.add(side.id); renderSides(); } },
      dot, nameEl, h('span', { class: 'count' }, String(here.length)), h('span', { class: 'chev' }, icon('chev')));

    const searching = ui.search === side.id;
    const actions = h('div', { class: 'side-actions' },
      h('button', { class: 'chip-btn accent', onclick: () => { ui.search = searching ? null : side.id; renderSides(); } }, icon('plus', 14), 'Страна'),
      h('button', { class: 'chip-btn', title: 'Добавлять страны кликом по карте', onclick: () => startPick(side.id) }, icon('cursor', 14), 'По карте'),
      h('button', { class: 'chip-btn', title: 'Нарисовать новую территорию', onclick: () => startPaint({ kind: 'new', sid: side.id }) }, icon('pen', 14), 'Рисовать'),
      h('button', { class: 'chip-btn', onclick: rename }, 'Имя'),
      h('button', { class: 'chip-btn danger', title: 'Удалить сторону', onclick: () => deleteSide(side.id) }, icon('trash', 14)));

    const body = h('div', { class: 'side-body' }, actions);
    if (searching) body.append(searchBox(side));

    const elsewhere = side.regions.length - here.length;
    body.append(here.length
      ? h('ul', { class: 'regions' }, here.map((r) => regionRow(r)))
      : h('div', { class: 'none' }, elsewhere ? `В этом году пусто · в других эпохах: ${elsewhere}` : 'Пока пусто — добавь страны.'));

    return h('div', { class: 'side' + (open ? ' open' : '') }, top, body);
  }

  function regionRow(r) {
    const nameEl = h('span', { class: 'rn', title: 'Показать на карте' }, r.name);
    nameEl.addEventListener('click', () => flyToRegion(r.id));
    nameEl.addEventListener('dblclick', () => editableName(nameEl, r.name, (v) => { snapshot(); r.name = v; save(); rebuildRegions(); renderSides(); }));
    return h('li', { class: 'region' },
      nameEl,
      r.code ? (r.edited ? h('span', { class: 'tag' }, 'изменена') : null) : h('span', { class: 'tag' }, 'своя'),
      h('button', { class: 'icon-btn', title: 'Передать часть другой стране', onclick: () => startPaint({ kind: 'give', source: r.id }) }, icon('give', 15)),
      h('button', { class: 'icon-btn', title: 'Расширить границы рисованием', onclick: () => startPaint({ kind: 'take', target: r.id }) }, icon('brush', 15)),
      h('button', { class: 'icon-btn danger', title: 'Убрать', onclick: () => removeRegion(r.id) }, icon('trash', 15)));
  }

  function searchBox(side) {
    const input = h('input', { type: 'text', placeholder: 'Найти страну…', autocomplete: 'off' });
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
    const pickResult = (e) => assignCountry(e.key, side.id, { fly: true });
    input.addEventListener('input', () => { idx = 0; refresh(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { idx = Math.min(idx + 1, list.length - 1); refresh(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { idx = Math.max(idx - 1, 0); refresh(); e.preventDefault(); }
      else if (e.key === 'Enter' && list[idx]) { e.preventDefault(); pickResult(list[idx]); }
      else if (e.key === 'Escape') { e.stopPropagation(); ui.search = null; renderSides(); }
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
    ui.open.add(side.id); ui.search = side.id;
    sideForm.hidden = true;
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
      state = hydrate(raw); ui.open.clear(); ui.search = null;
      save(); rebuildRegions(); renderSides();
      toast('Карта загружена');
    } catch (err) { toast('Не получилось прочитать файл'); }
  });
  $('#resetBtn').addEventListener('click', () => {
    if (!confirm('Стереть все стороны и границы?')) return;
    endMode(); snapshot();
    state = { sides: [] }; ui.open.clear(); ui.search = null;
    save(); rebuildRegions(); renderSides();
  });

  // ---------- прочее ----------
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && ui.mode) endMode();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !/INPUT|SELECT/.test(document.activeElement.tagName) && !document.activeElement.isContentEditable) { e.preventDefault(); undo(); }
  });
  $('#panelToggle').addEventListener('click', () => document.body.classList.add('panel-open'));
  map.on('click', () => { if (window.innerWidth <= 760 && !ui.mode) document.body.classList.remove('panel-open'); });

  // ---------- запуск ----------
  async function boot() {
    let prefs = {};
    try { prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); } catch (e) { /* по умолчанию */ }
    if (prefs.rough >= 0 && prefs.rough <= 100) ui.rough = prefs.rough;
    setStyle(MAP_STYLES[prefs.style] ? prefs.style : 'dark', true);
    try {
      const [topo, names, hist] = await Promise.all([
        fetch('data/countries.json').then((r) => r.json()),
        fetch('data/names-ru.json').then((r) => r.json()),
        fetch('data/names-hist-ru.json').then((r) => r.json()),
      ]);
      modernTopo = topo; ruNames = names; histRu = hist;
      await loadEra('now');
    } catch (err) {
      toast('Не удалось загрузить данные карты. Открой сайт через веб-сервер.');
      console.error(err);
      return;
    }
    load();
    state.sides.forEach((s) => ui.open.add(s.id));
    const startEra = ERAS.some((e) => e.id === prefs.era) ? prefs.era : 'now';
    await loadEra(startEra).catch(() => null);
    cur = eraData[startEra] ? startEra : 'now';
    showEraUi(cur);
    rebuildNeutral();
    rebuildRegions();
    renderSides();
  }
  boot();
})();
