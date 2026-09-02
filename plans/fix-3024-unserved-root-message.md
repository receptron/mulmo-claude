# resolver が登録 root に `null` を返すと「黙っているのに書けない」（#3024）

## 症状（再現済み）

ホストの配線 3 通りを実際に走らせた結果:

```text
渡していない                    warn: 出る   write: writing to a non-default stories root is not supported yet
渡すが登録 root に null を返す   warn: 黙る   write: writing to a non-default stories root is not supported yet
正しく答える                    warn: 黙る   write: allowed
```

2 行目が問題。**警告は黙るのに書き込みは拒否される。** しかもメッセージが
`not supported yet`（＝プラグインの機能不足）と読めるので、ホストは
**自分の resolver が原因だと分かりません**。

#3022 が閉じたのは「言っていることとコードが逆」。その逆向き版が残っている。

## 原因

`guardStoryWriteRoot` が、性質の違う 2 つの失敗に**同じ文言**を使っている:

| 実際の状態 | 正しい説明 |
|---|---|
| `artifactsFor` を渡していない | この機能はまだこのホストで有効になっていない |
| 渡しているが、その root に `null` を返した | **このホストの resolver がその root に答えなかった** |

前者はプラグイン側の制限、後者は**ホストの配線ミス**。直す場所が違うのに
同じ文字列を読まされる。

## やること — 副作用の無い側だけ

**構築時に resolver を呼ばない。** issue の案 2（構築時に全 root を照合）は
ホストが遅延初期化していると早すぎる呼び出しになり、いま無い問題を作る。

`guardStoryWriteRoot` が拒否する時点では **すでに `artifactsForRoot` を呼んでいる**
ので、そこで「resolver は在るのに答えなかった」かどうかが分かる。追加の呼び出しは
発生しない。文言を分けるだけ。

## 決めたこと

- **`artifactsFor` の有無で文言を分ける。** 在って答えなかったなら root を名指しし、
  ホストが直す場所（自分の resolver）を指す
- **構築時の照合はしない。** 副作用を避ける。issue に案として残す
- **コードは分岐しない。** 拒否する条件は変えず、説明だけを変える

## 検証

- 3 通りの配線それぞれで、拒否の**理由**が正しいこと
- 既定 root と、正しく答えるホストが無改変であること
- リバートで赤になること
