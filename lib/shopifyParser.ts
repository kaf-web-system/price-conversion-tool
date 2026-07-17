export type ShopifyRow = {
  handle: string;
  originalTitle: string;
  synthesizedTitle: string;
  sku: string;
  currentPrice: number;
  status: string;
  titleWasFilled: boolean;
  /** rawRows 配列におけるこのバリアント行のインデックス（0=ヘッダー、1〜=データ行） */
  rowIndex: number;
};

export type ShopifyParseResult = {
  rows: ShopifyRow[];
  totalRaw: number;      // rows with a Handle (before any filter)
  skipNoPrice: number;   // Handle あり・Price 空または 0 以下
  skipNoTitle: number;   // Handle あり・補完後も Title 空
  skipStatus: number;    // Handle あり・activeOnly でStatus除外
  /** パース済みの全CSV行（ヘッダー＋全データ行）。インポート用CSV再シリアライズに使用 */
  rawRows: string[][];
};

// ─── CSV parser ──────────────────────────────────────────────────────────────
// Parses the entire CSV text in one pass so multi-line quoted fields work.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (ch === '"') {
      // Quoted field
      i++;
      while (i < text.length) {
        if (text[i] === '"') {
          if (i + 1 < text.length && text[i + 1] === '"') {
            field += '"';
            i += 2;
          } else {
            i++; // closing quote
            break;
          }
        } else {
          field += text[i++];
        }
      }
    } else if (ch === ',') {
      row.push(field);
      field = '';
      i++;
    } else if (ch === '\r') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i++;
      if (i < text.length && text[i] === '\n') i++;
    } else if (ch === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i++;
    } else {
      field += text[i++];
    }
  }

  // Flush last row (no trailing newline)
  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

// ─── Length / pieces helpers ─────────────────────────────────────────────────
const LENGTH_RE = /(\d+\.?\d*)\s*(m|cm)(?![a-zA-Z])/i;

function stripLengthFromTitle(title: string): string {
  let s = title.replace(/[（(]\s*\d+\.?\d*\s*(?:m|cm)\s*[）)]/gi, '');
  s = s.replace(/(?<![a-zA-Z\d])\d+\.?\d*\s*(?:m|cm)(?![a-zA-Z])/gi, '');
  return s.replace(/\s+/g, ' ').trim();
}

function extractLengthFromOptions(opts: string[]): { raw: string } | null {
  for (const opt of opts) {
    if (!opt || opt === 'Default Title') continue;
    const m = opt.match(LENGTH_RE);
    if (m) return { raw: `${m[1]}${m[2].toLowerCase()}` };
  }
  return null;
}

