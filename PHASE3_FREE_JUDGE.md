# Code execution: self-hosted Piston (free) and how to verify it

## 1. Verification status (read this first)
| Level | What | Status |
|---|---|---|
| **Verified locally** (Linux, real gcc/Python, no isolation) | Judging rules, hidden-data stripping, request flow, verdicts for C and Python (accepted / wrong answer / compile error / runtime error / time limit), run + submit logic | 49 tests passing in my environment |
| **Verified against a mock** | Piston adapter HTTP wiring: request fields, auth header, response mapping, timeouts, concurrency cap, clamp; Judge0 adapter via mocked `fetch` | Passing; the mock is **my emulation of Piston's documented API**, not Piston |
| **NOT verified: needs a live Piston** | Real sandbox isolation, memory limits, network blocking, wall-clock timeouts, runtime package names, `docker-compose.yml`, Caddy proxy, tunnel, Edge Functions on Deno, Supabase deployment, load/capacity | Pending: run section 5 |
| **NOT verified on Windows by me** | The Windows test-helper behaviour (gcc path/DLL handling, CRLF, file cleanup retries) | Written from analysis of your failures; confirm with `npm test` |

## 2. Why Piston
Official Judge0 CE's sandbox needs cgroup v1; Windows/WSL2 uses v2, so it fails there (still supported with `JUDGE_ENGINE=judge0` on a Linux host with cgroup v1). Piston is MIT-licensed, needs no account/key/card, needs cgroup v2 (Docker Desktop/WSL2 has it), supports C + Python, stdin, compile errors, per-run wall-clock timeout and memory limit, networking disabled by default.
Piston has **no authentication** and no batch API, so we add a Caddy proxy (only `POST /api/v2/execute` with a secret token) and a concurrency-capped adapter. `docker-compose.yml` also raises Piston's defaults that would break judging: output cap 1024 B -> 65536 B, max run time 3 s -> 10 s.
Coupling to remember: `PISTON_RUN_TIMEOUT` (compose, 10000) must equal `PISTON_MAX_RUN_TIMEOUT_MS` (Edge Function secret, default 10000); the adapter clamps each question's time limit to it, and the admin form caps time limits at 10000 ms.

## 3. Development vs public deployment
| | Local development | Event day |
|---|---|---|
| Piston runs on | Docker Desktop on your PC | An always-on Linux machine you control (college server/lab PC/VPS), dedicated to judging |
| Supabase reaches it via | Free Cloudflare quick tunnel (no account; URL changes on restart) | Stable HTTPS URL (domain in the Caddyfile for auto-TLS; needs ports 80/443) |
No free cloud VM is assumed (well-known free tiers require a credit card).

## 4. Windows setup (PowerShell, from the project root)
Prereqs: Docker Desktop (WSL2 backend, running), Node 22.6+, Supabase CLI, `winget install Cloudflare.cloudflared`.
```powershell
docker run --rm --privileged alpine stat -fc %T /sys/fs/cgroup     # must print: cgroup2fs

cd infra\piston
copy .env.example .env            # edit: set JUDGE_TOKEN to a long random string
docker compose up -d
cd ..\..

node scripts\piston-setup.mjs     # installs gcc + python runtimes (downloads from GitHub)
```

## 5. Live verification (the part only you can do)
```powershell
$env:PISTON_URL="http://127.0.0.1:8080"; $env:PISTON_TOKEN="<your JUDGE_TOKEN>"
npm run verify:judge -- --bench
curl.exe -i http://127.0.0.1:8080/api/v2/runtimes      # must be 403 (proxy blocks everything but execute)
```
`verify-judge.ts` runs 11 checks: C and Python stdin/stdout, compile error, Python exception, segfault, non-zero exit, **time limit**, **memory limit** (`-- --skip-memory` to skip), **network blocked**, 30,000-char output, Unicode stdin; `--bench` prints jobs/s.
Expected on real Piston: all PASS. Run against the *mock* it fails "Network is blocked" by design (the mock has no sandbox). Send me any FAIL line. Likely causes: runtime names (`PISTON_LANG_C`, `PISTON_LANG_PYTHON`), or an old Piston build without memory/time reporting.

## 6. Supabase configuration and deployment
```powershell
cloudflared tunnel --url http://localhost:8080          # dev only; keep open; copy the https://....trycloudflare.com URL

copy supabase\functions\.env.example supabase\functions\.env
# edit: PISTON_URL = tunnel URL, PISTON_TOKEN = your JUDGE_TOKEN
supabase login
supabase link --project-ref <your-project-ref>
supabase secrets set --env-file supabase/functions/.env
supabase functions deploy run submit --no-verify-jwt
```
`--no-verify-jwt`: the functions authenticate callers themselves (`auth.getUser`) and must answer CORS preflight (which carries no JWT); the gateway check can reject valid sessions on projects with newer signing keys. Unauthenticated calls still get 401 from the function.
Secrets: `JUDGE_ENGINE`, `PISTON_URL`, `PISTON_TOKEN`; optional `JUDGE_CONCURRENCY` (4), `PISTON_HEADERS` (JSON of extra headers), `PISTON_LANG_C` (c), `PISTON_LANG_PYTHON` (python), `PISTON_VERSION_C/PYTHON` (`*`), `PISTON_MAX_RUN_TIMEOUT_MS` (10000), `PISTON_COMPILE_TIMEOUT_MS` (10000), `PISTON_REQUEST_TIMEOUT_MS` (60000). Judge0 alternative: `JUDGE_ENGINE=judge0`, `JUDGE0_URL`, `JUDGE0_HEADERS`.
Not configured => students see a "Setup required" message; nothing runs or is recorded. Changing the tunnel URL only needs `secrets set` again.

## 7. Limitations and risks
- Piston's time limit is **wall-clock**; a busy machine can cause false TLEs. Keep `JUDGE_MAX_JOBS` near your core count.
- Time/memory figures appear only if your Piston version returns them; without `run.status`, TLE vs memory-kill is inferred from SIGKILL + elapsed time.
- C is compiled once per test case (no compile-once API): more CPU per submission.
- Piston's container is privileged: use a dedicated machine. Isolation strength is Piston's (isolate/seccomp/cgroups); I did not audit it.
- Quick tunnels are for development only. Do **not** claim 3,000-student capacity until you load-test (`--bench`, then a real burst test).
- Students can still probe hidden tests via repeated verdicts (the 10 s cooldown only slows it). Monaco loads from a CDN. A submission can stay `queued` only if the function process dies mid-judging.
