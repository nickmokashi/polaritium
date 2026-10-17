import type { FeatureSpec } from './service'
import { DISCOVERIES } from '../sim/discovery'

// What Claude may be asked, and what the game says without it. Every request carries a small
// structured summary measured from the simulation, never a history. Replies are JSON, checked
// against a schema, and shown as interpretation, kept apart from what was measured.

const BASE = `You are a quiet companion inside Polaritium, a fictional 3D sandbox where a medium expresses itself as light (emits energy), dark (absorbs it) and grey (mediates and transforms), joined by silver strands that carry flow, tension and rhythm. Everything you are told was measured by the game. Never state as fact anything not in the data. Keep fictional mechanics fictional: do not claim the game proves anything about real physics, consciousness or spirit. Plain words. No preaching, no moral of the story.`

type Facts = Record<string, number | string>

function json<T>(text: string, check: (x: any) => x is T): T | null {
  try {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end < start) return null
    const v = JSON.parse(text.slice(start, end + 1))
    return check(v) ? v : null
  } catch {
    return null
  }
}

const isStr = (x: unknown, max = 1200): x is string => typeof x === 'string' && x.trim().length > 0 && x.length <= max
const facts = (f: Facts) => JSON.stringify(f)

export interface InterpretInput {
  summary: Facts
  focus?: { title: string; facts: Facts } | null
}

export const interpretFeature: FeatureSpec<InterpretInput> = {
  id: 'interpret',
  deep: true,
  build(i) {
    return {
      system: `${BASE} Explain an experiment's state. First what the numbers show, then, separately and clearly marked as a guess, what might be happening.`,
      user: `Experiment summary: ${facts(i.summary)}${i.focus ? `\nSelected: ${i.focus.title} ${facts(i.focus.facts)}` : ''}\nReply as JSON: {"observed": "what the measurements show, two sentences at most", "hypothesis": "one or two sentences of interpretation, as a guess"}`,
      maxTokens: 380,
      schema: { type: 'object', properties: { observed: { type: 'string' }, hypothesis: { type: 'string' } }, required: ['observed', 'hypothesis'], additionalProperties: false }
    }
  },
  parse(text) {
    const v = json(text, (x): x is { observed: string; hypothesis: string } => isStr(x?.observed) && isStr(x?.hypothesis))
    return v ? { ...v, text: `${v.observed}\n\nPerhaps: ${v.hypothesis}` } : null
  },
  local(i) {
    const s = i.summary
    const lines: string[] = []
    lines.push(`${s.seconds} seconds in ${s.environment}: ${s.light} light, ${s.dark} dark and ${s.grey} grey, joined by ${s.strands} strands, ${s.lockedStrands} of them in step.`)
    if (Number(s.totalFlow) > 0.5) lines.push(`Energy is moving: about ${s.totalFlow} units a second along the strands.`)
    if (Number(s.rings)) lines.push(`${s.rings} ring${Number(s.rings) > 1 ? 's have' : ' has'} closed${Number(s.membranes) ? `, ${s.membranes} into membranes` : ''}.`)
    if (Number(s.organisms)) lines.push(`${s.organisms} living forms, up to generation ${s.generations}.`)
    if (Number(s.collapses)) lines.push(`${s.collapses} collapse${Number(s.collapses) > 1 ? 's' : ''} so far.`)
    if (i.focus) lines.push(`Selected: ${i.focus.title}.`)
    return lines.join(' ')
  }
}

export interface SuggestInput {
  summary: Facts
  found: string[]
}

