-- Phase 4/5: competition management. Additive and re-runnable; apply after 0001-0004.
-- Contents: profile fields + account enable/disable, event config, challenge close times, roster + activation codes,
-- question_results (trusted scoring facts), announcements, judge event log, admin monitoring RPCs, tightened access checks.

------------------------------------------------------------------ profiles
alter table public.profiles
  add column if not exists email text,
  add column if not exists department text,
  add column if not exists year smallint,
  add column if not exists is_active boolean not null default true,   -- existing accounts stay active
  add column if not exists activated_at timestamptz;
alter table public.profiles drop constraint if exists profiles_year_check;
alter table public.profiles add constraint profiles_year_check check (year is null or year between 1 and 8);

create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_active from public.profiles where id = auth.uid()), false)
$$;

------------------------------------------------------------------ event config (single row)
create table if not exists public.event_config (
  id int primary key default 1 check (id = 1),
  name text not null default '21X — The Code Arena' check (length(name) between 1 and 120),
  starts_at timestamptz, ends_at timestamptz,
  submissions_open boolean not null default true,
  wrong_penalty_minutes int not null default 10 check (wrong_penalty_minutes between 0 and 600),
  leaderboard_public boolean not null default true,
  rules text not null default '' check (length(rules) <= 4000),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  check (starts_at is null or ends_at is null or ends_at > starts_at));
insert into public.event_config (id) values (1) on conflict do nothing;
alter table public.event_config enable row level security;
drop policy if exists "auth read event_config" on public.event_config;
drop policy if exists "admin write event_config" on public.event_config;
create policy "auth read event_config" on public.event_config for select to authenticated using (true);
create policy "admin write event_config" on public.event_config for all using (public.is_admin()) with check (public.is_admin());

------------------------------------------------------------------ challenges: closing time; sane limits on questions/test cases
alter table public.challenges add column if not exists closes_at timestamptz;
alter table public.challenges drop constraint if exists challenges_close_after_open;
alter table public.challenges add constraint challenges_close_after_open check (closes_at is null or unlock_at is null or closes_at > unlock_at);

-- NOT VALID: enforced for new/changed rows without rejecting data that already exists.
alter table public.questions drop constraint if exists questions_limits_check;
alter table public.questions add constraint questions_limits_check
  check (points between 1 and 10000 and time_limit_ms between 100 and 10000 and memory_limit_kb between 16000 and 512000) not valid;
alter table public.test_cases drop constraint if exists test_cases_size_check;
alter table public.test_cases add constraint test_cases_size_check
  check (octet_length(input) <= 65536 and octet_length(expected_output) <= 65536) not valid;

------------------------------------------------------------------ roster (imported participants) + activation
create table if not exists public.roster (
  id uuid primary key default gen_random_uuid(),
  roll_number text not null unique check (roll_number ~ '^[A-Z0-9._-]{3,30}$'),
  full_name text not null check (length(trim(full_name)) between 2 and 120),
  email text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  department text, year smallint check (year is null or year between 1 and 8),
  user_id uuid unique references public.profiles(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','active','disabled')),
  code_hash text, code_created_at timestamptz,
  failed_attempts int not null default 0, locked_until timestamptz,
  activated_at timestamptz, created_at timestamptz not null default now());
create unique index if not exists roster_email_key on public.roster (lower(email));
create index if not exists roster_status_idx on public.roster (status);
alter table public.roster enable row level security;
drop policy if exists "admin all roster" on public.roster;
create policy "admin all roster" on public.roster for all using (public.is_admin()) with check (public.is_admin());
-- No student policy: students can never read the roster or other students' details.

create or replace function public.import_roster(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; roll text; mail text; res jsonb := '[]'::jsonb; outcome text;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then raise exception 'rows must be an array of at most 500 items'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    roll := upper(trim(r->>'roll_number')); mail := lower(trim(r->>'email'));
    if exists (select 1 from public.roster where roll_number = roll) then outcome := 'duplicate_roll';
    elsif exists (select 1 from public.roster where lower(email) = mail) then outcome := 'duplicate_email';
    else
      begin
        insert into public.roster (roll_number, full_name, email, department, year)
        values (roll, trim(r->>'full_name'), mail, nullif(trim(r->>'department'), ''), nullif(r->>'year', '')::smallint);
        outcome := 'inserted';
      exception when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range then outcome := 'invalid';
      end;
    end if;
    res := res || jsonb_build_array(jsonb_build_object('roll_number', roll, 'result', outcome));
  end loop;
  return res;   -- one entry per input row: nothing is dropped silently
end $$;

-- One-time activation codes. Only the SHA-256 hash is stored; the plaintext is returned ONCE to the admin and never again.
create or replace function public.generate_activation_codes(p_roster_ids uuid[] default null)
returns table (roll_number text, full_name text, email text, code text)
language sql volatile security definer set search_path = public as $$
  with todo as materialized (
    select id, roll_number, full_name, email, upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)) as code
    from public.roster
    where status = 'pending' and (p_roster_ids is null or id = any(p_roster_ids)) and public.is_admin()),
  upd as (
    update public.roster r set code_hash = encode(sha256(convert_to(t.code, 'UTF8')), 'hex'),
      code_created_at = now(), failed_attempts = 0, locked_until = null
    from todo t where r.id = t.id returning r.id)
  select t.roll_number, t.full_name, t.email, t.code from todo t join upd u on u.id = t.id order by t.roll_number
