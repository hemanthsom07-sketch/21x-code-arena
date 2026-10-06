import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { fetchLeaderboard, type LbOk } from '../../lib/competitionApi'
import { Empty, ErrorNote, Loading, fmt } from '../../components/ui'

const REFRESH_MS = 30_000

export default function Leaderboard() {
  const [chs, setChs] = useState<{ id: string; day_number: number; title: string }[]>([])
  const [scope, setScope] = useState('all')
  const [lb, setLb] = useState<LbOk | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => { supabase.from('challenges').select('id, day_number, title').order('day_number').then(({ data }) => setChs(data ?? [])) }, [])
  const load = useCallback(async () => {
    const r = await fetchLeaderboard({ challenge_id: scope === 'all' ? null : scope, limit: 100 })
    if (r.ok) { setLb(r); setErr(null) } else setErr(r.message)
  }, [scope])
  useEffect(() => {
    setLb(null); load()
    const t = setInterval(() => { if (document.visibilityState === 'visible') load() }, REFRESH_MS)   // no polling from background tabs
    return () => clearInterval(t)
  }, [load])

  return <>
    <Link to="/" className="text-sm text-cyan-300">← Dashboard</Link>
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="font-display text-2xl font-bold">Leaderboard</h1>
      <select className="input w-auto" value={scope} onChange={e => setScope(e.target.value)} aria-label="Round">
        <option value="all">Overall</option>{chs.map(c => <option key={c.id} value={c.id}>Day {c.day_number}: {c.title}</option>)}</select></div>
    {err && <div className="mt-3"><ErrorNote msg={err} /></div>}
    {!lb && !err ? <Loading /> : lb && (lb.rows.length === 0 ? <Empty>No one has scored yet. Be the first!</Empty> : <>
      <div className="card mt-3 overflow-x-auto p-0"><table className="w-full text-left text-sm">
        <thead className="text-xs uppercase text-slate-400"><tr><th className="p-3">#</th><th>Name</th><th>Dept</th><th className="text-right">Solved</th><th className="text-right">Points</th><th className="p-3 text-right">Penalty (min)</th></tr></thead>
        <tbody>{lb.rows.map(r => <tr key={`${r.rank}-${r.name}`} className={`border-t border-white/5 ${r.is_me ? 'bg-violet-500/15 font-semibold' : ''}`}>
          <td className="p-3">{r.rank <= 3 ? ['🥇', '🥈', '🥉'][r.rank - 1] : r.rank}</td><td>{r.name}{r.is_me && ' (you)'}</td><td className="text-slate-400">{r.department ?? '—'}</td>
          <td className="text-right">{r.solved}</td><td className="text-right">{r.points}</td><td className="p-3 text-right">{r.penalty_minutes}</td></tr>)}</tbody></table></div>
      {lb.me && !lb.rows.some(r => r.is_me) && <p className="card mt-3 text-sm">Your position: <b>#{lb.me.rank}</b> · {lb.me.points} pts · {lb.me.penalty_minutes} min penalty</p>}
      <p className="mt-2 text-xs text-slate-500">Showing top {lb.rows.length} of {lb.total_ranked}. Updated {fmt(lb.updated_at)}; refreshes automatically. Ties on points and penalty are broken by who solved last-needed question first.</p></>)}
  </>
}
