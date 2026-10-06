import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'

export type Role = 'student' | 'admin'
export interface Profile { id: string; full_name: string | null; role: Role; is_active: boolean }
interface AuthState {
  session: Session | null; profile: Profile | null; loading: boolean
  signIn: (identifier: string, password: string, expected: Role) => Promise<string | null>
  signOut: () => Promise<void>
}
const Ctx = createContext<AuthState>(null!)
export const useAuth = () => useContext(Ctx)

// Students sign in with a roll number; Supabase Auth needs an email, so we map it to a synthetic one.
// Create students with the same mapping when importing participants (Phase 2 admin tool).
export const STUDENT_EMAIL_DOMAIN = 'students.acm-event.local'
const toEmail = (id: string, role: Role) =>
  role === 'student' && !id.includes('@') ? `${id.trim().toLowerCase()}@${STUDENT_EMAIL_DOMAIN}` : id.trim()

async function loadProfile(uid: string): Promise<Profile | null> {
  // select('*') + default keeps login working even before migration 0005 adds profiles.is_active
  const { data } = await supabase.from('profiles').select('*').eq('id', uid).single()
  return data ? ({ id: data.id, full_name: data.full_name, role: data.role, is_active: data.is_active !== false } as Profile) : null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session)
      setProfile(data.session ? await loadProfile(data.session.user.id) : null)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      if (!s) setProfile(null)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const signIn: AuthState['signIn'] = async (identifier, password, expected) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email: toEmail(identifier, expected), password })
    if (error || !data.user) return 'Invalid credentials.'
    const p = await loadProfile(data.user.id)
    // UX gate only. Real enforcement is RLS + server-side role checks in the database.
    if (!p || p.role !== expected) {
      await supabase.auth.signOut()
      return expected === 'admin' ? 'This account is not an administrator.' : 'Please use the student login.'
    }
    if (p.role === 'student' && !p.is_active) { await supabase.auth.signOut(); return 'Your account is disabled. Please contact the organizers.' }
    setProfile(p)
    return null
  }
  const signOut = async () => { await supabase.auth.signOut(); setProfile(null) }

  return <Ctx.Provider value={{ session, profile, loading, signIn, signOut }}>{children}</Ctx.Provider>
}
