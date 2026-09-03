/*
 * Bus 3D — 정적 파일 + 실시간 API 프록시 서버 (의존성 없음)
 *
 *   DATA_GO_KR_API_KEY=발급받은키 node server.js
 *   → http://localhost:8080  (키가 없으면 시뮬레이션 모드로만 동작)
 *
 * 공공데이터포털(data.go.kr) 인증키(Decoding 키) 하나로 아래 세 어댑터를 사용합니다.
 * 각 서비스는 포털에서 "활용신청"을 해 두어야 합니다.
 *   seoul : 서울특별시_버스위치정보조회 + 노선정보조회 (ws.bus.go.kr)
 *   gbis  : 경기도_버스위치정보조회 + 노선정보조회 (apis.data.go.kr/6410000)
 *   tago  : 국토교통부_(TAGO)_버스위치정보 + 노선정보 (apis.data.go.kr/1613000) — 전국 도시코드 기반
 *
 * 도시별 어댑터 선택은 js/data/cities.js 의 live 설정을 그대로 따릅니다.
 *
 *   /api/health                    실시간 가능 여부
 *   /api/route/:num?city=yongin    노선번호 → busRouteId, 경로 좌표, 정류장
 *   /api/pos/:routeId?city=yongin  노선의 현재 차량 위치
 *   /api/cities                    서버가 아는 도시 목록
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PORT = Number(process.env.PORT) || 8080;
const KEY = process.env.DATA_GO_KR_API_KEY || process.env.SEOUL_BUS_API_KEY || '';
const ROOT = __dirname;

// js/data/cities.js 를 그대로 읽어 도시 설정 공유
const CITIES = (() => {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js/data/cities.js'), 'utf8'), sandbox);
  return sandbox.window.SB_CITIES || {};
})();

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8',
};

/* ── 공통 유틸 ─────────────────────────────────────────── */
const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  const data = await fn();
  cache.set(key, { at: Date.now(), data });
  return data;
}

async function getText(url) {
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url.pathname}: ${text.slice(0, 120)}`);
  return text;
}

/** 평면 XML 목록 → 객체 배열 (<item>..</item>, <busRouteList>..</busRouteList> 등 모두 처리) */
function xmlItems(xml) {
  const items = [];
  const re = /<(\w+)>((?:\s*<\w+>[^<]*<\/\w+>\s*|\s*<\w+\s*\/>\s*)+)<\/\1>/g;
  let m;
  while ((m = re.exec(xml))) {
    const obj = {};
    for (const f of m[2].matchAll(/<(\w+)>([^<]*)<\/\1>/g)) obj[f[1]] = f[2].trim();
    if (Object.keys(obj).length > 1) items.push(obj);
  }
  return items;
}
function xmlTag(xml, tag) { const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)); return m ? m[1].trim() : null; }

/** JSON 응답 어디에 있든 첫 번째 객체 배열을 찾음 */
function firstArray(o, depth = 0) {
  if (!o || depth > 6) return null;
  if (Array.isArray(o)) return o.length && typeof o[0] === 'object' ? o : null;
  if (typeof o === 'object') for (const v of Object.values(o)) { const a = firstArray(v, depth + 1); if (a) return a; }
  return null;
}
const num = v => Number(v);

/** 정류장 이름을 경로 좌표 중 가장 가까운 점에 붙임 */
function labelPath(pathPts, stops, maxDist = 120) {
  const out = pathPts.map(p => [p[0], p[1]]);
  for (const s of stops) {
    let best = -1, bestD = Infinity;
    out.forEach((p, i) => {
      const d = Math.hypot((p[0] - s.lng) * 88000, (p[1] - s.lat) * 111000);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best >= 0 && bestD < maxDist) out[best] = [out[best][0], out[best][1], s.name];
  }
  return out;
}

/* ── 어댑터: 서울 TOPIS ────────────────────────────────── */
const seoul = {
  async call(service, op, params) {
    const url = new URL(`http://ws.bus.go.kr/api/rest/${service}/${op}`);
    url.searchParams.set('serviceKey', KEY); url.searchParams.set('resultType', 'json');
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const j = JSON.parse(await getText(url));
    const code = j?.msgHeader?.headerCd;
    if (code && code !== '0' && code !== '4') throw new Error(`TOPIS ${op}: ${j.msgHeader.headerMsg}`);
    return j?.msgBody?.itemList || [];
  },
  async route(numStr) {
    const list = await this.call('busRouteInfo', 'getBusRouteList', { strSrch: numStr });
    const exact = list.find(r => r.busRouteNm === numStr) || list[0];
    if (!exact) throw new Error(`노선 ${numStr} 없음`);
    const id = exact.busRouteId;
    const [pathPts, stops] = await Promise.all([
      this.call('busRouteInfo', 'getRoutePath', { busRouteId: id }),
      this.call('busRouteInfo', 'getStaionByRoute', { busRouteId: id }),
    ]);
    const stopList = stops.map(s => ({ name: s.stationNm, lng: num(s.gpsX), lat: num(s.gpsY), seq: num(s.seq), turn: s.transYn === 'Y' }));
    return { busRouteId: id, num: exact.busRouteNm, from: exact.stStationNm, to: exact.edStationNm,
      path: labelPath(pathPts.map(p => [num(p.gpsX), num(p.gpsY)]), stopList), stops: stopList };
  },
  async positions(routeId) {
    const list = await this.call('buspos', 'getBusPosByRtid', { busRouteId: routeId });
    return list.map(v => ({ vehId: v.vehId, plainNo: v.plainNo, lng: num(v.gpsX), lat: num(v.gpsY), seq: num(v.sectOrd), stopFlag: v.stopFlag, busType: v.busType, congestion: v.congetion, dataTm: v.dataTm }));
  },
};

