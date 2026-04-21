# MulmoClaude — Product Hunt ローンチ戦略(日本語版)

*英語原本: [`launch-product-hunt.md`](./launch-product-hunt.md) — タグライン、PH 掲載コピー、ツイート文面、動画キャプションなど実際に公開されるコピーは英語のまま残しています。戦略上の説明文のみ日本語化。*

**オーナー:** CMO(戦略)、Engineering(素材制作)、Community(当日オペレーション)
**ローンチ予定日:** 火曜日(1 週間後) — 米西海岸時間 00:01 キックオフ
**ポジショニング・ワンライナー:** *Claude Code that creates documents, videos, and your personal knowledge base.*
**コア・セーシス(製品の背後にあるストーリー):** **2026 年のあらゆる AI エージェントは健忘症である。** Claude Code、Devin、Codex、ChatGPT、Cursor — どれもタスクごとにゼロから始まる。ChatGPT の "memory" は箇条書きの断片。Claude.ai Projects は手動アップロード前提。Mem.ai も Obsidian も不活性で、自分では育たない。**MulmoClaude はこの健忘症を治す。** Claude Code にファイルシステムとスケジューラーと複利で育つメモリを与える — すべてがユーザーのマシン上の 1 つのローカルフォルダ(`~/mulmoclaude/`)に収まる。AI に家ができる。覚えてくれる。寝ている間にも働く。自分のもの。これがセーシスのすべて。

**2026 年の現実チェック(コモディティ化 vs フロンティア):** リッチ出力(Artifacts)、モバイル AI(ChatGPT アプリ、OpenClaw)、サンドボックス、コード生成 — すべて **コモディティ化済み** で、看板として売っても刺さらない。残されたフロンティアであり、MulmoClaude が勝てる場所は **メモリ + 自律 + 所有権** の 3 つ。このプランは完全にこの 3 つを埋めるために組まれている。
**ターゲット・アーリーアダプター(ひとつの層に絞る、四つではなく):** ターミナルの限界に既にぶつかっている Claude Code のパワーユーザー。それ以外の層 — 生産性ユーザー、ナレッジワーカー、AI 愛好家 — はフェーズ 2 で、彼らはパワーユーザー経由で流入する。並列に狙わない。

---

## 1. ポジショニングとタグライン

### プライマリ・タグライン(Product Hunt ヒーローライン)

> **MulmoClaude — Claude Code that creates documents, videos, and your personal knowledge base.**

この一文が製品のすべて。3 つの名詞だけで全部を仕事させている: *documents* と *videos* は「何が返ってくるか」(具体的な成果物)を半秒で伝える; *your personal knowledge base* が堀(モート)であり、ローカルで、自分のもので、セッションを超えて複利で積み上がる部分。あらゆる表層 — ヒーロー動画、PH ヘッドライン、ツイート #1、ギャラリー・キャプション — は、この一文に戻って来なければならない。それ以外(並列セッション、ブリッジ、サンドボックス、ロール、スキル、チャート)はすべて *エビデンス* であって、メッセージではない。

**ドラフトの鉄則:** "artifacts" と書きたくなったら、毎回具体的な名詞(documents, videos)と堀の表現("your personal knowledge base")に置き換えること。抽象語はアップボートを逃す。

### サポーティング・タグライン(SNS とヒーロー画像の A/B 候補)

1. *Docs. Presentations. Spreadsheets. Videos. Out of Claude Code. And it remembers.*
2. *Claude Code that produces the things you actually ship — and gets smarter every chat.*
3. *Turn any research paper into a document, a deck, and a narrated video — without opening anything else.*
4. *Run five Claude Code agents in one browser tab. Get documents, decks, and videos back — not text.*
5. *`~/mulmoclaude/` — a local knowledge base that grows itself. Web, files, conversations — all here. Reach it from anywhere.* **(Geek 向け; HN、X-dev、ターミナルネイティブ層向け。)**

### カテゴリ選択

プライマリ: **Developer Tools** · セカンダリ: **Artificial Intelligence**
Dev Tools は我々が狙う唯一のオーディエンス(Claude Code のパワーユーザー)が棲息する場所。Productivity は完全にスキップ — PH 当日に二層を追うのは、どちらも取り逃す道。AI は防衛的なサードまで。

---

## 2. ワン・センテンス・ピッチ

**MulmoClaude turns Claude Code into a system that produces real documents, presentations, spreadsheets, and narrated videos, runs multiple agents at once, and builds a personal knowledge base from everything you do.**

3 つの節を、ユーザーの脳が問う順序で並べてある: *何を作るのか? どのくらい速いのか? 賢くなっていくのか?* このプラン内の他のすべては補強証拠にすぎない。

### 深層フレーム(視聴者がより多くを受け止められるときに使う)

> **AI が自分専用のワークスペースを育ててくれる。調べ物も、整理も、ファイル管理も自動で、どこからでもアクセスできる。全部ローカルで、全部自分のもの。**

