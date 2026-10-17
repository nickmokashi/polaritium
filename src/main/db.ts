import { DatabaseSync } from 'node:sqlite'
import { copyFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import type { AtlasEntry } from '@core/app/atlas'
import type { ChamberProgress, CheckpointMeta, Exhibit, UniverseMeta } from '@core/app/bridge'
import { normalizeSettings, type Settings } from '@core/app/settings'
import { deserializeWorld } from '@core/sim/serialize'

// Everything Polaritium keeps lives in one SQLite file in the user's app-data folder. Every
// write is a transaction: it lands whole or not at all. Each universe keeps its two previous
// saves as backups, and the whole file is copied aside once a day, so one bad write or a
// damaged file never costs more than the latest change.

const SCHEMA_VERSION = 1

export class Store {
  db: DatabaseSync
  readonly path: string
  recoveredFromBackup = false

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true })
    this.path = join(dir, 'polaritium.db')
    this.db = this.open()
    this.migrate()
    this.dailyBackup()
  }

  private open(): DatabaseSync {
    try {
      const db = new DatabaseSync(this.path)
      db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;')
      const ok = db.prepare('PRAGMA quick_check').get() as { quick_check?: string } | undefined
      if (ok && ok.quick_check && ok.quick_check !== 'ok') throw new Error(`Database check failed: ${ok.quick_check}`)
      return db
    } catch (err) {
      // The file is damaged. Keep it for inspection and restore the latest daily copy.
      if (existsSync(this.path)) renameSync(this.path, `${this.path}.damaged-${Date.now()}`)
      const backup = join(dirname(this.path), 'polaritium.backup.db')
      if (existsSync(backup)) {
        copyFileSync(backup, this.path)
        this.recoveredFromBackup = true
      }
      const db = new DatabaseSync(this.path)
      db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;')
      void err
      return db
    }
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS universes (id TEXT PRIMARY KEY, meta TEXT NOT NULL, updated INTEGER);
      CREATE TABLE IF NOT EXISTS states (universe_id TEXT NOT NULL, slot INTEGER NOT NULL, data BLOB NOT NULL, saved INTEGER, PRIMARY KEY (universe_id, slot));
      CREATE TABLE IF NOT EXISTS checkpoints (id TEXT PRIMARY KEY, universe_id TEXT NOT NULL, meta TEXT NOT NULL, data BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS atlas (id TEXT PRIMARY KEY, entry TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS exhibits (id TEXT PRIMARY KEY, meta TEXT NOT NULL, data BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS chambers (id TEXT PRIMARY KEY, progress TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ai_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, created INTEGER);
      CREATE TABLE IF NOT EXISTS budget (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS ledger (id TEXT PRIMARY KEY, entry TEXT NOT NULL, created INTEGER);
      CREATE TABLE IF NOT EXISTS rejections (at INTEGER, entry TEXT NOT NULL);
    `)
    const v = this.db.prepare("SELECT value FROM meta WHERE key = 'schema'").get() as { value?: string } | undefined
    if (!v) this.db.prepare("INSERT INTO meta (key, value) VALUES ('schema', ?)").run(String(SCHEMA_VERSION))
  }

  private dailyBackup(): void {
    const backup = join(dirname(this.path), 'polaritium.backup.db')
    try {
      const age = existsSync(backup) ? Date.now() - statSync(backup).mtimeMs : Infinity
      if (age > 24 * 3600_000) {
        const tmp = `${backup}.tmp`
        if (existsSync(tmp)) renameSync(tmp, `${tmp}.old-${Date.now()}`)
        this.db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`)
        renameSync(tmp, backup)
      }
    } catch {
      /* a failed backup never stops the game */
    }
  }

  /** Runs fn inside one transaction; any throw rolls everything back. */
  tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const r = fn()
      this.db.exec('COMMIT')
      return r
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  // ---- settings ----
  getSettings(): Settings {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'settings'").get() as { value?: string } | undefined
    try {
      return normalizeSettings(row?.value ? JSON.parse(row.value) : null)
    } catch {
      return normalizeSettings(null)
    }
  }
  setSettings(s: Settings): Settings {
    const n = normalizeSettings(s)
    this.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('settings', ?)").run(JSON.stringify(n))
    return n
  }

  // ---- universes ----
  listUniverses(): UniverseMeta[] {
    const rows = this.db.prepare('SELECT meta FROM universes ORDER BY updated DESC').all() as { meta: string }[]
    return rows.map((r) => JSON.parse(r.meta))
  }

  /** Saves atomically, keeping the two previous saves as slots 1 and 2. */
  saveUniverse(meta: UniverseMeta, state: string): UniverseMeta {
    deserializeWorld(state) // refuse to store anything that would not load
    const m = { ...meta, updated: Date.now() }
    const blob = gzipSync(Buffer.from(state, 'utf8'))
    this.tx(() => {
      this.db.prepare('DELETE FROM states WHERE universe_id = ? AND slot = 2').run(m.id)
      this.db.prepare('UPDATE states SET slot = 2 WHERE universe_id = ? AND slot = 1').run(m.id)
      this.db.prepare('UPDATE states SET slot = 1 WHERE universe_id = ? AND slot = 0').run(m.id)
      this.db.prepare('INSERT INTO states (universe_id, slot, data, saved) VALUES (?, 0, ?, ?)').run(m.id, blob, Date.now())
      this.db.prepare('INSERT OR REPLACE INTO universes (id, meta, updated) VALUES (?, ?, ?)').run(m.id, JSON.stringify(m), m.updated)
    })
    return m
  }

  /** Loads the newest save that is intact, falling back through the backups. */
  loadUniverse(id: string): { meta: UniverseMeta; state: string; recovered: boolean } | null {
    const row = this.db.prepare('SELECT meta FROM universes WHERE id = ?').get(id) as { meta?: string } | undefined
    if (!row?.meta) return null
    const slots = this.db.prepare('SELECT slot, data FROM states WHERE universe_id = ? ORDER BY slot').all(id) as { slot: number; data: Uint8Array }[]
    for (const s of slots) {
      try {
        const text = gunzipSync(Buffer.from(s.data)).toString('utf8')
        deserializeWorld(text)
        return { meta: JSON.parse(row.meta), state: text, recovered: s.slot > 0 }
      } catch {
        /* damaged; try the previous save */
      }
    }
    throw new Error('Every save of this universe is damaged.')
  }

  removeUniverse(id: string): void {
    this.tx(() => {
      this.db.prepare('DELETE FROM states WHERE universe_id = ?').run(id)
      this.db.prepare('DELETE FROM checkpoints WHERE universe_id = ?').run(id)
      this.db.prepare('DELETE FROM universes WHERE id = ?').run(id)
    })
  }

  renameUniverse(id: string, name: string): boolean {
    const row = this.db.prepare('SELECT meta FROM universes WHERE id = ?').get(id) as { meta?: string } | undefined
    if (!row?.meta) return false
    const m = { ...JSON.parse(row.meta), name }
    this.db.prepare('UPDATE universes SET meta = ? WHERE id = ?').run(JSON.stringify(m), id)
    return true
  }

  // ---- checkpoints ----
  listCheckpoints(universeId: string): CheckpointMeta[] {
    return (this.db.prepare('SELECT meta FROM checkpoints WHERE universe_id = ?').all(universeId) as { meta: string }[]).map((r) => JSON.parse(r.meta)).sort((a, b) => a.tick - b.tick)
  }
  saveCheckpoint(cp: CheckpointMeta, state: string): CheckpointMeta {
    deserializeWorld(state)
    this.db.prepare('INSERT OR REPLACE INTO checkpoints (id, universe_id, meta, data) VALUES (?, ?, ?, ?)').run(cp.id, cp.universeId, JSON.stringify(cp), gzipSync(Buffer.from(state, 'utf8')))
    return cp
  }
  loadCheckpoint(id: string): string | null {
    const row = this.db.prepare('SELECT data FROM checkpoints WHERE id = ?').get(id) as { data?: Uint8Array } | undefined
    if (!row?.data) return null
    const text = gunzipSync(Buffer.from(row.data)).toString('utf8')
    deserializeWorld(text)
    return text
  }
  removeCheckpoint(id: string): void {
    this.db.prepare('DELETE FROM checkpoints WHERE id = ?').run(id)
  }

  // ---- atlas ----
  listAtlas(): AtlasEntry[] {
    return (this.db.prepare('SELECT entry FROM atlas').all() as { entry: string }[]).map((r) => JSON.parse(r.entry)).sort((a, b) => a.firstAt - b.firstAt)
  }
  recordAtlas(e: AtlasEntry): { entry: AtlasEntry; isNew: boolean } {
    return this.tx(() => {
      const row = this.db.prepare('SELECT entry FROM atlas WHERE id = ?').get(e.id) as { entry?: string } | undefined
      if (row?.entry) {
        const prev = JSON.parse(row.entry) as AtlasEntry
        const next = { ...prev, count: prev.count + 1 }
        this.db.prepare('UPDATE atlas SET entry = ? WHERE id = ?').run(JSON.stringify(next), e.id)
        return { entry: next, isNew: false }
      }
      this.db.prepare('INSERT INTO atlas (id, entry) VALUES (?, ?)').run(e.id, JSON.stringify(e))
      return { entry: e, isNew: true }
    })
  }
  updateAtlas(id: string, patch: Partial<AtlasEntry>): AtlasEntry | null {
    const row = this.db.prepare('SELECT entry FROM atlas WHERE id = ?').get(id) as { entry?: string } | undefined
    if (!row?.entry) return null
    const next = { ...JSON.parse(row.entry), ...patch }
    this.db.prepare('UPDATE atlas SET entry = ? WHERE id = ?').run(JSON.stringify(next), id)
    return next
  }

  // ---- gallery ----
  listExhibits(): Exhibit[] {
    return (this.db.prepare('SELECT meta FROM exhibits').all() as { meta: string }[]).map((r) => JSON.parse(r.meta)).sort((a, b) => b.created - a.created)
  }
  saveExhibit(e: Exhibit, state: string): Exhibit {
    deserializeWorld(state)
    this.db.prepare('INSERT OR REPLACE INTO exhibits (id, meta, data) VALUES (?, ?, ?)').run(e.id, JSON.stringify(e), gzipSync(Buffer.from(state, 'utf8')))
    return e
  }
  loadExhibit(id: string): { exhibit: Exhibit; state: string } | null {
    const row = this.db.prepare('SELECT meta, data FROM exhibits WHERE id = ?').get(id) as { meta?: string; data?: Uint8Array } | undefined
    if (!row?.meta || !row.data) return null
    return { exhibit: JSON.parse(row.meta), state: gunzipSync(Buffer.from(row.data)).toString('utf8') }
  }
  updateExhibit(id: string, patch: Partial<Exhibit>): Exhibit | null {
    const row = this.db.prepare('SELECT meta FROM exhibits WHERE id = ?').get(id) as { meta?: string } | undefined
    if (!row?.meta) return null
    const next = { ...JSON.parse(row.meta), ...patch }
    this.db.prepare('UPDATE exhibits SET meta = ? WHERE id = ?').run(JSON.stringify(next), id)
    return next
  }
  removeExhibit(id: string): void {
    this.db.prepare('DELETE FROM exhibits WHERE id = ?').run(id)
  }

  // ---- chambers ----
  chamberProgress(): Record<string, ChamberProgress> {
    const out: Record<string, ChamberProgress> = {}
    for (const r of this.db.prepare('SELECT id, progress FROM chambers').all() as { id: string; progress: string }[]) out[r.id] = JSON.parse(r.progress)
    return out
  }
  recordChamber(id: string, solved: boolean, seconds: number | null): Record<string, ChamberProgress> {
    const p = this.chamberProgress()
    const prev = p[id] ?? { solved: false, bestSeconds: null, attempts: 0 }
    const next: ChamberProgress = {
      solved: prev.solved || solved,
      attempts: prev.attempts + (solved ? 0 : 1),
      bestSeconds: solved && seconds !== null ? (prev.bestSeconds === null ? seconds : Math.min(prev.bestSeconds, seconds)) : prev.bestSeconds
    }
    this.db.prepare('INSERT OR REPLACE INTO chambers (id, progress) VALUES (?, ?)').run(id, JSON.stringify(next))
    return { ...p, [id]: next }
  }

  // ---- AI cache ----
  cacheGet(key: string): { text: string; data: unknown; model: string } | null {
    const row = this.db.prepare('SELECT value FROM ai_cache WHERE key = ?').get(key) as { value?: string } | undefined
    return row?.value ? JSON.parse(row.value) : null
  }
  cachePut(key: string, value: { text: string; data: unknown; model: string }): void {
    this.db.prepare('INSERT OR REPLACE INTO ai_cache (key, value, created) VALUES (?, ?, ?)').run(key, JSON.stringify(value), Date.now())
  }

  close(): void {
    try {
      this.db.close()
    } catch {
      /* already closed */
    }
  }
}
