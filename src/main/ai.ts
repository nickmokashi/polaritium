import Anthropic from '@anthropic-ai/sdk'
import { app, net, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { ALL_FEATURES } from '@core/ai/features'
import { MockTransport } from '@core/ai/mock'
import { AiService, ServerAnchoredClock, TransportError, type AiTransport, type TransportRequest, type TransportResponse } from '@core/ai/service'
import { BudgetController, ledgerCsv, type BudgetPersistence, type BudgetSettings, type BudgetWriter, type ClockState, type LedgerEntry, type Rejection } from '@core/budget/controller'
import { BUNDLED_REGISTRY, validateUserRegistry, type ModelRegistry } from '@core/budget/pricing'
import type { AiStatus } from '@core/app/bridge'
import type { Store } from './db'

// The privileged side of the optional AI layer. The key lives here, encrypted by Windows
// (DPAPI through Electron's safeStorage) and is never sent to the game window. Every request
// goes through the budget controller, then through exactly one HTTP call with retries off.

const MOCK = process.env.POLARITIUM_AI_MOCK === '1'
const API_HOST = 'https://api.anthropic.com'

class SqliteBudgetStore implements BudgetPersistence {
  constructor(private store: Store) {}
  load() {
    const db = this.store.db
    const get = (k: string) => (db.prepare('SELECT value FROM budget WHERE key = ?').get(k) as { value?: string } | undefined)?.value
    const s = get('settings')
    const c = get('clock')
    const entries = (db.prepare('SELECT entry FROM ledger ORDER BY created').all() as { entry: string }[]).map((r) => JSON.parse(r.entry) as LedgerEntry)
    const rejections = (db.prepare('SELECT entry FROM rejections ORDER BY at DESC LIMIT 200').all() as { entry: string }[]).map((r) => JSON.parse(r.entry) as Rejection).reverse()
    return { settings: s ? (JSON.parse(s) as BudgetSettings) : null, clock: c ? (JSON.parse(c) as ClockState) : null, entries, rejections }
  }
  transaction(fn: (w: BudgetWriter) => void): void {
    const db = this.store.db
    this.store.tx(() =>
      fn({
        putSettings: (s) => db.prepare("INSERT OR REPLACE INTO budget (key, value) VALUES ('settings', ?)").run(JSON.stringify(s)),
        putClock: (c) => db.prepare("INSERT OR REPLACE INTO budget (key, value) VALUES ('clock', ?)").run(JSON.stringify(c)),
        putEntry: (e) => db.prepare('INSERT OR REPLACE INTO ledger (id, entry, created) VALUES (?, ?, ?)').run(e.id, JSON.stringify(e), e.createdAt),
        putRejection: (r) => db.prepare('INSERT INTO rejections (at, entry) VALUES (?, ?)').run(r.at, JSON.stringify(r))
      })
    )
  }
}

class KeyStore {
  private file: string
  constructor() {
    const dir = join(app.getPath('userData'), 'secrets')
    mkdirSync(dir, { recursive: true })
    this.file = join(dir, 'claude.key.bin')
  }
  present(): boolean {
    return MOCK || existsSync(this.file)
  }
  get(): string | null {
    if (!existsSync(this.file)) return null
    try {
      return safeStorage.decryptString(readFileSync(this.file))
    } catch {
      return null
    }
  }
  set(key: string): { ok: boolean; error?: string } {
    if (!/^sk-ant-[A-Za-z0-9_\-]{20,}$/.test(key)) return { ok: false, error: 'That does not look like a Claude API key (they begin with sk-ant-).' }
    if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'Windows key protection is not available, so the key was not saved.' }
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, safeStorage.encryptString(key))
    renameSync(tmp, this.file)
    return { ok: true }
  }
  clear(): void {
    rmSync(this.file, { force: true })
  }
}

/** The one real sender: a single request, no retries, server date read from the response. */
class AnthropicTransport implements AiTransport {
  constructor(private keys: KeyStore) {}
  async send(req: TransportRequest, signal: AbortSignal): Promise<TransportResponse> {
    const key = this.keys.get()
    if (!key) throw new TransportError('not_sent', 'No key is saved.')
    const client = new Anthropic({ apiKey: key, maxRetries: 0, timeout: 45_000 })
    const isHaiku = req.model.includes('haiku')
    const body: Anthropic.MessageCreateParamsNonStreaming = {
      model: req.model,
      max_tokens: req.maxTokens,
      system: req.system,
      messages: req.messages.map((m) => ({ role: m.role, content: m.text })),
      thinking: isHaiku ? { type: 'disabled' } : { type: 'between_tools' },
      output_config: { effort: 'low', ...(req.schema ? { format: { type: 'json_schema', schema: req.schema } } : {}) }
    }
    try {
      const { data, response } = await client.messages.create(body, { signal }).withResponse()
      const text = data.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
      const date = response.headers.get('date')
      return { text, usage: data.usage, requestId: response.headers.get('request-id'), serverDateMs: date ? Date.parse(date) : null, stopReason: data.stop_reason }
    } catch (err) {
      if (err instanceof Anthropic.APIUserAbortError) throw new TransportError('uncertain', 'Cancelled after sending.')
      if (err instanceof Anthropic.APIConnectionTimeoutError) throw new TransportError('uncertain', 'Timed out.')
      if (err instanceof Anthropic.APIConnectionError) throw new TransportError('uncertain', 'Could not reach Claude.')
      if (err instanceof Anthropic.APIError) {
        const status = err.status ?? 0
        const date = (err.headers as Headers | undefined)?.get?.('date')
        // A definite refusal before processing is not billed; server errors may have been.
        if (status >= 400 && status < 500 && status !== 408) throw new TransportError('rejected', `Claude refused the request (${status}).`, status, date ? Date.parse(date) : null)
        throw new TransportError('uncertain', `Claude had a problem (${status}).`, status, date ? Date.parse(date) : null)
      }
      throw new TransportError('uncertain', (err as Error)?.message ?? 'Unknown problem.')
    }
  }
}

