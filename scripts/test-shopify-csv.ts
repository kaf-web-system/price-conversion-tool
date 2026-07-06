/**
 * 徳山様の実 Shopify CSV で動作確認するスクリプト
 *   npx tsx scripts/test-shopify-csv.ts
 *
 * 主に B案（Option Value から長さ取得）の効果を A案 と比較するためのスクリプト。
 * - A案相当: parseShopifyCsv で productName を Title のみで決定するルート（旧ロジック）
 * - B案相当: 現在の parseShopifyCsv（Option Value からも長さを取得）
 *
 * 両者を同じCSVで走らせて、自動改定 vs 手動の件数差を出力する。
 */
import { readFileSync } from 'fs';
import Papa from 'papaparse';
import { shopifyAdapter } from '../lib/adapters/shopify';
import { calculatePrice, type KeywordRule, type ProductRow } from '../lib/parser';

const CSV_PATH =
  '/Users/chanchan/Desktop/こうちゃん依頼内容/ショッピファイ/products_export_1.csv';

// テスト用ルール（Amazon側スクリプトと同じ主要ブランド）
const RULES: KeywordRule[] = [
  { id: '1', label: 'BELDEN 88760', pattern: 'BELDEN\\s*88760', cablePerMeter: 200, plugPerPiece: 300 },
  { id: '2', label: 'BELDEN 8412', pattern: 'BELDEN\\s*8412', cablePerMeter: 180, plugPerPiece: 300 },
  { id: '3', label: 'MOGAMI 2534', pattern: 'MOGAMI\\s*2534', cablePerMeter: 150, plugPerPiece: 300 },
  { id: '4', label: 'MOGAMI 2549', pattern: 'MOGAMI\\s*2549', cablePerMeter: 150, plugPerPiece: 300 },
  { id: '5', label: 'MOGAMI 2893', pattern: 'MOGAMI\\s*2893', cablePerMeter: 150, plugPerPiece: 300 },
  { id: '6', label: 'MOGAMI 2944', pattern: 'MOGAMI\\s*2944', cablePerMeter: 180, plugPerPiece: 300 },
  { id: '7', label: 'MOGAMI 2972', pattern: 'MOGAMI\\s*2972', cablePerMeter: 180, plugPerPiece: 300 },
  { id: '8', label: 'CANARE L-4E6S', pattern: 'CANARE\\s*L-?4E6S', cablePerMeter: 100, plugPerPiece: 250 },
  { id: '9', label: 'CANARE L-2T2S', pattern: 'CANARE\\s*L-?2T2S', cablePerMeter: 100, plugPerPiece: 250 },
  { id: '10', label: 'CANARE 4S6/4S8/4S11', pattern: 'CANARE\\s*4S(6|8|11)', cablePerMeter: 120, plugPerPiece: 250 },
  { id: '11', label: 'GOTHAM GAC-2', pattern: 'GOTHAM\\s*GAC-?2', cablePerMeter: 220, plugPerPiece: 350 },
  { id: '12', label: 'ZONOTONE', pattern: 'Zonotone|ゾノトーン', cablePerMeter: 180, plugPerPiece: 300 },
];

