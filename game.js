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
  const STATE_GAMEOVER = 'gameover';
  const STATE_CLEAR = 'clear';

  let state = STATE_TITLE;
  let score = 0;
  let lives = 3;
  let elapsed = 0;
  let killCount = 0;
  const BOSS_KILL_THRESHOLD = 20;
  const MAX_LIVES = 5;

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
    const padCY = playH + controlBarH / 2;

    buttons.up = { x: padCX - btn / 2, y: padCY - cell, w: btn, h: btn };
    buttons.down = { x: padCX - btn / 2, y: padCY + gap, w: btn, h: btn };
    buttons.left = { x: padCX - cell - btn / 2, y: padCY - btn / 2, w: btn, h: btn };
    buttons.right = { x: padCX + cell - btn / 2, y: padCY - btn / 2, w: btn, h: btn };
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

  function onTouchStart(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      activePointers.set(t.identifier, localPos(t.clientX, t.clientY));
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
    activePointers.set(MOUSE_ID, localPos(e.clientX, e.clientY));
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
    shield: false
  };

  function resetPlayer() {
    player.x = Math.max(60, W * 0.15);
    player.y = playH / 2;
    player.invuln = 1.0;
    player.fireCooldown = 0;
    player.bulletType = 'normal';
    player.rapidFire = false;
    player.speedBoost = false;
    player.shield = false;
  }

  function playerMinX() { return player.size + 4; }
  function playerMaxX() { return W * 0.6; }

  // ---------- 弾 ----------
  let playerBullets = [];
  let enemyBullets = [];

  const BULLET_SPEED = 620;
  const BASE_FIRE_INTERVAL = 0.38;
  const RAPID_FIRE_INTERVAL = 0.15;
  const MOVE_SPEED_NORMAL = 260;
  const MOVE_SPEED_BOOST = 400;

  function spawnPlayerBullet() {
    const x = player.x + player.size;
    const y = player.y;
    if (player.bulletType === 'spread') {
      const angles = [-0.28, 0, 0.28];
      for (const a of angles) {
        playerBullets.push({
          x, y,
          vx: Math.cos(a) * BULLET_SPEED,
          vy: Math.sin(a) * BULLET_SPEED,
          r: 4, type: 'spread'
        });
      }
    } else if (player.bulletType === 'homing') {
      playerBullets.push({ x, y, vx: BULLET_SPEED, vy: 0, r: 5, type: 'homing', homing: true });
    } else if (player.bulletType === 'pierce') {
      playerBullets.push({ x, y, vx: BULLET_SPEED, vy: 0, r: 5, type: 'pierce', pierce: true });
    } else if (player.bulletType === 'wide') {
      playerBullets.push({ x, y, vx: BULLET_SPEED * 0.85, vy: 0, r: 10, type: 'wide' });
    } else {
      playerBullets.push({ x, y, vx: BULLET_SPEED, vy: 0, r: 4, type: 'normal' });
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

  function spawnEnemyBullet(x, y, vx, vy) {
    enemyBullets.push({ x, y, vx, vy, r: 5 });
  }

  // ---------- 敵 ----------
  let enemies = [];
  let spawnTimer = 0;
  let spawnInterval = 1.4;

  function spawnEnemy() {
    const r = Math.random();
    const y = 40 + Math.random() * (playH - 80);
    if (r < 0.4) {
      enemies.push({
        type: 'straight', x: W + 30, y, vx: -160, vy: 0,
        r: 14, hp: 1, score: 10
      });
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
    if (e.type === 'straight') {
      e.x += e.vx * dt;
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
        spawnEnemyBullet(e.x, e.y, (dx / len) * speed, (dy / len) * speed);
      }
    }
  }

  // ---------- ボス ----------
  let boss = null;

  function spawnBoss() {
    boss = {
      x: W - 140,
      y: playH / 2,
      targetX: W - 140,
      r: 46,
      hp: 60,
      maxHp: 60,
      t: 0,
      fireCooldown: 1.0
    };
    enemies = [];
    enemyBullets = [];
  }

  function updateBoss(dt) {
    if (!boss) return;
    boss.t += dt;
    boss.x += (boss.targetX - boss.x) * Math.min(1, dt * 2);
    boss.y = playH / 2 + Math.sin(boss.t * 0.8) * (playH * 0.28);
    boss.fireCooldown -= dt;
    if (boss.fireCooldown <= 0) {
      boss.fireCooldown = 0.9;
      const speed = 220;
      for (let i = -1; i <= 1; i++) {
        const dx = (player.x - boss.x);
        const dy = (player.y - boss.y) + i * 60;
        const len = Math.max(1, Math.hypot(dx, dy));
        spawnEnemyBullet(boss.x, boss.y, (dx / len) * speed, (dy / len) * speed);
      }
    }
  }

  // ---------- アイテム ----------
  let items = [];
  const ITEM_DROP_CHANCE = 0.22;
  const BULLET_ITEM_TYPES = ['spread', 'homing', 'pierce', 'wide'];
  const ITEM_TYPES = [...BULLET_ITEM_TYPES, 'rapid', 'speed', 'shield', 'heal'];

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
      player.shield = true;
    } else if (type === 'heal') {
      lives = Math.min(lives + 1, MAX_LIVES);
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
    if (player.invuln > 0) return;
    if (player.shield) {
      player.shield = false;
      player.invuln = 0.6;
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
    boss = null;
    spawnTimer = 0;
    initBubbles();
    resetPlayer();
  }

  function update(dt) {
    updateBubbles(dt);

    if (state !== STATE_PLAYING) return;

    elapsed += dt;
    if (player.invuln > 0) player.invuln -= dt;

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
    player.y = Math.max(player.size, Math.min(playH - player.size, player.y));
    player.x = Math.max(playerMinX(), Math.min(playerMaxX(), player.x));

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
    playerBullets = playerBullets.filter(b => b.x > -20 && b.x < W + 20 && b.y > -20 && b.y < playH + 20);

    for (const b of enemyBullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }
    enemyBullets = enemyBullets.filter(b => b.x > -20 && b.x < W + 20 && b.y > -20 && b.y < playH + 20);

    if (!boss) {
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        spawnTimer = spawnInterval;
        spawnEnemy();
      }
      for (const e of enemies) updateEnemy(e, dt);
      enemies = enemies.filter(e => e.x > -40);

      if (killCount >= BOSS_KILL_THRESHOLD) {
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
        score += 500;
        boss = null;
        state = STATE_CLEAR;
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
  }

  // ---------- 描画 ----------
  function drawPlayer() {
    if (player.invuln > 0 && Math.floor(player.invuln * 12) % 2 === 0) return;
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.fillStyle = '#4fd1ff';
    ctx.beginPath();
    ctx.moveTo(player.size, 0);
    ctx.lineTo(-player.size * 0.7, -player.size * 0.7);
    ctx.lineTo(-player.size * 0.3, 0);
    ctx.lineTo(-player.size * 0.7, player.size * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawFishEnemy(e) {
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.fillStyle = '#ff5c7a';
    // 尾びれ（進行方向の後ろ側）
    ctx.beginPath();
    ctx.moveTo(e.r * 0.6, 0);
    ctx.lineTo(e.r * 1.6, -e.r * 0.7);
    ctx.lineTo(e.r * 1.6, e.r * 0.7);
    ctx.closePath();
    ctx.fill();
    // 胴体
    ctx.beginPath();
    ctx.ellipse(0, 0, e.r, e.r * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();
    // 背びれ
    ctx.beginPath();
    ctx.moveTo(-e.r * 0.1, -e.r * 0.55);
    ctx.lineTo(e.r * 0.25, -e.r * 1.05);
    ctx.lineTo(e.r * 0.45, -e.r * 0.5);
    ctx.closePath();
    ctx.fill();
    // 目
    ctx.fillStyle = '#2a0410';
    ctx.beginPath();
    ctx.arc(-e.r * 0.45, -e.r * 0.12, e.r * 0.14, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawJellyEnemy(e) {
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#ffd24c';
    // 傘（ドーム）
    ctx.beginPath();
    ctx.arc(0, -e.r * 0.1, e.r, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    // 触手（波打つ）
    ctx.strokeStyle = '#ffd24c';
    ctx.lineWidth = 2;
    const t = e.t || 0;
    for (let i = -2; i <= 2; i++) {
      const baseX = i * e.r * 0.35;
      const midX = baseX + Math.sin(t * 3 + i) * e.r * 0.25;
      const endX = baseX + Math.sin(t * 3 + i + 1) * e.r * 0.35;
      ctx.beginPath();
      ctx.moveTo(baseX, -e.r * 0.1);
      ctx.quadraticCurveTo(midX, e.r * 0.7, endX, e.r * 1.3);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawSpikyEnemy(e) {
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.fillStyle = '#ff8a4c';
    // とげ
    const spikes = 8;
    ctx.beginPath();
    for (let i = 0; i < spikes; i++) {
      const a1 = (Math.PI * 2 * i) / spikes;
      const a2 = a1 + Math.PI / spikes;
      ctx.lineTo(Math.cos(a1) * e.r * 0.95, Math.sin(a1) * e.r * 0.95);
      ctx.lineTo(Math.cos(a2) * e.r * 1.5, Math.sin(a2) * e.r * 1.5);
    }
    ctx.closePath();
    ctx.fill();
    // 本体
    ctx.beginPath();
    ctx.arc(0, 0, e.r * 0.95, 0, Math.PI * 2);
    ctx.fill();
    // 目（発射直前は光る）
    const aboutToFire = e.fireCooldown !== undefined && e.fireCooldown < 0.3;
    ctx.fillStyle = aboutToFire ? '#fff5cc' : '#2a1204';
    ctx.beginPath();
    ctx.arc(-e.r * 0.3, 0, e.r * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawEnemies() {
    for (const e of enemies) {
      if (e.type === 'sine') drawJellyEnemy(e);
      else if (e.type === 'shooter') drawSpikyEnemy(e);
      else drawFishEnemy(e);
    }
  }

  function drawBoss() {
    if (!boss) return;
    ctx.save();
    ctx.translate(boss.x, boss.y);

    // 尾びれ
    ctx.fillStyle = '#c34cff';
    ctx.beginPath();
    ctx.moveTo(boss.r * 0.5, 0);
    ctx.lineTo(boss.r * 1.5, -boss.r * 0.6);
    ctx.lineTo(boss.r * 1.5, boss.r * 0.6);
    ctx.closePath();
    ctx.fill();

    // 胴体
    ctx.beginPath();
    ctx.ellipse(0, 0, boss.r, boss.r * 0.78, 0, 0, Math.PI * 2);
    ctx.fill();

    // 牙（ジグザグ）
    ctx.fillStyle = '#fff';
    const teeth = 6;
    const jawY = boss.r * 0.35;
    const jawW = boss.r * 0.9;
    ctx.beginPath();
    ctx.moveTo(-jawW / 2, jawY);
    for (let i = 0; i <= teeth; i++) {
      const tx = -jawW / 2 + (jawW * i) / teeth;
      const ty = jawY + (i % 2 === 0 ? boss.r * 0.22 : 0);
      ctx.lineTo(tx, ty);
    }
    ctx.lineTo(jawW / 2, jawY);
    ctx.closePath();
    ctx.fill();

    // ちょうちん（触角＋光る玉）
    const glow = 0.6 + Math.sin(boss.t * 4) * 0.4;
    ctx.strokeStyle = '#c34cff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-boss.r * 0.2, -boss.r * 0.7);
    ctx.quadraticCurveTo(-boss.r * 0.7, -boss.r * 1.5, -boss.r * 1.1, -boss.r * 1.6);
    ctx.stroke();
    ctx.fillStyle = `rgba(255,240,180,${glow})`;
    ctx.beginPath();
    ctx.arc(-boss.r * 1.1, -boss.r * 1.6, boss.r * 0.18, 0, Math.PI * 2);
    ctx.fill();

    // 目
    ctx.fillStyle = '#1a0424';
    ctx.beginPath();
    ctx.arc(-boss.r * 0.35, -boss.r * 0.15, boss.r * 0.12, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    const barW = Math.min(220, W - 140);
    const barX = W - barW - 16;
    const barY = 16;
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(barX, barY, barW, 10);
    ctx.fillStyle = '#c34cff';
    ctx.fillRect(barX, barY, barW * (boss.hp / boss.maxHp), 10);
  }

  const BULLET_COLORS = {
    normal: '#e8ffff', spread: '#8bffb0', homing: '#ff6fd8',
    pierce: '#ffd166', wide: '#5ad1ff'
  };

  function drawBullets() {
    for (const b of playerBullets) {
      ctx.fillStyle = BULLET_COLORS[b.type] || BULLET_COLORS.normal;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ff5c5c';
    for (const b of enemyBullets) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const ITEM_COLORS = {
    spread: '#8bffb0', homing: '#ff6fd8', pierce: '#ffd166', wide: '#5ad1ff',
    rapid: '#ff9f45', speed: '#a685ff', shield: '#66e0c8', heal: '#ff8fa3'
  };
  const ITEM_LABELS = {
    spread: '3', homing: 'H', pierce: 'P', wide: 'W',
    rapid: 'R', speed: 'M', shield: 'B', heal: '+'
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
  }

  const ITEM_NAMES = { spread: '3-WAY', homing: 'HOMING', pierce: 'PIERCE', wide: 'WIDE' };

  function drawHud() {
    ctx.fillStyle = '#fff';
    ctx.font = '16px sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(`SCORE ${score}`, 12, 12);
    ctx.fillText('LIFE ' + '♥'.repeat(Math.max(0, lives)), 12, 34);

    const badges = [];
    if (player.bulletType !== 'normal') {
      badges.push({ text: ITEM_NAMES[player.bulletType], color: ITEM_COLORS[player.bulletType] });
    }
    if (player.rapidFire) badges.push({ text: 'RAPID', color: ITEM_COLORS.rapid });
    if (player.speedBoost) badges.push({ text: 'SPEED', color: ITEM_COLORS.speed });
    if (player.shield) badges.push({ text: 'SHIELD', color: ITEM_COLORS.shield });

    let bx = 12;
    ctx.font = '14px sans-serif';
    for (const b of badges) {
      ctx.fillStyle = b.color;
      ctx.fillText(b.text, bx, 56);
      bx += ctx.measureText(b.text).width + 14;
    }
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

    if (state === STATE_PLAYING) {
      drawEnemies();
      drawItems();
      drawBoss();
      drawBullets();
      drawPlayer();
      drawHud();
      drawControls();
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
        { text: 'CLEAR!', font: 'bold 26px sans-serif' },
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
