import { useEffect, useState } from 'react'
import type { AiStatus } from '@core/app/bridge'
import { QUALITY_PRESETS, type Quality, type Settings } from '@core/app/settings'
import { PRESETS as BUDGET_PRESETS, type BudgetView, type ChangeResult, type LedgerEntry } from '@core/budget/controller'
import { formatUsd, usd } from '@core/budget/money'
import { audio } from '../audio/engine'
import { bridge } from '../bridge'
import { applyControlSettings } from '../scene/camera'
import { useUI } from '../state/store'
import { Btn, Modal, ScreenHeader, Slider, Toggle } from './primitives'

type Tab = 'graphics' | 'display' | 'audio' | 'controls' | 'access' | 'ai' | 'budget' | 'data' | 'about'
const TABS: [Tab, string][] = [
  ['graphics', 'Graphics'],
  ['display', 'Display'],
  ['audio', 'Sound'],
  ['controls', 'Controls'],
  ['access', 'Accessibility'],
  ['ai', 'AI'],
  ['budget', 'AI budget'],
  ['data', 'Data and saves'],
  ['about', 'About']
]

export function applySettings(s: Settings): void {
  audio.setVolumes(s.audio)
  audio.captions = s.access.captions
  applyControlSettings(s.controls)
  document.documentElement.style.setProperty('--scale', String(s.display.uiScale * (s.access.largeText ? 1.15 : 1)))
  document.body.classList.toggle('hc', s.access.highContrast)
  document.body.classList.toggle('reduce-motion', s.access.reduceMotion)
}

