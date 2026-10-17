import type { BudgetPersistence, BudgetSettings, BudgetWriter, ClockState, LedgerEntry, Rejection } from '@core/budget/controller'
import type { Store } from './db'

// The budget's durable record: every reservation is committed to SQLite inside the same
// transaction that admits it, before anything is sent.

export class SqliteBudgetStore implements BudgetPersistence {
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
