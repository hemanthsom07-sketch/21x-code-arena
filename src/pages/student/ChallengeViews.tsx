import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import CodeWorkspace from './CodeWorkspace'
import { challengeState } from '../../lib/challengeState'
import { fmt } from '../../components/ui'

// Access control is enforced by RLS: locked challenges simply return zero question rows.
const diffColor: Record<string, string> = { easy: 'text-lime-300', medium: 'text-amber-300', hard: 'text-red-400' }

export function ChallengePage() {
  const { id } = useParams()
  const [ch, setCh] = useState<{ title: string; day_number: number; is_unlocked: boolean; unlock_at: string | null; closes_at: string | null } | null>(null)
  const [qs, setQs] = useState<{ id: string; title: string; difficulty: string; points: number }[] | null>(null)
  const [solved, setSolved] = useState<Set<string>>(new Set())
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { (async () => {
    supabase.from('question_results').select('question_id, first_accepted_at').not('first_accepted_at', 'is', null).then(({ data }) => setSolved(new Set((data ?? []).map(r => r.question_id))))
    const [c, q] = await Promise.all([
      supabase.from('challenges').select('title, day_number, is_unlocked, unlock_at, closes_at').eq('id', id!).single(),
      supabase.from('questions').select('id, title, difficulty, points').eq('challenge_id', id!).order('created_at')])
    if (c.error || q.error) setErr('Could not load this challenge.'); else { setCh(c.data); setQs(q.data) }
  })() }, [id])
  if (err) return <p className="text-red-400">{err}</p>
  if (!ch || !qs) return <p className="text-slate-400">Loading…</p>
  const st = challengeState(ch); const open = st === 'open' || st === 'closed'
  return <>
    <Link to="/" className="text-sm text-cyan-300">← Challenges</Link>
    <div className="mt-1 text-xs font-semibold text-violet-300">DAY {ch.day_number}</div>
    <h1 className="font-display text-2xl font-bold">{ch.title}</h1>
    {st === 'closed' && <p className="mt-2 rounded bg-amber-500/10 p-3 text-sm text-amber-300">This challenge closed on {fmt(ch.closes_at)}. You can still read the problems, but submissions are no longer accepted.</p>}
    {st === 'open' && ch.closes_at && <p className="mt-1 text-xs text-slate-400">Closes {fmt(ch.closes_at)}</p>}
    {!open ? <p className="card mt-4">🔒 This challenge is locked. It will appear here when the organizers release it.</p>
      : qs.length === 0 ? <p className="card mt-4 text-slate-400">No questions have been added yet.</p>
      : <ul className="mt-4 space-y-3">{qs.map(q => <li key={q.id}>
          <Link to={`/questions/${q.id}`} className="card flex items-center justify-between hover:border-cyan-400/40">
            <span className="font-display font-bold">{solved.has(q.id) && <span className="mr-1 text-lime-300" title="Solved">✓</span>}{q.title}</span>
            <span className="text-xs"><span className={diffColor[q.difficulty]}>{q.difficulty}</span> · {q.points} pts</span></Link></li>)}</ul>}
  </>
}

export function QuestionPage() {
  const { id } = useParams()
  const [q, setQ] = useState<any | null | undefined>(undefined)
  useEffect(() => { supabase.from('questions').select('*').eq('id', id!).maybeSingle().then(({ data, error }) => setQ(error ? null : data)) }, [id])
  if (q === undefined) return <p className="text-slate-400">Loading…</p>
  if (q === null) return <p className="card">This question isn't available. It may be locked or may not exist.</p>
  // Statement is rendered as plain text (never as HTML) to avoid script injection.
  const Block = ({ label, text }: { label: string; text: string | null }) => text ? <div className="mt-4">
    <div className="text-xs font-semibold uppercase text-slate-400">{label}</div>
    <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-black/30 p-3 font-mono text-sm">{text}</pre></div> : null
  return <>
    <Link to={`/challenges/${q.challenge_id}`} className="text-sm text-cyan-300">← Back to challenge</Link>
    <div className="mt-2 grid gap-6 lg:grid-cols-2">
      <section>
        <h1 className="font-display text-2xl font-bold">{q.title}</h1>
        <p className="text-xs text-slate-400"><span className={diffColor[q.difficulty]}>{q.difficulty}</span> · {q.points} pts · {q.languages.join(', ')} · {q.time_limit_ms} ms limit</p>
        <p className="mt-4 whitespace-pre-wrap">{q.statement}</p>
        <Block label="Constraints" text={q.constraints_text} />
        <div className="grid gap-4 sm:grid-cols-2"><Block label="Sample input" text={q.sample_input} /><Block label="Sample output" text={q.sample_output} /></div>
      </section>
      <section><CodeWorkspace key={q.id} questionId={q.id} languages={q.languages} /></section>
    </div>
  </>
}
