import { buildStockOrder } from './stockSort';
import type { StockSortState } from './stockSort';

/**
 * 在庫DB編集の対象テーブル。
 * - 'stock'         … Amazon在庫DB編集
 * - 'stock_shopify' … Shopify在庫DB編集（カラム構成は stock の複製）
 */
export type StockTable = 'stock' | 'stock_shopify';

const STOCK_SELECT = 'select=id,sku,item_name,plug_name,current_price,updated_at,created_at';

const PLUG_UNREGISTERED_FILTER = 'or=(plug_name.is.null,plug_name.eq.)';

/**
 * 一覧取得用の PostgREST クエリパスを組み立てる（テーブル名で切替）。
 * 検索語があれば sku / item_name / plug_name の部分一致（ilike）で絞り込む。
 * unregisteredOnly が true なら plug_name が null または空文字の行だけに絞り込む。
 * ソート状態に合わせてサーバー側の並び（チャンク取得の順序）も揃える。
 * PostgREST は複数のクエリパラメータを AND で結合するため、検索 or=(...) と
 * プラグ未登録 or=(...) は別パラメータとして並べれば AND になる。
 */
export function buildStockQueryPath(
  table: StockTable,
  searchTerm: string,
  sortState: StockSortState,
  unregisteredOnly = false,
): string {
  const select = `${STOCK_SELECT}&${buildStockOrder(sortState)}`;
  if (!searchTerm.trim()) {
    return unregisteredOnly
      ? `${table}?${select}&${PLUG_UNREGISTERED_FILTER}`
      : `${table}?${select}`;
  }
  const q = encodeURIComponent(`%${searchTerm.trim()}%`);
  const searchFilter = `or=(sku.ilike.${q},item_name.ilike.${q},plug_name.ilike.${q})`;
  return unregisteredOnly
    ? `${table}?${searchFilter}&${PLUG_UNREGISTERED_FILTER}&${select}`
    : `${table}?${searchFilter}&${select}`;
}
