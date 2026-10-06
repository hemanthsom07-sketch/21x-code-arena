import test from 'node:test'
import assert from 'node:assert/strict'
import { Judge0Adapter, judge0ConfigFromEnv, type ExecJob } from '../supabase/functions/_shared/adapter.ts'

const b = (s: string) => Buffer.from(s).toString('base64')
const job = (n = 1): ExecJob[] => Array.from({ length: n }, (_, i) => ({ language: i % 2 ? 'python' : 'c', source: 'src' + i, stdin: 'in' + i, timeLimitMs: 2000, memoryLimitKb: 64000 }))
function mockFetch(handler: (url: string, init: RequestInit) => any) {
  const calls: { url: string; init: RequestInit }[] = []
  const f = (async (url: string, init: RequestInit) => { calls.push({ url, init }); const r = handler(url, init); return { ok: r.ok ?? true, status: r.status ?? 200, json: async () => r.body } }) as unknown as typeof fetch
  return { f, calls }
}
const cfg = (f: typeof fetch) => ({ baseUrl: 'https://j0.test', headers: { 'X-Auth-Token': 'SECRET' }, langIds: { c: 50, python: 71 }, pollIntervalMs: 1, timeoutMs: 500, fetchImpl: f })

test('config: unset => null (setup message); headers JSON; bad JSON throws', () => {
  assert.equal(judge0ConfigFromEnv(() => undefined), null)
  const c = judge0ConfigFromEnv(k => ({ JUDGE0_URL: 'https://x.io/', JUDGE0_HEADERS: '{"X-Auth-Token":"t"}' } as any)[k])!
  assert.equal(c.baseUrl, 'https://x.io'); assert.equal(c.headers['X-Auth-Token'], 't'); assert.deepEqual(c.langIds, { c: 50, python: 71 })
  assert.throws(() => judge0ConfigFromEnv(k => ({ JUDGE0_URL: 'https://x', JUDGE0_HEADERS: '{bad' } as any)[k]))
})
test('sends base64 payload + auth headers, polls until done, maps statuses', async () => {
  let polls = 0
  const { f, calls } = mockFetch((url, init) => {
    if (init.method === 'POST') return { body: [{ token: 'a' }, { token: 'b' }, { token: 'c' }, { token: 'd' }] }
    polls++
    const st = (id: number) => polls < 2 ? { id: 2 } : { id }
    return { body: { submissions: [
      { token: 'd', status: st(11), stderr: b('boom'), time: '0.01', memory: 900 },
      { token: 'a', status: st(3), stdout: b('héllo\n'), time: '0.123', memory: 1024 },
      { token: 'b', status: st(5) }, { token: 'c', status: st(6), compile_output: b('error: x') }] } }
  })
  const out = await new Judge0Adapter(cfg(f)).runBatch(job(4))
  assert.ok(polls >= 2, 'should poll while processing')
  const post = calls[0]; const body = JSON.parse(post.init.body as string)
  assert.equal((post.init.headers as any)['X-Auth-Token'], 'SECRET')
  assert.equal(body.submissions[0].language_id, 50); assert.equal(body.submissions[1].language_id, 71)
  assert.equal(Buffer.from(body.submissions[0].source_code, 'base64').toString(), 'src0')
  assert.equal(body.submissions[0].cpu_time_limit, 2); assert.equal(body.submissions[0].memory_limit, 64000)
  assert.deepEqual(out.map(o => o.outcome), ['ok', 'time_limit', 'compile_error', 'runtime_error'], 'results in request order')
  assert.equal(out[0].stdout, 'héllo\n'); assert.equal(out[0].timeMs, 123); assert.equal(out[2].compileOutput, 'error: x'); assert.equal(out[3].stderr, 'boom')
})
test('chunks batches of >20 jobs', async () => {
  let posts = 0
  const { f } = mockFetch((_u, init) => {
    if (init.method === 'POST') { posts++; const n = JSON.parse(init.body as string).submissions.length; return { body: Array.from({ length: n }, (_, i) => ({ token: `t${posts}_${i}` })) } }
    const toks = new URL(_u).searchParams.get('tokens')!.split(',')
    return { body: { submissions: toks.map(t => ({ token: t, status: { id: 3 }, stdout: b('') })) } }
  })
  assert.equal((await new Judge0Adapter(cfg(f)).runBatch(job(45))).length, 45); assert.equal(posts, 3)
})
test('errors: 429, http failure, timeout never leak secrets', async () => {
  await assert.rejects(new Judge0Adapter(cfg(mockFetch(() => ({ ok: false, status: 429 })).f)).runBatch(job()), /judge_rate_limited/)
  await assert.rejects(new Judge0Adapter(cfg(mockFetch(() => ({ ok: false, status: 500, body: 'SECRET' })).f)).runBatch(job()), (e: Error) => e.message === 'judge_http_500')
  const stuck = mockFetch((_u, init) => init.method === 'POST' ? { body: [{ token: 'a' }] } : { body: { submissions: [{ token: 'a', status: { id: 2 } }] } })
  await assert.rejects(new Judge0Adapter(cfg(stuck.f)).runBatch(job()), /judge_timeout/)
})
