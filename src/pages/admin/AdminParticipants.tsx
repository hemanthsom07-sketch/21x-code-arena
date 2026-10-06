import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { parseCsv } from '../../lib/importParse'
import { parseParticipants, type ParticipantParse } from '../../lib/participants'
import { downloadCsv, stamp, toCsv } from '../../lib/csv'
import { Empty, ErrorNote, InfoNote, Loading, Pager, fmt } from '../../components/ui'

interface R { id: string; roll_number: string; full_name: string; email: string; department: string | null; year: number | null; status: string; user_id: string | null; activated_at: string | null }
const PAGE = 25, COLS = 'id, roll_number, full_name, email, department, year, status, user_id, activated_at'
const STATUS_STYLE: Record<string, string> = { pending: 'text-amber-300', active: 'text-lime-300', disabled: 'text-red-400' }
const clean = (s: string) => s.replace(/[%,()*\\]/g, ' ').trim()   // keep user text out of the PostgREST filter syntax

async function allRoster(cols: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  for (let from = 0; ; from += 1000) {   // PostgREST returns at most 1000 rows per request
    const { data, error } = await supabase.from('roster').select(cols).order('roll_number').range(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...((data ?? []) as unknown as Record<string, unknown>[])); if (!data || data.length < 1000) return out
  }
}