export const suggestFeature: FeatureSpec<SuggestInput> = {
  id: 'suggest',
  build(i) {
    const missing = DISCOVERIES.filter((d) => !i.found.includes(d.id))
      .slice(0, 10)
      .map((d) => d.name)
    return {
      system: `${BASE} Suggest experiments the player has not tried. They are suggestions, not promises: say what might happen, never what will.`,
      user: `Experiment summary: ${facts(i.summary)}\nNot yet discovered: ${missing.join(', ')}\nReply as JSON: {"suggestions": [{"try": "one concrete action with the tools (Hand, Seed, Strand, Pull, Twist, Pulse, Tune, Fracture, Fuse, Veil, Anchor)", "why": "what might happen"}]} with at most three suggestions.`,
      maxTokens: 320,
      schema: {
        type: 'object',
        properties: { suggestions: { type: 'array', items: { type: 'object', properties: { try: { type: 'string' }, why: { type: 'string' } }, required: ['try', 'why'], additionalProperties: false } } },
        required: ['suggestions'],
        additionalProperties: false
      }
    }
  },
  parse(text) {
    const v = json(text, (x): x is { suggestions: { try: string; why: string }[] } => Array.isArray(x?.suggestions) && x.suggestions.length > 0 && x.suggestions.every((s: any) => isStr(s?.try, 300) && isStr(s?.why, 300)))
    return v ? { ...v, suggestions: v.suggestions.slice(0, 3), text: v.suggestions.slice(0, 3).map((s) => `Try: ${s.try} — ${s.why}`).join('\n') } : null
  },
  local(i) {
    const next = DISCOVERIES.filter((d) => !i.found.includes(d.id)).slice(0, 3)
    if (!next.length) return 'Every kind of discovery has been found here. Try a different environment, or look for new forms.'
    return next.map((d) => `Try: ${d.reproduce}`).join('\n')
  }
}

export interface OrganismInput {
  title: string
  facts: Facts
}

export const organismFeature: FeatureSpec<OrganismInput> = {
  id: 'organism',
  deep: true,
  build(i) {
    return {
      system: `${BASE} Describe what an organism seems to be responding to, using only its internal state and what it senses. Mark interpretation as interpretation. These are fictional life-like forms, not living beings.`,
      user: `${i.title}: ${facts(i.facts)}\nReply as JSON: {"text": "three sentences at most"}`,
      maxTokens: 260,
      schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false }
    }
  },
  parse(text) {
    return json(text, (x): x is { text: string } => isStr(x?.text))
  },
  local(i) {
    const f = i.facts
    const parts = [`This ${i.title.toLowerCase()} is ${String(f.state)}.`]
    if (Number(f.energyFrac) < 0.2) parts.push('It is low on energy.')
    if (Number(f.wariness) > 0.3) parts.push('It has learned to be wary: it has been shaken before.')
    parts.push(Number(f.diet) < 0.5 ? 'It eats light.' : 'It eats vibration.')
    return parts.join(' ')
  }
}

export interface NameInput {
  kind: 'organism' | 'structure' | 'discovery' | 'pattern'
  facts: Facts
}

const LOCAL_A = ['Vesper', 'Aulen', 'Silth', 'Morrow', 'Ondine', 'Calyx', 'Ithra', 'Ranse', 'Lume', 'Orrel', 'Nai', 'Quill', 'Seren', 'Tamsin']
const LOCAL_B = ['drift', 'weave', 'hollow', 'tide', 'knot', 'veil', 'thread', 'ember', 'wake', 'choir']

export const nameFeature: FeatureSpec<NameInput> = {
  id: 'name',
  build(i) {
    return {
      system: `${BASE} Suggest evocative, original names. Short (one or two words), no real brand or person names, no religious titles.`,
      user: `Something to name (${i.kind}): ${facts(i.facts)}\nReply as JSON: {"names": ["three different suggestions"]}`,
      maxTokens: 120,
      schema: { type: 'object', properties: { names: { type: 'array', items: { type: 'string' } } }, required: ['names'], additionalProperties: false }
    }
  },
  parse(text) {
    const v = json(text, (x): x is { names: string[] } => Array.isArray(x?.names) && x.names.length > 0 && x.names.every((n: unknown) => isStr(n, 40)))
    return v ? { names: v.names.slice(0, 3), text: v.names.slice(0, 3).join(', ') } : null
  },
  local(i) {
    const seed = JSON.stringify(i.facts)
    let h = 7
    for (let k = 0; k < seed.length; k++) h = (h * 31 + seed.charCodeAt(k)) >>> 0
    return [0, 1, 2].map((k) => `${LOCAL_A[(h + k * 5) % LOCAL_A.length]} ${LOCAL_B[(h >> 3) % LOCAL_B.length]}`).join(', ')
  }
}

