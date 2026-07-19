# End-to-end flows

Concrete walkthroughs — follow one event from a keypress to the screen reader. These tie
together [client.md](client.md), [server.md](server.md) and
[accessibility.md](accessibility.md). Module names are signposts, not exhaustive.

## 1. Playing a card (shedding)

You are in a match-and-discard game, focused on a card in your hand, and you press **Enter**.

**Client — resolve the intent**
1. `handPanel` sees Enter on the focused card and calls the family's `onPlay`.
2. `sheddingBoard.playCard(card)` checks it's your turn locally (a fast, spoken refusal if
   not — the server would reject it anyway) and, for a wild, opens the colour picker.
3. It calls `gameManager.sheddingPlay(instanceId, chosenColor)`, which via `runAsMe`
   resolves your player id and guards the turn, then calls
   `gameClient.sheddingPlay(...)`, which does `invoke("SheddingPlay", ...)` over SignalR.

**Server — decide and narrate**
4. `GameHub.SheddingPlay` packages a `SheddingPlayCommand` and calls `ExecuteCommand`.
5. `CommandDispatcher` runs the **turn guard** (are you the current player?) and the trade
   guard, then routes to `SheddingPlayHandler`.
6. The handler calls the **pure** `SheddingRulebook.Play(...)`, which mutates the
   authoritative state (card to the discards, colour in force, skip/reverse/draw effects,
   round-won?) and returns a result record. **No I/O, no voice** — that's the handler's
   job.
7. The handler **announces**: `context.Announce("game.shedding_played", { card, actorId })`
   — because `actorId` is present, the announcer sends `game.shedding_played_self` to *you*
   and `game.shedding_played` to everyone else. A penalty's drawn cards go **ToPlayer** to
   the victim only (their identity is secret). Then it advances the turn (direction-aware)
   and announces `game.turn_of`.

**Server — send state, hiding secrets**
8. The service raises "state changed". `GameStateFanout` computes, **per connection**, that
   player's `ProjectFor` view (your hand stays; rivals' hands and the pile become counts)
   and sends each socket its own view plus the announcement batch.

**Client — render and speak**
9. Each client stores the new state and repaints the active surface (the hand list + the
   aria-hidden table echo), reconciling the DOM so focus survives.
10. The announcement batch is rendered by i18next into the player's language, written to an
    **ARIA live region** (assertively for your own action, so it isn't queued behind the
    card your screen reader just read) and to a visual toast, and `soundEvents` fires the
    matching earcon.

The whole loop is server-authoritative: your browser never decided anything, it asked and
displayed. The E2E test `e2e/tests/shedding.spec.ts` drives exactly this with two real
browsers and asserts on what the aria-live regions said.

## 2. The draw-and-decide pause (a mid-turn server pause)

Some turns pause on a choice. In shedding, drawing a playable card:

1. You press **Space** → `gameManager.sheddingDraw` → `SheddingDraw` command.
2. The rulebook draws a card. If it's playable and the rules allow it, the server records a
   **`PendingDrawnPlay`** (private — projected away from rivals), whispers the drawn card's
   identity **ToPlayer**, and returns `TurnEnded: false` — the game now waits on you.
3. Your client shows the drawn card announcing itself ("just drawn"); Enter plays it, Space
   keeps it (`SheddingKeep`) and passes the turn.

The same shape powers journey's **coup fourré** (an out-of-turn window: the victim may
answer even though it isn't their turn — the command is not turn-bound and the handler
validates they own the pending coup) and race's "which piece moves?" choice. A pause is
just state (`Pending…`) the client re-opens, so a reconnect resumes it.

## 3. A simultaneous draft turn

Draft has **no turn** — `CurrentTurn` stays null all game:

1. Every player secretly picks a card (`DraftPick`, not turn-bound). The server marks the
   seat "has picked" (public) but keeps *what* they picked secret (projected away).
2. When the **last** seat commits, the server itself runs the reveal: every pick lands at
   once, the hands rotate one seat left, and (when hands run out) the round is scored — all
   narrated in order.

So "the server resolves when everyone has acted" replaces "the server waits for the current
player". The bot needs no turn either: it acts whenever it holds cards and hasn't picked.

## 4. A bot's turn

Bots are outside the engine:

1. `BotDriver` observes the state-changed event. When a bot owns the next decision, it
   takes the bot's **projected** view (no peeking) and asks the `IBotPolicy` for a command.
2. It runs that command through **`IGameService.ExecuteCommandAsync`** — the *same*
   pipeline a human's command takes (same guards, same announcements, same persistence) —
   then broadcasts the new state.
3. One action per pass; the resulting state change schedules the next. A rejected command
   is logged and not retried, so there are no hot loops. `e2e/tests/*-bot.spec.ts` proves a
   human-vs-bot game end to end.

## 5. Starting a game (lobby → board)

1. In the lobby, the host picks a package; the server stages it and validates it (a
   supported family, tokens present and drawable, every referenced i18n key resolvable,
   the deck/board well-formed).
2. On start, the game's **family** builds the initial state (`CreateGame`): deal hands or
   place pieces, set the first turn, and optionally announce an opening line
   (`PostStartAsync`). The service adopts that state and broadcasts it (projected).
3. Every client navigates to the board and builds its family view lazily on the first
   state it receives.

## 6. Reconnect / server restart

1. The full `GameState` is persisted to Cosmos as you play (via the background
   `GameStatePersister`).
2. After a restart, `RestoreGameAsync` **adopts the saved snapshot verbatim** — no reset,
   no replay — and re-attaches the package's rules. Play resumes exactly where it was,
   including any pending pause.
3. A player rejoins with a re-entry code and receives *their* projection of the restored
   state. `CardFamilyPersistenceTests` guards that a card game's hidden-info state
   survives this round-trip unchanged.
