import test from 'node:test'
import assert from 'node:assert/strict'
import { percentile, summarize, parseAccounts } from '../scripts/lib/loadStats.ts'

test('percentile (nearest-rank)', () => {
  const v = Array.from({ length: 100 }, (_, i) => i + 1)
  assert.equal(percentile(v, 50), 50); assert.equal(percentile(v, 95), 95); assert.equal(percentile(v, 100), 100); assert.equal(percentile(v, 0), 1); assert.equal(percentile([], 50), 0); assert.equal(percentile([7], 99), 7)
})
test('summarize: latency percentiles, outcome counts, throughput', () => {
  const s = summarize([{ ms: 100, outcome: 'accepted' }, { ms: 300, outcome: 'accepted' }, { ms: 200, outcome: 'cooldown' }, { ms: 900, outcome: 'network' }], 2000)
  assert.deepEqual(s.outcomes, { accepted: 2, cooldown: 1, network: 1 }); assert.equal(s.max, 900); assert.equal(s.p50, 200); assert.equal(s.requests, 4); assert.equal(s.throughputPerSec, 2)
  assert.equal(summarize([], 0).throughputPerSec, 0)
})
test('account list parsing ignores header, comments and blanks; passwords may contain commas', () => {
  assert.deepEqual(parseAccounts('roll,password\n# comment\n\nLT001,pass,word1\r\nLT002,abc\n,nopass\nonlyroll,'), [{ roll: 'LT001', password: 'pass,word1' }, { roll: 'LT002', password: 'abc' }])
})
