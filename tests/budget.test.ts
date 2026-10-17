import { describe, expect, it } from 'vitest'
import { BudgetController, DEFAULT_LIMITS, MemoryBudgetStore, defaultSettings, ledgerCsv } from '@core/budget/controller'
import { maxRequestCost, actualCost, inputTokenBound, utf8Bytes, MAX_OUTPUT_TOKENS_CAP, type RequestPlan } from '@core/budget/estimator'
import { BUNDLED_REGISTRY, effectivePrice, validateUserRegistry, type ModelRegistry } from '@core/budget/pricing'
import { usd, tokenCost } from '@core/budget/money'
import { nextMonthStart, periodOf } from '@core/budget/period'
import { AiService, ServerAnchoredClock, TransportError, type AiTransport, type TransportRequest, type TrustedClock } from '@core/ai/service'

const TZ = 'America/Boise'
const OCT17 = Date.parse('2026-10-17T18:00:00Z')

function plan(over: Partial<RequestPlan> = {}): RequestPlan {
  return { feature: 'test', model: 'claude-haiku-5-5', system: 'You are terse.', messages: [{ role: 'user', text: 'Name this ring.' }], maxOutputTokens: 200, ...over }
}

function make(opts: { registry?: ModelRegistry | null; now?: () => number; store?: MemoryBudgetStore } = {}) {
  const store = opts.store ?? new MemoryBudgetStore()
  if (!store.settings) store.settings = { ...defaultSettings(TZ), aiEnabled: true }
  const b = new BudgetController(store, () => opts.registry ?? null, opts.now ?? (() => OCT17))
  return { store, b }
}

const ctx = (over: Partial<Parameters<BudgetController['admit']>[1]> = {}) => ({
  trustedNow: OCT17,
  sessionId: 's1',
  keyPresent: true,
  userInitiated: true,
  ...over
})

class FixedClock implements TrustedClock {
  constructor(public t: number | null) {}
  now() {
    return this.t
  }
  async ensure() {
    return this.t
  }
  observe(ms: number | null | undefined) {
    if (ms) this.t = ms
  }
}

class MockTransport implements AiTransport {
  calls: TransportRequest[] = []
  constructor(private behave: (req: TransportRequest, signal: AbortSignal) => Promise<any>) {}
  send(req: TransportRequest, signal: AbortSignal) {
    this.calls.push(req)
    return this.behave(req, signal)
  }
}

const okReply = (text = '{"text":"Halo of Nine"}', usage: unknown = { input_tokens: 120, output_tokens: 30 }) =>
  async () => ({ text, usage, requestId: 'req_1', serverDateMs: OCT17, stopReason: 'end_turn' })

function service(b: BudgetController, t: AiTransport, clock: TrustedClock = new FixedClock(OCT17), key = true) {
  const s = new AiService(b, t, clock, { keyPresent: () => key, sessionId: 's1', timeoutMs: 2000 })
  s.register({
    id: 'test',
    build: () => ({ system: 'You are terse.', user: 'Name this ring.', maxTokens: 200 }),
    parse: (txt) => {
      try {
        const j = JSON.parse(txt)
        return typeof j.text === 'string' ? j : null
      } catch {
        return null
      }
    },
    local: () => 'Local name: Ring 4'
  })
  return s
}