export function SettingsScreen({ initial }: { initial?: Tab }) {
  const settings = useUI((s) => s.settings)
  const [tab, setTab] = useState<Tab>(initial ?? 'graphics')
  const update = async (patch: (s: Settings) => Settings) => {
    const next = await bridge.settings.set(patch(structuredClone(useUI.getState().settings)))
    useUI.getState().set({ settings: next })
    applySettings(next)
  }
  const g = settings.graphics
  return (
    <div className="screen" data-testid="settings" style={{ background: 'radial-gradient(ellipse at 60% 20%, #101015 0%, #050506 65%)' }}>
      <ScreenHeader title="Settings" line="Every change is saved at once." onBack={() => useUI.getState().set({ screen: 'menu', dialog: null })} />
      <div className="row" style={{ flex: 1, minHeight: 0, alignItems: 'stretch', padding: '0 28px 24px', gap: 18 }}>
        <div className="col" style={{ width: 180 }}>
          {TABS.map(([id, label]) => (
            <Btn key={id} kind="ghost" active={tab === id} onClick={() => setTab(id)} style={{ justifyContent: 'flex-start' }} testid={`settings-${id}`}>
              {label}
            </Btn>
          ))}
        </div>
        <div className="panel scroll" style={{ flex: 1, padding: 20, maxWidth: 780 }}>
          {tab === 'graphics' && (
            <div className="col" style={{ gap: 14 }}>
              <span className="muted">Lower settings run faster on modest graphics chips. Nothing here changes what happens in the simulation, only how it is drawn.</span>
              <div className="row" style={{ gap: 6 }}>
                {(['low', 'balanced', 'high', 'ultra'] as Quality[]).map((q) => (
                  <Btn key={q} active={g.quality === q} onClick={() => void update((s) => ({ ...s, graphics: { ...QUALITY_PRESETS[q] } }))} testid={`quality-${q}`}>
                    {q[0].toUpperCase() + q.slice(1)}
                  </Btn>
                ))}
              </div>
              <Toggle label="Glow (bloom)" hint="Bright things bleed soft light. Costs some speed." checked={g.bloom} onChange={(v) => void update((s) => ({ ...s, graphics: { ...s.graphics, bloom: v } }))} />
              <Slider label="Motes of the medium" hint="How many dust motes show the fields" value={g.dust} min={0} max={30000} step={500} format={(v) => String(v)} onChange={(v) => void update((s) => ({ ...s, graphics: { ...s.graphics, dust: v } }))} />
              <Slider label="Render resolution" hint="Below 1 draws fewer pixels, which is faster" value={g.resolution} min={0.5} max={1.5} step={0.05} onChange={(v) => void update((s) => ({ ...s, graphics: { ...s.graphics, resolution: v } }))} />
              <Toggle label="Limit to 30 frames a second" hint="Steadier and cooler on slower computers" checked={g.fpsCap === 30} onChange={(v) => void update((s) => ({ ...s, graphics: { ...s.graphics, fpsCap: v ? 30 : 60 } }))} />
            </div>
          )}
          {tab === 'display' && (
            <div className="col" style={{ gap: 14 }}>
              <Toggle
                label="Full screen"
                checked={settings.display.fullscreen}
                onChange={async (v) => {
                  const on = await bridge.app.setFullscreen(v)
                  void update((s) => ({ ...s, display: { ...s.display, fullscreen: on } }))
                }}
              />
              <Slider label="Interface size" value={settings.display.uiScale} min={0.8} max={1.6} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => void update((s) => ({ ...s, display: { ...s.display, uiScale: v } }))} />
            </div>
          )}
          {tab === 'audio' && (
            <div className="col" style={{ gap: 14 }}>
              <Toggle label="Mute everything" checked={settings.audio.muted} onChange={(v) => void update((s) => ({ ...s, audio: { ...s.audio, muted: v } }))} />
              {(['master', 'ambience', 'effects', 'interface'] as const).map((k) => (
                <Slider key={k} label={{ master: 'Overall', ambience: 'Ambience and voices', effects: 'Events', interface: 'Interface' }[k]} value={settings.audio[k]} min={0} max={1} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => void update((s) => ({ ...s, audio: { ...s.audio, [k]: v } }))} />
              ))}
            </div>
          )}
          {tab === 'controls' && (
            <div className="col" style={{ gap: 14 }}>
              <Slider label="Look-around speed" value={settings.controls.orbitSpeed} min={0.2} max={3} onChange={(v) => void update((s) => ({ ...s, controls: { ...s.controls, orbitSpeed: v } }))} />
              <Slider label="Flying speed (W A S D)" value={settings.controls.flySpeed} min={0.2} max={3} onChange={(v) => void update((s) => ({ ...s, controls: { ...s.controls, flySpeed: v } }))} />
              <Slider label="Zoom speed" value={settings.controls.zoomSpeed} min={0.2} max={3} onChange={(v) => void update((s) => ({ ...s, controls: { ...s.controls, zoomSpeed: v } }))} />
              <Toggle label="Invert up and down" checked={settings.controls.invertY} onChange={(v) => void update((s) => ({ ...s, controls: { ...s.controls, invertY: v } }))} />
              <span className="faint">Every tool also works without dragging: select something, then use + and −, the arrow keys, or the buttons in the inspector. Press H in an experiment for the full list.</span>
            </div>
          )}
          {tab === 'access' && (
            <div className="col" style={{ gap: 14 }}>
              <Toggle label="Reduce motion" hint="Slower drift, no camera sway" checked={settings.access.reduceMotion} onChange={(v) => void update((s) => ({ ...s, access: { ...s.access, reduceMotion: v } }))} />
              <Toggle label="Reduce flashing" hint="Softens flicker and bright flashes" checked={settings.access.reduceFlashing} onChange={(v) => void update((s) => ({ ...s, access: { ...s.access, reduceFlashing: v } }))} />
              <Toggle label="High-contrast interface" checked={settings.access.highContrast} onChange={(v) => void update((s) => ({ ...s, access: { ...s.access, highContrast: v } }))} />
              <Toggle label="Larger text" checked={settings.access.largeText} onChange={(v) => void update((s) => ({ ...s, access: { ...s.access, largeText: v } }))} />
              <Toggle label="Sound captions" hint="Important sounds are described in words" checked={settings.access.captions} onChange={(v) => void update((s) => ({ ...s, access: { ...s.access, captions: v } }))} />
            </div>
          )}
          {tab === 'ai' && <AiSettings />}
          {tab === 'budget' && <BudgetDashboard />}
          {tab === 'data' && (
            <div className="col" style={{ gap: 14 }}>
              <Slider label="Autosave every" value={settings.data.autosaveMinutes} min={0} max={30} step={1} format={(v) => (v ? `${v} min` : 'never')} onChange={(v) => void update((s) => ({ ...s, data: { ...s.data, autosaveMinutes: v } }))} />
              <span className="faint">Saves are written all at once, with the previous save kept as a backup, so an interrupted save never destroys a good one.</span>
              <Btn
                onClick={async () => {
                  const ok = await bridge.files.openSavesFolder()
                  if (!ok) useUI.getState().toast('The saves folder can be opened from the desktop app.', 'info')
                }}
              >
                Open the saves folder
              </Btn>
              <Btn onClick={() => void bridge.settings.set({ ...useUI.getState().settings, tutorialDone: false }).then((s) => useUI.getState().set({ settings: s }))}>Show the first-steps guide again</Btn>
            </div>
          )}
          {tab === 'about' && (
            <div className="col" style={{ gap: 10, lineHeight: 1.5 }}>
              <span className="display" style={{ fontSize: '1.8em' }}>
                Polaritium 1.0.0
              </span>
              <span>Made by Greygray. Creative imprint: The Grey Strand.</span>
              <span className="muted">Polaritium is a fictional universe. Its light, dark and grey, its strands, crystals and living forms follow rules made for the game. They borrow ideas from real science (feedback, resonance, oscillation, emergence) but prove nothing about the real world.</span>
              <span className="faint">Built with three.js, React, Electron and other open-source software, used under their licences. Fonts: Cormorant Garamond and Inter (SIL Open Font License). All sound is synthesized live by the game.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function AiSettings() {
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [key, setKey] = useState('')
  const [msg, setMsg] = useState('')
  const refresh = async () => setStatus(await bridge.ai.status())
  useEffect(() => {
    void refresh()
  }, [])
  if (!status) return null
  return (
    <div className="col" style={{ gap: 14, lineHeight: 1.5 }} data-testid="ai-settings">
      <span>
        AI is optional. The whole game works without it. With it on, you can ask Claude to interpret experiments, suggest things to try, name what you find and write captions. It only ever sends a request when you press a button for it, and every request passes through the budget first.
      </span>
      {!status.available ? (
        <span className="muted">{status.note}</span>
      ) : (
        <>
          <Toggle
            label={status.enabled ? 'AI is on' : 'AI is off'}
            hint={status.keyPresent ? 'Switching it off stops new requests immediately.' : 'Save a key below first.'}
            checked={status.enabled}
            testid="ai-toggle"
            onChange={async (v) => {
              if (v && !status.keyPresent) {
                setMsg('Save a Claude key first.')
                return
              }
              setStatus(await bridge.ai.setEnabled(v))
            }}
          />
          {status.mock && <span style={{ color: 'var(--amber)' }}>Test mode: a pretend Claude answers. Nothing is sent or billed.</span>}
          <div className="col panel" style={{ padding: 14, gap: 8 }}>
            <span className="caps">Your Claude key</span>
            <span className="muted">
              {status.keyPresent ? 'A key is saved, protected by Windows. The game window never sees it.' : 'No key is saved.'} We suggest a separate workspace in the Anthropic Console named “Polaritium”, with its own monthly spending limit of $10 to start, and a key made in that workspace. If you later raise the game’s allowance, raise that workspace limit too: whichever is lower applies.
            </span>
            <div className="row">
              <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Paste a key that begins sk-ant-" style={{ flex: 1 }} autoComplete="off" />
              <Btn
                onClick={async () => {
                  const r = await bridge.ai.setKey(key.trim())
                  setKey('')
                  setMsg(r.ok ? 'Key saved.' : r.error ?? 'The key was not saved.')
                  void refresh()
                }}
                disabled={!key.trim()}
              >
                Save key
              </Btn>
            </div>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              {status.keyPresent && (
                <Btn
                  small
                  onClick={async () => {
                    const r = await bridge.ai.checkKey()
                    setMsg(r.message)
                  }}
                  title="Asks Anthropic which models the key can use. This is free: it does not use any tokens."
                >
                  Check the key (free)
                </Btn>
              )}
              {status.keyPresent && (
                <Btn small kind="danger" onClick={async () => setStatus(await bridge.ai.clearKey())}>
                  Remove the key
                </Btn>
              )}
              <Btn small kind="ghost" onClick={() => void bridge.app.openLink('workspaces')}>
                How workspaces work
              </Btn>
              <Btn small kind="ghost" onClick={() => void bridge.app.openLink('console')}>
                Open the Anthropic Console
              </Btn>
            </div>
            {msg && <span>{msg}</span>}
          </div>
          <span className="faint">
            Models: {status.lightModel} for everything by default; {status.deepModel} only for deeper readings you ask for, and only if you allow it in the AI budget tab. Opus, Fable and other premium models are never used unless you allow them.
          </span>
        </>
      )}
    </div>
  )
}

export function BudgetDashboard() {
  const [v, setV] = useState<BudgetView | null>(null)
  const [ledger, setLedger] = useState<LedgerEntry[]>([])
  const [pending, setPending] = useState<ChangeResult | null>(null)
  const [custom, setCustom] = useState('')
  const [msg, setMsg] = useState('')
  const refresh = async () => {
    setV(await bridge.ai.budget.view())
    setLedger(await bridge.ai.budget.ledger(60))
  }
  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), 3000)
    return () => clearInterval(t)
  }, [])
  if (!v) return null
  const propose = async (req: Parameters<typeof bridge.ai.budget.propose>[0]) => {
    const r = await bridge.ai.budget.propose(req)
    if (r.status === 'needs_confirmation') setPending(r)
    else if (r.status === 'rejected') setMsg(r.error)
    else if (r.status === 'deferred') setMsg(r.summary.join(' '))
    else setMsg('Changed.')
    void refresh()
  }
  const row = (label: string, value: string) => (
    <tr>
      <td className="muted" style={{ padding: '3px 14px 3px 0' }}>
        {label}
      </td>
      <td>{value}</td>
    </tr>
  )
  return (
    <div className="col" style={{ gap: 14 }} data-testid="budget-dashboard">
      <span className="muted" style={{ lineHeight: 1.5 }}>
        This is Polaritium’s own record of what it has spent on Claude, kept here on this computer. Your Anthropic account’s billing is separate and has the final word.
      </span>
      <div className="row" style={{ gap: 26, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <table>
          <tbody>
            {row('AI', v.aiEnabled ? 'on' : 'off')}
            {row('Monthly allowance', formatUsd(v.limits.monthly, 2))}
            {row('Spent this month', formatUsd(v.spentMonth, 4))}
            {row('Remaining', formatUsd(v.remainingMonth, 4))}
            {row('Reserved for requests on their way', formatUsd(v.reservedNow, 4))}
            {row('Held for uncertain requests', formatUsd(v.uncertainMonth, 4))}
            {row('Today', `${formatUsd(v.spentToday, 4)} of ${formatUsd(v.limits.daily, 2)}`)}
            {row('This session', `${formatUsd(v.spentSession, 4)} of ${formatUsd(v.limits.session, 2)}`)}
            {row('Most one request may cost', formatUsd(v.limits.perRequest, 2))}
            {row('Requests this month', String(v.totalRequests))}
            {row('Model', v.lightModel)}
            {row('Next monthly reset', new Date(v.nextReset).toLocaleString())}
            {row('Accounting time zone', v.timezone)}
          </tbody>
        </table>
        <div className="col" style={{ gap: 6 }}>
          <span className="caps">By feature</span>
          {Object.entries(v.byFeature).map(([k, x]) => (
            <span key={k}>
              {k}: {x.requests} · {formatUsd(x.cost, 4)}
            </span>
          ))}
          {!Object.keys(v.byFeature).length && <span className="faint">Nothing yet.</span>}
          <span className="caps" style={{ marginTop: 8 }}>
            By model
          </span>
          {Object.entries(v.byModel).map(([k, x]) => (
            <span key={k}>
              {k}: {x.requests} · {formatUsd(x.cost, 4)}
            </span>
          ))}
        </div>
      </div>
      <div className="col panel" style={{ padding: 14, gap: 8 }}>
        <span className="caps">Monthly allowance</span>
        <span className="muted">Lowering takes effect at once. Raising always asks you to confirm.</span>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {BUDGET_PRESETS.map((p) => (
            <Btn key={p.label} small active={v.limits.monthly === p.monthly} onClick={() => void propose({ limits: { monthly: p.monthly } })} testid={`budget-${p.monthly}`}>
              {p.label}
            </Btn>
          ))}
          <input type="number" min={0} max={1000} step={1} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Custom $" style={{ width: 100 }} />
          <Btn small disabled={!custom} onClick={() => void propose({ limits: { monthly: usd(Math.max(0, Number(custom))) } })}>
            Set
          </Btn>
        </div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 14 }}>
          <label className="col">
            <span className="muted">Daily</span>
            <BudgetField value={v.limits.daily} onSet={(m) => void propose({ limits: { daily: m } })} />
          </label>
          <label className="col">
            <span className="muted">Per session</span>
            <BudgetField value={v.limits.session} onSet={(m) => void propose({ limits: { session: m } })} />
          </label>
          <label className="col">
            <span className="muted">Per request</span>
            <BudgetField value={v.limits.perRequest} onSet={(m) => void propose({ limits: { perRequest: m } })} />
          </label>
        </div>
        <Toggle label="Allow the deeper model for readings you ask for" hint={`${v.deepModel}: about twenty times the cost of ${v.lightModel}`} checked={v.allowDeep} onChange={(on) => void propose({ allowDeep: on })} />
        <Toggle label="Automatic enrichment" hint={`Names new discoveries by itself while you play, from its own allowance of ${formatUsd(v.limits.enrichMonthly, 2)} a month. Never while paused or idle.`} checked={v.autoEnrich} onChange={(on) => void propose({ autoEnrich: on })} />
        {msg && <span>{msg}</span>}
      </div>
      {v.rejections.length > 0 && (
        <div className="col" style={{ gap: 4 }}>
          <span className="caps">Recently refused</span>
          {v.rejections.slice(0, 6).map((r, i) => (
            <span key={i} className="faint">
              {new Date(r.at).toLocaleTimeString()} · {r.feature}: {r.detail}
            </span>
          ))}
        </div>
      )}
      <div className="col" style={{ gap: 4 }}>
        <div className="row">
          <span className="caps">Ledger</span>
          <div className="spacer" />
          <Btn small onClick={() => void bridge.ai.budget.exportCsv()}>
            Export as CSV
          </Btn>
        </div>
        <table style={{ width: '100%', fontSize: '0.92em' }}>
          <thead>
            <tr className="faint">
              <td>When</td>
              <td>Feature</td>
              <td>Model</td>
              <td>Status</td>
              <td>Reserved</td>
              <td>Actual</td>
              <td>Tokens in/out</td>
            </tr>
          </thead>
          <tbody>
            {ledger.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.createdAt).toLocaleString()}</td>
                <td>{e.feature}</td>
                <td>{e.model.replace('claude-', '')}</td>
                <td title={e.note ?? ''}>{e.status}</td>
                <td>{formatUsd(e.reserved, 4)}</td>
                <td>{e.actual === null ? '—' : formatUsd(e.actual, 4)}</td>
                <td>{e.inputTokens === null ? '—' : `${e.inputTokens}/${e.outputTokens}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!ledger.length && <span className="faint">No requests yet.</span>}
      </div>
      {pending?.status === 'needs_confirmation' && (
        <Modal title="Confirm a higher allowance" onClose={() => setPending(null)} testid="budget-confirm">
          <div className="col" style={{ gap: 8, lineHeight: 1.5 }}>
            {pending.summary.map((s) => (
              <span key={s}>{s}</span>
            ))}
            <div className="row">
              <Btn
                kind="primary"
                testid="budget-confirm-yes"
                onClick={async () => {
                  const r = await bridge.ai.budget.confirm(pending.token)
                  setPending(null)
                  setMsg(r.status === 'applied' ? 'Raised.' : r.status === 'rejected' ? r.error : r.summary.join(' '))
                  void refresh()
                }}
              >
                Yes, change it
              </Btn>
              <Btn onClick={() => setPending(null)}>Keep it as it is</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function BudgetField({ value, onSet }: { value: number; onSet: (m: number) => void }) {
  const [t, setT] = useState((value / 1e6).toFixed(2))
  useEffect(() => setT((value / 1e6).toFixed(2)), [value])
  return (
    <span className="row" style={{ gap: 4 }}>
      $
      <input type="number" min={0} step={0.01} value={t} onChange={(e) => setT(e.target.value)} style={{ width: 80 }} />
      <Btn small onClick={() => onSet(usd(Math.max(0, Number(t) || 0)))}>
        Set
      </Btn>
    </span>
  )
}
