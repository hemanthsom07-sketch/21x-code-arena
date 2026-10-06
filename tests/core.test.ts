import test from 'node:test'
import assert from 'node:assert/strict'
import { handleRun, handleSubmit, type Db, type Deps, type TestCase } from '../supabase/functions/_shared/core.ts'
import { LocalAdapter, toolchainProblem } from './helpers/localAdapter.ts'

// Tests that really compile/run code are skipped (with the reason shown) if gcc/Python are missing;
// tests/toolchain.test.ts then fails once with install instructions.
const exec = { skip: toolchainProblem() ?? false }

const TESTS: TestCase[] = [
  { input: '2 3\n', expected_output: '5\n', is_hidden: false },
  { input: '7731 2213\n', expected_output: '9944\n', is_hidden: true },
]
function fakeDb(over: Partial<Db> & { tests?: TestCase[]; langs?: string[] } = {}) {
  const finished: any[] = []
  const db: Db = {
    touchRun: async () => true,
    checkAccess: async () => ({ languages: over.langs ?? ['c', 'python'], time_limit_ms: 3000, memory_limit_kb: 128000 }),
    beginSubmission: async () => ({ id: 'sub-1', time_limit_ms: 5000, memory_limit_kb: 128000 }),
    getTests: async () => over.tests ?? TESTS,
    finishSubmission: async (_id, r) => { finished.push(r) },
    ...over,
  }
  return { db, finished }
}
// X21_DEBUG=1 prints adapter errors that the core would otherwise convert into a generic judge_unavailable reply.
const onError = process.env.X21_DEBUG ? (e: unknown) => console.error('# judge error:', (e as Error)?.message) : undefined
const deps = (f = fakeDb()): Deps & { finished: any[] } => ({ adapter: new LocalAdapter(), db: f.db, finished: f.finished, onError })
const submit = (d: Deps, language: string, source: string) => handleSubmit(d, 'u1', { question_id: '11111111-1111-4111-8111-111111111111', language, source })

const Q = '11111111-1111-4111-8111-111111111111'
const C_OK = '#include <stdio.h>\nint main(){int a,b;scanf("%d %d",&a,&b);printf("%d\\n",a+b);return 0;}'
const PY_OK = 'a,b=map(int,input().split())\nprint(a+b)'

test('C accepted', exec, async () => { const d = deps(); const r = await submit(d, 'c', C_OK)
  assert.equal(r.body.verdict, 'accepted'); assert.equal(r.body.passed, 2); assert.equal(d.finished[0].verdict, 'accepted') })
test('Python accepted (trailing spaces/CRLF tolerated)', exec, async () => {
  const r = await submit(deps(), 'python', 'a,b=map(int,input().split())\nprint(str(a+b)+"   ")'); assert.equal(r.body.verdict, 'accepted') })
test('Python accepted', exec, async () => assert.equal((await submit(deps(), 'python', PY_OK)).body.verdict, 'accepted'))
test('C wrong answer, hidden data not leaked', exec, async () => {
  const wrong = C_OK.replace('a+b', 'a*b')
  const r = await submit(deps(), 'c', wrong)
  assert.equal(r.body.verdict, 'wrong_answer'); assert.equal(r.body.passed, 0)
  const j = JSON.stringify(r)
  for (const s of ['7731', '2213', '9944']) assert.ok(!j.includes(s), `${s} leaked to the student response`)
})
test('C compilation error', exec, async () => {
  const d = deps(); const r = await submit(d, 'c', 'int main(){ return 0 }')
  assert.equal(r.body.verdict, 'compilation_error'); assert.ok(String(r.body.message).length > 0)
})
test('Python syntax error and exception -> runtime error', exec, async () => {
  assert.equal((await submit(deps(), 'python', 'print(')).body.verdict, 'runtime_error')
  assert.equal((await submit(deps(), 'python', 'raise ValueError("x")')).body.verdict, 'runtime_error')
})
test('C segfault -> runtime error', exec, async () =>
  assert.equal((await submit(deps(), 'c', 'int main(){int*p=0;*p=1;return 0;}')).body.verdict, 'runtime_error'))
