// Execution adapter: the ONLY place that knows about the judge provider. Swap hosted <-> self-hosted via env.
export type Language = 'c' | 'python'
export interface ExecJob { language: Language; source: string; stdin: string; timeLimitMs: number; memoryLimitKb: number }
export type Outcome = 'ok' | 'compile_error' | 'runtime_error' | 'time_limit' | 'internal_error'
export interface ExecResult { outcome: Outcome; stdout: string; stderr: string; compileOutput: string; timeMs: number | null; memoryKb: number | null; message?: string }
export interface ExecutionAdapter { runBatch(jobs: ExecJob[]): Promise<ExecResult[]> }

export interface Judge0Config {
  baseUrl: string; headers: Record<string, string>; langIds: Record<Language, number>
  pollIntervalMs: number; timeoutMs: number; fetchImpl?: typeof fetch
}

/** Returns null when JUDGE0_URL is not set (=> app shows a setup message). Throws on malformed JUDGE0_HEADERS. */
export function judge0ConfigFromEnv(get: (k: string) => string | undefined): Judge0Config | null {
  const url = get('JUDGE0_URL')?.trim().replace(/\/+$/, '')
  if (!url) return null
  let headers: Record<string, string> = {}
  const raw = get('JUDGE0_HEADERS')
  if (raw) { try { headers = JSON.parse(raw) } catch { throw new Error('JUDGE0_HEADERS must be valid JSON') } }
  return { baseUrl: url, headers,
    langIds: { c: Number(get('JUDGE0_LANG_C') || 50), python: Number(get('JUDGE0_LANG_PYTHON') || 71) },
    pollIntervalMs: 1000, timeoutMs: Number(get('JUDGE0_TIMEOUT_MS') || 30000) }
}

const b64 = (s: string) => {
  const bytes = new TextEncoder().encode(s); let bin = ''
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(bin)
}
const unb64 = (s?: string | null) => {
  if (!s) return ''
  const bin = atob(s.replace(/\s/g, ''))
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)))
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export class Judge0Adapter implements ExecutionAdapter {
  private cfg: Judge0Config
  constructor(cfg: Judge0Config) { this.cfg = cfg }
  private async http(path: string, init: RequestInit) {
    const f = this.cfg.fetchImpl ?? fetch
    const res = await f(this.cfg.baseUrl + path, { ...init, headers: { 'Content-Type': 'application/json', ...this.cfg.headers } })
    if (res.status === 429) throw new Error('judge_rate_limited')
    if (!res.ok) throw new Error(`judge_http_${res.status}`)  // never include body/headers (may hold secrets)
    return res.json()
  }
  async runBatch(jobs: ExecJob[]): Promise<ExecResult[]> {
    const out: ExecResult[] = []
    for (let i = 0; i < jobs.length; i += 20) out.push(...await this.runChunk(jobs.slice(i, i + 20)))  // Judge0 batch cap = 20
    return out
  }
  private async runChunk(jobs: ExecJob[]): Promise<ExecResult[]> {
    const created = await this.http('/submissions/batch?base64_encoded=true', { method: 'POST', body: JSON.stringify({
      submissions: jobs.map(j => ({ language_id: this.cfg.langIds[j.language], source_code: b64(j.source), stdin: b64(j.stdin),
        cpu_time_limit: j.timeLimitMs / 1000, memory_limit: j.memoryLimitKb })) }) })
    const tokens: string[] = Array.isArray(created) ? created.map((c: any) => c?.token) : []
    if (tokens.length !== jobs.length || tokens.some(t => !t)) throw new Error('judge_bad_response')
    const deadline = Date.now() + this.cfg.timeoutMs
    for (;;) {
      const data = await this.http(`/submissions/batch?base64_encoded=true&fields=token,stdout,stderr,compile_output,message,time,memory,status&tokens=${tokens.join(',')}`, { method: 'GET' })
      const byToken = new Map<string, any>((data?.submissions ?? []).map((s: any) => [s.token, s]))
      const subs = tokens.map(t => byToken.get(t))
      if (subs.every(s => s && s.status && s.status.id >= 3)) return subs.map(mapSubmission)
      if (Date.now() > deadline) throw new Error('judge_timeout')
      await sleep(this.cfg.pollIntervalMs)
    }
  }
}

function mapSubmission(s: any): ExecResult {
  const id: number = s.status.id
  const outcome: Outcome = id === 3 ? 'ok' : id === 5 ? 'time_limit' : id === 6 ? 'compile_error' : id >= 7 && id <= 12 ? 'runtime_error' : 'internal_error'
  const t = s.time != null ? parseFloat(s.time) : NaN
  return { outcome, stdout: unb64(s.stdout), stderr: unb64(s.stderr), compileOutput: unb64(s.compile_output),
    timeMs: Number.isFinite(t) ? Math.round(t * 1000) : null, memoryKb: typeof s.memory === 'number' ? s.memory : null, message: unb64(s.message) || s.status.description }
}
