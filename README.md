# Corro Online — accessible multiplayer game engine

A multiplayer engine for **spatial games, card games and other turn-based interaction
forms**, built accessibility-first so blind and sighted players can share the same game.
Content — boards or decks, pieces, optional card illustrations, languages and sounds — lives in
`.corro` packages. Card-bearing packages may override neutral faces with `assets/cards/<card-id>.svg` and
may add a validated `artColor: "#RRGGBB"` accent; localized names remain the accessible truth.
The authoritative server runs the rules; the browser renders each player's permitted
view and provides parallel visual and screen-reader presentations.

> **New here?** Read the architecture docs in **[`docs/`](docs/README.md)** — the big
> picture, the client, the accessibility doctrine, the server, how game families work, and
> end-to-end flows. To make a game as a *package* without programming, start with the
> [beginner guide](docs/package-authoring.md) ([Spanish](docs/package-authoring.es.md)). Keep
> [`CORRO_FORMAT.md`](CORRO_FORMAT.md) as the advanced reference and use the
> [Corro Package SDK](tools/Corro.PackageCli/README.md) to create, validate and pack it.

Create a valid starter for any supported family:

```bash
dotnet run --project tools/Corro.PackageCli -p:SkipFrontendBuild=true -- new journey games/my-journey
```

## Quick start — complete development stack

This is the recommended first-run path. It starts or reuses the **Cosmos DB emulator** and
**Azurite**, installs missing frontend dependencies, builds the client, watches every frontend
input, configures the local connection-string secrets, enables the shared pre-push test hook for
this clone, and runs the .NET server. You do not need to run `npm install`, install the hook or run
`docker compose up` separately.

Install these prerequisites first:

