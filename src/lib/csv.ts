// CSV generation for exports (RFC 4180 quoting, CRLF rows). Parsing lives in importParse.ts (parseCsv).
const FORMULA_START = /^[=+\-@\t\r]/

/** One cell. Quotes values containing commas/quotes/newlines. Text starting with = + - @ gets a leading apostrophe so spreadsheet
 *  apps cannot execute it as a formula (CSV injection via names or source text). Numbers/booleans/null are written as-is. */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  let s = String(v)
  if (typeof v === 'string' && FORMULA_START.test(s)) s = "'" + s
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

export function toCsv(headers: string[], rows: Record<string, unknown>[], opts: { bom?: boolean } = {}): string {
  const lines = [headers.map(csvCell).join(','), ...rows.map(r => headers.map(h => csvCell(r[h])).join(','))]
  return (opts.bom === false ? '' : '\ufeff') + lines.join('\r\n') + '\r\n'   // BOM so Excel reads UTF-8 names correctly
}

export function downloadCsv(filename: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
