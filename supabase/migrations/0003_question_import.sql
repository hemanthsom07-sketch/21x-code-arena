-- Phase 2 (part 2): transactional bulk import. Safe to apply on top of 0002. No existing data is changed.
create or replace function public.import_questions(cid uuid, payload jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare q jsonb; t jsonb; qid uuid; n int := 0; pos int;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if not exists (select 1 from public.challenges where id = cid) then raise exception 'challenge not found'; end if;
  if jsonb_typeof(payload) <> 'array' or jsonb_array_length(payload) > 200 then raise exception 'payload must be an array of at most 200 questions'; end if;
  for q in select * from jsonb_array_elements(payload) loop
    insert into public.questions (challenge_id, title, statement, constraints_text, sample_input, sample_output,
      difficulty, points, languages, time_limit_ms, memory_limit_kb)
    values (cid, q->>'title', q->>'statement', q->>'constraints', q->>'sample_input', q->>'sample_output',
      coalesce(q->>'difficulty','easy'), coalesce((q->>'points')::int,100),
      coalesce(array(select jsonb_array_elements_text(q->'languages')), '{c,python}'),
      coalesce((q->>'time_limit_ms')::int,2000), coalesce((q->>'memory_limit_kb')::int,128000))
    returning id into qid;
    pos := 0;
    for t in select * from jsonb_array_elements(coalesce(q->'test_cases','[]'::jsonb)) loop
      insert into public.test_cases (question_id, input, expected_output, is_hidden, position)
      values (qid, coalesce(t->>'input',''), t->>'expected_output', coalesce((t->>'is_hidden')::boolean, true), pos);
      pos := pos + 1;
    end loop;
    n := n + 1;
  end loop;
  return n;  -- any error above rolls back the whole import
end $$;
revoke all on function public.import_questions(uuid, jsonb) from public;
grant execute on function public.import_questions(uuid, jsonb) to authenticated;