export default function AdminParticipants() {
  const [rows, setRows] = useState<R[] | null>(null); const [total, setTotal] = useState(0); const [page, setPage] = useState(0)
  const [search, setSearch] = useState(''); const [status, setStatus] = useState(''); const [msg, setMsg] = useState<string | null>(null)
  const [codes, setCodes] = useState<{ roll_number: string; full_name: string; email: string; code: string }[] | null>(null)
  const [sel, setSel] = useState<R | null>(null)

  const load = useCallback(async () => {
    let q = supabase.from('roster').select(COLS, { count: 'exact' })
    if (status) q = q.eq('status', status)
    const s = clean(search); if (s) q = q.or(`roll_number.ilike.%${s}%,full_name.ilike.%${s}%,email.ilike.%${s}%`)
    const { data, count, error } = await q.order('roll_number').range(page * PAGE, page * PAGE + PAGE - 1)
    if (error) setMsg('Could not load participants. Has migration 0005 been applied?'); else { setRows((data ?? []) as R[]); setTotal(count ?? 0) }
  }, [page, search, status])
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t) }, [load])   // debounce typing

  const toggle = async (r: R) => {
    if (!r.user_id) return
    const enable = r.status === 'disabled'
    if (!confirm(`${enable ? 'Enable' : 'Disable'} access for ${r.full_name} (${r.roll_number})?`)) return
    const { error } = await supabase.rpc('set_participant_active', { p_user: r.user_id, p_active: enable })
    if (error) setMsg(error.message); else { setMsg(null); load() }
  }
  async function genCodes(ids: string[] | null, label: string) {
    if (!confirm(`Generate new one-time activation codes for ${label}? Any unused code they already have stops working. The codes are shown ONCE.`)) return
    const { data, error } = await supabase.rpc('generate_activation_codes', { p_roster_ids: ids })
    if (error) return setMsg(error.message)
    const list = (data ?? []) as { roll_number: string; full_name: string; email: string; code: string }[]
    if (!list.length) return setMsg('No pending participants to generate codes for.')
    setMsg(null); setCodes(list)
    downloadCsv(`activation-codes-${stamp()}.csv`, toCsv(['roll_number', 'full_name', 'email', 'activation_code'], list.map(c => ({ ...c, activation_code: `${c.code.slice(0, 5)}-${c.code.slice(5)}` }))))
    load()
  }
  async function exportAll() {
    try { const all = await allRoster('roll_number, full_name, email, department, year, status, activated_at')
      downloadCsv(`participants-${stamp()}.csv`, toCsv(['roll_number', 'full_name', 'email', 'department', 'year', 'status', 'activated_at'], all)) }
    catch (e) { setMsg(`Export failed: ${(e as Error).message}`) }
  }

  return <>
    <h1 className="font-display text-2xl font-bold">Participants</h1>
    <p className="text-sm text-slate-400">Import a CSV, give each student a one-time activation code, and they set their own password at <code>/activate</code>. Passwords are never in the CSV.</p>
    {msg && <div className="mt-3"><ErrorNote msg={msg} /></div>}
    {codes && <div className="card mt-3"><InfoNote>Activation codes for {codes.length} participant(s) were downloaded as a CSV. They are not stored in readable form and cannot be shown again; keep the file safe and delete it after distributing.</InfoNote>
      <button className="btn-ghost mt-2" onClick={() => setCodes(null)}>Dismiss</button></div>}

    <ImportPanel onDone={() => { setPage(0); load() }} />

    <div className="mt-6 flex flex-wrap items-center gap-2">
      <input className="input max-w-xs" placeholder="Search roll no., name or email" value={search} onChange={e => { setPage(0); setSearch(e.target.value) }} aria-label="Search participants" />
      <select className="input w-auto" value={status} onChange={e => { setPage(0); setStatus(e.target.value) }} aria-label="Status"><option value="">All statuses</option><option value="pending">Pending activation</option><option value="active">Active</option><option value="disabled">Disabled</option></select>
      <button className="btn-ghost" onClick={exportAll}>Export CSV</button>
      <button className="btn-ghost" onClick={() => genCodes(null, 'ALL pending participants')}>Generate codes for all pending</button></div>

    {!rows ? <div className="mt-3"><Loading /></div> : rows.length === 0 ? <div className="mt-3"><Empty>No participants match. Import a CSV above.</Empty></div> : <>
      <div className="card mt-3 overflow-x-auto p-0"><table className="w-full text-left text-sm"><thead className="text-xs uppercase text-slate-400"><tr><th className="p-3">Roll no.</th><th>Name</th><th>Dept</th><th>Status</th><th className="p-3 text-right">Actions</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.id} className="border-t border-white/5"><td className="p-3 font-mono">{r.roll_number}</td><td>{r.full_name}</td><td className="text-slate-400">{r.department ?? '—'}{r.year ? ` · ${r.year}` : ''}</td>
          <td className={STATUS_STYLE[r.status]}>{r.status}</td><td className="p-3 text-right whitespace-nowrap"><button className="btn-ghost mr-1 text-xs" onClick={() => setSel(r)}>Details</button>
            {r.status === 'pending' && <button className="btn-ghost mr-1 text-xs" onClick={() => genCodes([r.id], r.roll_number)}>New code</button>}
            {r.user_id && <button className="btn-ghost text-xs" onClick={() => toggle(r)}>{r.status === 'disabled' ? 'Enable' : 'Disable'}</button>}</td></tr>)}</tbody></table></div>
      <Pager page={page} pageSize={PAGE} total={total} onPage={setPage} /></>}
    {sel && <div className="card mt-4"><div className="flex justify-between"><h2 className="font-display font-bold">{sel.full_name}</h2><button className="btn-ghost text-xs" onClick={() => setSel(null)}>Close</button></div>
      <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-2"><dt className="text-slate-400">Roll number</dt><dd>{sel.roll_number}</dd><dt className="text-slate-400">Email</dt><dd>{sel.email}</dd>
        <dt className="text-slate-400">Department / year</dt><dd>{sel.department ?? '—'} / {sel.year ?? '—'}</dd><dt className="text-slate-400">Status</dt><dd>{sel.status}</dd><dt className="text-slate-400">Activated</dt><dd>{fmt(sel.activated_at)}</dd></dl></div>}
  </>
}