/** A free request (no key, no tokens) whose only purpose is the server's Date header. */
async function serverDate(): Promise<number | null> {
  try {
    const r = await net.fetch(`${API_HOST}/`, { method: 'HEAD', cache: 'no-store' })
    const d = r.headers.get('date')
    return d ? Date.parse(d) : null
  } catch {
    return null
  }
}

export class AiMain {
  budget: BudgetController
  service: AiService
  keys = new KeyStore()
  private userRegistry: ModelRegistry | null = null
  private registryFile = join(app.getPath('userData'), 'model-prices.json')
  readonly sessionId = `s-${Date.now().toString(36)}`

  constructor(private store: Store) {
    try {
      if (existsSync(this.registryFile)) this.userRegistry = validateUserRegistry(JSON.parse(readFileSync(this.registryFile, 'utf8')))
    } catch {
      this.userRegistry = null
    }
    this.budget = new BudgetController(new SqliteBudgetStore(store), () => this.userRegistry)
    const clock = MOCK ? { now: () => Date.now(), ensure: async () => Date.now(), observe: () => {} } : new ServerAnchoredClock(() => performance.now(), serverDate)
    const transport: AiTransport = MOCK ? new MockTransport() : new AnthropicTransport(this.keys)
    this.service = new AiService(this.budget, transport, clock, {
      keyPresent: () => this.keys.present(),
      sessionId: this.sessionId,
      cache: { get: (k) => store.cacheGet(k), put: (k, v) => store.cachePut(k, v) }
    })
    for (const f of ALL_FEATURES) this.service.register(f)
  }

  status(): AiStatus {
    const s = this.budget.getSettings()
    return {
      available: true,
      enabled: s.aiEnabled,
      keyPresent: this.keys.present(),
      mock: MOCK,
      lightModel: s.lightModel,
      deepModel: s.deepModel,
      allowDeep: s.allowDeep,
      note: s.aiEnabled ? 'AI is on.' : 'AI is off. Switch it on in Settings, AI.'
    }
  }

  setEnabled(on: boolean): AiStatus {
    if (on && !this.keys.present()) return this.status()
    this.budget.setEnabled(on)
    if (!on) this.service.cancelAll()
    return this.status()
  }

  setKey(key: string) {
    return this.keys.set(key)
  }

  clearKey(): AiStatus {
    this.service.cancelAll()
    this.budget.setEnabled(false)
    this.keys.clear()
    return this.status()
  }

  /** Lists the models the key can use. Free: it uses no tokens. */
  async checkKey(): Promise<{ ok: boolean; message: string }> {
    if (MOCK) return { ok: true, message: 'Test mode: no real key is used.' }
    const key = this.keys.get()
    if (!key) return { ok: false, message: 'No key is saved.' }
    try {
      const client = new Anthropic({ apiKey: key, maxRetries: 0, timeout: 20_000 })
      const page = await client.models.list({ limit: 50 })
      const ids = page.data.map((m) => m.id)
      const s = this.budget.getSettings()
      const missing = [s.lightModel, s.deepModel].filter((m) => !ids.includes(m))
      return { ok: true, message: missing.length ? `The key works, but it cannot use: ${missing.join(', ')}.` : 'The key works, and can use the models Polaritium needs.' }
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) return { ok: false, message: 'Anthropic did not accept this key.' }
      return { ok: false, message: 'Could not reach Anthropic to check the key.' }
    }
  }

  ledgerCsv(): string {
    return ledgerCsv(this.budget.ledger(100_000))
  }

  registry(): { bundled: ModelRegistry; user: ModelRegistry | null } {
    return { bundled: BUNDLED_REGISTRY, user: this.userRegistry }
  }

  setRegistry(reg: ModelRegistry | null): { ok: boolean; error?: string } {
    try {
      if (reg === null) {
        rmSync(this.registryFile, { force: true })
        this.userRegistry = null
        return { ok: true }
      }
      const v = validateUserRegistry(reg)
      writeFileSync(this.registryFile, JSON.stringify(v, null, 2))
      this.userRegistry = v
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  }
}
