/**
 * 商品名パース・価格計算ロジック
 *
 * 想定する商品名フォーマット例:
 *   "BELDEN 88760 XLR(メス)-TRS(ステレオフォン) 2本ペア 変換ケーブル (4m)"
 *   "ACOUSTIC REVIVE SPC-REFERENCE-tripleC ... バナナプラグ付 スピーカーケーブル 2本セット (1.5m)"
 *
 * 抽出するもの:
 *   - 長さ (m)        ... 括弧内 "(4m)" "(25cm)" 等
 *   - 本数             ... "2本ペア" "4本セット" "8ch" 等。デフォルト1
 *   - キーワード一致   ... ユーザが指定した正規表現にヒットしたか
 */

export type KeywordRule = {
  id: string;
  /** 表示名（メモ用） */
  label: string;
  /** 正規表現パターン（商品名にマッチさせる） */
  pattern: string;
  /** 1mあたりの加算額（円） */
  cablePerMeter: number;
  /** プラグ1個あたりの加算額（円） */
  plugPerPiece: number;
};

export type AmazonRow = {
  sku: string;
  asin: string;
  productName: string;
  currentPrice: number;
  status: string;
  raw: Record<string, string>;
};

export type CalcResult = {
  sku: string;
  asin: string;
  productName: string;
  currentPrice: number;
  newPrice: number | null;
  diff: number | null;
  matchedRuleLabel: string | null;
  lengthM: number | null;
  cablePieces: number | null;
  pieces: number | null;
  manualReason: string | null;
};

/** "(4m)" "(25cm)" "(1.5m)" 等から長さ(m)を抽出 */
export function extractLengthMeters(name: string): number | null {
  // メートル表記
  const mMatch = name.match(/[（(]\s*(\d+(?:\.\d+)?)\s*m\s*[）)]/i);
  if (mMatch) return parseFloat(mMatch[1]);
  // センチ表記
  const cmMatch = name.match(/[（(]\s*(\d+(?:\.\d+)?)\s*cm\s*[）)]/i);
  if (cmMatch) return parseFloat(cmMatch[1]) / 100;
  // 括弧外の "1.5m" 表記もフォールバック
  const mFallback = name.match(/(\d+(?:\.\d+)?)\s*m(?![a-zA-Z])/);
  if (mFallback) return parseFloat(mFallback[1]);
  return null;
}

/** "2本ペア" "4本セット" "8ch" 等から本数（プラグ個数の手がかり）を抽出 */
export function extractPieces(name: string): number {
  // "8ch" 等 マルチch
  const chMatch = name.match(/(\d+)\s*ch/i);
  if (chMatch) return parseInt(chMatch[1], 10);
  // "2本ペア" "4本セット"
  const honMatch = name.match(/(\d+)\s*本/);
  if (honMatch) return parseInt(honMatch[1], 10);
  // "ペア" 単体は2
  if (/ペア/.test(name)) return 2;
  // デフォルト1
  return 1;
}

/**
 * ケーブル本数を抽出（ケーブル単価×長さ×本数 の計算に使う）
 * "2本ペア" → 2, "4本セット" → 4, "ペア" → 2
 * "8ch" → 1（多芯ケーブル1本構造のため）
 * "バイワイヤリング" → 1（特殊計算は仕様確認後に対応・Notion#7）
 * その他 → 1
 */
export function extractCablePieces(name: string): number {
  // バイワイヤリングは特殊（Notion#7 仕様確認後に実装）→ 暫定で1本扱い
  if (/バイワイヤリング|bi[\s\-]?wir/i.test(name)) return 1;
  // 多芯ケーブル(8ch等) は1本のケーブルに芯が入っている構造なので1本
  if (/\d+\s*ch/i.test(name)) return 1;
  // "N本ペア" "N本セット"
  const honMatch = name.match(/(\d+)\s*本/);
  if (honMatch) return parseInt(honMatch[1], 10);
  // "ペア" 単体は2本
  if (/ペア/.test(name)) return 2;
  return 1;
}

