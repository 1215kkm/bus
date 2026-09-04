/* 가로등 — 다크·노을 모드에서 도시 곳곳 도로 위에 켜지는 불빛
 *
 * 좌표를 따로 갖고 있지 않고, 지금 화면에 그려진 벡터 타일의 도로선
 * (OpenMapTiles 의 transportation 레이어)을 읽어 일정 간격으로 점을 찍습니다.
 * 그래서 어느 도시로 옮겨도 실제 도로를 따라 불이 켜집니다.
 *
 * 지도를 움직일 때마다 다시 계산하면 무거우니 moveend 에서 한 번만,
 * 점 개수도 상한을 둡니다.
 */
(function () {
  const G = window.SB_GEO;
  const SRC = 'sb-lamps';
  const CAP = 900;                 // 화면당 최대 불빛 수
  const IDLE = 260;                // moveend 후 이 시간만큼 조용하면 계산

  let map, on = false, timer = 0, warm = '#ffcf7a';

  /** 줌에 따른 가로등 간격(m) — 멀리서 보면 성기게 */
  function spacing(z) {
    if (z >= 16.5) return 38;
    if (z >= 15) return 65;
    if (z >= 14) return 120;
    if (z >= 13) return 230;
    return 420;
  }

  function roadLayerIds() {
    const layers = (map.getStyle() && map.getStyle().layers) || [];
    return layers.filter(l => l.type === 'line' && l['source-layer'] === 'transportation').map(l => l.id);
  }

  function walk(coords, step, out, seen) {
    let carry = 0;
    for (let i = 1; i < coords.length; i++) {
      const a = coords[i - 1], b = coords[i];
      const d = G.haversine(a, b);
      if (!d) continue;
      let t = carry;
      while (t < d) {
        const f = t / d;
        const lng = a[0] + (b[0] - a[0]) * f, lat = a[1] + (b[1] - a[1]) * f;
        const key = lng.toFixed(5) + ',' + lat.toFixed(5);   // 타일 경계에서 겹치는 점 제거
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lng, lat] } });
          if (out.length >= CAP) return true;
        }
        t += step;
      }
      carry = t - d;
    }
    return false;
  }

  function rebuild() {
    const src = map.getSource(SRC);
    if (!src) return;
    if (!on || map.getZoom() < 12.5) return src.setData({ type: 'FeatureCollection', features: [] });
    const ids = roadLayerIds();
    if (!ids.length) return src.setData({ type: 'FeatureCollection', features: [] });

    let feats;
    try {
      feats = map.queryRenderedFeatures({ layers: ids });
    } catch (_) { return; }

    const step = spacing(map.getZoom());
    const out = [], seen = new Set();
    for (const f of feats) {
      const g = f.geometry;
      if (!g) continue;
      const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : null;
      if (!lines) continue;
      for (const line of lines) if (walk(line, step, out, seen)) { src.setData({ type: 'FeatureCollection', features: out }); return; }
    }
    src.setData({ type: 'FeatureCollection', features: out });
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(rebuild, IDLE);
  }

  /** 스타일이 새로 올라올 때마다 app.js 의 addOverlays 에서 불러 줍니다 */
  function add(beforeId) {
    if (map.getSource(SRC)) return;
    map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: 'sb-lamp-glow', type: 'circle', source: SRC,
      layout: { visibility: on ? 'visible' : 'none' },
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 12.5, 4, 15, 11, 18, 26],
        'circle-color': warm, 'circle-blur': 1, 'circle-opacity': 0.28,
        'circle-pitch-alignment': 'map',
      },
    }, beforeId);
    map.addLayer({
      id: 'sb-lamp-core', type: 'circle', source: SRC,
      layout: { visibility: on ? 'visible' : 'none' },
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 12.5, 0.7, 15, 1.5, 18, 3.2],
        'circle-color': '#fff3d8', 'circle-blur': 0.25, 'circle-opacity': 0.95,
        'circle-pitch-alignment': 'map',
      },
    }, beforeId);
    schedule();
  }

  function setTheme(t) {
    on = t === 'dark' || t === 'sunset';
    warm = t === 'sunset' ? '#ffb066' : '#ffcf7a';
    for (const id of ['sb-lamp-glow', 'sb-lamp-core']) {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    }
    if (map.getLayer('sb-lamp-glow')) map.setPaintProperty('sb-lamp-glow', 'circle-color', warm);
    if (on) schedule(); else rebuild();
  }

  function init(m, theme) {
    map = m;
    on = theme === 'dark' || theme === 'sunset';
    warm = theme === 'sunset' ? '#ffb066' : '#ffcf7a';
    map.on('moveend', schedule);
    map.on('zoomend', schedule);
  }

  window.SB_CITYLIGHTS = { init, add, setTheme, refresh: schedule };
})();
