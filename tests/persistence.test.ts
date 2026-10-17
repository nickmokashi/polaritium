import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, copyFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { Store } from '../src/main/db'
import { SqliteBudgetStore } from '../src/main/budgetStore'
import { buildExport, importUniverse } from '../src/main/importer'
import { createWorld } from '@core/sim/world'
import { applyPreset } from '@core/sim/presets'
import { run } from '@core/sim/step'
import { serializeWorld, deserializeWorld, stateHash } from '@core/sim/serialize'
import { BudgetController, defaultSettings } from '@core/budget/controller'
import type { UniverseMeta } from '@core/app/bridge'
import type { RequestPlan } from '@core/budget/estimator'

const dirs: string[] = []
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'polaritium-test-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      /* Windows may hold the file a moment longer */
    }
  }
})

function meta(id: string, name = 'Test'): UniverseMeta {
  return { id, name, env: 'cradle', mode: 'lab', preset: 'twin', seed: 's', created: 1, updated: 1, tick: 0, parent: null, parentCheckpoint: null, thumb: null, notes: '', chamber: null, rules: 1, camera: null }
}

function world(ticks = 60): string {
  const w = createWorld({ seed: 'persist', env: 'cradle' })
  applyPreset(w, 'twin')
  run(w, ticks)
  return serializeWorld(w)
}

describe('saves', () => {
  it('a saved universe loads back exactly, and survives a restart', () => {
    const d = tmp()
    const s1 = new Store(d)
    const state = world()
    s1.saveUniverse(meta('u1'), state)
    s1.close()
    const s2 = new Store(d)
    const r = s2.loadUniverse('u1')!
    expect(r.recovered).toBe(false)
    expect(stateHash(deserializeWorld(r.state))).toBe(stateHash(deserializeWorld(state)))
    expect(s2.listUniverses().map((u) => u.id)).toEqual(['u1'])
    s2.close()
  })

  it('refuses to store a damaged world', () => {
    const s = new Store(tmp())
    expect(() => s.saveUniverse(meta('bad'), '{"not":"a world"}')).toThrow()
    expect(s.listUniverses()).toEqual([])
    s.close()
  })

  it('keeps the two previous saves and falls back to them if the latest is damaged', () => {
    const s = new Store(tmp())
    const a = world(30)
    const b = world(60)
    const c = world(90)
    s.saveUniverse(meta('u'), a)
    s.saveUniverse(meta('u'), b)
    s.saveUniverse(meta('u'), c)
    const slots = s.db.prepare('SELECT slot FROM states WHERE universe_id = ? ORDER BY slot').all('u') as { slot: number }[]
    expect(slots.map((x) => x.slot)).toEqual([0, 1, 2])
    // damage the newest save
    s.db.prepare('UPDATE states SET data = ? WHERE universe_id = ? AND slot = 0').run(gzipSync(Buffer.from('garbage')), 'u')
    const r = s.loadUniverse('u')!
    expect(r.recovered).toBe(true)
    expect(stateHash(deserializeWorld(r.state))).toBe(stateHash(deserializeWorld(b)))
    // damage every save: it fails safely with an explanation
    s.db.prepare('UPDATE states SET data = ? WHERE universe_id = ?').run(gzipSync(Buffer.from('garbage')), 'u')
    expect(() => s.loadUniverse('u')).toThrow(/damaged/)
    s.close()
  })

  it('an interrupted write leaves the earlier save intact', () => {
    const s = new Store(tmp())
    const a = world(30)
    s.saveUniverse(meta('u'), a)
    expect(() =>
      s.tx(() => {
        s.db.prepare('DELETE FROM states WHERE universe_id = ?').run('u')
        throw new Error('power cut')
      })
    ).toThrow('power cut')
    const r = s.loadUniverse('u')!
    expect(stateHash(deserializeWorld(r.state))).toBe(stateHash(deserializeWorld(a)))
    s.close()
  })

  it('a damaged database file is set aside and the daily copy restored', () => {
    // As at a real startup: this process has never opened the damaged file.
    const source = tmp()
    const d = tmp()
    const s1 = new Store(source)
    s1.saveUniverse(meta('keep'), world())
    s1.db.exec(`VACUUM INTO '${join(d, 'polaritium.backup.db').replace(/'/g, "''")}'`)
    s1.close()
    writeFileSync(join(d, 'polaritium.db'), Buffer.alloc(8192, 7))
    const s2 = new Store(d)
    expect(s2.recoveredFromBackup).toBe(true)
    expect(s2.listUniverses().map((u) => u.id)).toContain('keep')
    s2.close()
  })

  it('checkpoints reproduce their moment exactly, so a branch starts where it should', () => {
    const s = new Store(tmp())
    const state = world(120)
    s.saveUniverse(meta('u'), world(10))
    s.saveCheckpoint({ id: 'c1', universeId: 'u', label: 'mark', tick: 120, created: 1, thumb: null }, state)
    const back = s.loadCheckpoint('c1')!
    s.saveUniverse({ ...meta('branch'), parent: 'u', parentCheckpoint: 'c1' }, back)
    const branch = s.loadUniverse('branch')!
    expect(stateHash(deserializeWorld(branch.state))).toBe(stateHash(deserializeWorld(state)))
    // and the branch evolves exactly as the checkpoint would have
    const x = deserializeWorld(branch.state)
    const y = deserializeWorld(state)
    run(x, 200)
    run(y, 200)
    expect(stateHash(x)).toBe(stateHash(y))
    s.close()
  })

  it('settings are normalised and kept', () => {
    const d = tmp()
    const s = new Store(d)
    const set = s.getSettings()
    s.setSettings({ ...set, audio: { ...set.audio, master: 0.3 }, graphics: { ...set.graphics, dust: 99999 as never } })
    s.close()
    const s2 = new Store(d)
    expect(s2.getSettings().audio.master).toBe(0.3)
    expect(s2.getSettings().graphics.dust).toBe(30000)
    s2.close()
  })

  it('the Atlas counts repeat findings and keeps notes', () => {
    const s = new Store(tmp())
    const e = { id: 'current', type: 'current', name: 'Living Current', customName: null, line: 'x', firstAt: 1, universeId: null, universeName: null, env: 'cradle', tick: 1, measurements: [], conditions: [], reproduce: 'y', notes: '', ai: null, image: null, count: 1 }
    expect(s.recordAtlas(e).isNew).toBe(true)
    expect(s.recordAtlas(e).isNew).toBe(false)
    s.updateAtlas('current', { notes: 'it hummed' })
    const back = s.listAtlas()[0]
    expect(back.count).toBe(2)
    expect(back.notes).toBe('it hummed')
    s.close()
  })
})

