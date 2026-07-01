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
  cablePieces: number | null;
  pieces: number | null;
  manualReason: string | null;
  /** プラグ型番だけマッチ、ケーブル単価が0のルールで計算した場合に true */
  cableRateUnregistered: boolean;
};

<<<<<<< HEAD
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
=======
/**
 * バイワイヤリング検出用の共通正規表現
 * 商品名から「バイワイヤリング／バイワイ／bi-wir／bi wir」等を検出する。
 * parser.ts 内の `extractCablePieces` と `calculatePrice`、両方の判定を統一する。
 * （章尋さん指示 2026-05-21：場所によって検出基準が違うと整合性が崩れるため一本化）
 */
export const BI_WIRING_RE = /バイワイヤリング|バイワイ|bi[\s\-]?wir/i;

/**
 * "(4m)" "(25cm)" "(1.5m)" 等から長さ(m)を抽出
 *
 * 章尋さん指示（2026-05-21）：
 *   半角「m/cm」だけでなく全角「ｍ/ｃｍ」、および大文字「M/Ｍ」「C/Ｃ」も認識する。
 *   例：「（4ｍ）」「（30ｃｍ）」「(4M)」「(30CM)」も length 抽出が走る。
 */
export function extractLengthMeters(name: string): number | null {
  // メートル表記（半角 m / 全角 ｍ / 大文字 M / 全角大文字 Ｍ）
  const mMatch = name.match(/[（(]\s*(\d+(?:\.\d+)?)\s*[mｍMＭ]\s*[）)]/);
  if (mMatch) return parseFloat(mMatch[1]);
  // センチ表記（c/ｃ/C/Ｃ + m/ｍ/M/Ｍ）
  const cmMatch = name.match(/[（(]\s*(\d+(?:\.\d+)?)\s*[cｃCＣ][mｍMＭ]\s*[）)]/);
  if (cmMatch) return parseFloat(cmMatch[1]) / 100;
  // 括弧外の "1.5m" 表記もフォールバック（全角・大文字対応）
  const mFallback = name.match(/(\d+(?:\.\d+)?)\s*[mｍMＭ](?![a-zA-Zａ-ｚＡ-Ｚ])/);
>>>>>>> cfba479f9b0e5e4c138a04aa2846de64f4bc6048
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

<<<<<<< HEAD
/** 1商品名に対して最初にマッチしたルールを返す（先勝ち） */
export function matchRule(text: string, rules: KeywordRule[]): KeywordRule | null {
=======
/**
 * ケーブル本数を抽出（ケーブル単価×長さ×本数 の計算に使う）
 * "2本ペア" → 2, "4本セット" → 4, "ペア" → 2
 * "8ch" → 1（多芯ケーブル1本構造のため）
 * "バイワイヤリング" → 1（特殊計算は仕様確認後に対応・Notion#7）
 * その他 → 1
 */
export function extractCablePieces(name: string): number {
  // バイワイヤリングは特殊（Notion#7 仕様確認後に実装）→ 暫定で1本扱い
  // 章尋さん指示 2026-05-21：calculatePrice 側と検出パターンを統一（共通定数 BI_WIRING_RE）
  if (BI_WIRING_RE.test(name)) return 1;
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
>>>>>>> cfba479f9b0e5e4c138a04aa2846de64f4bc6048
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

<<<<<<< HEAD
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
=======
/**
 * 1商品名に対して、「ケーブル系（1m単価>0）」と「プラグ系（プラグ単価>0）」を別々に探して両方返す。
 * これにより、商品名にケーブル型番とプラグ型番の両方が含まれる場合に両方加算できる。
 * 例: "MOGAMI 2534 NC3FXX-B (1m)" → cable: 2534ルール, plug: NC3FXX-Bルール
 *
 * 後方互換のため戻り値は { cable, plug } の単一形のまま。
 * 複数プラグ合算には `matchCableAndPlugs`（複数形）を使う。
 */
export function matchCableAndPlug(name: string, rules: KeywordRule[]): {
  cable: KeywordRule | null;
  plug: KeywordRule | null;
} {
  const { cable, plugs } = matchCableAndPlugs(name, rules);
  return { cable, plug: plugs[0] ?? null };
}

/**
 * 1商品名に対して、ケーブルルール（最初の1件）と
 * プラグルール（マッチしたものすべて）を返す。
 *
 * 徳山様仕様確認（2026-05-20）に基づく拡張:
 *   「ハイフンで繋がっているのは別単位として認識する」
 *   例: "ME2591-NAC3FCA" は ME2591 と NAC3FCA の2プラグ別々として合算する
 *
 * 章尋さん追加指示（2026-05-21）:
 *   「同じプラグであっても両端の場合は2個でカウントして」
 *   例: "ME2591-NL4-ME2591" は ME2591 を **2個**、NL4 を 1個としてカウントする
 *
 * 実装方針:
 *   - ハイフン繋ぎの「型番チェーン」（例: "ME2591-NL4-ME2591"）を抽出する
 *   - チェーン内では各プラグルールが出現した回数分カウント（両端同プラグに対応）
 *   - チェーン外（商品名のフリーテキスト部分）はルール1件につき最大1回カウント
 *     （「ME2591 高音質ペアセット ME2591」のような自由記述での誤検出を防ぐため）
 *
 * 戻り値の `plugs` 配列には、出現回数分だけ同じルールを重複させて入れる。
 * 例: ME2591 が2回出現すれば plugs に ME2591 ルールが 2回入る。
 * これにより既存の `plugRules.reduce((sum, p) => sum + pieces * p.plugPerPiece, 0)`
 * がそのまま正しい合算額を計算できる。
 */
export function matchCableAndPlugs(name: string, rules: KeywordRule[]): {
  cable: KeywordRule | null;
  plugs: KeywordRule[];
} {
  let cable: KeywordRule | null = null;
  const plugs: KeywordRule[] = [];

  // ハイフン繋ぎの「型番チェーン」を抽出する。
  // 「英数字を含むトークンが [-‐−–—] で2つ以上連結されている部分」を対象。
  // 例: "ME2591-NL4-ME2591" → ヒット
  //     "ME2591-NAC3FCA"   → ヒット
  //     単独の "ME2591"    → ヒットしない（チェーンではない）
  const HYPHEN_CLASS = '[-‐−–—]';
  const TOKEN = '[A-Za-z0-9][A-Za-z0-9/]*';
  const chainRe = new RegExp(`${TOKEN}(?:${HYPHEN_CLASS}${TOKEN}){1,}`, 'g');
  const chains: string[] = [];
  for (const m of name.matchAll(chainRe)) {
    chains.push(m[0]);
  }

  for (const rule of rules) {
    let re: RegExp;
    try {
      re = new RegExp(rule.pattern, 'i');
    } catch {
      continue;
    }
    if (!re.test(name)) continue;

    if (rule.cablePerMeter > 0 && !cable) cable = rule;

    if (rule.plugPerPiece > 0) {
      // チェーン内で何回出現するかをカウント
      let chainCount = 0;
      for (const chain of chains) {
        const reForChain = new RegExp(rule.pattern, 'gi');
        const matches = chain.match(reForChain);
        if (matches) chainCount += matches.length;
      }

      if (chainCount >= 1) {
        // チェーン内出現 → 回数分 push（両端同プラグ対応）
        for (let i = 0; i < chainCount; i++) plugs.push(rule);
      } else {
        // チェーン外（フリーテキスト）でヒットしたケース → 1個だけカウント
        // （誤検出抑止のため複数出現でも1個とする）
        plugs.push(rule);
      }
    }
  }
  return { cable, plugs };
}

/** 価格計算: 新価格 = 現在価格 + (長さ × ケーブル本数 × ケーブル単価) + (プラグ個数 × プラグ単価) */
export function calculatePrice(row: AmazonRow, rules: KeywordRule[]): CalcResult {
>>>>>>> cfba479f9b0e5e4c138a04aa2846de64f4bc6048
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
    cablePieces: null,
    pieces: null,
    manualReason: null,
    cableRateUnregistered: false,
  };

  if (!row.currentPrice || row.currentPrice <= 0) {
    return { ...base, manualReason: '現在価格が不明・0円' };
  }

<<<<<<< HEAD
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
=======
  // バイワイヤリング商品は特殊計算（2+4の×6、バナナはペアで×12、プラグ違いはa×2+b×4）が必要なため手動対応に回す
  // 章尋さん指示 2026-05-21：extractCablePieces と検出パターンを統一（共通定数 BI_WIRING_RE）
  if (BI_WIRING_RE.test(row.productName)) {
    return { ...base, manualReason: 'バイワイヤリング（特殊計算のため手動対応）' };
  }

  // ケーブル系・プラグ系を別々にマッチ（両方含む商品で合算するため）
  // プラグは複数ヒットした場合すべて合算する（徳山様仕様確認 2026-05-20）
  const { cable: cableRule, plugs: plugRules } = matchCableAndPlugs(row.productName, rules);
>>>>>>> cfba479f9b0e5e4c138a04aa2846de64f4bc6048

  if (!cableRule && plugRules.length === 0) {
    return { ...base, manualReason: 'キーワードに一致しない' };
  }

<<<<<<< HEAD
  const lengthM = extractLengthFromRow(row);
  const pieces = extractPieces(row.productName);

  // 長さが取れない & ケーブル加算がある場合は手動送り
  if (lengthM === null && (cableRule?.cablePerMeter ?? 0) > 0) {
    return {
      ...base,
      matchedRuleLabel: cableRule!.label,
=======
  const lengthM = extractLengthMeters(row.productName);
  const cablePieces = extractCablePieces(row.productName);
  const pieces = extractPieces(row.productName);

  // ラベル生成ヘルパー：
  //   - cable と plug が同一ルール（4列形式で1ルールに両方の単価が入っている）の場合は重複を消す
  //   - 両端同プラグ等で plugRules 配列に同じルールが複数回入っているケースも、
  //     表示ラベルは一意化する（matchedRuleLabel には1回だけ表示）
  const labelParts: string[] = [];
  const seenLabelIds = new Set<string>();
  if (cableRule) {
    labelParts.push(cableRule.label);
    seenLabelIds.add(cableRule.id);
  }
  for (const p of plugRules) {
    if (seenLabelIds.has(p.id)) continue;
    labelParts.push(p.label);
    seenLabelIds.add(p.id);
  }
  const matchedLabel = labelParts.join(' + ');

  // ケーブル単価ありなのに長さが取れない場合は手動送り
  if (cableRule && lengthM === null) {
    return {
      ...base,
      matchedRuleLabel: matchedLabel,
      cablePieces,
>>>>>>> cfba479f9b0e5e4c138a04aa2846de64f4bc6048
      pieces,
      manualReason: '長さが読み取れない',
    };
  }

<<<<<<< HEAD
  const cableAdd = (lengthM ?? 0) * (cableRule?.cablePerMeter ?? 0) * pieces;
  // 重複除去済みプラグルールの単価を合算して本数倍
  const plugAdd = pieces * plugRules.reduce((sum, r) => sum + r.plugPerPiece, 0);
=======
  const cableAdd = cableRule ? (lengthM ?? 0) * cablePieces * cableRule.cablePerMeter : 0;
  // プラグは各ルールの単価×個数を合算
  const plugAdd = plugRules.reduce((sum, p) => sum + pieces * p.plugPerPiece, 0);
>>>>>>> cfba479f9b0e5e4c138a04aa2846de64f4bc6048
  const newPrice = Math.round(row.currentPrice + cableAdd + plugAdd);

  // ケーブル単価が0のルールにマッチ = ケーブル型番未登録の疑い
  const cableRateUnregistered = cableRule !== null && cableRule.cablePerMeter === 0;

  return {
    ...base,
    newPrice,
    diff: newPrice - row.currentPrice,
<<<<<<< HEAD
    matchedRuleLabel: cableRule?.label ?? plugRules[0]?.label ?? null,
=======
    matchedRuleLabel: matchedLabel,
>>>>>>> cfba479f9b0e5e4c138a04aa2846de64f4bc6048
    lengthM,
    cablePieces,
    pieces,
    cableRateUnregistered,
  };
}
