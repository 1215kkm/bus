const { api, send, handler } = require('./_util.js');

module.exports = handler((req, res) => {
  send(res, 200, {
    live: !!api.KEY,
    adapters: api.KEY ? Object.keys(api.ADAPTERS) : [],
    cities: Object.keys(api.CITIES),
    runtime: 'vercel',
  });
}, { needsKey: false });
