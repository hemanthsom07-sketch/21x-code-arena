// TEST-ONLY. Runs untrusted code directly on this machine with NO isolation. Never import from production code.
// Needs a C compiler and Python 3. Missing/broken tools are reported explicitly, never misreported as a student error.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, existsSync, statSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, delimiter } from 'node:path'
import type { ExecJob, ExecResult, ExecutionAdapter } from '../../supabase/functions/_shared/adapter.ts'

const WIN = process.platform === 'win32'
const probe = (cmd: string, args: string[], env?: NodeJS.ProcessEnv) =>
  spawnSync(cmd, args, { encoding: 'utf8', timeout: 20000, windowsHide: true, env })

export interface Toolchain { cc: string | null; ccDir: string | null; py: string | null }

/** Finds `cmd` on PATH and returns its REAL path (symlinks resolved), or null.
 *  Why real: winget installs tools such as WinLibs gcc as a symlink in a "Links" folder. gcc starts fine from the link
 *  (`gcc --version` works) but its backend (cc1.exe) needs DLLs from the real install folder, which is not on PATH. */
export function locateExecutable(cmd: string, pathVar: string = process.env.PATH ?? process.env.Path ?? '', exts: string[] = WIN ? ['.exe', '.cmd', '.bat', ''] : ['']): string | null {
  for (const raw of pathVar.split(delimiter)) {
    const dir = raw.trim().replace(/^"|"$/g, '')
    if (!dir) continue
    for (const ext of exts) {
      const p = join(dir, cmd + ext)
      try { if (existsSync(p) && statSync(p).isFile()) return realpathSync(p) } catch { /* unreadable PATH entry: skip */ }
    }
  }
  return null
}

/** Copy of the environment with `dir` first on PATH. Windows env names are case-insensitive ("Path"), so reuse the existing key. */
export function toolEnv(dir: string | null, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...base }
  if (!dir) return env
  const key = Object.keys(env).find(k => k.toLowerCase() === 'path') ?? 'PATH'
  env[key] = dir + delimiter + (env[key] ?? '')
  return env
}

let cached: Toolchain | null = null
/** Finds a working C compiler and Python 3 by actually running them (rejects e.g. the Windows "python3" Store stub).
 *  Overrides: X21_CC / X21_PYTHON environment variables. Python is resolved to its real executable so a timeout kills the
 *  interpreter itself rather than a launcher. */
export function toolchain(): Toolchain {
  if (cached) return cached
  let cc: string | null = null, ccDir: string | null = null
  const ccCandidates = process.env.X21_CC ? [process.env.X21_CC] : ['gcc', 'cc', 'clang']
  for (const c of ccCandidates) {
    const loc = locateExecutable(c) ?? (existsSync(c) ? realpathSync(c) : null)
    if (!loc) continue
    const r = probe(loc, ['--version'], toolEnv(dirname(loc)))
    if (!r.error && r.status === 0) { cc = loc; ccDir = dirname(loc); break }
  }
  let py: string | null = null
  const pyCandidates: string[][] = process.env.X21_PYTHON ? [[process.env.X21_PYTHON]] : [['python3'], ['python'], ['py', '-3']]
  for (const [cmd, ...pre] of pyCandidates) {
    const v = probe(cmd, [...pre, '--version'])
    if (v.error || v.status !== 0 || !/Python 3\./.test((v.stdout ?? '') + (v.stderr ?? ''))) continue
    const exe = probe(cmd, [...pre, '-c', 'import sys;print(sys.executable)'])
    if (!exe.error && exe.status === 0 && exe.stdout.trim()) { py = exe.stdout.trim().split(/\r?\n/)[0]; break }
  }
  return (cached = { cc, ccDir, py })
}

/** null when both tools work; otherwise an actionable message. */
export function toolchainProblem(): string | null {
  const t = toolchain(); const missing: string[] = []
  if (!t.cc) missing.push('a working C compiler (tried gcc, cc, clang)')
  if (!t.py) missing.push('Python 3 (tried python3, python, py -3)')
  if (!missing.length) return null
  return `Test toolchain not found: ${missing.join(' and ')}. ` +
    `Windows: "winget install -e --id BrechtSanders.WinLibs.POSIX.UCRT" and/or "winget install -e --id Python.Python.3.12", then open a NEW terminal ` +
    `(or set X21_CC / X21_PYTHON to the full tool paths). Diagnose with: node --experimental-strip-types --no-warnings tests/helpers/diagnoseToolchain.ts`
}

