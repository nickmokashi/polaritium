import { utf8Bytes } from '../budget/estimator'
import type { AiTransport, TransportRequest, TransportResponse } from './service'

// A pretend Claude for testing the AI paths end to end without spending anything. Its replies
// are canned but shaped exactly like real ones, including usage figures. Everything it says
// is marked as a test reply, so it can never be mistaken for the real thing.

export class MockTransport implements AiTransport {
  calls = 0
  constructor(private now: () => number = () => Date.now()) {}
  async send(req: TransportRequest, signal: AbortSignal): Promise<TransportResponse> {
    this.calls++
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, 350)
      signal.addEventListener('abort', () => {
        clearTimeout(t)
        reject(new Error('aborted'))
      })
    })
    const u = req.messages[0]?.text ?? ''
    let text = '{"text":"(test reply) The strands are carrying energy from the light to the dark."}'
    if (u.includes('"observed"')) text = '{"observed":"(test reply) Energy flows from light to dark along the locked strands.","hypothesis":"Perhaps the rhythm keeps the flow efficient."}'
    else if (u.includes('"suggestions"')) text = '{"suggestions":[{"try":"(test reply) Twist a strand a quarter turn.","why":"It may start to turn."}]}'
    else if (u.includes('"names"')) text = '{"names":["Test Vesper","Test Calyx","Test Lume"]}'
    else if (u.includes('"caption"')) text = '{"title":"(test) Threadlight","caption":"(test reply) Light leaning toward dark."}'
    const input = Math.ceil(utf8Bytes(req.system + u) / 4)
    return { text, usage: { input_tokens: input, output_tokens: Math.ceil(utf8Bytes(text) / 4) }, requestId: `mock_${this.calls}`, serverDateMs: this.now(), stopReason: 'end_turn' }
  }
}
