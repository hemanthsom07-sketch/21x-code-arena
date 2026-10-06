import test from 'node:test'
import assert from 'node:assert/strict'
import { PistonAdapter, pistonConfigFromEnv, mapResult, type PistonConfig } from '../supabase/functions/_shared/piston.ts'
import { adapterFromEnv } from '../supabase/functions/_shared/engine.ts'
import { Judge0Adapter } from '../supabase/functions/_shared/adapter.ts'
import type { ExecJob } from '../supabase/functions/_shared/adapter.ts'
import { handleSubmit, type Db, type TestCase } from '../supabase/functions/_shared/core.ts'
import { startMockPiston } from './helpers/mockPiston.ts'
import { toolchainProblem } from './helpers/localAdapter.ts'

const env = (o: Record<string, string>) => (k: string) => o[k]
const job = (over: Partial<ExecJob> = {}): ExecJob => ({ language: 'c', source: 'SRC', stdin: 'IN', timeLimitMs: 2000, memoryLimitKb: 64000, ...over })
const cfg = (f: typeof fetch, over: Partial<PistonConfig> = {}): PistonConfig => ({ baseUrl: 'http://p.test', headers: { 'X-Judge-Token': 'TOK' },
  langs: { c: { language: 'c', version: '*' }, python: { language: 'python', version: '*' } }, concurrency: 4, compileTimeoutMs: 10000, requestTimeoutMs: 5000, maxRunTimeoutMs: 10000, fetchImpl: f, ...over })
const reply = (body: any, status = 200, delay = 0) => (async () => { if (delay) await new Promise(r => setTimeout(r, delay)); return { ok: status < 300, status, json: async () => body } }) as any
const okRun = { language: 'c', run: { stdout: 'out', stderr: '', code: 0, signal: null } }

