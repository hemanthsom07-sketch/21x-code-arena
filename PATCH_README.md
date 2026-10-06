# 21X final patch: competition management, scoring, monitoring, security

A **patch**: extract it over your existing project (it adds 39 files and replaces 16; see `MANIFEST.md`). It is based on the project as of `acm-platform-complete.zip`. If you edited any of the 16 replaced files locally, commit first and compare with `git diff` after applying.

## Apply (Windows PowerShell, from the project root)
```powershell
git add -A; git commit -m "before 21x final patch"            # lets you diff/revert
Expand-Archive -Path .\21x-final-updates.zip -DestinationPath . -Force
# No new npm dependencies. Optional: add to package.json "scripts":
#   "load:test": "node --experimental-strip-types --no-warnings scripts/load-test.ts"

# 1. Database (Supabase SQL editor): run supabase\migrations\0005_competition.sql   (after 0001-0004; safe to re-run)
# 2. Optional but recommended on a DEV project: run supabase\checks\competition_checks.sql -> must end with "ALL CHECKS PASSED" (rolls back)
# 3. Functions (ORDER MATTERS: migration first):
copy supabase\functions\.env.example supabase\functions\.env     # only if you don't already have .env; add ALLOWED_ORIGINS=https://your-site when known
supabase secrets set --env-file supabase/functions/.env
supabase functions deploy run submit leaderboard activate --no-verify-jwt
# 4. Check and run the app
npm test; npm run typecheck; npm run build; npm run dev
```
Keep your existing `PISTON_URL` / `PISTON_TOKEN` secrets. Your existing admin account keeps working (new profile columns default sensibly; existing students stay enabled).
Rollback: restore the 16 files from git; the migration is additive and its extra tables/policies are harmless to the old code.

## 1. Features completed
- **Participants**: CSV import (required fields, format checks, duplicate roll/email detection inside the file and against existing, preview, per-row errors, downloadable error report, chunked import with per-row results, safe to re-run); searchable list; details; enable/disable; export; sample template at `/participants-template.csv`.
- **Accounts without passwords in a CSV**: organizers generate **one-time activation codes** (stored only as SHA-256 hashes, shown once as a CSV download); the student opens `/activate`, enters roll number + code, and **chooses their own password**. 5 wrong codes lock that roll number for 15 minutes.
- **Scoring + leaderboard**: points per question, rounds = challenges, penalty and tie-break rules in `docs/SCORING_AND_RULES.md`; trusted DB trigger records facts, tested TypeScript applies the ranking; overall and per-round boards; cached ~10 s; auto-refresh; admin results CSV export.
- **Monitoring**: totals, active students, accepted/failed, verdict chart, in-flight/stuck, judge-failure log, per-question stats, filterable submissions (round/verdict/participant) with code + per-test inspection, CSV export, "resolve stuck" and "recompute scores".
- **Challenge management**: edit/delete challenges, schedule release **and closing**, unlock/lock/close/reopen; question/test-case validation before saving; students cannot read unreleased challenges or submit after closing.
- **Student dashboard**: score, rank, announcements, schedule/deadlines, per-challenge solved counts, submission history page, clear loading/empty/error states.
- **Event control**: name, dates, penalty, rules, leaderboard visibility, **pause/resume submissions** (with confirmation), announcements (publish/hide/pin/delete).
- **Editor paste/drop guard**: multi-line or large pastes and external drag-and-drop are blocked inside the code editor only (details in section 8).
- **Reliability**: judge faults are recorded, logged and never penalised, and don't consume the student's cooldown (instant retry); unexpected failures after a submission is created finish it as a judge error instead of leaving it queued; "stuck" sweeper; request validation (UUIDs, sizes).

## 2. Already present and preserved
Login/roles, Monaco editor, C/Python run + submit, hidden-test judging, Piston + proxy setup, submission history on question pages, question/test-case manager and CSV/JSON question import, challenge unlocking, existing data and relationships (migration is additive; new constraints are `NOT VALID` so old rows are untouched).

## 3. Database changes
Migration `0005_competition.sql` (apply it): new tables `event_config`, `roster`, `question_results`, `announcements`, `judge_events`; new columns `profiles.{email,department,year,is_active,activated_at}`, `challenges.closes_at`; trigger `submissions_apply_result`; RPCs `import_roster`, `generate_activation_codes`, `set_participant_active`, `recompute_results`, `admin_*`, `sweep_stuck_submissions`; service-only `verify_activation`, `finish_activation`, `standings_facts`; replaced `check_question_access`, `begin_submission` (same signatures) and the `questions` read policy.

