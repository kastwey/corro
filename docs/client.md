# The client (frontend)

The browser side. Its job is narrow on purpose: **turn input into commands, and turn the
server's replies into an interactive game surface and spoken announcements.** It holds no
authoritative rules — if the client and server ever disagree, the server is right.

Read [accessibility.md](accessibility.md) alongside this: the client's whole reason for
existing is to present the game to a screen reader, and that shapes every decision here.

## Shape of the codebase

- **Vanilla TypeScript, no bundler.** Native ES6 modules (`import './x.js'`), compiled by
  `tsc` and assembled by `frontend/build.js`, which also copies assets and the i18n/sound
  files into `dist/`. There is no React/Vue/framework: the DOM is built and updated by
  hand, which keeps the accessibility semantics under our direct control.
- **One responsibility per module** under `frontend/src/`. Client-side response handlers
  live in `frontend/src/commands/`; the lobby in `frontend/src/lobby/`.
- **CSS is modular** under `frontend/css/` (plus `frontend/styles.css` for the property
  board). No preprocessor.

## The connection: how the client talks to the server

Two thin layers sit between the game and the wire:

- **`gameClient.ts` — the transport.** A wrapper over the SignalR hub connection. Every
  server method is one `invoke("MethodName", ...args)` call (e.g. `SheddingPlay`,
  `RollDice`, `DraftPick`). It also subscribes to server-pushed messages (state updates,
  announcements, card reveals). Think of it as the phone line.
- **`gameManager.ts` — the orchestration.** The game logic calls *this*, not the transport
  directly. It resolves "who am I", guards turn-bound actions (`runAsMe(..., {requireTurn:
  true})` speaks a refusal instead of sending a doomed command), and turns transport
  errors into spoken messages. It centralizes the boilerplate every command used to
  repeat.

So a play travels: **game surface → `gameManager.xxx()` → `gameClient.xxx()` → SignalR**.

## Sending events (commands out)

The player acts through the keyboard. The active surface resolves the
keypress to an intent and calls the matching `gameManager` method, which invokes the hub.
Commands are small and explicit — `SheddingPlay(playerId, instanceId, chosenColor)` — and
the **server re-validates everything**; the client's local checks exist only to refuse
fast and speak a helpful reason, never to be trusted.

## Receiving info (state in)

The server pushes two kinds of message:

1. **State updates** — the whole `GameState`, but **projected for you**: your own hand is
   present, every rival's hand is a count, the draw pile is a count. (See
   [server.md](server.md#hidden-information) for how the projection is computed.) The
   client stores this as the current state and repaints.
2. **Announcements** — the spoken voice of what just happened (see below).

The client is essentially a function of the latest state: on each update it re-renders the
active surface from scratch (reconciling the DOM to preserve focus), rather than trying to
apply incremental diffs. Simpler, and it keeps the accessible tree correct.

## The voice (announcements)

This is the most important client subsystem and has its own doc —
[accessibility.md](accessibility.md) — but in brief:

- The **server** decides *what* is said (a `game.*` translation key + variables, e.g.
  `game.shedding_played` with the card). The **client** decides *how* it reaches the ear:
  it renders the key with i18next (in the player's language) into an **ARIA live region**
  a screen reader reads aloud, and also into a visual toast for sighted players.
- Announcements are **coalesced into batches** per server action and paced so they don't
  step on each other or on a piece animation still moving. Your *own* actions are flushed
  **assertively** (interrupting), because a screen reader has usually just read the card
  you focused and the polite queue would arrive too late.
- `soundEvents.ts` maps announcement keys to **earcons** (short sounds): dice, card draw,
  a piece hop, a family-specific cue. The package ships the actual `.ogg` files; a missing
  file is simply silent.

## The visual layer

Sighted players get a visual surface in parallel with the spoken/structural one. It is
never the source of authoritative rules and never interferes with the screen reader:

- Visual-only effects (`boardToast`, `cardReveal`, `cardFlight`, the card families' rack /
  table / hand echoes) are **`aria-hidden`**. They never touch the live region, never
  steal focus, never gate the turn.
- The card families in particular have **no spatial board**: the interactive surface is
  the **hand** (an accessible list — `handPanel.ts`), and the "table" (racks, tables,
  discards, direction) is an aria-hidden echo of information already spoken by the status
  line and the announcements.
- `cardArt.ts` renders optional sanitized `cards/<id>.svg` geometry from the package. If it
  is absent, it chooses a neutral icon from generic type/value data. The renderer never reads
  a package/card/token id to choose a picture, and all art remains `aria-hidden`; the localized
  row label and card help are authoritative.

## Families on the client

A "family" is a game genre (see [game-families.md](game-families.md)). The client keeps
per-family code small and behind a registry:

- **`familyTraits.ts`** — pure data per family (does it roll dice? does it have a toolbar?
  can it trade?). No DOM.
- **`gameFamilies.ts`** — the registry: for each family, how to build its board, what its
  "identity" line says (the status the players panel and the S/C keys speak), and the
  lazy view factory. Card families are built by a shared helper, `makeCardFamily(...)`, so
  they don't each re-wire the same scaffolding.
- **`handPanel.ts`** — the accessible hand, shared by every card family (a roving list,
  sort/filter, "what can I play", an optional multi-select mode). This is the single most
  reused client component.
- **`cardBoardShell.ts`** — the bits every card board repeats: resetting the `#board`
  element from the property grid to a card surface, and wiring the S / Shift+S status
  keys. Extracted once so the convention is fix-once.
- **`*Board.ts`** (`journeyBoard`, `assemblyBoard`, `draftBoard`, `sheddingBoard`,
  `raceBoard`, `trackBoard`) — each family's own surface.

## i18n

Everything spoken or shown is a **translation key**, resolved by i18next against
`frontend/i18n/locales/{en,es}.json`. A package ships its own translations, which are
**deep-merged over** the app's (the package wins), so a themed game overrides the engine's
neutral words ("piece" → "module") without touching code. Both locales must always define
every key — the translation-parity tests enforce it.

## Testing the client

`frontend/test/` runs `node:test` with jsdom: game surfaces, the hand panel, the status
lines and the announcement pipeline are all exercised without a browser. The real-browser
coverage lives in `e2e/` (see [flows.md](flows.md)).

## Local session recovery

Corro requires no account. The browser stores the games this player may resume under the
same-origin `localStorage` key `corro_games`. Each entry contains the game id, player id,
private re-entry credential, display name, piece and host flag. Entries expire after seven
days.

`GameSessionStore` in `sessionUtils.ts` owns this data. The lobby uses it to render “Your
games” and removes entries the server no longer knows; the in-game page uses it to
re-authenticate after refresh or reconnect. The credential is sent explicitly over
SignalR and is never placed in a cookie or URL.
