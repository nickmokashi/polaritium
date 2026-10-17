import { useEffect, useState } from 'react'
import type { AtlasEntry } from '@core/app/atlas'
import type { Exhibit } from '@core/app/bridge'
import { interpretFeature } from '@core/ai/features'
import { DISCOVERIES } from '@core/sim/discovery'
import type { EnvId } from '@core/sim/types'
import { bridge } from '../bridge'
import { useUI } from '../state/store'
import { Btn, ScreenHeader, uid } from './primitives'

// The Living Gallery and the Discovery Atlas: what has been made, and what has been found.

export function GalleryScreen() {
  const [list, setList] = useState<Exhibit[]>([])
  const refresh = async () => setList(await bridge.gallery.list())
  useEffect(() => {
    void refresh()
  }, [])
  const open = async (e: Exhibit, as: 'view' | 'resume') => {
    const r = await bridge.gallery.load(e.id)
    if (!r.ok || !r.value) {
      useUI.getState().toast(`That exhibit could not be opened: ${r.error}`, 'warn')
      return
    }
    useUI.getState().set({
      screen: 'game',
      spec: {
        mode: 'lab',
        env: e.env as EnvId,
        preset: 'empty',
        seed: 'exhibit',
        density: 1,
        name: as === 'resume' ? `${e.name} · resumed` : e.name,
        chamber: null,
        loadState: r.value.state,
        universe: null,
        exhibit: as === 'view' ? e : null
      }
    })
  }
  return (
    <div className="screen" data-testid="gallery" style={{ background: 'radial-gradient(ellipse at 50% 10%, #111116 0%, #050506 70%)' }}>
      <ScreenHeader title="Living Gallery" line="Moments you kept. Open one to look around it, or resume it as a new experiment that carries on from there." onBack={() => useUI.getState().set({ screen: 'menu' })} />
      <div className="scroll" style={{ flex: 1, padding: '6px 28px 28px' }}>
        {!list.length && <div className="muted">Nothing here yet. In any experiment, open the menu (Esc) and choose “Add this moment to the Living Gallery”.</div>}
        <div className="grid-cards" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
          {list.map((e) => (
            <div key={e.id} className="card" style={{ cursor: 'default' }} data-testid="exhibit">
              {e.thumb ? <img src={e.thumb} style={{ width: '100%', borderRadius: 6, display: 'block' }} alt="" /> : <div style={{ height: 140, background: '#0b0b0e', borderRadius: 6 }} />}
              <input
                type="text"
                defaultValue={e.name}
                maxLength={60}
                onBlur={(ev) => void bridge.gallery.update(e.id, { name: ev.target.value.trim() || e.name }).then(refresh)}
                style={{ width: '100%', marginTop: 8, background: 'transparent', border: '1px solid transparent', fontFamily: 'var(--display)', fontSize: '1.3em' }}
                title="Rename"
              />
              <div className="row" style={{ flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                <Btn small kind="primary" onClick={() => void open(e, 'view')} title="Open it to look around (it keeps running, nothing is saved over it)">
                  View
                </Btn>
                <Btn small onClick={() => void open(e, 'resume')} title="Continue from this moment as a new experiment you can save and change">
                  Resume
                </Btn>
                <Btn
                  small
                  onClick={async () => {
                    const r = await bridge.gallery.load(e.id)
                    if (r.ok && r.value) await bridge.gallery.save({ ...e, id: uid(), name: `${e.name} (copy)`, created: Date.now() }, r.value.state)
                    void refresh()
                  }}
                  title="Make a copy of this exhibit"
                >
                  Duplicate
                </Btn>
                <select value={e.presentation} onChange={(ev) => void bridge.gallery.update(e.id, { presentation: ev.target.value as Exhibit['presentation'] }).then(refresh)} title="How it is presented when viewed">
                  <option value="pedestal">Pedestal</option>
                  <option value="halo">Halo</option>
                  <option value="night">Night</option>
                </select>
                <Btn
                  small
                  kind="ghost"
                  onClick={async () => {
                    if (!confirm(`Remove “${e.name}” from the gallery?`)) return
                    await bridge.gallery.remove(e.id)
                    void refresh()
                  }}
                  title="Remove from the gallery"
                >
                  Remove
                </Btn>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export function AtlasScreen() {
  const [entries, setEntries] = useState<AtlasEntry[]>([])
  const [sel, setSel] = useState<string | null>(null)
  const [ai, setAi] = useState<string | null>(null)
  const refresh = async () => {
    const list = await bridge.atlas.list()
    setEntries(list)
    useUI.getState().set({ atlas: list })
  }
  useEffect(() => {
    void refresh()
  }, [])
  const found = new Map(entries.map((e) => [e.id, e]))
  const forms = entries.filter((e) => e.type === 'form')
  const cur = sel ? found.get(sel) ?? null : null
  const def = sel ? DISCOVERIES.find((d) => d.id === sel) : null
  return (
    <div className="screen" data-testid="atlas" style={{ background: 'radial-gradient(ellipse at 20% 80%, #101015 0%, #050506 65%)' }}>
      <ScreenHeader title="Discovery Atlas" line={`Every finding is recorded the first time the medium shows it. ${entries.filter((e) => e.type !== 'form').length} of ${DISCOVERIES.length - 1} kinds found, and ${forms.length} new forms.`} onBack={() => useUI.getState().set({ screen: 'menu' })} />
      <div className="row" style={{ flex: 1, minHeight: 0, alignItems: 'stretch', padding: '0 28px 24px', gap: 16 }}>
        <div className="scroll" style={{ width: 380 }}>
          {DISCOVERIES.filter((d) => d.id !== 'form').map((d) => {
            const e = found.get(d.id)
            return (
              <button key={d.id} className={`card ${sel === d.id ? 'selected' : ''}`} style={{ width: '100%', marginBottom: 6, opacity: e ? 1 : 0.55 }} onClick={() => setSel(d.id)} data-testid={`atlas-${d.id}`}>
                <div className="row">
                  <span className="display" style={{ fontSize: '1.2em' }}>
                    {e ? e.customName ?? e.name : 'Not yet found'}
                  </span>
                  <div className="spacer" />
                  {e && e.count > 1 && <span className="faint">×{e.count}</span>}
                </div>
                <div className="faint">{e ? e.line : d.reproduce}</div>
              </button>
            )
          })}
          {forms.length > 0 && <div className="caps" style={{ margin: '12px 0 6px' }}>New forms</div>}
          {forms.map((e) => (
            <button key={e.id} className={`card ${sel === e.id ? 'selected' : ''}`} style={{ width: '100%', marginBottom: 6 }} onClick={() => setSel(e.id)}>
              <div className="display" style={{ fontSize: '1.2em' }}>
                {e.customName ?? e.name}
              </div>
              <div className="faint">{e.line}</div>
            </button>
          ))}
        </div>
        <div className="panel scroll" style={{ flex: 1, padding: 18 }}>
          {!sel && <div className="muted">Choose a discovery to see what was measured when it happened and how to make it happen again.</div>}
          {sel && !cur && def && (
            <div className="col">
              <span className="display" style={{ fontSize: '2em' }}>
                Not yet found
              </span>
              <span className="muted">A hint at where to look: {def.reproduce}</span>
            </div>
          )}
          {cur && (
            <div className="col" style={{ gap: 10 }} data-testid="atlas-detail">
              {cur.image && <img src={cur.image} alt="" style={{ width: '100%', maxWidth: 560, borderRadius: 8 }} />}
              <input
                type="text"
                defaultValue={cur.customName ?? cur.name}
                key={cur.id}
                maxLength={60}
                className="display"
                style={{ fontSize: '2em', background: 'transparent', border: '1px solid transparent' }}
                onBlur={(e) => void bridge.atlas.update(cur.id, { customName: e.target.value.trim() && e.target.value.trim() !== cur.name ? e.target.value.trim() : null }).then(refresh)}
                title="Give it your own name"
              />
              <span style={{ lineHeight: 1.45 }}>{cur.line}</span>
              <span className="faint">
                First found in {cur.universeName ?? 'an experiment'} ({cur.env}), {new Date(cur.firstAt).toLocaleString()}. Seen {cur.count} time{cur.count > 1 ? 's' : ''}.
              </span>
              <div className="caps">Measured at the time</div>
              <table>
                <tbody>
                  {cur.measurements.map(([k, v]) => (
                    <tr key={k}>
                      <td className="muted" style={{ paddingRight: 14 }}>
                        {k}
                      </td>
                      <td>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="caps">Conditions</div>
              {cur.conditions.map((c) => (
                <span key={c}>{c}</span>
              ))}
              <div className="caps">To make it happen again</div>
              <span>{cur.reproduce}</span>
              <div className="caps">Your notes</div>
              <textarea key={`n-${cur.id}`} defaultValue={cur.notes} onBlur={(e) => void bridge.atlas.update(cur.id, { notes: e.target.value }).then(refresh)} placeholder="Anything you noticed" />
              <div className="row">
                <Btn
                  small
                  onClick={async () => {
                    const input = { summary: Object.fromEntries(cur.measurements.map(([k, v]) => [k, v])), focus: { title: cur.name, facts: Object.fromEntries(cur.conditions.map((c, i) => [`condition${i + 1}`, c])) } }
                    const r = await bridge.ai.run('interpret', input, { userInitiated: true })
                    const text = r.ok ? r.text : `${interpretFeature.local(input)}\n(${r.detail})`
                    setAi(text)
                    if (r.ok) await bridge.atlas.update(cur.id, { ai: r.text }).then(refresh)
                  }}
                  title="An interpretation of this finding (Claude if AI is on; otherwise a local one)"
                >
                  Interpret
                </Btn>
              </div>
              {(ai || cur.ai) && <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.45, padding: 10, background: 'rgba(255,255,255,0.04)', borderRadius: 8 }}>{ai ?? cur.ai}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
