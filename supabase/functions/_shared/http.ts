// Pure request helpers (unit-tested). Used by serve.ts.
export function bearerToken(h: { get(name: string): string | null }): string | null {
  const m = /^Bearer\s+(\S{1,4096})$/i.exec((h.get('Authorization') ?? '').trim())
  return m ? m[1] : null
}

/** ALLOWED_ORIGINS unset or "*" => any origin (development). Otherwise only listed origins are echoed back. */
export function corsHeaders(origin: string | null, allowed: string | undefined): Record<string, string> {
  const base = { 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
  const list = (allowed ?? '*').split(',').map(s => s.trim()).filter(Boolean)
  if (list.includes('*')) return { ...base, 'Access-Control-Allow-Origin': '*' }
  if (origin && list.includes(origin)) return { ...base, 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
  return { ...base, Vary: 'Origin' }   // no ACAO header => the browser blocks the call
}

export const MAX_BODY_BYTES = 262144  // 256 KB: source (64 KB) + stdin (16 KB) + JSON overhead fit comfortably

export async function readJsonLimited(req: Request, maxBytes = MAX_BODY_BYTES): Promise<{ ok: true; body: unknown } | { ok: false; reason: 'too_large' | 'invalid_json' }> {
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (declared > maxBytes) return { ok: false, reason: 'too_large' }
  const text = await req.text()
  if (new TextEncoder().encode(text).length > maxBytes) return { ok: false, reason: 'too_large' }
  try { return { ok: true, body: text ? JSON.parse(text) : null } } catch { return { ok: false, reason: 'invalid_json' } }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
