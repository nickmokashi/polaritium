import { describe, expect, it } from 'vitest'
import { CHAMBERS, createChamberWorld } from '@core/sim/chambers'
import { applyCommand, type Command } from '@core/sim/commands'
import { step } from '@core/sim/step'
import type { WorldState } from '@core/sim/types'

// Every chamber must be solvable with the player's own tools, and must not solve itself.

const S = 30
const cmd = (w: WorldState, c: Command) => {
  const r = applyCommand(w, c)
  if (!r.ok) throw new Error(`${c.type}: ${r.error}`)
  return r
}
const strandBetween = (w: WorldState, a: number, b: number) => w.strands.find((s) => (s.a === a && s.b === b) || (s.a === b && s.b === a))
function runUntil(w: WorldState, maxTicks: number, each?: (t: number) => void): boolean {
  for (let t = 0; t < maxTicks; t++) {
    each?.(t)
    step(w)
    if (w.chamber!.done) return true
  }
  return w.chamber!.done
}

const solutions: Record<string, (w: WorldState) => boolean> = {
  'still-motion': (w) => {
    const s = w.strands[0]
    cmd(w, { type: 'setStrand', id: s.id, twist: Math.PI / 2 })
    return runUntil(w, 60 * S)
  },
  delicate: (w) => {
    const c = w.crystals[0]
    cmd(w, { type: 'tune', id: c.id, freq: 0.2 })
    return runUntil(w, 70 * S)
  },
  heartbeat: (w) => {
    const g = w.nodes.find((n) => n.kind === 'grey')!
    cmd(w, { type: 'tune', id: g.id, freq: 0.6 })
    for (const s of w.strands) cmd(w, { type: 'setStrand', id: s.id, coupling: 0.8 })
    return runUntil(w, 90 * S)
  },
  storm: (w) => {
    const src = w.nodes.find((n) => n.kind === 'white')!
    const dst = w.nodes.find((n) => n.kind === 'black')!
    const greys = w.nodes.filter((n) => n.kind === 'grey').sort((a, b) => a.p.x - b.p.x)
    const path = [src, ...greys, dst]
    for (let i = 0; i < path.length - 1; i++) cmd(w, { type: 'connect', a: path[i].id, b: path[i + 1].id, coupling: 0.3 })
    return runUntil(w, 120 * S)
  },
  'same-changed': (w) => {
    let done = false
    // wait for the ring to settle
    runUntil(w, 5 * S)
    const ring = w.rings.find((r) => r.confirmed)!
    const [m0, m1] = ring.members
    const free = w.nodes.filter((n) => n.kind === 'grey' && !ring.members.includes(n.id))
    const insert = (a: number, b: number, g: number) => {
      const s = strandBetween(w, a, b)!
      cmd(w, { type: 'cut', id: s.id })
      cmd(w, { type: 'connect', a, b: g, coupling: 0.7 })
      cmd(w, { type: 'connect', a: g, b, coupling: 0.7 })
      done = runUntil(w, 12 * S)
    }
    insert(m0, m1, free[0].id)
    if (!done) insert(free[0].id, m1, free[1].id)
    return done || runUntil(w, 20 * S)
  },
  'unlikely-bond': (w) => {
    const [a, b] = w.nodes.filter((n) => n.kind === 'white')
    const sink = w.nodes.find((n) => n.kind === 'black')!
    cmd(w, { type: 'connect', a: a.id, b: sink.id, coupling: 0.6 })
    cmd(w, { type: 'connect', a: b.id, b: sink.id, coupling: 0.6 })
    runUntil(w, 15 * S)
    cmd(w, { type: 'connect', a: a.id, b: b.id })
    return runUntil(w, 45 * S)
  },
  choir: (w) => {
    const greys = w.nodes.filter((n) => n.kind === 'grey')
    for (const g of greys) cmd(w, { type: 'tune', id: g.id, freq: 0.4 })
    for (let i = 0; i < greys.length; i++) cmd(w, { type: 'connect', a: greys[i].id, b: greys[(i + 1) % greys.length].id, coupling: 0.8 })
    return runUntil(w, 40 * S)
  },
  'dark-garden': (w) => {
    const B = w.nodes.find((n) => n.kind === 'black')!
    return runUntil(w, 100 * S, (t) => {
      if (t === 20) cmd(w, { type: 'destabilize', id: B.id, amount: 2 })
      if (t > 60 && t % (3 * S) === 0) cmd(w, { type: 'pulse', p: { x: 0, y: 4, z: 0 }, strength: 5, radius: 10 })
    })
  },
  breaking: (w) => {
    const B = w.nodes.find((n) => n.kind === 'black')!
    cmd(w, { type: 'destabilize', id: B.id, amount: 2 })
    step(w)
    const fresh = w.nodes.filter((n) => n.kind === 'grey')
    expect(fresh.length).toBeGreaterThanOrEqual(2)
    for (const g of fresh) cmd(w, { type: 'tune', id: g.id, freq: B.freq })
    cmd(w, { type: 'connect', a: fresh[0].id, b: fresh[1].id, coupling: 0.8 })
    for (const s of w.strands) cmd(w, { type: 'setStrand', id: s.id, coupling: 0.8 })
    return runUntil(w, 40 * S)
  },
  balance: (w) => {
    const B = w.nodes.find((n) => n.kind === 'black')!
    for (const s of w.nodes.filter((n) => n.kind === 'white')) cmd(w, { type: 'connect', a: s.id, b: B.id, coupling: 0.1, resistance: 3 })
    return runUntil(w, 60 * S)
  },
  'long-echo': (w) => {
    const sun = w.nodes.find((n) => n.kind === 'white')!
    for (const g of w.nodes.filter((n) => n.kind === 'grey')) cmd(w, { type: 'connect', a: sun.id, b: g.id, coupling: 0.6 })
    return runUntil(w, 80 * S)
  },
  crossing: (w) => {
    runUntil(w, 3 * S)
    const lead = w.nodes[0]
    cmd(w, { type: 'grab', id: lead.id })
    let x = lead.p.x
    for (let t = 0; t < 40 * S && x < 34; t++) {
      x += 0.12
      cmd(w, { type: 'drag', id: lead.id, p: { x, y: lead.p.y, z: lead.p.z } })
      step(w)
    }
    cmd(w, { type: 'release', id: lead.id })
    return runUntil(w, 30 * S)
  }
}

describe('Paradox Chambers', () => {
  it('there are at least twelve, each in a real environment with a goal and hints', () => {
    expect(CHAMBERS.length).toBeGreaterThanOrEqual(12)
    for (const c of CHAMBERS) {
      expect(c.goal.length).toBeGreaterThan(10)
      expect(c.hints.length).toBe(3)
      expect(solutions[c.id]).toBeTypeOf('function')
    }
  })

  for (const c of CHAMBERS) {
    it(`${c.num}. ${c.title}: solvable with the player's tools`, () => {
      const w = createChamberWorld(c.id)
      const ok = solutions[c.id](w)
      if (!ok) console.log(c.id, 'not solved', w.chamber)
      expect(w.chamber!.failed).toBeNull()
      expect(ok).toBe(true)
    })
    it(`${c.num}. ${c.title}: does not solve itself`, () => {
      const w = createChamberWorld(c.id)
      const ok = runUntil(w, 100 * S)
      expect(ok).toBe(false)
    })
  }
})
