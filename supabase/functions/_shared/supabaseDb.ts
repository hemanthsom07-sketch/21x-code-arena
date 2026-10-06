import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type { Db } from './core.ts'

/** Service-role data access. Runs only inside Edge Functions. */
export function supabaseDb(c: SupabaseClient): Db {
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await c.rpc(fn, args)
    if (error) throw new Error(error.message)
    return data
  }
  return {
    touchRun: uid => rpc('touch_run', { p_user: uid }) as Promise<boolean>,
    checkAccess: (uid, qid) => rpc('check_question_access', { p_user: uid, p_question: qid }),
    beginSubmission: (uid, qid, lang, code) => rpc('begin_submission', { p_user: uid, p_question: qid, p_language: lang, p_code: code }),
    getTests: async qid => {
      const { data, error } = await c.from('test_cases').select('input, expected_output, is_hidden').eq('question_id', qid).order('position')
      if (error) throw new Error(error.message)
      return data ?? []
    },
    finishSubmission: async (id, r) => {
      const { error } = await c.from('submissions').update({ status: 'judged', verdict: r.verdict, passed: r.passed, total: r.total,
        time_ms: r.time_ms, memory_kb: r.memory_kb, message: r.message, results: r.results }).eq('id', id)
      if (error) throw new Error(error.message)
    },
    logEvent: async e => {   // best effort: logging must never break judging
      try { await c.from('judge_events').insert({ kind: e.kind, user_id: e.user_id, code: e.code, detail: e.detail.slice(0, 300) }) } catch { /* ignore */ }
    },
  }
}

// ---- leaderboard + activation + judge event log (service role)
import type { LbDb } from './leaderboard.ts'
import type { ActivateDb, AuthAdmin } from './activate.ts'
import type { Facts } from './scoring.ts'

export function lbDb(c: SupabaseClient): LbDb {
  return {
    getProfile: async uid => {
      const { data, error } = await c.from('profiles').select('role, is_active').eq('id', uid).maybeSingle()
      if (error) throw new Error(error.message)
      return data as { role: 'student' | 'admin'; is_active: boolean } | null
    },
    getConfig: async () => {
      const { data, error } = await c.from('event_config').select('wrong_penalty_minutes, leaderboard_public').eq('id', 1).single()
      if (error) throw new Error(error.message)
      return data as { wrong_penalty_minutes: number; leaderboard_public: boolean }
    },
    standingsFacts: async challenge => {   // PostgREST caps responses at 1000 rows by default: page through the result
      const all: Facts[] = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await c.rpc('standings_facts', { p_challenge: challenge }).range(from, from + 999)
        if (error) throw new Error(error.message)
        all.push(...((data ?? []) as Facts[]))
        if (!data || data.length < 1000) return all
      }
    },
  }
}
export function activateDb(c: SupabaseClient): ActivateDb {
  return {
    verify: async (roll, code) => {
      const { data, error } = await c.rpc('verify_activation', { p_roll: roll, p_code: code })
      if (error) throw new Error(error.message)
      return data
    },
    finish: async (rosterId, userId) => { const { error } = await c.rpc('finish_activation', { p_roster: rosterId, p_user: userId }); if (error) throw new Error(error.message) },
  }
}
export function authAdmin(c: SupabaseClient): AuthAdmin {
  return {
    createUser: async a => {
      const { data, error } = await c.auth.admin.createUser({ email: a.email, password: a.password, email_confirm: true,
        user_metadata: { full_name: a.full_name, roll_number: a.roll_number } })
      if (error || !data.user) {
        const m = (error?.message ?? '').toLowerCase()
        return { error: m.includes('already') || m.includes('registered') ? 'exists' : m.includes('password') ? 'weak' : 'failed' }
      }
      return { id: data.user.id }
    },
    deleteUser: async id => { await c.auth.admin.deleteUser(id) },
  }
}
