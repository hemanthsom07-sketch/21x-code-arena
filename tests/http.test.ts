import test from 'node:test'
import assert from 'node:assert/strict'
import { bearerToken, corsHeaders, readJsonLimited, UUID_RE } from '../supabase/functions/_shared/http.ts'

const h = (v: string | null) => ({ get: (n: string) => (n === 'Authorization' ? v : null) })
test('bearerToken: accepts a bearer token only', () => {
  assert.equal(bearerToken(h('Bearer abc.def.ghi')), 'abc.def.ghi'); assert.equal(bearerToken(h('bearer abc')), 'abc')
  for (const bad of [null, '', 'Bearer', 'Bearer ', 'Basic abc', 'abc', 'Bearer a b', 'Bearer ' + 'x'.repeat(5000)]) assert.equal(bearerToken(h(bad)), null, String(bad).slice(0, 20))
})
test('CORS: wildcard by default; allow-list echoes only listed origins', () => {
  assert.equal(corsHeaders('https://x.io', undefined)['Access-Control-Allow-Origin'], '*')
  const a = 'https://arena.example.com,https://admin.example.com'
  assert.equal(corsHeaders('https://arena.example.com', a)['Access-Control-Allow-Origin'], 'https://arena.example.com')
  assert.equal(corsHeaders('https://evil.example', a)['Access-Control-Allow-Origin'], undefined)
  assert.equal(corsHeaders(null, a)['Access-Control-Allow-Origin'], undefined)
})
test('readJsonLimited: parses, rejects oversize (declared and actual) and bad JSON', async () => {
  const mk = (body: string, headers: Record<string, string> = {}) => new Request('http://x/', { method: 'POST', body, headers })
  assert.deepEqual(await readJsonLimited(mk('{"a":1}')), { ok: true, body: { a: 1 } })
  assert.deepEqual(await readJsonLimited(mk('')), { ok: true, body: null })
  assert.deepEqual(await readJsonLimited(mk('{bad')), { ok: false, reason: 'invalid_json' })
  assert.deepEqual(await readJsonLimited(mk('x'.repeat(100)), 50), { ok: false, reason: 'too_large' })
  assert.deepEqual(await readJsonLimited(mk('{}', { 'content-length': '999999999' })), { ok: false, reason: 'too_large' })
})
test('UUID_RE', () => { assert.ok(UUID_RE.test('11111111-1111-4111-8111-111111111111')); for (const b of ['q', '', '1111', "x'; drop table"]) assert.ok(!UUID_RE.test(b)) })
