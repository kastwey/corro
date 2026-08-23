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

## What the table remembers

A retired match leaves its final snapshot in `lastMatch`, so the table can say who won and
offer the full standings on demand. The end screen is raised once, live, for whoever was there
when it finished; this is how everyone else finds out — someone who reconnected a minute later,
or who dismissed it and wants another look. Without it, a dropped connection at the wrong moment
meant never learning how the game ended.

It also remembers **which cards it has already been dealt**, in `dealtCards`, keyed by game type
and content language. A match used to shuffle the whole deck as if it were the table's first, so a
group playing several in a row met words it had just had — with 556 cards and twenty spent in a
short match of Forbidden Words, about even odds of a repeat between two consecutive matches. The
next match now deals the unseen ones first.

What it holds is **one trip through the deck, not the table's whole history**. The match that
completes the trip does not leave the memory full: it starts it again from its own cards, the way
you reshuffle a discard pile and leave the last trick out of it. A memory that only ever grew would
cover the deck after some twenty-eight matches and stay that way, and every match after that would
reshuffle everything again — the original repetition, back for good, on the tables that play most.

The memory belongs here for the same reason the chat does: it is about the group, not about one
game. It never reaches a client — no client reads it, it grows with every match, and this document
is broadcast on every lobby update — and a family that answers no `CardsDealt` never creates it.

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
3. ~~**The setup controls move in.**~~ **Done.** Creating or joining lands people at the table,
   which carries the invite code and link, each player's own re-entry code, the shared deck
   (the host's to change, everyone else's to read), the bot chair, the team arrangement and the
   way out. Tokens and seats never lived in the waiting room — they are picked in the
   create/join forms, which is part of asking to sit down, and stayed there. `view-waiting` is
   gone; the lobby is your tables, the create form and the join form.
4. ~~**Rules at the table, then the rename.**~~ **Done.** The host edits the board's declared
   house rules from the table, for the next match: stored raw on the document, applied over the
   package defaults at start through the catalogue that already did it. The lobby's vocabulary
   followed — it speaks of tables now, while a *match* is still a match, which is what it is.

   The BOARD itself is deliberately not changeable between matches. Every player's piece and
   seat belong to the package, so swapping it would invalidate them; a group that wants a
   different game creates a table for it. Worth revisiting once seats can be re-picked at the
   table.

## The rules of the next match

The board's declared house rules are the host's to change while nothing is running, from the
table. They are stored raw (`ruleValues`) and applied over the package's defaults when a match
starts, through the same catalogue that already did it — validating them a second time on the
way in would only be a second place to get the rules wrong. Mid-match they are locked: changing
them under a live game would mean two rulebooks in one match.

The panel opens on what the LAST match was played with rather than on the board's defaults, so
changing one thing does not silently reset the rest. It is offered to the host alone: a guest
reading a rule they cannot change, in a panel that repaints whenever the host moves something,
is worse served than by the board's own guide.

Every label in it carries its own `data-i18n` key. The panel is built from the package's rule
CATALOGUE, which arrives before the package's WORDS do, and it is built once per table — so
rendering the labels as plain text froze them as the keys they were rendered with, and the table
showed a rulebook written in identifiers. Carrying the key means the ordinary translation pass
re-resolves them where they stand, which also fixes a language change (it repaints `data-i18n`
markup and used to leave this panel in the old language).

## Leaving, and who holds the sceptre

Three goodbyes, named as three different things because they are:

- **Back to the lobby** keeps the seat. So does disconnecting — that is how a player comes back.
- **Leave the match** retires you from the game in progress, through the same command a player
  who forfeits by hand sends, and leaves you AT the table for the next one.
- **Leave the table** gives the seat up for good: it forfeits a running match on the way out, the
  re-entry code stops resolving with the seat, and the host's sceptre passes on.

They are one ARIA toolbar, built from what THIS reader may actually do (see
`docs/accessibility.md`) — the host's start and delete are absent for a guest rather than sitting
there disabled.

The sceptre goes to the next HUMAN in arrival order — the roster IS arrival order, so no
timestamp is needed. A bot never inherits it; a player who is merely disconnected still holds
their seat and keeps their place in that queue, since being away for a minute should not cost
someone the table. The host can also hand it over on purpose, which is the same succession done
deliberately.

When the last person leaves, the table is deleted rather than left for the retention sweep — and
a table holding only bots counts as empty, because nobody could ever start a game at it again.
The host may also delete a table outright, with a match running or not; that one always asks
first.

All of this is a read-modify-write on one document, so it goes through
`GameSessionRegistry.MutateDocumentAsync`, which serializes changes per game. Two people leaving
at the same instant is not hypothetical: without the lock each reads a table that still seats the
other and the second write puts the first one's seat back. The tests for that hold a repository
that yields around every read and write, so they actually interleave — they fail with the lock
removed, which is the only thing that makes them worth having.

## Open questions, deliberately not answered yet

- **A table has no hurry.** The waiting room is a "we're about to start" screen; a table is a
  place you can sit in for ten minutes while nothing happens. That raises the bar for it: who
  is here, who is talking, the chat within reach. More design than code, but it decides
  whether the concept feels like anything.
- **Who is in charge when the host never comes back.** It did not matter while a game died
  with its host. A table that lasts weeks with an absent host is a dead table: nobody can
  start anything. Host succession — or letting anyone start after the host has been away long
  enough — is a real question, just not a v1 one.
