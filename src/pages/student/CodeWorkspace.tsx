import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import type { OnMount } from '@monaco-editor/react'
import { supabase } from '../../lib/supabase'
import { runCode, submitCode } from '../../lib/execApi'
import { STARTERS, LANG_LABEL, type Lang } from '../../lib/starters'
import { blockedMessage, installPasteDropGuards, pasteVerdict, type BlockReason } from '../../lib/editorGuards'
import { isSetupProblem, verdictColor, verdictLabel, type ExecFail, type RunOk, type SubmitOk } from '../../lib/verdicts'

const Editor = lazy(() => import('@monaco-editor/react'))
const COOLDOWN_MS = 10_000
const store = {
  get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* storage unavailable: drafts just won't persist */ } },
}
interface Row { id: string; created_at: string; language: string; verdict: string | null; passed: number | null; total: number | null; time_ms: number | null }

export default function CodeWorkspace({ questionId, languages }: { questionId: string; languages: string[] }) {
  const langs = languages.filter((l): l is Lang => l === 'c' || l === 'python')
  const [language, setLanguage] = useState<Lang>(() => { const s = store.get(`21x:lang:${questionId}`); return (langs.find(l => l === s) ?? langs[0]) as Lang })
  const [code, setCode] = useState(() => store.get(`21x:code:${questionId}:${language}`) ?? STARTERS[language])
  const [tab, setTab] = useState<'results' | 'input' | 'history'>('results')
  const [stdin, setStdin] = useState('')
  const [busy, setBusy] = useState<'run' | 'submit' | null>(null)
  const [runRes, setRunRes] = useState<RunOk | null>(null)
  const [subRes, setSubRes] = useState<SubmitOk | null>(null)
  const [fail, setFail] = useState<ExecFail | null>(null)
  const [history, setHistory] = useState<Row[] | null>(null)
  const [cooldownUntil, setCooldownUntil] = useState(0)
  const [, tick] = useState(0)
  const [guardMsg, setGuardMsg] = useState<string | null>(null)
  const guardOff = useRef<(() => void) | null>(null)
  const guardTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { guardOff.current?.(); if (guardTimer.current) clearTimeout(guardTimer.current) }, [])
  const notifyBlocked = useCallback((reason: BlockReason) => {
    setGuardMsg(blockedMessage(reason))
    if (guardTimer.current) clearTimeout(guardTimer.current)
    guardTimer.current = setTimeout(() => setGuardMsg(null), 5000)
  }, [])
  // Multi-line / large paste and external drag-and-drop are blocked inside the editor only (see lib/editorGuards.ts).
  const onMount: OnMount = useCallback(editor => {
    guardOff.current?.()
    const node = editor.getDomNode()
    const off = node ? installPasteDropGuards(node, notifyBlocked) : () => {}
    // Safety net for pastes that bypass the DOM paste event (e.g. some context-menu paths): undo them immediately.
    const sub = editor.onDidPaste(e => {
      const v = pasteVerdict(editor.getModel()?.getValueInRange(e.range))
      if (!v.allowed) { editor.trigger('paste-guard', 'undo', null); notifyBlocked(v.reason) }
    })
    guardOff.current = () => { off(); sub.dispose() }
  }, [notifyBlocked])

  useEffect(() => {
    if (cooldownUntil <= Date.now()) return
    const t = setInterval(() => { tick(x => x + 1); if (Date.now() >= cooldownUntil) clearInterval(t) }, 500)
    return () => clearInterval(t)
  }, [cooldownUntil])

  const loadHistory = useCallback(async () => {
    const { data } = await supabase.from('submissions').select('id, created_at, language, verdict, passed, total, time_ms')
      .eq('question_id', questionId).order('created_at', { ascending: false }).limit(20)  // RLS: own rows only
    setHistory((data as Row[]) ?? [])
  }, [questionId])
  useEffect(() => { loadHistory() }, [loadHistory])

  function switchLanguage(l: Lang) {
    store.set(`21x:lang:${questionId}`, l)
    setLanguage(l); setCode(store.get(`21x:code:${questionId}:${l}`) ?? STARTERS[l])
  }
  function edit(v: string | undefined) { const s = v ?? ''; setCode(s); store.set(`21x:code:${questionId}:${language}`, s) }

  const wait = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000))
  async function run() {
    if (busy) return
    setBusy('run'); setFail(null); setRunRes(null); setTab('input')
    const r = await runCode(questionId, language, code, stdin)
    setBusy(null)
    if (r.ok) setRunRes(r); else setFail(r)
  }
  async function submit() {
    if (busy || wait > 0) return
    setBusy('submit'); setFail(null); setSubRes(null); setTab('results')
    const r = await submitCode(questionId, language, code)
    setBusy(null)
    if (r.ok) { setSubRes(r); setCooldownUntil(Date.now() + COOLDOWN_MS); loadHistory() } else setFail(r)
  }

  if (!langs.length) return <p className="card text-sm text-slate-400">No supported language is configured for this question.</p>
  return <div className="flex flex-col gap-3">
    <div className="flex items-center gap-3">
      <select className="input w-auto" value={language} onChange={e => switchLanguage(e.target.value as Lang)} aria-label="Language">
        {langs.map(l => <option key={l} value={l}>{LANG_LABEL[l]}</option>)}</select>
      <button className="btn-ghost ml-auto" onClick={() => { if (confirm('Reset to the starter template?')) edit(STARTERS[language]) }}>Reset</button>
    </div>
    <div className="h-[380px] overflow-hidden rounded-lg border border-white/10">
      <Suspense fallback={<p className="p-4 text-slate-400">Loading editor…</p>}>
        <Editor height="100%" theme="vs-dark" language={language} path={`${questionId}.${language}`} value={code} onChange={edit} onMount={onMount}
          options={{ fontSize: 14, minimap: { enabled: false }, automaticLayout: true, scrollBeyondLastLine: false, tabSize: 4, dropIntoEditor: { enabled: false } }} />
      </Suspense></div>
    {guardMsg && <p role="status" className="rounded bg-amber-500/10 p-2 text-xs text-amber-300">{guardMsg}</p>}
    <div className="flex gap-2">
      <button className="btn-ghost" onClick={run} disabled={!!busy}>{busy === 'run' ? 'Running…' : 'Run Code'}</button>
      <button className="btn-primary" onClick={submit} disabled={!!busy || wait > 0}>{busy === 'submit' ? 'Judging…' : wait > 0 ? `Submit (${wait}s)` : 'Submit'}</button>
      <span className="self-center text-xs text-slate-500">Run uses your custom input and is not a submission.</span></div>

    <div className="card p-0">
      <div className="flex gap-4 border-b border-white/10 px-4 pt-3 text-sm">
        {([['results', 'Test Results'], ['input', 'Custom Input'], ['history', 'Submissions']] as const).map(([k, label]) =>
          <button key={k} onClick={() => setTab(k)} className={`pb-2 ${tab === k ? 'border-b-2 border-accent text-white' : 'text-slate-400'}`}>{label}</button>)}</div>
      <div className="p-4 text-sm">
        {fail && <div role="alert" className={`mb-3 rounded p-3 ${isSetupProblem(fail.code) ? 'bg-amber-500/10 text-amber-300' : 'bg-red-500/10 text-red-300'}`}>
          {isSetupProblem(fail.code) && <b>Setup required: </b>}{fail.message}</div>}
        {tab === 'input' && <>
          <textarea className="input font-mono" rows={3} placeholder="Custom standard input" value={stdin} onChange={e => setStdin(e.target.value)} />
          {runRes && <div className="mt-3 space-y-2">
            <p className="text-xs text-slate-400">{runRes.outcome === 'ok' ? 'Finished' : runRes.outcome.replace('_', ' ')}{runRes.time_ms != null && ` · ${runRes.time_ms} ms`}</p>
            {runRes.compile_output && <Pre label="Compiler output" text={runRes.compile_output} bad />}
            <Pre label="Output" text={runRes.stdout} />
            {runRes.stderr && <Pre label="Errors" text={runRes.stderr} bad />}</div>}</>}
        {tab === 'results' && (subRes ? <Result r={subRes} /> : !fail && <p className="text-slate-400">Submit your code to see results. Some test cases are hidden.</p>)}
        {tab === 'history' && (history === null ? <p className="text-slate-400">Loading…</p> : history.length === 0 ? <p className="text-slate-400">No submissions yet.</p> :
          <ul className="space-y-1">{history.map(h => <li key={h.id} className="flex justify-between gap-2">
            <span className={verdictColor(h.verdict)}>{verdictLabel(h.verdict)}{h.total ? ` (${h.passed}/${h.total})` : ''}</span>
            <span className="text-xs text-slate-400">{h.language} · {h.time_ms != null ? `${h.time_ms} ms · ` : ''}{new Date(h.created_at).toLocaleString()}</span></li>)}</ul>)}
      </div></div>
  </div>
}

