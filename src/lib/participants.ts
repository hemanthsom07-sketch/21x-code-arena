export interface ParticipantRow { roll_number: string; full_name: string; email: string; department: string | null; year: number | null }
export interface RowResult { line: number; raw: Record<string, string>; value?: ParticipantRow; errors: string[] }
export interface ParticipantParse { rows: RowResult[]; valid: ParticipantRow[]; invalid: RowResult[]; fileErrors: string[] }
export interface Existing { rolls: Set<string>; emails: Set<string> }

export const MAX_IMPORT_ROWS = 5000
const ALIASES: Record<string, string[]> = {
  roll_number: ['roll_number', 'roll', 'rollno', 'roll_no', 'usn', 'registration_number', 'reg_no'],
  full_name: ['full_name', 'name', 'student_name', 'fullname'],
  email: ['email', 'college_email', 'email_id', 'mail'],
  department: ['department', 'dept', 'branch'],
  year: ['year', 'semester', 'sem', 'year_or_semester'],
}
const norm = (h: string) => h.trim().toLowerCase().replace(/[\s-]+/g, '_')
export const ROLL_RE = /^[A-Z0-9._-]{3,30}$/
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** Validates a parsed participants CSV (`table` = output of parseCsv from importParse.ts, header row first). Never throws; every problem becomes a per-row or file-level message.
 *  `existing` holds roll numbers/emails already in the roster (uppercase / lowercase) for duplicate detection. */
export function parseParticipants(table: string[][], existing: Existing = { rolls: new Set(), emails: new Set() }): ParticipantParse {
  const out: ParticipantParse = { rows: [], valid: [], invalid: [], fileErrors: [] }
  if (table.length < 2) { out.fileErrors.push('The file needs a header row and at least one participant row.'); return out }
  if (table.length - 1 > MAX_IMPORT_ROWS) { out.fileErrors.push(`Too many rows (${table.length - 1}). Import at most ${MAX_IMPORT_ROWS} at a time.`); return out }
  const headers = table[0].map(norm)
  const col: Record<string, number> = {}
  for (const [field, names] of Object.entries(ALIASES)) col[field] = headers.findIndex(h => names.includes(h))
  for (const req of ['roll_number', 'full_name', 'email'] as const)
    if (col[req] < 0) out.fileErrors.push(`Missing required column "${req}" (accepted names: ${ALIASES[req].join(', ')}).`)
  if (out.fileErrors.length) return out

  const seenRoll = new Map<string, number>(), seenEmail = new Map<string, number>()
  table.slice(1).forEach((cells, i) => {
    const line = i + 2
    const get = (f: string) => (col[f] >= 0 ? (cells[col[f]] ?? '').trim() : '')
    const raw = Object.fromEntries(Object.keys(ALIASES).map(f => [f, get(f)]))
    const errors: string[] = []
    const roll = raw.roll_number.toUpperCase()
    const name = raw.full_name.replace(/\s+/g, ' ')
    const email = raw.email.toLowerCase()
    if (!roll) errors.push('Roll number is missing.')
    else if (!ROLL_RE.test(roll)) errors.push('Roll number may contain only letters, digits, dot, dash or underscore (3-30 characters).')
    if (!name) errors.push('Full name is missing.'); else if (name.length < 2 || name.length > 120) errors.push('Full name must be 2-120 characters.')
    if (!email) errors.push('Email is missing.'); else if (email.length > 254 || !EMAIL_RE.test(email)) errors.push('Email address is not valid.')
    if (raw.department.length > 60) errors.push('Department is too long (60 characters max).')
    let year: number | null = null
    if (raw.year) { if (/^\d+$/.test(raw.year) && +raw.year >= 1 && +raw.year <= 8) year = +raw.year; else errors.push('Year/semester must be a whole number from 1 to 8.') }
    if (roll && ROLL_RE.test(roll)) {
      if (seenRoll.has(roll)) errors.push(`Duplicate roll number (first seen on line ${seenRoll.get(roll)}).`)
      else seenRoll.set(roll, line)
      if (existing.rolls.has(roll)) errors.push('Roll number is already in the participant list.')
    }
    if (email && EMAIL_RE.test(email)) {
      if (seenEmail.has(email)) errors.push(`Duplicate email (first seen on line ${seenEmail.get(email)}).`)
      else seenEmail.set(email, line)
      if (existing.emails.has(email)) errors.push('Email is already in the participant list.')
    }
    const result: RowResult = { line, raw, errors }
    if (!errors.length) { result.value = { roll_number: roll, full_name: name, email, department: raw.department || null, year }; out.valid.push(result.value) }
    else out.invalid.push(result)
    out.rows.push(result)
  })
  return out
}
