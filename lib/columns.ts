import type { AmazonRow } from './parser';

// 列名の揺れに対応するエイリアスマップ（プラットフォーム非依存）
export const COL_ALIASES: Record<string, string[]> = {
  sku:          ['出品者SKU', 'seller-sku', 'SKU'],
  asin:         ['ASIN 1', 'ASIN1', 'ASIN'],
  productName:  ['商品名', '商品タイトル', 'item-name', 'title'],
  description:  ['商品説明', 'item-description', '商品の説明'],
  bulletPoints: ['商品の仕様(まとめ)', '商品の仕様', 'bullet-point', 'bullet_point', '商品のポイント'],
  price:        ['販売価格', '価格', 'price', 'Price', '出品価格', '希望小売価格'],
  status:       ['ステータス', 'status', 'Status'],
};

export function pickCol(row: Record<string, string>, aliases: string[]): string {
  for (const alias of aliases) {
    const val = row[alias];
    if (val !== undefined) return String(val).trim();
  }
  return '';
}

export function rowsToAmazonRows(
  records: Record<string, string>[],
  opts: { activeOnly?: boolean } = {}
): AmazonRow[] {
  const rows: AmazonRow[] = [];
  for (const r of records) {
    const sku          = pickCol(r, COL_ALIASES.sku);
    const asin         = pickCol(r, COL_ALIASES.asin);
    const name         = pickCol(r, COL_ALIASES.productName);
    const description  = pickCol(r, COL_ALIASES.description);
    const bulletPoints = pickCol(r, COL_ALIASES.bulletPoints);
    const priceStr     = pickCol(r, COL_ALIASES.price);
    const status       = pickCol(r, COL_ALIASES.status);

    if (!sku && !asin) continue;
    if (!name) continue;
    if (opts.activeOnly && status !== 'Active') continue;

    const price = parseFloat(priceStr.replace(/[^\d.]/g, ''));
    rows.push({
      sku,
      asin,
      productName: name,
      description,
      bulletPoints,
      currentPrice: isNaN(price) ? 0 : price,
      status,
      raw: r,
    });
  }
  return rows;
}
