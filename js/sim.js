/* 버스 운행 시뮬레이션 엔진
 * - 시간대별 배차간격(출퇴근 단축, 심야 확대)에 맞춰 노선별 차량 수를 유지
 * - 정류장 정차, 종점 회차·대기, 운행시간 외 차고지 복귀
 * - 실시간 모드에서는 live.js 가 각 노선의 버스 목록을 대신 채웁니다
 */
(function () {
  const G = window.SB_GEO;
  const STOP_DWELL = [10, 25];   // 정류장 정차 시간(초)
  const LAYOVER = [90, 240];     // 종점 대기(초)

  function rand(a, b) { return a + Math.random() * (b - a); }

  /** 시각(시, 소수) 에 따른 배차 배율. 1 = 평시 */
  function headwayFactor(hour, route) {
    if (route.type === 'night') return 1;
    if ((hour >= 7 && hour < 9.5) || (hour >= 17 && hour < 20)) return 0.6;
    if (hour >= 22 || hour < 6) return 1.8;
    if (hour >= 10 && hour < 16) return 1.15;
    return 1;
  }

  /** 운행 시간대 여부 */
  function inService(hour, route) {
    if (route.type === 'night') return hour >= 23.5 || hour < 4;
    return hour >= 4.5 && hour < 23.5;
  }

  class Simulation {
    constructor(routes) {
      this.routes = routes;          // prepared routes
      this.buses = [];
      this.nextId = 1;
      this.plateSeq = 1000;
      this.lastFleetCheck = -Infinity;
      this.listeners = {};
    }

    /** 시뮬레이션 시각(ms) 기준으로 초기 차량을 노선 전체에 고르게 배치 */
    seed(timeMs) {
      this.buses = [];
      const hour = hourOf(timeMs);
      for (const route of this.routes) {
        const target = this.fleetTarget(route, hour);
        if (target === 0) continue;
        const perDir = route.loop ? target : Math.max(1, Math.round(target / 2));
        const dirs = route.loop ? [1] : [1, -1];
        for (const dir of dirs) {
          for (let i = 0; i < perDir; i++) {
            const d = (i + Math.random() * 0.4) / perDir * route.total;
            this.spawn(route, dir, dir === 1 ? d : route.total - d);
          }
        }
      }
      this.lastFleetCheck = timeMs;
    }

    fleetTarget(route, hour) {
      if (!inService(hour, route)) return 0;
      const headwaySec = route.headway * 60 * headwayFactor(hour, route);
      const speedMs = route.speed / 3.6;
      const dwellPerKm = 0.09;   // 정차·회차 손실률 근사
      const cycle = (route.loop ? route.total : route.total * 2) / speedMs * (1 + dwellPerKm) + (route.loop ? 0 : 180);
      return Math.max(1, Math.round(cycle / headwaySec));
    }

    spawn(route, dir, d) {
      const bus = {
        id: this.nextId++,
        routeId: route.id,
        route,
        dir,
        d: Math.max(0, Math.min(route.total, d)),
        speedFactor: rand(0.85, 1.18),
        speed: 0,
        wait: 0,
        state: 'run',            // run | stop | layover | retire
        plate: `서울 7${String(this.plateSeq++ % 10)}사 ${String(1000 + Math.floor(Math.random() * 9000))}`,
        lastStopIdx: -1,
        live: false,
      };
      this.buses.push(bus);
      return bus;
    }

    /** 노선별 차량 수를 목표치에 맞게 조정 (1분마다) */
    balanceFleet(timeMs) {
      if (timeMs - this.lastFleetCheck < 60000) return;
      this.lastFleetCheck = timeMs;
      const hour = hourOf(timeMs);
      for (const route of this.routes) {
        if (route.liveManaged) continue;
        const target = this.fleetTarget(route, hour);
        const mine = this.buses.filter(b => b.routeId === route.id && b.state !== 'retire');
        if (mine.length < target) {
          const dir = route.loop ? 1 : (mine.filter(b => b.dir === 1).length <= mine.length / 2 ? 1 : -1);
          this.spawn(route, dir, dir === 1 ? 0 : route.total);
        } else if (mine.length > target) {
          // 종점에 가장 가까운 차량을 차고지로
          mine.sort((a, b) => distToEnd(a) - distToEnd(b));
          mine[0].state = 'retire';
        }
      }
    }

    tick(dtSec, timeMs) {
      if (dtSec <= 0) return;
      this.balanceFleet(timeMs);
      const remove = [];
      for (const bus of this.buses) {
        if (bus.live) continue;   // 실시간 차량은 live.js 가 움직임
        const r = bus.route;
        if (bus.wait > 0) {
          bus.wait -= dtSec;
          bus.speed = 0;
          if (bus.wait <= 0) { bus.wait = 0; bus.state = bus.state === 'retire' ? 'retire' : 'run'; }
          continue;
        }
        const targetSpeed = r.speed / 3.6 * bus.speedFactor;
        bus.speed = Math.min(targetSpeed, bus.speed + 1.2 * dtSec);   // 완만한 가속
        const prevD = bus.d;
        let nextD = bus.d + bus.dir * bus.speed * dtSec;

        // 정류장 통과 검사
        const stop = nextStopBetween(r, prevD, nextD, bus.dir, bus.lastStopIdx);
        if (stop) {
          bus.d = stop.d;
          bus.lastStopIdx = stop.i;
          bus.wait = rand(STOP_DWELL[0], STOP_DWELL[1]);
          bus.state = 'stop';
          bus.speed = 0;
          continue;
        }

        if (r.loop) {
          if (nextD >= r.total) { nextD -= r.total; bus.lastStopIdx = -1; if (bus.state === 'retire') { remove.push(bus); continue; } }
          bus.d = nextD;
          continue;
        }

        if (nextD >= r.total || nextD <= 0) {
          bus.d = nextD >= r.total ? r.total : 0;
          if (bus.state === 'retire') { remove.push(bus); continue; }
          bus.dir = -bus.dir;
          bus.lastStopIdx = bus.dir === 1 ? 0 : r.stops.length - 1;
          bus.wait = rand(LAYOVER[0], LAYOVER[1]);
          bus.state = 'layover';
          bus.speed = 0;
        } else {
          bus.d = nextD;
        }
      }
      if (remove.length) this.buses = this.buses.filter(b => !remove.includes(b));
    }

    /** 다음 정류장 정보 */
    nextStop(bus) {
      const r = bus.route;
      if (bus.dir === 1) {
        for (let i = 0; i < r.stops.length; i++) if (r.stops[i].d > bus.d + 1) return r.stops[i];
        return r.loop ? r.stops[0] : r.stops[r.stops.length - 1];
      }
      for (let i = r.stops.length - 1; i >= 0; i--) if (r.stops[i].d < bus.d - 1) return r.stops[i];
      return r.stops[0];
    }
  }

  function distToEnd(bus) {
    return bus.dir === 1 ? bus.route.total - bus.d : bus.d;
  }

  function nextStopBetween(r, a, b, dir, lastIdx) {
    if (dir === 1) {
      for (let i = 0; i < r.stops.length; i++) {
        const s = r.stops[i];
        if (i !== lastIdx && s.d > a && s.d <= b) return { d: s.d, i };
      }
    } else {
      for (let i = r.stops.length - 1; i >= 0; i--) {
        const s = r.stops[i];
        if (i !== lastIdx && s.d < a && s.d >= b) return { d: s.d, i };
      }
    }
    return null;
  }

  /** 한국 표준시(Asia/Seoul) 기준 날짜·시각 분해 — 사용자의 브라우저 시간대와 무관하게 서울 운행시간을 따름 */
  const KST = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', hour12: false,
    year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short', hour: 'numeric', minute: 'numeric', second: 'numeric',
  });
  const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  function kst(ms) {
    const o = {};
    for (const part of KST.formatToParts(new Date(ms))) o[part.type] = part.value;
    return { y: +o.year, m: +o.month, d: +o.day, wd: WD[o.weekday], h: (+o.hour) % 24, mi: +o.minute, s: +o.second };
  }
  function hourOf(ms) {
    const t = kst(ms);
    return t.h + t.mi / 60;
  }

  window.SB_SIM = { Simulation, headwayFactor, inService, hourOf, kst };
})();
