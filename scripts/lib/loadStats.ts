// Pure helpers for scripts/load-test.ts (unit-tested).
export function percentile(sortedAsc: number[], p: number): number {
  if (!sortedAsc.length) return 0
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1))
  return sortedAsc[idx]
}
export interface Sample { ms: number; outcome: string }   // outcome: a verdict ("accepted"), a server code ("cooldown") or a transport failure ("network")
export function summarize(samples: Sample[], wallMs: number) {
  const lat = samples.map(s => s.ms).sort((a, b) => a - b)
  const outcomes: Record<string, number> = {}
  for (const s of samples) outcomes[s.outcome] = (outcomes[s.outcome] ?? 0) + 1
  return { requests: samples.length, outcomes, p50: percentile(lat, 50), p90: percentile(lat, 90), p95: percentile(lat, 95), p99: percentile(lat, 99), max: lat.at(-1) ?? 0,
    throughputPerSec: wallMs > 0 ? +(samples.length / (wallMs / 1000)).toFixed(2) : 0 }
}
export function parseAccounts(csv: string): { roll: string; password: string }[] {
  return csv.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#') && !/^roll/i.test(l)).map(l => { const i = l.indexOf(','); return { roll: l.slice(0, i).trim(), password: l.slice(i + 1).trim() } }).filter(a => a.roll && a.password)
}
