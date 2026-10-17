import type { EnvId, SimEvent } from '@core/sim/types'

// All sound is synthesized here at run time: no recordings, nothing licensed. Ambience is a
// slow drone per environment; the strongest nearby concentrations sing at pitches taken from
// their own rhythm; events (fractures, collapses, births, discoveries) make their own sounds.
// Event sounds are rate-limited so thousands of events never turn into noise.

type Bus = 'ambience' | 'effects' | 'interface'

const PENTA = [0, 3, 5, 7, 10]

export function pitchOf(freqHz: number, base = 110): number {
  const steps = Math.round(Math.log2(Math.max(0.05, freqHz) / 0.1) * 5)
  const oct = Math.floor(steps / 5)
  const deg = ((steps % 5) + 5) % 5
  return base * Math.pow(2, oct + PENTA[deg] / 12)
}

interface Voice {
  osc: OscillatorNode
  osc2: OscillatorNode
  gain: GainNode
  pan: StereoPannerNode
}

class Engine {
  ctx: AudioContext | null = null
  master!: GainNode
  buses!: Record<Bus, GainNode>
  reverb!: ConvolverNode
  reverbSend!: GainNode
  private ambience: { stop: () => void; set?: (x: number) => void } | null = null
  private voices: Voice[] = []
  private last = new Map<string, number>()
  private recent: number[] = []
  private tuneVoice: { osc: OscillatorNode; gain: GainNode } | null = null
  private interference: { a: OscillatorNode; b: OscillatorNode; gain: GainNode } | null = null
  onCaption: ((text: string) => void) | null = null
  captions = false
  private env: EnvId | null = null
  private volumes = { master: 0.8, ambience: 0.7, effects: 0.8, interface: 0.6, muted: false }

