// Burst/ramp load test against your DEPLOYED app (Supabase Auth + the `submit` Edge Function + the judge behind it).
//   node --experimental-strip-types --no-warnings scripts/load-test.ts
// Needs DEDICATED TEST accounts (activated students) and a DEDICATED test question with a known-correct solution.
// Never run it against live event data: it creates real submissions (they are scored!). Use a separate Supabase project or
// delete the test submissions and run "Recompute scores" afterwards.
//   SUPABASE_URL, SUPABASE_ANON_KEY   your project (anon key is public)
//   LOAD_ACCOUNTS    file with lines "roll_number,password" (test students)
//   LOAD_QUESTION_ID uuid of the test question   LOAD_LANG c|python   LOAD_SOURCE_FILE  path of a correct solution
//   LOAD_USERS (default 10)  LOAD_ROUNDS (default 1; each user submits once per round, rounds are 11 s apart because of the 10 s cooldown)
//   LOAD_STAGGER_MS (default 0 = all at once)
import { readFileSync } from 'node:fs'
import { parseAccounts, summarize, type Sample } from './lib/loadStats.ts'

const env = (k: string, d?: string) => { const v = process.env[k] ?? d; if (v === undefined) { console.error(`Missing ${k}. See the header of scripts/load-test.ts`); process.exit(2) } return v }
const url = env('SUPABASE_URL').replace(/\/+$/, ''), anon = env('SUPABASE_ANON_KEY')
const accounts = parseAccounts(readFileSync(env('LOAD_ACCOUNTS'), 'utf8'))
const question = env('LOAD_QUESTION_ID'), lang = env('LOAD_LANG', 'python'), source = readFileSync(env('LOAD_SOURCE_FILE'), 'utf8')
const users = Math.min(Number(env('LOAD_USERS', '10')), accounts.length), rounds = Number(env('LOAD_ROUNDS', '1')), stagger = Number(env('LOAD_STAGGER_MS', '0'))
if (users > 200 && !process.argv.includes('--i-know')) { console.error('Refusing >200 users without --i-know (it will create that many real submissions).'); process.exit(2) }
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function login(a: { roll: string; password: string }): Promise<string | null> {
  const email = a.roll.includes('@') ? a.roll : `${a.roll.toLowerCase()}@students.acm-event.local`
  try {
    const r = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: a.password }) })
    return r.ok ? (await r.json()).access_token : null
  } catch { return null }
}
async function submit(token: string): Promise<Sample> {
  const t0 = Date.now()
  try {
    const r = await fetch(`${url}/functions/v1/submit`, { method: 'POST', headers: { apikey: anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ question_id: question, language: lang, source }) })
    const j: any = await r.json().catch(() => ({}))
    return { ms: Date.now() - t0, outcome: r.status >= 500 ? `http_${r.status}` : j.ok ? j.verdict : (j.code ?? `http_${r.status}`) }
  } catch { return { ms: Date.now() - t0, outcome: 'network' } }
}

console.log(`Logging in ${users} test accounts…`)
const tokens = (await Promise.all(accounts.slice(0, users).map(login))).filter((t): t is string => !!t)
console.log(`${tokens.length}/${users} logged in${tokens.length < users ? ' (check the failures: wrong password, account not activated or disabled)' : ''}`)
if (!tokens.length) process.exit(1)
const samples: Sample[] = []; const t0 = Date.now()
for (let round = 1; round <= rounds; round++) {
  console.log(`Round ${round}/${rounds}: ${tokens.length} submissions${stagger ? ` staggered by ${stagger} ms` : ' at once'}…`)
  await Promise.all(tokens.map(async (t, i) => { if (stagger) await sleep(i * stagger); samples.push(await submit(t)) }))
  if (round < rounds) await sleep(11_000)
}
const s = summarize(samples, Date.now() - t0)
console.log('\nRESULT', JSON.stringify(s, null, 2))
const bad = Object.entries(s.outcomes).filter(([k]) => !['accepted', 'wrong_answer'].includes(k))
console.log(bad.length ? `\nNon-verdict outcomes (investigate): ${bad.map(([k, n]) => `${k}=${n}`).join(', ')}` : '\nAll requests produced a judged verdict.')
console.log('Reminder: these were REAL submissions. Clean up and recompute scores before the event.')
