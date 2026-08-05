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
  { hazard: 'wreckage',  midBoss: { kind: 'merman', hp: 45, score: 400 },
                         bosses: [{ kind: 'ghostoctopus', hp: 110, score: 950 }] },
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
- `midBoss` は任意。定義があるステージだけ、撃破数が `MIDBOSS_KILL_THRESHOLD`(22) に達したときに道中の中ボスが出る（詳細は次章）
- `midBossDone`（そのステージで中ボスを出したか）は、**`killCount = 0` を行っている箇所すべてで一緒にリセットする**。現在は `startGame()` / `continueGame()`のステージ再開側 / ボス撃破によるステージ進行 / `debugSkipStage()` の4箇所

---

## 3. ボス仕様

ボスは `kind` 文字列で種別を判定する共通オブジェクト（`makeBoss()`で生成し、`spawnBoss()` / `spawnMidBoss()` から使う）。`updateBoss()` / `drawBoss()` 内で `if (boss.kind === '...')` のディスパッチにより挙動・見た目を分岐する。

| kind | 名称 | 登場 | 攻撃概要 |
|---|---|---|---|
| `merman` | 半魚人（**中ボス**） | 3面の道中 | 構え(`HARPOON_AIM`=0.5秒、目が赤く光って予告)→自機を通り越す位置まで銛を投げ、ワイヤーで手元へ引き戻す（`updateMermanHarpoon` / `mermanHarpoonTip`）。通常弾は控えめな単発のみ |
| `crab` | カニ | 2面 | 自機狙いの4方向拡散弾（`BOSS_FIRE_SPREAD.crab`）を1.0秒間隔で発射 |
| `mantis` | シャコ | 1面 | 単発の狙い撃ち（1.4秒間隔）＋「シャコパンチ」: 溜め(`MANTIS_PUNCH_AIM`=0.55秒、打突腕が光って予告)→正面へ衝撃波弾を5発（`updateMantisPunch`） |
| `ghostoctopus` | 幽霊船の主（巨大タコ） | 3面 | 海底から複数本の触腕を同時に突き上げる叩きつけ（`GHOST_SLAM_COUNT`=2本、`GHOST_SLAM_TELEGRAPH`=0.6秒の予告あり）＋墨 |
| `squid` | ダイオウイカ | 4面／5面(1体目, `variant:'enraged'`) | 触腕を1本伸ばして自機へ追尾する掴みかかり＋全方位弾。`variant==='enraged'`（5面再戦）は弾数増加・発射間隔短縮・触腕間隔短縮・体色を濃い赤に変更して強化 |
| `goblinshark` | ゴブリンシャーク | 5面(2体目、最終ボス) | 狙いを定めてから画面を横断する噛みつき突進（`updateSharkCharge`。旧`shark`ボスのロジックを改名・転用）。突進時は`boss.jawExtend`(0→1)で顎が飛び出る演出。溜め中は安全地帯ができる。通常時は固定3方向弾（`SHARK_FIRE_ANGLES`） |

- `boss.variant`（`'normal'` | `'enraged'`）は同じ`kind`の強化版を表す汎用フィールド。`updateBoss()`/`draw<Kind>BossBody`内で分岐に使う
- ボス戦中も雑魚敵が間引かれて出現し（`BOSS_FIGHT_EXCLUDED`, `BOSS_FIGHT_SPAWN_INTERVAL`）、アイテムドロップ率が上がる（`ITEM_DROP_CHANCE_BOSS`）。これは`boss`の有無だけを見た汎用ロジックなので、新ボス追加時に個別対応不要
- ボス戦中は`bossArenaScale()`により海底・天井（深海の場合）が退いて（`BOSS_ARENA_FLATTEN`=0.45倍）圧迫事故を減らす
- **`drawBoss()`のディスパッチから漏れた`kind`は、マゼンタの丸に「NO ART」と描かれる**（`drawUnknownBossBody`）。以前はフォールバックが無く、描画関数の追加を忘れると「当たり判定だけあって何も見えないボス」になって静かに壊れていた。スクリーンショットを撮る検証シナリオはあるが画像の中身までは検証していないため、テストで守るのではなく**失敗を目立たせる**形にしてある