本当の差別化要因はどれか一つの機能ではなく、**「場所」** である。ネットの記事(ソース巡回経由)、チャットの会話(Wiki への自動抽出経由)、ローカルのファイル(ファイルエクスプローラー経由)、スケジュール実行、スマホからのメッセージ — *そのすべてが一つのフォルダに集まる*。プレーンな Markdown として、Claude にメンテナンスされた状態で。Notion はクラウド。Google Drive はクラウド。Obsidian はローカルだが AI が勝手に育てない。MulmoClaude は **3 つの性質を同時に一つの場所に持っている: ローカル・AI がメンテナンス・マルチソース。**

### アンチ・ラッパー・ライン("ChatGPT クローンなのでは?"に対する常備反論)

> **This doesn't call the Claude API. It runs Claude Code directly — your auth, your tools, your files, your environment.**

この区別こそが、この製品が他にはできないことを可能にしている根源的理由である。メーカーポスト、HN タイトル、ツイート #1 で一字一句そのまま反復すること。

---

## 3. Product Hunt で勝てる理由

PH の投票者が評価するのは 3 つ: **明快な "aha"**、**短いデモ**、**単なるラッパーではないナラティブ**。MulmoClaude は 3 つとも満たしている。

| Hunt 側が無意識に聞いてくる問い                 | MulmoClaude の答え                                                                                                          |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| "また別の AI チャットラッパー?"                 | 違う — Claude Code CLI を直接走らせている(API ではない)。そしてピッチは「チャット + 綺麗な出力」ではない — **エージェント健忘症を治す**ことだ。|
| "新しいアイディアは何?"                         | **あらゆる AI エージェントには健忘症がある。これだけは違う。** Claude にファイルシステムとスケジューラーと複利で育つメモリを与える。|
| "ChatGPT Memory や Obsidian と何が違う?"        | ChatGPT Memory は箇条書き。Obsidian は不活性。Mem.ai は手動キュレーション必須。**MulmoClaude はチャットの副産物として相互リンク付きナレッジベースが育つ。** 手動作業ゼロ。|
| "Claude.ai Projects で足りるのでは?"            | Projects は手動アップロード前提。MulmoClaude は自動で蓄積する — チャット、巡回記事、スケジュール実行、生成画像、検索結果、すべてが Wiki に流れ込む。|
| "明日も気にする理由は?"                         | **寝ている間にも働く**。ソースを登録すれば翌朝ブリーフィング。タスクを定期実行すればレポートが出来上がっている。これを出荷している AI エージェントは他にない。|

---

## 4. キー・メッセージ(5 個を 3 個に圧縮 — 2026 年版の再カット)

PH 閲覧者は約 10 秒でスキミングし、覚えるアイディアは **1 つ**。5 個は多い。2026 年の市場ではリッチ出力・モバイル AI・サンドボックスはすべてコモディティ化しているため、これらを看板に据えても刺さらない。残されたアンカーは **メモリ・自律・所有権** の 3 つだけ。以上。

### 3 つ(優先度順)

**1. The agent that remembers.** — *Every AI agent has amnesia. This one doesn't.*

個人用 Wiki が会話ごとに育つ — 自動的に、相互リンクされ、ユーザーのマシン上のプレーンな Markdown として。3 日後に質問すると、Claude は 3 日前に学んだことと今日の問いを自動で結び付ける — ユーザーは何も保存していない。**これが堀。** 使えば使うほど、他のツールに乗り換えにくくなる。

- **vs ChatGPT Memory:** 断片的な箇条書きではなく、*相互リンク付きナレッジベース*。
- **vs Mem.ai / Obsidian:** 手動作業ゼロ。会話の副産物として知識が育つ — 「ファイリングする」ために手を止める必要がない。
- **vs Claude.ai Projects:** 手動アップロード不要。チャット、巡回記事、生成画像、検索結果、一時サマリー — *すべて* が自動でメモリに流れ込み、以後のどのセッションからもアクセスできる。
- *最終的には、メモリ自体が推論されるべき:* AI が「何を生成するか」を決めているように、「何を覚えるべきか」も AI が決める。これがエンドゲーム。

**2. The agent that works while you sleep.** — *Other agents wait for you. This one has a schedule.*

