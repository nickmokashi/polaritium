import { useEffect, useRef, useState } from 'react'
import { localCaption, type Tone } from '@core/ai/features'
import { bridge } from '../bridge'
import { view } from '../scene/shared'
import { capture } from '../scene/Scene'
import { useUI } from '../state/store'
import { Btn, Modal } from './primitives'

// Pictures to keep or share. The image is rendered fresh at the chosen size, then text is
// laid over it here. Captions are written locally from the measurements; Claude can write
// one instead if AI is on. Nothing is ever published automatically.

const SIZES = [
  { id: 'square', label: 'Square (1080 × 1080)', w: 1080, h: 1080 },
  { id: 'portrait', label: 'Portrait (1080 × 1350)', w: 1080, h: 1350 },
  { id: 'wide', label: 'Wide (1920 × 1080)', w: 1920, h: 1080 },
  { id: 'card', label: 'Share card for links (1200 × 630)', w: 1200, h: 630 }
]
type Layout = 'image' | 'title' | 'explain' | 'measure' | 'caption'
const LAYOUTS: { id: Layout; label: string }[] = [
  { id: 'image', label: 'Image only' },
  { id: 'title', label: 'With title' },
  { id: 'explain', label: 'With explanation' },
  { id: 'measure', label: 'With measurements' },
  { id: 'caption', label: 'With a caption' }
]
const TONES: Tone[] = ['scientific', 'accessible', 'poetic', 'mystical', 'cryptic']

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const t = line ? `${line} ${w}` : w
    if (ctx.measureText(t).width > maxW && line) {
      lines.push(line)
      line = w
    } else line = t
  }
  if (line) lines.push(line)
  return lines
}

