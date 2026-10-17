import { useEffect, useMemo, useState } from 'react'
import type { CheckpointMeta, UniverseMeta } from '@core/app/bridge'
import type { EnvId } from '@core/sim/types'
import { bridge } from '../bridge'
import { Scene } from '../scene/Scene'
import { ViewState } from '../scene/shared'
import { SimHost } from '../sim/host'
import { useUI } from '../state/store'
import { Btn, ScreenHeader, formatTime } from './primitives'

// Two experiments side by side. Each runs in its own simulation from its own saved moment, at
// the same speed, so a branch and its original can be watched and measured together.

interface Side {
  label: string
  env: EnvId
  state: string
}

function useSide(side: Side | null) {
  const v = useMemo(() => new ViewState(), [side])
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!side) return
    const host = new SimHost()
    v.host = host
    host.paused = true
    void host.load(side.state).then(() => setReady(true))
    return () => {
      host.dispose()
      v.host = null
      setReady(false)
    }
  }, [side, v])
  return { v, ready }
}

export function CompareScreen() {
  const [universes, setUniverses] = useState<UniverseMeta[]>([])
  const [cps, setCps] = useState<Record<string, CheckpointMeta[]>>({})
  const [a, setA] = useState<Side | null>(null)
  const [b, setB] = useState<Side | null>(null)
  const [running, setRunning] = useState(false)
  const [stats, setStats] = useState<[Record<string, number | string> | null, Record<string, number | string> | null]>([null, null])
  const A = useSide(a)
  const B = useSide(b)

  useEffect(() => {
    void bridge.universes.list().then(async (list) => {
      setUniverses(list)
      const out: Record<string, CheckpointMeta[]> = {}
      for (const u of list.slice(0, 20)) out[u.id] = await bridge.universes.checkpoints(u.id)
      setCps(out)
    })
  }, [])

  useEffect(() => {
    for (const h of [A.v.host, B.v.host]) if (h) h.paused = !running
  }, [running, A.ready, B.ready])

  useEffect(() => {
    const t = setInterval(async () => {
      const sa = A.ready ? await A.v.host?.req<Record<string, number | string>>('summary') : null
      const sb = B.ready ? await B.v.host?.req<Record<string, number | string>>('summary') : null
      setStats([sa ?? null, sb ?? null])
    }, 1000)
    return () => clearInterval(t)
  }, [A.ready, B.ready])

  const choose = async (which: 'a' | 'b', u: UniverseMeta, cp: CheckpointMeta | null) => {
    let state: string | undefined
    if (cp) {
      const r = await bridge.universes.loadCheckpoint(cp.id)
      state = r.value
    } else {
      const r = await bridge.universes.load(u.id)
      state = r.value?.state
    }
    if (!state) {
      useUI.getState().toast('That one could not be opened.', 'warn')
      return
    }
    const side = { label: cp ? `${u.name} · ${cp.label}` : u.name, env: u.env as EnvId, state }
    setRunning(false)
    if (which === 'a') setA(side)
    else setB(side)
  }

  const picker = (which: 'a' | 'b') => (
    <select
      onChange={(e) => {
        const [uid, cpid] = e.target.value.split('|')
        const u = universes.find((x) => x.id === uid)
        if (u) void choose(which, u, cps[uid]?.find((c) => c.id === cpid) ?? null)
      }}
      defaultValue=""
      data-testid={`compare-pick-${which}`}
    >
      <option value="" disabled>
        Choose an experiment or checkpoint
      </option>
      {universes.map((u) => [
        <option key={u.id} value={`${u.id}|`}>
          {u.name} (latest)
        </option>,
        ...(cps[u.id] ?? []).map((c) => (
          <option key={c.id} value={`${u.id}|${c.id}`}>
            {'   '}
            {u.name} · {c.label} ({formatTime(c.tick)})
          </option>
        ))
      ])}
    </select>
  )

  const keys = ['seconds', 'light', 'dark', 'grey', 'strands', 'lockedStrands', 'totalFlow', 'rings', 'membranes', 'crystals', 'organisms', 'generations', 'births', 'collapses', 'fractures']
  const labels: Record<string, string> = { seconds: 'Seconds', light: 'Light', dark: 'Dark', grey: 'Grey', strands: 'Strands', lockedStrands: 'In step', totalFlow: 'Total flow', rings: 'Rings', membranes: 'Membranes', crystals: 'Crystals', organisms: 'Living forms', generations: 'Generations', births: 'Births of grey', collapses: 'Collapses', fractures: 'Fractures' }

  return (
    <div className="screen" data-testid="compare">
      <ScreenHeader
        title="Compare"
        line="Two experiments from their saved moments, running side by side at the same speed. Branch an experiment, change one thing, and compare it with the original."
        onBack={() => useUI.getState().set({ screen: 'menu' })}
        right={
          <Btn kind="primary" onClick={() => setRunning(!running)} disabled={!A.ready && !B.ready} testid="compare-run">
            {running ? 'Pause both' : 'Run both'}
          </Btn>
        }
      />
      <div className="row" style={{ flex: 1, minHeight: 0, alignItems: 'stretch', gap: 10, padding: '0 20px 10px' }}>
        {[
          { s: a, h: A, which: 'a' as const },
          { s: b, h: B, which: 'b' as const }
        ].map(({ s, h, which }) => (
          <div key={which} className="col" style={{ flex: 1, minWidth: 0 }}>
            <div className="row">{picker(which)}</div>
            <div className="panel" style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
              {s && h.ready ? <Scene env={s.env} interactive={false} pose={null} viewState={h.v} /> : <div className="faint" style={{ padding: 20 }}>Nothing chosen.</div>}
            </div>
          </div>
        ))}
      </div>
      <div className="panel" style={{ margin: '0 20px 20px', padding: 12 }}>
        <table style={{ width: '100%' }} data-testid="compare-table">
          <thead>
            <tr className="faint">
              <td>Measure</td>
              <td>{a?.label ?? 'Left'}</td>
              <td>{b?.label ?? 'Right'}</td>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k}>
                <td className="muted">{labels[k]}</td>
                <td>{String(stats[0]?.[k] ?? '—')}</td>
                <td style={{ color: stats[0] && stats[1] && stats[0][k] !== stats[1][k] ? '#fff' : undefined }}>{String(stats[1]?.[k] ?? '—')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