/* ── 어댑터: 경기 GBIS ─────────────────────────────────── */
const gbis = {
  /** v2(JSON) 우선, 실패하면 v1(XML) */
  async call(service, op, params) {
    const tryUrl = async (u) => {
      const text = await getText(u);
      if (text.trim().startsWith('{')) {
        const j = JSON.parse(text);
        const code = j?.response?.msgHeader?.resultCode ?? j?.msgHeader?.resultCode;
        if (code != null && String(code) !== '0' && String(code) !== '4') throw new Error(`GBIS ${op}: ${j?.response?.msgHeader?.resultMessage || code}`);
        return firstArray(j?.response?.msgBody ?? j?.msgBody) || [];
      }
      const code = xmlTag(text, 'resultCode');
      if (code != null && code !== '0' && code !== '4') throw new Error(`GBIS ${op}: ${xmlTag(text, 'resultMessage') || code}`);
      const body = text.match(/<msgBody>([\s\S]*)<\/msgBody>/);
      return body ? xmlItems(body[1]) : [];
    };
    const q = new URLSearchParams({ serviceKey: KEY, ...params });
    try {
      return await tryUrl(new URL(`https://apis.data.go.kr/6410000/${service}/v2/${op}v2?${q}&format=json`));
    } catch (e) {
      return await tryUrl(new URL(`https://apis.data.go.kr/6410000/${service}/${op}?${q}`));
    }
  },
  async route(numStr, city) {
    const list = await this.call('busrouteservice', 'getBusRouteList', { keyword: numStr });
    const inRegion = list.filter(r => !city.live.region || String(r.regionName || '').includes(city.live.region));
    const pool = inRegion.length ? inRegion : list;
    const exact = pool.find(r => r.routeName === numStr) || pool.find(r => String(r.routeName).replace(/[A-Z]$/, '') === numStr) || pool[0];
    if (!exact) throw new Error(`노선 ${numStr} 없음`);
    const id = String(exact.routeId);
    const [line, stations] = await Promise.all([
      this.call('busrouteservice', 'getBusRouteLineList', { routeId: id }).catch(() => []),
      this.call('busrouteservice', 'getBusRouteStationList', { routeId: id }),
    ]);
    const stopList = stations.map(s => ({ name: s.stationName, lng: num(s.x), lat: num(s.y), seq: num(s.stationSeq), turn: s.turnYn === 'Y', stationId: String(s.stationId) }))
      .sort((a, b) => a.seq - b.seq);
    const pathPts = line.length > 2 ? line.sort((a, b) => num(a.lineSeq) - num(b.lineSeq)).map(p => [num(p.x), num(p.y)]) : stopList.map(s => [s.lng, s.lat]);
    cache.set('gbis:stations:' + id, { at: Date.now(), data: stopList });
    return { busRouteId: id, num: String(exact.routeName), from: exact.startStationName, to: exact.endStationName, path: labelPath(pathPts, stopList), stops: stopList };
  },
  /** GBIS 위치정보는 GPS 대신 '마지막 통과 정류장 순번'만 주므로 정류장 좌표로 변환 */
  async positions(routeId) {
    let stations = cache.get('gbis:stations:' + routeId)?.data;
    if (!stations) {
      const st = await this.call('busrouteservice', 'getBusRouteStationList', { routeId });
      stations = st.map(s => ({ name: s.stationName, lng: num(s.x), lat: num(s.y), seq: num(s.stationSeq) })).sort((a, b) => a.seq - b.seq);
      cache.set('gbis:stations:' + routeId, { at: Date.now(), data: stations });
    }
    const list = await this.call('buslocationservice', 'getBusLocationList', { routeId });
    return list.map(v => {
      const seq = num(v.stationSeq);
      const st = stations.find(s => s.seq === seq) || stations[Math.min(stations.length - 1, Math.max(0, seq - 1))];
      return { vehId: v.vehId || v.plateNo, plainNo: v.plateNo, lng: st ? st.lng : NaN, lat: st ? st.lat : NaN, seq, stopFlag: '0', busType: v.lowPlate === '1' ? '1' : '0', remainSeat: v.remainSeatCnt, stationBased: true };
    }).filter(v => Number.isFinite(v.lng));
  },
};

