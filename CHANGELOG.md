# Changelog (this release: full-project integration and verification)

## Fixed
- **Windows: every C compile failed silently** (7 failing tests). The test helper launched gcc by the name found on PATH. Tools installed by winget (e.g. WinLibs gcc) are symlinks in a `Links` folder; `gcc --version` works through the link but the compiler backend needs DLLs from the *real* install folder, which isn't on PATH, so gcc exited non-zero with no output and the helper reported it as `compilation_error`. The helper now resolves the compiler's real path, puts that folder first on PATH for compile and run, and keeps gcc's temp files in the per-job folder. *(Most probable cause; I could not reproduce it without Windows. If it persists, `npm run diagnose:toolchain` shows the exact failure.)*
- A compiler that exits non-zero with **no diagnostics** is now reported as a test-setup error (with the exit code), never as a student compile error. Compiler/launch failures are no longer swallowed.
- Cleanup of the job folder can no longer change a verdict or throw (Windows keeps just-run `.exe` files locked: retries + best effort). This was a plausible cause of the "verdict undefined" Piston test result.
- Piston end-to-end tests used a 5 s request timeout, too tight for cold Windows compiles; raised to 60 s for those tests only (the timeout behaviour itself still has its own test).
- **Piston adapter**: a question time limit above Piston's server maximum (10 s) made Piston reject every run with HTTP 400. The adapter now clamps to `PISTON_MAX_RUN_TIMEOUT_MS`; the admin form caps time limit at 10000 ms.
- **CSV import** rejected files saved by Excel as "CSV UTF-8" (byte-order mark broke the first header). BOM is now stripped (CSV and JSON).

## Added
- `npm test` (serial), `npm run verify:judge`, `npm run diagnose:toolchain`.
- Tests: C infinite loop (TLE), C runtime error via exit status, meaningful C compiler diagnostics, toolchain emulation of the suspected Windows condition, silent-compiler-failure reporting, run_timeout clamp, CSV/JSON import (previously untested). 37 -> 49 tests.
- Root `.env.example`; `PHASE3_FREE_JUDGE.md` (was missing from the ZIP) and a rewritten `README.md`.

## Removed / cleaned
- `supabase/tests/` (stale older copies of tests; not run by anything), `dist/`, `tsconfig.tsbuildinfo`, `.env` (contains your Supabase project values, so it is not in the ZIP).
