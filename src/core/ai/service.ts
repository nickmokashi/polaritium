import type { BudgetController, RejectReason } from '../budget/controller'
import { REJECT_TEXT } from '../budget/controller'
import type { RequestPlan } from '../budget/estimator'
import type { Micro } from '../budget/money'

// The only code path that sends anything to Claude. It never retries on its own, never runs
// without a budget ticket, and keeps a request's full reservation whenever it cannot be sure
// what happened to it.

export interface TransportRequest {
  model: string
  system: string
  messages: { role: 'user' | 'assistant'; text: string }[]
  maxTokens: number
  /** JSON schema for structured output, when the feature wants one. */
  schema?: Record<string, unknown>
}

export interface TransportResponse {
  text: string
  usage: unknown
  requestId: string | null
  serverDateMs: number | null
  stopReason: string | null
}

export type TransportErrorKind = 'not_sent' | 'rejected' | 'uncertain'

export class TransportError extends Error {
  constructor(
    public kind: TransportErrorKind,
    message: string,
    public status?: number,
    public serverDateMs?: number | null
  ) {
    super(message)
  }
}

/** Sends exactly one HTTP request per call. Implementations must not retry. */
export interface AiTransport {
  send(req: TransportRequest, signal: AbortSignal): Promise<TransportResponse>
}

/** Supplies a trusted "now": the server's date plus the monotonic time since it was seen. */
export interface TrustedClock {
  now(): number | null
  /** Obtains a trusted time if none is held (a free request with no key). */
  ensure(): Promise<number | null>
  observe(serverMs: number | null | undefined): void
}

export interface AiCache {
  get(key: string): { text: string; data: unknown; model: string } | null
  put(key: string, value: { text: string; data: unknown; model: string }): void
}

export interface FeatureSpec<I = unknown> {
  id: string
  /** Build the request. Must stay small: structured summaries, never whole histories. */
  build(input: I, model: string): { system: string; user: string; maxTokens: number; schema?: Record<string, unknown> }
  /** Validate and shape the reply. Return null if the reply is unusable. */
  parse(text: string): unknown | null
  /** What the player sees with no AI: local, deterministic, never empty. */
  local(input: I): string
  /** Prefer the deeper model when the player asked for a deep reading and it is allowed. */
  deep?: boolean
}

export type AiOutcome =
  | { ok: true; text: string; data: unknown; cached: boolean; cost: Micro; model: string; requestId: string | null }
  | { ok: false; reason: RejectReason | 'failed' | 'invalid_response' | 'refused' | 'cancelled'; detail: string; fallback: string; charged: boolean }

export interface RunContext {
  userInitiated: boolean
  enrich?: boolean
  deep?: boolean
}

export function cacheKey(feature: string, model: string, input: unknown): string {
  return `${feature}|${model}|${stableStringify(input)}`
}

export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v)
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`
  const keys = Object.keys(v as object).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(',')}}`
}

export class AiService {
  private controllers = new Set<AbortController>()
  private features = new Map<string, FeatureSpec<any>>()

  constructor(
    private budget: BudgetController,
    private transport: AiTransport,
    private clock: TrustedClock,
    private deps: { keyPresent: () => boolean; sessionId: string; cache?: AiCache; timeoutMs?: number }
  ) {}

  register(spec: FeatureSpec<any>): void {
    this.features.set(spec.id, spec)
  }

  feature(id: string): FeatureSpec<any> | undefined {
    return this.features.get(id)
  }

  /** Switching AI off stops new requests at once and cancels what is on its way. */
  cancelAll(): void {
    for (const c of this.controllers) c.abort()
    this.controllers.clear()
  }

