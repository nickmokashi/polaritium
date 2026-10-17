import { assertMicro, formatUsd, isMicro, usd, type Micro } from './money'
import { effectivePrice, type ModelRegistry } from './pricing'
import { MAX_INPUT_TOKENS, MAX_OUTPUT_TOKENS_CAP, actualCost, isCompleteUsage, maxRequestCost, type RequestPlan, type Usage } from './estimator'
import { laterPeriod, localTimeZone, nextMonthStart, periodOf, type Period } from './period'

// THE ONE DOOR TO THE PAID API.
//
// Every Claude request in Polaritium must be admitted here first. Admission is synchronous:
// it checks every limit, reserves the most the request could cost, and commits that
// reservation durably before it returns. Nothing is transmitted without a ticket.
// Because admission never awaits, two requests can never both pass the same check.

export interface BudgetLimits {
  monthly: Micro
  daily: Micro
  session: Micro
  perRequest: Micro
  /** Separate, smaller allowance for the optional automatic enrichment feature. */
  enrichMonthly: Micro
}

export interface BudgetSettings {
  limits: BudgetLimits
  aiEnabled: boolean
  /** Allows the deeper (more expensive) model for player-requested deep readings. */
  allowDeep: boolean
  /** Opus, Fable and similar. Off, and nothing in the game turns it on by itself. */
  allowPremium: boolean
  autoEnrich: boolean
  timezone: string
  lightModel: string
  deepModel: string
}

export const DEFAULT_LIMITS: BudgetLimits = {
  monthly: usd(10),
  daily: usd(0.75),
  session: usd(0.5),
  perRequest: usd(0.05),
  enrichMonthly: usd(1)
}

export const MAX_MONTHLY: Micro = usd(1000)
export const MAX_PER_REQUEST: Micro = usd(1)
export const PRESETS: { label: string; monthly: Micro }[] = [
  { label: 'Off ($0)', monthly: 0 },
  { label: 'Minimal ($5)', monthly: usd(5) },
  { label: 'Default ($10)', monthly: usd(10) },
  { label: 'Expanded ($20)', monthly: usd(20) },
  { label: 'Higher ($30)', monthly: usd(30) },
  { label: 'High ($50)', monthly: usd(50) }
]

export function defaultSettings(timezone = localTimeZone()): BudgetSettings {
  return {
    limits: { ...DEFAULT_LIMITS },
    aiEnabled: false,
    allowDeep: false,
    allowPremium: false,
    autoEnrich: false,
    timezone,
    lightModel: 'claude-haiku-5-5',
    deepModel: 'claude-sonnet-5-5'
  }
}

export type EntryStatus = 'reserved' | 'sent' | 'reconciled' | 'uncertain' | 'released'

export interface LedgerEntry {
  id: string
  feature: string
  model: string
  createdAt: number
  month: string
  day: string
  sessionId: string
  enrich: boolean
  reserved: Micro
  actual: Micro | null
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number | null
  requestId: string | null
  status: EntryStatus
  note: string | null
}

export interface ClockState {
  period: Period
  /** Latest trusted instant ever used for accounting. */
  trustedMs: number
}

export type RejectReason =
  | 'ai_off'
  | 'no_key'
  | 'not_user_initiated'
  | 'busy'
  | 'clock_unverified'
  | 'unknown_price'
  | 'model_not_allowed'
  | 'too_large'
  | 'output_cap'
  | 'over_request_cap'
  | 'monthly_limit'
  | 'daily_limit'
  | 'session_limit'
  | 'enrich_off'
  | 'enrich_limit'
  | 'persist_failed'

