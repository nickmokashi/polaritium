// Accounting periods. The month and day a request belongs to are worked out in one stored
// accounting time zone (chosen once, on first run) from a TRUSTED instant: the date the
// Anthropic server reported, carried forward by the computer's monotonic clock. Changing the
// computer's clock therefore cannot move spending into a fresh month.

export interface Period {
  month: string // YYYY-MM
  day: string // YYYY-MM-DD
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    formatters.set(tz, f)
  }
  return f
}

export function isValidTimeZone(tz: string): boolean {
  try {
    formatter(tz).format(new Date(0))
    return true
  } catch {
    return false
  }
}

export function localTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    return tz && isValidTimeZone(tz) ? tz : 'UTC'
  } catch {
    return 'UTC'
  }
}

export function periodOf(ms: number, tz: string): Period {
  if (!Number.isFinite(ms)) throw new Error('Not a valid instant')
  const parts = formatter(tz).formatToParts(new Date(ms))
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  const y = get('year').padStart(4, '0')
  const m = get('month').padStart(2, '0')
  const d = get('day').padStart(2, '0')
  return { month: `${y}-${m}`, day: `${y}-${m}-${d}` }
}

/** Periods compare correctly as strings because they are zero-padded. Never moves backwards. */
export function laterPeriod(a: Period, b: Period): Period {
  if (b.month > a.month) return b
  if (b.month < a.month) return a
  return b.day > a.day ? b : a
}

/** The instant (to the minute) when the month after `ms` begins, in `tz`. */
export function nextMonthStart(ms: number, tz: string): number {
  const start = periodOf(ms, tz).month
  let lo = ms
  let hi = ms
  const DAY = 86_400_000
  for (let i = 0; i < 40; i++) {
    hi += DAY
    if (periodOf(hi, tz).month !== start) break
    lo = hi
  }
  while (hi - lo > 60_000) {
    const mid = lo + Math.floor((hi - lo) / 2)
    if (periodOf(mid, tz).month === start) lo = mid
    else hi = mid
  }
  return hi
}
