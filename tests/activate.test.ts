import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { handleActivate, passwordProblem, validateActivation, STUDENT_EMAIL_DOMAIN, type ActivateDeps, type VerifyResult } from '../supabase/functions/_shared/activate.ts'

const GOOD = { roll_number: ' 1ga23cs001 ', code: 'abcde-12345', password: 'Sunny#Day42' }
function setup(over: { verify?: VerifyResult; create?: any; finishThrows?: boolean } = {}) {
  const log = { created: [] as any[], deleted: [] as string[], finished: [] as any[], errors: [] as unknown[], verifyCalls: [] as any[] }
  const deps: ActivateDeps = {
    db: { verify: async (roll, code) => { log.verifyCalls.push([roll, code]); return over.verify ?? { ok: true, roster_id: 'r1', roll_number: '1GA23CS001', full_name: 'Asha Rao', email: 'asha@college.edu', department: 'CSE', year: 2 } },
          finish: async (r, u) => { if (over.finishThrows) throw new Error('db down'); log.finished.push([r, u]) } },
    auth: { createUser: async a => { log.created.push(a); return over.create ?? { id: 'user-1' } }, deleteUser: async id => { log.deleted.push(id) } },
    onError: e => log.errors.push(e) }
  return { deps, log }
}

test('success: normalises input, creates the synthetic-email account, never echoes the password', async () => {
  const { deps, log } = setup(); const r = await handleActivate(deps, GOOD)
  assert.equal(r.body.ok, true); assert.deepEqual(log.verifyCalls, [['1GA23CS001', 'ABCDE12345']])
  assert.equal(log.created[0].email, `1ga23cs001@${STUDENT_EMAIL_DOMAIN}`); assert.deepEqual(log.finished, [['r1', 'user-1']])
  assert.ok(!JSON.stringify(r).includes('Sunny#Day42') && !JSON.stringify(r).includes('user-1'))
})
test('wrong code and unknown/used roll give the SAME generic reply (no enumeration); lockout is reported', async () => {
  const a = await handleActivate(setup({ verify: { ok: false, reason: 'invalid' } }).deps, GOOD)
  assert.equal(a.body.code, 'invalid'); assert.match(String(a.body.message), /Invalid roll number or activation code/)
  const l = await handleActivate(setup({ verify: { ok: false, reason: 'locked' } }).deps, GOOD); assert.equal(l.body.code, 'locked')
})
test('no account is created when verification fails', async () => {
  const s = setup({ verify: { ok: false, reason: 'invalid' } }); await handleActivate(s.deps, GOOD); assert.equal(s.log.created.length, 0)
})
test('weak/short/roll-containing passwords and malformed inputs are rejected before any lookup', async () => {
  for (const pw of ['short1A', 'aaaaaaaaaa', '12345678', 'xx1ga23cs001xx!', 'a'.repeat(73) + '1']) {
    const s = setup(); const r = await handleActivate(s.deps, { ...GOOD, password: pw })
    assert.equal(r.body.code, 'bad_request', pw); assert.equal(s.log.verifyCalls.length, 0)
  }
  for (const bad of [null, {}, { ...GOOD, roll_number: 'a b' }, { ...GOOD, code: 'x' }, { ...GOOD, roll_number: "x'; drop table" }]) assert.equal((await handleActivate(setup().deps, bad)).body.code, 'bad_request')
  assert.equal(passwordProblem('Sunny#Day42', 'R1'), null)
})
test('account already exists / password rejected / auth failure map to clear replies', async () => {
  assert.equal((await handleActivate(setup({ create: { error: 'exists' } }).deps, GOOD)).body.code, 'exists')
  assert.equal((await handleActivate(setup({ create: { error: 'weak' } }).deps, GOOD)).body.code, 'weak_password')
  assert.equal((await handleActivate(setup({ create: { error: 'failed' } }).deps, GOOD)).body.code, 'activation_failed')
})
test('if linking the profile fails the new auth user is deleted (no half-created account) and the error is logged', async () => {
  const s = setup({ finishThrows: true }); const r = await handleActivate(s.deps, GOOD)
  assert.equal(r.body.code, 'activation_failed'); assert.deepEqual(s.log.deleted, ['user-1']); assert.equal(s.log.errors.length, 1)
  assert.ok(!JSON.stringify(s.log.errors.map(String)).includes('Sunny#Day42'), 'password never reaches logs')
})
test('the synthetic email domain matches the one the login form uses', () => {
  const src = readFileSync(new URL('../src/lib/auth.tsx', import.meta.url), 'utf8')
  assert.ok(src.includes(`'${STUDENT_EMAIL_DOMAIN}'`))
  assert.equal(validateActivation({ ...GOOD }).ok, true)
})
