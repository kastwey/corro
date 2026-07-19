# E2E (Playwright)

Real games, end to end: two browsers (one context per player), the real server with
SignalR, and the `imperio-galactico` board in Spanish. The suite verifies
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

Hence `workers: 1`: the dice queue lives in the server process and is shared.

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
npm test                         # starts the E2E server by itself
npm run test:headed              # with a visible browser
npm run report                   # HTML report of the last run
```

Always run from `e2e/` (from the repo root, Playwright would pick up the frontend's
unit tests). The command rebuilds the frontend into wwwroot before starting, so it
always exercises the current code.

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
