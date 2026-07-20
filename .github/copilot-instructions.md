# Copilot Instructions - Corro Online

## 📋 Project Overview

**Corro Online** is a multiplayer accessible game engine for spatial and card-based games, with a client-server architecture. The project uses vanilla TypeScript for the frontend and .NET 10 backend with real-time communication via SignalR.

**Key Focus:** Accessibility-first design for screen reader users (JAWS, NVDA).

## 🎯 Design Principles

### SOLID Principles
- **S**ingle Responsibility: Each module/class has one clear purpose
  - `gameClient.ts` → SignalR communication only
  - `gameManager.ts` → Game state management only
  - `dialogManager.ts` → Modal dialogs only
  - `notificationService.ts` → Non-intrusive notifications only
- **O**pen/Closed: Command handlers are extensible without modifying core code
  - Add new handlers in `commands/` folder following `ICommandHandler` interface
- **L**iskov Substitution: All command handlers implement `ICommandHandler` interface consistently
- **I**nterface Segregation: Small, focused interfaces (`CommandContext`, `DialogOptions`)
- **D**ependency Inversion: Services depend on abstractions (`IGameRepository`, `ICommandHandler`)

### KISS (Keep It Simple, Stupid)
- No bundler (Webpack/Vite) — native ES6 modules
- No CSS preprocessor — vanilla CSS with utility classes
- No heavy frameworks — vanilla TypeScript
- Simple build script (`build.js`) instead of complex toolchain
- Single deployment unit (backend serves frontend static files)

### DRY (Don't Repeat Yourself)
- Unified i18n system for lobby and game (`i18nBinder.ts`)
- Command registry pattern for server responses
- Shared translation files for both pages

## 🏗️ Project Structure

```
./
├── frontend/                    # Frontend (TypeScript/Vanilla JS)
│   ├── src/
│   │   ├── index.html          # Lobby page
│   │   ├── board.html          # Game board page
│   │   ├── app.ts              # Game board orchestrator
│   │   ├── gameManager.ts      # Server-authoritative state manager
│   │   ├── gameClient.ts       # SignalR client wrapper
│   │   ├── dialogManager.ts    # Modal dialog system
│   │   ├── board.ts            # Board rendering and navigation
│   │   ├── announcer.ts        # Single ARIA live-region announcer (polite + assertive)
│   │   ├── announcementGate.ts # Holds 'resolve' lines until the token finishes moving
│   │   ├── tokenAnimator.ts    # Animates token hops; fires onIdle when movement settles
│   │   ├── boardToast.ts       # Transient center-board visual toasts (sighted players)
│   │   ├── popupMenu.ts        # Reusable WAI-ARIA menu (roving tabindex, typeahead)
│   │   ├── squareMenu.ts       # Pure logic: which actions a square offers + affordability
│   │   ├── sound.ts            # Web Audio earcons (SoundManager singleton)
│   │   ├── i18nBinder.ts       # Translation system
│   │   ├── commands/           # Command handlers (SOLID pattern)
│   │   │   ├── registry.ts     # Handler registration
│   │   │   ├── DiceRolledHandler.ts
│   │   │   ├── PropertyHandlers.ts
│   │   │   └── AuctionHandlers.ts
│   │   └── lobby/              # Lobby modules
│   │       ├── index.ts        # Orchestrator
│   │       ├── tokens.ts       # Token selection
│   │       └── ui.ts           # UI utilities
│   ├── css/                    # Modular CSS
│   │   ├── global.css          # Reset, layout, utilities
│   │   ├── forms.css           # Form controls
│   │   ├── modal.css           # Dialog styles
│   │   ├── notifications.css   # Notification panel
│   │   └── ...
│   ├── i18n/locales/           # Translations (en.json, es.json)
│   └── build.js                # Simple build script
└── server/                     # .NET 10 backend
    ├── Controllers/            # REST API (GameController)
    ├── Hubs/                   # SignalR (GameHub)
    ├── Models/                 # DTOs and domain models
    ├── Services/
    │   ├── Commands/           # Command handlers (CQRS-like)
    │   │   ├── ICommandHandler.cs
    │   │   ├── RollDiceHandler.cs
    │   │   ├── BuyPropertyHandler.cs
    │   │   └── AuctionHandlers.cs
    │   ├── GameService.cs      # Game orchestration
    │   └── Interfaces.cs       # Abstractions
    ├── Packages/               # Shipped, legally distributable .corro package sources
    └── Services/Corro/       # Package loading, validation, families, and persistence
```

