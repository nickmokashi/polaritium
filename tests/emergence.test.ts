import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createWorld, addNode, addStrand } from '@core/sim/world'
import { applyCommand } from '@core/sim/commands'
import { run, step } from '@core/sim/step'
import { ARCHETYPES, spawnOrganism } from '@core/sim/organisms'
import { applyPreset } from '@core/sim/presets'
import { DISCOVERIES } from '@core/sim/discovery'
import type { WorldState } from '@core/sim/types'

function loop(w: WorldState, kinds: ('white' | 'black' | 'grey')[], coupling = 0.8) {
  const ids = kinds.map((k, i) => {
    const a = (i * Math.PI * 2) / kinds.length
    const n = addNode(w, k, { x: Math.cos(a) * 9, y: 0, z: Math.sin(a) * 9 }, { freq: 0.4, phase: 0, energy: k === 'black' ? 30 : undefined })!
    n.anchor = 1
    return n.id
  })
  for (let i = 0; i < ids.length; i++) addStrand(w, ids[i], ids[(i + 1) % ids.length], { coupling })
  return ids
}

describe('emergence', () => {
  it('a ring persists while its conditions hold, and is lost when broken', () => {
    const w = createWorld({ seed: 'ring', env: 'well', laws: { mediators: false } })
    loop(w, ['white', 'grey', 'black', 'grey'])
    run(w, 600)
    const ring = w.rings.find((r) => r.confirmed)
    expect(ring).toBeTruthy()
    run(w, 600)
    expect(w.rings.some((r) => r.id === ring!.id && r.confirmed)).toBe(true)
    // break it and wait past its memory
    applyCommand(w, { type: 'cut', id: ring!.edges[0] })
    run(w, 700)
    expect(w.rings.some((r) => r.id === ring!.id)).toBe(false)
  })

  it('a crystal grows in light and stillness, and does not grow in the dark', () => {
    const grown = (light: boolean) => {
      const w = createWorld({ seed: 'cr', env: 'cradle' })
      const b = addNode(w, 'black', { x: 0, y: 0, z: 0 }, { energy: 40 })!
      b.anchor = 1
      if (light) {
        const s = addNode(w, 'white', { x: 0, y: 12, z: 0 }, { mass: 2 })!
        s.anchor = 1
      }
      applyCommand(w, { type: 'seedCrystal', p: { x: 0, y: 0, z: 0 } })
      run(w, 2400)
      return w.crystals.reduce((s, c) => s + c.segs.length, 0)
    }
    expect(grown(true)).toBeGreaterThan(grown(false) + 5)
  })

  it('adaptation is observable: repeated pulses shift inherited caution and shells over generations', () => {
    const trait = (pulsed: boolean) => {
      const w = createWorld({ seed: 'adapt', env: 'cradle' })
      const sun = addNode(w, 'white', { x: 0, y: 0, z: 0 }, { mass: 4 })!
      sun.anchor = 1
      for (let i = 0; i < 24; i++) {
        const g = ARCHETYPES.seeker.map((x, k) => (k === 5 || k === 11 ? 0.2 + (i % 6) * 0.12 : x))
        spawnOrganism(w, { x: Math.cos(i) * 6, y: Math.sin(i * 1.3) * 3, z: Math.sin(i) * 6 }, g, null, 30)
      }
      for (let t = 0; t < 12000; t++) {
        if (pulsed && t % 90 === 0) applyCommand(w, { type: 'pulse', p: { x: Math.sin(t) * 4, y: 0, z: Math.cos(t) * 4 }, strength: 9, radius: 12 })
        step(w)
      }
      const alive = w.organisms
      const mean = (k: number) => alive.reduce((s, o) => s + o.genome[k], 0) / Math.max(1, alive.length)
      return { caution: mean(5), shell: mean(11), n: alive.length, gen: w.stats.maxGeneration }
    }
    const calm = trait(false)
    const shaken = trait(true)
    expect(calm.n).toBeGreaterThan(0)
    expect(shaken.n).toBeGreaterThan(0)
    expect(shaken.gen).toBeGreaterThanOrEqual(2)
    // under repeated shocks the population carries more protection (shell or caution)
    expect(shaken.shell + shaken.caution).toBeGreaterThan(calm.shell + calm.caution + 0.04)
  }, 120_000)

  it('the discovery engine reports nothing that did not happen', () => {
    const w = createWorld({ seed: 'quiet', env: 'well' })
    addNode(w, 'white', { x: -20, y: 0, z: 0 })
    addNode(w, 'black', { x: 20, y: 0, z: 0 })
    run(w, 1800)
    // no strand, no organisms, no rings: none of these may be reported
    for (const id of ['resonance', 'third', 'ring', 'membrane', 'quickening', 'motile', 'lineage', 'colony', 'chorus', 'crystal', 'collapse']) expect(w.found[id]).toBeUndefined()
    // and what it does report must be backed by the state or the record
    for (const id of Object.keys(w.found)) expect(DISCOVERIES.some((d) => d.id === id || id.startsWith('form:'))).toBe(true)
  })

  it('every reported finding carries a real subject or event', () => {
    const w = createWorld({ seed: 'busy', env: 'cradle' })
    applyPreset(w, 'twin')
    applyCommand(w, { type: 'connect', a: w.nodes[0].id, b: w.nodes[1].id })
    const findings: { text?: string; a?: number; t: number }[] = []
    for (let t = 0; t < 3600; t++) {
      step(w)
      for (const e of w.events) if (e.type === 'finding') findings.push(e)
    }
    expect(findings.length).toBeGreaterThan(0)
    for (const f of findings) {
      const type = String(f.text).split('|')[0]
      if (type === 'third') expect(w.log.some((e) => e.type === 'birth' && e.t <= f.t)).toBe(true)
      if (type === 'collapse') expect(w.log.some((e) => e.type === 'collapse' && e.t <= f.t)).toBe(true)
      if (type === 'current' || type === 'resonance') expect(typeof f.a).toBe('number')
    }
  })

  it('Genesis begins with the deeper laws asleep and wakes them through discovery', () => {
    const w = createWorld({ seed: 'gen', env: 'genesis', mode: 'genesis' })
    expect(w.laws.phase).toBe(false)
    expect(w.laws.mediators).toBe(false)
    expect(applyCommand(w, { type: 'seed', kind: 'grey', p: { x: 0, y: 0, z: 0 } }).ok).toBe(false)
    applyPreset(w, 'twin')
    const W = w.nodes.find((n) => n.kind === 'white')!
    const B = w.nodes.find((n) => n.kind === 'black')!
    applyCommand(w, { type: 'connect', a: W.id, b: B.id, coupling: 0.7 })
    applyCommand(w, { type: 'tune', id: B.id, freq: W.freq })
    const laws: string[] = []
    for (let t = 0; t < 5400; t++) {
      step(w)
      for (const e of w.events) if (e.type === 'law') laws.push(String(e.text))
    }
    expect(laws).toContain('phase')
    expect(laws).toContain('mediators')
    expect(w.laws.phase && w.laws.mediators).toBe(true)
  }, 60_000)
})

