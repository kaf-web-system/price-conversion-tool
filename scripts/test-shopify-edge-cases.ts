/**
 * Shopify B案実装のエッジケース単体テスト
 *   npx tsx scripts/test-shopify-edge-cases.ts
 *
 * Option Value からの長さ抽出が正しく動くか、特殊ケースをチェックする。
 */
import { shopifyAdapter } from '../lib/adapters/shopify';
import { calculatePrice, type KeywordRule } from '../lib/parser';

type Case = {
  name: string;
  csv: string;
  expected: {
    rowCount: number;
    productNames?: string[]; // 含まれていてほしい productName 断片
    notContains?: string[]; // 含まれていてほしくない断片
  };
};

const cases: Case[] = [
  {
    name: '1. Option1 Value="3m" → productName 末尾に (3m) が追加される',
    csv: `Handle,Title,Vendor,Option1 Name,Option1 Value,Variant SKU,Variant Price,Status
test-1,MOGAMI 2534 XLRケーブル,音光堂,長さ,3m,,8500,active`,
    expected: {
      rowCount: 1,
      productNames: ['MOGAMI 2534 XLRケーブル (3m)'],
    },
  },
  {
    name: '2. Option1 Value="Default Title" → productName は変化しない',
    csv: `Handle,Title,Vendor,Option1 Name,Option1 Value,Variant SKU,Variant Price,Status
test-2,バナナプラグ4本完成品,音光堂,Title,Default Title,,1200,active`,
    expected: {
      rowCount: 1,
      productNames: ['バナナプラグ4本完成品'],
      notContains: ['Default Title', '(default'],
    },
  },
  {
    name: '3. Option1 Value="" 空欄 → productName は変化しない',
    csv: `Handle,Title,Vendor,Option1 Name,Option1 Value,Variant SKU,Variant Price,Status
test-3,XLRケーブル,音光堂,,,,5000,active`,
    expected: {
      rowCount: 1,
      productNames: ['XLRケーブル'],
    },
  },
  {
    name: '4. Title に既に "(5m)" がある → Option Value の値は無視される（重複防止）',
    csv: `Handle,Title,Vendor,Option1 Name,Option1 Value,Variant SKU,Variant Price,Status
test-4,MOGAMI 2534 (5m),音光堂,長さ,10m,,8500,active`,
    expected: {
      rowCount: 1,
      productNames: ['MOGAMI 2534 (5m)'],
      notContains: ['MOGAMI 2534 (5m) (10m)'], // 二重に付かない
    },
  },
  {
    name: '5. Option1 Value="3M" 大文字 → 小文字正規化して 3m として取得',
    csv: `Handle,Title,Vendor,Option1 Name,Option1 Value,Variant SKU,Variant Price,Status
test-5,XLR,音光堂,length,3M,,8500,active`,
    expected: {
      rowCount: 1,
      productNames: ['(3m)'],
    },
  },
  {
    name: '6. Option1 Value="50mリール" → 50m を抽出',
    csv: `Handle,Title,Vendor,Option1 Name,Option1 Value,Variant SKU,Variant Price,Status
test-6,MOGAMI 2549 マイクケーブル,音光堂,長さ,50mリール,,4250,active`,
    expected: {
      rowCount: 1,
      productNames: ['(50m)'],
    },
  },
  {
    name: '7. Option1 Value="0.5m 2本セット" → 長さも本数も拾う',
    csv: `Handle,Title,Vendor,Option1 Name,Option1 Value,Variant SKU,Variant Price,Status
test-7,MOGAMI 2972 切り売り,音光堂,長さ,0.5m 2本セット,,3500,active`,
    expected: {
      rowCount: 1,
      productNames: ['(0.5m) 2本'],
    },
  },
  {
    name: '8. Option1 Value="0.5m（2本セット）" 全角括弧 → 長さも本数も拾う',
    csv: `Handle,Title,Vendor,Option1 Name,Option1 Value,Variant SKU,Variant Price,Status
test-8,Zonotone Granster,音光堂,長さ,0.5m（2本セット）,,3500,active`,
    expected: {
      rowCount: 1,
      productNames: ['(0.5m) 2本'],
    },
  },
  {
    name: '9. Option1 Value="30cm" → 30cm を抽出',
    csv: `Handle,Title,Vendor,Option1 Name,Option1 Value,Variant SKU,Variant Price,Status
test-9,ステレオミニ,音光堂,長さ,30cm,,1500,active`,
    expected: {
      rowCount: 1,
      productNames: ['(30cm)'],
    },
  },
  {
    name: '10. Option1 Value="mogami" (英字途中の m) → 拾わない',
    csv: `Handle,Title,Vendor,Option1 Name,Option1 Value,Variant SKU,Variant Price,Status
test-10,プラグ単体,音光堂,色,mogami赤,,500,active`,
    expected: {
      rowCount: 1,
      productNames: ['プラグ単体'],
      notContains: ['(mogami)'],
    },
  },
  {
    name: '11. Variant SKU 空欄でも取り込まれる（徳山様CSV対応）',
    csv: `Handle,Title,Vendor,Option1 Name,Option1 Value,Variant SKU,Variant Price,Status
test-11,XLR,音光堂,長さ,5m,,8500,active`,
    expected: {
      rowCount: 1,
      productNames: ['XLR (5m)'],
    },
  },
  {
    name: '12. Option1 空、Option2 Value="3m" → Option2 から拾う',
    csv: `Handle,Title,Vendor,Option1 Name,Option1 Value,Option2 Name,Option2 Value,Variant SKU,Variant Price,Status
test-12,XLR,音光堂,色,赤,長さ,3m,,8500,active`,
    expected: {
      rowCount: 1,
      productNames: ['XLR (3m)'],
    },
  },
  {
    name: '13. Status="draft" + activeOnly=true → 除外される',
    csv: `Handle,Title,Vendor,Option1 Name,Option1 Value,Variant SKU,Variant Price,Status
test-13,XLR,音光堂,長さ,3m,,8500,draft`,
    expected: {
      rowCount: 0,
    },
  },
  {
    name: '14. Status="Active" 大文字 → activeOnly=true で含める（toLowerCase 比較）',
    csv: `Handle,Title,Vendor,Option1 Name,Option1 Value,Variant SKU,Variant Price,Status
test-14,XLR,音光堂,長さ,3m,,8500,Active`,
    expected: {
      rowCount: 1,
      productNames: ['XLR (3m)'],
    },
  },
];

