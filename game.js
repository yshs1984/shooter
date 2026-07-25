(() => {
  'use strict';

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');

  let W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

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

  // ---------- 入力 ----------
  let pointerActive = false;
  let pointerX = null;
  let pointerY = null;

  function setPointerFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    if (e.touches && e.touches.length > 0) {
      pointerX = e.touches[0].clientX - rect.left;
      pointerY = e.touches[0].clientY - rect.top;
    } else if (typeof e.clientY === 'number') {
      pointerX = e.clientX - rect.left;
      pointerY = e.clientY - rect.top;
    }
  }

  function onPointerDown(e) {
    e.preventDefault();
    pointerActive = true;
    setPointerFromEvent(e);
    if (state === STATE_TITLE || state === STATE_GAMEOVER || state === STATE_CLEAR) {
      startGame();
    }
  }
  function onPointerMove(e) {
    if (!pointerActive) return;
    e.preventDefault();
    setPointerFromEvent(e);
  }
  function onPointerUp(e) {
    pointerActive = false;
  }

  canvas.addEventListener('touchstart', onPointerDown, { passive: false });
  canvas.addEventListener('touchmove', onPointerMove, { passive: false });
  canvas.addEventListener('touchend', onPointerUp, { passive: false });
  canvas.addEventListener('mousedown', onPointerDown);
  canvas.addEventListener('mousemove', onPointerMove);
  canvas.addEventListener('mouseup', onPointerUp);

  // ---------- 星空背景 ----------
  let stars = [];
  function initStars() {
    stars = [];
    for (let i = 0; i < 80; i++) {
      stars.push({
        x: Math.random() * W,
        y: Math.random() * H,
        speed: 30 + Math.random() * 90,
        size: 1 + Math.random() * 2
      });
    }
  }

  function updateStars(dt) {
    for (const s of stars) {
      s.x -= s.speed * dt;
      if (s.x < 0) {
        s.x = W;
        s.y = Math.random() * H;
      }
    }
  }

  function drawStars() {
    ctx.fillStyle = '#fff';
    for (const s of stars) {
      ctx.globalAlpha = 0.6;
      ctx.fillRect(s.x, s.y, s.size, s.size);
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
    fireInterval: 0.22
  };

  function resetPlayer() {
    player.x = Math.max(60, W * 0.15);
    player.y = H / 2;
    player.invuln = 1.0;
    player.fireCooldown = 0;
  }

  function playerMinX() { return player.size + 4; }
  function playerMaxX() { return W * 0.6; }

  // ---------- 弾 ----------
  let playerBullets = [];
  let enemyBullets = [];

  function spawnPlayerBullet() {
    playerBullets.push({
      x: player.x + player.size,
      y: player.y,
      vx: 620,
      vy: 0,
      r: 4
    });
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
    const y = 40 + Math.random() * (H - 80);
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
      y: H / 2,
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
    boss.y = H / 2 + Math.sin(boss.t * 0.8) * (H * 0.28);
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

  // ---------- 衝突判定 ----------
  function dist(ax, ay, bx, by) {
    return Math.hypot(ax - bx, ay - by);
  }

  function hitPlayer() {
    if (player.invuln > 0) return;
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
    boss = null;
    spawnTimer = 0;
    initStars();
    resetPlayer();
  }

  function update(dt) {
    updateStars(dt);

    if (state !== STATE_PLAYING) return;

    elapsed += dt;
    if (player.invuln > 0) player.invuln -= dt;

    if (pointerActive && pointerY !== null) {
      player.y += (pointerY - player.y) * Math.min(1, dt * 18);
      player.x += (pointerX - player.x) * Math.min(1, dt * 18);
    }
    player.y = Math.max(player.size, Math.min(H - player.size, player.y));
    player.x = Math.max(playerMinX(), Math.min(playerMaxX(), player.x));

    player.fireCooldown -= dt;
    if (player.fireCooldown <= 0) {
      player.fireCooldown = player.fireInterval;
      spawnPlayerBullet();
    }

    for (const b of playerBullets) b.x += b.vx * dt;
    playerBullets = playerBullets.filter(b => b.x < W + 20);

    for (const b of enemyBullets) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }
    enemyBullets = enemyBullets.filter(b => b.x > -20 && b.x < W + 20 && b.y > -20 && b.y < H + 20);

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
        if (dist(e.x, e.y, b.x, b.y) < e.r + b.r) {
          b.hit = true;
          e.hp -= 1;
        }
      }
    }
    for (const e of enemies) {
      if (e.hp <= 0 && !e.dead) {
        e.dead = true;
        score += e.score;
        killCount += 1;
      }
    }
    enemies = enemies.filter(e => !e.dead);

    // 自機弾 vs ボス
    if (boss) {
      for (const b of playerBullets) {
        if (b.hit) continue;
        if (dist(boss.x, boss.y, b.x, b.y) < boss.r + b.r) {
          b.hit = true;
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

  function drawEnemies() {
    for (const e of enemies) {
      ctx.fillStyle = e.type === 'shooter' ? '#ff8a4c' : (e.type === 'sine' ? '#ffd24c' : '#ff5c7a');
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawBoss() {
    if (!boss) return;
    ctx.fillStyle = '#c34cff';
    ctx.beginPath();
    ctx.arc(boss.x, boss.y, boss.r, 0, Math.PI * 2);
    ctx.fill();

    const barW = Math.min(220, W - 140);
    const barX = W - barW - 16;
    const barY = 16;
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fillRect(barX, barY, barW, 10);
    ctx.fillStyle = '#c34cff';
    ctx.fillRect(barX, barY, barW * (boss.hp / boss.maxHp), 10);
  }

  function drawBullets() {
    ctx.fillStyle = '#e8ffff';
    for (const b of playerBullets) {
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

  function drawHud() {
    ctx.fillStyle = '#fff';
    ctx.font = '16px sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(`SCORE ${score}`, 12, 12);
    ctx.fillText('LIFE ' + '♥'.repeat(Math.max(0, lives)), 12, 34);
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
    ctx.fillStyle = '#05060f';
    ctx.fillRect(0, 0, W, H);
    drawStars();

    if (state === STATE_PLAYING) {
      drawEnemies();
      drawBoss();
      drawBullets();
      drawPlayer();
      drawHud();
    } else if (state === STATE_TITLE) {
      drawCenterText([
        { text: '横スクロールシューティング', font: 'bold 24px sans-serif' },
        { text: 'タップでスタート', font: '18px sans-serif' }
      ]);
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

  initStars();
  resetPlayer();
  requestAnimationFrame(loop);
})();
