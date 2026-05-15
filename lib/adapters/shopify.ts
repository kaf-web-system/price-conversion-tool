/**
 * Shopify プラットフォーム adapter
 *
 * - 入力: Shopify 商品エクスポートCSV（UTF-8、カンマ区切り、LF改行）
 * - 自動改定出力: `Handle,Title,Variant SKU,Variant Price` 形式（安全構成4列）
 *     → CSVにあって空欄の列は既存値が消える Shopify 仕様のため、更新したい列だけを含める。
 *     → インポート時は「Overwrite any current products with the same handle」チェックON必須。
 * - 手動対応リスト: Handle, Variant SKU, Title, 現在価格, 手動対応理由
 * - 詳細CSV: 検証用 Handle, Variant SKU, Title, 現価格, 改定後価格, 差額, ルール, 分類
 *
 * ---
 * バリアント前方補完について（重要）
 *
 * Shopify CSV は「1商品=1〜N行」の構造で、同じ Handle の2行目以降は
 * Title / Vendor / Status などの共通カラムが空欄になる仕様。
 * 例：
 *   Handle, Title, Variant SKU, Variant Price
 *   audio-cable, MOGAMI 2534 XLR (3m), MGM-2534-3M, 8500
 *   audio-cable, ,                    MGM-2534-5M, 9800   ← Title 空欄
 *
 * このまま商品名解析にかけると2行目以降が「商品名なし」で全部手動対応に
 * 落ちてしまうため、parseCsv 内で同一 Handle の最初の Title / Vendor /
 * Status を後続行へコピー（前方補完）してから ProductRow 化する。
 *
 * ---
 * 徳山様の実CSVが届いたら確認すべき項目（公式仕様と実物の差分が出やすい箇所）
 *
 * 1. カラム順・カラム数：公式仕様にない独自列が混ざっていないか
 *    （例：Inventory location 別カラム、メタフィールド列など）
 * 2. 国際販売（Markets）の追加列：`Price / International` `Compare At Price / International`
 *    が存在する場合は出力でこれらを「空欄で含めない」よう注意（空で上書きされ消える）
 * 3. Status列の実値：active / draft / archived 以外（カスタム値）の存在
 *    特に大文字小文字（"Active" 等）が混ざっていないか — 現在の実装は厳密一致 'active'
 * 4. Variant Price が文字列で「¥8,500」のようにフォーマットされて返るケース
 *    （現状は数値化時に \d. 以外を除去する想定だが要再確認）
 * 5. バリアント行で Variant SKU が空のケースの扱い（現状はスキップ）
 * 6. 商品名（Title）の命名規則：Amazon と同表記か、Shopify用に短縮されているか
 *    → 同表記でなければ既存の正規表現ルール側の調整が必要
 * 7. 長さ・本数が Title に含まれない場合：Option1 Value（例：「3m」）から
 *    取得する分岐（設計プランB案）への切替検討
 */

import Papa from 'papaparse';
import type { ProductRow, CalcResult } from '../parser';
import type { PlatformAdapter } from './types';
import { escapeCsv } from '../csv-utils';

/**
 * Shopify 商品エクスポートCSV(UTF-8)をブラウザ内でパースして ProductRow[] に変換。
 * バリアント行（同一Handleの2行目以降）は Title 等が空欄になるため前方補完する。
 */