  /** Must be called from a user gesture the first time. */
  start(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume()
      return
    }
    try {
      this.ctx = new AudioContext()
    } catch {
      return
    }
    const ctx = this.ctx
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -16
    comp.ratio.value = 4
    this.master = ctx.createGain()
    this.master.connect(comp).connect(ctx.destination)
    this.buses = { ambience: ctx.createGain(), effects: ctx.createGain(), interface: ctx.createGain() }
    for (const b of Object.values(this.buses)) b.connect(this.master)
    this.reverb = ctx.createConvolver()
    this.reverb.buffer = this.impulse(3.6)
    this.reverbSend = ctx.createGain()
    this.reverbSend.gain.value = 0.5
    this.reverbSend.connect(this.reverb).connect(this.master)
    for (let i = 0; i < 6; i++) {
      const osc = ctx.createOscillator()
      const osc2 = ctx.createOscillator()
      const gain = ctx.createGain()
      const pan = ctx.createStereoPanner()
      osc.type = 'sine'
      osc2.type = 'triangle'
      gain.gain.value = 0
      osc.connect(gain)
      osc2.connect(gain)
      gain.connect(pan).connect(this.buses.ambience)
      pan.connect(this.reverbSend)
      osc.start()
      osc2.start()
      this.voices.push({ osc, osc2, gain, pan })
    }
    this.applyVolumes()
    if (this.env) this.setEnvironment(this.env)
  }

  private impulse(seconds: number): AudioBuffer {
    const ctx = this.ctx!
    const len = Math.floor(ctx.sampleRate * seconds)
    const buf = ctx.createBuffer(2, len, ctx.sampleRate)
    let s = 4242
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c)
      for (let i = 0; i < len; i++) {
        s = (s * 1664525 + 1013904223) >>> 0
        d[i] = ((s / 4294967296) * 2 - 1) * Math.pow(1 - i / len, 2.6)
      }
    }
    return buf
  }

  setVolumes(v: { master: number; ambience: number; effects: number; interface: number; muted: boolean }): void {
    this.volumes = v
    this.applyVolumes()
  }

  private applyVolumes(): void {
    if (!this.ctx) return
    const v = this.volumes
    const t = this.ctx.currentTime
    this.master.gain.setTargetAtTime(v.muted ? 0 : v.master, t, 0.1)
    this.buses.ambience.gain.setTargetAtTime(v.ambience, t, 0.1)
    this.buses.effects.gain.setTargetAtTime(v.effects, t, 0.1)
    this.buses.interface.gain.setTargetAtTime(v.interface, t, 0.1)
  }

  setEnvironment(env: EnvId | null): void {
    this.env = env
    this.ambience?.stop()
    this.ambience = null
    if (!this.ctx || !env) return
    const ctx = this.ctx
    const out = ctx.createGain()
    out.gain.value = 0
    out.gain.setTargetAtTime(0.32, ctx.currentTime, 2.5)
    out.connect(this.buses.ambience)
    out.connect(this.reverbSend)
    const nodes: AudioScheduledSourceNode[] = []
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 600
    lp.Q.value = 0.6
    lp.connect(out)
    const lfo = ctx.createOscillator()
    const lfoGain = ctx.createGain()
    lfo.frequency.value = 0.05
    lfoGain.gain.value = 260
    lfo.connect(lfoGain).connect(lp.frequency)
    lfo.start()
    nodes.push(lfo)
    const notes: Record<EnvId, number[]> = {
      cradle: [55, 82.4, 110.2],
      cathedral: [65.4, 82.4, 98, 130.8],
      garden: [49, 73.4, 77.8],
      well: [36.7, 55, 36.9],
      threshold: [58.3, 87.3, 116.5],
      genesis: [41.2, 61.7]
    }
    for (const [i, f] of notes[env].entries()) {
      const o = ctx.createOscillator()
      o.type = i % 2 ? 'triangle' : 'sine'
      o.frequency.value = f
      o.detune.value = (i - 1) * 6
      const g = ctx.createGain()
      g.gain.value = 0.22 / (i + 1)
      o.connect(g).connect(lp)
      o.start()
      nodes.push(o)
    }
    // air: a quiet band of filtered noise
    const noise = ctx.createBufferSource()
    noise.buffer = this.noiseBuffer(4)
    noise.loop = true
    const bp = ctx.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = env === 'cathedral' ? 2600 : env === 'well' ? 300 : 1400
    bp.Q.value = 0.7
    const ng = ctx.createGain()
    ng.gain.value = env === 'genesis' ? 0.015 : 0.035
    noise.connect(bp).connect(ng).connect(out)
    noise.start()
    nodes.push(noise)
    this.ambience = {
      stop: () => {
        const t = ctx.currentTime
        out.gain.setTargetAtTime(0, t, 0.6)
        setTimeout(() => {
          for (const n of nodes) {
            try {
              n.stop()
            } catch {
              /* already stopped */
            }
          }
          out.disconnect()
        }, 2500)
      }
    }
  }

  private noiseBuffer(seconds: number): AudioBuffer {
    const ctx = this.ctx!
    const len = Math.floor(ctx.sampleRate * seconds)
    const buf = ctx.createBuffer(1, len, ctx.sampleRate)
    const d = buf.getChannelData(0)
    let s = 99
    for (let i = 0; i < len; i++) {
      s = (s * 1664525 + 1013904223) >>> 0
      d[i] = (s / 4294967296) * 2 - 1
    }
    return buf
  }

  /** The strongest nearby concentrations sing, each at the pitch of its own rhythm. */
  setVoices(list: { freq: number; gain: number; pan: number; kind: number }[]): void {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i]
      const s = list[i]
      if (!s) {
        v.gain.gain.setTargetAtTime(0, t, 0.4)
        continue
      }
      const base = s.kind === 0 ? 55 : s.kind === 1 ? 220 : 110
      const f = pitchOf(s.freq, base)
      v.osc.frequency.setTargetAtTime(f, t, 0.3)
      v.osc2.frequency.setTargetAtTime(f * (s.kind === 2 ? 2.76 : 2), t, 0.3)
      v.gain.gain.setTargetAtTime(Math.min(0.05, s.gain * 0.05), t, 0.5)
      v.pan.pan.setTargetAtTime(Math.max(-0.9, Math.min(0.9, s.pan)), t, 0.3)
    }
  }

  /** Two tones that beat against each other when a strand's ends are out of step. */
  setInterference(level: number, beatHz: number, baseHz = 165): void {
    if (!this.ctx) return
    const ctx = this.ctx
    if (!this.interference) {
      const a = ctx.createOscillator()
      const b = ctx.createOscillator()
      const gain = ctx.createGain()
      gain.gain.value = 0
      a.connect(gain)
      b.connect(gain)
      gain.connect(this.buses.effects)
      a.start()
      b.start()
      this.interference = { a, b, gain }
    }
    const t = ctx.currentTime
    this.interference.a.frequency.setTargetAtTime(baseHz, t, 0.2)
    this.interference.b.frequency.setTargetAtTime(baseHz + Math.min(8, beatHz), t, 0.2)
    this.interference.gain.gain.setTargetAtTime(Math.min(0.04, level * 0.04), t, 0.3)
  }

  tune(freq: number | null): void {
    if (!this.ctx) return
    const ctx = this.ctx
    if (freq === null) {
      if (this.tuneVoice) {
        const v = this.tuneVoice
        v.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.15)
        setTimeout(() => v.osc.stop(), 600)
        this.tuneVoice = null
      }
      return
    }
    if (!this.tuneVoice) {
      const osc = ctx.createOscillator()
      osc.type = 'triangle'
      const gain = ctx.createGain()
      gain.gain.value = 0
      osc.connect(gain).connect(this.buses.interface)
      gain.connect(this.reverbSend)
      osc.start()
      this.tuneVoice = { osc, gain }
    }
    this.tuneVoice.osc.frequency.setTargetAtTime(pitchOf(freq, 220), ctx.currentTime, 0.03)
    this.tuneVoice.gain.gain.setTargetAtTime(0.07, ctx.currentTime, 0.05)
  }

  private allow(type: string, minGapMs: number): boolean {
    const now = performance.now()
    if ((this.last.get(type) ?? 0) + minGapMs > now) return false
    this.recent = this.recent.filter((t) => now - t < 1000)
    if (this.recent.length > 10) return false
    this.recent.push(now)
    this.last.set(type, now)
    return true
  }

  private tone(f: number, dur: number, gain: number, type: OscillatorType = 'sine', bus: Bus = 'effects', glideTo?: number, reverb = 0.4): void {
    const ctx = this.ctx!
    const t = ctx.currentTime
    const o = ctx.createOscillator()
    o.type = type
    o.frequency.setValueAtTime(f, t)
    if (glideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, glideTo), t + dur)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(gain, t + Math.min(0.02, dur * 0.2))
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    o.connect(g).connect(this.buses[bus])
    if (reverb > 0) {
      const r = ctx.createGain()
      r.gain.value = reverb
      g.connect(r).connect(this.reverbSend)
    }
    o.start(t)
    o.stop(t + dur + 0.05)
  }

  private noise(dur: number, gain: number, freq: number, q = 1, sweepTo?: number): void {
    const ctx = this.ctx!
    const t = ctx.currentTime
    const src = ctx.createBufferSource()
    src.buffer = this.noiseBuffer(Math.max(0.2, dur))
    const f = ctx.createBiquadFilter()
    f.type = 'bandpass'
    f.frequency.setValueAtTime(freq, t)
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur)
    f.Q.value = q
    const g = ctx.createGain()
    g.gain.setValueAtTime(gain, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
    src.connect(f).connect(g).connect(this.buses.effects)
    g.connect(this.reverbSend)
    src.start(t)
    src.stop(t + dur + 0.05)
  }

  private chord(root: number, intervals: number[], dur: number, gain: number, spread = 0): void {
    intervals.forEach((iv, i) => {
      setTimeout(() => this.ctx && this.tone(root * Math.pow(2, iv / 12), dur, gain / intervals.length, 'sine', 'effects', undefined, 0.8), i * spread * 1000)
    })
  }

  private cap(text: string): void {
    if (this.captions) this.onCaption?.(text)
  }

  event(e: SimEvent): void {
    if (!this.ctx || this.ctx.state !== 'running') return
    const v = e.value ?? 0
    switch (e.type) {
      case 'fire':
        if (this.allow('fire', 110)) this.tone(1100 + (e.a ?? 0) % 7 * 80, 0.07, 0.025, 'sine', 'effects', undefined, 0.3)
        break
      case 'fracture':
      case 'cut':
        if (this.allow('fracture', 120)) {
          this.noise(0.35, 0.18, 1800, 1.2, 400)
          this.tone(140, 0.45, 0.2, 'sine', 'effects', 40, 0.5)
          this.cap('A sharp crack.')
        }
        break
      case 'collapse':
        if (this.allow('collapse', 400)) {
          this.tone(85, 1.8, 0.35, 'sine', 'effects', 24, 0.9)
          this.noise(1.6, 0.12, 300, 0.6, 60)
          this.cap('A deep collapse.')
        }
        break
      case 'shatter':
        if (this.allow('shatter', 300)) {
          for (let i = 0; i < 6; i++) this.tone(1800 + i * 430, 0.5 + i * 0.05, 0.04, 'triangle', 'effects', undefined, 0.8)
          this.noise(0.4, 0.08, 4000, 2)
          this.cap('Light breaking apart.')
        }
        break
      case 'birth':
        if (this.allow('birth', 300)) {
          this.chord(pitchOf(0.4, 220), [0, 12, 19, 24], 2.6, 0.18, 0.05)
          this.cap('A clear chime: something was born.')
        }
        break
      case 'ringFormed':
        if (this.allow('ring', 400)) this.chord(pitchOf(0.3, 110), [0, 7, 12], 3, 0.14, 0.15)
        break
      case 'membrane':
        if (this.allow('membrane', 400)) {
          this.chord(pitchOf(0.25, 110), [0, 4, 7, 11], 3.5, 0.16, 0.2)
          this.cap('A soft swell: a boundary closed.')
        }
        break
      case 'quickening':
        if (this.allow('quick', 400)) {
          this.chord(pitchOf(0.35, 220), [0, 3, 7, 10, 15], 2.4, 0.2, 0.12)
          this.cap('A rising call: something began to move.')
        }
        break
      case 'pulse':
        if (this.allow('pulse', 80)) {
          this.noise(0.6, 0.06 + v * 0.01, 900, 0.8, 200)
          this.tone(90, 0.5, 0.08 + v * 0.015, 'sine', 'effects', 45, 0.6)
        }
        break
      case 'quake':
        if (this.allow('quake', 1000)) {
          this.noise(2.2, 0.16, 120, 0.5, 50)
          this.tone(48, 2.2, 0.18, 'sine', 'effects', 30, 0.7)
          this.cap('The ground shakes.')
        }
        break
      case 'crystal':
        if (this.allow('crystal', 200)) this.tone(2400, 0.6, 0.05, 'sine', 'effects', undefined, 0.9)
        break
      case 'crystalBreak':
        if (this.allow('cbreak', 90)) this.tone(2900 + Math.random() * 800, 0.35, 0.05, 'triangle', 'effects', undefined, 0.8)
        break
      case 'division':
        if (this.allow('division', 150)) this.tone(660, 0.18, 0.04, 'sine', 'effects', 880, 0.5)
        break
      case 'death':
        if (this.allow('death', 250)) this.tone(330, 0.9, 0.04, 'sine', 'effects', 160, 0.6)
        break
      case 'transform':
        if (this.allow('transform', 300)) this.chord(pitchOf(0.5, 110), [0, 6, 12], 2, 0.15, 0.1)
        break
      case 'fuse':
        if (this.allow('fuse', 200)) this.tone(220, 0.9, 0.12, 'triangle', 'effects', 330, 0.7)
        break
      case 'finding':
        if (this.allow('finding', 500)) this.chord(pitchOf(0.6, 440), [0, 7, 12, 16], 3, 0.14, 0.18)
        break
      case 'law':
        if (this.allow('law', 800)) {
          this.tone(55, 5, 0.3, 'sine', 'effects', undefined, 1)
          this.tone(110.5, 5, 0.12, 'triangle', 'effects', undefined, 1)
          this.cap('A deep resonance: a new law of the medium.')
        }
        break
    }
  }

  ui(kind: 'click' | 'open' | 'confirm' | 'error'): void {
    if (!this.ctx || this.ctx.state !== 'running') return
    if (!this.allow(`ui-${kind}`, 40)) return
    if (kind === 'click') this.tone(1500, 0.05, 0.03, 'sine', 'interface', undefined, 0)
    else if (kind === 'open') this.tone(700, 0.18, 0.03, 'sine', 'interface', 1050, 0.2)
    else if (kind === 'confirm') this.chord(880, [0, 7], 0.5, 0.06, 0.04)
    else this.tone(220, 0.25, 0.05, 'triangle', 'interface', 160, 0)
  }

  pluck(tension: number, length: number): void {
    if (!this.ctx || this.ctx.state !== 'running') return
    const f = Math.max(70, Math.min(1400, (90 + Math.sqrt(Math.max(0.05, Math.abs(tension) + 0.3)) * 120) * (12 / Math.max(3, length))))
    this.tone(f, 1.6, 0.12, 'triangle', 'effects', f * 0.995, 0.7)
    this.tone(f * 2.01, 0.9, 0.04, 'sine', 'effects', undefined, 0.6)
  }
}

export const audio = new Engine()
