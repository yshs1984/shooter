#!/usr/bin/env node
// 回帰シナリオのランナー。
//
//   node tools/verify.mjs            すべて実行
//   node tools/verify.mjs stages     名前を指定して実行（複数可）
//   node tools/verify.mjs --list     シナリオ一覧
//
// Node 20以上が必要（Playwrightの要件）。詳細は docs/spec.md の検証ワークフローの章。

import { withGame, SHOT_DIR, SetupError } from './harness.mjs';

// --- 表明のための最小限のヘルパ ------------------------------------------

// 表明が落ちたことを表す。実行時エラーと区別するために専用の型にしている
class AssertionFailure extends Error {}

// 失敗したら即座に投げる（fail-fast）。
// こうすることで withGame 側が「失敗した瞬間の画面」をスクリーンショットに残せる。
// 最後まで走らせてから撮ると、そのころには画面が先へ進んでしまっていて診断に使えない
function makeChecker() {
  const failures = [];
  const check = (cond, msg) => {
    if (!cond) {
      failures.push(msg);
      throw new AssertionFailure(msg);
    }
    return true;
  };
  check.equal = (actual, expected, label) =>
    check(
      actual === expected,
      `${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  check.failures = failures;
  // 失敗時に withGame が撮ったスクリーンショットのパスが積まれる
  check.shots = [];
  return check;
}

// --- シナリオ -------------------------------------------------------------

const scenarios = {
  // 通常プレイ（?debug=1なし）でエラーが出ないこと。
  // デバッグAPIを常設したことで通常プレイが壊れていないかの確認も兼ねる
  smoke: async (check) => {
    await withGame({ name: 'smoke', debug: false, check }, async (game) => {
      await game.page.waitForTimeout(1500);
      check(game.errors.length === 0, `コンソールエラー: ${JSON.stringify(game.errors)}`);

      // 通常プレイにデバッグAPIが漏れていないこと
      const leaked = await game.page.evaluate(() => !!window.__t);
      check(leaked === false, '通常モードなのに window.__t が生えている');

      await game.shot('normal-play');
    });
  },

  // 1面から5面まで、実際のボス撃破による遷移で走破できること。
  // 「ステージ1から5まで正しく遷移するか」の再実行可能版
  stages: async (check) => {
    const expected = [
      { stage: 1, hazard: 'volcano', kind: 'mantis' },
      { stage: 2, hazard: 'whirlpool', kind: 'crab' },
      { stage: 3, hazard: 'wreckage', kind: 'ghostoctopus' },
      { stage: 4, hazard: 'dive', kind: 'squid' },
      { stage: 5, hazard: 'darkdive', kind: 'squid', variant: 'enraged' },
      { stage: 5, hazard: 'darkdive', kind: 'goblinshark' }  // 5面は2体連戦
    ];

    await withGame({ name: 'stages', check }, async (game) => {
      const first = await game.snap();
      check.equal(first.currentStage, 1, '開始ステージ');
      check.equal(first.hazard, 'volcano', '開始hazard');

      for (const exp of expected) {
        await game.call('spawnBossNow');
        await game.tick(5);
        const s = await game.snap();

        const label = `stage${exp.stage}/${exp.kind}`;
        check.equal(s.currentStage, exp.stage, `${label} currentStage`);
        check.equal(s.hazard, exp.hazard, `${label} hazard`);
        check.equal(s.boss?.kind, exp.kind, `${label} boss.kind`);
        if (exp.variant) check.equal(s.boss?.variant, exp.variant, `${label} boss.variant`);

        await game.call('killBoss');
        await game.tick(20);
      }

      const end = await game.snap();
      check.equal(end.state, 'ending', '全ボス撃破後にエンディングへ入る');
      await game.shot('ending');
    });
  },

  // 4面→5面で潜航（穴くぐり）演出が繰り返されないこと。#100 / #103 の回帰。
  // 本編の遷移とデバッグのステージスキップは別実装なので、両方を個別に確認する
  dive: async (check) => {
    await withGame({ name: 'dive', check }, async (game) => {
      // --- 本編の遷移（ボス撃破）経路 ---
      await game.call('gotoStage', 4);
      await game.call('setDive', 'deep', 2000);
      await game.tick(5);

      const inStage4 = await game.snap();
      check.equal(inStage4.currentStage, 4, '4面にいる');
      check.equal(inStage4.diveMode, 'deep', '4面で深海に到達している');

      await game.call('spawnBossNow');
      await game.tick(5);
      await game.call('killBoss');
      await game.tick(20);

      const afterBoss = await game.snap();
      check.equal(afterBoss.currentStage, 5, 'ボス撃破で5面へ');
      check.equal(
        afterBoss.diveMode, 'deep',
        '5面は深海の続きとして始まる（潜航演出をやり直さない）'
      );

      // 猶予が明けると連戦1体目が自動で出現する
      await game.tick(80);
      const spawned = await game.snap();
      check.equal(spawned.boss?.kind, 'squid', '5面1体目のボスが自動出現');
      check.equal(spawned.boss?.variant, 'enraged', '5面1体目は強化版');
    });

    // --- デバッグのステージスキップ経路（debugSkipStage は別実装） ---
    await withGame({ name: 'dive-skip', check }, async (game) => {
      await game.call('gotoStage', 5);
      const s = await game.snap();
      check.equal(s.currentStage, 5, 'スキップで5面へ');
      check.equal(
        s.diveMode, 'deep',
        'スキップでも5面は深海から始まる（潜航演出をやり直さない）'
      );
    });
  },

  // コンティニューは、どこで力尽きてもステージの最初からやり直すこと。
  // 以前はボス戦から再開していたが、アイテムを失った状態でHP全快のボスに
  // 挑むことになりまず勝てなかったため
  continueFromStageStart: async (check) => {
    // --- 3面のボス戦で力尽きた場合 ---
    await withGame({ name: 'continue', check }, async (game) => {
      await game.call('gotoStage', 3);
      await game.call('spawnBossNow');
      await game.tick(5);

      const inBoss = await game.snap();
      check.equal(inBoss.boss?.kind, 'ghostoctopus', '3面のボス戦に入っている');
      const livesBefore = inBoss.continuesLeft;

      await game.call('killPlayer');
      await game.tick(3);
      const dead = await game.snap();
      check.equal(dead.state, 'continue', 'ライフ0でコンティニュー待ちになる');
      await game.shot('continue-prompt');

      await game.call('doContinue');
      await game.tick(5);

      const resumed = await game.snap();
      check.equal(resumed.state, 'playing', 'コンティニューで再開できる');
      check.equal(resumed.boss, null, 'ボス戦から再開しない（ステージ最初へ戻る）');
      check.equal(resumed.currentStage, 3, '同じステージをやり直す');
      check.equal(resumed.killCount, 0, '撃破数がリセットされる');
      check.equal(resumed.midBossDone, false, '中ボスも出直す');
      check.equal(resumed.continuesLeft, livesBefore - 1, 'コンティニュー回数が減る');
      await game.shot('continue-resumed');
    });

    // --- 5面の連戦2体目（ゴブリンシャーク）で力尽きた場合 ---
    await withGame({ name: 'continue-chain', check }, async (game) => {
      await game.call('gotoStage', 5);
      await game.call('setDive', 'deep', 2000);
      await game.call('spawnBossNow');
      await game.tick(5);
      await game.call('killBoss');          // 1体目（強化イカ）を倒して連戦2体目へ
      await game.tick(20);
      await game.call('spawnBossNow');
      await game.tick(5);

      const chain = await game.snap();
      check.equal(chain.boss?.kind, 'goblinshark', '連戦2体目に入っている');
      check.equal(chain.bossIndex, 1, 'bossIndexが2体目を指している');

      await game.call('killPlayer');
      await game.tick(3);
      await game.call('doContinue');
      await game.tick(5);

      const resumed = await game.snap();
      check.equal(resumed.currentStage, 5, '5面をやり直す');
      check.equal(resumed.bossIndex, 0, '連戦の1体目からやり直す');
      check.equal(resumed.boss, null, 'ボス戦から再開しない');
      check.equal(
        resumed.diveMode, 'none',
        '潜航ステージは穴くぐりからやり直す（アイテムを集め直す時間を確保する）'
      );
    });
  },

  // 3面の中ボス「半魚人」。道中に挟まり、ステージ進行には関与しないこと
  midboss: async (check) => {
    await withGame({ name: 'midboss', check }, async (game) => {
      await game.call('gotoStage', 3);

      // 撃破数が中ボスの閾値に達すると出現する
      await game.call('setKillCount', 22);
      await game.tick(10);
      const mid = await game.snap();
      check.equal(mid.currentStage, 3, '3面にいる');
      check.equal(mid.boss?.kind, 'merman', '中ボスとして半魚人が出現');
      check.equal(mid.boss?.isMid, true, '中ボスとして扱われている');
      await game.shot('merman');

      // 銛の構えと、投擲の伸びきったところをそれぞれ撮る
      let sawAim = false;
      let sawThrow = false;
      for (let i = 0; i < 200 && !sawThrow; i++) {
        await game.tick(1);
        const s = await game.snap();
        if (!sawAim && s.boss?.harpoonPhase === 'aim') {
          sawAim = true;
          await game.shot('harpoon-aim');
        }
        if (s.boss?.harpoonPhase === 'throw') {
          // 投げ始めは手元にあるので、伸びきるあたりまで進めてから撮る
          await game.tick(9);
          const mid = await game.snap();
          if (mid.boss?.harpoonPhase === 'throw') {
            sawThrow = true;
            await game.shot('harpoon-throw');
          }
        }
      }
      check(sawAim, '銛の構え(harpoonPhase=aim)が発生する');
      check(sawThrow, '銛の投擲(harpoonPhase=throw)が発生する');

      // 中ボス戦の最中も雑魚が出るので撃破数は伸びる。ステージボスの閾値を
      // 超えた状態で中ボスを倒しても、ステージボスが即出現しないことを確かめる
      await game.call('setKillCount', 31);
      const beforeItems = (await game.snap()).counts.items;
      await game.call('killBoss');
      await game.tick(20);

      const after = await game.snap();
      check.equal(after.boss, null, '中ボス撃破直後にステージボスが即出現しない');
      check.equal(after.currentStage, 3, '中ボス撃破ではステージが進まない');
      check(after.counts.items > beforeItems, '中ボス撃破でアイテムが確定ドロップする');
      check(
        after.killCount < 30,
        `撃破数が巻き戻る（実際: ${after.killCount}）`
      );

      // そのあと撃破数が伸びればステージボスが出る
      await game.call('setKillCount', 30);
      await game.tick(10);
      const stageBoss = await game.snap();
      check.equal(stageBoss.boss?.kind, 'ghostoctopus', '中ボスの後にステージボスが出現');
      check.equal(stageBoss.boss?.isMid, false, 'ステージボスは中ボス扱いではない');
    });

    // 中ボスを持たないステージには出現しないこと
    await withGame({ name: 'midboss-absent', check }, async (game) => {
      await game.call('setKillCount', 22);
      await game.tick(10);
      const s = await game.snap();
      check.equal(s.currentStage, 1, '1面にいる');
      check.equal(s.boss, null, '中ボスを持たない1面では出現しない');
    });
  },

  // 全ボスを順に出現させてスクリーンショットを撮る（見た目変更時の目視確認用）
  bosses: async (check) => {
    await withGame({ name: 'boss', check }, async (game) => {
      const seen = [];
      // 5面は2体連戦なので、ステージ数より1回多く回す
      for (let i = 0; i < 6; i++) {
        await game.call('spawnBossNow');
        await game.tick(6);
        const s = await game.snap();
        if (s.boss) {
          seen.push(s.boss.kind);
          const tag = s.boss.variant === 'enraged' ? `${s.boss.kind}-enraged` : s.boss.kind;
          await game.shot(`stage${s.currentStage}-${tag}`);
        }
        await game.call('killBoss');
        await game.tick(20);
      }
      check.equal(seen.length, 6, `出現したボスの数（実際: ${seen.join(', ')}）`);
    });
  },

  // 各ステージのhazardを実際に発生させ、発生したことを表明したうえでスクリーンショットを撮る。
  // 火山・残骸は地形の山に乗るので、山が流れてくるまで十分にスクロールさせる必要がある
  hazards: async (check) => {
    await withGame({ name: 'hazard', check }, async (game) => {
      for (let stage = 1; stage <= 5; stage++) {
        if (stage > 1) await game.call('gotoStage', stage);
        await game.call('activateHazard');

        const before = await game.snap();
        if (before.hazard === 'dive' || before.hazard === 'darkdive') {
          // 潜航ステージは深海まで進めて天井が見える状態にする
          await game.call('setDive', 'deep', 2000);
          await game.tick(60);
        } else {
          // 地形は110px/s、山の周期は700pxなので、20秒ぶん流して山を確実に画面へ入れる
          await game.tick(400);
        }

        const s = await game.snap();
        check.equal(s.currentStage, stage, `stage${stage} に到達`);

        // hazardが本当に起きているか（スクリーンショットが空振りしていないか）
        if (s.hazard === 'volcano') check(s.volcanoActive, 'stage1: 火山が発生していない');
        if (s.hazard === 'wreckage') check(s.wreckageActive, 'stage3: 残骸が発生していない');
        if (s.hazard === 'whirlpool') {
          check(s.whirlpoolActive, 'stage2: 渦が発生していない');
          check(s.counts.whirlpools > 0, 'stage2: 渦が画面に出ていない');
        }
        if (s.hazard === 'dive' || s.hazard === 'darkdive') {
          check.equal(s.diveMode, 'deep', `stage${stage}: 深海に到達していない`);
        }

        await game.shot(`stage${stage}-${s.hazard}`);
      }
    });
  }
};

// --- CLI ------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--list')) {
    console.log('シナリオ:');
    for (const name of Object.keys(scenarios)) console.log(`  ${name}`);
    return 0;
  }

  const unknown = args.filter((a) => !scenarios[a]);
  if (unknown.length) {
    console.error(`不明なシナリオ: ${unknown.join(', ')}`);
    console.error(`指定できるのは: ${Object.keys(scenarios).join(', ')}`);
    return 2;
  }

  const names = args.length ? args : Object.keys(scenarios);
  const results = [];

  for (const name of names) {
    const check = makeChecker();
    process.stdout.write(`▶ ${name} ... `);
    try {
      await scenarios[name](check);
      console.log('PASS');
      results.push({ name, ok: true });
    } catch (err) {
      if (err instanceof SetupError) throw err;   // 環境不備は全体を止める

      if (err instanceof AssertionFailure) {
        console.log('FAIL');
        for (const f of check.failures) console.log(`    - ${f}`);
      } else {
        console.log('ERROR');
        console.log(`    ${err.stack || err.message}`);
      }
      for (const s of check.shots) console.log(`    ⤷ 失敗時の画面: ${s}`);
      results.push({ name, ok: false });
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log('');
  console.log(`${results.length - failed.length}/${results.length} passed`);
  console.log(`スクリーンショット: ${SHOT_DIR}`);
  return failed.length ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    // 環境不備は原因と対処だけを示す（スタックトレースは出さない）
    if (err instanceof SetupError) {
      console.error(`\n${err.message}`);
      process.exit(2);
    }
    console.error(err);
    process.exit(2);
  });
