# Bugs

Found while building and testing. All listed bugs are fixed and covered by a test unless marked open.

| # | Found by | Problem | Fix |
|---|---|---|---|
| 1 | budget tests | Lowering the monthly allowance below the untouched enrichment allowance was refused | Untouched limits now follow a lowered allowance down |
| 2 | simulation run | Dark stopped filling once both ends were equally full, so nothing ever collapsed | Kind-dependent potential (Decision 9) |
| 3 | simulation run | Phase locking never registered (per-tick noise) | Smoothed drift (Decision 10) |
| 4 | simulation tests | Default strands overloaded and snapped within a second | Flow drive halved; overload now needs high coupling or low resistance |
| 5 | simulation tests | Organisms starved: light too faint a few units from a source | Brighter emitters, better foraging utility |
| 6 | chamber tests | Twisted strand spun up until it tore (Chamber 1) | Twist drive reduced so drag sets a steady speed |
| 7 | chamber tests | Crystal broke whether tuned or not (Chamber 2) | Resonance-led crystal strain (Decision 11); chamber moved to the Void Cradle |
| 8 | chamber tests | Opening a ring to add a member destroyed its identity (Chamber 5) | Ring memory (Decision 12) |
| 9 | chamber tests | Dark Garden survived on its own: dark leaked food; oscillators flashed for free; dormant forms never died | Leak cut to near zero; flashes cost energy; dormancy costs more; death below 0.01 energy |
| 10 | headless screenshot | Swinging strands drew as thick white bars | Wave amplitude and frequency scaled to the strand |
| 11 | headless screenshot | Fade-in animation cancelled centring of the tool hint and tutorial | Animation now changes opacity only |
| 12 | interface tests | After branching, the title kept the original's name | Title follows the stored current universe |
| 13 | persistence tests | A damaged database could not be set aside on Windows (a shadowed variable left it open) | Variable renamed; recovery tested |
| 14 | desktop tests | The page could not load: the network block also blocked the app's own files | Own files allowed through, everything else still blocked |
| 15 | packaged self-test | Hidden window barely advanced (throttled frames) | Timer pacing in hidden mode (Decision 19) |
| 16 | installer check | Picture capture waited for a frame that a hidden window never got | Pictures render on demand |

## Open

None known that block release. Known limitations are in `release/KNOWN_LIMITATIONS.md`.
