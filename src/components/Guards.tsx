import { Navigate, Outlet, Link } from 'react-router-dom'
import { useAuth, type Role } from '../lib/auth'
import { BrandHeader } from './Brand'

export function RequireRole({ role }: { role: Role }) {
  const { session, profile, loading } = useAuth()
  if (loading) return <p className="p-8 text-slate-500">Loading…</p>
  if (!session || !profile) return <Navigate to={role === 'admin' ? '/admin/login' : '/login'} replace />
  if (profile.role !== role) return <Navigate to={profile.role === 'admin' ? '/admin' : '/'} replace />
  if (role === 'student' && !profile.is_active) return <Disabled />
  return <Layout role={role}><Outlet /></Layout>
}

function Disabled() {
  const { signOut } = useAuth()
  return <div className="flex min-h-screen items-center justify-center p-4"><div className="card max-w-sm text-center"><h1 className="font-display text-lg font-bold">Account disabled</h1>
    <p className="mt-2 text-sm text-slate-400">Your access to the competition has been turned off. Please contact the organizers.</p><button className="btn-ghost mt-4" onClick={signOut}>Sign out</button></div></div>
}

function Layout({ role, children }: { role: Role; children: React.ReactNode }) {
  const { profile, signOut } = useAuth()
  const links = role === 'admin'
    ? [['/admin', 'Challenges'], ['/admin/event', 'Event'], ['/admin/participants', 'Participants'], ['/admin/monitor', 'Monitoring'], ['/admin/results', 'Results']]
    : [['/', 'Dashboard'], ['/leaderboard', 'Leaderboard'], ['/submissions', 'Submissions']]
  return (
    <div className="min-h-screen">
      <header className="border-b border-white/10 bg-black/30 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <BrandHeader compact />
          <nav className="flex items-center gap-4 text-sm">
            {links.map(([to, label]) => <Link key={to} to={to} className="font-medium hover:text-accent">{label}</Link>)}
            <span className="text-slate-400">{profile?.full_name ?? role}</span>
            <button className="btn-ghost" onClick={signOut}>Sign out</button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  )
}
