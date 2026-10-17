// Simulation timing on this computer. Bundled and run by scripts/perf.mjs (npm run perf).
// The game advances 30 simulation ticks for every second of play at normal speed, so a tick
// that takes under 33 ms keeps up; the margin is how many times faster than that it runs.
import { LIMITS } from '@core/sim/constants'
import { applyCommand } from '@core/sim/commands'
import { ARCHETYPES, spawnOrganism } from '@core/sim/organisms'
import { applyPreset } from '@core/sim/presets'
import { buildSnapshot } from '@core/sim/snapshot'
import { run, step } from '@core/sim/step'
import type { WorldState } from '@core/sim/types'
import { addNode, addStrand, createWorld } from '@core/sim/world'

interface Row {
  scene: string
  nodes: number
  strands: number
  organisms: number
  crystalSegments: number
  msPerTick: number
  p95: number
  snapshotMs: number
  realtimeMargin: number
}

function measure(scene: string, w: WorldState, ticks = 900): Row {
  run(w, 120) // settle first
  const times: number[] = []
  for (let i = 0; i < ticks; i++) {
    const t0 = performance.now()
    step(w)
    times.push(performance.now() - t0)
  }
  const s0 = performance.now()
  for (let i = 0; i < 30; i++) buildSnapshot(w, { fields: i % 3 === 0 })
  const snapshotMs = (performance.now() - s0) / 30
  times.sort((a, b) => a - b)
  const mean = times.reduce((a, b) => a + b, 0) / times.length
  return {
    scene,
    nodes: w.nodes.length,
    strands: w.strands.length,
    organisms: w.organisms.length,
    crystalSegments: w.crystals.reduce((s, c) => s + c.segs.length, 0),
    msPerTick: +mean.toFixed(3),
    p95: +times[Math.floor(times.length * 0.95)].toFixed(3),
    snapshotMs: +snapshotMs.toFixed(3),
    realtimeMargin: +(1000 / 30 / (mean + snapshotMs / 2)).toFixed(1)
  }
}

function stress(): WorldState {
  const w = createWorld({ seed: 'stress', env: 'cradle' })
  const ids: number[] = []
  const kinds = ['white', 'black', 'grey'] as const
  for (let i = 0; i < LIMITS.nodes; i++) {
    const a = i * 2.399963
    const r = 6 + (i % 40) * 1.1
    const n = addNode(w, kinds[i % 3], { x: Math.cos(a) * r, y: ((i * 37) % 23) - 11, z: Math.sin(a) * r }, { freq: 0.3 + (i % 7) * 0.05 })
    if (n) ids.push(n.id)
  }
  for (let i = 0; i < ids.length && w.strands.length < LIMITS.strands - 10; i++) {
    for (const j of [1, 2, 5]) if (i + j < ids.length) addStrand(w, ids[i], ids[i + j], { coupling: 0.4 })
  }
  const genes = Object.values(ARCHETYPES)
  for (let i = 0; i < LIMITS.organisms; i++) spawnOrganism(w, { x: Math.cos(i) * 20, y: Math.sin(i * 1.7) * 6, z: Math.sin(i) * 20 }, genes[i % genes.length], null, 20)
  for (let i = 0; i < 12; i++) applyCommand(w, { type: 'seedCrystal', p: { x: Math.cos(i) * 15, y: 0, z: Math.sin(i) * 15 } })
  return w
}

const rows: Row[] = []
for (const [env, preset] of [['cradle', 'twin'], ['cradle', 'scatter'], ['cathedral', 'choir'], ['cradle', 'shoal'], ['garden', 'orchard']] as const) {
  const w = createWorld({ seed: `perf-${preset}`, env })
  applyPreset(w, preset)
  rows.push(measure(`${preset} (${env})`, w))
}
rows.push(measure('stress: every limit at once', stress(), 300))
console.log(JSON.stringify(rows))
