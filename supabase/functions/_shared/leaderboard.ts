import type { Reply } from './core.ts'
import { rankStandings, type Facts, type Standing } from './scoring.ts'
import { UUID_RE } from './http.ts'

export interface LbDb {
  getProfile(uid: string): Promise<{ role: 'student' | 'admin'; is_active: boolean } | null>
  getConfig(): Promise<{ wrong_penalty_minutes: number; leaderboard_public: boolean }>
  standingsFacts(challenge: string | null): Promise<Facts[]>
}
export type LbCache = Map<string, { at: number; facts: Facts[] }>
export interface LbDeps { db: LbDb; now?: () => number; cacheTtlMs?: number; cache?: LbCache }
const defaultCache: LbCache = new Map()
const fail = (code: string, message: string): Reply => ({ status: 200, body: { ok: false, code, message } })

/** Access rules: signed-in + (active student | admin). Students never receive roll numbers, emails or user ids of others.
 *  Facts are cached briefly (default 10 s) so thousands of dashboard refreshes cost one database aggregation. */
export async function handleLeaderboard(deps: LbDeps, uid: string, body: any): Promise<Reply> {
  const now = (deps.now ?? Date.now)()
  const challenge = body?.challenge_id == null ? null : String(body.challenge_id)
  if (challenge !== null && !UUID_RE.test(challenge)) return fail('bad_request', 'Invalid request.')
  const limit = Math.min(500, Math.max(1, Number.isFinite(Number(body?.limit)) ? Math.floor(Number(body.limit)) : 100))
  const wantExport = body?.export === true

  const profile = await deps.db.getProfile(uid)
  if (!profile) return fail('forbidden', 'Not allowed.')
  const admin = profile.role === 'admin'
  if (!admin && !profile.is_active) return fail('disabled', 'Your account is disabled. Contact the organizers.')
  if (wantExport && !admin) return fail('forbidden', 'Not allowed.')
  const cfg = await deps.db.getConfig()
  if (!admin && !cfg.leaderboard_public) return fail('hidden', 'The leaderboard is hidden by the organizers right now.')

  const cache = deps.cache ?? defaultCache, ttl = deps.cacheTtlMs ?? 10_000, key = challenge ?? 'all'
  let hit = cache.get(key)
  if (!hit || now - hit.at >= ttl) { hit = { at: now, facts: await deps.db.standingsFacts(challenge) }; cache.set(key, hit) }
  const ranked = rankStandings(hit.facts, cfg.wrong_penalty_minutes)

  const shape = (s: Standing) => ({ rank: s.rank, name: s.full_name ?? 'Unnamed', department: s.department, solved: s.solved, points: s.points,
    penalty_minutes: s.penalty_minutes, last_accept: s.last_accept, is_me: s.user_id === uid, ...(admin ? { roll_number: s.roll_number } : {}) })
  const me = ranked.find(s => s.user_id === uid)
  return { status: 200, body: { ok: true, rows: (wantExport ? ranked : ranked.slice(0, limit)).map(shape), me: me ? shape(me) : null,
    total_ranked: ranked.length, updated_at: new Date(hit.at).toISOString() } }
}