$$;

-- Used only by the `activate` Edge Function (service role). Lockout: 5 wrong codes => 15 minutes.
create or replace function public.verify_activation(p_roll text, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r public.roster; h text;
begin
  select * into r from public.roster where roll_number = upper(trim(p_roll)) for update;
  if not found or r.status <> 'pending' or r.code_hash is null then return jsonb_build_object('ok', false, 'reason', 'invalid'); end if;
  if r.locked_until is not null and r.locked_until > now() then return jsonb_build_object('ok', false, 'reason', 'locked'); end if;
  h := encode(sha256(convert_to(upper(replace(trim(p_code), '-', '')), 'UTF8')), 'hex');
  if h = r.code_hash then
    update public.roster set failed_attempts = 0, locked_until = null where id = r.id;
    return jsonb_build_object('ok', true, 'roster_id', r.id, 'roll_number', r.roll_number, 'full_name', r.full_name,
                              'email', r.email, 'department', r.department, 'year', r.year);
  end if;
  update public.roster set
    failed_attempts = case when failed_attempts + 1 >= 5 then 0 else failed_attempts + 1 end,
    locked_until = case when failed_attempts + 1 >= 5 then now() + interval '15 minutes' else locked_until end
  where id = r.id;
  return jsonb_build_object('ok', false, 'reason', 'invalid');
end $$;

create or replace function public.finish_activation(p_roster uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r public.roster;
begin
  update public.roster set user_id = p_user, status = 'active', code_hash = null, activated_at = now(), failed_attempts = 0
  where id = p_roster and status = 'pending' returning * into r;
  if not found then raise exception 'not_pending'; end if;
  insert into public.profiles (id, full_name, roll_number, email, department, year, is_active, activated_at)
  values (p_user, r.full_name, r.roll_number, r.email, r.department, r.year, true, now())
  on conflict (id) do update set full_name = excluded.full_name, roll_number = excluded.roll_number, email = excluded.email,
    department = excluded.department, year = excluded.year, is_active = true, activated_at = now();
end $$;

create or replace function public.set_participant_active(p_user uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  update public.profiles set is_active = p_active where id = p_user and role = 'student';
  update public.roster set status = case when p_active then 'active' else 'disabled' end where user_id = p_user;
end $$;

------------------------------------------------------------------ trusted scoring facts
create table if not exists public.question_results (
  user_id uuid not null references public.profiles(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  first_accepted_at timestamptz, first_accepted_submission uuid,
  points_awarded int not null default 0,
  wrong_count int not null default 0,           -- penalised attempts BEFORE the first accepted one
  primary key (user_id, question_id));
create index if not exists question_results_question_idx on public.question_results (question_id);
alter table public.question_results enable row level security;
drop policy if exists "read own results" on public.question_results;
create policy "read own results" on public.question_results for select using (user_id = auth.uid() or public.is_admin());
-- No insert/update policy: only the trigger below (and recompute_results) can write.

-- Rules (see docs/SCORING_AND_RULES.md): only the FIRST accepted submission scores; later accepted ones change nothing.
-- Penalised verdicts: wrong_answer, runtime_error, time_limit_exceeded. NOT penalised: compilation_error, internal_error (judge faults).
create or replace function public.apply_submission_result() returns trigger
language plpgsql security definer set search_path = public as $$
declare q public.questions; ch public.challenges;
begin
  if new.verdict is null or new.verdict is not distinct from old.verdict then return new; end if;
  if new.verdict not in ('accepted', 'wrong_answer', 'runtime_error', 'time_limit_exceeded') then return new; end if;
  select * into q from public.questions where id = new.question_id;
  select * into ch from public.challenges where id = q.challenge_id;
  if ch.closes_at is not null and new.created_at > ch.closes_at then return new; end if;  -- defence in depth
  insert into public.question_results (user_id, question_id) values (new.user_id, new.question_id) on conflict do nothing;
  perform 1 from public.question_results where user_id = new.user_id and question_id = new.question_id for update;  -- serialises concurrent judging
  if new.verdict = 'accepted' then
    update public.question_results set first_accepted_at = new.created_at, first_accepted_submission = new.id, points_awarded = q.points
    where user_id = new.user_id and question_id = new.question_id and first_accepted_at is null;
  else
    update public.question_results set wrong_count = wrong_count + 1
    where user_id = new.user_id and question_id = new.question_id and first_accepted_at is null;
  end if;
  return new;
end $$;
drop trigger if exists submissions_apply_result on public.submissions;
create trigger submissions_apply_result after update of verdict on public.submissions
  for each row execute function public.apply_submission_result();

-- Rebuilds question_results from the submissions table (use after editing question points or fixing data). Admin only.
create or replace function public.recompute_results() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  delete from public.question_results where true;
  insert into public.question_results (user_id, question_id, first_accepted_at, first_accepted_submission, points_awarded, wrong_count)
  select s.user_id, s.question_id, fa.created_at, fa.id, case when fa.id is not null then q.points else 0 end,
         count(*) filter (where s.verdict in ('wrong_answer', 'runtime_error', 'time_limit_exceeded') and (fa.created_at is null or s.created_at < fa.created_at))
  from public.submissions s
  join public.questions q on q.id = s.question_id
  join public.challenges c on c.id = q.challenge_id
  left join lateral (select a.id, a.created_at from public.submissions a
                     where a.user_id = s.user_id and a.question_id = s.question_id and a.verdict = 'accepted'
                       and (c.closes_at is null or a.created_at <= c.closes_at) order by a.created_at limit 1) fa on true
  where s.verdict is not null and (c.closes_at is null or s.created_at <= c.closes_at)
  group by s.user_id, s.question_id, fa.id, fa.created_at, q.points
  having fa.id is not null or count(*) filter (where s.verdict in ('wrong_answer', 'runtime_error', 'time_limit_exceeded')) > 0;
  get diagnostics n = row_count; return n;
end $$;

-- Aggregated facts for the `leaderboard` Edge Function (service role only; ranking rules live in TypeScript).
create or replace function public.standings_facts(p_challenge uuid default null)
returns table (user_id uuid, full_name text, department text, roll_number text, solved int, points int,
               elapsed_minutes int, wrong_count int, last_accept timestamptz)
language sql stable security definer set search_path = public as $$
  select qr.user_id, p.full_name, p.department, p.roll_number, count(*)::int, sum(qr.points_awarded)::int,
         sum(greatest(0, floor(extract(epoch from (qr.first_accepted_at - coalesce(c.unlocked_at, c.unlock_at, ev.starts_at, c.created_at))) / 60)))::int,
         sum(qr.wrong_count)::int, max(qr.first_accepted_at)
  from public.question_results qr
  join public.questions q on q.id = qr.question_id
  join public.challenges c on c.id = q.challenge_id
  join public.profiles p on p.id = qr.user_id
  cross join public.event_config ev
  where qr.first_accepted_at is not null and p.is_active and p.role = 'student' and (p_challenge is null or c.id = p_challenge)
  group by qr.user_id, p.full_name, p.department, p.roll_number
  order by qr.user_id
$$;

------------------------------------------------------------------ announcements + judge event log
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 1 and 120),
  body text not null default '' check (length(body) <= 2000),
  pinned boolean not null default false, published boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now());
create index if not exists announcements_created_idx on public.announcements (pinned desc, created_at desc);
alter table public.announcements enable row level security;
drop policy if exists "read published announcements" on public.announcements;
drop policy if exists "admin all announcements" on public.announcements;
create policy "read published announcements" on public.announcements for select to authenticated
  using (published and public.is_active_user());
create policy "admin all announcements" on public.announcements for all using (public.is_admin()) with check (public.is_admin());

create table if not exists public.judge_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  kind text not null, user_id uuid, code text not null, detail text);
create index if not exists judge_events_at_idx on public.judge_events (at desc);
alter table public.judge_events enable row level security;
drop policy if exists "admin read judge_events" on public.judge_events;
create policy "admin read judge_events" on public.judge_events for select using (public.is_admin());
-- Inserts come only from the Edge Functions (service role bypasses RLS).

------------------------------------------------------------------ tighter access rules for run/submit (deadlines, pause, disabled accounts)
drop policy if exists "read open questions" on public.questions;
create policy "read open questions" on public.questions for select to authenticated using (
  public.is_admin() or (public.is_active_user() and exists (
    select 1 from public.challenges c where c.id = challenge_id and public.challenge_open(c))));

create or replace function public.check_question_access(p_user uuid, p_question uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare q public.questions; ch public.challenges; adm boolean; act boolean; ev public.event_config;
begin
  select * into q from public.questions where id = p_question;
  if not found then raise exception 'not_found'; end if;
  select * into ch from public.challenges where id = q.challenge_id;
  select (role = 'admin'), is_active into adm, act from public.profiles where id = p_user;
  if not found then raise exception 'disabled'; end if;
  if not adm then
    select * into ev from public.event_config where id = 1;
    if not act then raise exception 'disabled'; end if;
    if not public.challenge_open(ch) then raise exception 'locked'; end if;
    if ch.closes_at is not null and ch.closes_at <= now() then raise exception 'closed'; end if;
    if ev.starts_at is not null and ev.starts_at > now() then raise exception 'event_not_started'; end if;
    if ev.ends_at is not null and ev.ends_at <= now() then raise exception 'event_ended'; end if;
    if not ev.submissions_open then raise exception 'submissions_closed'; end if;
  end if;
  return jsonb_build_object('languages', to_jsonb(q.languages), 'time_limit_ms', q.time_limit_ms, 'memory_limit_kb', q.memory_limit_kb);
end $$;

-- Same as 0004 except: judge faults (internal_error) no longer consume the cooldown, so a student can retry at once.
create or replace function public.begin_submission(p_user uuid, p_question uuid, p_language text, p_code text, p_cooldown_s int default 10)
returns jsonb language plpgsql security definer set search_path = public as $$
declare acc jsonb; sid uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));
  acc := public.check_question_access(p_user, p_question);
  if not (acc->'languages') ? p_language then raise exception 'language_not_allowed'; end if;
  if octet_length(p_code) > 65536 then raise exception 'too_large'; end if;
  if exists (select 1 from public.submissions where user_id = p_user and created_at > now() - make_interval(secs => p_cooldown_s)
             and coalesce(verdict, '') <> 'internal_error') then raise exception 'cooldown'; end if;
  insert into public.submissions (user_id, question_id, language, code, status) values (p_user, p_question, p_language, p_code, 'queued') returning id into sid;
  return jsonb_build_object('id', sid, 'time_limit_ms', acc->'time_limit_ms', 'memory_limit_kb', acc->'memory_limit_kb');
