/**
 * 本物のCSVで動作確認するスクリプト
 *   npx tsx scripts/test-real-csv.ts
 */
import { readFileSync } from 'fs';
import { amazonAdapter } from '../lib/adapters/amazon';
import { calculatePrice, type KeywordRule } from '../lib/parser';

const CSV_PATH =
  '/Users/chanchan/Downloads/こうちゃん依頼内容/すべての出品商品のレポート_05-01-2026_-_コピー.csv';

// テスト用ルール（CSV分析結果から主要ブランドをカバー）
const RULES: KeywordRule[] = [
  { id: '1', label: 'BELDEN 88760', pattern: 'BELDEN\\s*88760', cablePerMeter: 200, plugPerPiece: 300 },
  { id: '2', label: 'BELDEN 8412', pattern: 'BELDEN\\s*8412', cablePerMeter: 180, plugPerPiece: 300 },
  { id: '3', label: 'MOGAMI 2534', pattern: 'MOGAMI\\s*2534', cablePerMeter: 150, plugPerPiece: 300 },
  { id: '4', label: 'MOGAMI 2549', pattern: 'MOGAMI\\s*2549', cablePerMeter: 150, plugPerPiece: 300 },
  { id: '5', label: 'CANARE L-4E6S', pattern: 'CANARE\\s*L-?4E6S', cablePerMeter: 100, plugPerPiece: 250 },
  { id: '6', label: 'CANARE L-2T2S', pattern: 'CANARE\\s*L-?2T2S', cablePerMeter: 100, plugPerPiece: 250 },
  { id: '7', label: 'CANARE 4S6/4S8/4S11', pattern: 'CANARE\\s*4S(6|8|11)', cablePerMeter: 120, plugPerPiece: 250 },
  { id: '8', label: 'GOTHAM GAC-2', pattern: 'GOTHAM\\s*GAC-?2', cablePerMeter: 220, plugPerPiece: 350 },
];

console.log('CSV読み込み中...');
const buf = readFileSync(CSV_PATH);
const rows = amazonAdapter.parseCsv(buf, { activeOnly: true });
console.log(`Active商品: ${rows.length} 件`);

console.log('\n価格計算中...');
const t0 = Date.now();
const results = rows.map((r) => calculatePrice(r, RULES));
const t1 = Date.now();
console.log(`計算時間: ${t1 - t0} ms`);

const auto = results.filter((r) => r.newPrice !== null);
const manual = results.filter((r) => r.newPrice === null);
console.log(`\n自動改定: ${auto.length} 件 (${((auto.length / rows.length) * 100).toFixed(1)}%)`);
console.log(`手動対応: ${manual.length} 件 (${((manual.length / rows.length) * 100).toFixed(1)}%)`);

// 手動対応理由の内訳
const reasonCount = new Map<string, number>();
for (const r of manual) {
  const k = r.manualReason ?? '(理由不明)';
  reasonCount.set(k, (reasonCount.get(k) ?? 0) + 1);
}
console.log('\n手動対応の理由内訳:');
for (const [k, v] of [...reasonCount.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k}: ${v} 件`);
}

// マッチしたルール内訳
const ruleCount = new Map<string, number>();
for (const r of auto) {
  const k = r.matchedRuleLabel ?? '(なし)';
  ruleCount.set(k, (ruleCount.get(k) ?? 0) + 1);
}
console.log('\n自動改定のルール内訳:');
for (const [k, v] of [...ruleCount.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k}: ${v} 件`);
}

console.log('\n自動改定サンプル（先頭5件）:');
for (const r of auto.slice(0, 5)) {
  console.log(
    `  [${r.sku}] ${r.productName.slice(0, 50)}\n    現価格 ${r.currentPrice} → 新価格 ${r.newPrice} (差 +${r.diff}, ${r.matchedRuleLabel}, ${r.lengthM}m × ${r.pieces}個)`
  );
}

console.log('\n手動送りサンプル（先頭5件）:');
for (const r of manual.slice(0, 5)) {
  console.log(`  [${r.sku}] ${r.productName.slice(0, 50)} … 理由: ${r.manualReason}`);
}
