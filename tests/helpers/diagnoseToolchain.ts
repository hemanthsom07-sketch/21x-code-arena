// Run this if the execution tests fail on your machine:
//   node --experimental-strip-types --no-warnings tests/helpers/diagnoseToolchain.ts
// It shows exactly what gcc/Python do, and whether the "compiler folder on PATH" fix is what your machine needs.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { locateExecutable, toolEnv, toolchain, toolchainProblem } from './localAdapter.ts'

const hex = (n: number | null) => (n == null ? 'null' : `${n} (0x${(n >>> 0).toString(16)})`)
console.log(`platform=${process.platform} node=${process.version}`)
console.log('PATH hits for gcc:', locateExecutable('gcc') ?? '(none)', '| cc:', locateExecutable('cc') ?? '(none)')
const t = toolchain(); console.log('selected toolchain:', JSON.stringify(t)); console.log('problem:', toolchainProblem() ?? 'none')
if (!t.cc) process.exit(1)
const dir = mkdtempSync(join(tmpdir(), 'x21diag-')); writeFileSync(join(dir, 'a.c'), '#include <stdio.h>\nint main(void){printf("hello\\n");return 0;}\n')
const exe = join(dir, process.platform === 'win32' ? 'a.exe' : 'a')
const attempt = (label: string, cmd: string, env: NodeJS.ProcessEnv) => {
  const r = spawnSync(cmd, ['-O2', '-o', exe, join(dir, 'a.c')], { encoding: 'utf8', env, cwd: dir, windowsHide: true })
  console.log(`\n[${label}] ${cmd}\n  exit=${hex(r.status)} error=${r.error?.message ?? 'none'}\n  stdout=${JSON.stringify(r.stdout)}\n  stderr=${JSON.stringify(r.stderr)}`)
  if (r.status === 0) { const p = spawnSync(exe, [], { encoding: 'utf8' }); console.log(`  program output=${JSON.stringify(p.stdout)} exit=${hex(p.status)}`) }
  return r.status === 0
}
const plain = attempt('1: command exactly as on PATH, PATH unchanged', 'gcc', process.env)
const fixed = attempt('2: real compiler path + its folder first on PATH (what the tests now do)', t.cc, toolEnv(t.ccDir))
console.log(`\nSUMMARY: plain=${plain ? 'OK' : 'FAILS'}  fixed=${fixed ? 'OK' : 'FAILS'}`)
if (!plain && fixed) console.log('=> Your gcc only works when its own folder is on PATH. The test helper now handles that; consider adding that folder to your PATH.')
if (!fixed) console.log('=> The compiler cannot compile even with its folder on PATH. Send me the output above.')
rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 }); process.exit(fixed ? 0 : 1)
