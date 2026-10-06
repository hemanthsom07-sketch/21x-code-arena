import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../lib/auth'
import { fetchLeaderboard, type LbRow } from '../../lib/competitionApi'
import { challengeState, submissionBlock } from '../../lib/challengeState'
import { Empty, ErrorNote, InfoNote, Loading, StateBadge, Stat, fmt } from '../../components/ui'

interface Ch { id: string; day_number: number; title: string; is_unlocked: boolean; unlock_at: string | null; closes_at: string | null }
interface Cfg { name: string; starts_at: string | null; ends_at: string | null; submissions_open: boolean; rules: string; wrong_penalty_minutes: number }
interface Ann { id: string; title: string; body: string; pinned: boolean; created_at: string }
interface Data { cfg: Cfg; ann: Ann[]; chs: Ch[]; qs: { id: string; challenge_id: string; points: number }[]; res: { question_id: string; points_awarded: number; first_accepted_at: string | null }[] }

export default function StudentHome() {
  const { profile } = useAuth()
  const [d, setD] = useState<Data | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [me, setMe] = useState<LbRow | null | undefined>(undefined)
  const [lbNote, setLbNote] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [cfg, ann, chs, qs, res] = await Promise.all([
        supabase.from('event_config').select('name, starts_at, ends_at, submissions_open, rules, wrong_penalty_minutes').eq('id', 1).single(),
        supabase.from('announcements').select('id, title, body, pinned, created_at').order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(5),
        supabase.from('challenges').select('id, day_number, title, is_unlocked, unlock_at, closes_at').order('day_number').range(0, 99),
        supabase.from('questions').select('id, challenge_id, points'),   // row-level security returns only released challenges
        supabase.from('question_results').select('question_id, points_awarded, first_accepted_at')])
      if (!alive) return
      const bad = [cfg, ann, chs, qs, res].find(r => r.error)
      if (bad) { setErr('Could not load your dashboard. Check your connection and refresh.'); return }
      setD({ cfg: cfg.data as Cfg, ann: (ann.data ?? []) as Ann[], chs: (chs.data ?? []) as Ch[], qs: (qs.data ?? []) as Data['qs'], res: (res.data ?? []) as Data['res'] })
      const lb = await fetchLeaderboard({ limit: 1 })
      if (!alive) return
      if (lb.ok) setMe(lb.me); else { setMe(null); if (lb.code === 'hidden') setLbNote('The leaderboard is hidden by the organizers right now.') }
    })()
    return () => { alive = false }
  }, [])

  if (err) return <ErrorNote msg={err} />
  if (!d) return <Loading />
  const solvedIds = new Set(d.res.filter(r => r.first_accepted_at).map(r => r.question_id))
  const score = d.res.reduce((a, r) => a + (r.first_accepted_at ? r.points_awarded : 0), 0)
  const evBlock = d.cfg.starts_at && Date.parse(d.cfg.starts_at) > Date.now() ? 'The event has not started yet.'
    : d.cfg.ends_at && Date.parse(d.cfg.ends_at) <= Date.now() ? 'The event has ended.' : !d.cfg.submissions_open ? 'Submissions are paused by the organizers right now.' : null

  return <>
    <h1 className="font-display text-2xl font-bold">Welcome, {profile?.full_name ?? 'competitor'}</h1>
    <p className="text-sm text-slate-400">{d.cfg.name}{d.cfg.starts_at && ` · ${fmt(d.cfg.starts_at)}`}{d.cfg.ends_at && ` → ${fmt(d.cfg.ends_at)}`}</p>
    {evBlock && <div className="mt-3"><InfoNote>{evBlock}</InfoNote></div>}

    <div className="mt-4 grid gap-3 sm:grid-cols-3">
      <Stat label="Your score" value={score} sub={`${solvedIds.size} question${solvedIds.size === 1 ? '' : 's'} solved`} />
      <Stat label="Your rank" value={me === undefined ? '…' : me ? `#${me.rank}` : '—'} sub={me ? `${me.penalty_minutes} min penalty` : lbNote ?? 'Solve a question to get ranked'} />
      <Link to="/leaderboard" className="card hover:border-cyan-400/40"><div className="text-xs uppercase tracking-wide text-slate-400">Leaderboard</div><div className="font-display text-2xl font-bold">View →</div></Link>
    </div>

    <h2 className="mt-6 font-display text-lg font-bold">Announcements</h2>
    {d.ann.length === 0 ? <Empty>No announcements yet.</Empty> : <ul className="mt-2 space-y-2">{d.ann.map(a =>
      <li key={a.id} className="card"><div className="flex justify-between gap-2"><span className="font-semibold">{a.pinned && '📌 '}{a.title}</span><span className="text-xs text-slate-500">{fmt(a.created_at)}</span></div>
        {a.body && <p className="mt-1 whitespace-pre-wrap text-sm text-slate-300">{a.body}</p>}</li>)}</ul>}

    <h2 className="mt-6 font-display text-lg font-bold">Challenges &amp; schedule</h2>
    {d.chs.length === 0 ? <Empty>No challenges have been announced yet.</Empty> :
      <ul className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{d.chs.map(c => {
        const st = challengeState(c); const open = st === 'open' || st === 'closed'
        const mine = d.qs.filter(q => q.challenge_id === c.id); const solved = mine.filter(q => solvedIds.has(q.id)).length
        const block = submissionBlock(c, d.cfg)
        return <li key={c.id} className={`card ${st === 'open' ? 'border-cyan-400/40' : open ? '' : 'opacity-70'}`}>
          <div className="flex items-center justify-between"><span className="text-xs font-semibold text-violet-300">DAY {c.day_number}</span><StateBadge state={st} /></div>
          <div className="font-display text-lg font-bold">{open ? <Link to={`/challenges/${c.id}`} className="hover:text-cyan-300">{c.title}</Link> : c.title}</div>
          <div className="mt-2 space-y-0.5 text-xs text-slate-400">
            {c.unlock_at && <div>Opens: {fmt(c.unlock_at)}</div>}{c.closes_at && <div>Closes: {fmt(c.closes_at)}</div>}
            {open && <div className={solved === mine.length && mine.length > 0 ? 'text-lime-300' : ''}>{mine.length === 0 ? 'No questions yet' : `${solved}/${mine.length} solved`}</div>}
            {st === 'open' && block && <div className="text-amber-300">{block}</div>}</div></li>})}</ul>}

    {d.cfg.rules && <details className="card mt-6"><summary className="cursor-pointer font-semibold">Competition rules</summary>
      <p className="mt-2 whitespace-pre-wrap text-sm text-slate-300">{d.cfg.rules}</p>
      <p className="mt-2 text-xs text-slate-500">Ranking: most points, then least penalty time (each wrong attempt adds {d.cfg.wrong_penalty_minutes} min), then earliest last solve.</p></details>}
  </>
}