let pass = 0;
let fail = 0;

for (const c of cases) {
  const buf = Buffer.from(c.csv, 'utf-8');
  const rows = shopifyAdapter.parseCsv(buf, { activeOnly: true });

  const errors: string[] = [];
  if (rows.length !== c.expected.rowCount) {
    errors.push(`行数: expected=${c.expected.rowCount}, actual=${rows.length}`);
  }
  if (c.expected.productNames) {
    for (const need of c.expected.productNames) {
      if (!rows.some((r) => r.productName.includes(need))) {
        errors.push(`含まれてほしい productName 断片 "${need}" が見つからない（actual=${rows.map((r) => r.productName).join(' | ')}）`);
      }
    }
  }
  if (c.expected.notContains) {
    for (const ng of c.expected.notContains) {
      if (rows.some((r) => r.productName.includes(ng))) {
        errors.push(`含まれてはいけない断片 "${ng}" が見つかった`);
      }
    }
  }

  if (errors.length === 0) {
    console.log(`✅ ${c.name}`);
    pass++;
  } else {
    console.log(`❌ ${c.name}`);
    for (const e of errors) console.log(`     ${e}`);
    if (rows.length > 0) {
      console.log(`     実際の productName: "${rows[0].productName}"`);
    }
    fail++;
  }
}

// ============================================================
// buildAutoCsv の Title が「合成前の原本」になっているかを最終確認
// （Shopify書き戻し時の商品名破壊防止）
// ============================================================
console.log(`\n----- buildAutoCsv の Title 列が原本Titleか確認 -----`);
const verifyCsv = `Handle,Title,Vendor,Option1 Name,Option1 Value,Variant SKU,Variant Price,Status
verify-1,MOGAMI 2534 XLRケーブル,音光堂,長さ,3m,,8500,active`;
const verifyRows = shopifyAdapter.parseCsv(Buffer.from(verifyCsv, 'utf-8'), { activeOnly: true });
const verifyRules: KeywordRule[] = [
  { id: 'v', label: 'MOGAMI 2534', pattern: 'MOGAMI\\s*2534', cablePerMeter: 150, plugPerPiece: 0 },
];
const verifyResults = verifyRows.map((r) => calculatePrice(r, verifyRules));
const autoCsv = shopifyAdapter.buildAutoCsv(verifyResults);
console.log(autoCsv);
const titleLine = autoCsv.split('\n')[1] ?? '';
if (titleLine.includes('(3m)')) {
  console.log('❌ buildAutoCsv の Title 列に "(3m)" が混入している（productName 合成後が漏れた）');
  fail++;
} else if (titleLine.includes('MOGAMI 2534 XLRケーブル')) {
  console.log('✅ buildAutoCsv の Title は原本通り（合成後の "(3m)" は含まれない）');
  pass++;
} else {
  console.log('❌ Title 出力が想定外:', titleLine);
  fail++;
}

console.log(`\n============================`);
console.log(`Pass: ${pass} / Fail: ${fail} / Total: ${cases.length + 1}`);
process.exit(fail === 0 ? 0 : 1);
