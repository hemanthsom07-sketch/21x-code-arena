import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeOutput, outputsMatch, worstVerdict, summarize, judgeOne } from '../supabase/functions/_shared/judge.ts'
import type { ExecResult } from '../supabase/functions/_shared/adapter.ts'

const ok = (stdout: string): ExecResult => ({ outcome: 'ok', stdout, stderr: '', compileOutput: '', timeMs: 5, memoryKb: 100 })

test('whitespace policy', () => {
  assert.ok(outputsMatch('5\r\n', '5'))
  assert.ok(outputsMatch('a  \nb\t\n\n\n', 'a\nb'))
  assert.ok(!outputsMatch(' 5', '5'), 'leading whitespace is significant')
  assert.ok(!outputsMatch('Yes', 'yes'), 'case-sensitive')
  assert.ok(!outputsMatch('1 2', '1  2'), 'internal spacing is significant')
  assert.equal(normalizeOutput(''), '')
})
test('worst verdict ordering', () => {
  assert.equal(worstVerdict([]), 'accepted')
  assert.equal(worstVerdict(['accepted', 'wrong_answer']), 'wrong_answer')
  assert.equal(worstVerdict(['wrong_answer', 'runtime_error', 'time_limit_exceeded']), 'runtime_error')
  assert.equal(worstVerdict(['compilation_error', 'internal_error']), 'internal_error')
})
test('judgeOne maps outcomes', () => {
  assert.equal(judgeOne({ ...ok(''), outcome: 'time_limit' }, 'x'), 'time_limit_exceeded')
  assert.equal(judgeOne({ ...ok(''), outcome: 'internal_error' }, 'x'), 'internal_error')
})
test('summarize hides hidden-test data and reports counts', () => {
  const tests = [{ input: 'VIS_IN', expected_output: 'VIS_OUT', is_hidden: false }, { input: 'HID_IN', expected_output: 'HID_OUT', is_hidden: true }]
  const s = summarize(tests, [ok('VIS_OUT\n'), { ...ok('HID_IN echoed'), stderr: 'HID_IN on stderr' }])
  assert.equal(s.verdict, 'wrong_answer'); assert.equal(s.passed, 1); assert.equal(s.total, 2)
  assert.equal(s.message, 'Wrong Answer on hidden test #2.')
  const j = JSON.stringify(s)
  for (const secret of ['HID_IN', 'HID_OUT']) assert.ok(!j.includes(secret), `${secret} leaked`)
  assert.equal(s.results[0].input, 'VIS_IN')
})
