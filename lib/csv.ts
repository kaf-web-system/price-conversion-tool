import Papa from 'papaparse';
import iconv from 'iconv-lite';
import type { AmazonRow } from './parser';

/**
 * Amazon出品レポートCSV(CP932)をパースして AmazonRow[] に変換
 * Active のみ対象とするオプションあり
 */
export function parseAmazonCsv(buffer: Buffer, opts: { activeOnly?: boolean } = {}): AmazonRow[] {
  // CP932 → UTF-8（失敗時は素のutf-8で再試行）
  let text: string;
  try {
    text = iconv.decode(buffer, 'cp932');
  } catch {
    text = buffer.toString('utf-8');
  }

  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });

  const rows: AmazonRow[] = [];
  for (const r of parsed.data) {
    const sku = (r['出品者SKU'] ?? '').trim();
    const asin = (r['ASIN 1'] ?? '').trim();
    const name = (r['商品名'] ?? '').trim();
    const priceStr = (r['価格'] ?? '').trim();
    const status = (r['ステータス'] ?? '').trim();
    if (!sku && !asin) continue;
    if (!name) continue;
    if (opts.activeOnly && status !== 'Active') continue;
    const price = parseFloat(priceStr.replace(/[^\d.]/g, ''));
    rows.push({
      sku,
      asin,
      productName: name,
      currentPrice: isNaN(price) ? 0 : price,
      status,
      raw: r,
    });
  }
  return rows;
}

/** 自動改定用CSV: SKU,price */
export function buildAutoCsv(results: { sku: string; newPrice: number | null }[]): string {
  const rows = results
    .filter((r) => r.newPrice !== null)
    .map((r) => `${escapeCsv(r.sku)},${r.newPrice}`);
  return ['sku,price', ...rows].join('\n');
}

/** 手動対応リスト用CSV */
export function buildManualCsv(
  results: {
    sku: string;
    asin: string;
    productName: string;
    currentPrice: number;
    manualReason: string | null;
  }[]
): string {
  const header = 'sku,asin,商品名,現在価格,手動対応理由';
  const rows = results.map(
    (r) =>
      `${escapeCsv(r.sku)},${escapeCsv(r.asin)},${escapeCsv(r.productName)},${r.currentPrice},${escapeCsv(
        r.manualReason ?? ''
      )}`
  );
  return [header, ...rows].join('\n');
}

function escapeCsv(s: string): string {
  if (s == null) return '';
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
