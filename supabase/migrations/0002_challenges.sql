-- Phase 2: challenges, questions, hidden test cases, unlocking, submissions (read side).
create table public.challenges (
  id uuid primary key default gen_random_uuid(),
  day_number int not null check (day_number between 1 and 21),
  title text not null check (length(title) between 3 and 120),
  unlock_at timestamptz,
  is_unlocked boolean not null default false,
  unlocked_by uuid references public.profiles(id),
  unlocked_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.challenges (day_number);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references public.challenges(id) on delete cascade,
  title text not null,
  statement text not null,
  constraints_text text,
  sample_input text, sample_output text,
  difficulty text not null check (difficulty in ('easy','medium','hard')),
  points int not null default 100 check (points > 0),
  languages text[] not null default '{c,python}' check (languages <@ array['c','python']),
  time_limit_ms int not null default 2000, memory_limit_kb int not null default 128000,
  created_at timestamptz not null default now()
);
create index on public.questions (challenge_id);

create table public.test_cases (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  input text not null, expected_output text not null,
  is_hidden boolean not null default true, position int not null default 0
);
create index on public.test_cases (question_id);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  question_id uuid not null references public.questions(id),
  language text not null check (language in ('c','python')),
  code text not null,
  status text not null default 'queued',
  passed int, total int,
  created_at timestamptz not null default now()  -- server clock, not client
);
create index on public.submissions (user_id, question_id, created_at desc);

create or replace function public.challenge_open(c public.challenges) returns boolean
language sql stable as $$ select c.is_unlocked or (c.unlock_at is not null and c.unlock_at <= now()) $$;

alter table public.challenges enable row level security;
alter table public.questions enable row level security;
alter table public.test_cases enable row level security;
alter table public.submissions enable row level security;

-- Challenge metadata (title/day/lock state) is visible so students can see locked cards.
create policy "auth read challenges" on public.challenges for select to authenticated using (true);
create policy "admin write challenges" on public.challenges for all using (public.is_admin()) with check (public.is_admin());

-- Question CONTENT only when the challenge is open (or admin).
create policy "read open questions" on public.questions for select to authenticated using (
  public.is_admin() or exists (select 1 from public.challenges c where c.id = challenge_id and public.challenge_open(c)));
create policy "admin write questions" on public.questions for all using (public.is_admin()) with check (public.is_admin());

-- Test cases: admins only. Students get NO policy, so hidden cases and expected outputs are unreachable.
-- (Sample cases are shown from questions.sample_input/sample_output.)
create policy "admin all test_cases" on public.test_cases for all using (public.is_admin()) with check (public.is_admin());

-- Submissions: students read their own; inserts happen only via the Phase 3 Edge Function (service role).
create policy "read own submissions" on public.submissions for select using (user_id = auth.uid() or public.is_admin());

-- Audited manual unlock (admin-checked inside the function).
create or replace function public.unlock_challenge(cid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  update public.challenges set is_unlocked = true, unlocked_by = auth.uid(), unlocked_at = now() where id = cid;
end $$;
revoke all on function public.unlock_challenge(uuid) from public;
grant execute on function public.unlock_challenge(uuid) to authenticated;
-- Prevent clients from setting unlock audit fields directly is covered by admin-only write policy.
