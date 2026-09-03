const { api, send, handler } = require('../_util.js');

/* GET /api/pos/<busRouteId>?city=seoul → 현재 차량 위치 */
module.exports = handler(async (req, res) => {
  const { id, city, adapter, adapterName } = api.pickCity(req.query || {});
  const routeId = decodeURIComponent(String((req.query && req.query.routeId) || ''));
  if (!routeId) return send(res, 400, { error: 'routeId 가 없습니다.' });
  const list = await api.cached(`pos:${id}:${adapterName}:${routeId}`, 10000, () => adapter.positions(routeId, city));
  // 서버리스는 인스턴스마다 메모리 캐시가 따로라, CDN 캐시로 여러 사람이 한 번의 호출을 나눠 씀
  send(res, 200, list, 'public, s-maxage=10, stale-while-revalidate=20');
});
