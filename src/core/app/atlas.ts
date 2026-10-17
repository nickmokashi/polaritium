import { DISCOVERY_BY_ID } from '../sim/discovery'
import { envOf } from '../sim/environments'
import { inspect, summarize } from '../sim/inspect'
import { hash53 } from '../sim/serialize'
import type { SimEvent, WorldState } from '../sim/types'
import { TICKS_PER_SECOND } from '../sim/constants'

export interface AtlasEntry {
  id: string
  type: string
  name: string
  customName: string | null
  line: string
  firstAt: number
  universeId: string | null
  universeName: string | null
  env: string
  tick: number
  measurements: [string, string][]
  conditions: string[]
  reproduce: string
  notes: string
  ai: string | null
  image: string | null
  count: number
}

const SYL_A = ['ver', 'aul', 'sil', 'mor', 'tes', 'ond', 'cal', 'ith', 'ran', 'ves', 'lum', 'orr', 'eth', 'nai', 'quor', 'zel']
const SYL_B = ['ane', 'ith', 'ora', 'ex', 'yl', 'um', 'is', 'ae', 'on', 'eth', 'ix', 'ar']

/** A deterministic name for a new kind of form, from its signature. */
export function formName(signature: string): string {
  const h = parseInt(hash53(signature), 36)
  const a = SYL_A[h % SYL_A.length]
  const b = SYL_A[Math.floor(h / 16) % SYL_A.length]
  const c = SYL_B[Math.floor(h / 256) % SYL_B.length]
  const word = a + b + c
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/** Builds the Atlas record for a finding event, from the state at the moment it was found. */
export function entryFromFinding(w: WorldState, e: SimEvent, universe: { id: string | null; name: string | null }): AtlasEntry | null {
  const [type, extra] = String(e.text ?? '').split('|')
  const def = DISCOVERY_BY_ID.get(type)
  if (!def) return null
  const env = envOf(w.env)
  const reading = e.a ? inspect(w, e.a) : null
  const s = summarize(w)
  const measurements: [string, string][] = []
  if (reading) for (const v of reading.values.slice(0, 5)) measurements.push(v)
  if (type === 'adaptation' && extra) measurements.unshift(['Trait that shifted', extra])
  measurements.push(['Measured value', Number(e.value ?? 0).toFixed(2)])
  const conditions = [
    `In ${env.name}, ${Math.round(w.tick / TICKS_PER_SECOND)} seconds in.`,
    `${s.light} light, ${s.dark} dark, ${s.grey} grey; ${s.strands} strands (${s.lockedStrands} in step).`,
    s.organisms ? `${s.organisms} living forms, up to generation ${s.generations}.` : 'No living forms.'
  ]
  const isForm = type === 'form'
  return {
    id: isForm ? `form:${extra}` : type,
    type,
    name: isForm ? `${formName(extra ?? '')}` : def.name,
    customName: null,
    line: isForm ? describeSignature(extra ?? '') : def.line,
    firstAt: Date.now(),
    universeId: universe.id,
    universeName: universe.name,
    env: env.name,
    tick: w.tick,
    measurements,
    conditions,
    reproduce: def.reproduce,
    notes: '',
    ai: null,
    image: null,
    count: 1
  }
}

export function describeSignature(sig: string): string {
  const m = /^ring(\d+)-([BGW]*)-w(\d+)$/.exec(sig)
  if (!m) return 'A structure not seen before.'
  const n = Number(m[1])
  const kinds = m[2]
  const parts = [
    kinds.split('W').length - 1 ? `${kinds.split('W').length - 1} light` : '',
    kinds.split('B').length - 1 ? `${kinds.split('B').length - 1} dark` : '',
    kinds.split('G').length - 1 ? `${kinds.split('G').length - 1} grey` : ''
  ].filter(Boolean)
  return `A ring of ${n} (${parts.join(', ')})${Number(m[3]) ? ` whose rhythm winds ${m[3]} time${Number(m[3]) > 1 ? 's' : ''} around it` : ''}.`
}
