// TEST-ONLY emulation of Piston's documented HTTP API. It executes code via LocalAdapter (NO isolation, NO memory limits).
// It verifies our adapter's HTTP wiring/parsing against the documented schema; it is NOT proof that real Piston behaves the same.
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { runOne } from './localAdapter.ts'

export function startMockPiston(opts: { port?: number; withStatus?: boolean; token?: string } = {}) {
  const requests: any[] = []
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', c => (raw += c))
    req.on('end', () => {
      const send = (code: number, body: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
      if (opts.token && req.headers['x-judge-token'] !== opts.token) return send(403, { message: 'forbidden' })
      if (req.method !== 'POST' || req.url !== '/api/v2/execute') return send(404, { message: 'not found' })
      const b = JSON.parse(raw); requests.push(b)
      const lang = String(b.language).startsWith('py') ? 'python' : 'c'
      const r = runOne({ language: lang, source: b.files[0].content, stdin: b.stdin ?? '', timeLimitMs: b.run_timeout, memoryLimitKb: 0 })
      const base = { language: b.language, version: '0.0.0' }
      if (r.outcome === 'compile_error') return send(200, { ...base, compile: { stdout: '', stderr: r.compileOutput, output: r.compileOutput, code: 1, signal: null } })
      const run: any = { stdout: r.stdout, stderr: r.stderr, output: r.stdout + r.stderr, code: 0, signal: null }
      if (r.outcome === 'runtime_error') { run.code = 1 }
      if (r.outcome === 'time_limit') { run.code = null; run.signal = 'SIGKILL'; if (opts.withStatus) run.status = 'TO' }
      send(200, { ...base, ...(lang === 'c' ? { compile: { stdout: '', stderr: '', output: '', code: 0, signal: null } } : {}), run })
    })
  })
  return new Promise<{ url: string; requests: any[]; close: () => Promise<void> }>(resolve =>
    server.listen(opts.port ?? 0, '127.0.0.1', () => resolve({
      url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests,
      close: () => new Promise(r => { server.closeAllConnections?.(); server.close(() => r()) }) })))
}

if (process.argv[1]?.endsWith('mockPiston.ts')) {
  const s = await startMockPiston({ port: Number(process.argv[2] || 2000) })
  console.log('mock piston (UNSAFE, test-only) on', s.url)
}