## 🚀 Build & Development

### Frontend
```bash
cd frontend
npm install          # Install dependencies
npm run build        # Compile TS + copy assets to dist/
npm run watch        # Initial build + watch TS, HTML, CSS, i18n, config and assets
```

### Backend
```bash
cd server
dotnet build         # Build
dotnet run           # Run (serves frontend from dist/)
dotnet watch run     # Hot reload
```

### Tests
```bash
# Backend build (skip frontend) + unit tests (xUnit)
dotnet build server/CorroServer.csproj -p:SkipFrontendBuild=true --nologo
dotnet test server.tests/CorroServer.Tests.csproj --nologo

# Frontend translation parity / key-usage tests (run from frontend/)
node --import tsx --test test/translations.test.ts
```
Always validate changes with these before finishing. Game rules live in
`server/Services/Rules/` (the `CorroRulebook` partial classes + `Rules/Cards/`)
and are covered by `server.tests/`.

## 🔧 Code Patterns

### Frontend Command Handler Pattern
New server responses are handled by adding a handler class. Client handlers drive
the **visuals** (via `context.emit`) and local UI; they do **NOT** voice game
events — the server owns that (see Accessible Announcements below).

```typescript
// commands/MyHandler.ts
export class MyHandler implements ICommandHandler {
    readonly responseType = 'MY_RESPONSE_TYPE';
    
    handle(response: CommandResponse, context: CommandContext): void {
        // Drive visuals / panels — the spoken voice comes from the server.
        context.emit('myEvent', data);
    }
}

// Register in registry.ts
registry.register(new MyHandler());
```

### Backend Command Handler Pattern
```csharp
// Services/Commands/MyHandler.cs
public class MyHandler : ICommandHandler<MyCommand>
{
    public async Task<ServerResponse> HandleAsync(MyCommand cmd, GameContext ctx)
    {
        var player = ctx.Helper.GetPlayer(cmd.PlayerId);
        if (player == null)
            return new ErrorResponse { Message = "Player not found", Code = "PLAYER_NOT_FOUND" };

        // Validate and delegate game rules to CorroRulebook / AuctionRulebook.
        // The rulebook owns game announcements; the handler only shapes the response.
        return new MyResponse { ... };
    }
}
```


### Translation Usage
```typescript
// Sync (for immediate use, requires i18next loaded)
const text = tSync('game.my_key', { player: name });

// Helper for game translations
const t = (key: string, vars?: any) => tSync(`game.${key}`, vars);
```

### JSON Deserialization (.NET)
Always use case-insensitive for JSON files:
```csharp
var options = new JsonSerializerOptions { PropertyNameCaseInsensitive = true };
var data = JsonSerializer.Deserialize<T>(json, options);
```

## 🌐 Internationalization

- **Library:** i18next (UMD bundle)
- **Languages:** English (en), Spanish (es)
- **Structure:** `lobby.*`, `game.*`, `common.*`, `serverErrors.*`
- **Interpolation:** `{{variable}}` syntax

```html
<!-- DOM binding -->
<p data-i18n="lobby.intro">Default text</p>
<input data-i18n-attr:placeholder="lobby.namePlaceholder">
```

## ♿ Accessibility

### Screen Reader Support
- ARIA live regions for announcements (`aria-live="polite"`)
- Keyboard navigation (arrows, Tab, Enter)
- Focus management after dialogs
- Semantic HTML structure

### Composed lines must flow as ONE spoken sentence
A screen reader hears a label, a dialog row or an announcement as a single line, so
every line composed from several facts must read as a coherent sentence:
- Connect the pieces with words and punctuation — "Puja actual: 120₡, de Berto",
  "Mazo: 58. Descartes: 1." — never with visual separators (`·`, `|`, spacing/layout)
  or bare juxtaposition ("120 Berto"): those don't speak and produce number soup.
- Join enumerations with a spoken connector before the last item — use `joinList`
  (`tradeDialog.ts`, wraps `Intl.ListFormat`: "A, B y C" / "A, B, and C").
- Disambiguate figures with a word when they could be misheard (money in a trade is
  "{{amount}} en efectivo", not a bare amount next to property prices).
