import { buildStockOrder } from './stockSort';
import type { StockSortState } from './stockSort';

/**
 * 在庫DB編集の対象テーブル。
 * - 'stock'         … Amazon在庫DB編集
 * - 'stock_shopify' … Shopify在庫DB編集（カラム構成は stock の複製）
 */
export type StockTable = 'stock' | 'stock_shopify';

const STOCK_SELECT = 'select=id,sku,item_name,plug_name,current_price,updated_at,created_at';

/**
 * 一覧取得用の PostgREST クエリパスを組み立てる（テーブル名で切替）。
 * 検索語があれば sku / item_name / plug_name の部分一致（ilike）で絞り込む。
 * ソート状態に合わせてサーバー側の並び（チャンク取得の順序）も揃える。
 */
export function buildStockQueryPath(table: StockTable, searchTerm: string, sortState: StockSortState): string {
  const select = `${STOCK_SELECT}&${buildStockOrder(sortState)}`;
  if (!searchTerm.trim()) return `${table}?${select}`;
  const q = encodeURIComponent(`%${searchTerm.trim()}%`);
  return `${table}?or=(sku.ilike.${q},item_name.ilike.${q},plug_name.ilike.${q})&${select}`;
}
