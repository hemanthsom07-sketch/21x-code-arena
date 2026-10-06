-- Phase 3: judging columns, atomic submission gate, run rate-limit. Additive; safe on top of 0001-0003.
alter table public.submissions
  add column if not exists verdict text,
  add column if not exists time_ms int,
  add column if not exists memory_kb int,
  add column if not exists message text,
  add column if not exists results jsonb;   -- sanitized per-test summary (never hidden input/expected output)
alter table public.submissions drop constraint if exists submissions_verdict_check;
alter table public.submissions add constraint submissions_verdict_check check (verdict is null or verdict in
  ('accepted','wrong_answer','compilation_error','runtime_error','time_limit_exceeded','internal_error'));
create index if not exists submissions_user_created_idx on public.submissions (user_id, created_at desc);
-- Phase 4 will use this to find each student's FIRST accepted submission per question.
create index if not exists submissions_first_accept_idx on public.submissions (question_id, user_id, created_at) where verdict = 'accepted';

create table if not exists public.exec_rate (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  last_run_at timestamptz not null default now());
alter table public.exec_rate enable row level security;  -- no policies: service role only

create or replace function public.check_question_access(p_user uuid, p_question uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare q public.questions; ch public.challenges; adm boolean;
begin
  select * into q from public.questions where id = p_question;
  if not found then raise exception 'not_found'; end if;
  select * into ch from public.challenges where id = q.challenge_id;
  select exists(select 1 from public.profiles where id = p_user and role = 'admin') into adm;
  if not adm and not public.challenge_open(ch) then raise exception 'locked'; end if;
  return jsonb_build_object('languages', to_jsonb(q.languages), 'time_limit_ms', q.time_limit_ms, 'memory_limit_kb', q.memory_limit_kb);
end $$;

-- Atomic: per-user advisory lock makes the 10s cooldown race-free under concurrent requests.
create or replace function public.begin_submission(p_user uuid, p_question uuid, p_language text, p_code text, p_cooldown_s int default 10)
returns jsonb language plpgsql security definer set search_path = public as $$
declare acc jsonb; sid uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));
  acc := public.check_question_access(p_user, p_question);
  if not (acc->'languages') ? p_language then raise exception 'language_not_allowed'; end if;
  if octet_length(p_code) > 65536 then raise exception 'too_large'; end if;
  if exists (select 1 from public.submissions where user_id = p_user and created_at > now() - make_interval(secs => p_cooldown_s)) then
    raise exception 'cooldown'; end if;
  insert into public.submissions (user_id, question_id, language, code, status) values (p_user, p_question, p_language, p_code, 'queued') returning id into sid;
  return jsonb_build_object('id', sid, 'time_limit_ms', acc->'time_limit_ms', 'memory_limit_kb', acc->'memory_limit_kb');
end $$;

create or replace function public.touch_run(p_user uuid, p_min_ms int default 3000) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.exec_rate (user_id, last_run_at) values (p_user, now())
  on conflict (user_id) do update set last_run_at = now()
    where public.exec_rate.last_run_at < now() - make_interval(secs => p_min_ms / 1000.0);
  get diagnostics n = row_count; return n > 0;
end $$;

-- Only the Edge Functions (service role) may call these; students cannot invoke them via the API.
revoke all on function public.check_question_access(uuid, uuid) from public, anon, authenticated;
revoke all on function public.begin_submission(uuid, uuid, text, text, int) from public, anon, authenticated;
revoke all on function public.touch_run(uuid, int) from public, anon, authenticated;
grant execute on function public.check_question_access(uuid, uuid) to service_role;
grant execute on function public.begin_submission(uuid, uuid, text, text, int) to service_role;
grant execute on function public.touch_run(uuid, int) to service_role;
