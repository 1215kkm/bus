/*
 * Bus 3D — 로컬 개발용 정적 서버 + 실시간 API 프록시 (의존성 없음)
 *
 *   DATA_GO_KR_API_KEY=발급받은키 node server.js
 *   → http://localhost:8080  (키가 없으면 시뮬레이션 모드로만 동작)
 *
 * 어댑터 구현은 lib/bus-api.js 에 있고, Vercel 배포에서는 api/ 아래
 * 서버리스 함수가 같은 모듈을 그대로 씁니다.
 *
 *   /api/health                    실시간 가능 여부
 *   /api/route/:num?city=yongin    노선번호 → busRouteId, 경로 좌표, 정류장
 *   /api/pos/:routeId?city=yongin  노선의 현재 차량 위치
 *   /api/cities                    서버가 아는 도시 목록
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { KEY, CITIES, ADAPTERS, cached, pickCity } = require('./lib/bus-api.js');

const PORT = Number(process.env.PORT) || 8080;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.md': 'text/plain; charset=utf-8',
};

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
    // 개발 서버라 캐시 금지 — 안 그러면 고친 js/css 가 브라우저 캐시에 막혀 그대로 보입니다
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
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
      const { id, city, adapter, adapterName } = pickCity(url.searchParams);
      const numStr = decodeURIComponent(m[1]);
      const data = await cached(`route:${id}:${adapterName}:${numStr}`, 24 * 3600 * 1000, () => adapter.route(numStr, city));
      return json(res, 200, Object.assign({ adapter: adapterName }, data));
    }
    if ((m = url.pathname.match(/^\/api\/pos\/([^/]+)$/))) {
      const { id, city, adapter, adapterName } = pickCity(url.searchParams);
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
