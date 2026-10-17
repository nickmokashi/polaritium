import type { CSSProperties, ReactNode } from 'react'
import { audio } from '../audio/engine'

export function Btn(props: {
  children: ReactNode
  onClick?: () => void
  kind?: 'primary' | 'ghost' | 'danger'
  small?: boolean
  disabled?: boolean
  title?: string
  active?: boolean
  style?: CSSProperties
  testid?: string
}) {
  return (
    <button
      className={`btn ${props.kind ?? ''} ${props.small ? 'small' : ''} ${props.active ? 'active' : ''}`}
      disabled={props.disabled}
      title={props.title}
      style={props.style}
      data-testid={props.testid}
      onClick={() => {
        audio.start()
        audio.ui('click')
        props.onClick?.()
      }}
    >
      {props.children}
    </button>
  )
}

export function Slider(props: { label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string; hint?: string }) {
  return (
    <label className="col" style={{ gap: 4 }} title={props.hint}>
      <span className="row" style={{ justifyContent: 'space-between' }}>
        <span className="muted">{props.label}</span>
        <span>{props.format ? props.format(props.value) : props.value.toFixed(2)}</span>
      </span>
      <input type="range" min={props.min} max={props.max} step={props.step ?? 0.01} value={props.value} onChange={(e) => props.onChange(Number(e.target.value))} />
    </label>
  )
}

export function Toggle(props: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string; testid?: string }) {
  return (
    <label className="row" style={{ cursor: 'pointer', justifyContent: 'space-between', gap: 14 }} title={props.hint}>
      <span>
        {props.label}
        {props.hint && <div className="faint" style={{ fontSize: '0.88em', marginTop: 2 }}>{props.hint}</div>}
      </span>
      <input type="checkbox" checked={props.checked} data-testid={props.testid} onChange={(e) => props.onChange(e.target.checked)} />
    </label>
  )
}

export function Bar({ value, label }: { value: number; label?: string }) {
  return (
    <div className="col" style={{ gap: 3 }}>
      {label && <span className="faint" style={{ fontSize: '0.86em' }}>{label}</span>}
      <div className="bar">
        <i style={{ width: `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%` }} />
      </div>
    </div>
  )
}

export function Modal(props: { title: string; children: ReactNode; onClose?: () => void; width?: number; testid?: string }) {
  return (
    <div className="modal-back" onClick={(e) => e.target === e.currentTarget && props.onClose?.()}>
      <div className="modal panel fade-in scroll" style={{ width: props.width ? `min(${props.width}px, 94vw)` : undefined }} data-testid={props.testid}>
        <div className="row" style={{ marginBottom: 10 }}>
          <div className="display" style={{ fontSize: '1.7em' }}>
            {props.title}
          </div>
          <div className="spacer" />
          {props.onClose && (
            <Btn kind="ghost" small onClick={props.onClose} title="Close this window">
              Close
            </Btn>
          )}
        </div>
        {props.children}
      </div>
    </div>
  )
}

export function ScreenHeader(props: { title: string; line: string; onBack: () => void; right?: ReactNode }) {
  return (
    <div className="row" style={{ padding: '22px 28px 10px', gap: 18, alignItems: 'flex-end' }}>
      <div className="col" style={{ gap: 4 }}>
        <div className="display" style={{ fontSize: '2.6em', lineHeight: 1 }}>
          {props.title}
        </div>
        <div className="muted">{props.line}</div>
      </div>
      <div className="spacer" />
      {props.right}
      <Btn onClick={props.onBack} title="Return to the main menu" testid="back">
        Back
      </Btn>
    </div>
  )
}

const P = {
  hand: 'M8 13V6.5a1.5 1.5 0 0 1 3 0V12m0-6.5V5a1.5 1.5 0 0 1 3 0v7m0-6a1.5 1.5 0 0 1 3 0v6.5m0-4a1.5 1.5 0 0 1 3 0V15c0 4-3 6.5-6.5 6.5S7.5 19 6 16.5L4 13a1.6 1.6 0 0 1 2.6-1.8L8 13',
  seed: 'M12 3v3M12 18v3M3 12h3M18 12h3M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6',
  strand: 'M5 17a2 2 0 1 0 0.1 0M19 7a2 2 0 1 0 0.1 0M6.5 15.5C10 13 13 11 17.5 8.5',
  pull: 'M3 12h6m-3-3l3 3l-3 3M21 12h-6m3-3l-3 3l3 3M12 9v6',
  twist: 'M4 7c4 0 4 10 8 10s4-10 8-10M4 17c4 0 4-10 8-10s4 10 8 10',
  pulse: 'M12 12m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14',
  tune: 'M3 12c2-6 4-6 6 0s4 6 6 0s4-6 6 0',
  fracture: 'M4 4l6 6l-2 3l5 2l-2 5M14 4l2 4l4 1M20 14l-3 1',
  fuse: 'M9 12m-5 0a5 5 0 1 0 10 0a5 5 0 1 0-10 0M15 12m-5 0a5 5 0 1 0 10 0a5 5 0 1 0-10 0',
  veil: 'M12 3a9 9 0 1 0 0.1 0M12 7a5 5 0 1 0 0.1 0',
  lens: 'M10.5 10.5m-6 0a6 6 0 1 0 12 0a6 6 0 1 0-12 0M15 15l6 6M8 10.5h5M10.5 8v5',
  anchor: 'M12 5m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M12 7v13M5 13a7 7 0 0 0 14 0M8 11h8',
  time: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 7v5l3 2',
  sight: 'M2 12c4-7 16-7 20 0c-4 7-16 7-20 0M12 12m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0',
  photo: 'M4 8h3l2-2h6l2 2h3v11H4zM12 13.5m-3.2 0a3.2 3.2 0 1 0 6.4 0a3.2 3.2 0 1 0-6.4 0',
  save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
  spark: 'M12 3l1.8 5.4L19 10l-5.2 1.6L12 17l-1.8-5.4L5 10l5.2-1.6zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  menu: 'M4 7h16M4 12h16M4 17h16',
  play: 'M8 5l11 7l-11 7z',
  pause: 'M8 5v14M16 5v14',
  step: 'M6 5l9 7l-9 7zM18 5v14',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5l-5-5M20 9H10a6 6 0 0 0 0 12h3',
  flag: 'M5 21V4h11l-2 4l2 4H5',
  branch: 'M6 3v12M18 9a3 3 0 1 0 0.1 0M6 21a3 3 0 1 0 0.1 0M18 12c0 4-6 3-12 6',
  help: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 1-1 1.7M12 17h.01'
}

export type IconName = keyof typeof P

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={P[name]} />
    </svg>
  )
}

export function formatTime(ticks: number): string {
  const s = Math.floor(ticks / 30)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

export function uid(): string {
  const a = new Uint8Array(10)
  crypto.getRandomValues(a)
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('')
}
