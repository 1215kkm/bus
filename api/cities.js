const { api, send, handler } = require('./_util.js');

module.exports = handler((req, res) => send(res, 200, api.CITIES, 'public, s-maxage=3600'), { needsKey: false });
