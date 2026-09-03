/* 실시간 모드 어댑터
 * server.js 가 서울시 버스 위치정보 API를 중계하면 이 모듈이
 *   /api/health          → 실시간 사용 가능 여부
 *   /api/route/:num      → 실제 노선 형상(경로 좌표 + 정류장)
 *   /api/pos/:routeId    → 노선별 차량 GPS 위치
 * 를 주기적으로 읽어 시뮬레이션 버스 대신 실제 차량을 지도에 올립니다.
 * GPS 좌표는 노선 경로에 스냅되고, 다음 갱신까지 부드럽게 보간됩니다.
 */
(function () {
  const G = window.SB_GEO;
  const POLL_MS = 15000;

  class LiveFeed {
    constructor(sim, onRouteReplaced) {
      this.sim = sim;
      this.onRouteReplaced = onRouteReplaced;
      this.active = false;
      this.timers = new Map();
      this.vehicles = new Map();   // key: routeId + plate
      this.lastUpdate = 0;
      this.error = null;
    }

    async check() {
      try {
        const res = await fetch('api/health', { cache: 'no-store' });
        if (!res.ok) return false;
        const j = await res.json();
        return !!j.live;
      } catch (_) { return false; }
    }

    async start() {
      this.active = true;
      this.error = null;
      for (const route of this.sim.routes) this.attach(route);
    }

    stop() {
      this.active = false;
      for (const t of this.timers.values()) clearTimeout(t);
      this.timers.clear();
      for (const route of this.sim.routes) route.liveManaged = false;
      this.sim.buses = this.sim.buses.filter(b => !b.live);
      this.vehicles.clear();
    }

    async attach(route) {
      try {
        const res = await fetch(`api/route/${encodeURIComponent(route.num)}`);
        if (!res.ok) throw new Error(`route ${route.num}: HTTP ${res.status}`);
        const info = await res.json();
        if (!this.active) return;
        if (info.path && info.path.length > 2) {
          // 실제 형상으로 교체 (TOPIS 경로는 기점→종점→기점 순환 형태)
          const def = Object.assign({}, route, { path: info.path, loop: true, busRouteId: info.busRouteId, realShape: true });
          const prepared = G.prepareRoute(def);
          Object.assign(route, prepared);
          if (this.onRouteReplaced) this.onRouteReplaced(route);
        }
        route.liveManaged = true;
        this.sim.buses = this.sim.buses.filter(b => b.routeId !== route.id || b.live);
        this.poll(route);
      } catch (e) {
        console.warn('[live]', e.message);
        this.error = e.message;
      }
    }

    async poll(route) {
      if (!this.active || !route.busRouteId) return;
      try {
        const res = await fetch(`api/pos/${encodeURIComponent(route.busRouteId)}`, { cache: 'no-store' });
        if (res.ok) {
          const list = await res.json();
          this.applyPositions(route, list);
          this.lastUpdate = Date.now();
          this.error = null;
        }
      } catch (e) {
        this.error = e.message;
      }
      this.timers.set(route.id, setTimeout(() => this.poll(route), POLL_MS));
    }

    applyPositions(route, list) {
      const seen = new Set();
      for (const v of list) {
        const key = `${route.id}:${v.plainNo || v.vehId}`;
        seen.add(key);
        const snap = G.snapToRoute(route, v.lng, v.lat);
        let bus = this.vehicles.get(key);
        if (!bus) {
          bus = this.sim.spawn(route, 1, snap.d);
          bus.live = true;
          bus.plate = v.plainNo || v.vehId;
          bus.anim = { from: snap.d, to: snap.d, t0: performance.now(), dur: 1 };
          this.vehicles.set(key, bus);
        } else {
          let to = snap.d;
          if (to < bus.d - 50) to += route.total;       // 순환 경로 끝 → 처음 넘어감
          bus.anim = { from: bus.d, to, t0: performance.now(), dur: POLL_MS };
        }
        bus.gps = [v.lng, v.lat];
        bus.state = v.stopFlag === '1' ? 'stop' : 'run';
        bus.lowFloor = v.busType === '1';
        bus.congestion = v.congestion;
      }
      // 사라진 차량 제거
      for (const [key, bus] of this.vehicles) {
        if (key.startsWith(route.id + ':') && !seen.has(key)) {
          this.vehicles.delete(key);
          this.sim.buses = this.sim.buses.filter(b => b !== bus);
        }
      }
    }

    /** 매 프레임: 보간 위치 적용 */
    tick() {
      if (!this.active) return;
      const now = performance.now();
      for (const bus of this.vehicles.values()) {
        const a = bus.anim; if (!a) continue;
        const t = Math.min(1, (now - a.t0) / a.dur);
        const d = a.from + (a.to - a.from) * t;
        bus.speed = a.dur > 1 ? Math.abs(a.to - a.from) / (a.dur / 1000) : 0;
        bus.d = bus.route.loop ? ((d % bus.route.total) + bus.route.total) % bus.route.total : d;
      }
    }
  }

  window.SB_LIVE = { LiveFeed };
})();
