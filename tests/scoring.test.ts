import test from 'node:test'
import assert from 'node:assert/strict'
import { rankStandings, penaltyMinutes, isPenalized, type Facts } from '../supabase/functions/_shared/scoring.ts'

const f = (id: string, name: string, points: number, elapsed: number, wrong: number, last: string, solved = 1): Facts =>
  ({ user_id: id, full_name: name, department: 'CSE', roll_number: id.toUpperCase(), solved, points, elapsed_minutes: elapsed, wrong_count: wrong, last_accept: last })

test('penalised verdicts: wrong answer, runtime error, TLE; never compile errors or judge faults', () => {
  for (const v of ['wrong_answer', 'runtime_error', 'time_limit_exceeded']) assert.equal(isPenalized(v), true, v)
  for (const v of ['accepted', 'compilation_error', 'internal_error', null]) assert.equal(isPenalized(v), false, String(v))
})
test('penalty = elapsed minutes + wrong attempts x configured minutes', () => {
  assert.equal(penaltyMinutes({ elapsed_minutes: 25, wrong_count: 3 }, 10), 55)
  assert.equal(penaltyMinutes({ elapsed_minutes: 25, wrong_count: 3 }, 0), 25)
})
test('more points ranks first regardless of penalty', () => {
  const r = rankStandings([f('a', 'A', 100, 5, 0, '2026-10-05T10:05:00Z'), f('b', 'B', 300, 500, 9, '2026-10-05T12:00:00Z')], 10)
  assert.deepEqual(r.map(x => x.user_id), ['b', 'a']); assert.deepEqual(r.map(x => x.rank), [1, 2])
})
test('equal points: lower penalty wins; wrong attempts matter', () => {
  const r = rankStandings([f('a', 'A', 200, 30, 0, '2026-10-05T10:30:00Z'), f('b', 'B', 200, 20, 2, '2026-10-05T10:20:00Z')], 10)  // a=30, b=40
  assert.deepEqual(r.map(x => [x.user_id, x.penalty_minutes]), [['a', 30], ['b', 40]])
})
test('equal points and penalty: earlier last acceptance wins, and they do NOT share a rank', () => {
  const r = rankStandings([f('a', 'A', 100, 10, 0, '2026-10-05T10:10:00Z'), f('b', 'B', 100, 10, 0, '2026-10-05T10:09:00Z')], 10)
  assert.deepEqual(r.map(x => [x.user_id, x.rank]), [['b', 1], ['a', 2]])
})
test('exact ties share a rank (1,2,2,4) and are ordered deterministically by name then id', () => {
  const same = '2026-10-05T10:00:00Z'
  const r = rankStandings([f('d', 'Zed', 50, 9, 0, '2026-10-05T11:00:00Z'), f('c', 'Cara', 100, 10, 0, same), f('b', 'Bob', 100, 10, 0, same), f('a', 'Top', 500, 1, 0, same)], 10)
  assert.deepEqual(r.map(x => [x.full_name, x.rank]), [['Top', 1], ['Bob', 2], ['Cara', 2], ['Zed', 4]])
})
test('participants with no scoring solve are not ranked; empty input is fine', () => {
  assert.deepEqual(rankStandings([], 10), [])
  assert.equal(rankStandings([f('a', 'A', 0, 0, 5, '2026-10-05T10:00:00Z', 0)], 10).length, 0)
})
test('ranking does not mutate its input and handles a null name', () => {
  const input = [f('b', 'B', 10, 1, 0, '2026-10-05T10:00:00Z'), { ...f('a', 'A', 10, 1, 0, '2026-10-05T10:00:00Z'), full_name: null }]
  const copy = JSON.stringify(input); const r = rankStandings(input, 10)
  assert.equal(JSON.stringify(input), copy); assert.equal(r.length, 2)
})
