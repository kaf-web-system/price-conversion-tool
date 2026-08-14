/**
 * 在庫DB（stock）一覧のソート状態管理・比較の純関数群。
 *
 * 仕様:
 * - ソート対象は「商品名（item_name）」と「価格（current_price）」の2列
 * - 初期表示は商品名の昇順
 * - 同じ列をクリックすると昇順⇔降順をトグル
 * - 別の列をクリックするとその列の昇順に切り替え（前の列のソートは解除）
 * - 適用されるソートは常にどちらか一方のみ
 */

export type StockSortKey = 'item_name' | 'current_price';
export type StockSortDir = 'asc' | 'desc';
export type StockSortState = { key: StockSortKey; dir: StockSortDir };

/** 初期表示: 商品名の昇順 */
export const DEFAULT_STOCK_SORT: StockSortState = { key: 'item_name', dir: 'asc' };

/** 列タイトルクリック時の次のソート状態を返す */
export function nextStockSort(current: StockSortState, clicked: StockSortKey): StockSortState {
  if (current.key === clicked) {
    return { key: clicked, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  }
  return { key: clicked, dir: 'asc' };
}

/**
 * PostgREST の order クエリ句を返す。
 * サーバー側ページング（チャンク取得）の並びを表示ソートと揃えるために使う。
 * null は昇順・降順とも末尾、同値は sku 昇順で安定化。
 */
export function buildStockOrder(sort: StockSortState): string {
  return `order=${sort.key}.${sort.dir}.nullslast,sku.asc`;
}

type SortableStockRow = {
  sku: string;
  item_name: string | null;
  current_price: number | null;
};

/**
 * 表示用の安定ソート（元配列は変更しない）。
 * - 商品名は localeCompare('ja') による日本語対応の比較
 * - null（未設定）は昇順・降順に関わらず末尾
 * - 同値は sku 昇順で安定化
 */
export function sortStockRows<T extends SortableStockRow>(rows: T[], sort: StockSortState): T[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    let cmp: number;
    if (sort.key === 'item_name') {
      const av = a.item_name;
      const bv = b.item_name;
      if (av === null && bv === null) cmp = 0;
      else if (av === null) return 1;
      else if (bv === null) return -1;
      else cmp = av.localeCompare(bv, 'ja');
    } else {
      const av = a.current_price;
      const bv = b.current_price;
      if (av === null && bv === null) cmp = 0;
      else if (av === null) return 1;
      else if (bv === null) return -1;
      else cmp = av - bv;
    }
    if (cmp !== 0) return sign * (cmp > 0 ? 1 : -1);
    return a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0;
  });
}
