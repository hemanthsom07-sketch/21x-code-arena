// Client-side validation mirroring the database constraints (0005_competition.sql). The database stays the final authority.
export interface QuestionInput { title: string; statement: string; points: number; time_limit_ms: number; memory_limit_kb: number; languages: string[]; difficulty: string }
export function validateQuestion(q: QuestionInput): string[] {
  const e: string[] = []
  if (q.title.trim().length < 3 || q.title.length > 120) e.push('Title must be 3-120 characters.')
  if (!q.statement.trim()) e.push('Problem statement is required.')
  if (q.statement.length > 20000) e.push('Problem statement is too long (20,000 characters max).')
  if (!['easy', 'medium', 'hard'].includes(q.difficulty)) e.push('Choose a difficulty.')
  if (!Number.isInteger(q.points) || q.points < 1 || q.points > 10000) e.push('Points must be a whole number from 1 to 10,000.')
  if (!Number.isInteger(q.time_limit_ms) || q.time_limit_ms < 100 || q.time_limit_ms > 10000) e.push('Time limit must be 100-10,000 ms (the judge allows at most 10 s).')
  if (!Number.isInteger(q.memory_limit_kb) || q.memory_limit_kb < 16000 || q.memory_limit_kb > 512000) e.push('Memory limit must be 16,000-512,000 KB.')
  if (!q.languages.length || q.languages.some(l => l !== 'c' && l !== 'python')) e.push('Select at least one language (C and/or Python).')
  return e
}
export function validateTestCase(input: string, expected: string): string[] {
  const e: string[] = []
  const size = (s: string) => new TextEncoder().encode(s).length
  if (!expected.trim()) e.push('Expected output cannot be empty or only whitespace.')
  if (size(input) > 65536) e.push('Input is too large (64 KB max).')
  if (size(expected) > 65536) e.push('Expected output is too large (64 KB max).')
  return e
}
export function validateChallenge(c: { day_number: number; title: string; unlock_at: string | null; closes_at: string | null }): string[] {
  const e: string[] = []
  if (!Number.isInteger(c.day_number) || c.day_number < 1 || c.day_number > 21) e.push('Day must be a whole number from 1 to 21.')
  if (c.title.trim().length < 3 || c.title.length > 120) e.push('Title must be 3-120 characters.')
  if (c.unlock_at && Number.isNaN(Date.parse(c.unlock_at))) e.push('Release time is not a valid date.')
  if (c.closes_at && Number.isNaN(Date.parse(c.closes_at))) e.push('Closing time is not a valid date.')
  if (c.unlock_at && c.closes_at && Date.parse(c.closes_at) <= Date.parse(c.unlock_at)) e.push('Closing time must be after the release time.')
  return e
}
export function validateEvent(c: { name: string; starts_at: string | null; ends_at: string | null; wrong_penalty_minutes: number; rules: string }): string[] {
  const e: string[] = []
  if (!c.name.trim() || c.name.length > 120) e.push('Event name is required (120 characters max).')
  if (c.starts_at && c.ends_at && Date.parse(c.ends_at) <= Date.parse(c.starts_at)) e.push('The event must end after it starts.')
  if (!Number.isInteger(c.wrong_penalty_minutes) || c.wrong_penalty_minutes < 0 || c.wrong_penalty_minutes > 600) e.push('Wrong-attempt penalty must be 0-600 minutes.')
  if (c.rules.length > 4000) e.push('Rules text is too long (4,000 characters max).')
  return e
}
export function validateAnnouncement(a: { title: string; body: string }): string[] {
  const e: string[] = []
  if (!a.title.trim() || a.title.length > 120) e.push('Title is required (120 characters max).')
  if (a.body.length > 2000) e.push('Message is too long (2,000 characters max).')
  return e
}
