import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createWorld, totalEnergy, addNode, addStrand, capacity, nodeById, fill } from '@core/sim/world'
import { applyPreset, PRESETS } from '@core/sim/presets'
import { applyCommand } from '@core/sim/commands'
import { step, run } from '@core/sim/step'
import { serializeWorld, deserializeWorld, stateHash, SaveError, cloneWorld, hash53 } from '@core/sim/serialize'
import { buildSnapshot } from '@core/sim/snapshot'
import { ENVIRONMENTS, PLAYABLE_ENVS } from '@core/sim/environments'
import { DT, STRAND_DRIVE } from '@core/sim/constants'
import type { WorldState } from '@core/sim/types'
import { ARCHETYPES, spawnOrganism } from '@core/sim/organisms'

function expected(w: WorldState, E0: number, a0: WorldState['acct']): number {
  const a = w.acct
  return E0 + (a.generated - a0.generated) + (a.harvested - a0.harvested) + (a.external - a0.external) - (a.dissipated - a0.dissipated) - (a.converted - a0.converted)
}

function allFinite(w: WorldState): boolean {
  for (const n of w.nodes) for (const v of [n.p.x, n.p.y, n.p.z, n.v.x, n.v.y, n.v.z, n.energy, n.phase, n.mass, n.freq]) if (!Number.isFinite(v)) return false
  for (const s of w.strands) for (const v of [s.current, s.tension, s.stress, s.coupling, s.amp, s.mean]) if (!Number.isFinite(v)) return false
  for (const o of w.organisms) for (const v of [o.p.x, o.p.y, o.p.z, o.energy, ...o.genome]) if (!Number.isFinite(v)) return false
  for (const c of w.crystals) for (const s of c.segs) for (const v of [s.ax, s.bx, s.len, s.stress]) if (!Number.isFinite(v)) return false
  for (const a of [w.field.radiance, w.field.signal, w.field.signalVel]) for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return false
  return true
}

describe('stability', () => {
  for (const env of PLAYABLE_ENVS) {
    it(`stays bounded and finite in ${ENVIRONMENTS[env].name} with a rich random start`, () => {
      const w = createWorld({ seed: `stable-${env}`, env })
      applyPreset(w, 'scatter', 2)
      applyPreset(w, 'shoal')
      const E0 = totalEnergy(w)
      const a0 = { ...w.acct }
      for (let t = 0; t < 2400; t++) {
        step(w)
        if (t % 400 === 0) {
          // poke it hard now and then
          applyCommand(w, { type: 'pulse', p: { x: 0, y: 0, z: 0 }, strength: 12, radius: 10 })
        }
      }
      expect(allFinite(w)).toBe(true)
      for (const n of w.nodes) {
        expect(n.energy).toBeGreaterThanOrEqual(0)
        expect(n.energy).toBeLessThanOrEqual(capacity(n) + 1e-6)
        expect(Math.hypot(n.p.x, n.p.y, n.p.z)).toBeLessThanOrEqual(ENVIRONMENTS[env].radius * 1.03)
      }
      for (const s of w.strands) expect(Math.abs(s.current)).toBeLessThan(100)
      const e = totalEnergy(w)
      expect(Math.abs(e - expected(w, E0, a0)) / Math.max(1, e)).toBeLessThan(1e-6)
    })
  }
})

describe('energy accounting', () => {
  it('every unit of energy is accounted for: generated, harvested, added, lost or converted', () => {
    const w = createWorld({ seed: 'acct', env: 'cradle' })
    applyPreset(w, 'twin')
    applyCommand(w, { type: 'connect', a: w.nodes[0].id, b: w.nodes[1].id })
    const E0 = totalEnergy(w)
    const a0 = { ...w.acct }
    for (let t = 0; t < 3000; t++) {
      step(w)
      if (t === 900) applyCommand(w, { type: 'seed', kind: 'white', p: { x: 0, y: 10, z: 0 } })
      if (t === 1500) applyCommand(w, { type: 'fuse', a: w.nodes[0].id, b: w.nodes[w.nodes.length - 1].id })
    }
    const e = totalEnergy(w)
    expect(Math.abs(e - expected(w, E0, a0))).toBeLessThan(1e-6 * Math.max(1, e))
  })
})