function extractPiecesFromOptions(opts: string[]): number | null {
  for (const opt of opts) {
    if (!opt) continue;
    const m = opt.match(/(\d+)\s*本/);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

function synthesizeTitle(title: string, opts: string[], titleWasFilled: boolean): string {
  const titleHasLength = LENGTH_RE.test(title);

  let baseTitle: string;
  let useOptionLength: boolean;

  if (titleHasLength && !titleWasFilled) {
    baseTitle = title;
    useOptionLength = false;
  } else if (titleHasLength && titleWasFilled) {
    baseTitle = stripLengthFromTitle(title);
    useOptionLength = true;
  } else {
    baseTitle = title;
    useOptionLength = true;
  }

  const optLength = useOptionLength ? extractLengthFromOptions(opts) : null;
  const pieces    = extractPiecesFromOptions(opts);

  let result = baseTitle;
  if (optLength) result += ` (${optLength.raw})`;
  if (pieces !== null) result += ` ${pieces}本`;
  return result;
}

function parsePriceString(s: string): number {
  const cleaned = s.replace(/[^\d.]/g, '');
  return cleaned ? parseFloat(cleaned) : NaN;
}

// ─── Main export ──────────────────────────────────────────────────────────────
export function parseShopifyCsv(text: string, activeOnly: boolean): ShopifyParseResult {
  // ① Remove BOM, parse entire CSV in one stream pass
  const clean = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const allRows = parseCsv(clean);
  if (allRows.length < 2) return { rows: [], totalRaw: 0, skipNoPrice: 0, skipNoTitle: 0, skipStatus: 0, rawRows: allRows };

  const header = allRows[0];
  const col = (name: string) =>
    header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());

  const iHandle = col('Handle');
  const iTitle  = col('Title');
  const iStatus = col('Status');
  const iSku    = col('Variant SKU');
  const iPrice  = col('Variant Price');
  const iOpt1   = col('Option1 Value');
  const iOpt2   = col('Option2 Value');
  const iOpt3   = col('Option3 Value');

  if (iHandle === -1) {
    return { rows: [], totalRaw: 0, skipNoPrice: 0, skipNoTitle: 0, skipStatus: 0, rawRows: allRows };
  }

  // ② Forward-fill: collect raw data per row, then fill Title/Status per Handle group
  type RawEntry = {
    rowIndex: number;
    handle: string;
    rawTitle: string;
    rawStatus: string;
    sku: string;
    priceStr: string;
    opt1: string; opt2: string; opt3: string;
  };

  const entries: RawEntry[] = [];

  for (let i = 1; i < allRows.length; i++) {
    const cols = allRows[i];
    // Skip completely empty rows (e.g., trailing newline)
    if (cols.length === 1 && cols[0] === '') continue;

    const handle = iHandle < cols.length ? cols[iHandle].trim() : '';
    if (!handle) continue;

    entries.push({
      rowIndex: i,
      handle,
      rawTitle:  iTitle  < cols.length ? cols[iTitle].trim()  : '',
      rawStatus: iStatus < cols.length ? cols[iStatus].trim() : '',
      sku:       iSku    < cols.length ? cols[iSku].trim()    : '',
      priceStr:  iPrice  < cols.length ? cols[iPrice].trim()  : '',
      opt1:      iOpt1 >= 0 && iOpt1 < cols.length ? cols[iOpt1].trim() : '',
      opt2:      iOpt2 >= 0 && iOpt2 < cols.length ? cols[iOpt2].trim() : '',
      opt3:      iOpt3 >= 0 && iOpt3 < cols.length ? cols[iOpt3].trim() : '',
    });
  }

  // Apply forward-fill within each Handle group
  type FilledEntry = RawEntry & { title: string; status: string; titleWasFilled: boolean };

  let lastHandle = '';
  let lastTitle  = '';
  let lastStatus = '';

  const filled: FilledEntry[] = entries.map((e) => {
    if (e.handle !== lastHandle) {
      lastHandle = e.handle;
      lastTitle  = e.rawTitle;
      lastStatus = e.rawStatus;
    } else {
      if (e.rawTitle)  lastTitle  = e.rawTitle;
      if (e.rawStatus) lastStatus = e.rawStatus;
    }
    return {
      ...e,
      title: lastTitle,
      status: lastStatus,
      titleWasFilled: e.rawTitle === '' && lastTitle !== '',
    };
  });

  // ③ Filter + synthesize
  const totalRaw = filled.length;
  let skipNoPrice = 0;
  let skipNoTitle = 0;
  let skipStatus  = 0;
  const rows: ShopifyRow[] = [];

  for (const e of filled) {
    const price = parsePriceString(e.priceStr);
    if (isNaN(price) || price <= 0) { skipNoPrice++; continue; }

    if (!e.title) { skipNoTitle++; continue; }

    if (activeOnly) {
      const s = e.status.toLowerCase();
      if (s !== '' && s !== 'active') { skipStatus++; continue; }
    }

    rows.push({
      handle:           e.handle,
      originalTitle:    e.title,
      synthesizedTitle: synthesizeTitle(e.title, [e.opt1, e.opt2, e.opt3], e.titleWasFilled),
      sku:              e.sku,
      currentPrice:     price,
      status:           e.status,
      titleWasFilled:   e.titleWasFilled,
      rowIndex:         e.rowIndex,
    });
  }

  return { rows, totalRaw, skipNoPrice, skipNoTitle, skipStatus, rawRows: allRows };
}
