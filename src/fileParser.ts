import Papa from 'papaparse';
import { rowsToAmazonRows } from '../lib/columns';
import type { AmazonRow } from '../lib/parser';

// ─── Amazon在庫テンプレートのシステム名（行5）定数 ────────────────────────────
const MKT = 'A1VC38T7YXB528';

const SYS_SKU         = 'contribution_sku#1.value';
const SYS_NAME        = `item_name[marketplace_id=${MKT}][language_tag=ja_JP]#1.value`;
const SYS_DESC        = `product_description[marketplace_id=${MKT}][language_tag=ja_JP]#1.value`;
const SYS_BULLET_BASE = `bullet_point[marketplace_id=${MKT}][language_tag=ja_JP]#`;
const SYS_PRICE       = `purchasable_offer[marketplace_id=${MKT}][audience=ALL]#1.our_price#1.schedule#1.value_with_tax`;
const SYS_STATUS      = '::listing_status';
const SYS_CABLE_LEN   = `cable[marketplace_id=${MKT}]#1.length#1.string_value`;

// 「Activeのみ対象」で有効とみなすステータス
const ACTIVE_VALUES = new Set(['有効', 'Active', 'active']);

// ─── 診断情報 ──────────────────────────────────────────────────────────────

export type FileDiagInfo = {
  filename: string;
  sheetNames: string[];
  hasTemplateSheet: boolean;
  dataRowCount: number;
  columns: {
    sku: number | null;
    name: number | null;
    price: number | null;
    status: number | null;
  };
  error?: string;
};

// ─── 公開エントリ ──────────────────────────────────────────────────────────

export async function parseFile(
  file: File,
  opts: { activeOnly?: boolean } = {}
): Promise<{ rows: AmazonRow[]; diag: FileDiagInfo }> {
  const lower = file.name.toLowerCase();
  const baseDiag: FileDiagInfo = {
    filename: file.name,
    sheetNames: [],
    hasTemplateSheet: false,
    dataRowCount: 0,
    columns: { sku: null, name: null, price: null, status: null },
  };

  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch (e) {
    return { rows: [], diag: { ...baseDiag, error: `ファイル読み込み失敗: ${String(e)}` } };
  }

  if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.xlsm')) {
    return parseXlsxOrTemplate(buffer, opts, baseDiag);
  }

  try {
    const rows = parseCsv(buffer, opts);
    return { rows, diag: { ...baseDiag, dataRowCount: rows.length } };
  } catch (e) {
    return { rows: [], diag: { ...baseDiag, error: e instanceof Error ? e.message : String(e) } };
  }
}

// ─── xlsx / xlsm ──────────────────────────────────────────────────────────

async function parseXlsxOrTemplate(
  buffer: ArrayBuffer,
  opts: { activeOnly?: boolean },
  baseDiag: FileDiagInfo
): Promise<{ rows: AmazonRow[]; diag: FileDiagInfo }> {
  const XLSX = await import('xlsx');

  let workbook: import('xlsx').WorkBook;
  try {
    // cellText:false でセルごとの書式文字列生成をスキップ→メモリ削減
    workbook = XLSX.read(buffer, { type: 'array', cellText: false, cellHTML: false, cellNF: false });
  } catch (e) {
    return {
      rows: [],
      diag: { ...baseDiag, error: `XLSX読み込みエラー: ${e instanceof Error ? e.message : String(e)}` },
    };
  }

  const sheetNames = workbook.SheetNames;
  const hasTemplateSheet = sheetNames.includes('テンプレート');
  const diag: FileDiagInfo = { ...baseDiag, sheetNames, hasTemplateSheet };

  if (hasTemplateSheet) {
    const sheet = workbook.Sheets['テンプレート'];
    return parseAmazonTemplateCells(XLSX, sheet, opts, diag);
  }

  // テンプレートシートなし → 通常 xlsx として先頭シートを処理
  const sheetName = sheetNames[0];
  if (!sheetName) {
    return { rows: [], diag: { ...diag, error: 'シートが1つも見つかりません' } };
  }
  const sheet = workbook.Sheets[sheetName];
  try {
    const records = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: '', raw: false });
    if (records.length === 0) {
      return { rows: [], diag: { ...diag, error: 'データ行がありません（ヘッダー行のみ）' } };
    }
    const rows = rowsToAmazonRows(records, opts);
    return { rows, diag: { ...diag, dataRowCount: rows.length } };
  } catch (e) {
    return { rows: [], diag: { ...diag, error: e instanceof Error ? e.message : String(e) } };
  }
}

/**
 * Amazon在庫テンプレート専用パーサ（省メモリ版）。
 *
 * sheet_to_json で全列×全行を展開せず、セルアドレス直接アクセスのみ使用。
 *   行5(index 4) : システム名行 → 列インデックスMapを構築（全列走査は1行分のみ）
 *   行6(index 5) : Amazonサンプル → スキップ
 *   行7(index 6)〜: 実データ → 必要な列のセルのみ読む
 */