test('config: unset => null; strips /api/v2; token header; bad JSON throws; defaults', () => {
  assert.equal(pistonConfigFromEnv(env({})), null)
  const c = pistonConfigFromEnv(env({ PISTON_URL: 'https://x.io/api/v2/', PISTON_TOKEN: 't1', PISTON_HEADERS: '{"A":"b"}' }))!
  assert.equal(c.baseUrl, 'https://x.io'); assert.deepEqual(c.headers, { A: 'b', 'X-Judge-Token': 't1' })
  assert.equal(c.concurrency, 4); assert.deepEqual(c.langs.python, { language: 'python', version: '*' })
  assert.throws(() => pistonConfigFromEnv(env({ PISTON_URL: 'http://x', PISTON_HEADERS: '{bad' })))
})
test('engine selection', () => {
  assert.equal(adapterFromEnv(env({})), null)
  assert.ok(adapterFromEnv(env({ PISTON_URL: 'http://x' })) instanceof PistonAdapter)
  assert.ok(adapterFromEnv(env({ JUDGE0_URL: 'http://x' })) instanceof Judge0Adapter)
  assert.ok(adapterFromEnv(env({ PISTON_URL: 'http://x', JUDGE0_URL: 'http://y' })) instanceof PistonAdapter, 'piston wins when both set')
  assert.ok(adapterFromEnv(env({ PISTON_URL: 'http://x', JUDGE0_URL: 'http://y', JUDGE_ENGINE: 'judge0' })) instanceof Judge0Adapter)
  assert.equal(adapterFromEnv(env({ JUDGE_ENGINE: 'piston' })), null)
})
test('request payload follows the Piston API (bytes, ms, file, stdin, auth header)', async () => {
  const calls: any[] = []
  const f = (async (url: string, init: any) => { calls.push({ url, init, body: JSON.parse(init.body) }); return { ok: true, status: 200, json: async () => okRun } }) as any
  await new PistonAdapter(cfg(f)).runBatch([job(), job({ language: 'python', memoryLimitKb: 0 })])
  assert.equal(calls[0].url, 'http://p.test/api/v2/execute'); assert.equal(calls[0].init.headers['X-Judge-Token'], 'TOK')
  const [b0, b1] = calls.map(c => c.body)
  assert.equal(b0.language, 'c'); assert.equal(b0.version, '*'); assert.equal(b0.files[0].name, 'main.c'); assert.equal(b0.files[0].content, 'SRC')
  assert.equal(b0.stdin, 'IN'); assert.equal(b0.run_timeout, 2000); assert.equal(b0.run_memory_limit, 64000 * 1024); assert.equal(b0.compile_timeout, 10000)
  assert.equal(b1.files[0].name, 'main.py'); assert.equal(b1.run_memory_limit, -1)
})
test('response mapping', () => {
  const j = job()
  assert.equal(mapResult(j, okRun, 10).outcome, 'ok')
  const ce = mapResult(j, { compile: { output: 'bad code', code: 1, signal: null } }, 10)
  assert.equal(ce.outcome, 'compile_error'); assert.equal(ce.compileOutput, 'bad code')
  assert.equal(mapResult(j, { run: { stdout: '', stderr: 'Traceback', code: 1, signal: null } }, 10).outcome, 'runtime_error')
  assert.equal(mapResult(j, { run: { code: null, signal: 'SIGKILL', status: 'TO' } }, 10).outcome, 'time_limit')
  assert.equal(mapResult(j, { run: { code: null, signal: 'SIGKILL' } }, 2500).outcome, 'time_limit', 'SIGKILL after the limit => TLE')
  const mle = mapResult(j, { run: { stdout: '', stderr: '', code: null, signal: 'SIGKILL' } }, 100)
  assert.equal(mle.outcome, 'runtime_error'); assert.match(mle.stderr, /memory limit/)
  assert.equal(mapResult(j, { run: { code: 139, signal: null, status: 'XX', message: 'boom' } }, 1).outcome, 'internal_error')
  assert.match(mapResult(j, { run: { code: 1, signal: null, status: 'OL' } }, 1).stderr, /Output limit/)
  const m = mapResult(j, { run: { stdout: 'x', code: 0, signal: null, cpu_time: 12, wall_time: 30, memory: 2048000 } }, 1)
  assert.equal(m.timeMs, 12); assert.equal(m.memoryKb, 2000)
  assert.equal(mapResult(j, {}, 1).outcome, 'internal_error')
})
test('slow SIGKILL heuristic via the adapter (elapsed time measured)', async () => {
  const f = reply({ run: { code: null, signal: 'SIGKILL', stdout: '', stderr: '' } }, 200, 80)
  assert.equal((await new PistonAdapter(cfg(f)).runBatch([job({ timeLimitMs: 50 })]))[0].outcome, 'time_limit')
})
test('concurrency cap honoured, results keep request order', async () => {
  let inflight = 0, peak = 0
  const f = (async (_u: string, init: any) => { inflight++; peak = Math.max(peak, inflight); await new Promise(r => setTimeout(r, 15)); inflight--
    return { ok: true, status: 200, json: async () => ({ run: { stdout: JSON.parse(init.body).stdin, code: 0, signal: null } }) } }) as any
  const jobs = Array.from({ length: 12 }, (_, i) => job({ stdin: 'n' + i }))
  const out = await new PistonAdapter(cfg(f, { concurrency: 3 })).runBatch(jobs)
  assert.equal(peak, 3); assert.deepEqual(out.map(o => o.stdout), jobs.map(j => j.stdin))
})
test('errors: 429, 400 with message, unreachable, timeout; secrets never in messages', async () => {
  await assert.rejects(new PistonAdapter(cfg(reply({}, 429))).runBatch([job()]), /judge_rate_limited/)
  await assert.rejects(new PistonAdapter(cfg(reply({ message: 'run_timeout exceeds max' }, 400))).runBatch([job()]), /judge_http_400: run_timeout exceeds max/)
  const boom = (async () => { throw new TypeError('fetch failed http://p.test TOK') }) as any
  await assert.rejects(new PistonAdapter(cfg(boom)).runBatch([job()]), (e: Error) => e.message === 'judge_unreachable')
  const abort = (async () => { const e = new Error('x'); e.name = 'TimeoutError'; throw e }) as any
  await assert.rejects(new PistonAdapter(cfg(abort)).runBatch([job()]), (e: Error) => e.message === 'judge_timeout')
})

