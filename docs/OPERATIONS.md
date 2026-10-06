# Operations: stable judge hosting, load testing, event day

Nothing here has been run against your live infrastructure; treat figures as things to *measure*, not promises.

## 1. Moving from the Cloudflare Quick Tunnel to a stable judge host
The quick tunnel URL changes on restart and has no uptime guarantee. The judge needs a machine that is always on and a URL that never changes. The application code does not change: you only change the `PISTON_URL` secret.

| Option | Stable URL | Cost / catch |
|---|---|---|
| **A. College/lab Linux server** (Docker, public IP or reverse proxy) | Your domain, HTTPS via Caddy (put the domain in `infra/piston/Caddyfile` instead of `:8080`; ports 80/443 open) | Best for event day. Needs IT help for the domain and firewall. |
| **B. Cloudflare *named* tunnel** (`cloudflared`) | Yes, a hostname on a domain you control | Needs a domain managed in Cloudflare (a domain is usually not free). Free tunnel plan; verify current terms. |
| **C. Tailscale Funnel** | Yes, a stable `*.ts.net` HTTPS URL | Verify current free-plan terms/limits yourself before relying on it. |
| A Windows laptop | Any of the above | Not recommended for event day: sleep, updates and Docker Desktop startup are risks. If unavoidable: disable sleep, keep it plugged in, start Docker/cloudflared at boot, and rehearse a reboot. |

**Migration steps (any option)**
1. Provision the host (Linux, Docker, cgroup v2: `docker run --rm --privileged alpine stat -fc %T /sys/fs/cgroup` must print `cgroup2fs`).
2. Copy `infra/piston/`, create `.env` with a NEW long `JUDGE_TOKEN`, `docker compose up -d`, `node scripts/piston-setup.mjs`.
3. From your PC: set `PISTON_URL` (the new public URL) and `PISTON_TOKEN`, then `npm run verify:judge -- --bench`. All checks must pass; note jobs/s.
4. `supabase secrets set --env-file supabase/functions/.env` with the new URL/token. No redeploy needed.
5. Submit a real C and a Python solution through the app; check Monitoring shows them judged.
6. Stop the quick tunnel. **Rollback** = put the old URL back in the secret.
Keep `restart: unless-stopped` (already in the compose file), make Docker start at boot, put the host on a UPS if you can, and never expose port 2000 (only the token-protected proxy).

## 2. Capacity: how to size it (measure, don't guess)
Each test case of a submission is one Piston job (C also recompiles each time).
`jobs per second needed = submissions per second at peak x test cases per question`.
`npm run verify:judge -- --bench` prints the jobs/s your host actually sustains. You want measured capacity comfortably above the need (2x is a sensible margin). Raise `JUDGE_MAX_JOBS` only up to your CPU core count; wall-clock time limits give false Time Limit Exceeded when the machine is oversubscribed.
Other limits to check in your Supabase dashboard: Edge Function invocation limits for your plan, and **Authentication -> Rate limits**: many students on one campus network share one IP and may hit the per-IP sign-in limit when logging in together. Raise it or stagger logins.

## 3. Load testing
`scripts/load-test.ts` (needs real credentials; I could not run it). Use a **separate Supabase project** or clean up afterwards: the submissions are real and scored.
1. Create ~50-300 test students (import a roster, generate codes, activate, or create Auth users) and one test question with a known-correct solution and 3-5 test cases.
2. Put `roll,password` lines in a file (do not commit it).
3. Ramp: 10 -> 50 -> 100 -> 300 users. PowerShell example:
```powershell
$env:SUPABASE_URL="https://xxxx.supabase.co"; $env:SUPABASE_ANON_KEY="..."; $env:LOAD_ACCOUNTS="C:\secure\load-accounts.csv"
$env:LOAD_QUESTION_ID="<uuid>"; $env:LOAD_LANG="python"; $env:LOAD_SOURCE_FILE="C:\secure\solution.py"; $env:LOAD_USERS="50"; $env:LOAD_ROUNDS="2"
node --experimental-strip-types --no-warnings scripts/load-test.ts
```
4. Watch: the script's latency percentiles and outcome counts, the Monitoring page (judge errors, stuck), and `docker stats` on the judge host.
5. Suggested pass criteria (adjust to taste): p95 under ~10 s, zero `http_5xx` / `judge_unavailable` / `network`, every request ends in a verdict. If it fails: lower `JUDGE_CONCURRENCY`/`JUDGE_MAX_JOBS` mismatch, add cores, or add a second judge host (needs a small adapter change: not built).
6. Afterwards delete the test data and run **Recompute scores**.
Do not claim the platform supports N simultaneous participants until a run at N has passed. The leaderboard endpoint is cached (~10 s) so it scales differently from submissions; test it too by opening it from many accounts.

## 4. Security configuration reminders
- Edge Functions are deployed with `--no-verify-jwt`; every function except `activate` authenticates the caller itself (`auth.getUser`), and `activate` is public by design, protected by one-time codes + lockout. Do not remove those checks.
- Set `ALLOWED_ORIGINS=https://your-site` once the site has its final address.
- `SUPABASE_SERVICE_ROLE_KEY` exists only inside Edge Functions. Never put it in `.env`/`VITE_*`.
- CSV exports contain personal data (roll numbers, emails, results). Store/share them accordingly; activation-code CSVs are secrets until used.
- Rotate `JUDGE_TOKEN` after the event.

## 5. Event-day checklist
**Day before**
- [ ] Migration 0005 applied; `supabase/checks/competition_checks.sql` printed ALL CHECKS PASSED (on a dev project or after backing up)
- [ ] Functions deployed: `run submit leaderboard activate`; secrets set (`PISTON_URL`, `PISTON_TOKEN`, `ALLOWED_ORIGINS`)
- [ ] Stable judge host live; `npm run verify:judge -- --bench` all PASS; bench jobs/s noted
- [ ] Load test passed at your target size; test data deleted, scores recomputed
- [ ] Roster imported, activation codes generated and handed out, a few students activated and signed in end-to-end
- [ ] Challenges created with release/close times; every question has test cases (the manager warns if not); sample solution accepted via the real app
- [ ] Event settings: name, dates, penalty, rules, announcement posted; submissions open
- [ ] Admin accounts tested (two admins), backups: export participants CSV
**Start of event**
- [ ] Judge host healthy (`docker compose ps`), disk/CPU normal
- [ ] Monitoring page open: judge errors 0, stuck 0
- [ ] Post "Event started" announcement
**During**
- [ ] Watch Monitoring (verdict mix, judge errors, active students); "Resolve stuck submissions" if any appear
- [ ] To pause everything: Event control -> untick Submissions open -> Save (students see why)
**After**
- [ ] Close challenges, export results/leaderboard/submissions CSVs, rotate `JUDGE_TOKEN`, stop the judge host
