import type { AmazonRow } from './parser';

/**
 * 在庫DB（stock）一括インポート用の純関数群。
 * ファイル解析後の AmazonRow[] から stock テーブルへの upsert 行を組み立てる。
 */

export type StockUpsertRow = {
  sku: string;
  /** 商品名（stock.item_name）。取得できない場合は null */
  item_name: string | null;
  current_price: number | null;
};

export type ImportCollectResult = {
  rows: StockUpsertRow[];
  /** SKU が空でスキップした行数 */
  noSkuCount: number;
  /** 価格が空または0で価格未設定として登録した行数 */
  noPriceCount: number;
};

/**
 * パース済み行から upsert 行を作る。
 * - SKU 重複は後勝ち（従来挙動を維持）
 * - 価格は 0 より大きい場合のみ整数に丸めて採用、それ以外は null
 * - 商品名は productName をトリムして item_name に採用（空なら null）
 */
export function collectStockUpsertRows(parsed: AmazonRow[]): ImportCollectResult {
  const seen = new Map<string, StockUpsertRow>();
  let noSkuCount = 0;
  let noPriceCount = 0;
  for (const r of parsed) {
    const sku = r.sku.trim();
    if (!sku) { noSkuCount++; continue; }
    const price = r.currentPrice > 0 ? Math.round(r.currentPrice) : null;
    if (price === null) noPriceCount++;
    const itemName = (r.productName ?? '').trim();
    seen.set(sku, { sku, item_name: itemName || null, current_price: price });
  }
  return { rows: Array.from(seen.values()), noSkuCount, noPriceCount };
}

/**
 * upsert 行を PostgREST へ送るバッチに分割する。
 * 商品名が取れない行（旧形式ファイル等）は item_name キー自体を送らず、
 * DB に既に登録済みの item_name を null で上書きしない（後方互換）。
 * PostgREST の一括 insert は全行同一キーが必要なため、有無で2バッチに分ける。
 */
export function toUpsertBatches(
  rows: StockUpsertRow[],
  updatedAt: string
): Record<string, unknown>[][] {
  const withName = rows
    .filter((r) => r.item_name !== null)
    .map((r) => ({ sku: r.sku, item_name: r.item_name, current_price: r.current_price, updated_at: updatedAt }));
  const withoutName = rows
    .filter((r) => r.item_name === null)
    .map((r) => ({ sku: r.sku, current_price: r.current_price, updated_at: updatedAt }));
  const batches: Record<string, unknown>[][] = [];
  if (withName.length > 0) batches.push(withName);
  if (withoutName.length > 0) batches.push(withoutName);
  return batches;
}
