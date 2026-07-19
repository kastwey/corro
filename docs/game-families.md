# Game families

A **family** is an interaction model implemented by the engine. A `.corro` package chooses
a family and supplies its theme, rules configuration, deck or board, translations, pieces
and sounds. Different packages can therefore share mechanics without sharing names or art.

## Supported families

| Family | Interaction model | Hidden information | Primary surface |
| --- | --- | --- | --- |
| `property` | Roll, move, trade and manage an economy | no | perimeter board |
| `race` | Roll and choose one of several pieces | no | shared circuit and final lanes |
| `track` | Roll and advance along a path with square effects | no | linear track |
| `trivia` | Roll, choose a destination and answer by category | question-dependent | hub-and-spoke wheel |
| `journey` | Draw and play distance, hazard and remedy cards | yes | hand and shared journey state |
| `assembly` | Build a rack while repairing or disrupting rivals | yes | hand and racks |
| `draft` | Everyone picks secretly, then hands rotate | yes | hand and public table |
| `shedding` | Match the discard or draw | yes | hand and discard pile |
| `exploding` | Play actions, then draw against elimination risk | yes | hand and draw pile |

The server registry in `server/Services/Corro/Families/GameFamilies.cs` is authoritative.
The format details for each family live in [`../CORRO_FORMAT.md`](../CORRO_FORMAT.md).

## Package or new family?

Most new games should be packages for an existing family. Extend a family when the turn
shape, hidden-information model and player decisions already match and only the effect
catalog or configurable rules need to grow.

Add a family only for a genuinely different interaction model. A new family must define:

- package loading and validation;
- initial state and restore behavior;
- command handlers and a pure rulebook;
- per-player state projection when information is hidden;
- retirement behavior so a disconnected or departing seat cannot block play;
- bot policy, or an explicit decision that bots are unsupported;
- a client surface, keyboard interaction, announcements, translations and earcons;
- unit, integration and browser coverage;
- a corresponding section in the package-format specification.

## Shared client chassis

Card families share the stable presentation pieces:

- `handPanel.ts` provides the accessible roving hand, sort/filter actions and optional
  multi-selection;
- `cardBoardShell.ts` resets the common game container and wires shared status behavior;
- `makeCardFamily(...)` in `gameFamilies.ts` builds the common client registration.

Family-specific rules remain separate on the server. Projection, reshuffling, retirement,
validation and turn resolution differ enough that a common base class would hide important
behavior—especially around secret information. Share small, stable helpers when behavior is
truly identical; keep family rules explicit otherwise.

`server.tests/CardFamilyPersistenceTests.cs` verifies that hidden state survives a
save-and-restore round trip for every card family.

## Hidden information

A hidden-information family sets `HasHiddenInformation` and implements `ProjectFor`.
Each connection receives only its permitted projection: the local hand remains visible,
rival hands become counts, private pending choices are removed, and draw-pile order never
leaves the server. Persistence stores the complete authoritative state.

Projection code is security-sensitive. A new or changed family must test both what the
owner can see and what rivals and unauthenticated viewers cannot see.

## Movement pacing

Families with animated pieces coordinate narration and visuals through
`AnnouncementGate`:

1. a pre-movement cause uses `AnnouncementPhase.Move` and arms the gate;
2. landing consequences use the default `Resolve` phase;
3. visual consequences use `announcementGate.deferVisual(...)`;
4. the active animator calls `settle()` when movement finishes.

For a two-step choice such as trivia movement, the client arms the gate when the player
confirms the destination because the earlier roll has already settled. This preserves the
sequence “cause → movement → consequence” for both visual and screen-reader users.

## Registration checklist

A new family normally touches these shared registries:

- `GameFamilies.All` and `BotPolicies.All` on the server;
- `CommandDispatcher` and the SignalR hub methods for its commands;
- `GameState` and package-definition models;
- `familyTraits.ts` and `gameFamilies.ts` on the client;
- package validation, translations, sounds and the format specification.

See [architecture.md](architecture.md), [server.md](server.md), [client.md](client.md) and
[accessibility.md](accessibility.md) before implementing one.
