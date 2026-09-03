/*
 * Seoul Bus 3D — 정적 파일 + 실시간 API 프록시 서버 (의존성 없음)
 *
 *   SEOUL_BUS_API_KEY=발급받은키 node server.js
 *   → http://localhost:8080  (키가 없으면 시뮬레이션 모드로만 동작)
 *
 * 공공데이터포털(data.go.kr) "서울특별시_버스위치정보조회 서비스" 와
 * "서울특별시_노선정보조회 서비스" 의 인증키(디코딩된 일반 인증키)를 사용합니다.
 *   /api/health           실시간 가능 여부
 *   /api/route/:num       노선번호 → busRouteId, 경로 좌표, 정류장
 *   /api/pos/:busRouteId  노선의 현재 차량 위치
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 8080;
const KEY = process.env.SEOUL_BUS_API_KEY || '';
const ROOT = __dirname;
const BASE = 'http://ws.bus.go.kr/api/rest';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8',
};

const routeCache = new Map();   // num → { at, data }
const posCache = new Map();     // busRouteId → { at, data }

async function topis(service, op, params) {
  const url = new URL(`${BASE}/${service}/${op}`);
  url.searchParams.set('serviceKey', KEY);
  url.searchParams.set('resultType', 'json');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`TOPIS ${op} HTTP ${res.status}`);
  const j = await res.json();
  const code = j?.msgHeader?.headerCd;
  if (code && code !== '0' && code !== '4') throw new Error(`TOPIS ${op}: ${j.msgHeader.headerMsg}`);
  return j?.msgBody?.itemList || [];
}

async function routeInfo(num) {
  const hit = routeCache.get(num);
  if (hit && Date.now() - hit.at < 24 * 3600 * 1000) return hit.data;
  const list = await topis('busRouteInfo', 'getBusRouteList', { strSrch: num });
  const exact = list.find(r => r.busRouteNm === num) || list[0];
  if (!exact) throw new Error(`노선 ${num} 없음`);
  const id = exact.busRouteId;
  const [pathPts, stops] = await Promise.all([
    topis('busRouteInfo', 'getRoutePath', { busRouteId: id }),
    topis('busRouteInfo', 'getStaionByRoute', { busRouteId: id }),
  ]);
  const path = pathPts.map(p => [Number(p.gpsX), Number(p.gpsY)]);
  // 정류장을 가장 가까운 경로점에 이름으로 붙임
  for (const s of stops) {
    const sx = Number(s.gpsX), sy = Number(s.gpsY);
    let best = -1, bestD = Infinity;
    path.forEach((p, i) => {
      const d = Math.hypot((p[0] - sx) * 88000, (p[1] - sy) * 111000);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best >= 0 && bestD < 120) path[best] = [path[best][0], path[best][1], s.stationNm];
  }
  const data = {
    busRouteId: id, num: exact.busRouteNm, type: exact.routeType,
    from: exact.stStationNm, to: exact.edStationNm, path,
    stops: stops.map(s => ({ name: s.stationNm, lng: Number(s.gpsX), lat: Number(s.gpsY), seq: Number(s.seq), turn: s.transYn === 'Y' })),
  };
  routeCache.set(num, { at: Date.now(), data });
  return data;
}

async function positions(busRouteId) {
  const hit = posCache.get(busRouteId);
  if (hit && Date.now() - hit.at < 10000) return hit.data;
  const list = await topis('buspos', 'getBusPosByRtid', { busRouteId });
  const data = list.map(v => ({
    vehId: v.vehId, plainNo: v.plainNo, lng: Number(v.gpsX), lat: Number(v.gpsY),
    sectOrd: Number(v.sectOrd), stopFlag: v.stopFlag, busType: v.busType, congestion: v.congetion,
    lastStop: v.lastStnId, dataTm: v.dataTm,
  }));
  posCache.set(busRouteId, { at: Date.now(), data });
  return data;
}

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
    if (url.pathname === '/api/health') return json(res, 200, { live: !!KEY, source: KEY ? 'seoul-topis' : null });
    if (!KEY && url.pathname.startsWith('/api/')) return json(res, 503, { error: 'SEOUL_BUS_API_KEY 환경변수가 없습니다.' });
    let m;
    if ((m = url.pathname.match(/^\/api\/route\/([^/]+)$/))) return json(res, 200, await routeInfo(decodeURIComponent(m[1])));
    if ((m = url.pathname.match(/^\/api\/pos\/([^/]+)$/))) return json(res, 200, await positions(decodeURIComponent(m[1])));
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'unknown endpoint' });
    return serveStatic(req, res);
  } catch (e) {
    console.error(e);
    return json(res, 502, { error: e.message });
  }
}).listen(PORT, () => {
  console.log(`Seoul Bus 3D → http://localhost:${PORT}  (${KEY ? '실시간 모드 가능' : '시뮬레이션 전용: SEOUL_BUS_API_KEY 미설정'})`);
});
