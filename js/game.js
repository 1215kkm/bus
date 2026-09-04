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
  const GAME_NAME = '퀵서비스의 달인';

  /* ── 탈것 ─────────────────────────────────────────
   * parts: 차체를 이루는 상자들 (차량 기준 좌표, 단위 m)
   *   x 앞(+)/뒤(-) · y 오른쪽(+)/왼쪽(-) · l 길이 · w 폭 · b 바닥높이 · h 윗면높이
   *   c 를 비우면 그 차량의 대표색을 씁니다.
   */
  const VEHICLES = {
    bike:  { name: '오토바이', emoji: '🏍️', maxKmh: 125,  accel: 7.6, brake: 10, turn: 2.8, len: 2.2, wid: 0.9, hgt: 1.3, color: '#ff5c8a', reward: 1.0, radius: 1500, wave: 'square',   base: 70,  range: 6, desc: '빠르고 골목에 강함. 작은 배달 전문',
      parts: [
        { x:  0.85, y: 0,    l: 0.62, w: 0.22, b: 0,    h: 0.62, c: '#15171c' },  // 앞바퀴
        { x: -0.82, y: 0,    l: 0.66, w: 0.28, b: 0,    h: 0.66, c: '#15171c' },  // 뒷바퀴
        { x:  0.05, y: 0,    l: 1.50, w: 0.50, b: 0.32, h: 0.98 },                // 차체·연료탱크
        { x:  0.78, y: 0,    l: 0.18, w: 0.74, b: 0.86, h: 1.10, c: '#2b3242' },  // 핸들바
        { x: -0.20, y: 0,    l: 0.62, w: 0.52, b: 0.95, h: 1.72, c: '#2b3242' },  // 라이더
        { x:  0.02, y: 0,    l: 0.44, w: 0.46, b: 1.72, h: 2.04, c: '#eef2f8' },  // 헬멧
        { x: -0.92, y: 0,    l: 0.62, w: 0.70, b: 0.98, h: 1.66 },                // 배달통
      ] },
    sport: { name: '스포츠카', emoji: '🏎️', maxKmh: 265, accel: 11.5, brake: 13, turn: 2.0, len: 4.5, wid: 1.9, hgt: 1.2, color: '#ffd166', reward: 1.2, radius: 2500, wave: 'sawtooth', base: 55,  range: 7, desc: '최고 속도. 빠른 배달 보너스가 큼',
      parts: [
        { x:  1.45, y: -0.88, l: 0.68, w: 0.26, b: 0,    h: 0.66, c: '#15171c' }, // 앞바퀴 좌
        { x:  1.45, y:  0.88, l: 0.68, w: 0.26, b: 0,    h: 0.66, c: '#15171c' }, // 앞바퀴 우
        { x: -1.50, y: -0.92, l: 0.74, w: 0.30, b: 0,    h: 0.70, c: '#15171c' }, // 뒷바퀴 좌
        { x: -1.50, y:  0.92, l: 0.74, w: 0.30, b: 0,    h: 0.70, c: '#15171c' }, // 뒷바퀴 우
        { x:  0,    y: 0,    l: 4.40, w: 1.80, b: 0.28, h: 0.92 },                // 로우 바디
        { x:  1.72, y: 0,    l: 1.00, w: 1.66, b: 0.30, h: 0.74 },                // 낮은 보닛
        { x: -0.35, y: 0,    l: 1.90, w: 1.54, b: 0.92, h: 1.34, c: '#12161f' },  // 캐빈(유리)
        { x: -1.95, y: 0,    l: 0.22, w: 1.72, b: 1.00, h: 1.24, c: '#1d2230' },  // 리어 스포일러
      ] },
    bus:   { name: '버스',     emoji: '🚌', maxKmh: 96,  accel: 3.1, brake: 6,  turn: 1.2, len: 11,  wid: 2.5, hgt: 3.4, color: '#4f7de8', reward: 1.6, radius: 3000, wave: 'sawtooth', base: 38,  range: 4, desc: '단체 승객 이동 의뢰. 보수가 높음',
      parts: [
        { x:  3.60, y: -1.15, l: 1.05, w: 0.34, b: 0,    h: 0.95, c: '#15171c' }, // 앞바퀴
        { x:  3.60, y:  1.15, l: 1.05, w: 0.34, b: 0,    h: 0.95, c: '#15171c' },
        { x: -3.10, y: -1.20, l: 1.10, w: 0.42, b: 0,    h: 0.98, c: '#15171c' }, // 뒷바퀴(복륜)
        { x: -3.10, y:  1.20, l: 1.10, w: 0.42, b: 0,    h: 0.98, c: '#15171c' },
        { x:  0,    y: 0,    l: 10.80, w: 2.46, b: 0.42, h: 2.72 },               // 차체
        { x: -0.20, y: 0,    l: 9.20, w: 2.54, b: 1.44, h: 2.26, c: '#d8e3ff' },  // 창문 띠
        { x:  5.10, y: 0,    l: 0.48, w: 2.32, b: 1.20, h: 2.62, c: '#c2d6f7' },  // 앞유리
        { x: -5.20, y: 0,    l: 0.40, w: 2.30, b: 1.30, h: 2.50, c: '#c2d6f7' },  // 뒷유리
        { x:  0,    y: 0,    l: 10.40, w: 2.40, b: 2.72, h: 3.28, c: '#8fabf0' }, // 지붕
        { x:  1.60, y: 0,    l: 0.30, w: 2.52, b: 0.42, h: 2.10, c: '#2b3242' },  // 중문
      ] },
    dump:  { name: '덤프트럭', emoji: '🚛', maxKmh: 102,  accel: 3.3, brake: 6,  turn: 1.1, len: 9,   wid: 2.6, hgt: 3.5, color: '#f39c3d', reward: 1.8, radius: 3500, wave: 'triangle', base: 34,  range: 3.5, desc: '건설 자재·이삿짐 운반. 보수가 큼',
      parts: [
        { x:  3.00, y: -1.20, l: 1.05, w: 0.36, b: 0,    h: 0.95, c: '#15171c' }, // 앞바퀴
        { x:  3.00, y:  1.20, l: 1.05, w: 0.36, b: 0,    h: 0.95, c: '#15171c' },
        { x: -1.90, y: -1.28, l: 1.10, w: 0.46, b: 0,    h: 1.00, c: '#15171c' }, // 뒷바퀴 앞축
        { x: -1.90, y:  1.28, l: 1.10, w: 0.46, b: 0,    h: 1.00, c: '#15171c' },
        { x: -3.10, y: -1.28, l: 1.10, w: 0.46, b: 0,    h: 1.00, c: '#15171c' }, // 뒷바퀴 뒷축
        { x: -3.10, y:  1.28, l: 1.10, w: 0.46, b: 0,    h: 1.00, c: '#15171c' },
        { x:  0.20, y: 0,    l: 8.40, w: 2.10, b: 0.50, h: 1.00, c: '#2a2f3a' },  // 섀시
        { x:  3.00, y: 0,    l: 2.50, w: 2.50, b: 0.85, h: 3.10 },                // 캡
        { x:  3.78, y: 0,    l: 0.36, w: 2.20, b: 2.00, h: 2.95, c: '#c2d6f7' },  // 앞유리
        { x:  3.00, y: 0,    l: 2.30, w: 2.58, b: 3.10, h: 3.32, c: '#1d2230' },  // 캡 지붕
        { x: -1.60, y: 0,    l: 5.20, w: 2.58, b: 1.00, h: 2.85, c: '#8a6d3b' },  // 적재함
        { x: -4.15, y: 0,    l: 0.30, w: 2.58, b: 1.00, h: 3.05, c: '#6d5630' },  // 뒷문
        { x: -1.50, y: 0,    l: 4.40, w: 2.20, b: 2.85, h: 3.25, c: '#6b5433' },  // 실린 흙더미
      ] },
    tank:  { name: '탱크',     emoji: '🪖', maxKmh: 78,  accel: 2.7, brake: 5,  turn: 1.0, len: 7,   wid: 3.4, hgt: 2.6, color: '#6b7a45', reward: 2.2, radius: 3800, wave: 'sawtooth', base: 26,  range: 3, desc: '군수 물자 수송. 가장 느리지만 보수 최고',
      parts: [
        { x:  0,    y: -1.50, l: 6.80, w: 0.78, b: 0,    h: 1.02, c: '#23262b' }, // 좌 궤도
        { x:  0,    y:  1.50, l: 6.80, w: 0.78, b: 0,    h: 1.02, c: '#23262b' }, // 우 궤도
        { x:  0,    y: 0,    l: 6.50, w: 2.50, b: 0.50, h: 1.55 },                // 차체
        { x:  2.60, y: 0,    l: 1.40, w: 2.50, b: 1.18, h: 1.62 },                // 경사 전면
        { x: -0.50, y: 0,    l: 3.30, w: 2.50, b: 1.55, h: 2.45, c: '#4a5533' },  // 포탑
        { x:  2.30, y: 0,    l: 4.40, w: 0.42, b: 1.95, h: 2.28, c: '#3a4128' },  // 포신
        { x: -1.30, y: 0.50, l: 0.95, w: 0.95, b: 2.45, h: 2.85, c: '#3a4128' },  // 큐폴라
        { x: -2.10, y: 0,    l: 0.50, w: 1.70, b: 1.70, h: 2.20, c: '#3a4128' },  // 뒤 수납함
      ] },
  };
  const ITEMS = {
    bike: ['치킨', '떡볶이 세트', '아이스 아메리카노 4잔', '꽃다발', '서류 봉투', '약 봉투', '케이크'],
    sport: ['긴급 서류', '결혼반지', '생일 케이크', '한정판 운동화', 'VIP 도시락'],
    bus: ['단체 승객 12명', '수학여행 학생 30명', '회사 워크숍 팀', '동호회 회원들'],
    dump: ['모래 8톤', '자갈', '건설 자재', '이삿짐', '흙 6톤', '폐콘크리트'],
    tank: ['군수 물자', '훈련용 포탄 20발', '전차 부품', '비상 구호품', '야전 취사 장비'],
  };
  const NAMES = ['김민준', '이서연', '박지호', '최수아', '정도윤', '강하은', '조예준', '윤지우', '한서준', '오하린'];
  const AUTO_KMH = 80;          // 자동 주행 속도(차 최고속도를 넘지는 않음)
  const AUTO_PITCH = 45;        // 자동 주행 시 카메라 각도

  const CAMS = ['driver', 'chase', 'top', 'free'];
  const CAM_LABEL = { driver: '운전석', chase: '추적', top: '탑뷰', free: '자유' };
  /** 도착으로 인정하는 반경(m) — 차가 클수록 넉넉하게 */
  const arriveRadius = () => Math.round(60 + game.spec.len * 6);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  const CAM_SET = { driver: { pitch: 84, zoom: 19.2, ahead: 9 }, chase: { pitch: 72, zoom: 18.5, ahead: 24 }, top: { pitch: 45, zoom: 16.6, ahead: 60 } };

  const game = {
    active: false, key: null, spec: null,
    lng: 0, lat: 0, heading: 0, speed: 0, camBearing: 0, cam: 'chase', zoomOffset: 0, pitchOffset: 0,
    keys: {}, money: 0, done: 0, failed: 0, requests: [], mission: null, guide: null,
    sound: true, audio: null, minimap: null, markers: new Map(), lastReqTick: 0, lastHud: 0,
    phoneOpen: false, thread: [], typing: null, unread: 0, sitting: null,
    crashes: 0, lastCrashMsg: 0,
    auto: false, autoIdx: 0,
  };
  /* 건물 충돌 — 화면에 그려진 건물 폴리곤을 주기적으로 받아 두고 매 프레임 점 검사 */
  const solid = { polys: [], at: 0, lng: 0, lat: 0 };
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
    game.speed = 0; game.cam = 'chase'; game.zoomOffset = 0; game.pitchOffset = 0; game.mission = null; game.guide = null; game.sitting = null;
    game.thread = []; game.unread = 0;
    game.crashes = 0; solid.polys = []; solid.at = 0;
    game.auto = false; game.autoIdx = 0;
    game.active = true;
    document.body.classList.add('game-on');
    ui.root.hidden = false;
    map.scrollZoom.disable();
    addLayers();
    startAudio();
    initMinimap();
    ui.vehName.textContent = `${game.spec.emoji} ${game.spec.name}`;
    // 휴대폰은 처음부터 오른쪽에 켜져 있고, 의뢰는 여기로 문자가 옵니다
    ui.phone.hidden = false; game.phoneOpen = true;
    updateHud(true);
    pushMsg('sys', `${game.spec.name} 운전 시작 — 의뢰가 들어오면 이 화면으로 문자가 옵니다.`);
    pushMsg('sys', '의뢰를 기다리는 중…');
    app.toast(`${GAME_NAME} · ${game.spec.name} — W/A/S/D 운전, 휠 시점 각도, C 시점 전환, Esc 종료`);
    map.easeTo({ center: [game.lng, game.lat], zoom: CAM_SET.chase.zoom, pitch: CAM_SET.chase.pitch, bearing: game.heading, duration: 1600 });
  }

  function stop() {
    game.active = false;
    document.body.classList.remove('game-on', 'game-select');
    ui.root.hidden = true; ui.select.hidden = true; ui.phone.hidden = true; game.phoneOpen = false;
    map.scrollZoom.enable();
    clearRequests(); clearMission(false);
    dropLayers();
    if (game.minimap) { game.minimap.remove(); game.minimap = null; }
    stopAudio();
    map.easeTo({ pitch: 58, zoom: Math.min(map.getZoom(), 15), duration: 1200 });
    app.toast(`${GAME_NAME} 종료 — 실시간 지도로 돌아갑니다`);
  }

  /* ── 레이어 ─────────────────────────────────────── */
  const SRC_IDS = ['sb-game-guide', 'sb-game-zone', 'sb-game-veh'];
  const LAYER_IDS = ['sb-game-guide', 'sb-game-zone-fill', 'sb-game-zone-line', 'sb-game-veh'];

  function addLayers() {
    if (map.getLayer('sb-game-veh')) return;
    try {
      addLayersUnsafe();
    } catch (e) {
      // 스타일 교체 중이면 addSource 가 거부됩니다. 반쯤 올라간 것을 걷어내고 style.load 에서 다시 시도.
      dropLayers();
    }
  }
  function dropLayers() {
    for (const id of LAYER_IDS) if (map.getLayer(id)) map.removeLayer(id);
    for (const id of SRC_IDS) if (map.getSource(id)) map.removeSource(id);
  }
  function addLayersUnsafe() {
    map.addSource('sb-game-guide', { type: 'geojson', data: empty() });
    map.addSource('sb-game-zone', { type: 'geojson', data: empty() });
    map.addSource('sb-game-veh', { type: 'geojson', data: empty() });
    map.addLayer({
      id: 'sb-game-guide', type: 'line', source: 'sb-game-guide',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffb547', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 3, 16, 7, 19, 12], 'line-opacity': 0.85, 'line-dasharray': [1.2, 1.4] },
    });
    map.addLayer({
      id: 'sb-game-zone-fill', type: 'fill', source: 'sb-game-zone',
      paint: { 'fill-color': '#ffb547', 'fill-opacity': 0.16 },
    });
    map.addLayer({
      id: 'sb-game-zone-line', type: 'line', source: 'sb-game-zone',
      paint: { 'line-color': '#ffb547', 'line-width': 2.5, 'line-opacity': 0.9, 'line-dasharray': [2, 2] },
    });
    map.addLayer({
      id: 'sb-game-veh', type: 'fill-extrusion', source: 'sb-game-veh',
      paint: { 'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-base': ['get', 'b'], 'fill-extrusion-opacity': 0.98, 'fill-extrusion-vertical-gradient': true },
    });
    if (game.guide) map.getSource('sb-game-guide').setData(game.guide.fc);
    if (game.mission) setZone(game.mission.stage === 'pickup' ? game.mission.req.pickup : game.mission.req.dest);
  }
  const empty = () => ({ type: 'FeatureCollection', features: [] });

  /* ── 프레임 ─────────────────────────────────────── */
  function tick(dt) {
    if (!game.active) return;
    if (!autopilot(dt)) physics(dt);
    camera(dt);
    render();
    missions(dt);
    if (game.audio) game.audio.update(Math.abs(game.speed) / (game.spec.maxKmh / 3.6), game.keys.up ? 1 : 0);
    const now = performance.now();
    if (now - game.lastReqTick > 1000) { game.lastReqTick = now; spawnRequests(); refreshBubbles(); }
    // 30m 넘게 움직였거나 0.6초 지났으면 주변 건물을 다시 읽음
    if (now - solid.at > 600 || dist({ lng: game.lng, lat: game.lat }, solid) > 30) refreshSolids();
    if (now - game.lastHud > 120) { game.lastHud = now; updateHud(); }
    if (game.minimap && game.minimap._sbReady) updateMinimap();
  }

  /** 차 주변 건물 폴리곤을 다시 읽음 (매 프레임은 무거워서 이동·시간 기준으로만) */
  function refreshSolids() {
    if (!map.getLayer('sb-buildings')) { solid.polys = []; return; }
    let visible = 'visible';
    try { visible = map.getLayoutProperty('sb-buildings', 'visibility') || 'visible'; } catch (_) { /* 무시 */ }
    if (visible === 'none') { solid.polys = []; return; }   // 건물을 껐으면(B) 충돌도 없음
    let feats;
    try {
      const p = map.project([game.lng, game.lat]);
      const R = 260;
      feats = map.queryRenderedFeatures([[p.x - R, p.y - R], [p.x + R, p.y + R]], { layers: ['sb-buildings'] });
    } catch (_) { return; }
    const polys = [];
    for (const f of feats) {
      const g = f.geometry; if (!g) continue;
      const rings = g.type === 'Polygon' ? [g.coordinates[0]]
        : g.type === 'MultiPolygon' ? g.coordinates.map(c => c[0]) : null;
      if (!rings) continue;
      for (const r of rings) if (r && r.length > 3) polys.push(r);
    }
    solid.polys = polys;
    solid.lng = game.lng; solid.lat = game.lat; solid.at = performance.now();
  }

  function inSolid(lng, lat) {
    for (const ring of solid.polys) {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
        if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) return true;
    }
    return false;
  }

  function crash(speedWas) {
    const kmh = Math.abs(speedWas) * 3.6;
    game.speed = -Math.sign(speedWas) * Math.min(Math.abs(speedWas) * 0.3, 3.5);   // 살짝 튕겨 나옴
    if (game.audio) game.audio.crash(Math.min(1, kmh / 90));
    if (kmh > 25) {
      game.crashes++;
      const now = performance.now();
      if (now - game.lastCrashMsg > 4000) {
        game.lastCrashMsg = now;
        app.toast(`쿵! 건물에 부딪혔습니다 · ${Math.round(kmh)}km/h`);
      }
    }
  }

  /** 안내선을 따라 스스로 달림. 처리했으면 true (수동 물리를 건너뜀) */
  function autopilot(dt) {
    const m = game.mission;
    if (!game.auto || !m) return false;
    const target = m.stage === 'pickup' ? m.req.pickup : m.req.dest;
    const f = game.guide && game.guide.fc && game.guide.fc.features[0];
    const path = f && f.geometry && f.geometry.coordinates;
    let aim = [target.lng, target.lat];
    if (path && path.length) {
      if (game.autoIdx >= path.length) game.autoIdx = path.length - 1;
      // 이미 지난 점은 넘기고, 20m 앞의 점을 바라봄
      while (game.autoIdx < path.length - 1 && G.haversine([game.lng, game.lat], path[game.autoIdx]) < 20) game.autoIdx++;
      aim = path[game.autoIdx];
    }
    const want = G.bearing([game.lng, game.lat], aim);
    const diff = ((want - game.heading + 540) % 360) - 180;
    const rate = game.spec.turn * 57.3 * 1.8 * dt;            // 사람보다 조금 빠르게 꺾음
    game.heading = (game.heading + Math.max(-rate, Math.min(rate, diff)) + 360) % 360;

    const cap = Math.min(AUTO_KMH, game.spec.maxKmh) / 3.6;
    const aimSpeed = cap * (Math.abs(diff) > 60 ? 0.42 : Math.abs(diff) > 25 ? 0.7 : 1);
    game.speed += (aimSpeed - game.speed) * Math.min(1, dt * 2.2);
    const p = G.move(game.lng, game.lat, game.heading, game.speed * dt, 0);
    game.lng = p[0]; game.lat = p[1];
    return true;
  }

  function setAuto(on) {
    if (on && !game.mission) return app.toast('의뢰를 수락한 뒤에 쓸 수 있습니다');
    game.auto = on;
    game.autoIdx = 0;
    if (on) {
      game.cam = 'chase';
      game.pitchOffset = AUTO_PITCH - CAM_SET.chase.pitch;    // 카메라를 45도로
      game.keys = {};
      app.toast(`자동 주행 켜짐 — 추천 경로를 따라 ${Math.round(Math.min(AUTO_KMH, game.spec.maxKmh))}km/h 로 갑니다`);
    } else {
      game.pitchOffset = 0;
      app.toast('자동 주행 꺼짐');
    }
    updateHud(true);
  }

  function physics(dt) {
    const s = game.spec, k = game.keys;
    const max = s.maxKmh / 3.6;
    if (k.up) game.speed += s.accel * dt;
    else if (k.down) {
      if (game.speed > 0.3) game.speed -= s.brake * dt;
      else game.speed = Math.max(-max / 4, game.speed - s.accel * 0.6 * dt);
    } else {
      const drag = 0.9 + 0.004 * game.speed * game.speed;
      game.speed -= Math.sign(game.speed) * Math.min(Math.abs(game.speed), drag * dt);
    }
    if (k.brake) game.speed -= Math.sign(game.speed) * Math.min(Math.abs(game.speed), s.brake * 1.6 * dt);
    game.speed = Math.max(-max / 4, Math.min(max, game.speed));
    const steer = (k.left ? -1 : 0) + (k.right ? 1 : 0);
    if (steer && Math.abs(game.speed) > 0.2) {
      const eff = Math.min(1, Math.abs(game.speed) / 7) * (1 - 0.45 * Math.min(1, Math.abs(game.speed) / max));
      game.heading = (game.heading + steer * eff * s.turn * 57.3 * dt * (game.speed < 0 ? -1 : 1) + 360) % 360;
    }
    if (Math.abs(game.speed) > 0.01) {
      const p = G.move(game.lng, game.lat, game.heading, game.speed * dt, 0);
      // 차 앞끝(후진이면 뒤끝)이 건물 안으로 들어가려 하면 막는다
      const nose = Math.sign(game.speed) * s.len * 0.5;
      const probe = G.move(p[0], p[1], game.heading, nose, 0);
      if (solid.polys.length && inSolid(probe[0], probe[1])) crash(game.speed);
      else { game.lng = p[0]; game.lat = p[1]; }
    }
  }

  function camera(dt) {
    if (game.cam === 'free') return;
    const c = CAM_SET[game.cam];
    const k = 1 - Math.exp(-dt * (game.cam === 'driver' ? 10 : 5));
    let diff = ((game.heading - game.camBearing + 540) % 360) - 180;
    game.camBearing = (game.camBearing + diff * k + 360) % 360;
    const center = G.move(game.lng, game.lat, game.heading, c.ahead, 0);
    map.jumpTo({ center, bearing: game.camBearing, pitch: clamp(c.pitch + game.pitchOffset, 0, 85), zoom: c.zoom + game.zoomOffset });
  }

  function render() {
    const src = map.getSource('sb-game-veh'); if (!src) return;
    const s = game.spec;
    const mpp = G.metersPerPixel(game.lat, map.getZoom());
    const scale = Math.max(1, 24 * mpp / s.len);   // 화면에서 최소 24px 는 되게 — 이보다 작으면 차종이 구분 안 됨
    const feats = s.parts.map(p => ({
      type: 'Feature',
      properties: { color: p.c || s.color, h: p.h * scale, b: p.b * scale },
      geometry: { type: 'Polygon', coordinates: G.boxPolygon(...G.move(game.lng, game.lat, game.heading, p.x * scale, p.y * scale), game.heading, p.l * scale, p.w * scale) },
    }));
    src.setData({ type: 'FeatureCollection', features: feats });
  }

  /* ── 의뢰 ────────────────────────────────────────── */
  /** 목적지 둘레에 그리는 도착 범위 원 */
  function setZone(target) {
    const src = map.getSource('sb-game-zone'); if (!src) return;
    if (!target) return src.setData(empty());
    const r = arriveRadius(), ring = [];
    for (let i = 0; i <= 48; i++) ring.push(G.move(target.lng, target.lat, i / 48 * 360, r, 0));
    src.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }] });
  }

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
    // 의뢰는 지도 말풍선보다 휴대폰으로 먼저 옵니다. 상담 중인 건이 있으면 대기 목록에 쌓입니다.
    if (!game.sitting || !game.requests.includes(game.sitting)) presentRequest(req);
    else { pushMsg('sys', `📨 새 의뢰 — ${req.item} · ${req.pickup.name} (${req.reward.toLocaleString()}원)`); renderPending(); }
  }
  function refreshBubbles() {
    const me = { lng: game.lng, lat: game.lat };
    for (const r of game.requests) {
      const d = dist(me, r.pickup);
      r.marker.getElement().querySelector('span').textContent = `${fmtDist(d)} · ${r.reward.toLocaleString()}원`;
      if (d > game.spec.radius * 2.5) removeRequest(r);   // 너무 멀어지면 의뢰 소멸
    }
  }
  function removeRequest(r) {
    r.marker.remove();
    game.requests = game.requests.filter(x => x !== r);
    if (game.sitting === r) game.sitting = null;
    renderPending();
  }
  function clearRequests() { for (const r of [...game.requests]) removeRequest(r); }

  /* ── 휴대폰 ─────────────────────────────────────── */
  function openPhone(req) {
    game.phoneOpen = true; ui.phone.hidden = false; game.unread = 0;
    if (req) presentRequest(req); else renderThread();
    updateHud(true);
  }
  /** 의뢰 하나를 문자 대화로 띄우고 수락 버튼까지 붙임 */
  function presentRequest(req) {
    if (game.mission) return;
    if (game.sitting && game.sitting.id === req.id) { renderThread(); return; }
    {
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
  function closePhone() { game.phoneOpen = false; ui.phone.hidden = true; updateHud(true); }
  /** 상담 중인 건 말고 대기 중인 의뢰를 칩으로 보여줌 */
  function renderPending() {
    if (!ui.pending) return;
    const others = game.mission ? [] : game.requests.filter(r => !game.sitting || r.id !== game.sitting.id);
    ui.pending.hidden = !others.length;
    if (!others.length) { ui.pending.innerHTML = ''; return; }
    ui.pending.innerHTML = `<span class="plabel">대기 ${others.length}건</span>` +
      others.map(r => `<button data-id="${r.id}">💬 ${escape(r.item)} · ${r.reward.toLocaleString()}원</button>`).join('');
    ui.pending.querySelectorAll('button').forEach(b => b.onclick = () => {
      const r = game.requests.find(x => String(x.id) === b.dataset.id);
      if (r) presentRequest(r);
    });
  }
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
    renderPending();
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
    setZone(req.pickup);
    renderPending();
    if (game.audio) game.audio.chime([523, 659, 784]);
    updateHud(true);
  }
  function clearMission(keepMarkers) {
    const m = game.mission; game.mission = null;
    if (m && !keepMarkers) { m.req.marker.remove(); if (m.destMarker) m.destMarker.remove(); }
    game.guide = null;
    if (m) game.sitting = null;
    if (game.auto) { game.auto = false; game.pitchOffset = 0; }
    setZone(null);
    renderPending();
    const src = map.getSource('sb-game-guide'); if (src) src.setData(empty());
    updateHud(true);
  }

  function missions(dt) {
    const m = game.mission; if (!m) return;
    const elapsed = (performance.now() - m.t0) / 1000;
    const target = m.stage === 'pickup' ? m.req.pickup : m.req.dest;
    const d = dist({ lng: game.lng, lat: game.lat }, target);
    if (game.guide && (performance.now() - game.guide.at > 4000) && d > arriveRadius()) setGuide({ lng: game.lng, lat: game.lat }, target, true);   // 안내선 갱신
    if (d < arriveRadius() && Math.abs(game.speed) < 4.5) {
      if (m.stage === 'pickup') {
        m.stage = 'deliver'; m.pickedAt = elapsed;
        m.req.marker.remove();
        const el = document.createElement('div'); el.className = 'req-bubble accepted'; el.innerHTML = `<b>🏁 배달지</b><span>${m.req.dest.name}</span>`;
        m.destMarker = new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -14] }).setLngLat([m.req.dest.lng, m.req.dest.lat]).addTo(map);
        pushMsg('sys', `${m.req.item} 픽업 완료! 이제 ${m.req.dest.name}까지 가세요.`);
        setTimeout(() => pushMsg('them', '잘 부탁드려요. 도착하면 문자 주세요 🙏'), 800);
        setGuide({ lng: game.lng, lat: game.lat }, m.req.dest);
        setZone(m.req.dest);
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
    game.autoIdx = 0;
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
    ui.count.textContent = `${game.done}건 완료${game.failed ? ' · ' + game.failed + '건 실패' : ''}${game.crashes ? ' · 충돌 ' + game.crashes : ''}`;
    ui.cam.textContent = CAM_LABEL[game.cam];
    ui.autoBtn.classList.toggle('on', game.auto);
    ui.autoBtn.classList.toggle('dim', !game.mission);
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
    const mapKey = { w: 'up', arrowup: 'up', s: 'down', arrowdown: 'down', a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right', ' ': 'brake' }[k];
    if (mapKey) {
      if (down && game.auto) setAuto(false);            // 직접 조작하면 자동 주행 해제
      game.keys[mapKey] = down; e.preventDefault(); return;
    }
    if (!down) return;
    if (k === 'c') { game.cam = CAMS[(CAMS.indexOf(game.cam) + 1) % CAMS.length]; game.zoomOffset = 0; game.pitchOffset = 0; app.toast(`시점: ${CAM_LABEL[game.cam]}`); updateHud(true); }
    else if (k === 'h') { if (game.audio) game.audio.horn(game.key); }
    else if (k === 'm') { game.sound = !game.sound; if (game.audio) game.audio.setMuted(!game.sound); updateHud(true); }
    else if (k === 'g') setAuto(!game.auto);
    else if (k === 'p') { game.phoneOpen ? closePhone() : openPhone(game.sitting); }
    else if (k === 'escape') { if (game.phoneOpen) closePhone(); else stop(); }
  }
  function onWheel(e) {
    if (!game.active) return;
    e.preventDefault();
    const step = Math.sign(e.deltaY);
    // 자유 시점에서는 게임 카메라가 관여하지 않으니 지도를 직접 확대·축소
    if (game.cam === 'free') return map.zoomTo(map.getZoom() - step * 0.3, { duration: 90 });
    // 휠 = 확대·축소, Shift+휠 = 시점 각도
    if (e.shiftKey) game.pitchOffset = clamp(game.pitchOffset - step * 2.5, -45, 25);
    else game.zoomOffset = clamp(game.zoomOffset - step * 0.15, -3.5, 1.5);
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
      const freqs = key === 'bike' ? [780, 1040] : key === 'sport' ? [440, 554] : key === 'tank' ? [165, 208] : [330, 415];
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
    /** 충돌음 — 짧게 감쇠하는 저역 노이즈 */
    crash(power) {
      const t = this.ctx.currentTime;
      const n = Math.floor(this.ctx.sampleRate * 0.3);
      const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.6);
      const src = this.ctx.createBufferSource(); src.buffer = buf;
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260 + power * 380;
      const g = this.ctx.createGain(); g.gain.value = 0.08 + power * 0.34;
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start(t); src.stop(t + 0.32);
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
          <div class="keys">W/S 가속·브레이크 · A/D 조향 · Space 핸드브레이크 · G 자동 주행 · 휠 확대·축소 · Shift+휠 시점 각도 · C 시점 <b id="gCam"></b></div>
        </div>
        <div class="btns">
          <button id="gAutoBtn" title="자동 주행 (G) — 추천 경로로 알아서 갑니다">🧭</button>
          <button id="gPhoneBtn" title="휴대폰 (P)">📱</button>
          <button id="gSoundBtn" title="소리 (M)">🔊</button>
          <button id="gHornBtn" title="경적 (H)">📣</button>
          <button id="gCamBtn" title="시점 (C)">🎥</button>
          <button id="gExitBtn" title="종료 (Esc)">✕</button>
        </div>
      </div>
      <div class="phone" id="gPhone" hidden>
        <div class="notch"></div>
        <div class="pstatus"><span id="pTime">00:00</span><span>📶 🔋</span></div>
        <div class="phead"><span class="avatar">👤</span><b id="pName">배달 의뢰</b><button id="pClose">닫기</button></div>
        <div class="thread" id="pThread"></div>
        <div class="pending" id="pPending" hidden></div>
        <div class="pactions" id="pActions"></div>
      </div>`;
    const sel = document.getElementById('gameSelect');
    sel.innerHTML = `<div class="box">
      <h2>🎮 ${GAME_NAME}</h2>
      <p>탈것을 고르면 지금 보고 있는 화면 한가운데서 출발합니다. 실시간 버스는 계속 다닙니다.<br>의뢰는 오른쪽 휴대폰으로 문자가 오고, 목적지 둘레의 노란 원 안에서 멈추면 처리됩니다.</p>
      <div class="cards">${Object.entries(VEHICLES).map(([k, v]) => `
        <button class="vcard" data-key="${k}" style="--c:${v.color}">
          <span class="emoji">${v.emoji}</span><b>${v.name}</b><small>${v.desc}</small>
          <div class="bars">${bar('속도', v.maxKmh / 265)}${bar('가속', v.accel / 10)}${bar('조향', v.turn / 3)}${bar('보수', v.reward / 2)}</div>
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
      phone: root.querySelector('#gPhone'), phoneTime: root.querySelector('#pTime'), phoneName: root.querySelector('#pName'), thread: root.querySelector('#pThread'), phoneActions: root.querySelector('#pActions'), pending: root.querySelector('#pPending'),
      phoneBtn: root.querySelector('#gPhoneBtn'), soundBtn: root.querySelector('#gSoundBtn'), autoBtn: root.querySelector('#gAutoBtn'),
    };
    ui.autoBtn.onclick = () => setAuto(!game.auto);
    ui.phoneBtn.onclick = () => game.phoneOpen ? closePhone() : openPhone(game.sitting);
    ui.soundBtn.onclick = () => { game.sound = !game.sound; if (game.audio) game.audio.setMuted(!game.sound); updateHud(true); };
    root.querySelector('#gHornBtn').onclick = () => { if (game.audio) game.audio.horn(game.key); };
    root.querySelector('#gCamBtn').onclick = () => { game.cam = CAMS[(CAMS.indexOf(game.cam) + 1) % CAMS.length]; game.zoomOffset = 0; game.pitchOffset = 0; updateHud(true); };
    root.querySelector('#gExitBtn').onclick = stop;
    root.querySelector('#pClose').onclick = closePhone;
    map.getCanvas().addEventListener('wheel', onWheel, { passive: false });
    // 터치 조작 (모바일): 화면 좌/우 하단 터치
    root.addEventListener('touchstart', e => touch(e, true), { passive: false });
    root.addEventListener('touchend', e => touch(e, false));
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
