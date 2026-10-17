import { gunzipSync, gzipSync } from 'node:zlib'
import { z } from 'zod'
import type { CheckpointMeta, UniverseMeta } from '@core/app/bridge'
import { deserializeWorld } from '@core/sim/serialize'
import type { Store } from './db'

// Universe files (.polaritium): a world and its checkpoints, nothing else. No settings, no
// key, no spending record. Imports are validated before anything is stored.

const universeFile = z.object({
  format: z.literal('polaritium-universe'),
  version: z.number(),
  meta: z.object({ id: z.string(), name: z.string().max(200), env: z.string(), mode: z.string(), preset: z.string(), seed: z.string() }).passthrough(),
  state: z.string(),
  checkpoints: z.array(z.object({ id: z.string(), universeId: z.string(), label: z.string(), tick: z.number(), created: z.number() }).passthrough()).optional(),
  checkpointStates: z.record(z.string(), z.string()).optional()
})

export const MAX_IMPORT_BYTES = 80 * 1024 * 1024

export function buildExport(store: Store, id: string): Buffer | null {
  const r = store.loadUniverse(id)
  if (!r) return null
  const cps = store.listCheckpoints(id)
  const states: Record<string, string> = {}
  for (const c of cps) states[c.id] = store.loadCheckpoint(c.id) ?? ''
  const file = { format: 'polaritium-universe', version: 1, meta: r.meta, state: r.state, checkpoints: cps, checkpointStates: states }
  return gzipSync(Buffer.from(JSON.stringify(file), 'utf8'))
}

export function importUniverse(store: Store, raw: Buffer, newId: string): { ok: true; meta: UniverseMeta } | { ok: false; error: string } {
  try {
    if (raw.length > MAX_IMPORT_BYTES) return { ok: false, error: 'That file is too large to be a Polaritium universe.' }
    const text = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw).toString('utf8') : raw.toString('utf8')
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      return { ok: false, error: 'That file is not a readable Polaritium universe.' }
    }
    const parsed = universeFile.safeParse(json)
    if (!parsed.success) return { ok: false, error: 'That file is not a readable Polaritium universe.' }
    deserializeWorld(parsed.data.state)
    const meta = { ...(parsed.data.meta as unknown as UniverseMeta), id: newId, name: `${parsed.data.meta.name} (imported)`, updated: Date.now() }
    store.saveUniverse(meta, parsed.data.state)
    for (const c of parsed.data.checkpoints ?? []) {
      const s = parsed.data.checkpointStates?.[c.id]
      if (s) store.saveCheckpoint({ ...(c as unknown as CheckpointMeta), id: `${newId}-${c.id}`, universeId: newId }, s)
    }
    return { ok: true, meta }
  } catch (e) {
    return { ok: false, error: `That file could not be imported: ${(e as Error).message}` }
  }
}