- A big visual-only figure (e.g. the auction countdown "58 s") is `aria-hidden` and
  ships a visually-hidden sibling with the full sentence ("Quedan 58 segundos para
  pujar").

### Disabled controls (NEVER use the `disabled` attribute)
A native `disabled` button/control is removed from the tab order, so a screen
reader user can neither focus it nor hear WHY it is unavailable. ALWAYS keep the
control focusable and convey its state to assistive tech instead:
- Use `aria-disabled="true"` (not the `disabled` attribute) to mark it unavailable.
- Add `aria-describedby` pointing to the id of a visible tooltip/hint element that
  explains why it is disabled (e.g. "No tienes suficiente dinero, te faltan 120€").
- The click/activation handler must still fire: when `aria-disabled` is set, do
  NOT perform the action — instead surface the explanatory hint (spoken
  announcement + non-intrusive message), so the user learns why nothing happened.
- Style `[aria-disabled="true"]` to look inactive, but keep it in the tab order.

### Dialogs (ALWAYS native `<dialog>`) & the global focus trap
Every dialog MUST be a native `<dialog>` element — NEVER a `<div role="dialog"
aria-modal="true">`. Open modal dialogs with `showModal()` and non-modal ones with
`show()`. Restore focus to the opener (or `#board`) on close.

Keep the native dialog's implicit semantics: `role="application"` is NOT valid on a
`<dialog>` root. If a keyboard-intensive widget genuinely needs screen-reader focus mode,
put a **named inner surface** (`role="application"` + `aria-labelledby`) inside the dialog;
the trade, chat, manage-properties, player-detail and property-info dialogs are the
reference implementations. Reading dialogs (help, rules, end screen) must contain NO
application surface, so the screen reader can build a browse buffer.

Keyboard focus must NEVER leave the page to the browser chrome (the address bar).
A page-level `FocusTrap` (`focusTrap.ts`) wraps the whole `<body>` on both the board
and the lobby (`scopeToOpenModal: true`):
- While a **modal** `<dialog>` is open the trap scopes to that dialog (detected via the
  `:modal` pseudo-class, with a `data-modal` fallback for jsdom), so Tab stays inside
  the modal and cannot reach the inert body or the browser chrome.
- A **non-modal** `<dialog>` keeps the body as the root, so Tab circulates the whole
  page (dialog + board) but still never escapes.
This is why `<div>`-based dialogs are forbidden: the trap and `keys.ts` shortcut
suppression both key off real `<dialog>` semantics.

### Accessible Announcements (server-authoritative voice)
The **server is the single source of truth for the spoken voice of game events.**
Rules/handlers call `context.Announce(key, vars)` including `["actorId"] = player.Id`.

Flow: `context.Announce` → SignalR `"Announcement"` → whole group → `gameManager`
`personalizeAnnouncement` → `announcer`. The actor's client swaps `<key>` for
`<key>_self` when `vars.actorId === myPlayerId` and a `_self` translation exists,
giving first-person phrasing ("You rolled…") while everyone else hears third person.

Rules:
- Add BOTH the base key (3rd person) and a `<key>_self` (1st person) in `en.json`
  AND `es.json`. The translation parity test enforces this.
- Client command handlers must NOT announce game events (duplicates the server
  voice). They only `emit` visuals and may announce local UI (navigation, errors).
- Each server announcement carries a `phase`: `move` (the dice roll — spoken
  immediately) or `resolve` (the default — landing rent/tax/cards). The client's
  `AnnouncementGate` holds an action's `resolve` lines (voice + sound + toast) until
  the actor's token finishes its hop (`TokenAnimator` `onIdle`), then releases them, so
  a turn reads "dice → hop → what happened" rather than all at once. Tag a NEW
  pre-movement cause with `AnnouncementPhase.Move`; leave consequences at the default.
- The `announcer` coalesces the announcements that arrive in ONE synchronous batch
  into a single utterance joined by periods (flushed on the next tick — no timed
  window), so a dice roll + its consequences read coherently with no added latency.
- The board renders visuals in parallel: tokens (`renderPlayers`), the pips dice
  (`diceControl`), owner badges, houses/hotel chips and a mortgage marker. Keep
  visual state and aria-labels in sync from the `gameStateUpdated` handler.

### Background-tab robustness (multi-window play is the norm)
Two players often run two browser windows side by side, so a board is frequently the
**background/hidden tab**. Browsers throttle background tabs in two ways that BOTH
broke accessibility, so keep these rules:
- **`requestAnimationFrame` is paused in background tabs.** NEVER drive
  accessibility-critical work off rAF. Instant/assertive announcements flush via
  `window.setTimeout(…, 0)` (not rAF); otherwise they pile up and spill out as a
  merged burst when the tab is refocused. Same applies to anything that must run
  while hidden.
- **The `AudioContext` auto-suspends in background tabs** (and can be `interrupted`
  on Safari). `app.ts` resumes it on `visibilitychange`/`focus`, and
  `SoundManager.unlock()` resumes from both `suspended` and `interrupted`. `playSound`
  logs (via `console.debug`) when the context is not `running` at play time so silent
  earcons are diagnosable.
- **The announcer merges, never clobbers.** A flush still pending within the clear
  gap is merged into the next utterance (`pendingUtterance`) so a `move` line and an
  immediately-following movement-less `resolve` line (e.g. "you stay in holding") are both
  spoken. Cancel timers with `window.clearTimeout` to match `window.setTimeout`
  (identical in browsers; required for cancellation to work under jsdom tests).

### No nested ARIA landmarks
Keep the landmark tree flat. Nested regions/landmarks make a screen reader read a
chain of region names (especially on return-from-modal). The board is a plain
container (`<div class="game-layout__board">`, NOT a `<section>`/`<main>`), and `#board`
carries a short, localized `aria-label` (`game.panels.board` → "Tablero"/"Board").
Prefer one clear label over nested wrappers; if you add a landmark, justify it.

Every page still needs one top-level `<main>`, and all visible page content must live in
a landmark. Keep heading order coherent (`h1` page title, `h2` view/dialog title, then
deeper levels without skipping); visually-hidden headings are valid when a dynamic view
needs structural context. A dialog title bar is a plain `<div>` + heading, not a nested
`<header>` banner landmark.

### Reusable accessible popup menus (`popupMenu.ts`)
Contextual square actions (build/sell/mortgage/buy) open through `popupMenu`, a reusable
implementation of the WAI-ARIA menu pattern: `role="menu"` + `role="menuitem"`, roving
tabindex (one item tabbable at a time), Arrow/Home/End navigation, typeahead, and
Esc/Tab/click-outside to close + restore focus to the opener. Unaffordable items stay
focusable and are `aria-disabled` with an `aria-describedby` reason (never the `disabled`
attribute). The decision of WHICH actions to offer (and affordability) lives in the pure,
unit-tested `squareMenu.ts`; `popupMenu` only renders. Reuse `popupMenu` for any new
menu instead of hand-rolling one. A popup must be hosted inside the closest active
`dialog`/`main`/region landmark — never appended as orphaned visible content directly to
`body`.

### Axe-driven contrast, themes, and scrollability (hard requirements)
Axe-found contrast fixes must preserve the visual design, not flatten it into a generic
palette:
- Use semantic theme tokens (`--text`, `--text-muted`, `--surface*`, `--accent`,
  `--on-accent`, `--good`, `--on-good`, `--danger`, `--on-danger`) for UI chrome and test
  every new surface/state in BOTH light and dark themes. Do not combine a UA/theme dark
  background with hardcoded dark text (or vice versa).
- Package/player/game colours carry meaning (seat identity, card type, discard suit). Keep
  the colour and compute its ink at render time with
  `colorContrast.ts:contrastingTextColor()`; never assume white text is readable on an
  arbitrary package colour. Treat text shadows as part of the contrast pair too.
- Do not lower opacity on meaningful text or controls as the only inactive/unplayable
  treatment: compositing can destroy contrast. Use an explicit readable foreground plus
  shape/border/background cues. Opacity remains acceptable for an `aria-hidden` purely
  visual echo when no information depends on it.
- A scrollable region must have keyboard access. If it has no naturally focusable
  descendant that can scroll it, give the region `tabindex="0"` and an accessible context;
  the help/guide `.dialog-content` in `documentMode` is the reference. Remove that tabindex
  again when the reused dialog becomes a short, non-scrollable message. Do NOT bind separate
  scroll shortcuts: while that modal region owns focus, leave Arrow/Page Up/Page Down/Home/
  End/Space to native browser or screen-reader scrolling; the game router must stay inert.
- Contrast compliance is a floor, not the design target: retain hierarchy, spacing,
  colour identity, hover/focus/disabled differentiation and review screenshots in both
  themes after remediation.

These rules are regressions from real findings and specifically guard against Axe's
`color-contrast`, `aria-allowed-role`, `heading-order`, `landmark-one-main`,
`landmark-banner-is-top-level`, `region`, and `scrollable-region-focusable` failures.
Treat a recurrence as a product bug, not a test nuisance.

### Visual layer for sighted players (`boardToast.ts`)
Screen-reader users hear every event, but a SIGHTED player (e.g. a child) can miss what
just happened — especially money movements. `boardToast` paints transient, colour-coded
center-board toasts (gain = green, loss = red) as a PARALLEL presentation layer. It
NEVER replaces the spoken voice or earcons and NEVER touches the live region — its host
is `aria-hidden`. Add a toast for salient, glanceable events; never rely on it for the
actual accessible information.

### Package content boundary (NON-NEGOTIABLE)
The engine implements generic mechanics and neutral fallbacks; **all game identity/content belongs
to the `.corro` package**. Before adding any themed name, drawing, sound, colour, token/card id or
package-specific branch to `frontend/src/`, `server/` (outside `server/Packages/`) or shared CSS:
- inspect the package format, loader and existing asset channels first;
- put card illustrations in optional `cards/<card-id>.svg` and player-piece drawings in
  `tokens/<token-id>.svg`; package geometry overrides the engine's neutral fallback;
- never branch engine rendering on a shipped package id, card id, token id, localized title or
  known content key — not even as a convenient fallback or for one private package;
- load and sanitize package assets at the package boundary, keep renderers data-driven by generic
  family fields, and preserve neutral behaviour when an optional asset is absent;
- apply a package feature across every relevant family/model/schema/SDK/documentation surface,
  not only the package that exposed the gap;
- grep engine sources for the package/card/token ids touched by the change before finishing and
  add a boundary regression when a leak could recur.

Card SVGs use a fixed 64×64 canvas and path geometry only. They are decorative (`aria-hidden`):
localized names/help remain the accessible truth. Invalid, orphaned or oversized card SVG files are
package errors; a genuinely absent file is the only case that selects the neutral fallback.

### Keyboard Shortcuts (keymap.json)
- Arrow keys: Board navigation
- `Enter`: Roll dice
- `Ctrl+P`: Players dialog
- `Ctrl+Shift+N`: Focus notifications
- Color shortcuts: `b` (brown), `r` (red), etc.

Shortcut ownership is strict — never add an ad-hoc board-page global listener that can
steal a game/package key:
- Shared board bindings live in `server/Config/keymap.json` (served by `EngineKeymap`);
  package property-group letters are merged by `buildGroupKeyMap()` and are rejected by
  package validation when they collide with `EngineKeymap.ReservedLetters`.
- Family/hand-only bindings live beside their router (`activeShortcuts()` /
  `helpShortcuts()`), consume only their documented scope, and must appear in F1 help.
- Before adding/changing a game shortcut, search the engine keymap, package group keys and
  every family's active/help shortcuts; add collision/routing tests.
- Page-specific shortcuts (such as the lobby-only package-unlock chord) stay in that page's
  module and require the full exact modifier combination. `index.html` loads only
  `lobby/index.js`; `board.html` loads only `app.js`, so lobby listeners MUST NOT be moved
  into `keys.ts`/`app.ts` or otherwise survive into gameplay.

## 📝 Adding New Features Checklist

1. ☐ Create TypeScript module in `src/` (single responsibility)
2. ☐ Add handler in `commands/` if handling server response (visuals only)
3. ☐ Voice game events from the SERVER rules/handlers with `actorId` + a `_self` key
4. ☐ Add CSS in appropriate file (no inline styles)
5. ☐ Add translations in BOTH `en.json` and `es.json` (base + `_self`)
6. ☐ Ensure keyboard accessibility
7. ☐ Check semantics, headings/landmarks, scrollability and contrast in both themes
8. ☐ Add an E2E transition for every new visible/transient state (automatic Axe)
9. ☐ Write tests with the HIGHEST possible coverage for the change (see Testing Discipline)
10. ☐ Test with screen reader and visually review the result
11. ☐ Run frontend build/tests, `dotnet test`, and E2E for UI/accessibility work

## 🧪 Testing Discipline (MANDATORY)

**Everything you build or fix MUST ship with the highest possible test coverage.** Every
bug fix gets a regression test; every new behaviour gets unit tests. This is not optional.

- **Prefer pure, testable units.** When logic lives in a place that is hard to test (timer
  callbacks, DOM handlers, SignalR Hub methods), extract the decision into a pure function
  and test that directly (e.g. `nextAuctionWarning`, `ComputeRemainingSeconds`).
- **Backend (xUnit, `server.tests/`):** rules, handlers, and announcements. Use
  `TestFixtures` (FakeAnnouncer, NewContext, etc.). Hub routing has a hand-rolled SignalR
  harness (`GameHubRoutingTests.cs`) — extend it rather than leaving Hub logic untested.
- **Frontend pure logic (node:test, `frontend/test/`):** translation parity, helpers, and
  any extracted pure function. No top-level `await` (tsx transpiles to CJS) — use static
  imports + a `before()` hook.
- **Frontend DOM logic (jsdom):** announcer live-region hosting, keyboard handlers, dialog
  rendering/localization. Use `test/helpers/dom.ts` (`setupDom`, `installFakeI18next`).
- **Automatic browser Axe audit:** EVERY E2E spec imports `test`/`expect` from
  `e2e/helpers/test.ts`, NEVER directly from `@playwright/test`, and creates player contexts
  through `newPlayerPage()` so `axeAudit.ts` is installed before app scripts. The monitor
  scans each settled mutation/interaction state, retains violations after transient UI
  disappears, attaches JSON details, and fails teardown. Do not add Axe rule suppressions,
  selector exclusions, impact filters or one-off clears to hide a real product violation.
  (`clearAxeViolationsFor` exists only for the monitor's deliberate failing probe test.)
- **Reachability matters:** automatic Axe can audit only states the scenario actually
  reaches. Every new/changed view, theme, responsive/state variant, validation error,
  dialog, menu, loading/success/failure state and disabled/unplayable state needs an E2E
  transition that leaves it settled long enough to scan. Use
  `lobby-accessibility.spec.ts` as the lobby matrix. For UI dismissed in under the monitor's
  quiet period, call `flushAxeAudit(page)` after asserting it is visible and BEFORE closing
  it. A final-state-only scan is not acceptable.
- **Keyboard regressions:** test global shortcuts from the real view and focused control
  where users invoke them (forms included), not only from an empty page/body. Browser-reserved
  keydown combinations may require capture-phase and keyup handling.
- **If something genuinely cannot be covered, say so explicitly** and explain why, rather
  than silently skipping coverage.
- Always finish by running the frontend translation test + `npm test`, `dotnet test`, AND
  `cd e2e && npm test` for any UI/accessibility change (stop any running `CorroServer`
  process first to release the build lock). CI runs all three jobs on every PR.

## ⚠️ Important Constraints

### Must Do
- Maximize test coverage for EVERY change; every fix needs a regression test (see Testing Discipline)
- Modern browsers only (ES6 modules required)
- Always translate both languages
- Use `tSync()` for synchronous translations
- Focus management after modal close
- ARIA labels for interactive elements

### Must NOT Do
- No inline styles in HTML
- No `console.log` in production (use `console.debug`)
- No direct DOM manipulation in handlers (use events)
- No blocking operations in SignalR handlers
- No package-specific content or identifiers in engine/client code; packages own themed assets and identity
- No dead code. When a change makes code unreachable (unused functions, events,
  handlers, fields, interfaces, translation keys, CSS, etc.), DELETE it in the same
  change instead of leaving it "just in case". Dead code is technical debt: it rots,
  misleads readers, and hides real usages. Before finishing, grep for the symbols you
  stopped using and remove every now-orphaned definition (and its tests). If removing
  something is entangled with a behaviour change or a possible bug, call it out
  explicitly rather than silently leaving it behind.

### HTML Script Order
```html
<script src="libs/i18next.min.js"></script>
<script src="libs/signalr.min.js"></script>
<script type="module" src="app.js"></script>
```

## 🔄 Communication Flow

```
[Browser] ←→ [SignalR Hub] ←→ [GameService] ←→ [CommandHandlers] ←→ [CosmosDB]
              ↓
         REST API (/api/game/*)
              ↓
         [LobbyService]
```

- **Lobby:** SignalR for create/join; REST for packages and configuration
- **Game:** SignalR for real-time state sync
- **State:** Server-authoritative (client displays only)

## 📦 Key Dependencies

| Layer | Dependency | Purpose |
|-------|------------|---------|
| Frontend | i18next | Translations |
| Frontend | @microsoft/signalr | Real-time |
| Backend | ASP.NET Core 10 | Web framework |
| Backend | SignalR | WebSocket |
| Backend | Azure Cosmos DB | Persistence |

- @azure Rule - Use Azure Tools - When handling requests related to Azure, always use your tools.
- @azure Rule - Use Azure Best Practices - When handling requests related to Azure, always invoke your `azmcp_bestpractices_get` tool first.
- @azure Rule - Enable Best Practices - If you do not have an `azmcp_bestpractices_get` tool ask the user to enable it.