const Pre = ({ label, text, bad }: { label: string; text: string; bad?: boolean }) => <div>
  <div className="text-xs text-slate-400">{label}</div>
  <pre className={`overflow-auto whitespace-pre-wrap rounded bg-black/30 p-2 font-mono ${bad ? 'text-red-300' : ''}`}>{text || '(empty)'}</pre></div>

function Result({ r }: { r: SubmitOk }) {
  return <div className="space-y-3">
    <div className="flex items-baseline gap-3"><span className={`font-display text-lg font-bold ${verdictColor(r.verdict)}`}>{verdictLabel(r.verdict)}</span>
      <span className="text-xs text-slate-400">{r.passed}/{r.total} tests{r.time_ms != null && ` · ${r.time_ms} ms`}{r.memory_kb != null && ` · ${Math.round(r.memory_kb / 1024)} MB`}</span></div>
    {r.message && <pre className="whitespace-pre-wrap rounded bg-black/30 p-2 font-mono text-xs">{r.message}</pre>}
    <ul className="space-y-2">{r.results.map(t => <li key={t.index} className="rounded border border-white/10 p-2">
      <div className="flex justify-between"><span>Test #{t.index} {t.hidden && <span className="text-xs text-slate-400">(hidden)</span>}</span>
        <span className={verdictColor(t.verdict)}>{verdictLabel(t.verdict)}</span></div>
      {!t.hidden && t.verdict !== 'accepted' && <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <Pre label="Input" text={t.input ?? ''} /><Pre label="Expected" text={t.expected ?? ''} /><Pre label="Your output" text={t.actual ?? ''} /></div>}
    </li>)}</ul></div>
}