/* ── 어댑터: 국토교통부 TAGO (전국) ────────────────────── */
const tago = {
  async call(service, op, params) {
    const url = new URL(`https://apis.data.go.kr/1613000/${service}/${op}`);
    url.searchParams.set('serviceKey', KEY); url.searchParams.set('_type', 'json'); url.searchParams.set('numOfRows', '500'); url.searchParams.set('pageNo', '1');
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const text = await getText(url);
    if (!text.trim().startsWith('{')) throw new Error(`TAGO ${op}: ${xmlTag(text, 'returnReasonCode') || xmlTag(text, 'resultMsg') || text.slice(0, 80)}`);
    const j = JSON.parse(text);
    const code = j?.response?.header?.resultCode;
    if (code && code !== '00') throw new Error(`TAGO ${op}: ${j.response.header.resultMsg}`);
    const item = j?.response?.body?.items?.item;
    return !item ? [] : Array.isArray(item) ? item : [item];
  },
  async route(numStr, city) {
    const cityCode = city.live.tagoCityCode;
    if (!cityCode) throw new Error('cities.js 에 tagoCityCode 가 없습니다');
    const list = await this.call('BusRouteInfoInqireService', 'getRouteNoList', { cityCode, routeNo: numStr });
    const exact = list.find(r => String(r.routeno) === numStr) || list[0];
    if (!exact) throw new Error(`노선 ${numStr} 없음`);
    const id = String(exact.routeid);
    const st = await this.call('BusRouteInfoInqireService', 'getRouteAcctoThrghSttnList', { cityCode, routeId: id });
    const stopList = st.map(s => ({ name: s.nodenm, lng: num(s.gpslong), lat: num(s.gpslati), seq: num(s.nodeord), stationId: String(s.nodeid), updown: s.updowncd })).sort((a, b) => a.seq - b.seq);
    return { busRouteId: id, num: String(exact.routeno), from: exact.startnodenm, to: exact.endnodenm, path: labelPath(stopList.map(s => [s.lng, s.lat]), stopList), stops: stopList };
  },
  async positions(routeId, city) {
    const list = await this.call('BusLcInfoInqireService', 'getRouteAcctoBusLcList', { cityCode: city.live.tagoCityCode, routeId });
    return list.map(v => ({ vehId: String(v.vehicleno), plainNo: String(v.vehicleno), lng: num(v.gpslong), lat: num(v.gpslati), seq: num(v.nodeord), stopFlag: '0', busType: v.routetp }));
  },
};

const ADAPTERS = { seoul, gbis, tago };

function pickCity(url) {
  const id = url.searchParams.get('city') || 'seoul';
  const city = CITIES[id];
  if (!city) throw new Error(`알 수 없는 도시: ${id}`);
  const adapterName = url.searchParams.get('adapter') || (city.live && city.live.adapter) || 'tago';
  const adapter = ADAPTERS[adapterName];
  if (!adapter) throw new Error(`알 수 없는 어댑터: ${adapterName}`);
  return { id, city, adapter, adapterName };
}

/* ── HTTP ──────────────────────────────────────────────── */
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/health') return json(res, 200, { live: !!KEY, adapters: KEY ? Object.keys(ADAPTERS) : [], cities: Object.keys(CITIES) });
    if (url.pathname === '/api/cities') return json(res, 200, CITIES);
    if (!KEY && url.pathname.startsWith('/api/')) return json(res, 503, { error: 'DATA_GO_KR_API_KEY 환경변수가 없습니다.' });
    let m;
    if ((m = url.pathname.match(/^\/api\/route\/([^/]+)$/))) {
      const { id, city, adapter, adapterName } = pickCity(url);
      const numStr = decodeURIComponent(m[1]);
      const data = await cached(`route:${id}:${adapterName}:${numStr}`, 24 * 3600 * 1000, () => adapter.route(numStr, city));
      return json(res, 200, Object.assign({ adapter: adapterName }, data));
    }
    if ((m = url.pathname.match(/^\/api\/pos\/([^/]+)$/))) {
      const { id, city, adapter, adapterName } = pickCity(url);
      const routeId = decodeURIComponent(m[1]);
      return json(res, 200, await cached(`pos:${id}:${adapterName}:${routeId}`, 10000, () => adapter.positions(routeId, city)));
    }
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'unknown endpoint' });
    return serveStatic(req, res);
  } catch (e) {
    console.error(`[api] ${req.url} → ${e.message}`);
    return json(res, 502, { error: e.message });
  }
}).listen(PORT, () => {
  console.log(`Bus 3D → http://localhost:${PORT}  (${KEY ? '실시간 모드 가능 · 도시: ' + Object.keys(CITIES).join(', ') : '시뮬레이션 전용: DATA_GO_KR_API_KEY 미설정'})`);
});
