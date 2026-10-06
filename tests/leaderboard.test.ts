import test from 'node:test'
import assert from 'node:assert/strict'
import { handleLeaderboard, type LbDb, type LbCache } from '../supabase/functions/_shared/leaderboard.ts'
import type { Facts } from '../supabase/functions/_shared/scoring.ts'

const fact = (id: string, name: string, points: number, wrong = 0): Facts => ({ user_id: id, full_name: name, department: 'CSE', roll_number: 'ROLL-' + id, solved: 1, points, elapsed_minutes: 10, wrong_count: wrong, last_accept: '2026-10-05T10:00:00Z' })
function setup(over: { profiles?: Record<string, any>; cfg?: any; facts?: Facts[] } = {}) {
  const calls = { facts: 0 }
  const profiles = over.profiles ?? { s1: { role: 'student', is_active: true }, s2: { role: 'student', is_active: true }, adm: { role: 'admin', is_active: true }, off: { role: 'student', is_active: false } }
  const db: LbDb = { getProfile: async uid => profiles[uid] ?? null, getConfig: async () => over.cfg ?? { wrong_penalty_minutes: 10, leaderboard_public: true },
    standingsFacts: async () => { calls.facts++; return over.facts ?? [fact('s1', 'Asha', 200), fact('s2', 'Ben', 100, 1), fact('s3', 'Cy', 50)] } }
  let t = 1_000_000; const cache: LbCache = new Map()
  return { calls, deps: { db, cache, now: () => t, cacheTtlMs: 10_000 }, tick: (ms: number) => { t += ms } }
}

test('student sees ranked rows with names, but never roll numbers, emails or user ids', async () => {
  const { deps } = setup(); const r = await handleLeaderboard(deps, 's2', {})
  assert.equal(r.body.ok, true); const rows = r.body.rows as any[]
  assert.deepEqual(rows.map(x => [x.rank, x.name]), [[1, 'Asha'], [2, 'Ben'], [3, 'Cy']])
  const j = JSON.stringify(r.body); assert.ok(!j.includes('ROLL-') && !j.includes('roll_number') && !j.includes('user_id') && !j.includes('email'))
  assert.equal(rows.find(x => x.is_me).name, 'Ben'); assert.equal((r.body.me as any).rank, 2)
})
test('a student outside the top N still gets their own standing in `me`', async () => {
  const { deps } = setup({ facts: Array.from({ length: 30 }, (_, i) => fact('u' + i, 'N' + i, 1000 - i)).concat([fact('s1', 'Me', 1)]) })
  const r = await handleLeaderboard(deps, 's1', { limit: 5 })
  assert.equal((r.body.rows as any[]).length, 5); assert.equal((r.body.me as any).rank, 31); assert.equal(r.body.total_ranked, 31)
})
test('admin rows include roll numbers; export is admin-only and returns everyone', async () => {
  const { deps } = setup()
  const a = await handleLeaderboard(deps, 'adm', {}); assert.equal((a.body.rows as any[])[0].roll_number, 'ROLL-s1')
  assert.equal((await handleLeaderboard(deps, 's1', { export: true })).body.code, 'forbidden')
  const e = await handleLeaderboard(deps, 'adm', { export: true, limit: 1 }); assert.equal((e.body.rows as any[]).length, 3)
})
test('access control: unknown user, disabled student, hidden leaderboard', async () => {
  const { deps } = setup()
  assert.equal((await handleLeaderboard(deps, 'ghost', {})).body.code, 'forbidden')
  assert.equal((await handleLeaderboard(deps, 'off', {})).body.code, 'disabled')
  const hidden = setup({ cfg: { wrong_penalty_minutes: 10, leaderboard_public: false } })
  assert.equal((await handleLeaderboard(hidden.deps, 's1', {})).body.code, 'hidden')
  assert.equal((await handleLeaderboard(hidden.deps, 'adm', {})).body.ok, true, 'admins still see it')
})
test('request validation: bad challenge id rejected, limit clamped', async () => {
  const { deps } = setup()
  assert.equal((await handleLeaderboard(deps, 's1', { challenge_id: "x'; drop" })).body.code, 'bad_request')
  assert.equal((await handleLeaderboard(deps, 's1', { challenge_id: '11111111-1111-4111-8111-111111111111', limit: 99999 })).body.ok, true)
})
test('cache: repeated requests within the TTL cost one database aggregation; expiry refreshes; configured penalty applies', async () => {
  const { deps, calls, tick } = setup()
  await handleLeaderboard(deps, 's1', {}); await handleLeaderboard(deps, 's2', {}); await handleLeaderboard(deps, 'adm', {})
  assert.equal(calls.facts, 1); tick(10_001); await handleLeaderboard(deps, 's1', {}); assert.equal(calls.facts, 2)
  const r = await handleLeaderboard(setup({ cfg: { wrong_penalty_minutes: 30, leaderboard_public: true } }).deps, 's2', {})
  assert.equal((r.body.me as any).penalty_minutes, 40)   // elapsed 10 + 1 wrong x 30
})
