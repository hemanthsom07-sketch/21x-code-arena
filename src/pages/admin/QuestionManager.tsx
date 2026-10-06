import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { parseImport, type ParseResult } from '../../lib/importParse'
import { validateQuestion, validateTestCase } from '../../lib/validation'

interface Q { id: string; title: string; statement: string; constraints_text: string | null; sample_input: string | null
  sample_output: string | null; difficulty: string; points: number; languages: string[]; time_limit_ms: number; memory_limit_kb: number }
interface T { id: string; input: string; expected_output: string; is_hidden: boolean; position: number }
const blank = { title: '', statement: '', constraints_text: '', sample_input: '', sample_output: '', difficulty: 'easy', points: 100, languages: ['c', 'python'], time_limit_ms: 2000, memory_limit_kb: 128000 }

export default function QuestionManager() {
  const { id: cid } = useParams()
  const [title, setTitle] = useState(''); const [qs, setQs] = useState<Q[] | null>(null)
  const [form, setForm] = useState<(typeof blank & { id?: string }) | null>(null)
  const [msg, setMsg] = useState<string | null>(null); const [openTests, setOpenTests] = useState<string | null>(null)
  const [imp, setImp] = useState<ParseResult | null>(null)

  const load = async () => {
    const [c, q] = await Promise.all([
      supabase.from('challenges').select('title, day_number').eq('id', cid!).single(),
      supabase.from('questions').select('*').eq('challenge_id', cid!).order('created_at')])
    if (c.data) setTitle(`Day ${c.data.day_number}: ${c.data.title}`)
    if (q.error) setMsg('Could not load questions.'); else setQs(q.data as Q[])
  }
  useEffect(() => { load() }, [cid])

  async function save(e: FormEvent) {
    e.preventDefault(); if (!form) return; setMsg(null)
    const errs = validateQuestion(form); if (errs.length) return setMsg(errs.join(' '))
    const { id, ...f } = form
    const row = { ...f, constraints_text: f.constraints_text || null, sample_input: f.sample_input || null, sample_output: f.sample_output || null }
    const { error } = id ? await supabase.from('questions').update(row).eq('id', id)
      : await supabase.from('questions').insert({ ...row, challenge_id: cid })
    if (error) setMsg(error.message); else { setForm(null); load() }
  }
  async function del(q: Q) {
    if (!confirm(`Delete "${q.title}" and all its test cases?`)) return
    const { error } = await supabase.from('questions').delete().eq('id', q.id)
    if (error) setMsg(error.message); else load()
  }
  async function pickFile(f?: File) {
    if (!f) return; setImp(parseImport(f.name, await f.text()))
  }
  async function doImport() {
    if (!imp || imp.errors.length) return
    const { error } = await supabase.rpc('import_questions', { cid, payload: imp.questions })
    if (error) setMsg(error.message); else { setMsg(`Imported ${imp.questions.length} questions.`); setImp(null); load() }
  }
  const set = (k: string, v: unknown) => setForm(f => f && { ...f, [k]: v })
  const toggleLang = (l: string) => form && set('languages', form.languages.includes(l) ? form.languages.filter(x => x !== l) : [...form.languages, l])

  return <>
    <Link to="/admin" className="text-sm text-cyan-300">← All challenges</Link>
    <h1 className="font-display text-2xl font-bold">{title || 'Challenge'}</h1>
    {msg && <p className="mt-2 text-sm text-amber-300">{msg}</p>}
    <div className="mt-4 flex flex-wrap gap-3">
      <button className="btn-primary" onClick={() => setForm({ ...blank })}>New question</button>
      <label className="btn-ghost cursor-pointer">Import CSV / JSON
        <input type="file" accept=".csv,.json" className="hidden" onChange={e => pickFile(e.target.files?.[0])} /></label>
    </div>
    {imp && <div className="card mt-4 text-sm">
      <p>{imp.questions.length} question(s) parsed, {imp.questions.reduce((a, q) => a + q.test_cases.length, 0)} test case(s).</p>
      {imp.errors.length > 0 ? <ul className="mt-2 list-disc pl-5 text-red-400">{imp.errors.slice(0, 15).map((e, i) => <li key={i}>{e}</li>)}</ul>
        : <button className="btn-primary mt-3" onClick={doImport}>Confirm import</button>}
      <button className="btn-ghost ml-2 mt-3" onClick={() => setImp(null)}>Cancel</button></div>}

    {form && <form onSubmit={save} className="card mt-4 grid gap-3">
      <input className="input" placeholder="Title" required minLength={3} value={form.title} onChange={e => set('title', e.target.value)} />
      <textarea className="input" rows={6} placeholder="Problem statement" required value={form.statement} onChange={e => set('statement', e.target.value)} />
      <textarea className="input" rows={2} placeholder="Constraints" value={form.constraints_text} onChange={e => set('constraints_text', e.target.value)} />
      <div className="grid gap-3 sm:grid-cols-2">
        <textarea className="input font-mono" rows={3} placeholder="Sample input" value={form.sample_input} onChange={e => set('sample_input', e.target.value)} />
        <textarea className="input font-mono" rows={3} placeholder="Sample output" value={form.sample_output} onChange={e => set('sample_output', e.target.value)} /></div>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <select className="input w-auto" value={form.difficulty} onChange={e => set('difficulty', e.target.value)}>
          <option>easy</option><option>medium</option><option>hard</option></select>
        <label>Points <input className="input inline w-24" type="number" min={1} value={form.points} onChange={e => set('points', +e.target.value)} /></label>
        <label>Time ms <input className="input inline w-24" type="number" min={100} max={10000} value={form.time_limit_ms} onChange={e => set('time_limit_ms', +e.target.value)} /></label>
        {['c', 'python'].map(l => <label key={l}><input type="checkbox" checked={form.languages.includes(l)} onChange={() => toggleLang(l)} /> {l}</label>)}</div>
      <div className="flex gap-2"><button className="btn-primary">{form.id ? 'Save changes' : 'Create question'}</button>
        <button type="button" className="btn-ghost" onClick={() => setForm(null)}>Cancel</button></div></form>}

    {qs === null ? <p className="mt-4 text-slate-400">Loading…</p> : qs.length === 0 ? <p className="card mt-4 text-slate-400">No questions yet.</p> :
      <ul className="mt-4 space-y-3">{qs.map(q => <li key={q.id} className="card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><span className="font-display font-bold">{q.title}</span>
            <span className="ml-2 text-xs text-slate-400">{q.difficulty} · {q.points} pts · {q.languages.join('/')}</span></div>
          <div className="flex gap-2"><button className="btn-ghost" onClick={() => setOpenTests(openTests === q.id ? null : q.id)}>Test cases</button>
            <button className="btn-ghost" onClick={() => setForm({ ...q, constraints_text: q.constraints_text ?? '', sample_input: q.sample_input ?? '', sample_output: q.sample_output ?? '' })}>Edit</button>
            <button className="btn-ghost text-red-400" onClick={() => del(q)}>Delete</button></div></div>
        {openTests === q.id && <TestCases qid={q.id} />}</li>)}</ul>}
  </>
}

