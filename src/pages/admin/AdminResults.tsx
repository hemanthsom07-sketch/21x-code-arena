import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { fetchLeaderboard, type LbOk } from '../../lib/competitionApi'
import { downloadCsv, stamp, toCsv } from '../../lib/csv'
import { Empty, ErrorNote, Loading, fmt } from '../../components/ui'

export default function AdminResults() {
  const [chs, setChs] = useState<{ id: string; day_number: number; title: string }[]>([]); const [scope, setScope] = useState('all')
  const [lb, setLb] = useState<LbOk | null>(null); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false)
  useEffect(() => { supabase.from('challenges').select('id, day_number, title').order('day_number').then(({ data }) => setChs(data ?? [])) }, [])
  const load = useCallback(async () => { setLb(null); const r = await fetchLeaderboard({ challenge_id: scope === 'all' ? null : scope, limit: 200 }); if (r.ok) { setLb(r); setErr(null) } else setErr(r.message) }, [scope])
  useEffect(() => { load() }, [load])
  async function exportCsv() {
    setBusy(true)
    const r = await fetchLeaderboard({ challenge_id: scope === 'all' ? null : scope, export: true })   // server verifies the caller is an admin
    setBusy(false); if (!r.ok) return setErr(r.message)
    downloadCsv(`results-${scope === 'all' ? 'overall' : 'round'}-${stamp()}.csv`, toCsv(['rank', 'roll_number', 'name', 'department', 'solved', 'points', 'penalty_minutes', 'last_accept'], r.rows as unknown as Record<string, unknown>[]))
  }
  return <>
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="font-display text-2xl font-bold">Results</h1>
      <div className="flex gap-2"><select className="input w-auto" value={scope} onChange={e => setScope(e.target.value)} aria-label="Round"><option value="all">Overall</option>{chs.map(c => <option key={c.id} value={c.id}>Day {c.day_number}: {c.title}</option>)}</select>
        <button className="btn-primary" onClick={exportCsv} disabled={busy}>{busy ? 'Exporting…' : 'Export CSV'}</button></div></div>
    {err && <div className="mt-3"><ErrorNote msg={err} /></div>}
    {!lb && !err ? <div className="mt-3"><Loading /></div> : lb && (lb.rows.length === 0 ? <div className="mt-3"><Empty>No scoring submissions yet.</Empty></div> : <>
      <div className="card mt-3 overflow-x-auto p-0"><table className="w-full text-left text-sm"><thead className="text-xs uppercase text-slate-400"><tr><th className="p-3">#</th><th>Roll no.</th><th>Name</th><th>Dept</th><th className="text-right">Solved</th><th className="text-right">Points</th><th className="p-3 text-right">Penalty</th></tr></thead>
        <tbody>{lb.rows.map(r => <tr key={r.roll_number ?? r.name} className="border-t border-white/5"><td className="p-3">{r.rank}</td><td className="font-mono">{r.roll_number}</td><td>{r.name}</td><td className="text-slate-400">{r.department ?? '—'}</td><td className="text-right">{r.solved}</td><td className="text-right">{r.points}</td><td className="p-3 text-right">{r.penalty_minutes}</td></tr>)}</tbody></table></div>
      <p className="mt-2 text-xs text-slate-500">Top {lb.rows.length} of {lb.total_ranked} ranked. Updated {fmt(lb.updated_at)}. The CSV contains everyone.</p></>)}
  </>
}
