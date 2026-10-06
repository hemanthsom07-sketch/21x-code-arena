// Paste / drop guards for the code editor. DOM-only logic with no imports so it can be unit-tested without a browser.
// This discourages pasting a whole solution; it is NOT a security boundary (a person can still type code from another screen).

/** Longest single-line paste allowed (e.g. a variable name, an include line, a short expression). */
export const MAX_PASTE_CHARS = 200
export type BlockReason = 'multiline' | 'too_long' | 'drop'
export type PasteVerdict = { allowed: true } | { allowed: false; reason: 'multiline' | 'too_long' }

const LINE_BREAK = /[\r\n\u2028\u2029]/
const TRAILING_BREAK = /(\r\n|\r|\n|\u2028|\u2029)$/

/** Decides whether clipboard text may be pasted. One trailing line break is tolerated (copying a single line often adds it). */
export function pasteVerdict(text: string | null | undefined): PasteVerdict {
  if (!text) return { allowed: true }
  const body = text.replace(TRAILING_BREAK, '')
  if (LINE_BREAK.test(body)) return { allowed: false, reason: 'multiline' }
  if (body.length > MAX_PASTE_CHARS) return { allowed: false, reason: 'too_long' }
  return { allowed: true }
}

export function blockedMessage(reason: BlockReason): string {
  if (reason === 'drop') return 'Dropping text or files into the editor is turned off. Please type your code.'
  return 'Pasting multiple lines or large blocks of code is turned off in the editor. Please type your solution (a short single-line paste is fine).'
}

/** Anything with add/removeEventListener: an HTMLElement in the app, a plain EventTarget in tests. */
export interface Listenable {
  addEventListener(type: string, listener: (e: any) => void, options?: boolean | AddEventListenerOptions): void
  removeEventListener(type: string, listener: (e: any) => void, options?: boolean | EventListenerOptions): void
}

/** Attaches capture-phase listeners to the editor's element only, so nothing else on the page (problem statement, custom input) is affected.
 *  Capture phase + stopPropagation means Monaco never sees a blocked event. Returns a function that removes the listeners.
 *  Typing, selection, deletion, indentation, autocomplete and Monaco's own mouse-driven selection drag are untouched. */
export function installPasteDropGuards(node: Listenable, onBlocked: (reason: BlockReason) => void): () => void {
  const onPaste = (e: any) => {
    const v = pasteVerdict(e.clipboardData?.getData('text/plain'))
    if (!v.allowed) { e.preventDefault(); e.stopPropagation(); onBlocked(v.reason) }
  }
  // A native drag over the editor can only be external (Monaco's own text move uses mouse events). Show "not allowed" and hide it from Monaco.
  const onDrag = (e: any) => { e.stopPropagation(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'none' }
  // preventDefault on drop is essential: otherwise the browser inserts the text (or navigates to a dropped file).
  const onDrop = (e: any) => { e.preventDefault(); e.stopPropagation(); onBlocked('drop') }
  const handlers: [string, (e: any) => void][] = [['paste', onPaste], ['dragenter', onDrag], ['dragover', onDrag], ['drop', onDrop]]
  // `{ capture: true }` (not the boolean shorthand): some runtimes, e.g. Node's EventTarget, ignore the boolean when REMOVING a listener.
  const opts = { capture: true }
  for (const [type, fn] of handlers) node.addEventListener(type, fn, opts)
  return () => { for (const [type, fn] of handlers) node.removeEventListener(type, fn, opts) }
}
