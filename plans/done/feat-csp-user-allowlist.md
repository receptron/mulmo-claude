# feat: サンドボックスビューの CSP をユーザー設定で拡張 (#1989)

issue: #1989

## 目的

カスタムビュー等のサンドボックス HTML に適用される CSP を `config/csp.json` で拡張できるようにする（例: Google Maps を通す）。あわせて CSP 違反をチャットに拾い、拡張の危険性を明示する。

## 実装状況（全て本 PR で完了）

- ✅ **基盤**: `previewCsp.ts` に `frame-src` directive + directive 別 extra（`CspExtraHosts`）+ `sanitizeCspExtra`（URL ベース検証）。
- ✅ **config 読込＋配信**: `config/csp.json`（`csp-io.ts` `readCspExtraSync`）→ サーバヘッダ（`server/index.ts`）＋ `/api/config`（`ConfigResponse.csp`）配信 → クライアント holder（`useCspExtra.ts`）→ `uiHost.ts` で custom view srcdoc に注入 + `useContentDisplay` の file preview にも。**Maps 埋め込みが通る。**
- ✅ **違反捕捉→通知**: srcdoc に `securitypolicyviolation` リスナー注入（host `customViewSrcdoc.ts`、プラグイン改変なし）→ 親へ postMessage → host global collector（`useCspViolations.ts`）→ App.vue の注意バナー（i18n 8 locale）＋ console.warn。
- ✅ **危険性の警告**: `warnIfCspExtended`（boot 時ログ、`connect-src` は専用の強警告）。バナー文言にも「信頼できる場合のみ」を明記。

## 現状（確定）

- CSP 生成: `src/utils/html/previewCsp.ts`。`buildCsp` に **`frame-src` directive が無い** → iframe は `default-src 'none'` で全ブロック（Maps 埋め込み不可の主因）。
- 許可リスト: `packages/core/src/remote-view/index.ts` `SANDBOXED_VIEW_CDN_ALLOWLIST`（ハードコード）。config は**加算**にする。
- CSP は2箇所で生成: サーバヘッダ（`server/index.ts:511` `buildHtmlPreviewCsp`）＋ クライアント srcdoc meta（`customViewSrcdoc.ts` `buildCustomViewCsp`）＋ 純クライアント `wrapHtmlWithPreviewCsp`。→ config を両系統へ届ける必要。

## PR1 実装方針

1. **`previewCsp.ts`**:
   - `buildCsp` に `frame-src` を追加（extra が空なら directive を出さず従来どおり default-src フォールバック）。
   - directive 別の追加ホストを受ける形に拡張（例 `CspExtra = { "frame-src"?: string[]; "script-src"?: string[]; ... }`）。`buildCustomViewCsp`/`buildHtmlPreviewCsp` が受け取り、ベースリストに加算。
   - 値のバリデーション（`https://host` 形式のみ、`'unsafe-*'`/`data:` 等の危険トークンは弾く or 別扱い）。
2. **config 読込（サーバ）**: `config/csp.json` を読む io ヘルパ（既存 `config/*.json` パターンに倣う）。`WORKSPACE_*` の config パス定数を使用。無ければ空 extra。
3. **配信**:
   - サーバヘッダ（`server/index.ts`）: config を読んで `buildHtmlPreviewCsp(origin, extra)` に渡す。
   - カスタムビュー srcdoc: `boot`(CustomViewBootstrap) に extra を載せて `buildCustomViewCsp(origin, extra)` へ（boot 生成場所は調査で確定）。
   - `wrapHtmlWithPreviewCsp`（純クライアント）: app config（`/api/config` 等）で extra を受け取る（配線は調査で確定）。
4. **テスト**: `previewCsp` の frame-src 出力 / extra 加算 / バリデーション。config io の read（無ファイル→空、正常、壊れ JSON→空+ログ）。

## 検討中（プランビング調査で確定）

- `boot` 生成がサーバ/クライアントどちらか → extra の届け方。
- `/api/config` 系のクライアント配信の有無と形。
- config io の既存パターン（atomic write / パス定数）。

## セキュリティ

- `connect-src` 拡張が最危険（token+データの双方向 exfil）。PR1 では**加算は許すが**、警告本体は PR3。値バリデーションで最低限のガード。
- ベース許可リストは維持（config は加算のみ、削除・上書き不可）。

## 関連
- #1989 / `plans/done/feat-collections-custom-views.md`
