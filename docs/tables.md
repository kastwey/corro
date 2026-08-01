# Tables

A **table** is the group of people, and it outlives the games they play. A **match** is one
game, and it is disposable. Until now Corro had only the second: the last roll of a game
deleted everything the group had built — the chat, the seats, the invite code, the voice
room — and playing again meant starting from an empty form.

This document is the design being implemented, its reasoning, and what is deliberately left
for later. It is meant to be argued with.

## The decision that orders everything

**The id that already exists IS the table.** What had to become disposable is the match.

Everything durable already hangs off `gameId`: the invite code, each player's re-entry code,
the SignalR group, the LiveKit room name, the chat history, the `corro_games` entry in every
browser, the retention sweep and the Cosmos partition. Reading that id as the table's makes
almost all of it correct by construction:

- a `?gameId=` someone bookmarked still resolves — now to the table;
- **the voice room keeps its name across matches**, so a conversation is not cut in half by a
  game ending;
- the chat is already stored *outside* `GameState` (so state broadcasts don't re-send it),
  which means it was already table-scoped and nobody had noticed;
- re-entry codes now recover *your seat at the table*, which is strictly better and needed no
  change at all.

The alternative — minting a new table id and leaving `gameId` to the match — would have meant
re-pointing every one of those, migrating saved sessions, and breaking links people had
already shared. Same concept, all of the cost.

## What a match end does now

`CleanupIfGameOverAsync` used to delete the document. It now **retires the match**:

1. the clocks stop and the in-memory game service is dropped and ended;
2. the persister is flushed and removed, so a late snapshot cannot put the finished match
   back as if it were still running;
3. the final snapshot **moves** from `gameState` to `lastMatch` — the result outlives the game
   that produced it, at roughly no cost in document size, and it is the same shape the end
   screen is already built from;
4. the status returns to `WaitingForPlayers` — the state the rest of the system already reads
   as "at the table" (an authenticated rejoin gets the lobby state, the saved-games list
   resumes to the waiting room rather than to a board);
5. `MatchEnded` is broadcast, because whoever was not looking at the board should not have to
   infer it from state that stops arriving.

The package is **not** released and the voice room is **not** deleted: the board a table just
played is the one it is most likely to play again, and the conversation belongs to the table.

Deletion is now what happens to a **table**: the host's own action, or the retention sweep
(unchanged — it keys on `lastUpdated`, which a retirement bumps).

## Getting there

Creating or joining goes straight to the table's page. The lobby keeps what is genuinely
lobby: the list of your tables, the create form, and the join form — where the piece and the
seat are picked, because they are part of asking to sit down. Resuming a table with no match
running lands there too, through the same door.

## Where people live

Today the waiting room is a view of the lobby page and the game is `board.html`. The table
belongs on the **game page**, not the lobby: the table view and the match surface swap inside
one document, and the chat and voice panels are mounted once and never learn that a match
started or ended.

This is not a preference. Navigating between pages tears down the WebRTC connection, so every
match start and end would cut the audio and make everyone rejoin — which would destroy the
best part of the idea. The game page also already owns what a table needs (the announcer, the
panels, the keymap, the panel navigator, session recovery); the lobby owns forms, which stay
where they are: create a table, join by code, and the list of your tables.

## The end-of-match dialog

It is already a dialog — winner, standings, `documentMode`, focus at the title. Two things
change:

- closing it returns to the **table**, not to the home page;
- it must be **interruptible**: if the host starts another match while it is open, it closes
  and everyone enters the new game.

The honest way to get the second is to make it a *reconciled* modal driven by state (the
table is at rest and there is a `lastMatch` this player has not dismissed) rather than a
fire-and-forget `show()`. The modal reconciler already exists and is already the source of
truth after a reconnection, so this reuses the mechanism that closes an auction modal when
the auction resolves — and fixes, for free, the case of reconnecting just as a game ended.

A dialog that closes itself must not do it silently: one announced line, and focus lands on
the new match surface exactly as it does today when a game starts.

## Phases

1. ~~**Server, first** — retire instead of delete.~~ **Done.**
2. ~~**Client** — the end dialog returns to the table; the table view lives on the game page
   with chat and voice mounted once; "start another" lives there.~~ **Done.** The table shows
   who is here, the invite code, and the host's way to start the next match, and the page
   swaps between it and the board without ever navigating.
3. ~~**The setup controls move in.**~~ **Mostly done.** Creating or joining now lands people at
   the table, which carries the invite code and link, each player's own re-entry code, the
   shared deck (the host's to change, everyone else's to read), the bot chair and the way out.
   Tokens and seats never lived in the waiting room — they are picked in the create/join forms,
   and stayed there.

   **What is left:** arranging TEAMS. That panel is a roving list with its own focus plan, and
   it has not moved, so a team board still stops at the lobby's waiting room — the one
   condition in `enterTable`, and the only thing keeping `view-waiting` alive. A table knows
   its family (`gameType` on the document) precisely so its page can offer the family's setup
   without staging the package to ask.
4. **Rules at the table, then the rename** — the create form's board picker and rule fields
   are reused as "settings for the next match" (nearly free: `packageToken`, `ruleValues` and
   `settings` already live on the document and are already re-read at every start). The
   vocabulary sweep (mesa/partida, "your tables") comes last, so a rename never fights a
   behaviour change.

## Open questions, deliberately not answered yet

- **A table has no hurry.** The waiting room is a "we're about to start" screen; a table is a
  place you can sit in for ten minutes while nothing happens. That raises the bar for it: who
  is here, who is talking, the chat within reach. More design than code, but it decides
  whether the concept feels like anything.
- **Who is in charge when the host never comes back.** It did not matter while a game died
  with its host. A table that lasts weeks with an absent host is a dead table: nobody can
  start anything. Host succession — or letting anyone start after the host has been away long
  enough — is a real question, just not a v1 one.
