// Live verification of the CONFIGURED execution engine. Run it yourself against real Piston:
//   node --experimental-strip-types --no-warnings scripts/verify-judge.ts [--skip-memory] [--bench]
// Reads PISTON_URL / PISTON_TOKEN (or JUDGE0_*) from the environment, exactly like the Edge Functions do.
import { adapterFromEnv } from '../supabase/functions/_shared/engine.ts'
import type { ExecJob, ExecResult } from '../supabase/functions/_shared/adapter.ts'

const adapter = adapterFromEnv(k => process.env[k])
if (!adapter) { console.error('No engine configured. Set PISTON_URL (and PISTON_TOKEN) first.'); process.exit(2) }
const args = new Set(process.argv.slice(2))
const J = (language: 'c' | 'python', source: string, stdin = '', timeLimitMs = 3000, memoryLimitKb = 128000): ExecJob => ({ language, source, stdin, timeLimitMs, memoryLimitKb })
type Check = { name: string; job: ExecJob; pass: (r: ExecResult) => boolean; skip?: boolean }
const SUM_C = '#include <stdio.h>\nint main(){int a,b;scanf("%d %d",&a,&b);printf("%d\\n",a+b);return 0;}'
const checks: Check[] = [
  { name: 'C: stdin/stdout', job: J('c', SUM_C, '2 3\n'), pass: r => r.outcome === 'ok' && r.stdout.trim() === '5' },
  { name: 'Python: stdin/stdout', job: J('python', 'a,b=map(int,input().split())\nprint(a+b)', '4 5\n'), pass: r => r.outcome === 'ok' && r.stdout.trim() === '9' },
  { name: 'C: compilation error reported', job: J('c', 'int main(){ return 0 }'), pass: r => r.outcome === 'compile_error' && r.compileOutput.length > 0 },
  { name: 'Python: exception => runtime error', job: J('python', 'raise ValueError("x")'), pass: r => r.outcome === 'runtime_error' },
  { name: 'C: segfault => runtime error', job: J('c', 'int main(){int*p=0;*p=1;return 0;}'), pass: r => r.outcome === 'runtime_error' },
  { name: 'C: non-zero exit => runtime error', job: J('c', 'int main(){return 3;}'), pass: r => r.outcome === 'runtime_error' },
  { name: 'Time limit (infinite loop, 1000 ms)', job: J('python', 'while True: pass', '', 1000), pass: r => r.outcome === 'time_limit' },
  { name: 'Memory limit (allocate up to 1 GB, limit 64 MB)', skip: args.has('--skip-memory'), pass: r => r.outcome !== 'ok',
    job: J('c', '#include <stdlib.h>\n#include <string.h>\nint main(){for(int i=0;i<16;i++){char*p=malloc(64u<<20);if(!p)return 1;memset(p,1,64u<<20);}return 0;}', '', 5000, 64000) },
  { name: 'Network is blocked', pass: r => !r.stdout.includes('NET_OK'),
    job: J('python', 'import socket\ntry:\n    socket.create_connection(("1.1.1.1",80),timeout=2); print("NET_OK")\nexcept Exception as e:\n    print("blocked")') },
  { name: 'Large output is not truncated (30,000 chars)', job: J('python', 'print("x"*30000)'), pass: r => r.outcome === 'ok' && r.stdout.trim().length === 30000 },
  { name: 'Unicode + CRLF-free stdin round trip', job: J('python', 'print(input())', 'héllo\n'), pass: r => r.outcome === 'ok' && r.stdout.trim() === 'héllo' },
]
let failed = 0
for (const c of checks) {
  if (c.skip) { console.log(`SKIP  ${c.name}`); continue }
  try {
    const [r] = await adapter.runBatch([c.job]); const ok = c.pass(r); if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}${ok ? '' : `   -> outcome=${r.outcome} stdout=${JSON.stringify(r.stdout.slice(0, 60))} stderr=${JSON.stringify(r.stderr.slice(0, 80))} compile=${JSON.stringify(r.compileOutput.slice(0, 80))}`}`)
  } catch (e) { failed++; console.log(`FAIL  ${c.name}   -> ${(e as Error).message}`) }
}
if (args.has('--bench')) {
  const n = 24, t0 = Date.now()
  const res = await adapter.runBatch(Array.from({ length: n }, () => J('python', 'print(sum(range(1000)))')))
  const s = (Date.now() - t0) / 1000
  console.log(`BENCH ${n} Python jobs in ${s.toFixed(1)}s = ${(n / s).toFixed(1)} jobs/s, ${res.filter(r => r.outcome === 'ok').length}/${n} ok`)
}
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed'); process.exit(failed ? 1 : 0)
