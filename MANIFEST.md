# Manifest: 55 files

Every path is relative to the project root. "modified" files are complete replacements of your existing file.

| File | Change | Purpose |
|---|---|---|
| `docs/OPERATIONS.md` | new | Stable judge hosting, capacity, load testing, event-day checklist. |
| `docs/SCORING_AND_RULES.md` | new | Scoring, penalty, ranking and deadline rules. |
| `public/participants-template.csv` | new | Sample participant CSV template for organizers (placeholder data). |
| `scripts/lib/loadStats.ts` | new | Pure helpers for the load test. |
| `scripts/load-test.ts` | new | Load test against the deployed app (needs your test accounts). |
| `src/App.tsx` | modified (full file) | MODIFIED: new routes (/activate, /leaderboard, /submissions, /admin/event|participants|monitor|results). |
| `src/components/Guards.tsx` | modified (full file) | MODIFIED: role navigation, "account disabled" screen. |
| `src/components/ui.tsx` | new | Shared small UI pieces (loading/error/empty states, pager, date helpers). |
| `src/lib/auth.tsx` | modified (full file) | MODIFIED: carries is_active; disabled students cannot sign in; works before migration 0005 too. |
| `src/lib/challengeState.ts` | new | Locked/upcoming/open/closed logic + why-submissions-are-blocked (UI hint; the database enforces). |
| `src/lib/competitionApi.ts` | new | Calls to the leaderboard and activate Edge Functions with clear failure messages. |
| `src/lib/csv.ts` | new | CSV export (quoting, BOM, CRLF, formula-injection guard, download). |
| `src/lib/editorGuards.ts` | new | Paste/drop guard logic (paste rule: no line breaks, max 200 chars; drops blocked) + listener installer. Browser-free, unit-tested. |
| `src/lib/participants.ts` | new | Participant CSV validation (required fields, formats, duplicates, per-row messages). |
| `src/lib/validation.ts` | new | Question / test-case / challenge / event / announcement validation mirroring DB limits. |
| `src/pages/Activate.tsx` | new | Student account activation page. |
| `src/pages/Dashboards.tsx` | modified (full file) | MODIFIED: now re-exports StudentHome / AdminChallenges (same import path for App.tsx). |
| `src/pages/Login.tsx` | modified (full file) | MODIFIED: "Activate your account" link. |
| `src/pages/admin/AdminChallenges.tsx` | new | Challenge CRUD, scheduling (open/close), unlock/lock/close/reopen, safe delete. |
| `src/pages/admin/AdminEvent.tsx` | new | Event settings (name, dates, penalty, pause, rules, leaderboard visibility) + announcements. |
| `src/pages/admin/AdminMonitor.tsx` | new | Monitoring: overview, verdict chart, per-question stats, filterable submissions + code inspection, judge failures, maintenance actions. |
| `src/pages/admin/AdminParticipants.tsx` | new | Participant import with preview/errors, search, enable/disable, activation codes, CSV export. |
| `src/pages/admin/AdminResults.tsx` | new | Leaderboard for admins + results CSV export. |
| `src/pages/admin/QuestionManager.tsx` | modified (full file) | MODIFIED: validates questions and test cases before saving; time limit capped at 10 s. |
| `src/pages/student/ChallengeViews.tsx` | modified (full file) | MODIFIED: closed-challenge banner, closing time, solved check marks. |
| `src/pages/student/CodeWorkspace.tsx` | modified (full file) | MODIFIED: blocks multi-line/large paste and external drag-and-drop inside the Monaco editor only (typing, autocomplete, Run, Submit unchanged); shows a short notice. |
| `src/pages/student/Leaderboard.tsx` | new | Leaderboard (overall or per round, auto-refresh). |
| `src/pages/student/MySubmissions.tsx` | new | Own submission history with verdict filter and paging. |
| `src/pages/student/StudentHome.tsx` | new | Student dashboard: score, rank, announcements, schedule, challenge status. |
| `supabase/checks/competition_checks.sql` | new | Self-check script (run in the SQL editor; rolls back): scoring trigger, deadlines, RLS as a student, activation lockout. Not run by me. |
| `supabase/functions/.env.example` | modified (full file) | MODIFIED: documents ALLOWED_ORIGINS, LEADERBOARD_CACHE_SECONDS (template only, no secrets). |
| `supabase/functions/_shared/activate.ts` | new | Account activation handler: validation, one-time-code check, password policy, rollback on failure. |
| `supabase/functions/_shared/core.ts` | modified (full file) | MODIFIED: new deadline/pause/disabled error codes, question_id UUID validation, judge-failure event logging. |
| `supabase/functions/_shared/http.ts` | new | Bearer-token parsing, CORS allow-list, bounded JSON body reading, UUID check. |
| `supabase/functions/_shared/leaderboard.ts` | new | Leaderboard handler: access control, caching, student-safe vs admin rows, export. |
| `supabase/functions/_shared/scoring.ts` | new | The ranking rules (penalty, tie-breaks, competition ranking). |
| `supabase/functions/_shared/serve.ts` | modified (full file) | MODIFIED: handles run/submit/leaderboard/activate; per-function auth, CORS allow-list, body-size limit, POST-only. |
| `supabase/functions/_shared/supabaseDb.ts` | modified (full file) | MODIFIED: adds judge-event logging, leaderboard data access (paged), activation data access + auth admin. |
| `supabase/functions/activate/index.ts` | new | Edge Function entry: activate. |
| `supabase/functions/leaderboard/index.ts` | new | Edge Function entry: leaderboard. |
| `supabase/migrations/0005_competition.sql` | new | Migration: profile fields + enable/disable, event_config, challenge closes_at, roster + activation codes, question_results (trusted scoring facts + trigger), announcements, judge_events, tightened access checks (deadline/pause/disabled), admin monitoring RPCs, privileges. Additive; APPLY IT. |
| `tests/activate.test.ts` | new | Activation flow and password policy. |
| `tests/core.test.ts` | modified (full file) | MODIFIED: UUID ids, new error codes, judge-failure logging, C timeout/exit tests, debug switch. |
| `tests/csv.test.ts` | new | CSV export. |
| `tests/editorGuards.test.ts` | new | Tests for the paste rule, the installed listeners (synthetic events), scope (statement unaffected) and wiring. |
| `tests/helpers/localAdapter.ts` | modified (full file) | MODIFIED: fixes a real race (EPIPE when a program exits without reading input) + transient launch retry. |
| `tests/http.test.ts` | new | Auth header, CORS, body limits. |
| `tests/leaderboard.test.ts` | new | Leaderboard access control, privacy, caching. |
| `tests/loadStats.test.ts` | new | Load-test statistics. |
| `tests/migrations.test.ts` | new | Static security lint of the SQL migrations (RLS on every table, privileges, admin checks). |
| `tests/participants.test.ts` | new | Participant CSV validation. |
| `tests/piston.test.ts` | modified (full file) | MODIFIED: UUID ids. |
| `tests/schedule.test.ts` | new | Challenge scheduling + form validation. |
| `tests/scoring.test.ts` | new | Ranking, penalty and tie-break rules. |
| `tests/toolchain.test.ts` | modified (full file) | MODIFIED: regression test that forces the EPIPE case. |

Also in the ZIP: `PATCH_README.md`, `MANIFEST.md`.
Not included on purpose: `package.json` (no new dependencies; see PATCH_README for the optional script), `.env`, `node_modules`, build output.
