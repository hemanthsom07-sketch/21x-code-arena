import { supabase } from './supabase'
import { describeInvokeFailure, type ExecFail, type RunOk, type SubmitOk } from './verdicts'

async function call<T>(fn: 'run' | 'submit', body: object): Promise<T | ExecFail> {
  const { data, error } = await supabase.functions.invoke(fn, { body })
  if (error) return describeInvokeFailure((error as { context?: Response }).context?.status)
  return data as T | ExecFail
}
export const runCode = (question_id: string, language: string, source: string, stdin: string) =>
  call<RunOk>('run', { question_id, language, source, stdin })
export const submitCode = (question_id: string, language: string, source: string) =>
  call<SubmitOk>('submit', { question_id, language, source })
