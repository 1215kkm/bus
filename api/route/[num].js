const { api, send, handler } = require('../_util.js');

/* GET /api/route/143?city=seoul → 실제 노선 형상 + 정류장 (하루 캐시) */
module.exports = handler(async (req, res) => {
  const { id, city, adapter, adapterName } = api.pickCity(req.query || {});
  const numStr = decodeURIComponent(String((req.query && req.query.num) || ''));
  if (!numStr) return send(res, 400, { error: '노선 번호가 없습니다.' });
  const data = await api.cached(`route:${id}:${adapterName}:${numStr}`, 24 * 3600 * 1000, () => adapter.route(numStr, city));
  // 노선 형상은 거의 안 바뀜 → Vercel CDN 에 하루 캐시해 공공 API 호출량을 줄임
  send(res, 200, Object.assign({ adapter: adapterName }, data), 'public, s-maxage=86400, stale-while-revalidate=86400');
});
