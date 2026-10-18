# Roadmap

Every phase from the master packet (`docs/MASTER_PACKET.md`), its acceptance test, and where it stands.
`[x]` = built and verified by a test that ran. `[~]` = built, verification partial (see note). `[ ]` = not done.

## Phase 0 — Environment and foundation
- [x] Machine inspected: i3-1115G4 (2 cores / 4 threads), Intel UHD graphics, 15.7 GB RAM, 1366×768 display; Node 22.18, Electron 44.4.1 (Node 24.21, Chrome 152).
- [x] Project, records, Eonweld distinction document, test framework (vitest, Playwright web + Electron).
- [x] Simulation core separate from rendering (enforced by a test).
- [x] Budget subsystem with mock transport, 45 tests.
- [x] Name check (`NAME_CHECK.md`).

## Phase 1 — The first beautiful reality
- [x] Camera (orbit, pan, zoom, fly, focus, follow, previous view, cinematic), original look, light/dark concentrations, nodes and fields, drawing strands, visible energy flow, basic audio, save/load foundation.

## Phase 2 — The complete force engine
- [x] Eight relationships built into mechanics (see `ARCHITECTURE.md`), tension, resonance, phase, coupling, instability, stabilisation, thresholds, feedback, transformations, spatial effects, Strand Sight. Tests: flow, resistance, coupling threshold to oscillation, phase lock, fracture, collapse, resonant birth, twist drive, veil.

## Phase 3 — Emergence and life-like entities
- [x] Crystalline (lattice growth, resonance fracture, regrowth), membrane (rings → membranes → quickening), oscillating, motile, adaptive organisms; bounded reproduction with variation; feeding; dormancy; death; colonies. Tests: feeding, division with variation, starvation, sensing, population cap, removal integrity, adaptation.

## Phase 4 — All god powers and tools
- [x] Hand, Seed, Strand, Pull, Twist, Pulse, Tune, Fracture, Fuse, Veil, Lens, Anchor, Time Hand; undo/redo (true state restoration); selection and multi-select; inspector; tooltips; shortcuts; keyboard alternatives; first-use tutorial. Headless mouse tests for every tool.

## Phase 5 — Discovery and play modes
- [x] Discovery Atlas (28 kinds + new forms), five environments + Genesis chamber, 12 Paradox Chambers each solvable and not self-solving (tested), Living Gallery, Genesis law progression, 8 prepared starting systems.

## Phase 6 — Time, save and branching
- [x] Saves with two backups per universe, autosave, multiple universes, checkpoints, branching, rewind (auto snapshots every 10 s), Compare view, import/export, damaged-save and damaged-database recovery. Tests on real SQLite.

## Phase 7 — Optional Claude intelligence
- [x] Key setup (Windows-protected), routing (Haiku 5.5 default, Sonnet 5.5 opt-in), $10 default, adjustable limits with confirmation, central admission, atomic durable reservations, reconciliation, dashboard + CSV, interpretation, suggestions, naming, captions, reflections, full AI-off play.
- [~] **Live provider test: pending.** No real paid request has been made (none authorised). Mock transport tested through the real desktop path.

## Phase 8 — Visual and audio polish
- [~] Consistent look across screens and environments, verified by screenshots. Audio is synthesized and exercised without errors, but no one has listened to it yet: a headless run cannot hear.

## Phase 9 — Testing, security and performance
- [x] Unit/integration (vitest), interface (Playwright, headless Edge), desktop app (Playwright Electron, hidden), installer (scripted).
- [x] Performance measured on this machine (`TEST_RESULTS.md`): simulation 35–48× faster than real time in normal scenes, 3.4× with every limit reached; every graphics level holds its frame limit on Intel UHD graphics.

## Phase 10 — Windows release
- [x] Installer, uninstaller, Start Menu and desktop shortcuts, icon, local saves, onboarding, user guide, technical notes, release notes, troubleshooting. Installed copy verified with its own hidden self-test and the six desktop tests (26/26, 17 Oct 2026). Release folder: `release/`.
- [x] Private GitHub repository `nickmokashi/polaritium`, created and pushed 17 Oct 2026 on Greygray's yes.
- [~] Public showcase: started 17 Oct 2026 in its own session, on his yes.
