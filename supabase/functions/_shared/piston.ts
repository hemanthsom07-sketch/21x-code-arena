// Piston adapter (free, MIT, self-hosted). https://github.com/engineer-man/piston
// One HTTP request per test case (Piston has no batch API); concurrency is capped here and by PISTON_MAX_CONCURRENT_JOBS.
import type { ExecJob, ExecResult, ExecutionAdapter, Language } from './adapter.ts'

export interface PistonConfig {
  baseUrl: string                      // origin only, e.g. http://127.0.0.1:8080 (no /api/v2)
  headers: Record<string, string>
  langs: Record<Language, { language: string; version: string }>
  concurrency: number; compileTimeoutMs: number; requestTimeoutMs: number
  maxRunTimeoutMs: number              // must equal PISTON_RUN_TIMEOUT on the server (infra/piston/docker-compose.yml: 10000)
  fetchImpl?: typeof fetch
}

/** Returns null when PISTON_URL is unset (=> the app shows the "Setup required" message). */
export function pistonConfigFromEnv(get: (k: string) => string | undefined): PistonConfig | null {
  const url = get('PISTON_URL')?.trim().replace(/\/+$/, '').replace(/\/api\/v2$/, '')
  if (!url) return null
  let headers: Record<string, string> = {}
  const raw = get('PISTON_HEADERS')
  if (raw) { try { headers = JSON.parse(raw) } catch { throw new Error('PISTON_HEADERS must be valid JSON') } }
  const token = get('PISTON_TOKEN')?.trim()
  if (token) headers = { ...headers, 'X-Judge-Token': token }   // header checked by infra/piston/Caddyfile
  const n = (k: string, d: number) => { const v = Number(get(k)); return Number.isFinite(v) && v > 0 ? v : d }
  return { baseUrl: url, headers,
    langs: { c: { language: get('PISTON_LANG_C') || 'c', version: get('PISTON_VERSION_C') || '*' },
             python: { language: get('PISTON_LANG_PYTHON') || 'python', version: get('PISTON_VERSION_PYTHON') || '*' } },
    concurrency: n('JUDGE_CONCURRENCY', 4), compileTimeoutMs: n('PISTON_COMPILE_TIMEOUT_MS', 10000), requestTimeoutMs: n('PISTON_REQUEST_TIMEOUT_MS', 60000), maxRunTimeoutMs: n('PISTON_MAX_RUN_TIMEOUT_MS', 10000) }
}

const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null)

export class PistonAdapter implements ExecutionAdapter {
  private cfg: PistonConfig
  constructor(cfg: PistonConfig) { this.cfg = cfg }

  async runBatch(jobs: ExecJob[]): Promise<ExecResult[]> {
    const out: ExecResult[] = new Array(jobs.length)
    let next = 0
    const worker = async () => { for (;;) { const i = next++; if (i >= jobs.length) return; out[i] = await this.runOne(jobs[i]) } }
    await Promise.all(Array.from({ length: Math.min(this.cfg.concurrency, jobs.length) }, worker))
    return out
  }

  private async runOne(job: ExecJob): Promise<ExecResult> {
    const { language, version } = this.cfg.langs[job.language]
    const body = { language, version, files: [{ name: job.language === 'c' ? 'main.c' : 'main.py', content: job.source }],
      stdin: job.stdin, compile_timeout: this.cfg.compileTimeoutMs, run_timeout: Math.min(job.timeLimitMs, this.cfg.maxRunTimeoutMs), compile_memory_limit: -1,
      run_memory_limit: job.memoryLimitKb > 0 ? job.memoryLimitKb * 1024 : -1 }
    const f = this.cfg.fetchImpl ?? fetch
    const t0 = Date.now()
    let res: Response
    try {
      res = await f(this.cfg.baseUrl + '/api/v2/execute', { method: 'POST', body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json', ...this.cfg.headers }, signal: AbortSignal.timeout(this.cfg.requestTimeoutMs) })
    } catch (e) {
      const name = (e as Error)?.name
      throw new Error(name === 'TimeoutError' || name === 'AbortError' ? 'judge_timeout' : 'judge_unreachable')
    }
    if (res.status === 429) throw new Error('judge_rate_limited')
    if (!res.ok) {
      const msg = String((await res.json().catch(() => null))?.message ?? '').slice(0, 200)  // Piston's message holds no secrets
      throw new Error(`judge_http_${res.status}${msg ? ': ' + msg : ''}`)
    }
    return mapResult(job, await res.json(), Date.now() - t0)
  }
}

/** Maps a Piston /execute response. Newer Piston adds run.status/cpu_time/wall_time/memory; older versions don't,
 *  so TLE vs memory-kill is inferred from SIGKILL + elapsed time when `status` is absent (documented limitation). */
export function mapResult(job: ExecJob, r: any, elapsedMs: number): ExecResult {
  const none = { stdout: '', stderr: '', compileOutput: '', timeMs: null, memoryKb: null }
  const c = r?.compile, run = r?.run
  if (c && (c.code !== 0 || c.signal)) return { ...none, outcome: 'compile_error', compileOutput: String(c.output ?? c.stderr ?? c.message ?? 'Compilation failed') }
  if (!run) return { ...none, outcome: 'internal_error', message: 'The judge returned no run result.' }
  const wall = num(run.wall_time), cpu = num(run.cpu_time), mem = num(run.memory)
  const stdout = String(run.stdout ?? ''), stderr = String(run.stderr ?? '')
  const common = { stdout, stderr, compileOutput: '', timeMs: cpu ?? wall, memoryKb: mem != null ? Math.round(mem / 1024) : null }
  const status = typeof run.status === 'string' ? run.status : undefined
  if (status === 'XX') return { ...common, outcome: 'internal_error', message: String(run.message ?? 'Judge internal error') }
  if (status === 'TO') return { ...common, outcome: 'time_limit' }
  if (status === 'OL') return { ...common, outcome: 'runtime_error', stderr: stderr + '\nOutput limit exceeded' }
  if (run.code === 0 && !run.signal) return { ...common, outcome: 'ok' }
  if (run.signal === 'SIGKILL' && !status && (wall ?? elapsedMs) >= job.timeLimitMs) return { ...common, outcome: 'time_limit' }
  const note = run.signal === 'SIGKILL' ? '\nProcess was killed (it may have exceeded the memory limit).' : run.signal ? `\nTerminated by signal ${run.signal}` : ''
  return { ...common, outcome: 'runtime_error', stderr: stderr + note }
}
