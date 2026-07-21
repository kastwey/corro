# Accessibility — the heart of the project

This is not a chapter about a feature. **Accessibility is part of the product's
foundation.** Corro is a multiplayer game engine for spatial games, card games and other
turn-based interaction forms. Blind and sighted players share the same session, so every
architectural choice must keep the spoken/structural and visual channels equally complete.
Read this even if you only touch the server: it constrains what you may do everywhere.

## The one rule everything else follows: the server owns the voice

Game events are narrated by the **server**, from the rules, not invented by the client.

- A rule/handler calls `context.Announce(key, vars)` with a `game.*` translation key and
  variables. When `vars` carries `["actorId"]`, the announcer sends the third-person base
  key to everyone and a first-person `<key>_self` variant to the actor (and, for targeted
  events, a `<key>_victim` second-person variant to the target). So the same event is
  heard as "You play the reactor", "Ana plays the reactor", "Ana attacks you" — each in
  the listener's own language.
- The client only **renders** those keys into speech and visuals. It may announce local UI
  mechanics (a menu opened, a refusal), but it must **never duplicate the server's voice**
  for a game outcome.

Why: if each browser narrated independently, the narrations would drift, repeat or
contradict. One authoritative voice keeps every player hearing the same, correct line.

## How a line reaches the ear

- The client writes the translated text into an **ARIA live region** — a hidden element a
  screen reader reads aloud when its content changes — and may also render a visual toast.
- Announcements are **coalesced into a batch** per server action and released together, so
  a multi-step outcome reads as one sequence, not a stutter.
- The batch is **paced against animation**: if a piece is still sliding across the board,
  the announcements wait at a "gate" until it settles, so "Ana moves to Mayfair" doesn't
  arrive before the token gets there.
- Your **own** actions flush **assertively** (the live region interrupts), because a
  screen reader has usually just read the card you focused; a polite line would queue
  behind it and arrive too late to feel responsive.

## The composed-line doctrine

A screen reader hears a label or announcement as **one flowing line**. So every composed
line must read as **one sentence**, with its facts joined by *words and punctuation*, not
by visual separators:

- Good: `"120₡, from Ana"`, `"Deck: 58. Discards: 1."`
- Bad: `"120₡ · Ana"`, `"Deck 58 | Discards 1"` — the `·` and `|` don't speak; the reader
  hears "120 Ana" and "Deck 58 Discards 1" as a jumble.

Join lists with a spoken connector (there's a `joinList` helper wrapping `Intl.ListFormat`)
and word money as cash where it could be misheard as a price. When a card name must travel
inside a line in the listener's language, it rides as an i18n key and is resolved with
`$t(...)` in the template, so every ear hears it translated.

## Dialogs, focus and controls

- **Dialogs are always native `<dialog>`** (never `<div role="dialog">`). Native dialogs
  bring correct focus trapping and screen-reader semantics for free. On close, focus
  returns to whatever opened it.
- **Never use the `disabled` attribute.** A disabled control vanishes from the screen
  reader's tab order, so the player can't even discover *why* they can't act. Instead keep
  the control focusable, set `aria-disabled="true"` + `aria-describedby` explaining the
  reason, and **speak the reason** when they try. Refusals are information, not silence.
- **Keep the landmark tree flat** (no nested regions), and don't drive
  accessibility-critical work off `requestAnimationFrame` (it pauses in a background tab —
  the game must not stall because the player alt-tabbed).

## The accessible hand (`handPanel.ts`)

Card games have no spatial board; the **hand is the surface**, and it is a carefully built
accessible list:

- A **roving list**: arrow keys move between cards, each card is one focus stop that reads
  its name; the currently-focused card is the only tab stop. The list contains only cards
  the player holds — shared deck/discard counts never appear as a trailing fake card.
- Per-card actions (play, discard, help) reachable via a toolbar / `Shift+F10` menu; and
  list-level tools (sort by value/type, "only what I can play") painted once.
- Enter plays, Space draws (when the family draws), Delete discards behind a **modal
  yes/no** because it is irreversible. Refusals are spoken with the reason.
- **D reads the shared piles on demand** in every card family. The exact sentence follows
  the genre (deck only, deck + discards, or deck + discard top) and focus stays in the hand.
- An optional **multi-select mode** (Ctrl+Space) for families that need to send several
  cards at once (draft's "chopsticks", assembly's multi-discard): Space marks, Enter sends,
  and a rules-forced multi-pick switches it on automatically with its own earcon.

## Parallel presentation channels

The visual and spoken/structural channels carry the same game information, but neither
implements the rules. Visual-only effects must not interfere with assistive technology:

- Visual-only layers (`boardToast`, `cardReveal`, `cardFlight`, the racks/tables/hands
  echoes) are **`aria-hidden`**, never touch the live region, never steal focus, never
  gate the turn.
- The accessible identity of a thing is its **name + keyboard affordance**, not its
  colour. Colour is decoration; the spoken name and the shortcut carry the meaning.
- Optional package card illustrations (`assets/cards/<id>.svg`) and neutral fallback drawings are
  **always decorative**. They may help a sighted player recognize a card, but never replace its
  localized row label, rules/help text or server announcement. A missing picture therefore loses
  no semantic information.

## Sound (earcons)

Short non-speech cues layer *under* the voice: dice, buying, a card draw, a piece hop, a
family-specific cue (a card revealed, a wild's colour chosen). They give fast, ambient
feedback without words. `soundEvents.ts` maps announcement keys to event names; the
**package** ships the `.ogg` files and a missing file just stays silent. Sounds never
replace the spoken line — they accompany it.

The engine's own pack (`server/Assets/Sounds`) holds only **platform** cues (chat,
invalid-action) that every package inherits; all **game** earcons live in the package.
Cross-family generics (dice, draw, shuffle, your-turn, game-over, piece-captured) have a
canonical source in `sound-commons/`, copied into each package that needs them. The
travelling-token hop is a client animation sound (`finger.ogg`) a package may override with a
`token.hop` event.

## i18n parity

Every user-facing string exists in **both** `en.json` and `es.json` (base **and** `_self`
where applicable). Automated parity/usage tests fail the build if a key is used but not
translated, or a server `actorId` announcement lacks its `_self` twin — so the voice can
never regress into reading a raw key aloud.
