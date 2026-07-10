/**
 * 商品名パース・価格計算ロジック
 *
 * マッチ対象テキスト: 商品名 + 商品説明 + 商品の仕様(bullet_point) を連結
 * 長さ抽出優先順位: 商品名 → 商品説明 → 商品の仕様
 */

export type KeywordRule = {
  id: string;
  /** 表示名（メモ用） */
  label: string;
  /** 正規表現パターン（マッチテキストに適用） */
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
  description: string;
  bulletPoints: string;
  currentPrice: number;
  status: string;
  raw: Record<string, string>;
};

export type CalcResult = {
  sku: string;
  asin: string;
  productName: string;
  description: string;
  bulletPoints: string;
  currentPrice: number;
  newPrice: number | null;
  diff: number | null;
  matchedRuleLabel: string | null;
  lengthM: number | null;
  pieces: number | null;
  manualReason: string | null;
  /** プラグ型番だけマッチ、ケーブル単価が0のルールで計算した場合に true */
  cableRateUnregistered: boolean;
  /** ケーブル加算額 = lengthM × cablePerMeter × pieces（ケーブルなし・長さなしは0） */
  cableAdd: number;
  /** プラグ加算額 = pieces × Σ(マッチした各プラグのplugPerPiece)（プラグなしは0） */
  plugAdd: number;
  /** マッチした全プラグルールのlabelを"+"で連結した文字列（なしは空文字） */
  plugLabels: string;
  /** ケーブル・プラグ問わず加算対象にマッチした全ルールのlabelを"+"で連結（なしは空文字） */
  allMatchedLabels: string;
};

/** "(4m)" "(25cm)" "(1.5m)" 等から長さ(m)を抽出 */
export function extractLengthMeters(text: string): number | null {
  // 括弧内メートル表記
  const mMatch = text.match(/[（(]\s*(\d+(?:\.\d+)?)\s*m\s*[）)]/i);
  if (mMatch) return parseFloat(mMatch[1]);
  // 括弧内センチ表記
  const cmMatch = text.match(/[（(]\s*(\d+(?:\.\d+)?)\s*cm\s*[）)]/i);
  if (cmMatch) return parseFloat(cmMatch[1]) / 100;
  // 括弧外 "1.5m" フォールバック
  const mFallback = text.match(/(\d+(?:\.\d+)?)\s*m(?![a-zA-Z])/);
  if (mFallback) return parseFloat(mFallback[1]);
  return null;
}

/**
 * 長さ抽出: 商品名 → 商品説明 → 商品の仕様 の順で最初に取れた値を返す
 * 別商品の長さの誤検出を防ぐため商品名を最優先にする
 */
export function extractLengthFromRow(row: Pick<AmazonRow, 'productName' | 'description' | 'bulletPoints'>): number | null {
  return (
    extractLengthMeters(row.productName) ??
    (row.description ? extractLengthMeters(row.description) : null) ??
    (row.bulletPoints ? extractLengthMeters(row.bulletPoints) : null)
  );
}

/** "2本ペア" "4本セット" "8ch" 等から本数（プラグ個数の手がかり）を抽出 */
export function extractPieces(name: string): number {
  const chMatch = name.match(/(\d+)\s*ch/i);
  if (chMatch) return parseInt(chMatch[1], 10);
  const honMatch = name.match(/(\d+)\s*本/);
  if (honMatch) return parseInt(honMatch[1], 10);
  if (/ペア/.test(name)) return 2;
  return 1;
}

/** 1商品名に対して最初にマッチしたルールを返す（先勝ち） */
export function matchRule(text: string, rules: KeywordRule[]): KeywordRule | null {
  for (const rule of rules) {
    try {
      const re = new RegExp(rule.pattern, 'i');
      if (re.test(text)) return rule;
    } catch {
      continue;
    }
  }
  return null;
}

// ─── 照合・採用ロジック（内部用） ─────────────────────────────────────────

/** text にマッチするルールをすべて返す */
function matchAllRules(text: string, rules: KeywordRule[]): KeywordRule[] {
  return rules.filter((rule) => {
    try { return new RegExp(rule.pattern, 'i').test(text); }
    catch { return false; }
  });
}

/** label が最長のルールを返す（同長なら先頭優先） */
function longestLabelRule(rules: KeywordRule[]): KeywordRule {
  return rules.reduce((a, b) => b.label.length > a.label.length ? b : a);
}

/**
 * あるルールの label が他のマッチ済みルールの label に完全に含まれる場合は除去する。
 * 例: NC3MXX と NC3MXX-B が両方マッチした場合、NC3MXX を除去して NC3MXX-B だけ残す。
 */
function deduplicateLongestMatch(rules: KeywordRule[]): KeywordRule[] {
  return rules.filter(
    (r) => !rules.some((other) => other !== r && other.label.includes(r.label))
  );
}

