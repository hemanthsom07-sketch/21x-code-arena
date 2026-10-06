import { useState, type FormEvent } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth, type Role } from '../lib/auth'
import { isConfigured } from '../lib/supabase'
import { BrandHeader } from '../components/Brand'
import { branding } from '../lib/branding'

export default function Login({ role }: { role: Role }) {
  const { signIn } = useAuth(); const nav = useNavigate()
  const [id, setId] = useState(''); const [pw, setPw] = useState('')
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false)
  const admin = role === 'admin'
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null)
    const msg = await signIn(id, pw, role); setBusy(false)
    if (msg) setErr(msg); else nav(admin ? '/admin' : '/')
  }
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-cover bg-center p-4" style={{ backgroundImage: `url(${branding.campus})` }}>
      <div className="absolute inset-0 bg-gradient-to-br from-[#0a0e1c]/90 via-[#0a0e1c]/75 to-violet-950/80" />
      <form onSubmit={submit} className="relative w-full max-w-sm space-y-4 rounded-2xl border border-white/15 bg-white/[0.07] p-7 shadow-2xl backdrop-blur-xl">
        <BrandHeader />
        <p className="text-xs text-cyan-300">{branding.tagline}</p>
        <h1 className="font-display text-lg font-bold">{admin ? 'Administrator sign in' : 'Student sign in'}</h1>
        {!isConfigured && <p className="rounded bg-amber-500/10 p-2 text-xs text-amber-300">Supabase isn't configured. Copy .env.example to .env.</p>}
        <label className="block text-sm font-medium">{admin ? 'Email' : 'Roll number'}
          <input className="input mt-1" value={id} onChange={e => setId(e.target.value)} required autoComplete="username" /></label>
        <label className="block text-sm font-medium">Password
          <input className="input mt-1" type="password" value={pw} onChange={e => setPw(e.target.value)} required autoComplete="current-password" /></label>
        {err && <p role="alert" className="text-sm text-red-400">{err}</p>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Signing in…' : 'Enter the Arena'}</button>
        <p className="text-center text-xs text-slate-400">
          {admin ? <Link to="/login" className="underline">Student login</Link> : <Link to="/admin/login" className="underline">Administrator login</Link>}</p>
        {!admin && <p className="text-center text-xs text-slate-300">First time here? <Link to="/activate" className="font-semibold text-cyan-300 underline">Activate your account</Link></p>}
      </form>
    </div>
  )
}