export const REJECT_TEXT: Record<RejectReason, string> = {
  ai_off: 'AI is switched off.',
  no_key: 'No Claude key is saved.',
  not_user_initiated: 'Paid requests only run when you ask for them.',
  busy: 'Another request is still on its way. One at a time.',
  clock_unverified: 'Could not confirm today’s date with Anthropic, so the budget cannot be checked. Try again when online.',
  unknown_price: 'This model has no verified price, so it is blocked.',
  model_not_allowed: 'That model is not allowed in your AI settings.',
  too_large: 'This request would be too large.',
  output_cap: 'This request asks for a longer answer than the game allows.',
  over_request_cap: 'This request could cost more than your per-request ceiling.',
  monthly_limit: 'This month’s AI allowance is used up. The game carries on without AI.',
  daily_limit: 'Today’s AI allowance is used up. It renews tomorrow.',
  session_limit: 'This session’s AI allowance is used up. It renews next time you start the game.',
  enrich_off: 'Automatic enrichment is switched off.',
  enrich_limit: 'The automatic enrichment allowance is used up.',
  persist_failed: 'The spending record could not be saved, so nothing was sent.'
}

export interface Rejection {
  at: number
  feature: string
  reason: RejectReason
  detail: string
}

export interface BudgetPersistence {
  load(): { settings: BudgetSettings | null; clock: ClockState | null; entries: LedgerEntry[]; rejections: Rejection[] }
  /** Runs fn and commits everything it wrote atomically and durably, or throws and commits nothing. */
  transaction(fn: (w: BudgetWriter) => void): void
}

export interface BudgetWriter {
  putSettings(s: BudgetSettings): void
  putClock(c: ClockState): void
  putEntry(e: LedgerEntry): void
  putRejection(r: Rejection): void
}

export interface AdmitContext {
  /** A trusted instant (server-confirmed date plus monotonic time), or null if unknown. */
  trustedNow: number | null
  sessionId: string
  keyPresent: boolean
  userInitiated: boolean
  enrich?: boolean
}

export interface Ticket {
  entryId: string
  model: string
  maxOutputTokens: number
  reserved: Micro
  inputBound: number
}

export type AdmitResult = { ok: true; ticket: Ticket } | { ok: false; reason: RejectReason; detail: string }

export interface ChangeRequest {
  limits?: Partial<BudgetLimits>
  allowDeep?: boolean
  allowPremium?: boolean
  autoEnrich?: boolean
}

export type ChangeResult =
  | { status: 'applied'; settings: BudgetSettings }
  | { status: 'needs_confirmation'; token: string; summary: string[]; from: BudgetSettings; to: BudgetSettings }
  | { status: 'deferred'; summary: string[] }
  | { status: 'rejected'; error: string }

export interface BudgetView {
  aiEnabled: boolean
  limits: BudgetLimits
  timezone: string
  month: string
  day: string
  spentMonth: Micro
  reservedNow: Micro
  uncertainMonth: Micro
  remainingMonth: Micro
  spentToday: Micro
  spentSession: Micro
  enrichSpentMonth: Micro
  totalRequests: number
  byFeature: Record<string, { requests: number; cost: Micro }>
  byModel: Record<string, { requests: number; cost: Micro }>
  lightModel: string
  deepModel: string
  allowDeep: boolean
  allowPremium: boolean
  autoEnrich: boolean
  nextReset: number
  inFlight: number
  rejections: Rejection[]
  pendingDeferred: boolean
}

const CONFIRM_TTL_MS = 10 * 60_000

function randomToken(): string {
  const a = new Uint8Array(16)
  globalThis.crypto.getRandomValues(a)
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('')
}

export class BudgetController {
  private settings: BudgetSettings
  private clock: ClockState
  private entries = new Map<string, LedgerEntry>()
  private rejections: Rejection[] = []
  private pending = new Map<string, { to: BudgetSettings; createdAt: number }>()
  private deferred: BudgetSettings | null = null
  private seq = 0
  readonly maxInFlight = 1