### 中ボス（`boss.isMid`）

中ボスは専用の変数や更新系を持たず、**同じ`boss`スロットを`isMid: true`で流用する**。これによりHPバー描画・海底の沈降・雑魚の間引き出現・アイテムドロップ率上昇がすべて無改修で効く。通常ボスとの違いは、**撃破時にステージ進行の経路へ入らない**点だけ。スコア加算・撃破エフェクト・`spawnItem()`による確定ドロップを行ったあと、`killCount`を`MIDBOSS_KILL_THRESHOLD`へ巻き戻して終わる。

`killCount`の巻き戻しは必須。中ボス戦の最中も雑魚が出続けて撃破数が伸びるため、巻き戻さないと中ボスを倒した瞬間にステージボスが即出現してしまう（`tools/verify.mjs`の`midboss`シナリオがこの退行を検出する）。

中ボスは`boss`スロットを占有し、ステージボスの出現判定は`if (!boss)`の中にある。また中ボスが自然消滅する処理は無い。したがって**中ボスを倒すまでステージボスは現れず、避け続けて先へ進むことはできない**。

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
| `riser` | クラゲ（`sine`と同じ`drawJellyEnemy`で描画） | 潜航パート専用 | 画面下から左右に揺れながら浮上してくる |
| `angler` | チョウチンアンコウ | 潜航パート専用 | 誘引突起だけ光って見え、近づくと本体が現れる |

潜航パート（`diveMode === 'diving'`）中は `STAGE_ENEMY_WEIGHTS` を使わず、`spawnDiveEnemy()` が専用に抽選する（34%で`angler`、残りが`riser`）。

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

### デバッグモード

URLに`?debug=1`を付けると`DEBUG`定数が有効になる。通常プレイには一切影響しない。

- 画面下部にSTAGE（次のステージへ即座に進む）／BOSS（現在のステージのボスを即座に出現させる）／MUTEKI（無敵切り替え）ボタンが表示される。キーボードでは`N`/`B`/`I`
- `game.js`末尾の`if (DEBUG)`内で `window.__t` として**常設の検証API**が生える（後述）

### 検証ハーネスの実行

```
node tools/verify.mjs             # 全シナリオ
node tools/verify.mjs stages dive # 名前を指定
node tools/verify.mjs --list      # シナリオ一覧
```

**Node 20以上が必要**（Playwrightの要件）。システムのNodeが18系の場合はポータブル版を使う。不足していればハーネスが取得手順つきで止まる。

ハーネスは以下を自動でやるので、手作業の準備は不要:
- Playwright本体の解決（通常の`import` → 見つからなければnpxキャッシュを走査）
- Chromium実行ファイルの解決（`~/.cache/ms-playwright/chromium-*` から**最新を自動選択**。バージョン固定しない）
- 静的サーバの起動（Nodeの`http`で自前に立てる。リポジトリルートを配信し、ポートはOS任せ。`python3 -m http.server`の配信ディレクトリ取り違え事故を構造的に防ぐ）
- ブラウザ起動（iPhone 13相当の390x844）、`window.__t`の待機、ゲーム開始と無敵化、終了時の後片付け

スクリーンショットは`.verify-shots/`（gitignore済み）に出力される。用途は2つ:

- **失敗時の自動撮影**: 表明が落ちる／実行時エラーが出ると、その瞬間の画面を`<シナリオ名>-NN-FAILED.png`として残し、パスを実行結果に表示する。表明は**fail-fast**（落ちたら即座に例外を投げてシナリオを止める）にしてあり、これは「最後まで走らせてから撮ると画面が先へ進んでしまい診断に使えない」ため。1回の実行で表示される失敗は1件だけになるが、そのぶん画面が確実に一致する
- **目視確認用**: `bosses` / `hazards` は成功時もスクリーンショットを撮る。canvasの手描きグラフィックの良し悪しは自動判定できないため（「タコがクラゲに見える」といった指摘は人間の目でしか出ない）、人のレビューへ画像を届けるためのもの。これはテストというより成果物の生成に近い

