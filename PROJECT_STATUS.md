# Project status

**17 October 2026: version 1.0.0 built, installed, tested and uninstalled cleanly.**

## Done
All eleven phases of the master packet (0 to 10). The installer is in `release/`, with the
player's guide and the AI and privacy pages. Every suite passes: 127 unit and integration tests,
43 interface tests, 6 desktop tests, and a 26-step installer check that includes the desktop
tests against the installed copy. Details in `TEST_RESULTS.md`.

## Waiting on Greygray
1. **A first real Claude request**, if he wants AI checked live. It needs his key in the game and
   his yes for a stated maximum: one Haiku 5.5 interpretation sets aside at most $0.00051 and
   should actually cost about $0.0001 to $0.0002 (calculated with the game's own estimator).
2. **A first listen** to the sound.
3. **The name.** `NAME_CHECK.md`: no exact conflict; Nintendo's *Polarium* is close.
4. **The icon** (`build/icon-sheet.png`): first proposal, his call.
5. **A public showcase**, if he wants one. The code repository is private.

## Not planned
Code signing (needs a paid certificate), other operating systems.

## Where to start next time
`RESUME.md`.
