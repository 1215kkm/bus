/* Vercel 서버리스 함수 공통 껍데기 — 로컬 server.js 와 같은 lib/bus-api.js 를 씁니다. */
const api = require('../lib/bus-api.js');

function send(res, status, body, cacheControl) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cacheControl || 'no-store');
  res.end(JSON.stringify(body));
}

/** 핸들러를 감싸 에러를 502 JSON 으로, 키 없음을 503 으로 바꿔 줍니다. */
function handler(fn, { needsKey = true } = {}) {
  return async (req, res) => {
    try {
      if (needsKey && !api.KEY) return send(res, 503, { error: 'DATA_GO_KR_API_KEY 환경변수가 없습니다.' });
      await fn(req, res);
    } catch (e) {
      console.error(`[api] ${req.url} → ${e.message}`);
      send(res, 502, { error: e.message });
    }
  };
}

module.exports = { api, send, handler };
