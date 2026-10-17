import { DT } from './constants'
import { crystalStep } from './crystals'
import { envOf } from './environments'
import { computeVeilMask, stepField } from './field'
import { organismStep } from './organisms'
import {
  assignVeils,
  environmentDrivers,
  fire,
  forceStep,
  fractureStrand,
  integrate,
  makeScratch,
  nodeIntrinsics,
  phaseStep,
  spontaneousStrands,
  strandStep,
  transformations
} from './physics'
import { structureStep } from './structures'
import { discoveryStep } from './discovery'
import type { WorldState } from './types'
import { emit, removeStrand } from './world'

/**
 * Advances the universe by one fixed tick. The order is fixed so the same state and the same
 * actions always produce the same result.
 */
export function step(w: WorldState): void {
  const env = envOf(w.env)
  const dt = DT
  w.events = []
  w.tick++
  const sc = makeScratch(w)
  assignVeils(w, sc)

  environmentDrivers(w, env, dt)
  nodeIntrinsics(w, env, dt, sc)
  const { fractures, births, faded } = strandStep(w, env, dt, sc)
  const fired = phaseStep(w, env, dt, sc)
  for (const g of fired) fire(w, g, sc)
  forceStep(w, env, dt, sc)
  integrate(w, env, dt, sc)
  for (const s of fractures) if (w.strands.includes(s)) fractureStrand(w, s, sc)
  for (const s of faded) {
    if (!w.strands.includes(s)) continue
    removeStrand(w, s.id)
    emit(w, 'strandFaded', null, { a: s.a, b: s.b })
  }
  transformations(w, env, sc, births)
  spontaneousStrands(w, env, makeScratchIfChanged(w, sc))

  stepField(w, env, dt, computeVeilMask(w))

  const byId = new Map(w.nodes.map((n) => [n.id, n]))
  crystalStep(w, env, dt, byId)
  sc.hash.build(w.nodes)
  organismStep(w, env, dt, byId, sc.hash)
  structureStep(w, env, byId)
  discoveryStep(w)

  for (const v of w.veils) v.ticks--
  w.veils = w.veils.filter((v) => v.ticks > 0)
  for (const p of w.pulls) p.ticks--
  w.pulls = w.pulls.filter((p) => p.ticks > 0)
}

function makeScratchIfChanged(w: WorldState, sc: ReturnType<typeof makeScratch>) {
  if (sc.byId.size !== w.nodes.length || w.nodes.some((n) => !sc.byId.has(n.id))) {
    const fresh = makeScratch(w)
    fresh.hash.build(w.nodes)
    return fresh
  }
  sc.hash.build(w.nodes)
  return sc
}

/** Runs n ticks. */
export function run(w: WorldState, n: number): void {
  for (let i = 0; i < n; i++) step(w)
}