const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
/** A freshly built executable can briefly fail to launch (Linux ETXTBSY; Windows EBUSY/EPERM while antivirus scans it). Retry those only. */
const TRANSIENT = new Set(['ETXTBSY', 'EBUSY', 'EAGAIN', 'EPERM'])

const lf = (s: string | null | undefined) => (s ?? '').replace(/\r\n/g, '\n')  // emulate Linux output (Windows runtimes emit CRLF)

export function runOne(j: ExecJob, tc: Toolchain = toolchain()): ExecResult {
  const need = j.language === 'c' ? tc.cc : tc.py
  if (!need) throw new Error(toolchainProblem() ?? 'toolchain missing')
  const dir = mkdtempSync(join(tmpdir(), 'x21-'))
  const empty = { stdout: '', stderr: '', compileOutput: '', timeMs: null, memoryKb: null }
  try {
    let cmd: string, args: string[]
    let env: NodeJS.ProcessEnv = toolEnv(tc.ccDir)
    if (j.language === 'c') {
      const exe = join(dir, WIN ? 'a.exe' : 'a')
      writeFileSync(join(dir, 'a.c'), j.source)
      // Compiler temp files go to the job folder (no cross-process interference, cleaned up with it); cwd = job folder.
      const cenv = { ...env, TMP: dir, TEMP: dir, TMPDIR: dir }
      const c = spawnSync(tc.cc!, ['-O2', '-o', exe, join(dir, 'a.c')], { encoding: 'utf8', timeout: 60000, windowsHide: true, cwd: dir, env: cenv })
      if (c.error) throw new Error(`test setup: could not launch the C compiler "${tc.cc}" (${c.error.message})`)  // not a student error
      const diag = lf((c.stderr ?? '') + (c.stdout ?? '')).trim()
      if (c.status !== 0) {
        // Real compile errors always carry diagnostics. Exiting non-zero with NO output means the compiler itself could not run.
        if (!diag) throw new Error(`test setup: the C compiler "${tc.cc}" exited with code ${c.status} (0x${((c.status ?? 0) >>> 0).toString(16)}) and printed nothing, so it could not run properly ` +
          `(on Windows usually a missing DLL: the compiler's own folder must be on PATH). Run: node --experimental-strip-types --no-warnings tests/helpers/diagnoseToolchain.ts`)
        return { ...empty, outcome: 'compile_error', compileOutput: diag }
      }
      cmd = exe; args = []
    } else { writeFileSync(join(dir, 'a.py'), j.source); cmd = tc.py!; args = [join(dir, 'a.py')] }
    let t0 = Date.now(), r
    for (let attempt = 1; ; attempt++) {
      t0 = Date.now()
      r = spawnSync(cmd, args, { input: j.stdin, encoding: 'utf8', timeout: j.timeLimitMs, maxBuffer: 1 << 20, windowsHide: true, cwd: dir,
        env: { ...env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' } })
      const c = (r.error as NodeJS.ErrnoException | undefined)?.code
      if (!c || !TRANSIENT.has(c) || attempt >= 4) break
      sleepSync(150 * attempt)
    }
    const timeMs = Date.now() - t0
    const code = (r.error as NodeJS.ErrnoException | undefined)?.code
    if (code === 'ETIMEDOUT') return { ...empty, outcome: 'time_limit', timeMs }
    if (code === 'ENOBUFS') return { ...empty, outcome: 'runtime_error', stderr: 'Output limit exceeded', timeMs }
    // EPIPE: the program exited without reading all of its stdin (perfectly legal, e.g. `return 7;`). The process still ran, so
    // its exit status/output are valid; only a failure to START the program is a setup error.
    if (r.error && code !== 'EPIPE') throw new Error(`test setup: could not launch the program (${r.error.message})`)  // not a student error
    return { outcome: r.status === 0 ? 'ok' : 'runtime_error', stdout: lf(r.stdout), stderr: lf(r.stderr), compileOutput: '', timeMs, memoryKb: null }
  } finally {
    // Cleanup must never change a verdict. On Windows a just-run .exe is often still locked by antivirus/indexer (EBUSY/EPERM).
    try { rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }) } catch { /* best effort */ }
  }
}
export class LocalAdapter implements ExecutionAdapter { async runBatch(jobs: ExecJob[]) { return jobs.map(j => runOne(j)) } }
