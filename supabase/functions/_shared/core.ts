// Framework-free request logic (unit-tested in Node). serve.ts wires it to Deno + Supabase.
import type { ExecutionAdapter, ExecResult, Language } from './adapter.ts'
import { MAX_SOURCE_BYTES, MAX_STDIN_BYTES, summarize, truncate, type Summary } from './judge.ts'
import { UUID_RE } from './http.ts'

export interface TestCase { input: string; expected_output: string; is_hidden: boolean }
export interface QuestionLimits { languages: string[]; time_limit_ms: number; memory_limit_kb: number }
export interface Db {
  touchRun(uid: string): Promise<boolean>
  checkAccess(uid: string, qid: string): Promise<QuestionLimits>
  beginSubmission(uid: string, qid: string, lang: Language, code: string): Promise<{ id: string; time_limit_ms: number; memory_limit_kb: number }>
  getTests(qid: string): Promise<TestCase[]>
  finishSubmission(id: string, r: Summary): Promise<void>
  logEvent?(e: { kind: 'run' | 'submit'; user_id: string; code: string; detail: string }): Promise<void>   // judge-failure audit trail (best effort)
}
export interface Deps { adapter: ExecutionAdapter | null; db: Db; onError?: (e: unknown) => void }
export interface Reply { status: number; body: Record<string, unknown> }

const ok = (body: Record<string, unknown>): Reply => ({ status: 200, body: { ok: true, ...body } })
const fail = (code: string, message: string): Reply => ({ status: 200, body: { ok: false, code, message } })
const NOT_CONFIGURED = fail('not_configured', 'Code execution is not set up yet. An organizer needs to start and configure the judge service.')
const DB_MESSAGES: Record<string, string> = {
  not_found: 'Question not found.', locked: 'This challenge is locked.', language_not_allowed: 'That language is not allowed for this question.',
  too_large: 'Source code is too large (64 KB max).', cooldown: 'Please wait 10 seconds between submissions.',
  disabled: 'Your account is disabled. Contact the organizers.', closed: 'This challenge is closed; submissions are no longer accepted.',
  submissions_closed: 'Submissions are paused by the organizers right now.', event_not_started: 'The event has not started yet.', event_ended: 'The event has ended.' }
function dbError(e: unknown): Reply {
  const code = String((e as Error)?.message ?? '').match(/not_found|language_not_allowed|too_large|cooldown|disabled|submissions_closed|event_not_started|event_ended|closed|locked/)?.[0]
  if (!code) throw e
  return fail(code, DB_MESSAGES[code])
}
async function logEv(deps: Deps, kind: 'run' | 'submit', uid: string, code: string, e: unknown) {
  try { await deps.db.logEvent?.({ kind, user_id: uid, code, detail: String((e as Error)?.message ?? e) }) } catch { /* ignore */ }
}
const bytes = (s: string) => new TextEncoder().encode(s).length

function parse(body: any): { qid: string; language: Language; source: string } | Reply {
  if (!body || typeof body.question_id !== 'string' || !UUID_RE.test(body.question_id) || typeof body.source !== 'string' || (body.language !== 'c' && body.language !== 'python'))
    return fail('bad_request', 'Invalid request.')
  if (bytes(body.source) > MAX_SOURCE_BYTES) return fail('too_large', DB_MESSAGES.too_large)
  return { qid: body.question_id, language: body.language, source: body.source }
}

export async function handleRun(deps: Deps, uid: string, body: any): Promise<Reply> {
  if (!deps.adapter) return NOT_CONFIGURED
  const p = parse(body); if ('status' in p) return p
  const stdin = typeof body.stdin === 'string' ? body.stdin : ''
  if (bytes(stdin) > MAX_STDIN_BYTES) return fail('too_large', 'Custom input is too large (16 KB max).')
  let lim: QuestionLimits
  try {
    lim = await deps.db.checkAccess(uid, p.qid)
    if (!lim.languages.includes(p.language)) return fail('language_not_allowed', DB_MESSAGES.language_not_allowed)
    if (!(await deps.db.touchRun(uid))) return fail('rate_limited', 'Running too fast. Wait a few seconds and try again.')
  } catch (e) { return dbError(e) }
  let r: ExecResult
  try { [r] = await deps.adapter.runBatch([{ language: p.language, source: p.source, stdin, timeLimitMs: lim.time_limit_ms, memoryLimitKb: lim.memory_limit_kb }]) }
  catch (e) { deps.onError?.(e); await logEv(deps, 'run', uid, 'judge_unavailable', e); return fail('judge_unavailable', 'The judge is busy or unavailable. Please try again shortly.') }
  return ok({ outcome: r.outcome, stdout: truncate(r.stdout), stderr: truncate(r.stderr), compile_output: truncate(r.compileOutput), time_ms: r.timeMs, memory_kb: r.memoryKb })
}

export async function handleSubmit(deps: Deps, uid: string, body: any): Promise<Reply> {
  if (!deps.adapter) return NOT_CONFIGURED
  const p = parse(body); if ('status' in p) return p
  let begun
  try { begun = await deps.db.beginSubmission(uid, p.qid, p.language, p.source) } catch (e) { return dbError(e) }
  const internal = (message: string): Summary => ({ verdict: 'internal_error', passed: 0, total: 0, time_ms: null, memory_kb: null, message, results: [] })
  try {
    const tests = await deps.db.getTests(p.qid)
    if (!tests.length) {
      await deps.db.finishSubmission(begun.id, internal('This question has no test cases yet.'))
      return fail('no_tests', 'This question has no test cases yet. Please tell an organizer.')
    }
    let res: ExecResult[]
    try {
      res = await deps.adapter.runBatch(tests.map(t => ({ language: p.language, source: p.source, stdin: t.input, timeLimitMs: begun.time_limit_ms, memoryLimitKb: begun.memory_limit_kb })))
    } catch (e) {
      deps.onError?.(e); await logEv(deps, 'submit', uid, 'judge_unavailable', e)
      await deps.db.finishSubmission(begun.id, internal('Judge unavailable.'))
      return fail('judge_unavailable', 'The judge is busy or unavailable. Your attempt was recorded as a judge error; please try again shortly.')
    }
    const s = summarize(tests, res)
    await deps.db.finishSubmission(begun.id, s)
    return ok({ submission_id: begun.id, ...s })
  } catch (e) {
    // Never leave a submission stuck as "queued" if something unexpected fails after it was created.
    deps.onError?.(e); await logEv(deps, 'submit', uid, 'internal', e)
    try { await deps.db.finishSubmission(begun.id, internal('Internal error while judging.')) } catch { /* ignore */ }
    return fail('internal', 'Something went wrong while judging. Please try again.')
  }
}
