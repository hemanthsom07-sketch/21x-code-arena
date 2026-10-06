// Installs the C (gcc) and Python runtimes into a running Piston and prints what the API now offers.
// Usage: node scripts/piston-setup.mjs [http://127.0.0.1:2000]
const base = (process.argv[2] || 'http://127.0.0.1:2000').replace(/\/+$/, '') + '/api/v2'
const get = async p => { const r = await fetch(base + p); if (!r.ok) throw new Error(`GET ${p} -> ${r.status}`); return r.json() }
const ver = v => String(v).split('.').map(Number)
const cmp = (a, b) => { const x = ver(a), y = ver(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0 }
try {
  const pkgs = await get('/packages')
  for (const want of ['gcc', 'python']) {
    const all = pkgs.filter(p => p.language === want).sort((a, b) => cmp(b.language_version, a.language_version))
    if (!all.length) { console.error(`! package "${want}" not found in the Piston repository index. Available: ${[...new Set(pkgs.map(p => p.language))].join(', ')}`); process.exitCode = 1; continue }
    const best = all[0]
    if (best.installed) { console.log(`= ${want} ${best.language_version} already installed`); continue }
    console.log(`+ installing ${want} ${best.language_version} (downloads from GitHub; can take a minute)...`)
    const r = await fetch(base + '/packages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ language: want, version: best.language_version }) })
    console.log(r.ok ? `  ok: ${JSON.stringify(await r.json())}` : `  FAILED ${r.status}: ${await r.text()}`); if (!r.ok) process.exitCode = 1
  }
  const rt = await get('/runtimes')
  const has = n => rt.some(r => r.language === n || (r.aliases || []).includes(n))
  console.log(`\nRuntimes available: ${rt.map(r => `${r.language}@${r.version}`).join(', ') || '(none)'}`)
  console.log(`C usable as "c": ${has('c')}   Python usable as "python": ${has('python')}`)
  if (!has('c') || !has('python')) { console.error('! Set PISTON_LANG_C / PISTON_LANG_PYTHON to the names shown above.'); process.exitCode = 1 }
} catch (e) { console.error('Setup failed:', e.message, '\nIs Piston running (docker compose up -d) and reachable at', base, '?'); process.exitCode = 1 }
