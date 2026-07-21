# Architecture overview

Corro Online is a multiplayer, **accessibility-first game engine** for blind and sighted
players. It supports spatial games, card games and several turn models from one
server-authoritative core.

## The three parts

º```
   ┌─────────────┐   SignalR (WebSocket)   ┌──────────────┐
   │   CLIENT    │ ──── commands ────────▶ │    SERVER    │
   │ (browser)   │ ◀─── state + voice ──── │  (.NET 10)   │
   │ vanilla TS  │                         │ authoritative│
   └─────────────┘                         └──────┬───────┘
         ▲                                        │ loads
         │ renders                                ▼
         │                                 ┌──────────────┐
  the player                             │   PACKAGE     │
  (visual or screen-reader UI)           │   .corro      │
                                          │ data, no code │
                                          └──────────────┘
```

1. **The server is authoritative.** It holds the real game state, runs the rules, decides
   who wins, and — crucially — **owns the spoken voice**. The client cannot invent game
   outcomes; it displays what the server sends. This matters for fairness (no client-side
   cheating), for security, and for accessibility (one authoritative narration, not N
   clients guessing).

2. **The client is a display + input surface.** Vanilla TypeScript, no bundler, native ES
   modules. It turns keypresses into commands, sends them to the server, and turns the
   server's replies into rendered state and screen-reader announcements. See
   [client.md](client.md).

3. **A package is pure data** (`.corro`, a zip): the board or deck, the names, the
   sounds, the translations. It brings the *theme*; the engine brings the *mechanics*. A
   package can never contain code or invent a rule. See
   [`../CORRO_FORMAT.md`](../CORRO_FORMAT.md).

## Package asset boundary

The package owns every themed asset; the engine owns only neutral mechanics and fallbacks.
Player pieces live at `assets/tokens/<id>.svg`, optional card illustrations at
`assets/cards/<card-id>.svg`, and earcons under `assets/sounds/`. SVGs are not served as arbitrary markup:
the loader extracts sanitized path geometry into the definition/state models. Card art uses
a fixed 64×64 canvas and overrides the neutral type/value drawing when present. This keeps
uploaded packages data-only, makes restore self-contained and prevents shared renderers from
branching on a known package, token or card id.

## Why this shape

- **Accessibility drives everything.** A blind player hears the game. If two clients
  narrated independently they'd drift, repeat, or contradict — so the server narrates
  once, authoritatively, and every client speaks the same line. See
  [accessibility.md](accessibility.md).
- **Security & fairness.** Hidden information (your hand) must never reach a rival's
  browser. The server sends each player a *projected* view with the secrets stripped. A
  packaged game is data only, so an uploaded game can't run code.
- **One engine, many genres.** Genres are **families** (see
  [game-families.md](game-families.md)). Adding a game is usually adding a package to an
  existing family, not writing an engine.

## Tech stack

| Layer | Tech |
| --- | --- |
| Client | TypeScript compiled with `tsc` (no bundler), native ES modules, i18next, the SignalR JS client, Web Audio for earcons. Built by `frontend/build.js` into `dist/`. |
| Transport | ASP.NET Core **SignalR** (WebSocket) — a hub the client calls like RPC, plus server-pushed messages. |
| Server | .NET 10, C#. A SignalR hub, a command pipeline, pure rulebooks, a family registry. |
| Persistence | Azure **Cosmos DB** (games) and **Blob** (uploaded packages); local emulators for dev. State serialized with System.Text.Json. |
| Tests | `frontend/test/` (node:test + jsdom), `server.tests/` (xUnit), `e2e/` (Playwright, real browsers + real server with scripted dice). |

## A turn, end to end (the one-paragraph version)

You press a key on your hand of cards. The client resolves it to a command and calls the
SignalR hub. The hub runs it through a dispatcher (which checks it's your turn) to a
handler, which calls a **pure rulebook** to compute the new state and **announces** the
outcome (a translation key + variables, with your id marked so *you* hear "you played…"
and everyone else hears "Ana played…"). The server then broadcasts the new state —
**projected per player** so nobody sees your remaining hand — and each client repaints its
board and speaks the announcement through an ARIA live region. The full trace, with the
exact modules, is in [flows.md](flows.md).

## Where things live (quick orientation)

- Client modules: `frontend/src/` (one responsibility each). Families:
  `familyTraits.ts`, `gameFamilies.ts`, the `*Board.ts` surfaces, `handPanel.ts`.
- Server: `server/Hubs/` (SignalR), `server/Services/Commands/` (handlers + dispatcher),
  `server/Services/Rules/` (rulebooks), `server/Services/Corro/Families/` (the family
  registry), `server/Services/Bots/`.
- Packages: `server/Packages/<id>/`. Format spec: [`../CORRO_FORMAT.md`](../CORRO_FORMAT.md).
- Contribution rules: [`../CONTRIBUTING.md`](../CONTRIBUTING.md).