end $$;

------------------------------------------------------------------ admin monitoring (all check is_admin() inside)
create index if not exists submissions_verdict_created_idx on public.submissions (verdict, created_at desc);
create index if not exists submissions_question_created_idx on public.submissions (question_id, created_at desc);

create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'participants', (select count(*) from public.profiles where role = 'student'),
    'enabled_accounts', (select count(*) from public.profiles where role = 'student' and is_active),
    'roster_total', (select count(*) from public.roster),
    'roster_activated', (select count(*) from public.roster where status = 'active'),
    'active_30m', (select count(distinct user_id) from public.submissions where created_at > now() - interval '30 minutes'),
    'submissions', (select count(*) from public.submissions),
    'judged', (select count(*) from public.submissions where verdict is not null),
    'accepted', (select count(*) from public.submissions where verdict = 'accepted'),
    'failed', (select count(*) from public.submissions where verdict in ('wrong_answer','runtime_error','time_limit_exceeded','compilation_error')),
    'judge_errors', (select count(*) from public.submissions where verdict = 'internal_error'),
    'pending', (select count(*) from public.submissions where verdict is null and created_at > now() - interval '10 minutes'),
    'stuck', (select count(*) from public.submissions where verdict is null and created_at <= now() - interval '10 minutes'),
    'last_hour', (select count(*) from public.submissions where created_at > now() - interval '1 hour'),
    'judge_events_24h', (select count(*) from public.judge_events where at > now() - interval '24 hours'),
    'verdicts', (select coalesce(jsonb_object_agg(verdict, n), '{}'::jsonb) from
                  (select verdict, count(*) n from public.submissions where verdict is not null group by verdict) v));
