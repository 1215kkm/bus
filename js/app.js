/* Seoul Bus 3D — 지도·애니메이션·UI 본체 */
(function () {
  const G = window.SB_GEO, S = window.SB_SIM, TYPES = window.SB_ROUTE_TYPES, CITIES = window.SB_CITIES;

  /* ── 설정 ─────────────────────────────────────────── */
  const STYLE = {
    dark: 'https://tiles.openfreemap.org/styles/dark',
    light: 'https://tiles.openfreemap.org/styles/positron',
  };
  const RASTER_FALLBACK = theme => ({
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    sources: {
      carto: {
        type: 'raster', tileSize: 256, maxzoom: 19,
        tiles: ['a', 'b', 'c', 'd'].map(s => `https://${s}.basemaps.cartocdn.com/${theme === 'dark' ? 'dark_all' : 'light_all'}/{z}/{x}/{y}.png`),
        attribution: '© OpenStreetMap contributors © CARTO',
      },
    },
    layers: [{ id: 'carto', type: 'raster', source: 'carto' }],
  });
  const RATES = [1, 5, 20, 60];

  /* ── 상태 ─────────────────────────────────────────── */
  let routes = [], routeById = {}, sim = new S.Simulation([]);
  const state = {
    city: (new URLSearchParams(location.search).get('city') in CITIES) ? new URLSearchParams(location.search).get('city') : (load('city', 'seoul') in CITIES ? load('city', 'seoul') : 'seoul'),
    theme: load('theme', 'dark'),
    hidden: new Set(),
    buildings: load('buildings', true),
    showStops: true,
    rate: 1,
    playing: true,
    realtime: true,          // 벽시계와 동기화
    simTime: Date.now(),
    liveMode: false,
    selectedBus: null,
    selectedRoute: null,
    isolate: false,
    follow: false,
    fontStack: ['Noto Sans Bold'],
    styleReady: false,
  };
  const live = new window.SB_LIVE.LiveFeed(sim, () => { refreshRouteSources(); });
  const HOME = () => CITIES[state.city].camera;

  /* ── DOM ──────────────────────────────────────────── */
  const $ = id => document.getElementById(id);
  const el = {
    clock: $('clock'), q: $('q'), results: $('results'), card: $('card'), legend: $('legend'), legendList: $('legendList'),
    status: $('status'), tlTime: $('tlTime'), tlRange: $('tlRange'), tlRate: $('tlRate'), btnNow: $('btnNow'),
    btnPlay: $('btnPlay'), iconPlay: $('iconPlay'), iconPause: $('iconPause'), help: $('help'), toast: $('toast'),
    btnTheme: $('btnTheme'), btnBuildings: $('btnBuildings'), btnRate: $('btnRate'), btnStops: $('btnStops'),
    btnLive: $('btnLive'), btnLegend: $('btnLegend'), citySel: $('city'), sub: $('sub'),
  };
  document.documentElement.dataset.theme = state.theme;

  /* ── 지도 ─────────────────────────────────────────── */
  // 네트워크 없이 즉시 뜨는 빈 스타일로 시작 → 노선·버스는 바로 보이고, 배경 지도는 loadStyle 이 받아오는 대로 교체
  const EMPTY_STYLE = { version: 8, glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf', sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': state.theme === 'dark' ? '#0b0f16' : '#e9edf3' } }] };
  const map = new maplibregl.Map({
    container: 'map',
    style: EMPTY_STYLE,
    center: HOME().center, zoom: HOME().zoom, pitch: HOME().pitch, bearing: HOME().bearing,
    maxPitch: 75, minZoom: 6.5, maxZoom: 19, antialias: true,
    attributionControl: false,
    maxBounds: [[123.5, 32.5], [132.5, 39.5]],   // 대한민국 전역
  });
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  map.on('error', e => { if (e && e.error && /style/i.test(String(e.error.message))) console.warn(e.error.message); });

  async function loadStyle(theme) {
    let style = RASTER_FALLBACK(theme);
    let fontStack = ['Open Sans Semibold'];
    try {
      const res = await fetch(STYLE[theme], { mode: 'cors' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      style = await res.json();
      fontStack = ['Noto Sans Bold'];
    } catch (e) {
      console.warn('벡터 스타일을 불러오지 못해 래스터 지도로 대체합니다:', e.message);
      toast('벡터 지도 스타일을 불러오지 못해 기본 지도로 표시합니다');
    }
    state.fontStack = fontStack;
    state.styleReady = false;
    map.setStyle(style, { diff: false });
  }
  map.on('style.load', () => { addOverlays(); state.styleReady = true; lastBusPush = 0; });
  loadStyle(state.theme);

  /* ── 오버레이 레이어 ─────────────────────────────── */
  function firstSymbolLayer() {
    const layers = map.getStyle().layers || [];
    const s = layers.find(l => l.type === 'symbol');
    return s ? s.id : undefined;
  }

  function addOverlays() {
    const beforeLabels = firstSymbolLayer();
    const dark = state.theme === 'dark';

    // 3D 건물 (벡터 스타일일 때만)
    const styleSources = (map.getStyle() && map.getStyle().sources) || {};
    const vectorSrc = Object.keys(styleSources).find(id => styleSources[id].type === 'vector');
    if (vectorSrc) {
      map.addLayer({
        id: 'sb-buildings', type: 'fill-extrusion', source: vectorSrc, 'source-layer': 'building', minzoom: 13,
        layout: { visibility: state.buildings ? 'visible' : 'none' },
        paint: {
          'fill-extrusion-color': dark ? '#2a3140' : '#d9dee6',
          'fill-extrusion-height': ['interpolate', ['linear'], ['zoom'], 13, 0, 14.5, ['coalesce', ['get', 'render_height'], 12]],
          'fill-extrusion-base': ['interpolate', ['linear'], ['zoom'], 13, 0, 14.5, ['coalesce', ['get', 'render_min_height'], 0]],
          'fill-extrusion-opacity': dark ? 0.75 : 0.8,
          'fill-extrusion-vertical-gradient': true,
        },
      }, beforeLabels);
    }

    map.addSource('sb-routes', { type: 'geojson', data: routeFC() });
    map.addSource('sb-stops', { type: 'geojson', data: stopFC() });
    map.addSource('sb-buses', { type: 'geojson', data: emptyFC() });
    map.addSource('sb-bus-pts', { type: 'geojson', data: emptyFC() });
    map.addSource('sb-focus', { type: 'geojson', data: emptyFC() });

    const dim = ['case', ['boolean', ['get', 'dim'], false], 0.18, 1];
    map.addLayer({
      id: 'sb-route-glow', type: 'line', source: 'sb-routes',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'], 'line-blur': 6,
        'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 10, 4, 14, 12, 17, 26],
        'line-opacity': ['*', dark ? 0.28 : 0.18, dim],
      },
    }, beforeLabels);
    map.addLayer({
      id: 'sb-route-line', type: 'line', source: 'sb-routes',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 10, 1.4, 13, 3, 16, 6, 18, 10],
        'line-opacity': ['*', 0.95, dim],
      },
    }, beforeLabels);
    map.addLayer({   // 클릭 판정용 넓은 투명선
      id: 'sb-route-hit', type: 'line', source: 'sb-routes',
      paint: { 'line-color': '#000', 'line-opacity': 0.001, 'line-width': 16 },
    }, beforeLabels);

    map.addLayer({
      id: 'sb-stops', type: 'circle', source: 'sb-stops', minzoom: 12.2,
      layout: { visibility: state.showStops ? 'visible' : 'none' },
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 12.2, 1.5, 14, 3.2, 17, 6],
        'circle-color': dark ? '#0f131b' : '#ffffff',
        'circle-stroke-color': ['get', 'color'],
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 12.2, 1, 15, 2],
        'circle-opacity': ['interpolate', ['linear'], ['zoom'], 12.2, 0, 13, 1],
        'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 12.2, 0, 13, 1],
      },
    });
    map.addLayer({
      id: 'sb-stop-labels', type: 'symbol', source: 'sb-stops', minzoom: 14.8,
      layout: {
        visibility: state.showStops ? 'visible' : 'none',
        'text-field': ['get', 'name'], 'text-font': state.fontStack, 'text-size': 11,
        'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-optional': true,
      },
      paint: { 'text-color': dark ? '#c9d1de' : '#3b4453', 'text-halo-color': dark ? '#0b0f16' : '#ffffff', 'text-halo-width': 1.2 },
    });
    map.addLayer({
      id: 'sb-focus', type: 'circle', source: 'sb-focus',
      paint: { 'circle-radius': 14, 'circle-color': '#ffb547', 'circle-opacity': 0.25, 'circle-stroke-color': '#ffb547', 'circle-stroke-width': 2 },
    });

    // 버스 차체(3D 압출)
    map.addLayer({
      id: 'sb-bus-body', type: 'fill-extrusion', source: 'sb-buses',
      paint: {
        'fill-extrusion-color': ['get', 'color'],
        'fill-extrusion-height': ['get', 'h'],
        'fill-extrusion-base': ['get', 'b'],
        'fill-extrusion-opacity': 0.96,
        'fill-extrusion-vertical-gradient': true,
      },
    });
    map.addLayer({
      id: 'sb-bus-halo', type: 'circle', source: 'sb-bus-pts', filter: ['==', ['get', 'sel'], 1],
      paint: { 'circle-radius': 22, 'circle-color': '#ffffff', 'circle-opacity': 0.12, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5, 'circle-stroke-opacity': 0.6, 'circle-pitch-alignment': 'map' },
    }, 'sb-bus-body');
    map.addLayer({
      id: 'sb-bus-labels', type: 'symbol', source: 'sb-bus-pts', minzoom: 14.2,
      layout: {
        'text-field': ['get', 'num'], 'text-font': state.fontStack, 'text-size': 11,
        'text-offset': [0, -1.6], 'text-anchor': 'bottom', 'text-allow-overlap': false, 'text-optional': true,
      },
      paint: { 'text-color': '#ffffff', 'text-halo-color': ['get', 'color'], 'text-halo-width': 1.6 },
    });

    // 상호작용
    for (const id of ['sb-bus-body', 'sb-route-hit', 'sb-stops']) {
      map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
    }
    applyDim();
  }

  function emptyFC() { return { type: 'FeatureCollection', features: [] }; }

  function routeFC() {
    return {
      type: 'FeatureCollection',
      features: routes.filter(r => !state.hidden.has(r.id)).map(r => ({
        type: 'Feature',
        properties: { id: r.id, num: r.num, color: r.color, dim: !!(state.selectedRoute && state.selectedRoute !== r.id) },
        geometry: { type: 'LineString', coordinates: r.pts },
      })),
    };
  }

  function stopFC() {
    const seen = new Map();
    for (const r of routes) {
      if (state.hidden.has(r.id)) continue;
      if (state.isolate && state.selectedRoute && r.id !== state.selectedRoute) continue;
      for (const s of r.stops) {
        const key = s.name + '@' + s.lng.toFixed(3) + ',' + s.lat.toFixed(3);
        if (!seen.has(key)) seen.set(key, { type: 'Feature', properties: { name: s.name, color: r.color, routes: r.num }, geometry: { type: 'Point', coordinates: [s.lng, s.lat] } });
        else seen.get(key).properties.routes += ', ' + r.num;
      }
    }
    return { type: 'FeatureCollection', features: [...seen.values()] };
  }

  function refreshRouteSources() {
    if (!state.styleReady) return;
    const rs = map.getSource('sb-routes'), ss = map.getSource('sb-stops');
    if (rs) rs.setData(routeFC());
    if (ss) ss.setData(stopFC());
  }

  function applyDim() { refreshRouteSources(); }

  map.on('click', e => {
    const hit = map.queryRenderedFeatures(e.point, { layers: ['sb-bus-body', 'sb-route-hit', 'sb-stops'].filter(l => map.getLayer(l)) });
    const bus = hit.find(f => f.layer.id === 'sb-bus-body');
    if (bus) return selectBus(sim.buses.find(b => b.id === bus.properties.id));
    const stop = hit.find(f => f.layer.id === 'sb-stops');
    if (stop) return focusStop(stop.properties.name, stop.geometry.coordinates, stop.properties.routes);
    const line = hit.find(f => f.layer.id === 'sb-route-hit');
    if (line) return selectRoute(line.properties.id);
    clearSelection();
  });
  map.on('dragstart', () => { if (state.follow) { state.follow = false; renderCard(); } });

  /* ── 프레임 루프 ─────────────────────────────────── */
  let lastReal = performance.now(), lastBusPush = 0, lastUi = 0;
  function frame(now) {
    try { step(now); } catch (e) { console.error('[frame]', e); }
    requestAnimationFrame(frame);
  }
  function step(now) {
    const dtReal = Math.min(0.25, (now - lastReal) / 1000);
    lastReal = now;

    if (state.liveMode) {
      state.simTime = Date.now();
      live.tick();
    } else if (state.realtime) {
      state.simTime = Date.now();
      sim.tick(dtReal, state.simTime);
    } else if (state.playing) {
      const dtSim = Math.min(5, dtReal * state.rate);
      state.simTime += dtSim * 1000;
      sim.tick(dtSim, state.simTime);
    }

    if (now - lastBusPush > 40 && state.styleReady) {
      lastBusPush = now;
      pushBuses();
      if (state.follow && state.selectedBus) {
        const p = G.pointAt(state.selectedBus.route, state.selectedBus.d);
        map.setCenter([p.lng, p.lat]);
      }
    }
    if (now - lastUi > 250) { lastUi = now; updateClock(); updateStatus(); renderCard(false); }
  }
  requestAnimationFrame(frame);

  function pushBuses() {
    const bodySrc = map.getSource('sb-buses'), ptSrc = map.getSource('sb-bus-pts');
    if (!bodySrc || !ptSrc) return;
    const zoom = map.getZoom();
    const bodies = [], pts = [];
    const bounds = map.getBounds();
    const pad = 0.05;
    for (const bus of sim.buses) {
      const r = bus.route;
      if (state.hidden.has(r.id)) continue;
      if (state.isolate && state.selectedRoute && r.id !== state.selectedRoute) continue;
      const p = G.pointAt(r, bus.d);
      if (p.lng < bounds.getWest() - pad || p.lng > bounds.getEast() + pad || p.lat < bounds.getSouth() - pad || p.lat > bounds.getNorth() + pad) continue;
      const heading = bus.dir === 1 ? p.heading : (p.heading + 180) % 360;
      const mpp = G.metersPerPixel(p.lat, zoom);
      const L = Math.max(11, 15 * mpp);
      const W = L * 0.36;
      const H = Math.max(3.4, W * 0.85);
      const [lng, lat] = G.move(p.lng, p.lat, heading, 0, W * 0.75 + 1.5);   // 우측 통행
      const sel = state.selectedBus === bus;
      const color = sel ? '#ffd166' : r.color;
      bodies.push({
        type: 'Feature', properties: { id: bus.id, color, h: H, b: 0 },
        geometry: { type: 'Polygon', coordinates: G.boxPolygon(lng, lat, heading, L, W) },
      });
      bodies.push({
        type: 'Feature', properties: { id: bus.id, color: lighten(color, sel ? 0.1 : 0.28), h: H * 1.18, b: H },
        geometry: { type: 'Polygon', coordinates: G.boxPolygon(lng, lat, heading, L * 0.82, W * 0.7) },
      });
      pts.push({ type: 'Feature', properties: { id: bus.id, num: r.num, color: r.color, sel: sel ? 1 : 0 }, geometry: { type: 'Point', coordinates: [lng, lat] } });
    }
    bodySrc.setData({ type: 'FeatureCollection', features: bodies });
    ptSrc.setData({ type: 'FeatureCollection', features: pts });
  }

  /* ── 선택 ────────────────────────────────────────── */
  function selectBus(bus) {
    if (!bus) return;
    state.selectedBus = bus; state.selectedRoute = bus.route.id; state.isolate = false;
    applyDim(); renderCard(true); highlightLegend();
  }
  function selectRoute(id, fit) {
    state.selectedBus = null; state.follow = false; state.selectedRoute = id;
    applyDim(); renderCard(true); highlightLegend();
    if (fit) fitRoute(routeById[id]);
  }
  function clearSelection() {
    state.selectedBus = null; state.selectedRoute = null; state.isolate = false; state.follow = false;
    el.card.classList.remove('open');
    setFocus(null);
    applyDim(); highlightLegend();
  }
  function fitRoute(r) {
    map.fitBounds(G.bboxOf(r), { padding: { top: 90, bottom: 120, left: 360, right: 90 }, pitch: 50, bearing: map.getBearing(), duration: 1200, maxZoom: 14.5 });
  }
  function focusStop(name, coords, routesStr) {
    setFocus(coords);
    map.flyTo({ center: coords, zoom: Math.max(map.getZoom(), 16.2), pitch: 60, duration: 1400 });
    toast(`${name} · 경유 노선 ${routesStr}`);
  }
  function setFocus(coords) {
    const src = map.getSource('sb-focus');
    if (src) src.setData(coords ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: coords } }] } : emptyFC());
  }

  function renderCard(force) {
    if (!state.selectedBus && !state.selectedRoute) return;
    if (!force && !el.card.classList.contains('open')) return;
    if (state.selectedBus && !sim.buses.includes(state.selectedBus)) { state.selectedBus = null; state.follow = false; }
    el.card.classList.add('open');
    if (state.selectedBus) return renderBusCard(state.selectedBus);
    renderRouteCard(routeById[state.selectedRoute]);
  }

  function renderBusCard(bus) {
    const r = bus.route;
    const next = sim.nextStop(bus);
    const dest = r.loop ? `${r.to} (순환)` : (bus.dir === 1 ? r.to : r.from);
    const stateLabel = { run: '운행 중', stop: '정류장 정차', layover: '종점 대기', retire: '차고지 회송' }[bus.state] || '운행 중';
    const kmh = Math.round(bus.speed * 3.6);
    el.card.style.setProperty('--route-color', r.color);
    el.card.innerHTML = `
      <div class="head">
        <span class="chip" style="background:${r.color}">${r.num}</span>
        <div><div class="title">${TYPES[r.type].label}버스 · ${dest} 방면</div><div class="tag">${bus.plate}${bus.live ? ' · 실시간' : ''}</div></div>
        <button class="close" title="닫기">×</button>
      </div>
      <div class="grid">
        <div class="kv"><div class="k">다음 정류장</div><div class="v">${next ? next.name : '-'}</div></div>
        <div class="kv"><div class="k">상태</div><div class="v">${stateLabel}</div></div>
        <div class="kv"><div class="k">속도</div><div class="v mono">${kmh} km/h</div></div>
        <div class="kv"><div class="k">노선 진행률</div><div class="v mono">${Math.round((r.loop ? bus.d : (bus.dir === 1 ? bus.d : r.total - bus.d)) / r.total * 100)} %</div></div>
      </div>
      <div class="row-btns">
        <button data-act="follow" class="${state.follow ? 'on' : ''}">${state.follow ? '따라가는 중' : '따라가기'}</button>
        <button data-act="route">노선 정보</button>
      </div>`;
    el.card.querySelector('.close').onclick = clearSelection;
    el.card.querySelector('[data-act=follow]').onclick = () => {
      state.follow = !state.follow;
      if (state.follow) { const p = G.pointAt(r, bus.d); map.easeTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 15.5), pitch: 62, duration: 900 }); }
      renderCard(true);
    };
    el.card.querySelector('[data-act=route]').onclick = () => selectRoute(r.id, true);
  }

  function renderRouteCard(r) {
    const buses = sim.buses.filter(b => b.routeId === r.id);
    const hour = S.hourOf(state.simTime);
    const headway = Math.round(r.headway * S.headwayFactor(hour, r));
    const passed = new Map();   // stop index → 버스 수
    for (const b of buses) {
      let idx = -1;
      for (let i = 0; i < r.stops.length; i++) if (r.stops[i].d <= b.d + 1) idx = i;
      if (idx >= 0) passed.set(idx, (passed.get(idx) || 0) + 1);
    }
    el.card.style.setProperty('--route-color', r.color);
    el.card.innerHTML = `
      <div class="head">
        <span class="chip" style="background:${r.color}">${r.num}</span>
        <div><div class="title">${r.from} ${r.loop ? '→' : '↔'} ${r.to}</div><div class="tag">${TYPES[r.type].label}버스 · ${r.realShape ? '실제 노선 형상' : '근사 노선 형상'} · ${(r.total / 1000).toFixed(1)} km</div></div>
        <button class="close" title="닫기">×</button>
      </div>
      <div class="grid">
        <div class="kv"><div class="k">운행 중</div><div class="v">${buses.length}대</div></div>
        <div class="kv"><div class="k">배차 간격</div><div class="v">${S.inService(hour, r) ? headway + '분' : '운행 종료'}</div></div>
        <div class="kv"><div class="k">정류장</div><div class="v">${r.stops.length}개</div></div>
        <div class="kv"><div class="k">평균 속도</div><div class="v mono">${r.speed} km/h</div></div>
      </div>
      <div class="row-btns">
        <button data-act="isolate" class="${state.isolate ? 'on' : ''}">이 노선만 보기</button>
        <button data-act="fit">전체 보기</button>
      </div>
      <ul class="stops">${r.stops.map((s, i) => `<li${passed.has(i) ? ' class="here"' : ''}>${passed.has(i) ? '<span class="bus-mark">🚌</span>' : ''}${s.name}</li>`).join('')}</ul>`;
    el.card.querySelector('.close').onclick = clearSelection;
    el.card.querySelector('[data-act=isolate]').onclick = () => { state.isolate = !state.isolate; refreshRouteSources(); renderCard(true); };
    el.card.querySelector('[data-act=fit]').onclick = () => fitRoute(r);
  }

  /* ── 범례 ────────────────────────────────────────── */
  function buildLegend() {
    const groups = Object.entries(TYPES).sort((a, b) => a[1].order - b[1].order);
    el.legendList.innerHTML = groups.map(([type, t]) => {
      const rs = routes.filter(r => r.type === type);
      if (!rs.length) return '';
      return `<div class="group">${t.label}</div><div class="rows">${rs.map(r => `
        <div class="row${state.hidden.has(r.id) ? ' off' : ''}" data-id="${r.id}" title="클릭: 켜고 끄기 · 더블클릭: 노선 정보" style="color:${r.color}">
          <span class="sw" style="background:${r.color}"></span><span style="color:var(--text)">${r.num}</span><span class="n" data-count></span>
        </div>`).join('')}</div>`;
    }).join('');
    el.legendList.querySelectorAll('.row').forEach(row => {
      row.addEventListener('click', () => toggleRoute(row.dataset.id));
      row.addEventListener('dblclick', e => { e.preventDefault(); if (state.hidden.has(row.dataset.id)) toggleRoute(row.dataset.id); selectRoute(row.dataset.id, true); });
    });
  }
  function toggleRoute(id) {
    if (state.hidden.has(id)) state.hidden.delete(id); else state.hidden.add(id);
    save('hidden:' + state.city, [...state.hidden]);
    el.legendList.querySelector(`.row[data-id="${id}"]`).classList.toggle('off', state.hidden.has(id));
    refreshRouteSources();
  }
  function highlightLegend() {
    el.legendList.querySelectorAll('.row').forEach(row => row.classList.toggle('sel', row.dataset.id === state.selectedRoute));
  }
  function updateLegendCounts() {
    const counts = {};
    for (const b of sim.buses) counts[b.routeId] = (counts[b.routeId] || 0) + 1;
    el.legendList.querySelectorAll('.row').forEach(row => { row.querySelector('[data-count]').textContent = counts[row.dataset.id] ? counts[row.dataset.id] + '대' : ''; });
  }
  $('legendAll').onclick = () => { state.hidden.clear(); save('hidden:' + state.city, []); buildLegend(); refreshRouteSources(); };
  $('legendNone').onclick = () => { routes.forEach(r => state.hidden.add(r.id)); save('hidden:' + state.city, [...state.hidden]); buildLegend(); refreshRouteSources(); };

  /* ── 검색 ────────────────────────────────────────── */
  let index = [], stopCount = 0;
  function buildSearchIndex() {
    index = [];
    routes.forEach(r => index.push({ kind: 'route', key: r.num.toLowerCase(), label: r.num, meta: `${r.from} ${r.loop ? '→' : '↔'} ${r.to}`, color: r.color, id: r.id }));
    const stopSeen = new Map();
    routes.forEach(r => r.stops.forEach(s => {
      const k = s.name;
      if (!stopSeen.has(k)) stopSeen.set(k, { kind: 'stop', key: k.toLowerCase(), label: k, coords: [s.lng, s.lat], nums: [r.num] });
      else if (!stopSeen.get(k).nums.includes(r.num)) stopSeen.get(k).nums.push(r.num);
    }));
    index.push(...stopSeen.values());
    stopCount = stopSeen.size;
    el.q.value = ''; closeResults();
  }
  let activeIdx = -1, currentResults = [];

  el.q.addEventListener('input', () => {
    const q = el.q.value.trim().toLowerCase();
    if (!q) return closeResults();
    currentResults = index.filter(i => i.key.includes(q)).sort((a, b) => (a.key.startsWith(q) ? 0 : 1) - (b.key.startsWith(q) ? 0 : 1) || (a.kind === 'route' ? -1 : 1)).slice(0, 9);
    activeIdx = currentResults.length ? 0 : -1;
    el.results.innerHTML = currentResults.map((r, i) => r.kind === 'route'
      ? `<div class="result${i === activeIdx ? ' active' : ''}" data-i="${i}"><span class="chip" style="background:${r.color}">${r.label}</span><span>${TYPES[routeById[r.id].type].label}버스</span><span class="meta">${r.meta}</span></div>`
      : `<div class="result${i === activeIdx ? ' active' : ''}" data-i="${i}"><span class="dot"></span><span>${r.label}</span><span class="meta">${r.nums.join(', ')}</span></div>`).join('')
      || '<div class="result" style="color:var(--text-dim)">검색 결과가 없습니다</div>';
    el.results.classList.add('open');
    el.results.querySelectorAll('.result[data-i]').forEach(d => d.onclick = () => pickResult(Number(d.dataset.i)));
  });
  el.q.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!currentResults.length) return;
      activeIdx = (activeIdx + (e.key === 'ArrowDown' ? 1 : -1) + currentResults.length) % currentResults.length;
      el.results.querySelectorAll('.result[data-i]').forEach((d, i) => d.classList.toggle('active', i === activeIdx));
    } else if (e.key === 'Enter') { if (activeIdx >= 0) pickResult(activeIdx); }
    else if (e.key === 'Escape') { closeResults(); el.q.blur(); }
  });
  el.q.addEventListener('blur', () => setTimeout(closeResults, 150));
  function pickResult(i) {
    const r = currentResults[i]; if (!r) return;
    closeResults(); el.q.value = r.label; el.q.blur();
    if (r.kind === 'route') { if (state.hidden.has(r.id)) toggleRoute(r.id); selectRoute(r.id, true); }
    else focusStop(r.label, r.coords, r.nums.join(', '));
  }
  function closeResults() { el.results.classList.remove('open'); }

  /* ── 툴바 ────────────────────────────────────────── */
  $('btnSearch').onclick = () => el.q.focus();
  el.btnTheme.onclick = () => setTheme(state.theme === 'dark' ? 'light' : 'dark');
  function setTheme(t) {
    state.theme = t; save('theme', t);
    document.documentElement.dataset.theme = t;
    state.styleReady = false;
    loadStyle(t);
  }
  el.btnBuildings.onclick = () => {
    state.buildings = !state.buildings; save('buildings', state.buildings);
    el.btnBuildings.classList.toggle('on', state.buildings);
    if (map.getLayer('sb-buildings')) map.setLayoutProperty('sb-buildings', 'visibility', state.buildings ? 'visible' : 'none');
    else if (state.buildings) toast('현재 지도 스타일에는 건물 데이터가 없습니다');
  };
  el.btnBuildings.classList.toggle('on', state.buildings);
  el.btnStops.onclick = () => {
    state.showStops = !state.showStops;
    el.btnStops.classList.toggle('on', state.showStops);
    for (const id of ['sb-stops', 'sb-stop-labels']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', state.showStops ? 'visible' : 'none');
  };
  el.btnLegend.onclick = () => { const open = el.legend.style.display !== 'none'; el.legend.style.display = open ? 'none' : ''; el.btnLegend.classList.toggle('on', !open); };
  $('btnFit').onclick = () => map.easeTo(Object.assign({ duration: 1200 }, HOME()));
  $('btnZoomIn').onclick = () => map.zoomIn();
  $('btnZoomOut').onclick = () => map.zoomOut();
  $('btnNorth').onclick = () => map.easeTo({ bearing: 0, pitch: map.getPitch() > 5 ? 0 : HOME().pitch, duration: 700 });
  $('btnHelp').onclick = () => el.help.classList.add('open');
  $('helpOk').onclick = () => { el.help.classList.remove('open'); save('helpSeen', true); };
  el.help.addEventListener('click', e => { if (e.target === el.help) el.help.classList.remove('open'); });
  if (!load('helpSeen', false)) el.help.classList.add('open');

  const cycleRate = () => { setRate(RATES[(RATES.indexOf(state.rate) + 1) % RATES.length]); };
  el.btnRate.onclick = cycleRate;
  el.tlRate.onclick = cycleRate;
  function setRate(r) {
    state.rate = r;
    if (r !== 1) setRealtime(false);
    el.btnRate.textContent = el.tlRate.textContent = '×' + r;
    el.btnRate.classList.toggle('on', r !== 1);
  }
  function setRealtime(on) {
    if (on) {
      const jump = Math.abs(Date.now() - state.simTime) > 10 * 60 * 1000;
      state.simTime = Date.now();
      if (jump) sim.seed(state.simTime);
      state.rate = 1; el.btnRate.textContent = el.tlRate.textContent = '×1'; el.btnRate.classList.remove('on');
      state.playing = true; syncPlayIcon();
    }
    state.realtime = on;
    el.btnNow.classList.toggle('on', on);
  }
  el.btnNow.onclick = () => setRealtime(true);
  el.btnPlay.onclick = togglePlay;
  function togglePlay() {
    if (state.liveMode) return toast('실시간 모드에서는 일시정지할 수 없습니다');
    state.playing = !state.playing;
    if (!state.playing) state.realtime = false, el.btnNow.classList.remove('on');
    syncPlayIcon();
  }
  function syncPlayIcon() { el.iconPause.style.display = state.playing ? '' : 'none'; el.iconPlay.style.display = state.playing ? 'none' : ''; }
  el.tlRange.addEventListener('input', () => {
    const t = S.kst(state.simTime);
    const midnight = state.simTime - ((t.h * 60 + t.mi) * 60 + t.s) * 1000;   // 서울 기준 오늘 0시
    state.simTime = midnight + Number(el.tlRange.value) * 60000;
    state.realtime = false; el.btnNow.classList.remove('on');
    sim.seed(state.simTime);
    updateClock();
  });

  el.btnLive.onclick = async () => {
    if (state.liveMode) { live.stop(); state.liveMode = false; el.btnLive.classList.remove('on'); sim.seed(Date.now()); refreshRouteSources(); return toast('시뮬레이션 모드로 전환했습니다'); }
    if (!(await live.check())) return toast('실시간 서버가 없습니다. DATA_GO_KR_API_KEY 를 설정하고 node server.js 로 실행하세요');
    state.liveMode = true; setRealtime(true); el.btnLive.classList.add('on');
    live.start(); toast('서울시 버스 실시간 위치를 불러옵니다');
  };
  live.check().then(ok => { if (!ok) { el.btnLive.classList.add('disabled'); el.btnLive.dataset.tip = '실시간 서버 없음 · 시뮬레이션'; } });

  document.addEventListener('keydown', e => {
    const typing = /INPUT|TEXTAREA/.test(document.activeElement.tagName);
    if (e.key === '/' && !typing) { e.preventDefault(); el.q.focus(); el.q.select(); }
    if (typing) return;
    if (e.key === ' ') { e.preventDefault(); togglePlay(); }
    if (e.key === 'd' || e.key === 'D') el.btnTheme.click();
    if (e.key === 'b' || e.key === 'B') el.btnBuildings.click();
    if (e.key === 'Escape') { el.help.classList.remove('open'); clearSelection(); }
  });

  /* ── 도시 ────────────────────────────────────────── */
  function loadCity(id, fly) {
    if (!CITIES[id]) id = 'seoul';
    if (state.liveMode) { live.stop(); state.liveMode = false; el.btnLive.classList.remove('on'); }
    state.city = id; save('city', id);
    const city = CITIES[id];
    routes = (window.SB_ROUTE_DATA[id] || []).map(G.prepareRoute);
    routeById = Object.fromEntries(routes.map(r => [r.id, r]));
    sim = new S.Simulation(routes);
    sim.seed(state.simTime);
    live.sim = sim; live.city = id;
    state.hidden = new Set(load('hidden:' + id, []).filter(rid => routeById[rid]));
    state.selectedBus = null; state.selectedRoute = null; state.isolate = false; state.follow = false;
    el.card.classList.remove('open');
    if (state.styleReady) { setFocus(null); refreshRouteSources(); pushBuses(); }
    buildLegend(); buildSearchIndex(); updateStatus();
    el.citySel.value = id;
    el.sub.textContent = city.sub;
    document.title = `Korea Bus 3D — ${city.name} 버스 실시간 3D 노선도`;
    try { history.replaceState(null, '', id === 'seoul' ? location.pathname : `?city=${id}`); } catch (_) { /* file:// 등 */ }
    if (fly) map.flyTo(Object.assign({ duration: 2200, essential: true }, city.camera));
  }
  el.citySel.innerHTML = Object.entries(CITIES).map(([id, c]) => `<option value="${id}">${c.name}</option>`).join('');
  el.citySel.onchange = () => { loadCity(el.citySel.value, true); toast(`${CITIES[state.city].name} 노선으로 전환했습니다`); };
  loadCity(state.city, false);

  /* ── 시계 · 상태 ─────────────────────────────────── */
  const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
  function updateClock() {
    const t = S.kst(state.simTime);
    const hh = String(t.h).padStart(2, '0'), mm = String(t.mi).padStart(2, '0'), ss = String(t.s).padStart(2, '0');
    el.clock.textContent = `${t.y}년 ${t.m}월 ${t.d}일 (${DAYS[t.wd]}) ${hh}:${mm}:${ss} KST`;
    el.tlTime.textContent = `${hh}:${mm}`;
    if (document.activeElement !== el.tlRange) el.tlRange.value = t.h * 60 + t.mi;
  }
  function updateStatus() {
    const visible = sim.buses.filter(b => !state.hidden.has(b.routeId)).length;
    const stops = stopCount;
    const t = new Date(state.simTime).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul' });
    const mode = state.liveMode
      ? `<span class="live-dot"></span>LIVE${live.error ? ' (오류)' : ''}`
      : `<span class="sim-dot"></span>${state.realtime ? '실시간 시뮬레이션' : (state.playing ? '×' + state.rate + ' 재생' : '일시정지')}`;
    el.status.innerHTML = `${mode} · <b>${visible}</b>대 운행 · <b>${stops}</b>개 정류장 · ${t}`;
    updateLegendCounts();
  }
  updateClock(); updateStatus();

  /* ── 유틸 ────────────────────────────────────────── */
  let toastTimer;
  function toast(msg) { el.toast.textContent = msg; el.toast.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.toast.classList.remove('show'), 2600); }
  function lighten(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const f = c => Math.round(c + (255 - c) * amt);
    return '#' + [f(r), f(g), f(b)].map(c => c.toString(16).padStart(2, '0')).join('');
  }
  function load(k, def) { try { const v = localStorage.getItem('sb:' + k); return v === null ? def : JSON.parse(v); } catch (_) { return def; } }
  function save(k, v) { try { localStorage.setItem('sb:' + k, JSON.stringify(v)); } catch (_) { /* 무시 */ } }

  window.SB_APP = { map, state, live, get sim() { return sim; }, get routes() { return routes; }, loadCity };
})();
