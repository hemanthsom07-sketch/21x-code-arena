export type ChallengeState = 'locked' | 'upcoming' | 'open' | 'closed'
export interface ChallengeTimes { is_unlocked: boolean; unlock_at: string | null; closes_at: string | null }
export interface EventTimes { starts_at: string | null; ends_at: string | null; submissions_open: boolean }

/** locked = not scheduled; upcoming = scheduled for later; open = released and not closed; closed = past closes_at.
 *  UI hint only: the database (check_question_access) is what actually enforces access and deadlines. */
export function challengeState(c: ChallengeTimes, now: number = Date.now()): ChallengeState {
  const released = c.is_unlocked || (!!c.unlock_at && Date.parse(c.unlock_at) <= now)
  if (!released) return c.unlock_at ? 'upcoming' : 'locked'
  if (c.closes_at && Date.parse(c.closes_at) <= now) return 'closed'
  return 'open'
}

/** Why submissions are not possible right now (same order as the database check), or null if they are. */
export function submissionBlock(c: ChallengeTimes, e: EventTimes, now: number = Date.now()): string | null {
  const s = challengeState(c, now)
  if (s === 'locked' || s === 'upcoming') return 'This challenge has not been released yet.'
  if (s === 'closed') return 'This challenge is closed; submissions are no longer accepted.'
  if (e.starts_at && Date.parse(e.starts_at) > now) return 'The event has not started yet.'
  if (e.ends_at && Date.parse(e.ends_at) <= now) return 'The event has ended.'
  if (!e.submissions_open) return 'Submissions are paused by the organizers right now.'
  return null
}
