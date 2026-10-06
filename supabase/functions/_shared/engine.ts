import type { ExecutionAdapter } from './adapter.ts'
import { Judge0Adapter, judge0ConfigFromEnv } from './adapter.ts'
import { PistonAdapter, pistonConfigFromEnv } from './piston.ts'

/** JUDGE_ENGINE=piston|judge0 forces an engine; otherwise Piston if PISTON_URL is set, else Judge0 if JUDGE0_URL is set.
 *  Returns null when nothing is configured (the app then shows a setup message). Throws on malformed JSON settings. */
export function adapterFromEnv(get: (k: string) => string | undefined): ExecutionAdapter | null {
  const engine = (get('JUDGE_ENGINE') ?? '').trim().toLowerCase()
  const useJudge0 = engine === 'judge0' || (!engine && !get('PISTON_URL') && !!get('JUDGE0_URL'))
  if (useJudge0) { const c = judge0ConfigFromEnv(get); return c ? new Judge0Adapter(c) : null }
  const c = pistonConfigFromEnv(get); return c ? new PistonAdapter(c) : null
}
