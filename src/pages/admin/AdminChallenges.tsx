import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { challengeState } from '../../lib/challengeState'
import { validateChallenge } from '../../lib/validation'
import { Empty, ErrorNote, Loading, StateBadge, fmt, fromLocalInput, toLocalInput } from '../../components/ui'

interface Ch { id: string; day_number: number; title: string; is_unlocked: boolean; unlock_at: string | null; closes_at: string | null; unlocked_at: string | null }
const blank = { day_number: 1, title: '', unlock_at: '', closes_at: '' }

export default function AdminChallenges() {
  const [rows, setRows] = useState<Ch[] | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [form, setForm] = useState<typeof blank & { id?: string }>(blank)
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('challenges').select('id, day_number, title, is_unlocked, unlock_at, closes_at, unlocked_at').order('day_number').range(0, 99)
    if (error) setMsg('Could not load challenges.'); else setRows(data as Ch[])
  }, [])
  useEffect(() => { load() }, [load])

  const run = async (p: PromiseLike<{ error: { message: string } | null }>, friendly?: (m: string) => string) => {
    const { error } = await p
    if (error) setMsg(friendly ? friendly(error.message) : error.message); else { setMsg(null); load() }
    return !error
  }
  async function save(e: FormEvent) {
    e.preventDefault(); setMsg(null)
    const row = { day_number: form.day_number, title: form.title.trim(), unlock_at: fromLocalInput(form.unlock_at), closes_at: fromLocalInput(form.closes_at) }
    const errs = validateChallenge(row); if (errs.length) return setMsg(errs.join(' '))
    const ok = await run(form.id ? supabase.from('challenges').update(row).eq('id', form.id) : supabase.from('challenges').insert(row))
    if (ok) setForm(blank)
  }
  const del = (c: Ch) => { if (confirm(`Delete "${c.title}" and all its questions and test cases? This cannot be undone.`))
    run(supabase.from('challenges').delete().eq('id', c.id), m => /foreign key|violates/i.test(m)
      ? "This challenge has student submissions, so it can't be deleted (that would erase their history). Close or lock it instead." : m) }

  return <>
    <h1 className="font-display text-2xl font-bold">Challenges</h1>
    <p className="text-sm text-slate-400">Release and closing times are your local time. Students can read a closed challenge but not submit to it.</p>
    <form onSubmit={save} className="card mt-4 grid gap-3 sm:grid-cols-6">
      <label className="text-xs text-slate-400">Day<input className="input mt-1" type="number" min={1} max={21} value={form.day_number} onChange={e => setForm({ ...form, day_number: +e.target.value })} /></label>
      <label className="text-xs text-slate-400 sm:col-span-2">Title<input className="input mt-1" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} required minLength={3} maxLength={120} /></label>
      <label className="text-xs text-slate-400">Opens (optional)<input className="input mt-1" type="datetime-local" value={form.unlock_at} onChange={e => setForm({ ...form, unlock_at: e.target.value })} /></label>
      <label className="text-xs text-slate-400">Closes (optional)<input className="input mt-1" type="datetime-local" value={form.closes_at} onChange={e => setForm({ ...form, closes_at: e.target.value })} /></label>
      <div className="flex items-end gap-2"><button className="btn-primary">{form.id ? 'Save' : 'Create'}</button>{form.id && <button type="button" className="btn-ghost" onClick={() => setForm(blank)}>Cancel</button>}</div></form>
    {msg && <div className="mt-3"><ErrorNote msg={msg} /></div>}
    {!rows ? <div className="mt-4"><Loading /></div> : rows.length === 0 ? <div className="mt-4"><Empty>No challenges yet. Create the first one above.</Empty></div> :
      <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{rows.map(c => {
        const st = challengeState(c)
        return <li key={c.id} className="card">
          <div className="flex items-center justify-between"><span className="text-xs font-semibold text-violet-300">DAY {c.day_number}</span><StateBadge state={st} /></div>
          <Link to={`/admin/challenges/${c.id}`} className="font-display text-lg font-bold hover:text-cyan-300">{c.title}</Link>
          <div className="mt-1 space-y-0.5 text-xs text-slate-400">{c.unlock_at && <div>Opens: {fmt(c.unlock_at)}</div>}{c.closes_at && <div>Closes: {fmt(c.closes_at)}</div>}
            {c.unlocked_at && <div>Manually unlocked: {fmt(c.unlocked_at)}</div>}</div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <Link className="btn-ghost" to={`/admin/challenges/${c.id}`}>Questions</Link>
            <button className="btn-ghost" onClick={() => setForm({ id: c.id, day_number: c.day_number, title: c.title, unlock_at: toLocalInput(c.unlock_at), closes_at: toLocalInput(c.closes_at) })}>Edit</button>
            {st !== 'open' && st !== 'closed' && <button className="btn-ghost" onClick={() => run(supabase.rpc('unlock_challenge', { cid: c.id }))}>Unlock now</button>}
            {(st === 'open' || st === 'closed') && <button className="btn-ghost" onClick={() => confirm('Hide this challenge from students again?') && run(supabase.from('challenges').update({ is_unlocked: false, unlock_at: null, closes_at: null }).eq('id', c.id))}>Lock</button>}
            {st === 'open' && <button className="btn-ghost" onClick={() => confirm('Close now? Students will no longer be able to submit.') && run(supabase.from('challenges').update({ closes_at: new Date().toISOString() }).eq('id', c.id))}>Close now</button>}
            {st === 'closed' && <button className="btn-ghost" onClick={() => run(supabase.from('challenges').update({ closes_at: null }).eq('id', c.id))}>Reopen</button>}
            <button className="btn-ghost text-red-400" onClick={() => del(c)}>Delete</button></div></li>})}</ul>}
  </>
}
