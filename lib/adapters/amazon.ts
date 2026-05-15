/**
 * Amazon プラットフォーム adapter
 *
 * - 入力: Amazon出品レポートCSV（CP932/Shift-JIS互換、カンマ区切り）
 * - 自動改定出力: `sku,price` 形式（Amazon一括価格更新CSV）
 * - 手動対応リスト: 検証用に sku, asin, 商品名, 現在価格, 手動対応理由
 * - 詳細CSV: 全カラムの検証用ダンプ
 */

import Papa from 'papaparse';
import type { ProductRow, CalcResult } from '../parser';
import type { PlatformAdapter } from './types';
import { escapeCsv } from '../csv-utils';

/**
 * Amazon出品レポートCSV(CP932/UTF-8)をブラウザ内でパースして ProductRow[] に変換。
 * Active のみ対象とするオプションあり。
 *
 * ブラウザ動作のため iconv-lite/Buffer は使わず TextDecoder('shift-jis') を利用。
 * shift-jis でデコード失敗(化け検知)の場合は UTF-8 で再試行する。
 */
function parseAmazonCsv(
  buffer: ArrayBuffer | Uint8Array,
  opts: { activeOnly?: boolean } = {}
): ProductRow[] {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

  // CP932 (shift-jis 互換) でデコード。失敗時は UTF-8 で再試行。
  let text: string;
  try {
    const decoder = new TextDecoder('shift-jis', { fatal: false });
    text = decoder.decode(bytes);
  } catch {
    const decoder = new TextDecoder('utf-8', { fatal: false });
    text = decoder.decode(bytes);
  }

  // 先頭にBOMが残っていれば除去
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });

  const rows: ProductRow[] = [];
  for (const r of parsed.data) {
    const sku = (r['出品者SKU'] ?? '').trim();
    const asin = (r['ASIN 1'] ?? '').trim();
    const name = (r['商品名'] ?? '').trim();
    const priceStr = (r['価格'] ?? '').trim();
    const status = (r['ステータス'] ?? '').trim();
    if (!sku && !asin) continue;
    if (!name) continue;
    // Amazon出品レポートは仕様上必ず 'Active'（Pascalcase）。
    // Shopify側はバリアント補完で空文字になりうるため寛容判定だが、Amazonは厳密一致でOK。
    if (opts.activeOnly && status !== 'Active') continue;
    const price = parseFloat(priceStr.replace(/[^\d.]/g, ''));
    rows.push({
      sku,
      productId: asin,
      productName: name,
      currentPrice: isNaN(price) ? 0 : price,
      status,
      raw: r,
    });
  }
  return rows;
}

/** 自動改定用CSV: sku,price（Amazon一括価格更新フォーマット） */
function buildAutoCsv(results: CalcResult[]): string {
  const rows = results
    .filter((r) => r.newPrice !== null)
    .map((r) => `${escapeCsv(r.sku)},${r.newPrice}`);
  return ['sku,price', ...rows].join('\n');
}

/** 手動対応リストCSV */
function buildManualCsv(results: CalcResult[]): string {
  const header = 'sku,asin,商品名,現在価格,手動対応理由';
  const rows = results
    .filter((r) => r.newPrice === null)
    .map(
      (r) =>
        `${escapeCsv(r.sku)},${escapeCsv(r.productId)},${escapeCsv(r.productName)},${r.currentPrice},${escapeCsv(
          r.manualReason ?? ''
        )}`
    );
  return [header, ...rows].join('\n');
}

/** 詳細CSV（検証用・全カラム） */
function buildDetailCsv(results: CalcResult[]): string {
  const header = 'sku,商品名,現価格,改定後価格,差額,マッチしたルール,分類';
  const rows = results.map((r) => {
    const klass = r.newPrice === null ? `手動対応: ${r.manualReason ?? ''}` : '自動改定';
    const newP = r.newPrice !== null ? String(r.newPrice) : '';
    const diff = r.diff !== null ? (r.diff >= 0 ? `+${r.diff}` : String(r.diff)) : '';
    const rule = r.matchedRuleLabel ?? '';
    return `${escapeCsv(r.sku)},${escapeCsv(r.productName)},${r.currentPrice},${newP},${escapeCsv(diff)},${escapeCsv(rule)},${escapeCsv(klass)}`;
  });
  return [header, ...rows].join('\n');
}

export const amazonAdapter: PlatformAdapter = {
  id: 'amazon',
  label: 'Amazon',
  parseCsv: parseAmazonCsv,
  buildAutoCsv,
  buildManualCsv,
  buildDetailCsv,
  labels: {
    sku: 'SKU',
    productId: 'ASIN',
  },
};
