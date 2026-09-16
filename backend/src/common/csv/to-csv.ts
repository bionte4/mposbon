/** Escape a CSV field (RFC 4180-ish). Always quote when needed. */
export function csvEscape(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  const raw = String(value);
  if (/[",\r\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

export function toCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const lines = [
    headers.map(csvEscape).join(','),
    ...rows.map((row) => row.map(csvEscape).join(',')),
  ];
  // BOM helps Excel open UTF-8 currency labels correctly
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
