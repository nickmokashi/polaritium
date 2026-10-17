import { envOf } from './environments'
import { TAU } from './math'
import { ARCHETYPES, spawnOrganism } from './organisms'
import { nextRandom, randInSphere, randRange } from './rng'
import type { Kind, WorldState } from './types'
import { addNode, addStrand } from './world'
import { nucleate } from './crystals'

// Prepared starting systems. Each one is a different first question to ask the medium.

export interface PresetInfo {
  id: string
  name: string
  line: string
}

export const PRESETS: PresetInfo[] = [
  { id: 'twin', name: 'Twin Concentrations', line: 'One light, one dark, and the space between them. Where it all begins.' },
  { id: 'scatter', name: 'Scattered Medium', line: 'A loose, random scattering of light, dark and grey. Different every seed.' },
  { id: 'choir', name: 'The Choir', line: 'Six mediators in a loop, each with its own rhythm, fed by one light.' },
  { id: 'wheel', name: 'The Frustrated Wheel', line: 'A loop whose twists add up to a full turn, so its rhythm can never settle.' },
  { id: 'orchard', name: 'Crystal Orchard', line: 'Dark concentrations in still light, ready to grow.' },
  { id: 'shoal', name: 'The Shoal', line: 'Living forms already swimming between a light and a dark.' },
  { id: 'engine', name: 'Collapse Engine', line: 'A dark concentration nearly full. What happens when it can hold no more?' },
  { id: 'empty', name: 'Empty Chamber', line: 'Nothing at all. Seed it yourself.' }
]

export function applyPreset(w: WorldState, id: string, density = 1): void {
  const env = envOf(w.env)
  const R = env.radius
  const node = (kind: Kind, x: number, y: number, z: number, o: Parameters<typeof addNode>[3] = {}) => {
    const n = addNode(w, kind, { x, y, z }, o)
    if (n) w.acct.external += n.energy
    return n
  }
  switch (id) {
    case 'twin': {
      node('white', -14, 2, 0, { mass: 1.1, freq: 0.42 })
      node('black', 14, -2, 0, { mass: 1.3, freq: 0.32 })
      // Faint distant concentrations so the dark has depth.
      node('white', -34, 18, -30, { mass: 0.5, freq: 0.7 })
      node('black', 30, -16, -34, { mass: 0.6, freq: 0.22 })
      break
    }
    case 'scatter': {
      const count = Math.round(10 * density)
      for (let i = 0; i < count; i++) {
        const p = randInSphere(w, R * 0.6)
        const r = nextRandom(w)
        const kind: Kind = r < 0.42 ? 'white' : r < 0.84 ? 'black' : w.laws.mediators ? 'grey' : 'white'
        node(kind, p.x, p.y * 0.6, p.z, { mass: randRange(w, 0.5, 1.8) })
      }
      break
    }
    case 'choir': {
      const ids: number[] = []
      for (let i = 0; i < 6; i++) {
        const a = (i * TAU) / 6
        const n = node(w.laws.mediators ? 'grey' : 'white', Math.cos(a) * 14, 0, Math.sin(a) * 14, { mass: 0.9, freq: 0.3 + i * 0.07, energy: 4 })
        if (n) ids.push(n.id)
      }
      for (let i = 0; i < ids.length; i++) addStrand(w, ids[i], ids[(i + 1) % ids.length], { coupling: 0.3, origin: 'preset' })
      const sun = node('white', 0, 10, 0, { mass: 1.4, freq: 0.5 })
      if (sun) for (let i = 0; i < ids.length; i += 2) addStrand(w, sun.id, ids[i], { coupling: 0.25, origin: 'preset' })
      break
    }
    case 'wheel': {
      const kinds: Kind[] = ['white', 'grey', 'black', 'grey']
      const ids: number[] = []
      for (let i = 0; i < 4; i++) {
        const a = (i * TAU) / 4
        const kind = kinds[i] === 'grey' && !w.laws.mediators ? 'white' : kinds[i]
        const n = node(kind, Math.cos(a) * 12, Math.sin(a) * 3, Math.sin(a) * 12, { mass: 1, freq: 0.4 })
        if (n) ids.push(n.id)
      }
      for (let i = 0; i < ids.length; i++) addStrand(w, ids[i], ids[(i + 1) % ids.length], { coupling: 0.8, twist: TAU / 4, resistance: 1.2, origin: 'preset' })
      break
    }
    case 'orchard': {
      node('white', 0, 16, 0, { mass: 1.8, freq: 0.5 })
      for (let i = 0; i < 3; i++) {
        const a = (i * TAU) / 3 + 0.4
        const b = node('black', Math.cos(a) * 16, -6, Math.sin(a) * 16, { mass: 1.2, energy: 30 })
        if (b && w.laws.crystals) nucleate(w, env, b.p, b)
      }
      break
    }
    case 'shoal': {
      const sun = node('white', -14, 4, 0, { mass: 1.6, freq: 0.5 })
      const dark = node('black', 14, -4, 0, { mass: 1.4, freq: 0.35 })
      if (sun && dark) addStrand(w, sun.id, dark.id, { coupling: 0.35, origin: 'preset' })
      if (w.laws.life) {
        for (let i = 0; i < Math.round(12 * density); i++) {
          const p = randInSphere(w, 14)
          const o = spawnOrganism(w, { x: p.x - 6, y: p.y, z: p.z }, ARCHETYPES.swimmer.map((g) => Math.min(1, Math.max(0, g + randRange(w, -0.08, 0.08)))), null, 18)
          if (o) w.acct.external += o.energy
        }
        for (let i = 0; i < Math.round(6 * density); i++) {
          const p = randInSphere(w, 10)
          const o = spawnOrganism(w, { x: p.x + 4, y: p.y + 6, z: p.z }, ARCHETYPES.drifter.map((g) => Math.min(1, Math.max(0, g + randRange(w, -0.08, 0.08)))), null, 20)
          if (o) w.acct.external += o.energy
        }
      }
      break
    }
    case 'engine': {
      const core = node('black', 0, 0, 0, { mass: 1.6, freq: 0.28 })
      if (core) {
        core.energy = core.mass * 60 * 0.9
        w.acct.external += core.energy - core.mass * 60 * 0.1
      }
      for (let i = 0; i < 3; i++) {
        const a = (i * TAU) / 3
        const s = node('white', Math.cos(a) * 15, 3, Math.sin(a) * 15, { mass: 1.2, freq: 0.3 })
        if (s && core) addStrand(w, s.id, core.id, { coupling: 0.5, origin: 'preset' })
      }
      break
    }
    case 'empty':
    default:
      break
  }
}
