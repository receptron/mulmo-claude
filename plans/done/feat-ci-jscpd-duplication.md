# feat(ci): jscpd で PR に新規流入した重複コードを Code Scanning に報告する

Issue: #2127

## 背景

DRY はレビューで人間が守るのに最も向いていない原則。目の前の差分が綺麗でも「300 ファイル向こうに同じ関数がある」かはレビュアーの記憶に頼るしかなく、実際 `truncate()` が 6 実装に増えた（#1304 / `docs/shared-utils.md` の由来）。トークン列の一致判定は機械的なので、機械に任せる。

## 実測（jscpd v5.0.12、調査済み）

`src` + `server` + `packages`（`node_modules` / `dist` / `*.d.ts` 除外）:

| Format | Files | Total lines | Clones | Duplicated lines |
|---|---|---|---|---|
| **typescript** | 1,170 | 163,210 | 314 | 5,332 (**3.27%**) |
| markdown | 58 | 8,010 | 84 | 1,818 (22.70%) |
| json | 78 | 5,607 | 45 | 858 (15.30%) |
| vue | 132 | 35,088 | **0** | 0 (0.00%) |
| **Total** | 1,666 | 267,098 | 512 | 9,504 (3.56%) |

実行時間 **127ms**（v5 は Rust 実装）→ CI コストは実質ゼロ。

判断材料:

- **見るべきは typescript の 3.27%**。markdown / json はノイズ（`package.json` 定型・docs）→ `--format typescript` で絞る。
- `src` + `server` のみなら 1.90% / 113 クローン。`packages/`（25+ bridge が構造上似ている）を足して 3.27% / 314。数字が上がる＝悪ではない。

## 設計判断

### 1. なぜ「全体 % 閾値」を採用しないか

`--threshold` は**新規重複を止めない**。16 万行に 20 行コピペしても全体率は 3.27% → 3.28% にしか動かず閾値に届かない。`truncate()` が 6 実装に増える事故は % ゲートでは 1 件も止まらない。

→ 母数に薄められない **PR 差分**の単位で見る必要がある。Code Scanning は「この PR で新規に増えたアラート」を差分表示するので、自前のベースライン比較なしにこれが得られる。

### 2. なぜ公式 Action を使わないか

`uses: kucherenko/jscpd@master` はサードパーティ Action かつ可変 ref。このリポジトリは `secret-scan.yml` で確立した方針
（gitleaks-action が Organization 配下でライセンスキー必須になった経緯）に従い、
**version pin + SHA256 検証したバイナリを直接実行**する。`workflow-lint.yaml` のコメントも同方針を明記している。

SARIF アップロードのみ GitHub 純正の `github/codeql-action/upload-sarif` を使う。

### 3. スコープ

- 対象: リポジトリルート `.` を `--ignore` でスコープ限定（理由は下記の落とし穴 A）
- format: `typescript` のみ
- 除外: `**/node_modules/**`, `**/dist/**`, `**/*.d.ts`, `test/**`, `e2e/**`, `e2e-live/**`
  - テストの重複はフィクスチャ等で大量に出てノイズになりがちなので第一段階では対象外

実測（この設定で 186 クローン）: `packages` 70 / `server` 20 / `src` 16。当初想定した
「`src` `server` `packages` を引数で渡す」と実質同じスコープになるが、パスが壊れないのが違い。

### 落とし穴 A: 複数ルートを引数で渡すと SARIF のパスが壊れる

jscpd は**スキャンルートのプレフィックスを剥がして**パスを報告する。`jscpd src server packages` と渡すと:

- `bridges/google-chat/src/index.ts`（実際は `packages/bridges/...`）
- `agent/stream.ts`（実際は `server/agent/...`）
- `index.ts`（**どのルート由来か復元不能**）

となり、Code Scanning がファイルにマッピングできない。後処理での復元も不可能。
**`.` をスキャンすればリポジトリルート相対**になり全パスが解決する（検証済み: 不正パス 0 件）。

### 落とし穴 B: `--ignore` と `--ignore-pattern` は別物

- `-i, --ignore` … **ファイル単位の glob 除外**（これが正解）
- `--ignore-pattern` … **コード単位の正規表現**（`//\s*cpd-disable` 等でトークンをスキップ）

jscpd の README のオプション表は `--ignore-pattern | -i | Glob patterns to ignore` と書いているが**実際の CLI と食い違う**。
`--ignore-pattern` にファイル glob を書いても**黙って何にもマッチしない**（test/ が 95 件混入して発覚）。`jscpd --help` が正。

### 4. 落とし方（第一段階）

**アラート報告のみ。CI は落とさない。** 既存コードに 314 クローンある状態でいきなりブロックすると摩擦が大きい。まず実態を可視化し、運用しながら閾値・必須化を判断する。

## 実装

`.github/workflows/duplication-scan.yaml` を新規作成。

- pinned: jscpd **v5.0.12** / `jscpd-linux-x64-gnu.tar.gz`
  - SHA256 `c1107547ee52bc83131d6e62d1fc9c156d194c593a4532876cdb1584b4e1dc3b`
  - tarball 内のバイナリ名は `jscpd`（`cpd` ではない）
- `--reporters sarif` → `report/jscpd-report.sarif` → `github/codeql-action/upload-sarif`
- `permissions`: `contents: read` + `security-events: write`（SARIF アップロードに必須）
- `persist-credentials: false`（zizmor artipacked、既存ワークフローに合わせる）
- `paths-ignore`: docs / plans / md（既存 `pull_request.yaml` に合わせる）

## 確認事項

- **CodeQL default setup との共存**: 現在 Code Scanning は CodeQL の default setup で稼働。サードパーティ tool（`tool.name = jscpd`）の SARIF は通常干渉しないはずだが、初回実行で要確認。干渉した場合は default setup を advanced にするか、SARIF アップロードを諦めて artifact + PR コメントに切り替える。
- `security-events: write` は他ワークフロー（`contents: read` 最小権限）より広い。SARIF アップロードに必須のため、このワークフロー限定で付与する。
- actionlint + zizmor（`workflow-lint.yaml`）を通すこと。

## 将来

- 運用して新規アラートの質を見てから、必要なら required check 化 / 閾値追加を検討。
- 定期的な全体監査（`--blame` + `html` レポーター）は別途スケジュール実行で足してもよい。

## 参考

調査の詳細と結果の読み方: https://zenn.dev/singularity/articles/jscpd-dry-detection-mono
