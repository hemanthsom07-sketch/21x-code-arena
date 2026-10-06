import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { locateExecutable, runOne, toolEnv, toolchain, toolchainProblem } from './helpers/localAdapter.ts'

const NEEDS_TOOLS = toolchainProblem() ?? false   // these tests need a real compiler; tests/toolchain test below reports the problem once
const POSIX = process.platform === 'win32' ? 'POSIX-only emulation (shell-script compiler + symlinks); not applicable on Windows' : NEEDS_TOOLS

// One clear, actionable failure when gcc/Python are missing, instead of many misleading verdict failures.
test('test toolchain (working C compiler + Python 3) is available for the execution tests', () => {
  const problem = toolchainProblem()
  assert.equal(problem, null, problem ?? '')
  const t = toolchain(); console.log(`# using C compiler: ${t.cc}, Python: ${t.py}`)
})

test('toolEnv prepends the compiler folder and reuses the existing PATH key (Windows uses "Path")', () => {
  const e = toolEnv('/real/bin', { Path: '/usr/bin', OTHER: '1' })
  assert.ok(e.Path!.startsWith('/real/bin'), 'prepended'); assert.equal(Object.keys(e).filter(k => k.toLowerCase() === 'path').length, 1, 'no duplicate PATH key')
  assert.equal(e.OTHER, '1'); assert.deepEqual(toolEnv(null, { PATH: 'x' }), { PATH: 'x' })
})

// Emulates the suspected Windows failure: a tool launched through a symlink ("winget Links" folder) starts fine for
// `--version`, but compiling fails SILENTLY unless the real install folder is on PATH. The real compiler is wrapped to behave that way.
function fakeInstall() {
  const root = mkdtempSync(join(tmpdir(), 'x21fake-')); const real = join(root, 'real', 'bin'), links = join(root, 'links')
  mkdirSync(real, { recursive: true }); mkdirSync(links)
  const script = `#!/bin/sh\n[ "$1" = "--version" ] && { echo "fake gcc 1.0"; exit 0; }\nREAL=$(PATH=/usr/bin:/bin dirname "$(PATH=/usr/bin:/bin readlink -f "$0")")\ncase ":$PATH:" in *":$REAL:"*) exec "${toolchain().cc}" "$@";; esac\nexit 1\n`
  writeFileSync(join(real, 'gcc'), script); chmodSync(join(real, 'gcc'), 0o755); symlinkSync(join(real, 'gcc'), join(links, 'gcc'))
  return { root, real, links }
}
const C_HELLO = '#include <stdio.h>\nint main(void){printf("hi\\n");return 0;}'
const job = (source: string) => ({ language: 'c' as const, source, stdin: '', timeLimitMs: 5000, memoryLimitKb: 64000 })

test('emulated winget-symlink compiler: fails silently as-is, works via real path + its folder on PATH', { skip: POSIX }, () => {
  const f = fakeInstall()
  try {
    const viaLink = join(f.links, 'gcc')
    assert.equal(spawnSync(viaLink, ['--version']).status, 0, '--version works through the link (this is why detection passed)')
    const plain = spawnSync(viaLink, ['-o', join(f.root, 'x'), '/dev/null'], { encoding: 'utf8', env: { PATH: f.links } })
    assert.equal(plain.status, 1); assert.equal((plain.stdout ?? '') + (plain.stderr ?? ''), '', 'mechanism reproduced: non-zero exit, no output')
    const found = locateExecutable('gcc', f.links)!
    assert.equal(dirname(found), f.real, 'symlink resolved to the real install folder')
    const r = runOne(job(C_HELLO), { cc: found, ccDir: dirname(found), py: toolchain().py })
    assert.equal(r.outcome, 'ok'); assert.equal(r.stdout, 'hi\n')
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('compiler that exits non-zero with no output is reported as a setup problem, not a student compile error', { skip: POSIX }, () => {
  const f = fakeInstall()
  try {
    const link = join(f.links, 'gcc')   // no PATH fix applied: ccDir null, so the fake exits 1 silently
    assert.throws(() => runOne(job(C_HELLO), { cc: link, ccDir: null, py: null }), /printed nothing/)
  } finally { rmSync(f.root, { recursive: true, force: true }) }
})

test('real compile errors still come back as compile_error with the compiler diagnostics', { skip: NEEDS_TOOLS }, () => {
  const r = runOne(job('int main(){ return 0 }'))
  assert.equal(r.outcome, 'compile_error'); assert.match(r.compileOutput, /error/i)
})

// Regression: this raced (~1 run in 5) before EPIPE was handled. A 4 MB stdin guarantees the pipe is still full when the program exits.
test('a program that exits without reading its input is judged normally (no EPIPE launcher error)', { skip: NEEDS_TOOLS }, () => {
  const big = 'x'.repeat(4 * 1024 * 1024)
  for (let i = 0; i < 8; i++) {
    const c = runOne({ ...job('int main(void){ return 7; }'), stdin: big }); assert.equal(c.outcome, 'runtime_error', `C run ${i}`)
    const ok = runOne({ ...job('int main(void){ return 0; }'), stdin: big }); assert.equal(ok.outcome, 'ok', `C ok run ${i}`)
  }
  assert.equal(runOne({ language: 'python', source: 'print("hi")', stdin: big, timeLimitMs: 5000, memoryLimitKb: 1 }).outcome, 'ok')
})
