# Budget and privacy

## The promise

Polaritium never spends money on its own. AI is **off** until you switch it on, it only sends a
request when you press a button for one (or, if you switch on automatic enrichment, when a new
discovery is made while you are actively playing), and every request is checked against your
limits **before** anything leaves your computer.

## The default limits

| Limit | Default |
|---|---|
| Monthly allowance | $10.00 |
| Daily | $0.75 |
| One session | $0.50 |
| Most one request may cost | $0.05 |
| Automatic enrichment (off by default) | $1.00 a month, inside the monthly allowance |

You can change them in **Settings, AI budget**. Lowering a limit takes effect at once. Raising
one, switching on the deeper model or automatic enrichment always asks you to confirm, and shows
the old and new values side by side.

## How the game keeps to them

- **Checked first, sent second.** Before a request is sent, the game works out the most it could
  possibly cost (every word priced at the highest rate, the longest possible answer, plus 10%)
  and sets that amount aside. If setting it aside would cross any limit, the request is not sent.
- **One at a time.** Only one request can be on its way at once.
- **Settled afterwards.** When the answer comes back, the real cost replaces the amount set aside.
- **Unsure means counted.** If the connection drops and the game cannot tell whether Anthropic
  charged, it counts the full amount set aside. It never assumes free.
- **No silent retries.** A failed request is never repeated automatically.
- **Unknown prices are refused.** A model without a checked price cannot be used.
- **The clock cannot be fooled.** Months and days are counted from Anthropic's own server date,
  so changing the computer's clock does not open a fresh month.
- **Never while you are away.** Requests only go from a window that is open and in use.
- **One switch stops everything.** **Switch AI off** (in the AI panel and in Settings) stops new
  requests immediately.

Prices used (checked against Anthropic's pricing page on 17 October 2026, per million tokens):

| Model | Input | Output |
|---|---|---|
| Claude Haiku 5.5 | $0.10 | $0.50 |
| Claude Sonnet 5.5 | $2.00 | $10.00 |

If Anthropic raises a price, you can raise it in the AI budget tab. Prices can never be set
below the checked figures.

## Your record

**Settings, AI budget** shows what has been spent this month, today and this session, what is
set aside, a list of every request with its cost, and the totals by feature and by model.
**Export the ledger** saves it as a spreadsheet (CSV). This is the game's own record; your
Anthropic account's billing is separate and has the final word.

## What is sent, and what is not

When you ask for a reading, Polaritium sends a short summary of the experiment's numbers: the
place, how long it has run, how many lights, darks and greys, strands, rings, crystals and living
forms, and counts such as births, collapses and fractures. For suggestions it adds the kinds of
things you have already found; for a caption or a name, the measurements of that one thing.
That is all.

Your key travels only to Anthropic, in the request itself, as any key must. Nothing else leaves:
not your saves, your name, your files, your pictures, or anything from outside the game.
Claude's words are always marked as interpretation; the measurements come from the simulation.

Anthropic's own data policies apply to what is sent: https://www.anthropic.com/legal/privacy

## Without AI

With AI off, Polaritium makes no network connections at all. (Two buttons open Anthropic's web
pages in your own browser, only if you press them.) The game page itself has no network access,
by design. Everything, including the Atlas, the chambers, saves and pictures, is local.
