/**
 * プラグ正規表現改善の検証スクリプト
 *
 * 検証内容（徳山様 2026-05-20 仕様確認）:
 *   A) ハイフン繋ぎ表記の複数プラグ合算
 *      例: "ベルデン 19364 ME2591-NAC3FCA (4m)"
 *          → ME2591 と NAC3FCA の両方を別プラグとして認識して合算する
 *   B) 単語境界（最長マッチ）
 *      例: "NEUTRIK NP3X-BAG" は NP3X-B ルールにヒットしてはいけない
 *          NP3X-BAG ルールには正しくヒットする
 *
 * 実行: npx tsx scripts/test-plug-regex.ts
 */

import { buildRegexFromCode } from '../lib/csv';
import {
  calculatePrice,
  matchCableAndPlugs,
  type AmazonRow,
  type KeywordRule,
} from '../lib/parser';

let passed = 0;
let failed = 0;

function assertEq<T>(label: string, actual: T, expected: T): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failed++;
    console.log(`  FAIL  ${label}`);
    console.log(`        expected: ${JSON.stringify(expected)}`);
    console.log(`        actual:   ${JSON.stringify(actual)}`);
  }
}

// ─────────────────────────────────────────
//  1. buildRegexFromCode の単語境界テスト
// ─────────────────────────────────────────
console.log('\n[1] buildRegexFromCode の単語境界アサーション');
{
  const np3xb = buildRegexFromCode('NP3X-B');
  const np3xbag = buildRegexFromCode('NP3X-BAG');
  console.log(`  NP3X-B   → ${np3xb}`);
  console.log(`  NP3X-BAG → ${np3xbag}`);

  // NP3X-B は NP3X-BAG にマッチしてはいけない
  const reB = new RegExp(np3xb, 'i');
  const reBAG = new RegExp(np3xbag, 'i');

  assertEq('NP3X-B ルールが "NEUTRIK NP3X-B" にマッチ', reB.test('NEUTRIK NP3X-B プラグ'), true);
  assertEq('NP3X-B ルールが "NEUTRIK NP3X-BAG" には**マッチしない**', reB.test('NEUTRIK NP3X-BAG プラグ'), false);
  assertEq('NP3X-BAG ルールが "NEUTRIK NP3X-BAG" にマッチ', reBAG.test('NEUTRIK NP3X-BAG プラグ'), true);
  assertEq('NP3X-BAG ルールが "NEUTRIK NP3X-B" には**マッチしない**', reBAG.test('NEUTRIK NP3X-B プラグ'), false);
}

// ─────────────────────────────────────────
//  2. 数字型番の単語境界（88760 vs 188760）
// ─────────────────────────────────────────
console.log('\n[2] 数字型番の単語境界（88760 vs 188760）');
{
  const p = buildRegexFromCode('88760');
  const re = new RegExp(p, 'i');
  assertEq('88760 が "BELDEN 88760" にマッチ', re.test('BELDEN 88760 ケーブル'), true);
  assertEq('88760 が "BELDEN 188760" にはマッチしない', re.test('BELDEN 188760 ケーブル'), false);
  assertEq('88760 が "BELDEN 887600" にはマッチしない', re.test('BELDEN 887600 ケーブル'), false);
}

// ─────────────────────────────────────────
//  3. ハイフン区切りで複数プラグ合算（要件A）
// ─────────────────────────────────────────
console.log('\n[3] ハイフン区切り複数プラグ合算');
{
  const rules: KeywordRule[] = [
    { id: 'c1', label: 'BELDEN 19364', pattern: buildRegexFromCode('BELDEN 19364'), cablePerMeter: 200, plugPerPiece: 0 },
    { id: 'p1', label: 'ME2591', pattern: buildRegexFromCode('ME2591'), cablePerMeter: 0, plugPerPiece: 400 },
    { id: 'p2', label: 'NAC3FCA', pattern: buildRegexFromCode('NAC3FCA'), cablePerMeter: 0, plugPerPiece: 350 },
  ];

  // 「ベルデン 19364 ME2591-NAC3FCA (4m)」 → ケーブル4m×200 + プラグME2591×1×400 + プラグNAC3FCA×1×350 = 800+400+350 = +1,550
  // 検証データ「+1,000」になるよう、ME2591=300円、NAC3FCA=200円、ケーブル無しで計算してみる
  // 実際の徳山様データに合わせるため、ここはロジック検証として複数プラグが両方ヒットすることだけ確認
  const name = 'BELDEN 19364 ME2591-NAC3FCA 変換ケーブル (4m)';
  const { cable, plugs } = matchCableAndPlugs(name, rules);
  assertEq('cableルール = BELDEN 19364', cable?.label ?? null, 'BELDEN 19364');
  assertEq('plugsが2件ヒット', plugs.length, 2);
  assertEq('plugs[0] = ME2591', plugs[0]?.label ?? null, 'ME2591');
  assertEq('plugs[1] = NAC3FCA', plugs[1]?.label ?? null, 'NAC3FCA');

  // 価格計算: 現在9,100、ケーブル4m×200=800 + ME2591×1×400=400 + NAC3FCA×1×350=350 = +1,550
  const row: AmazonRow = {
    sku: 'TEST-1',
    asin: 'B00TEST',
    productName: name,
    currentPrice: 9100,
    status: 'Active',
    raw: {},
  };
  const result = calculatePrice(row, rules);
  assertEq('新価格 = 9,100 + 800 + 400 + 350 = 10,650', result.newPrice, 10650);
  assertEq('差分 = +1,550', result.diff, 1550);
  assertEq('matchedLabel = BELDEN 19364 + ME2591 + NAC3FCA', result.matchedRuleLabel, 'BELDEN 19364 + ME2591 + NAC3FCA');
}

