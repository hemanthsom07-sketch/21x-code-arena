import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

// STATIC analysis of the SQL text. It does not execute SQL (see supabase/checks/competition_checks.sql for that), but it
// catches the mistakes that silently weaken security: a table without RLS, a privileged function left callable by students.
const dir = new URL('../supabase/migrations/', import.meta.url)
const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
const sql = Object.fromEntries(files.map(f => [f, readFileSync(new URL(f, dir), 'utf8')]))
const all = Object.values(sql).join('\n')
const tables = [...all.matchAll(/create table (?:if not exists )?public\.(\w+)/g)].map(m => m[1])

test('migrations are numbered consecutively', () => assert.deepEqual(files.map(f => f.slice(0, 4)), files.map((_, i) => String(i + 1).padStart(4, '0'))))
test('every table has row level security enabled', () => {
  assert.deepEqual([...tables].sort(), ['announcements', 'challenges', 'event_config', 'exec_rate', 'judge_events', 'profiles', 'question_results', 'questions', 'roster', 'submissions', 'test_cases'],
    'table list changed: review RLS for the new table, then update this list')
  for (const t of tables) assert.match(all, new RegExp(`alter table public\\.${t} enable row level security`), `RLS missing on ${t}`)
})
test('tables that must never be student-readable have no student policy', () => {
  for (const t of ['test_cases', 'roster', 'exec_rate', 'judge_events']) {
    const pol = [...all.matchAll(new RegExp(`create policy "[^"]+" on public\\.${t}[\\s\\S]*?;`, 'g'))].map(m => m[0])
    for (const p of pol) assert.match(p, /is_admin\(\)/, `${t}: policy not admin-gated: ${p.slice(0, 80)}`)
  }
})
test('students cannot write scoring facts or event config: no insert/update policy for them', () => {
  const sql5 = sql['0005_competition.sql']
  assert.ok(!/create policy [^;]*on public\.question_results for (insert|update|all)/.test(sql5))
  for (const m of sql5.matchAll(/create policy "[^"]+" on public\.event_config for (all|insert|update)[^;]*;/g)) assert.match(m[0], /is_admin\(\)/)
})
test('service-role-only functions are revoked from public/anon/authenticated', () => {
  const s = sql['0005_competition.sql']
  for (const f of ['verify_activation(text,text)', 'finish_activation(uuid,uuid)', 'standings_facts(uuid)']) assert.ok(s.includes(`'${f}'`), f)
  assert.match(s, /revoke all on function public\.%s from public, anon, authenticated/); assert.match(s, /grant execute on function public\.%s to service_role/)
  const s4 = sql['0004_submissions_verdict.sql']
  for (const f of ['check_question_access(uuid, uuid)', 'begin_submission(uuid, uuid, text, text, int)', 'touch_run(uuid, int)']) assert.ok(s4.includes(`revoke all on function public.${f} from public, anon, authenticated`), f)
})
test('every admin-callable RPC checks is_admin() inside its body', () => {
  const s = sql['0005_competition.sql']
  for (const fn of ['import_roster', 'generate_activation_codes', 'set_participant_active', 'recompute_results', 'admin_overview', 'admin_submissions', 'admin_question_stats', 'sweep_stuck_submissions']) {
    const m = new RegExp(`create or replace function public\\.${fn}\\([\\s\\S]*?\\n(?:\\$\\$|end \\$\\$);`).exec(s)
    assert.ok(m, `${fn} not found`); assert.match(m![0], /is_admin\(\)/, `${fn} does not check is_admin()`)
  }
})
test('SECURITY DEFINER functions pin search_path', () => {
  for (const [f, text] of Object.entries(sql)) for (const m of text.matchAll(/create or replace function[\s\S]*?(?=\n\$\$|\nbegin|\nas \$\$| as \$\$)/g))
    if (/security definer/i.test(m[0])) assert.match(m[0], /set search_path/i, `${f}: ${m[0].slice(0, 70)}`)
})
test('deadline/disabled/pause checks exist in the access function used by run AND submit', () => {
  const s = sql['0005_competition.sql']; const body = /function public\.check_question_access[\s\S]*?end \$\$;/.exec(s)![0]
  for (const code of ['disabled', 'locked', 'closed', 'event_not_started', 'event_ended', 'submissions_closed']) assert.match(body, new RegExp(`raise exception '${code}'`), code)
  assert.match(/function public\.begin_submission[\s\S]*?end \$\$;/.exec(s)![0], /check_question_access/)
})
test('scoring trigger: only first acceptance scores; compile errors and judge faults are not penalised', () => {
  const t = /function public\.apply_submission_result[\s\S]*?end \$\$;/.exec(sql['0005_competition.sql'])![0]
  assert.match(t, /not in \('accepted', 'wrong_answer', 'runtime_error', 'time_limit_exceeded'\)/); assert.ok(!/compilation_error|internal_error/.test(t.replace(/--.*$/gm, '')))
  assert.match(t, /first_accepted_at is null/)
})
