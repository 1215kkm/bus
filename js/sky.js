/* 하늘 오버레이 — 별·달·구름·해
 *
 * 지도 캔버스 위에 얇은 캔버스를 한 장 덮고, 지평선 위쪽에만 하늘을 그립니다.
 * 지도를 기울이면(pitch) 하늘이 넓어지고, 좌우로 돌리면(bearing) 별·달·구름이
 * 같이 흘러가 하늘이 지도에 붙어 있는 것처럼 보입니다.
 *
 * 하늘 높이는 MapLibre 가 실제로 지면 그리기를 멈추는 선(transform.getHorizon)에
 * 정확히 맞춥니다. 그 아래는 진짜 도시가 그려지는 자리라 한 픽셀도 덮지 않습니다.
 * 그래서 pitch 가 낮으면(기본 58도) 하늘이 아예 없고, 위로 기울일수록 넓어집니다.
 */
(function () {
  const THEME = {
    dark: {
      grad: [[0, '#050a18'], [0.55, '#0d1730'], [1, '#1b2740']],
      stars: 1, moon: 1, sun: 0, clouds: 0,
      cloud: 'rgba(190, 210, 255, 0.10)',
    },
    sunset: {
      grad: [[0, '#241a4d'], [0.42, '#7e3268'], [0.72, '#d8564f'], [1, '#ffb26b']],
      stars: 0.3, moon: 0.35, sun: 1, clouds: 0.85,
      cloud: 'rgba(255, 186, 140, 0.34)',
    },
    light: {
      grad: [[0, '#6fb0e6'], [0.6, '#a9d2f2'], [1, '#d8e9f8']],
      stars: 0, moon: 0, sun: 0, clouds: 1,
      cloud: 'rgba(255, 255, 255, 0.9)',
    },
  };
  const STAR_N = 240, CLOUD_N = 16;
  let cv, ctx, map, theme = 'dark', W = 0, H = 0, dpr = 1, raf = 0;
  const stars = [], clouds = [];

  function rnd(a, b) { return a + Math.random() * (b - a); }

  function seed() {
    stars.length = 0; clouds.length = 0;
    for (let i = 0; i < STAR_N; i++) {
      stars.push({ u: Math.random(), v: Math.pow(Math.random(), 1.7), r: rnd(0.5, 1.7), ph: rnd(0, 6.28), sp: rnd(0.6, 2.2) });
    }
    for (let i = 0; i < CLOUD_N; i++) {
      clouds.push({ u: Math.random(), v: rnd(0.1, 0.85), s: rnd(0.5, 1.6), sp: rnd(0.004, 0.016), puffs: Math.round(rnd(3, 6)) });
    }
  }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** 화면에서 하늘이 차지하는 높이(px) — 지면이 끝나는 선까지만 */
  function skyHeight() {
    const t = map.transform;
    let fromTop;
    if (t && typeof t.getHorizon === 'function') {
      fromTop = H / 2 - t.getHorizon();
    } else {
      // getHorizon 이 없는 버전 대비 — MapLibre 와 같은 식으로 직접 계산
      const fovDeg = (t && typeof t.fov === 'number') ? t.fov : 36.87;
      const c2c = 0.5 / Math.tan(fovDeg / 2 * Math.PI / 180) * H;
      fromTop = H / 2 - Math.tan(Math.PI / 2 - map.getPitch() * Math.PI / 180) * c2c * 0.85;
    }
    return Math.max(0, Math.min(H * 0.5, fromTop * 0.98));   // 0.98 은 경계선 겹침 여유
  }

  /** bearing 에 따라 하늘이 흘러가는 가로 오프셋. 한 바퀴 돌면 화면 두 폭만큼 흐름 */
  function panX() { return -(((map.getBearing() % 360) + 360) % 360) / 360 * W * 2; }

  /** u(0~1) → 화면 x. 화면 두 폭 길이의 띠를 감아서 배치 */
  function ux(u, ox) {
    const strip = W * 2;
    let x = u * strip + ox;
    x = ((x % strip) + strip) % strip;
    return x > W + 80 ? x - strip : x;   // 화면 밖 오른쪽은 왼쪽으로 넘김
  }

  function draw(t) {
    raf = requestAnimationFrame(draw);
    if (!map) return;
    if (cv.clientWidth !== W || cv.clientHeight !== H) resize();
    ctx.clearRect(0, 0, W, H);

    const sky = skyHeight();
    if (sky < 4) return;

    const cfg = THEME[theme] || THEME.dark;
    const ox = panX();
    const sec = t / 1000;

    // 하늘 그라데이션 — 아래쪽은 투명하게 빼서 지도와 자연스럽게 이어지게
    const g = ctx.createLinearGradient(0, 0, 0, sky);
    for (const [pos, col] of cfg.grad) g.addColorStop(pos, col);
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, sky);
    // 지평선 쪽 페이드
    const fade = ctx.createLinearGradient(0, sky * 0.6, 0, sky);
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = fade;
    ctx.fillRect(0, sky * 0.6, W, sky * 0.4);
    ctx.restore();

    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, sky); ctx.clip();

    if (cfg.stars) drawStars(cfg, ox, sky, sec);
    if (cfg.sun) drawSun(cfg, ox, sky);
    if (cfg.moon) drawMoon(cfg, ox, sky);
    if (cfg.clouds) drawClouds(cfg, ox, sky, sec);

    ctx.restore();
  }

  function drawStars(cfg, ox, sky, sec) {
    for (const s of stars) {
      const x = ux(s.u, ox), y = s.v * sky * 0.92;
      if (x < -4 || x > W + 4) continue;
      const twinkle = 0.55 + 0.45 * Math.sin(sec * s.sp + s.ph);
      const a = cfg.stars * twinkle * (1 - s.v * 0.55);
      if (a <= 0.02) continue;
      ctx.globalAlpha = a;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(x, y, s.r, 0, 6.2832); ctx.fill();
      if (s.r > 1.3) {                       // 큰 별은 십자 빛살
        ctx.globalAlpha = a * 0.5;
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(x - s.r * 3, y); ctx.lineTo(x + s.r * 3, y);
        ctx.moveTo(x, y - s.r * 3); ctx.lineTo(x, y + s.r * 3);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawMoon(cfg, ox, sky) {
    const x = ux(0.63, ox), y = sky * 0.26, r = Math.max(14, Math.min(30, sky * 0.16));
    if (x < -r * 4 || x > W + r * 4) return;
    ctx.globalAlpha = cfg.moon;
    const glow = ctx.createRadialGradient(x, y, r * 0.7, x, y, r * 4.2);
    glow.addColorStop(0, 'rgba(226, 236, 255, 0.30)');
    glow.addColorStop(1, 'rgba(226, 236, 255, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(x, y, r * 4.2, 0, 6.2832); ctx.fill();

    ctx.fillStyle = '#eef3ff';
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
    // 크레이터
    ctx.globalAlpha = cfg.moon * 0.13;
    ctx.fillStyle = '#8e9bb5';
    for (const [dx, dy, dr] of [[-0.28, -0.2, 0.2], [0.24, 0.1, 0.15], [-0.05, 0.35, 0.12], [0.35, -0.32, 0.1]]) {
      ctx.beginPath(); ctx.arc(x + dx * r, y + dy * r, dr * r, 0, 6.2832); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawSun(cfg, ox, sky) {
    const x = ux(0.5, ox), y = sky * 0.78, r = Math.max(20, Math.min(46, sky * 0.24));
    if (x < -r * 5 || x > W + r * 5) return;
    const glow = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 6);
    glow.addColorStop(0, 'rgba(255, 214, 140, 0.55)');
    glow.addColorStop(0.4, 'rgba(255, 150, 90, 0.22)');
    glow.addColorStop(1, 'rgba(255, 120, 80, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(x, y, r * 6, 0, 6.2832); ctx.fill();
    ctx.fillStyle = '#ffe0a8';
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
  }

  function drawClouds(cfg, ox, sky, sec) {
    ctx.fillStyle = cfg.cloud;
    for (const c of clouds) {
      const drift = (sec * c.sp) % 1;
      const x = ux(c.u + drift, ox), y = c.v * sky * 0.8;
      const w = sky * 0.42 * c.s;
      if (x < -w * 3 || x > W + w * 3) continue;
      ctx.globalAlpha = cfg.clouds * (0.55 + 0.45 * (1 - c.v));
      ctx.beginPath();
      for (let i = 0; i < c.puffs; i++) {
        const f = i / (c.puffs - 1 || 1);
        const px = x + (f - 0.5) * w * 1.9;
        const py = y + Math.sin(f * 3.1 + c.u * 6) * w * 0.12;
        ctx.moveTo(px + w * 0.5, py);
        ctx.arc(px, py, w * (0.34 + 0.22 * Math.sin(f * 3.14)), 0, 6.2832);
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function init(m) {
    map = m;
    cv = document.getElementById('sky');
    if (!cv) return;
    ctx = cv.getContext('2d');
    seed();
    resize();
    window.addEventListener('resize', resize);
    if (!raf) raf = requestAnimationFrame(draw);
  }
  function setTheme(t) { theme = t; }

  window.SB_SKY = { init, setTheme };
})();
