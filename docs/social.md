# The social layer

Everything that happens between people rather than between a player and a board: being seen, being
found, being written to, and being asked to a table. It sits on top of [accounts](accounts.md) and
inherits that document's first rule — **none of it is ever a precondition for playing**. A person
can create a table, join one and play a whole match without an account, and nothing here changes
that.

Four things exist, and they are deliberately separate:

| Thing | Where it lives | What it is |
| --- | --- | --- |
| **Presence** | `PresenceRegistry` (memory) | Who is connected right now, by account rather than by tab. |
| **Friendships** | `Friendships` container | One document per PAIR: pending, accepted or refused. |
| **Private messages** | nowhere | Delivered live over the hub and forgotten. |
| **Invitations** | the game document | Who was asked to a table, and who asked to be let in. |

## Three questions, three answers

The same three-step shape appears three times, and the repetition is the point: a player who has met
one of these knows how the others behave.

- **Who can see that you are connected?** Nobody / only your friends / everyone
  (`PresenceVisibility`, on the account).
- **Who can send you messages?** Nobody / only your friends / anyone (`MessagePolicy`, on the
  account). Being findable and being interruptible are different questions, so they get different
  answers.
- **Do you want to be told when somebody arrives?** Nobody / only my friends / everybody — this one
  in the BROWSER, not the account, because it is a preference about speech on *this device*.
  Somebody who drives one machine with a screen reader and another silently should not have to
  choose once for both.

Each option means literally what it says. "Nobody" hides you from your friends too. An option that
quietly did not apply to some people would be worse than not offering it.

New accounts start at "only friends" everywhere, which shows them to nobody until they accept
somebody — the safe default and the useful one turn out to be the same choice. An account written
before a setting existed is read from what it *did* say rather than defaulted, because promoting a
"no" to a smaller "yes" still publishes somebody who never agreed to it.

## What a refusal is allowed to say

The load-bearing rule of the whole layer, and the one most likely to be undone by a well-meaning
change: **every way a thing can fail reports the same sentence.**

- A message that reaches nobody says so without saying whether the name is unknown, the person is
  away, or their settings refuse this sender.
- An invitation that cannot be sent says the same for all three.
- A friend request to somebody who does not exist reads exactly like one to somebody who chose not
  to be listed.

Telling those apart would turn each of these into a way to learn who exists, who is around, and who
has quietly shut somebody out. The end-to-end tests assert it by substituting the name out of two
different refusals and comparing the rest.

The other half of the same rule: **a refusal is never reported to the person who was refused.** The
sender keeps seeing what they did — that they asked — because that is the part that is theirs.

## Friendships

One document per pair, keyed by the two account ids in a fixed order, so the relationship is a
single fact rather than two copies that can disagree. The container's duplicate-id rejection settles
two people asking each other in the same second: one request exists, and whoever lost the race is
holding a request from the other, which is simply accepted.

Declining does **not** delete the document. It writes "no" into it, and a later request from the
same person changes nothing while still answering "sent". Without that, "no" would mean "not this
evening": anyone could ask again every day and the only escape would be to stop being listed at all.

Nothing can take a request back. A cancel would have to fail on a request that had been refused — or
the refusal would be erasable — and a button that quietly stops working is exactly how the asker
would learn the answer the other person chose not to give. A request is a thing you send, like a
message, not a thing you keep hold of.

Ending a friendship erases the document, and both are free afterwards.

## Private messages

There is deliberately **no general lobby channel**. A room-wide stream of strangers talking is, for
somebody listening to every line, not a feature. A message goes to the people it NAMES, with `@`,
and a line that names nobody is refused with the reason and left in the box to fix.

Addressing is read out of the message itself (`mentions.ts`) rather than from a recipient field
beside it, and that is an accessibility argument rather than a stylistic one: a separate field makes
saying one sentence a trip between two controls. So `@` works anywhere in the line, several people
can be named at once, and a bare `@` followed by a space means "whoever last wrote to me".

Messages are a lobby SCREEN of their own (`view-messages`), reached from the People block on the
home page, and never a dialog. Home is an entrance hall — what you can start, what is waiting on an
answer, your tables, the people — and a log with a text box under it is a place you go to, not
something to read past on the way to your tables. Nothing about that lets a message interrupt: one
arriving while the reader is elsewhere is said once through the lobby's live region, naming who
wrote and never what they wrote, and then waits in the NAME of the way in ("Messages, 3 unread"),
exactly as the friends button carries its requests. Opening the screen is what clears it, because
opening it is what reading them means.