export function ExportDialog({ title, onClose }: { title: string; onClose: () => void }) {
  const [size, setSize] = useState(SIZES[3])
  const [layout, setLayout] = useState<Layout>('title')
  const [tone, setTone] = useState<Tone>('poetic')
  const [heading, setHeading] = useState(title)
  const [text, setText] = useState('')
  const [summary, setSummary] = useState<Record<string, number | string> | null>(null)
  const [raw, setRaw] = useState<string | null>(null)
  const [out, setOut] = useState<string | null>(null)
  const [aiNote, setAiNote] = useState('')
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    void view.host?.req<Record<string, number | string>>('summary').then((s) => setSummary(s ?? null))
  }, [])

  useEffect(() => {
    setRaw(null)
    capture.pending = { width: size.w, height: size.h, resolve: setRaw }
  }, [size])

  useEffect(() => {
    if (!summary) return
    if (layout === 'caption') setText(localCaption(tone, summary))
    else if (layout === 'explain') setText(`${summary.light} light and ${summary.dark} dark, joined by ${summary.strands} strands in ${summary.environment}. ${Number(summary.rings) ? `${summary.rings} rings closed. ` : ''}${Number(summary.organisms) ? `${summary.organisms} living forms.` : ''}`.trim())
  }, [layout, tone, summary])

  useEffect(() => {
    if (!raw || !canvas.current) return
    const c = canvas.current
    c.width = size.w
    c.height = size.h
    const ctx = c.getContext('2d')!
    const img = new Image()
    img.onload = async () => {
      await document.fonts.load('64px "Cormorant Garamond"').catch(() => null)
      await document.fonts.load('24px "Inter"').catch(() => null)
      ctx.drawImage(img, 0, 0, size.w, size.h)
      const u = size.w / 1200
      if (layout !== 'image') {
        const panelH = layout === 'title' ? 150 * u : 260 * u
        const g = ctx.createLinearGradient(0, size.h - panelH * 1.6, 0, size.h)
        g.addColorStop(0, 'rgba(5,5,6,0)')
        g.addColorStop(1, 'rgba(5,5,6,0.88)')
        ctx.fillStyle = g
        ctx.fillRect(0, size.h - panelH * 1.6, size.w, panelH * 1.6)
        const pad = 56 * u
        let y = size.h - panelH + 30 * u
        ctx.fillStyle = '#f2f2f6'
        ctx.font = `500 ${54 * u}px "Cormorant Garamond", Georgia, serif`
        ctx.fillText(heading, pad, y)
        y += 42 * u
        ctx.font = `${21 * u}px Inter, "Segoe UI", sans-serif`
        ctx.fillStyle = 'rgba(232,232,238,0.86)'
        if (layout === 'measure' && summary) {
          const items = [
            ['Light', summary.light],
            ['Dark', summary.dark],
            ['Grey', summary.grey],
            ['Strands', summary.strands],
            ['In step', summary.lockedStrands],
            ['Rings', summary.rings],
            ['Life', summary.organisms],
            ['Seconds', summary.seconds]
          ]
          items.forEach(([k, v], i) => {
            const x = pad + (i % 4) * 230 * u
            const yy = y + Math.floor(i / 4) * 34 * u
            ctx.fillStyle = 'rgba(200,200,210,0.65)'
            ctx.fillText(String(k), x, yy)
            ctx.fillStyle = '#ffffff'
            ctx.fillText(String(v), x + 120 * u, yy)
          })
        } else if (text) {
          for (const line of wrap(ctx, text, size.w - pad * 2).slice(0, 4)) {
            ctx.fillText(line, pad, y)
            y += 30 * u
          }
        }
      }
      ctx.font = `${13 * u}px Inter, sans-serif`
      ctx.fillStyle = 'rgba(220,220,230,0.55)'
      ctx.save()
      ctx.letterSpacing = `${4 * u}px`
      ctx.fillText('POLARITIUM', size.w - 150 * u, 34 * u)
      ctx.restore()
      setOut(c.toDataURL('image/png'))
    }
    img.src = raw
  }, [raw, layout, heading, text, summary, size])

  const askClaude = async () => {
    if (!summary) return
    setAiNote('Asking…')
    const r = await bridge.ai.run('caption', { tone, title: heading, facts: summary }, { userInitiated: true })
    if (r.ok) {
      const d = r.data as { title?: string; caption?: string }
      if (d.title) setHeading(d.title)
      setText(d.caption ?? r.text)
      setLayout('caption')
      setAiNote(r.cached ? 'Written by Claude earlier (remembered, no cost).' : 'Written by Claude.')
    } else {
      setText(r.fallback)
      setAiNote(`Local caption. ${r.detail}`)
    }
  }

  return (
    <Modal title="Take a picture" onClose={onClose} width={820} testid="export-dialog">
      <div className="row" style={{ alignItems: 'flex-start', gap: 16 }}>
        <div className="col" style={{ width: 300 }}>
          <span className="muted">Choose a size and what to put on it, then save it as a picture file.</span>
          <select value={size.id} onChange={(e) => setSize(SIZES.find((s) => s.id === e.target.value)!)}>
            {SIZES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
            {LAYOUTS.map((l) => (
              <Btn key={l.id} small active={layout === l.id} onClick={() => setLayout(l.id)}>
                {l.label}
              </Btn>
            ))}
          </div>
          {layout !== 'image' && <input type="text" value={heading} onChange={(e) => setHeading(e.target.value)} maxLength={60} placeholder="Title" />}
          {(layout === 'caption' || layout === 'explain') && (
            <>
              {layout === 'caption' && (
                <select value={tone} onChange={(e) => setTone(e.target.value as Tone)} title="The voice of the caption">
                  {TONES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              )}
              <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={300} />
              <Btn small onClick={() => void askClaude()} title="Let Claude write the caption (only if AI is switched on; otherwise a local one is used)">
                Write it with Claude
              </Btn>
              {aiNote && <span className="faint">{aiNote}</span>}
            </>
          )}
          <Btn
            kind="primary"
            disabled={!out}
            testid="export-save"
            onClick={async () => {
              if (!out) return
              const r = await bridge.files.saveImage(out, `${heading.replace(/[^\w\- ]+/g, '').trim() || 'Polaritium'} ${size.w}x${size.h}.png`)
              useUI.getState().toast(r.ok ? 'Picture saved.' : `The picture was not saved${r.error ? `: ${r.error}` : '.'}`, 'info')
              if (r.ok) onClose()
            }}
          >
            Save picture
          </Btn>
        </div>
        <div style={{ flex: 1 }}>
          <canvas ref={canvas} style={{ width: '100%', borderRadius: 8, border: '1px solid var(--line)', background: '#000' }} data-testid="export-preview" />
          {!out && <div className="faint">Rendering…</div>}
        </div>
      </div>
    </Modal>
  )
}
