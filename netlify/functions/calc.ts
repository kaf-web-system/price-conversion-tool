import type { Handler, HandlerEvent } from '@netlify/functions';
import { parseAmazonCsv } from '../../lib/csv';
import { calculatePrice, type KeywordRule } from '../../lib/parser';

export const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const contentType = event.headers['content-type'] ?? '';
    if (!contentType.includes('multipart/form-data')) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'multipart/form-data が必要です' }),
      };
    }

    // Parse multipart form data manually
    const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
    if (!boundaryMatch) {
      return { statusCode: 400, body: JSON.stringify({ error: 'boundary が見つかりません' }) };
    }
    const boundary = boundaryMatch[1];

    const bodyBuffer = event.isBase64Encoded
      ? Buffer.from(event.body ?? '', 'base64')
      : Buffer.from(event.body ?? '', 'binary');

    const parts = parseMultipart(bodyBuffer, boundary);

    const filePart = parts.find((p) => p.name === 'file');
    const rulesPart = parts.find((p) => p.name === 'rules');
    const activeOnlyPart = parts.find((p) => p.name === 'activeOnly');

    if (!filePart) {
      return { statusCode: 400, body: JSON.stringify({ error: 'CSVファイルが選ばれていません' }) };
    }
    if (!rulesPart) {
      return { statusCode: 400, body: JSON.stringify({ error: 'キーワードルールが空です' }) };
    }

    let rules: KeywordRule[] = [];
    try {
      rules = JSON.parse(rulesPart.data.toString('utf-8'));
    } catch {
      return { statusCode: 400, body: JSON.stringify({ error: 'ルールのJSONが壊れています' }) };
    }

    if (!Array.isArray(rules) || rules.length === 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'ルールを1件以上設定してください' }) };
    }

    const activeOnly = activeOnlyPart?.data.toString('utf-8') === 'true';
    const rows = parseAmazonCsv(filePart.data, { activeOnly });

    const results = rows.map((r) => calculatePrice(r, rules));
    const auto = results.filter((r) => r.newPrice !== null);
    const manual = results.filter((r) => r.newPrice === null);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        total: rows.length,
        autoCount: auto.length,
        manualCount: manual.length,
        preview: results.slice(0, 50),
        results,
      }),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : '不明なエラー';
    return { statusCode: 500, body: JSON.stringify({ error: `処理中にエラー: ${msg}` }) };
  }
};

type Part = { name: string; filename?: string; data: Buffer };

function parseMultipart(body: Buffer, boundary: string): Part[] {
  const parts: Part[] = [];
  const sep = Buffer.from(`--${boundary}`);
  const end = Buffer.from(`--${boundary}--`);

  let pos = 0;
  while (pos < body.length) {
    const boundaryIdx = indexOf(body, sep, pos);
    if (boundaryIdx === -1) break;
    pos = boundaryIdx + sep.length;

    // Check for end boundary
    if (body.slice(pos, pos + 2).toString() === '--') break;

    // Skip CRLF after boundary
    if (body.slice(pos, pos + 2).toString() === '\r\n') pos += 2;

    // Find end of headers (double CRLF)
    const headerEnd = indexOf(body, Buffer.from('\r\n\r\n'), pos);
    if (headerEnd === -1) break;

    const headerStr = body.slice(pos, headerEnd).toString('utf-8');
    pos = headerEnd + 4;

    // Find start of next boundary
    const nextBoundary = indexOf(body, sep, pos);
    if (nextBoundary === -1) break;

    // Data ends 2 bytes before next boundary (CRLF before --)
    const dataEnd = nextBoundary - 2;
    const data = body.slice(pos, dataEnd);
    pos = nextBoundary;

    const nameMatch = headerStr.match(/name="([^"]+)"/);
    const filenameMatch = headerStr.match(/filename="([^"]+)"/);
    if (nameMatch) {
      parts.push({
        name: nameMatch[1],
        filename: filenameMatch?.[1],
        data,
      });
    }
  }

  // Suppress unused variable warning
  void end;

  return parts;
}

function indexOf(haystack: Buffer, needle: Buffer, start = 0): number {
  for (let i = start; i <= haystack.length - needle.length; i++) {
    let found = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        found = false;
        break;
      }
    }
    if (found) return i;
  }
  return -1;
}
