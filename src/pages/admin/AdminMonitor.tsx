import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { downloadCsv, stamp, toCsv } from '../../lib/csv'
import { verdictColor, verdictLabel } from '../../lib/verdicts'
import { Empty, ErrorNote, InfoNote, Loading, Pager, Stat, fmt } from '../../components/ui'

interface Ov { participants: number; enabled_accounts: number; roster_total: number; roster_activated: number; active_30m: number; submissions: number; judged: number; accepted: number; failed: number
  judge_errors: number; pending: number; stuck: number; last_hour: number; judge_events_24h: number; verdicts: Record<string, number> }
interface Sub { id: string; created_at: string; user_id: string; full_name: string | null; roll_number: string | null; question_id: string; question_title: string; day_number: number; language: string; verdict: string | null; passed: number | null; total: number | null; time_ms: number | null; message: string | null; total_count: number }
interface QS { question_id: string; title: string; day_number: number; points: number; submissions: number; accepted: number; solvers: number; judge_errors: number }
interface Ev { id: number; at: string; kind: string; user_id: string | null; code: string; detail: string | null }
const PAGE = 25, VERDICTS = ['accepted', 'wrong_answer', 'compilation_error', 'runtime_error', 'time_limit_exceeded', 'internal_error', 'pending']
const REFRESH_MS = 15_000

