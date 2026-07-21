# AGENTS.md — Corro Online

Cross-tool guide for AI coding agents (Claude Code, Copilot, etc.). The full,
authoritative reference lives in [.github/copilot-instructions.md](.github/copilot-instructions.md);
read it before doing non-trivial work. This file is the short version with the
rules you must never break.

For **how the system is built** (architecture, client, accessibility, server, game
families, end-to-end flows), see the prose docs in [docs/](docs/README.md). This file is
the *rules*; those docs are the *map*.

## What this project is

Multiplayer, **accessibility-first** Corro for screen-reader users (JAWS,
NVDA). Vanilla TypeScript frontend (no bundler, native ES6 modules) + .NET 10
backend with real-time SignalR. The server is **authoritative**; the client only
displays state and drives visuals.

## Build, run & test

Frontend (from `frontend/`):
```bash
npm install
npm run build        # compile TS + copy assets to dist/ ("Build completed successfully!")
npm test             # all node:test suites (tsx)
node --import tsx --test test/<file>.test.ts   # a single suite
```

Backend (stop any running CorroServer first to release the build lock):
```bash
# PowerShell: Get-Process -Name CorroServer -ErrorAction SilentlyContinue | Stop-Process -Force
dotnet build server/CorroServer.csproj -p:SkipFrontendBuild=true --nologo
dotnet test server.tests/CorroServer.Tests.csproj --nologo
```

E2E (Playwright, real browsers + real server with scripted dice — see `e2e/README.md`):
```bash
cd e2e && npm test   # run from e2e/, NEVER from the repo root
```

Always finish a change by running the frontend tests (incl. translation parity)
**and** `dotnet test`; run the E2E suite when the change touches a flow it covers
(lobby, trades, purchases, announcements).

### Pre-push hook (blocks a red push)

A shared `pre-push` hook (`.githooks/pre-push`) refuses to push to ANY branch when the suites
are red: it always runs the frontend (build + `npm test`) and backend (build + `dotnet test`)
suites, and runs the E2E suite only when `RUN_E2E=1` (it needs a built server + installed
Playwright browsers, so it stays opt-in). `tools/dev.ps1` installs it idempotently on startup;
when using another development path, enable it once per clone:
```bash
pwsh -File tools/install-hooks.ps1        # sets core.hooksPath=.githooks
RUN_E2E=1 git push                         # include E2E in this push
```
It's a local safety net, not the real gate — CI / branch protection is. Genuine emergency
bypass: `git push --no-verify`.

### Local Azure Blob (Azurite) — uploaded-package persistence

Uploaded `.corro` packages are persisted as a single zip blob so a game can be restored after a
restart. With no `ConnectionStrings:PackageBlobs` configured the server uses a filesystem store
(`%TEMP%/corro-blobs/`); set that connection string to use Azure Blob (prod) or the local Azurite
emulator (dev). Shipped boards in `server/Packages/` never go to blob — they re-stage from disk by id.

To exercise the real Azure client locally (Azurite runs in Docker via compose):
```bash
docker compose up -d azurite     # Azurite (blob) on :10000; data in a named volume
dotnet user-secrets --project server set "ConnectionStrings:PackageBlobs" "UseDevelopmentStorage=true"
```
The `AzureBlobPackageStore` integration tests (`[AzuriteFact]`) then run against it; they SKIP (never
fail) when Azurite isn't up, so CI stays green.

### Local Cosmos DB (emulator) — game persistence

Games (lobbies + in-progress) are stored in Cosmos. For full create→save→restore e2e locally, run the
Cosmos emulator in Docker (via compose):
```bash
docker compose up -d cosmos     # vnext-preview emulator; NoSQL over HTTP on :8081, data explorer :1234
dotnet user-secrets --project server set "ConnectionStrings:CosmosDB" \
  "AccountEndpoint=http://localhost:8081/;AccountKey=C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw=="
```
The server detects the emulator — a `localhost`/`127.0.0.1` endpoint **or** the emulator's well-known
key (so the containerised app whose endpoint is the `cosmos` compose service is recognised too) — and
switches the `CosmosClient` to Gateway mode, gated so it never relaxes TLS against a real account (see
`ServiceCollectionExtensions.IsCosmosEmulator`). It bootstraps the `CorroGame`/`Games` schema on
startup. The `CosmosGameRepository` integration tests (`[CosmosFact]`) round-trip a game against it and
SKIP when it's down. With **both** emulators up you can play a package game and exercise restore e2e.

