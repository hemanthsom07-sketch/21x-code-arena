-- Self-check for migrations 0001-0005. NOT executed by me (no Postgres in my environment): run it yourself.
-- Paste into the Supabase SQL editor and run. Everything happens in ONE transaction that is ROLLED BACK at the end, so no data is left behind.
-- Expected: a final notice "ALL CHECKS PASSED". Any failure raises "CHECK FAILED: ..." naming the broken rule.
-- Run it on a development project first. It temporarily edits event_config/challenges inside the transaction only.
begin;

create or replace function pg_temp.expect(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'CHECK FAILED: %', msg; end if; end $$;

create or replace function pg_temp.raises(stmt text, expected text) returns void language plpgsql as $$
begin
  begin execute stmt;
  exception when others then
    if sqlerrm like '%' || expected || '%' then return; end if;
    raise exception 'CHECK FAILED: [%] raised "%" but "%" was expected', stmt, sqlerrm, expected;
  end;
  raise exception 'CHECK FAILED: [%] did not raise "%"', stmt, expected;
end $$;

-- inserts a submission and then sets its verdict, exactly like the judge does (the scoring trigger fires on the verdict update)
create or replace function pg_temp.judged(u uuid, q uuid, v text, at timestamptz) returns void language plpgsql as $$
declare sid uuid := gen_random_uuid();
begin
  insert into public.submissions (id, user_id, question_id, language, code, status, created_at) values (sid, u, q, 'c', 'x', 'queued', at);
  update public.submissions set verdict = v, status = 'judged' where id = sid;
end $$;

do $$
declare
  adm uuid := gen_random_uuid(); s1 uuid := gen_random_uuid(); s2 uuid := gen_random_uuid(); s3 uuid := gen_random_uuid(); s4 uuid := gen_random_uuid();
  ch uuid; ch2 uuid; q uuid; q2 uuid; t0 timestamptz := now() - interval '1 hour'; n int; r record; code text; res jsonb;
  before_n bigint; before_sum bigint; after_n bigint; after_sum bigint; roster_id uuid;
  c_tc int; c_roster int; c_events int; c_other_subs int; c_own_subs int; c_other_res int; c_q_open int; c_q_locked int; c_ann int; c_role int; c_cfg int; c_disabled int;
  blocked_insert boolean := false; blocked_facts boolean := false; blocked_verify boolean := false; blocked_import boolean := false;
begin
  insert into auth.users (id, email) values (adm, 'adm@check.local'), (s1, 's1@check.local'), (s2, 's2@check.local'), (s3, 's3@check.local'), (s4, 's4@check.local');
  update public.profiles set role = 'admin', full_name = 'Check Admin' where id = adm;
  update public.profiles set full_name = 'Student One', roll_number = 'CHK1' where id = s1;
  update public.profiles set full_name = 'Student Two', roll_number = 'CHK2' where id = s2;
  insert into public.challenges (day_number, title, is_unlocked) values (1, 'check open', true) returning id into ch;
  insert into public.challenges (day_number, title, is_unlocked) values (2, 'check locked', false) returning id into ch2;
  insert into public.questions (challenge_id, title, statement, difficulty, points) values (ch, 'q', 's', 'easy', 100) returning id into q;
  insert into public.questions (challenge_id, title, statement, difficulty, points) values (ch2, 'q-locked', 's', 'easy', 50) returning id into q2;
  insert into public.test_cases (question_id, input, expected_output) values (q, '1', '2');

  ---------------------------------------------------------------- scoring facts
  perform pg_temp.judged(s1, q, 'wrong_answer', t0 + interval '1 min');
  perform pg_temp.judged(s1, q, 'compilation_error', t0 + interval '2 min');          -- not penalised
  perform pg_temp.judged(s1, q, 'internal_error', t0 + interval '3 min');             -- judge fault: not penalised
  perform pg_temp.judged(s1, q, 'time_limit_exceeded', t0 + interval '4 min');
  perform pg_temp.judged(s1, q, 'accepted', t0 + interval '5 min');                   -- first accepted: scores
  perform pg_temp.judged(s1, q, 'accepted', t0 + interval '6 min');                   -- duplicate accepted: changes nothing
  perform pg_temp.judged(s1, q, 'wrong_answer', t0 + interval '7 min');               -- after acceptance: ignored
  select * into r from public.question_results where user_id = s1 and question_id = q;
  perform pg_temp.expect(r.first_accepted_at = t0 + interval '5 min', 'first accepted time is the FIRST acceptance');
  perform pg_temp.expect(r.points_awarded = 100, 'points awarded once');
  perform pg_temp.expect(r.wrong_count = 2, 'only wrong_answer + time_limit before acceptance are penalised (got ' || r.wrong_count || ')');
  perform pg_temp.judged(s2, q, 'compilation_error', t0 + interval '1 min'); perform pg_temp.judged(s2, q, 'internal_error', t0 + interval '2 min');
  select count(*) into n from public.question_results where user_id = s2; perform pg_temp.expect(n = 0, 'compile errors and judge faults create no scoring facts');
  perform pg_temp.judged(s2, q, 'wrong_answer', t0 + interval '3 min');
  select * into r from public.question_results where user_id = s2 and question_id = q;
  perform pg_temp.expect(r.first_accepted_at is null and r.wrong_count = 1 and r.points_awarded = 0, 'unsolved attempts do not score');
  select * into r from public.standings_facts(null) where user_id = s1;
  perform pg_temp.expect(r.solved = 1 and r.points = 100 and r.wrong_count = 2, 'standings_facts aggregates the solver');
  select count(*) into n from public.standings_facts(null) where user_id = s2; perform pg_temp.expect(n = 0, 'non-solvers are not ranked');

  -- recompute_results must reproduce the trigger's facts exactly
  select count(*), coalesce(sum(points_awarded + wrong_count), 0) into before_n, before_sum from public.question_results where user_id in (s1, s2);
  perform set_config('request.jwt.claims', json_build_object('sub', adm)::text, true);
  perform public.recompute_results();
  select count(*), coalesce(sum(points_awarded + wrong_count), 0) into after_n, after_sum from public.question_results where user_id in (s1, s2);
  perform pg_temp.expect(after_n = before_n and after_sum = before_sum, 'recompute_results reproduces the trigger facts');
  perform set_config('request.jwt.claims', json_build_object('sub', s1)::text, true);
  perform pg_temp.raises('select public.recompute_results()', 'forbidden');

  ---------------------------------------------------------------- access rules (deadline, pause, event window, disabled, locked)
  perform public.check_question_access(s1, q);
  perform pg_temp.raises(format('select public.check_question_access(%L,%L)', s1, q2), 'locked');
  update public.challenges set closes_at = now() - interval '1 minute' where id = ch;
  perform pg_temp.raises(format('select public.check_question_access(%L,%L)', s1, q), 'closed');
  perform public.check_question_access(adm, q);                                        -- admins are exempt
  update public.challenges set closes_at = null where id = ch;
  update public.event_config set submissions_open = false where id = 1;
  perform pg_temp.raises(format('select public.check_question_access(%L,%L)', s1, q), 'submissions_closed');
  update public.event_config set submissions_open = true where id = 1;
  update public.event_config set starts_at = now() + interval '1 hour' where id = 1;
  perform pg_temp.raises(format('select public.check_question_access(%L,%L)', s1, q), 'event_not_started');
  update public.event_config set starts_at = null, ends_at = now() - interval '1 hour' where id = 1;
  perform pg_temp.raises(format('select public.check_question_access(%L,%L)', s1, q), 'event_ended');
  update public.event_config set ends_at = null where id = 1;
  update public.profiles set is_active = false where id = s2;
  perform pg_temp.raises(format('select public.check_question_access(%L,%L)', s2, q), 'disabled');

  ---------------------------------------------------------------- submission gate: cooldown, judge faults free the cooldown
  res := public.begin_submission(s3, q, 'c', 'int main(){}');
  perform pg_temp.raises(format('select public.begin_submission(%L,%L,%L,%L)', s3, q, 'c', 'x'), 'cooldown');
  update public.submissions set verdict = 'internal_error', status = 'judged' where id = (res->>'id')::uuid;
  perform public.begin_submission(s3, q, 'c', 'int main(){}');                         -- retry allowed after a judge fault
  perform pg_temp.raises(format('select public.begin_submission(%L,%L,%L,%L)', s4, q, 'java', 'x'), 'language_not_allowed');
  perform pg_temp.raises(format('select public.begin_submission(%L,%L,%L,%L)', s4, q, 'c', repeat('x', 70000)), 'too_large');

  ---------------------------------------------------------------- row level security as a signed-in student
  insert into public.announcements (title, published) values ('visible', true);
  insert into public.announcements (title, published) values ('hidden', false);
  insert into public.roster (roll_number, full_name, email) values ('RLS001', 'Roster Person', 'rls@check.local');
  perform set_config('request.jwt.claims', json_build_object('sub', s1, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into c_tc from public.test_cases;
  select count(*) into c_roster from public.roster;
  select count(*) into c_events from public.judge_events;
  select count(*) into c_other_subs from public.submissions where user_id <> s1;
  select count(*) into c_own_subs from public.submissions where user_id = s1;
  select count(*) into c_other_res from public.question_results where user_id <> s1;
  select count(*) into c_q_open from public.questions where id = q;
  select count(*) into c_q_locked from public.questions where id = q2;
  select count(*) into c_ann from public.announcements;
  update public.profiles set role = 'admin' where id = s1; get diagnostics c_role = row_count;
  update public.event_config set submissions_open = false; get diagnostics c_cfg = row_count;
  begin insert into public.submissions (user_id, question_id, language, code) values (s1, q, 'c', 'x');
  exception when insufficient_privilege then blocked_insert := true; end;
  begin perform public.standings_facts(null); exception when insufficient_privilege then blocked_facts := true; end;
  begin perform public.verify_activation('X', 'Y'); exception when insufficient_privilege then blocked_verify := true; end;
  begin perform public.import_roster('[]'::jsonb); exception when others then blocked_import := (sqlerrm like '%forbidden%'); end;
  perform set_config('request.jwt.claims', json_build_object('sub', s2, 'role', 'authenticated')::text, true);   -- s2 is disabled
  select count(*) into c_disabled from public.questions;
  execute 'reset role';
  perform pg_temp.expect(c_tc = 0, 'students cannot read test_cases');
  perform pg_temp.expect(c_roster = 0, 'students cannot read the roster');
  perform pg_temp.expect(c_events = 0, 'students cannot read judge_events');
  perform pg_temp.expect(c_other_subs = 0, 'students cannot read others'' submissions');
  perform pg_temp.expect(c_own_subs > 0, 'students can read their own submissions');
  perform pg_temp.expect(c_other_res = 0, 'students cannot read others'' results');
  perform pg_temp.expect(c_q_open = 1, 'open challenge questions are readable');
  perform pg_temp.expect(c_q_locked = 0, 'locked challenge questions are NOT readable');
  perform pg_temp.expect(c_ann = 1, 'students see only published announcements');
  perform pg_temp.expect(c_role = 0, 'students cannot promote themselves');
  perform pg_temp.expect(c_cfg = 0, 'students cannot change event config');
  perform pg_temp.expect(blocked_insert, 'students must not insert submissions directly');
  perform pg_temp.expect(blocked_facts, 'students must not call standings_facts');
  perform pg_temp.expect(blocked_verify, 'students must not call verify_activation');
  perform pg_temp.expect(blocked_import, 'students must not call import_roster');
  perform pg_temp.expect(c_disabled = 0, 'a disabled student reads no question content');

  ---------------------------------------------------------------- roster import + activation workflow
  perform set_config('request.jwt.claims', json_build_object('sub', adm)::text, true);
  res := public.import_roster('[{"roll_number":"act001","full_name":"Act One","email":"Act1@Check.local","department":"CSE","year":"2"},
     {"roll_number":"ACT001","full_name":"Dup Roll","email":"other@check.local"}, {"roll_number":"ACT002","full_name":"Dup Mail","email":"act1@check.local"},
     {"roll_number":"ACT003","full_name":"Bad Mail","email":"nope"}]'::jsonb);
  perform pg_temp.expect((select array_agg(e->>'result') from jsonb_array_elements(res) e) = array['inserted', 'duplicate_roll', 'duplicate_email', 'invalid'], 'import reports every row: ' || res::text);
  select * into r from public.generate_activation_codes((select array_agg(id) from public.roster where roll_number = 'ACT001'));
  code := r.code; perform pg_temp.expect(code ~ '^[0-9A-F]{10}$', 'activation code format');
  perform pg_temp.expect((select code_hash <> code and length(code_hash) = 64 from public.roster where roll_number = 'ACT001'), 'only a SHA-256 hash is stored');
  for i in 1..5 loop res := public.verify_activation('ACT001', 'WRONGCODE1'); perform pg_temp.expect(res->>'ok' = 'false', 'wrong code rejected'); end loop;
  res := public.verify_activation('act001', code); perform pg_temp.expect(res->>'reason' = 'locked', 'correct code is refused while locked out');
  update public.roster set locked_until = null where roll_number = 'ACT001';
  res := public.verify_activation(' act001 ', substr(code, 1, 5) || '-' || substr(code, 6)); perform pg_temp.expect((res->>'ok')::boolean, 'correct code accepted (case/dash/space tolerant)');
  roster_id := (res->>'roster_id')::uuid;
  perform public.finish_activation(roster_id, s4);
  perform pg_temp.expect((select status = 'active' and code_hash is null and user_id = s4 from public.roster where id = roster_id), 'activation consumes the code and links the user');
  perform pg_temp.raises(format('select public.finish_activation(%L,%L)', roster_id, s4), 'not_pending');
  res := public.verify_activation('ACT001', code); perform pg_temp.expect(res->>'ok' = 'false', 'a used code cannot be reused');
  perform pg_temp.expect((select department = 'CSE' and year = 2 and roll_number = 'ACT001' from public.profiles where id = s4), 'profile filled from the roster');
  perform public.set_participant_active(s4, false);
  perform pg_temp.expect((select not is_active from public.profiles where id = s4) and (select status = 'disabled' from public.roster where id = roster_id), 'admin can disable an account');

  raise notice 'ALL CHECKS PASSED';
end $$;

rollback;