function parseShopifyCsv(
  buffer: ArrayBuffer | Uint8Array,
  opts: { activeOnly?: boolean } = {}
): ProductRow[] {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

  // UTF-8 でデコード（Shopify公式仕様は UTF-8 固定）
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let text = decoder.decode(bytes);

  // 先頭にBOMが残っていれば除去
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });

  // ---- バリアント前方補完 ----
  // Handle ごとに「最初の非空 Title / Vendor / Status」を覚えて、後続行へ複製。
  // 元の raw を破壊しないようコピーしてから書き戻す（出力時に raw['Title'] 等を
  // 参照できるようにするため、補完後の値で raw も更新する）。
  const filledByHandle = new Map<string, { title: string; vendor: string; status: string }>();
  const filledRows: Record<string, string>[] = [];
  for (const r of parsed.data) {
    const handle = (r['Handle'] ?? '').trim();
    if (!handle) {
      // Handle が無い行はそのまま渡す（通常は発生しないが安全に）
      filledRows.push({ ...r });
      continue;
    }
    const titleRaw = (r['Title'] ?? '').trim();
    const vendorRaw = (r['Vendor'] ?? '').trim();
    const statusRaw = (r['Status'] ?? '').trim();

    let cache = filledByHandle.get(handle);
    if (!cache) {
      cache = { title: titleRaw, vendor: vendorRaw, status: statusRaw };
      filledByHandle.set(handle, cache);
    } else {
      // 既存キャッシュ：この行で値があってキャッシュが空ならキャッシュへ反映。
      // この行で値が空ならキャッシュからの補完を下の filled[...] 側で実施。
      if (titleRaw && !cache.title) cache.title = titleRaw;
      if (vendorRaw && !cache.vendor) cache.vendor = vendorRaw;
      if (statusRaw && !cache.status) cache.status = statusRaw;
    }

    const filled: Record<string, string> = { ...r };
    if (!titleRaw && cache.title) filled['Title'] = cache.title;
    if (!vendorRaw && cache.vendor) filled['Vendor'] = cache.vendor;
    if (!statusRaw && cache.status) filled['Status'] = cache.status;
    filledRows.push(filled);
  }

  // ---- ProductRow 化 ----
  const rows: ProductRow[] = [];
  for (const r of filledRows) {
    const sku = (r['Variant SKU'] ?? '').trim();
    const handle = (r['Handle'] ?? '').trim();
    const name = (r['Title'] ?? '').trim();
    const priceStr = (r['Variant Price'] ?? '').trim();
    const status = (r['Status'] ?? '').trim();

    // SKU が空、または Handle/Title が空の行はスキップ
    if (!sku) continue;
    if (!handle) continue;
    if (!name) continue;

    // 価格パース（"¥8,500" のような形式にも一応耐えるよう数字とドット以外を除去）
    const priceNum = parseFloat(priceStr.replace(/[^\d.]/g, ''));
    if (!priceStr || isNaN(priceNum) || priceNum <= 0) continue;

    // activeOnly 指定時は status === 'active' のみ。
    // ただし「Status空文字」は active 扱いとして寛容に判定する。
    // バリアント2行目以降や Status 列自体が無いCSVの場合、前方補完で埋まらず
    // 空文字のままになるケースがあり、厳密一致だと全部スキップされてしまうため。
    if (opts.activeOnly && status !== '' && status.toLowerCase() !== 'active') continue;

    rows.push({
      sku,
      productId: handle,
      productName: name,
      currentPrice: priceNum,
      status,
      raw: r,
    });
  }
  return rows;
}

/**
 * 自動改定用CSV: `Handle,Title,Variant SKU,Variant Price`（安全構成4列）
 * LF改行、UTF-8（BOMなし）。改定対象（newPrice !== null）のみ出力。
 * Title は ProductRow.raw['Title'] から取得（parseCsv で前方補完済み）。
 */
function buildAutoCsv(results: CalcResult[]): string {
  const header = 'Handle,Title,Variant SKU,Variant Price';
  const rows = results
    .filter((r) => r.newPrice !== null)
    .map((r) => {
      // CalcResult には raw を持っていないため、productId(=Handle)・productName(=Title) を使う
      // ※ parseShopifyCsv の段階で前方補完済みなので productName は必ず埋まっている
      const handle = r.productId;
      const title = r.productName;
      return `${escapeCsv(handle)},${escapeCsv(title)},${escapeCsv(r.sku)},${r.newPrice}`;
    });
  return [header, ...rows].join('\n');
}

/**
 * 手動対応リストCSV: `Handle,Variant SKU,Title,現在価格,手動対応理由`
 * LF改行、UTF-8（ダウンロード時の BOM 付与はダウンローダー側で制御）
 */
function buildManualCsv(results: CalcResult[]): string {
  const header = 'Handle,Variant SKU,Title,現在価格,手動対応理由';
  const rows = results
    .filter((r) => r.newPrice === null)
    .map(
      (r) =>
        `${escapeCsv(r.productId)},${escapeCsv(r.sku)},${escapeCsv(r.productName)},${r.currentPrice},${escapeCsv(
          r.manualReason ?? ''
        )}`
    );
  return [header, ...rows].join('\n');
}

/**
 * 詳細CSV（検証用・全カラム）: `Handle,Variant SKU,Title,現価格,改定後価格,差額,マッチしたルール,分類`
 * LF改行、UTF-8。ダウンローダ側で BOM を付与する。
 */
function buildDetailCsv(results: CalcResult[]): string {
  const header = 'Handle,Variant SKU,Title,現価格,改定後価格,差額,マッチしたルール,分類';
  const rows = results.map((r) => {
    const klass = r.newPrice === null ? `手動対応: ${r.manualReason ?? ''}` : '自動改定';
    const newP = r.newPrice !== null ? String(r.newPrice) : '';
    const diff = r.diff !== null ? (r.diff >= 0 ? `+${r.diff}` : String(r.diff)) : '';
    const rule = r.matchedRuleLabel ?? '';
    return `${escapeCsv(r.productId)},${escapeCsv(r.sku)},${escapeCsv(r.productName)},${r.currentPrice},${newP},${escapeCsv(diff)},${escapeCsv(rule)},${escapeCsv(klass)}`;
  });
  return [header, ...rows].join('\n');
}

export const shopifyAdapter: PlatformAdapter = {
  id: 'shopify',
  label: 'Shopify',
  parseCsv: parseShopifyCsv,
  buildAutoCsv,
  buildManualCsv,
  buildDetailCsv,
  labels: {
    sku: 'Variant SKU',
    productId: 'Handle',
  },
};
