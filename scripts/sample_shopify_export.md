# Shopify Adapter 動作確認用サンプルCSV解説

`sample_shopify_export.csv` の各行は以下の検証を意図しています。

| 行 | Variant SKU | 検証意図 |
|---|---|---|
| 1 | MGM-2534-3M | 標準的なバリアントなし商品。MOGAMI 2534 ルールで自動改定。 |
| 2 | MGM-2534-5M | 1行目のバリアント（5m）。**Status空欄** で前方補完テスト。Title「(3m)」が継承される＝現状仕様は長さも3m扱い（B案=Option Value取得は徳山様CSV受領後に検討）。 |
| 3 | BLD-88760-4M | 別商品 BELDEN（2本ペア・4m）。複数ルールマッチを検証。 |
| 4 | CNR-L4E6S-2M | 別商品 CANARE（2m）。シンプル計算検証。 |
| 5 | MGM-2534-NL | **長さ表記なし**で手動対応に落ちる検証。 |
| 6 | DRAFT-001 | **status=draft** で activeOnly フィルタテスト。 |

## 期待される結果（activeOnly=true、デフォルトルール3つ）

- 読み込み: 5件（draft除外）
- 自動改定: 4件
- 手動対応: 1件（長さ読み取れない MGM-2534-NL）

詳細CSV出力時のカラム順とエンコーディングも目視確認に使えます。

## activeOnly の寛容判定について

行2（MGM-2534-5M）は Status 列が空欄ですが、Shopify CSV の仕様上
バリアント2行目以降は共通カラムが空になります。
adapter 側で「Status 空文字＝active 扱い」として寛容に判定するため、
activeOnly=true でも行2は対象に含まれます。
（厳密一致だとバリアント全滅するため）