`tools/dev.ps1` brings the whole stack up at once (`docker compose up` for the emulators + secrets +
an initial frontend build + complete frontend watch + the server on the host). Development serves
`frontend/dist` directly; TS, HTML, CSS, i18n, config and assets update there and appear on browser
refresh. Ctrl+C stops both app processes; the emulators outlive them. Use `-NoWatch` to opt out or
`-Build` to additionally mirror the initial build into `server/wwwroot`. Stop Corro-owned emulators
with `tools/stop.ps1`. To run **everything** in Docker, including the app, use
`docker compose --profile full up` (built from `server/Dockerfile`).
The script probes `localhost:8081`/`:10000` first and reuses healthy emulators even when another
Compose project owns them; do not replace that with an unconditional `docker compose up`, which
reintroduces host-port collisions.

## Non-negotiable rules

**Testing discipline (mandatory).** Every change ships with the highest possible
test coverage; every bug fix gets a regression test. Prefer extracting pure,
unit-testable functions over leaving logic in timers/DOM/Hub methods. If
something genuinely can't be covered, say so explicitly.

**Accessibility.**
- Dialogs are ALWAYS native `<dialog>` (never `<div role="dialog">`). Keep the native
  root's implicit role — `role="application"` is invalid there. A keyboard-intensive
  dialog may put it on a named INNER surface; reading dialogs contain none. Restore focus
  to the opener on close.
- Never use the `disabled` attribute. Keep controls focusable, use
  `aria-disabled="true"` + `aria-describedby` explaining why, and surface the
  reason instead of acting.
- **Server owns the spoken voice.** Game events are announced from server
  rules/handlers via `context.Announce(key, vars)` with `["actorId"]`. Add BOTH
  a base key (3rd person) and a `<key>_self` (1st person) in `en.json` AND
  `es.json`. Client command handlers only drive visuals (`context.emit`) and may
  announce local UI — never duplicate the server voice.
- Keep the landmark tree flat (no nested regions). Every page has one top-level `main`,
  all visible content belongs to a landmark, heading levels do not skip, and dialog title
  bars use a plain `div` rather than a nested `header`. Popup menus are hosted inside the
  active `dialog`/`main`/region, never as visible orphan content under `body`.
- A scrollable region needs keyboard access: if no focusable descendant can scroll it,
  give the region `tabindex="0"` and accessible context (see help `documentMode`). Do not
  invent scroll bindings: native Arrow/Page Up/Page Down/Home/End/Space stay with the
  focused modal region while game shortcuts are suppressed.
- **Contrast without destroying the design:** use semantic light/dark theme tokens for UI
  chrome. Preserve package/player/suit colours and derive readable black/white ink with
  `contrastingTextColor()`; never hardcode white over arbitrary dynamic colours. Do not use
  opacity alone to dim meaningful text/controls — add explicit readable foreground and
  shape/border/background cues. Visually review both themes as well as passing Axe.
- Background-tab safe: don't drive accessibility-critical work off
  `requestAnimationFrame`.
- Visual-only layers for sighted players (`boardToast`, `cardReveal`,
  `cardFlight`) are `aria-hidden`, never touch the live region, never steal
  focus, never gate the turn.
- **Every composed line must read as ONE flowing sentence.** A screen reader
  hears a label/row/announcement as a single line: connect its facts with words
  and punctuation ("120₡, de Berto", "Mazo: 58. Descartes: 1."), never with
  visual separators (`·`, `|`, bare juxtaposition) — those don't speak. Join
  lists with a spoken connector (`joinList` in `tradeDialog.ts` wraps
  `Intl.ListFormat`); word money as cash where it could be misheard as a price.

