# Polaritium — project instructions

A 3D Windows game, made by Greygray: a universe of opposing forces you can touch. The
authoritative brief is **POLARITIUM: The Complete Autonomous Claude Code Development Packet,
v1.0, 17 Oct 2026** (pasted in the chat that started the project; its full text is kept in
`docs/MASTER_PACKET.md`). It replaces every earlier "Grey Strand God Simulation" packet.

**Read first, every session:** `RESUME.md`, then `PROJECT_STATUS.md` and `ROADMAP.md`.

## Hard rules for this project

- **The game must never spend money on its own.** Every Claude request goes through
  `src/core/budget/controller.ts` (admission) and `src/core/ai/service.ts` (the one sender).
  No other file may import the Anthropic SDK except `src/main/ai.ts` (a test enforces it).
- **No real paid API calls during development** without Greygray's explicit yes for that call
  and a stated maximum cost. Mock transports are used for every test.
- **Not Eonweld.** Check `DISTINCTION_FROM_EONWELD.md` before adding a system. Never read code
  from `35 Eonweld/` into this project.
- **Test headless.** No visible app windows on his screen: interface tests run in headless Edge
  (`npm run e2e`); the packaged app's self-test runs with hidden windows (`--selftest`).
- **The simulation core (`src/core/sim/`) imports nothing from React, three.js, Electron or the
  network.** A test enforces it.
- **Determinism:** no `Math.random()` or `Date.now()` inside `src/core/sim/`. Use the world RNG.
  Bump `RULES_VERSION` in `src/core/sim/constants.ts` on purpose whenever behaviour changes.
- Name rules from the vault apply: the retired old name never appears; he *creates*, he does not
  "write"; no affiliate links.
- Every app explains itself: each screen opens with one plain sentence; every button says what
  it does.

## Commands

    npm install          (uses .npmrc legacy-peer-deps; npm 10 crashes on vitest's optional peers otherwise)
    npm test             unit and integration tests (vitest)
    npm run build        build main, preload and renderer into out/
    npm run e2e          interface tests in headless Edge against out/renderer
    npm run perf         simulation timing on this machine
    npm run dist         Windows installer into dist/