export interface ReflectInput {
  summary: Facts
}

export const reflectFeature: FeatureSpec<ReflectInput> = {
  id: 'reflect',
  build(i) {
    return {
      system: `${BASE} Offer a brief, optional reflection on what the experiment shows about opposition, connection, tension or transformation. It is interpretation, clearly so. No sermon, no advice, no conclusion handed down.`,
      user: `Experiment summary: ${facts(i.summary)}\nReply as JSON: {"text": "sixty words at most"}`,
      maxTokens: 200,
      schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false }
    }
  },
  parse(text) {
    return json(text, (x): x is { text: string } => isStr(x?.text, 600))
  },
  local(i) {
    const s = i.summary
    if (Number(s.collapses) > 0) return 'Something here held more than it could, and broke, and what it scattered became something else.'
    if (Number(s.rings) > 0) return 'A loop closed. Nothing in it is the loop; the loop is what they do together.'
    if (Number(s.lockedStrands) > 0) return 'Two rhythms that were not the same found a way to keep time.'
    return 'Light gives, dark keeps. Neither is the whole of it.'
  }
}

export type Tone = 'scientific' | 'accessible' | 'poetic' | 'mystical' | 'cryptic'

export interface CaptionInput {
  tone: Tone
  title: string
  facts: Facts
}

export const captionFeature: FeatureSpec<CaptionInput> = {
  id: 'caption',
  build(i) {
    return {
      system: `${BASE} Write a caption for a shared image of the experiment, in the requested tone. The caption must stay true to the data. No hashtags, no emoji.`,
      user: `Tone: ${i.tone}\nWorking title: ${i.title}\nData: ${facts(i.facts)}\nReply as JSON: {"title": "up to six words", "caption": "up to forty words"}`,
      maxTokens: 260,
      schema: { type: 'object', properties: { title: { type: 'string' }, caption: { type: 'string' } }, required: ['title', 'caption'], additionalProperties: false }
    }
  },
  parse(text) {
    const v = json(text, (x): x is { title: string; caption: string } => isStr(x?.title, 80) && isStr(x?.caption, 400))
    return v ? { ...v, text: v.caption } : null
  },
  local(i) {
    return localCaption(i.tone, i.facts)
  }
}

export function localCaption(tone: Tone, f: Facts): string {
  const light = f.light ?? 0
  const dark = f.dark ?? 0
  const grey = f.grey ?? 0
  switch (tone) {
    case 'scientific':
      return `${light} emitters, ${dark} absorbers and ${grey} mediators; ${f.strands ?? 0} couplings, ${f.lockedStrands ?? 0} phase-locked; ${f.rings ?? 0} closed loops after ${f.seconds ?? 0} s.`
    case 'accessible':
      return `Lights, darks and the grey between them, joined by ${f.strands ?? 0} silver strands. ${Number(f.rings) ? 'Some of them closed into rings.' : 'Energy flowing from one to another.'}`
    case 'poetic':
      return Number(f.organisms) ? 'Out of the space between giving and keeping, something began to move by itself.' : 'Light leaning toward dark, and the thread that formed between them.'
    case 'mystical':
      return 'Neither the light nor the dark, but the strand that will not let them go.'
    case 'cryptic':
    default:
      return `${f.seconds ?? 0}. ${f.strands ?? 0}. ${f.rings ?? 0}. It kept time.`
  }
}

export const ALL_FEATURES = [interpretFeature, suggestFeature, organismFeature, nameFeature, reflectFeature, captionFeature]