describe('determinism', () => {
  const script = (w: WorldState, t: number) => {
    if (t === 10) applyCommand(w, { type: 'connect', a: w.nodes[0].id, b: w.nodes[1].id })
    if (t === 200) applyCommand(w, { type: 'pulse', p: { x: 3, y: 0, z: 0 }, strength: 4 })
    if (t === 400) applyCommand(w, { type: 'seed', kind: 'grey', p: { x: 0, y: 8, z: 2 } })
  }
  it('the same seed and the same actions give the same universe', () => {
    const a = createWorld({ seed: 'det', env: 'garden' })
    const b = createWorld({ seed: 'det', env: 'garden' })
    applyPreset(a, 'scatter')
    applyPreset(b, 'scatter')
    for (let t = 0; t < 900; t++) {
      script(a, t)
      script(b, t)
      step(a)
      step(b)
    }
    expect(stateHash(a)).toBe(stateHash(b))
  })

  it('a saved and reloaded universe continues exactly as the original', () => {
    const a = createWorld({ seed: 'det2', env: 'cathedral' })
    applyPreset(a, 'shoal')
    applyPreset(a, 'scatter')
    for (let t = 0; t < 450; t++) {
      script(a, t)
      step(a)
    }
    const b = deserializeWorld(serializeWorld(a))
    expect(stateHash(b)).toBe(stateHash(a))
    for (let t = 450; t < 900; t++) {
      script(a, t)
      script(b, t)
      step(a)
      step(b)
    }
    expect(stateHash(b)).toBe(stateHash(a))
  })

  it('different seeds give different universes', () => {
    const a = createWorld({ seed: 'one', env: 'cradle' })
    const b = createWorld({ seed: 'two', env: 'cradle' })
    applyPreset(a, 'scatter')
    applyPreset(b, 'scatter')
    expect(stateHash(a)).not.toBe(stateHash(b))
  })

  it('pausing stops evolution and looking does not change anything', () => {
    const w = createWorld({ seed: 'pause', env: 'cradle' })
    applyPreset(w, 'shoal')
    run(w, 120)
    const h = stateHash(w)
    buildSnapshot(w, { fields: true })
    buildSnapshot(w)
    expect(stateHash(w)).toBe(h)
  })

  it('the simulation core imports nothing from rendering, React, Electron or the network', () => {
    const dir = join(__dirname, '..', 'src', 'core', 'sim')
    for (const f of readdirSync(dir)) {
      const text = readFileSync(join(dir, f), 'utf8')
      expect(text).not.toMatch(/from ['"](three|react|electron|@react-three|zustand|@anthropic-ai)/)
      expect(text).not.toMatch(/Math\.random\(|Date\.now\(|performance\.now\(/)
    }
  })
})

describe('forces and strands', () => {
  it('a strand carries energy from light to dark', () => {
    const w = createWorld({ seed: 'flow', env: 'well' })
    const W = addNode(w, 'white', { x: -6, y: 0, z: 0 }, { energy: 18 })!
    const B = addNode(w, 'black', { x: 6, y: 0, z: 0 }, { energy: 0 })!
    addStrand(w, W.id, B.id)
    const before = B.energy
    run(w, 300)
    expect(B.energy).toBeGreaterThan(before + 5)
    expect(w.strands[0].mean).toBeGreaterThan(0)
  })

  it('resistance slows transfer, coupling speeds it', () => {
    const transfer = (coupling: number, resistance: number) => {
      const w = createWorld({ seed: 'res', env: 'well' })
      const W = addNode(w, 'white', { x: -6, y: 0, z: 0 }, { energy: 18 })!
      const B = addNode(w, 'black', { x: 6, y: 0, z: 0 }, { energy: 0 })!
      W.anchor = 1 | 4
      W.anchorEnergy = 18
      B.anchor = 1
      addStrand(w, W.id, B.id, { coupling, resistance })
      run(w, 60)
      return B.energy
    }
    expect(transfer(0.1, 4)).toBeLessThan(transfer(0.1, 1))
    expect(transfer(0.08, 3)).toBeLessThan(transfer(0.3, 3))
  })

  it('past a coupling threshold the flow rings: it oscillates instead of settling', () => {
    // Two greys (neutral potential), phase held still, so only the flow dynamics act.
    const ringAmp = (coupling: number, resistance: number) => {
      const w = createWorld({ seed: 'ring', env: 'well', laws: { phase: false, mediators: false } })
      const A = addNode(w, 'grey', { x: -5, y: 0, z: 0 }, { mass: 3, energy: 18 })!
      const B = addNode(w, 'grey', { x: 5, y: 0, z: 0 }, { mass: 3, energy: 12 })!
      A.anchor = 1
      B.anchor = 1
      addStrand(w, A.id, B.id, { coupling, resistance })
      let crossings = 0
      let last = 0
      for (let t = 0; t < 600; t++) {
        step(w)
        const s = w.strands[0]
        const sign = Math.sign(s.current)
        if (Math.abs(s.current) > 0.05 && sign !== 0 && last !== 0 && sign !== last) crossings++
        if (Math.abs(s.current) > 0.05 && sign !== 0) last = sign
      }
      return crossings
    }
    // Overdamped: the flow never reverses. Underdamped: it swings back and forth.
    expect(ringAmp(0.2, 3)).toBe(0)
    expect(ringAmp(1.2, 0.25)).toBeGreaterThanOrEqual(2)
    void STRAND_DRIVE
    void DT
  })

  it('strands lock into phase when coupling beats the frequency gap, and not when it does not', () => {
    const locks = (coupling: number) => {
      const w = createWorld({ seed: 'lock', env: 'well', laws: { mediators: false } })
      const A = addNode(w, 'white', { x: -6, y: 0, z: 0 }, { freq: 0.4 })!
      const B = addNode(w, 'black', { x: 6, y: 0, z: 0 }, { freq: 0.3 })!
      A.anchor = 1
      B.anchor = 1
      addStrand(w, A.id, B.id, { coupling })
      run(w, 600)
      return w.strands[0]?.lock ?? 0
    }
    expect(locks(0.05)).toBeLessThan(30)
    expect(locks(0.6)).toBeGreaterThan(300)
  })

  it('overstress fractures a strand and releases energy as radiance and a pulse', () => {
    const w = createWorld({ seed: 'frac', env: 'garden' })
    const A = addNode(w, 'white', { x: -4, y: 0, z: 0 })!
    const B = addNode(w, 'black', { x: 4, y: 0, z: 0 })!
    addStrand(w, A.id, B.id, { rest: 8 })
    applyCommand(w, { type: 'grab', id: A.id })
    let broke = false
    for (let t = 0; t < 300 && !broke; t++) {
      applyCommand(w, { type: 'drag', id: A.id, p: { x: -40, y: 0, z: 0 } })
      step(w)
      broke = w.events.some((e) => e.type === 'fracture')
    }
    expect(broke).toBe(true)
    expect(w.strands.length).toBe(0)
  })

  it('a saturated dark collapses into a well and scatters mediators', () => {
    const w = createWorld({ seed: 'col', env: 'cradle' })
    const B = addNode(w, 'black', { x: 0, y: 0, z: 0 }, { mass: 1.4 })!
    B.energy = capacity(B)
    B.anchor = 4
    B.anchorEnergy = capacity(B)
    let collapsed = false
    for (let t = 0; t < 400 && !collapsed; t++) {
      step(w)
      collapsed = w.events.some((e) => e.type === 'collapse')
    }
    expect(collapsed).toBe(true)
    expect(nodeById(w, B.id)!.well).toBe(true)
    expect(w.nodes.filter((n) => n.kind === 'grey').length).toBeGreaterThan(0)
  })

  it('resonance between light and dark gives birth to a mediator', () => {
    const w = createWorld({ seed: 'birth', env: 'well' })
    const W = addNode(w, 'white', { x: -7, y: 0, z: 0 }, { freq: 0.35 })!
    const B = addNode(w, 'black', { x: 7, y: 0, z: 0 }, { freq: 0.33, energy: 0 })!
    W.anchor = 1
    B.anchor = 1
    addStrand(w, W.id, B.id, { coupling: 0.7 })
    let born = false
    for (let t = 0; t < 1200 && !born; t++) {
      step(w)
      born = w.events.some((e) => e.type === 'birth')
    }
    expect(born).toBe(true)
    expect(w.nodes.some((n) => n.kind === 'grey')).toBe(true)
  })

  it('a twisted strand carrying flow turns its ends around each other', () => {
    const w = createWorld({ seed: 'twist', env: 'well', laws: { phase: false } })
    const W = addNode(w, 'white', { x: -6, y: 0, z: 0 }, { energy: 20 })!
    const B = addNode(w, 'black', { x: 6, y: 0, z: 0 }, { energy: 0 })!
    W.anchor = 4
    W.anchorEnergy = 20
    addStrand(w, W.id, B.id, { twist: Math.PI / 2, coupling: 0.6 })
    run(w, 300)
    const sideways = Math.hypot(W.p.y, W.p.z) + Math.hypot(B.p.y, B.p.z)
    expect(sideways).toBeGreaterThan(1)
  })

  it('a veil cuts flow across its edge', () => {
    const flowWith = (veil: boolean) => {
      const w = createWorld({ seed: 'veil', env: 'well' })
      const W = addNode(w, 'white', { x: -6, y: 0, z: 0 }, { energy: 20 })!
      const B = addNode(w, 'black', { x: 6, y: 0, z: 0 }, { energy: 0 })!
      W.anchor = 1
      B.anchor = 1
      addStrand(w, W.id, B.id)
      if (veil) applyCommand(w, { type: 'veil', p: { x: 6, y: 0, z: 0 }, r: 4, mask: 31 })
      run(w, 120)
      return B.energy
    }
    expect(flowWith(true)).toBeLessThan(flowWith(false) * 0.2)
  })
})

describe('commands handle bad targets safely', () => {
  it('every command with a missing or bad target fails with an explanation and changes nothing', () => {
    const w = createWorld({ seed: 'bad', env: 'cradle' })
    applyPreset(w, 'twin')
    const h = stateHash(w)
    const bad = [
      { type: 'connect', a: 9999, b: 9998 },
      { type: 'connect', a: w.nodes[0].id, b: w.nodes[0].id },
      { type: 'grab', id: 4242 },
      { type: 'drag', id: w.nodes[0].id, p: { x: 0, y: 0, z: 0 } },
      { type: 'setStrand', id: 777 },
      { type: 'tune', id: 777, freq: 1 },
      { type: 'tune', id: w.nodes[0].id, freq: Number.NaN },
      { type: 'cut', id: 777 },
      { type: 'destabilize', id: 777 },
      { type: 'fuse', a: 777, b: 778 },
      { type: 'unveil', id: 777 },
      { type: 'anchor', id: 777, flags: 1 },
      { type: 'rename', id: 777, name: 'x' },
      { type: 'seed', kind: 'white', p: { x: Number.NaN, y: 0, z: 0 } },
      { type: 'pulse', p: { x: Number.POSITIVE_INFINITY, y: 0, z: 0 }, strength: 3 }
    ] as const
    for (const c of bad) {
      const r = applyCommand(w, c as never)
      expect(r.ok).toBe(false)
      expect(typeof r.error).toBe('string')
    }
    expect(stateHash(w)).toBe(h.replace(/.*/, stateHash(w))) // lastAction may not change on failures
    const h2 = stateHash(w)
    expect(h2).toBe(h)
  })
})

describe('saves', () => {
  it('a damaged save is refused, not loaded as something else', () => {
    const w = createWorld({ seed: 'dmg', env: 'cradle' })
    applyPreset(w, 'twin')
    const text = serializeWorld(w)
    const tampered = text.replace('"tick":0', '"tick":5')
    expect(() => deserializeWorld(tampered)).toThrow(SaveError)
    expect(() => deserializeWorld('not json')).toThrow(SaveError)
    expect(() => deserializeWorld(JSON.stringify({ format: 'polaritium-world', schema: 99, world: {} }))).toThrow(SaveError)
  })

  it('an older save format is migrated', () => {
    const w = createWorld({ seed: 'mig', env: 'cradle' })
    applyPreset(w, 'twin')
    const file = JSON.parse(serializeWorld(w))
    delete file.world.found
    delete file.world.memo
    delete file.world.lineages
    delete file.world.ghosts
    file.schema = 1
    file.checksum = hash53(JSON.stringify(file.world))
    const back = deserializeWorld(JSON.stringify(file))
    expect(back.found).toEqual({})
    expect(back.lineages).toEqual([])
    run(back, 30)
    expect(allFinite(back)).toBe(true)
  })

  it('a cloned world is independent of the original', () => {
    const w = createWorld({ seed: 'clone', env: 'cradle' })
    applyPreset(w, 'twin')
    const c = cloneWorld(w)
    run(c, 60)
    expect(w.tick).toBe(0)
    expect(c.tick).toBe(60)
  })
})

describe('presets', () => {
  for (const p of PRESETS) {
    it(`${p.name} starts and runs`, () => {
      const w = createWorld({ seed: `preset-${p.id}`, env: 'cradle' })
      applyPreset(w, p.id)
      run(w, 300)
      expect(allFinite(w)).toBe(true)
    })
  }
})

describe('organisms', () => {
  it('feed, divide with variation, and die when starved', () => {
    const w = createWorld({ seed: 'life', env: 'cradle' })
    const sun = addNode(w, 'white', { x: 0, y: 0, z: 0 }, { mass: 3 })!
    sun.anchor = 1
    for (let i = 0; i < 4; i++) spawnOrganism(w, { x: 4 + i, y: 0, z: 0 }, ARCHETYPES.swimmer, null, 30)
    let divisions = 0
    for (let t = 0; t < 3000; t++) {
      step(w)
      divisions += w.events.filter((e) => e.type === 'division').length
    }
    expect(divisions).toBeGreaterThan(0)
    const genomes = w.organisms.map((o) => o.genome.join(','))
    expect(new Set(genomes).size).toBeGreaterThan(1)
    // starve them: remove the light
    const w2 = createWorld({ seed: 'starve', env: 'well' })
    for (let i = 0; i < 3; i++) spawnOrganism(w2, { x: i * 3, y: 0, z: 0 }, ARCHETYPES.swimmer, null, 3)
    run(w2, 9000)
    expect(w2.organisms.length).toBe(0)
  })

  it('respond to what they sense: light-eaters move toward light', () => {
    const w = createWorld({ seed: 'sense', env: 'well' })
    const sun = addNode(w, 'white', { x: 20, y: 0, z: 0 }, { mass: 3 })!
    sun.anchor = 1
    run(w, 300) // let radiance spread
    const o = spawnOrganism(w, { x: 0, y: 0, z: 0 }, ARCHETYPES.swimmer, null, 8)!
    const d0 = Math.hypot(o.p.x - 20, o.p.y, o.p.z)
    run(w, 300)
    const alive = w.organisms.find((x) => x.id === o.id)!
    expect(Math.hypot(alive.p.x - 20, alive.p.y, alive.p.z)).toBeLessThan(d0)
  })

  it('reproduction obeys the population cap', () => {
    const w = createWorld({ seed: 'cap', env: 'cradle' })
    const sun = addNode(w, 'white', { x: 0, y: 0, z: 0 }, { mass: 6 })!
    sun.anchor = 1
    for (let i = 0; i < 30; i++) spawnOrganism(w, { x: (i % 6) * 2, y: Math.floor(i / 6) * 2, z: 0 }, ARCHETYPES.drifter, null, 40)
    run(w, 4000)
    expect(w.organisms.length).toBeLessThanOrEqual(ENVIRONMENTS.cradle.maxOrganisms)
  })

  it('removing an entity never leaves broken relationships behind', () => {
    const w = createWorld({ seed: 'rm', env: 'cradle' })
    applyPreset(w, 'choir')
    run(w, 200)
    const victim = w.nodes[0].id
    applyCommand(w, { type: 'remove', id: victim })
    expect(w.strands.some((s) => s.a === victim || s.b === victim)).toBe(false)
    run(w, 100)
    expect(w.rings.some((r) => r.members.includes(victim))).toBe(false)
    expect(allFinite(w)).toBe(true)
    void fill
  })
})
