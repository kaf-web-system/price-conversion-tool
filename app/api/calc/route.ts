import { NextRequest, NextResponse } from 'next/server';
import { parseAmazonCsv } from '@/lib/csv';
import { calculatePrice, type KeywordRule } from '@/lib/parser';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get('file') as File | null;
    const rulesJson = form.get('rules') as string | null;
    const activeOnly = form.get('activeOnly') === 'true';

    if (!file) {
      return NextResponse.json({ error: 'CSVファイルが選ばれていません' }, { status: 400 });
    }
    if (!rulesJson) {
      return NextResponse.json({ error: 'キーワードルールが空です' }, { status: 400 });
    }

    let rules: KeywordRule[] = [];
    try {
      rules = JSON.parse(rulesJson);
    } catch {
      return NextResponse.json({ error: 'ルールのJSONが壊れています' }, { status: 400 });
    }

    if (!Array.isArray(rules) || rules.length === 0) {
      return NextResponse.json({ error: 'ルールを1件以上設定してください' }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const rows = parseAmazonCsv(buf, { activeOnly });

    const results = rows.map((r) => calculatePrice(r, rules));
    const auto = results.filter((r) => r.newPrice !== null);
    const manual = results.filter((r) => r.newPrice === null);

    return NextResponse.json({
      total: rows.length,
      autoCount: auto.length,
      manualCount: manual.length,
      preview: results.slice(0, 50),
      results,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '不明なエラー';
    return NextResponse.json({ error: `処理中にエラー: ${msg}` }, { status: 500 });
  }
}
