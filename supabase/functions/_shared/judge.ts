import type { ExecResult } from './adapter.ts'

export const MAX_SOURCE_BYTES = 65536
export const MAX_STDIN_BYTES = 16384
export const MAX_DISPLAY_CHARS = 2000
export type Verdict = 'accepted' | 'wrong_answer' | 'time_limit_exceeded' | 'runtime_error' | 'compilation_error' | 'internal_error'
export const VERDICT_LABEL: Record<Verdict, string> = {
  accepted: 'Accepted', wrong_answer: 'Wrong Answer', time_limit_exceeded: 'Time Limit Exceeded',
  runtime_error: 'Runtime Error', compilation_error: 'Compilation Error', internal_error: 'Judge Error' }
// Ascending severity; the submission verdict is the most severe per-test verdict.
const RANK: Verdict[] = ['accepted', 'wrong_answer', 'time_limit_exceeded', 'runtime_error', 'compilation_error', 'internal_error']
export const worstVerdict = (vs: Verdict[]): Verdict => vs.reduce((w, v) => (RANK.indexOf(v) > RANK.indexOf(w) ? v : w), 'accepted' as Verdict)

/** Comparison policy: CRLF/CR -> LF; trailing spaces/tabs on each line ignored; trailing blank lines ignored.
 *  Case-sensitive. Leading whitespace and internal spacing are significant. */
export function normalizeOutput(s: string): string {
  const lines = s.replace(/\r\n?/g, '\n').split('\n').map(l => l.replace(/[ \t\f\v]+$/, ''))
  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  return lines.join('\n')
}
export const outputsMatch = (actual: string, expected: string) => normalizeOutput(actual) === normalizeOutput(expected)
export const truncate = (s: string, n = MAX_DISPLAY_CHARS) => (s.length > n ? s.slice(0, n) + '\n…(truncated)' : s)

export function judgeOne(r: ExecResult, expected: string): Verdict {
  switch (r.outcome) {
    case 'ok': return outputsMatch(r.stdout, expected) ? 'accepted' : 'wrong_answer'
    case 'compile_error': return 'compilation_error'
    case 'runtime_error': return 'runtime_error'
    case 'time_limit': return 'time_limit_exceeded'
    default: return 'internal_error'
  }
}

export interface PublicTestResult { index: number; hidden: boolean; verdict: Verdict; time_ms: number | null
  input?: string; expected?: string; actual?: string; stderr?: string }
export interface Summary { verdict: Verdict; passed: number; total: number; time_ms: number | null; memory_kb: number | null; message: string; results: PublicTestResult[] }

/** Builds the student-visible summary. Hidden tests contribute ONLY index/verdict/time: never input, expected, actual or stderr
 *  (a program could echo hidden input to stdout/stderr, so those are withheld for hidden tests). */
export function summarize(tests: { input: string; expected_output: string; is_hidden: boolean }[], res: ExecResult[]): Summary {
  const per = res.map((r, i) => judgeOne(r, tests[i].expected_output))
  const verdict = worstVerdict(per)
  const results: PublicTestResult[] = tests.map((t, i) => {
    const base = { index: i + 1, hidden: t.is_hidden, verdict: per[i], time_ms: res[i].timeMs }
    return t.is_hidden ? base : { ...base, input: truncate(t.input), expected: truncate(t.expected_output), actual: truncate(res[i].stdout), stderr: truncate(res[i].stderr) }
  })
  let message = ''
  if (verdict === 'compilation_error') message = truncate(res.find(r => r.outcome === 'compile_error')?.compileOutput ?? '')
  else if (verdict === 'internal_error') message = 'The judge had a problem running your code. Please try again.'
  else if (verdict !== 'accepted') {
    const i = per.indexOf(verdict)
    message = `${VERDICT_LABEL[verdict]} on ${tests[i].is_hidden ? 'hidden ' : ''}test #${i + 1}.`
    if (!tests[i].is_hidden && res[i].stderr) message += '\n' + truncate(res[i].stderr)
  }
  const nums = (f: (r: ExecResult) => number | null) => { const v = res.map(f).filter((x): x is number => x != null); return v.length ? Math.max(...v) : null }
  return { verdict, passed: per.filter(v => v === 'accepted').length, total: tests.length,
    time_ms: nums(r => r.timeMs), memory_kb: nums(r => r.memoryKb), message, results }
}
