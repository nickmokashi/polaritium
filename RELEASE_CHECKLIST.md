# Release checklist, 1.0.0

`[x]` done and verified · `[~]` done, partly verified · `[ ]` not done

## Build
- [x] `npm run dist` builds `dist/Polaritium Setup 1.0.0.exe` (per-user NSIS, x64, 115 MB)
- [x] Installer copied into `release/`
- [ ] Code signing (no certificate; SmartScreen warning documented)

## Installer
- [x] Silent install, Start Menu entry, desktop shortcut option, uninstaller, licence notices
- [x] Installed copy passes its own hidden self-test, first run and after restart
- [x] Six desktop tests pass against the installed copy
- [x] Uninstall removes the program and Start Menu entry; saves are kept (documented)

## Game
- [x] All 12 tools and the Time Hand, by mouse and by keyboard (interface tests)
- [x] Five environments and Genesis open and run (visual tour)
- [x] 12 Paradox Chambers solvable, none self-solving (unit tests)
- [x] Atlas, Living Gallery, Compare, checkpoints, branches, rewind (interface tests)
- [x] Saves: autosave, save on close, backups, recovery, export, import (unit, interface, desktop)
- [x] Settings kept across restarts; graphics levels all hold their frame limit
- [~] Sound: runs without errors; not yet listened to
- [x] Every screen opens with a plain sentence; every button says what it does

## Optional AI and money
- [x] AI off by default; game fully playable without a key
- [x] $10 monthly default with daily, session and per-request limits
- [x] Admission before sending, one in flight, no SDK retries, uncertain kept, unknown prices blocked
- [x] Raising limits needs confirmation; AI OFF switch; ledger and CSV export
- [x] Key stored with Windows protection, never reaches the page, saves, exports, logs or pictures
- [ ] Live request with a real key (needs Greygray's yes and a stated maximum cost)

## Documents
- [x] `release/USER_GUIDE.md`, `API_SETUP.md`, `BUDGET_AND_PRIVACY.md`, `KNOWN_LIMITATIONS.md`, `RELEASE_NOTES.md`
- [x] `README.md`, `ARCHITECTURE.md`, `DECISIONS.md`, `BUGS.md`, `TEST_RESULTS.md`, `NAME_CHECK.md`, `PROJECT_STATUS.md`, `ROADMAP.md`, `RESUME.md`, `DISTINCTION_FROM_EONWELD.md`

## Rules
- [x] No Eonweld code read or used; distinction document kept
- [x] No paid API calls made; no purchases; no billing changes; nothing published
- [x] Retired name absent from code, documents and pictures
