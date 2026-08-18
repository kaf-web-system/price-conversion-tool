import { parseCsv } from './shopifyParser';
import type { StockUpsertRow } from './stockImport';

/**
 * Shopify在庫DB（stock_shopify）一括インポート用の純関数群。
 * Shopify商品CSV（products_export形式: Handle / Title / Option1-3 Value / Variant Price）から
 * stock_shopify テーブルへの upsert 行を組み立てる。
 *
 * SKU 連結仕様（発注元スペック）:
 *   Shopifyは複数の項目値でデータを特定するため、Handle とバリアントの Option1〜3 の値を
 *   _（アンダーバー）で接続した文字列を stock_shopify.sku として登録する。
 *   例: Handle=aaaa, Option1=bbbb, Option2=cccc → sku = aaaa_bbbb_cccc
 */

export type ShopifyStockCollectResult = {
  rows: StockUpsertRow[];
  /** Handle が空でスキップした行数 */
  noSkuCount: number;
  /** 価格が空または0で価格未設定として登録した行数 */
  noPriceCount: number;
  /** 必須列（Handle / Variant Price）が見つからない等、ファイル単位のエラー */
  columnError: string | null;
};

/**
 * Handle と Option1〜3 の値を _ で連結して Shopify 用 SKU を作る。
 * - 空欄の Option はスキップ（末尾や途中に _ を残さない）
 * - バリアントなし商品の既定値 'Default Title' もスキップ（sku = Handle のみ）
 *   例: Handle=aaaa, Option1=bbbb, Option2=(空), Option3=cccc → aaaa_bbbb_cccc
 */
export function buildShopifySku(handle: string, options: string[]): string {
  const parts = [
    handle.trim(),
    ...options.map((o) => o.trim()).filter((o) => o !== '' && o !== 'Default Title'),
  ];
  return parts.join('_');
}

/**
 * Shopify商品CSVのテキストから stock_shopify への upsert 行を作る。
 * - sku = buildShopifySku(Handle, [Option1, Option2, Option3])
 * - item_name = Title（バリアント行の空欄は同一Handleグループ内で前方補完。取れない場合は null）
 * - current_price = Variant Price（0より大きい場合のみ整数に丸めて採用、それ以外は null）
 * - 同一 sku の重複は後勝ち（Amazon側 collectStockUpsertRows と同じ）
 * - Status による絞り込みはしない（Amazon側インポートの activeOnly:false と同等）
 */
export function collectShopifyStockRows(text: string): ShopifyStockCollectResult {
  const clean = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const allRows = parseCsv(clean);
  if (allRows.length < 2) {
    return { rows: [], noSkuCount: 0, noPriceCount: 0, columnError: 'データ行がありません' };
  }

  const header = allRows[0];
  const col = (name: string) =>
    header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());

  const iHandle = col('Handle');
  const iTitle = col('Title');
  const iPrice = col('Variant Price');
  const iOpt1 = col('Option1 Value');
  const iOpt2 = col('Option2 Value');
  const iOpt3 = col('Option3 Value');

  if (iHandle === -1) {
    return { rows: [], noSkuCount: 0, noPriceCount: 0, columnError: 'Handle 列が見つかりません（Shopify商品CSVを指定してください）' };
  }
  if (iPrice === -1) {
    return { rows: [], noSkuCount: 0, noPriceCount: 0, columnError: 'Variant Price 列が見つかりません（Shopify商品CSVを指定してください）' };
  }

  const cell = (cols: string[], i: number): string => (i >= 0 && i < cols.length ? cols[i].trim() : '');

  const seen = new Map<string, StockUpsertRow>();
  let noSkuCount = 0;
  let noPriceCount = 0;

  // Title はグループ先頭行にのみ入っているため、同一 Handle グループ内で前方補完する
  let lastHandle = '';
  let lastTitle = '';

  for (let i = 1; i < allRows.length; i++) {
    const cols = allRows[i];
    if (cols.length === 1 && cols[0] === '') continue; // 空行（末尾改行など）

    const handle = cell(cols, iHandle);
    if (!handle) { noSkuCount++; continue; }

    const rawTitle = cell(cols, iTitle);
    if (handle !== lastHandle) {
      lastHandle = handle;
      lastTitle = rawTitle;
    } else if (rawTitle) {
      lastTitle = rawTitle;
    }

    const sku = buildShopifySku(handle, [cell(cols, iOpt1), cell(cols, iOpt2), cell(cols, iOpt3)]);

    const priceStr = cell(cols, iPrice).replace(/[^\d.]/g, '');
    const priceNum = priceStr ? parseFloat(priceStr) : NaN;
    const price = !isNaN(priceNum) && priceNum > 0 ? Math.round(priceNum) : null;
    if (price === null) noPriceCount++;

    seen.set(sku, { sku, item_name: lastTitle || null, current_price: price });
  }

  return { rows: Array.from(seen.values()), noSkuCount, noPriceCount, columnError: null };
}
