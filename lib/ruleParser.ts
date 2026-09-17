import type { KeywordRule } from './parser';

// ─── 正規表現自動生成 ──────────────────────────────────────────────────────

const REGEX_META = /[\\[\]()|?+*{}^$]/;

// ハイフン類（全角含む）にマッチする文字クラス
const HYPHEN_CLASS = '[-‐−–—]';

/**
 * 型番文字列から正規表現パターンを自動生成する。
 *
 * - 型番にすでにメタ文字が含まれる場合はそのまま返す（ユーザーが手書きした正規表現と見なす）
 * - . → \.
 * - スペース連続（半角/全角混在可）→ \s*
 * - ハイフン類 → [-‐−–—]?
 * - 先頭/末尾が英数字なら単語境界の lookaround を付加
 *   （88760が188760に、NP3X-BがNP3X-BAGに誤マッチしない）
 */
export function buildRegexFromCode(code: string): string {
  if (REGEX_META.test(code)) return code;

  let pat = code
    .replace(/\./g, '\\.')                // . → \.
    .replace(/[  \t]+/g, '\u0000')        // スペース連続（半角・全角）を仮マーカーに
    .replace(/\u0000/g, '\\s*')           // → \s*
    .replace(/[-‐−–—]/g, `${HYPHEN_CLASS}?`); // ハイフン類 → [-‐−–—]?

  const startsAlnum = /^[A-Za-z0-9]/.test(code);
  const endsAlnum   = /[A-Za-z0-9]$/.test(code);

  if (startsAlnum) pat = `(?<![A-Za-z0-9])${pat}`;
  if (endsAlnum)   pat = `${pat}(?![A-Za-z0-9])`;

  return pat;
}

// ─── セクション見出し判定 ──────────────────────────────────────────────────

function isCableHeading(line: string): boolean {
  return /ケーブル/.test(line) && /1\s*m/.test(line);
}

function isPlugHeading(line: string): boolean {
  return /プラグ/.test(line) && /1\s*個/.test(line);
}

// ─── .txt / .csv パーサ ───────────────────────────────────────────────────

export type ParseRulesResult = {
  rules: KeywordRule[];
  warnings: string[];
};

/**
 * 値上げデータ.txt（または .csv）のテキストを KeywordRule[] に変換する。
 *
 * フォーマット（テキスト形式）:
 *   - UTF-8、半角スペース区切り
 *   - セクション見出し行でモードを切り替え（cable / plug）
 *   - 1フィールド: 型番のみ → 単価0で登録
 *   - 2フィールド: 型番 単価
 *   - 型番にスペースを含む行: 末尾フィールドが純数値なら単価、残りを型番とする
 *
 * フォーマット（CSV形式）:
 *   - カンマ区切り
 *   - 2列: 型番,単価（モードに応じてcable/plug）
 *   - 3列: 型番,1m単価,プラグ単価
 *   - 4列: 表示名,正規表現パターン,1m単価,プラグ単価
 */
export function parseRulesTxt(raw: string): ParseRulesResult {
  // BOM除去
  const text = raw.replace(/^\uFEFF/, '');

  const lines = text.split(/\r?\n/);
  const rules: KeywordRule[] = [];
  const warnings: string[] = [];

  type Mode = 'cable' | 'plug';
  let mode: Mode = 'cable';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // 空行・コメント行スキップ
    if (!line || line.startsWith('#')) continue;

    // セクション見出し
    if (isCableHeading(line)) { mode = 'cable'; continue; }
    if (isPlugHeading(line))  { mode = 'plug';  continue; }

    // CSV行（カンマが含まれる）
    if (line.includes(',')) {
      const cols = line.split(',').map((c) => c.trim());
      const rule = parseCsvColumns(cols, i + 1, warnings);
      if (rule) rules.push(rule);
      continue;
    }

    // スペース区切りテキスト行
    const rule = parseSpaceDelimitedLine(line, mode, i + 1, warnings);
    if (rule) rules.push(rule);
  }

  return { rules, warnings };
}

// ─── 内部ヘルパー ──────────────────────────────────────────────────────────

function parseCsvColumns(
  cols: string[],
  lineNum: number,
  warnings: string[]
): KeywordRule | null {
  if (cols.length === 2) {
    // 型番,単価 — cableモード相当（CSVではモード概念がないのでcableとして扱う）
    const [code, priceStr] = cols;
    const price = parseNum(priceStr);
    if (price === null) {
      warnings.push(`行${lineNum}: 単価 "${priceStr}" を数値に変換できません`);
      return null;
    }
    return makeRule(code, price, 0);
  }
  if (cols.length === 3) {
    // 型番,1m単価,プラグ単価
    const [code, cableStr, plugStr] = cols;
    const cable = parseNum(cableStr) ?? 0;
    const plug  = parseNum(plugStr)  ?? 0;
    return makeRule(code, cable, plug);
  }
  if (cols.length >= 4) {
    // 表示名,正規表現パターン,1m単価,プラグ単価
    const [label, pattern, cableStr, plugStr] = cols;
    const cable = parseNum(cableStr) ?? 0;
    const plug  = parseNum(plugStr)  ?? 0;
    return {
      id: String(Date.now()) + Math.random(),
      label,
      pattern,
      cablePerMeter: cable,
      plugPerPiece:  plug,
    };
  }
  warnings.push(`行${lineNum}: 列数が不足しています（${cols.length}列）`);
  return null;
}

function parseSpaceDelimitedLine(
  line: string,
  mode: 'cable' | 'plug',
  lineNum: number,
  warnings: string[]
): KeywordRule | null {
  const fields = line.split(/\s+/);

  if (fields.length === 1) {
    // 型番のみ → 単価0で登録
    return makeRule(fields[0], 0, 0);
  }

  // 末尾フィールドが純数値かチェック
  const lastField = fields[fields.length - 1];
  const price = parseNum(lastField);

  if (price !== null) {
    // 末尾が数値 → 残りを型番として連結
    const code = fields.slice(0, fields.length - 1).join(' ');
    if (mode === 'cable') return makeRule(code, price, 0);
    else                  return makeRule(code, 0, price);
  }

  // 末尾が非数値で2フィールド以上 → 先頭を型番として扱い、2番目以降はセクション見出しのなごりかもしれない
  warnings.push(`行${lineNum}: 単価を読み取れません ("${line}")`);
  return null;
}

function makeRule(code: string, cablePerMeter: number, plugPerPiece: number): KeywordRule {
  return {
    id: String(Date.now()) + Math.random(),
    label: code,
    pattern: buildRegexFromCode(code),
    cablePerMeter,
    plugPerPiece,
  };
}

function parseNum(s: string): number | null {
  const normalized = s
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[－−]/g, '-')
    .replace(/,/g, '');
  const n = parseFloat(normalized);
  return isNaN(n) ? null : n;
}
