/**
 * PlatformAdapter インターフェイス
 *
 * Amazon / Shopify 等、プラットフォームごとの CSV 入出力を抽象化する。
 * App.tsx は platform 選択に応じて該当 adapter を選び、共通インターフェイスで呼び出す。
 */

import type { ProductRow, CalcResult } from '../parser';

export type PlatformAdapter = {
  id: 'amazon' | 'shopify';
  label: string;
  /** CSV(バイト列) → ProductRow[] */
  parseCsv: (buffer: ArrayBuffer | Uint8Array, opts?: { activeOnly?: boolean }) => ProductRow[];
  /** 自動改定用CSV（プラットフォームへの一括価格更新形式） */
  buildAutoCsv: (results: CalcResult[]) => string;
  /** 手動対応リストCSV */
  buildManualCsv: (results: CalcResult[]) => string;
  /** 検証用詳細CSV（全カラム） */
  buildDetailCsv: (results: CalcResult[]) => string;
  /** UI表示用ラベル（カラム見出し等） */
  labels: {
    sku: string;       // Amazon="SKU"、Shopify="Variant SKU"
    productId: string; // Amazon="ASIN"、Shopify="Handle"
  };
};