ベースライン画像との自動比較（ビジュアルリグレッション）は**現状は導入できない**。描画が`Date.now()`（火山の光・舷窓の光・帆のはためき）と`Math.random()`に依存しており、同じゲーム状態でも毎回ピクセルが変わるため。導入するなら時刻の注入と乱数のシード化が先。

### 用意されているシナリオ

| 名前 | 内容 |
|---|---|
| `smoke` | **通常モード**（`?debug=1`なし）で起動・プレイし、`pageerror`がゼロであること／`window.__t`が漏れていないことを表明 |
| `stages` | ボス撃破による実際の遷移で1→5面を走破。各面のhazard・ボスの`kind`/`variant`、5面の連戦、最終撃破後の`ending`到達までを表明 |
| `dive` | 4面→5面で潜航演出が重複しないこと（#100/#103の回帰）。本編の遷移とデバッグの`skipStage()`は別実装なので両方を個別に表明 |
| `midboss` | 3面の中ボス（半魚人）が出現・撃破でき、ステージ進行に関与しないこと。確定ドロップと撃破数の巻き戻しも表明。中ボスを持たない1面では出現しないことも確認 |
| `continueFromStageStart` | ボス戦で力尽きてコンティニューしても、ボス戦からではなくステージの最初から再開すること。5面の連戦2体目で力尽きた場合に`bossIndex`が1体目へ戻ること、潜航ステージが穴くぐりからやり直しになることも表明 |
| `bosses` | 全ボスを順に出現させてスクリーンショット（見た目変更時の目視確認用） |
| `hazards` | 各ステージのhazardを発生させ、実際に発生したことを表明したうえでスクリーンショット |

### `window.__t` API

`game.js`末尾の常設API。**アドホックにフックを足さず、足りない操作はここへ追加する**。

- `snap()` — 内部状態のスナップショット（`state`/`currentStage`/`bossIndex`/`hazard`/`diveMode`/`boss`/各配列の件数など）。表明はこれを見て書く
- `tick(steps, dt)` — `update(dt); render();` を直接回す。**headless Chromeでは非アクティブタブの`requestAnimationFrame`が極端にスロットリングされる**ため、時間を進めるときは必ずこれを使う
- `start()` / `setInvincible(v)` / `killBoss()` / `spawnBossNow()` / `skipStage()` / `gotoStage(n)` / `setKillCount(n)` / `setDive(mode, depth)` / `activateHazard()`

`gotoStage()`と`activateHazard()`は状態を直接書き換えるのではなく**実際の遷移・発生ロジックを通す**ようにしている（4面→5面の潜航引き継ぎのような分岐を検証で素通りさせないため）。

### シナリオの追加

`tools/verify.mjs`の`scenarios`オブジェクトに関数を足すだけ。`check(cond, msg)` / `check.equal(actual, expected, label)` で表明を書き、失敗すれば exit 1 になる。共通の起動処理は`withGame()`が持っているので、シナリオ本体は表明に集中できる。

`withGame()`には**`check`を渡すこと**（`withGame({ name: 'foo', check }, async (game) => {...})`）。渡さないと失敗時のスクリーンショットが撮られない。

### 注意

- `node --check game.js` は**構文チェックのみ**で、意味的な退行は一切検出しない。自動で退行を捕捉できるのは`tools/verify.mjs`だけなので、コード変更時はこちらを流す
- 新しく回帰を1件直したら、対応するシナリオに表明を1行足しておくと同じ退行を二度踏まない

---

## 8. リリース運用

- ブランチは `feature/xxx`（新機能）／`fix/xxx`（不具合修正）／`docs/xxx`（ドキュメント）のように用途を接頭辞で表す
- `.github/workflows/version-bump.yml` が、PRの作成（`opened`）およびPRブランチへのpushのたびに `version.js` の `window.GAME_VERSION` をそのPR番号（`v1.0.<PR番号>`）に自動書き換えしてコミット・プッシュする。そのため**`version.js`を手動で編集しない**。また、他のPRとの間で頻繁にコンフリクトするので、コンフリクト時は「より大きいバージョン番号を採用」して解消すればよい
- 開発は基本的に `main` から都度ブランチを切り、PRを作成してユーザーのレビュー・マージを経る
