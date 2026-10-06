import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { MAX_PASTE_CHARS, blockedMessage, installPasteDropGuards, pasteVerdict, type BlockReason } from '../src/lib/editorGuards.ts'

const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8')

test('pasteVerdict: short single-line text is allowed (typing-like pastes keep working)', () => {
  for (const ok of ['', null, undefined, 'x', 'int a = 0;', '#include <stdio.h>', 'printf("%d\\n", a + b);', 'héllo wörld', 'x'.repeat(MAX_PASTE_CHARS)])
    assert.equal(pasteVerdict(ok).allowed, true, String(ok).slice(0, 30))
})
test('pasteVerdict: one trailing line break is tolerated (copying a single line often adds it)', () => {
  for (const ok of ['int a;\n', 'int a;\r\n', 'int a;\r', '\n', '\r\n']) assert.equal(pasteVerdict(ok).allowed, true, JSON.stringify(ok))
})
test('pasteVerdict: multi-line text is blocked, whatever the line-break style', () => {
  for (const bad of ['a\nb', 'a\r\nb', 'a\rb', 'a\u2028b', 'a\u2029b', '\n\n', 'int main(){\n  return 0;\n}\n', '\nint a;'])
    assert.deepEqual(pasteVerdict(bad), { allowed: false, reason: 'multiline' }, JSON.stringify(bad))
})
test('pasteVerdict: a whole program squeezed onto one line is blocked by the length limit', () => {
  assert.deepEqual(pasteVerdict('x'.repeat(MAX_PASTE_CHARS + 1)), { allowed: false, reason: 'too_long' })
  assert.deepEqual(pasteVerdict('#include <stdio.h> int main(){int a,b;scanf("%d %d",&a,&b);printf("%d",a+b);return 0;} '.repeat(3)), { allowed: false, reason: 'too_long' })
})

// ---- the installed listeners, exercised with synthetic events on a plain EventTarget (no browser needed)
const paste = (text: string | null) => Object.assign(new Event('paste', { cancelable: true, bubbles: true }), { clipboardData: text === null ? null : { getData: (t: string) => (t === 'text/plain' ? text : '') } })
const drag = (type: string) => Object.assign(new Event(type, { cancelable: true, bubbles: true }), { dataTransfer: { dropEffect: 'copy', types: ['text/plain'] } })
function setup() {
  const node = new EventTarget(); const blocked: BlockReason[] = []
  const off = installPasteDropGuards(node, r => blocked.push(r)); return { node, blocked, off }
}