## 4. Security review: what I checked and changed
- **`--no-verify-jwt`**: I inspected the flow. `run`, `submit`, `leaderboard` call `auth.getUser(token)` themselves and return 401 for missing/invalid/anon tokens; `activate` is public by design (students have no account yet) and relies on one-time codes + lockout + generic error messages. So the flag is acceptable *because of those checks*; do not remove them. It is also required for CORS preflight.
- **New**: CORS allow-list (`ALLOWED_ORIGINS`), 256 KB body cap, POST-only, UUID validation, judge errors logged as messages only (never bodies, tokens or passwords).
- **Access control**: disabled students are blocked by RLS (no question content) and by the access check (no run/submit); deadlines, event window and pause are enforced in the database for Run and Submit; students cannot read the roster, test cases, others' submissions or results, cannot write scores/config, cannot call privileged functions (enforced by privileges, linted by `tests/migrations.test.ts`, verified by the SQL check script).
- **Score integrity**: scores come from a trigger on server-set verdicts; the browser can't submit or alter them; `recompute_results` rebuilds them from submissions.
- **Exports**: CSV cells starting with `= + - @` are neutralised against formula injection.
- **Honest gaps**: a disabled student's existing login session stays valid until it expires (their data access is cut, but the Auth user is not banned); hidden tests can still be probed through repeated verdicts (cooldown only slows this); the leaderboard shows names/departments to all students (switchable off); activation-code CSVs are sensitive until used.

## 5. Test results (what was actually run)
| Check | Result |
|---|---|
| `npm test` (node:test, serial) x2 on Linux with gcc + Python, after the final change | **125 passed, 0 failed, 0 skipped**, each run (15 are the new editor-guard tests) |
| Baseline before my changes (the 49-test suite you had) | 49/49 |
| `tsc -b` with your real `node_modules` | pass |
| Backend modules, strict `tsc` | pass |
| esbuild production **bundle check** of the whole app (all imports resolve, JSX compiles) | pass, 492 KB total |
| **`vite build` / `npm run build`** | **NOT run**: your `node_modules` has only Windows binaries. The `tsc -b` half passes; run the full build on Windows. |
| SQL migration, triggers, RLS | **NOT executed** (no Postgres here). Covered by a static lint (`tests/migrations.test.ts`) and the self-check `supabase/checks/competition_checks.sql` for you to run. |
| Edge Functions on Deno/Supabase, Auth flows, tunnel/Piston live, load | **NOT tested live.** Handler logic is unit-tested with fakes; `scripts/load-test.ts` is untested against a real project. |
| Windows behaviour of the test helper | Not verified by me (Linux only). |
Tested: CSV validation (20 cases incl. duplicates, malformed, BOM), CSV export/injection, scoring/ties/penalties, leaderboard privacy/access/caching, activation (lockout path, rollback, no password leakage), challenge scheduling, form validation, error mapping, judge-failure logging. One real bug found and fixed on the way: the test runner raced (EPIPE) when a program exits without reading its input; it failed about 1 run in 5 before the fix and 0 of 15 after.

## 6. Remaining limitations
Not live-tested (above); one judge host only (no failover); scoring uses the verdict time order (no re-judging); deleting a question/challenge that has submissions is refused by design; Auth sign-in rate limits per IP may throttle a lab logging in at once (check Supabase Auth rate limits); Piston wall-clock limits can give false TLEs on an oversubscribed host; no claim of capacity for thousands of users until you load-test (`docs/OPERATIONS.md`).

## 7. Checklists
Deployment and event-day checklists are in `docs/OPERATIONS.md` section 5; stable-hosting migration is section 1.

## 8. Editor paste / drop guard (added before finalizing)
**Behaviour (code editor only):**
- **Paste blocked** when the clipboard text contains a line break (one trailing line break is tolerated) or is longer than 200 characters. Short single-line pastes (a variable name, an `#include` line, an expression) still work.
- **Drag-and-drop blocked**: text or files dropped onto the editor are refused (no insertion, no file navigation).
- A short amber notice under the editor explains why for 5 seconds.
- **Unchanged**: typing, selection, deletion, Tab/indentation, autocomplete, undo/redo, Monaco's own move-selection-by-dragging, Run, Submit, drafts. The problem statement, Custom Input box and every other page keep normal copy/paste (the listeners are attached to the editor's own element only).
- How: capture-phase listeners on the editor element stop `paste`/`drop` before Monaco sees them; `editor.onDidPaste` undoes any oversized paste that slips past (e.g. a context-menu path); Monaco's `dropIntoEditor` is disabled. Logic: `src/lib/editorGuards.ts`.
- Side effect to know: copying several lines of your *own* code and pasting them back is blocked too (the editor cannot tell the source). Copy one line, or use the editor's Copy Line Down (Shift+Alt+Down).

**Tested:** the paste rule and the installed listeners (synthetic events: blocking, pass-through, capture phase, cleanup, scope), the wiring into `CodeWorkspace`, and that nothing outside the editor imports the guard. Mutation checks confirmed the tests fail if blocking or cleanup is removed.
**NOT tested in a real browser with the real Monaco** (none available to me). Please verify manually, in Chrome and Edge:
1. Copy 3 lines of code from anywhere, paste into the editor: nothing is inserted, amber notice appears. Same via right-click Paste and Shift+Insert.
2. Paste `int x = 5;` (single line): it is inserted. Type normally; use Tab, autocomplete, undo/redo, Run and Submit.
3. Drag selected text from the problem statement onto the editor: not allowed cursor, nothing inserted. Drag a file onto it: nothing happens, the page does not navigate.
4. Select text inside the editor and drag it elsewhere in the editor: it still moves (if it does not, tell me).
5. Copy text from the problem statement and paste into Custom Input: works.
**Limits:** this discourages pasting a whole solution; it is not a security boundary. Someone can still type code from another screen or device, or tamper with the page. Combine it with the Phase 5 monitoring if integrity matters.