- **[.NET 10 SDK](https://dot.net/download)**
- **[Node.js 20+](https://nodejs.org/)**
- **[Docker](https://www.docker.com/)**. Its daemon may be stopped: the startup script attempts
  to launch Docker Desktop on Windows/macOS or the installed Docker service on Linux.
- **[PowerShell 7+](https://learn.microsoft.com/powershell/scripting/install/installing-powershell)**
  (the `pwsh` command; available on Windows, macOS and Linux)

Then, from a terminal:

```bash
git clone https://github.com/kastwey/corro.git
cd corro
pwsh ./tools/dev.ps1
```

Open **http://localhost:5000** when the terminal reports `Application started`. The first Cosmos
startup can take around 30 seconds. Changes to TypeScript, HTML, CSS, translations, configuration
or assets are rebuilt into `frontend/dist` automatically; refresh the browser to see them. The
.NET server does not need to restart for frontend changes.

Press **Ctrl+C** to stop both the server and frontend watcher. The emulators deliberately remain
running for the next session; stop Corro-owned emulator containers when finished with:

```bash
pwsh ./tools/stop.ps1          # keep persisted Azurite data
pwsh ./tools/stop.ps1 -Wipe    # also delete that data
```

Useful startup variants:

- `pwsh ./tools/dev.ps1 -NoWatch` — build the frontend once without keeping a watcher running.
- `pwsh ./tools/dev.ps1 -Build` — additionally mirror the initial frontend build into
  `server/wwwroot`; normal Development mode does not require this.

Docker is optional if persistence is not needed. See [Getting started (local)](#getting-started-local)
for the in-memory and all-in-Docker alternatives.

## Why “Corro”?

In Spanish, a **corro** is a ring of people — often children — standing or moving in a
circle, usually holding hands. English has nearby images in *circle* and *ring*, but no
single everyday word carries quite the same picture, so the project keeps the Spanish
name.

Seen from above, that circle is also a wheel: every person has an equal place on its rim
and stands at the same distance from the shared centre. There is no head of the circle,
no privileged seat and no participant who matters more than another. The centre belongs
to everyone; it is where the game, the conversation and the experience are shared.

The joined hands matter too. A corro is not a collection of isolated spectators: everyone
takes part, supports the people beside them and makes the circle whole. That is the image
behind Corro Online — blind and sighted players, using different ways to perceive and
control the game, participating together as equals around the same authoritative game.
Accessibility is not an accommodation added at the edge; it is part of the circle's shape.

## Architecture

```
[Browser]  ──SignalR (WebSocket)──►  [GameHub]  ──►  [GameService]  ──►  [CommandDispatcher]  ──►  [Handlers]
     │                                    │                │                                          │
    │  REST /api/* (packages, config)    │                └──► [CorroRulebook / AuctionRulebook]  │
     ▼                                    ▼                                                           ▼
 [Lobby + board]                  [Cosmos DB / in-memory persistence]                         [mutated GameState]
```

- **Lobby:** SignalR creates and joins games; REST serves packages and configuration.
- **Game:** SignalR for real-time state synchronisation.
- **Optional voice:** authenticated audio-only LiveKit rooms on a self-hosted SFU/TURN relay;
  games and text chat continue normally when the relay is not configured or unavailable.
- **State:** authoritative server. The client sends *commands* and receives *responses*
  and *announcements*; it never computes rules.
- **Persistence:** Azure Cosmos DB in production; locally, the Cosmos emulator **or** an
  **in-memory** repository when nothing is configured (everything sits behind
  `IGameRepository`). See [Getting started (local)](#getting-started-local).

Voice chat is opt-in per game and per player, includes local per-person volume and a
reversible one-shot host mute, and exposes active speakers visually plus through an
on-demand keyboard query. See [the voice architecture and accessibility guide](docs/voice-chat.md)
and [the VPS deployment template](infra/livekit/README.md).

## Repository layout

```
├── frontend/                       # Client (vanilla TypeScript, no bundler)
│   ├── src/
│   │   ├── index.html              # Lobby page
│   │   ├── board.html              # In-game page
│   │   ├── app.ts                  # In-game orchestrator (composition root)
│   │   ├── gameClient.ts           # SignalR client (transport, typed events)
│   │   ├── gameManager.ts          # Client-side authoritative state + command sending
│   │   ├── board.ts                # Board rendering and navigation (11x11 grid, 40 squares)
│   │   ├── dialogManager.ts        # Accessible modal dialogs (native <dialog>)
│   │   ├── announcer.ts            # ARIA live regions for screen readers (polite + assertive)
│   │   ├── announcementGate.ts     # Holds 'resolve' announcements until the token stops moving
│   │   ├── turnSequencer.ts        # Serializes (events + state) segments to token hops
│   │   ├── tokenAnimator.ts        # Animates token hops; fires onIdle when movement settles
│   │   ├── boardToast.ts           # Transient visual notices at the board centre (sighted players)
│   │   ├── popupMenu.ts            # Reusable accessible menu (WAI-ARIA: roving tabindex, typeahead)
│   │   ├── i18nBinder.ts           # Translation system (i18next) + board vocabulary
│   │   ├── models.ts               # Domain types (GameState, Player, Square…)
│   │   ├── keys.ts                 # Keyboard shortcuts → commands
│   │   └── commands/               # Server-response handlers (registry pattern)
│   ├── css/                        # Modular CSS (no preprocessor, no inline styles)
│   ├── i18n/locales/               # App translations (en.json, es.json)
│   ├── test/                       # node:test suites (run with tsx)
│   └── build.js                    # Simple build script (compiles TS + copies assets)
├── server/                         # Backend .NET 10 (ASP.NET Core + SignalR)
│   ├── Program.cs                  # Host bootstrap, static files, hub mapping, E2E test mode
│   ├── Hubs/                       # GameHub (partial): Core, Commands, Events, Lobby + session registry
│   ├── Controllers/                # REST API (game, config, packages, sounds)
│   ├── Services/
│   │   ├── GameService.cs          # Per-game orchestrator (serializes commands with a lock)
│   │   ├── Commands/               # Command handlers (ICommandHandler<TCommand>)
│   │   ├── Rules/                  # CorroRulebook + AuctionRulebook (authoritative rules)
│   │   └── Corro/                # .corro package loading, validation and adaptation
│   ├── Models/                     # DTOs and domain models
│   ├── Config/keymap.json          # Keyboard map (served at /api/config/keymap)
│   └── Packages/                   # Boards shipped with the server (.corro content)
├── server.tests/                   # xUnit suites (unit + integration playthroughs)
└── e2e/                            # Playwright end-to-end suite (real browsers, scripted dice)
```

## Command flow (authoritative server)

1. The client sends a command over SignalR (e.g. `RollDice`) from `gameManager`.
2. `GameHub` receives the invocation and forwards it to `GameService.ExecuteCommandAsync`.
3. `GameService` **serializes** execution with a per-game lock (`SemaphoreSlim`) and
   delegates to `CommandDispatcher`, which locates the right `ICommandHandler<TCommand>`.
4. The handler validates and delegates rule logic to `CorroRulebook` / `AuctionRulebook`.
   The **rulebook owns the game's announcements** (the handler only shapes the response).
5. The mutated state is persisted and broadcast to the game group's clients.

## Command handler pattern

**Frontend** — handles server *responses* (open/closed registry in `commands/registry.ts`):

```typescript
export class MyHandler implements ICommandHandler {
    readonly responseType = 'MY_RESPONSE_TYPE';
    handle(response: CommandResponse, context: CommandContext): void {
        // Visuals/local UI only: the VOICE of game events comes from the server.
        context.emit('myEvent', data);   // never touch the DOM directly
    }
}
// Register in registry.ts: registry.register(new MyHandler());
```

**Backend** — handles *commands* and returns a `ServerResponse`:

```csharp
public class MyHandler : ICommandHandler<MyCommand>
{
    public async Task<ServerResponse> HandleAsync(MyCommand cmd, GameContext ctx)
    {
        var player = ctx.Helper.GetPlayer(cmd.PlayerId);
        if (player == null)
            return new ErrorResponse { Message = "Player not found", Code = "PLAYER_NOT_FOUND" };
        // validate and delegate to the rulebook…
        return new MyResponse { /* … */ };
    }
}
```

## Building and testing

### Prerequisites

- **[.NET 10 SDK](https://dot.net/download)** — backend build/tests, and the E2E suite (it starts the
  server with `dotnet run`).
- **[Node.js](https://nodejs.org/) 20+** — the frontend and the E2E suite.
- **[Docker](https://www.docker.com/)** — *optional*. Only for the persistent-mode emulators (Cosmos
  + Azurite) and the `[CosmosFact]` / `[AzuriteFact]` integration tests, or the full Docker stack. The
  default frontend, backend and E2E runs need none of it — the integration tests **skip** (never fail)
  when the emulators are down.
- **[PowerShell 7+](https://learn.microsoft.com/powershell/scripting/install/installing-powershell)**
  — required only for the cross-platform development, emulator and hook-installation scripts.

### Before pushing: enable the local test gate

The recommended `pwsh ./tools/dev.ps1` startup installs the versioned `pre-push` hook
automatically and idempotently for the current clone. If you use another startup path, enable it
once after cloning:

```bash
pwsh -File ./tools/install-hooks.ps1
```

The hook runs before **every push to any branch**. It checks repository conventions, builds and
tests the frontend, then builds and tests the backend; a failure aborts the push. Playwright remains
opt-in because it needs installed browsers and takes several minutes:

```powershell
$env:RUN_E2E = '1'; git push       # PowerShell
```

```bash
RUN_E2E=1 git push                 # bash/zsh
```

This is a local safety net, not a replacement for CI or branch protection. Use `--no-verify` only
for a genuine emergency with a known reason.

### Frontend
```bash
cd frontend
npm install
npm run build        # Compiles TS and copies assets to dist/
npm test             # All node:test suites (tsx), incl. translation parity
```

### Frontend dev loop (no backend restart)

In **Development** the server serves the frontend straight from `frontend/dist`, so you iterate the
client without rebuilding the backend. `pwsh tools/dev.ps1` performs one complete build, starts the
frontend watcher and then runs the server in the foreground. The watcher mirrors TypeScript, HTML,
CSS, i18n, configuration and assets into `dist`; stop the server with Ctrl+C and its watcher stops too.
Refresh the browser after an edit — there is intentionally no live-reload injection.

To run the watcher separately (for example when launching the server with F5):
```bash
cd frontend
npm run watch     # initial full build, then watches TS + all static frontend inputs
```
Use `npm run watch:ts` only when you deliberately want the old TypeScript-only watcher. In
**production and E2E** the server serves the packaged `wwwroot/` instead (`dist` isn't published) —
see `server/Program.cs`.

### Backend
```bash
cd server
dotnet build         # Builds (also triggers the frontend build into wwwroot/)
dotnet run           # Serves the built frontend and exposes the hub/API
dotnet test ../server.tests/CorroServer.Tests.csproj
```

> The server project also triggers the frontend build, so `dotnet build` validates both
> halves in one step. The backend serves the frontend from `frontend/dist` in Development and
> from the packaged `wwwroot/` in production/E2E.

### End to end (Playwright)
```bash
cd e2e               # run from e2e/, not the repo root
npm install && npx playwright install chromium   # first time
npm test             # starts the server itself in its deterministic E2E mode
```

The E2E suite drives **real browsers** (one context per player) against the real server
running with `ASPNETCORE_ENVIRONMENT=E2E`: dice are scripted through a test-only endpoint,
decks keep their declared order, turn order is the join order, and persistence is
in-memory — so whole games are replayed deterministically. Assertions read the ARIA live
regions (what a screen reader would hear) and compare texts against the package's own
i18n files. See [`e2e/README.md`](e2e/README.md).

## Getting started (local)

The server picks its persistence automatically from whether connection strings are
configured — no code changes. Everything below is cross-platform (Windows, macOS, Linux,
including Apple Silicon). Pick the level you want.

### Brand a self-hosted site

The public site identity is deployment configuration, not an engine fork. Edit the
`SiteBranding` section in `server/appsettings.json`, or override individual values with
standard ASP.NET Core environment variables such as `SiteBranding__Title` and
`SiteBranding__Tagline`. The included defaults are **All Welcome** and
**Play together, play your way.**

`LogoUrl` and `LogoDarkUrl` are optional. With neither set, the lobby renders the title as
text; with one set, that image is used in both themes; with both set, the active theme chooses
the appropriate image. `FaviconUrl` and `FaviconDarkUrl` follow the same rule. Asset values may
be same-site paths or HTTPS URLs. The engine attribution is deliberately separate from host
branding: every deployment retains **Powered by Corro**, with **Corro** linking directly to the
source repository.

### Level 0 — Just run it (no Docker, no Azure)

Games live **in memory** (lost on restart) and uploaded boards go to a temp folder. Only the
**.NET SDK** and **Node** are needed (the backend build triggers the frontend build).

```bash
cd server
dotnet run --urls http://localhost:5000
```

Open http://localhost:5000. The ideal mode to clone and try the project — zero Azure setup.
Shipped boards and whole games work 100% offline.

### Level 1 — Persistent, emulators in Docker (recommended for development)

Games survive restarts, as in production. One command starts or reuses the **Cosmos DB emulator**
and **Azurite** (blob storage), prepares and watches the frontend, and runs the app **on your
machine**:

```bash
pwsh tools/dev.ps1            # secrets + full frontend watch + server (Ctrl+C stops both app processes)
```

There is no need to run `docker compose up` first. After Ctrl+C, use `pwsh tools/stop.ps1`
to stop Corro-owned emulators; add `-Wipe` to also remove persisted Azurite data. Use
`tools/dev.ps1 -NoWatch` for a one-time frontend build, or `tools/dev.ps1 -Build` to additionally
mirror that initial build into `server/wwwroot`.

`tools/dev.ps1` probes the actual host endpoints before invoking Compose. If healthy Cosmos
or Azurite instances are already running — even under another Compose project — it reuses
them and starts only the missing service. If an unrelated process owns `8081` or `10000`, it
stops with a precise conflict message instead of mistaking that process for an emulator.

When an emulator is missing, the script verifies Docker before invoking Compose. A missing Docker
installation or Compose plugin produces an installation-specific error. If Docker is installed but
its engine is stopped, it attempts to start Docker Desktop on Windows/macOS, `docker.service` (with
an elevation prompt when needed), Docker Desktop for Linux, or a configured rootless/legacy Linux
service, then waits for the engine to become ready. Permission and startup-timeout failures are
reported as Docker problems rather than misleading Cosmos DB failures.

Prereq: **Docker** installed. Ports used: **8081** (Cosmos), **1234** (Cosmos data explorer),
**10000** (Azurite), **5000** (server). `pwsh` (PowerShell 7+) runs on all three OSes; the
scripts are optional — you can also `docker compose up -d` and start the server yourself with
the two `ConnectionStrings:*` set in user-secrets.

### Level 2 — Everything in Docker (no local SDK or Node)

The whole stack — **app included** — in containers, one command. Built from
[`server/Dockerfile`](server/Dockerfile):

```bash
docker compose --profile full up --build   # Cosmos + Azurite + app
docker compose down                        # stop everything (add -v to wipe volumes)
```

Open http://localhost:5000. The app waits for Cosmos to be healthy, then bootstraps its
database on first boot.

## Debugging with the emulators up

Recommended model: **emulators in Docker, app debugged from your IDE on the host** — native
breakpoints, no in-container debugger.

- **VS Code:** press **F5** and pick a config ([`.vscode/launch.json`](.vscode/launch.json)):
  *Debug CorroServer (in-memory)* (no Docker) or *Debug CorroServer (Docker emulators)*
  — the latter's `preLaunchTask` brings the emulators up (waiting for Cosmos to be healthy)
  and injects the emulator connection strings before launching.
- **Visual Studio:** open `server/CorroServer.csproj`, run `docker compose up -d` once (or
  `tools/dev.ps1`), then **F5** — the app reaches the emulators on localhost.
- **Inside the container (optional):** to debug the app *in* its container, attach with the
  VS Code Dev Containers / Docker extension to the running `corro-app`, or use Visual
  Studio's container tooling against `server/Dockerfile`. Slower inner loop — Level 1 is
  usually preferable.

## Content: `.corro` packages

The engine is content-agnostic. A game is a `.corro` package (a zip) carrying its
board or deck, pieces, optional card illustrations, per-locale texts, terminology and sounds.
Packages can be **bundled**
with the server (`server/Packages/`) or **uploaded** at runtime from the lobby; the
engine treats both identically.

The format is designed for **game families**: every package declares a `gameType`, and
each family plugs its own rulebook and board topology under the same package envelope.
This engine version implements nine: `property` (roll-and-move property trading),
`race` (cross-and-circle races), `track` (shared-path race games), `journey`
(distance-and-hazard card games), `assembly` (set-building card games), `draft`
(simultaneous card drafting), `shedding` (match-and-discard card games), `exploding`
(push-your-luck elimination card games), and `trivia` (category quiz games). See
[`CORRO_FORMAT.md`](CORRO_FORMAT.md)
for the package specification and [`CONTRIBUTING.md`](CONTRIBUTING.md) for the rules on
which games can be bundled into this repository (original or freely licensed content
only).

## Accessibility

- ARIA live regions (`aria-live="polite"` / `assertive`) for game announcements.
- Keyboard navigation (arrows, Tab, Enter) and focus management after closing dialogs.
- Native `<dialog>` modals (trapped focus, no `aria-modal` duplication).
- Semantic HTML, **no nested landmarks** (the board is a container with a short localized
  `aria-label`, not a `<main>`/`<section>`), ARIA labels on interactive elements.
- Configurable keyboard shortcuts (`server/Config/keymap.json`, served at
  `/api/config/keymap`).
- **The server owns the voice:** rules announce with `context.Announce(key, vars)`
  (including `actorId`); the acting player hears the first-person `<key>_self` variant.
  Every key needs its `_self` variant in both languages.
- **Movement pacing:** every announcement carries a phase — `move` (the roll, spoken
  immediately) or `resolve` (consequences). The `AnnouncementGate` holds `resolve` lines
  until the token finishes hopping (`TokenAnimator.onIdle`), so a turn reads
  "dice → hop → what happened".
- **Background-tab robustness (two-window play):** background tabs suspend the
  `AudioContext` and pause `requestAnimationFrame`. Audio resumes on focus/visibility and
  instant announcements flush via `setTimeout` (not rAF) so they never pile up and burst
  when the tab wakes.
- **Context menus:** square actions use `popupMenu` (reusable WAI-ARIA menu); unaffordable
  options are `aria-disabled` with a spoken reason — never the `disabled` attribute.
- **Parallel visual layer:** `boardToast` shows colour-coded notices for sighted players
  without ever touching the ARIA live region (its host is `aria-hidden`).

## Internationalisation

- **Library:** i18next (UMD bundle). **Languages:** English (`en`), Spanish (`es`).
- **App namespaces:** `lobby.*`, `game.*`, `common.*`, `serverErrors.*`. Packages bring
  their own keys (square names, groups, terminology), merged at runtime.
- **Interpolation:** `{{variable}}` syntax, plus package vocabulary variables (`{{holding}}`,
  `{{currency}}`…) so app strings stay generic and each package supplies its own
  words. Every new string must be translated in **both** languages.

## Design principles

- **SOLID:** single responsibility per module, extensible handlers (OCP), segregated interfaces.
- **KISS:** no bundler, no preprocessor; native ES modules and vanilla CSS.
- **DRY:** unified i18n system and shared handler registries.

## Contributing

Want to help? See [`CONTRIBUTING.md`](CONTRIBUTING.md): how to open an issue, send a
pull request, and which boards can be bundled into the repository.

## License

Copyright © 2026 kastwey and contributors.

The original code, documentation and repository-authored content are licensed under the
**GNU Affero General Public License v3.0 only** unless a file or package states otherwise — see
[`LICENSE`](LICENSE) and [`NOTICE.md`](NOTICE.md). In short: you can use, modify and run it, including as a network
service, but if you offer a modified version to others over a network you must offer
them its source too.

External `.corro` packages are independent data and their authors choose their own
licenses. Packages bundled here follow the repository license for original content and
retain the separate licenses stated in their `CREDITS.md` files for third-party media.