function TestCases({ qid }: { qid: string }) {
  const [rows, setRows] = useState<T[] | null>(null); const [msg, setMsg] = useState<string | null>(null)
  const [input, setInput] = useState(''); const [out, setOut] = useState(''); const [hidden, setHidden] = useState(true)
  const load = async () => {
    const { data, error } = await supabase.from('test_cases').select('*').eq('question_id', qid).order('position')
    if (error) setMsg('Could not load test cases.'); else setRows(data as T[])
  }
  useEffect(() => { load() }, [qid])
  async function add(e: FormEvent) {
    e.preventDefault(); setMsg(null)
    const errs = validateTestCase(input, out); if (errs.length) return setMsg(errs.join(' '))
    const { error } = await supabase.from('test_cases').insert({ question_id: qid, input, expected_output: out, is_hidden: hidden, position: rows?.length ?? 0 })
    if (error) setMsg(error.message); else { setInput(''); setOut(''); load() }
  }
  async function del(id: string) { const { error } = await supabase.from('test_cases').delete().eq('id', id); if (error) setMsg(error.message); else load() }
  async function flip(t: T) { const { error } = await supabase.from('test_cases').update({ is_hidden: !t.is_hidden }).eq('id', t.id); if (error) setMsg(error.message); else load() }
  return <div className="mt-3 border-t border-white/10 pt-3 text-sm">
    {msg && <p className="text-red-400">{msg}</p>}
    {rows?.map((t, i) => <div key={t.id} className="mb-2 grid gap-2 sm:grid-cols-[auto_1fr_1fr_auto]">
      <span className="text-slate-400">#{i + 1} {t.is_hidden ? '🔒 hidden' : 'visible'}</span>
      <pre className="overflow-auto rounded bg-black/30 p-2">{t.input || '(empty)'}</pre>
      <pre className="overflow-auto rounded bg-black/30 p-2">{t.expected_output}</pre>
      <div className="flex gap-1"><button className="btn-ghost" onClick={() => flip(t)}>Toggle</button>
        <button className="btn-ghost text-red-400" onClick={() => del(t.id)}>✕</button></div></div>)}
    {rows?.length === 0 && <p className="text-amber-300">No test cases: this question can't be auto-judged yet.</p>}
    <form onSubmit={add} className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
      <textarea className="input font-mono" rows={2} placeholder="Input (stdin)" value={input} onChange={e => setInput(e.target.value)} />
      <textarea className="input font-mono" rows={2} placeholder="Expected output" required value={out} onChange={e => setOut(e.target.value)} />
      <label className="flex items-center gap-1"><input type="checkbox" checked={hidden} onChange={e => setHidden(e.target.checked)} /> hidden</label>
      <button className="btn-primary">Add</button></form></div>
}
