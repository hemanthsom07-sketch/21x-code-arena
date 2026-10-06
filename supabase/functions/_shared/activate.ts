import type { Reply } from './core.ts'

/** Must match STUDENT_EMAIL_DOMAIN in src/lib/auth.tsx (a test enforces this): students sign in with roll@domain. */
export const STUDENT_EMAIL_DOMAIN = 'students.acm-event.local'
export type VerifyResult = { ok: true; roster_id: string; roll_number: string; full_name: string; email: string; department: string | null; year: number | null }
  | { ok: false; reason: 'invalid' | 'locked' }
export interface ActivateDb { verify(roll: string, code: string): Promise<VerifyResult>; finish(rosterId: string, userId: string): Promise<void> }
export interface AuthAdmin {
  createUser(a: { email: string; password: string; full_name: string; roll_number: string }): Promise<{ id: string } | { error: 'exists' | 'weak' | 'failed' }>
  deleteUser(id: string): Promise<void>
}
export interface ActivateDeps { db: ActivateDb; auth: AuthAdmin; onError?: (e: unknown) => void }
const fail = (code: string, message: string): Reply => ({ status: 200, body: { ok: false, code, message } })

export function passwordProblem(pw: string, roll: string): string | null {
  if (pw.length < 8) return 'Password must be at least 8 characters.'
  if (pw.length > 72) return 'Password must be at most 72 characters.'
  if (pw.toLowerCase().includes(roll.toLowerCase())) return 'Password must not contain your roll number.'
  if (/^(.)\1+$/.test(pw)) return 'Password is too simple.'
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(r => r.test(pw)).length
  if (classes < 2) return 'Use at least two kinds of characters (letters, digits, symbols).'
  return null
}

export function validateActivation(body: any): { ok: true; roll: string; code: string; password: string } | { ok: false; message: string } {
  const roll = typeof body?.roll_number === 'string' ? body.roll_number.trim().toUpperCase() : ''
  const code = typeof body?.code === 'string' ? body.code.replace(/[\s-]/g, '').toUpperCase() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  if (!/^[A-Z0-9._-]{3,30}$/.test(roll)) return { ok: false, message: 'Enter a valid roll number.' }
  if (!/^[A-Z0-9]{8,16}$/.test(code)) return { ok: false, message: 'Enter the activation code you were given.' }
  const problem = passwordProblem(password, roll)
  if (problem) return { ok: false, message: problem }
  return { ok: true, roll, code, password }
}

/** Student self-activation with a one-time code. The password is chosen by the student, only ever sent to Supabase Auth,
 *  and never logged, stored or returned. Wrong codes give one generic message (no roll-number enumeration). */
export async function handleActivate(deps: ActivateDeps, body: any): Promise<Reply> {
  const v = validateActivation(body)
  if (!v.ok) return fail('bad_request', v.message)
  const check = await deps.db.verify(v.roll, v.code)
  if (!check.ok) return check.reason === 'locked'
    ? fail('locked', 'Too many attempts. Try again in 15 minutes.')
    : fail('invalid', 'Invalid roll number or activation code (or the account is already activated).')
  const created = await deps.auth.createUser({ email: `${check.roll_number.toLowerCase()}@${STUDENT_EMAIL_DOMAIN}`, password: v.password,
    full_name: check.full_name, roll_number: check.roll_number })
  if ('error' in created) return created.error === 'exists'
    ? fail('exists', 'An account already exists for this roll number. Try signing in, or contact the organizers.')
    : created.error === 'weak' ? fail('weak_password', 'That password was rejected. Choose a stronger one.')
    : fail('activation_failed', 'Could not create the account. Please try again or contact the organizers.')
  try { await deps.db.finish(check.roster_id, created.id) }
  catch (e) {
    deps.onError?.(e)
    try { await deps.auth.deleteUser(created.id) } catch (e2) { deps.onError?.(e2) }   // roll back: no half-created account
    return fail('activation_failed', 'Could not complete activation. Contact the organizers with your roll number.')
  }
  return { status: 200, body: { ok: true, message: 'Account activated. You can sign in now.', roll_number: check.roll_number } }
}
