/* 게임 모드 — 배달 드라이버
 * 실시간 버스가 계속 돌아다니는 지도 위에서 탈것을 골라 직접 운전하고,
 * 근처에서 뜨는 의뢰(말풍선)를 휴대폰 문자로 수락해 픽업 → 배달을 완수합니다.
 *
 *  조작: W/↑ 가속 · S/↓ 브레이크·후진 · A/D 또는 ←/→ 조향 · Space 핸드브레이크
 *        C 시점 전환(운전석/추적/탑뷰/자유) · H 경적 · M 소리 · P 휴대폰 · Esc 종료
 *  길 안내: OSRM 공개 라우터(router.project-osrm.org)로 최단 경로를 받아 그리고, 실패하면 직선으로 안내합니다.
 *  소리: 오디오 파일 없이 Web Audio 로 엔진음·경적·알림음을 합성합니다.
 */
(function () {
  const G = window.SB_GEO;

  /* ── 탈것 ─────────────────────────────────────────── */
  const VEHICLES = {
    bike:  { name: '오토바이', emoji: '🏍️', maxKmh: 260, accel: 22, brake: 16, turn: 3.2, len: 2.2, wid: 0.9, hgt: 1.3, color: '#ff5c8a', reward: 1.0, radius: 1500, wave: 'square',   base: 70, range: 6,
             armor: 22,  smashKmh: 0,   crush: 0,   desc: '가장 민첩. 벽에 부딪히면 크게 튕겨 나감' },
    sport: { name: '스포츠카', emoji: '🏎️', maxKmh: 480, accel: 34, brake: 22, turn: 2.3, len: 4.5, wid: 1.9, hgt: 1.2, color: '#ffd166', reward: 1.2, radius: 2500, wave: 'sawtooth', base: 55, range: 7,
             armor: 34,  smashKmh: 0,   crush: 0,   desc: '압도적인 최고 속도. 신속 보너스에 유리' },
    bus:   { name: '버스',     emoji: '🚌', maxKmh: 210, accel: 12, brake: 11, turn: 1.5, len: 11,  wid: 2.5, hgt: 3.4, color: '#4f7de8', reward: 1.6, radius: 3000, wave: 'sawtooth', base: 38, range: 4,
             armor: 78,  smashKmh: 150, crush: 22,  desc: '단체 승객 이동. 아주 빠르면 벽도 뚫음' },
    truck: { name: '트럭',     emoji: '🚚', maxKmh: 240, accel: 15, brake: 12, turn: 1.7, len: 8,   wid: 2.4, hgt: 3.0, color: '#7bd3c8', reward: 1.5, radius: 3000, wave: 'sawtooth', base: 42, range: 4,
             armor: 88,  smashKmh: 90,  crush: 40,  desc: '큰 짐 운반. 웬만한 건물은 밀고 지나감' },
    dump:  { name: '덤프트럭', emoji: '🚛', maxKmh: 200, accel: 13, brake: 10, turn: 1.4, len: 9,   wid: 2.6, hgt: 3.5, color: '#f39c3d', reward: 1.8, radius: 3500, wave: 'triangle', base: 34, range: 3.5,
             armor: 130, smashKmh: 45,  crush: 100, desc: '철거 전문. 낮은 속도에도 건물이 무너짐' },
  };
  const NITRO_MAX = 100, NITRO_DRAIN = 34, NITRO_FILL = 11;
  const ITEMS = {
    bike: ['치킨', '떡볶이 세트', '아이스 아메리카노 4잔', '꽃다발', '서류 봉투', '약 봉투', '케이크'],
    sport: ['긴급 서류', '결혼반지', '생일 케이크', '한정판 운동화', 'VIP 도시락'],
    bus: ['단체 승객 12명', '수학여행 학생 30명', '회사 워크숍 팀', '동호회 회원들'],
    truck: ['이삿짐', '냉장고', '가구 세트', '생수 20팔레트', '사무용 책상 10개'],
    dump: ['모래 8톤', '자갈', '건설 자재', '흙 6톤', '폐콘크리트'],
  };
  const NAMES = ['김민준', '이서연', '박지호', '최수아', '정도윤', '강하은', '조예준', '윤지우', '한서준', '오하린'];
  const CAMS = ['driver', 'chase', 'top', 'free'];
  const CAM_LABEL = { driver: '운전석', chase: '추적', top: '탑뷰', free: '자유' };
  const CAM_SET = { driver: { pitch: 84, zoom: 19.2, ahead: 9 }, chase: { pitch: 72, zoom: 17.9, ahead: 28 }, top: { pitch: 45, zoom: 16.6, ahead: 60 } };

  const game = {
    active: false, key: null, spec: null,
    lng: 0, lat: 0, heading: 0, speed: 0, camBearing: 0, cam: 'chase', zoomOffset: 0,
    keys: {}, money: 0, done: 0, failed: 0, requests: [], mission: null, guide: null,
    sound: true, audio: null, minimap: null, markers: new Map(), lastReqTick: 0, lastHud: 0,
    phoneOpen: false, thread: [], typing: null, unread: 0, sitting: null,
    // 충돌 · 파괴
    ghost: false, boosting: false, damage: 0, crashes: 0, smashed: 0, combo: 0, comboAt: 0,
    hitCool: 0, shake: 0, nitro: NITRO_MAX, wrecked: 0,
    destroyed: new Set(), hiddenIds: [], rubble: [], particles: [],
  };
  let app, map, ui = {};

  /* ── 진입 · 종료 ─────────────────────────────────── */
  function init() {
    app = window.SB_APP; map = app.map;
    buildDom();
    map.on('style.load', () => { if (game.active) addLayers(); });
    document.addEventListener('keydown', onKey);
    document.addEventListener('keyup', onKey);
    window.addEventListener('blur', () => { game.keys = {}; });
  }

  function toggle() { game.active ? stop() : openSelect(); }

  function openSelect() {
    ui.select.hidden = false;
    document.body.classList.add('game-select');
  }

  function start(key) {
    ui.select.hidden = true;
    document.body.classList.remove('game-select');
    game.key = key; game.spec = VEHICLES[key];
    // 지금 보고 있던 화면 한가운데에서 출발 → 실시간 지도에서 그대로 이어짐
    const c = map.getCenter();
    game.lng = c.lng; game.lat = c.lat; game.heading = map.getBearing(); game.camBearing = game.heading;
    game.speed = 0; game.cam = 'chase'; game.zoomOffset = 0; game.mission = null; game.guide = null; game.sitting = null;
    game.thread = []; game.unread = 0;
    game.ghost = false; game.damage = 0; game.crashes = 0; game.smashed = 0; game.combo = 0;
    game.hitCool = 0; game.shake = 0; game.nitro = NITRO_MAX; game.wrecked = 0;
    game.destroyed = new Set(); game.hiddenIds = []; game.rubble = []; game.particles = []; game.prevNose = null;
    game.active = true;
    document.body.classList.add('game-on');
    ui.root.hidden = false;
    map.scrollZoom.disable();
    addLayers();
    startAudio();
    initMinimap();
    ui.vehName.textContent = `${game.spec.emoji} ${game.spec.name}`;
    updateHud(true);
    pushMsg('sys', `${game.spec.name} 운전을 시작합니다. 근처 의뢰 말풍선을 클릭하면 문자로 상세 내용이 옵니다.`);
    if (game.spec.crush) pushMsg('sys', `${game.spec.smashKmh}km/h 이상으로 건물을 들이받으면 건물이 무너지고 철거 수당이 붙습니다.`);
    app.toast(`게임 모드 · ${game.spec.name} — W/A/S/D 로 운전, C 로 시점 전환, Esc 로 종료`);
    map.easeTo({ center: [game.lng, game.lat], zoom: CAM_SET.chase.zoom, pitch: CAM_SET.chase.pitch, bearing: game.heading, duration: 1600 });
  }

  function stop() {
    game.active = false;
    document.body.classList.remove('game-on', 'game-select');
    ui.root.hidden = true; ui.select.hidden = true; ui.phone.hidden = true; game.phoneOpen = false;
    map.scrollZoom.enable();
    clearRequests(); clearMission(false);
    game.hiddenIds = []; applyBuildingFilter();
    const own = ['sb-game-veh', 'sb-game-guide', 'sb-game-rubble', 'sb-game-debris'];
    for (const id of own) if (map.getLayer(id)) map.removeLayer(id);
    for (const id of own) if (map.getSource(id)) map.removeSource(id);
    if (game.minimap) { game.minimap.remove(); game.minimap = null; }
    stopAudio();
    map.easeTo({ pitch: 58, zoom: Math.min(map.getZoom(), 15), duration: 1200 });
    app.toast('게임 모드를 종료했습니다. 실시간 지도로 돌아갑니다');
  }

  /* ── 레이어 ─────────────────────────────────────── */
  function addLayers() {
    if (map.getSource('sb-game-veh')) return;
    map.addSource('sb-game-guide', { type: 'geojson', data: empty() });
    map.addSource('sb-game-veh', { type: 'geojson', data: empty() });
    map.addLayer({
      id: 'sb-game-guide', type: 'line', source: 'sb-game-guide',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffb547', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3, 16, 7, 19, 12], 'line-opacity': 0.85, 'line-dasharray': [1.2, 1.4] },
    });
    map.addSource('sb-game-rubble', { type: 'geojson', data: empty() });
    map.addSource('sb-game-debris', { type: 'geojson', data: empty() });
    map.addLayer({
      id: 'sb-game-rubble', type: 'fill-extrusion', source: 'sb-game-rubble',
      paint: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-base': 0, 'fill-extrusion-opacity': 0.95 },
    });
    map.addLayer({
      id: 'sb-game-veh', type: 'fill-extrusion', source: 'sb-game-veh',
      paint: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-base': ['get', 'b'], 'fill-extrusion-opacity': 0.98, 'fill-extrusion-vertical-gradient': true },
    });
    map.addLayer({
      id: 'sb-game-debris', type: 'circle', source: 'sb-game-debris',
      paint: { 'circle-radius': ['get', 'r'], 'circle-color': ['get', 'color'], 'circle-opacity': ['get', 'o'], 'circle-blur': ['get', 'blur'], 'circle-pitch-alignment': 'map' },
    });
    if (game.guide) map.getSource('sb-game-guide').setData(game.guide.fc);
    applyBuildingFilter();
    refreshRubble();
  }
  const empty = () => ({ type: 'FeatureCollection', features: [] });

  /* ── 프레임 ─────────────────────────────────────── */
  function tick(dt) {
    if (!game.active) return;
    physics(dt);
    collision(dt);
    particles(dt);
    camera(dt);
    render();
    missions(dt);
    if (game.audio) game.audio.update(Math.abs(game.speed) / (game.spec.maxKmh / 3.6), game.keys.up ? 1 : 0);
    const now = performance.now();
    if (now - game.lastReqTick > 1000) { game.lastReqTick = now; spawnRequests(); refreshBubbles(); }
    if (now - game.lastHud > 120) { game.lastHud = now; updateHud(); }
    if (game.minimap && game.minimap._sbReady) updateMinimap();
  }

  function physics(dt) {
    const s = game.spec, k = game.keys;
    const boosting = !!k.boost && !!k.up && game.nitro > 0 && game.speed > 1;
    game.nitro = Math.max(0, Math.min(NITRO_MAX, game.nitro + (boosting ? -NITRO_DRAIN : NITRO_FILL) * dt));
    game.boosting = boosting;
    const max = s.maxKmh / 3.6 * (boosting ? 1.35 : 1);
    if (k.up) game.speed += s.accel * (boosting ? 1.9 : 1) * dt;
    else if (k.down) {
      if (game.speed > 0.3) game.speed -= s.brake * dt;
      else game.speed = Math.max(-max / 4, game.speed - s.accel * 0.6 * dt);
    } else {
      const drag = 0.9 + 0.004 * game.speed * game.speed;
      game.speed -= Math.sign(game.speed) * Math.min(Math.abs(game.speed), drag * dt);
    }
    if (k.brake) game.speed -= Math.sign(game.speed) * Math.min(Math.abs(game.speed), s.brake * 1.6 * dt);
    game.speed = Math.max(-max / 4, Math.min(max, game.speed));
    if (game.wrecked > 0) { game.wrecked -= dt; game.speed *= 0.86; }
    const steer = (k.left ? -1 : 0) + (k.right ? 1 : 0);
    if (steer && Math.abs(game.speed) > 0.2) {
      const eff = Math.min(1, Math.abs(game.speed) / 7) * (1 - 0.45 * Math.min(1, Math.abs(game.speed) / max));
      game.heading = (game.heading + steer * eff * s.turn * 57.3 * dt * (game.speed < 0 ? -1 : 1) + 360) % 360;
    }
    if (Math.abs(game.speed) > 0.01) {
      const p = G.move(game.lng, game.lat, game.heading, game.speed * dt, 0);
      game.lng = p[0]; game.lat = p[1];
    }
  }

  function camera(dt) {
    if (game.shake > 0) game.shake = Math.max(0, game.shake - dt * 2.4);
    if (game.cam === 'free') return;
    const c = CAM_SET[game.cam];
    const k = 1 - Math.exp(-dt * (game.cam === 'driver' ? 10 : 5));
    const diff = ((game.heading - game.camBearing + 540) % 360) - 180;
    game.camBearing = (game.camBearing + diff * k + 360) % 360;
    // 빠를수록 카메라가 뒤로 물러나 시야를 넓힘
    const ratio = Math.min(1, Math.abs(game.speed) / (game.spec.maxKmh / 3.6));
    let center = G.move(game.lng, game.lat, game.heading, c.ahead * (1 + ratio * 0.9), 0);
    let bearing = game.camBearing, pitch = c.pitch;
    if (game.shake > 0) {
      const m = game.shake * game.shake * 26;
      center = G.offset(center[0], center[1], (Math.random() - 0.5) * m, (Math.random() - 0.5) * m);
      bearing += (Math.random() - 0.5) * game.shake * 9;
      pitch = Math.max(0, Math.min(85, pitch + (Math.random() - 0.5) * game.shake * 7));
    }
    map.jumpTo({ center, bearing, pitch, zoom: c.zoom + game.zoomOffset - ratio * 0.85 });
  }

  function render() {
    const src = map.getSource('sb-game-veh'); if (!src) return;
    const s = game.spec;
    const mpp = G.metersPerPixel(game.lat, map.getZoom());
    const scale = Math.max(1, 14 * mpp / s.len);
    const L = s.len * scale, W = s.wid * scale, H = s.hgt * scale;
    const feats = [
      { type: 'Feature', properties: { color: s.color, h: H, b: 0 }, geometry: { type: 'Polygon', coordinates: G.boxPolygon(game.lng, game.lat, game.heading, L, W) } },
    ];
    if (game.key === 'bike') {
      const rider = G.move(game.lng, game.lat, game.heading, -L * 0.1, 0);
      feats.push({ type: 'Feature', properties: { color: '#2b2f3a', h: H * 1.9, b: H * 0.6 }, geometry: { type: 'Polygon', coordinates: G.boxPolygon(rider[0], rider[1], game.heading, L * 0.35, W * 0.9) } });
    } else if (game.key === 'sport') {
      feats.push({ type: 'Feature', properties: { color: '#1d2230', h: H * 1.55, b: H * 0.7 }, geometry: { type: 'Polygon', coordinates: G.boxPolygon(...G.move(game.lng, game.lat, game.heading, -L * 0.08, 0), game.heading, L * 0.48, W * 0.82) } });
    } else if (game.key === 'bus') {
      feats.push({ type: 'Feature', properties: { color: '#dfe7ff', h: H * 1.06, b: H * 0.55 }, geometry: { type: 'Polygon', coordinates: G.boxPolygon(game.lng, game.lat, game.heading, L * 0.96, W * 1.02) } });
    } else {
      // 트럭·덤프: 앞쪽 캡 + 뒤 적재함
      const cab = G.move(game.lng, game.lat, game.heading, L * 0.32, 0);
      const bed = G.move(game.lng, game.lat, game.heading, -L * 0.2, 0);
      feats.push({ type: 'Feature', properties: { color: '#1d2230', h: H * 1.15, b: H * 0.5 }, geometry: { type: 'Polygon', coordinates: G.boxPolygon(cab[0], cab[1], game.heading, L * 0.3, W * 0.95) } });
      feats.push({ type: 'Feature', properties: { color: game.key === 'dump' ? '#8a6d3b' : '#c9d3dd', h: H * (game.key === 'dump' ? 1.25 : 1.1), b: H * 0.45 }, geometry: { type: 'Polygon', coordinates: G.boxPolygon(bed[0], bed[1], game.heading, L * 0.56, W * 1.02) } });
    }
    src.setData({ type: 'FeatureCollection', features: feats });
  }

  /* ── 충돌 · 파괴 ─────────────────────────────────── */
  const HIT_WORDS = ['쿵!', '쾅!', '으악!', '깡!'];
  const SMASH_WORDS = ['쾅!!', '와장창!!', '박살!!', '무너진다!!'];

  /** 차 앞머리가 건물 안에 들어갔는지 검사 */
  function collision(dt) {
    game.hitCool -= dt;
    if (game.ghost || game.hitCool > 0) return;
    if (!map.getLayer('sb-buildings') || map.getLayoutProperty('sb-buildings', 'visibility') === 'none') return;
    const spd = Math.abs(game.speed);
    if (spd < 2.2) return;
    const s = game.spec;
    const fwd = s.len * 0.55 * (game.speed < 0 ? -1 : 1);
    const nose = G.move(game.lng, game.lat, game.heading, fwd, 0);
    const prev = game.prevNose || nose;
    game.prevNose = nose;

    let a, b;
    try { a = map.project(prev); b = map.project(nose); } catch (_) { return; }
    if (!a || !b || !isFinite(a.x) || !isFinite(b.x)) return;
    const pad = 34;
    const box = [[Math.min(a.x, b.x) - pad, Math.min(a.y, b.y) - pad], [Math.max(a.x, b.x) + pad, Math.max(a.y, b.y) + pad]];
    if (box[1][0] < -300 || box[1][1] < -300 || box[0][0] > innerWidth + 300 || box[0][1] > innerHeight + 300) return;
    if (box[1][0] - box[0][0] > 1600 || box[1][1] - box[0][1] > 1600) return;   // 순간이동 등 비정상 구간은 건너뜀
    let cands;
    try { cands = map.queryRenderedFeatures(box, { layers: ['sb-buildings'] }); }
    catch (_) { return; }
    if (!cands || !cands.length) return;

    // 한 프레임에 벽을 지나쳐 버리지 않도록 이동 구간을 나눠 검사한다
    const travel = G.haversine(prev, nose);
    const steps = Math.max(1, Math.min(6, Math.ceil(travel / 3)));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const p = [prev[0] + (nose[0] - prev[0]) * t, prev[1] + (nose[1] - prev[1]) * t];
      // 이미 부순 건물은 그대로 통과 (id 가 없어 숨기지 못한 건물도 다시 막지 않도록)
      const hit = cands.find(f => f.geometry && !game.destroyed.has(featKey(f)) && G.pointInPolygon(p[0], p[1], f.geometry));
      if (hit) { impact(hit, spd, p); return; }
    }
  }

  function featKey(f) {
    if (f.id != null) return 'i' + f.id;
    const c = G.polyCenter(f.geometry);
    return 'c' + c[0].toFixed(6) + ',' + c[1].toFixed(6);
  }

  function impact(feat, spd, nose) {
    const s = game.spec;
    const kmh = spd * 3.6;
    const key = featKey(feat);
    const height = Number(feat.properties && (feat.properties.render_height || feat.properties.height)) || 12;
    // 건물이 클수록 부수기 어려움
    const needed = s.smashKmh * (1 + Math.max(0, height - 12) / 55);
    const canSmash = s.crush > 0 && kmh >= needed;
    game.hitCool = canSmash ? 0.18 : 0.45;
    game.shake = Math.min(1.5, (canSmash ? 0.55 : 0.75) + kmh / 320);
    flash(canSmash ? 'smash' : 'hit');

    if (canSmash) {
      game.destroyed.add(key);
      demolish(feat, key, height);
      game.smashed++;
      const now = performance.now();
      game.combo = now - game.comboAt < 6000 ? game.combo + 1 : 1;
      game.comboAt = now;
      const pay = Math.round((1200 + height * 60) * (1 + (game.combo - 1) * 0.5) / 100) * 100;
      game.money += pay;
      game.damage = Math.min(100, game.damage + Math.max(2, 14 - s.crush / 10));
      game.speed *= 0.55;                                    // 밀고 지나가되 속도는 깎임
      floatText(`${SMASH_WORDS[Math.floor(Math.random() * SMASH_WORDS.length)]} 철거 수당 +${pay.toLocaleString()}원${game.combo > 1 ? `  ${game.combo}연쇄!` : ''}`, 'smash');
      if (game.audio) game.audio.crash(1, true);
      app.toast(`🏗️ 건물 철거 · +${pay.toLocaleString()}원${game.combo > 1 ? ` (${game.combo}연쇄)` : ''}`);
    } else {
      game.crashes++;
      game.combo = 0;
      const dmg = Math.min(60, kmh * kmh / (s.armor * 12));
      game.damage = Math.min(100, game.damage + dmg);
      // 튕겨 나오기: 건물 밖으로 밀어내고 반대 방향으로 반동
      const back = G.move(game.lng, game.lat, game.heading, -Math.sign(game.speed) * (s.len * 0.9 + 3), 0);
      game.lng = back[0]; game.lat = back[1];
      game.speed = -game.speed * (0.18 + Math.min(0.3, s.armor / 400));
      game.heading = (game.heading + (Math.random() - 0.5) * 26 + 360) % 360;
      game.wrecked = 0.35;
      spawnDebris(nose, Math.min(1, kmh / 160), '#ffd9a0');
      floatText(HIT_WORDS[Math.floor(Math.random() * HIT_WORDS.length)] + `  -${Math.round(dmg)}%`, 'hit');
      if (game.audio) game.audio.crash(Math.min(1, kmh / 180), false);
      if (game.damage >= 100) wreck();
    }
    updateHud(true);
  }

  function wreck() {
    const fee = 5000;
    game.money = Math.max(0, game.money - fee);
    game.damage = 0; game.speed = 0; game.wrecked = 1.4; game.combo = 0;
    floatText(`💥 완파 · 견인 수리비 -${fee.toLocaleString()}원`, 'hit');
    app.toast('차량이 완파되어 현장에서 수리했습니다 · -5,000원');
    pushMsg('sys', '차량이 완파되어 견인·수리했습니다. 수리비 5,000원이 빠졌어요.');
    if (game.audio) game.audio.crash(1, true);
  }

  /** 건물 숨기고 잔해 더미로 교체 */
  function demolish(feat, key, height) {
    if (feat.id != null && !game.hiddenIds.includes(feat.id)) { game.hiddenIds.push(feat.id); applyBuildingFilter(); }
    game.rubble.push({ geom: feat.geometry, h0: height, h1: Math.max(1.5, height * 0.16), t: 0 });
    refreshRubble();
    const c = G.polyCenter(feat.geometry);
    spawnDebris(c, 1, '#b9c2cc', 26);
    spawnDebris(nudge(c), 0.8, '#8d97a3', 14);
  }
  function nudge(c) { return G.offset(c[0], c[1], (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12); }

  function applyBuildingFilter() {
    if (!map.getLayer('sb-buildings')) return;
    try { map.setFilter('sb-buildings', game.hiddenIds.length ? ['!', ['in', ['id'], ['literal', game.hiddenIds]]] : null); }
    catch (e) { console.warn('[game] 건물 숨김 실패', e.message); }
  }

  function refreshRubble() {
    const src = map.getSource('sb-game-rubble'); if (!src) return;
    src.setData({
      type: 'FeatureCollection',
      features: game.rubble.map(r => ({
        type: 'Feature',
        properties: { h: r.h1 + (r.h0 - r.h1) * Math.max(0, 1 - r.t), color: r.t < 1 ? '#6b7280' : '#565f6b' },
        geometry: r.geom,
      })),
    });
  }

  /* ── 파편 · 먼지 ─────────────────────────────────── */
  function spawnDebris(at, power, color, count) {
    const n = Math.round((count || 16) * (0.5 + power));
    for (let i = 0; i < n; i++) {
      const dir = Math.random() * 360;
      const sp = (3 + Math.random() * 16) * (0.4 + power);
      game.particles.push({
        lng: at[0], lat: at[1], dir, sp, z: 1 + Math.random() * 4,
        vz: 3 + Math.random() * 9 * power, life: 1, size: 2 + Math.random() * 5, color,
      });
    }
    if (game.particles.length > 400) game.particles.splice(0, game.particles.length - 400);
  }

  function particles(dt) {
    if (!game.particles.length) {
      if (game.rubbleAnim) stepRubble(dt);
      return;
    }
    const alive = [];
    for (const p of game.particles) {
      p.life -= dt * 0.85;
      if (p.life <= 0) continue;
      p.vz -= 22 * dt;
      p.z = Math.max(0, p.z + p.vz * dt);
      if (p.z <= 0) { p.vz = -p.vz * 0.35; p.sp *= 0.55; }
      p.sp *= (1 - dt * 1.6);
      const np = G.move(p.lng, p.lat, p.dir, p.sp * dt, 0);
      p.lng = np[0]; p.lat = np[1];
      alive.push(p);
    }
    game.particles = alive;
    const src = map.getSource('sb-game-debris');
    if (src) src.setData({
      type: 'FeatureCollection',
      features: alive.map(p => ({
        type: 'Feature',
        properties: { r: p.size * (0.6 + p.z / 14), o: Math.min(0.9, p.life), color: p.color, blur: p.z > 6 ? 0.6 : 0.1 },
        geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      })),
    });
    stepRubble(dt);
  }

  function stepRubble(dt) {
    let animating = false;
    for (const r of game.rubble) if (r.t < 1) { r.t = Math.min(1, r.t + dt * 1.6); animating = true; }
    game.rubbleAnim = animating;
    if (animating) refreshRubble();
  }

  /* ── 화면 효과 ───────────────────────────────────── */
  let flashTimer;
  function flash(kind) {
    ui.flash.className = 'flash ' + kind;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { ui.flash.className = 'flash'; }, kind === 'smash' ? 320 : 200);
  }
  function floatText(text, kind) {
    const el = document.createElement('div');
    el.className = 'float-text ' + kind;
    el.textContent = text;
    ui.floats.appendChild(el);
    setTimeout(() => el.remove(), 1400);
  }

  /* ── 의뢰 ────────────────────────────────────────── */
  function stopsPool() {
    const seen = new Map();
    for (const r of app.routes) for (const st of r.stops) if (!seen.has(st.name)) seen.set(st.name, { name: st.name, lng: st.lng, lat: st.lat });
    return [...seen.values()];
  }
  function dist(a, b) { return G.haversine([a.lng, a.lat], [b.lng, b.lat]); }

  function spawnRequests() {
    if (game.mission || game.requests.length >= 3) return;
    const me = { lng: game.lng, lat: game.lat };
    const pool = stopsPool().map(s => Object.assign({ d: dist(me, s) }, s)).sort((a, b) => a.d - b.d);
    let near = pool.filter(s => s.d > 150 && s.d < game.spec.radius);
    if (near.length < 3) near = pool.slice(0, 6);                      // 근처에 정류장이 없으면 가장 가까운 곳들
    near = near.filter(s => !game.requests.some(r => r.pickup.name === s.name));
    if (!near.length) return;
    const pickup = near[Math.floor(Math.random() * near.length)];
    let dests = pool.filter(s => { const d = dist(pickup, s); return d > 700 && d < 4500 && s.name !== pickup.name; });
    if (!dests.length) dests = pool.filter(s => s.name !== pickup.name).slice(0, 5);
    const dest = dests[Math.floor(Math.random() * dests.length)];
    const km = dist(pickup, dest) / 1000;
    const items = ITEMS[game.key];
    const req = {
      id: Date.now() + Math.random(), pickup, dest, km,
      item: items[Math.floor(Math.random() * items.length)],
      client: NAMES[Math.floor(Math.random() * NAMES.length)],
      reward: Math.round((2500 + km * 1100) * game.spec.reward / 100) * 100,
      limit: Math.round(60 + km * 1000 / (game.spec.maxKmh / 3.6 * 0.45)),
    };
    const el = document.createElement('div');
    el.className = 'req-bubble';
    el.innerHTML = `<b>💬 ${req.item}</b><span></span>`;
    el.addEventListener('click', e => { e.stopPropagation(); openPhone(req); });
    req.marker = new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -14] }).setLngLat([pickup.lng, pickup.lat]).addTo(map);
    game.requests.push(req);
    if (game.audio) game.audio.ping();
  }
  function refreshBubbles() {
    const me = { lng: game.lng, lat: game.lat };
    for (const r of game.requests) {
      const d = dist(me, r.pickup);
      r.marker.getElement().querySelector('span').textContent = `${fmtDist(d)} · ${r.reward.toLocaleString()}원`;
      if (d > game.spec.radius * 2.5) removeRequest(r);   // 너무 멀어지면 의뢰 소멸
    }
  }
  function removeRequest(r) { r.marker.remove(); game.requests = game.requests.filter(x => x !== r); }
  function clearRequests() { for (const r of [...game.requests]) removeRequest(r); }

  /* ── 휴대폰 ─────────────────────────────────────── */
  function openPhone(req) {
    game.phoneOpen = true; ui.phone.hidden = false; game.unread = 0;
    if (req && (!game.sitting || game.sitting.id !== req.id)) {
      game.sitting = req;
      game.thread = [];
      renderThread();
      const km = req.km.toFixed(1);
      const lines = [
        ['them', `안녕하세요, ${req.client}입니다. 지금 배달 가능하세요?`],
        ['them', `📍 픽업: ${req.pickup.name}\n🏁 도착: ${req.dest.name}\n📦 ${req.item}`],
        ['them', `거리 ${km}km, 제한시간 ${fmtTime(req.limit)}이고 보수는 ${req.reward.toLocaleString()}원 드릴게요.`],
      ];
      let delay = 200;
      for (const [who, text] of lines) { setTimeout(() => pushMsg(who, text), delay); delay += 900; }
      setTimeout(() => showAccept(req), delay);
    }
    renderThread();
  }
  function closePhone() { game.phoneOpen = false; ui.phone.hidden = true; }
  function pushMsg(who, text) {
    game.thread.push({ who, text, t: new Date() });
    if (!game.phoneOpen && who === 'them') { game.unread++; updateHud(true); if (game.audio) game.audio.ping(); }
    renderThread();
  }
  function renderThread() {
    const t = new Date();
    ui.phoneTime.textContent = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
    ui.phoneName.textContent = game.sitting ? game.sitting.client : '배달 의뢰';
    ui.thread.innerHTML = game.thread.map(m => `<div class="msg ${m.who}">${escape(m.text).replace(/\n/g, '<br>')}</div>`).join('');
    ui.thread.scrollTop = ui.thread.scrollHeight;
    ui.phoneActions.innerHTML = '';
  }
  function showAccept(req) {
    if (!game.requests.includes(req) || game.mission) return;
    ui.phoneActions.innerHTML = `<button class="acc">수락 · 배달 시작</button><button class="dec">거절</button>`;
    ui.phoneActions.querySelector('.acc').onclick = () => accept(req);
    ui.phoneActions.querySelector('.dec').onclick = () => { pushMsg('me', '죄송해요, 지금은 어려울 것 같아요.'); removeRequest(req); setTimeout(closePhone, 700); };
  }
  function accept(req) {
    pushMsg('me', '네, 지금 출발할게요! 🛵');
    setTimeout(() => pushMsg('them', `감사합니다! ${req.pickup.name}에서 기다릴게요.`), 700);
    game.mission = { req, stage: 'pickup', t0: performance.now(), pickedAt: 0 };
    for (const r of [...game.requests]) if (r !== req) removeRequest(r);
    req.marker.getElement().classList.add('accepted');
    req.marker.getElement().innerHTML = `<b>📦 픽업</b><span>${req.pickup.name}</span>`;
    setGuide({ lng: game.lng, lat: game.lat }, req.pickup);
    setTimeout(closePhone, 1500);
    if (game.audio) game.audio.chime([523, 659, 784]);
    updateHud(true);
  }
  function clearMission(keepMarkers) {
    const m = game.mission; game.mission = null;
    if (m && !keepMarkers) { m.req.marker.remove(); if (m.destMarker) m.destMarker.remove(); }
    game.guide = null;
    const src = map.getSource('sb-game-guide'); if (src) src.setData(empty());
    updateHud(true);
  }

  function missions(dt) {
    const m = game.mission; if (!m) return;
    const elapsed = (performance.now() - m.t0) / 1000;
    const target = m.stage === 'pickup' ? m.req.pickup : m.req.dest;
    const d = dist({ lng: game.lng, lat: game.lat }, target);
    if (game.guide && (performance.now() - game.guide.at > 4000) && d > 60) setGuide({ lng: game.lng, lat: game.lat }, target, true);   // 안내선 갱신
    if (d < 32 && Math.abs(game.speed) < 2.5) {
      if (m.stage === 'pickup') {
        m.stage = 'deliver'; m.pickedAt = elapsed;
        m.req.marker.remove();
        const el = document.createElement('div'); el.className = 'req-bubble accepted'; el.innerHTML = `<b>🏁 배달지</b><span>${m.req.dest.name}</span>`;
        m.destMarker = new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -14] }).setLngLat([m.req.dest.lng, m.req.dest.lat]).addTo(map);
        pushMsg('sys', `${m.req.item} 픽업 완료! 이제 ${m.req.dest.name}까지 가세요.`);
        setTimeout(() => pushMsg('them', '잘 부탁드려요. 도착하면 문자 주세요 🙏'), 800);
        setGuide({ lng: game.lng, lat: game.lat }, m.req.dest);
        if (game.audio) game.audio.chime([659, 880]);
      } else {
        const fast = elapsed < m.req.limit * 0.6;
        const bonus = fast ? Math.round(m.req.reward * 0.3 / 100) * 100 : 0;
        game.money += m.req.reward + bonus; game.done++;
        pushMsg('me', '도착했습니다! 문 앞에 두고 갈게요.');
        setTimeout(() => pushMsg('them', `감사합니다! ${fast ? '엄청 빠르시네요 ⭐⭐⭐⭐⭐ (보너스 +' + bonus.toLocaleString() + '원)' : '수고하셨어요 ⭐⭐⭐⭐'}`), 700);
        app.toast(`배달 완료 · +${(m.req.reward + bonus).toLocaleString()}원${fast ? ' (신속 보너스)' : ''}`);
        if (game.audio) game.audio.chime([523, 659, 784, 1047]);
        clearMission(false);
      }
      return;
    }
    if (elapsed > m.req.limit) {
      game.failed++;
      pushMsg('them', '너무 늦어서 취소할게요… 😢');
      app.toast('제한시간 초과 · 의뢰가 취소되었습니다');
      if (game.audio) game.audio.chime([392, 311]);
      clearMission(false);
    }
  }

  /* ── 길 안내 (OSRM → 실패 시 직선) ──────────────── */
  let guideSeq = 0;
  async function setGuide(from, to, silent) {
    const seq = ++guideSeq;
    const straight = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[from.lng, from.lat], [to.lng, to.lat]] } }] };
    if (!game.guide || !silent) applyGuide({ fc: straight, distance: dist(from, to), at: performance.now(), osrm: false });
    try {
      const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 6000);
      const url = `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
      const res = await fetch(url, { signal: ctrl.signal }); clearTimeout(timer);
      if (!res.ok) throw new Error('OSRM ' + res.status);
      const j = await res.json();
      if (seq !== guideSeq || !j.routes || !j.routes[0]) return;
      const r = j.routes[0];
      applyGuide({ fc: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: r.geometry }] }, distance: r.distance, at: performance.now(), osrm: true });
    } catch (_) {
      if (seq === guideSeq && game.guide) game.guide.at = performance.now();
    }
  }
  function applyGuide(g) {
    game.guide = g;
    const src = map.getSource('sb-game-guide'); if (src) src.setData(g.fc);
    if (game.minimap && game.minimap._sbReady) game.minimap.getSource('mm-guide').setData(g.fc);
  }

  /* ── 미니맵 ─────────────────────────────────────── */
  function initMinimap() {
    if (game.minimap) return;
    const style = app.state.currentStyle || { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#1b2331' } }] };
    const mm = new maplibregl.Map({ container: ui.minimap, style, center: [game.lng, game.lat], zoom: 14.2, interactive: false, attributionControl: false, pitchWithRotate: false });
    game.minimap = mm;
    mm.on('load', () => {
      mm.addSource('mm-guide', { type: 'geojson', data: game.guide ? game.guide.fc : empty() });
      mm.addSource('mm-pts', { type: 'geojson', data: empty() });
      mm.addLayer({ id: 'mm-guide', type: 'line', source: 'mm-guide', paint: { 'line-color': '#ffb547', 'line-width': 4, 'line-opacity': 0.9 } });
      mm.addLayer({ id: 'mm-pts', type: 'circle', source: 'mm-pts', paint: { 'circle-radius': ['get', 'r'], 'circle-color': ['get', 'c'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
      mm._sbReady = true;
    });
  }
  function updateMinimap() {
    const mm = game.minimap;
    mm.jumpTo({ center: [game.lng, game.lat] });
    const pts = [{ type: 'Feature', properties: { r: 7, c: game.spec.color }, geometry: { type: 'Point', coordinates: [game.lng, game.lat] } }];
    if (game.mission) {
      const t = game.mission.stage === 'pickup' ? game.mission.req.pickup : game.mission.req.dest;
      pts.push({ type: 'Feature', properties: { r: 6, c: '#ffb547' }, geometry: { type: 'Point', coordinates: [t.lng, t.lat] } });
    } else for (const r of game.requests) pts.push({ type: 'Feature', properties: { r: 5, c: '#ffffff' }, geometry: { type: 'Point', coordinates: [r.pickup.lng, r.pickup.lat] } });
    mm.getSource('mm-pts').setData({ type: 'FeatureCollection', features: pts });
    ui.mmHeading.style.transform = `rotate(${game.heading}deg)`;
  }

  /* ── HUD ─────────────────────────────────────────── */
  function updateHud(force) {
    const kmh = Math.round(Math.abs(game.speed) * 3.6);
    ui.speed.textContent = kmh;
    ui.gear.textContent = game.speed < -0.2 ? 'R' : game.keys.brake ? 'P' : 'D';
    ui.needle.style.transform = `rotate(${-120 + 240 * Math.min(1, kmh / game.spec.maxKmh)}deg)`;
    if (!force && !game.mission && !ui.mission.hidden) ui.mission.hidden = true;
    const m = game.mission;
    if (m) {
      ui.mission.hidden = false;
      const target = m.stage === 'pickup' ? m.req.pickup : m.req.dest;
      const d = game.guide ? game.guide.distance : dist({ lng: game.lng, lat: game.lat }, target);
      const left = Math.max(0, m.req.limit - (performance.now() - m.t0) / 1000);
      ui.mission.innerHTML = `<span class="stage">${m.stage === 'pickup' ? '📦 픽업하러 가는 중' : '🏁 배달 중'}</span><b>${target.name}</b><span class="d">${fmtDist(d)}${game.guide && game.guide.osrm ? ' 도로 기준' : ' 직선'}</span><span class="t ${left < 30 ? 'warn' : ''}">⏱ ${fmtTime(left)}</span>`;
    } else if (force) ui.mission.hidden = true;
    ui.money.textContent = game.money.toLocaleString() + '원';
    ui.count.textContent = `${game.done}건 완료${game.failed ? ' · ' + game.failed + '건 실패' : ''}` +
      (game.smashed ? ` · 🏗️ ${game.smashed}채 철거` : '') + (game.crashes ? ` · 💥 ${game.crashes}회 충돌` : '');
    ui.dmgBar.style.width = game.damage + '%';
    ui.dmgBar.classList.toggle('crit', game.damage > 70);
    ui.nitroBar.style.width = game.nitro + '%';
    ui.nitroBar.classList.toggle('boost', !!game.boosting);
    ui.ghostBtn.classList.toggle('on', game.ghost);
    ui.cam.textContent = CAM_LABEL[game.cam];
    ui.phoneBtn.dataset.unread = game.unread || '';
    ui.soundBtn.textContent = game.sound ? '🔊' : '🔇';
  }
  const fmtDist = d => d >= 1000 ? (d / 1000).toFixed(1) + 'km' : Math.round(d) + 'm';
  const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const escape = t => t.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

  /* ── 입력 ───────────────────────────────────────── */
  function onKey(e) {
    if (!game.active) return;
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    const down = e.type === 'keydown';
    const k = e.key.toLowerCase();
    const mapKey = { w: 'up', arrowup: 'up', s: 'down', arrowdown: 'down', a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right', ' ': 'brake', shift: 'boost' }[k];
    if (mapKey) { game.keys[mapKey] = down; e.preventDefault(); return; }
    if (!down) return;
    if (k === 'c') { game.cam = CAMS[(CAMS.indexOf(game.cam) + 1) % CAMS.length]; game.zoomOffset = 0; app.toast(`시점: ${CAM_LABEL[game.cam]}`); updateHud(true); }
    else if (k === 'h') { if (game.audio) game.audio.horn(game.key); }
    else if (k === 'm') { game.sound = !game.sound; if (game.audio) game.audio.setMuted(!game.sound); updateHud(true); }
    else if (k === 'p') { game.phoneOpen ? closePhone() : openPhone(game.sitting); }
    else if (k === 'g') { toggleGhost(); }
    else if (k === 'r') { game.damage = 0; game.speed = 0; updateHud(true); app.toast('차량을 수리했습니다'); }
    else if (k === 'escape') { if (game.phoneOpen) closePhone(); else stop(); }
  }
  function onWheel(e) {
    if (!game.active || game.cam === 'free') return;
    e.preventDefault();
    game.zoomOffset = Math.max(-2.5, Math.min(1.5, game.zoomOffset - Math.sign(e.deltaY) * 0.15));
  }

  /* ── 소리 (Web Audio 합성) ──────────────────────── */
  function startAudio() {
    if (game.audio) { game.audio.setMuted(!game.sound); return; }
    try { game.audio = new EngineAudio(game.spec); game.audio.setMuted(!game.sound); } catch (e) { game.audio = null; }
  }
  function stopAudio() { if (game.audio) { game.audio.destroy(); game.audio = null; } }

  class EngineAudio {
    constructor(spec) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.spec = spec;
      this.master = this.ctx.createGain(); this.master.gain.value = 0.5; this.master.connect(this.ctx.destination);
      this.engineGain = this.ctx.createGain(); this.engineGain.gain.value = 0.0001;
      this.filter = this.ctx.createBiquadFilter(); this.filter.type = 'lowpass'; this.filter.frequency.value = 600; this.filter.Q.value = 2;
      this.osc1 = this.ctx.createOscillator(); this.osc1.type = spec.wave; this.osc1.frequency.value = spec.base;
      this.osc2 = this.ctx.createOscillator(); this.osc2.type = spec.wave === 'square' ? 'sawtooth' : 'square'; this.osc2.frequency.value = spec.base * 0.5; this.osc2.detune.value = 7;
      const g2 = this.ctx.createGain(); g2.gain.value = 0.5;
      this.osc1.connect(this.filter); this.osc2.connect(g2); g2.connect(this.filter);
      // 트럭·버스 저음 노이즈
      const buf = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.6;
      this.noise = this.ctx.createBufferSource(); this.noise.buffer = buf; this.noise.loop = true;
      this.noiseFilter = this.ctx.createBiquadFilter(); this.noiseFilter.type = 'bandpass'; this.noiseFilter.frequency.value = 120; this.noiseFilter.Q.value = 0.8;
      this.noiseGain = this.ctx.createGain(); this.noiseGain.gain.value = spec.len > 6 ? 0.35 : 0.12;
      this.noise.connect(this.noiseFilter); this.noiseFilter.connect(this.noiseGain); this.noiseGain.connect(this.engineGain);
      this.filter.connect(this.engineGain); this.engineGain.connect(this.master);
      this.osc1.start(); this.osc2.start(); this.noise.start();
      this.rpm = 0;
    }
    update(speedRatio, throttle) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      // 기어 변속 느낌: 속도를 3단으로 나눠 rpm 이 오르내림
      const gear = Math.min(2, Math.floor(speedRatio * 3));
      const inGear = (speedRatio * 3 - gear);
      const target = 0.25 + inGear * 0.75;
      this.rpm += (target - this.rpm) * 0.12;
      const f = this.spec.base * (1 + this.rpm * this.spec.range * 0.5 + gear * 0.35);
      const t = this.ctx.currentTime;
      this.osc1.frequency.setTargetAtTime(f, t, 0.05);
      this.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
      this.filter.frequency.setTargetAtTime(300 + this.rpm * 1400 + throttle * 500, t, 0.08);
      this.noiseFilter.frequency.setTargetAtTime(80 + this.rpm * 180, t, 0.1);
      this.engineGain.gain.setTargetAtTime(0.06 + throttle * 0.10 + speedRatio * 0.06, t, 0.08);
    }
    horn(key) {
      const t = this.ctx.currentTime;
      const freqs = key === 'bike' ? [780, 1040] : key === 'sport' ? [440, 554] : [330, 415];
      for (const fq of freqs) {
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = 'square'; o.frequency.value = fq; g.gain.value = 0.0001;
        o.connect(g); g.connect(this.master);
        g.gain.setTargetAtTime(0.12, t, 0.01); g.gain.setTargetAtTime(0.0001, t + 0.45, 0.05);
        o.start(t); o.stop(t + 0.8);
      }
    }
    chime(notes) {
      const t = this.ctx.currentTime;
      notes.forEach((fq, i) => {
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.type = 'sine'; o.frequency.value = fq; g.gain.value = 0.0001;
        o.connect(g); g.connect(this.master);
        g.gain.setTargetAtTime(0.18, t + i * 0.12, 0.01); g.gain.setTargetAtTime(0.0001, t + i * 0.12 + 0.25, 0.06);
        o.start(t + i * 0.12); o.stop(t + i * 0.12 + 0.6);
      });
    }
    /** 충돌음: 노이즈 파열 + 저역 쿵 (heavy 면 콘크리트 무너지는 저음 추가) */
    crash(power, heavy) {
      const t = this.ctx.currentTime;
      const dur = heavy ? 1.1 : 0.5;
      const buf = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * dur), this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, heavy ? 1.4 : 2.4);
      const src = this.ctx.createBufferSource(); src.buffer = buf;
      const bp = this.ctx.createBiquadFilter();
      bp.type = heavy ? 'lowpass' : 'bandpass';
      bp.frequency.value = heavy ? 700 : 900 + power * 1600;
      bp.Q.value = heavy ? 1 : 0.7;
      const g = this.ctx.createGain(); g.gain.value = Math.min(0.55, 0.14 + power * 0.4);
      src.connect(bp); bp.connect(g); g.connect(this.master); src.start(t);
      const o = this.ctx.createOscillator(), og = this.ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(heavy ? 110 : 150, t);
      o.frequency.exponentialRampToValueAtTime(heavy ? 26 : 40, t + (heavy ? 0.6 : 0.32));
      og.gain.setValueAtTime(Math.min(0.6, 0.22 + power * 0.42), t);
      og.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(og); og.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
    }
    ping() { this.chime([880, 1175]); }
    setMuted(m) { this.master.gain.setTargetAtTime(m ? 0 : 0.5, this.ctx.currentTime, 0.05); }
    destroy() { try { this.osc1.stop(); this.osc2.stop(); this.noise.stop(); this.ctx.close(); } catch (_) { /* 무시 */ } }
  }

  /* ── DOM ─────────────────────────────────────────── */
  function buildDom() {
    const root = document.getElementById('game');
    root.innerHTML = `
      <div class="hud-top">
        <div class="mission panel" id="gMission" hidden></div>
      </div>
      <div class="minimap-wrap panel">
        <div id="minimap"></div>
        <div class="mm-heading" id="mmHeading"></div>
        <div class="mm-label" id="gVeh"></div>
      </div>
      <div class="hud-bottom panel">
        <div class="gauge"><div class="dial"></div><div class="needle" id="gNeedle"></div><div class="speed"><b id="gSpeed">0</b><span>km/h</span></div><div class="gear" id="gGear">D</div></div>
        <div class="stats">
          <div class="money" id="gMoney">0원</div>
          <div class="count" id="gCount">0건 완료</div>
          <div class="meters">
            <div class="meter dmg"><span>내구도</span><i><b id="gDmg"></b></i></div>
            <div class="meter nit"><span>니트로</span><i><b id="gNitro"></b></i></div>
          </div>
          <div class="keys">W/S 가속·브레이크 · A/D 조향 · Shift 니트로 · Space 핸드브레이크 · C 시점 <b id="gCam"></b></div>
        </div>
        <div class="btns">
          <button id="gPhoneBtn" title="휴대폰 (P)">📱</button>
          <button id="gSoundBtn" title="소리 (M)">🔊</button>
          <button id="gHornBtn" title="경적 (H)">📣</button>
          <button id="gCamBtn" title="시점 (C)">🎥</button>
          <button id="gGhostBtn" title="유령 모드 (G) · 건물 통과">👻</button>
          <button id="gExitBtn" title="종료 (Esc)">✕</button>
        </div>
      </div>
      <div class="flash" id="gFlash"></div>
      <div class="floats" id="gFloats"></div>
      <div class="phone" id="gPhone" hidden>
        <div class="notch"></div>
        <div class="pstatus"><span id="pTime">00:00</span><span>📶 🔋</span></div>
        <div class="phead"><span class="avatar">👤</span><b id="pName">배달 의뢰</b><button id="pClose">닫기</button></div>
        <div class="thread" id="pThread"></div>
        <div class="pactions" id="pActions"></div>
      </div>`;
    const sel = document.getElementById('gameSelect');
    sel.innerHTML = `<div class="box">
      <h2>🎮 배달 드라이버</h2>
      <p>탈것을 고르면 지금 보고 있는 화면 한가운데서 출발합니다. 실시간 버스는 계속 다닙니다.</p>
      <div class="cards">${Object.entries(VEHICLES).map(([k, v]) => `
        <button class="vcard" data-key="${k}" style="--c:${v.color}">
          <span class="emoji">${v.emoji}</span><b>${v.name}</b><small>${v.desc}</small>
          <div class="bars">${bar('속도', v.maxKmh / 480)}${bar('가속', v.accel / 34)}${bar('조향', v.turn / 3.2)}${bar('내구', v.armor / 130)}${bar('파괴', v.crush / 100)}</div>
          <small class="top">최고 ${v.maxKmh}km/h${v.crush ? ` · ${v.smashKmh}km/h 부터 건물 파괴` : ' · 건물에 튕김'}</small>
        </button>`).join('')}
      </div>
      <button class="cancel" id="gameCancel">취소</button>
    </div>`;
    sel.querySelectorAll('.vcard').forEach(b => b.onclick = () => start(b.dataset.key));
    sel.querySelector('#gameCancel').onclick = () => { sel.hidden = true; document.body.classList.remove('game-select'); };
    ui = {
      root, select: sel, mission: root.querySelector('#gMission'), minimap: root.querySelector('#minimap'), mmHeading: root.querySelector('#mmHeading'),
      vehName: root.querySelector('#gVeh'), speed: root.querySelector('#gSpeed'), gear: root.querySelector('#gGear'), needle: root.querySelector('#gNeedle'),
      money: root.querySelector('#gMoney'), count: root.querySelector('#gCount'), cam: root.querySelector('#gCam'),
      dmgBar: root.querySelector('#gDmg'), nitroBar: root.querySelector('#gNitro'),
      flash: root.querySelector('#gFlash'), floats: root.querySelector('#gFloats'), ghostBtn: root.querySelector('#gGhostBtn'),
      phone: root.querySelector('#gPhone'), phoneTime: root.querySelector('#pTime'), phoneName: root.querySelector('#pName'), thread: root.querySelector('#pThread'), phoneActions: root.querySelector('#pActions'),
      phoneBtn: root.querySelector('#gPhoneBtn'), soundBtn: root.querySelector('#gSoundBtn'),
    };
    ui.phoneBtn.onclick = () => game.phoneOpen ? closePhone() : openPhone(game.sitting);
    ui.soundBtn.onclick = () => { game.sound = !game.sound; if (game.audio) game.audio.setMuted(!game.sound); updateHud(true); };
    root.querySelector('#gHornBtn').onclick = () => { if (game.audio) game.audio.horn(game.key); };
    root.querySelector('#gCamBtn').onclick = () => { game.cam = CAMS[(CAMS.indexOf(game.cam) + 1) % CAMS.length]; game.zoomOffset = 0; updateHud(true); };
    root.querySelector('#gGhostBtn').onclick = toggleGhost;
    root.querySelector('#gExitBtn').onclick = stop;
    root.querySelector('#pClose').onclick = closePhone;
    map.getCanvas().addEventListener('wheel', onWheel, { passive: false });
    // 터치 조작 (모바일): 화면 좌/우 하단 터치
    root.addEventListener('touchstart', e => touch(e, true), { passive: false });
    root.addEventListener('touchend', e => touch(e, false));
  }
  function toggleGhost() {
    game.ghost = !game.ghost;
    app.toast(game.ghost ? '유령 모드 · 건물을 통과합니다' : '충돌 모드 · 건물에 부딪힙니다');
    updateHud(true);
  }

  function bar(label, v) { return `<div class="bar"><span>${label}</span><i style="width:${Math.round(Math.min(1, v) * 100)}%"></i></div>`; }
  function touch(e, down) {
    if (!game.active || e.target.closest('button, .phone, .req-bubble')) return;
    e.preventDefault();
    const w = window.innerWidth;
    game.keys = {};
    if (down) for (const t of e.touches) {
      const x = t.clientX / w, y = t.clientY / window.innerHeight;
      if (y > 0.5) { if (x < 0.25) game.keys.left = true; else if (x < 0.5) game.keys.right = true; else if (x < 0.75) game.keys.down = true; else game.keys.up = true; }
    }
  }

  window.SB_GAME = { init, toggle, start, stop, tick, get active() { return game.active; }, game, VEHICLES };
})();