  constructor(
    private store: BudgetPersistence,
    private registry: () => ModelRegistry | null,
    private wallNow: () => number = () => Date.now()
  ) {
    const loaded = store.load()
    this.settings = loaded.settings ? normaliseSettings(loaded.settings) : defaultSettings()
    const now = this.wallNow()
    this.clock = loaded.clock ?? { period: periodOf(now, this.settings.timezone), trustedMs: 0 }
    for (const e of loaded.entries) this.entries.set(e.id, { ...e })
    this.rejections = loaded.rejections.slice(-200)
    // Anything left in flight by a previous run (crash, power cut) may have been billed.
    // Keep its full reservation and mark it uncertain. Never release it.
    const orphans = [...this.entries.values()].filter((e) => e.status === 'reserved' || e.status === 'sent')
    if (orphans.length || !loaded.settings || !loaded.clock) {
      this.store.transaction((w) => {
        if (!loaded.settings) w.putSettings(this.settings)
        if (!loaded.clock) w.putClock(this.clock)
        for (const e of orphans) {
          e.status = e.status === 'reserved' ? 'released' : 'uncertain'
          e.note = e.status === 'released' ? 'Never sent (the app closed first).' : 'The app closed before the answer arrived; kept at its full reservation.'
          w.putEntry(e)
        }
      })
    }
  }

  getSettings(): BudgetSettings {
    return structuredClone(this.settings)
  }

  inFlight(): number {
    let n = 0
    for (const e of this.entries.values()) if (e.status === 'reserved' || e.status === 'sent') n++
    return n
  }

  /** What one request counts against the allowance right now. */
  private committed(e: LedgerEntry): Micro {
    if (e.status === 'released') return 0
    if (e.status === 'reconciled') return e.actual ?? e.reserved
    return e.reserved // reserved, sent, uncertain
  }

  private sum(filter: (e: LedgerEntry) => boolean): Micro {
    let s = 0
    for (const e of this.entries.values()) if (filter(e)) s += this.committed(e)
    return s
  }

  private currentPeriod(trustedNow: number | null): Period {
    if (trustedNow === null) return this.clock.period
    return laterPeriod(this.clock.period, periodOf(trustedNow, this.settings.timezone))
  }

  private reject(feature: string, reason: RejectReason, now: number, extra?: string): AdmitResult {
    const r: Rejection = { at: now, feature, reason, detail: extra ? `${REJECT_TEXT[reason]} ${extra}` : REJECT_TEXT[reason] }
    this.rejections.push(r)
    if (this.rejections.length > 200) this.rejections.shift()
    try {
      this.store.transaction((w) => w.putRejection(r))
    } catch {
      /* a rejection record failing to save never matters for safety */
    }
    return { ok: false, reason, detail: r.detail }
  }