Nothing is stored on the server. A message is handed to the recipient's open connections and
forgotten — no mailbox, no history, no record that two people ever wrote to each other. What was
said this session is kept by the browser, per tab. A stored conversation would need retention, a way
to erase it, a section of the privacy notice about who can read it and an answer for what happens on
a shared computer; none of that is worth building until somebody wants to write to a friend who is
asleep.

## Invitations

Stored **on the game document**, because both directions are facts about a table: who was asked, and
who is asking to be let in. That is what makes them survive a reload, reach somebody who was away,
and expire without anybody sweeping up — a table that fills, starts or is deleted takes them with
it.

Who may ask whom reuses the message policy rather than inventing a second one: an invitation is an
interruption too. Asking to be let in has its own gate — a friend must actually be sitting at that
table — because otherwise anybody who guessed a table id could knock on it and learn from the answer
that it exists.

Accepting walks the ORDINARY join, with the invite code the server hands back. There is one way into
a table rather than two that have to be kept in step.

An invitation reaches you wherever you are: the lobby's home page has a block for it — before your
own tables, because a seat expires and a table you already have does not — and so does a table, since
sitting at one table is exactly where you are when a friend wants you at theirs.

### Picking somebody instead of spelling them

Asking somebody is one control, not two: a field with a list under it that opens showing everybody
who could come and narrows as a name is typed. Knowing the name and knowing only that somebody is
about are the same task from a keyboard, and splitting them would make the common case a trip
between two controls. It is the chat's name list, reused — a third hand-rolled option list is a
third chance to announce loose buttons with no position and no count.

The candidates are the SERVER's answer (`GetInvitablePlayers`), never a filter applied by the
client, and the two questions are asked in order: can this caller SEE them, and do they accept being
asked. Seeing comes first and on its own, so the picker can never become a way around the presence
setting — somebody hidden is absent from it whatever their message policy says, and is still
reachable by typing their name. That is what keeps the two ways distinct: "who is about?" and "I
know who I want".

**This is the one place a message policy becomes observable without an attempt**, and it was weighed
rather than overlooked. For somebody the caller can already see in the room, the policy is deducible
today with one invitation: away and unknown-name are both ruled out by their being visibly present,
so a refusal there can only be the policy. What changes is the cost — this can be read on a timer
without the target ever being asked. It was chosen anyway, because a picker of people who cannot be
picked is not a feature, and the only thing learned about somebody already visible is that they did
not choose "anyone".

## What never travels

- **The account id of a seat.** It is stored and stripped on the way to a client. Opaque, but
  STABLE: enough to note down and recognise the same person at every other table they ever sit at.
- **The account display name.** It usually comes from a sign-in provider and is often somebody's
  real name. A handle is chosen to be public; a name imported from Google was not.
- **Which table somebody is at.** With one narrow exception: a FRIEND at a table that still has
  room, which is the whole point of asking to join them.

A table is the one place a public name IS shown to everybody present. That setting is about being
found among strangers, and the people you dealt into a game are not strangers.

## Where the code is

| Concern | Server | Client |
| --- | --- | --- |
| Presence | `Hubs/PresenceRegistry.cs`, `Controllers/PresenceController.cs` | `onlinePlayers.ts` |
| Friendships | `Services/Accounts/FriendshipService.cs`, `FriendshipKey.cs`, `Controllers/FriendsController.cs` | `friends.ts`, `friendsList.ts` |
| Messages | `Hubs/GameHub.DirectMessages.cs` | `lobbyChat.ts`, `mentions.ts` |
| Invitations | `Hubs/GameHub.Invitations.cs` | `tableInvites.ts`, `tableView.ts` |
| Who may see / be reached | `Services/Accounts/ReachRules.cs` | — |
| Shared widgets | — | `friendRoster.ts`, `mentionList.ts`, `tabs.ts` |
| Settings screen | `Controllers/AuthController.cs` | `accountSettings.ts`, `lobbyNotices.ts` |

The three rosters (the table's players, the in-game panel, and these two lists) are one widget on
purpose: one tab stop, arrows between people, Right into a row's actions, Shift+F10 for the same as
a menu. Somebody who has met one has met all of them, which only stays true while there is one
implementation.
