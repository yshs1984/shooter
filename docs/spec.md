# DEEP DIVER 詳細スペック

開発者・Claude Code向けの実装詳細集。プレイヤー向けの遊び方説明は [`README.md`](../README.md) を参照。ここでは各章が独立して読めるよう構成しているので、作業内容に対応する章だけ読めばよい。

## 目次
1. [ファイル構成](#1-ファイル構成)
2. [ステージ構成](#2-ステージ構成)
3. [ボス仕様](#3-ボス仕様)
4. [敵（雑魚）仕様](#4-敵雑魚仕様)
5. [アイテム仕様](#5-アイテム仕様)
6. [地形・障害物仕様](#6-地形障害物仕様)
7. [デバッグモードと検証ワークフロー](#7-デバッグモードと検証ワークフロー)
8. [リリース運用](#8-リリース運用)

---

## 1. ファイル構成

- `index.html` — canvasとviewport設定。`version.js`→`game.js`の順で読み込む
- `version.js` — `window.GAME_VERSION` を定義するだけの自動生成ファイル（後述）
- `game.js` — ゲームロジック一式。単一IIFE、`// ---------- セクション名 ----------` でセクション分けされている
- `README.md` — プレイヤー向けの遊び方説明
- `.github/workflows/version-bump.yml` — バージョン自動更新（後述）

---

## 2. ステージ構成

`STAGES` 配列（`game.js`）でステージごとの `hazard`（地形障害の種類）と `bosses`（戦うボスの並び。通常1体、連戦ステージは複数）を定義する。

```js
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
```

- `currentStage`（1始まり）と `bossIndex`（同ステージ内で何体目のボスと戦っているか、連戦用）で現在地を管理
- ボス撃破時、`bossIndex + 1 < stageBosses.length` なら同ステージ内の次のボスへ（`bossIndex += 1`、「NEXT BOSS」バナー）。そうでなければ `currentStage += 1` して次ステージへ
- 4面(`dive`)→5面(`darkdive`)の遷移だけは特別扱い: 両方とも潜航ロジック（`updateDive`）を共有するステージなので、`resetDive()` を呼ばず `diveMode` を `'deep'` のまま維持し、`deepTimer` だけ `DEEP_BOSS_DELAY` にリセットする（穴くぐりの潜航演出を繰り返さないため）。それ以外のステージ遷移は `resetDive()` で潜航状態を初期化する
- `debugSkipStage()`（デバッグのSTAGEボタン）も本編のボス撃破遷移と同じ4面→5面特別扱いロジックを持つ（別実装なので変更時は両方直すこと）
- `STAGE_ENEMY_WEIGHTS`（雑魚敵の出現重みテーブル）は `STAGES` とは別配列で、ステージ数と同じ5要素

---

## 3. ボス仕様

ボスは `kind` 文字列で種別を判定する共通オブジェクト（`spawnBoss()`で生成）。`updateBoss()` / `drawBoss()` 内で `if (boss.kind === '...')` のディスパッチにより挙動・見た目を分岐する。

| kind | 名称 | 登場 | 攻撃概要 |
|---|---|---|---|
| `crab` | カニ | 2面 | 自機狙いの4方向拡散弾（`BOSS_FIRE_SPREAD.crab`）を1.0秒間隔で発射 |
| `mantis` | シャコ | 1面 | 単発の狙い撃ち（1.4秒間隔）＋「シャコパンチ」: 溜め(`MANTIS_PUNCH_AIM`=0.55秒、打突腕が光って予告)→正面へ衝撃波弾を5発（`updateMantisPunch`） |
| `ghostoctopus` | 幽霊船の主（巨大タコ） | 3面 | 海底から複数本の触腕を同時に突き上げる叩きつけ（`GHOST_SLAM_COUNT`=2本、`GHOST_SLAM_TELEGRAPH`=0.6秒の予告あり）＋墨 |
| `squid` | ダイオウイカ | 4面／5面(1体目, `variant:'enraged'`) | 触腕を1本伸ばして自機へ追尾する掴みかかり＋全方位弾。`variant==='enraged'`（5面再戦）は弾数増加・発射間隔短縮・触腕間隔短縮・体色を濃い赤に変更して強化 |
| `goblinshark` | ゴブリンシャーク | 5面(2体目、最終ボス) | 狙いを定めてから画面を横断する噛みつき突進（`updateSharkCharge`。旧`shark`ボスのロジックを改名・転用）。突進時は`boss.jawExtend`(0→1)で顎が飛び出る演出。溜め中は安全地帯ができる。通常時は固定3方向弾（`SHARK_FIRE_ANGLES`） |

- `boss.variant`（`'normal'` | `'enraged'`）は同じ`kind`の強化版を表す汎用フィールド。`updateBoss()`/`draw<Kind>BossBody`内で分岐に使う
- ボス戦中も雑魚敵が間引かれて出現し（`BOSS_FIGHT_EXCLUDED`, `BOSS_FIGHT_SPAWN_INTERVAL`）、アイテムドロップ率が上がる（`ITEM_DROP_CHANCE_BOSS`）。これは`boss`の有無だけを見た汎用ロジックなので、新ボス追加時に個別対応不要
- ボス戦中は`bossArenaScale()`により海底・天井（深海の場合）が退いて（`BOSS_ARENA_FLATTEN`=0.45倍）圧迫事故を減らす

---

## 4. 敵（雑魚）仕様

`STAGE_ENEMY_WEIGHTS[currentStage-1]` の重みで `pickEnemyKind()` が抽選する。

| kind | 通称 | 登場 | 特徴 |
|---|---|---|---|
| `straight`(school) | ピラニア | 全ステージ | 3匹の群れで直進 |
| `sine` | 毒クラゲ | 全ステージ | サインカーブ移動 |
| `shooter` | ウニ | 全ステージ | 自機狙いの棘を発射（発射前は目が赤く光る） |
| `marlin` | カジキ | 2面以降 | 画面右端で狙いを定めてから高速突進 |
| `moray` | ウツボ | 2面以降 | 海底の巣穴に潜み、近づくと飛び出す |
| `puffer` | フグ | 3面以降 | 被弾で膨らむ。倒すと全方位に棘を撒く |
| `octopus` | タコ | 3面以降 | 墨を吐く（ダメージなし、視界を奪う） |
| `angler` | チョウチンアンコウ | 潜航パート専用 | 誘引突起だけ光って見え、近づくと本体が現れる（`STAGE_ENEMY_WEIGHTS`の対象外、潜航中の専用スポーン） |

---

## 5. アイテム仕様

`ITEM_COLORS` / `ITEM_LABELS`（`game.js`）で色とHUDラベルを定義。効果は取得後、次のアイテムを取るかリスタートするまで持続（時間制限なし）。

| type | 効果 |
|---|---|
| `spread` | 3-WAY弾 |
| `homing` | 誘導弾（近くの敵に緩やかに追尾） |
| `pierce` | 貫通弾 |
| `wide` | 弾が大きくなる（速度・威力は通常弾と同じ） |
| `rapid` | 発射間隔短縮 |
| `speed` | 自機の移動速度上昇 |
| `shield` | 被弾2回分のバリア |
| `heal` | ライフ1回復（上限5） |
| `escort` | 護衛機（最大2機、自動射撃） |
| `torpedo` | 魚雷（1発4ダメージ、発射間隔2倍） |

---

## 6. 地形・障害物仕様

`STAGES[currentStage-1].hazard` で分岐。

- **`volcano`**: 海底の山（`mountainAt()`）の一部が火山になる（`isVolcano`フラグ、`VOLCANO_MOUNTAIN_CHANCE`=0.9）。撃破数`VOLCANO_TRIGGER_KILLS`(14)で発生、山頂から不規則にマグマを発射
- **`whirlpool`**: 撃破数`WHIRLPOOL_TRIGGER_KILLS`(14)で発生。画面右から渦が次々流れてきて、入ると操作を奪われ内壁を回りながら引きずり込まれる
- **`wreckage`**: 山の一部が沈没船残骸になる（`isWreckage`フラグ、`WRECKAGE_MOUNTAIN_CHANCE`=0.85）。撃破数`WRECKAGE_TRIGGER_KILLS`(14)で発生。残骸の見た目は3種類（船体片`drawWreckageHullPlate`／マスト`drawWreckageMast`／肋材+錨`drawWreckageRibs`）を`periodIndex`ごとに決定的に振り分け
- **`dive` / `darkdive`**: 共通で`updateDive(dt)`を呼ぶ。撃破数`DIVE_TRIGGER_KILLS`(14)で大穴(`THE ABYSS`)が接近→`diveMode`が `'none' → 'opening' → 'diving'（縦スクロール、左右に岩壁`collidesCave`） → 'deep'（横スクロール復帰、`SEA FLOOR`）` と遷移。深度`DIVE_BOTTOM_DEPTH`(2000)まで潜ると`'deep'`になり、`DEEP_BOSS_DELAY`(3.2秒)後にボス出現。`diveMode==='deep'`のときは海底(`drawTerrain`/`collidesTerrain`)に加えて天井(`drawCeiling`/`collidesCeiling`)もあり、上下から挟まれる構造
- 明るさは`drawDepthDarkness()`が担当（`diveMode==='deep'`なら暗さの上限0.5、それ以外の潜航中は0.72、`diveDepth`に応じて徐々に暗くなる）。5面専用の特別な暗闇演出は過去に実装したが、ボス戦が暗すぎて戦えなくなるため撤去済み（4面と同じ扱いに統一）

---

## 7. デバッグモードと検証ワークフロー

- URLに`?debug=1`を付けると`DEBUG`定数が有効になり、通常プレイには一切影響しない
- 画面下部にSTAGE（次のステージへ即座に進む）／BOSS（現在のステージのボスを即座に出現させる）／MUTEKI（無敵切り替え）ボタンが表示される。キーボードでは`N`/`B`/`I`
- コード変更を検証する際は、`})();` の直前（IIFE末尾）に一時的な `if (DEBUG) { window.__t = { ... }; }` ブロックを追加し、内部状態のスナップショット取得（`snap()`）やボス撃破の強制（`boss.hp = -1`）、rAFのスロットリングを避けるための直接ティック（`update(dt); render();` をループで呼ぶ `tick(steps, dt)`）などを生やして Playwright から `window.__t.xxx()` を呼び出す、というのがこのプロジェクトで確立した検証手法
  - headless Chromeではタブが非アクティブだと`requestAnimationFrame`が極端にスロットリングされることがあるため、時間を進めたい検証では`tick()`のような直接呼び出し用フックを使う
  - 検証が終わったら**このフックは必ず削除してからコミットする**（`grep -n "__t"` で残っていないか確認する習慣）
- ローカルのPlaywrightバイナリがNode 20以上を要求する一方、環境のシステムNodeが18系である場合があるため、`nodejs.org`からポータブルなNode 20を取得して使う運用実績がある
- `node --check game.js` で構文エラーの有無を確認してからコミットする

---

## 8. リリース運用

- ブランチは `feature/xxx`（新機能）／`fix/xxx`（不具合修正）／`docs/xxx`（ドキュメント）のように用途を接頭辞で表す
- `.github/workflows/version-bump.yml` が、PRの作成（`opened`）およびPRブランチへのpushのたびに `version.js` の `window.GAME_VERSION` をそのPR番号（`v1.0.<PR番号>`）に自動書き換えしてコミット・プッシュする。そのため**`version.js`を手動で編集しない**。また、他のPRとの間で頻繁にコンフリクトするので、コンフリクト時は「より大きいバージョン番号を採用」して解消すればよい
- 開発は基本的に `main` から都度ブランチを切り、PRを作成してユーザーのレビュー・マージを経る