describe('universe files', () => {
  it('export and import round-trip a world and its checkpoints', () => {
    const s = new Store(tmp())
    const state = world(60)
    s.saveUniverse(meta('u', 'Original'), state)
    s.saveCheckpoint({ id: 'c', universeId: 'u', label: 'mark', tick: 60, created: 1, thumb: null }, state)
    const file = buildExport(s, 'u')!
    const r = importUniverse(s, file, 'imp')
    expect(r.ok).toBe(true)
    expect(s.listUniverses().some((u) => u.name === 'Original (imported)')).toBe(true)
    expect(s.listCheckpoints('imp').length).toBe(1)
    s.close()
  })

  it('an export never contains a key, settings or the spending record', () => {
    const s = new Store(tmp())
    s.setSettings({ ...s.getSettings() })
    s.db.prepare("INSERT INTO budget (key, value) VALUES ('secret-test', 'sk-ant-should-never-leave-00000000000000000')").run()
    s.saveUniverse(meta('u'), world())
    const text = gunzipSync(buildExport(s, 'u')!).toString('utf8')
    expect(text).not.toMatch(/sk-ant/)
    expect(text).not.toMatch(/"ledger"|"budget"|"settings"/)
    s.close()
  })

  it('imports are validated: junk, wrong shapes and damaged worlds are refused', () => {
    const s = new Store(tmp())
    expect(importUniverse(s, Buffer.from('nonsense'), 'a').ok).toBe(false)
    expect(importUniverse(s, Buffer.from(JSON.stringify({ format: 'something-else' })), 'b').ok).toBe(false)
    const bad = { format: 'polaritium-universe', version: 1, meta: { id: 'x', name: 'x', env: 'cradle', mode: 'lab', preset: 'twin', seed: 's' }, state: '{"broken":true}' }
    expect(importUniverse(s, Buffer.from(JSON.stringify(bad)), 'c').ok).toBe(false)
    expect(s.listUniverses()).toEqual([])
    s.close()
  })
})

describe('the budget ledger on disk', () => {
  const plan: RequestPlan = { feature: 'test', model: 'claude-haiku-5-5', system: 's', messages: [{ role: 'user', text: 'u' }], maxOutputTokens: 200 }
  it('a reservation is on disk before admission returns, and a crash keeps it counted', () => {
    const d = tmp()
    const s1 = new Store(d)
    const store1 = new SqliteBudgetStore(s1)
    const b1 = new BudgetController(store1, () => null)
    b1.setEnabled(true)
    const r = b1.admit(plan, { trustedNow: Date.now(), sessionId: 'x', keyPresent: true, userInitiated: true })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    b1.markSent(r.ticket.entryId)
    s1.close() // crash
    const s2 = new Store(d)
    const b2 = new BudgetController(new SqliteBudgetStore(s2), () => null)
    const e = b2.ledger().find((x) => x.id === r.ticket.entryId)!
    expect(e.status).toBe('uncertain')
    expect(b2.view(Date.now(), 'y').spentMonth).toBe(r.ticket.reserved)
    expect(b2.getSettings().limits.monthly).toBe(defaultSettings().limits.monthly)
    s2.close()
  })
  void copyFileSync
  void readFileSync
})