  admit(plan: RequestPlan, ctx: AdmitContext): AdmitResult {
    const now = this.wallNow()
    const s = this.settings
    const enrich = !!ctx.enrich
    if (!s.aiEnabled) return this.reject(plan.feature, 'ai_off', now)
    if (!ctx.keyPresent) return this.reject(plan.feature, 'no_key', now)
    if (enrich && !s.autoEnrich) return this.reject(plan.feature, 'enrich_off', now)
    if (!enrich && !ctx.userInitiated) return this.reject(plan.feature, 'not_user_initiated', now)
    if (this.inFlight() >= this.maxInFlight) return this.reject(plan.feature, 'busy', now)
    if (ctx.trustedNow === null || !Number.isFinite(ctx.trustedNow)) return this.reject(plan.feature, 'clock_unverified', now)

    const price = effectivePrice(plan.model, this.registry())
    if (!price) return this.reject(plan.feature, 'unknown_price', now)
    if (price.premium && !s.allowPremium) return this.reject(plan.feature, 'model_not_allowed', now)
    if (price.tier === 'deep' && !s.allowDeep) return this.reject(plan.feature, 'model_not_allowed', now)
    if (plan.model !== s.lightModel && plan.model !== s.deepModel && !(price.premium && s.allowPremium)) {
      return this.reject(plan.feature, 'model_not_allowed', now)
    }
    if (!Number.isSafeInteger(plan.maxOutputTokens) || plan.maxOutputTokens < 1 || plan.maxOutputTokens > MAX_OUTPUT_TOKENS_CAP) {
      return this.reject(plan.feature, 'output_cap', now)
    }

    const { inputBound, cost } = maxRequestCost(plan, price)
    if (inputBound > MAX_INPUT_TOKENS) return this.reject(plan.feature, 'too_large', now)
    if (cost > s.limits.perRequest) return this.reject(plan.feature, 'over_request_cap', now, `It could cost up to ${formatUsd(cost)}.`)

    const period = this.currentPeriod(ctx.trustedNow)
    const month = this.sum((e) => e.month === period.month)
    if (month + cost > s.limits.monthly) return this.reject(plan.feature, 'monthly_limit', now)
    const day = this.sum((e) => e.day === period.day)
    if (day + cost > s.limits.daily) return this.reject(plan.feature, 'daily_limit', now)
    const session = this.sum((e) => e.sessionId === ctx.sessionId)
    if (session + cost > s.limits.session) return this.reject(plan.feature, 'session_limit', now)
    if (enrich) {
      const em = this.sum((e) => e.enrich && e.month === period.month)
      if (em + cost > s.limits.enrichMonthly) return this.reject(plan.feature, 'enrich_limit', now)
    }

    const entry: LedgerEntry = {
      id: `${now.toString(36)}-${(++this.seq).toString(36)}-${randomToken().slice(0, 8)}`,
      feature: plan.feature,
      model: plan.model,
      createdAt: now,
      month: period.month,
      day: period.day,
      sessionId: ctx.sessionId,
      enrich,
      reserved: cost,
      actual: null,
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      requestId: null,
      status: 'reserved',
      note: null
    }
    const clock: ClockState = { period, trustedMs: Math.max(this.clock.trustedMs, ctx.trustedNow) }
    try {
      this.store.transaction((w) => {
        w.putClock(clock)
        w.putEntry(entry)
      })
    } catch {
      return this.reject(plan.feature, 'persist_failed', now)
    }
    this.clock = clock
    this.entries.set(entry.id, entry)
    return { ok: true, ticket: { entryId: entry.id, model: plan.model, maxOutputTokens: plan.maxOutputTokens, reserved: cost, inputBound } }
  }

  private update(id: string, patch: Partial<LedgerEntry>, allowed: EntryStatus[]): LedgerEntry {
    const e = this.entries.get(id)
    if (!e) throw new Error('Unknown ledger entry')
    if (!allowed.includes(e.status)) throw new Error(`Ledger entry is ${e.status}, cannot change`)
    const next = { ...e, ...patch }
    this.store.transaction((w) => w.putEntry(next))
    this.entries.set(id, next)
    this.applyDeferredIfIdle()
    return next
  }

  /** Called immediately before the request leaves the computer. */
  markSent(id: string): void {
    this.update(id, { status: 'sent' }, ['reserved'])
  }

  /** The request never left the computer (or was refused outright before processing): release it. */
  release(id: string, note: string): void {
    this.update(id, { status: 'released', actual: 0, note }, ['reserved', 'sent'])
  }

  /** Something went wrong after sending. Keep the whole reservation; never release it. */
  markUncertain(id: string, note: string): void {
    this.update(id, { status: 'uncertain', note }, ['reserved', 'sent'])
  }