describe('money and estimates', () => {
  it('keeps money in whole microdollars', () => {
    expect(usd(10)).toBe(10_000_000)
    expect(usd(0.05)).toBe(50_000)
    expect(tokenCost(1, 100_000)).toBe(1) // rounds a fraction of a microdollar UP
    expect(tokenCost(1_000_000, 500_000)).toBe(500_000)
  })

  it('bounds input tokens by UTF-8 bytes plus framing', () => {
    expect(utf8Bytes('abc')).toBe(3)
    expect(utf8Bytes('é')).toBe(2)
    expect(utf8Bytes('😀')).toBe(4)
    const p = plan()
    expect(inputTokenBound(p)).toBeGreaterThan(utf8Bytes(p.system) + utf8Bytes(p.messages[0].text))
  })

  it('reserves more than any honest usage report can cost', () => {
    const p = plan({ maxOutputTokens: 300 })
    const price = effectivePrice('claude-haiku-5-5', null)!
    const { inputBound, cost } = maxRequestCost(p, price)
    const worst = actualCost({ input_tokens: inputBound, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, price)
    expect(cost).toBeGreaterThanOrEqual(worst)
    // even if every input token had been a 1-hour cache write
    const cached = actualCost({ input_tokens: 0, output_tokens: 300, cache_creation_input_tokens: inputBound }, price)
    expect(cost).toBeGreaterThanOrEqual(cached)
  })

  it('uses the verified prices for Haiku 5.5 and Sonnet 5.5', () => {
    const h = BUNDLED_REGISTRY.models['claude-haiku-5-5']
    expect(h.inputPerMTok).toBe(100_000)
    expect(h.outputPerMTok).toBe(500_000)
    const s = BUNDLED_REGISTRY.models['claude-sonnet-5-5']
    expect(s.inputPerMTok).toBe(2_000_000)
    expect(s.outputPerMTok).toBe(10_000_000)
  })
})

describe('defaults', () => {
  it('starts at a $10 monthly allowance with AI off and premium models off', () => {
    const s = defaultSettings(TZ)
    expect(s.limits.monthly).toBe(usd(10))
    expect(s.limits.daily).toBe(usd(0.75))
    expect(s.limits.session).toBe(usd(0.5))
    expect(s.limits.perRequest).toBe(usd(0.05))
    expect(s.aiEnabled).toBe(false)
    expect(s.allowPremium).toBe(false)
    expect(s.allowDeep).toBe(false)
    expect(s.autoEnrich).toBe(false)
  })

  it('a fresh controller blocks paid calls until AI is switched on', () => {
    const store = new MemoryBudgetStore()
    const b = new BudgetController(store, () => null, () => OCT17)
    const r = b.admit(plan(), ctx())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('ai_off')
  })
})

describe('admission', () => {
  it('admits a small request and reserves it durably before returning', () => {
    const { b, store } = make()
    const r = b.admit(plan(), ctx())
    expect(r.ok).toBe(true)
    if (r.ok) {
      const saved = store.entries.get(r.ticket.entryId)!
      expect(saved.status).toBe('reserved')
      expect(saved.reserved).toBe(r.ticket.reserved)
    }
  })

  it('a $0 allowance blocks every paid call', () => {
    const { b } = make()
    const res = b.proposeChange({ limits: { monthly: 0, daily: 0, session: 0, perRequest: 0, enrichMonthly: 0 } })
    expect(res.status).toBe('applied')
    const r = b.admit(plan(), ctx())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('ai_off') // $0 also switches AI off
    b.setEnabled(true)
    expect(b.getSettings().aiEnabled).toBe(false)
  })

  it('refuses without a key, without a trusted date, or when the player did not ask', () => {
    const { b } = make()
    const a = b.admit(plan(), ctx({ keyPresent: false }))
    const c = b.admit(plan(), ctx({ trustedNow: null }))
    const d = b.admit(plan(), ctx({ userInitiated: false }))
    expect([a, c, d].map((x) => (!x.ok ? x.reason : 'ok'))).toEqual(['no_key', 'clock_unverified', 'not_user_initiated'])
  })

  it('blocks unknown prices and premium models', () => {
    const { b } = make()
    const a = b.admit(plan({ model: 'claude-opus-5-5' }), ctx())
    const c = b.admit(plan({ model: 'some-unpriced-model' }), ctx())
    expect(!a.ok && a.reason).toBe('unknown_price')
    expect(!c.ok && c.reason).toBe('unknown_price')
  })

  it('blocks the deeper model until it is allowed', () => {
    const { b } = make()
    const a = b.admit(plan({ model: 'claude-sonnet-5-5' }), ctx())
    expect(!a.ok && a.reason).toBe('model_not_allowed')
  })

  it('enforces the per-request output cap', () => {
    const { b } = make()
    const a = b.admit(plan({ maxOutputTokens: MAX_OUTPUT_TOKENS_CAP + 1 }), ctx())
    expect(!a.ok && a.reason).toBe('output_cap')
  })

  it('refuses requests that could cost more than the per-request ceiling', () => {
    const { b } = make()
    const big = 'x'.repeat(19_000)
    b.proposeChange({ limits: { perRequest: usd(0.001) } })
    const a = b.admit(plan({ messages: [{ role: 'user', text: big }] }), ctx())
    expect(!a.ok && a.reason).toBe('over_request_cap')
  })

  it('refuses oversized prompts', () => {
    const { b } = make()
    const a = b.admit(plan({ messages: [{ role: 'user', text: 'x'.repeat(30_000) }] }), ctx())
    expect(!a.ok && a.reason).toBe('too_large')
  })

  it('allows one request in flight at a time', () => {
    const { b } = make()
    expect(b.admit(plan(), ctx()).ok).toBe(true)
    const second = b.admit(plan(), ctx())
    expect(!second.ok && second.reason).toBe('busy')
  })

  it('stops at the session, daily and monthly allowances', () => {
    const { b } = make()
    const p = plan({ maxOutputTokens: 1000 })
    let n = 0
    for (let i = 0; i < 10_000; i++) {
      const r = b.admit(p, ctx())
      if (!r.ok) {
        expect(r.reason).toBe('session_limit')
        break
      }
      b.markSent(r.ticket.entryId)
      b.markUncertain(r.ticket.entryId, 'test') // worst case: every request counts in full
      n++
    }
    const v = b.view(OCT17, 's1')
    expect(v.spentSession).toBeLessThanOrEqual(DEFAULT_LIMITS.session)
    expect(n).toBeGreaterThan(0)
    // a new session can carry on until the daily limit
    for (let i = 0; i < 10_000; i++) {
      const r = b.admit(p, ctx({ sessionId: `s${i + 2}` }))
      if (!r.ok) {
        expect(['daily_limit', 'session_limit']).toContain(r.reason)
        if (r.reason === 'daily_limit') break
        continue
      }
      b.markSent(r.ticket.entryId)
      b.markUncertain(r.ticket.entryId, 'test')
    }
    expect(b.view(OCT17, 's1').spentToday).toBeLessThanOrEqual(DEFAULT_LIMITS.daily)
  })

  it('never lets the month go over its allowance, across many days', () => {
    const { b } = make()
    const p = plan({ maxOutputTokens: 1000 })
    const DAY = 86_400_000
    const start = Date.parse('2026-10-01T18:00:00Z')
    for (let d = 0; d < 31; d++) {
      for (let i = 0; i < 400; i++) {
        const r = b.admit(p, ctx({ trustedNow: start + d * DAY, sessionId: `d${d}-s${Math.floor(i / 40)}` }))
        if (!r.ok) continue
        b.markSent(r.ticket.entryId)
        b.markUncertain(r.ticket.entryId, 'test')
      }
    }
    const v = b.view(Date.parse('2026-10-31T18:00:00Z'), 'x')
    expect(v.month).toBe('2026-10')
    expect(v.spentMonth).toBeLessThanOrEqual(usd(10))
  })

  it('does not admit when the reservation cannot be saved', () => {
    const { b, store } = make()
    store.failNext = true
    const r = b.admit(plan(), ctx())
    expect(!r.ok && r.reason).toBe('persist_failed')
    expect(b.inFlight()).toBe(0)
  })
})

describe('reconciliation', () => {
  it('records the real cost and frees the rest of the reservation', () => {
    const { b } = make()
    const r = b.admit(plan(), ctx())
    if (!r.ok) throw new Error('not admitted')
    b.markSent(r.ticket.entryId)
    const e = b.reconcile(r.ticket.entryId, { input_tokens: 100, output_tokens: 20 }, 'req_x')
    expect(e.status).toBe('reconciled')
    expect(e.actual!).toBeLessThan(r.ticket.reserved)
    expect(b.view(OCT17, 's1').spentMonth).toBe(e.actual)
  })

  it('missing usage never silently releases a reservation', () => {
    const { b } = make()
    const r = b.admit(plan(), ctx())
    if (!r.ok) throw new Error('not admitted')
    b.markSent(r.ticket.entryId)
    const e = b.reconcile(r.ticket.entryId, { output_tokens: 3 }, null)
    expect(e.status).toBe('uncertain')
    expect(b.view(OCT17, 's1').spentMonth).toBe(r.ticket.reserved)
  })

  it('requests left in flight by a crash stay counted in full', () => {
    const store = new MemoryBudgetStore()
    store.settings = { ...defaultSettings(TZ), aiEnabled: true }
    const b1 = new BudgetController(store, () => null, () => OCT17)
    const r = b1.admit(plan(), ctx())
    if (!r.ok) throw new Error('not admitted')
    b1.markSent(r.ticket.entryId)
    // the app dies here; a new run loads the same store
    const b2 = new BudgetController(store, () => null, () => OCT17)
    const e = b2.ledger().find((x) => x.id === r.ticket.entryId)!
    expect(e.status).toBe('uncertain')
    expect(b2.view(OCT17, 's2').spentMonth).toBe(r.ticket.reserved)
    expect(b2.inFlight()).toBe(0)
  })

  it('exports the ledger as CSV', () => {
    const { b } = make()
    const r = b.admit(plan(), ctx())
    if (!r.ok) throw new Error('not admitted')
    b.markSent(r.ticket.entryId)
    b.reconcile(r.ticket.entryId, { input_tokens: 100, output_tokens: 20 }, 'req_x')
    const csv = ledgerCsv(b.ledger())
    expect(csv.split('\n')[0]).toContain('reserved_usd')
    expect(csv).toContain('req_x')
  })
})

describe('changing the allowance', () => {
  it('a $10 allowance cannot be raised without confirmation', () => {
    const { b } = make()
    const r = b.proposeChange({ limits: { monthly: usd(20) } })
    expect(r.status).toBe('needs_confirmation')
    expect(b.getSettings().limits.monthly).toBe(usd(10))
    if (r.status === 'needs_confirmation') {
      expect(r.summary.join(' ')).toContain('$10.00 → $20.00')
      expect(r.summary.join(' ')).toMatch(/Anthropic workspace limit is separate/)
      const c = b.confirmChange(r.token)
      expect(c.status).toBe('applied')
      expect(b.getSettings().limits.monthly).toBe(usd(20))
    }
  })

  it('a confirmation token works once and expires', () => {
    let now = OCT17
    const { b } = make({ now: () => now })
    const r = b.proposeChange({ limits: { monthly: usd(30) } })
    if (r.status !== 'needs_confirmation') throw new Error('expected confirmation')
    now += 11 * 60_000
    expect(b.confirmChange(r.token).status).toBe('rejected')
    expect(b.confirmChange('made-up').status).toBe('rejected')
    expect(b.getSettings().limits.monthly).toBe(usd(10))
  })

  it('switching on the deeper model or enrichment also needs confirmation', () => {
    const { b } = make()
    expect(b.proposeChange({ allowDeep: true }).status).toBe('needs_confirmation')
    expect(b.proposeChange({ autoEnrich: true }).status).toBe('needs_confirmation')
    expect(b.getSettings().allowDeep).toBe(false)
  })

  it('decreases apply at once, but wait while a request is in flight', () => {
    const { b } = make()
    const r = b.admit(plan(), ctx())
    if (!r.ok) throw new Error('not admitted')
    const d = b.proposeChange({ limits: { monthly: usd(5) } })
    expect(d.status).toBe('deferred')
    expect(b.getSettings().limits.monthly).toBe(usd(10))
    b.markSent(r.ticket.entryId)
    b.reconcile(r.ticket.entryId, { input_tokens: 10, output_tokens: 10 }, null)
    expect(b.getSettings().limits.monthly).toBe(usd(5))
  })

  it('rejects invalid limits', () => {
    const { b } = make()
    expect(b.proposeChange({ limits: { daily: usd(50) } }).status).toBe('rejected')
    expect(b.proposeChange({ limits: { monthly: -5 } }).status).toBe('rejected')
    expect(b.proposeChange({ limits: { monthly: 1.5 } }).status).toBe('rejected')
    expect(b.proposeChange({ limits: { monthly: Number.POSITIVE_INFINITY } }).status).toBe('rejected')
    expect(b.proposeChange({ limits: { monthly: usd(5000) } }).status).toBe('rejected')
  })
})

describe('time and periods', () => {
  it('works out the month and day in the accounting time zone', () => {
    // 05:30 UTC on 1 November is still 31 October in Boise
    const p = periodOf(Date.parse('2026-11-01T05:30:00Z'), TZ)
    expect(p.month).toBe('2026-10')
    expect(p.day).toBe('2026-10-31')
    const reset = nextMonthStart(OCT17, TZ)
    expect(periodOf(reset, TZ).month).toBe('2026-11')
    expect(periodOf(reset - 120_000, TZ).month).toBe('2026-10')
  })

  it('a computer clock set forward does not reset the month', () => {
    // Spend the whole month, then change only the computer clock.
    let wall = OCT17
    const { b } = make({ now: () => wall })
    b.proposeChange({ limits: { monthly: usd(0.05), daily: usd(0.05), session: usd(0.05), perRequest: usd(0.05) } })
    for (let i = 0; i < 1000; i++) {
      const r = b.admit(plan({ maxOutputTokens: 1000 }), ctx({ sessionId: `s${i}` }))
      if (!r.ok) break
      b.markSent(r.ticket.entryId)
      b.markUncertain(r.ticket.entryId, 'x')
    }
    wall = Date.parse('2026-12-15T12:00:00Z')
    // trustedNow still comes from the server, which says it is October
    const r = b.admit(plan({ maxOutputTokens: 1000 }), ctx({ trustedNow: OCT17 + 60_000, sessionId: 'new' }))
    expect(!r.ok && r.reason).toBe('monthly_limit')
    expect(b.view(OCT17 + 60_000, 'new').month).toBe('2026-10')
  })

  it('a computer clock set backwards does not return to an earlier, emptier month', () => {
    const { b } = make()
    const nov = Date.parse('2026-11-02T18:00:00Z')
    const r = b.admit(plan(), ctx({ trustedNow: nov }))
    expect(r.ok).toBe(true)
    if (r.ok) {
      b.markSent(r.ticket.entryId)
      b.markUncertain(r.ticket.entryId, 'x')
    }
    expect(b.view(OCT17, 's1').month).toBe('2026-11') // never goes back to October
  })

  it('the server-anchored clock trusts nothing until the server has spoken', async () => {
    let mono = 0
    let server: number | null = null
    const c = new ServerAnchoredClock(() => mono, async () => server)
    expect(c.now()).toBeNull()
    expect(await c.ensure()).toBeNull() // offline
    server = OCT17
    expect(await c.ensure()).toBe(OCT17)
    mono += 5000
    expect(c.now()).toBe(OCT17 + 5000)
    mono -= 10_000 // monotonic clock cannot go backwards; if it seems to, trust is dropped
    expect(c.now()).toBeNull()
  })
})

describe('the price list', () => {
  it('player edits cannot lower a price below the verified figure', () => {
    const user: ModelRegistry = structuredClone(BUNDLED_REGISTRY)
    user.models['claude-haiku-5-5'].outputPerMTok = 1
    user.models['claude-haiku-5-5'].inputPerMTok = 1
    const p = effectivePrice('claude-haiku-5-5', user)!
    expect(p.outputPerMTok).toBe(500_000)
    expect(p.inputPerMTok).toBe(100_000)
  })

  it('player edits can raise a price', () => {
    const user: ModelRegistry = structuredClone(BUNDLED_REGISTRY)
    user.models['claude-haiku-5-5'].outputPerMTok = 900_000
    expect(effectivePrice('claude-haiku-5-5', user)!.outputPerMTok).toBe(900_000)
  })

  it('a zero, missing or broken price blocks the model', () => {
    const user = structuredClone(BUNDLED_REGISTRY) as ModelRegistry
    user.models['claude-new-x'] = { ...user.models['claude-haiku-5-5'], model: 'claude-new-x', outputPerMTok: 0 }
    expect(effectivePrice('claude-new-x', user)).toBeNull()
    expect(() => validateUserRegistry(user)).toThrow()
    expect(() => validateUserRegistry({ models: { a: { model: 'a', inputPerMTok: 'cheap' } } })).toThrow()
  })

  it('premium models added by hand stay blocked unless premium is allowed', () => {
    const user = structuredClone(BUNDLED_REGISTRY) as ModelRegistry
    user.models['claude-opus-5-5'] = { ...user.models['claude-sonnet-5-5'], model: 'claude-opus-5-5', label: 'Opus', premium: false, tier: 'premium' }
    const { b } = make({ registry: user })
    const r = b.admit(plan({ model: 'claude-opus-5-5' }), ctx())
    expect(!r.ok && r.reason).toBe('model_not_allowed')
  })
})

describe('the AI service', () => {
  it('sends one request with the capped max_tokens and reconciles it', async () => {
    const { b } = make()
    const t = new MockTransport(okReply())
    const s = service(b, t)
    const out = await s.run('test', { x: 1 }, { userInitiated: true })
    expect(out.ok).toBe(true)
    expect(t.calls.length).toBe(1)
    expect(t.calls[0].maxTokens).toBe(200)
    expect(b.ledger()[0].status).toBe('reconciled')
  })

  it('serves identical requests from its cache for free', async () => {
    const { b } = make()
    const t = new MockTransport(okReply())
    const store = new Map<string, any>()
    const s = new AiService(b, t, new FixedClock(OCT17), {
      keyPresent: () => true,
      sessionId: 's1',
      cache: { get: (k) => store.get(k) ?? null, put: (k, v) => store.set(k, v) }
    })
    s.register({ id: 'test', build: () => ({ system: 's', user: 'u', maxTokens: 50 }), parse: (x) => JSON.parse(x), local: () => 'l' })
    await s.run('test', { a: 1 }, { userInitiated: true })
    const second = await s.run('test', { a: 1 }, { userInitiated: true })
    expect(second.ok && second.cached).toBe(true)
    expect(t.calls.length).toBe(1)
  })

  it('AI off: no request is made and the local reading is returned', async () => {
    const { b } = make()
    b.setEnabled(false)
    const t = new MockTransport(okReply())
    const out = await service(b, t).run('test', {}, { userInitiated: true })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.fallback).toBe('Local name: Ring 4')
    expect(t.calls.length).toBe(0)
  })

  it('a dropped connection keeps the full reservation and is never retried', async () => {
    const { b } = make()
    const t = new MockTransport(async () => {
      throw new TransportError('uncertain', 'socket hang up')
    })
    const out = await service(b, t).run('test', {}, { userInitiated: true })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.charged).toBe(true)
    expect(t.calls.length).toBe(1)
    const e = b.ledger()[0]
    expect(e.status).toBe('uncertain')
    expect(b.view(OCT17, 's1').spentMonth).toBe(e.reserved)
  })

  it('a definite refusal by the API (400) is released, not billed', async () => {
    const { b } = make()
    const t = new MockTransport(async () => {
      throw new TransportError('rejected', 'bad request', 400)
    })
    await service(b, t).run('test', {}, { userInitiated: true })
    expect(b.ledger()[0].status).toBe('released')
    expect(b.view(OCT17, 's1').spentMonth).toBe(0)
  })

  it('switching AI off cancels the request on its way and keeps it counted', async () => {
    const { b } = make()
    let started!: () => void
    const begun = new Promise<void>((r) => (started = r))
    const t = new MockTransport(
      (_req, signal) =>
        new Promise((_res, rej) => {
          started()
          signal.addEventListener('abort', () => rej(new Error('aborted')))
        })
    )
    const s = service(b, t)
    const p = s.run('test', {}, { userInitiated: true })
    await begun
    b.setEnabled(false)
    s.cancelAll()
    const out = await p
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toBe('cancelled')
    expect(b.ledger()[0].status).toBe('uncertain')
    const again = await s.run('test', {}, { userInitiated: true })
    expect(!again.ok && again.reason).toBe('ai_off')
    expect(t.calls.length).toBe(1)
  })

  it('many simultaneous asks cannot overspend: one goes, the rest wait their turn', async () => {
    const { b } = make()
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const t = new MockTransport(async () => {
      await gate
      return { text: '{"text":"x"}', usage: { input_tokens: 10, output_tokens: 10 }, requestId: 'r', serverDateMs: OCT17, stopReason: 'end_turn' }
    })
    const s = service(b, t)
    const all = Promise.all(Array.from({ length: 50 }, () => s.run('test', {}, { userInitiated: true })))
    await new Promise((r) => setTimeout(r, 10))
    release()
    const outs = await all
    expect(outs.filter((o) => o.ok).length).toBe(1)
    expect(outs.filter((o) => !o.ok && o.reason === 'busy').length).toBe(49)
    expect(t.calls.length).toBe(1)
  })

  it('budget exhaustion returns the local reading so play continues', async () => {
    const { b } = make()
    b.proposeChange({ limits: { monthly: usd(0.0001), daily: usd(0.0001), session: usd(0.0001), perRequest: usd(0.0001) } })
    const t = new MockTransport(okReply())
    const out = await service(b, t).run('test', {}, { userInitiated: true })
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.reason).toBe('over_request_cap')
      expect(out.fallback.length).toBeGreaterThan(0)
    }
    expect(t.calls.length).toBe(0)
  })

  it('with no trusted date (offline), nothing is sent', async () => {
    const { b } = make()
    const t = new MockTransport(okReply())
    const out = await service(b, t, new FixedClock(null)).run('test', {}, { userInitiated: true })
    expect(!out.ok && out.reason).toBe('clock_unverified')
    expect(t.calls.length).toBe(0)
  })

  it('an unreadable reply is still recorded as spent and falls back locally', async () => {
    const { b } = make()
    const t = new MockTransport(okReply('not json'))
    const out = await service(b, t).run('test', {}, { userInitiated: true })
    expect(!out.ok && out.reason).toBe('invalid_response')
    expect(b.ledger()[0].status).toBe('reconciled')
  })
})