// ─────────────────────────────────────────
//  4. 徳山様提示シナリオ：ME2591-NAC3FCA で +1,000
// ─────────────────────────────────────────
// 推測：徳山様の単価設定が「19364=ケーブル無し（合算対象外） / ME2591=600 / NAC3FCA=400」等の場合
// ここでは「複数プラグが両方ヒットして合算される」というロジックを再現する。
// 実単価は徳山様の値上げデータ.txtに依存するので、ロジックが期待通り動くことのみ確認。
console.log('\n[4] ハイフン繋ぎプラグの2個合算（単価合計+1,000ケース想定）');
{
  const rules: KeywordRule[] = [
    { id: 'p1', label: 'ME2591', pattern: buildRegexFromCode('ME2591'), cablePerMeter: 0, plugPerPiece: 600 },
    { id: 'p2', label: 'NAC3FCA', pattern: buildRegexFromCode('NAC3FCA'), cablePerMeter: 0, plugPerPiece: 400 },
  ];
  const row: AmazonRow = {
    sku: 'TEST-2',
    asin: 'B00TEST',
    productName: 'ベルデン 19364 ME2591-NAC3FCA 変換ケーブル (4m)',
    currentPrice: 9100,
    status: 'Active',
    raw: {},
  };
  const result = calculatePrice(row, rules);
  assertEq('現在価格 9,100 → 新価格 10,100（+1,000）', result.newPrice, 10100);
  assertEq('差分 +1,000', result.diff, 1000);
}

// ─────────────────────────────────────────
//  5. NEUTRIK NP3X-BAG の単価検証（要件B）
// ─────────────────────────────────────────
console.log('\n[5] NP3X-B と NP3X-BAG が別物として認識される');
{
  const rules: KeywordRule[] = [
    { id: 'p1', label: 'NP3X-B', pattern: buildRegexFromCode('NP3X-B'), cablePerMeter: 0, plugPerPiece: 200 },
    { id: 'p2', label: 'NP3X-BAG', pattern: buildRegexFromCode('NP3X-BAG'), cablePerMeter: 0, plugPerPiece: 200 },
  ];

  // NP3X-BAG の商品は NP3X-BAG ルールのみがヒットすべき（NP3X-B はヒットしない）
  const r1 = calculatePrice(
    {
      sku: 'TEST-3',
      asin: 'B00TEST',
      productName: 'NEUTRIK NP3X-BAG TRSフォンプラグ',
      currentPrice: 1100,
      status: 'Active',
      raw: {},
    },
    rules
  );
  assertEq('NP3X-BAG商品 → 200円のみ加算（重複加算しない）', r1.newPrice, 1300);
  assertEq('NP3X-BAG商品 → matchedLabel = NP3X-BAG のみ', r1.matchedRuleLabel, 'NP3X-BAG');

  // NP3X-B の商品は NP3X-B ルールのみがヒットすべき
  const r2 = calculatePrice(
    {
      sku: 'TEST-4',
      asin: 'B00TEST',
      productName: 'NEUTRIK NP3X-B TRSフォンプラグ',
      currentPrice: 1100,
      status: 'Active',
      raw: {},
    },
    rules
  );
  assertEq('NP3X-B商品 → matchedLabel = NP3X-B のみ', r2.matchedRuleLabel, 'NP3X-B');
}

// ─────────────────────────────────────────
//  6. 後方互換: 既存の matchCableAndPlug がそのまま動くか
// ─────────────────────────────────────────
console.log('\n[6] 後方互換性（既存 matchCableAndPlug）');
{
  const rules: KeywordRule[] = [
    { id: 'c1', label: 'MOGAMI 2534', pattern: buildRegexFromCode('MOGAMI 2534'), cablePerMeter: 150, plugPerPiece: 0 },
    { id: 'p1', label: 'NC3FXX-B', pattern: buildRegexFromCode('NC3FXX-B'), cablePerMeter: 0, plugPerPiece: 300 },
  ];
  const row: AmazonRow = {
    sku: 'TEST-5',
    asin: 'B00TEST',
    productName: 'MOGAMI 2534 NC3FXX-B XLRケーブル (1m)',
    currentPrice: 2000,
    status: 'Active',
    raw: {},
  };
  const result = calculatePrice(row, rules);
  // 1m × 1本 × 150 + 1個 × 300 = 450
  assertEq('既存ケース：MOGAMI 2534 NC3FXX-B (1m) → +450', result.diff, 450);
}