  /** The answer arrived with usage figures: record the real cost and free the rest of the reservation. */
  reconcile(id: string, usage: unknown, requestId: string | null): LedgerEntry {
    const e = this.entries.get(id)
    if (!e) throw new Error('Unknown ledger entry')
    if (!isCompleteUsage(usage)) {
      return this.update(id, { status: 'uncertain', requestId, note: 'The answer had no usage figures; kept at its full reservation.' }, ['sent'])
    }
    const price = effectivePrice(e.model, this.registry())
    if (!price) {
      return this.update(id, { status: 'uncertain', requestId, note: 'Price unknown at reconciliation; kept at full reservation.' }, ['sent'])
    }
    const u = usage as Usage
    const cost = actualCost(u, price)
    return this.update(
      id,
      {
        status: 'reconciled',
        actual: cost,
        requestId,
        inputTokens: u.input_tokens,
        outputTokens: u.output_tokens,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
        cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
        note: cost > e.reserved ? 'Cost came in above the reservation.' : null
      },
      ['sent']
    )
  }

  setEnabled(on: boolean): BudgetSettings {
    const next = { ...this.settings, aiEnabled: on }
    if (on && this.settings.limits.monthly === 0) next.aiEnabled = false
    this.commitSettings(next)
    return this.getSettings()
  }

  setModels(light: string, deep: string): BudgetSettings {
    this.commitSettings({ ...this.settings, lightModel: light, deepModel: deep })
    return this.getSettings()
  }

  private commitSettings(next: BudgetSettings): void {
    this.store.transaction((w) => w.putSettings(next))
    this.settings = next
  }

  private validate(next: BudgetSettings): string | null {
    const l = next.limits
    for (const [k, v] of Object.entries(l)) if (!isMicro(v)) return `The ${k} limit must be a positive amount.`
    if (l.monthly > MAX_MONTHLY) return `The monthly allowance cannot be more than ${formatUsd(MAX_MONTHLY)}.`
    if (l.daily > l.monthly) return 'The daily allowance cannot be more than the monthly allowance.'
    if (l.session > l.monthly) return 'The session allowance cannot be more than the monthly allowance.'
    if (l.perRequest > MAX_PER_REQUEST) return `One request cannot be allowed more than ${formatUsd(MAX_PER_REQUEST)}.`
    if (l.monthly > 0 && l.perRequest > Math.min(l.daily, l.session)) return 'The per-request ceiling cannot be more than the daily or session allowance.'
    if (l.enrichMonthly > l.monthly) return 'The enrichment allowance must fit inside the monthly allowance.'
    return null
  }

  private describe(from: BudgetSettings, to: BudgetSettings): { lines: string[]; increase: boolean } {
    const lines: string[] = []
    let increase = false
    const names: Record<keyof BudgetLimits, string> = {
      monthly: 'Monthly allowance',
      daily: 'Daily allowance',
      session: 'Session allowance',
      perRequest: 'Most one request may cost',
      enrichMonthly: 'Automatic enrichment allowance'
    }
    for (const k of Object.keys(names) as (keyof BudgetLimits)[]) {
      const a = from.limits[k]
      const b = to.limits[k]
      if (a !== b) {
        lines.push(`${names[k]}: ${formatUsd(a, 2)} → ${formatUsd(b, 2)}`)
        if (b > a) increase = true
      }
    }
    const flag = (name: string, a: boolean, b: boolean) => {
      if (a !== b) {
        lines.push(`${name}: ${a ? 'on' : 'off'} → ${b ? 'on' : 'off'}`)
        if (b) increase = true
      }
    }
    flag('Deeper model (Sonnet) allowed', from.allowDeep, to.allowDeep)
    flag('Premium models allowed', from.allowPremium, to.allowPremium)
    flag('Automatic enrichment', from.autoEnrich, to.autoEnrich)
    if (increase && to.limits.monthly > from.limits.monthly) {
      lines.push(
        `At most ${formatUsd(to.limits.monthly, 2)} a month can now be spent by Polaritium. Your Anthropic workspace limit is separate: if it is lower, it still applies, and you would raise it yourself in the Anthropic Console.`
      )
    }
    return { lines, increase }
  }