// ---- End-to-end over real HTTP against the protocol-level mock (real compile/run, NO isolation; see helper header)
const TESTS: TestCase[] = [{ input: '2 3\n', expected_output: '5\n', is_hidden: false }, { input: '7731 2213\n', expected_output: '9944\n', is_hidden: true }]
function db(limitMs = 3000) {
  const finished: any[] = []
  const d: Db = { touchRun: async () => true, checkAccess: async () => ({ languages: ['c', 'python'], time_limit_ms: limitMs, memory_limit_kb: 128000 }),
    beginSubmission: async () => ({ id: 's1', time_limit_ms: limitMs, memory_limit_kb: 128000 }), getTests: async () => TESTS, finishSubmission: async (_i, r) => { finished.push(r) } }
  return { d, finished }
}
const C_OK = '#include <stdio.h>\nint main(){int a,b;scanf("%d %d",&a,&b);printf("%d\\n",a+b);return 0;}'
for (const withStatus of [false, true]) test(`Piston adapter -> HTTP -> mock Piston -> verdicts (status field ${withStatus ? 'present' : 'absent'})`, { skip: toolchainProblem() ?? false }, async () => {
  const mock = await startMockPiston({ withStatus, token: 'TOK' })
  try {
    const mk = (limit?: number) => { const x = db(limit); return { ...x, deps: { adapter: new PistonAdapter(cfg(undefined as any, { baseUrl: mock.url, fetchImpl: undefined, concurrency: 2, requestTimeoutMs: 60000 })), db: x.d } } }
    const run = (m: ReturnType<typeof mk>, language: string, source: string) => handleSubmit(m.deps, 'u', { question_id: '11111111-1111-4111-8111-111111111111', language, source })
    assert.equal((await run(mk(), 'c', C_OK)).body.verdict, 'accepted')
    assert.equal((await run(mk(), 'python', 'a,b=map(int,input().split())\nprint(a+b)')).body.verdict, 'accepted')
    const wa = await run(mk(), 'c', C_OK.replace('a+b', 'a*b')); assert.equal(wa.body.verdict, 'wrong_answer')
    for (const s of ['7731', '2213', '9944']) assert.ok(!JSON.stringify(wa).includes(s), `${s} leaked`)
    assert.equal((await run(mk(), 'c', 'int main(){ return 0 }')).body.verdict, 'compilation_error')
    assert.equal((await run(mk(), 'python', 'raise SystemExit(3)')).body.verdict, 'runtime_error')
    assert.equal((await run(mk(400), 'python', 'while True: pass')).body.verdict, 'time_limit_exceeded')
    assert.ok(mock.requests.every(r => r.run_memory_limit === 128000 * 1024 && r.files.length === 1))
  } finally { await mock.close() }
})
test('wrong auth token against the proxy => judge_unavailable, recorded as judge error', async () => {
  const mock = await startMockPiston({ token: 'RIGHT' })
  try {
    const x = db(); const adapter = new PistonAdapter(cfg(undefined as any, { baseUrl: mock.url, fetchImpl: undefined, headers: { 'X-Judge-Token': 'WRONG' }, requestTimeoutMs: 60000 }))
    const r = await handleSubmit({ adapter, db: x.d }, 'u', { question_id: '11111111-1111-4111-8111-111111111111', language: 'c', source: C_OK })
    assert.equal(r.body.code, 'judge_unavailable'); assert.equal(x.finished[0].verdict, 'internal_error')
  } finally { await mock.close() }
})

test('run_timeout is clamped to the Piston server maximum (an unclamped value would make Piston answer 400 for every submission)', async () => {
  const calls: any[] = []
  const f = (async (_u: string, init: any) => { calls.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => okRun } }) as any
  await new PistonAdapter(cfg(f, { maxRunTimeoutMs: 10000 })).runBatch([job({ timeLimitMs: 30000 }), job({ timeLimitMs: 2000 })])
  assert.deepEqual(calls.map(c => c.run_timeout), [10000, 2000])
  assert.equal(pistonConfigFromEnv(env({ PISTON_URL: 'http://x' }))!.maxRunTimeoutMs, 10000)
  assert.equal(pistonConfigFromEnv(env({ PISTON_URL: 'http://x', PISTON_MAX_RUN_TIMEOUT_MS: '3000' }))!.maxRunTimeoutMs, 3000)
})
