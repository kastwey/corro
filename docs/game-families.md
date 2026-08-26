# Game families

A **family** is an interaction model implemented by the engine. A `.corro` package chooses
a family and supplies its theme, rules configuration, deck or board, translations, pieces
and sounds. Different packages can therefore share mechanics without sharing names or art.

## Supported families

| Family | Interaction model | Hidden information | Primary surface | Package card art |
| --- | --- | --- | --- | --- |
| `property` | Roll, move, trade and manage an economy | no | perimeter board | yes, deck-card reveals |
| `race` | Roll and choose one of several pieces | no | shared circuit and final lanes | — |
| `track` | Roll and advance along a path with square effects | no | linear track | — |
| `trivia` | Roll, choose a destination and answer by category | question-dependent | hub-and-spoke wheel | — |
| `forbidden` | Rotate team roles, give spoken clues and resolve cards against a clock | target + forbidden words by role | role table and private text card | — |
| `journey` | Draw and play distance, hazard and remedy cards | yes | hand and shared journey state | yes |
| `assembly` | Build a rack while repairing or disrupting rivals | yes | hand and racks | yes |
| `draft` | Everyone picks secretly, then hands rotate | yes | hand and public table | yes |
| `shedding` | Match the discard or draw | yes | hand and discard pile | yes |
| `exploding` | Play actions, then draw against elimination risk | yes | hand and draw pile | yes |
| `categories` | Everyone writes to shared prompts at once; a rotating judge rules | yes, until the review | round card, sheet and answer list | — |

The server registry in `server/Services/Corro/Families/GameFamilies.cs` is authoritative.
The format details for each family live in [`../CORRO_FORMAT.md`](../CORRO_FORMAT.md).

For every “yes” row, `assets/cards/<card-id>.svg` is optional package content. Its sanitized
64×64 path geometry overrides the neutral type/value drawing; absence is valid and selects
the fallback. The same card art follows the card across hand, discard and public-table views.
An optional `artColor: "#RRGGBB"` travels with that geometry to preserve package identity in
those views; text still names every colour/type so the accent never carries meaning alone.

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

- `handPanel.ts` provides the accessible roving hand, sorting, mutually exclusive
    all/playable-first/only-playable display modes and optional multi-selection;
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

Categories hides answers the same way, and for the same reason: while the writing clock runs, an
answer reaches its own writer and nobody else — not a rival, not the round's judge, not the public
view. It is the one family whose hidden information becomes PUBLIC mid-round: at review the answers
are read out and ruled on, so everybody sees them all.

Forbidden Words also separates **content language** from interface language. The host chooses one
package-supplied word deck in the lobby (defaulting to the host interface), and that shared choice is
visible to the room and locked when play starts. The clue-giver and monitor therefore adjudicate the
same target and forbidden words even when their buttons and help are localized differently.

## Timed rounds

A family with an authoritative clock does not own a timer. It answers two questions from
`IGameFamily` — `RoundClock(state)` (the live countdown, or null) and `ExpireRoundCommand(state)`
(what resolves it) — and the session registry drives the one shared `RoundClockService` from those
answers, re-sampling them on every state change. The remaining time is never stored: it is always
recomputed from the start stamp and the duration, so a reconnecting player, a restored game and
every other client agree on the same deadline. The expiry travels the ordinary command pipeline,
so the rules and the spoken voice of a timeout live in a handler like every other outcome.

Forbidden Words and Categories both use it, and neither has a line of timer code.

## The final table

A family that counts something answers `FinalStandings(state)` with one row per SIDE — a player,
or a whole team named together — carrying that side's place and the number it ended on, plus the
i18n key that names the measure (`game.end_measure_points`, `game.end_measure_square`…). The
engine seals the answer into `GameState.FinalStandings` the first time a finished state is
published (`GameService.NotifyStateChangedAsync`) and the end screen renders it; families that
count nothing worth showing return null — the default — and the screen keeps its plain ranked
list of names.

Two rules hold across every family. The ORDER is `Player.FinishPlace`, never the number: a
shedding match played with the penalty count is won by the LOWEST score. And the table is sealed
ONCE, not recomputed per client, because a hidden-information family hands every connection a
different projection and tables built from those would disagree with each other.

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
- its command records (each with a `[JsonDerivedType]` entry on `GameCommand` — the wire
  allowlist) and their handlers in `CommandDispatcher`. The hub needs **no** change: every
  command travels through the one `ExecuteCommand`;
- `GameState` and package-definition models;
- the client's `GameCommand` union in `models.ts` and the typed methods in `gameManager.ts`;
- `familyTraits.ts` and `gameFamilies.ts` on the client;
- package validation, translations, sounds and the format specification.

See [architecture.md](architecture.md), [server.md](server.md), [client.md](client.md) and
[accessibility.md](accessibility.md) before implementing one.