ソースを登録すれば翌朝ブリーフィングが届いている。週次レポートをスケジュールすれば、頼まずともワークスペースに出来上がっている。ノート PC を閉じて、戻ってきたらキャッチアップ済み。**GUI + 永続化された状態 + 見逃した実行のキャッチアップ — この組み合わせを出荷している AI エージェントは他にない。** メモリの堀(#1)と自律実行(#2)が組み合わさって複利が回る: ユーザーが見ていない間もエージェントが学び続ける。

- **vs Devin / Codex / 現在の Claude Code:** どれもワンショット実行者。開けば動き、閉じれば止まる。MulmoClaude はバックグラウンドで走る。
- **vs cron + Claude API を自作する流派:** パワーユーザーが自前で組むことはあるが、GUI + 永続化 + キャッチアップをアウトオブザボックスで出荷しているツールはゼロ。
- *最終的には、スケジューリング自体も自律化すべき:* メモリと同じく、ユーザーが cron 式を書くのではなく、AI が「何を繰り返すべきか・何を監視すべきか・毎朝何を要約すべきか」を推論する。これが「寝ている間に働くエージェント」のフル解像度の姿。

**3. Your machine, your data, your agent.** — *It all lives in `~/mulmoclaude/`. Plain Markdown. Git-friendly. No cloud. No lock-in.*

ネット記事、チャット、ローカルファイル、生成画像・動画、検索結果、スケジュール出力 — すべてが一つのフォルダにプレーンテキストで入っている。プライベートリポジトリに `git push` すればバックアップ完了。どんなエディタでも開ける。10 年後もマイグレーションなしで読める。

- **vs Notion / Mem.ai / ChatGPT:** クラウドではない。エクスポートフローが不要 — すでにディスク上のプレーンテキストだから「エクスポートする対象」が存在しない。
- **vs Obsidian:** ローカルだが、AI が育ててくれる。手動キュレーションゼロ。
- 米国の "own your AI" センチメントに直撃 — すでに X で流通しているフレーズ。
- サンドボックス(Docker 自動検出)はここに吸収する、単独のメッセージにしない: 「自分のマシン、自分のデータ」を *どう守るか* の手段であって、別ピッチではない。

### ビジュアル・フック(メッセージではなく — デモ用のバズ弾)

**3 つの Claude Code セッションが並列で走っている画** は、シェアされる視覚として今でも最強。ただし、もはや *メッセージ* ではなく **フック** として扱う。Twitter と PH ギャラリーで注意を引き付け、上記 3 メッセージで follow-through を獲得する。ビジュアルはクリックを売り、メモリ + 自律 + 所有権が試用を売る。

### 温存するもの(2026 年のテーブルステークス — 看板には出さず、FAQ 用に温めておく)

- **マルチモーダル出力 — ドキュメント、デッキ、スプレッドシート、動画。** Claude Artifacts によってコモディティ化。まだ機能としては強力、デモ素材としても生きる、だがカテゴリ決定要素ではない。3 メッセージが着地した後に言及する。
- **モバイル・ブリッジ(Telegram, Slack, LINE, WhatsApp, Discord, Matrix)。** OpenClaw(Claude のモバイルアプリ)が先に「スマホの Claude」を取った。我々の独自アングルはいまや: *スマホから書き込んだ内容がノート PC と同じ永続メモリに入る* — しかしこれはメッセージ #1 の補強であって独立ピラーではない。
- **Docker サンドボックス。** 2026 年には当然の衛生基準で、ヘッドラインには値しない。メッセージ #3 に吸収。
- **ロール、スキルランチャー、Markdown-as-database、ECharts、ファイル添付。** コメントスレッド用の弾薬 — 個別の質問が開いたときに展開する。

---

## 5. Product Hunt 掲載コピー

### ヘッドライン(60 文字以内)
`MulmoClaude — Docs, videos, and a growing knowledge base` *(56 文字 — 91 文字のヒーロータグラインの短縮版)*

### タグライン(60 文字以内)
`Parallel sessions. Personal wiki. Phone bridges. Sandboxed.` *(58 文字)*

### ファーストコメント(メーカーポスト — 固定)

```
Hi Product Hunt 👋

I'm Satoshi Nakajima. I spent thirteen and half years at Microsoft working on
operating systems (lead architect on early Windows releases), then
spent the last year obsessing over a single question: **what does an
AI-native OS actually look like?**

I don't think it's ChatGPT. I don't think it's Copilot. I think the
kernel is something like Claude Code — an agent with direct access to
your files, your tools, your environment. Powerful, but living inside
a terminal.

Terminals were the OS shell of 1975. We can do better.

MulmoClaude is my attempt at the **shell for that new kernel**. It
does three things:

**1. Claude replies with real documents, decks, spreadsheets, and videos — not text.**
Documents, spreadsheets, ECharts dashboards, forms, 3D scenes — and
full narrated slide decks and AI-generated videos via the built-in
MulmoScript / MulmoCast engine (Gemini image + Veo 3.1 video +
audio). Drop in a research paper, get back a summary doc, a deck, and
a narrated video. No other tools opened.

**2. It runs many Claude Code agents in parallel, in one browser tab.**
Kick off a video render in one session, refactor code in another,
draft an email in a third. While one is working, you keep working.
Claude Code is no longer single-threaded.

**3. It gets smarter every conversation.**
Every ingested article, every decision, every fact becomes a
cross-linked page in a personal wiki Claude builds and maintains
itself (inspired by @karpathy's *LLM Knowledge Bases* post). It's
all plain Markdown in `~/mulmoclaude/` — git-friendly, portable,
yours. This is the part I'm proudest of: **every other Claude client
starts from zero; this one compounds.**

Two details that matter:

- **Not a wrapper.** This doesn't call the Claude API. It runs the
  actual Claude Code CLI — your auth, your filesystem, your skills,
  your MCP servers. That's why it can do what it does.
- **Sandboxed by default.** Claude runs inside a Docker container
  that only sees your workspace. SSH keys, `.env` files, home
  directory — invisible. Auto-detected on launch, no configuration.

You can also reach the same workspace from Telegram, Slack, LINE,
Discord, WhatsApp, Matrix — same agent, same wiki memory. Fire a
task from the subway, see the result on your laptop.

Open source, MIT.

If you're already a Claude Code power user who's hit the walls of
the terminal, this is built for you. Would love your honest feedback
— this is the first visible surface of a much bigger thesis about
what computing looks like when AI is the kernel.

— Satoshi
```

### ギャラリー・キャプション(スクリーンショット 1 枚ごとに 1 キャプション)

5 枚構成。#1 は並列セッションのビジュアル・フック、#2〜#4 が 3 つのキー・メッセージ、#5 はアンチ・ラッパーの証拠。孤児キャプションなし、温存機能なし。

1. **フック — 並列セッション** — "Three Claude Code agents in one browser tab. One researches, one writes docs, one builds charts. Now watch what happens tomorrow."
2. **#1 メモリ** — "Every AI agent has amnesia. This one doesn't. A cross-linked wiki grows from every chat — automatically, in plain Markdown on your machine."
3. **#2 自律** — "Other agents wait for you. This one has a schedule. Register a source, get a morning briefing. Close the lid, come back to catch-up."
4. **#3 所有権** — "It all lives in `~/mulmoclaude/`. Plain Markdown. `git push` is the backup. No cloud, no lock-in."
5. **証拠 — ラッパーではない** — "Runs the Claude Code CLI directly. Your auth, your tools, your files. Sandboxed in Docker so it stays in its lane."

---

## 6. デモ動画プラン

動画は 3 本 — それぞれ別のチャネル向け。**必ず無音で収録した後、一度だけナレーションを乗せ、キャプションを付けて出す。**

### Video A — 60 秒ヒーロー(Product Hunt ギャラリー + Twitter/X)

- **ゴール:** 視聴者 1 人につき 1 アップボート。機能列挙をしない。
- **絶対に決めなければならない 1 ショット:** 「明日」のセッションが「昨日」学んだことについて質問し、Claude が自分で築いた Wiki を根拠に答える画。*これが* 健忘症の治療を可視化したもの。並列セッションのスプラッシュは視線を掴むため、メモリ・ペイオフがハート。
- **フック(冒頭):** 動画開始時点ですでに 3 つの並列 Claude Code セッションが走っている。3 秒で「え、複数エージェントが同時に動いているの?」の注意を獲得。
- **構成:**
  - 0:00–0:08 — コールドオープン: スプリットスクリーン、3 セッションがすでに途中まで走っている。セッション 1 はトピックを調査、セッション 2 はそこからドキュメントを作成、セッション 3 はチャートをレンダリング。ロゴなし、タイトルカードなし。キャプションがフェードイン: *"3 Claude Code agents. One browser tab."*
  - 0:08–0:15 — Wiki サイドバーにズーム: セッションが動くにつれて新しいページが出現し、既存のページに自動で相互リンクされる。キャプション: *"Everything they learn is saved — automatically."*
  - 0:15–0:30 — **メモリ・ペイオフ(マネーショット)。** 時間ジャンプのオーバーレイ: *"Tomorrow."* 新規セッションが開く。昨日のトピックに触れる質問をユーザーがタイプ。Claude が Wiki の相互リンクを可視化したまま回答する。キャプション: *"Every AI agent has amnesia. This one doesn't."*
  - 0:30–0:40 — スケジューラー・ビート。スケジューラー・ビューを表示: 登録されたソースが夜間にトリガーされ、朝のブリーフィングがキャンバスに出現。キャプション: *"Other agents wait for you. This one works while you sleep."*
  - 0:40–0:50 — 所有権ビート。Finder / ターミナルで `~/mulmoclaude/` を開く — プレーン Markdown ファイルが見える。`git push` がスクロールで流れる。キャプション: *"It all lives on your machine. Plain Markdown. Git-friendly. No cloud."*
  - 0:50–0:55 — アンチ・ラッパー・ビート。白地に黒の 1 フレーム: *"Not an API wrapper. Claude Code, directly."*
  - 0:55–1:00 — ロゴ + `npx create-mulmoclaude` + GitHub URL。(ホストデモまたは `--demo` モードが出荷される場合は CTA を差し替える — §10.5 参照。)
- **制作メモ:** 1080p スクリーンキャプチャ、24fps、ズームトランジションなし、等幅フォントのキャプション。BGM: ロイヤリティフリーの lo-fi トラックを 40% で 1 曲 — 0:55 でカット。**絶対条件:** スピナー待ち時間ゼロ。プリレンダー、スプライス、絶対に待たない。0:15–0:30 のメモリ・ペイオフがマネーショット — 2 テイク撮ってシャープな方を採用する。

### Video B — 3 分ディープダイブ(YouTube + ランディングページ)

- **ゴール:** 開発者の視聴者を `npx create-mulmoclaude` / `git clone`(もしくはホストデモ/`--demo` モードが出荷されていればそのクリック)に変換する。
- **ナラティブの弧:** *何を作る? どのくらい速い? 賢くなる? 信頼できる?* — ユーザーの脳が問う順序そのまま。
- **アウトライン:**
  - 0:00–0:20 — 問題提起、中島自身のナレーションで: "I worked on Windows for eight years. Claude Code is the kernel of an AI-native OS. But kernels need shells. Here's the shell I wanted."
  - 0:20–0:50 — **ショックデモ。** 研究論文 PDF をドロップ。要約ドキュメント、スライドデッキ、ナレーション付き MulmoCast 動画が出てくる。強調: *the answer isn't text, it's an artifact. Powered by GUI Chat Protocol.*
  - 0:50–1:30 — さらに 2 つのセッションを並列で開く。片方で別の MulmoCast 動画を走らせ、もう片方で実際のコードベースをリファクタリング。3 つの成果物が同時に生成される。強調: *"one browser tab, many Claude Code workers."*
  - 1:30–2:10 — **複利の瞬間。** 関連する 2 本の記事を取り込む。Wiki のバックリンクが出現する様子を見せる。"翌朝" を想定した新しいセッションを開いて質問する — Claude が自分で築いた Wiki を根拠に答える。強調: *"every other Claude client starts from zero. This one compounds."*
  - 2:10–2:30 — ブリッジ。**Telegram** と **LINE** からメッセージ; デスクトップのキャンバスがライブで更新される様子を見せる。同じメモリ、同じワークスペース。
  - 2:30–2:50 — 信頼レイヤー。Docker サンドボックス・バナー。Claude がワークスペース外のファイルを *読めない* 様子を見せる。`~/` で直接 Claude を動かすツールと対比。アンチ・ラッパー・ラインを画面に。
  - 2:50–3:00 — オープンソース、MIT。GitHub リンク(ホストデモまたは `--demo` モードが用意できていればそのリンクも)。
- **制作メモ:** 最初の 20 秒だけ右下にトーキングヘッドのインセット、以後は純粋なスクリーンキャスト。

### Video C — 15 秒ループ(Instagram, LinkedIn, PH ギャラリーモーション)

- 単一プロンプト → 単一のリッチなビジュアル結果 → ロゴへフェード。無音前提。
- 3 バリアント撮影: **(a)** 並列で動く 3 セッション、**(b)** MulmoCast ナレーション動画のフル生成、**(c)** Telegram → キャンバスの往復。最強のものを PH に。他 2 本は当日別投稿。

### 撮影チェックリスト(全動画共通)

- クリーンなワークスペース(新鮮な `~/mulmoclaude/`)を使い、ファイルツリーを散らかさない。
- 最低 1920×1080 で収録、H.264 / 8Mbps でエクスポート。
- プロンプトはすべて事前にテキストファイルで用意する — ライブタイピングでテンポを落とさない。ペースト & 送信。
- Claude が実際にヒットするネットワークでドライラン。エージェントレイテンシがデモ最大の殺し手。
- プラグインのレンダリングが 8 秒以上かかるなら **待ちをカット** — PH 視聴者は空白を許さない。

---

## 7. ローンチウィーク・タイムライン(T = ローンチ当日)

### T-14 〜 T-8 — 素材制作

- [ ] ヒーロー動画、3 分動画、15 秒ループ × 3、スクリーンショット 7 枚を完成
- [ ] Product Hunt アカウント登録、X 連携、他のローンチ 2 件にコメントしてウォームアップ
- [ ] ローンチ当日の関与を約束する **ハンター 4 名** を確保。5 分の Loom で製品をブリーフ。
- [ ] すべてのツイート、LinkedIn 投稿、Reddit 投稿、HN 投稿をドラフト
- [ ] クリーンな macOS、クリーンな Windows WSL、クリーンな Ubuntu でインストール QA — 摩擦をすべて潰す
- [ ] 決定: `npx create-mulmoclaude` を出荷するか、それとも `git clone` を CTA として維持するか? **推奨: npx ラッパーを出荷する。インストールファネルが半分になる。**

### T-7 — 事前告知

- [ ] "Coming Tuesday on PH" ツイートを 15 秒ループ付きで(リンクなし)
- [ ] r/ClaudeAI、r/LocalLLaMA にティーザー投稿 — 製品デモであってローンチ CTA ではない(Reddit はローンチ投稿を嫌う)
- [ ] 知り合いの Claude Code パワーユーザー 10 名に DM — 火曜朝に試してもらい、率直なフィードバックを依頼

### T-3 — ウォームアップ

- [ ] **ブログポスト** を公開: Karpathy-KB 接続について *"What I learned building a personal wiki for Claude."* これが知的な錨(いかり)。
- [ ] ブログポストを HN に提出。PH にはまだ触れない。
- [ ] Maker Studio で PH 掲載をドラフト(**公開はしない** — ステージングのみ)

### T-0 — ローンチ当日

- **00:01 PT** — PH に公開。ファーストコメントを 90 秒以内に投稿。
- **00:05 PT** — ツイートスレッド(7 ツイート、キーメッセージ 1 個に 1 ツイート)。スレッド先頭を固定。
- **00:10 PT** — LinkedIn、Mastodon、Bluesky にクロスポスト(コピペせず、各チャネルに合わせて改作)
- **01:00 PT** — HN "Show HN: MulmoClaude — visual GUI + personal wiki for Claude Code"
- **06:00 PT** — Reddit r/ClaudeAI 投稿(ローンチ色ではなく価値先行 — "これを作った、Wiki メモリのアイディアはこう、コードはここ")
- **09:00 PT / 12:00 PT / 15:00 PT / 18:00 PT** — すべての PH コメントに 30 分以内に返信。**例外なし。**
- **17:00 PT** — 中間チェック: トップ 10 に入っていなければ、Telegram ブリッジのデモ動画を新規投稿として出し、@ProductHunt をタグ付け。
- **21:00 PT** — 順位にかかわらず感謝ポスト。トップコメンターの名前を挙げる。

### T+1 〜 T+7 — 複利化

- ニュースレター配信(dev.to、Hacker Newsletter 寄稿、TLDR Dev 売り込み)
- "ローンチ翌日 — 学んだこと" ポストを収録。これはローンチ自体より 30% の確率で跳ねる。
- インタビュー行脚開始: Changelog、Latent Space、Anthropic コミュニティコールに売り込み。

---

## 8. チャネル別プレイブック

### X / Twitter

**オープニング・ツイート(並列セッションのビジュアルでクリックを売る):**
> *"3 Claude Code agents running in parallel. One researches, one writes docs, one builds charts. Tomorrow they remember everything. [GIF]"*

**ローンチスレッド(6 ツイート) — 順序: フック → 3 メッセージ → CTA。メモリ/自律/所有権がアンカー、並列セッションはビジュアル冒頭でメッセージではない。**

1. **[フック — 並列セッション GIF]** *"3 Claude Code agents running in parallel. One researches, one writes docs, one builds charts. Tomorrow they remember everything. This is MulmoClaude — live on Product Hunt today. 🧵"*
2. **[メッセージ #1 — メモリ]** *Every AI agent has amnesia. This one doesn't. A cross-linked wiki grows from every chat, automatically, in plain Markdown on your machine. ChatGPT Memory is a bullet list. Obsidian is inert. This is the moat. [wiki-compounding gif]*
3. **[メッセージ #2 — 自律]** *Other agents wait for you. This one has a schedule. Register a source → morning briefing. Set a recurring task → weekly report done. Close the lid, come back to a catch-up. No other AI agent ships this. [scheduler gif]*
4. **[メッセージ #3 — 所有権]** *It all lives in `~/mulmoclaude/`. Plain Markdown. `git push` is the backup. No cloud, no lock-in, no export flow. Your machine, your data, your agent. [folder + git gif]*
5. **[アンチ・ラッパー・ビート]** *This is not an API wrapper. It runs the Claude Code CLI directly — your auth, your tools, your files. That's why it can do what it does.*
6. **[CTA]** *Install with `npx create-mulmoclaude` or `git clone` — open source, MIT. One upvote on PH costs you nothing and means everything today: [link]* (ホストデモもしくは `--demo` モードがローンチ前に出荷されれば先頭の節を差し替える。)

### Hacker News

**タイトル:** `Show HN: MulmoClaude – Every AI agent has amnesia. I gave Claude Code a memory that compounds.`

**本文の冒頭:** *"Every AI agent has amnesia. I gave Claude Code a file system, a scheduler, and a memory that compounds. Here's what happened."* 続いてセーシスを展開(2026 年は飽和している; 残されたフロンティアはメモリ・自律・所有権)、3 メッセージ、そして最後に AI ネイティブ OS の文脈。HN は機能よりアイディアを評価する — 健忘症フレーミングを先に売る。明示的に述べる: *this runs the Claude Code CLI directly, not the API — that's why it can do what it does.*

### Reddit (r/ClaudeAI, r/LocalLLaMA, r/selfhosted)

- ローンチ投稿ではない。ビルドログ: *"I spent 8 months giving Claude Code a shell. Here's the wiki-memory idea and what I learned."*
- PH リンクは最下部に一行だけ。

### LinkedIn

**ローンチ当日はスキップ。** LinkedIn は生産性オーディエンス向けのフェーズ 2 チャネル。当日追うと焦点がぼやけ、カテゴリをスキミングしている PH 投票者に "エンタープライズツール" のシグナルを送ってしまう。T+3 に dev 波が落ち着いてから LinkedIn 投稿をキューする。

### 日本コミュニティ(Note, X-JP)

中島は強い JP オーディエンスを持つ。メーカーポストとヒーロー動画のキャプションの日本語版を出す。ローンチ当日 JP ツイートは 09:00 JST = PT の前日 17:00 — アジア太平洋の投票ウィンドウを捕まえる。

---

## 9. ハンターとコミュニティ・シードリスト

- **ハンターのターゲット:** PH フォロワー 5k+ の人、できれば Claude/LLM 界隈。見つからなければセルフハント — 中島の直接ネットワークで十分強い。
- **シード投票者リスト:** リポジトリをスターした、もしくは MulmoChat と接点のある 50 名。月曜夜にカレンダーリマインダーを DM で送る。
- **コメンター下準備:** 1、3、6、9 時間目に実のある(チアリーディングではない)コメントを残す 4 〜 6 名。PH のアルゴリズムはコメントの速度と多様性も重視する、アップボートだけではない。

---

## 10. リスクと緩和策

| リスク                                                 | 確率     | 緩和策                                                                                                                                 |
| ------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| **アクティベーションギャップ — PH 当日にセットアップが重すぎる** | **高**   | **T-10 までにアクティベーション経路を確定(§10.5 参照):** ホストデモを構築する *か*(現時点では未構築)、`--demo` リプレイモード、あるいはスクリプト化ウォークスルーのいずれか。`npx create-mulmoclaude` だけだと 50% 離脱。 |
| 初回起動時に Claude Code CLI 認証が失敗する            | 中       | アプリ内にプリフライトチェック; 親切なエラーページから Claude Code ドキュメントへリンク                                              |
| "ただのラッパーでしょ"という反論                       | 中       | アンチ・ラッパー・ラインを一字一句そのまま使う: *"It runs Claude Code directly — not the API."* Wiki + マルチセッションで補強。         |
| 認知過負荷(1 メッセージに機能が多すぎる)               | 中       | §4 で既に対処済 — 9 → 5 に圧縮、残りは温存。ラインを死守; スクリーンショットでリストが戻らないよう監視。                             |
| ライブ Claude 呼び出しによるデモ動画のレイテンシ       | 中       | プリレコード、スプライス、スピナー 3 秒以上絶対に見せない                                                                             |
| MIT + Docker が "ハッカーツール、危険" と読まれる      | 低〜中   | **再フレーム:** サンドボックス = *"the level of care a real shell needs."* MIT = *"maximally permissive open source — フォークしろ、出荷しろ、商用利用 OK"*。(MIT は AGPL だと発生していたライセンス反論をそもそも除去する。)|
| Anthropic が同じ週に自社 GUI を出す                    | 低       | 補完的と位置付ける — ローカルファースト、オープンソース、プラグイン拡張可能                                                           |
| PH アルゴリズム — JP タイミングによる米国夕方の追い上げ | 低       | JP ローンチツイートを日本夕方 = PH 当日朝 PT に合わせる                                                                               |

### 10.5 アクティベーション問題 — ここを解くか、当日を失うか

これが v1 プラン最大のギャップ。現実チェック: `npx create-mulmoclaude` があっても、インストール経路は **Node + Claude Code CLI 認証 + Gemini API キー + Docker** — 5 〜 10 分、開発者限定、モバイルはゼロ。PH 勝者は即時充足感。午前中にアップボートが伸び、午後には誰も実際に試していないから勢いが死ぬ。

**インパクト順 3 オプション:**

**オプション A(強く推奨、ただし未構築) — ホスト・リードオンリー・デモ**
- 10 個の準備済みセッションをプリロードしたワークスペース: 「明日、覚えている」メモリ・モーメント、スケジューラーのキャッチアップ、バックリンク入り Wiki、マルチセッションのスナップショット、記事取り込み → Wiki ページのフロー。
- 訪問者は既存の成果物をクリックスルーし、キャンバスを再生できる — タイピング不要、認証不要、API キー不要、Docker 不要。
- 予算: エンジニア約 3 人日 + ホスティング。T-3 までに出荷。**これがプラン全体で最もレバレッジの大きい単一の変更だが、ドメインもインスタンスもまだ用意していない。** コミットするならサブドメインを T-10 までに確保し VM をプロビジョンする。
- 出荷できた場合、ヒーロー動画と全ツイートの CTA が *"try it in your browser"*(決定した URL 付き)になる(`git clone` ではなく)。

**オプション B(最小実用) — "Watch Claude work" モード**
- Gemini キー不要、Claude 認証不要のローカルモード。リポジトリに焼き込んだプリレコードセッションのリプレイを使う。`npx create-mulmoclaude --demo` で 30 秒でインタラクティブウォークスルーに落とす。
- 実インストール比で離脱半減; オプション A には及ばないがアクティベーションコストを抑えられる。

**オプション C(最終手段) — ランディングページ上のスクリプト化スクリーンショット・ウォークスルー**
- ショックデモ、並列セッション、Wiki バックリンク、Telegram 往復をクリックスルー。
- 実インタラクティビティはないが、PH スキマーに "体験した" 感覚だけは残せる。

**決定:** **T-7 までにオプション A にコミット**。スコープが滑ったら C に触る前に B に落ちる。

---

## 11. 成功メトリクス

**当日:**
- Product Hunt: **当日 Top 5**; Top 10 は下限。
- GitHub スター: 24h で **+500**。
- **アクティベーション経路セッション: ユニーク 3,000** — ホストデモまたは `--demo` リプレイが出荷される場合(§10.5)。出荷されなければこの行は N/A。
- インストール数(Gemini キー入力をプロキシに): デモがカジュアル流入を吸収する場合は **500**; インストールが唯一の経路なら **約 1,500**(数は多いが質は低い — 大半が離脱)。
- PH コメント: **50 件以上の実のあるもの**(チーム内を除く)。

**当週:**
- スター: **累積 +1,500**。
- HN: フロントページ 2 時間以上。
- Twitter: ローンチスレッドに 2M+ インプレッション。
- インバウンドポッドキャスト/インタビュー依頼 3 件以上。

**当月:**
- WAU 2,000(セッションログを根拠に)。
- コミュニティ投稿の custom role もしくはプラグインが 5 件。
- @karpathy、@alexalbert、または Anthropic のエンジニアから 1 件の言及(願望だが計測可能)。

---

## 12. 2 つの賭け

外せない勝負所が 2 つある。どちらかを外せば、ローンチは 10 点中 6 点で終わる。

**Bet 1 — メモリ・モーメント(アップボートを稼ぐ)**
ヒーロー動画の 0:15–0:30 ウィンドウ: **「明日」のセッションで昨日の仕事に触れる質問が投げられ、Claude が自分で築いた Wiki を根拠に答える画。** このシーケンスがピッチそのもの — 「あらゆる AI エージェントには健忘症がある、このツールだけは違う」を可視化したもの。並列セッションの冒頭(0:00–0:08)がクリックを稼ぎ、メモリ・ペイオフがアップボートを稼ぐ。メモリ・ビートがなければ、動画は「きれいな UI を持つ Claude の別ラッパー」でしかない。あれば、健忘症の治療を主張しているのは我々だけ。

**Bet 2 — アクティベーション経路(試してもらう)**
PH スキマーがメモリ・モーメントとスケジューラー・ビートをゼロインストールで体験できる経路。現時点ではどれか 1 つを選ぶ: (a) T-3 までに構築をコミットするならホスト・リードオンリー・デモ(§10.5 オプション A、現時点では未構築)、(b) プリレコードセッション・リプレイを焼き込んだ `npx create-mulmoclaude --demo`(§10.5 オプション B)、(c) ランディングページ上のスクリプト化スクリーンショット・ウォークスルー(§10.5 オプション C)。このうち *どれか一つ* がないと、Bet 1 で得たアップボートはスターにも、フォローにも、ビルドにも変換されない。**決定は T-10 まで。** Bet 1 が注意を引き、Bet 2 が記憶に残す。

プラン内の他のすべて — ブリッジ、サンドボックス、ロール、Wiki ツアー、スキルランチャー、マルチモーダル出力 — は、すでに信じた視聴者のための確認バイアスにすぎない。2 つの賭けのどちらにも資さないものはカットする。

---

## 13. 底流にある物語(そもそもなぜこれをやるのか)

PH 当日のフレームは *「あらゆる AI エージェントには健忘症がある、このツールだけは違う」*。だがそのさらに深層のフレーム — HN 向け、長文記事向け、「これはどこに向かっているのか」を知りたい人向け — は、**今日のあらゆる AI エージェントはホームレスである** というものだ。永続的なファイルシステムを持たず、スケジュールを持たず、複利で育つメモリを持たない。呼ばれて、働いて、消える。これはエージェントではない。関数呼び出しだ。

MulmoClaude はそのエージェントに家を与える: `~/mulmoclaude/`。本棚(Wiki)、ファイルキャビネット(ドキュメント)、スケジュール帳(スケジューラー)、電話(ブリッジ)。家があるから蓄積する。蓄積するから賢くなる。賢くなるからもっと自律を任せられる。メモリ → 複利 → 信頼 → 委任。このループを開こうとしているのがこのプランだ。

これは、もっと大きな仮説の最初の可視表層である: **コンピューティングは AI エージェントの上に再プラットフォーム化されつつあり、そのプラットフォームに必要なシェルはまだ存在しない。** Claude Code がカーネル。MulmoClaude がそのシェルの最初のドラフトであり、そのシェルのユーザーに向かう形は、すべての入力が流れ込み、すべての出力が出てくる、たった一つのフォルダである。1975 年、ホームディレクトリはあなたのファイルが置かれる場所だった。2026 年、そこにはあなたのファイル、調査、会話、スケジュールされた作業、そしてそれらから抽出された知識のすべてが置かれる — しかも「何を覚えるべきか、何をファイルすべきか、そして最終的には何をスケジュールすべきか」を知っている AI によってメンテナンスされた状態で。

この最後の節が重要だ。**メモリとスケジューリングはどちらも自律化されるべきである。** 今日、MulmoClaude は自動で覚えてくれるが、スケジュールは依然としてユーザーが手動で設定する必要がある。エンドゲームは、エージェントが自分で「何を繰り返すべきか、何を監視すべきか、毎朝何を要約すべきか」を判断するようになること — Wiki に何を書き込むべきかを既に自分で決めているのと同じように。ユーザーが行うすべて(検索、一時的にまとめたもの、生成された画像や動画、スケジュール出力)が同じメモリに流れ込み、どのセッション、どのデバイス、いつでもアクセスできる。その時点で、「MulmoClaude」は開くツールではなくなり、すでに働いているアンビエントな共同作業者になる。

ローンチがうまくいくなら、我々が祝っているのは成功したプロダクトローンチではなく — 新しいコンピューティング表層の存在を宣言している。フェーズ 2 オーディエンス(生産性ユーザー、ナレッジワーカー、日本市場、エンタープライズ)は後から、初日に築いた dev ネイティブな重力によって引き寄せられる。

このフレーミングこそが、このプランを慎重ではなく攻撃的にしている理由だ。我々は "very advanced tool" になろうとしているのではない。ひとつの鋭い製品を通して、コンピューティングの未来を一瞥させようとしている。

---

*MulmoClaude ローンチ用資料。T-7 の素材ドライランの後に改訂すること。**アクティベーション経路の決定は T-10 まで** — §10.5 オプション A / B / C のいずれかを選ぶ。これがクリティカルパス項目。*
