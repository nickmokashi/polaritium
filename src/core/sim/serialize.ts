import { RULES_VERSION, SAVE_SCHEMA } from './constants'
import { ENVIRONMENTS } from './environments'
import type { WorldState } from './types'
import { invalidate } from './world'

// Saved worlds are plain JSON. The typed field arrays travel as base64. Every saved world
// carries its schema and rules version and a checksum of its contents, so a damaged file is
// refused instead of silently loading as a different universe.

export class SaveError extends Error {
  constructor(
    public reason: 'unreadable' | 'checksum' | 'version' | 'shape',
    message: string
  ) {
    super(message)
  }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function bytesToBase64(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63]
  }
  const rem = bytes.length - i
  if (rem === 1) {
    const n = bytes[i] << 16
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + '=='
  } else if (rem === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8)
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '='
  }
  return out
}

const REV = new Int16Array(128).fill(-1)
for (let i = 0; i < B64.length; i++) REV[B64.charCodeAt(i)] = i

export function base64ToBytes(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/=]/g, '')
  const pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0
  const len = (clean.length / 4) * 3 - pad
  const out = new Uint8Array(Math.max(0, len))
  let o = 0
  for (let i = 0; i < clean.length; i += 4) {
    const a = REV[clean.charCodeAt(i)]
    const b = REV[clean.charCodeAt(i + 1)]
    const c = clean[i + 2] === '=' ? 0 : REV[clean.charCodeAt(i + 2)]
    const d = clean[i + 3] === '=' ? 0 : REV[clean.charCodeAt(i + 3)]
    if (a < 0 || b < 0 || c < 0 || d < 0) throw new SaveError('unreadable', 'The saved field data is damaged.')
    const n = (a << 18) | (b << 12) | (c << 6) | d
    if (o < len) out[o++] = (n >> 16) & 255
    if (o < len) out[o++] = (n >> 8) & 255
    if (o < len) out[o++] = n & 255
  }
  return out
}

/** A fast 53-bit string hash (cyrb53). Used for checksums and determinism checks. */
export function hash53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507)
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507)
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

function body(w: WorldState): Record<string, unknown> {
  const { field, events: _e, ...rest } = w
  void _e
  return {
    ...rest,
    field: {
      n: field.n,
      half: field.half,
      radiance: bytesToBase64(new Uint8Array(field.radiance.buffer, field.radiance.byteOffset, field.radiance.byteLength)),
      signal: bytesToBase64(new Uint8Array(field.signal.buffer, field.signal.byteOffset, field.signal.byteLength)),
      signalVel: bytesToBase64(new Uint8Array(field.signalVel.buffer, field.signalVel.byteOffset, field.signalVel.byteLength))
    }
  }
}

export interface SaveFile {
  format: 'polaritium-world'
  schema: number
  rules: number
  checksum: string
  world: Record<string, unknown>
}

export function serializeWorld(w: WorldState): string {
  const world = body(w)
  const json = JSON.stringify(world)
  const file: SaveFile = { format: 'polaritium-world', schema: SAVE_SCHEMA, rules: w.rulesVersion, checksum: hash53(json), world }
  return JSON.stringify(file)
}

/** A stable fingerprint of the authoritative state (events in flight excluded). */
export function stateHash(w: WorldState): string {
  return hash53(JSON.stringify(body(w)))
}

type Migration = (world: Record<string, unknown>) => Record<string, unknown>

// Schema 1 (the first internal builds) had no discovery memory and no lines of descent.
const MIGRATIONS: Record<number, Migration> = {
  1: (wd) => ({ ...wd, found: wd.found ?? {}, memo: wd.memo ?? {}, lineages: wd.lineages ?? [] })
}

export function migrate(schema: number, world: Record<string, unknown>): Record<string, unknown> {
  let s = schema
  let wd = world
  while (s < SAVE_SCHEMA) {
    const m = MIGRATIONS[s]
    if (!m) throw new SaveError('version', `This world was saved in an old format (${s}) that cannot be read.`)
    wd = m(wd)
    s++
  }
  return wd
}

function float64(b64: unknown, n: number): Float64Array {
  if (typeof b64 !== 'string') throw new SaveError('shape', 'The saved field is missing.')
  const bytes = base64ToBytes(b64)
  if (bytes.byteLength !== n * 8) throw new SaveError('shape', 'The saved field has the wrong size.')
  return new Float64Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
}

function float32(b64: unknown, n: number): Float32Array {
  if (typeof b64 !== 'string') throw new SaveError('shape', 'The saved field is missing.')
  const bytes = base64ToBytes(b64)
  if (bytes.byteLength !== n * 4) throw new SaveError('shape', 'The saved field has the wrong size.')
  return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
}

export function deserializeWorld(text: string): WorldState {
  let file: SaveFile
  try {
    file = JSON.parse(text)
  } catch {
    throw new SaveError('unreadable', 'The world file is not readable.')
  }
  if (!file || file.format !== 'polaritium-world' || typeof file.world !== 'object' || !file.world) throw new SaveError('unreadable', 'This is not a Polaritium world.')
  if (typeof file.schema !== 'number' || file.schema > SAVE_SCHEMA) throw new SaveError('version', 'This world was saved by a newer version of Polaritium.')
  if (hash53(JSON.stringify(file.world)) !== file.checksum) throw new SaveError('checksum', 'The world file is damaged (its checksum does not match).')
  const wd = migrate(file.schema, file.world)
  return reviveWorld(wd)
}

export function reviveWorld(wd: Record<string, unknown>): WorldState {
  const f = wd.field as { n: number; half: number; radiance: string; signal: string; signalVel: string } | undefined
  if (!f || !Number.isInteger(f.n) || f.n < 4 || f.n > 64 || !Number.isFinite(f.half)) throw new SaveError('shape', 'The saved world has no valid field.')
  const cells = f.n * f.n * f.n
  for (const k of ['nodes', 'strands', 'crystals', 'fragments', 'organisms', 'bonds', 'rings', 'veils', 'pulls', 'log', 'scars', 'traitHistory', 'lineages']) {
    if (!Array.isArray(wd[k])) throw new SaveError('shape', `The saved world is missing its ${k}.`)
  }
  if (!ENVIRONMENTS[wd.env as keyof typeof ENVIRONMENTS]) throw new SaveError('shape', 'The saved world names an unknown environment.')
  for (const k of ['tick', 'seed', 'rng', 'nextId']) if (!Number.isFinite(wd[k] as number)) throw new SaveError('shape', `The saved world has a bad ${k}.`)
  const nodes = wd.nodes as { p?: { x: number }; energy?: number }[]
  for (const n of nodes) if (!n || !n.p || !Number.isFinite(n.p.x) || !Number.isFinite(n.energy as number)) throw new SaveError('shape', 'A saved node is damaged.')
  const w = {
    ...(wd as unknown as WorldState),
    events: [],
    field: { n: f.n, half: f.half, radiance: float64(f.radiance, cells), signal: float32(f.signal, cells), signalVel: float32(f.signalVel, cells) }
  } as WorldState
  if (!w.rulesVersion) w.rulesVersion = RULES_VERSION
  invalidate(w)
  return w
}

/** A deep copy through the save format (used for checkpoints, undo and branching). */
export function cloneWorld(w: WorldState): WorldState {
  return deserializeWorld(serializeWorld(w))
}
