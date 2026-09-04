/* 배경음악 — 유튜브 플레이어 + 이퀄라이저
 *
 * 오른쪽 위 🎵 버튼으로 패널을 엽니다. 소리는 패널 안의 작은 유튜브 플레이어가 냅니다.
 * (iframe 을 화면 밖에 숨기면 브라우저·유튜브 정책에 걸려 재생이 막히는 경우가 있어
 *  일부러 작게 보이게 뒀습니다. 3:00 부터 시작하고 끝나면 다시 3:00 으로 돌아갑니다.)
 *
 * 이퀄라이저는 *실제 파형이 아닙니다*. 유튜브 iframe 의 오디오는 다른 출처라
 * Web Audio 로 들여다볼 수 없어서(브라우저가 막습니다), 재생 중일 때만
 * 음악처럼 움직이는 막대를 그립니다. 멈추면 같이 가라앉습니다.
 */
(function () {
  const VIDEO = 'dZBxqRgYcfE';
  const START = 180;               // 3분부터
  const BARS = 14;

  const state = {
    player: null, ready: false, playing: false, failed: false,
    vol: Number(localStorage.getItem('sb.music.vol') || 45),
    open: false,
  };
  let ui = {}, bars = [], raf = 0;

  function buildDom() {
    const host = document.createElement('div');
    host.id = 'musicPanel';
    host.className = 'panel music';
    host.hidden = true;
    host.innerHTML = `
      <div class="mrow">
        <button class="play" id="mPlay" title="재생 / 일시정지">▶</button>
        <div class="meta">
          <b id="mTitle">배경음악</b>
          <span id="mState">멈춤 · 3:00 부터</span>
        </div>
        <button class="x" id="mClose" title="닫기">✕</button>
      </div>
      <div id="ytHost"></div>
      <div class="eq" id="mEq"></div>
      <div class="mrow vol">
        <span>🔈</span>
        <input type="range" id="mVol" min="0" max="100" step="1" value="${state.vol}">
        <span id="mVolN">${state.vol}</span>
      </div>
      <a class="yt" id="mYt" href="https://www.youtube.com/watch?v=${VIDEO}&t=${START}s" target="_blank" rel="noopener">유튜브에서 열기 ↗</a>`;
    document.body.appendChild(host);

    const eq = host.querySelector('#mEq');
    for (let i = 0; i < BARS; i++) {
      const b = document.createElement('i');
      eq.appendChild(b);
      bars.push({ el: b, v: 0.08, target: 0.08 });
    }

    ui = {
      panel: host, play: host.querySelector('#mPlay'), stateText: host.querySelector('#mState'),
      vol: host.querySelector('#mVol'), volN: host.querySelector('#mVolN'), eq,
      title: host.querySelector('#mTitle'), yt: host.querySelector('#mYt'),
    };
    ui.play.onclick = toggle;
    host.querySelector('#mClose').onclick = () => togglePanel(false);
    ui.vol.oninput = () => {
      state.vol = Number(ui.vol.value);
      ui.volN.textContent = state.vol;
      localStorage.setItem('sb.music.vol', state.vol);
      if (state.player && state.ready) state.player.setVolume(state.vol);
    };
  }

  function loadApi() {
    return new Promise((resolve, reject) => {
      if (window.YT && window.YT.Player) return resolve();
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (prev) prev(); resolve(); };
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.onerror = () => reject(new Error('유튜브 플레이어를 불러오지 못했습니다'));
      document.head.appendChild(tag);
      setTimeout(() => reject(new Error('유튜브 응답 없음')), 12000);
    });
  }

  async function ensurePlayer() {
    if (state.player) return;
    setState('불러오는 중…');
    await loadApi();
    state.player = new YT.Player('ytHost', {
      height: '132', width: '232', videoId: VIDEO,
      playerVars: {
        autoplay: 1, start: START, controls: 0, disablekb: 1,
        modestbranding: 1, rel: 0, playsinline: 1, origin: location.origin,
      },
      events: {
        onReady: e => {
          state.ready = true;
          e.target.setVolume(state.vol);
          e.target.seekTo(START, true);
          e.target.playVideo();
        },
        onStateChange: e => {
          state.playing = e.data === YT.PlayerState.PLAYING;
          if (e.data === YT.PlayerState.ENDED) {         // 끝나면 다시 3분부터
            state.player.seekTo(START, true);
            state.player.playVideo();
          }
          paint();
        },
        onError: () => {
          state.failed = true;
          setState('이 영상은 외부 재생이 막혀 있습니다');
        },
      },
    });
  }

  async function toggle() {
    if (state.failed) return window.open(ui.yt.href, '_blank');
    try {
      if (!state.player) { await ensurePlayer(); return; }
      if (state.playing) state.player.pauseVideo();
      else {
        if (state.player.getCurrentTime && state.player.getCurrentTime() < START - 1) state.player.seekTo(START, true);
        state.player.playVideo();
      }
    } catch (e) {
      state.failed = true;
      setState('재생할 수 없습니다 — 유튜브에서 열어 주세요');
    }
  }

  function setState(t) { if (ui.stateText) ui.stateText.textContent = t; }

  function paint() {
    ui.play.textContent = state.playing ? '⏸' : '▶';
    ui.panel.classList.toggle('playing', state.playing);
    const btn = document.getElementById('btnMusic');
    if (btn) btn.classList.toggle('on', state.playing);
    if (!state.failed) setState(state.playing ? '재생 중' : state.player ? '일시정지' : '멈춤 · 3:00 부터');
  }

  /* 재생 중일 때만 막대가 살아 움직이게 (실제 파형 아님 — 위 주석 참고) */
  function tick(t) {
    raf = requestAnimationFrame(tick);
    const sec = t / 1000;
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      if (state.playing) {
        // 낮은 대역은 크고 느리게, 높은 대역은 작고 빠르게
        const lowness = 1 - i / bars.length;
        const wob = Math.sin(sec * (2.2 + i * 0.55) + i) * 0.5 + 0.5;
        const beat = Math.pow(Math.sin(sec * 2.4) * 0.5 + 0.5, 3);
        b.target = 0.12 + (0.25 + 0.55 * lowness) * wob * (0.55 + 0.75 * beat);
      } else b.target = 0.06;
      b.v += (b.target - b.v) * (state.playing ? 0.28 : 0.08);
      b.el.style.height = (b.v * 100).toFixed(1) + '%';
    }
  }

  function togglePanel(force) {
    state.open = force === undefined ? !state.open : force;
    ui.panel.hidden = !state.open;
    const btn = document.getElementById('btnMusic');
    if (btn) btn.setAttribute('aria-expanded', String(state.open));
  }

  function init() {
    buildDom();
    paint();
    if (!raf) raf = requestAnimationFrame(tick);
    const btn = document.getElementById('btnMusic');
    if (btn) btn.onclick = () => {
      if (!state.open) { togglePanel(true); if (!state.player) toggle(); }
      else togglePanel(false);
    };
  }

  window.SB_MUSIC = { init, toggle, togglePanel, get playing() { return state.playing; } };
})();
