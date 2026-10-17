# Test results

Final run on the release code, 17 October 2026, on the test laptop: Intel Core i3-1115G4,
Intel UHD Graphics, 16 GB, Windows 11 Home. Every suite below ran and passed on that day.

| Suite | Command | Result |
|---|---|---|
| Unit and integration (simulation, chambers, emergence, budget, persistence, architecture rules) | `npm test` | **127 passed** |
| Interface: every tool by mouse, time and history, saving and branching, modes and screens, optional AI with a pretend Claude | `npx playwright test e2e/interaction.spec.ts` | **28 passed** |
| Interface: first run and visual tour of six scenes | `npx playwright test e2e/smoke.spec.ts e2e/tour.spec.ts` | **7 passed** |
| Interface: frame rate at each graphics level | `npx playwright test e2e/perf.spec.ts` | **8 passed** |
| Desktop app (hidden Electron), development build | `npx playwright test -c playwright.electron.config.ts` | **6 passed** |
| Installer: silent install, Start Menu entry, licence notices, installed self-test before and after a restart (21 checks), the 6 desktop tests against the installed copy, silent uninstall, saves kept | `node scripts/verify-installer.mjs` | **26 of 26 passed** (`release/installer-verification.json`) |

## What the suites prove

- **Simulation:** determinism (same seed, same result; no clock or `Math.random` in the core);
  energy books balance to one part in a million; flow, resistance, coupling threshold to
  oscillation, phase lock, fracture, collapse, resonant birth, twist drive, veils; field step
  sizes inside their stability limits; rings persist and are lost when broken; crystals grow in
  light and stillness and not in the dark; organisms feed, divide with variation, starve, sense,
  respect the population cap; repeated shocks shift inherited shells and caution over
  generations; the discovery engine reports nothing that did not happen; Genesis wakes its laws
  through discovery.
- **Paradox Chambers:** all 12 solvable through player commands, and none solves itself.
- **Budget (45 tests):** defaults ($10 monthly, $0.75 daily, $0.50 session, $0.05 per request,
  AI off); admission before sending; atomic reservations; one request in flight; reconciliation;
  uncertain requests kept in full; definite refusals released; unknown prices blocked; prices
  cannot be lowered below the checked ones; clock moved forward or back cannot open a new
  month; raises need confirmation showing old and new values; enrichment has its own allowance.
- **Architecture rules:** only `src/main/ai.ts` imports the Anthropic SDK; SDK retries are off;
  every request goes through the budget; the page has no way to read the key.
- **Persistence:** saves on real SQLite with two backups, damaged-save fallback, damaged-database
  recovery, export and import validation.
- **Desktop app:** the page is locked down (no network, no Node, no key in its reach); a saved
  universe and settings survive a restart; closing the window saves first; the key is stored
  encrypted and never returned; AI through the real desktop path with a pretend Claude (off by
  default, $10, confirmation to raise, ledger on disk); no paid request while the window is
  not in use.

## Performance

**Simulation** (`npm run perf`, Node 22). The game needs 30 ticks a second at normal speed.

| Scene | Nodes | Strands | Living forms | Crystal facets | ms per tick | 95th percentile | Times faster than real time |
|---|---|---|---|---|---|---|---|
| Twin Concentrations (Cradle) | 4 | 1 | 0 | 0 | 0.47 | 0.92 | 48 |
| Scattered Medium (Cradle) | 10 | 10 | 0 | 0 | 0.52 | 1.20 | 44 |
| The Choir (Cathedral) | 7 | 9 | 0 | 0 | 0.53 | 1.17 | 46 |
| The Shoal (Cradle) | 3 | 2 | 21 | 1 | 0.68 | 1.32 | 35 |
| Crystal Orchard (Garden) | 4 | 3 | 0 | 33 | 0.53 | 1.04 | 42 |
| Every limit at once | 260 | 561 | 220 | 5 | 9.25 | 13.5 | 3.4 |

**Drawing** (headless Edge on the laptop's own Intel UHD graphics; headless Edge offers at most
60 frames a second, so 60 is the ceiling of this measurement).

| Graphics level | Frame limit | Frames per second (The Shoal / Scattered Medium) | Page time per frame |
|---|---|---|---|
| Low | 30 | 30 / 30 | 0.8–0.9 ms |
| Balanced (default) | 60 | 60 / 60 | 1.4 ms |
| High | 60 | 60 / 60 | 1.4–1.7 ms |
| Ultra | 60 | 60 / 60 | 1.4–1.5 ms |

Startup: a new experiment is ready in 0.2–1.9 s in the headless browser.

## Not tested, and why

- **A real Claude request.** None has been made: a paid call needs Greygray's explicit yes and a
  stated maximum cost. Everything up to the network is tested with a pretend Claude.
- **How the sound sounds.** The audio engine runs without errors in every test; a headless run
  cannot listen.
- **A visible window on screen.** By the project's rule, tests never open windows on his screen;
  the look is checked in headless Edge and the installed app in hidden windows.

## Flakiness seen

One visual-tour run timed out waiting 5 s for a scene to open while the machine was busy; that
wait is now 20 s and startup times are logged (normally under 2 s). One interface run failed
because browsers left over from a timed-out earlier run were still alive; with those stopped,
all 28 passed.
