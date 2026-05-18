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
 * 7. 長さ・本数が Title に含まれない場合：Option1/2/3 Value（例：「3m」「0.5m 2本セット」）
 *    から取得する **B案ロジックを実装済み（2026-05-18）**。Title優先・Option Valueフォールバック。
 *    "Default Title"（バリアント無し商品のShopify標準値）は対象外。
 */

import Papa from 'papaparse';
import type { ProductRow, CalcResult } from '../parser';
import type { PlatformAdapter } from './types';
import { escapeCsv } from '../csv-utils';

/**
 * Option1/2/3 Value から長さ表記を含むかどうか判定するための正規表現。
 *
 * 想定パターン:
 *   "3m" "5m" "10m" "1.5m" "0.5m" → m 表記
 *   "30cm" "50cm" → cm 表記
 *   "3M" "5M" → 大文字 m
 *   "50mリール" "100mロール" "0.5m 2本セット" "0.5m（2本セット）" → 後ろに何か続くケース
 *
 * 弾きたいパターン:
 *   "Default Title" → バリアント無し商品（Shopify標準値）
 *   "" → 空文字
 *   "mogami" "max" 等の英単語の途中にある m は弾く（後方境界で英字を禁止）
 */
const LENGTH_IN_OPTION_RE = /(\d+\.?\d*)\s*(m|M|cm|CM|Cm|cM)(?![a-zA-Z])/;

/**
 * 「N本」表記が Option Value に含まれているかチェック。
 * "0.5m 2本セット" "0.5m（2本セット）" 等から本数も拾えるようにする。
 */
const PIECES_IN_OPTION_RE = /(\d+)\s*本/;

/**
 * Option1/2/3 Value から「長さ・本数」を取得する。
 * 「Default Title」など長さを含まない値は null を返す。
 *
 * 戻り値:
 *   { lengthStr: "3m" | "30cm" 等, piecesStr?: "2本セット" 等 } | null
 *
 * - 1番目に該当が見つかった Option を採用（Option1優先）
 * - 単位を再正規化はせず、検出した元の表記を返す（解析側で extractLengthMeters が再度パースする）
 */
function extractFromOptionValues(
  r: Record<string, string>
): { lengthStr: string; piecesStr: string | null } | null {
  for (const idx of [1, 2, 3] as const) {
    const v = (r[`Option${idx} Value`] ?? '').trim();
    if (!v) continue;
    // "Default Title" は Shopify がバリアント無し商品に自動付与する値。長さ取得対象外。
    if (v.toLowerCase() === 'default title') continue;

    const lenMatch = v.match(LENGTH_IN_OPTION_RE);
    if (!lenMatch) continue;

    const lengthStr = `${lenMatch[1]}${lenMatch[2].toLowerCase()}`; // 小文字に正規化（m / cm）
    const piecesMatch = v.match(PIECES_IN_OPTION_RE);
    const piecesStr = piecesMatch ? `${piecesMatch[1]}本` : null;
    return { lengthStr, piecesStr };
  }
  return null;
}

/**
 * Shopify 商品エクスポートCSV(UTF-8)をブラウザ内でパースして ProductRow[] に変換。
 * バリアント行（同一Handleの2行目以降）は Title 等が空欄になるため前方補完する。
 *
 * 長さ取得ロジック（B案・2026-05-18 追加）:
 *   1. Title に長さ表記がある → そのまま使う（A案フォールバック）
 *   2. Title に長さ表記がない & Option Value に長さ表記がある → productName 末尾に
 *      「(3m)」等を追記して、既存の extractLengthMeters でそのまま拾えるようにする。
 *      "0.5m 2本セット" のように本数表記もあれば末尾に追記する。
 *   3. どちらにも無ければ手動対応（既存挙動）
 *
 * 既存ロジック（calculatePrice / extractLengthMeters / extractCablePieces）には
 * 一切手を入れず、productName への「合成」だけで対応する。
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

    // Handle / Title が空の行はスキップ。
    // Variant SKU は徳山様CSVのようにほぼ全行空欄のストアが存在するため、空欄でも取り込む。
    //   - 識別子は Handle を主とする
    //   - 出力CSV側で SKU 列が空欄でも Shopify は Handle + バリアント識別（Option1/2/3 Value）で照合可能
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

    // B案：Title に長さ表記が無ければ Option Value から取得して productName に合成する。
    // 既存の extractLengthMeters / extractCablePieces は商品名文字列のみを引数に取るため、
    // ここで「(3m) 2本」の形で末尾に追記しておけば下流のロジックには一切触れずに済む。
    let productName = name;
    const titleHasLength = LENGTH_IN_OPTION_RE.test(name); // Title 内に長さ表記があるか
    if (!titleHasLength) {
      const fromOpt = extractFromOptionValues(r);
      if (fromOpt) {
        // 例: "MOGAMI 2534 ステレオミニフォン (15cm)" や
        //     "MOGAMI 2972 外皮加工済み (0.5m) 2本" 等
        const piecesSuffix = fromOpt.piecesStr ? ` ${fromOpt.piecesStr}` : '';
        productName = `${name} (${fromOpt.lengthStr})${piecesSuffix}`;
      }
    }

    rows.push({
      sku,
      productId: handle,
      productName,
      // 解析用 productName は B案で合成した値（"…(3m) 2本"）。
      // 出力CSV用には合成前の原本 Title を使う（Shopify書き戻し時に商品名を破壊しないため）。
      originalProductName: name,
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
 *
 * **重要**: Title 列には B案で合成された解析用 productName ではなく、
 * CSV原本の Title（originalProductName）を出力する。
 * 合成後の "...(3m) 2本" を書き戻すと、Shopify側で商品名が破壊されるため。
 */
function buildAutoCsv(results: CalcResult[]): string {
  const header = 'Handle,Title,Variant SKU,Variant Price';
  const rows = results
    .filter((r) => r.newPrice !== null)
    .map((r) => {
      const handle = r.productId;
      const title = r.originalProductName; // ← 合成前の原本Titleを出力
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
