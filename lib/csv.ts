import Papa from 'papaparse';
import type { AmazonRow, KeywordRule } from './parser';

/**
 * Amazon出品レポートCSV(CP932/UTF-8)をブラウザ内でパースして AmazonRow[] に変換
 * Active のみ対象とするオプションあり
 *
 * ブラウザ動作のため iconv-lite/Buffer は使わず TextDecoder('shift-jis') を利用。
 * shift-jis でデコード失敗(化け検知)の場合は UTF-8 で再試行する。
 */
export function parseAmazonCsv(
  buffer: ArrayBuffer | Uint8Array,
  opts: { activeOnly?: boolean } = {}
): AmazonRow[] {
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

// ─────────────────────────────────────────────
//  ルール定義CSV 一括インポート（こうちゃんレビュー#1）
// ─────────────────────────────────────────────

/**
 * ルール定義テキスト/CSVのパース結果
 */
export type RuleImportResult = {
  rules: KeywordRule[];
  warnings: string[];
};

/**
 * 値上げデータ.txt / CSV からルールを一括インポートする。
 *
 * サポートする入力形式（行ごと）:
 *   1) スペース区切り（値上げデータ.txt形式）  : `88760 200`
 *      → 型番=88760 / 1m単価=200 / プラグ単価=0
 *   2) カンマ区切り（CSV形式）                  : `88760,200,300`
 *      → 型番=88760 / 1m単価=200 / プラグ単価=300
 *   3) カンマ4列                                : `BELDEN 88760,BELDEN\s*88760,200,300`
 *      → 表示名 / 正規表現 / 1m単価 / プラグ単価
 *   4) 単価なし行                                : `3208`（型番のみ）
 *      → 単価0で登録（読み込み対象だが計算対象外）
 *
 * 「ケーブル 1m当たりの価格」「プラグ 1個当たりの価格」等のセクション見出し行・
 * 空行・コメント行（#始まり）はスキップ。
 *
 * 「プラグ」セクション内では、単価をプラグ単価として登録する（1m単価は0）。
 */
export function parseRulesCsv(text: string): RuleImportResult {
  // 先頭BOM除去
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const warnings: string[] = [];
  const rules: KeywordRule[] = [];
  let mode: 'cable' | 'plug' = 'cable'; // 初期はケーブル単価扱い
  let seq = 0;

  const lines = text.split(/\r?\n/);
  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const raw = lines[lineNo];
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) continue;

    // セクション見出しの判定
    if (/ケーブル.*1\s*m.*価格|ケーブル単価|1m\s*当たり|1m単価/i.test(line)) {
      mode = 'cable';
      continue;
    }
    if (/プラグ.*価格|プラグ単価|1個\s*当たり|プラグ1個/i.test(line)) {
      mode = 'plug';
      continue;
    }

    // CSV形式（カンマ区切り）優先で解析、なければスペース区切り
    let fields: string[];
    if (line.includes(',')) {
      // 簡易CSVパース（クォート対応）
      fields = parseCsvLine(line);
    } else {
      fields = line.split(/\s+/);
      // スペース区切りで型番にスペースが入る場合（例：「PROFI NF2C-B/2 800」）に対応：
      // 最後のフィールドが純粋な数値なら、それを単価、それ以外を型番として連結する
      if (fields.length >= 3 && /^\d+(?:\.\d+)?$/.test(fields[fields.length - 1])) {
        const price = fields[fields.length - 1];
        const code = fields.slice(0, -1).join(' ');
        fields = [code, price];
      }
    }

    if (fields.length === 0) continue;

    // フィールド数による分岐
    let label = '';
    let pattern = '';
    let cablePerMeter = 0;
    let plugPerPiece = 0;

    if (fields.length === 1) {
      // 型番のみ（単価なし）
      const code = fields[0];
      label = code;
      pattern = buildRegexFromCode(code);
      // cable/plug ともに 0 のまま
    } else if (fields.length === 2) {
      // 型番 単価
      const code = fields[0];
      const priceStr = fields[1];
      const price = parseInt(priceStr.replace(/[^\d.-]/g, ''), 10);
      if (isNaN(price)) {
        warnings.push(`L${lineNo + 1}: 単価が数値として読み取れません → "${raw}"`);
        continue;
      }
      label = code;
      pattern = buildRegexFromCode(code);
      if (mode === 'cable') cablePerMeter = price;
      else plugPerPiece = price;
    } else if (fields.length === 3) {
      // 型番,1m単価,プラグ単価
      const code = fields[0];
      const cable = parseInt(fields[1].replace(/[^\d.-]/g, ''), 10);
      const plug = parseInt(fields[2].replace(/[^\d.-]/g, ''), 10);
      label = code;
      pattern = buildRegexFromCode(code);
      cablePerMeter = isNaN(cable) ? 0 : cable;
      plugPerPiece = isNaN(plug) ? 0 : plug;
    } else if (fields.length >= 4) {
      // 表示名,正規表現,1m単価,プラグ単価
      label = fields[0];
      pattern = fields[1];
      const cable = parseInt(fields[2].replace(/[^\d.-]/g, ''), 10);
      const plug = parseInt(fields[3].replace(/[^\d.-]/g, ''), 10);
      cablePerMeter = isNaN(cable) ? 0 : cable;
      plugPerPiece = isNaN(plug) ? 0 : plug;
    }

    if (!label || !pattern) {
      warnings.push(`L${lineNo + 1}: 解析できない行 → "${raw}"`);
      continue;
    }

    seq += 1;
    rules.push({
      id: `imp-${Date.now()}-${seq}`,
      label,
      pattern,
      cablePerMeter,
      plugPerPiece,
    });
  }

  return { rules, warnings };
}

