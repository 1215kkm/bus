/* 지오메트리 유틸 — 경로 거리 계산, 경로상 위치/방위 보간, 버스 3D 폴리곤 생성 */
(function () {
  const R = 6371008.8;
  const D2R = Math.PI / 180;

  function haversine(a, b) {
    const dLat = (b[1] - a[1]) * D2R;
    const dLng = (b[0] - a[0]) * D2R;
    const s = Math.sin(dLat / 2) ** 2 +
      Math.cos(a[1] * D2R) * Math.cos(b[1] * D2R) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  /** 두 점 사이 진행 방위 (북 0°, 시계 방향) */
  function bearing(a, b) {
    const y = Math.sin((b[0] - a[0]) * D2R) * Math.cos(b[1] * D2R);
    const x = Math.cos(a[1] * D2R) * Math.sin(b[1] * D2R) -
      Math.sin(a[1] * D2R) * Math.cos(b[1] * D2R) * Math.cos((b[0] - a[0]) * D2R);
    return ((Math.atan2(y, x) / D2R) + 360) % 360;
  }

  /** 원시 노선 정의 → 누적거리, 정류장 목록이 붙은 실행용 노선 */
  function prepareRoute(def) {
    const pts = def.path.map(p => [p[0], p[1]]);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversine(pts[i - 1], pts[i]));
    const stops = [];
    def.path.forEach((p, i) => {
      if (p.length > 2 && p[2]) stops.push({ name: p[2], d: cum[i], lng: p[0], lat: p[1], idx: i });
    });
    return Object.assign({}, def, {
      pts, cum, total: cum[cum.length - 1], stops,
      color: def.color || (window.SB_ROUTE_TYPES[def.type] || {}).color || '#ffffff',
    });
  }

  /** 경로상 거리 d(m)에서의 위치·방위 */
  function pointAt(route, d) {
    const { pts, cum, total } = route;
    if (route.loop) d = ((d % total) + total) % total;
    else d = Math.max(0, Math.min(total, d));
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= d) lo = mid; else hi = mid;
    }
    const a = pts[lo], b = pts[Math.min(hi, pts.length - 1)];
    const seg = cum[hi] - cum[lo];
    const t = seg > 0 ? (d - cum[lo]) / seg : 0;
    return {
      lng: a[0] + (b[0] - a[0]) * t,
      lat: a[1] + (b[1] - a[1]) * t,
      heading: bearing(a, b),
      segIdx: lo,
    };
  }

  /** 미터 단위 오프셋 → 경위도 이동 */
  function offset(lng, lat, dxMeters, dyMeters) {
    const dLat = dyMeters / 111320;
    const dLng = dxMeters / (111320 * Math.cos(lat * D2R));
    return [lng + dLng, lat + dLat];
  }

  /** 방위 heading 방향으로 forward(m), 오른쪽으로 right(m) 이동 */
  function move(lng, lat, heading, forward, right) {
    const h = heading * D2R;
    const dx = forward * Math.sin(h) + right * Math.cos(h);
    const dy = forward * Math.cos(h) - right * Math.sin(h);
    return offset(lng, lat, dx, dy);
  }

  /** 중심·방위·길이·폭으로 회전된 직사각형 폴리곤 (버스 차체) */
  function boxPolygon(lng, lat, heading, length, width) {
    const hl = length / 2, hw = width / 2;
    const c = [
      move(lng, lat, heading, hl, -hw),
      move(lng, lat, heading, hl, hw),
      move(lng, lat, heading, -hl, hw),
      move(lng, lat, heading, -hl, -hw),
    ];
    c.push(c[0]);
    return [c];
  }

  /** 지도 위 1픽셀이 몇 m 인지 */
  function metersPerPixel(lat, zoom) {
    return 156543.03392 * Math.cos(lat * D2R) / Math.pow(2, zoom);
  }

  /** 임의 좌표를 경로에 투영 → 경로상 거리 (실시간 GPS 스냅용) */
  function snapToRoute(route, lng, lat) {
    const { pts, cum } = route;
    let best = { d: 0, dist: Infinity };
    const kx = 111320 * Math.cos(lat * D2R), ky = 111320;
    for (let i = 0; i < pts.length - 1; i++) {
      const ax = pts[i][0] * kx, ay = pts[i][1] * ky;
      const bx = pts[i + 1][0] * kx, by = pts[i + 1][1] * ky;
      const px = lng * kx, py = lat * ky;
      const vx = bx - ax, vy = by - ay;
      const len2 = vx * vx + vy * vy;
      let t = len2 > 0 ? ((px - ax) * vx + (py - ay) * vy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const qx = ax + vx * t, qy = ay + vy * t;
      const dist = Math.hypot(px - qx, py - qy);
      if (dist < best.dist) best = { d: cum[i] + (cum[i + 1] - cum[i]) * t, dist, seg: i };
    }
    return best;
  }

  /** 점이 다각형(Polygon / MultiPolygon) 안에 있는지 — 건물 충돌 판정용 */
  function pointInPolygon(lng, lat, geom) {
    if (!geom) return false;
    const polys = geom.type === 'MultiPolygon' ? geom.coordinates : geom.type === 'Polygon' ? [geom.coordinates] : [];
    for (const rings of polys) {
      if (!rings.length || !inRing(lng, lat, rings[0])) continue;
      let inHole = false;
      for (let i = 1; i < rings.length; i++) if (inRing(lng, lat, rings[i])) { inHole = true; break; }
      if (!inHole) return true;
    }
    return false;
  }
  function inRing(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  /** 다각형의 대략적인 중심 (잔해·먼지 위치용) */
  function polyCenter(geom) {
    const polys = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
    let sx = 0, sy = 0, n = 0;
    for (const rings of polys) for (const [x, y] of rings[0]) { sx += x; sy += y; n++; }
    return n ? [sx / n, sy / n] : [0, 0];
  }

  function bboxOf(route) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of route.pts) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    return [[minX, minY], [maxX, maxY]];
  }

  window.SB_GEO = { haversine, bearing, prepareRoute, pointAt, offset, move, boxPolygon, metersPerPixel, snapToRoute, bboxOf, pointInPolygon, polyCenter };
})();
