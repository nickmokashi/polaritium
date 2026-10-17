import type { ToolId } from '@core/sim/chambers'
import type { IconName } from './primitives'

export interface ToolInfo {
  id: ToolId
  name: string
  key: string
  icon: IconName
  /** What happens when you use it, in one or two plain sentences. */
  does: string
  /** The keyboard way, for when dragging is hard. */
  keyboard: string
}

export const TOOLS: ToolInfo[] = [
  { id: 'hand', name: 'Hand', key: '1', icon: 'hand', does: 'Select, grab and throw. Drag something to move it; let go while moving to throw it. Drag empty space to look around.', keyboard: 'Select, then arrow keys move it (Alt + up/down: nearer or farther).' },
  { id: 'seed', name: 'Seed', key: '2', icon: 'seed', does: 'Click to place something new: light, dark, grey, a crystal or a living form. Choose which above.', keyboard: 'Click where it should go.' },
  { id: 'strand', name: 'Strand', key: '3', icon: 'strand', does: 'Drag from one concentration to another to connect them, or click one and then the other.', keyboard: 'Click the first, then the second.' },
  { id: 'pull', name: 'Pull', key: '4', icon: 'pull', does: 'Hold on empty space to draw things toward that point (Shift: push away). Drag a strand up or down to shorten or lengthen it.', keyboard: 'Select a strand, then + / - to lengthen or shorten.' },
  { id: 'twist', name: 'Twist', key: '5', icon: 'twist', does: 'Drag a strand sideways to twist it. A twisted strand that carries flow turns its ends around each other.', keyboard: 'Select a strand, then + / - to twist.' },
  { id: 'pulse', name: 'Pulse', key: '6', icon: 'pulse', does: 'Click to send a wave through the medium. Hold longer for a stronger pulse.', keyboard: 'Click where the pulse should start.' },
  { id: 'tune', name: 'Tune', key: '7', icon: 'tune', does: 'Drag sideways on light, dark, grey or a crystal to change its rhythm (you will hear it). On a strand it changes coupling; hold Alt for resistance.', keyboard: 'Select, then + / - (Alt for resistance).' },
  { id: 'fracture', name: 'Fracture', key: '8', icon: 'fracture', does: 'Click a strand to cut it. Click a concentration, crystal, ring or living form to destabilize it (Shift: harder).', keyboard: 'Select, then Delete.' },
  { id: 'fuse', name: 'Fuse', key: '9', icon: 'fuse', does: 'Click two things to merge them: two concentrations, two rings, or two related living forms.', keyboard: 'Click the first, then the second.' },
  { id: 'veil', name: 'Veil', key: '0', icon: 'veil', does: 'Drag to place a sphere that shields its inside from the outside. Click a veil to lift it.', keyboard: 'Click to place a veil of the size chosen above.' },
  { id: 'lens', name: 'Lens', key: 'L', icon: 'lens', does: 'Reveals what is invisible: light pooling in space, vibration passing through it, and the force each node feels.', keyboard: 'Press L to switch it on or off.' },
  { id: 'anchor', name: 'Anchor', key: 'K', icon: 'anchor', does: 'Click something to hold it in place, or hold its rhythm or energy (choose above). Click again to release it.', keyboard: 'Select, then click it with Anchor.' }
]

export const TOOL_BY_ID = new Map(TOOLS.map((t) => [t.id, t]))
