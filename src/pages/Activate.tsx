import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { activateAccount } from '../lib/competitionApi'
import { BrandHeader } from '../components/Brand'
import { branding } from '../lib/branding'

export default function Activate() {
  const nav = useNavigate()
  const [f, setF] = useState({ roll: '', code: '', pw: '', pw2: '' }); const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault(); setErr(null)
    if (f.pw !== f.pw2) return setErr('The two passwords do not match.')
    setBusy(true); const r = await activateAccount({ roll_number: f.roll, code: f.code, password: f.pw }); setBusy(false)
    if (r.ok) { setDone(true); setTimeout(() => nav('/login'), 2500) } else setErr(r.message)
  }
  return <div className="relative flex min-h-screen items-center justify-center bg-cover bg-center p-4" style={{ backgroundImage: `url(${branding.campus})` }}>
    <div className="absolute inset-0 bg-gradient-to-br from-[#0a0e1c]/90 via-[#0a0e1c]/75 to-violet-950/80" />
    <form onSubmit={submit} className="relative w-full max-w-sm space-y-4 rounded-2xl border border-white/15 bg-white/[0.07] p-7 shadow-2xl backdrop-blur-xl">
      <BrandHeader /><h1 className="font-display text-lg font-bold">Activate your account</h1>
      {done ? <p role="status" className="rounded bg-lime-500/10 p-3 text-sm text-lime-300">Account activated! Taking you to sign in…</p> : <>
        <p className="text-xs text-slate-300">Enter the roll number and one-time activation code from the organizers, then choose your own password.</p>
        <label className="block text-sm font-medium">Roll number<input className="input mt-1" value={f.roll} onChange={e => setF({ ...f, roll: e.target.value })} required autoComplete="username" /></label>
        <label className="block text-sm font-medium">Activation code<input className="input mt-1 font-mono uppercase" value={f.code} onChange={e => setF({ ...f, code: e.target.value })} required placeholder="XXXXX-XXXXX" autoComplete="off" /></label>
        <label className="block text-sm font-medium">New password<input className="input mt-1" type="password" value={f.pw} onChange={e => setF({ ...f, pw: e.target.value })} required minLength={8} maxLength={72} autoComplete="new-password" /></label>
        <label className="block text-sm font-medium">Confirm password<input className="input mt-1" type="password" value={f.pw2} onChange={e => setF({ ...f, pw2: e.target.value })} required autoComplete="new-password" /></label>
        <p className="text-xs text-slate-400">At least 8 characters, mixing letters with digits or symbols.</p>
        {err && <p role="alert" className="text-sm text-red-400">{err}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Activating…' : 'Activate account'}</button></>}
      <p className="text-center text-xs text-slate-400"><Link to="/login" className="underline">Back to sign in</Link></p></form></div>
}
