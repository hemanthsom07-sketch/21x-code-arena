import { supabase } from './supabase'

export interface Fail { ok: false; code: string; message: string }
export interface LbRow { rank: number; name: string; department: string | null; solved: number; points: number; penalty_minutes: number; last_accept: string | null; is_me: boolean; roll_number?: string }
export interface LbOk { ok: true; rows: LbRow[]; me: LbRow | null; total_ranked: number; updated_at: string }

function failure(status?: number): Fail {
  if (status === 404) return { ok: false, code: 'not_deployed', message: 'This feature is not deployed yet. An organizer must deploy the Edge Functions (see PATCH_README.md).' }
  if (status === 401) return { ok: false, code: 'unauthorized', message: 'Your session expired. Please sign in again.' }
  if (status === undefined) return { ok: false, code: 'network', message: 'Could not reach the server. Check your connection and try again.' }
  return { ok: false, code: 'internal', message: 'The server had a problem. Please try again shortly.' }
}
async function call<T>(fn: string, body: object): Promise<T | Fail> {
  const { data, error } = await supabase.functions.invoke(fn, { body })
  if (error) return failure((error as { context?: Response }).context?.status)
  return data as T | Fail
}
export const fetchLeaderboard = (o: { challenge_id?: string | null; limit?: number; export?: boolean }) => call<LbOk>('leaderboard', o)
export const activateAccount = (b: { roll_number: string; code: string; password: string }) => call<{ ok: true; message: string }>('activate', b)
