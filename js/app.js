/* OhMyGlobalMap — карта для ВПИ-сервера.
 * Стороны → страны → редактируемые границы. Всё хранится в localStorage + экспорт в JSON. */
(() => {
  'use strict';

  const STORE_KEY = 'omgm.v1';
  const PALETTE = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#14b8a6'];
  const RU_FALLBACK = {
    'Somaliland': 'Сомалиленд', 'Kosovo': 'Косово', 'N. Cyprus': 'Северный Кипр',
    'Indian Ocean Ter.': 'Территории в Индийском океане', 'Siachen Glacier': 'Ледник Сиачен',
  };

  // ---------- helpers ----------
  const $ = (s) => document.querySelector(s);
  const uid = () => Math.random().toString(36).slice(2, 9);
  const clone = (o) => JSON.parse(JSON.stringify(o));

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
    pin: 'M12 21s-7-6.2-7-11a7 7 0 0114 0c0 4.8-7 11-7 11zM12 12a2 2 0 100-4 2 2 0 000 4z',
    edit: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
    trash: 'M5 7h14M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3',
    pen: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z',
    cursor: 'M5 3l14 7-6 2-2 6L5 3z',
    scissors: 'M6 9a3 3 0 100-6 3 3 0 000 6zM6 21a3 3 0 100-6 3 3 0 000 6zM20 4L8.1 15.9M14.5 14.5L20 20M8.1 8.1L12 12',
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
    toastTimer = setTimeout(() => (t.hidden = true), 2600);
  }

  // геометрия: центр самого крупного куска (для подписей)
  function labelPoint(geom) {
    const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
    let best = null, bestA = -1;
    for (const p of polys) {
      const r = p[0]; let a = 0, cx = 0, cy = 0;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const f = r[j][0] * r[i][1] - r[i][0] * r[j][1];
        a += f; cx += (r[j][0] + r[i][0]) * f; cy += (r[j][1] + r[i][1]) * f;
      }
      const area = Math.abs(a / 2);
      if (area > bestA) {
        bestA = area;
        best = a ? [cx / (3 * a), cy / (3 * a)] : r[0];
      }
    }
    return L.latLng(best[1], best[0]);
  }

  // Упрощение вершин на время правки: у границ 50m тысячи точек, ими невозможно управлять.
  function simplifyLatLngs(ll, tol) {
    if (ll.length && ll[0].lat === undefined) return ll.map((x) => simplifyLatLngs(x, tol));
    const out = L.LineUtil.simplify(ll.map((p) => L.point(p.lng, p.lat)), tol).map((p) => L.latLng(p.y, p.x));
    return out.length >= 3 ? out : ll;
  }

  // ---------- state ----------
  /** side: {id,name,color,regions:[{id,name,code|null,geometry,edited}]} */
  let state = { sides: [] };
  const ui = { open: new Set(), search: null, mode: null };
  let features = [], featById = new Map(), ruNames = {};

  const sideById = (id) => state.sides.find((s) => s.id === id);
  const findRegion = (rid) => {
    for (const s of state.sides) { const r = s.regions.find((x) => x.id === rid); if (r) return { side: s, region: r }; }
    return null;
  };
  const findByCode = (code) => {
    for (const s of state.sides) { const r = s.regions.find((x) => x.code === code); if (r) return { side: s, region: r }; }
    return null;
  };
  const countryName = (f) => ruNames[f.id] || RU_FALLBACK[f.properties.name] || f.properties.name;

  function serialize() {
    return {
      v: 1,
      sides: state.sides.map((s) => ({
        id: s.id, name: s.name, color: s.color,
        regions: s.regions.map((r) => ({
          id: r.id, name: r.name, code: r.code,
          // оригинальную геометрию страны не храним — только то, что изменили руками
          ...(r.edited || !r.code ? { geometry: r.geometry, edited: true } : {}),
        })),
      })),
    };
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(serialize())); }
    catch (e) { toast('Не удалось сохранить в браузере — сделай экспорт'); }
  }
  function hydrate(raw) {
    const sides = [];
    for (const s of raw.sides || []) {
      const regions = [];
      for (const r of s.regions || []) {
        let geometry = r.geometry, edited = !!r.edited;
        if (!geometry && r.code && featById.has(r.code)) geometry = clone(featById.get(r.code).geometry);
        if (!geometry) continue;
        regions.push({ id: r.id || uid(), name: r.name || 'Территория', code: r.code || null, geometry, edited });
      }
      sides.push({ id: s.id || uid(), name: s.name || 'Сторона', color: s.color || PALETTE[0], regions });
    }
    return { sides };
  }
  function load() {
    try { const raw = localStorage.getItem(STORE_KEY); if (raw) state = hydrate(JSON.parse(raw)); } catch (e) { /* пустое состояние */ }
  }

  // ---------- map ----------
  const map = L.map('map', {
    zoomControl: false, minZoom: 2, maxZoom: 9, zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 90,
    maxBounds: [[-62, -200], [88, 200]], maxBoundsViscosity: 0.85, worldCopyJump: false,
  });
  L.control.zoom({ position: 'topright' }).addTo(map);
  map.attributionControl.setPrefix(false);
  map.attributionControl.addAttribution('Данные: Natural Earth');
  map.pm.setLang('ru');
  map.pm.setGlobalOptions({ snappable: true, snapDistance: 14 });
  map.createPane('neutral').style.zIndex = 300;
  map.createPane('regions').style.zIndex = 400;
  map.fitBounds([[-50, -150], [78, 170]]);

  const neutralGroup = L.featureGroup().addTo(map);
  const regionsGroup = L.featureGroup().addTo(map);
  const labelsGroup = L.layerGroup().addTo(map);
  const layerByRid = new Map();
  const canvas = L.canvas({ pane: 'neutral' });

  const NEUTRAL = { color: '#314059', weight: 0.7, fillColor: '#1a2438', fillOpacity: 1 };
  const NEUTRAL_HOVER = { fillColor: '#2a3a58', color: '#4a5d82', weight: 1 };

  function buildNeutral() {
    for (const f of features) {
      const l = L.geoJSON(f, {
        pane: 'neutral', renderer: canvas, style: () => NEUTRAL, pmIgnore: true,
        onEachFeature: (_, layer) => {
          layer.bindTooltip(countryName(f), { sticky: true, className: 'hover-tip', direction: 'top', offset: [0, -6] });
          layer.on('mouseover', () => { if (!ui.mode || ui.mode.type === 'pick') layer.setStyle(NEUTRAL_HOVER); });
          layer.on('mouseout', () => layer.setStyle(NEUTRAL));
          layer.on('click', (e) => onNeutralClick(f, e));
        },
      });
      neutralGroup.addLayer(l);
    }
  }

  function regionStyle(side, hover) {
    return { color: '#ffffff', opacity: hover ? 0.9 : 0.5, weight: hover ? 1.8 : 1.2, fillColor: side.color, fillOpacity: hover ? 0.88 : 0.7, lineJoin: 'round' };
  }

  function rebuildRegions() {
    regionsGroup.clearLayers(); labelsGroup.clearLayers(); layerByRid.clear();
    for (const side of state.sides) {
      for (const region of side.regions) {
        const layer = L.geoJSON({ type: 'Feature', geometry: region.geometry, properties: {} }, { pane: 'regions', style: () => regionStyle(side) }).getLayers()[0];
        layer._rid = region.id;
        layer.on('mouseover', () => { if (!ui.mode) layer.setStyle(regionStyle(side, true)); });
        layer.on('mouseout', () => layer.setStyle(regionStyle(side)));
        layer.on('click', (e) => onRegionClick(region.id, e));
        regionsGroup.addLayer(layer);
        layerByRid.set(region.id, layer);
        labelsGroup.addLayer(L.tooltip({ permanent: true, direction: 'center', className: 'map-label', interactive: false })
          .setLatLng(labelPoint(region.geometry)).setContent(region.name));
      }
    }
    updateLabelVisibility();
  }
  function updateLabelVisibility() {
    map.getContainer().classList.toggle('labels-hidden', map.getZoom() < 3);
  }
  map.on('zoomend', updateLabelVisibility);

  // ---------- modes (pick / draw / edit) ----------
  const banner = $('#banner'), bannerText = $('#bannerText'), bannerActions = $('#bannerActions');

  function showBanner(text, actions) {
    bannerText.textContent = text;
    bannerActions.replaceChildren(...actions.map(([label, fn, cls]) => h('button', { class: 'btn ' + (cls || ''), onclick: fn }, label)));
    banner.hidden = false;
  }

  function endMode() {
    const m = ui.mode;
    if (!m) return;
    map.pm.disableDraw();
    if (m.type === 'edit') {
      const layer = layerByRid.get(m.rid);
      if (layer) {
        layer.pm.disable();
        layer.off('pm:edit', syncEdit); layer.off('pm:markerdragend', syncEdit);
        layer.off('pm:vertexadded', syncEdit); layer.off('pm:vertexremoved', syncEdit);
        if (m.dirty) syncGeometry(m.rid, layer);
      }
    }
    ui.mode = null;
    banner.hidden = true;
    map.getContainer().style.cursor = '';
    rebuildRegions();
    renderSides();
  }
  function setMode(m) { endMode(); ui.mode = m; }

  function startPick(sid) {
    setMode({ type: 'pick', sid });
    const side = sideById(sid);
    map.getContainer().style.cursor = 'crosshair';
    showBanner(`Кликай по странам — они попадут в «${side.name}»`, [['Готово', endMode, 'primary']]);
  }

  function startDraw(sid) {
    setMode({ type: 'draw', sid });
    const side = sideById(sid);
    map.pm.enableDraw('Polygon', {
      snappable: true, snapDistance: 16, allowSelfIntersection: false,
      templineStyle: { color: side.color, weight: 2 }, hintlineStyle: { color: side.color, dashArray: [6, 6], weight: 2 },
      pathOptions: { color: '#fff', fillColor: side.color, fillOpacity: 0.7, weight: 1.2 },
    });
    showBanner(`Рисуем территорию для «${side.name}»: ставь точки, замкни на первой`, [['Отмена', endMode]]);
  }

  map.on('pm:create', (e) => {
    if (!ui.mode || ui.mode.type !== 'draw' || e.shape !== 'Polygon') return;
    const side = sideById(ui.mode.sid);
    const geometry = e.layer.toGeoJSON(5).geometry;
    map.removeLayer(e.layer);
    const n = side.regions.filter((r) => !r.code).length + 1;
    side.regions.push({ id: uid(), name: `Территория ${n}`, code: null, geometry, edited: true });
    ui.open.add(side.id);
    save(); endMode();
    toast('Территория добавлена. Её границы можно менять ✎');
  });

  function startEdit(rid) {
    const found = findRegion(rid);
    if (!found) return;
    setMode({ type: 'edit', rid });
    map.closePopup();
    const layer = layerByRid.get(rid);
    if (!layer) { ui.mode = null; return; }
    layer.setStyle(regionStyle(found.side, true));
    const b = layer.getBounds();
    const diag = Math.hypot(b.getEast() - b.getWest(), b.getNorth() - b.getSouth());
    layer.setLatLngs(simplifyLatLngs(layer.getLatLngs(), Math.min(0.15, Math.max(0.008, diag / 300))));
    layer.pm.enable({ snappable: true, snapDistance: 14, allowSelfIntersection: true });
    for (const ev of ['pm:edit', 'pm:markerdragend', 'pm:vertexadded', 'pm:vertexremoved']) layer.on(ev, syncEdit);
    map.fitBounds(layer.getBounds(), { maxZoom: 6, padding: [80, 80] });
    const acts = [['Вырезать', toggleCut]];
    if (found.region.code) acts.push(['Вернуть реальные', () => resetBorders(rid)]);
    acts.push(['Готово', () => { endMode(); toast('Границы сохранены'); }, 'primary']);
    showBanner(`Правка: ${found.region.name} — тащи точки, тяни середины рёбер, ПКМ по точке удаляет`, acts);
  }

  function syncGeometry(rid, layer) {
    const f = findRegion(rid);
    if (!f || !layer) return;
    f.region.geometry = layer.toGeoJSON(5).geometry;
    f.region.edited = true;
    save();
  }
  function syncEdit() {
    if (!ui.mode || ui.mode.type !== 'edit') return;
    ui.mode.dirty = true;
    syncGeometry(ui.mode.rid, layerByRid.get(ui.mode.rid));
  }

  let cutting = false;
  function toggleCut() {
    cutting = !cutting;
    if (cutting) {
      map.pm.enableDraw('Cut', { allowSelfIntersection: false, snappable: true });
      toast('Обведи область, которую нужно вырезать');
    } else map.pm.disableDraw();
  }
  map.on('pm:cut', (e) => {
    cutting = false;
    map.pm.disableDraw();
    if (!ui.mode || ui.mode.type !== 'edit') return;
    const rid = ui.mode.rid;
    const f = findRegion(rid);
    if (!f) return;
    f.region.geometry = e.layer.toGeoJSON(5).geometry;
    f.region.edited = true;
    save();
    // слой мог быть заменён — пересобираем (не читая старый слой) и продолжаем правку
    const old = layerByRid.get(rid);
    try { old.pm.disable(); } catch (err) { /* слой уже убран */ }
    ui.mode = null; banner.hidden = true;
    rebuildRegions(); renderSides();
    startEdit(rid);
  });

  function resetBorders(rid) {
    const f = findRegion(rid);
    if (!f || !f.region.code) return;
    f.region.geometry = clone(featById.get(f.region.code).geometry);
    f.region.edited = false;
    save();
    endMode();
    setTimeout(() => startEdit(rid), 0);
    toast('Границы возвращены к реальным');
  }

  // ---------- operations ----------
  function assignCountry(code, sid, opts = {}) {
    const side = sideById(sid), feat = featById.get(code);
    if (!side || !feat) return false;
    const ex = findByCode(code);
    if (ex) {
      if (ex.side.id === sid) { toast(`${ex.region.name} уже в «${side.name}»`); return false; }
      ex.side.regions.splice(ex.side.regions.indexOf(ex.region), 1);
      side.regions.push(ex.region);
    } else {
      side.regions.push({ id: uid(), name: countryName(feat), code, geometry: clone(feat.geometry), edited: false });
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
    f.side.regions.splice(f.side.regions.indexOf(f.region), 1);
    to.regions.push(f.region);
    save(); rebuildRegions(); renderSides();
  }
  function removeRegion(rid) {
    const f = findRegion(rid);
    if (!f) return;
    f.side.regions.splice(f.side.regions.indexOf(f.region), 1);
    map.closePopup();
    save(); rebuildRegions(); renderSides();
  }
  function deleteSide(sid) {
    const s = sideById(sid);
    if (!s) return;
    if (s.regions.length && !confirm(`Удалить сторону «${s.name}» вместе с ${s.regions.length} терр.?`)) return;
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

  function onNeutralClick(f, e) {
    const m = ui.mode;
    if (m && m.type !== 'pick') return; // рисуем/правим — пусть событие идёт к карте
    L.DomEvent.stopPropagation(e);
    if (m && m.type === 'pick') { assignCountry(f.id, m.sid); return; }
    const code = f.id;
    const ex = findByCode(code);
    const box = h('div', {}, h('div', { class: 'pop-title' }, countryName(f)));
    if (!state.sides.length) {
      box.append(h('div', { class: 'pop-note' }, 'Сначала создай сторону кнопкой «+» слева.'));
    } else {
      box.append(h('div', { class: 'pop-sub' }, ex ? 'Часть территории уже занята. Добавить целиком в:' : 'Нейтральная страна. Добавить в:'));
      box.append(h('div', { class: 'pop-list' }, state.sides.map((s) => chip(s, s.name, () => { map.closePopup(); assignCountry(code, s.id); }))));
    }
    L.popup({ closeButton: true, offset: [0, -2] }).setLatLng(e.latlng).setContent(box).openOn(map);
  }

  function onRegionClick(rid, e) {
    const m = ui.mode;
    if (m && m.type === 'pick') {
      L.DomEvent.stopPropagation(e);
      const f = findRegion(rid);
      if (f && f.region.code) assignCountry(f.region.code, m.sid);
      return;
    }
    if (m) return;
    L.DomEvent.stopPropagation(e);
    const f = findRegion(rid);
    if (!f) return;
    const box = h('div', {},
      h('div', { class: 'pop-title' }, f.region.name),
      h('div', { class: 'pop-sub' }, h('i', { style: `background:${f.side.color}` }), f.side.name),
      h('div', { class: 'pop-list' },
        chip(null, '✎  Изменить границы', () => startEdit(rid)),
        ...state.sides.filter((s) => s !== f.side).map((s) => chip(s, `Передать: ${s.name}`, () => { map.closePopup(); moveRegion(rid, s.id); })),
        chip(null, 'Убрать со стороны', () => removeRegion(rid), 'danger')));
    L.popup({ closeButton: true, offset: [0, -2] }).setLatLng(e.latlng).setContent(box).openOn(map);
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
    const nameEl = h('div', { class: 'side-name', title: 'Двойной клик — переименовать' }, side.name);
    const rename = () => editableName(nameEl, side.name, (v) => { side.name = v; save(); rebuildRegions(); renderSides(); });
    nameEl.addEventListener('dblclick', (e) => { e.stopPropagation(); rename(); });

    const colorInput = h('input', { type: 'color', value: side.color, title: 'Цвет стороны' });
    colorInput.addEventListener('change', () => { side.color = colorInput.value; save(); rebuildRegions(); renderSides(); });
    const dot = h('span', { class: 'dot', style: `background:${side.color}`, onclick: (e) => e.stopPropagation() }, colorInput);

    const top = h('div', { class: 'side-top', onclick: () => { ui.open.has(side.id) ? ui.open.delete(side.id) : ui.open.add(side.id); renderSides(); } },
      dot, nameEl, h('span', { class: 'count' }, String(side.regions.length)), h('span', { class: 'chev' }, icon('chev')));

    const searching = ui.search === side.id;
    const actions = h('div', { class: 'side-actions' },
      h('button', { class: 'chip-btn accent', onclick: () => { ui.search = searching ? null : side.id; renderSides(); } }, icon('plus', 14), 'Страна'),
      h('button', { class: 'chip-btn', title: 'Добавлять страны кликом по карте', onclick: () => startPick(side.id) }, icon('cursor', 14), 'По карте'),
      h('button', { class: 'chip-btn', title: 'Нарисовать свою территорию', onclick: () => startDraw(side.id) }, icon('pen', 14), 'Рисовать'),
      h('button', { class: 'chip-btn', onclick: rename }, 'Имя'),
      h('button', { class: 'chip-btn danger', onclick: () => deleteSide(side.id) }, icon('trash', 14)));

    const body = h('div', { class: 'side-body' }, actions);
    if (searching) body.append(searchBox(side));

    body.append(side.regions.length
      ? h('ul', { class: 'regions' }, side.regions.map((r) => regionRow(side, r)))
      : h('div', { class: 'none' }, 'Пока пусто — добавь страны.'));

    return h('div', { class: 'side' + (open ? ' open' : ''), style: `--c:${side.color}` }, top, body);
  }

  function regionRow(side, r) {
    const nameEl = h('span', { class: 'rn', title: 'Показать на карте' }, r.name);
    nameEl.addEventListener('click', () => flyToRegion(r.id));
    nameEl.addEventListener('dblclick', () => editableName(nameEl, r.name, (v) => { r.name = v; save(); rebuildRegions(); renderSides(); }));
    return h('li', { class: 'region' },
      nameEl,
      r.code ? (r.edited ? h('span', { class: 'tag' }, 'изменена') : null) : h('span', { class: 'tag' }, 'своя'),
      h('button', { class: 'icon-btn', title: 'Изменить границы', onclick: () => startEdit(r.id) }, icon('edit', 15)),
      h('button', { class: 'icon-btn danger', title: 'Убрать', onclick: () => removeRegion(r.id) }, icon('trash', 15)));
  }

  function searchBox(side) {
    const input = h('input', { type: 'text', placeholder: 'Найти страну…', autocomplete: 'off' });
    const results = h('div', { class: 'results' });
    let idx = 0, list = [];
    const refresh = () => {
      const q = input.value.trim().toLowerCase();
      results.hidden = !q;
      list = !q ? [] : features
        .map((f) => ({ f, n: countryName(f) }))
        .filter(({ f, n }) => n.toLowerCase().includes(q) || f.properties.name.toLowerCase().includes(q))
        .sort((a, b) => a.n.localeCompare(b.n, 'ru')).slice(0, 60);
      idx = Math.min(idx, Math.max(list.length - 1, 0));
      results.replaceChildren(...(list.length ? list.map(({ f, n }, i) => {
        const ex = findByCode(f.id);
        const here = ex && ex.side.id === side.id;
        return h('button', { type: 'button', class: 'result' + (i === idx ? ' active' : ''), disabled: here, onclick: () => pickResult(f) },
          n, ex ? h('small', {}, h('i', { style: `background:${ex.side.color}` }), here ? 'уже здесь' : ex.side.name) : null);
      }) : [h('div', { class: 'no-res' }, 'Ничего не найдено')]));
    };
    const pickResult = (f) => { assignCountry(f.id, side.id, { fly: true }); };
    input.addEventListener('input', () => { idx = 0; refresh(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { idx = Math.min(idx + 1, list.length - 1); refresh(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { idx = Math.max(idx - 1, 0); refresh(); e.preventDefault(); }
      else if (e.key === 'Enter' && list[idx]) { e.preventDefault(); pickResult(list[idx].f); }
      else if (e.key === 'Escape') { e.stopPropagation(); ui.search = null; renderSides(); }
    });
    refresh();
    return h('div', { class: 'search' }, input, results);
  }

  // ---------- new side form ----------
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
    const side = { id: uid(), name, color: chosenColor, regions: [] };
    state.sides.push(side);
    ui.open.add(side.id); ui.search = side.id;
    sideForm.hidden = true;
    save(); renderSides();
  });

  // ---------- export / import / reset ----------
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
      endMode();
      state = hydrate(raw); ui.open.clear(); ui.search = null;
      save(); rebuildRegions(); renderSides();
      toast('Карта загружена');
    } catch (err) { toast('Не получилось прочитать файл'); }
  });
  $('#resetBtn').addEventListener('click', () => {
    if (!confirm('Стереть все стороны и границы?')) return;
    endMode();
    state = { sides: [] }; ui.open.clear(); ui.search = null;
    save(); rebuildRegions(); renderSides();
  });

  // ---------- misc ----------
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ui.mode) endMode(); });
  $('#panelToggle').addEventListener('click', () => document.body.classList.add('panel-open'));
  map.on('click', () => { if (window.innerWidth <= 760 && !ui.mode) document.body.classList.remove('panel-open'); });

  // ---------- boot ----------
  async function boot() {
    try {
      const [topo, names] = await Promise.all([
        fetch('data/countries.json').then((r) => r.json()),
        fetch('data/names-ru.json').then((r) => r.json()),
      ]);
      ruNames = names;
      features = topojson.feature(topo, topo.objects.countries).features.filter((f) => f.id !== '010'); // без Антарктиды
      features.forEach((f, i) => { if (!f.id) f.id = 'x' + i; featById.set(f.id, f); });
    } catch (err) {
      toast('Не удалось загрузить данные карты. Открой сайт через веб-сервер.');
      console.error(err);
      return;
    }
    buildNeutral();
    load();
    rebuildRegions();
    renderSides();
    state.sides.forEach((s) => ui.open.add(s.id));
    renderSides();
  }
  boot();
})();