describe('architecture rules', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f)
      return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : []
    })
  const src = join(__dirname, '..', 'src')

  it('only the one desktop sender imports the Anthropic SDK', () => {
    const importers = files(src).filter((f) => /from ['"]@anthropic-ai\/sdk/.test(readFileSync(f, 'utf8')))
    expect(importers.map((f) => f.replace(src, '').replace(/\\/g, '/'))).toEqual(['/main/ai.ts'])
  })

  it('the sender turns SDK retries off and every request goes through the budget', () => {
    const ai = readFileSync(join(src, 'main', 'ai.ts'), 'utf8')
    const clients = ai.match(/new Anthropic\(\{[^}]*\}\)/g) ?? []
    expect(clients.length).toBeGreaterThan(0)
    for (const c of clients) expect(c).toContain('maxRetries: 0')
    // messages are only created inside the transport used by AiService
    expect((ai.match(/messages\.create\(/g) ?? []).length).toBe(1)
    expect(ai).toContain('new AiService(this.budget')
  })

  it('the game page has no way to read the key', () => {
    const preload = readFileSync(join(src, 'preload', 'index.ts'), 'utf8')
    expect(preload).not.toMatch(/getKey|readKey|key:get/)
    const bridge = readFileSync(join(src, 'core', 'app', 'bridge.ts'), 'utf8')
    expect(bridge).not.toMatch(/getKey|readKey/)
  })
})
