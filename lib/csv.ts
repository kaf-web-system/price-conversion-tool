import Papa from 'papaparse';
import iconv from 'iconv-lite';
import { rowsToAmazonRows } from './columns';
import type { AmazonRow } from './parser';

/**
 * Amazon出品レポートCSV(CP932 or UTF-8) → AmazonRow[]
 * Node.js(Netlify Functions)環境向け。ブラウザではsrc/fileParser.tsを使う。
 */
export function parseAmazonCsv(buffer: Buffer, opts: { activeOnly?: boolean } = {}): AmazonRow[] {
  let text: string;
  try {
    text = iconv.decode(buffer, 'cp932');
  } catch {
    text = buffer.toString('utf-8');
  }

  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
  });

  return rowsToAmazonRows(parsed.data, opts);
}