test('multi-line paste: default prevented, hidden from the editor, user notified', () => {
  const { node, blocked } = setup(); const e = paste('int main(){\n return 0;\n}')
  node.dispatchEvent(e); assert.equal(e.defaultPrevented, true); assert.equal(e.cancelBubble, true); assert.deepEqual(blocked, ['multiline'])
})
test('oversized single-line paste is blocked with the right reason', () => {
  const { node, blocked } = setup(); const e = paste('y'.repeat(500)); node.dispatchEvent(e); assert.equal(e.defaultPrevented, true); assert.deepEqual(blocked, ['too_long'])
})
test('short single-line paste passes through untouched (editor handles it normally)', () => {
  const { node, blocked } = setup()
  for (const text of ['count', 'a + b', 'int x;\n']) { const e = paste(text); node.dispatchEvent(e); assert.equal(e.defaultPrevented, false, text); assert.equal(e.cancelBubble, false, text) }
  assert.deepEqual(blocked, [])
})
test('paste with no readable clipboard text is left to the editor (the onDidPaste safety net covers it)', () => {
  const { node, blocked } = setup(); const e = paste(null); node.dispatchEvent(e); assert.equal(e.defaultPrevented, false); assert.deepEqual(blocked, [])
})
test('drop: always prevented (no text insertion, no file navigation) and reported', () => {
  const { node, blocked } = setup(); const e = drag('drop'); node.dispatchEvent(e)
  assert.equal(e.defaultPrevented, true); assert.equal(e.cancelBubble, true); assert.deepEqual(blocked, ['drop'])
})
test('dragenter/dragover: cursor shows "not allowed", Monaco never sees them, nothing is reported', () => {
  const { node, blocked } = setup()
  for (const t of ['dragenter', 'dragover']) { const e = drag(t); node.dispatchEvent(e); assert.equal(e.dataTransfer.dropEffect, 'none', t); assert.equal(e.cancelBubble, true, t) }
  assert.deepEqual(blocked, [])
})
test('guards use the capture phase (they run before the editor\'s own handlers) and dispose removes every listener', () => {
  const added: [string, unknown][] = [], removed: [string, unknown][] = []
  const fake = { addEventListener: (t: string, _l: unknown, o: unknown) => added.push([t, o]), removeEventListener: (t: string, _l: unknown, o: unknown) => removed.push([t, o]) }
  const off = installPasteDropGuards(fake, () => {})
  assert.deepEqual(added.map(a => a[0]).sort(), ['dragenter', 'dragover', 'drop', 'paste']); assert.ok(added.every(a => (a[1] as { capture?: boolean })?.capture === true), 'capture = true')
  assert.ok(removed.length === 0 || removed.every(r => (r[1] as { capture?: boolean })?.capture === true), 'removed with the same capture flag')
  off(); assert.deepEqual(removed.sort(), added.sort())
  const { node, off: off2 } = setup(); off2(); const e = paste('a\nb'); node.dispatchEvent(e); assert.equal(e.defaultPrevented, false, 'no interception after dispose')
})
test('scope: events on any other element (problem statement, custom input) are never touched', () => {
  const editor = new EventTarget(), statement = new EventTarget(), blocked: BlockReason[] = []
  installPasteDropGuards(editor, r => blocked.push(r))
  const p = paste('multi\nline'); statement.dispatchEvent(p); const d = drag('drop'); statement.dispatchEvent(d)
  assert.equal(p.defaultPrevented, false); assert.equal(d.defaultPrevented, false); assert.deepEqual(blocked, [])
})
test('messages are specific and non-empty', () => {
  const m = (['multiline', 'too_long', 'drop'] as const).map(blockedMessage); assert.ok(m.every(x => x.length > 20)); assert.match(blockedMessage('drop'), /Dropping/); assert.match(blockedMessage('multiline'), /Pasting/)
})

// ---- wiring (static): guards the regression "someone removed the hook" and "someone broke typing"
test('CodeWorkspace wires the guards into Monaco and does not interfere with typing, Run or Submit', () => {
  const cw = src('../src/pages/student/CodeWorkspace.tsx')
  assert.match(cw, /installPasteDropGuards\(node, notifyBlocked\)/); assert.match(cw, /onMount=\{onMount\}/); assert.match(cw, /editor\.onDidPaste\(/); assert.match(cw, /dropIntoEditor: \{ enabled: false \}/)
  assert.match(cw, /guardOff\.current\?\.\(\)/, 'listeners are removed on unmount')
  assert.ok(!/readOnly|contextmenu: false|domReadOnly|keydown|onKeyDown/.test(cw), 'no keyboard/read-only/context-menu changes')
  assert.match(cw, /onClick=\{run\}/); assert.match(cw, /onClick=\{submit\}/)
})
test('the guards are used ONLY by the code editor (statement and the rest of the app can still copy/paste)', () => {
  for (const f of ['../src/pages/student/ChallengeViews.tsx', '../src/pages/admin/QuestionManager.tsx', '../src/pages/Activate.tsx', '../src/pages/Login.tsx', '../src/App.tsx'])
    assert.ok(!src(f).includes('editorGuards'), f)
  assert.ok(!/user-select|onCopy|onPaste|oncopy/.test(src('../src/pages/student/ChallengeViews.tsx')), 'statement has no copy/paste blocking')
})