export default function AdminMonitor() {
  const [ov, setOv] = useState<Ov | null>(null); const [qs, setQs] = useState<QS[] | null>(null); const [evs, setEvs] = useState<Ev[] | null>(null)
  const [msg, setMsg] = useState<string | null>(null); const [info, setInfo] = useState<string | null>(null)
  const [subs, setSubs] = useState<Sub[] | null>(null); const [total, setTotal] = useState(0); const [page, setPage] = useState(0)
  const [f, setF] = useState({ verdict: '', challenge: '', question: '', roll: '' }); const [userId, setUserId] = useState<string | null | undefined>(undefined)
  const [chs, setChs] = useState<{ id: string; day_number: number; title: string }[]>([]); const [open, setOpen] = useState<string | null>(null)
  const [detail, setDetail] = useState<{ code: string; results: unknown; message: string | null } | null>(null)

  useEffect(() => { supabase.from('challenges').select('id, day_number, title').order('day_number').then(({ data }) => setChs(data ?? [])) }, [])
  const loadStatic = useCallback(async () => {
    const [o, q, e] = await Promise.all([supabase.rpc('admin_overview'), supabase.rpc('admin_question_stats'),
      supabase.from('judge_events').select('id, at, kind, user_id, code, detail').order('at', { ascending: false }).limit(25)])
    if (o.error) setMsg(`Could not load overview: ${o.error.message}. Has migration 0005 been applied?`); else { setOv(o.data as Ov); setMsg(null) }
    if (!q.error) setQs(q.data as QS[]); if (!e.error) setEvs(e.data as Ev[])
  }, [])
  useEffect(() => { loadStatic(); const t = setInterval(() => { if (document.visibilityState === 'visible') loadStatic() }, REFRESH_MS); return () => clearInterval(t) }, [loadStatic])

  // Resolve a typed roll number to a user id once (so the heavy query filters on an indexed uuid).
  useEffect(() => {
    const r = f.roll.trim(); if (!r) { setUserId(undefined); return }
    const t = setTimeout(async () => { const { data } = await supabase.from('profiles').select('id').ilike('roll_number', r.replace(/[%,()*\\]/g, ' ')).limit(1); setUserId(data?.[0]?.id ?? null) }, 300)
    return () => clearTimeout(t)
  }, [f.roll])

  const args = (limit: number, offset: number) => ({ p_user: userId ?? null, p_question: f.question || null, p_challenge: f.challenge || null, p_verdict: f.verdict || null, p_limit: limit, p_offset: offset })
  useEffect(() => {
    if (userId === null) { setSubs([]); setTotal(0); return }
    setSubs(null)
    supabase.rpc('admin_submissions', args(PAGE, page * PAGE)).then(({ data, error }) => {
      if (error) setMsg(error.message); else { const r = (data ?? []) as Sub[]; setSubs(r); setTotal(r[0]?.total_count ?? 0) }
    })
  }, [page, f.verdict, f.challenge, f.question, userId])   // eslint-disable-line react-hooks/exhaustive-deps

  async function inspect(id: string) {
    if (open === id) { setOpen(null); return }
    setOpen(id); setDetail(null)
    const { data } = await supabase.from('submissions').select('code, results, message').eq('id', id).single()   // admins may read all submissions (RLS)
    setDetail(data as typeof detail)
  }
  async function exportSubs() {
    const all: Sub[] = []
    for (let off = 0; off < 20000; off += 200) { const { data, error } = await supabase.rpc('admin_submissions', args(200, off)); if (error) return setMsg(error.message); const r = (data ?? []) as Sub[]; all.push(...r); if (r.length < 200) break }
    downloadCsv(`submissions-${stamp()}.csv`, toCsv(['created_at', 'roll_number', 'full_name', 'day_number', 'question_title', 'language', 'verdict', 'passed', 'total', 'time_ms'], all as unknown as Record<string, unknown>[]))
  }
  async function sweep() {
    if (!confirm('Mark submissions that never received a verdict (older than 10 minutes) as judge errors? They are not penalised.')) return
    const { data, error } = await supabase.rpc('sweep_stuck_submissions', { p_minutes: 10 }); if (error) setMsg(error.message); else { setInfo(`${data} stuck submission(s) marked as judge errors.`); loadStatic() }
  }
  async function recompute() {
    if (!confirm('Rebuild all scores from the submissions table? Use this after changing question points. Scores briefly change while it runs.')) return
    const { data, error } = await supabase.rpc('recompute_results'); if (error) setMsg(error.message); else setInfo(`Scores rebuilt (${data} result rows).`)
  }
  const vmax = ov ? Math.max(1, ...Object.values(ov.verdicts)) : 1
  const qsFiltered = (qs ?? []).filter(q => !f.challenge || chs.find(c => c.id === f.challenge)?.day_number === q.day_number)

  return <>
    <h1 className="font-display text-2xl font-bold">Monitoring</h1>
    <p className="text-sm text-slate-400">Auto-refreshes every 15 s while this tab is visible.</p>
    {msg && <div className="mt-3"><ErrorNote msg={msg} /></div>}{info && <div className="mt-3"><InfoNote>{info}</InfoNote></div>}
    {!ov ? <div className="mt-3"><Loading /></div> : <>
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Participants" value={ov.participants} sub={`${ov.enabled_accounts} enabled · ${ov.roster_activated}/${ov.roster_total} of roster activated`} />
        <Stat label="Active (30 min)" value={ov.active_30m} sub="distinct students submitting" /><Stat label="Submissions" value={ov.submissions} sub={`${ov.last_hour} in the last hour`} />
        <Stat label="Accepted" value={ov.accepted} sub={`${ov.failed} failed · ${ov.judged ? Math.round(100 * ov.accepted / ov.judged) : 0}% acceptance`} />
        <Stat label="Judge errors" value={ov.judge_errors} sub={`${ov.judge_events_24h} failures logged in 24 h`} /><Stat label="In flight" value={ov.pending} sub="judging right now" />
        <Stat label="Stuck" value={ov.stuck} sub="no verdict after 10 min" /><div className="card flex flex-col justify-center gap-2"><button className="btn-ghost text-xs" onClick={sweep}>Resolve stuck submissions</button><button className="btn-ghost text-xs" onClick={recompute}>Recompute scores</button></div></div>
      <h2 className="mt-6 font-display text-lg font-bold">Verdicts</h2>
      {Object.keys(ov.verdicts).length === 0 ? <Empty>No judged submissions yet.</Empty> : <div className="card mt-2 space-y-1">{Object.entries(ov.verdicts).sort((a, b) => b[1] - a[1]).map(([v, n]) =>
        <div key={v} className="flex items-center gap-2 text-sm"><span className={`w-44 shrink-0 ${verdictColor(v)}`}>{verdictLabel(v)}</span>
          <div className="h-3 flex-1 rounded bg-white/5"><div className="h-3 rounded bg-violet-500/70" style={{ width: `${(100 * n) / vmax}%` }} /></div><span className="w-12 text-right">{n}</span></div>)}</div>}</>}

    <h2 className="mt-6 font-display text-lg font-bold">Per-question statistics</h2>
    {!qs ? <Loading /> : qsFiltered.length === 0 ? <Empty>No questions yet.</Empty> : <div className="card mt-2 overflow-x-auto p-0"><table className="w-full text-left text-sm"><thead className="text-xs uppercase text-slate-400"><tr><th className="p-3">Day</th><th>Question</th><th className="text-right">Pts</th><th className="text-right">Submissions</th><th className="text-right">Accepted</th><th className="text-right">Solvers</th><th className="p-3 text-right">Judge errors</th></tr></thead>
      <tbody>{qsFiltered.map(q => <tr key={q.question_id} className="border-t border-white/5"><td className="p-3">{q.day_number}</td><td>{q.title}</td><td className="text-right">{q.points}</td><td className="text-right">{q.submissions}</td><td className="text-right">{q.accepted}</td><td className="text-right">{q.solvers}</td><td className="p-3 text-right">{q.judge_errors}</td></tr>)}</tbody></table></div>}

    <h2 className="mt-6 font-display text-lg font-bold">Submissions</h2>
    <div className="mt-2 flex flex-wrap gap-2">
      <select className="input w-auto" value={f.challenge} onChange={e => { setPage(0); setF({ ...f, challenge: e.target.value }) }} aria-label="Round"><option value="">All rounds</option>{chs.map(c => <option key={c.id} value={c.id}>Day {c.day_number}</option>)}</select>
      <select className="input w-auto" value={f.verdict} onChange={e => { setPage(0); setF({ ...f, verdict: e.target.value }) }} aria-label="Verdict"><option value="">All verdicts</option>{VERDICTS.map(v => <option key={v} value={v}>{verdictLabel(v)}</option>)}</select>
      <input className="input max-w-[12rem]" placeholder="Roll number" value={f.roll} onChange={e => { setPage(0); setF({ ...f, roll: e.target.value }) }} aria-label="Participant roll number" />
      <button className="btn-ghost" onClick={exportSubs}>Export CSV</button></div>
    {f.roll.trim() && userId === null && <p className="mt-2 text-sm text-amber-300">No participant has that roll number yet.</p>}
    {!subs ? <div className="mt-3"><Loading /></div> : subs.length === 0 ? <div className="mt-3"><Empty>No submissions match these filters.</Empty></div> : <>
      <div className="card mt-3 overflow-x-auto p-0"><table className="w-full text-left text-sm"><thead className="text-xs uppercase text-slate-400"><tr><th className="p-3">When</th><th>Participant</th><th>Question</th><th>Lang</th><th>Verdict</th><th>Tests</th><th className="p-3 text-right">Time</th></tr></thead>
        <tbody>{subs.map(s => <><tr key={s.id} className="cursor-pointer border-t border-white/5 hover:bg-white/5" onClick={() => inspect(s.id)}>
          <td className="p-3 whitespace-nowrap text-slate-400">{fmt(s.created_at)}</td><td>{s.full_name} <span className="font-mono text-xs text-slate-500">{s.roll_number}</span></td><td>D{s.day_number} · {s.question_title}</td><td>{s.language}</td>
          <td className={verdictColor(s.verdict)}>{verdictLabel(s.verdict)}</td><td>{s.total ? `${s.passed}/${s.total}` : '—'}</td><td className="p-3 text-right">{s.time_ms != null ? `${s.time_ms} ms` : '—'}</td></tr>
          {open === s.id && <tr key={s.id + 'd'}><td colSpan={7} className="bg-black/30 p-3">{!detail ? <Loading /> : <>{detail.message && <pre className="mb-2 whitespace-pre-wrap text-xs text-amber-200">{detail.message}</pre>}
            <pre className="max-h-72 overflow-auto rounded bg-black/40 p-2 text-xs">{detail.code}</pre>
            <pre className="mt-2 max-h-48 overflow-auto rounded bg-black/40 p-2 text-xs">{JSON.stringify(detail.results, null, 1)}</pre></>}</td></tr>}</>)}</tbody></table></div>
      <Pager page={page} pageSize={PAGE} total={total} onPage={setPage} /></>}

    <h2 className="mt-6 font-display text-lg font-bold">Judge failures (latest 25)</h2>
    {!evs ? <Loading /> : evs.length === 0 ? <Empty>No judge failures logged. 🎉</Empty> : <div className="card mt-2 overflow-x-auto p-0"><table className="w-full text-left text-xs"><thead className="uppercase text-slate-400"><tr><th className="p-3">When</th><th>Kind</th><th>Code</th><th>Detail</th></tr></thead>
      <tbody>{evs.map(e => <tr key={e.id} className="border-t border-white/5"><td className="p-3 whitespace-nowrap text-slate-400">{fmt(e.at)}</td><td>{e.kind}</td><td className="text-amber-300">{e.code}</td><td className="text-slate-300">{e.detail}</td></tr>)}</tbody></table></div>}
  </>
}