/** 1商品名に対して最初にマッチしたルールを返す（先勝ち）— 後方互換のため残存 */
export function matchRule(name: string, rules: KeywordRule[]): KeywordRule | null {
  for (const rule of rules) {
    try {
      const re = new RegExp(rule.pattern, 'i');
      if (re.test(name)) return rule;
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * 1商品名に対して、「ケーブル系（1m単価>0）」と「プラグ系（プラグ単価>0）」を別々に探して両方返す。
 * これにより、商品名にケーブル型番とプラグ型番の両方が含まれる場合に両方加算できる。
 * 例: "MOGAMI 2534 NC3FXX-B (1m)" → cable: 2534ルール, plug: NC3FXX-Bルール
 */
export function matchCableAndPlug(name: string, rules: KeywordRule[]): {
  cable: KeywordRule | null;
  plug: KeywordRule | null;
} {
  let cable: KeywordRule | null = null;
  let plug: KeywordRule | null = null;
  for (const rule of rules) {
    if (cable && plug) break;
    let re: RegExp;
    try {
      re = new RegExp(rule.pattern, 'i');
    } catch {
      continue;
    }
    if (!re.test(name)) continue;
    if (rule.cablePerMeter > 0 && !cable) cable = rule;
    if (rule.plugPerPiece > 0 && !plug) plug = rule;
  }
  return { cable, plug };
}

/** 価格計算: 新価格 = 現在価格 + (長さ × ケーブル本数 × ケーブル単価) + (プラグ個数 × プラグ単価) */
export function calculatePrice(row: AmazonRow, rules: KeywordRule[]): CalcResult {
  const base: CalcResult = {
    sku: row.sku,
    asin: row.asin,
    productName: row.productName,
    currentPrice: row.currentPrice,
    newPrice: null,
    diff: null,
    matchedRuleLabel: null,
    lengthM: null,
    cablePieces: null,
    pieces: null,
    manualReason: null,
  };

  if (!row.currentPrice || row.currentPrice <= 0) {
    return { ...base, manualReason: '現在価格が不明・0円' };
  }

  // バイワイヤリング商品は特殊計算（2+4の×6、バナナはペアで×12、プラグ違いはa×2+b×4）が必要なため手動対応に回す
  if (/バイワイヤリング|バイワイ|bi[\s\-]?wir/i.test(row.productName)) {
    return { ...base, manualReason: 'バイワイヤリング（特殊計算のため手動対応）' };
  }

  // ケーブル系・プラグ系を別々にマッチ（両方含む商品で合算するため）
  const { cable: cableRule, plug: plugRule } = matchCableAndPlug(row.productName, rules);

  if (!cableRule && !plugRule) {
    return { ...base, manualReason: 'キーワードに一致しない' };
  }

  const lengthM = extractLengthMeters(row.productName);
  const cablePieces = extractCablePieces(row.productName);
  const pieces = extractPieces(row.productName);

  // ケーブル単価ありなのに長さが取れない場合は手動送り
  if (cableRule && lengthM === null) {
    const labels = [cableRule.label, plugRule?.label].filter(Boolean).join(' + ');
    return {
      ...base,
      matchedRuleLabel: labels,
      cablePieces,
      pieces,
      manualReason: '長さが商品名から読み取れない',
    };
  }

  const cableAdd = cableRule ? (lengthM ?? 0) * cablePieces * cableRule.cablePerMeter : 0;
  const plugAdd = plugRule ? pieces * plugRule.plugPerPiece : 0;
  const newPrice = Math.round(row.currentPrice + cableAdd + plugAdd);

  // マッチラベル：cable + plug の両方マッチを表示
  const matchedLabel = [cableRule?.label, plugRule?.label].filter(Boolean).join(' + ');

  return {
    ...base,
    newPrice,
    diff: newPrice - row.currentPrice,
    matchedRuleLabel: matchedLabel,
    lengthM,
    cablePieces,
    pieces,
  };
}
