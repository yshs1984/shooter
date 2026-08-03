(() => {
  'use strict';

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  // バージョン番号は version.js（自動生成ファイル）で定義される
  const GAME_VERSION = window.GAME_VERSION || 'v0.0.0';

  // ---------- ハイスコア（localStorageに保存） ----------
  const HIGH_SCORE_KEY = 'shooter.highScore';
  let highScore = 0;
  let newRecord = false;   // 今回のプレイで更新したか

  function loadHighScore() {
    try {
      const v = parseInt(localStorage.getItem(HIGH_SCORE_KEY), 10);
      highScore = Number.isFinite(v) && v > 0 ? v : 0;
    } catch (e) {
      // プライベートモードなどでlocalStorageが使えない場合は0のまま続行する
      highScore = 0;
    }
  }

  // ゲーム終了時に呼ぶ。更新したらtrueを返す
  function saveHighScore() {
    if (score <= highScore) return false;
    highScore = score;
    newRecord = true;
    try {
      localStorage.setItem(HIGH_SCORE_KEY, String(highScore));
    } catch (e) {
      // 保存できなくても表示だけは更新しておく
    }
    return true;
  }

  let W = 0, H = 0, DPR = 1, playH = 0, controlBarH = 0;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    layoutButtons();
  }
  window.addEventListener('resize', resize);

  // ---------- サウンド ----------
  // 音源ファイルは持たず Web Audio で合成する（ビルド不要・アセット不要の構成を維持するため）
  let audioCtx = null;
  let masterGain = null;
  let muted = false;

  // モバイルは最初のユーザー操作までAudioContextを開始できないため、入力時に呼ぶ
  function initAudio() {
    if (audioCtx) {
      if (audioCtx.state === 'suspended') audioCtx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    audioCtx = new AC();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = muted ? 0 : 0.9;
    masterGain.connect(audioCtx.destination);
  }

  function setMuted(v) {
    muted = v;
    if (masterGain) masterGain.gain.value = muted ? 0 : 0.9;
  }

  // 減衰する単音。周波数を from→to へ滑らせる
  function playTone(opts) {
    if (!audioCtx || muted) return;
    const t0 = audioCtx.currentTime;
    const dur = opts.dur;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = opts.type || 'square';
    osc.frequency.setValueAtTime(opts.from, t0);
    if (opts.to && opts.to !== opts.from) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.to), t0 + dur);
    }
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(opts.vol, t0 + Math.min(0.012, dur * 0.3));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  // ホワイトノイズ（爆発・被弾などの破裂音向け）
  function playNoise(opts) {
    if (!audioCtx || muted) return;
    const t0 = audioCtx.currentTime;
    const dur = opts.dur;
    const frames = Math.floor(audioCtx.sampleRate * dur);
    const buf = audioCtx.createBuffer(1, frames, audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < frames; i++) {
      // 後半ほど小さくして、ぼわっと消えるようにする
      data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    }
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    const filter = audioCtx.createBiquadFilter();
    filter.type = opts.filterType || 'lowpass';
    filter.frequency.setValueAtTime(opts.freq, t0);
    if (opts.freqTo) filter.frequency.exponentialRampToValueAtTime(Math.max(1, opts.freqTo), t0 + dur);
    const gain = audioCtx.createGain();
    gain.gain.setValueAtTime(opts.vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(masterGain);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  const SFX = {
    shot:      () => playTone({ type: 'square',   from: 900,  to: 420,  dur: 0.06, vol: 0.05 }),
    enemyKill: () => playNoise({ dur: 0.16, freq: 1600, freqTo: 300, vol: 0.20 }),
    bossHit:   () => playTone({ type: 'square',   from: 260,  to: 190,  dur: 0.05, vol: 0.05 }),
    hit:       () => playNoise({ dur: 0.36, freq: 700,  freqTo: 90,  vol: 0.38 }),
    shieldOff: () => playTone({ type: 'triangle', from: 780,  to: 240,  dur: 0.22, vol: 0.20 }),
    item:      () => { playTone({ type: 'triangle', from: 660, to: 660, dur: 0.07, vol: 0.16 });
                       setTimeout(() => playTone({ type: 'triangle', from: 990, to: 990, dur: 0.11, vol: 0.16 }), 70); },
    bossAppear:() => playTone({ type: 'sawtooth', from: 70,   to: 180,  dur: 0.9,  vol: 0.20 }),
    // サメの突進: 溜めは上昇音、突進は水を切るノイズ
    sharkCharge:() => playTone({ type: 'sawtooth', from: 120, to: 420, dur: 0.8, vol: 0.16 }),
    sharkBite: () => playNoise({ dur: 0.45, freq: 400, freqTo: 2600, vol: 0.30, filterType: 'bandpass' }),
    bossDown:  () => { playNoise({ dur: 0.9, freq: 900, freqTo: 60, vol: 0.45 });
                       playTone({ type: 'sawtooth', from: 200, to: 40, dur: 0.9, vol: 0.18 }); },
    stage:     () => { playTone({ type: 'triangle', from: 520, to: 520, dur: 0.12, vol: 0.18 });
                       setTimeout(() => playTone({ type: 'triangle', from: 780, to: 780, dur: 0.18, vol: 0.18 }), 130); },
    gameOver:  () => playTone({ type: 'sawtooth', from: 320,  to: 60,   dur: 1.1,  vol: 0.24 }),
    clear:     () => {
      // 上昇するアルペジオ
      [523, 659, 784, 1047].forEach((f, i) => {
        setTimeout(() => playTone({ type: 'triangle', from: f, to: f, dur: 0.3, vol: 0.18 }), i * 140);
      });
    }
  };

  // ---------- ゲーム状態 ----------
  const STATE_TITLE = 'title';
  const STATE_PLAYING = 'playing';
  const STATE_PAUSED = 'paused';
  const STATE_GAMEOVER = 'gameover';
  const STATE_ENDING = 'ending';
  const STATE_CONTINUE = 'continue';

  let state = STATE_TITLE;
  let score = 0;
  let lives = 3;
  let elapsed = 0;
  let killCount = 0;
  const BOSS_KILL_THRESHOLD = 30;
  const MAX_LIVES = 5;

  // ライフが尽きても規定回数までは再開できる（ボス戦で尽きたならボス戦から）
  const CONTINUE_MAX = 2;
  let continuesLeft = CONTINUE_MAX;
  let totalKills = 0;   // エンディングで見せる通算撃破数
  let endingT = 0;      // エンディング演出の経過秒
  let checkpointAtBoss = false;

  // ---------- 面構成 ----------
  // hazard: そのステージで発生する障害の種類('volcano'|'whirlpool'|'dive')
  // bosses: そのステージで戦うボスの並び（通常1体。連戦ステージは複数）
  const STAGES = [
    { hazard: 'volcano',   bosses: [{ kind: 'mantis',       hp: 75,  score: 650 }] },
    { hazard: 'whirlpool', bosses: [{ kind: 'crab',         hp: 90,  score: 800 }] },
    { hazard: 'wreckage',  bosses: [{ kind: 'ghostoctopus', hp: 110, score: 950 }] },
    { hazard: 'dive',      bosses: [{ kind: 'squid',        hp: 95,  score: 800 }] },
    { hazard: 'darkdive',  bosses: [
        { kind: 'squid',       hp: 130, score: 900,  variant: 'enraged' },
        { kind: 'goblinshark', hp: 140, score: 1200 }
      ] }
  ];
  let currentStage = 1;
  let bossIndex = 0;   // 現在のステージ内で何体目のボスと戦っているか（連戦用）
  let stageBannerTimer = 0;
  let stageBannerText = '';

  // ---------- 潜航ステージ ----------
  // 潜航hazardのステージでは途中で海底が途切れて大穴になり、そこへ潜ると縦スクロールに切り替わる。
  const DIVE_TRIGGER_KILLS = 14;   // この撃破数で大穴が近づいてくる
  const DIVE_HOLE_WIDTH = 4000;    // 大穴の横幅（ワールド座標）
  const DIVE_SPEED = 128;          // 潜航中の縦スクロール速度(px/s)
  const DIVE_BOTTOM_DEPTH = 2000;  // この深さまで潜ると縦穴を抜けて再び横スクロールになる
  const DEEP_BOSS_DELAY = 3.2;     // 横スクロールに戻ってからボスが現れるまでの秒数
  let diveMode = 'none';           // 'none' | 'opening' | 'diving' | 'deep'
  let diveHole = null;             // { start } 大穴のワールド座標
  let diveDepth = 0;
  let deepTimer = 0;

  // ---------- デバッグモード ----------
  // URLに ?debug=1 が付いている場合のみ有効。通常プレイには一切影響しない。
  const DEBUG = new URLSearchParams(location.search).get('debug') === '1';
  let debugInvincible = false;
  let debugButtons = {};

  // ---------- 入力（画面下部の操作ボタン） ----------
  const controls = { up: false, down: false, left: false, right: false };
  const buttons = {
    up: { x: 0, y: 0, w: 0, h: 0 },
    down: { x: 0, y: 0, w: 0, h: 0 },
    left: { x: 0, y: 0, w: 0, h: 0 },
    right: { x: 0, y: 0, w: 0, h: 0 }
  };
  const activePointers = new Map();
  const MOUSE_ID = 'mouse';

  let pauseButton = { x: 0, y: 0, w: 0, h: 0 };
  let muteButton = { x: 0, y: 0, w: 0, h: 0 };
  let restartButton = { x: 0, y: 0, w: 0, h: 0 };

  const KEY_DIRECTIONS = {
    ArrowUp: 'up', KeyW: 'up',
    ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right'
  };
  const keysActive = { up: false, down: false, left: false, right: false };

  function layoutButtons() {
    controlBarH = Math.max(120, Math.min(170, Math.round(H * 0.22)));
    playH = H - controlBarH;

    const btn = Math.min(64, Math.round(controlBarH * 0.4));
    const gap = 8;
    const cell = btn + gap;
    const padCX = 24 + cell * 1.5;
    const padCY = playH + controlBarH * 0.38;

    buttons.up = { x: padCX - btn / 2, y: padCY - cell, w: btn, h: btn };
    buttons.down = { x: padCX - btn / 2, y: padCY + gap, w: btn, h: btn };
    buttons.left = { x: padCX - cell - btn / 2, y: padCY - btn / 2, w: btn, h: btn };
    buttons.right = { x: padCX + cell - btn / 2, y: padCY - btn / 2, w: btn, h: btn };

    const pbSize = 40;
    pauseButton = { x: W - pbSize - 12, y: 12, w: pbSize, h: pbSize };
    muteButton = { x: W - pbSize * 2 - 20, y: 12, w: pbSize, h: pbSize };
    const rbW = 170, rbH = 46;
    restartButton = { x: W / 2 - rbW / 2, y: H / 2 + 30, w: rbW, h: rbH };

    if (DEBUG) {
      // 操作パッドの右側の空きスペースに縦積みで配置する
      const dw = 78, dh = 30, dgap = 6;
      const dx = W - dw - 12;
      const top = playH + (controlBarH - (dh * 3 + dgap * 2)) / 2;
      debugButtons = {
        stage: { x: dx, y: top, w: dw, h: dh, label: 'STAGE ▶' },
        boss: { x: dx, y: top + dh + dgap, w: dw, h: dh, label: 'BOSS' },
        invuln: { x: dx, y: top + (dh + dgap) * 2, w: dw, h: dh, label: 'MUTEKI' }
      };
    }
  }

  function localPos(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function inRect(px, py, r) {
    return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
  }

  function recomputeControls() {
    controls.up = controls.down = controls.left = controls.right = false;
    for (const p of activePointers.values()) {
      if (inRect(p.x, p.y, buttons.up)) controls.up = true;
      if (inRect(p.x, p.y, buttons.down)) controls.down = true;
      if (inRect(p.x, p.y, buttons.left)) controls.left = true;
      if (inRect(p.x, p.y, buttons.right)) controls.right = true;
    }
    controls.up = controls.up || keysActive.up;
    controls.down = controls.down || keysActive.down;
    controls.left = controls.left || keysActive.left;
    controls.right = controls.right || keysActive.right;
  }

  function maybeStartOrRestart() {
    if (state === STATE_CONTINUE) {
      continueGame();
    } else if (state === STATE_ENDING) {
      // 演出の途中でうっかり飛ばさないよう、少し経ってから受け付ける
      if (endingT > ENDING_TAP_DELAY) state = STATE_TITLE;
    } else if (state === STATE_TITLE || state === STATE_GAMEOVER) {
      startGame();
    }
  }

  function togglePause() {
    if (state === STATE_PLAYING) state = STATE_PAUSED;
    else if (state === STATE_PAUSED) state = STATE_PLAYING;
  }

  // 次のステージへ即座に進む（最終ステージならクリア扱い）
  function debugSkipStage() {
    boss = null;
    enemies = [];
    enemyBullets = [];
    resetVolcanoes();
    resetWhirlpools();
    resetWreckage();
    killCount = 0;
    bossIndex = 0;
    spawnTimer = Math.max(spawnTimer, 1.2);
    if (currentStage < STAGES.length) {
      const prevHazard = STAGES[currentStage - 1].hazard;
      currentStage += 1;
      const nextHazard = STAGES[currentStage - 1].hazard;
      // 4面→5面は同じ深海の続きなので、穴くぐりの潜航演出をやり直さない（本編の遷移と同じ扱い）
      if (prevHazard === 'dive' && nextHazard === 'darkdive') {
        diveMode = 'deep';
        diveDepth = DIVE_BOTTOM_DEPTH;
        deepTimer = DEEP_BOSS_DELAY;
      } else {
        resetDive();
      }
      stageBannerTimer = 2.2;
      stageBannerText = `STAGE ${currentStage}`;
    } else {
      startEnding();
    }
  }

  // 現在のステージのボスを即座に出現させる
  function debugSpawnBoss() {
    if (boss) return;
    killCount = BOSS_KILL_THRESHOLD;
    spawnBoss();
  }

  function handleDebugPointerDown(pos) {
    if (!DEBUG || (state !== STATE_PLAYING && state !== STATE_PAUSED)) return false;
    if (inRect(pos.x, pos.y, debugButtons.stage)) {
      debugSkipStage();
      return true;
    }
    if (inRect(pos.x, pos.y, debugButtons.boss)) {
      debugSpawnBoss();
      return true;
    }
    if (inRect(pos.x, pos.y, debugButtons.invuln)) {
      debugInvincible = !debugInvincible;
      return true;
    }
    return false;
  }

  // ポーズ関連のボタンをタップした場合はtrueを返し、通常の入力処理（操作ボタン・スタート判定）を行わせない
  function handlePointerDown(pos) {
    // 最初のユーザー操作でAudioContextを起こす（モバイルの自動再生制限のため）
    initAudio();
    // ミュートボタンは表示されている画面でだけ反応させる
    if (muteButtonVisible() && inRect(pos.x, pos.y, muteButton)) {
      setMuted(!muted);
      return true;
    }
    if (handleDebugPointerDown(pos)) return true;
    if (state === STATE_PLAYING && inRect(pos.x, pos.y, pauseButton)) {
      togglePause();
      return true;
    }
    if (state === STATE_PAUSED) {
      if (inRect(pos.x, pos.y, pauseButton)) {
        togglePause();
      } else if (inRect(pos.x, pos.y, restartButton)) {
        startGame();
      }
      return true;
    }
    return false;
  }

  function onTouchStart(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      const pos = localPos(t.clientX, t.clientY);
      if (handlePointerDown(pos)) continue;
      activePointers.set(t.identifier, pos);
    }
    recomputeControls();
    maybeStartOrRestart();
  }
  function onTouchMove(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (activePointers.has(t.identifier)) {
        activePointers.set(t.identifier, localPos(t.clientX, t.clientY));
      }
    }
    recomputeControls();
  }
  function onTouchEnd(e) {
    e.preventDefault();
    for (const t of e.changedTouches) activePointers.delete(t.identifier);
    recomputeControls();
  }

  function onMouseDown(e) {
    const pos = localPos(e.clientX, e.clientY);
    if (handlePointerDown(pos)) return;
    activePointers.set(MOUSE_ID, pos);
    recomputeControls();
    maybeStartOrRestart();
  }
  function onMouseMove(e) {
    if (!activePointers.has(MOUSE_ID)) return;
    activePointers.set(MOUSE_ID, localPos(e.clientX, e.clientY));
    recomputeControls();
  }
  function onMouseUp() {
    activePointers.delete(MOUSE_ID);
    recomputeControls();
  }

  function onKeyDown(e) {
    initAudio();
    if (e.code === 'KeyM') {
      e.preventDefault();
      setMuted(!muted);
      return;
    }
    const dir = KEY_DIRECTIONS[e.code];
    if (dir) {
      e.preventDefault();
      keysActive[dir] = true;
      recomputeControls();
      maybeStartOrRestart();
      return;
    }
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      maybeStartOrRestart();
      return;
    }
    if (e.code === 'KeyP' || e.code === 'Escape') {
      e.preventDefault();
      togglePause();
      return;
    }
    if (DEBUG && state === STATE_PLAYING) {
      if (e.code === 'KeyN') {
        e.preventDefault();
        debugSkipStage();
      } else if (e.code === 'KeyB') {
        e.preventDefault();
        debugSpawnBoss();
      } else if (e.code === 'KeyI') {
        e.preventDefault();
        debugInvincible = !debugInvincible;
      }
    }
  }
  function onKeyUp(e) {
    const dir = KEY_DIRECTIONS[e.code];
    if (dir) {
      keysActive[dir] = false;
      recomputeControls();
    }
  }

  canvas.addEventListener('touchstart', onTouchStart, { passive: false });
  canvas.addEventListener('touchmove', onTouchMove, { passive: false });
  canvas.addEventListener('touchend', onTouchEnd, { passive: false });
  canvas.addEventListener('touchcancel', onTouchEnd, { passive: false });
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup', onMouseUp);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  // ---------- 海中の背景（気泡・光の筋） ----------
  let bubbles = [];
  let lightShift = 0;

  function initBubbles() {
    bubbles = [];
    for (let i = 0; i < 60; i++) {
      bubbles.push({
        x: Math.random() * W,
        y: Math.random() * playH,
        speedX: 15 + Math.random() * 50,
        speedY: 8 + Math.random() * 26,
        size: 1.5 + Math.random() * 3.5,
        alpha: 0.15 + Math.random() * 0.35
      });
    }
  }

  function updateBubbles(dt) {
    lightShift += dt * 18;
    for (const b of bubbles) {
      b.x -= b.speedX * dt;
      b.y -= b.speedY * dt;
      if (b.x < -10 || b.y < -10) {
        b.x = Math.random() * W + W * 0.2;
        b.y = playH + Math.random() * 40;
      }
    }
  }

  function drawOceanBackground() {
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#0d5c78');
    grad.addColorStop(0.55, '#0a3a52');
    grad.addColorStop(1, '#031522');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // 水面から差し込む光の筋
    ctx.save();
    ctx.globalAlpha = 0.07;
    ctx.fillStyle = '#eafcff';
    const rayGap = 220;
    for (let x = -rayGap; x < W + rayGap; x += rayGap) {
      const rayX = x - (lightShift % rayGap);
      ctx.beginPath();
      ctx.moveTo(rayX, 0);
      ctx.lineTo(rayX + 60, 0);
      ctx.lineTo(rayX - 40, H);
      ctx.lineTo(rayX - 100, H);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // 気泡
    ctx.fillStyle = '#dff7ff';
    for (const b of bubbles) {
      ctx.globalAlpha = b.alpha;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawTerrain() {
    const step = 5;

    const grad = ctx.createLinearGradient(0, playH * 0.55, 0, playH);
    grad.addColorStop(0, '#2b4a3a');
    grad.addColorStop(1, '#0e2018');
    ctx.fillStyle = grad;

    ctx.beginPath();
    ctx.moveTo(0, playH);
    for (let sx = 0; sx <= W; sx += step) {
      ctx.lineTo(sx, terrainSurfaceY(sx));
    }
    ctx.lineTo(W, playH);
    ctx.closePath();
    ctx.fill();

    // 稜線のハイライト
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let sx = 0; sx <= W; sx += step) {
      const y = terrainSurfaceY(sx);
      if (sx === 0) ctx.moveTo(sx, y);
      else ctx.lineTo(sx, y);
    }
    ctx.stroke();
  }

  // 深海（潜航後の横スクロール）の天井。海底と対になる見た目にする
  function drawCeiling() {
    const step = 5;

    const grad = ctx.createLinearGradient(0, 0, 0, playH * 0.45);
    grad.addColorStop(0, '#0e2018');
    grad.addColorStop(1, '#2b4a3a');
    ctx.fillStyle = grad;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (let sx = 0; sx <= W; sx += step) {
      ctx.lineTo(sx, ceilingSurfaceY(sx));
    }
    ctx.lineTo(W, 0);
    ctx.closePath();
    ctx.fill();

    // 稜線のハイライト
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let sx = 0; sx <= W; sx += step) {
      const y = ceilingSurfaceY(sx);
      if (sx === 0) ctx.moveTo(sx, y);
      else ctx.lineTo(sx, y);
    }
    ctx.stroke();
  }

  // ---------- 海底（起伏のある地形。当たり判定あり） ----------
  const TERRAIN_SCROLL_SPEED = 110;
  const TERRAIN_PERIOD = 700;
  let terrainOffset = 0;

  // 決定的な擬似乱数（同じnには常に同じ値を返す）
  function terrainHash(n) {
    const s = Math.sin(n * 12.9898) * 43758.5453123;
    return s - Math.floor(s);
  }

  // 周期ごとの山の情報（決定的。山がない周期はnull）
  function mountainAt(periodIndex) {
    const r1 = terrainHash(periodIndex);
    if (r1 >= 0.6) return null;
    const r2 = terrainHash(periodIndex + 100);
    const r3 = terrainHash(periodIndex + 200);
    return {
      center: periodIndex * TERRAIN_PERIOD + TERRAIN_PERIOD * (0.3 + r2 * 0.4),
      halfWidth: 140 + r3 * 110,
      peakH: playH * 0.18 + r1 * (playH * 0.22), // 控えめ〜プレイエリアの4割程度
      // 山のうち一部は火山。地形と一緒に流れてくるので固定配置にならない
      isVolcano: terrainHash(periodIndex + 300) < VOLCANO_MOUNTAIN_CHANCE,
      // 山のうち一部は沈没船の残骸。isVolcanoとは独立の判定なので、
      // どちらを見るかはステージのhazardが決める
      isWreckage: terrainHash(periodIndex + 400) < WRECKAGE_MOUNTAIN_CHANCE
    };
  }

  // ワールド座標x（画面スクロール分を含む）における海底の高さ（playHからの隆起量）
  function terrainHeightAt(worldX) {
    const rolling = 14 + Math.sin(worldX * 0.004) * 8 + Math.sin(worldX * 0.011 + 1.7) * 5;

    // ゴツゴツした岩肌の凹凸（高周波の山なりを複数重ね、鋭い突起にする）
    const jag =
      Math.abs(Math.sin(worldX * 0.09 + 3.1)) * 7 +
      Math.abs(Math.sin(worldX * 0.23 + 1.2)) * 4 +
      Math.abs(Math.sin(worldX * 0.53 + 5.4)) * 2.2;

    const m = mountainAt(Math.floor(worldX / TERRAIN_PERIOD));
    let mountain = 0;
    if (m) {
      const d = worldX - m.center;
      if (Math.abs(d) < m.halfWidth) {
        const t = d / m.halfWidth;
        mountain = Math.cos((t * Math.PI) / 2) ** 2 * m.peakH;
      }
    }
    return (rolling + jag + mountain) * holeMask(worldX) * bossArenaScale();
  }

  // ボス戦中は海底を低くして、ボスに追い立てられて地形に潰される事故を減らす。
  // 切り替わりで地形が瞬間的に変形しないよう、時間をかけて上下させる
  const BOSS_ARENA_FLATTEN = 0.45;   // ボス戦中の海底の高さの倍率
  let bossArenaT = 0;                // 0=通常, 1=ボス戦の低い海底

  function updateBossArena(dt) {
    const target = boss ? 1 : 0;
    const rate = dt / 1.2;
    if (bossArenaT < target) bossArenaT = Math.min(target, bossArenaT + rate);
    else if (bossArenaT > target) bossArenaT = Math.max(target, bossArenaT - rate);
  }

  function bossArenaScale() {
    return 1 - (1 - BOSS_ARENA_FLATTEN) * bossArenaT;
  }

  // 大穴の内側では海底の高さを0にする（縁はなめらかに落として崖に見せる）
  function holeMask(worldX) {
    if (!diveHole) return 1;
    const s = diveHole.start;
    const e = s + DIVE_HOLE_WIDTH;
    const edge = 110;
    if (worldX <= s - edge || worldX >= e + edge) return 1;
    if (worldX >= s && worldX <= e) return 0;
    const d = worldX < s ? (s - worldX) / edge : (worldX - e) / edge;
    return d * d;
  }

  // ---------- 潜航中の縦穴（左右の岩壁。当たり判定あり） ----------
  // 深さ（ワールドY）から壁の食い込み量を決める決定的な関数
  function caveInset(worldY, phase) {
    const base =
      44 +
      Math.sin(worldY * 0.0052 + phase) * 26 +
      Math.sin(worldY * 0.0131 + phase * 2.3) * 13;
    const jag =
      Math.abs(Math.sin(worldY * 0.075 + phase)) * 8 +
      Math.abs(Math.sin(worldY * 0.19 + phase * 1.7)) * 4;
    return base + jag;
  }

  function caveLeftAt(screenY) { return caveInset(screenY + diveDepth, 0); }
  function caveRightAt(screenY) { return W - caveInset(screenY + diveDepth, 2.4); }

  function collidesCave(x, y, r) {
    return x - r < caveLeftAt(y) || x + r > caveRightAt(y);
  }

  // 潜航中かどうかで地形の当たり判定を切り替える
  function collidesWorld(x, y, r) {
    if (diveMode === 'diving') return collidesCave(x, y, r);
    if (diveMode === 'deep' && collidesCeiling(x, y, r)) return true;
    return collidesTerrain(x, y, r);
  }

  // 画面座標xにおける海底の表面のy座標
  function terrainSurfaceY(screenX) {
    return playH - terrainHeightAt(screenX + terrainOffset);
  }

  function collidesTerrain(x, y, r) {
    return y + r > terrainSurfaceY(x);
  }

  // ---------- 深海（潜航後の横スクロール）の天井（当たり判定あり） ----------
  // 海底の起伏(rolling+jag)と同じ考え方だが、位相と周期をずらして海底とは違う見た目にする。
  // 大きな山（火山・残骸）は乗せず、ボス戦中は海底と同じくbossArenaScale()で退かせて圧迫感を抑える
  function ceilingHeightAt(worldX) {
    const rolling = 16 + Math.sin(worldX * 0.0035 + 4.1) * 9 + Math.sin(worldX * 0.0097 + 0.6) * 5;
    const jag =
      Math.abs(Math.sin(worldX * 0.081 + 2.3)) * 6 +
      Math.abs(Math.sin(worldX * 0.21 + 4.8)) * 3.5;
    return (rolling + jag) * bossArenaScale();
  }

  // 画面座標xにおける天井の表面のy座標
  function ceilingSurfaceY(screenX) {
    return ceilingHeightAt(screenX + terrainOffset);
  }

  function collidesCeiling(x, y, r) {
    return y - r < ceilingSurfaceY(x);
  }

  function updateTerrain(dt) {
    // 潜航中は横スクロールを止める（縦スクロールに切り替わるため）
    if (diveMode === 'diving') return;
    terrainOffset += TERRAIN_SCROLL_SPEED * dt;
  }

  // ---------- 自機 ----------
  const player = {
    x: 0,
    y: 0,
    size: 18,
    hitRadius: 12,
    hp: 3,
    invuln: 0,
    fireCooldown: 0,
    bulletType: 'normal',
    rapidFire: false,
    speedBoost: false,
    shieldHp: 0,
    shieldPopTimer: 0,
    spin: 0,
    caught: false
  };

  function resetPlayer() {
    player.x = Math.max(60, W * 0.15);
    player.y = playH / 2;
    player.invuln = 1.0;
    player.fireCooldown = 0;
    player.bulletType = 'normal';
    player.rapidFire = false;
    player.speedBoost = false;
    player.shieldHp = 0;
    player.shieldPopTimer = 0;
    player.spin = 0;
    player.caught = false;
  }

  function playerMinX() { return player.size + 4; }
  // 前進の上限は設けず画面右端まで行ける。前に出すぎて敵に接触するのはプレイヤーの判断に委ねる
  function playerMaxX() { return W - player.size - 4; }

  // ---------- 潜水艦の気泡（艦尾から漏れる小さな泡） ----------
  let playerBubbles = [];
  let playerBubbleTimer = 0;

  function updatePlayerBubbles(dt) {
    playerBubbleTimer -= dt;
    if (playerBubbleTimer <= 0) {
      playerBubbleTimer = 0.08 + Math.random() * 0.07;
      playerBubbles.push({
        x: player.x - player.size * 1.3 + (Math.random() - 0.5) * 6,
        y: player.y + (Math.random() - 0.5) * 10,
        vx: -26 - Math.random() * 18,
        vy: -16 - Math.random() * 20,
        size: 1 + Math.random() * 2,
        life: 0.7 + Math.random() * 0.4,
        maxLife: 0
      });
      playerBubbles[playerBubbles.length - 1].maxLife = playerBubbles[playerBubbles.length - 1].life;
    }
    for (const b of playerBubbles) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
    }
    playerBubbles = playerBubbles.filter(b => b.life > 0);
  }

  function drawPlayerBubbles() {
    ctx.fillStyle = '#dff7ff';
    for (const b of playerBubbles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, b.life / b.maxLife)) * 0.55;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ---------- 弾 ----------
  let playerBullets = [];
  let enemyBullets = [];

  const BULLET_SPEED = 620;
  // ホーミング弾の追尾性能。旋回が速すぎるとまず外れないため控えめにしている
  const HOMING_TURN_RATE = 2.2;  // 最大旋回速度(rad/s)
  const HOMING_RANGE = 230;      // この距離より遠い敵は追わない(px)
  const BASE_FIRE_INTERVAL = 0.38;
  const TORPEDO_DAMAGE = 4;      // 魚雷1発の威力
  const TORPEDO_FIRE_MULT = 2.0; // 魚雷の発射間隔の倍率
  const RAPID_FIRE_INTERVAL = 0.15;
  const MOVE_SPEED_NORMAL = 260;
  const MOVE_SPEED_BOOST = 400;

  function spawnPlayerBullet() {
    // 潜航中は下から来る敵に向けて真下へ撃つ
    const aim = diveMode === 'diving' ? Math.PI / 2 : 0;
    const ca = Math.cos(aim), sa = Math.sin(aim);
    const x = player.x + player.size * ca;
    const y = player.y + player.size * sa;
    const push = (speed, a, rest) => {
      const ang = aim + a;
      playerBullets.push({
        x, y,
        vx: Math.cos(ang) * speed,
        vy: Math.sin(ang) * speed,
        ...rest
      });
    };

    if (player.bulletType === 'spread') {
      for (const a of [-0.28, 0, 0.28]) push(BULLET_SPEED, a, { r: 4, type: 'spread' });
    } else if (player.bulletType === 'homing') {
      push(BULLET_SPEED, 0, { r: 5, type: 'homing', homing: true });
    } else if (player.bulletType === 'pierce') {
      push(BULLET_SPEED, 0, { r: 5, type: 'pierce', pierce: true });
    } else if (player.bulletType === 'wide') {
      push(BULLET_SPEED, 0, { r: 10, type: 'wide' });
    } else if (player.bulletType === 'torpedo') {
      push(BULLET_SPEED, 0, { r: 7, type: 'torpedo', dmg: TORPEDO_DAMAGE });
    } else {
      push(BULLET_SPEED, 0, { r: 4, type: 'normal' });
    }
  }

  // maxRange を渡すとその範囲内の敵だけを対象にする
  function findNearestTarget(x, y, maxRange) {
    let best = null;
    let bestDist = maxRange === undefined ? Infinity : maxRange;
    for (const e of enemies) {
      const d = dist(x, y, e.x, e.y);
      if (d < bestDist) { bestDist = d; best = e; }
    }
    if (boss) {
      const d = dist(x, y, boss.x, boss.y);
      if (d < bestDist) { bestDist = d; best = boss; }
    }
    return best;
  }

  function spawnEnemyBullet(x, y, vx, vy, opts) {
    enemyBullets.push({
      x, y, vx, vy,
      r: (opts && opts.r) || 5,
      lava: !!(opts && opts.lava),
      kind: (opts && opts.kind) || 'normal'
    });
  }

  // ---------- 敵 ----------
  let enemies = [];
  let spawnTimer = 0;
  // 敵の出現間隔。ステージが進むほど、またステージ内で撃破が進むほど詰まっていく
  const SPAWN_INTERVAL_BASE = 1.45;   // ステージ1の開始時
  const SPAWN_INTERVAL_PER_STAGE = 0.15;  // ステージごとに短くする量
  const SPAWN_INTERVAL_PROGRESS = 0.38;   // ステージ内の進行で短くする割合
  const SPAWN_INTERVAL_MIN = 0.55;    // これ以上は詰めない（理不尽さの下限）
  // ボス戦中の敵の出現間隔。ボスの相手をしながらなので通常より大幅に緩くする
  const BOSS_FIGHT_SPAWN_INTERVAL = 2.6;

  function currentSpawnInterval() {
    const base = SPAWN_INTERVAL_BASE - (currentStage - 1) * SPAWN_INTERVAL_PER_STAGE;
    const progress = Math.min(1, killCount / BOSS_KILL_THRESHOLD);
    return Math.max(SPAWN_INTERVAL_MIN, base * (1 - progress * SPAWN_INTERVAL_PROGRESS));
  }

  // ステージごとの出現テーブル（重み）。進むほど新しい敵が混ざるようにする
  const STAGE_ENEMY_WEIGHTS = [
    { school: 40, sine: 35, shooter: 25 },
    { school: 28, sine: 24, shooter: 20, marlin: 16, moray: 12 },
    { school: 20, sine: 18, shooter: 16, marlin: 16, moray: 14, puffer: 10, octopus: 6 },
    { school: 18, sine: 16, shooter: 16, marlin: 16, moray: 12, puffer: 12, octopus: 10 },
    { school: 18, sine: 16, shooter: 16, marlin: 16, moray: 12, puffer: 12, octopus: 10 }
  ];

  function pickEnemyKind(exclude) {
    const idx = Math.min(currentStage, STAGE_ENEMY_WEIGHTS.length) - 1;
    const table = STAGE_ENEMY_WEIGHTS[idx];
    let total = 0;
    for (const k in table) {
      if (exclude && exclude.includes(k)) continue;
      total += table[k];
    }
    let r = Math.random() * total;
    for (const k in table) {
      if (exclude && exclude.includes(k)) continue;
      r -= table[k];
      if (r <= 0) return k;
    }
    return 'school';
  }

  // ボス戦中に出したくない敵。飛び道具が加わると難易度が跳ね上がるため
  const BOSS_FIGHT_EXCLUDED = ['shooter'];

  function spawnEnemy(exclude) {
    const y = 40 + Math.random() * (playH - 80);
    switch (pickEnemyKind(exclude)) {
      case 'sine':
        enemies.push({
          type: 'sine', x: W + 30, y, baseY: y, vx: -140,
          amp: 40 + Math.random() * 40, freq: 1.5 + Math.random(), t: 0,
          r: 14, hp: 1, score: 15
        });
        break;
      case 'shooter':
        enemies.push({
          type: 'shooter', x: W + 30, y, vx: -90, vy: 0,
          r: 16, hp: 2, score: 25, fireCooldown: 1.2 + Math.random()
        });
        break;
      case 'marlin':
        spawnMarlin();
        break;
      case 'moray':
        spawnMoray();
        break;
      case 'puffer':
        enemies.push({
          type: 'puffer', x: W + 30, y, baseY: y, vx: -68, t: 0,
          r: 18, hp: 3, maxHp: 3, score: 35
        });
        break;
      case 'octopus':
        enemies.push({
          type: 'octopus', x: W + 30, y, baseY: y, vx: -80, t: 0,
          r: 17, hp: 2, score: 30, inkCooldown: 1.0 + Math.random()
        });
        break;
      default: {
        // ピラニアは単体ではなく群れ（3匹）で出現する
        const schoolSize = 3;
        for (let i = 0; i < schoolSize; i++) {
          const sy = y + (i - (schoolSize - 1) / 2) * 26;
          const sx = W + 30 + i * 24;
          enemies.push({
            type: 'straight',
            x: sx, baseX: sx,
            y: sy, baseY: sy,
            vx: -170, vy: 0,
            t: Math.random() * Math.PI * 2,
            xWobble: 10 + Math.random() * 8,
            yWobble: 9 + Math.random() * 7,
            r: 14, hp: 1, score: 10
          });
        }
      }
    }
  }

  // カジキ: 画面右端で狙いを定めてから自機めがけて高速で突進する
  function spawnMarlin() {
    enemies.push({
      type: 'marlin',
      x: W + 26,
      y: Math.max(40, Math.min(playH - 40, player.y + (Math.random() - 0.5) * 90)),
      vx: 0, r: 15, hp: 2, score: 30,
      phase: 'aim', aimT: 0.75, t: 0
    });
  }

  // ウツボ: 海底に張り付いて待ち伏せ、自機が近づくと飛び出して噛みつく
  function spawnMoray() {
    const x = W + 26;
    enemies.push({
      type: 'moray',
      x, y: terrainSurfaceY(x) - 10,
      r: 15, hp: 3, score: 30,
      phase: 'hide', strikeT: 0, t: 0,
      dirX: 0, dirY: 0
    });
  }

  function updateEnemy(e, dt) {
    if (e.type === 'riser') {
      // 縦穴を左右に揺れながら浮上してくる
      e.t += dt;
      e.y += e.vy * dt;
      e.x = e.baseX + Math.sin(e.t * e.freq) * e.amp;
      return;
    }
    if (e.type === 'straight') {
      // 前後・上下に小さく揺れながら群れで泳ぐ
      e.t += dt;
      e.baseX += e.vx * dt;
      e.x = e.baseX + Math.sin(e.t * 2.4) * e.xWobble;
      e.y = e.baseY + Math.sin(e.t * 3.1) * e.yWobble;
    } else if (e.type === 'sine') {
      e.t += dt;
      e.x += e.vx * dt;
      e.y = e.baseY + Math.sin(e.t * e.freq) * e.amp;
    } else if (e.type === 'shooter') {
      e.x += e.vx * dt;
      e.fireCooldown -= dt;
      if (e.fireCooldown <= 0 && e.x < W - 40) {
        e.fireCooldown = 1.6 + Math.random() * 0.8;
        const dx = player.x - e.x;
        const dy = player.y - e.y;
        const len = Math.max(1, Math.hypot(dx, dy));
        const speed = 260;
        spawnEnemyBullet(e.x, e.y, (dx / len) * speed, (dy / len) * speed, { r: 6, kind: 'spike' });
      }
    } else if (e.type === 'marlin') {
      e.t += dt;
      if (e.phase === 'aim') {
        // 突進前に画面端で少し引いて溜める（予兆）
        e.aimT -= dt;
        e.x = W + 26 - Math.sin(Math.min(1, (0.75 - e.aimT) / 0.75) * Math.PI) * 14;
        if (e.aimT <= 0) {
          e.phase = 'dash';
          const dx = player.x - e.x;
          const dy = player.y - e.y;
          const len = Math.max(1, Math.hypot(dx, dy));
          const speed = 520;
          e.vx = (dx / len) * speed;
          e.vy = (dy / len) * speed;
        }
      } else {
        e.x += e.vx * dt;
        e.y += e.vy * dt;
      }
    } else if (e.type === 'moray') {
      e.t += dt;
      // 海底に張り付いたままスクロールしていく
      e.x -= TERRAIN_SCROLL_SPEED * dt;
      const restY = terrainSurfaceY(e.x) - 10;
      if (e.phase === 'hide') {
        e.y = restY;
        const near = Math.abs(player.x - e.x) < 120 && player.y > e.y - 190;
        if (near && e.x < W - 20) {
          e.phase = 'strike';
          e.strikeT = 0;
          const dx = player.x - e.x;
          const dy = player.y - e.y;
          const len = Math.max(1, Math.hypot(dx, dy));
          e.dirX = dx / len;
          e.dirY = dy / len;
        }
      } else {
        // 飛び出して噛みつき、また岩陰へ戻る
        e.strikeT += dt / 0.85;
        const reach = Math.sin(Math.min(1, e.strikeT) * Math.PI) * 120;
        e.y = restY + e.dirY * reach;
        e.x += e.dirX * reach * dt * 1.4;
        if (e.strikeT >= 1) {
          e.phase = 'hide';
          e.y = restY;
        }
      }
    } else if (e.type === 'puffer') {
      e.t += dt;
      e.x += e.vx * dt;
      e.y = e.baseY + Math.sin(e.t * 1.5) * 12;
    } else if (e.type === 'octopus') {
      e.t += dt;
      e.x += e.vx * dt;
      e.y = e.baseY + Math.sin(e.t * 1.2) * 20;
      e.inkCooldown -= dt;
      if (e.inkCooldown <= 0 && e.x < W - 30) {
        e.inkCooldown = 2.2 + Math.random() * 1.4;
        spawnInk(e.x - e.r, e.y);
      }
    } else if (e.type === 'angler') {
      // 潜航パート専用。普段は擬態していて、近づくと本体を現して襲ってくる
      e.t += dt;
      if (e.phase === 'lurk') {
        e.y += e.vy * dt;
        e.x = e.baseX + Math.sin(e.t * 1.1) * 10;
        if (dist(e.x, e.y, player.x, player.y) < 130) {
          e.phase = 'chase';
          const dx = player.x - e.x;
          const dy = player.y - e.y;
          const len = Math.max(1, Math.hypot(dx, dy));
          const speed = 300;
          e.vx = (dx / len) * speed;
          e.vy = (dy / len) * speed;
        }
      } else {
        e.x += e.vx * dt;
        e.y += e.vy * dt;
      }
    }
  }

  // ---------- 撃破・被弾の見た目のフィードバック ----------
  // 破片の色は敵の見た目に合わせる
  const ENEMY_BURST_COLORS = {
    straight: '#c0304a',  // ピラニア
    sine: '#b9932f',      // 毒クラゲ
    riser: '#b9932f',
    shooter: '#8f3d16',   // ウニ
    marlin: '#35618f',    // カジキ
    moray: '#5c8f56',     // ウツボ
    puffer: '#e8c46b',    // フグ
    octopus: '#8e4bb0',   // タコ
    angler: '#2b2036'     // チョウチンアンコウ
  };

  let particles = [];
  let shakeT = 0;      // 残り時間
  let shakeMag = 0;    // 揺れ幅(px)

  // 破片を放射状に散らす
  function spawnBurst(x, y, color, count, speed, size) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.35 + Math.random() * 0.65);
      const life = 0.28 + Math.random() * 0.34;
      particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life, maxLife: life,
        size: size * (0.5 + Math.random() * 0.8),
        color
      });
    }
  }

  function shakeScreen(mag, dur) {
    // 連続被弾で揺れが増幅しすぎないよう、強い方を採用する
    shakeMag = Math.max(shakeMag, mag);
    shakeT = Math.max(shakeT, dur);
  }

  function updateEffects(dt) {
    for (const e of enemies) {
      if (e.flash > 0) e.flash -= dt;
    }
    if (boss && boss.flash > 0) boss.flash -= dt;
    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.94;   // 水中なので減速させる
      p.vy *= 0.94;
      p.life -= dt;
    }
    particles = particles.filter(p => p.life > 0);
    if (shakeT > 0) {
      shakeT -= dt;
      if (shakeT <= 0) shakeMag = 0;
    }
  }

  function drawParticles() {
    for (const p of particles) {
      const k = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = k;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.4 + k * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ダメージを受けた敵・ボスを一瞬光らせる（形を問わず使えるよう加算合成の光を重ねる）
  function drawHitFlash(o) {
    if (!o.flash || o.flash <= 0) return;
    const k = Math.min(1, o.flash / 0.12);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = k * 0.75;
    const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r * 1.25);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(o.x, o.y, o.r * 1.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ---------- タコの墨（視界を奪うだけでダメージはない） ----------
  let inkClouds = [];

  function spawnInk(x, y) {
    inkClouds.push({
      // タコ本体(-80)より速く左へ流し、墨に隠れて本体が見えなくならないようにする
      x, y, vx: -128,
      r: 24, maxR: 74 + Math.random() * 24,
      life: 4.0, maxLife: 4.0,
      seed: Math.random() * Math.PI * 2
    });
  }

  function updateInk(dt) {
    for (const c of inkClouds) {
      c.x += c.vx * dt;
      c.y += Math.sin(c.seed + c.life * 1.2) * 6 * dt;
      c.r = Math.min(c.maxR, c.r + 26 * dt);
      c.life -= dt;
    }
    inkClouds = inkClouds.filter(c => c.life > 0 && c.x > -c.maxR * 1.4);
  }

  // ---------- 火山 ----------
  // 海底の山の一部が火山になっており、地形と一緒に流れてくる（画面端に固定はされない）
  const VOLCANO_TRIGGER_KILLS = 14;
  const VOLCANO_MOUNTAIN_CHANCE = 0.9;   // 山のうち火山になる割合（次々に流れてくるよう高めにする）
  let volcanoActive = false;             // 撃破数の条件を満たして噴火が始まったか
  let volcanoTimers = new Map();         // periodIndex -> 次の噴火までの秒数

  function resetVolcanoes() {
    volcanoActive = false;
    volcanoTimers.clear();
  }

  // 画面に写っている火山を列挙する
  function visibleVolcanoes() {
    const list = [];
    const first = Math.floor(terrainOffset / TERRAIN_PERIOD) - 1;
    const last = Math.floor((terrainOffset + W) / TERRAIN_PERIOD) + 1;
    for (let i = first; i <= last; i++) {
      const m = mountainAt(i);
      if (!m || !m.isVolcano) continue;
      const screenX = m.center - terrainOffset;
      if (screenX < -60 || screenX > W + 60) continue;
      list.push({ periodIndex: i, x: screenX, y: terrainSurfaceY(screenX) });
    }
    return list;
  }

  function updateVolcanoes(dt) {
    if (!volcanoActive) return;
    const onScreen = new Set();
    for (const v of visibleVolcanoes()) {
      onScreen.add(v.periodIndex);
      let t = volcanoTimers.get(v.periodIndex);
      if (t === undefined) t = 0.3 + Math.random() * 0.7;
      t -= dt;
      if (t <= 0) {
        t = 0.6 + Math.random() * 1.0;
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.95;
        const speed = 190 + Math.random() * 230;
        spawnEnemyBullet(
          v.x, v.y - 10,
          Math.cos(angle) * speed, Math.sin(angle) * speed,
          { r: 8, lava: true }
        );
      }
      volcanoTimers.set(v.periodIndex, t);
    }
    // 画面外に出た火山のタイマーは破棄する
    for (const key of volcanoTimers.keys()) {
      if (!onScreen.has(key)) volcanoTimers.delete(key);
    }
  }

  // ---------- 沈没船の残骸帯 ----------
  // 海底の山の一部が船体の残骸になっており、火山と同じく地形と一緒に流れてくる。
  // 主な危険は「隙間を縫って進む」地形の通行難度そのもの。まれに崩落デブリが剥がれ落ちる
  const WRECKAGE_TRIGGER_KILLS = 14;
  const WRECKAGE_MOUNTAIN_CHANCE = 0.85;  // 山のうち残骸になる割合（頻出させて隙間を縫わせる）
  let wreckageActive = false;
  let wreckageTimers = new Map();         // periodIndex -> 次のデブリ剥離までの秒数

  function resetWreckage() {
    wreckageActive = false;
    wreckageTimers.clear();
  }

  // 画面に写っている残骸を列挙する
  function visibleWreckage() {
    const list = [];
    const first = Math.floor(terrainOffset / TERRAIN_PERIOD) - 1;
    const last = Math.floor((terrainOffset + W) / TERRAIN_PERIOD) + 1;
    for (let i = first; i <= last; i++) {
      const m = mountainAt(i);
      if (!m || !m.isWreckage) continue;
      const screenX = m.center - terrainOffset;
      if (screenX < -60 || screenX > W + 60) continue;
      list.push({ periodIndex: i, x: screenX, y: terrainSurfaceY(screenX) });
    }
    return list;
  }

  function updateWreckage(dt) {
    if (!wreckageActive) return;
    const onScreen = new Set();
    for (const w of visibleWreckage()) {
      onScreen.add(w.periodIndex);
      let t = wreckageTimers.get(w.periodIndex);
      if (t === undefined) t = 1.0 + Math.random() * 1.5;
      t -= dt;
      if (t <= 0) {
        t = 2.2 + Math.random() * 1.8;
        // 船体からデブリが剥がれ落ち、ゆっくり漂う（軽量な危険源）
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.5;
        const speed = 60 + Math.random() * 60;
        spawnEnemyBullet(
          w.x, w.y - 12,
          Math.cos(angle) * speed, Math.sin(angle) * speed,
          { r: 6 + Math.random() * 4, kind: 'debris' }
        );
      }
      wreckageTimers.set(w.periodIndex, t);
    }
    for (const key of wreckageTimers.keys()) {
      if (!onScreen.has(key)) wreckageTimers.delete(key);
    }
  }

  // ---------- 渦（hazard='whirlpool'のステージで火山の代わりに出現する） ----------
  let whirlpools = [];
  let whirlpoolActive = false;        // 撃破数の条件を満たして渦が発生し始めたか
  let whirlpoolSpawnTimer = 0;
  const WHIRLPOOL_TRIGGER_KILLS = 14;
  const WHIRLPOOL_SPIN_SPEED = 3.6;   // 捕まっている間の回転角速度(rad/s)
  const WHIRLPOOL_SINK_SPEED = 76;    // 下へ引きずり込まれる速さ(px/s)
  const WHIRLPOOL_DEPTH = 210;        // 漏斗の深さ（基準値）

  function resetWhirlpools() {
    whirlpools = [];
    whirlpoolActive = false;
    whirlpoolSpawnTimer = 0;
    player.caught = false;
  }

  // 大きさ・深さ・速さ・高さをばらつかせて次々に流す
  function spawnWhirlpool() {
    whirlpools.push({
      x: W + 120,
      y: playH * 0.14 + Math.random() * playH * 0.24,  // 漏斗の口（上端）
      r: 68 + Math.random() * 30,
      depth: WHIRLPOOL_DEPTH * (0.85 + Math.random() * 0.35),
      vx: -(40 + Math.random() * 20),
      t: Math.random() * Math.PI * 2
    });
  }

  // 漏斗の底（海底に埋まらないよう手前で止める）
  function whirlpoolBottomY(wp) {
    return Math.min(wp.y + wp.depth, terrainSurfaceY(wp.x) - 30);
  }

  // 深さに応じた漏斗の半径（下へ行くほど絞られる）
  function whirlpoolRadiusAt(wp, y) {
    const bottom = whirlpoolBottomY(wp);
    const u = Math.max(0, Math.min(1, (y - wp.y) / Math.max(1, bottom - wp.y)));
    return wp.r * (1 - u * 0.78);
  }

  function updateWhirlpools(dt) {
    if (whirlpoolActive) {
      whirlpoolSpawnTimer -= dt;
      if (whirlpoolSpawnTimer <= 0) {
        whirlpoolSpawnTimer = 4.5 + Math.random() * 2.5;
        spawnWhirlpool();
      }
    }
    for (const wp of whirlpools) {
      wp.t += dt;
      wp.x += wp.vx * dt;
    }
    whirlpools = whirlpools.filter(wp => wp.x > -wp.r * 1.6);
  }

  // 自機を巻き込んでいる渦を返す（複数あっても最初に捕まえた1つだけが効く）
  function whirlpoolCatching() {
    for (const wp of whirlpools) {
      const bottom = whirlpoolBottomY(wp);
      // 漏斗の内側（上端より少し上から底まで）にいるときだけ捕まる
      if (player.y < wp.y - 24 || player.y > bottom + 12) continue;
      if (Math.abs(player.x - wp.x) > whirlpoolRadiusAt(wp, player.y) + 14) continue;
      return wp;
    }
    return null;
  }

  // 渦に入っている間は操作を奪い、回転させながら下へ引きずり込む
  function applyWhirlpool(dt) {
    const wp = whirlpoolCatching();
    if (!wp) {
      player.caught = false;
      return false;
    }

    player.caught = true;
    // 縦軸のまわりを回りながら沈んでいく
    const bottom = whirlpoolBottomY(wp);
    const newY = Math.min(bottom, Math.max(wp.y, player.y) + WHIRLPOOL_SINK_SPEED * dt);
    const angle = wp.t * WHIRLPOOL_SPIN_SPEED;
    player.y = newY;
    player.x = wp.x + Math.cos(angle) * whirlpoolRadiusAt(wp, newY);
    player.spin += WHIRLPOOL_SPIN_SPEED * dt;
    return true;
  }

  // ---------- 潜航ステージの進行 ----------
  function resetDive() {
    diveMode = 'none';
    diveHole = null;
    diveDepth = 0;
    deepTimer = 0;
  }

  function updateDive(dt) {
    if (diveMode === 'none') {
      if (killCount >= DIVE_TRIGGER_KILLS) {
        // 画面の右外から大穴が近づいてくる
        diveHole = { start: terrainOffset + W + 240 };
        diveMode = 'opening';
        stageBannerTimer = 2.2;
        stageBannerText = 'THE ABYSS';
      }
      return;
    }

    if (diveMode === 'opening') {
      // 画面全体が大穴の上に来たら縦スクロールへ切り替える
      if (terrainOffset > diveHole.start + 60) {
        diveMode = 'diving';
        diveDepth = 0;
        enemies = [];
        enemyBullets = [];
        spawnTimer = 1.2;
        // 切り替えた瞬間に岩壁へめり込んで被弾しないよう、縦穴の中央へ移す
        player.x = W / 2;
        player.y = playH * 0.36;
        player.invuln = Math.max(player.invuln, 1.2);
        stageBannerTimer = 2.0;
        stageBannerText = 'DIVE!';
      }
      return;
    }

    if (diveMode === 'diving') {
      diveDepth += DIVE_SPEED * dt;
      // 縦穴の底まで潜りきったら、深海を進む横スクロールへ戻す
      if (diveDepth >= DIVE_BOTTOM_DEPTH) {
        diveMode = 'deep';
        deepTimer = DEEP_BOSS_DELAY;
        diveHole = null;          // 海底が戻る
        enemies = [];
        enemyBullets = [];
        spawnTimer = 1.2;
        // 横スクロール時の定位置へ戻し、地形にめり込まないようにする
        player.x = Math.max(60, W * 0.15);
        player.y = playH / 2;
        player.spin = 0;
        player.invuln = Math.max(player.invuln, 1.2);
        stageBannerTimer = 2.2;
        stageBannerText = 'SEA FLOOR';
      }
      return;
    }

    // deep: 深海を横スクロール。少し進むとボスが現れる
    if (deepTimer > 0) deepTimer -= dt;
  }

  // 潜航中に下から浮上してくる敵
  function spawnDiveEnemy() {
    const margin = 46;
    const x = margin + Math.random() * (W - margin * 2);
    // 3回に1回はチョウチンアンコウ（擬態して待ち構える）
    if (Math.random() < 0.34) {
      enemies.push({
        type: 'angler',
        x, baseX: x,
        y: playH + 30,
        vx: 0, vy: -(52 + Math.random() * 26),
        t: Math.random() * Math.PI * 2,
        r: 16, hp: 2, score: 40,
        phase: 'lurk'
      });
      return;
    }
    enemies.push({
      type: 'riser',
      x, baseX: x,
      y: playH + 30,
      vy: -(120 + Math.random() * 70),
      t: Math.random() * Math.PI * 2,
      amp: 18 + Math.random() * 26,
      freq: 1.4 + Math.random(),
      r: 14, hp: 1, score: 20
    });
  }

  // ---------- ボス ----------
  let boss = null;

  const BOSS_FIRE_SPREAD = {
    shark: [-60, 0, 60],
    crab: [-90, -30, 30, 90]
  };
  // サメの3方向弾の角度（正面＝左からのずれ。約±30度）
  const SHARK_FIRE_ANGLES = [-0.52, 0, 0.52];

  function spawnBoss() {
    // ここ以降に力尽きたらボス戦から再開する
    checkpointAtBoss = true;
    SFX.bossAppear();
    const def = STAGES[currentStage - 1].bosses[bossIndex];
    const baseX = W - 140;
    boss = {
      kind: def.kind,
      variant: def.variant || 'normal',
      x: W + 80,
      baseX,
      y: playH / 2,
      r: 46,
      hp: def.hp,
      maxHp: def.hp,
      t: 0,
      fireCooldown: 1.0,
      lunging: false,
      lungeT: 0,
      lungeTimer: 2.5 + Math.random() * 1.5,
      entering: true,
      enterT: 0,
      tentacleCooldown: 2.5,
      tentacleActive: false,
      tentacleT: 0,
      tentacleIndex: 0,
      tentacleTargetX: 0,
      tentacleTargetY: 0,
      chargeCooldown: 3.0,
      chargePhase: 'none',
      chargeT: 0,
      chargeY: 0,
      returnFrom: 0,
      jawExtend: 0,   // ゴブリンシャーク専用: 突進時に顎が飛び出る演出用(0→1)
      punchCooldown: 2.2,
      punchPhase: 'none',
      punchT: 0,
      slamCooldown: 2.6,
      slamPhase: 'none',
      slamT: 0,
      slamXs: [],
      ghostInkCooldown: 2.0
    };
    enemies = [];
    enemyBullets = [];
    inkClouds = [];
    resetWhirlpools();
  }

  function squidTentacleTip(b) {
    const R = b.r;
    const baseY = b.tentacleIndex * R * 0.16;
    const attachX = b.x - R * 0.55;
    const attachY = b.y + baseY * 0.4;
    const reach = Math.sin(Math.min(1, b.tentacleT) * Math.PI);
    return {
      x: attachX + (b.tentacleTargetX - attachX) * reach,
      y: attachY + (b.tentacleTargetY - attachY) * reach,
      reach
    };
  }

  // シャコパンチ: 溜めてから正面（左）へ衝撃波を1回撃つ。通常の遊泳とは並行して進む
  const MANTIS_PUNCH_AIM = 0.55;      // 溜めの時間
  const MANTIS_PUNCH_RECOVER = 0.4;   // 打った後の硬直
  const MANTIS_SHOCKWAVE_SPEED = 480;

  function updateMantisPunch(dt) {
    if (boss.punchPhase === 'none') {
      boss.punchCooldown -= dt;
      if (boss.punchCooldown <= 0) {
        boss.punchPhase = 'aim';
        boss.punchT = 0;
        SFX.sharkCharge();   // 溜め音を流用
      }
      return;
    }
    if (boss.punchPhase === 'aim') {
      boss.punchT += dt / MANTIS_PUNCH_AIM;
      if (boss.punchT >= 1) {
        boss.punchPhase = 'punch';
        boss.punchT = 0;
        SFX.sharkBite();   // 打撃音を流用
        // 縦に並んだ衝撃波の帯を正面へ放つ
        const n = 5;
        for (let i = 0; i < n; i++) {
          const oy = (i - (n - 1) / 2) * 20;
          spawnEnemyBullet(
            boss.x - boss.r * 0.8, boss.y + oy,
            -MANTIS_SHOCKWAVE_SPEED, 0,
            { r: 10, kind: 'shockwave' }
          );
        }
      }
      return;
    }
    if (boss.punchPhase === 'punch') {
      boss.punchT += dt / MANTIS_PUNCH_RECOVER;
      if (boss.punchT >= 1) {
        boss.punchPhase = 'none';
        boss.punchT = 0;
        boss.punchCooldown = 3.4 + Math.random() * 1.8;
      }
    }
  }

  // 幽霊船の主（巨大タコ）の触腕叩きつけ: 複数本を画面下から同時に突き上げる。
  // イカの単発追尾とは違い、叩きつけどころは事前に決め打ちして予告する
  const GHOST_SLAM_TELEGRAPH = 0.6;
  const GHOST_SLAM_COUNT = 2;
  const GHOST_SLAM_SEGMENTS = 5;   // 1本のタコ足を表す弾の数

  function updateGhostOctopusSlam(dt) {
    if (boss.slamPhase === 'none') {
      boss.slamCooldown -= dt;
      if (boss.slamCooldown <= 0) {
        boss.slamPhase = 'telegraph';
        boss.slamT = 0;
        boss.slamXs = [];
        for (let i = 0; i < GHOST_SLAM_COUNT; i++) {
          boss.slamXs.push(30 + Math.random() * (W - 60));
        }
      }
      return;
    }
    if (boss.slamPhase === 'telegraph') {
      boss.slamT += dt / GHOST_SLAM_TELEGRAPH;
      if (boss.slamT >= 1) {
        boss.slamPhase = 'none';
        boss.slamT = 0;
        boss.slamCooldown = 3.6 + Math.random() * 2.0;
        SFX.sharkBite();   // 突き上げの衝撃音を流用
        for (const sx of boss.slamXs) {
          for (let i = 0; i < GHOST_SLAM_SEGMENTS; i++) {
            spawnEnemyBullet(
              sx, playH + 20 + i * 22,
              0, -420,
              { r: 9, kind: 'tentacleslam' }
            );
          }
        }
      }
    }
  }

  // サメの噛みつき突進。突進中はtrueを返し、通常の遊泳・射撃を止める
  const SHARK_CHARGE_AIM = 0.85;    // 溜めの時間
  const SHARK_CHARGE_SPEED = 900;   // 突進速度(px/s)
  // 突進はここまでしか進まない。左端に張り付いた自機に届かない位置で止め、
  // 画面左側を安全地帯として残す
  const SHARK_CHARGE_SAFE_BAND = 26;   // 安全地帯の幅(px)

  function sharkChargeStopX() {
    return playerMinX() + player.hitRadius + boss.r + SHARK_CHARGE_SAFE_BAND;
  }

  function updateSharkCharge(dt) {
    if (boss.chargePhase === 'none') {
      boss.chargeCooldown -= dt;
      if (boss.chargeCooldown <= 0) {
        boss.chargePhase = 'aim';
        boss.chargeT = 0;
        boss.chargeY = player.y;   // この瞬間の高さに狙いを固定する
        SFX.sharkCharge();
      }
      return false;
    }

    if (boss.chargePhase === 'aim') {
      // 後ろに引いて溜めつつ、自機の高さへ鼻先を合わせる
      boss.chargeT += dt / SHARK_CHARGE_AIM;
      const t = Math.min(1, boss.chargeT);
      boss.x = boss.baseX + Math.sin(t * Math.PI) * 26;
      boss.y += (boss.chargeY - boss.y) * Math.min(1, dt * 5);
      if (t >= 1) {
        boss.chargePhase = 'run';
        boss.jawExtend = 1;   // ゴブリンシャークは噛みつき時に顎を飛び出させる
        SFX.sharkBite();
      }
      return true;
    }

    if (boss.chargePhase === 'run') {
      // 左へ突進するが、画面左端までは行かない。
      // 左端の手前を安全地帯として残し、逃げ場がなくならないようにする
      boss.x -= SHARK_CHARGE_SPEED * dt;
      if (boss.x <= sharkChargeStopX()) {
        boss.x = sharkChargeStopX();
        boss.chargePhase = 'back';
        boss.chargeT = 0;
        boss.returnFrom = boss.x;
      }
      return true;
    }

    // back: 反転して定位置へ泳いで戻る（右向き）。顎もゆっくり引っ込める
    boss.chargeT += dt / 1.6;
    const t = Math.min(1, boss.chargeT);
    const eased = 1 - Math.pow(1 - t, 3);
    const from = boss.returnFrom;
    boss.x = from + (boss.baseX - from) * eased;
    boss.jawExtend = Math.max(0, 1 - t * 1.4);
    if (t >= 1) {
      boss.chargePhase = 'none';
      boss.x = boss.baseX;
      boss.jawExtend = 0;
      // 通常の上下運動へ戻る際にyが飛ばないよう、今の高さに合う位相からtを再開する
      const s = Math.max(-1, Math.min(1, (boss.y - playH / 2) / (playH * 0.28)));
      boss.t = Math.asin(s) / 0.8;
      boss.chargeCooldown = 4.5 + Math.random() * 2.5;
    }
    return true;
  }

  function updateBoss(dt) {
    if (!boss) return;
    boss.t += dt;

    // 画面後方から自然に泳いで登場する
    if (boss.entering) {
      boss.enterT += dt / 1.4;
      const t = Math.min(1, boss.enterT);
      const eased = 1 - Math.pow(1 - t, 3);
      boss.x = (W + 80) + (boss.baseX - (W + 80)) * eased;
      boss.y = playH / 2;
      if (t >= 1) {
        boss.entering = false;
        boss.x = boss.baseX;
        // 登場中に進んでいたtをリセットし、上下運動をy=playH/2から滑らかに始める
        // （リセットしないと sin(boss.t*0.8) が既に大きく進んでいて、この瞬間にyが飛ぶ）
        boss.t = 0;
      }
      return;
    }

    // ゴブリンシャークの固有攻撃: 狙いを定めてから画面を横断する噛みつき突進
    if (boss.kind === 'goblinshark' && updateSharkCharge(dt)) return;

    boss.y = playH / 2 + Math.sin(boss.t * 0.8) * (playH * 0.28);

    // 前方への突進（ブロック崩しのボスが突っ込んでくる動きと同じ考え方）
    if (boss.lunging) {
      boss.lungeT += dt / 0.9;
      if (boss.lungeT >= 1) {
        boss.lunging = false;
        boss.lungeT = 0;
        boss.lungeTimer = 3.5 + Math.random() * 2.5;
      }
    } else {
      boss.lungeTimer -= dt;
      if (boss.lungeTimer <= 0) {
        boss.lunging = true;
        boss.lungeT = 0;
      }
    }
    const lungeDepth = boss.baseX - 100;
    const lungeOffset = boss.lunging ? Math.sin(boss.lungeT * Math.PI) * lungeDepth : 0;
    boss.x = boss.baseX - lungeOffset;

    // 海底に見た目上埋まらないよう浮上させる（当たり判定はなし。縦穴には海底がないので対象外）
    if (diveMode !== 'diving') {
      boss.y = Math.min(boss.y, terrainSurfaceY(boss.x) - boss.r);
    }

    // イカの触腕を伸ばす攻撃
    if (boss.kind === 'squid') {
      if (boss.tentacleActive) {
        boss.tentacleT += dt / 0.9;
        if (boss.tentacleT >= 1) {
          boss.tentacleActive = false;
          boss.tentacleT = 0;
          // 5面の強化再戦(enraged)は触腕の間隔も詰める
          const base = boss.variant === 'enraged' ? 1.8 : 3.2;
          boss.tentacleCooldown = base + Math.random() * 1.8;
        }
      } else {
        boss.tentacleCooldown -= dt;
        if (boss.tentacleCooldown <= 0) {
          boss.tentacleActive = true;
          boss.tentacleT = 0;
          boss.tentacleIndex = Math.floor(Math.random() * 7) - 3;
          boss.tentacleTargetX = player.x;
          boss.tentacleTargetY = player.y;
        }
      }
    }

    // シャコの固有攻撃: 溜めてから正面へ衝撃波（シャコパンチ）
    if (boss.kind === 'mantis') updateMantisPunch(dt);

    // 幽霊船の主の固有攻撃: 触腕叩きつけ＋墨
    if (boss.kind === 'ghostoctopus') {
      updateGhostOctopusSlam(dt);
      boss.ghostInkCooldown -= dt;
      if (boss.ghostInkCooldown <= 0) {
        boss.ghostInkCooldown = 3.5 + Math.random() * 1.5;
        spawnInk(boss.x - boss.r, boss.y);
      }
    }

    boss.fireCooldown -= dt;
    if (boss.fireCooldown <= 0) {
      if (boss.kind === 'squid') {
        // 5面の強化再戦(enraged)は弾数を増やし、間隔も詰める
        const enraged = boss.variant === 'enraged';
        boss.fireCooldown = enraged ? 0.8 : 1.1;
        const n = enraged ? 12 : 8;
        const speed = enraged ? 210 : 180;
        for (let i = 0; i < n; i++) {
          const a = (Math.PI * 2 * i) / n + boss.t;
          spawnEnemyBullet(boss.x, boss.y, Math.cos(a) * speed, Math.sin(a) * speed);
        }
      } else if (boss.kind === 'crab') {
        boss.fireCooldown = 1.0;
        const speed = 150;
        const offsets = BOSS_FIRE_SPREAD.crab;
        for (const dyOff of offsets) {
          const dx = player.x - boss.x;
          const dy = (player.y - boss.y) + dyOff;
          const len = Math.max(1, Math.hypot(dx, dy));
          spawnEnemyBullet(
            boss.x, boss.y,
            (dx / len) * speed, (dy / len) * speed - 20,
            { r: 7 + Math.random() * 4, kind: 'bubble' }
          );
        }
      } else if (boss.kind === 'goblinshark') {
        // ゴブリンシャークは自機を狙わず、正面（左）と斜め上下の固定3方向へ撃つ。
        // 狙い撃ちは反応し続けることを強制するが、固定角度なら位置取りで避けられる
        boss.fireCooldown = 1.6;
        const speed = 220;
        for (const a of SHARK_FIRE_ANGLES) {
          const ang = Math.PI + a;   // Math.PI = 左向き
          spawnEnemyBullet(boss.x, boss.y, Math.cos(ang) * speed, Math.sin(ang) * speed);
        }
      } else if (boss.kind === 'mantis') {
        // シャコパンチが主な脅威なので、通常弾は狙い撃ちの単発だけに抑える
        boss.fireCooldown = 1.4;
        const speed = 210;
        const dx = player.x - boss.x;
        const dy = player.y - boss.y;
        const len = Math.max(1, Math.hypot(dx, dy));
        spawnEnemyBullet(boss.x, boss.y, (dx / len) * speed, (dy / len) * speed);
      } else if (boss.kind === 'ghostoctopus') {
        // 触腕叩きつけ＋墨が主な脅威なので、通常弾も狙い撃ちの単発だけに抑える
        boss.fireCooldown = 1.8;
        const speed = 190;
        const dx = player.x - boss.x;
        const dy = player.y - boss.y;
        const len = Math.max(1, Math.hypot(dx, dy));
        spawnEnemyBullet(boss.x, boss.y, (dx / len) * speed, (dy / len) * speed, { r: 6 });
      } else {
        boss.fireCooldown = 0.9;
        const speed = 220;
        const offsets = BOSS_FIRE_SPREAD[boss.kind] || BOSS_FIRE_SPREAD.shark;
        for (const dyOff of offsets) {
          const dx = player.x - boss.x;
          const dy = (player.y - boss.y) + dyOff;
          const len = Math.max(1, Math.hypot(dx, dy));
          spawnEnemyBullet(boss.x, boss.y, (dx / len) * speed, (dy / len) * speed);
        }
      }
    }
  }

  // ---------- アイテム ----------
  let items = [];
  const ITEM_DROP_CHANCE = 0.22;
  // ボス戦中は数が少ないぶんドロップしやすくして、確実に補給できるようにする
  const ITEM_DROP_CHANCE_BOSS = 0.55;
  const SHIELD_MAX_HITS = 2;  // バリアが耐えられる被弾回数
  const BULLET_ITEM_TYPES = ['spread', 'homing', 'pierce', 'wide', 'torpedo'];
  const ITEM_TYPES = [...BULLET_ITEM_TYPES, 'rapid', 'speed', 'shield', 'heal', 'escort'];

  function spawnItem(x, y) {
    const type = ITEM_TYPES[Math.floor(Math.random() * ITEM_TYPES.length)];
    items.push({ x, y, type, vx: -70, r: 12 });
  }

  function applyItem(type) {
    if (BULLET_ITEM_TYPES.includes(type)) {
      player.bulletType = type;
    } else if (type === 'rapid') {
      player.rapidFire = true;
    } else if (type === 'speed') {
      player.speedBoost = true;
    } else if (type === 'shield') {
      player.shieldHp = SHIELD_MAX_HITS;
    } else if (type === 'heal') {
      lives = Math.min(lives + 1, MAX_LIVES);
    } else if (type === 'escort') {
      spawnEscort();
    }
  }

  // ---------- 味方の小型潜水艦（護衛機） ----------
  let escorts = [];
  const ESCORT_MAX = 2;
  const ESCORT_FIRE_INTERVAL = 0.55;

  function spawnEscort() {
    if (escorts.length >= ESCORT_MAX) return;
    // 1機目はランダムな側、2機目は反対側に付ける
    const slot = escorts.length === 0
      ? (Math.random() < 0.5 ? -1 : 1)
      : -escorts[0].slot;
    escorts.push({
      x: player.x, y: player.y + slot * 40,
      slot, size: 11, hitRadius: 9,
      fireCooldown: Math.random() * ESCORT_FIRE_INTERVAL,
      t: 0
    });
  }

  function updateEscorts(dt) {
    for (const e of escorts) {
      e.t += dt;
      // 追従目標（潜航中は左右に、通常時は上下に並ぶ）
      const wobble = Math.sin(e.t * 2.2) * 4;
      const tx = diveMode === 'diving' ? player.x + e.slot * 40 + wobble : player.x - 26;
      const ty = diveMode === 'diving' ? player.y - 26 : player.y + e.slot * 40 + wobble;
      const k = Math.min(1, dt * 5.5);
      e.x += (tx - e.x) * k;
      e.y += (ty - e.y) * k;

      e.fireCooldown -= dt;
      if (e.fireCooldown <= 0) {
        e.fireCooldown = ESCORT_FIRE_INTERVAL;
        const aim = diveMode === 'diving' ? Math.PI / 2 : 0;
        playerBullets.push({
          x: e.x + Math.cos(aim) * e.size,
          y: e.y + Math.sin(aim) * e.size,
          vx: Math.cos(aim) * BULLET_SPEED * 0.95,
          vy: Math.sin(aim) * BULLET_SPEED * 0.95,
          r: 3, type: 'escort'
        });
      }
    }
  }

  function updateItems(dt) {
    for (const it of items) it.x += it.vx * dt;
    items = items.filter(it => it.x > -30);

    for (const it of items) {
      if (dist(it.x, it.y, player.x, player.y) < it.r + player.hitRadius) {
        it.picked = true;
        applyItem(it.type);
        SFX.item();
      }
    }
    items = items.filter(it => !it.picked);
  }

  // ---------- 衝突判定 ----------
  function dist(ax, ay, bx, by) {
    return Math.hypot(ax - bx, ay - by);
  }

  function hitPlayer() {
    if (DEBUG && debugInvincible) return;
    if (player.invuln > 0) return;
    if (player.shieldHp > 0) {
      // バリアは規定回数ぶん被弾を肩代わりし、尽きた時だけ消滅演出を出す
      player.shieldHp -= 1;
      player.invuln = 0.6;
      shakeScreen(3, 0.18);
      SFX.shieldOff();
      if (player.shieldHp === 0) player.shieldPopTimer = 0.4;
      return;
    }
    lives -= 1;
    player.invuln = 1.5;
    spawnBurst(player.x, player.y, '#9fe6ff', 16, 240, 4);
    shakeScreen(7, 0.34);
    SFX.hit();
    if (lives <= 0) {
      state = continuesLeft > 0 ? STATE_CONTINUE : STATE_GAMEOVER;
      if (state === STATE_GAMEOVER) saveHighScore();
      SFX.gameOver();
    }
  }

  // 進行中のものを一掃して、その場から仕切り直せる状態にする
  function clearField() {
    enemies = [];
    playerBullets = [];
    enemyBullets = [];
    items = [];
    escorts = [];
    inkClouds = [];
    particles = [];
    shakeT = 0;
    shakeMag = 0;
    resetWhirlpools();
    boss = null;
    spawnTimer = 1.2;
    playerBubbles = [];
    playerBubbleTimer = 0;
  }

  // ---------- エンディング ----------
  const ENDING_TEXT_DELAY = 1.8;   // 浮上演出のあと文字が出るまで
  const ENDING_TAP_DELAY = 3.2;    // タップを受け付けるまで

  function startEnding() {
    state = STATE_ENDING;
    endingT = 0;
    clearField();
    player.spin = 0;
    saveHighScore();
    SFX.clear();
  }

  function updateEnding(dt) {
    endingT += dt;
    // 任務を終えた潜水艦がゆっくり浮上していく
    player.y -= 34 * dt;
    player.x += 12 * dt;
    updatePlayerBubbles(dt);
  }

  function formatTime(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function drawEnding() {
    // 海面へ近づくにつれて明るくなる
    const light = Math.min(0.55, endingT / 7);
    ctx.fillStyle = `rgba(180,235,255,${light})`;
    ctx.fillRect(0, 0, W, playH);

    drawPlayerBubbles();
    if (player.y > -40) drawPlayer();

    if (endingT < ENDING_TEXT_DELAY) return;

    const fade = Math.min(1, (endingT - ENDING_TEXT_DELAY) / 1.2);
    const slide = (1 - fade) * 26;
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, W, H);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let y = H * 0.26 + slide;

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 30px sans-serif';
    ctx.fillText('ALL CLEAR!', W / 2, y);
    y += 34;
    ctx.fillStyle = '#9fe6ff';
    ctx.font = '15px sans-serif';
    ctx.fillText('深海の脅威は去った', W / 2, y);
    y += 30;
    if (newRecord) {
      ctx.fillStyle = '#ffd76a';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText('NEW RECORD!', W / 2, y);
    }
    y += 30;

    // 戦績
    const rows = [
      ['SCORE', `${score}`],
      ['BEST', `${highScore}`],
      ['TIME', formatTime(elapsed)],
      ['撃破数', `${totalKills}`],
      ['コンティニュー', `${CONTINUE_MAX - continuesLeft} / ${CONTINUE_MAX}`]
    ];
    ctx.font = '15px sans-serif';
    for (const [label, value] of rows) {
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText(label, W / 2 - 10, y);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#fff';
      ctx.fillText(value, W / 2 + 14, y);
      y += 26;
    }

    ctx.textAlign = 'center';
    y += 18;
    ctx.fillStyle = '#ffd76a';
    ctx.font = '14px sans-serif';
    ctx.fillText('Thanks for playing!', W / 2, y);

    if (endingT > ENDING_TAP_DELAY) {
      const blink = 0.55 + 0.45 * Math.sin(endingT * 3);
      ctx.fillStyle = `rgba(255,255,255,${blink})`;
      ctx.font = '15px sans-serif';
      ctx.fillText('タップでタイトルへ', W / 2, playH * 0.9);
    }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
  }

  // コンティニュー。ボス戦で力尽きたならボス戦から、そうでなければそのステージの最初から
  function continueGame() {
    if (continuesLeft <= 0) return;
    continuesLeft -= 1;
    lives = 3;
    state = STATE_PLAYING;
    clearField();
    resetPlayer();

    if (checkpointAtBoss) {
      // ボスを出し直す（ステージ3の潜航後なら深海の横スクロールのまま再戦）
      stageBannerTimer = 2.0;
      stageBannerText = 'BOSS BATTLE';
      spawnBoss();
    } else {
      // ステージの最初からやり直す
      killCount = 0;
      bossIndex = 0;
      resetVolcanoes();
      resetWhirlpools();
      resetDive();
      resetWreckage();
      stageBannerTimer = 2.2;
      stageBannerText = `STAGE ${currentStage}`;
    }
  }

  // ---------- ゲーム開始/更新 ----------
  function startGame() {
    state = STATE_PLAYING;
    score = 0;
    newRecord = false;
    lives = 3;
    continuesLeft = CONTINUE_MAX;
    checkpointAtBoss = false;
    bossIndex = 0;
    totalKills = 0;
    endingT = 0;
    elapsed = 0;
    killCount = 0;
    enemies = [];
    playerBullets = [];
    enemyBullets = [];
    items = [];
    escorts = [];
    inkClouds = [];
    particles = [];
    shakeT = 0;
    shakeMag = 0;
    boss = null;
    bossArenaT = 0;
    resetVolcanoes();
    resetWhirlpools();
    resetDive();
    resetWreckage();
    spawnTimer = 0;
    terrainOffset = 0;
    currentStage = 1;
    stageBannerTimer = 0;
    playerBubbles = [];
    playerBubbleTimer = 0;
    initBubbles();
    resetPlayer();
  }

  function update(dt) {
    updateBubbles(dt);

    if (state === STATE_ENDING) {
      updateEnding(dt);
      return;
    }
    if (state !== STATE_PLAYING) return;

    updateTerrain(dt);
    updateBossArena(dt);

    elapsed += dt;
    if (player.invuln > 0) player.invuln -= dt;
    if (stageBannerTimer > 0) stageBannerTimer -= dt;
    if (player.shieldPopTimer > 0) player.shieldPopTimer -= dt;
    updatePlayerBubbles(dt);

    // 渦に捕まっている間は操作入力を無視する
    if (!applyWhirlpool(dt)) {
      const MOVE_SPEED = player.speedBoost ? MOVE_SPEED_BOOST : MOVE_SPEED_NORMAL;
      let mvx = 0, mvy = 0;
      if (controls.up) mvy -= 1;
      if (controls.down) mvy += 1;
      if (controls.left) mvx -= 1;
      if (controls.right) mvx += 1;
      if (mvx !== 0 || mvy !== 0) {
        const len = Math.hypot(mvx, mvy);
        player.x += (mvx / len) * MOVE_SPEED * dt;
        player.y += (mvy / len) * MOVE_SPEED * dt;
      }
      // 渦から解放されたら傾きを戻す
      if (player.spin !== 0) {
        const back = Math.sign(player.spin) * Math.min(Math.abs(player.spin), 8 * dt);
        player.spin -= back;
      }
    }
    player.y = Math.max(player.size, Math.min(playH - player.size, player.y));
    player.x = Math.max(playerMinX(), Math.min(playerMaxX(), player.x));

    // 地形との当たり判定（潜航中は縦穴の左右の岩壁、深海は天井もある）
    if (diveMode === 'diving') {
      if (collidesCave(player.x, player.y, player.hitRadius)) {
        hitPlayer();
        const l = caveLeftAt(player.y) + player.hitRadius;
        const r = caveRightAt(player.y) - player.hitRadius;
        player.x = Math.max(l, Math.min(r, player.x));
      }
    } else if (diveMode === 'deep' && collidesCeiling(player.x, player.y, player.hitRadius)) {
      hitPlayer();
      player.y = ceilingSurfaceY(player.x) + player.hitRadius;
    } else if (collidesTerrain(player.x, player.y, player.hitRadius)) {
      hitPlayer();
      player.y = terrainSurfaceY(player.x) - player.hitRadius;
    }

    player.fireCooldown -= dt;
    if (player.fireCooldown <= 0) {
      const interval = player.rapidFire ? RAPID_FIRE_INTERVAL : BASE_FIRE_INTERVAL;
      // 魚雷は一撃が重いぶん発射間隔が長い
      player.fireCooldown = interval * (player.bulletType === 'torpedo' ? TORPEDO_FIRE_MULT : 1);
      spawnPlayerBullet();
      SFX.shot();
    }

    for (const b of playerBullets) {
      if (b.homing) {
        // 索敵範囲内の敵にだけ、ゆるやかに曲がって追尾する（外すこともある）
        const target = findNearestTarget(b.x, b.y, HOMING_RANGE);
        if (target) {
          const desiredAngle = Math.atan2(target.y - b.y, target.x - b.x);
          const curAngle = Math.atan2(b.vy, b.vx);
          let diff = desiredAngle - curAngle;
          diff = Math.atan2(Math.sin(diff), Math.cos(diff));
          const maxTurn = HOMING_TURN_RATE * dt;
          const newAngle = curAngle + Math.max(-maxTurn, Math.min(maxTurn, diff));
          const speed = Math.hypot(b.vx, b.vy);
          b.vx = Math.cos(newAngle) * speed;
          b.vy = Math.sin(newAngle) * speed;
        }
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }
    playerBullets = playerBullets.filter(b =>
      b.x > -20 && b.x < W + 20 && b.y > -20 && b.y < playH + 20 && !collidesWorld(b.x, b.y, b.r)
    );

    for (const b of enemyBullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }
    enemyBullets = enemyBullets.filter(b =>
      b.x > -20 && b.x < W + 20 && b.y > -20 && b.y < playH + 20 && !collidesWorld(b.x, b.y, b.r)
    );

    if (!boss) {
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        if (diveMode === 'diving') {
          // 潜航中は深く潜るほど詰める
          const t = Math.min(1, diveDepth / DIVE_BOTTOM_DEPTH);
          spawnTimer = 0.95 - t * 0.3;
          spawnDiveEnemy();
        } else {
          spawnTimer = currentSpawnInterval();
          spawnEnemy();
        }
      }

      // ステージごとの障害（hazardで種類を切り替える）
      const hazard = STAGES[currentStage - 1].hazard;
      if (hazard === 'whirlpool') {
        if (!whirlpoolActive && killCount >= WHIRLPOOL_TRIGGER_KILLS) {
          whirlpoolActive = true;
          whirlpoolSpawnTimer = 0;
        }
      } else if (hazard === 'dive' || hazard === 'darkdive') {
        updateDive(dt);
      } else if (hazard === 'wreckage') {
        if (!wreckageActive && killCount >= WRECKAGE_TRIGGER_KILLS) {
          wreckageActive = true;
        }
      } else if (!volcanoActive && killCount >= VOLCANO_TRIGGER_KILLS) {
        volcanoActive = true;
      }
      updateVolcanoes(dt);
      updateWhirlpools(dt);
      updateWreckage(dt);

      // 潜航ステージでは撃破数ではなく、縦穴を抜けて深海を少し進むとボスが現れる
      if (hazard === 'dive' || hazard === 'darkdive') {
        if (diveMode === 'deep' && deepTimer <= 0) {
          spawnBoss();
        }
      } else if (killCount >= BOSS_KILL_THRESHOLD) {
        spawnBoss();
      }
    } else {
      updateBoss(dt);
      // ボス戦中も通常の敵を少しずつ出す。
      // コンティニュー直後はアイテムを失っているため、補給の機会がないとボスに勝てない
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawnTimer = BOSS_FIGHT_SPAWN_INTERVAL;
        spawnEnemy(BOSS_FIGHT_EXCLUDED);
      }
    }

    // 敵の更新はボス戦中も行う
    for (const e of enemies) updateEnemy(e, dt);
    enemies = enemies.filter(e =>
      e.x > -40 && e.y > -60 && e.y < playH + 80 &&
      // ウツボは海底に張り付いているので地形判定では消さない
      (e.type === 'moray' || !collidesWorld(e.x, e.y, e.r))
    );

    // 墨はボス戦中も流れ続ける
    updateInk(dt);
    updateEffects(dt);

    // 自機弾 vs 敵
    for (const e of enemies) {
      for (const b of playerBullets) {
        if (b.hit) continue;
        if (b.pierce) {
          b.hitSet = b.hitSet || new Set();
          if (b.hitSet.has(e)) continue;
        }
        if (dist(e.x, e.y, b.x, b.y) < e.r + b.r) {
          if (b.pierce) {
            b.hitSet.add(e);
          } else {
            b.hit = true;
          }
          e.hp -= b.dmg || 1;
          e.flash = 0.12;
        }
      }
    }
    for (const e of enemies) {
      if (e.hp <= 0 && !e.dead) {
        e.dead = true;
        score += e.score;
        killCount += 1;
        totalKills += 1;
        SFX.enemyKill();
        spawnBurst(e.x, e.y, ENEMY_BURST_COLORS[e.type] || '#ff8f6a', 10, 190, 3);
        // フグは倒すと全方位にトゲを撒き散らす
        if (e.type === 'puffer') {
          const n = 10;
          const speed = 190;
          for (let i = 0; i < n; i++) {
            const a = (Math.PI * 2 * i) / n + Math.random() * 0.2;
            spawnEnemyBullet(e.x, e.y, Math.cos(a) * speed, Math.sin(a) * speed, { r: 5, kind: 'spike' });
          }
        }
        const dropChance = boss ? ITEM_DROP_CHANCE_BOSS : ITEM_DROP_CHANCE;
        if (Math.random() < dropChance) spawnItem(e.x, e.y);
      }
    }
    enemies = enemies.filter(e => !e.dead);
    updateItems(dt);
    updateEscorts(dt);

    // 自機弾 vs ボス
    if (boss) {
      for (const b of playerBullets) {
        if (b.hit) continue;
        if (b.pierce) {
          b.hitSet = b.hitSet || new Set();
          if (b.hitSet.has(boss)) continue;
        }
        if (dist(boss.x, boss.y, b.x, b.y) < boss.r + b.r) {
          if (b.pierce) {
            b.hitSet.add(boss);
          } else {
            b.hit = true;
          }
          boss.hp -= b.dmg || 1;
          boss.flash = 0.12;
          SFX.bossHit();
        }
      }
      if (boss.hp <= 0) {
        const stageBosses = STAGES[currentStage - 1].bosses;
        score += stageBosses[bossIndex].score;
        spawnBurst(boss.x, boss.y, '#ffd166', 34, 320, 6);
        spawnBurst(boss.x, boss.y, '#ff6a4a', 22, 210, 5);
        shakeScreen(9, 0.5);
        boss = null;
        SFX.bossDown();
        if (bossIndex + 1 < stageBosses.length) {
          // 同じステージ内に次のボスが控えている（連戦）。
          // checkpointAtBossはtrueのまま維持し、コンティニュー時は連戦の1体目から再開する
          bossIndex += 1;
          stageBannerTimer = 2.2;
          stageBannerText = 'NEXT BOSS';
          SFX.stage();
        } else {
          // ボスを倒したので、次に力尽きたときはステージ最初からに戻す
          checkpointAtBoss = false;
          bossIndex = 0;
          if (currentStage < STAGES.length) {
            const prevHazard = STAGES[currentStage - 1].hazard;
            currentStage += 1;
            const nextHazard = STAGES[currentStage - 1].hazard;
            killCount = 0;
            resetVolcanoes();
            resetWhirlpools();
            // 4面→5面は同じ深海の続きなので、穴くぐりの潜航演出をやり直さない
            if (prevHazard === 'dive' && nextHazard === 'darkdive') {
              deepTimer = DEEP_BOSS_DELAY;
            } else {
              resetDive();
            }
            resetWreckage();
            spawnTimer = Math.max(spawnTimer, 1.2);
            stageBannerTimer = 2.2;
            stageBannerText = `STAGE ${currentStage}`;
            SFX.stage();
          } else {
            startEnding();
          }
        }
      }
    }
    playerBullets = playerBullets.filter(b => !b.hit);

    // 敵 vs 自機
    for (const e of enemies) {
      if (dist(e.x, e.y, player.x, player.y) < e.r + player.hitRadius) {
        e.dead = true;
        hitPlayer();
      }
    }
    enemies = enemies.filter(e => !e.dead);

    // 敵弾 vs 自機
    for (const b of enemyBullets) {
      if (dist(b.x, b.y, player.x, player.y) < b.r + player.hitRadius) {
        b.hit = true;
        hitPlayer();
      }
    }
    enemyBullets = enemyBullets.filter(b => !b.hit);

    // ボス vs 自機（体当たり）
    if (boss && dist(boss.x, boss.y, player.x, player.y) < boss.r + player.hitRadius) {
      hitPlayer();
    }

    // イカの触腕 vs 自機
    if (boss && boss.kind === 'squid' && boss.tentacleActive) {
      const tip = squidTentacleTip(boss);
      if (tip.reach > 0.5 && dist(tip.x, tip.y, player.x, player.y) < 14 + player.hitRadius) {
        hitPlayer();
      }
    }

    // 護衛機は被弾すると失われる（自機の盾としても機能する）
    if (escorts.length) {
      for (const e of escorts) {
        for (const b of enemyBullets) {
          if (b.hit) continue;
          if (dist(b.x, b.y, e.x, e.y) < b.r + e.hitRadius) {
            b.hit = true;
            e.dead = true;
          }
        }
        for (const en of enemies) {
          if (en.dead) continue;
          if (dist(en.x, en.y, e.x, e.y) < en.r + e.hitRadius) {
            en.dead = true;
            e.dead = true;
          }
        }
        if (boss && dist(boss.x, boss.y, e.x, e.y) < boss.r + e.hitRadius) {
          e.dead = true;
        }
      }
      enemyBullets = enemyBullets.filter(b => !b.hit);
      enemies = enemies.filter(en => !en.dead);
      escorts = escorts.filter(e => !e.dead);
    }
  }

  // ---------- 描画 ----------
  // 護衛機（自機のミニチュア版。味方と分かるよう緑寄りの色にする）
  function drawEscorts() {
    for (const e of escorts) {
      const s = e.size;
      const aim = diveMode === 'diving' ? Math.PI / 2 : 0;
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(aim);

      ctx.fillStyle = '#7ef0c0';
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 1.15, s * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      // 艦尾フィン
      ctx.beginPath();
      ctx.moveTo(-s * 1.05, -s * 0.15);
      ctx.lineTo(-s * 1.5, -s * 0.5);
      ctx.lineTo(-s * 0.85, -s * 0.05);
      ctx.closePath();
      ctx.fill();
      // セイル
      ctx.fillStyle = '#2fa583';
      roundRect(-s * 0.25, -s * 0.95, s * 0.5, s * 0.5, 3);
      ctx.fill();
      // 発射口
      roundRect(s * 0.8, -s * 0.18, s * 0.5, s * 0.36, 2);
      ctx.fill();
      // 舷窓
      ctx.fillStyle = '#eafff7';
      for (const ox of [-s * 0.3, s * 0.15]) {
        ctx.beginPath();
        ctx.arc(ox, 0, s * 0.11, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  function drawPlayer() {
    if (player.invuln > 0 && Math.floor(player.invuln * 12) % 2 === 0) return;
    ctx.save();
    ctx.translate(player.x, player.y);
    if (player.spin !== 0) ctx.rotate(player.spin);

    const s = player.size;
    const hullColor = '#4fd1ff';
    const sailColor = '#2f9fd6';

    // 船体（葉巻型、艦首は右向き）
    ctx.fillStyle = hullColor;
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 1.15, s * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();

    // 艦尾フィン（上下）
    ctx.beginPath();
    ctx.moveTo(-s * 1.05, -s * 0.15);
    ctx.lineTo(-s * 1.55, -s * 0.55);
    ctx.lineTo(-s * 0.85, -s * 0.05);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-s * 1.05, s * 0.15);
    ctx.lineTo(-s * 1.55, s * 0.55);
    ctx.lineTo(-s * 0.85, s * 0.05);
    ctx.closePath();
    ctx.fill();

    // 発射口（艦首の魚雷発射管。弾はplayer.x + player.sizeから出るため位置を合わせる）
    ctx.fillStyle = sailColor;
    roundRect(s * 0.85, -s * 0.2, s * 0.55, s * 0.4, 3);
    ctx.fill();
    ctx.fillStyle = '#0b2f42';
    ctx.beginPath();
    ctx.arc(s * 1.38, 0, s * 0.14, 0, Math.PI * 2);
    ctx.fill();

    // セイル（司令塔）
    ctx.fillStyle = sailColor;
    roundRect(-s * 0.3, -s * 1.05, s * 0.55, s * 0.6, 4);
    ctx.fill();

    // 潜望鏡
    ctx.strokeStyle = sailColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -s * 1.05);
    ctx.lineTo(0, -s * 1.32);
    ctx.stroke();

    // 舷窓
    ctx.fillStyle = '#e8ffff';
    for (const ox of [-s * 0.35, s * 0.1, s * 0.5]) {
      ctx.beginPath();
      ctx.arc(ox, 0, s * 0.12, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  function drawShieldEffect() {
    const s = player.size;
    if (player.shieldHp > 0) {
      // 残り回数が多いほど厚く明るいリングにして、消耗が分かるようにする
      const full = player.shieldHp >= SHIELD_MAX_HITS;
      const pulse = 0.5 + 0.5 * Math.sin(elapsed * 4);
      const r = s * 1.7 + pulse * 2;
      ctx.save();
      ctx.translate(player.x, player.y);
      ctx.shadowColor = '#66e0c8';
      ctx.shadowBlur = (full ? 10 : 6) + pulse * 8;
      ctx.strokeStyle = `rgba(102,224,200,${(full ? 0.55 : 0.35) + pulse * 0.25})`;
      ctx.lineWidth = full ? 3 : 1.8;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = `rgba(102,224,200,${full ? 0.08 : 0.04})`;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      // 満タンのときは内側にもう一重
      if (full) {
        ctx.shadowBlur = 0;
        ctx.strokeStyle = `rgba(102,224,200,${0.3 + pulse * 0.2})`;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(0, 0, r - 5, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (player.shieldPopTimer > 0) {
      const t = 1 - player.shieldPopTimer / 0.4; // 0→1
      ctx.save();
      ctx.translate(player.x, player.y);
      ctx.globalAlpha = 1 - t;
      ctx.strokeStyle = '#66e0c8';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, s * 1.7 + t * s * 0.9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // 赤く光る丸い目。暗い眼窩に浮かぶ残り火のような見え方にする
  function drawEvilEye(x, y, radius, color, glow) {
    ctx.save();
    // 眼窩の影
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.arc(x, y, radius * 1.7, 0, Math.PI * 2);
    ctx.fill();
    // 発光する眼球
    ctx.shadowColor = color;
    ctx.shadowBlur = glow;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fill();
    // 白熱した中心
    ctx.shadowBlur = glow * 0.5;
    ctx.fillStyle = '#ffd9d9';
    ctx.beginPath();
    ctx.arc(x, y, radius * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 三角の吊り目。後方が高く、前方へ鋭く落ちてにらみつける形
  // （ブロック崩しのボスと同じ形状。scaleで大きさを合わせる）
  const GLARE_EYE_PTS = [[14, -9], [-12, 1], [10, 5]];
  const GLARE_EYE_CENTER = [4, -1]; // 重心。ここを基準に拡大して眼窩を作る

  function traceGlareTriangle(x, y, scale, expand) {
    const [cx, cy] = GLARE_EYE_CENTER;
    ctx.beginPath();
    GLARE_EYE_PTS.forEach(([px, py], i) => {
      const ex = x + (cx + (px - cx) * expand) * scale;
      const ey = y + (cy + (py - cy) * expand) * scale;
      if (i === 0) ctx.moveTo(ex, ey);
      else ctx.lineTo(ex, ey);
    });
    ctx.closePath();
  }

  function drawTriangleGlareEye(x, y, scale, color, glow) {
    ctx.save();
    // 薄い眼窩の影（目と相似の三角形をひと回り大きく）
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    traceGlareTriangle(x, y, scale, 1.4);
    ctx.fill();
    // 発光する三角の目
    ctx.shadowColor = color;
    ctx.shadowBlur = glow;
    ctx.fillStyle = color;
    traceGlareTriangle(x, y, scale, 1);
    ctx.fill();
    ctx.fill();
    ctx.restore();
  }

  function drawFishEnemy(e) {
    const r = e.r;
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.fillStyle = '#8e1b34';
    // 尾びれ（切れ込みの入った鋭角）
    ctx.beginPath();
    ctx.moveTo(r * 0.5, 0);
    ctx.lineTo(r * 1.7, -r * 0.85);
    ctx.lineTo(r * 1.25, 0);
    ctx.lineTo(r * 1.7, r * 0.85);
    ctx.closePath();
    ctx.fill();
    // 胴体（角ばったピラニア型）
    ctx.beginPath();
    ctx.moveTo(-r * 1.1, r * 0.05);
    ctx.lineTo(-r * 0.25, -r * 0.75);
    ctx.lineTo(r * 0.75, -r * 0.4);
    ctx.lineTo(r * 0.75, r * 0.4);
    ctx.lineTo(-r * 0.2, r * 0.7);
    ctx.closePath();
    ctx.fill();
    // 背びれ（鋭い鎌型）
    ctx.beginPath();
    ctx.moveTo(-r * 0.15, -r * 0.62);
    ctx.lineTo(r * 0.35, -r * 1.3);
    ctx.lineTo(r * 0.6, -r * 0.45);
    ctx.closePath();
    ctx.fill();
    // 開いた口（暗い顎）
    ctx.fillStyle = '#3d0517';
    ctx.beginPath();
    ctx.moveTo(-r * 1.1, r * 0.05);
    ctx.lineTo(-r * 0.35, -r * 0.05);
    ctx.lineTo(-r * 0.3, r * 0.5);
    ctx.closePath();
    ctx.fill();
    // 牙（上下）
    ctx.fillStyle = '#fff';
    for (let i = 0; i < 3; i++) {
      const tx = -r * (0.95 - i * 0.25);
      ctx.beginPath();
      ctx.moveTo(tx, r * (0.02 + i * 0.02));
      ctx.lineTo(tx + r * 0.08, r * 0.3);
      ctx.lineTo(tx + r * 0.16, r * (0.04 + i * 0.02));
      ctx.closePath();
      ctx.fill();
    }
    // 体の傷跡
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = Math.max(1.5, r * 0.09);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(r * 0.1, -r * 0.32);
    ctx.lineTo(r * 0.38, r * 0.1);
    ctx.stroke();
    // 赤く光る目
    drawEvilEye(-r * 0.42, -r * 0.26, r * 0.17, '#ff2020', r * 0.8);
    ctx.restore();
  }

  // カジキ: 長い吻を持つ細身の魚。突進前は溜めの光を出す
  function drawMarlinEnemy(e) {
    const r = e.r;
    ctx.save();
    ctx.translate(e.x, e.y);
    if (e.phase === 'dash') ctx.rotate(Math.atan2(e.vy, e.vx) + Math.PI);

    if (e.phase === 'aim') {
      // 突進の予兆（明滅する残光）
      const blink = 0.5 + 0.5 * Math.sin(e.t * 22);
      ctx.shadowColor = '#ffd166';
      ctx.shadowBlur = 8 + blink * 14;
    }
    ctx.fillStyle = '#35618f';
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 1.25, r * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    // 長い吻（左向き＝進行方向）
    ctx.beginPath();
    ctx.moveTo(-r * 1.15, -r * 0.09);
    ctx.lineTo(-r * 2.1, 0);
    ctx.lineTo(-r * 1.15, r * 0.09);
    ctx.closePath();
    ctx.fill();
    // 背びれ・尾びれ
    ctx.beginPath();
    ctx.moveTo(-r * 0.1, -r * 0.35);
    ctx.lineTo(r * 0.35, -r * 1.15);
    ctx.lineTo(r * 0.5, -r * 0.28);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(r * 1.1, 0);
    ctx.lineTo(r * 1.75, -r * 0.6);
    ctx.lineTo(r * 1.75, r * 0.6);
    ctx.closePath();
    ctx.fill();
    drawEvilEye(-r * 0.72, -r * 0.08, r * 0.15, '#ff2020', r * 0.8);
    ctx.restore();
  }

  // ウツボ: 岩陰から胴体を伸ばして噛みつく
  function drawMorayEnemy(e) {
    const r = e.r;
    const restY = terrainSurfaceY(e.x) - 10;
    ctx.save();
    ctx.translate(e.x, restY);

    // 岩陰からの伸び具合（ローカル座標。原点は海底の巣穴）
    const tipY = e.y - restY;
    const tipX = (e.phase === 'strike' ? e.dirX * 0.35 : 0) * tipY;

    // 岩から伸びる胴体
    ctx.strokeStyle = '#4e7a4a';
    ctx.lineCap = 'round';
    ctx.lineWidth = r * 0.85;
    ctx.beginPath();
    ctx.moveTo(0, 6);
    ctx.quadraticCurveTo(tipX * 0.4, tipY * 0.55, tipX, tipY);
    ctx.stroke();

    // 頭
    ctx.save();
    ctx.translate(tipX, tipY);
    ctx.rotate(Math.atan2(tipY, tipX) + Math.PI / 2);
    ctx.fillStyle = '#5c8f56';
    ctx.beginPath();
    ctx.ellipse(0, 0, r * 0.52, r * 0.72, 0, 0, Math.PI * 2);
    ctx.fill();
    // 開いた口とギザギザの歯
    ctx.fillStyle = '#2a1206';
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.34, r * 0.34, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    for (let i = 0; i < 4; i++) {
      const tx = -r * 0.26 + i * r * 0.17;
      ctx.beginPath();
      ctx.moveTo(tx, -r * 0.55);
      ctx.lineTo(tx + r * 0.07, -r * 0.34);
      ctx.lineTo(tx + r * 0.14, -r * 0.55);
      ctx.closePath();
      ctx.fill();
    }
    drawEvilEye(-r * 0.2, r * 0.06, r * 0.13, '#ffcf3a', r * 0.7);
    drawEvilEye(r * 0.2, r * 0.06, r * 0.13, '#ffcf3a', r * 0.7);
    ctx.restore();
    ctx.restore();
  }

  // フグ: ダメージを受けるほど膨らむ。倒すとトゲを撒く
  function drawPufferEnemy(e) {
    const dmg = 1 - (e.hp - 1) / Math.max(1, e.maxHp - 1); // 0(無傷)→1(瀕死)
    const r = e.r * (0.85 + dmg * 0.45);
    ctx.save();
    ctx.translate(e.x, e.y);
    // 全身のトゲ
    ctx.fillStyle = '#c99a3e';
    const spikes = 12;
    for (let i = 0; i < spikes; i++) {
      const a = (Math.PI * 2 * i) / spikes + e.t * 0.4;
      const half = (Math.PI / spikes) * 0.4;
      const len = r * (1.18 + dmg * 0.3);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a - half) * r * 0.92, Math.sin(a - half) * r * 0.92);
      ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
      ctx.lineTo(Math.cos(a + half) * r * 0.92, Math.sin(a + half) * r * 0.92);
      ctx.closePath();
      ctx.fill();
    }
    // 本体
    ctx.fillStyle = '#e8c46b';
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    // 尾びれ
    ctx.beginPath();
    ctx.moveTo(r * 0.85, 0);
    ctx.lineTo(r * 1.5, -r * 0.42);
    ctx.lineTo(r * 1.5, r * 0.42);
    ctx.closePath();
    ctx.fill();
    // すぼめた口
    ctx.fillStyle = '#8a5a1c';
    ctx.beginPath();
    ctx.ellipse(-r * 0.78, r * 0.12, r * 0.16, r * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    drawEvilEye(-r * 0.42, -r * 0.3, r * 0.15, '#ff2020', r * 0.8);
    ctx.restore();
  }

  // タコ: 丸い頭と8本足。墨を吐く
  function drawOctopusEnemy(e) {
    const r = e.r;
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.fillStyle = '#8e4bb0';
    // 足（後方へなびく）
    ctx.strokeStyle = '#8e4bb0';
    ctx.lineCap = 'round';
    ctx.lineWidth = r * 0.16;
    for (let i = -2; i <= 2; i++) {
      const baseY = i * r * 0.2;
      ctx.beginPath();
      ctx.moveTo(r * 0.4, baseY * 0.6);
      ctx.quadraticCurveTo(
        r * 1.0, baseY + Math.sin(e.t * 3 + i) * r * 0.22,
        r * 1.55, baseY * 1.5 + Math.sin(e.t * 3 + i + 1) * r * 0.3
      );
      ctx.stroke();
    }
    // 頭
    ctx.beginPath();
    ctx.ellipse(-r * 0.1, 0, r * 0.92, r * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
    // 墨を吐く直前は口元が光る
    if (e.inkCooldown < 0.35) {
      ctx.fillStyle = 'rgba(40,10,60,0.9)';
      ctx.beginPath();
      ctx.arc(-r * 0.95, r * 0.16, r * 0.22, 0, Math.PI * 2);
      ctx.fill();
    }
    drawEvilEye(-r * 0.42, -r * 0.18, r * 0.16, '#ff2020', r * 0.8);
    drawEvilEye(r * 0.14, -r * 0.24, r * 0.16, '#ff2020', r * 0.8);
    ctx.restore();
  }

  // チョウチンアンコウ: 潜んでいる間は光る誘引突起だけが見える
  function drawAnglerEnemy(e) {
    const r = e.r;
    const lurking = e.phase === 'lurk';
    const glow = 0.55 + 0.45 * Math.sin(e.t * 3);
    ctx.save();
    ctx.translate(e.x, e.y);

    if (!lurking) {
      // 本体（大きな口とギザギザの歯）
      ctx.fillStyle = '#2b2036';
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 1.05, r * 0.9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(r * 0.85, 0);
      ctx.lineTo(r * 1.6, -r * 0.5);
      ctx.lineTo(r * 1.6, r * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 5; i++) {
        const tx = -r * 0.75 + i * r * 0.3;
        ctx.beginPath();
        ctx.moveTo(tx, r * 0.16);
        ctx.lineTo(tx + r * 0.12, r * 0.52);
        ctx.lineTo(tx + r * 0.24, r * 0.16);
        ctx.closePath();
        ctx.fill();
      }
      drawEvilEye(-r * 0.3, -r * 0.34, r * 0.15, '#ff2020', r * 0.9);
    }

    // 誘引突起（提灯）。潜んでいる間はこれだけが見える
    ctx.strokeStyle = lurking ? 'rgba(150,230,255,0.35)' : 'rgba(150,230,255,0.6)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-r * 0.35, -r * 0.5);
    ctx.quadraticCurveTo(-r * 1.0, -r * 1.5, -r * 1.35, -r * 1.0);
    ctx.stroke();
    ctx.shadowColor = '#9fe6ff';
    ctx.shadowBlur = 12 + glow * 16;
    ctx.fillStyle = `rgba(200,245,255,${0.7 + glow * 0.3})`;
    ctx.beginPath();
    ctx.arc(-r * 1.35, -r * 1.0, r * 0.24, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // タコの墨（画面を覆って視界を奪う）
  function drawInk() {
    for (const c of inkClouds) {
      const fade = Math.min(1, c.life / (c.maxLife * 0.45));
      ctx.save();
      ctx.globalAlpha = 0.72 * fade;
      ctx.fillStyle = '#0a0512';
      // 単一の円だと不自然なので複数の塊を重ねてもやっとさせる
      for (let i = 0; i < 5; i++) {
        const a = c.seed + (Math.PI * 2 * i) / 5;
        const d = c.r * 0.34;
        ctx.beginPath();
        ctx.arc(c.x + Math.cos(a) * d, c.y + Math.sin(a) * d, c.r * 0.68, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r * 0.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawJellyEnemy(e) {
    const r = e.r;
    ctx.save();
    ctx.translate(e.x, e.y);
    // 傘（ドーム＋ギザギザの裾＝毒クラゲ風）
    ctx.globalAlpha = 0.92;
    ctx.fillStyle = '#6e5f12';
    ctx.beginPath();
    ctx.arc(0, -r * 0.15, r, Math.PI, 0);
    const teethN = 5;
    for (let i = 0; i <= teethN; i++) {
      const x = r - (r * 2 * i) / teethN;
      const y = i % 2 === 0 ? -r * 0.15 : r * 0.2;
      ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    // 赤く光る一対の目
    for (const ex of [-r * 0.45, r * 0.05]) {
      drawEvilEye(ex, -r * 0.42, r * 0.15, '#ff2020', r * 0.7);
    }
    // 触手（波打つ、先が尖って見えるよう細めに）
    ctx.strokeStyle = '#6e5f12';
    ctx.lineWidth = 2;
    const t = e.t || 0;
    for (let i = -2; i <= 2; i++) {
      const baseX = i * r * 0.35;
      const midX = baseX + Math.sin(t * 3 + i) * r * 0.25;
      const endX = baseX + Math.sin(t * 3 + i + 1) * r * 0.35;
      ctx.beginPath();
      ctx.moveTo(baseX, r * 0.05);
      ctx.quadraticCurveTo(midX, r * 0.75, endX, r * 1.35);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawSpikyEnemy(e) {
    const r = e.r;
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.fillStyle = '#8f3d16';
    // とげ（細長い針）
    const spikes = 10;
    for (let i = 0; i < spikes; i++) {
      const a = (Math.PI * 2 * i) / spikes;
      const half = Math.PI / spikes * 0.35;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a - half) * r * 0.85, Math.sin(a - half) * r * 0.85);
      ctx.lineTo(Math.cos(a) * r * 1.75, Math.sin(a) * r * 1.75);
      ctx.lineTo(Math.cos(a + half) * r * 0.85, Math.sin(a + half) * r * 0.85);
      ctx.closePath();
      ctx.fill();
    }
    // 本体
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.95, 0, Math.PI * 2);
    ctx.fill();
    // 食いしばった口（ギザギザの歯）
    ctx.fillStyle = '#3a1502';
    ctx.fillRect(-r * 0.62, r * 0.32, r * 0.75, r * 0.16);
    ctx.fillStyle = '#fff';
    for (let i = 0; i < 4; i++) {
      const tx = -r * 0.6 + i * r * 0.18;
      ctx.beginPath();
      ctx.moveTo(tx, r * 0.33);
      ctx.lineTo(tx + r * 0.08, r * 0.46);
      ctx.lineTo(tx + r * 0.16, r * 0.33);
      ctx.closePath();
      ctx.fill();
    }
    // 赤く光る3つの目（単眼を下に置くと鼻に見えるので、単眼は上・対の目は下に配置）
    const aboutToFire = e.fireCooldown !== undefined && e.fireCooldown < 0.3;
    const eyeColor = aboutToFire ? '#ff5a2a' : '#ff2020';
    const eyeGlow = aboutToFire ? r * 1.4 : r * 0.7;
    const eyePositions = [
      [-r * 0.22, -r * 0.46],
      [-r * 0.48, -r * 0.12],
      [r * 0.02, -r * 0.16]
    ];
    for (const [ex, ey] of eyePositions) {
      drawEvilEye(ex, ey, r * 0.15, eyeColor, eyeGlow);
    }
    ctx.restore();
  }

  function drawEnemies() {
    for (const e of enemies) {
      // 浮上してくる敵はクラゲの見た目を流用する（上へ漂う動きと合う）
      if (e.type === 'sine' || e.type === 'riser') drawJellyEnemy(e);
      else if (e.type === 'shooter') drawSpikyEnemy(e);
      else if (e.type === 'marlin') drawMarlinEnemy(e);
      else if (e.type === 'moray') drawMorayEnemy(e);
      else if (e.type === 'puffer') drawPufferEnemy(e);
      else if (e.type === 'octopus') drawOctopusEnemy(e);
      else if (e.type === 'angler') drawAnglerEnemy(e);
      else drawFishEnemy(e);
      drawHitFlash(e);
    }
  }

  function drawSharkBossBody(R) {
    const bodyColor = '#3c4a56';

    // 尾びれ（三日月型、後方＝右）
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.moveTo(R * 0.85, 0);
    ctx.lineTo(R * 1.75, -R * 0.9);
    ctx.lineTo(R * 1.4, 0);
    ctx.lineTo(R * 1.7, R * 0.75);
    ctx.closePath();
    ctx.fill();

    // 胴体（流線型、鼻先が左）
    ctx.beginPath();
    ctx.moveTo(-R * 1.55, R * 0.08);
    ctx.quadraticCurveTo(-R * 0.7, -R * 0.85, R * 0.35, -R * 0.55);
    ctx.quadraticCurveTo(R * 1.05, -R * 0.3, R * 1.05, 0);
    ctx.quadraticCurveTo(R * 1.0, R * 0.4, R * 0.25, R * 0.58);
    ctx.quadraticCurveTo(-R * 0.75, R * 0.8, -R * 1.55, R * 0.08);
    ctx.closePath();
    ctx.fill();

    // 背びれ（大きな三角。後ろ側が食いちぎられて欠けている）
    ctx.beginPath();
    ctx.moveTo(-R * 0.3, -R * 0.6);
    ctx.lineTo(R * 0.1, -R * 1.45);
    ctx.lineTo(R * 0.26, -R * 1.1);
    ctx.lineTo(R * 0.2, -R * 0.85);
    ctx.lineTo(R * 0.38, -R * 0.78);
    ctx.lineTo(R * 0.5, -R * 0.5);
    ctx.closePath();
    ctx.fill();

    // 胸びれ
    ctx.beginPath();
    ctx.moveTo(-R * 0.25, R * 0.55);
    ctx.lineTo(-R * 0.55, R * 1.15);
    ctx.lineTo(R * 0.15, R * 0.6);
    ctx.closePath();
    ctx.fill();

    // 開いた口（暗い顎、鼻先の下）
    ctx.fillStyle = '#1c1016';
    ctx.beginPath();
    ctx.moveTo(-R * 1.5, R * 0.12);
    ctx.quadraticCurveTo(-R * 0.85, R * 0.3, -R * 0.45, R * 0.34);
    ctx.quadraticCurveTo(-R * 0.85, R * 0.72, -R * 1.3, R * 0.5);
    ctx.closePath();
    ctx.fill();

    // 上あごの牙
    ctx.fillStyle = '#fff';
    for (let i = 0; i < 5; i++) {
      const tx = -R * (1.38 - i * 0.21);
      const ty = R * (0.17 + i * 0.045);
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx + R * 0.08, ty + R * 0.2);
      ctx.lineTo(tx + R * 0.17, ty + R * 0.02);
      ctx.closePath();
      ctx.fill();
    }
    // 下あごの牙
    for (let i = 0; i < 4; i++) {
      const tx = -R * (1.24 - i * 0.2);
      const ty = R * (0.5 - i * 0.02);
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx + R * 0.09, ty - R * 0.18);
      ctx.lineTo(tx + R * 0.18, ty - R * 0.01);
      ctx.closePath();
      ctx.fill();
    }

    // えら（3本）
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = Math.max(2, R * 0.05);
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const gx = R * (0.05 + i * 0.14);
      ctx.beginPath();
      ctx.moveTo(gx, -R * 0.35);
      ctx.quadraticCurveTo(gx - R * 0.12, 0, gx, R * 0.35);
      ctx.stroke();
    }

    // 古傷（脇腹の抉れた跡）
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = Math.max(2, R * 0.06);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-R * 0.45, -R * 0.35);
    ctx.lineTo(-R * 0.15, R * 0.05);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-R * 0.2, -R * 0.42);
    ctx.lineTo(-R * 0.02, -R * 0.12);
    ctx.stroke();

    // 赤く光る三角の吊り目（鼓動するように明滅）
    const pulse = 0.5 + 0.5 * Math.sin(boss.t * 3);
    drawTriangleGlareEye(-R * 0.74, -R * 0.24, R / 42, '#ff2a1a', 12 + pulse * 10);
  }

  // ゴブリンシャークはサメの体をそのまま流用し、突進の噛みつき時だけ
  // 特徴的な飛び出す顎(jawExtend)を重ねて描く
  function drawGoblinSharkBossBody(R) {
    drawSharkBossBody(R);
    const j = boss.jawExtend || 0;
    if (j <= 0) return;

    ctx.save();
    const jawColor = '#8a95a0';
    const noseX = -R * 1.5;
    const extend = j * R * 0.9;

    // 飛び出した細長い顎
    ctx.fillStyle = jawColor;
    ctx.beginPath();
    ctx.moveTo(noseX + R * 0.1, R * 0.05);
    ctx.lineTo(noseX - extend, R * 0.14);
    ctx.lineTo(noseX - extend, R * 0.32);
    ctx.lineTo(noseX + R * 0.1, R * 0.5);
    ctx.closePath();
    ctx.fill();

    // 針のような牙
    ctx.fillStyle = '#fff';
    const teeth = 5;
    for (let i = 0; i < teeth; i++) {
      const tx = noseX + R * 0.05 - (extend * (i + 0.5)) / teeth;
      ctx.beginPath();
      ctx.moveTo(tx, R * 0.14);
      ctx.lineTo(tx - R * 0.05, R * 0.14 - R * 0.09 * j);
      ctx.lineTo(tx + R * 0.05, R * 0.14);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(tx, R * 0.32);
      ctx.lineTo(tx - R * 0.05, R * 0.32 + R * 0.09 * j);
      ctx.lineTo(tx + R * 0.05, R * 0.32);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawCrabBossBody(R) {
    const shellColor = '#8a3a2c';
    const clawColor = '#b0492f';
    const pulse = 0.5 + 0.5 * Math.sin(boss.t * 3);

    // 脚（甲羅の下から放射状に）
    ctx.strokeStyle = shellColor;
    ctx.lineWidth = Math.max(3, R * 0.09);
    ctx.lineCap = 'round';
    for (const dir of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const baseX = R * (0.35 - i * 0.35) * dir;
        const kneeX = baseX + R * 0.28 * dir;
        const kneeY = R * 0.75;
        const footX = baseX + R * 0.5 * dir;
        const footY = R * 1.25;
        ctx.beginPath();
        ctx.moveTo(baseX, R * 0.4);
        ctx.lineTo(kneeX, kneeY);
        ctx.lineTo(footX, footY);
        ctx.stroke();
      }
    }

    // 甲羅（横長の丸い形）
    ctx.fillStyle = shellColor;
    ctx.beginPath();
    ctx.ellipse(0, 0, R * 1.05, R * 0.72, 0, 0, Math.PI * 2);
    ctx.fill();
    // 甲羅の模様（背側の隆起した筋）
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = Math.max(2, R * 0.045);
    ctx.beginPath();
    ctx.ellipse(0, -R * 0.08, R * 0.78, R * 0.4, 0, Math.PI * 1.08, Math.PI * 1.92);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-R * 0.5, -R * 0.35);
    ctx.lineTo(-R * 0.5, -R * 0.15);
    ctx.moveTo(R * 0.5, -R * 0.35);
    ctx.lineTo(R * 0.5, -R * 0.15);
    ctx.stroke();

    // 目（甲羅の前方、柄の上）
    ctx.strokeStyle = shellColor;
    ctx.lineWidth = Math.max(3, R * 0.08);
    for (const ex of [-R * 0.32, -R * 0.02]) {
      ctx.beginPath();
      ctx.moveTo(ex, -R * 0.55);
      ctx.lineTo(ex - R * 0.12, -R * 0.95);
      ctx.stroke();
      drawEvilEye(ex - R * 0.12, -R * 0.95, R * 0.13, '#ff2a1a', 8 + pulse * 6);
    }

    // ハサミ（開閉するように上下の爪を少し動かす）
    const pinch = 0.5 + 0.5 * Math.sin(boss.t * 2.4);
    for (const dir of [-1, 1]) {
      ctx.save();
      ctx.translate(-R * 1.15, dir * R * 0.5);
      ctx.rotate(dir * (0.25 + pinch * 0.12));
      ctx.fillStyle = clawColor;
      // 腕
      ctx.beginPath();
      ctx.ellipse(R * 0.35, 0, R * 0.4, R * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
      // 爪（上下2枚）
      ctx.beginPath();
      ctx.moveTo(-R * 0.05, -R * 0.05);
      ctx.lineTo(-R * 0.5, -R * 0.32 - pinch * R * 0.12);
      ctx.lineTo(-R * 0.32, R * 0.02);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-R * 0.05, R * 0.05);
      ctx.lineTo(-R * 0.5, R * 0.32 + pinch * R * 0.12);
      ctx.lineTo(-R * 0.32, -R * 0.02);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  function drawMantisBossBody(R) {
    const bodyColor = '#2fa66a';
    const bandColor = '#1c7a4a';
    const clawColor = '#7fe0a8';
    const t = boss.t;

    // 節のある体（横長、後方は画面右）
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.ellipse(0, 0, R * 1.15, R * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    // 体節の縞
    ctx.strokeStyle = bandColor;
    ctx.lineWidth = Math.max(2, R * 0.05);
    for (let i = -2; i <= 2; i++) {
      const x = i * R * 0.32;
      ctx.beginPath();
      ctx.moveTo(x, -R * 0.5);
      ctx.lineTo(x, R * 0.5);
      ctx.stroke();
    }
    // 尾びれ（後方＝右）
    ctx.fillStyle = bandColor;
    ctx.beginPath();
    ctx.moveTo(R * 0.95, -R * 0.4);
    ctx.lineTo(R * 1.5, 0);
    ctx.lineTo(R * 0.95, R * 0.4);
    ctx.closePath();
    ctx.fill();

    // 目
    const pulse = 0.5 + 0.5 * Math.sin(t * 3);
    drawEvilEye(-R * 0.85, -R * 0.15, R * 0.13, '#ff2a1a', 8 + pulse * 6);
    drawEvilEye(-R * 0.85, R * 0.15, R * 0.13, '#ff2a1a', 8 + pulse * 6);

    // 前脚の打突腕（シャコパンチ）。溜め中は引き、打撃の瞬間に伸びる
    let armPull = 0, armExtend = 0;
    if (boss.punchPhase === 'aim') armPull = Math.min(1, boss.punchT);
    if (boss.punchPhase === 'punch') armExtend = 1 - Math.min(1, boss.punchT);
    const armBaseX = -R * 0.75;
    const armX = armBaseX - armPull * R * 0.3 + armExtend * R * 1.4;

    for (const dir of [-1, 1]) {
      ctx.save();
      ctx.strokeStyle = clawColor;
      ctx.fillStyle = clawColor;
      ctx.lineWidth = Math.max(3, R * 0.1);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(armBaseX, dir * R * 0.3);
      ctx.lineTo(armX, dir * R * 0.22);
      ctx.stroke();
      // 打突部の先端（棍棒状）
      ctx.beginPath();
      ctx.ellipse(armX, dir * R * 0.22, R * 0.16, R * 0.11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 溜め中は打突腕のまわりに緊張の光を出す
    if (boss.punchPhase === 'aim') {
      const glow = 0.4 + 0.6 * Math.min(1, boss.punchT);
      ctx.save();
      ctx.shadowColor = '#ffe08a';
      ctx.shadowBlur = 6 + glow * 14;
      ctx.strokeStyle = `rgba(255,224,138,${glow})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(armBaseX, 0, R * 0.45, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawGhostOctopusBossBody(R) {
    const t = boss.t;
    const bodyColor = 'rgba(190,210,220,0.55)';   // 幽霊のように半透明
    const outlineColor = 'rgba(230,245,250,0.7)';
    const tentColor = 'rgba(190,210,220,0.6)';
    const suckerColor = 'rgba(230,245,250,0.55)';

    // 触腕（8本）。クラゲのように並んで垂れるのではなく、胴体下の一点から
    // 放射状に扇状へ広がらせ、うねらせてタコらしいシルエットにする
    ctx.lineCap = 'round';
    const tentacleCount = 8;
    const originY = R * 0.35;   // マントがくびれる付け根
    for (let i = 0; i < tentacleCount; i++) {
      const norm = (i - (tentacleCount - 1) / 2) / ((tentacleCount - 1) / 2); // -1..1
      const baseAngle = Math.PI / 2 + norm * 1.25;   // 下向きを中心に扇状(約143度)へ広げる
      const sway = Math.sin(t * 1.4 + i * 0.9) * 0.18;
      const angle = baseAngle + sway;
      const len = R * (1.5 + 0.15 * Math.sin(i * 2.1));
      const curl = Math.sin(t * 1.1 + i * 1.3) * R * 0.35;

      const sx = Math.cos(baseAngle) * R * 0.15, sy = originY + Math.sin(baseAngle) * R * 0.15;
      const mx = Math.cos(angle) * len * 0.55, my = originY + Math.sin(angle) * len * 0.55;
      // 先端は曲げの方向へさらにカールさせ、まっすぐ伸びきらないようにする
      const perpX = -Math.sin(angle), perpY = Math.cos(angle);
      const ex = Math.cos(angle) * len + perpX * curl;
      const ey = originY + Math.sin(angle) * len + perpY * curl;

      ctx.strokeStyle = tentColor;
      ctx.lineWidth = Math.max(2.5, R * 0.13 * (1 - Math.abs(norm) * 0.25));
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(mx, my, ex, ey);
      ctx.stroke();

      // 吸盤（触腕の曲線に沿って小さな丸を並べる）
      ctx.fillStyle = suckerColor;
      for (let s = 1; s <= 3; s++) {
        const u = s / 4;
        const px = (1 - u) * (1 - u) * sx + 2 * (1 - u) * u * mx + u * u * ex;
        const py = (1 - u) * (1 - u) * sy + 2 * (1 - u) * u * my + u * u * ey;
        ctx.beginPath();
        ctx.arc(px, py, R * 0.045 * (1 - u * 0.4), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // マント（丸くふくらんだ袋状の頭部が、くびれた付け根で触腕の束に繋がる）
    const mantlePath = () => {
      ctx.beginPath();
      ctx.moveTo(0, originY);
      ctx.bezierCurveTo(-R * 0.95, R * 0.3, -R * 1.05, -R * 0.55, -R * 0.35, -R * 0.95);
      ctx.quadraticCurveTo(0, -R * 1.15, R * 0.35, -R * 0.95);
      ctx.bezierCurveTo(R * 1.05, -R * 0.55, R * 0.95, R * 0.3, 0, originY);
      ctx.closePath();
    };
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = bodyColor;
    mantlePath();
    ctx.fill();
    ctx.restore();
    // 幽霊らしいゆらめきを、輪郭のぼかしで軽く添える程度に留める
    const flicker = 0.5 + 0.5 * Math.sin(t * 1.8);
    ctx.strokeStyle = outlineColor;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.6 + flicker * 0.4;
    mantlePath();
    ctx.stroke();
    ctx.globalAlpha = 1;

    // 大きな青白い目
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.4);
    for (const ex of [-R * 0.32, R * 0.1]) {
      ctx.save();
      ctx.shadowColor = '#bfe8ff';
      ctx.shadowBlur = 6 + pulse * 10;
      ctx.fillStyle = `rgba(200,240,255,${0.7 + pulse * 0.3})`;
      ctx.beginPath();
      ctx.arc(ex, -R * 0.35, R * 0.17, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0a1620';
      ctx.beginPath();
      ctx.arc(ex, -R * 0.35, R * 0.07, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 叩きつけの予告中は不気味な明滅で緊張を出す
    if (boss.slamPhase === 'telegraph') {
      const glow = 0.4 + 0.6 * boss.slamT;
      ctx.save();
      ctx.shadowColor = '#7fffe0';
      ctx.shadowBlur = 10 + glow * 16;
      ctx.strokeStyle = `rgba(127,255,224,${glow})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, -R * 0.3, R * 1.3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawSquidBossBody(R) {
    // 5面の強化再戦(enraged)は色を濃い赤に変え、同じボスの強化版だと伝える
    const mantleColor = boss.variant === 'enraged' ? '#a4102f' : '#7a1f3d';
    const t = boss.t;

    // 触腕（波打ちながら前方＝左に伸びる）
    ctx.lineCap = 'round';
    for (let i = -3; i <= 3; i++) {
      const isStriking = boss.tentacleActive && boss.tentacleIndex === i;
      const baseY = i * R * 0.16;
      if (isStriking) {
        const tip = squidTentacleTip(boss);
        const sx = -R * 0.55, sy = baseY * 0.4;
        const ex = tip.x - boss.x, ey = tip.y - boss.y;
        // 制御点を根元寄りに置き、まっすぐな棒ではなく緩く曲がった足にする
        const cxp = sx + (ex - sx) * 0.45;
        const cyp = sy + (ey - sy) * 0.15;

        // ベジェ上をサンプリングし、進行方向に対して垂直方向へうねりを加える
        const SEG = 16;
        const pts = [];
        for (let s = 0; s <= SEG; s++) {
          const u = s / SEG;
          const bx = (1 - u) * (1 - u) * sx + 2 * (1 - u) * u * cxp + u * u * ex;
          const by = (1 - u) * (1 - u) * sy + 2 * (1 - u) * u * cyp + u * u * ey;
          const dx = 2 * (1 - u) * (cxp - sx) + 2 * u * (ex - cxp);
          const dy = 2 * (1 - u) * (cyp - sy) + 2 * u * (ey - cyp);
          const dl = Math.max(1, Math.hypot(dx, dy));
          // 根元と先端は振れ幅を絞り、中央がよくうねるようにする
          const wave = Math.sin(u * Math.PI * 2.2 - t * 9) * R * 0.13 * Math.sin(u * Math.PI);
          pts.push({ x: bx - (dy / dl) * wave, y: by + (dx / dl) * wave, u });
        }

        ctx.save();
        ctx.shadowColor = '#ff3a6e';
        ctx.shadowBlur = 8;
        ctx.strokeStyle = '#ff3a6e';
        // 根元を太く先端を細くして足らしいテーパーをつける
        for (let s = 0; s < SEG; s++) {
          const p = pts[s], q = pts[s + 1];
          ctx.lineWidth = Math.max(2, R * 0.14 * (1 - p.u * 0.65));
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(q.x, q.y);
          ctx.stroke();
        }
        // 先端の触腕鉤（イカの触腕は先だけ幅広くなる）
        const tipPt = pts[SEG];
        const prevPt = pts[SEG - 1];
        ctx.translate(tipPt.x, tipPt.y);
        ctx.rotate(Math.atan2(tipPt.y - prevPt.y, tipPt.x - prevPt.x));
        ctx.fillStyle = '#ff3a6e';
        ctx.beginPath();
        ctx.ellipse(-R * 0.1, 0, R * 0.2, R * 0.09, 0, 0, Math.PI * 2);
        ctx.fill();
        // 吸盤
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#7a1f3d';
        for (let s = 0; s < 3; s++) {
          ctx.beginPath();
          ctx.arc(-R * 0.19 + s * R * 0.08, 0, R * 0.028, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        continue;
      }
      ctx.strokeStyle = mantleColor;
      ctx.lineWidth = Math.max(3, R * 0.09);
      const midX = -R * 1.1 + Math.sin(t * 2.4 + i) * R * 0.25;
      const midY = baseY + Math.cos(t * 2 + i) * R * 0.18;
      const endX = -R * 2.1 + Math.sin(t * 2.4 + i + 1) * R * 0.3;
      const endY = baseY + Math.sin(t * 2 + i + 1) * R * 0.3;
      ctx.beginPath();
      ctx.moveTo(-R * 0.55, baseY * 0.4);
      ctx.quadraticCurveTo(midX, midY, endX, endY);
      ctx.stroke();
    }

    // マント（丸みのある胴体、後方に尾びれ状の突起）
    ctx.fillStyle = mantleColor;
    ctx.beginPath();
    ctx.moveTo(R * 1.3, 0);
    ctx.quadraticCurveTo(R * 0.6, -R * 1.1, -R * 0.3, -R * 0.8);
    ctx.quadraticCurveTo(-R * 0.65, -R * 0.3, -R * 0.65, 0);
    ctx.quadraticCurveTo(-R * 0.65, R * 0.3, -R * 0.3, R * 0.8);
    ctx.quadraticCurveTo(R * 0.6, R * 1.1, R * 1.3, 0);
    ctx.closePath();
    ctx.fill();
    // ひれ（左右の三角）
    ctx.beginPath();
    ctx.moveTo(R * 0.3, -R * 0.7);
    ctx.lineTo(R * 0.95, -R * 1.25);
    ctx.lineTo(R * 0.55, -R * 0.45);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(R * 0.3, R * 0.7);
    ctx.lineTo(R * 0.95, R * 1.25);
    ctx.lineTo(R * 0.55, R * 0.45);
    ctx.closePath();
    ctx.fill();

    // 大きな目（縦に裂けた瞳孔）
    const pulse = 0.5 + 0.5 * Math.sin(t * 3);
    for (const ey of [-R * 0.28, R * 0.28]) {
      ctx.fillStyle = '#2a0a18';
      ctx.beginPath();
      ctx.arc(-R * 0.15, ey, R * 0.24, 0, Math.PI * 2);
      ctx.fill();
      drawEvilEye(-R * 0.15, ey, R * 0.17, '#ff2a5a', 10 + pulse * 8);
    }
  }

  // 突進中のサメに、溜めの予兆と走行時の水しぶきを重ねる
  function drawSharkChargeFx(R) {
    if (boss.kind !== 'shark') return;

    if (boss.chargePhase === 'aim') {
      // 狙われていることが分かるよう赤く明滅させ、狙いの高さに線を引く
      const pulse = 0.5 + 0.5 * Math.sin(boss.chargeT * 26);
      ctx.save();
      ctx.strokeStyle = `rgba(255,70,70,${0.35 + pulse * 0.4})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.moveTo(0, boss.chargeY - boss.y);
      ctx.lineTo(-boss.x - 40, boss.chargeY - boss.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.shadowColor = '#ff4646';
      ctx.shadowBlur = 12 + pulse * 16;
      ctx.strokeStyle = `rgba(255,70,70,${0.5 + pulse * 0.4})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, R * 1.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else if (boss.chargePhase === 'run') {
      // 後方へ伸びる水しぶきの筋
      ctx.save();
      ctx.strokeStyle = 'rgba(220,245,255,0.45)';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      for (const oy of [-R * 0.5, 0, R * 0.5]) {
        ctx.beginPath();
        ctx.moveTo(R * 1.2, oy);
        ctx.lineTo(R * 1.2 + 46 + Math.random() * 26, oy);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // 触腕叩きつけの予告。海底から立ち上る影で、突き上げてくる位置を示す
  function drawGhostSlamTelegraph() {
    const k = boss.slamT;
    for (const sx of boss.slamXs) {
      ctx.save();
      ctx.globalAlpha = 0.3 + k * 0.4;
      ctx.fillStyle = 'rgba(127,255,224,0.4)';
      ctx.beginPath();
      ctx.ellipse(sx, playH - 6, 22 + k * 10, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawBoss() {
    if (!boss) return;
    const R = boss.r;
    ctx.save();
    ctx.translate(boss.x, boss.y);

    drawSharkChargeFx(R);
    if (boss.kind === 'crab') drawCrabBossBody(R);
    else if (boss.kind === 'squid') drawSquidBossBody(R);
    else if (boss.kind === 'mantis') drawMantisBossBody(R);
    else if (boss.kind === 'ghostoctopus') drawGhostOctopusBossBody(R);
    else if (boss.kind === 'goblinshark') {
      // 戻りは右向きに泳ぐので、絵も反転させる
      if (boss.chargePhase === 'back') ctx.scale(-1, 1);
      drawGoblinSharkBossBody(R);
    }

    ctx.restore();
    if (boss.kind === 'ghostoctopus' && boss.slamPhase === 'telegraph') drawGhostSlamTelegraph();
    drawHitFlash(boss);

    const barW = Math.min(220, W - 140);
    const barX = W - barW - 16;
    const barY = 16;
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(barX, barY, barW, 10);
    ctx.fillStyle = '#ff4d4d';
    ctx.fillRect(barX, barY, barW * (boss.hp / boss.maxHp), 10);
  }

  const BULLET_COLORS = {
    normal: '#e8ffff', spread: '#8bffb0', homing: '#ff6fd8',
    pierce: '#ffd166', wide: '#5ad1ff', escort: '#7ef0c0', torpedo: '#ffe08a'
  };

  function drawBullets() {
    for (const b of playerBullets) {
      ctx.fillStyle = BULLET_COLORS[b.type] || BULLET_COLORS.normal;
      if (b.type === 'torpedo') {
        // 魚雷は葉巻型に尾びれ。進行方向を向かせる
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(Math.atan2(b.vy, b.vx));
        ctx.beginPath();
        ctx.ellipse(0, 0, b.r * 1.7, b.r * 0.72, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-b.r * 1.3, 0);
        ctx.lineTo(-b.r * 2.1, -b.r * 0.85);
        ctx.lineTo(-b.r * 2.1, b.r * 0.85);
        ctx.closePath();
        ctx.fill();
        // 弾頭の光
        ctx.fillStyle = '#fff6d8';
        ctx.beginPath();
        ctx.arc(b.r * 1.1, 0, b.r * 0.34, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        continue;
      }
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const b of enemyBullets) {
      if (b.lava) {
        ctx.save();
        ctx.shadowColor = '#ff8a1a';
        ctx.shadowBlur = 10;
        ctx.fillStyle = '#ff8a1a';
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#ffd68a';
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r * 0.45, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (b.kind === 'bubble') {
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.fillStyle = 'rgba(210,240,255,0.35)';
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, b.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath();
        ctx.arc(-b.r * 0.35, -b.r * 0.35, b.r * 0.28, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (b.kind === 'spike') {
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(Math.atan2(b.vy, b.vx));
        ctx.shadowColor = '#ffcf3a';
        ctx.shadowBlur = 8;
        ctx.fillStyle = '#ffcf3a';
        ctx.beginPath();
        ctx.moveTo(b.r * 2.4, 0);
        ctx.lineTo(-b.r * 1.2, b.r * 0.9);
        ctx.lineTo(-b.r * 1.2, -b.r * 0.9);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#8f3d16';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      } else if (b.kind === 'shockwave') {
        // シャコパンチの衝撃波。進行方向に長い半透明の帯
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(Math.atan2(b.vy, b.vx));
        ctx.shadowColor = '#ffe08a';
        ctx.shadowBlur = 10;
        ctx.fillStyle = 'rgba(255,224,138,0.5)';
        ctx.beginPath();
        ctx.ellipse(0, 0, b.r * 2.4, b.r * 0.65, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
      } else if (b.kind === 'debris') {
        // 残骸から剥がれ落ちたデブリ。錆びた鉄片
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.x * 0.05 + b.y * 0.03);
        ctx.fillStyle = '#7a5a44';
        ctx.beginPath();
        ctx.moveTo(-b.r, -b.r * 0.6);
        ctx.lineTo(b.r * 0.8, -b.r * 0.3);
        ctx.lineTo(b.r * 0.6, b.r);
        ctx.lineTo(-b.r * 0.7, b.r * 0.5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else if (b.kind === 'tentacleslam') {
        // 触腕叩きつけの一節。半透明の吸盤付き
        ctx.save();
        ctx.fillStyle = 'rgba(190,210,220,0.6)';
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(120,150,160,0.5)';
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r * 0.45, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.fillStyle = '#ff5c5c';
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // 下へ引きずり込む漏斗状の渦を描く
  function drawWhirlpool(wp) {
    const R = wp.r;
    const bottom = whirlpoolBottomY(wp);
    const depth = Math.max(1, bottom - wp.y);
    const FLAT = 0.34;  // 上から見下ろした遠近感（楕円の潰し具合）

    ctx.save();
    ctx.translate(wp.x, wp.y);

    // 漏斗の内側（下へ向かって暗くなる縦グラデーション）
    const grad = ctx.createLinearGradient(0, 0, 0, depth);
    grad.addColorStop(0, 'rgba(8,52,74,0.35)');
    grad.addColorStop(0.6, 'rgba(3,26,40,0.75)');
    grad.addColorStop(1, 'rgba(0,6,12,0.95)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(-R, 0);
    ctx.lineTo(-R * 0.22, depth);
    ctx.lineTo(R * 0.22, depth);
    ctx.lineTo(R, 0);
    ctx.ellipse(0, 0, R, R * FLAT, 0, 0, Math.PI, true);
    ctx.closePath();
    ctx.fill();

    // 口のふち
    ctx.strokeStyle = 'rgba(190,235,255,0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, 0, R, R * FLAT, 0, 0, Math.PI * 2);
    ctx.stroke();

    // 内壁を回りながら落ちていく水流（螺旋を数本）
    ctx.lineCap = 'round';
    const arms = 3;
    for (let a = 0; a < arms; a++) {
      const phase = (Math.PI * 2 * a) / arms - wp.t * 2.6;
      ctx.strokeStyle = `rgba(200,240,255,${0.3 - a * 0.06})`;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      for (let s = 0; s <= 48; s++) {
        const u = s / 48;
        const rr = R * (1 - u * 0.78);
        const ang = phase + u * Math.PI * 3.4;
        const px = Math.cos(ang) * rr;
        const py = u * depth + Math.sin(ang) * rr * FLAT;
        if (s === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    // 底の暗い吸い込み口
    ctx.fillStyle = 'rgba(0,4,10,0.95)';
    ctx.beginPath();
    ctx.ellipse(0, depth, R * 0.22, R * 0.22 * FLAT, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // 火山は地形の山そのものなので、山頂に火口と溶岩の筋だけを重ねて描く
  function drawVolcanoes() {
    for (const v of visibleVolcanoes()) {
      const glow = 0.6 + 0.4 * Math.sin(Date.now() / 150 + v.periodIndex);
      ctx.save();
      ctx.translate(v.x, v.y);

      // 山肌を流れる溶岩の筋（地形の斜面に沿わせる）
      ctx.strokeStyle = 'rgba(255,120,30,0.5)';
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        for (let s = 0; s <= 8; s++) {
          const dx = dir * s * 5;
          // 表面より少し内側を通して、地形からはみ出さないようにする
          const dy = terrainSurfaceY(v.x + dx) - v.y + 3;
          if (s === 0) ctx.moveTo(dx, dy);
          else ctx.lineTo(dx, dy);
        }
        ctx.stroke();
      }

      // 火口の光（明滅）
      ctx.shadowColor = '#ff8a1a';
      ctx.shadowBlur = 16 + glow * 14;
      ctx.fillStyle = `rgba(255,140,40,${glow})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, 17, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = `rgba(255,220,150,${0.5 + glow * 0.4})`;
      ctx.beginPath();
      ctx.ellipse(0, 0, 8, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // 山頂に突き刺さった船体の断片（大きく傾いた鉄板・舷窓）
  function drawWreckageHullPlate(phase) {
    ctx.save();
    ctx.rotate(-0.18);
    const hullColor = '#4a4038';
    ctx.fillStyle = hullColor;
    ctx.beginPath();
    ctx.moveTo(-58, 6);
    ctx.lineTo(-40, -46);
    ctx.lineTo(30, -58);
    ctx.lineTo(56, -30);
    ctx.lineTo(44, 4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(20,16,14,0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // リベット打ちの継ぎ目
    ctx.strokeStyle = 'rgba(150,110,70,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-40, -46);
    ctx.lineTo(-10, -20);
    ctx.lineTo(30, -58);
    ctx.moveTo(-10, -20);
    ctx.lineTo(44, 4);
    ctx.stroke();

    // 割れた舷窓3つ（ぼんやり発光）
    const glow = 0.4 + 0.3 * Math.sin(Date.now() / 400 + phase);
    for (const [px, py] of [[-24, -18], [4, -36], [26, -14]]) {
      ctx.fillStyle = `rgba(150,215,230,${glow})`;
      ctx.beginPath();
      ctx.arc(px, py, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(15,12,10,0.85)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();

    // 折れて突き出た鉄骨・手すり
    ctx.strokeStyle = 'rgba(60,52,48,0.9)';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(dir * 44, -12);
      ctx.lineTo(dir * 70, -40);
      ctx.moveTo(dir * 50, -2);
      ctx.lineTo(dir * 78, -6);
      ctx.stroke();
    }
  }

  // 折れたマストとちぎれた帆（水中でゆっくりはためく）
  function drawWreckageMast(phase) {
    ctx.save();
    ctx.rotate(-0.12);

    // マスト本体
    ctx.strokeStyle = '#3a3128';
    ctx.lineWidth = 7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 10);
    ctx.lineTo(-8, -78);
    ctx.stroke();

    // 支索（リギング）
    ctx.strokeStyle = 'rgba(120,100,80,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-8, -78);
    ctx.lineTo(38, 0);
    ctx.moveTo(-8, -50);
    ctx.lineTo(-46, 4);
    ctx.stroke();

    // ちぎれてはためく帆布
    const flutter = Math.sin(Date.now() / 700 + phase) * 8;
    ctx.fillStyle = 'rgba(200,195,180,0.45)';
    ctx.beginPath();
    ctx.moveTo(-8, -74);
    ctx.quadraticCurveTo(20 + flutter, -60, 30 + flutter * 1.4, -34);
    ctx.quadraticCurveTo(14, -44, -6, -36);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(20,16,14,0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.restore();
  }

  // むき出しの肋材（船の骨組み）と錨
  function drawWreckageRibs(phase) {
    ctx.save();

    // 扇状に並んだ肋材
    ctx.strokeStyle = 'rgba(70,58,50,0.85)';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const a = -Math.PI / 2 + (i - 1.5) * 0.32;
      const x1 = Math.cos(a) * 12, y1 = Math.sin(a) * 12 + 4;
      const x2 = Math.cos(a) * 58, y2 = Math.sin(a) * 58 - 4;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo(x1 + (x2 - x1) * 0.5, y1 - 14, x2, y2);
      ctx.stroke();
    }
    // 竜骨
    ctx.strokeStyle = 'rgba(50,42,36,0.9)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(-40, 2);
    ctx.lineTo(40, 2);
    ctx.stroke();

    // 錨
    ctx.save();
    ctx.translate(50, -20);
    ctx.rotate(0.3);
    ctx.strokeStyle = 'rgba(90,80,70,0.8)';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, 0, 5, 0, Math.PI * 2);
    ctx.moveTo(0, 5);
    ctx.lineTo(0, 26);
    ctx.moveTo(-12, 26);
    ctx.quadraticCurveTo(0, 38, 12, 26);
    ctx.moveTo(-10, -10);
    ctx.lineTo(10, -10);
    ctx.stroke();
    ctx.restore();

    ctx.restore();
  }

  const WRECKAGE_VARIANT_DRAWERS = [drawWreckageHullPlate, drawWreckageMast, drawWreckageRibs];

  // 沈没船の残骸帯の見た目。山の斜面に沿って錆の筋を重ね、残骸の形は場所ごとに変える
  function drawWreckage() {
    for (const w of visibleWreckage()) {
      ctx.save();
      ctx.translate(w.x, w.y);

      // 錆の筋（火山の溶岩の筋と同じ考え方で斜面に沿わせる）
      ctx.strokeStyle = 'rgba(150,110,70,0.55)';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        for (let s = 0; s <= 10; s++) {
          const dx = dir * s * 9;
          const dy = terrainSurfaceY(w.x + dx) - w.y + 5;
          if (s === 0) ctx.moveTo(dx, dy);
          else ctx.lineTo(dx, dy);
        }
        ctx.stroke();
      }

      // 残骸の形は場所ごとに決定的に変える（船体片・マスト・肋材の3種）
      const variant = Math.floor(terrainHash(w.periodIndex + 500) * WRECKAGE_VARIANT_DRAWERS.length);
      WRECKAGE_VARIANT_DRAWERS[variant](w.periodIndex);

      ctx.restore();
    }
  }

  const ITEM_COLORS = {
    spread: '#8bffb0', homing: '#ff6fd8', pierce: '#ffd166', wide: '#5ad1ff',
    rapid: '#ff9f45', speed: '#a685ff', shield: '#66e0c8', heal: '#ff8fa3',
    escort: '#7ef0c0', torpedo: '#ffe08a'
  };
  const ITEM_LABELS = {
    spread: '3', homing: 'H', pierce: 'P', wide: 'W',
    rapid: 'R', speed: 'M', shield: 'B', heal: '+', escort: 'A', torpedo: 'T'
  };

  function drawItems() {
    for (const it of items) {
      ctx.save();
      ctx.translate(it.x, it.y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = ITEM_COLORS[it.type] || '#fff';
      ctx.fillRect(-it.r, -it.r, it.r * 2, it.r * 2);
      ctx.restore();

      ctx.fillStyle = '#04202b';
      ctx.font = `bold ${Math.round(it.r * 1.2)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ITEM_LABELS[it.type] || '?', it.x, it.y + 1);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawButton(r, glyph, active) {
    ctx.fillStyle = active ? 'rgba(79,209,255,0.55)' : 'rgba(255,255,255,0.12)';
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    roundRect(r.x, r.y, r.w, r.h, 10);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = active ? '#04202b' : '#dff7ff';
    ctx.font = `${Math.round(r.h * 0.45)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph, r.x + r.w / 2, r.y + r.h / 2 + 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  function drawControls() {
    ctx.fillStyle = '#03141d';
    ctx.fillRect(0, playH, W, controlBarH);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, playH + 0.5);
    ctx.lineTo(W, playH + 0.5);
    ctx.stroke();

    drawButton(buttons.up, '▲', controls.up);
    drawButton(buttons.down, '▼', controls.down);
    drawButton(buttons.left, '◀', controls.left);
    drawButton(buttons.right, '▶', controls.right);

    if (DEBUG) drawDebugButtons();
  }

  function drawDebugButtons() {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const key of ['stage', 'boss', 'invuln']) {
      const r = debugButtons[key];
      const active = key === 'invuln' && debugInvincible;
      ctx.fillStyle = active ? 'rgba(255,200,60,0.85)' : 'rgba(255,255,255,0.12)';
      ctx.strokeStyle = 'rgba(255,200,60,0.7)';
      ctx.lineWidth = 1.2;
      roundRect(r.x, r.y, r.w, r.h, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = active ? '#3a2a00' : '#ffd76a';
      ctx.font = '12px sans-serif';
      ctx.fillText(r.label, r.x + r.w / 2, r.y + r.h / 2 + 1);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  const ITEM_NAMES = { spread: '3-WAY', homing: 'HOMING', pierce: 'PIERCE', wide: 'WIDE', torpedo: 'TORPEDO' };

  function drawHud() {
    ctx.fillStyle = '#fff';
    ctx.font = '16px sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(`SCORE ${score}`, 12, 12);
    if (highScore > 0) {
      // 記録を抜いた瞬間からプレイ中もNEW RECORDを出す
      const beating = score > highScore;
      const sw = ctx.measureText(`SCORE ${score}`).width;
      ctx.fillStyle = beating ? '#ffd76a' : 'rgba(255,255,255,0.5)';
      ctx.font = '12px sans-serif';
      ctx.fillText(beating ? 'NEW RECORD' : `BEST ${highScore}`, 12 + sw + 12, 16);
      ctx.fillStyle = '#fff';
      ctx.font = '16px sans-serif';
    }
    const lifeText = 'LIFE ' + '♥'.repeat(Math.max(0, lives));
    ctx.fillText(lifeText, 12, 34);
    // 残りコンティニュー回数（減っているときだけ出す）。幅は描画に使った16pxのまま測る
    const lifeW = ctx.measureText(lifeText).width;
    if (continuesLeft < CONTINUE_MAX) {
      ctx.fillStyle = '#ffb0c0';
      ctx.font = '13px sans-serif';
      ctx.fillText(`CONTINUE ${continuesLeft}`, 12 + lifeW + 22, 36);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '13px sans-serif';
    ctx.fillText(`STAGE ${currentStage}/${STAGES.length}`, 12, 56);
    if (diveMode === 'diving' || diveMode === 'deep') {
      ctx.fillStyle = '#9fe6ff';
      ctx.fillText(`DEPTH ${Math.floor(diveDepth)}m`, 90, 56);
    }

    if (DEBUG) {
      ctx.fillStyle = '#ffd76a';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText(debugInvincible ? 'DEBUG (MUTEKI)' : 'DEBUG', 12, 74);
    }

    const badges = [];
    if (player.bulletType !== 'normal') {
      badges.push({ text: ITEM_NAMES[player.bulletType], color: ITEM_COLORS[player.bulletType] });
    }
    if (player.rapidFire) badges.push({ text: 'RAPID', color: ITEM_COLORS.rapid });
    if (player.speedBoost) badges.push({ text: 'SPEED', color: ITEM_COLORS.speed });
    if (player.shieldHp > 0) badges.push({ text: `SHIELD x${player.shieldHp}`, color: ITEM_COLORS.shield });
    if (escorts.length) badges.push({ text: `ESCORT x${escorts.length}`, color: ITEM_COLORS.escort });

    // デバッグ表示があるぶんバッジ行を下げて重ならないようにする
    const badgeY = DEBUG ? 94 : 76;
    let bx = 12;
    ctx.font = '14px sans-serif';
    for (const b of badges) {
      ctx.fillStyle = b.color;
      ctx.fillText(b.text, bx, badgeY);
      bx += ctx.measureText(b.text).width + 14;
    }
  }

  function drawStageBanner() {
    const t = stageBannerTimer;
    const alpha = t > 1.7 ? (2.2 - t) / 0.5 : Math.min(1, t / 0.5);
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 30px sans-serif';
    ctx.fillText(stageBannerText, W / 2, playH / 2);
    ctx.restore();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  function drawPauseButton() {
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    roundRect(pauseButton.x, pauseButton.y, pauseButton.w, pauseButton.h, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#dff7ff';
    const cx = pauseButton.x + pauseButton.w / 2;
    const cy = pauseButton.y + pauseButton.h / 2;
    if (state === STATE_PAUSED) {
      // 再生アイコン（三角）
      ctx.beginPath();
      ctx.moveTo(cx - 6, cy - 8);
      ctx.lineTo(cx - 6, cy + 8);
      ctx.lineTo(cx + 8, cy);
      ctx.closePath();
      ctx.fill();
    } else {
      // 一時停止アイコン（縦棒2本）
      const barW = 4, barH = 14, gap = 4;
      ctx.fillRect(cx - gap - barW, cy - barH / 2, barW, barH);
      ctx.fillRect(cx + gap, cy - barH / 2, barW, barH);
    }
    ctx.restore();
  }

  function muteButtonVisible() {
    return state === STATE_TITLE || state === STATE_PLAYING || state === STATE_PAUSED;
  }

  function drawMuteButton() {
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    roundRect(muteButton.x, muteButton.y, muteButton.w, muteButton.h, 8);
    ctx.fill();
    ctx.stroke();

    const cx = muteButton.x + muteButton.w / 2;
    const cy = muteButton.y + muteButton.h / 2;
    ctx.fillStyle = muted ? 'rgba(223,247,255,0.45)' : '#dff7ff';
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';

    // スピーカー本体
    ctx.beginPath();
    ctx.moveTo(cx - 9, cy - 3);
    ctx.lineTo(cx - 5, cy - 3);
    ctx.lineTo(cx - 1, cy - 8);
    ctx.lineTo(cx - 1, cy + 8);
    ctx.lineTo(cx - 5, cy + 3);
    ctx.lineTo(cx - 9, cy + 3);
    ctx.closePath();
    ctx.fill();

    if (muted) {
      // ミュート時はバツ印
      ctx.beginPath();
      ctx.moveTo(cx + 3, cy - 5);
      ctx.lineTo(cx + 11, cy + 5);
      ctx.moveTo(cx + 11, cy - 5);
      ctx.lineTo(cx + 3, cy + 5);
      ctx.stroke();
    } else {
      // 音が出ているときは音波
      ctx.beginPath();
      ctx.arc(cx - 1, cy, 6, -Math.PI / 3, Math.PI / 3);
      ctx.moveTo(cx + 8, cy - 5);
      ctx.arc(cx - 1, cy, 10, -Math.PI / 3.4, Math.PI / 3.4);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPauseOverlay() {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText('PAUSED', W / 2, H / 2 - 40);
    ctx.font = '15px sans-serif';
    ctx.fillText('右上のボタンで再開', W / 2, H / 2 - 6);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    drawButton(restartButton, 'RESTART', false);
  }

  // 潜るほど暗くなる深海の闇（縦穴を抜けたあとも深海のままなので暗さを残す）
  function drawDepthDarkness() {
    // 横スクロールに戻ったあとはボスや敵が見えにくくならないよう少し明るくする
    const cap = diveMode === 'deep' ? 0.5 : 0.72;
    const k = Math.min(cap, diveDepth / 2600);
    ctx.fillStyle = `rgba(0,8,16,${k})`;
    ctx.fillRect(0, 0, W, playH);
  }

  // 5面専用: 自機の周りだけを照らすライト。全オブジェクト描画後に乗算合成で重ねることで、
  // ライトの外側は暗く沈みつつも発光生物（shadowBlurで光る敵・弾）だけはうっすら見える
  function drawPlayerLight() {
    const innerR = 85;
    const outerR = 240;
    const grad = ctx.createRadialGradient(player.x, player.y, 0, player.x, player.y, outerR);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(innerR / outerR, 'rgba(255,255,255,1)');
    grad.addColorStop(1, 'rgba(16,20,26,1)');
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, playH);
    ctx.restore();
  }

  // 潜航中の縦穴（左右の岩壁）
  function drawCaveWalls() {
    const step = 5;
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, '#233a30');
    grad.addColorStop(0.5, '#0c1a14');
    grad.addColorStop(1, '#233a30');

    ctx.fillStyle = grad;
    // 左の壁
    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (let sy = 0; sy <= playH; sy += step) ctx.lineTo(caveLeftAt(sy), sy);
    ctx.lineTo(0, playH);
    ctx.closePath();
    ctx.fill();
    // 右の壁
    ctx.beginPath();
    ctx.moveTo(W, 0);
    for (let sy = 0; sy <= playH; sy += step) ctx.lineTo(caveRightAt(sy), sy);
    ctx.lineTo(W, playH);
    ctx.closePath();
    ctx.fill();

    // 壁面のハイライト
    ctx.strokeStyle = 'rgba(255,255,255,0.09)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let sy = 0; sy <= playH; sy += step) {
      const x = caveLeftAt(sy);
      if (sy === 0) ctx.moveTo(x, sy); else ctx.lineTo(x, sy);
    }
    ctx.stroke();
    ctx.beginPath();
    for (let sy = 0; sy <= playH; sy += step) {
      const x = caveRightAt(sy);
      if (sy === 0) ctx.moveTo(x, sy); else ctx.lineTo(x, sy);
    }
    ctx.stroke();
  }

  function drawCenterText(lines) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let y = H / 2 - (lines.length - 1) * 16;
    for (const line of lines) {
      ctx.font = line.font || '22px sans-serif';
      ctx.fillStyle = line.color || '#fff';
      ctx.fillText(line.text, W / 2, y);
      y += line.gap || 32;   // 大きい文字の行は個別に間隔を広げられる
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  function render() {
    drawOceanBackground();

    // コンティニュー確認中も、どこで力尽きたか分かるよう盤面を残したまま上に重ねる
    if (state === STATE_PLAYING || state === STATE_PAUSED || state === STATE_CONTINUE) {
      // 揺らすのは盤面だけ。HUDや操作ボタンは動かさない
      ctx.save();
      if (shakeT > 0) {
        const k = shakeMag * Math.min(1, shakeT / 0.2);
        ctx.translate((Math.random() - 0.5) * k * 2, (Math.random() - 0.5) * k * 2);
      }
      const isDarkDive = STAGES[currentStage - 1].hazard === 'darkdive';
      if (diveMode === 'diving') {
        if (!isDarkDive) drawDepthDarkness();
        drawCaveWalls();
      } else {
        if (diveMode === 'deep' && !isDarkDive) drawDepthDarkness();
        drawTerrain();
        if (diveMode === 'deep') drawCeiling();
      }
      if (volcanoActive) drawVolcanoes();
      if (wreckageActive) drawWreckage();
      for (const wp of whirlpools) drawWhirlpool(wp);
      drawEnemies();
      drawItems();
      drawBoss();
      drawBullets();
      drawPlayerBubbles();
      drawEscorts();
      drawShieldEffect();
      drawPlayer();
      drawParticles();
      // 墨は自機や敵の上に被せて視界を奪う（HUDより下）
      drawInk();
      // 5面の暗闇は全オブジェクトを描いたあとにポストプロセスとして重ねる
      if (isDarkDive && (diveMode === 'diving' || diveMode === 'deep')) drawPlayerLight();
      ctx.restore();

      drawHud();
      drawControls();
      if (state === STATE_PLAYING && stageBannerTimer > 0) drawStageBanner();
      if (state === STATE_PAUSED) drawPauseOverlay();
      if (state !== STATE_CONTINUE) {
        drawPauseButton();
        drawMuteButton();
      }
    }

    if (state === STATE_ENDING) {
      drawEnding();
    } else if (state === STATE_TITLE) {
      const titleLines = [
        { text: 'DEEP DIVER', font: 'bold 40px sans-serif', gap: 50 },
        { text: 'タップでスタート', font: '18px sans-serif' }
      ];
      if (highScore > 0) {
        titleLines.push({ text: `BEST ${highScore}`, font: '15px sans-serif' });
      }
      drawCenterText(titleLines);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(GAME_VERSION, W / 2, H - 14);
      ctx.textAlign = 'left';
      drawMuteButton();
    } else if (state === STATE_CONTINUE) {
      drawCenterText([
        { text: 'CONTINUE?', font: 'bold 26px sans-serif' },
        { text: `のこり ${continuesLeft}回`, font: '18px sans-serif' },
        {
          text: checkpointAtBoss ? 'タップでボス戦から再開' : `タップでステージ${currentStage}の最初から再開`,
          font: '15px sans-serif'
        }
      ]);
    } else if (state === STATE_GAMEOVER) {
      drawCenterText([
        { text: 'GAME OVER', font: 'bold 26px sans-serif' },
        { text: `SCORE ${score}`, font: '18px sans-serif' },
        newRecord
          ? { text: 'NEW RECORD!', font: 'bold 17px sans-serif', color: '#ffd76a' }
          : { text: `BEST ${highScore}`, font: '15px sans-serif', color: 'rgba(255,255,255,0.65)' },
        { text: 'タップでリスタート', font: '16px sans-serif' }
      ]);
    }
  }

  // ---------- メインループ ----------
  let lastTime = null;
  function loop(now) {
    if (lastTime === null) lastTime = now;
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    update(dt);
    render();

    requestAnimationFrame(loop);
  }

  loadHighScore();
  resize();
  initBubbles();
  resetPlayer();
  requestAnimationFrame(loop);

})();