function ImportPanel({ onDone }: { onDone: () => void }) {
  const [parsed, setParsed] = useState<ParticipantParse | null>(null); const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState<string | null>(null); const [err, setErr] = useState<string | null>(null)
  const [summary, setSummary] = useState<{ inserted: number; duplicate_roll: number; duplicate_email: number; invalid: number } | null>(null)

  async function pick(f?: File) {
    if (!f) return; setErr(null); setSummary(null); setParsed(null); setFileName(f.name); setBusy('Checking file…')
    try {
      if (f.size > 2_000_000) throw new Error('File is too large (2 MB max).')
      const existing = await allRoster('roll_number, email')   // for duplicate detection against what is already imported
      setParsed(parseParticipants(parseCsv(await f.text()), { rolls: new Set(existing.map(r => String(r.roll_number).toUpperCase())), emails: new Set(existing.map(r => String(r.email).toLowerCase())) }))
    } catch (e) { setErr((e as Error).message) } finally { setBusy(null) }
  }
  async function run() {
    if (!parsed || !parsed.valid.length) return
    const tot = { inserted: 0, duplicate_roll: 0, duplicate_email: 0, invalid: 0 }; setErr(null)
    for (let i = 0; i < parsed.valid.length; i += 200) {
      setBusy(`Importing ${Math.min(i + 200, parsed.valid.length)} / ${parsed.valid.length}…`)
      const { data, error } = await supabase.rpc('import_roster', { p_rows: parsed.valid.slice(i, i + 200) })
      if (error) { setBusy(null); setSummary(tot); setErr(`Stopped after ${i} of ${parsed.valid.length} rows: ${error.message}. The remaining rows were NOT imported. Re-upload the same file to continue; rows already imported are skipped as duplicates.`); onDone(); return }
      for (const r of data as { result: keyof typeof tot | 'inserted' }[]) tot[r.result as keyof typeof tot]++
    }
    setBusy(null); setSummary(tot); setParsed(null); onDone()
  }
  const errorReport = () => parsed && downloadCsv(`import-errors-${stamp()}.csv`, toCsv(['line', 'roll_number', 'full_name', 'email', 'department', 'year', 'errors'],
    parsed.invalid.map(r => ({ line: r.line, ...r.raw, errors: r.errors.join(' ') }))))

  return <div className="card mt-4"><h2 className="font-display font-bold">Import participants</h2>
    <p className="mt-1 text-sm text-slate-400">Columns: roll_number, full_name, email (required); department, year (optional). <a className="text-cyan-300 underline" href="/participants-template.csv" download>Download template</a></p>
    <input className="mt-3 block text-sm" type="file" accept=".csv,text/csv" onChange={e => { pick(e.target.files?.[0]); e.target.value = '' }} disabled={!!busy} aria-label="Participants CSV" />
    {busy && <div className="mt-2"><Loading what={busy} /></div>}{err && <div className="mt-3"><ErrorNote msg={err} /></div>}
    {summary && <div className="mt-3"><InfoNote>Imported {summary.inserted} participant(s). Skipped as already present: {summary.duplicate_roll + summary.duplicate_email}. Rejected by the database: {summary.invalid}.</InfoNote></div>}
    {parsed && <div className="mt-3">
      {parsed.fileErrors.length > 0 ? parsed.fileErrors.map((m, i) => <ErrorNote key={i} msg={m} />) : <>
        <p className="text-sm"><b className="text-lime-300">{parsed.valid.length} valid</b> · <b className={parsed.invalid.length ? 'text-red-400' : ''}>{parsed.invalid.length} with errors</b> in <i>{fileName}</i>. Nothing is imported until you confirm.</p>
        {parsed.invalid.length > 0 && <div className="mt-2 max-h-64 overflow-auto rounded border border-red-500/30"><table className="w-full text-left text-xs"><thead className="text-slate-400"><tr><th className="p-2">Line</th><th>Roll</th><th>Name</th><th>Problem</th></tr></thead>
          <tbody>{parsed.invalid.slice(0, 200).map(r => <tr key={r.line} className="border-t border-white/5 align-top"><td className="p-2">{r.line}</td><td>{r.raw.roll_number}</td><td>{r.raw.full_name}</td><td className="text-red-300">{r.errors.join(' ')}</td></tr>)}</tbody></table></div>}
        {parsed.invalid.length > 200 && <p className="text-xs text-slate-400">Showing the first 200 problems; download the full report.</p>}
        {parsed.valid.length > 0 && <div className="mt-2 max-h-40 overflow-auto rounded border border-white/10"><table className="w-full text-left text-xs"><tbody>{parsed.valid.slice(0, 20).map(v => <tr key={v.roll_number} className="border-t border-white/5"><td className="p-2 font-mono">{v.roll_number}</td><td>{v.full_name}</td><td className="text-slate-400">{v.email}</td></tr>)}</tbody></table></div>}
        <div className="mt-3 flex flex-wrap gap-2">{parsed.valid.length > 0 && <button className="btn-primary" disabled={!!busy} onClick={run}>Import {parsed.valid.length} valid row{parsed.valid.length === 1 ? '' : 's'}{parsed.invalid.length ? ' (skip the invalid ones)' : ''}</button>}
          {parsed.invalid.length > 0 && <button className="btn-ghost" onClick={errorReport}>Download error report</button>}<button className="btn-ghost" onClick={() => setParsed(null)}>Cancel</button></div></>}</div>}</div>
}
