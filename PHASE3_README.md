> **Note:** execution now defaults to self-hosted **Piston**. See `PHASE3_FREE_JUDGE.md` (setup, verification status) and `README.md` (tests, scripts).
> The Judge0 notes below remain valid only if you set `JUDGE_ENGINE=judge0`. Test counts/commands in older sections are superseded by `npm test`.

# Phase 3: Code editor and automatic evaluation

Extract this ZIP into your project root. It adds new files and replaces **one** existing file
(`src/pages/student/ChallengeViews.tsx`). `package.json` is intentionally NOT included so your own
dependencies aren't overwritten; run the one install command below.

## Architecture
Browser -> Supabase Edge Function (`run` / `submit`) -> Judge0 (isolated execution).
- Student code is **never** executed in the browser or on your servers; only Judge0 runs it.
- Edge Functions verify the user's JWT, then use the service role to (a) check access rules in SQL, (b) read `test_cases`
  (students have no access to that table), (c) write the submission. Judge0 credentials exist only as Edge Function secrets.
- All provider-specific code is in `supabase/functions/_shared/adapter.ts` (`ExecutionAdapter`). Switching from hosted to
  self-hosted Judge0 = change two secrets, no code change.
- **If Judge0 is not configured**, nothing is executed or recorded and the student sees an amber "Setup required" message.

## Files
**New**
- `supabase/migrations/0004_submissions_verdict.sql`: verdict/time/memory/message/results columns, indexes, `check_question_access`, `begin_submission` (atomic: lock check, language check, 64 KB cap, 10 s cooldown), `touch_run` (3 s run rate-limit), `exec_rate` table. The three functions are callable by `service_role` only.
- `supabase/functions/run/index.ts`, `supabase/functions/submit/index.ts`: entry points.
- `supabase/functions/_shared/`: `adapter.ts` (Judge0 adapter + env config), `judge.ts` (comparison policy, verdicts, summary), `core.ts` (request logic), `supabaseDb.ts`, `serve.ts`.
- `src/pages/student/CodeWorkspace.tsx`: Monaco editor, language selector, Run, Submit, Test Results / Custom Input / Submissions tabs.
- `src/lib/execApi.ts`, `src/lib/verdicts.ts`, `src/lib/starters.ts`.
- `tests/`: `judge.test.ts`, `core.test.ts`, `judge0adapter.test.ts`, `verdicts.test.ts`, `helpers/localAdapter.ts`.

**Modified**
- `src/pages/student/ChallengeViews.tsx`: `QuestionPage` is now a two-column layout (statement | workspace). `ChallengePage` is unchanged.

## Setup
1. `npm install @monaco-editor/react`
2. Apply `supabase/migrations/0004_submissions_verdict.sql` in the Supabase SQL editor (after 0001-0003). Additive only.
3. Set Edge Function secrets (Supabase CLI shown; or Dashboard > Edge Functions > Secrets):
   ```
   supabase secrets set JUDGE0_URL=https://<your-judge0-host>
   supabase secrets set JUDGE0_HEADERS='{"<auth-header-name>":"<value>"}'
   ```
   e.g. RapidAPI-hosted: `JUDGE0_URL=https://judge0-ce.p.rapidapi.com`, headers `{"X-RapidAPI-Key":"...","X-RapidAPI-Host":"judge0-ce.p.rapidapi.com"}`.
   Judge0 CE hosted/self-hosted with token auth: `{"X-Auth-Token":"..."}`.
   Optional: `JUDGE0_LANG_C` (default 50), `JUDGE0_LANG_PYTHON` (default 71), `JUDGE0_TIMEOUT_MS` (default 30000).
   **Verify the language IDs** against your provider's `GET /languages`; they differ between Judge0 versions.
   `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided to Edge Functions automatically. Never put either in a `VITE_` variable.
4. Deploy: `supabase functions deploy run submit`
5. No new frontend environment variables.

## Judging rules
- Compared per test case against `expected_output`: CRLF -> LF, trailing spaces/tabs per line ignored, trailing blank lines ignored. Case-sensitive; leading/internal whitespace significant.
- Submission verdict = most severe per-test verdict (Accepted < Wrong Answer < TLE < Runtime Error < Compilation Error < Judge Error).
- Python syntax errors surface as Runtime Error (Python has no compile step).
- Time/memory limits come from each question (`time_limit_ms`, `memory_limit_kb`) and are enforced by Judge0.
- Students see input/expected/actual **only for tests an admin marked visible**. For hidden tests they see only pass/fail and the test number. Hidden stdout/stderr are withheld too (a program can echo its input).
- Resubmitting after Accepted is allowed. Every submission is stored; Phase 4 should score the **first** Accepted (index `submissions_first_accept_idx` is ready for that). No scoring is implemented here.

## Testing
Run `npm test` (see `README.md`). Verification levels (local / mock / live) are listed in `PHASE3_FREE_JUDGE.md`.

## Known limitations
- A student can still learn about hidden tests indirectly through repeated verdicts (e.g. probing pass/fail). The 10 s cooldown slows this but doesn't prevent it.
- Hosted Judge0 plans have request quotas, batch/time caps and queueing. Check them against ~3,000 students (each submission = one job per test case, plus polling). Self-hosting is likely needed for event day; load-test first.
- Judge0 compiles C once per test case in a batch (slower, more load); acceptable for now.
- A submission row is created before judging; if the function crashes mid-way it stays `queued` and still counts toward the cooldown. Judge-error attempts also use the cooldown.
- Monaco loads from a public CDN by default (needs internet on student machines).
- Copy/paste restrictions and focus monitoring are Phase 5; none are included.
- Drafts are saved per browser (`localStorage`), not synced across devices.
- Edge Function CORS is `*`; access is protected by the JWT check, not by origin.
