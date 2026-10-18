import type { Bridge, ChamberProgress, CheckpointMeta, Exhibit, UniverseMeta, AiStatus } from '@core/app/bridge'
import { DOC_LINKS } from '@core/app/bridge'
import type { AtlasEntry } from '@core/app/atlas'
import { defaultSettings, normalizeSettings, type Settings } from '@core/app/settings'
import { BudgetController, MemoryBudgetStore, defaultSettings as budgetDefaults, ledgerCsv } from '@core/budget/controller'
import { AiService, type TrustedClock } from '@core/ai/service'
import { ALL_FEATURES } from '@core/ai/features'
import { MockTransport } from '@core/ai/mock'
import { deserializeWorld } from '@core/sim/serialize'

// The browser preview's storage: IndexedDB for worlds and exhibits, local storage for small
// things. Real AI is never available in a browser (the key would have to live in the page).
// With ?mockai=1 the full budget controller runs against a pretend Claude, for testing.

const DB_NAME = 'polaritium'
const STORES = ['universes', 'states', 'checkpoints', 'cpstates', 'atlas', 'exhibits', 'exstates', 'kv']

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

let dbp: Promise<IDBDatabase> | null = null
const db = () => (dbp ??= openDb())

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  const d = await db()
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode)
    const s = t.objectStore(store)
    const r = fn(s)
    let value: T
    if (r) r.onsuccess = () => (value = r.result)
    t.oncomplete = () => resolve(value)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
}

const get = <T>(store: string, key: string) => tx<T>(store, 'readonly', (s) => s.get(key) as IDBRequest<T>)
const put = (store: string, key: string, value: unknown) => tx(store, 'readwrite', (s) => void s.put(value, key))
const del = (store: string, key: string) => tx(store, 'readwrite', (s) => void s.delete(key))
const all = <T>(store: string) => tx<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>)

function download(name: string, data: string, type: string): void {
  const a = document.createElement('a')
  a.href = data.startsWith('data:') ? data : URL.createObjectURL(new Blob([data], { type }))
  a.download = name
  a.click()
}

