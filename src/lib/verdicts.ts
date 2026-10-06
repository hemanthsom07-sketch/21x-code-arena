// Pure helpers shared by the workspace UI (unit-tested without a browser).
export type Verdict = 'accepted' | 'wrong_answer' | 'time_limit_exceeded' | 'runtime_error' | 'compilation_error' | 'internal_error'
export const VERDICT_LABEL: Record<Verdict, string> = {
  accepted: 'Accepted', wrong_answer: 'Wrong Answer', time_limit_exceeded: 'Time Limit Exceeded',
  runtime_error: 'Runtime Error', compilation_error: 'Compilation Error', internal_error: 'Judge Error' }
export const verdictColor = (v: string | null) => v === 'accepted' ? 'text-lime-300' : v === 'internal_error' || !v ? 'text-slate-300' : 'text-red-400'
export const verdictLabel = (v: string | null) => (v && VERDICT_LABEL[v as Verdict]) || 'Pending'

export interface TestResult { index: number; hidden: boolean; verdict: Verdict; time_ms: number | null; input?: string; expected?: string; actual?: string; stderr?: string }
export interface SubmitOk { ok: true; submission_id: string; verdict: Verdict; passed: number; total: number; time_ms: number | null; memory_kb: number | null; message: string; results: TestResult[] }
export interface RunOk { ok: true; outcome: string; stdout: string; stderr: string; compile_output: string; time_ms: number | null; memory_kb: number | null }
export interface ExecFail { ok: false; code: string; message: string }

/** Maps a failed Edge Function call (HTTP status, if any) to a student-facing message. */
export function describeInvokeFailure(status?: number): ExecFail {
  if (status === 404) return { ok: false, code: 'not_deployed', message: 'Code execution is not set up yet. An organizer needs to deploy the judge functions.' }
  if (status === 401) return { ok: false, code: 'unauthorized', message: 'Your session expired. Please sign in again.' }
  if (status === undefined) return { ok: false, code: 'network', message: 'Could not reach the judge. Check your connection and try again.' }
  return { ok: false, code: 'internal', message: 'The judge had a server problem. Please try again shortly.' }
}
export const isSetupProblem = (code: string) => code === 'not_configured' || code === 'not_deployed'