  /**
   * The only way limits change. Decreases apply at once. Any increase (or switching on a
   * costlier option) returns a confirmation token and changes nothing until confirmChange.
   */
  proposeChange(req: ChangeRequest): ChangeResult {
    const from = this.settings
    const to: BudgetSettings = {
      ...from,
      limits: { ...from.limits, ...(req.limits ?? {}) },
      allowDeep: req.allowDeep ?? from.allowDeep,
      allowPremium: req.allowPremium ?? from.allowPremium,
      autoEnrich: req.autoEnrich ?? from.autoEnrich
    }
    for (const v of Object.values(req.limits ?? {})) {
      try {
        assertMicro(v)
      } catch {
        return { status: 'rejected', error: 'Every limit must be a positive amount.' }
      }
    }
    // Limits the player did not touch follow a lowered allowance down (never up).
    const given = req.limits ?? {}
    const l = to.limits
    if (given.daily === undefined) l.daily = Math.min(l.daily, l.monthly)
    if (given.session === undefined) l.session = Math.min(l.session, l.monthly)
    if (given.enrichMonthly === undefined) l.enrichMonthly = Math.min(l.enrichMonthly, l.monthly)
    if (given.perRequest === undefined && l.monthly > 0) l.perRequest = Math.min(l.perRequest, l.daily, l.session)
    const err = this.validate(to)
    if (err) return { status: 'rejected', error: err }
    const { lines, increase } = this.describe(from, to)
    if (!lines.length) return { status: 'applied', settings: this.getSettings() }
    if (increase) {
      const token = randomToken()
      this.pending.set(token, { to, createdAt: this.wallNow() })
      return { status: 'needs_confirmation', token, summary: lines, from: structuredClone(from), to: structuredClone(to) }
    }
    if (to.limits.monthly === 0) to.aiEnabled = false
    if (this.inFlight() > 0) {
      this.deferred = to
      return { status: 'deferred', summary: [...lines, 'This takes effect as soon as the request on its way now finishes.'] }
    }
    this.commitSettings(to)
    return { status: 'applied', settings: this.getSettings() }
  }

  confirmChange(token: string): ChangeResult {
    const p = this.pending.get(token)
    this.pending.delete(token)
    if (!p) return { status: 'rejected', error: 'That confirmation has expired. Nothing was changed.' }
    if (this.wallNow() - p.createdAt > CONFIRM_TTL_MS) return { status: 'rejected', error: 'That confirmation has expired. Nothing was changed.' }
    const to: BudgetSettings = { ...p.to, aiEnabled: this.settings.aiEnabled, lightModel: this.settings.lightModel, deepModel: this.settings.deepModel }
    const err = this.validate(to)
    if (err) return { status: 'rejected', error: err }
    if (this.inFlight() > 0) {
      this.deferred = to
      return { status: 'deferred', summary: ['This takes effect as soon as the request on its way now finishes.'] }
    }
    this.commitSettings(to)
    return { status: 'applied', settings: this.getSettings() }
  }

  private applyDeferredIfIdle(): void {
    if (this.deferred && this.inFlight() === 0) {
      const d = this.deferred
      this.deferred = null
      this.commitSettings({ ...d, aiEnabled: d.limits.monthly === 0 ? false : this.settings.aiEnabled })
    }
  }

  ledger(limit = 500): LedgerEntry[] {
    return [...this.entries.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit).map((e) => ({ ...e }))
  }