/**
 * ケーブルルール選択（不具合2対応: 商品名優先）。
 * plugPerPiece===0 のルールを対象に、まず productName だけで照合する。
 * マッチがあれば label 最長のものを採用。なければ fullText にフォールバック。
 */
function selectCableRule(
  productName: string,
  fullText: string,
  rules: KeywordRule[]
): KeywordRule | null {
  const candidates = rules.filter((r) => r.plugPerPiece === 0);

  const nameHits = matchAllRules(productName, candidates);
  if (nameHits.length > 0) return longestLabelRule(nameHits);

  const fullHits = matchAllRules(fullText, candidates);
  if (fullHits.length > 0) return longestLabelRule(fullHits);

  return null;
}

/**
 * プラグルール選択（不具合1対応: 最長一致で重複除去）。
 * plugPerPiece>0 のルールを全文で照合し、部分文字列関係にある短い型番を除去して返す。
 * 例: NC3MXX と NC3MXX-B が両方マッチ → NC3MXX-B だけを残す。
 */
function selectPlugRules(text: string, rules: KeywordRule[]): KeywordRule[] {
  const candidates = rules.filter((r) => r.plugPerPiece > 0);
  const hits = matchAllRules(text, candidates);
  return deduplicateLongestMatch(hits);
}

/** 価格計算: 新価格 = 現在価格 + (長さ × ケーブル単価) + (本数 × プラグ単価合計) */
export function calculatePrice(row: AmazonRow, rules: KeywordRule[], plugExtraText = ''): CalcResult {
  const base: CalcResult = {
    sku: row.sku,
    asin: row.asin,
    productName: row.productName,
    description: row.description,
    bulletPoints: row.bulletPoints,
    currentPrice: row.currentPrice,
    newPrice: null,
    diff: null,
    matchedRuleLabel: null,
    lengthM: null,
    pieces: null,
    manualReason: null,
    cableRateUnregistered: false,
    cableAdd: 0,
    plugAdd: 0,
    plugLabels: '',
    allMatchedLabels: '',
  };

  if (!row.currentPrice || row.currentPrice <= 0) {
    return { ...base, manualReason: '現在価格が不明・0円' };
  }

  if (/バイワイヤ|バイワイ|bi[\s\-_]?wir/i.test(row.productName)) {
    return { ...base, manualReason: 'バイワイヤリング（手動対応）' };
  }
  if (/\d+\s*ch/i.test(row.productName)) {
    return { ...base, manualReason: '多チャンネル（手動対応）' };
  }

  // マッチ対象: 商品名 + 商品説明 + 商品の仕様 を連結
  const matchText = [row.productName, row.description, row.bulletPoints]
    .filter(Boolean)
    .join(' ');
  // プラグ判定のみ plug_name（plugExtraText）を追加する
  const plugMatchText = plugExtraText ? `${matchText} ${plugExtraText}` : matchText;

  // 不具合2修正: ケーブルは商品名優先、不具合1修正: プラグは最長一致で重複除去
  const cableRule = selectCableRule(row.productName, matchText, rules);
  const plugRules = selectPlugRules(plugMatchText, rules);

  if (!cableRule && plugRules.length === 0) {
    return { ...base, manualReason: 'キーワードに一致しない' };
  }

  const lengthM = extractLengthFromRow(row);
  const pieces = extractPieces(row.productName);

  // 長さが取れない & ケーブル加算がある場合は手動送り
  if (lengthM === null && (cableRule?.cablePerMeter ?? 0) > 0) {
    const allLabels = [cableRule!.label, ...plugRules.map((r) => r.label)].join('+');
    return {
      ...base,
      matchedRuleLabel: cableRule!.label,
      allMatchedLabels: allLabels,
      pieces,
      manualReason: '長さが読み取れない',
    };
  }

  const cableAdd = (lengthM ?? 0) * (cableRule?.cablePerMeter ?? 0) * pieces;
  // 重複除去済みプラグルールの単価を合算して本数倍
  const plugAdd = pieces * plugRules.reduce((sum, r) => sum + r.plugPerPiece, 0);
  const newPrice = Math.round(row.currentPrice + cableAdd + plugAdd);

  // ケーブル単価が0のルールにマッチ = ケーブル型番未登録の疑い
  const cableRateUnregistered = cableRule !== null && cableRule.cablePerMeter === 0;

  return {
    ...base,
    newPrice,
    diff: newPrice - row.currentPrice,
    matchedRuleLabel: cableRule?.label ?? plugRules[0]?.label ?? null,
    lengthM,
    pieces,
    cableRateUnregistered,
    cableAdd,
    plugAdd,
    plugLabels: plugRules.map((r) => r.label).join('+'),
    allMatchedLabels: [cableRule?.label, ...plugRules.map((r) => r.label)].filter(Boolean).join('+'),
  };
}
