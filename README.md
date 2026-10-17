# Polaritium

A 3D universe you can touch. Light, dark and the grey between them are three expressions of
one fictional medium. You pull them together, connect them, twist, tune, shake and break their
relationships, and the medium answers: flows, rhythms, crystals, rings, membranes and small
living forms that feed, divide and adapt. Created by Greygray. Windows, offline, free of
accounts; Claude is an optional extra with a hard spending limit.

## For players

Install with `Polaritium Setup 1.0.0.exe` (in `release/`). The guide is
`release/USER_GUIDE.md`. Optional AI: `release/API_SETUP.md` and
`release/BUDGET_AND_PRIVACY.md`.

## For developers

    npm install          uses .npmrc (legacy-peer-deps)
    npm run dev          the app with live reload
    npm test             127 unit and integration tests (vitest)
    npm run build        main, preload and renderer into out/
    npm run e2e          interface tests in headless Edge against out/renderer
    npm run perf         simulation timing on this computer
    npm run dist         Windows installer into dist/
    npx playwright test -c playwright.electron.config.ts   desktop-app tests, hidden windows
    node scripts/verify-installer.mjs   silent install, installed self-test, uninstall

Requires Node 22+ and Microsoft Edge (for the headless interface tests).

| Folder | What lives there |
|---|---|
| `src/core/sim` | The simulation. Deterministic, no graphics, no network. |
| `src/core/budget`, `src/core/ai` | Spending limits and the single route to Claude. |
| `src/core/app` | Settings, Atlas and the contract between game page and desktop process. |
| `src/main` | Desktop process: windows, database, saves, key storage, the Claude sender. |
| `src/preload` | The narrow bridge the game page is allowed to call. |
| `src/renderer` | The game page: 3D view, interface, sound, simulation worker. |
| `tests`, `e2e`, `e2e-electron` | Unit, interface and desktop tests. |
| `release` | Player documents, verification records and (after a build) the installer. |

Technical notes: `ARCHITECTURE.md`. Decisions and their reasons: `DECISIONS.md`. Test record:
`TEST_RESULTS.md`. Current state: `PROJECT_STATUS.md`.

The master brief is `docs/MASTER_PACKET.md`. How Polaritium differs from Eonweld:
`DISTINCTION_FROM_EONWELD.md`.
