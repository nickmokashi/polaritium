# Known limitations

Honest list, as of version 1.0.0 (17 October 2026).

1. **The live Claude connection has not been tried with a real key.** Every AI path is tested
   against a pretend Claude, through the real desktop code, budget and ledger. The first real
   request will be the first time Anthropic's actual reply is read. If anything about the reply
   is unexpected, the request is counted as uncertain (charged in full to the game's own record)
   and the game falls back to its local reading.
2. **No one has listened to the sound yet.** The sound is synthesized live and every part of it
   runs without errors in tests, but a headless test cannot hear. Volume balance and character
   may need adjusting after a first listen.
3. **The installer is not code-signed.** Windows SmartScreen warns on first run ("Windows
   protected your PC"); choose More info, then Run anyway.
4. **Windows only.** The code is cross-platform, but only the Windows build was made and tested.
5. **Performance was measured on one computer** (Intel Core i3-1115G4, Intel UHD graphics,
   16 GB). It held every graphics level's frame limit there. Older or weaker graphics chips may
   need the Low setting.
6. **Very large universes slow the simulation.** With every limit reached at once (260
   concentrations, 700 strands, 220 living forms, 24 crystals) the simulation still runs about
   three times faster than real time on the test computer, so 4× and 8× speed cannot keep up in
   such a universe; the game simply advances as fast as it can.
7. **Limits are fixed:** 260 concentrations, 700 strands, 220 living forms, 24 crystals of up
   to 90 facets each, 6 veils. Seeding past a limit is refused with a message.
8. **Saves from future versions** with different rules may not open in this one; saves record
   their rules version.
9. **The icon is a first proposal** (a light and a ringed dark joined by a strand).
10. **The name is provisional.** See `NAME_CHECK.md` in the project folder: no exact conflict
    was found, but a Nintendo puzzle game called *Polarium* is close. This is not legal advice.
11. **Importing a universe file** works in the desktop app only; the browser test version can
    export but not import.
12. **The packaged app's own self-test runs in a hidden window**, so it checks that the game
    runs and saves, not how it looks; how it looks is checked separately in a headless browser.
