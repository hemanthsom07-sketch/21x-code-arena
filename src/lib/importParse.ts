export interface ImportTest { input: string; expected_output: string; is_hidden: boolean }
export interface ImportQuestion {
  title: string; statement: string; constraints?: string; sample_input?: string; sample_output?: string
  difficulty: string; points: number; languages: string[]; test_cases: ImportTest[]
}
export interface ParseResult { questions: ImportQuestion[]; errors: string[] }

/** Minimal RFC-4180 CSV parser (quoted fields, escaped quotes, newlines inside quotes). */
export function parseCsv(text: string): string[][] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)  // strip UTF-8 BOM (Excel "CSV UTF-8")
  const rows: string[][] = []; let row: string[] = []; let f = ''; let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++ } else q = false } else f += c }
    else if (c === '"') q = true
    else if (c === ',') { row.push(f); f = '' }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = '' }
    else f += c
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row) }
  return rows.filter(r => r.some(x => x.trim() !== ''))
}

const DIFF = ['easy', 'medium', 'hard']
const LANG = ['c', 'python']

function validate(q: ImportQuestion, label: string, errors: string[]) {
  if (!q.title || q.title.length < 3) errors.push(`${label}: title is required (min 3 chars)`)
  if (!q.statement) errors.push(`${label}: statement is required`)
  if (!DIFF.includes(q.difficulty)) errors.push(`${label}: difficulty must be easy, medium or hard`)
  if (!Number.isInteger(q.points) || q.points <= 0) errors.push(`${label}: points must be a positive integer`)
  if (!q.languages.length || q.languages.some(l => !LANG.includes(l))) errors.push(`${label}: languages must be c and/or python`)
  if (!q.test_cases.length) errors.push(`${label}: at least one test case is required`)
  q.test_cases.forEach((t, i) => { if (t.expected_output === '' ) errors.push(`${label}: test case ${i + 1} has empty expected_output`) })
}

export function parseJson(text: string): ParseResult {
  const errors: string[] = []
  let data: any
  try { data = JSON.parse(text.replace(/^\uFEFF/, '')) } catch { return { questions: [], errors: ['File is not valid JSON'] } }
  const arr = Array.isArray(data) ? data : data?.questions
  if (!Array.isArray(arr)) return { questions: [], errors: ['Expected an array, or an object with a "questions" array'] }
  const questions = arr.map((x: any, i: number): ImportQuestion => ({
    title: String(x.title ?? '').trim(), statement: String(x.statement ?? ''),
    constraints: x.constraints, sample_input: x.sample_input, sample_output: x.sample_output,
    difficulty: String(x.difficulty ?? 'easy').toLowerCase(), points: Number(x.points ?? 100),
    languages: Array.isArray(x.languages) ? x.languages.map((l: any) => String(l).toLowerCase()) : ['c', 'python'],
    test_cases: (Array.isArray(x.test_cases) ? x.test_cases : []).map((t: any) => ({
      input: String(t.input ?? ''), expected_output: String(t.expected_output ?? ''), is_hidden: t.is_hidden !== false })),
  }))
  questions.forEach((q, i) => validate(q, `Question ${i + 1}`, errors))
  return { questions, errors }
}

/** CSV: one row per test case; rows sharing a title form one question (question fields from its first row). */
export function parseCsvQuestions(text: string): ParseResult {
  const rows = parseCsv(text); const errors: string[] = []
  if (rows.length < 2) return { questions: [], errors: ['CSV needs a header row and at least one data row'] }
  const head = rows[0].map(h => h.trim().toLowerCase())
  for (const need of ['title', 'statement', 'input', 'expected_output'])
    if (!head.includes(need)) errors.push(`Missing column: ${need}`)
  if (errors.length) return { questions: [], errors }
  const col = (r: string[], n: string) => (r[head.indexOf(n)] ?? '')
  const map = new Map<string, ImportQuestion>()
  for (const r of rows.slice(1)) {
    const title = col(r, 'title').trim()
    let q = map.get(title)
    if (!q) {
      q = { title, statement: col(r, 'statement'), constraints: col(r, 'constraints'),
        sample_input: col(r, 'sample_input'), sample_output: col(r, 'sample_output'),
        difficulty: (col(r, 'difficulty') || 'easy').trim().toLowerCase(), points: Number(col(r, 'points') || 100),
        languages: (col(r, 'languages') || 'c|python').split('|').map(s => s.trim().toLowerCase()).filter(Boolean), test_cases: [] }
      map.set(title, q)
    }
    q.test_cases.push({ input: col(r, 'input'), expected_output: col(r, 'expected_output'),
      is_hidden: col(r, 'is_hidden').trim().toLowerCase() !== 'false' })
  }
  const questions = [...map.values()]
  questions.forEach((q, i) => validate(q, `Question ${i + 1} ("${q.title}")`, errors))
  return { questions, errors }
}

export function parseImport(name: string, text: string): ParseResult {
  return name.toLowerCase().endsWith('.csv') ? parseCsvQuestions(text) : parseJson(text)
}
