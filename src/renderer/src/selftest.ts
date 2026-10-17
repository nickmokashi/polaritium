import { NODE_STRIDE, STRAND_STRIDE } from '@core/sim/snapshot'
import { bridge } from './bridge'
import { view } from './scene/shared'
import { useUI } from './state/store'
import { snapshotThumb } from './ui/Game'

// The installed game checks itself. Run with --selftest (first run) and --selftest=reload
// (second run, after a restart): it plays a short real session in a hidden window and writes
// a report, so the packaged app can be verified without anything appearing on screen.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function waitFor(fn: () => boolean, ms: number): Promise<boolean> {
  const t0 = performance.now()
  while (performance.now() - t0 < ms) {
    if (fn()) return true
    await sleep(100)
  }
  return false
}

export async function runSelftest(): Promise<void> {
  const mode = new URLSearchParams(location.search).get('selftest') ?? 'first'
  if (mode !== 'first' && mode !== 'reload') return
  const steps: { name: string; ok: boolean; detail?: string }[] = []
  const step = (name: string, ok: boolean, detail?: string) => steps.push({ name, ok, detail })
  const report: Record<string, unknown> = { mode, steps, started: new Date().toISOString() }
  try {
    step('the game page loaded and reached its storage', !!(await bridge.settings.get()))
    if (mode === 'first') {
      useUI.getState().set({ screen: 'game', spec: { mode: 'lab', env: 'cradle', preset: 'twin', seed: 'selftest', density: 1, name: 'Self-test universe', chamber: null, universe: null } })
      step('a new world was generated', await waitFor(() => (view.snap?.nodeIds.length ?? 0) >= 2, 30000))
      const t0 = view.host?.info?.tick ?? 0
      await sleep(3000)
      const t1 = view.host?.info?.tick ?? 0
      step('the world evolves without input', t1 > t0 + 20, `tick ${t0} → ${t1}`)
      const s = view.snap!
      let w = -1
      let b = -1
      for (let i = 0; i < s.nodeIds.length; i++) {
        if (w < 0 && s.nodes[i * NODE_STRIDE + 6] === 1) w = s.nodeIds[i]
        if (b < 0 && s.nodes[i * NODE_STRIDE + 6] === 0) b = s.nodeIds[i]
      }
      const r = await view.host!.cmd({ type: 'connect', a: w, b }, true)
      step('a strand can be drawn between light and dark', r.ok, r.error)
      await sleep(3000)
      const s2 = view.snap!
      let flow = 0
      for (let i = 0; i < s2.strandIds.length; i++) flow += Math.abs(s2.strands[i * STRAND_STRIDE + 2])
      step('energy flows along it', flow > 0.05, `flow ${flow.toFixed(3)}`)
      const p = await view.host!.cmd({ type: 'pulse', p: { x: 0, y: 0, z: 0 }, strength: 6 }, true)
      step('a pulse can be sent', p.ok)
      window.dispatchEvent(new CustomEvent('polaritium:save'))
      step('the universe was saved', await waitFor(() => false, 1500) || (await bridge.universes.list()).some((u) => u.name === 'Self-test universe'))
      const img = await snapshotThumb(640, 360)
      step('a picture can be rendered', !!img && img.length > 2000)
      report.image = img
      const st = await bridge.settings.get()
      await bridge.settings.set({ ...st, audio: { ...st.audio, master: 0.55 } })
      step('settings can be saved', (await bridge.settings.get()).audio.master === 0.55)
      const ai = await bridge.ai.status()
      step('AI starts switched off', !ai.enabled)
      const out = await bridge.ai.run('interpret', { summary: { environment: 'test', seconds: 1, light: 1, dark: 1, grey: 0, strands: 1, lockedStrands: 0, totalFlow: 0, rings: 0, membranes: 0, organisms: 0, generations: 0, collapses: 0 } }, { userInitiated: true })
      step('with AI off, a local reading is given and nothing is sent', !out.ok && out.reason === 'ai_off' && out.fallback.length > 10)
    } else {
      const list = await bridge.universes.list()
      const u = list.find((x) => x.name === 'Self-test universe')
      step('the saved universe survived a restart', !!u)
      step('settings survived a restart', (await bridge.settings.get()).audio.master === 0.55)
      if (u) {
        const r = await bridge.universes.load(u.id)
        step('it loads', !!r.ok && !!r.value)
        if (r.ok && r.value) {
          useUI.getState().set({ screen: 'game', spec: { mode: 'lab', env: 'cradle', preset: 'twin', seed: u.seed, density: 1, name: u.name, chamber: null, loadState: r.value.state, universe: r.value.meta } })
          step('the reloaded world is drawn', await waitFor(() => (view.snap?.strandIds.length ?? 0) >= 1, 30000))
          const t0 = view.host?.info?.tick ?? 0
          await sleep(2500)
          step('the reloaded world keeps running', (view.host?.info?.tick ?? 0) > t0 + 15)
          report.image = await snapshotThumb(640, 360)
        }
      }
    }
  } catch (e) {
    report.error = (e as Error).message
  }
  report.ok = !report.error && steps.length > 0 && steps.every((s) => s.ok)
  report.finished = new Date().toISOString()
  await bridge.app.selftest?.(report)
}
