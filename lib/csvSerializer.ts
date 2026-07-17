/**
 * RFC4180準拠のCSVシリアライザ。
 * 各フィールドを元の列順のままquoteエスケープして1つの文字列にする。
 * フィールド内の改行・引用符・カンマを壊さない。
 */
export function serializeCsv(rows: string[][]): string {
  return rows.map(escapeRow).join('\r\n');
}

function escapeRow(fields: string[]): string {
  return fields.map(escapeField).join(',');
}

function escapeField(field: string): string {
  if (field == null) return '';
  if (/[",\r\n]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}