export function createWebBridge(): Bridge {
  const mock = new URLSearchParams(location.search).has('mockai')
  const budgetStore = new MemoryBudgetStore()
  budgetStore.settings = budgetDefaults()
  const budget = new BudgetController(budgetStore, () => null)
  const clock: TrustedClock = { now: () => Date.now(), ensure: async () => Date.now(), observe: () => {} }
  const ai = new AiService(budget, new MockTransport(), clock, { keyPresent: () => mock, sessionId: `web-${Date.now()}` })
  for (const f of ALL_FEATURES) ai.register(f)

  const status = (): AiStatus => {
    const s = budget.getSettings()
    return {
      available: mock,
      enabled: mock && s.aiEnabled,
      keyPresent: mock,
      mock,
      lightModel: s.lightModel,
      deepModel: s.deepModel,
      allowDeep: s.allowDeep,
      note: mock ? 'Test mode: replies come from a pretend Claude and cost nothing.' : 'The AI features need the desktop version, built from the open code on GitHub. Everything else works here.'
    }
  }

  const bridge: Bridge = {
    kind: 'web',
    version: '1.0.0',
    settings: {
      async get() {
        try {
          return normalizeSettings(JSON.parse(localStorage.getItem('polaritium.settings') ?? 'null'))
        } catch {
          return defaultSettings()
        }
      },
      async set(s: Settings) {
        const n = normalizeSettings(s)
        try {
          localStorage.setItem('polaritium.settings', JSON.stringify(n))
        } catch {
          /* storage may be unavailable */
        }
        return n
      }
    },
    universes: {
      async list() {
        return ((await all<UniverseMeta>('universes')) ?? []).sort((a, b) => b.updated - a.updated)
      },
      async save(meta, state) {
        try {
          deserializeWorld(state)
          await put('states', meta.id, state)
          const m = { ...meta, updated: Date.now() }
          await put('universes', meta.id, m)
          return { ok: true, value: m }
        } catch (e) {
          return { ok: false, error: (e as Error).message }
        }
      },
      async load(id) {
        const meta = await get<UniverseMeta>('universes', id)
        const state = await get<string>('states', id)
        if (!meta || !state) return { ok: false, error: 'That universe could not be found.' }
        try {
          deserializeWorld(state)
        } catch (e) {
          return { ok: false, error: (e as Error).message }
        }
        return { ok: true, value: { meta, state } }
      },
      async remove(id) {
        await del('universes', id)
        await del('states', id)
        return true
      },
      async rename(id, name) {
        const m = await get<UniverseMeta>('universes', id)
        if (!m) return false
        await put('universes', id, { ...m, name })
        return true
      },
      async checkpoints(universeId) {
        return ((await all<CheckpointMeta>('checkpoints')) ?? []).filter((c) => c.universeId === universeId).sort((a, b) => a.tick - b.tick)
      },
      async saveCheckpoint(cp, state) {
        await put('cpstates', cp.id, state)
        await put('checkpoints', cp.id, cp)
        return { ok: true, value: cp }
      },
      async loadCheckpoint(id) {
        const s = await get<string>('cpstates', id)
        return s ? { ok: true, value: s } : { ok: false, error: 'That checkpoint could not be found.' }
      },
      async removeCheckpoint(id) {
        await del('checkpoints', id)
        await del('cpstates', id)
        return true
      },
      async exportFile(id) {
        const r = await bridge.universes.load(id)
        if (!r.ok || !r.value) return { ok: false, error: r.error }
        const cps = await bridge.universes.checkpoints(id)
        const states: Record<string, string> = {}
        for (const c of cps) states[c.id] = (await get<string>('cpstates', c.id)) ?? ''
        download(`${r.value.meta.name}.polaritium`, JSON.stringify({ format: 'polaritium-universe', version: 1, meta: r.value.meta, state: r.value.state, checkpoints: cps, checkpointStates: states }), 'application/json')
        return { ok: true, value: 'downloaded' }
      },
      async importFile() {
        return { ok: false, error: 'Importing is available in the desktop app.' }
      }
    },
    atlas: {
      async list() {
        return ((await all<AtlasEntry>('atlas')) ?? []).sort((a, b) => a.firstAt - b.firstAt)
      },
      async record(e) {
        const prev = await get<AtlasEntry>('atlas', e.id)
        if (prev) {
          const next = { ...prev, count: prev.count + 1 }
          await put('atlas', e.id, next)
          return { entry: next, isNew: false }
        }
        await put('atlas', e.id, e)
        return { entry: e, isNew: true }
      },
      async update(id, patch) {
        const prev = await get<AtlasEntry>('atlas', id)
        if (!prev) return null
        const next = { ...prev, ...patch }
        await put('atlas', id, next)
        return next
      }
    },
    gallery: {
      async list() {
        return ((await all<Exhibit>('exhibits')) ?? []).sort((a, b) => b.created - a.created)
      },
      async save(e, state) {
        await put('exstates', e.id, state)
        await put('exhibits', e.id, e)
        return { ok: true, value: e }
      },
      async load(id) {
        const e = await get<Exhibit>('exhibits', id)
        const s = await get<string>('exstates', id)
        return e && s ? { ok: true, value: { exhibit: e, state: s } } : { ok: false, error: 'That exhibit could not be found.' }
      },
      async update(id, patch) {
        const prev = await get<Exhibit>('exhibits', id)
        if (!prev) return null
        const next = { ...prev, ...patch }
        await put('exhibits', id, next)
        return next
      },
      async remove(id) {
        await del('exhibits', id)
        await del('exstates', id)
        return true
      }
    },
    chambers: {
      async progress() {
        return ((await get<Record<string, ChamberProgress>>('kv', 'chambers')) ?? {}) as Record<string, ChamberProgress>
      },
      async record(id, solved, seconds) {
        const p = ((await get<Record<string, ChamberProgress>>('kv', 'chambers')) ?? {}) as Record<string, ChamberProgress>
        const prev = p[id] ?? { solved: false, bestSeconds: null, attempts: 0 }
        p[id] = {
          solved: prev.solved || solved,
          attempts: prev.attempts + (solved ? 0 : 1),
          bestSeconds: solved && seconds !== null ? (prev.bestSeconds === null ? seconds : Math.min(prev.bestSeconds, seconds)) : prev.bestSeconds
        }
        await put('kv', 'chambers', p)
        return p
      }
    },
    files: {
      async saveImage(dataUrl, name) {
        download(name, dataUrl, 'image/png')
        return { ok: true, value: name }
      },
      async saveText(text, name) {
        download(name, text, 'text/plain')
        return { ok: true, value: name }
      },
      async openSavesFolder() {
        return false
      }
    },
    ai: {
      async status() {
        return status()
      },
      async setEnabled(on) {
        if (!mock) return status()
        budget.setEnabled(on)
        if (!on) ai.cancelAll()
        return status()
      },
      async setKey() {
        return { ok: false, error: 'Keys can only be saved in the desktop app.' }
      },
      async clearKey() {
        return status()
      },
      async checkKey() {
        return { ok: mock, message: mock ? 'Test mode: no real key is used.' : 'Available in the desktop app.' }
      },
      async run(feature, input, ctx) {
        return ai.run(feature, input, ctx)
      },
      async cancel() {
        ai.cancelAll()
      },
      budget: {
        async view() {
          return budget.view(Date.now(), 'web')
        },
        async propose(req) {
          return budget.proposeChange(req)
        },
        async confirm(token) {
          return budget.confirmChange(token)
        },
        async ledger(limit) {
          return budget.ledger(limit)
        },
        async exportCsv() {
          download('polaritium-ai-ledger.csv', ledgerCsv(budget.ledger(10000)), 'text/csv')
          return { ok: true, value: 'downloaded' }
        }
      },
      registry: {
        async get() {
          const { BUNDLED_REGISTRY } = await import('@core/budget/pricing')
          return { bundled: BUNDLED_REGISTRY, user: null }
        },
        async set() {
          return { ok: false, error: 'Available in the desktop app.' }
        }
      }
    },
    app: {
      async quit() {
        window.close()
      },
      async setFullscreen(on) {
        try {
          if (on) await document.documentElement.requestFullscreen()
          else if (document.fullscreenElement) await document.exitFullscreen()
        } catch {
          /* not allowed here */
        }
        return !!document.fullscreenElement
      },
      async openLink(which) {
        window.open(DOC_LINKS[which], '_blank', 'noopener')
      },
      async isSelftest() {
        return false
      }
    }
  }
  return bridge
}
