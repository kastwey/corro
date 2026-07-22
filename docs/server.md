# The server (backend)

.NET 10, C#. The server is **authoritative**: it holds the real state, runs the rules,
narrates the game, hides secrets, persists everything, and drives the bots. The client
only displays what the server sends.

## The command pipeline

Everything a player does is a **command**, handled the same way:

```
client → SignalR hub → CommandDispatcher → ICommandHandler → rulebook → announce + new state
```

1. **The SignalR hub** (`server/Hubs/GameHub.*.cs`, partial classes) exposes one method per
   command (e.g. `SheddingPlay`, `RollDice`, `DraftPick`). Each just packages a
   `GameCommand` and calls the shared `ExecuteCommand`, which does auth, game lookup,
   response routing and cleanup — so no hub method reimplements that.
2. **`CommandDispatcher`** routes a command to its handler by type (no reflection), but
   first runs two **guards**: the *turn guard* (a turn-bound command from anyone but the
   current player is rejected `NOT_YOUR_TURN`) and the *trade-freeze guard* (while a trade
   is pending, only the trade response / cancellation and read-only queries pass). Both are
   pure static methods, unit-tested without a dispatcher.
3. **An `ICommandHandler<TCommand>`** (e.g. `SheddingPlayHandler`) is the thin flow layer:
   it validates the player, calls the rulebook, and **owns the spoken voice** for the
   outcome (see [accessibility.md](accessibility.md)). Handlers emit announcements and
   state changes; they don't contain the rules themselves.

At command completion, `GameService` flushes the ordered `GameEvents` batch before the Hub
sends `GameStateChanged`. A handler cannot push an ordinary full-state snapshot through
`IGamePresenter`; the only mid-command state path is `CheckpointTurnSegmentAsync`, which
itself flushes that segment's events first. This structural rule keeps every family on the
same narration-before-repaint contract.

## Rulebooks — the rules, pure

The actual game logic lives in **rulebooks** (`server/Services/Rules/`): `CorroRulebook`
(the property family, split into partials) and one per card/board family
(`RaceRulebook`, `TrackRulebook`, `JourneyRulebook`, `AssemblyRulebook`, `DraftRulebook`,
`SheddingRulebook`). They are **pure**: no I/O, no announcements, no transport, and
**randomness is injected** (an `IRandomSource`, so the E2E environment can script a
deterministic "identity shuffle"). This purity is why they're cheap to unit-test
exhaustively — most of `server.tests/` is rulebook tests.

The split is deliberate: the **rulebook** decides *what happens*; the **handler** decides
*what is said and sent*. A rulebook returns a result record ("this attack destroyed the
piece; the winning line is X"); the handler turns that into announcements.

## The game-family registry

Genres are **families** (full treatment in [game-families.md](game-families.md)). The
registry is the one place they're enumerated:

- **`IGameFamily`** — the contract each family implements: load its package definition,
  validate it, create the initial game, build its runtime, process a dice roll (or refuse
  it), whether it has hidden information, how to project state per player, and how to fold
  a seat when a player leaves.
- **`GameFamilies.All`** — the list. The package loader, the content validator, game
  start/restore and the dice dispatch all ask the registry, so **adding a family is
  writing one class and registering it**, not editing those call sites.

  ## Package assets

  `CorroPackageLoader` resolves asset conventions before family validation. Required
  `assets/tokens/<id>.svg` and optional `assets/cards/<card-id>.svg` are parsed as XML with external entities
  and DTDs disabled; only `<path d>` geometry survives. Card art additionally requires a 64×64
  viewBox, a matching card id and per-file/package size limits. Invalid or orphaned files reject
  the package; a genuinely absent card file remains `Svg = null` and selects the client fallback.

  The resolved geometry rides in the relevant token/card definition, so folder packages,
  uploaded archives, persisted games and restored games follow one path. `PackageSummary` exposes
  `cardIllustrations` through `corro-package inspect`. Sounds differ because binary audio is served
  through the sound-pack provider instead of being embedded in game state.

## Hidden information

The single most important server responsibility for a card game. The full `GameState` is
authoritative and holds *everyone's* hands and the pile order — but a client must never
receive a rival's secrets. So:

- A family that hides information sets `HasHiddenInformation` and implements
  **`ProjectFor(state, playerId)`**: it returns the view *that player* may see — their own
  hand stays; every rival's hand collapses to a count; the draw pile becomes a count; a
  pending secret pick is stripped. A `null` playerId yields the **public** view (for an
  unauthenticated connection or a lobby payload).
- **`GameStateFanout`** plans a **per-connection** send: each player's socket gets *their*
  projection. There is exactly one state-send path, so no code can accidentally broadcast
  the full state.
- **Persistence always stores the full state**; projection is a wire-only concern.

Because this is the highest-stakes code (a bug leaks secrets), each family's projection is
written and tested on its own — see [game-families.md](game-families.md) for why they are
*not* merged into one generic projector.

## Leaving a game

Leaving the game runs the shared bankruptcy/retirement flow, which speaks a
**per-family** line (only the property family forfeits an estate; everyone else "retires")
and then calls the family's **`OnPlayerRetiredAsync`** *before* the turn passes, so the
family can fold the seat: move the leaver's cards somewhere sensible (so the game doesn't
stall on a ghost that never acts), clear any window waiting on them, and — for the
simultaneous or direction-aware families — hand the turn to the correct next player.

## Persistence

- A game's `GameState` is written to **Cosmos DB** as JSON via
  `SystemTextJsonCosmosSerializer` (camelCase, ignore-nulls). Writes go through
  **`GameStatePersister`**, a background, coalescing writer that took persistence off the
  awaited command path (latest-wins, never overlapping).
- **Restore** adopts the saved snapshot verbatim (positions, money, hands, piles, current
  turn) — it does not replay or reset. A package game re-attaches its rules on restore.
- Uploaded packages persist to **Blob**; shipped packages re-stage from disk by id.
- Game-over, host deletion and retention all use `GameSessionRegistry.DeleteGameAsync`:
  it stops live work, drains the coalescing persister, deletes Cosmos, then deletes the
  uploaded blob only if no other game still references it. Deleting Cosmos first avoids a
  restorable document pointing at a package that has already disappeared.
- `GameRetentionWorker` catches up at process startup and runs daily at 03:00 UTC. A game
  is eligible after 30 complete days without a persisted update, not merely 30 days after
  creation; any game still active in this process is skipped. The same pass removes uploaded
  blobs that have themselves been unreferenced for 30 days, including abandoned uploads and
  retries after transient Blob Storage failures.
- `GameDocument.Sanitized()` projects the embedded snapshot to the public view before it
  rides in a lobby payload — the same "never leak secrets" discipline as the live wire.

## Bots

Bots live **outside the engine** (`server/Services/Bots/`). `BotDriver` watches a live
game and, when a bot owns the next decision, runs its policy's command through the **exact
same pipeline** a human's command takes. An `IBotPolicy` is a **pure decision function**
over the bot's *projected* view — so a bot can't peek at hidden information any more than a
human can, and it automatically honours whatever rules the package configured. The engine
never knows bots exist.

## Testing the server

`server.tests/` (xUnit): rulebooks (the bulk), family registry contracts, turn flows
(asserting the announced voice via a fake announcer), bots, package loading/validation,
persistence round-trips, and restore. Integration tests against the Cosmos/Blob emulators
skip cleanly when the emulators are down, so CI stays green.