// ============================================================
// A案再現: productName を Title のみで決定するパース関数
//   （現行 shopifyAdapter.parseCsv は B案実装済みなので、比較用に旧ロジック相当を再現）
// ============================================================
function parseShopifyCsvAOnly(buf: Buffer, activeOnly: boolean): ProductRow[] {
  let text = buf.toString('utf-8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });

  // 前方補完
  const filledByHandle = new Map<string, { title: string; vendor: string; status: string }>();
  const filledRows: Record<string, string>[] = [];
  for (const r of parsed.data) {
    const handle = (r['Handle'] ?? '').trim();
    if (!handle) {
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
      if (titleRaw && !cache.title) cache.title = titleRaw;
      if (vendorRaw && !cache.vendor) cache.vendor = vendorRaw;
      if (statusRaw && !cache.status) cache.status = statusRaw;
    }
    const filled = { ...r };
    if (!titleRaw && cache.title) filled['Title'] = cache.title;
    if (!vendorRaw && cache.vendor) filled['Vendor'] = cache.vendor;
    if (!statusRaw && cache.status) filled['Status'] = cache.status;
    filledRows.push(filled);
  }

  const rows: ProductRow[] = [];
  for (const r of filledRows) {
    const sku = (r['Variant SKU'] ?? '').trim();
    const handle = (r['Handle'] ?? '').trim();
    const name = (r['Title'] ?? '').trim();
    const priceStr = (r['Variant Price'] ?? '').trim();
    const status = (r['Status'] ?? '').trim();
    // A案も B案と同条件にするため SKU 必須は外す（識別子は Handle）
    if (!handle || !name) continue;
    const priceNum = parseFloat(priceStr.replace(/[^\d.]/g, ''));
    if (!priceStr || isNaN(priceNum) || priceNum <= 0) continue;
    if (activeOnly && status !== '' && status.toLowerCase() !== 'active') continue;
    rows.push({ sku, productId: handle, productName: name, currentPrice: priceNum, status, raw: r });
  }
  return rows;
}

// ============================================================
// 実行
// ============================================================
console.log('CSV読み込み中:', CSV_PATH);
const buf = readFileSync(CSV_PATH);
console.log(`ファイルサイズ: ${(buf.length / 1024).toFixed(1)} KB`);

// ---- A案 ----
const rowsA = parseShopifyCsvAOnly(buf, true);
const resultsA = rowsA.map((r) => calculatePrice(r, RULES));
const autoA = resultsA.filter((r) => r.newPrice !== null);
const manualA = resultsA.filter((r) => r.newPrice === null);

// ---- B案（現行 shopifyAdapter） ----
const rowsB = shopifyAdapter.parseCsv(buf, { activeOnly: true });
const resultsB = rowsB.map((r) => calculatePrice(r, RULES));
const autoB = resultsB.filter((r) => r.newPrice !== null);
const manualB = resultsB.filter((r) => r.newPrice === null);

console.log('\n========== 結果比較 ==========');
console.log(`読み込み件数:  A案=${rowsA.length}  B案=${rowsB.length}`);
console.log(`自動改定件数:  A案=${autoA.length}  B案=${autoB.length}   (差分 +${autoB.length - autoA.length})`);
console.log(`手動対応件数:  A案=${manualA.length}  B案=${manualB.length}  (差分 ${manualB.length - manualA.length})`);

// 手動理由の内訳（B案）
const reasonCount = new Map<string, number>();
for (const r of manualB) {
  const k = r.manualReason ?? '(理由不明)';
  reasonCount.set(k, (reasonCount.get(k) ?? 0) + 1);
}
console.log('\n----- B案の手動対応 理由内訳 -----');
for (const [k, v] of [...reasonCount.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k}: ${v} 件`);
}

// 「長さが商品名から読み取れない」が A案 vs B案 でどれだけ減ったか
const lengthFailA = manualA.filter((r) => r.manualReason === '長さが商品名から読み取れない').length;
const lengthFailB = manualB.filter((r) => r.manualReason === '長さが商品名から読み取れない').length;
console.log('\n----- 「長さが商品名から読み取れない」件数 -----');
console.log(`  A案: ${lengthFailA} 件 → B案: ${lengthFailB} 件 (改善 -${lengthFailA - lengthFailB})`);

// B案で自動改定に化けたサンプル（A案では手動だった行）
console.log('\n----- B案で自動改定に化けたサンプル（先頭8件） -----');
const skuMapA = new Map(resultsA.map((r) => [r.sku, r]));
let count = 0;
for (const rb of autoB) {
  const ra = skuMapA.get(rb.sku);
  if (ra && ra.newPrice === null) {
    console.log(
      `  [${rb.sku}] ${rb.productName.slice(0, 70)}\n    現${rb.currentPrice} → 新${rb.newPrice} (+${rb.diff}, ${rb.matchedRuleLabel}, ${rb.lengthM}m × ${rb.cablePieces}本)`
    );
    if (++count >= 8) break;
  }
}

// 「Default Title」が紛れて誤検出していないかチェック
console.log('\n----- "Default Title" 行が誤って Option Value から長さを拾っていないか -----');
let defaultTitleCount = 0;
let defaultTitleAutoCount = 0;
for (const r of rowsB) {
  const optV = (r.raw['Option1 Value'] ?? '').trim().toLowerCase();
  if (optV === 'default title') {
    defaultTitleCount++;
    // productName が Title から変わっていれば誤検出
    const original = (r.raw['Title'] ?? '').trim();
    if (r.productName !== original) {
      console.log(`  [WARN] 誤検出: [${r.sku}] Title="${original}" / productName="${r.productName}"`);
      defaultTitleAutoCount++;
    }
  }
}
console.log(`  Option1=Default Title の行数: ${defaultTitleCount}`);
console.log(`  そのうち productName が変わった件数: ${defaultTitleAutoCount}（0 が正常）`);
