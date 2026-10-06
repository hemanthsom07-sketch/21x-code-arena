import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { verdictColor, verdictLabel } from '../../lib/verdicts'
import { Empty, ErrorNote, Loading, Pager, fmt } from '../../components/ui'

interface Row { id: string; created_at: string; language: string; verdict: string | null; passed: number | null; total: number | null; time_ms: number | null; question_id: string; question: { title: string } | null }
const PAGE = 25
const VERDICTS = ['accepted', 'wrong_answer', 'compilation_error', 'runtime_error', 'time_limit_exceeded', 'internal_error']

export default function MySubmissions() {
  const [rows, setRows] = useState<Row[] | null>(null); const [total, setTotal] = useState(0); const [page, setPage] = useState(0)
  const [verdict, setVerdict] = useState(''); const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    setRows(null)
    let q = supabase.from('submissions').select('id, created_at, language, verdict, passed, total, time_ms, question_id, question:questions(title)', { count: 'exact' })   // RLS: own rows only
    if (verdict) q = q.eq('verdict', verdict)
    q.order('created_at', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1).then(({ data, count, error }) => {
      if (error) setErr('Could not load your submissions.'); else { setErr(null); setRows((data ?? []) as unknown as Row[]); setTotal(count ?? 0) }
    })
  }, [page, verdict])
  return <>
    <Link to="/" className="text-sm text-cyan-300">← Dashboard</Link>
    <div className="flex flex-wrap items-center justify-between gap-3"><h1 className="font-display text-2xl font-bold">My submissions</h1>
      <select className="input w-auto" value={verdict} onChange={e => { setPage(0); setVerdict(e.target.value) }} aria-label="Verdict">
        <option value="">All verdicts</option>{VERDICTS.map(v => <option key={v} value={v}>{verdictLabel(v)}</option>)}</select></div>
    {err && <div className="mt-3"><ErrorNote msg={err} /></div>}
    {!rows && !err ? <Loading /> : rows && (rows.length === 0 ? <Empty>No submissions yet.</Empty> : <>
      <div className="card mt-3 overflow-x-auto p-0"><table className="w-full text-left text-sm">
        <thead className="text-xs uppercase text-slate-400"><tr><th className="p-3">When</th><th>Question</th><th>Lang</th><th>Verdict</th><th>Tests</th><th className="p-3 text-right">Time</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.id} className="border-t border-white/5"><td className="p-3 whitespace-nowrap text-slate-400">{fmt(r.created_at)}</td>
          <td><Link to={`/questions/${r.question_id}`} className="hover:text-cyan-300">{r.question?.title ?? '—'}</Link></td><td>{r.language}</td>
          <td className={verdictColor(r.verdict)}>{verdictLabel(r.verdict)}</td><td>{r.total ? `${r.passed}/${r.total}` : '—'}</td><td className="p-3 text-right">{r.time_ms != null ? `${r.time_ms} ms` : '—'}</td></tr>)}</tbody></table></div>
      <Pager page={page} pageSize={PAGE} total={total} onPage={setPage} /></>)}
  </>
}
