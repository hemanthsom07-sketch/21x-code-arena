// Deno entry wiring (needs the Supabase runtime; the logic it calls is unit-tested). Secrets come from Edge Function env only.
// Deployed with --no-verify-jwt: every function except `activate` authenticates the caller ITSELF below (auth.getUser on the
// bearer token, so an anon key or garbage token gets 401), and `activate` is public by design (students have no account yet)
// and is protected by one-time codes + lockout instead.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { adapterFromEnv } from './engine.ts'
import { handleRun, handleSubmit } from './core.ts'
import { handleLeaderboard } from './leaderboard.ts'
import { handleActivate } from './activate.ts'
import { activateDb, authAdmin, lbDb, supabaseDb } from './supabaseDb.ts'
import { bearerToken, corsHeaders, readJsonLimited } from './http.ts'

export type Kind = 'run' | 'submit' | 'leaderboard' | 'activate'

export function makeServer(kind: Kind) {
  return async (req: Request): Promise<Response> => {
    const cors = corsHeaders(req.headers.get('origin'), Deno.env.get('ALLOWED_ORIGINS'))
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
    if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
    if (req.method !== 'POST') return json({ ok: false, code: 'method_not_allowed', message: 'POST only.' }, 405)
    const onError = (e: unknown) => console.error(kind, 'error:', (e as Error)?.message)   // message only: never log bodies, passwords or tokens
    try {
      const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
      let uid = ''
      if (kind !== 'activate') {
        const token = bearerToken(req.headers)
        const { data, error } = token ? await admin.auth.getUser(token) : { data: null, error: new Error('no token') }
        if (error || !data?.user) return json({ ok: false, code: 'unauthorized', message: 'Please sign in again.' }, 401)
        uid = data.user.id
      }
      const parsed = await readJsonLimited(req)
      if (!parsed.ok) return json({ ok: false, code: parsed.reason, message: parsed.reason === 'too_large' ? 'Request too large.' : 'Invalid request.' }, parsed.reason === 'too_large' ? 413 : 400)
      let reply
      if (kind === 'activate') reply = await handleActivate({ db: activateDb(admin), auth: authAdmin(admin), onError }, parsed.body)
      else if (kind === 'leaderboard') reply = await handleLeaderboard({ db: lbDb(admin), cacheTtlMs: Number(Deno.env.get('LEADERBOARD_CACHE_SECONDS') ?? '10') * 1000 }, uid, parsed.body)
      else {
        let adapter = null
        try { adapter = adapterFromEnv(k => Deno.env.get(k)) } catch (e) { console.error('judge config:', (e as Error).message) }
        const deps = { adapter, db: supabaseDb(admin), onError }
        reply = kind === 'run' ? await handleRun(deps, uid, parsed.body) : await handleSubmit(deps, uid, parsed.body)
      }
      return json(reply.body, reply.status)
    } catch (e) {
      onError(e)
      return json({ ok: false, code: 'internal', message: 'Something went wrong on the server.' }, 500)
    }
  }
}
