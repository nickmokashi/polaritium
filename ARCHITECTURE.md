# Architecture

## Processes

```
 Desktop process (src/main)                     Game page (src/renderer)
 ┌────────────────────────────┐   preload     ┌──────────────────────────────┐
 │ SQLite store (node:sqlite) │◄─ bridge ────►│ React interface, 3D view     │
 │ key storage (safeStorage)  │  (IPC calls)  │ (three.js + React Three      │
 │ budget store + controller  │               │  Fiber + postprocessing)     │
 │ the one Claude sender      │               │ synthesized sound (WebAudio) │
 │ server-anchored clock      │               │          ▲  snapshots        │
 └────────────────────────────┘               │          │  (typed arrays)   │
                                              │ Web Worker: the simulation   │
                                              └──────────────────────────────┘
```

- The **simulation** (`src/core/sim`) runs in a Web Worker at a fixed 30 ticks per simulated
  second. It imports nothing from React, three.js, Electron or the network (a test enforces it).
  It is deterministic: a seeded generator lives in the state; no clock and no `Math.random`.
- The worker sends **render snapshots**: packed `Float32Array`s of nodes, strands, organisms,
  crystal segments, rings, veils, fields (every third frame) and events. The page eases
  displayed positions between ticks; drawing never changes the simulation's numbers.
- The **page** has no network access (blocked in the Electron session, tested) and never sees the
  Claude key. Everything privileged goes through the preload bridge (`src/core/app/bridge.ts`
  is the contract; `src/renderer/src/bridge/web.ts` implements it in a plain browser for tests).
- The **desktop process** owns the database, saves, files, the key, the budget and the only
  route to Claude.

## The medium

