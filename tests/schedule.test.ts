import test from 'node:test'
import assert from 'node:assert/strict'
import { challengeState, submissionBlock } from '../src/lib/challengeState.ts'
import { validateQuestion, validateTestCase, validateChallenge, validateEvent, validateAnnouncement } from '../src/lib/validation.ts'

const NOW = Date.parse('2026-10-05T12:00:00Z'); const iso = (m: number) => new Date(NOW + m * 60000).toISOString()
const ch = (o: Partial<{ is_unlocked: boolean; unlock_at: string | null; closes_at: string | null }> = {}) => ({ is_unlocked: false, unlock_at: null, closes_at: null, ...o })
const ev = (o: any = {}) => ({ starts_at: null, ends_at: null, submissions_open: true, ...o })

test('challenge states: locked, upcoming, open (manual or scheduled), closed', () => {
  assert.equal(challengeState(ch(), NOW), 'locked'); assert.equal(challengeState(ch({ unlock_at: iso(30) }), NOW), 'upcoming')
  assert.equal(challengeState(ch({ unlock_at: iso(-1) }), NOW), 'open'); assert.equal(challengeState(ch({ is_unlocked: true }), NOW), 'open')
  assert.equal(challengeState(ch({ unlock_at: iso(-60), closes_at: iso(60) }), NOW), 'open')
  assert.equal(challengeState(ch({ unlock_at: iso(-60), closes_at: iso(-1) }), NOW), 'closed'); assert.equal(challengeState(ch({ is_unlocked: true, closes_at: iso(-1) }), NOW), 'closed')
  assert.equal(challengeState(ch({ unlock_at: iso(0) }), NOW), 'open', 'boundary: release time reached')
  assert.equal(challengeState(ch({ is_unlocked: true, closes_at: iso(0) }), NOW), 'closed', 'boundary: closing time reached')
})
test('submission blocking mirrors the database order: release, deadline, event window, pause', () => {
  const open = ch({ is_unlocked: true })
  assert.equal(submissionBlock(open, ev(), NOW), null)
  assert.match(submissionBlock(ch(), ev(), NOW)!, /not been released/); assert.match(submissionBlock(ch({ unlock_at: iso(5) }), ev(), NOW)!, /not been released/)
  assert.match(submissionBlock(ch({ is_unlocked: true, closes_at: iso(-1) }), ev(), NOW)!, /closed/)
  assert.match(submissionBlock(open, ev({ starts_at: iso(10) }), NOW)!, /not started/); assert.match(submissionBlock(open, ev({ ends_at: iso(-10) }), NOW)!, /ended/)
  assert.match(submissionBlock(open, ev({ submissions_open: false }), NOW)!, /paused/)
  assert.match(submissionBlock(ch({ is_unlocked: true, closes_at: iso(-1) }), ev({ submissions_open: false }), NOW)!, /closed/, 'deadline reported before pause')
})
test('question validation matches the database limits', () => {
  const ok = { title: 'Sum', statement: 'Add.', points: 100, time_limit_ms: 2000, memory_limit_kb: 128000, languages: ['c', 'python'], difficulty: 'easy' }
  assert.deepEqual(validateQuestion(ok), [])
  assert.ok(validateQuestion({ ...ok, points: 0 }).length); assert.ok(validateQuestion({ ...ok, points: 10001 }).length); assert.ok(validateQuestion({ ...ok, points: 1.5 }).length)
  assert.ok(validateQuestion({ ...ok, time_limit_ms: 99 }).length); assert.ok(validateQuestion({ ...ok, time_limit_ms: 10001 }).length)
  assert.ok(validateQuestion({ ...ok, memory_limit_kb: 1000 }).length); assert.ok(validateQuestion({ ...ok, languages: [] }).length); assert.ok(validateQuestion({ ...ok, languages: ['java'] }).length)
  assert.ok(validateQuestion({ ...ok, title: 'ab' }).length); assert.ok(validateQuestion({ ...ok, statement: '  ' }).length); assert.ok(validateQuestion({ ...ok, difficulty: 'x' }).length)
  assert.equal(validateQuestion({ ...ok, points: 10000, time_limit_ms: 10000, memory_limit_kb: 512000 }).length, 0)
})
test('test-case validation', () => {
  assert.deepEqual(validateTestCase('1 2', '3'), []); assert.deepEqual(validateTestCase('', '0'), [])
  assert.ok(validateTestCase('1', '  \n').length); assert.ok(validateTestCase('x'.repeat(65537), '1').length); assert.ok(validateTestCase('1', 'x'.repeat(65537)).length)
})
test('challenge scheduling validation: close must follow release; day 1-21', () => {
  const base = { day_number: 1, title: 'Warm up', unlock_at: iso(0), closes_at: iso(60) }
  assert.deepEqual(validateChallenge(base), []); assert.deepEqual(validateChallenge({ ...base, unlock_at: null, closes_at: null }), [])
  assert.ok(validateChallenge({ ...base, closes_at: iso(0) }).some(m => /after the release/.test(m))); assert.ok(validateChallenge({ ...base, closes_at: iso(-5) }).length)
  assert.ok(validateChallenge({ ...base, day_number: 22 }).length); assert.ok(validateChallenge({ ...base, day_number: 0 }).length); assert.ok(validateChallenge({ ...base, unlock_at: 'garbage' }).length)
})
test('event + announcement validation', () => {
  const e = { name: '21X', starts_at: iso(0), ends_at: iso(60), wrong_penalty_minutes: 10, rules: '' }
  assert.deepEqual(validateEvent(e), []); assert.ok(validateEvent({ ...e, ends_at: iso(0) }).length); assert.ok(validateEvent({ ...e, wrong_penalty_minutes: -1 }).length)
  assert.ok(validateEvent({ ...e, wrong_penalty_minutes: 601 }).length); assert.ok(validateEvent({ ...e, name: ' ' }).length); assert.ok(validateEvent({ ...e, rules: 'x'.repeat(4001) }).length)
  assert.deepEqual(validateAnnouncement({ title: 'Hi', body: '' }), []); assert.ok(validateAnnouncement({ title: '', body: '' }).length); assert.ok(validateAnnouncement({ title: 'a', body: 'x'.repeat(2001) }).length)
})
