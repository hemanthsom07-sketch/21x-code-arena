// Ranking rules (single source of truth; documented in docs/SCORING_AND_RULES.md).
// The database records trusted FACTS (first accepted time, wrong attempts before it); this module applies the rules.
export const PENALIZED_VERDICTS = ['wrong_answer', 'runtime_error', 'time_limit_exceeded'] as const
/** Compilation errors and judge faults (internal_error) are never penalised. */
export const isPenalized = (verdict: string | null) => (PENALIZED_VERDICTS as readonly string[]).includes(verdict ?? '')

export interface Facts {
  user_id: string; full_name: string | null; department: string | null; roll_number: string | null
  solved: number; points: number; elapsed_minutes: number; wrong_count: number; last_accept: string | null
}
export interface Standing extends Facts { rank: number; penalty_minutes: number }

/** penalty = minutes from each solved question's challenge start to its first accepted submission, summed,
 *  plus `wrongPenaltyMinutes` for every penalised attempt made before that acceptance. */
export const penaltyMinutes = (f: Pick<Facts, 'elapsed_minutes' | 'wrong_count'>, wrongPenaltyMinutes: number) => f.elapsed_minutes + f.wrong_count * wrongPenaltyMinutes

const ts = (s: string | null) => (s ? Date.parse(s) : Number.POSITIVE_INFINITY)

/** Order: points desc, penalty asc, earliest last acceptance asc; then name and user id so the ORDER is always deterministic.
 *  Rank uses competition ranking (1,2,2,4): equal points + penalty + last acceptance share a rank. */
export function rankStandings(facts: Facts[], wrongPenaltyMinutes: number): Standing[] {
  const rows = facts.filter(f => f.solved > 0 && f.points > 0).map(f => ({ ...f, penalty_minutes: penaltyMinutes(f, wrongPenaltyMinutes), rank: 0 }))
  const cmp = (a: Standing, b: Standing) => b.points - a.points || a.penalty_minutes - b.penalty_minutes || ts(a.last_accept) - ts(b.last_accept)
  rows.sort((a, b) => cmp(a, b) || (a.full_name ?? '').localeCompare(b.full_name ?? '') || a.user_id.localeCompare(b.user_id))
  rows.forEach((r, i) => { r.rank = i > 0 && cmp(rows[i - 1], r) === 0 ? rows[i - 1].rank : i + 1 })
  return rows
}
