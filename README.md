# 21X — The Code Arena

Coding-competition platform for the ACM Student Chapter, Global Academy of Technology.
React + TypeScript + Vite + Tailwind, Supabase (Postgres, Auth, Edge Functions), Monaco editor, and a self-hosted **Piston** code-execution engine (free, no API key).

## Status
| Area | State |
|---|---|
| Student/admin login, role-gated routes, RLS | Implemented (Phase 1) |
| Challenges (Day 1-21), manual + scheduled unlock, question/test-case manager, CSV/JSON import | Implemented (Phase 2) |
| Student question pages, Monaco editor (C/Python), Run (custom stdin), Submit, verdicts, submission history | Implemented (Phase 3) |
| Judging: Edge Functions `run`/`submit` -> engine adapter (Piston default, Judge0 optional) | Implemented; **verified only against a mock**, see below |
| Scoring, leaderboard, focus-loss monitoring, copy/paste restrictions, fun challenges, admin submission viewer | **Not built** (Phases 4-5) |

## Layout
```
src/                      React app (pages/student, pages/admin, lib)
supabase/migrations/      0001-0004 (apply in order)
supabase/functions/       Edge Functions run + submit; _shared/ = judging logic, Piston/Judge0 adapters
infra/piston/             docker-compose.yml (Piston + Caddy auth proxy), Caddyfile
scripts/                  piston-setup.mjs (install runtimes), verify-judge.ts (live engine checks)
tests/                    node:test suite (+ test-only local runner and mock Piston)
```

## Windows quick start
Requires Node 22.6+ (tests use `--experimental-strip-types`).
```powershell
npm install
copy .env.example .env            # fill VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run typecheck
npm run build
npm run dev                       # http://localhost:5173
```
Database: apply `supabase/migrations/0001..0004` in the Supabase SQL editor. Make an admin with
`update public.profiles set role='admin' where id='<auth-user-uuid>';`. Students log in with `<rollno>@students.acm-event.local` accounts.

### Tests
The execution tests compile and run real C and Python on your machine (unsandboxed, test-only), so they need a C compiler and Python 3:
```powershell
winget install -e --id BrechtSanders.WinLibs.POSIX.UCRT
winget install -e --id Python.Python.3.12
# open a NEW terminal, then:
npm test
npm run diagnose:toolchain        # only if tests fail on gcc/Python: prints exactly what the tools do
```
`npm test` runs files one at a time (Windows compiles slowly when run in parallel). If a tool is missing you get one clear failure from `tests/toolchain.test.ts` and the tests that need it are listed as **skipped**; that is not a pass.

### Code execution (Piston) and deployment
See **PHASE3_FREE_JUDGE.md**: Docker setup, runtime install, live verification (`npm run verify:judge`), Supabase secrets and `supabase functions deploy`.

## Security notes
- `.env` and `supabase/functions/.env` are git-ignored; never commit them. Only the Supabase *anon* key belongs in the frontend.
- Hidden test cases are unreachable by students (RLS gives them no access to `test_cases`; only Edge Functions read them).
- Piston has no authentication: only the Caddy proxy (token-protected, `POST /api/v2/execute` only) may be exposed, never Piston's port.
