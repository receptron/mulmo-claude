# sync-upstream

upstream (receptron/mulmoclaude) の最新変更をこのフォークに取り込み、プルリクエストを作成する。

## 手順

以下を順番に実行してください：

1. `git fetch upstream` で最新を取得
2. `git log upstream/main ^main --oneline` で差分を表示し、ユーザーに内容を報告
3. 差分がなければ「upstream と同期済みです」と報告して終了
4. 差分がある場合は、作業ブランチを作成する：
   - ブランチ名は `sync/upstream-YYYYMMDD`（今日の日付）とする
   - `git checkout -b sync/upstream-YYYYMMDD` を実行
5. `git merge upstream/main` を実行
6. コンフリクトが発生した場合は、以下の方針で解決する：
   - `README.md`: **常に HEAD 側（exe.dev フォーク版）を採用する**。このファイルは「exe.dev 環境向けフォークである旨」のみを記載し、機能説明は upstream README へのリンクで済ませる方針のため、upstream の変更は無視する。`git checkout --ours README.md && git add README.md` で解決する。
   - `server/index.ts`: `if (sandboxEnabled)` ブロック（Docker ブリッジ二次リスナー）を維持
   - `server/csrfGuard.ts`: `isAllowedOrigin()`, `EXTRA_ALLOWED_ORIGINS`, `EXTRA_ALLOWED_HOSTS` を維持
   - `vite.config.ts`: `VITE_PORT` / `VITE_ALLOWED_HOSTS` の env 読み取りを維持
   - `e2e/playwright.config.ts`: `VITE_PORT` からのポート読み取りを維持
   - `server/docker.ts`: `getDockerBridgeIp()` 関数を維持
7. `yarn install` を実行（依存関係の変化に対応）
8. `yarn format && yarn lint && yarn typecheck && yarn build` を実行して検証
9. lint エラーをチェックする：
   - `yarn lint 2>&1 | grep " error "` でエラー行を抽出する
   - エラーがある場合：`yarn lint --fix` で自動修正できるものを直し、残りは手動修正する
   - 修正後、`git add -p` で変更をステージし、別コミットとして記録する（メッセージ例: `fix: lint errors in exe.dev-specific files after upstream sync`）
   - **注意**: warning（`id-length` など）は upstream が段階的に移行中のため、放置してよい。error のみ対処する。
10. マージコミットメッセージは日本語で、取り込んだ主な変更内容を箇条書きにする
11. `git push github sync/upstream-YYYYMMDD` を実行
    - **注意**: upstream sync はワークフローファイル（`.github/workflows/`）を含むことが多いため、`origin`（exe.dev プロキシ）ではなく `github`（直接 GitHub）を使う。`origin` は `workflows` 権限がなくリジェクトされる。
12. `gh pr create` でプルリクエストを作成する：
    - タイトル: `chore: sync upstream YYYY-MM-DD`
    - 本文: 取り込んだコミット一覧（`git log upstream/main ^main --oneline` の出力）と、コンフリクト解決があった場合はその内容を記載
    - base ブランチ: `main`
13. PR の URL をユーザーに報告する
14. PR がマージされたことをユーザーが確認したら、作業ブランチを削除する：
    - `git checkout main && git pull origin main` で main を最新化
    - `git branch -d sync/upstream-YYYYMMDD` でローカルブランチを削除
    - `git push origin --delete sync/upstream-YYYYMMDD` で origin のブランチを削除
