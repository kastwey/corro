# E2E (Playwright)

Real games, end to end: two browsers (one context per player), the real server with
SignalR, and the `galactic-empire` board in Spanish. The suite verifies
**package ↔ screen coherence**: texts are asserted against the package's own i18n
(`server/Packages/…/i18n/*.json`), never hardcoded.

## How determinism works

Playwright's `webServer` launches the server with `ASPNETCORE_ENVIRONMENT=E2E`
(see `server/Extensions/E2EExtensions.cs`):

- **Scripted dice**: each test enqueues its rolls with `scriptDice(die1, die2)`
  (`POST /e2e/random`). An unscripted roll **fails loudly** — it never falls back to
  real randomness.
- **Unshuffled decks** (`cards.json` order) and **join-order turns** (the host moves
  first).
- **In-memory persistence** (never Cosmos) and `reducedMotion` (tokens snap, no races
  against animations).

Hence `workers: 1`: the dice queue lives in the server process and is shared by every game
in it, so two tests rolling at once would eat each other's script.

That is a property of ONE server, not of the suite — which is why `npm test` runs several
servers instead (see [Running](#running)). Each shard gets its own port, its own dice queue
and its own in-memory persistence, and stays exactly as serial and as deterministic inside
itself as a single-server run.

## Automatic Axe accessibility audit

Every player page loads Axe Core before the application. A browser-side monitor
observes DOM, ARIA, text and interaction changes and runs Axe after each settled UI
update. Synchronous mutation batches are coalesced; if the tree changes while Axe is
reading it, that unstable result is discarded and the settled state is scanned next.
Violations are retained even when the offending dialog or panel later disappears.

The shared fixture in `helpers/test.ts` flushes every live page after each scenario and
fails the test on any violation. Its JSON attachment records the page, transient UI
state, selector, offending HTML, impact and Axe help URL. All specs MUST import
`test` and `expect` from `../helpers/test`, never directly from `@playwright/test`.
`axe-monitor.spec.ts` proves that a short-lived barrier is not lost before teardown.

## Running

```bash
cd e2e
npm install                      # first time
npx playwright install chromium  # first time
npm test                         # sharded: several servers at once (the default)
npm test 1                       # one server, one worker — the classic serial run
npm test 6                       # more shards, if the machine can take it
npm run test:serial              # same as `npm test 1`, without the runner
npm run test:headed              # with a visible browser
npm run report                   # HTML report of the last run
```

Always run from `e2e/` (from the repo root, Playwright would pick up the frontend's
unit tests). The command rebuilds the frontend into wwwroot before starting, so it
always exercises the current code.

`npm test` goes through `run-sharded.mjs`: it builds **once**, then starts one server per
shard on its own port and gives each a slice of the spec files. Anything after the shard
count is passed to every shard (`npm test 4 --grep trade`); naming files yourself
(`npm test 4 tests/race.spec.ts`) hands the split back to Playwright.

Each run records how long every file took (`.durations/`, gitignored) and the next one packs
the slices by TIME rather than by file count — the wall clock is the slowest shard, and these
files are nowhere near equal.

**How many shards.** The default leaves a core per shard spare, because this workload is
CPU-bound: measured on a 16-core machine, the suite went 6.3 min serial → 3.6 at four shards
→ 2.6 at four shards once balanced. Six was slightly faster still and is NOT the default: at
that level the machine saturates and tests start losing races they win every time on their
own. A flaky accessibility gate is worth less than a slow one. Deadlines widen automatically
with the shard count for the same reason (`playwright.config.ts`).

The cost is Chromium, not the servers: profiled during a run, the .NET servers used 2.6% of
the machine and the browsers 18%+ (undercounted — a renderer process per context, created and
destroyed per test). Roughly a quarter of the time is the Axe audit itself, and it is not
waste: instrumenting it showed 0–2 of every 2–37 scans per page repeat a DOM state. It is
doing exactly the work the accessibility gate asks for.

A shard is also the natural unit for CI: N parallel jobs, each `npm test 1 --shard=i/N`.

## Visual-review screenshots

The `*-screenshot.spec.ts` scenarios capture named full-page images with
`helpers/screenshot.ts`. Each image is an attachment in Playwright's managed
`test-results/` output and is available through `npm run report`. Tests must not write
screenshots directly into the `e2e/` root: managed artifacts are refreshed by
Playwright, while root-level files accumulate stale visual states.

## Scenarios

| Spec | Covers |
|---|---|
| `trade.spec.ts` | Full trade between two browsers: group names (not hex), per-property prices in board currency (never euros), Enter accepts from any line, the swap propagates to both boards. |
| `manageProperties.spec.ts` | Rows read group names and the price in the board's currency word; Shift+F10 opens the context menu INSIDE the modal and mortgages from it. |
| `auction.spec.ts` | Declining opens the auction on every screen; a lone bidder wins the moment the last rival passes (no timer wait); the win is announced in board currency and ownership propagates. |
| `smoke-en.spec.ts` | The same purchase circuit in English: the package's and the app's EN texts. |
| `connection.spec.ts` | Mid-game disconnect: announcement + tag in the players list and turn indicator, the `t` key voices the absence, and the rejoin is announced (first-person for the returning player). |
| `axe-monitor.spec.ts` | Mutation-driven Axe auditing retains a barrier from a transient UI state after that element disappears. |
| `lobby-accessibility.spec.ts` | Lobby-only Axe states: both themes, runtime language switch, create/join validation, invalid and successful `.corro` uploads, upload removal, unlock prompt/feedback, saved-game actions, and the complete hidden-package lifecycle (reveal → persist → delayed stage → create → code-free guest → browser board). |
| `voice.spec.ts` | Optional voice lifecycle with two players: deployment-gated lobby choice, host enable/disable, opt-in unmuted join, presence, active-speaker query, local volume, reversible host mute and every settled Axe state. |

## Writing a scenario

All the plumbing lives in `helpers/game.ts`:

- `newPlayerPage(browser, locale?, { reducedMotion? })` — isolated per-player context,
  aria-live capture and automatic Axe monitoring.
- `createGame(page, name, board, { houseRules? })` / `joinGame` / `startGame` — the lobby
  flow through the real UI; `houseRules` flips the package's declared toggle rules.
- `roll(page, d1, d2)` / `buyPendingProperty(page)` / `actionButton(page, id)`.
- `expectAnnouncement(page, /regex/)` — asserts what a screen reader WOULD hear.
- `packageI18n` / `packageManifest` / `appI18n` — the source of truth for texts.

The shipped package under `fixtures/packages/hidden/` is injected as an additional package
root **only** when the server runs in E2E mode. It is deliberately absent from
`server/Packages/` and production publish artifacts. Its code is `e2e-hidden`; use it to
test the unlock gate instead of relying on private/local packages.

Known gotchas:

- The aria-label of the square the exploration cursor RESTS ON is deliberately never
  rewritten (so JAWS doesn't re-read it). Assert ownership on the OTHER player's page —
  which also proves cross-client propagation.
- The lobby's token radios are invisible by design and the long create form defeats
  Playwright's scroll-into-view: lobby controls are driven with `dispatchEvent('click')`
  / `evaluate`, not positional clicks.
- The announcer CLEARS the live region ~300 ms after writing. The collector reads the
  MutationRecords (added nodes keep their text after removal), never the current
  `textContent` — reading it in the callback can arrive late and miss the line.

## Running only what a change could break

`npm test` runs everything, and so do the pre-push hook and CI. That is the gate and it stays the
gate. For the inner loop there is a narrower run:

```bash
npm run test:map          # once: measure which modules each spec exercises (a slow full run)
npm run test:affected     # then: run only the specs that could care about your changes
npm run test:affected HEAD~3   # against another base (default: origin/main)
```

The map is **measured, not written**. A hand-kept list of file → spec answers this question wrongly
the first time somebody adds a module and forgets to update it, and it does so in silence. So
`test:map` records it from a real run using V8 coverage (`helpers/coverage.ts`), keyed on whether a
module's functions actually RAN — not on whether it loaded, which would be useless here, since the
lobby statically imports nearly everything.

Every rule fails **open**: a changed file the map cannot account for — a brand-new module, anything
under `server/`, the harness itself — means "run the whole suite", and it says so. The day this
narrows too far is the day an accessibility regression ships, so it is never allowed to be the
thing that decides a change is safe.

What it actually buys, measured on this suite (the full run is 160s):

| changed | specs selected | time |
| --- | --- | --- |
| `frontend/src/forbiddenBoard.ts` | 1 of 39 | ~13s |
| `frontend/src/raceBoard.ts` | 3 of 39 | |
| `frontend/src/privacyPage.ts` | 1 of 39 | |
| `frontend/src/comboBox.ts` | 10 of 39 | ~61s |
| `frontend/src/announcer.ts` | 35 of 39 | |
| `server/**`, a new module, the harness | all | 160s |

### The one judgement call

Everything above is measured except one rule, and it is the only one that can make the selection
WRONG rather than merely slow.

The map is honest that 38 of 39 specs exercise the lobby: every scenario creates its game through
it. But a game spec does not TEST the lobby — it passes through it to reach a board. What it
genuinely depends on is the handoff: that the game comes out configured the way it asked for. So a
change to the pre-game surface ALONE selects the specs whose subject that surface is, plus one spec
per way a game can be set up from it — seats, teams, content deck, house rules, and a plain
create-and-join. That is the 10 above.

Those representatives are not decoration. When the game picker became a combobox, the spec it broke
was `race.spec` — "a taken colour says who holds it" — and not one lobby spec: staging repainted the
seat list and wiped the seat the test had chosen. `race` is in the list because it is the only spec
that picks a seat at all.

The stricter version — lobby specs only — is 44s, and buys those 17 seconds with exactly that hole.
The lists live at the top of `affected.mjs` so the trade can be argued with.

Note what the rule keys on: which MODULE changed, not how many specs it drags in. `announcer.ts`
also selects 35, and narrowing it would be wrong — it is the voice of the game, not of the lobby.

Rot is safe by construction. A lobby module nobody adds to the list keeps the measured selection,
which is the whole suite; and `test:map` going stale means a file it has never seen falls open the
same way. Forgetting costs time, never coverage. Re-run `test:map` after adding a spec or a module.
