(() => {
  'use strict';

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  // バージョン番号は version.js（自動生成ファイル）で定義される
  const GAME_VERSION = window.GAME_VERSION || 'v0.0.0';

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

  // ---------- ゲーム状態 ----------
  const STATE_TITLE = 'title';
  const STATE_PLAYING = 'playing';
  const STATE_PAUSED = 'paused';
  const STATE_GAMEOVER = 'gameover';
  const STATE_CLEAR = 'clear';

  let state = STATE_TITLE;
  let score = 0;
  let lives = 3;
  let elapsed = 0;
  let killCount = 0;
  const BOSS_KILL_THRESHOLD = 30;
  const MAX_LIVES = 5;

  // ---------- 面構成 ----------
  const STAGE_BOSSES = [
    { kind: 'shark', hp: 60, score: 500 },
    { kind: 'crab', hp: 75, score: 650 },
    { kind: 'squid', hp: 95, score: 800 }
  ];
  let currentStage = 1;
  let stageBannerTimer = 0;
  let stageBannerText = '';

  // ---------- 潜航ステージ ----------
  // ステージ3では途中で海底が途切れて大穴になり、そこへ潜ると縦スクロールに切り替わる。
  const DIVE_STAGE = 3;
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
    if (state === STATE_TITLE || state === STATE_GAMEOVER || state === STATE_CLEAR) {
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
    volcano = null;
    volcanoSpawned = false;
    whirlpool = null;
    whirlpoolSpawned = false;
    player.caught = false;
    resetDive();
    killCount = 0;
    spawnTimer = Math.max(spawnTimer, 1.2);
    if (currentStage < STAGE_BOSSES.length) {
      currentStage += 1;
      stageBannerTimer = 2.2;
      stageBannerText = `STAGE ${currentStage}`;
    } else {
      state = STATE_CLEAR;
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

  // ---------- 海底（起伏のある地形。当たり判定あり） ----------
  const TERRAIN_SCROLL_SPEED = 110;
  const TERRAIN_PERIOD = 700;
  let terrainOffset = 0;

  // 決定的な擬似乱数（同じnには常に同じ値を返す）
  function terrainHash(n) {
    const s = Math.sin(n * 12.9898) * 43758.5453123;
    return s - Math.floor(s);
  }

  // ワールド座標x（画面スクロール分を含む）における海底の高さ（playHからの隆起量）
  function terrainHeightAt(worldX) {
    const rolling = 14 + Math.sin(worldX * 0.004) * 8 + Math.sin(worldX * 0.011 + 1.7) * 5;

    // ゴツゴツした岩肌の凹凸（高周波の山なりを複数重ね、鋭い突起にする）
    const jag =
      Math.abs(Math.sin(worldX * 0.09 + 3.1)) * 7 +
      Math.abs(Math.sin(worldX * 0.23 + 1.2)) * 4 +
      Math.abs(Math.sin(worldX * 0.53 + 5.4)) * 2.2;

    const periodIndex = Math.floor(worldX / TERRAIN_PERIOD);
    const r1 = terrainHash(periodIndex);
    const r2 = terrainHash(periodIndex + 100);
    const r3 = terrainHash(periodIndex + 200);

    let mountain = 0;
    if (r1 < 0.6) {
      const center = periodIndex * TERRAIN_PERIOD + TERRAIN_PERIOD * (0.3 + r2 * 0.4);
      const halfWidth = 140 + r3 * 110;
      const d = worldX - center;
      if (Math.abs(d) < halfWidth) {
        const t = d / halfWidth;
        const peakH = playH * 0.18 + r1 * (playH * 0.22); // 控えめ〜プレイエリアの4割程度
        mountain = Math.cos((t * Math.PI) / 2) ** 2 * peakH;
      }
    }
    return (rolling + jag + mountain) * holeMask(worldX);
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
    return diveMode === 'diving' ? collidesCave(x, y, r) : collidesTerrain(x, y, r);
  }

  // 画面座標xにおける海底の表面のy座標
  function terrainSurfaceY(screenX) {
    return playH - terrainHeightAt(screenX + terrainOffset);
  }

  function collidesTerrain(x, y, r) {
    return y + r > terrainSurfaceY(x);
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
  // 潜航中は縦穴の中を左右いっぱいに動けるようにする
  function playerMaxX() { return diveMode === 'diving' ? W - player.size - 4 : W * 0.6; }

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
  const BASE_FIRE_INTERVAL = 0.38;
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
      push(BULLET_SPEED * 0.85, 0, { r: 10, type: 'wide' });
    } else {
      push(BULLET_SPEED, 0, { r: 4, type: 'normal' });
    }
  }

  function findNearestTarget(x, y) {
    let best = null;
    let bestDist = Infinity;
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
  let spawnInterval = 1.4;

  function spawnEnemy() {
    const r = Math.random();
    const y = 40 + Math.random() * (playH - 80);
    if (r < 0.4) {
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
    } else if (r < 0.75) {
      enemies.push({
        type: 'sine', x: W + 30, y, baseY: y, vx: -140,
        amp: 40 + Math.random() * 40, freq: 1.5 + Math.random(), t: 0,
        r: 14, hp: 1, score: 15
      });
    } else {
      enemies.push({
        type: 'shooter', x: W + 30, y, vx: -90, vy: 0,
        r: 16, hp: 2, score: 25, fireCooldown: 1.2 + Math.random()
      });
    }
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
    }
  }

  // ---------- 火山 ----------
  let volcano = null;
  let volcanoSpawned = false;
  const VOLCANO_TRIGGER_KILLS = 14;

  function spawnVolcano() {
    volcano = {
      x: W - 60,
      y: playH - 16,
      r: 34,
      fireCooldown: 0.5
    };
  }

  function updateVolcano(dt) {
    if (!volcano) return;
    volcano.fireCooldown -= dt;
    if (volcano.fireCooldown <= 0) {
      volcano.fireCooldown = 0.3 + Math.random() * 0.7;
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.95;
      const speed = 190 + Math.random() * 230;
      spawnEnemyBullet(
        volcano.x, volcano.y - volcano.r * 1.5,
        Math.cos(angle) * speed, Math.sin(angle) * speed,
        { r: 8, lava: true }
      );
    }
  }

  // ---------- 渦（ステージ2で火山の代わりに出現する） ----------
  let whirlpool = null;
  let whirlpoolSpawned = false;
  const WHIRLPOOL_STAGE = 2;
  const WHIRLPOOL_TRIGGER_KILLS = 14;
  const WHIRLPOOL_SPIN_SPEED = 3.6;   // 捕まっている間の回転角速度(rad/s)
  const WHIRLPOOL_SINK_SPEED = 76;    // 下へ引きずり込まれる速さ(px/s)
  const WHIRLPOOL_TOP_R = 86;         // 漏斗の口の半径
  const WHIRLPOOL_DEPTH = 210;        // 漏斗の深さ

  function spawnWhirlpool() {
    whirlpool = {
      x: W + 120,
      y: playH * 0.18 + Math.random() * playH * 0.12,  // 漏斗の口（上端）
      r: WHIRLPOOL_TOP_R,
      depth: WHIRLPOOL_DEPTH,
      vx: -46,
      t: 0
    };
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

  function updateWhirlpool(dt) {
    if (!whirlpool) return;
    whirlpool.t += dt;
    whirlpool.x += whirlpool.vx * dt;
    if (whirlpool.x < -whirlpool.r * 1.6) {
      whirlpool = null;
      player.caught = false;
    }
  }

  // 渦に入っている間は操作を奪い、回転させながら下へ引きずり込む
  function applyWhirlpool(dt) {
    if (!whirlpool) {
      player.caught = false;
      return false;
    }
    const wp = whirlpool;
    const bottom = whirlpoolBottomY(wp);
    const dx = player.x - wp.x;
    // 漏斗の内側（上端より少し上から底まで）にいるときだけ捕まる
    if (player.y < wp.y - 24 || player.y > bottom + 12 ||
        Math.abs(dx) > whirlpoolRadiusAt(wp, player.y) + 14) {
      player.caught = false;
      return false;
    }

    player.caught = true;
    // 縦軸のまわりを回りながら沈んでいく
    const newY = Math.min(bottom, Math.max(wp.y, player.y) + WHIRLPOOL_SINK_SPEED * dt);
    const angle = Math.atan2(0, 1) + wp.t * WHIRLPOOL_SPIN_SPEED;
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
        volcano = null;
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
    crab: [-110, -55, 0, 55, 110]
  };

  function spawnBoss() {
    const def = STAGE_BOSSES[currentStage - 1];
    const baseX = W - 140;
    boss = {
      kind: def.kind,
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
      tentacleTargetY: 0
    };
    enemies = [];
    enemyBullets = [];
    volcano = null;
    whirlpool = null;
    player.caught = false;
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
          boss.tentacleCooldown = 3.2 + Math.random() * 1.8;
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

    boss.fireCooldown -= dt;
    if (boss.fireCooldown <= 0) {
      if (boss.kind === 'squid') {
        boss.fireCooldown = 1.1;
        const n = 8;
        const speed = 180;
        for (let i = 0; i < n; i++) {
          const a = (Math.PI * 2 * i) / n + boss.t;
          spawnEnemyBullet(boss.x, boss.y, Math.cos(a) * speed, Math.sin(a) * speed);
        }
      } else if (boss.kind === 'crab') {
        boss.fireCooldown = 0.85;
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
  const SHIELD_MAX_HITS = 2;  // バリアが耐えられる被弾回数
  const BULLET_ITEM_TYPES = ['spread', 'homing', 'pierce', 'wide'];
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
      if (player.shieldHp === 0) player.shieldPopTimer = 0.4;
      return;
    }
    lives -= 1;
    player.invuln = 1.5;
    if (lives <= 0) {
      state = STATE_GAMEOVER;
    }
  }

  // ---------- ゲーム開始/更新 ----------
  function startGame() {
    state = STATE_PLAYING;
    score = 0;
    lives = 3;
    elapsed = 0;
    killCount = 0;
    enemies = [];
    playerBullets = [];
    enemyBullets = [];
    items = [];
    escorts = [];
    boss = null;
    volcano = null;
    volcanoSpawned = false;
    whirlpool = null;
    whirlpoolSpawned = false;
    resetDive();
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

    if (state !== STATE_PLAYING) return;

    updateTerrain(dt);

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

    // 地形との当たり判定（潜航中は縦穴の左右の岩壁）
    if (diveMode === 'diving') {
      if (collidesCave(player.x, player.y, player.hitRadius)) {
        hitPlayer();
        const l = caveLeftAt(player.y) + player.hitRadius;
        const r = caveRightAt(player.y) - player.hitRadius;
        player.x = Math.max(l, Math.min(r, player.x));
      }
    } else if (collidesTerrain(player.x, player.y, player.hitRadius)) {
      hitPlayer();
      player.y = terrainSurfaceY(player.x) - player.hitRadius;
    }

    player.fireCooldown -= dt;
    if (player.fireCooldown <= 0) {
      player.fireCooldown = player.rapidFire ? RAPID_FIRE_INTERVAL : BASE_FIRE_INTERVAL;
      spawnPlayerBullet();
    }

    for (const b of playerBullets) {
      if (b.homing) {
        const target = findNearestTarget(b.x, b.y);
        if (target) {
          const desiredAngle = Math.atan2(target.y - b.y, target.x - b.x);
          const curAngle = Math.atan2(b.vy, b.vx);
          let diff = desiredAngle - curAngle;
          diff = Math.atan2(Math.sin(diff), Math.cos(diff));
          const maxTurn = 6 * dt;
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
          spawnTimer = 0.9;
          spawnDiveEnemy();
        } else {
          spawnTimer = spawnInterval;
          spawnEnemy();
        }
      }
      for (const e of enemies) updateEnemy(e, dt);
      enemies = enemies.filter(e =>
        e.x > -40 && e.y > -60 && e.y < playH + 80 && !collidesWorld(e.x, e.y, e.r)
      );

      // ステージごとの障害（ステージ2は渦、ステージ3は大穴＝潜航、その他は火山）
      if (currentStage === WHIRLPOOL_STAGE) {
        if (!whirlpoolSpawned && killCount >= WHIRLPOOL_TRIGGER_KILLS) {
          whirlpoolSpawned = true;
          spawnWhirlpool();
        }
      } else if (currentStage === DIVE_STAGE) {
        updateDive(dt);
      } else if (!volcanoSpawned && killCount >= VOLCANO_TRIGGER_KILLS) {
        volcanoSpawned = true;
        spawnVolcano();
      }
      updateVolcano(dt);
      updateWhirlpool(dt);

      // 潜航ステージでは撃破数ではなく、縦穴を抜けて深海を少し進むとボスが現れる
      if (currentStage === DIVE_STAGE) {
        if (diveMode === 'deep' && deepTimer <= 0) {
          spawnBoss();
        }
      } else if (killCount >= BOSS_KILL_THRESHOLD) {
        spawnBoss();
      }
    } else {
      updateBoss(dt);
    }

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
          e.hp -= 1;
        }
      }
    }
    for (const e of enemies) {
      if (e.hp <= 0 && !e.dead) {
        e.dead = true;
        score += e.score;
        killCount += 1;
        if (Math.random() < ITEM_DROP_CHANCE) spawnItem(e.x, e.y);
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
          boss.hp -= 1;
        }
      }
      if (boss.hp <= 0) {
        score += STAGE_BOSSES[currentStage - 1].score;
        boss = null;
        if (currentStage < STAGE_BOSSES.length) {
          currentStage += 1;
          killCount = 0;
          volcanoSpawned = false;
          whirlpoolSpawned = false;
          resetDive();
          spawnTimer = Math.max(spawnTimer, 1.2);
          stageBannerTimer = 2.2;
          stageBannerText = `STAGE ${currentStage}`;
        } else {
          state = STATE_CLEAR;
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
      else drawFishEnemy(e);
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

  function drawSquidBossBody(R) {
    const mantleColor = '#7a1f3d';
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

  function drawBoss() {
    if (!boss) return;
    const R = boss.r;
    ctx.save();
    ctx.translate(boss.x, boss.y);

    if (boss.kind === 'crab') drawCrabBossBody(R);
    else if (boss.kind === 'squid') drawSquidBossBody(R);
    else drawSharkBossBody(R);

    ctx.restore();

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
    pierce: '#ffd166', wide: '#5ad1ff', escort: '#7ef0c0'
  };

  function drawBullets() {
    for (const b of playerBullets) {
      ctx.fillStyle = BULLET_COLORS[b.type] || BULLET_COLORS.normal;
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

  function drawVolcano(v) {
    ctx.save();
    ctx.translate(v.x, v.y);
    // 山体
    ctx.fillStyle = '#3a2a22';
    ctx.beginPath();
    ctx.moveTo(-v.r * 1.6, 0);
    ctx.lineTo(-v.r * 0.5, -v.r * 1.6);
    ctx.lineTo(v.r * 0.5, -v.r * 1.6);
    ctx.lineTo(v.r * 1.6, 0);
    ctx.closePath();
    ctx.fill();
    // 溶岩の筋
    ctx.strokeStyle = 'rgba(255,120,30,0.55)';
    ctx.lineWidth = Math.max(2, v.r * 0.08);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-v.r * 0.15, -v.r * 1.4);
    ctx.lineTo(-v.r * 0.5, 0);
    ctx.moveTo(v.r * 0.2, -v.r * 1.3);
    ctx.lineTo(v.r * 0.55, 0);
    ctx.stroke();
    // 火口の光（明滅）
    const glow = 0.6 + 0.4 * Math.sin(Date.now() / 150);
    ctx.shadowColor = '#ff8a1a';
    ctx.shadowBlur = 16 + glow * 14;
    ctx.fillStyle = `rgba(255,140,40,${glow})`;
    ctx.beginPath();
    ctx.ellipse(0, -v.r * 1.55, v.r * 0.45, v.r * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const ITEM_COLORS = {
    spread: '#8bffb0', homing: '#ff6fd8', pierce: '#ffd166', wide: '#5ad1ff',
    rapid: '#ff9f45', speed: '#a685ff', shield: '#66e0c8', heal: '#ff8fa3',
    escort: '#7ef0c0'
  };
  const ITEM_LABELS = {
    spread: '3', homing: 'H', pierce: 'P', wide: 'W',
    rapid: 'R', speed: 'M', shield: 'B', heal: '+', escort: 'A'
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

  const ITEM_NAMES = { spread: '3-WAY', homing: 'HOMING', pierce: 'PIERCE', wide: 'WIDE' };

  function drawHud() {
    ctx.fillStyle = '#fff';
    ctx.font = '16px sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(`SCORE ${score}`, 12, 12);
    ctx.fillText('LIFE ' + '♥'.repeat(Math.max(0, lives)), 12, 34);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '13px sans-serif';
    ctx.fillText(`STAGE ${currentStage}/${STAGE_BOSSES.length}`, 12, 56);
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
      ctx.fillText(line.text, W / 2, y);
      y += 32;
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  function render() {
    drawOceanBackground();

    if (state === STATE_PLAYING || state === STATE_PAUSED) {
      if (diveMode === 'diving') {
        drawDepthDarkness();
        drawCaveWalls();
      } else {
        if (diveMode === 'deep') drawDepthDarkness();
        drawTerrain();
      }
      if (volcano) drawVolcano(volcano);
      if (whirlpool) drawWhirlpool(whirlpool);
      drawEnemies();
      drawItems();
      drawBoss();
      drawBullets();
      drawPlayerBubbles();
      drawEscorts();
      drawShieldEffect();
      drawPlayer();
      drawHud();
      drawControls();
      if (state === STATE_PLAYING && stageBannerTimer > 0) drawStageBanner();
      if (state === STATE_PAUSED) drawPauseOverlay();
      drawPauseButton();
    } else if (state === STATE_TITLE) {
      drawCenterText([
        { text: '横スクロールシューティング', font: 'bold 24px sans-serif' },
        { text: 'タップでスタート', font: '18px sans-serif' }
      ]);
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(GAME_VERSION, W / 2, H - 14);
      ctx.textAlign = 'left';
    } else if (state === STATE_GAMEOVER) {
      drawCenterText([
        { text: 'GAME OVER', font: 'bold 26px sans-serif' },
        { text: `SCORE ${score}`, font: '18px sans-serif' },
        { text: 'タップでリスタート', font: '16px sans-serif' }
      ]);
    } else if (state === STATE_CLEAR) {
      drawCenterText([
        { text: 'ALL CLEAR!', font: 'bold 26px sans-serif' },
        { text: `SCORE ${score}`, font: '18px sans-serif' },
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

  resize();
  initBubbles();
  resetPlayer();
  requestAnimationFrame(loop);

})();
