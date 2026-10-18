# Resume here

Version 1.0.0 is finished and verified (17 October 2026). Nothing is half-done.

1. Read `CLAUDE.md` (rules), then `PROJECT_STATUS.md` (what is waiting on Greygray), then
   `ROADMAP.md`. The brief is `docs/MASTER_PACKET.md`.
2. `npm install` if `node_modules/` is missing, then `npm test` (127 tests, about 100 s).
3. Interface tests need a build first: `npm run build`, then run `e2e/interaction.spec.ts`,
   `e2e/smoke.spec.ts e2e/tour.spec.ts` and `e2e/perf.spec.ts` as separate commands (together
   they run longer than ten minutes). If a run is cut off, stop leftover headless Edge processes
   (command line contains `playwright_chromiumdev`) before the next run.
4. Release: `npm run dist`, then `node scripts/verify-installer.mjs` (installs silently into a
   temporary folder, tests, uninstalls; about five minutes), then copy the installer into
   `release/`.

Never make a paid Claude request without Greygray's yes and a stated maximum cost. Never open
a visible window on his screen.

Working folder: `47 Polaritium`. Git branch `main`, pushed to the
private repository `github.com/nickmokashi/polaritium` (created 17 Oct 2026 on Greygray's yes).
Push after every commit worth keeping.
