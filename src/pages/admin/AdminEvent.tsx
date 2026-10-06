import { useEffect, useState, type FormEvent } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { validateAnnouncement, validateEvent } from '../../lib/validation'
import { Empty, ErrorNote, InfoNote, Loading, fmt, fromLocalInput, toLocalInput } from '../../components/ui'

interface Cfg { name: string; starts_at: string; ends_at: string; submissions_open: boolean; wrong_penalty_minutes: number; leaderboard_public: boolean; rules: string }
interface Ann { id: string; title: string; body: string; pinned: boolean; published: boolean; created_at: string }

export default function AdminEvent() {
  const { profile } = useAuth()
  const [cfg, setCfg] = useState<Cfg | null>(null); const [saved, setSaved] = useState<boolean | null>(null)
  const [msg, setMsg] = useState<string | null>(null); const [ok, setOk] = useState<string | null>(null)
  const [anns, setAnns] = useState<Ann[] | null>(null); const [form, setForm] = useState({ title: '', body: '', pinned: false })

  const loadAnns = async () => { const { data, error } = await supabase.from('announcements').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false }).range(0, 99); if (error) setMsg('Could not load announcements.'); else setAnns(data as Ann[]) }
  useEffect(() => {
    supabase.from('event_config').select('*').eq('id', 1).single().then(({ data, error }) => {
      if (error || !data) { setMsg('Could not load event settings. Has migration 0005 been applied?'); return }
      setCfg({ ...data, starts_at: toLocalInput(data.starts_at), ends_at: toLocalInput(data.ends_at) }); setSaved(data.submissions_open)
    }); loadAnns()
  }, [])

  async function saveCfg(e: FormEvent) {
    e.preventDefault(); if (!cfg) return; setMsg(null); setOk(null)
    const row = { name: cfg.name.trim(), starts_at: fromLocalInput(cfg.starts_at), ends_at: fromLocalInput(cfg.ends_at), submissions_open: cfg.submissions_open,
      wrong_penalty_minutes: cfg.wrong_penalty_minutes, leaderboard_public: cfg.leaderboard_public, rules: cfg.rules }
    const errs = validateEvent(row); if (errs.length) return setMsg(errs.join(' '))
    if (saved !== null && row.submissions_open !== saved && !confirm(row.submissions_open ? 'Resume submissions for all students?' : 'PAUSE submissions for all students now?')) return
    const { error } = await supabase.from('event_config').update({ ...row, updated_at: new Date().toISOString(), updated_by: profile?.id }).eq('id', 1)
    if (error) setMsg(error.message); else { setSaved(row.submissions_open); setOk('Saved.') }
  }
  async function addAnn(e: FormEvent) {
    e.preventDefault(); setMsg(null)
    const errs = validateAnnouncement(form); if (errs.length) return setMsg(errs.join(' '))
    const { error } = await supabase.from('announcements').insert({ title: form.title.trim(), body: form.body, pinned: form.pinned, created_by: profile?.id })
    if (error) setMsg(error.message); else { setForm({ title: '', body: '', pinned: false }); loadAnns() }
  }
  const patchAnn = async (id: string, patch: Partial<Ann>) => { const { error } = await supabase.from('announcements').update(patch).eq('id', id); if (error) setMsg(error.message); else loadAnns() }
  const delAnn = async (a: Ann) => { if (!confirm(`Delete announcement "${a.title}"?`)) return; const { error } = await supabase.from('announcements').delete().eq('id', a.id); if (error) setMsg(error.message); else loadAnns() }

  return <>
    <h1 className="font-display text-2xl font-bold">Event control</h1>
    {msg && <div className="mt-3"><ErrorNote msg={msg} /></div>}
    {!cfg ? <div className="mt-3"><Loading /></div> : <form onSubmit={saveCfg} className="card mt-4 grid gap-3 sm:grid-cols-2">
      <label className="text-xs text-slate-400 sm:col-span-2">Event name<input className="input mt-1" value={cfg.name} maxLength={120} onChange={e => setCfg({ ...cfg, name: e.target.value })} /></label>
      <label className="text-xs text-slate-400">Starts<input className="input mt-1" type="datetime-local" value={cfg.starts_at} onChange={e => setCfg({ ...cfg, starts_at: e.target.value })} /></label>
      <label className="text-xs text-slate-400">Ends<input className="input mt-1" type="datetime-local" value={cfg.ends_at} onChange={e => setCfg({ ...cfg, ends_at: e.target.value })} /></label>
      <label className="text-xs text-slate-400">Penalty per wrong attempt (minutes)<input className="input mt-1" type="number" min={0} max={600} value={cfg.wrong_penalty_minutes} onChange={e => setCfg({ ...cfg, wrong_penalty_minutes: +e.target.value })} /></label>
      <div className="flex flex-col justify-end gap-2 text-sm">
        <label><input type="checkbox" checked={cfg.submissions_open} onChange={e => setCfg({ ...cfg, submissions_open: e.target.checked })} /> Submissions open (uncheck to pause everything)</label>
        <label><input type="checkbox" checked={cfg.leaderboard_public} onChange={e => setCfg({ ...cfg, leaderboard_public: e.target.checked })} /> Students can see the leaderboard</label></div>
      <label className="text-xs text-slate-400 sm:col-span-2">Competition rules (shown to students)<textarea className="input mt-1" rows={5} value={cfg.rules} maxLength={4000} onChange={e => setCfg({ ...cfg, rules: e.target.value })} /></label>
      <div className="sm:col-span-2"><InfoNote>Changing the penalty re-ranks the leaderboard immediately (within ~10 s). The event window and the pause switch apply to Run and Submit; the per-challenge closing time is set on the Challenges page.</InfoNote></div>
      <div className="flex items-center gap-3"><button className="btn-primary">Save settings</button>{ok && <span className="text-sm text-lime-300">{ok}</span>}</div></form>}

    <h2 className="mt-8 font-display text-lg font-bold">Announcements</h2>
    <form onSubmit={addAnn} className="card mt-2 grid gap-3">
      <input className="input" placeholder="Title" value={form.title} maxLength={120} onChange={e => setForm({ ...form, title: e.target.value })} required />
      <textarea className="input" rows={3} placeholder="Message (optional)" value={form.body} maxLength={2000} onChange={e => setForm({ ...form, body: e.target.value })} />
      <div className="flex items-center gap-4 text-sm"><label><input type="checkbox" checked={form.pinned} onChange={e => setForm({ ...form, pinned: e.target.checked })} /> Pin to top</label><button className="btn-primary">Publish</button></div></form>
    {!anns ? <div className="mt-3"><Loading /></div> : anns.length === 0 ? <div className="mt-3"><Empty>No announcements yet.</Empty></div> :
      <ul className="mt-3 space-y-2">{anns.map(a => <li key={a.id} className="card">
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold">{a.pinned && '📌 '}{a.title}{!a.published && <span className="ml-2 text-xs text-amber-300">(hidden)</span>}</span>
          <span className="text-xs text-slate-500">{fmt(a.created_at)}</span></div>
        {a.body && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-300">{a.body}</p>}
        <div className="mt-2 flex gap-2 text-xs"><button className="btn-ghost" onClick={() => patchAnn(a.id, { published: !a.published })}>{a.published ? 'Hide' : 'Show'}</button>
          <button className="btn-ghost" onClick={() => patchAnn(a.id, { pinned: !a.pinned })}>{a.pinned ? 'Unpin' : 'Pin'}</button><button className="btn-ghost text-red-400" onClick={() => delAnn(a)}>Delete</button></div></li>)}</ul>}
  </>
}