**Automatic Axe gate (mandatory for every browser UI state).**
- Every E2E spec imports `test`/`expect` from `e2e/helpers/test.ts`, never directly from
  `@playwright/test`; create contexts through `newPlayerPage()` so Axe loads before the app.
- The mutation monitor retains violations from settled transient states, but it can inspect
  only states a scenario REACHES. Add E2E transitions for every new/changed view, theme,
  validation error, dialog/menu, loading/success/failure and disabled/unplayable state.
  `lobby-accessibility.spec.ts` is the lobby matrix.
- For a state dismissed faster than the quiet period, assert it, call
  `flushAxeAudit(page)`, then close it. Final-state-only scans are forbidden.
- Never suppress Axe rules, exclude selectors, filter impacts or clear genuine violations.
  Fix the product. Preserve visual quality; WCAG is the floor, not the design goal.
- The recurring rule families are `color-contrast`, `aria-allowed-role`, `heading-order`,
  `landmark-one-main`, `landmark-banner-is-top-level`, `region`, and
  `scrollable-region-focusable`; treat each recurrence as a product bug.
- Test global shortcuts from the real view and focused control where users invoke them.
  Run `cd e2e && npm test` for every UI/accessibility change; CI runs it on every PR.

**i18n.** Translate every user-facing string in BOTH `en.json` and `es.json`
(base + `_self` where applicable). The translation parity/usage tests enforce
this.

**No dead code.** When a change orphans code (functions, handlers, keys, CSS),
delete it in the same change. Grep for now-unused symbols before finishing.

**Package boundary.** The engine owns generic mechanics and neutral fallbacks; packages own all
themed identity and assets. Never branch shared client/server code on a shipped package, card or
token id/title. Optional card art lives in `assets/cards/<id>.svg` (64×64 path geometry), token art in
`assets/tokens/<id>.svg`; package art overrides the neutral fallback. For package-facing changes, inspect
the loader/format first, update every relevant family/model/schema/SDK/doc surface, grep for leaked
content ids, and add a boundary regression.

**Style.** No inline styles in HTML. No `console.log` in production (use
`console.debug`). Handlers emit events, not direct DOM manipulation.

## Where things live

- Frontend modules: `frontend/src/` (one responsibility each). Client response
  handlers: `frontend/src/commands/`. Lobby: `frontend/src/lobby/`.
- Keyboard shortcuts: `server/Config/keymap.json` (+ `keys.ts`); document new ones in
  the F1 help (`helpDialog.ts`) with a `help_cmd_*` key in both locales. Never add ad-hoc
  board globals: shared bindings belong to the engine keymap, package group letters are
  collision-checked through `EngineKeymap.ReservedLetters`, and family-only bindings stay
  beside `activeShortcuts()`/`helpShortcuts()`. Page-only lobby chords stay in the lobby
  module and must never leak into `app.ts`/`keys.ts`; search all three scopes and add a
  collision/routing regression before introducing any key.
- CSS is modular under `frontend/css/` (plus `frontend/styles.css` for the
  board). No CSS preprocessor.
- Translations: `frontend/i18n/locales/{en,es}.json`.
- Backend: `server/` — `Hubs/` (SignalR), `Services/Commands/` (CQRS-like
  handlers), `Services/Rules/` (`CorroRulebook` partials + `Rules/Cards/`), and
  `Packages/` (shipped package sources; cards target square INDICES so decks are
  portable across boards).
- Tests: `frontend/test/` (node:test/jsdom) and `server.tests/` (xUnit).
- Game families (genres): registered in `server/.../Families/GameFamilies.cs` +
  client `gameFamilies.ts`/`familyTraits.ts`. Read `docs/game-families.md` and the
  relevant section of `CORRO_FORMAT.md` first: a family is a distinct *interaction
  form*; most new games EXTEND an existing family's effect catalog + house rules instead
  (a match-and-discard variant → `shedding`, a distance-card variant → `journey`). Card families
  share `handPanel.ts`, `cardBoardShell.ts` and `makeCardFamily` — reuse, don't
  re-duplicate.

## Git

- Don't amend commits already pushed to a remote branch with an open PR; add a
  new commit instead. Only amend if it hasn't been pushed.
- Commit only when explicitly asked.