  view(trustedNow: number | null, sessionId: string): BudgetView {
    const period = this.currentPeriod(trustedNow)
    const inMonth = [...this.entries.values()].filter((e) => e.month === period.month)
    const byFeature: BudgetView['byFeature'] = {}
    const byModel: BudgetView['byModel'] = {}
    let reservedNow = 0
    let uncertain = 0
    for (const e of inMonth) {
      const c = this.committed(e)
      if (e.status !== 'released') {
        byFeature[e.feature] = { requests: (byFeature[e.feature]?.requests ?? 0) + 1, cost: (byFeature[e.feature]?.cost ?? 0) + c }
        byModel[e.model] = { requests: (byModel[e.model]?.requests ?? 0) + 1, cost: (byModel[e.model]?.cost ?? 0) + c }
      }
      if (e.status === 'reserved' || e.status === 'sent') reservedNow += e.reserved
      if (e.status === 'uncertain') uncertain += e.reserved
    }
    const spentMonth = this.sum((e) => e.month === period.month)
    const ref = trustedNow ?? Math.max(this.clock.trustedMs, this.wallNow())
    return {
      aiEnabled: this.settings.aiEnabled,
      limits: { ...this.settings.limits },
      timezone: this.settings.timezone,
      month: period.month,
      day: period.day,
      spentMonth,
      reservedNow,
      uncertainMonth: uncertain,
      remainingMonth: Math.max(0, this.settings.limits.monthly - spentMonth),
      spentToday: this.sum((e) => e.day === period.day),
      spentSession: this.sum((e) => e.sessionId === sessionId),
      enrichSpentMonth: this.sum((e) => e.enrich && e.month === period.month),
      totalRequests: inMonth.filter((e) => e.status !== 'released').length,
      byFeature,
      byModel,
      lightModel: this.settings.lightModel,
      deepModel: this.settings.deepModel,
      allowDeep: this.settings.allowDeep,
      allowPremium: this.settings.allowPremium,
      autoEnrich: this.settings.autoEnrich,
      nextReset: nextMonthStart(ref, this.settings.timezone),
      inFlight: this.inFlight(),
      rejections: this.rejections.slice(-20).reverse(),
      pendingDeferred: !!this.deferred
    }
  }
}

function normaliseSettings(s: BudgetSettings): BudgetSettings {
  const d = defaultSettings(s.timezone || localTimeZone())
  return {
    ...d,
    ...s,
    limits: { ...d.limits, ...(s.limits ?? {}) }
  }
}

export function ledgerCsv(entries: LedgerEntry[]): string {
  const cols: (keyof LedgerEntry)[] = [
    'createdAt',
    'month',
    'day',
    'feature',
    'model',
    'status',
    'reserved',
    'actual',
    'inputTokens',
    'outputTokens',
    'cacheReadTokens',
    'cacheWriteTokens',
    'requestId',
    'sessionId',
    'note'
  ]
  const esc = (v: unknown) => {
    const t = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
  }
  const head = [...cols.map((c) => (c === 'reserved' ? 'reserved_usd' : c === 'actual' ? 'actual_usd' : c)), 'created_iso'].join(',')
  const rows = entries.map((e) =>
    [
      ...cols.map((c) => (c === 'reserved' || c === 'actual' ? (e[c] === null ? '' : (Number(e[c]) / 1_000_000).toFixed(6)) : esc(e[c]))),
      new Date(e.createdAt).toISOString()
    ].join(',')
  )
  return [head, ...rows].join('\n') + '\n'
}

export class MemoryBudgetStore implements BudgetPersistence {
  settings: BudgetSettings | null = null
  clock: ClockState | null = null
  entries = new Map<string, LedgerEntry>()
  rejections: Rejection[] = []
  failNext = false
  writes = 0
  load() {
    return { settings: this.settings, clock: this.clock, entries: [...this.entries.values()].map((e) => ({ ...e })), rejections: [...this.rejections] }
  }
  transaction(fn: (w: BudgetWriter) => void): void {
    if (this.failNext) {
      this.failNext = false
      throw new Error('Simulated write failure')
    }
    const staged: (() => void)[] = []
    fn({
      putSettings: (s) => staged.push(() => (this.settings = structuredClone(s))),
      putClock: (c) => staged.push(() => (this.clock = structuredClone(c))),
      putEntry: (e) => staged.push(() => this.entries.set(e.id, { ...e })),
      putRejection: (r) => staged.push(() => this.rejections.push({ ...r }))
    })
    for (const s of staged) s()
    this.writes++
  }
}
