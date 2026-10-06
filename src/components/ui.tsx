import type { ReactNode } from 'react'

export const Loading = ({ what = 'Loading…' }: { what?: string }) => <p className="text-slate-400" role="status">{what}</p>
export const ErrorNote = ({ msg }: { msg: string }) => <p role="alert" className="rounded bg-red-500/10 p-3 text-sm text-red-300">{msg}</p>
export const InfoNote = ({ children }: { children: ReactNode }) => <p className="rounded bg-amber-500/10 p-3 text-sm text-amber-300">{children}</p>
export const Empty = ({ children }: { children: ReactNode }) => <p className="card text-sm text-slate-400">{children}</p>
export const Stat = ({ label, value, sub }: { label: string; value: ReactNode; sub?: string }) =>
  <div className="card"><div className="text-xs uppercase tracking-wide text-slate-400">{label}</div><div className="font-display text-2xl font-bold">{value}</div>{sub && <div className="text-xs text-slate-500">{sub}</div>}</div>

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return <div className="mt-3 flex items-center justify-between text-sm text-slate-400">
    <span>{total === 0 ? 'No results' : `${page * pageSize + 1}-${Math.min(total, (page + 1) * pageSize)} of ${total}`}</span>
    <span className="flex gap-2"><button className="btn-ghost" disabled={page <= 0} onClick={() => onPage(page - 1)}>Previous</button>
      <span className="self-center">Page {page + 1} / {pages}</span>
      <button className="btn-ghost" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>Next</button></span></div>
}

export const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : '—')
const p2 = (n: number) => String(n).padStart(2, '0')
/** ISO timestamp -> value for <input type="datetime-local"> in the viewer's time zone. */
export const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`
}
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null)

const STATE_STYLE: Record<string, string> = { open: 'text-lime-300', upcoming: 'text-cyan-300', closed: 'text-slate-400', locked: 'text-slate-400' }
const STATE_LABEL: Record<string, string> = { open: '● Open', upcoming: '◷ Upcoming', closed: '■ Closed', locked: '🔒 Locked' }
export const StateBadge = ({ state }: { state: string }) => <span className={`text-xs font-semibold ${STATE_STYLE[state]}`}>{STATE_LABEL[state]}</span>