// ─────────────────────────────────────────
//  7. 両端同プラグの出現回数カウント（章尋さん指示 2026-05-21）
// ─────────────────────────────────────────
console.log('\n[7] 両端同プラグの出現回数カウント');
{
  const rules: KeywordRule[] = [
    { id: 'c1', label: 'BELDEN 19364', pattern: buildRegexFromCode('BELDEN 19364'), cablePerMeter: 200, plugPerPiece: 0 },
    { id: 'p1', label: 'ME2591', pattern: buildRegexFromCode('ME2591'), cablePerMeter: 0, plugPerPiece: 400 },
    { id: 'p2', label: 'NL4', pattern: buildRegexFromCode('NL4'), cablePerMeter: 0, plugPerPiece: 500 },
  ];

  // 「ベルデン 19364 ME2591-NL4-ME2591 (4m)」
  // チェーン "ME2591-NL4-ME2591" 内で ME2591 が2回・NL4 が1回出現
  // → ケーブル 4m × 200 = 800
  // → プラグ ME2591 × 2 × 400 = 800
  // → プラグ NL4 × 1 × 500 = 500
  // → 合計加算 +2,100
  const name = 'BELDEN 19364 ME2591-NL4-ME2591 変換ケーブル (4m)';
  const { cable, plugs } = matchCableAndPlugs(name, rules);
  assertEq('cableルール = BELDEN 19364', cable?.label ?? null, 'BELDEN 19364');
  assertEq('plugsが合計3件（ME2591×2 + NL4×1）', plugs.length, 3);
  const me2591Count = plugs.filter((p) => p.label === 'ME2591').length;
  const nl4Count = plugs.filter((p) => p.label === 'NL4').length;
  assertEq('ME2591 が2個カウント', me2591Count, 2);
  assertEq('NL4 が1個カウント', nl4Count, 1);

  const row: AmazonRow = {
    sku: 'TEST-7',
    asin: 'B00TEST',
    productName: name,
    currentPrice: 10000,
    status: 'Active',
    raw: {},
  };
  const result = calculatePrice(row, rules);
  // 10,000 + 800 + 800 + 500 = 12,100
  assertEq('新価格 = 12,100', result.newPrice, 12100);
  assertEq('差分 = +2,100', result.diff, 2100);
  // matchedRuleLabel は重複なし表示
  assertEq('matchedLabel は重複なし表示', result.matchedRuleLabel, 'BELDEN 19364 + ME2591 + NL4');
}

// ─────────────────────────────────────────
//  8. ハイフン繋ぎ外（フリーテキスト）の重複は1個カウント
// ─────────────────────────────────────────
console.log('\n[8] フリーテキスト内の重複出現は1個カウント（誤検出抑止）');
{
  const rules: KeywordRule[] = [
    { id: 'p1', label: 'ME2591', pattern: buildRegexFromCode('ME2591'), cablePerMeter: 0, plugPerPiece: 400 },
  ];
  // ハイフン繋ぎでない、自由記述で2回出現するケース
  const name = 'ME2591 高品質 ME2591 ペアセット (1m)';
  const { plugs } = matchCableAndPlugs(name, rules);
  // チェーンには含まれないので1個のみ
  assertEq('フリーテキスト内2回出現 → 1個カウントのみ', plugs.length, 1);
}

// ─────────────────────────────────────────
//  9. DEFAULT_RULES 相当の単語境界（CANARE L-4E6S vs L-4E6SAT）
// ─────────────────────────────────────────
console.log('\n[9] DEFAULT_RULES の単語境界（CANARE L-4E6S vs L-4E6SAT）');
{
  // App.tsx の DEFAULT_RULES と同じ生成方法
  const rules: KeywordRule[] = [
    { id: 'd1', label: 'CANARE L-4E6S', pattern: buildRegexFromCode('CANARE L-4E6S'), cablePerMeter: 100, plugPerPiece: 250 },
  ];

  // L-4E6SAT 商品（CANAREの別型番）には CANARE L-4E6S ルールがマッチしてはいけない
  // 「L-4E6SAT」は「L-4E6S」の末尾に英字 A が続いており、単語境界（末尾の負後読み）で除外されるはず
  const re = new RegExp(rules[0].pattern, 'i');
  assertEq('CANARE L-4E6S が "CANARE L-4E6SAT" にマッチしない', re.test('CANARE L-4E6SAT 高品質ケーブル (2m)'), false);
  assertEq('CANARE L-4E6S が "CANARE L-4E6S" にマッチする', re.test('CANARE L-4E6S 高品質ケーブル (2m)'), true);
  // ハイフン無し表記（CANARE L4E6S）にもマッチする（揺れ吸収）
  assertEq('CANARE L-4E6S が "CANARE L4E6S" にマッチする（ハイフン揺れ吸収）', re.test('CANARE L4E6S 高品質ケーブル (2m)'), true);
}

// ─────────────────────────────────────────
//  結果
// ─────────────────────────────────────────
console.log(`\n=== 結果: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