  async run<I>(featureId: string, input: I, ctx: RunContext): Promise<AiOutcome> {
    const spec = this.features.get(featureId) as FeatureSpec<I> | undefined
    if (!spec) throw new Error(`Unknown AI feature ${featureId}`)
    const fallback = safeLocal(spec, input)
    const settings = this.budget.getSettings()
    if (!settings.aiEnabled) return { ok: false, reason: 'ai_off', detail: REJECT_TEXT.ai_off, fallback, charged: false }

    const model = ctx.deep && spec.deep && settings.allowDeep ? settings.deepModel : settings.lightModel
    const key = cacheKey(spec.id, model, input)
    const hit = this.deps.cache?.get(key)
    if (hit) return { ok: true, text: hit.text, data: hit.data, cached: true, cost: 0, model: hit.model, requestId: null }

    const built = spec.build(input, model)
    const plan: RequestPlan = {
      feature: spec.id,
      model,
      system: built.system,
      messages: [{ role: 'user', text: built.user }],
      schemaText: built.schema ? JSON.stringify(built.schema) : undefined,
      maxOutputTokens: built.maxTokens
    }

    let trusted = this.clock.now()
    if (trusted === null && settings.aiEnabled && this.deps.keyPresent()) trusted = await this.clock.ensure()

    const admitted = this.budget.admit(plan, {
      trustedNow: trusted,
      sessionId: this.deps.sessionId,
      keyPresent: this.deps.keyPresent(),
      userInitiated: ctx.userInitiated,
      enrich: ctx.enrich
    })
    if (!admitted.ok) return { ok: false, reason: admitted.reason, detail: admitted.detail, fallback, charged: false }
    const ticket = admitted.ticket

    const ac = new AbortController()
    this.controllers.add(ac)
    const timer = setTimeout(() => ac.abort(), this.deps.timeoutMs ?? 45_000)
    // A request that was cancelled before it left keeps nothing.
    if (!this.budget.getSettings().aiEnabled) {
      clearTimeout(timer)
      this.controllers.delete(ac)
      this.budget.release(ticket.entryId, 'AI was switched off before sending.')
      return { ok: false, reason: 'cancelled', detail: 'AI was switched off.', fallback, charged: false }
    }
    try {
      this.budget.markSent(ticket.entryId)
    } catch {
      clearTimeout(timer)
      this.controllers.delete(ac)
      this.budget.release(ticket.entryId, 'Could not record the send, so nothing was sent.')
      return { ok: false, reason: 'persist_failed', detail: REJECT_TEXT.persist_failed, fallback, charged: false }
    }

    let res: TransportResponse
    try {
      res = await this.transport.send(
        { model, system: built.system, messages: plan.messages, maxTokens: ticket.maxOutputTokens, schema: built.schema },
        ac.signal
      )
    } catch (err) {
      clearTimeout(timer)
      this.controllers.delete(ac)
      const te = err instanceof TransportError ? err : null
      if (te?.serverDateMs) this.clock.observe(te.serverDateMs)
      if (te && (te.kind === 'not_sent' || te.kind === 'rejected')) {
        this.budget.release(ticket.entryId, te.kind === 'not_sent' ? 'Not sent.' : `Refused by the API (${te.status ?? 'error'}); not billed.`)
        return { ok: false, reason: 'failed', detail: te.message, fallback, charged: false }
      }
      const cancelled = ac.signal.aborted
      this.budget.markUncertain(
        ticket.entryId,
        cancelled ? 'Cancelled after sending; kept at its full reservation.' : `No reliable answer (${(err as Error)?.message ?? 'error'}); kept at its full reservation.`
      )
      return {
        ok: false,
        reason: cancelled ? 'cancelled' : 'failed',
        detail: cancelled ? 'The request was cancelled. Its full reserved cost stays counted, in case it was billed.' : 'Claude could not be reached. Its full reserved cost stays counted, in case it was billed.',
        fallback,
        charged: true
      }
    }
    clearTimeout(timer)
    this.controllers.delete(ac)
    this.clock.observe(res.serverDateMs)
    const entry = this.budget.reconcile(ticket.entryId, res.usage, res.requestId)
    const cost = entry.status === 'reconciled' ? (entry.actual ?? entry.reserved) : entry.reserved
    if (res.stopReason === 'refusal') {
      return { ok: false, reason: 'refused', detail: 'Claude declined this one.', fallback, charged: true }
    }
    const data = spec.parse(res.text)
    if (data === null) return { ok: false, reason: 'invalid_response', detail: 'Claude’s reply could not be read, so the local reading is shown.', fallback, charged: true }
    const text = typeof (data as { text?: unknown })?.text === 'string' ? (data as { text: string }).text : res.text
    this.deps.cache?.put(key, { text, data, model })
    return { ok: true, text, data, cached: false, cost, model, requestId: res.requestId }
  }
}

function safeLocal<I>(spec: FeatureSpec<I>, input: I): string {
  try {
    const t = spec.local(input)
    return t && t.trim() ? t : 'The local reading has nothing to add here yet.'
  } catch {
    return 'The local reading has nothing to add here yet.'
  }
}

/** A clock that trusts nothing until the server has spoken, then runs forward on monotonic time. */
export class ServerAnchoredClock implements TrustedClock {
  private anchor: { server: number; mono: number } | null = null
  constructor(
    private mono: () => number,
    private fetchServerDate: () => Promise<number | null>,
    private maxAgeMs = 6 * 3600_000
  ) {}
  now(): number | null {
    if (!this.anchor) return null
    const elapsed = this.mono() - this.anchor.mono
    if (elapsed < 0 || elapsed > this.maxAgeMs) return null
    return this.anchor.server + elapsed
  }
  async ensure(): Promise<number | null> {
    const n = this.now()
    if (n !== null) return n
    try {
      const d = await this.fetchServerDate()
      this.observe(d)
    } catch {
      /* offline: stays unknown, and paid requests stay blocked */
    }
    return this.now()
  }
  observe(serverMs: number | null | undefined): void {
    if (typeof serverMs === 'number' && Number.isFinite(serverMs) && serverMs > 1_600_000_000_000) {
      this.anchor = { server: serverMs, mono: this.mono() }
    }
  }
}