Three kinds of node (`SimNode.kind`): **white** (emits), **black** (absorbs, holds, may collapse),
**grey** (mediates: integrate-and-fire, passes rhythm and energy). Two coarse 3D fields:
**radiance** (energy white puts into space; diffuses, decays, is drunk) and **signal** (a damped
wave carrying pulses, firings, fractures; reflects off the Cathedral's walls). Strands carry
flow as an RLC-like circuit: drive from potential difference (white +0.4, black −0.4, grey 0, on
top of fullness), resistance, inertia; overload stresses and fractures them.

One tick (`step.ts`), in order: environment drivers → node intrinsics (generation, radiation,
drinking, saturation) → strand flow, twist drive and stress → phase coupling and grey firing →
forces (dark attraction, light pressure, contact) → integration → fractures and faded strands →
transformations (collapse, overload, dissolution, resonant birth) → spontaneous strands → fields
(behind veils) → crystals → organisms → rings, membranes, quickening → discovery → chamber goal
check. Energy is booked at every step (generated, harvested, external, dissipated, converted);
a test checks the books balance to one part in a million.

### The eight relationships, as mechanics

| Relationship | Where it lives in the rules |
|---|---|
| Emission / Absorption | White generates and radiates into the radiance field; black, crystals and light-eating organisms drink it; strand drive comes from the potential difference. |
| Expansion / Compression | Light pressure pushes neighbours outward (scaled by fullness); dark attraction pulls inward; a saturated dark collapses and throws its energy out, an overfull light shatters. |
| Coherence / Variability | Kuramoto phase coupling along strands locks rhythms (smoothed drift measure); differing natural frequencies, pulses and twist frustration keep them apart (The Frustrated Wheel cannot settle). |
| Attraction / Repulsion | Pairwise forces in `forceStep`: dark gravity-like pull, light pressure, contact repulsion; Pull adds a temporary attractor or repeller. |
| Growth / Dissolution | Crystals grow along lattice habits in still light; organisms feed and divide; greys starve and dissolve; strands fade without flow; fractured crystals shed shards; the Fracture Garden regrows strands. |
| Motion / Rest | Twisted strands carrying flow drive rotation; motile organisms swim up gradients; stillness (low signal vibration) is required for crystal growth and lets the Well remember disturbances. |
| Connection / Isolation | Strands, bonds, rings and membranes connect; veils block flow, signal, forces and radiance across their surface; isolated forms starve or go dormant. |
| Stability / Transformation | Thresholds everywhere: coupling past a point makes flow ring; lock-in resonance cracks crystals; a ringing locked strand gives birth to grey; quickening turns a membrane into life. |

### Emergent structures

- **Rings** (`structures.ts`): closed cycles in the graph of phase-locked strands (cycle basis),
  matched across time by member overlap (Jaccard), with ten seconds of memory ("ghosts") so a
  ring can open and close again through a new member without losing its identity.
- **Membranes** form on coherent, energised rings; a membrane holding energy across a gradient
  **quickens** and spawns a living form.
- **Crystals** (`crystals.ts`): segments on a habit lattice (cubic, hex, spire, shard), each
  generation weaker than the last; resonance at the crystal's own frequency drives strain.
- **Organisms** (`organisms.ts`): 13-gene genomes (size, speed, diet, flash rhythm, caution,
  sociability, shell and so on), utility-based choices, feeding, division with mutation and a
  population cap, bonds and colonies, dormancy, death. Selection is real: shocks favour shells
  and caution over generations (tested).
- **Discovery** (`discovery.ts`): 28 detectors that read state and events; each finding carries
  its subject and measurements, and a test checks nothing is reported that did not happen.
- **Paradox Chambers** (`chambers.ts`): 12 setups whose goals are checked inside `step()`; each is
  proven solvable by player commands and proven not to solve itself.

## Commands, undo and time

Every player action is a `Command` (`commands.ts`) applied inside the worker. Undo keeps the
serialized state before each command (true restoration, not inverse operations). Rewind keeps a
snapshot every ten seconds. Checkpoints and branches are serialized worlds stored with their
universe. `serialize.ts` writes a versioned save (`SAVE_SCHEMA`, `RULES_VERSION`).

## Persistence

One SQLite file, `%APPDATA%\Polaritium\polaritium.db` (WAL mode), tables: `settings`,
`universes`, `states` (three slots per universe: latest and two backups, loaded newest-first
with fallback), `checkpoints`, `atlas`, `exhibits` (Living Gallery), `chambers`, `ai_cache`,
`budget`, `ledger`, `rejections`. A daily copy of the whole file is kept; a damaged file is set
aside and the copy restored. `.polaritium` export files hold one universe and its checkpoints,
validated with zod on import, and never contain settings, keys or the ledger.

## The Claude layer

```
 button press ─► AiService.run (core/ai/service.ts)
                   │ local fallback text always prepared first
                   ▼
                 BudgetController.admit (core/budget/controller.ts)   synchronous, durable
                   │ AI on? key? window in use? price known? one in flight?
                   │ reservation = max possible cost (+10%) within per-request, session,
                   │ daily, monthly (and enrichment) limits, against the server-anchored date
                   ▼
                 transport (main/ai.ts)  ── the only file that imports the SDK; maxRetries: 0
                   ▼
                 settle: actual cost from usage replaces the reservation;
                 uncertain outcomes stay counted in full; definite 4xx refusals are released
```

Money is integer **microdollars** throughout. Prices are a bundled, dated registry; a player may
raise but never lower them. The accounting date comes from Anthropic's `Date` header (a free
HEAD request when needed), carried on the monotonic clock, so changing the computer clock cannot
open a new month. Haiku 5.5 is the default; Sonnet 5.5 only for deeper readings the player has
allowed; thinking is off and effort low so `max_tokens` bounds output. Identical requests are
answered from a local cache at no cost.

## Security summary

- Key: Electron `safeStorage` (Windows DPAPI) at `%APPDATA%\Polaritium\secrets\claude.key.bin`;
  no IPC channel returns it; never logged, saved, exported or rendered.
- Page: `contextIsolation`, `sandbox`, no `nodeIntegration`, network requests blocked except the
  app's own files, navigation and new windows denied, permission requests denied.
- No telemetry. With AI off the app makes no network connections.
