// npm run perf: bundles the simulation timing script with esbuild and runs it in Node.
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const out = join(mkdtempSync(join(tmpdir(), 'polaritium-perf-')), 'perf.mjs')
await build({ entryPoints: [join(root, 'scripts/perf-sim.ts')], bundle: true, platform: 'node', format: 'esm', outfile: out, alias: { '@core': join(root, 'src/core') }, logLevel: 'error' })
const rows = JSON.parse(execFileSync(process.execPath, [out], { encoding: 'utf8', maxBuffer: 1 << 24 }))
console.table(rows)
if (process.argv.includes('--json')) writeFileSync(join(root, 'test-results', 'perf-sim.json'), JSON.stringify({ when: new Date().toISOString(), node: process.version, rows }, null, 2))