/** 簡易CSV1行パーサ（"..." のクォート対応） */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuote = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === ',') {
        result.push(cur.trim());
        cur = '';
      } else if (ch === '"') {
        inQuote = true;
      } else {
        cur += ch;
      }
    }
  }
  result.push(cur.trim());
  return result;
}

// ─────────────────────────────────────────────
//  正規表現自動生成（こうちゃんレビュー#2）
// ─────────────────────────────────────────────

/**
 * 型番文字列から正規表現パターンを自動生成する。
 *
 * 揺れ吸収:
 *   - 半角/全角スペースの差 → `\s*`
 *   - ハイフン（-, −, ‐）   → `[-‐−–—]?`
 *   - 連続スペース           → `\s*`
 *
 * 例:
 *   "BELDEN 88760"      → "BELDEN\\s*88760"
 *   "CANARE L-4E6S"     → "CANARE\\s*L[-‐−–—]?4E6S"
 *   "NP2X-BAG"          → "NP2X[-‐−–—]?BAG"
 *   "ACPL-CRD"          → "ACPL[-‐−–—]?CRD"
 *
 * 既に正規表現の特殊文字（\, [, (, ., * 等）が含まれている場合は
 * 「ユーザが直接書いた」と判断してエスケープ加工はしない。
 */
export function buildRegexFromCode(code: string): string {
  if (!code) return '';

  // 「ユーザが正規表現を直接書いた」検出: \, [, ], (, ), |, ?, +, *, {, } などが含まれる
  if (/[\\[\]()|?+*{}^$]/.test(code)) {
    return code;
  }

  // 正規表現メタ文字をエスケープ（. のみ）
  const escaped = code.replace(/\./g, '\\.');

  // 半角/全角スペースを \s* へ
  let pattern = escaped.replace(/[\s　]+/g, '\\s*');

  // ハイフン類を [-‐−–—]? へ（揺れ吸収）
  pattern = pattern.replace(/[-‐−–—]/g, '[-‐−–—]?');

  return pattern;
}