function parseAmazonTemplateCells(
  XLSX: typeof import('xlsx'),
  sheet: import('xlsx').WorkSheet,
  opts: { activeOnly?: boolean },
  baseDiag: FileDiagInfo
): { rows: AmazonRow[]; diag: FileDiagInfo } {
  const ref = sheet['!ref'];
  if (!ref) {
    return { rows: [], diag: { ...baseDiag, error: 'シート範囲(!ref)が空です' } };
  }

  const range = XLSX.utils.decode_range(ref);

  // セル1個を文字列で読む。cell.v（raw値）を使う（cellText:false のためcell.wは未設定）
  const readCell = (r: number, c: number): string => {
    if (c < 0) return '';
    const cell = sheet[XLSX.utils.encode_cell({ r, c })];
    if (!cell || cell.v === undefined || cell.v === null) return '';
    return String(cell.v).trim();
  };

  // ── ステップ1: 行5(index=4)だけ走査してシステム名→列インデックスMapを作る ──
  const colIdx = new Map<string, number>();
  for (let c = range.s.c; c <= range.e.c; c++) {
    const name = readCell(4, c);
    if (name) colIdx.set(name, c);
  }

  // ── ステップ2: 必要な列インデックスを確定 ──
  const idxSku    = colIdx.get(SYS_SKU)    ?? -1;
  const idxName   = colIdx.get(SYS_NAME)   ?? -1;
  const idxDesc   = colIdx.get(SYS_DESC)   ?? -1;
  const idxPrice  = colIdx.get(SYS_PRICE)  ?? -1;
  const idxStatus = colIdx.get(SYS_STATUS) ?? -1;
  const idxCable  = colIdx.get(SYS_CABLE_LEN) ?? -1;

  const idxBullets: number[] = [];
  for (let n = 1; n <= 5; n++) {
    const idx = colIdx.get(`${SYS_BULLET_BASE}${n}.value`) ?? -1;
    if (idx >= 0) idxBullets.push(idx);
  }

  const diagColumns = {
    sku:    idxSku    >= 0 ? idxSku    : null,
    name:   idxName   >= 0 ? idxName   : null,
    price:  idxPrice  >= 0 ? idxPrice  : null,
    status: idxStatus >= 0 ? idxStatus : null,
  };

  const diag: FileDiagInfo = { ...baseDiag, columns: diagColumns };

  if (idxName < 0 && idxSku < 0) {
    return {
      rows: [],
      diag: {
        ...diag,
        error:
          '商品名・SKU列が見つかりません。' +
          `行5のシステム名と定数が一致しているか確認してください（検出列数: ${colIdx.size}）`,
      },
    };
  }

  // ── ステップ3: 行7(index=6)以降、必要な列だけを読む ──
  const rows: AmazonRow[] = [];

  for (let r = 6; r <= range.e.r; r++) {
    const name        = readCell(r, idxName);
    const sku         = readCell(r, idxSku);

    if (!name && !sku) continue;
    if (!name) continue;

    const status = readCell(r, idxStatus);
    if (opts.activeOnly && !ACTIVE_VALUES.has(status)) continue;

    const description = readCell(r, idxDesc);
    const priceStr    = readCell(r, idxPrice);
    const cableLenStr = idxCable >= 0 ? readCell(r, idxCable) : '';

    const bulletParts = idxBullets.map((i) => readCell(r, i)).filter(Boolean);

    if (cableLenStr) {
      const lenNum = parseFloat(cableLenStr.replace(/[^\d.]/g, ''));
      if (!isNaN(lenNum) && lenNum > 0) bulletParts.push(`(${lenNum}m)`);
    }

    const price = parseFloat(priceStr.replace(/[^\d.,]/g, '').replace(/,/g, ''));

    rows.push({
      sku,
      asin: '',
      productName: name,
      description,
      bulletPoints: bulletParts.join(' '),
      currentPrice: isNaN(price) ? 0 : price,
      status,
      raw: {},
    });
  }

  return { rows, diag: { ...diag, dataRowCount: rows.length } };
}

// ─── CSV ──────────────────────────────────────────────────────────────────

function parseCsv(buffer: ArrayBuffer, opts: { activeOnly?: boolean }): AmazonRow[] {
  const bytes = new Uint8Array(buffer);
  const hasUtf8Bom = bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF;

  let text: string;
  try {
    text = new TextDecoder(hasUtf8Bom ? 'utf-8' : 'shift_jis').decode(buffer);
  } catch {
    text = new TextDecoder('utf-8').decode(buffer);
  }

  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });

  if (parsed.data.length === 0) {
    const firstError = parsed.errors[0];
    throw new Error(firstError ? `CSV解析エラー: ${firstError.message}` : 'CSVにデータ行がありません');
  }

  return rowsToAmazonRows(parsed.data, opts);
}
