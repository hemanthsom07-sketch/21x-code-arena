import test from 'node:test'
import assert from 'node:assert/strict'
import { VERDICT_LABEL, verdictLabel, verdictColor, describeInvokeFailure, isSetupProblem } from '../src/lib/verdicts.ts'
import { VERDICT_LABEL as SERVER_LABEL } from '../supabase/functions/_shared/judge.ts'

test('client verdict labels match the server', () => assert.deepEqual(VERDICT_LABEL, SERVER_LABEL))
test('labels/colors', () => {
  assert.equal(verdictLabel(null), 'Pending'); assert.equal(verdictLabel('accepted'), 'Accepted')
  assert.match(verdictColor('accepted'), /lime/); assert.match(verdictColor('wrong_answer'), /red/)
})
test('edge function failures produce clear setup/network messages', () => {
  const nd = describeInvokeFailure(404); assert.ok(isSetupProblem(nd.code)); assert.match(nd.message, /not set up/i)
  assert.equal(describeInvokeFailure(undefined).code, 'network'); assert.equal(describeInvokeFailure(401).code, 'unauthorized')
  assert.ok(isSetupProblem('not_configured')); assert.ok(!isSetupProblem('cooldown'))
})