end $$;

create or replace function public.admin_submissions(p_user uuid default null, p_question uuid default null, p_challenge uuid default null,
                                                    p_verdict text default null, p_limit int default 50, p_offset int default 0)
returns table (id uuid, created_at timestamptz, user_id uuid, full_name text, roll_number text, question_id uuid, question_title text,
               day_number int, language text, verdict text, passed int, total int, time_ms int, message text, total_count bigint)
language sql stable security definer set search_path = public as $$
  select s.id, s.created_at, s.user_id, p.full_name, p.roll_number, s.question_id, q.title, c.day_number, s.language, s.verdict,
         s.passed, s.total, s.time_ms, s.message, count(*) over ()
  from public.submissions s
  join public.profiles p on p.id = s.user_id
  join public.questions q on q.id = s.question_id
  join public.challenges c on c.id = q.challenge_id
  where public.is_admin()
    and (p_user is null or s.user_id = p_user) and (p_question is null or s.question_id = p_question)
    and (p_challenge is null or c.id = p_challenge)
    and (p_verdict is null or (p_verdict = 'pending' and s.verdict is null) or s.verdict = p_verdict)
  order by s.created_at desc
  limit least(greatest(p_limit, 1), 200) offset greatest(p_offset, 0)
$$;

create or replace function public.admin_question_stats()
returns table (question_id uuid, title text, day_number int, points int, submissions bigint, accepted bigint, solvers bigint, judge_errors bigint)
language sql stable security definer set search_path = public as $$
  select q.id, q.title, c.day_number, q.points, count(s.id), count(s.id) filter (where s.verdict = 'accepted'),
         count(distinct s.user_id) filter (where s.verdict = 'accepted'), count(s.id) filter (where s.verdict = 'internal_error')
  from public.questions q join public.challenges c on c.id = q.challenge_id left join public.submissions s on s.question_id = q.id
  where public.is_admin()
  group by q.id, q.title, c.day_number, q.points, q.created_at order by c.day_number, q.created_at
$$;

-- Marks submissions that never got a verdict (function crashed mid-judging) as judge errors. Not penalised, not scored.
create or replace function public.sweep_stuck_submissions(p_minutes int default 10) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  update public.submissions set verdict = 'internal_error', status = 'judged', message = 'Judging did not complete. Please resubmit.'
  where verdict is null and created_at <= now() - make_interval(mins => greatest(p_minutes, 1));
  get diagnostics n = row_count; return n;
end $$;

------------------------------------------------------------------ privileges
do $$
declare f text;
begin
  -- service-role only
  foreach f in array array['verify_activation(text,text)', 'finish_activation(uuid,uuid)', 'standings_facts(uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  -- signed-in callers; each function checks is_admin() itself
  foreach f in array array['import_roster(jsonb)', 'generate_activation_codes(uuid[])', 'set_participant_active(uuid,boolean)', 'recompute_results()',
      'admin_overview()', 'admin_submissions(uuid,uuid,uuid,text,int,int)', 'admin_question_stats()', 'sweep_stuck_submissions(int)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
