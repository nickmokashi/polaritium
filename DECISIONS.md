# Decisions

Significant choices, with the reason. Newest last.

1. **One package, folders by area, instead of the packet's many packages.** `src/core` (simulation, budget, AI rules, app contract; no framework), `src/main` (desktop process), `src/preload`, `src/renderer`. The packet allows adjusting the structure; one package keeps builds and tests simple.
2. **Electron 44.4.1, electron-vite, React 19, three.js 0.186 with React Three Fiber, postprocessing, camera-controls, zustand, zod.** Versions already proven on this machine (Takesmith, Living Sphere). Drei left out: only camera controls were needed, so `camera-controls` is used directly.
3. **SQLite through Node's built-in `node:sqlite`.** Electron 44's Node (24.21) ships it, so there is no native module to compile or prebuild. Synchronous calls make budget admission atomic in the single main thread.
4. **`npm install` uses `legacy-peer-deps`** (in `.npmrc`): npm 10.9 crashes on vitest's optional peer dependencies otherwise.
5. **Simulation runs in a Web Worker;** the page receives compact typed-array snapshots. Positions are eased on screen between ticks; the simulation's numbers are never altered by drawing.
6. **Fixed tick of 1/30 simulated second; a cycle is 60 ticks.** Deterministic: seeded generator in the state, no clock or `Math.random` in the core (tested).
7. **Energy is conserved and every source and loss is recorded** (generated, harvested, external, dissipated, converted). A test checks the books balance to one part in a million.
8. **Flow along a strand is an RLC-like circuit** (drive from potential difference, resistance, inertia). This produces the packet's example behaviour: more coupling transfers more, then past a threshold the flow rings, and overload fractures.
9. **Light has a potential +0.4, dark −0.4, grey 0** on top of fullness, so dark keeps drinking until it saturates (and can collapse), instead of stopping when both ends are equally full.
10. **Phase locking measured on a smoothed drift** (1.2 s average): per-tick noise otherwise hid real locking.
11. **Crystals break by resonance:** a lock-in measure of vibration at the crystal's own frequency drives most strain. This made "tune the crystal away from the drummer" a real answer in Chamber 2.
12. **Rings keep their identity for ten seconds after opening** ("ghosts"), so a player can open a loop and close it through a new member without it becoming a different ring (Chamber 5).
13. **Paid AI only from a focused, visible window** (or the self-test), never while the window is unused. Matches "AI while inactive: disabled".
14. **The accounting date comes from Anthropic's server**, carried forward on the monotonic clock, never from the computer's clock alone. A free unauthenticated HEAD request obtains it when needed. Changing the computer clock cannot open a fresh month (tested).
15. **Reservations bound input tokens by UTF-8 bytes** (a token is at least one byte), price all input at the highest input rate (the 1-hour cache write), output at max_tokens, then add 10%. Players may raise prices in the registry but never lower them below the verified figures.
16. **Uncertain requests stay counted in full;** a definite 4xx refusal (not 408) is released as not billed; 5xx and network errors stay uncertain. SDK retries are off.
17. **Key storage: Electron `safeStorage` (Windows DPAPI)** in the app-data folder. The page never receives it; the page has no network access at all (blocked in the session, tested).
18. **Thinking off for the game's short requests** (`disabled` on Haiku 5.5, `between_tools` on Sonnet 5.5) with effort `low`, so max_tokens bounds the whole output and costs stay predictable.
19. **Hidden windows pace the simulation by a timer** (self-test and desktop tests only), because a hidden window receives almost no animation frames. Normal play is unaffected.
20. **Saves keep the two previous versions;** loading falls back to them if the latest is damaged. A daily copy of the whole database is restored if the file itself is damaged.
21. **Fonts bundled locally** (Cormorant Garamond, Inter; SIL OFL) so the game is fully offline.
22. **Icon:** a light and a ringed dark joined by a strand (`build/icon.svg`). Not the retired split disc. Greygray's call to keep or change.
23. **Installer not code-signed** (no certificate). Windows SmartScreen will warn on first run; documented.
24. **Frames are drawn by a limiter, not the screen's refresh rate.** The 3D view runs `frameloop="never"` and a small loop advances it at most 30 or 60 times a second (the graphics setting), so faster screens do not make laptops run hot. The simulation's pace never depends on it.
25. **Reflections are mirror glints of the simulated emitters** on crystals, greys, darks and living forms (High and Ultra). They read the same top-six light list the lighting uses, so they show only what is really shining.
26. **Each generation of crystal growth is weaker than the last** (vigour falls with depth; at most 7 generations and 90 facets). Growing toward light used to speed growth up without limit, so crystals raced to the edge of the world.
27. **Closing the window saves first.** The desktop process holds the close, asks the page to save, and closes when it answers, or after four seconds at most so a stuck page can never trap the player.
28. **The single-instance lock is released as the game quits,** and a second launch brings the open window forward, so reopening straight after closing always works.
