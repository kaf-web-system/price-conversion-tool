/**
 * CSV共通ユーティリティ（プラットフォーム非依存）
 *
 * - parseCsvLine: 1行ぶんのCSV文字列を配列に分割（"..."クォート対応）
 * - escapeCsv: フィールド1個をCSV安全な文字列にエスケープ
 */

/** 簡易CSV1行パーサ（"..." のクォート対応） */
export function parseCsvLine(line: string): string[] {
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

/** CSVフィールド用エスケープ（カンマ・改行・ダブルクォートを含む場合のみクォート） */
export function escapeCsv(s: string | null | undefined): string {
  if (s == null) return '';
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