test('infinite loop -> time limit exceeded', exec, async () => {
  const f = fakeDb({ beginSubmission: async () => ({ id: 's', time_limit_ms: 400, memory_limit_kb: 1 }) })
  assert.equal((await submit(deps(f), 'python', 'while True: pass')).body.verdict, 'time_limit_exceeded')
})
test('not configured -> clear setup reply, nothing executed or recorded', async () => {
  const f = fakeDb(); let began = false; f.db.beginSubmission = async () => { began = true; throw new Error('x') }
  const r = await handleSubmit({ adapter: null, db: f.db }, 'u1', { question_id: '11111111-1111-4111-8111-111111111111', language: 'c', source: C_OK })
  assert.equal(r.body.code, 'not_configured'); assert.equal(began, false)
  assert.equal((await handleRun({ adapter: null, db: f.db }, 'u1', { question_id: '11111111-1111-4111-8111-111111111111', language: 'c', source: C_OK })).body.code, 'not_configured')
})
test('database gate errors map to friendly replies', async () => {
  for (const [code, msg] of [['cooldown', 'wait'], ['locked', 'locked'], ['language_not_allowed', 'language'], ['too_large', 'large']]) {
    const f = fakeDb({ beginSubmission: async () => { throw new Error(code) } })
    const r = await submit(deps(f), 'c', C_OK)
    assert.equal(r.body.code, code); assert.match(String(r.body.message), new RegExp(msg, 'i'))
  }
})
test('validation: bad language, oversize source', async () => {
  assert.equal((await submit(deps(), 'java', 'x')).body.code, 'bad_request')
  assert.equal((await submit(deps(), 'c', 'x'.repeat(65537))).body.code, 'too_large')
})
test('no test cases -> recorded as judge error, no fake pass', async () => {
  const d = deps(fakeDb({ tests: [] })); const r = await submit(d, 'c', C_OK)
  assert.equal(r.body.code, 'no_tests'); assert.equal(d.finished[0].verdict, 'internal_error')
})
test('adapter failure -> judge_unavailable, recorded as internal_error', async () => {
  const f = fakeDb(); const d: Deps & { finished: any[] } = { adapter: { runBatch: async () => { throw new Error('judge_timeout') } }, db: f.db, finished: f.finished }
  const r = await submit(d, 'c', C_OK); assert.equal(r.body.code, 'judge_unavailable'); assert.equal(f.finished[0].verdict, 'internal_error')
})
test('run: custom stdin, no submission recorded; rate limit; disallowed language', exec, async () => {
  const f = fakeDb(); const d = deps(f)
  const r = await handleRun(d, 'u1', { question_id: '11111111-1111-4111-8111-111111111111', language: 'python', source: 'print(input()[::-1])', stdin: 'abc' })
  assert.equal(r.body.stdout, 'cba\n'); assert.equal(r.body.outcome, 'ok'); assert.equal(f.finished.length, 0)
  f.db.touchRun = async () => false
  assert.equal((await handleRun(d, 'u1', { question_id: '11111111-1111-4111-8111-111111111111', language: 'python', source: 'x', stdin: '' })).body.code, 'rate_limited')
  assert.equal((await handleRun(deps(fakeDb({ langs: ['python'] })), 'u1', { question_id: '11111111-1111-4111-8111-111111111111', language: 'c', source: 'x', stdin: '' })).body.code, 'language_not_allowed')
  const ce = await handleRun(deps(), 'u1', { question_id: '11111111-1111-4111-8111-111111111111', language: 'c', source: 'int main(){', stdin: '' })
  assert.equal(ce.body.outcome, 'compile_error'); assert.ok(String(ce.body.compile_output).length > 0)
})

test('unexpected failure after begin: submission is finished as internal_error, not left queued', async () => {
  const f = fakeDb({ getTests: async () => { throw new Error('db down') } }); const d = deps(f)
  const r = await submit(d, 'c', C_OK)
  assert.equal(r.body.code, 'internal'); assert.equal(f.finished[0].verdict, 'internal_error')
})

test('C infinite loop -> time limit exceeded', exec, async () => {
  const f = fakeDb({ beginSubmission: async () => ({ id: 's', time_limit_ms: 500, memory_limit_kb: 1 }) })
  assert.equal((await submit(deps(f), 'c', 'int main(void){ for(;;){} return 0; }')).body.verdict, 'time_limit_exceeded')
})
test('C compilation error returns meaningful compiler output and no test details', exec, async () => {
  const r = await submit(deps(), 'c', '#include <stdio.h>\nint main(){ printf("x") return 0; }')
  assert.equal(r.body.verdict, 'compilation_error'); assert.match(String(r.body.message), /error/i)
  assert.equal((r.body.results as any[]).every(t => t.input === undefined || t.hidden === false), true)
})
test('C runtime error: non-zero exit status', exec, async () =>
  assert.equal((await submit(deps(), 'c', 'int main(void){ return 7; }')).body.verdict, 'runtime_error'))

test('deadline / pause / account errors from the database get clear, distinct replies (not judge errors)', async () => {
  for (const [code, re] of [['closed', /closed/i], ['submissions_closed', /paused/i], ['disabled', /disabled/i], ['event_ended', /ended/i], ['event_not_started', /not started/i]] as const) {
    const f = fakeDb({ beginSubmission: async () => { throw new Error(code) } })
    const r = await submit(deps(f), 'c', C_OK); assert.equal(r.body.code, code); assert.match(String(r.body.message), re)
    const run = await handleRun(deps(fakeDb({ checkAccess: async () => { throw new Error(code) } })), 'u1', { question_id: Q, language: 'c', source: 'x', stdin: '' })
    assert.equal(run.body.code, code)
  }
})
test('question_id must be a UUID (rejected before any database or judge work)', async () => {
  let began = false; const f = fakeDb({ beginSubmission: async () => { began = true; return { id: 's', time_limit_ms: 1, memory_limit_kb: 1 } } })
  for (const bad of ['q1', '', "1'; drop table submissions;--", '123']) assert.equal((await handleSubmit(deps(f), 'u1', { question_id: bad, language: 'c', source: C_OK })).body.code, 'bad_request')
  assert.equal(began, false)
})
test('judge failures are logged to the event log, distinct from verdicts, and never include secrets', async () => {
  const events: any[] = []; const f = fakeDb({ logEvent: async e => { events.push(e) } })
  const d: Deps & { finished: any[] } = { adapter: { runBatch: async () => { throw new Error('judge_http_500') } }, db: f.db, finished: f.finished }
  const r = await submit(d, 'c', C_OK)
  assert.equal(r.body.code, 'judge_unavailable'); assert.equal(r.body.verdict, undefined, 'a judge fault is not a verdict')
  assert.equal(f.finished[0].verdict, 'internal_error'); assert.deepEqual(events.map(e => [e.kind, e.code, e.detail]), [['submit', 'judge_unavailable', 'judge_http_500']])
  const throwingLog = fakeDb({ logEvent: async () => { throw new Error('log down') } })   // logging failures must not break judging
  assert.equal((await submit({ adapter: d.adapter, db: throwingLog.db, finished: [] }, 'c', C_OK)).body.code, 'judge_unavailable')
})
