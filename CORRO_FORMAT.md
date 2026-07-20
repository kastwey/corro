# The `.corro` package format (v1)

> Specification of the content package the engine loads. A `.corro` file is a **zip**
> with the structure below. During development you can work with the uncompressed folder
> (see `server/Packages/imperio-galactico/`, the reference board shipped with the server).

```
myboard.corro (zip)
├── manifest.json     # identity, currency, terminology, groups, decks, rules, tokens
├── board.json        # the squares (array), referencing groups and decks by id
├── cards.json        # each deck's cards (generic effects + text keys)
├── i18n/
│   ├── es.json       # every translatable text, resolved by key
│   └── en.json
├── tokens/
│   └── <id>.svg      # one SVG per player token (required)
├── sounds/           # the package's game earcons (engine ships only platform cues)
│   ├── pack.json
│   └── *.ogg
├── CREDITS.md        # sound attributions (CC0 / CC-BY)
└── help.<lang>.md    # optional: the board's own rules/how-to-play (F1 / Help button)
```

Use the [Corro Package SDK](tools/Corro.PackageCli/README.md) while authoring: `validate` runs
the engine's real structural, family and content checks; `inspect` summarizes a folder or archive
without exposing an unlock code; `pack` creates and round-trips a reproducible `.corro` file; and
`new` creates a valid neutral starter for any supported family. Generated projects carry local JSON
schemas for completion, but the engine-backed `validate` command remains authoritative.

**i18n convention**: everything translatable is a **key** resolved against the package's
own `i18n/{lang}.json` (`nameKey`, `colorName`, `textKey`, `terminology.*`,
`building.*Key`, `currency.nameKey`…). The **only exception** is `name` (the board's
display name), which is **inline** because the lobby shows it in the board selector
**before** the package i18n is merged. Untranslatable symbols and codes
(`currency.symbol`/`code`, `group.color`) are also inline.

## In-game guide

Every declared locale should ship a `help.<lang>.md`. The safe client renderer supports
headings, paragraphs, lists, emphasis, code, HTTP(S) links and same-document fragment links.
It assigns deterministic ids to headings and automatically inserts a linked table of contents
from the guide's `##` sections, so package authors must not maintain a duplicate contents list.

The guide should explain the four help layers when they apply: **F1** for the package guide,
**Ctrl+F1** for the live shortcut list, **Ctrl+Shift+F1** for the effective rules and
**Shift+F1** for focused-card help. It must also include a localized `## Playing with a screen
reader` section (or equivalent) describing the package family's real focus surface, navigation,
status queries, the **F6** panel cycle and direct chat access.

## Game families

The format is designed to carry **more than one kind of game**. Every package
declares which family it targets with the **required** `gameType` manifest field; each
family brings its own rulebook, board topology and family-specific manifest sections,
while the rest of the package (identity, locales, i18n convention, tokens, sounds, help)
is common to all families.

- `"gameType": "property"` — roll-and-move property trading. `terminology`, `groups`,
  `decks`, `building`, `rules`, `board.json` square types and `cards.json` effects are
  all `property`-family sections, specified in the sections below.
- `"gameType": "race"` — cross-and-circle race games: several pieces per player, a shared
  circuit with captures and barriers, private final corridors. Its `board.json` is a
  circuit definition and its rules live in the manifest's `raceRules` — see
  [The race family](#the-race-family) at the end of this document.
- `"gameType": "track"` — ladder-and-slide track games: one piece per player on a
  single 1..N path with declarative square effects (teleports). Its `board.json` is a
  track definition and its rules live in the manifest's `trackRules` — see
  [The track family](#the-track-family) at the end of this document.
- `"gameType": "journey"` — distance-card racing: draw-then-play turns, distance
  cards toward a kilometre goal, attacks/remedies/immunities, the coup fourré, optional
  shared-seat teams. **No `board.json`** — `cards.json` is the deck and the rules live in
  the manifest's `journeyRules` — see [The journey family](#the-journey-family).
- `"gameType": "assembly"` — rack building: collect one functional piece per
  colour while rivals damage them; remedies shield and lock. **No `board.json`** —
  `cards.json` is the deck and the rules live in the manifest's `assemblyRules` — see
  [The assembly family](#the-assembly-family).
- `"gameType": "draft"` — simultaneous pick-and-pass drafting: every trick
  ALL players secretly pick one card, the picks reveal together and the hands rotate left;
  rounds are scored from each player's public table. **No `board.json`** — `cards.json` is
  the deck and the rules live in the manifest's `draftRules` — see
  [The draft family](#the-draft-family).
- `"gameType": "shedding"` — match-and-discard card shedding: play one card matching the top of
  the discards by colour, number or action type — or draw one and maybe play it; first
  empty hand wins the round and collects the rivals' points. **No `board.json`** —
  `cards.json` is the deck and the rules live in the manifest's `sheddingRules` — see
  [The shedding family](#the-shedding-family).
- `"gameType": "exploding"` — elimination press-your-luck against a shared,
  ordered draw pile with bombs planted in it; play action cards, then draw to end your turn,
  and defuse the bomb or be knocked out. Last player standing wins. `cards.json` is the deck
  and the rules live in the manifest's `explodingRules` — see
  [The exploding family](#the-exploding-family).
- `"gameType": "trivia"` — category trivia on a hub-and-spoke **wheel**: roll
  and move, answer a question of the square's category, earn a wedge at each of the six
  category headquarters, then return to the centre for a final question to win. Answers are
  ruled by a human judge (rotating, or a fixed judge the host picks at game start) or
  auto-adjudicated (multiple choice / written). Its `board.json` is a wheel definition, the
  question deck ships as per-locale `questions.<lang>.json`, and the rules live in the
  manifest's `triviaRules` — see [The trivia family](#the-trivia-family). This family has
  **no bots**.

A package declaring a family the engine version doesn't implement is **rejected at
upload with a clear message** listing the supported families — it is never loaded into
the wrong rules.

---

## manifest.json

```jsonc
{
  "format": "corro/v1",
  "gameType": "property",           // REQUIRED: the game family (see "Game families")
  "engineVersion": "^1.0",          // engine compatibility (semver)
  "id": "imperio-galactico",
  "name": { "es": "Imperio Galáctico", "en": "Galactic Empire" },  // INLINE (lobby selector)
  "author": "Corro",
  "version": "0.1.0",
  "locales": ["es", "en"],

  "currency": { "symbol": "₡", "code": "CR", "nameKey": "currency.name" }, // symbol/code inline; name by key
  "centerBrand": "CORRO",          // the diagonal "logo" text at the board centre

  // The board's own names for special squares -> i18n keys.
  "terminology": {
    "start":       "terminology.start",
    "holding":        "terminology.holding",
    "freeparking": "terminology.freeparking",
    "sendtoholding":    "terminology.sendtoholding"
  },

  // Groups: color (inline, visual aid) + colorName (i18n key) + optional board shortcut key.
  "groups": [
    { "id": "g1", "color": "#8a5a2b", "colorName": "groups.g1", "key": "b" },
    { "id": "transit", "color": "#cfd2d6", "colorName": "groups.transit", "icon": "transit" },
    { "id": "utility", "color": "#b9a04a", "colorName": "groups.utility", "icon": "utility" }
  ],

  // Decks: name by i18n key. An unnamed card square inherits its deck's name.
  "decks": [
    { "id": "fortune",     "nameKey": "decks.fortune",     "icon": "question" },
    { "id": "blackmarket", "nameKey": "decks.blackmarket", "icon": "chest" }
  ],

  // Supported player counts (max is also capped by the number of tokens).
  "players": { "min": 2, "max": 4 },

  // Buildings: how many small ones make the big one + level names (by i18n key).
  "building": {
    "levels": 5,
    "smallKey": "building.small",
    "smallPluralKey": "building.smallPlural",
    "bigKey": "building.big"
  },

  // Rule configuration (parameters + per-square-type RENT STRATEGIES).
  "rules": {
    "startingMoney": 1500,
    "passStartBonus": 200,
    "rentStrategies": {
      "property": "buildingTable",   // rent = rent[buildingCount]; x2 for a complete unbuilt group
      "transit":  "ownedCountScale", // rent scales with how many of the group you own
      "utility":  "diceMultiplier"   // rent = dice × multiplier (by how many you own)
    },
    "transitRent": [25, 50, 100, 200],
    "utilityMultiplier": { "single": 4, "all": 10 },
    "holding": { "releaseCost": 50, "maxTurns": 3, "walk": false },
    // holding.walk: how the token reaches holding (third double / "sendtoholding" square / card).
    //   false (default) = teleport: the token appears in holding and the announcement is
    //     immediate ("you go straight to holding", no sliding across the board).
    //   true = walking: the token animates the trip and the announcement paces to the hop.
    "mortgageInterestRate": 10,
    "buildingShortage": true,        // the bank stocks a limited number of buildings
    "evenBuildRule": true,           // must build evenly across a colour group
    "auctionOnDecline": true,        // declining a purchase puts the square under the hammer
    "freeParkingJackpot": false      // taxes/fines feed the free-parking pot
  },

  // Optional: rules the HOST can tweak in the lobby before starting. Each declared rule
  // renders as a checkbox/number field; "default" pre-fills it. Grouping is cosmetic.
  "ruleGroups": [ { "id": "building", "nameKey": "rules.group.building" } ],
  "houseRules": [
    { "id": "startingMoney",  "nameKey": "rules.startingMoney",  "default": 1500, "type": "number" }
  ],

  // Player tokens (REQUIRED — the engine has no built-in set). See tokens/ below.
  "tokens": [
    { "id": "ufo",    "nameKey": "tokens.ufo" },
    { "id": "rocket", "nameKey": "tokens.rocket" }
  ]
}
```

**House-rule catalog** (the ids the engine understands; anything else is rejected):
`startingMoney`, `passStartBonus`, `doubleOnExactStart`, `finesToCenterPot`,
`limitedBuildings`, `buildEvenly`, `noBuildBeforeFirstLap`, `holdingReleaseCost`, `maxHoldingTurns`,
`collectRentWhileHeld`, `auctionOnDecline`, `auctionTimeoutSeconds`,
`mortgageInterestRate`.

And the package's `i18n/{lang}.json` defines those keys, e.g. `es.json`:

```jsonc
{
  "currency": { "name": "créditos" },
  "terminology": { "start": "Plataforma de Lanzamiento", "holding": "Agujero Negro",
           "freeparking": "Cinturón de Asteroides", "sendtoholding": "Rayo Tractor" },
  "building": { "small": "colonia", "smallPlural": "colonias", "big": "metrópolis" },
  "groups": { "g1": "Sistema Cuñao", "transit": "Saltos Hiperespaciales", "utility": "Suministros" },
  "decks": { "fortune": "Anomalía Cuántica", "blackmarket": "Mercado Negro" },
  "squares": { "1": "Planeta Cuñao", "3": "Luna Resacosa" },
  "tokens": { "ufo": "Platillo volante", "rocket": "Cohete" },
  "cards": { "f1": "Vientos solares favorables: avanza a la Plataforma de Lanzamiento y cobra." }
}
```

Partial translations are allowed: a key present in some locales falls back to any locale
that has it at runtime. A key referenced anywhere but defined in **no** locale fails
validation.

## Hidden packages (self-hosting)

Two OPTIONAL manifest fields let a self-hosted server keep some boards private. Both live entirely in
the package — the engine only reads and relays them; it never knows what a board *is* or what a notice
*says*.

```jsonc
{
  // ...alongside the other identity fields...
  "unlockCode": "onlywithblinds",   // OPTIONAL: hide this board behind a code
  "warning": "notice.blindsOnly"    // OPTIONAL: an i18n key shown when a host creates a game with it
}
```

- **`unlockCode`** — when present, the board is **hidden**: it isn't listed or stageable for a *new*
  game until a player enters the matching code (**Ctrl+Shift+Alt+C** in the lobby). One code reveals
  every hidden board that shares it; a player's codes are remembered in their browser and replayed, so
  each is typed only once. **Joining or resuming** a game that already uses the board needs no code —
  only *creating* one does. This is a soft gate, not access control: anyone you give the code to (or who
  joins a game already using the board) gets it. The code lives only in `manifest.json`, which is never
  served to clients, so it never leaves the server.

  Run your own Corro server and have boards you only want to play with friends or family you choose?
  Hide them, so not everyone who reaches the server can see them. (Built a game to poke fun at your
  mother-in-law? Her wandering onto your server and finding it is probably not the plan.)

- **`warning`** — an i18n key (in *this package's own* translations) shown to the host as a notice they
  must confirm each time they create a game with the board. The engine carries the key verbatim and
  renders whatever the package says; it does not interpret the text. Define it like any other key, e.g.
  `"notice": { "blindsOnly": "This board is for playing with blind people…" }`.

## board.json

Array of squares in walking order (0..N-1). Each declares its `type`; properties
reference a `group`, card squares a `deck`. Names are **keys** (`nameKey`), like every
other text.

```jsonc
[
  { "id": 0,  "type": "start" },
  { "id": 1,  "type": "property", "group": "g1", "nameKey": "squares.1",
              "price": 60, "buildCost": 50, "rent": [2, 10, 30, 90, 160, 250] },
  { "id": 2,  "type": "deck", "deck": "blackmarket" },
  { "id": 4,  "type": "tax", "nameKey": "squares.4", "amount": 200 },
  { "id": 5,  "type": "transit", "group": "transit", "nameKey": "squares.5", "price": 200 },
  { "id": 12, "type": "utility", "group": "utility", "nameKey": "squares.12", "price": 150 },
  { "id": 10, "type": "holding" },
  { "id": 20, "type": "freeparking" },
  { "id": 30, "type": "sendtoholding" }
]
```

Square types: `start`, `property`, `transit`, `utility`, `deck`, `tax`, `holding`,
`freeparking`, `sendtoholding`.

**Naming rules** (enforced by the package validator):

- `property` / `transit` / `utility` / `tax` squares **must** carry a `nameKey` — they
  have no fallback, so a missing name would leave them blank everywhere.
- Corner squares (`start`, `holding`, `freeparking`, `sendtoholding`) are named by
  `manifest.terminology` — don't repeat the name per square.
- `deck` squares without a `nameKey` inherit their **deck's** name.

## cards.json

Cards per deck. The **effect** is generic (the engine understands it); the **text** is
content, by key (`i18n/{lang}.json` under `cards.<id>`).

```jsonc
[
  { "id": "f1", "deck": "fortune",     "textKey": "cards.f1", "effect": { "type": "moveTo", "target": 0, "collectPass": true } },
  { "id": "f2", "deck": "fortune",     "textKey": "cards.f2", "effect": { "type": "moveTo", "target": "nearest:transit", "rentMultiplier": 2 } },
  { "id": "f3", "deck": "fortune",     "textKey": "cards.f3", "effect": { "type": "money", "amount": -50 } },
  { "id": "b1", "deck": "blackmarket", "textKey": "cards.b1", "effect": { "type": "money", "amount": 100 } },
  { "id": "b2", "deck": "blackmarket", "textKey": "cards.b2", "effect": { "type": "sendToHolding" } }
]
```

**Effect catalog** (engine-level; extensible):

- `moveTo` `{ target, collectPass?, rentMultiplier?, utilityTimesDice? }` — go to a square.
  `target` is a square id (`0`) or a nearest-of-type form (`"nearest:transit"`).
  `rentMultiplier` multiplies the rent due on arrival (the classic "pay double" card);
  `utilityTimesDice` charges 10× a fresh dice throw when landing on a utility.
- `moveBy` `{ steps }` — move forward/backward N squares.
- `money` `{ amount }` — collect from / pay the bank (+/-).
- `collectFromEach` / `payEach` `{ amount }` — with every player.
- `payPerBuilding` `{ perSmallBuilding, perBigBuilding }` — repairs.
- `sendToHolding` — to holding without collecting the start bonus.
- `grantReleasePass` — a keepable release-pass card.

---

## tokens/ (player pieces — required)

Every board **must** ship its own tokens (the engine has no built-in set). The manifest
declares only `id` + `nameKey`; the **drawing** lives in `tokens/<id>.svg`:

```xml
<!-- tokens/ufo.svg -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M3 14 h18 a9 5 0 0 0 -18 0 z"/></svg>
```

The loader extracts **only the `<path>` geometry** and **sanitises** it to path
characters (whitelist), so an uploaded package **cannot inject markup**: draw your tokens
**with paths** (flatten shapes to `path` in your editor). `nameKey` resolves against the
i18n (package or app). A `.corro` **without tokens** — or a token missing its
`tokens/<id>.svg` — **is invalid**.

---

## sounds/ (optional)

A package ships its game earcons in its own `sounds/` folder with a `pack.json`. The engine's
own pack holds **only platform cues** (chat, invalid-action) that every package inherits; it
ships **no game sounds**, so a package must declare its own `dice.roll`, `money.pay`, card
cues, etc. The pack still **overlays** the engine platform pack event-by-event (the package's
sounds win; platform cues are the backstop). The engine registers the package's pack when the
game starts and serves it; the client requests the manifest **by package token**.

Shared, cross-family earcons (`dice-roll`, `draw`, `shuffle`, `turn-you`, `game-over`,
`bankruptcy`, `piece-captured`) have a canonical source in the repo's `sound-commons/` folder:
copy the ones you need into `sounds/` and map them; ship themed files for the rest. Attribute
every file in a `CREDITS.md` (generics may point at `sound-commons/ATTRIBUTIONS.md`).

```jsonc
// sounds/pack.json
{
  "packId": "imperio-galactico",
  "events": {
    "holding.enter": "black-hole.ogg",
    "dice.roll": "dice.ogg",
    "money.pay": ["pay-1.ogg", "pay-2.ogg"]   // a list -> the client picks one at random
  },
  // Optional: map the package's OWN announcement keys (a card's themed playedKey line)
  // to an event, so the theme's plays carry their earcon. Consulted before the engine's
  // built-in announcement→event table; base keys cover their _self/_victim variants.
  "announcements": {
    "cards.sobrecarga_played": "assembly.attack"
  }
}
```

Each event maps to **one file or a list** (picked at random per playback). Event names
are **abstract** (they name no square and no brand): the server decides which event each
game occurrence fires and the client plays the active pack's sound. **A missing event is
simply silent** — declare only what you ship.

**Event vocabulary** (fixed in the engine; what the client knows how to fire):

| Event | When it plays |
| --- | --- |
| `dice.roll` | rolling the dice (property/race/track) |
| `property.buy` | buying a property |
| `property.build` | building a small building |
| `property.built` | landing on a built property |
| `property.sell` | selling a building |
| `group.complete` | completing a whole group |
| `money.pay` | paying money |
| `money.receive` | receiving money |
| `money.salary` | collecting when passing start |
| `tax.pay` | paying a tax |
| `rest.zone` | rest square (collecting the pot) |
| `transit` | transit square |
| `holding.enter` | being detained |
| `holding.leave` | leaving detention |
| `auction.start` | an auction starting |
| `turn.you` | your turn starts |
| `game.over` | game over |
| `bankruptcy` | bankruptcy |
| `error` | disallowed action |
| `piece.captured` | race: YOUR piece was captured (victim-side cue) |
| `card.draw` | card families: drawing / the automatic refill |
| `card.discard` | card families: discarding |
| `cards.shuffle` | journey: a fresh hand is dealt |
| `journey.distance.<km>` | journey: a distance card of that exact value (one slot per value: `journey.distance.25`, `.50`, `.75`, `.100`, `.200`…) |
| `journey.rolling` | journey: the seat starts rolling (green light) |
| `journey.immunity` | journey: an immunity is played |
| `journey.coup` | journey: a coup fourré |
| `assembly.piece.<color>` | assembly: a piece of that engine colour is installed (`assembly.piece.red`, `.green`, `.blue`, `.yellow`, `.wild`) |
| `assembly.attack` | assembly: an attack lands |
| `assembly.remedy` | assembly: a remedy is played |
| `assembly.special` | assembly: a special is played |
| `draft.pick` | draft: your secret pick (or re-pick) is confirmed |
| `draft.reveal` | draft: the whole table revealed |
| `draft.pass` | draft: the hands rotate |
| `draft.score` | draft: a round is scored |
| `hand.mode.single` | the hand panel returns to single-card mode |
| `hand.mode.multi` | the hand panel enters multi-select (the player's choice) |
| `hand.mode.multi_forced` | the rules FORCED multi-select (a mandatory multi-card pick) |
| `shedding.play` | shedding: a card lands on the discards |
| `shedding.wild` | shedding: a wild names the colour in force |
| `shedding.reverse` | shedding: the direction flips |
| `shedding.skip` | shedding: a player loses their turn |
| `shedding.penalty` | shedding: a penalty draw (2 or 4) |
| `shedding.round` | shedding: a round is won and scored |
| `exploding.played` | exploding: an action is played (opens the Nope window) |
| `exploding.nope` | exploding: a Nope is played |
| `exploding.fizzle` | exploding: a Noped action is cancelled |
| `exploding.skip` | exploding: a turn ends without drawing |
| `exploding.attack` | exploding: an attack piles draws on the next player |
| `exploding.shuffle` | exploding: the draw pile is shuffled |
| `exploding.future` | exploding: See the Future peeks the top cards |
| `exploding.defuse` | exploding: a drawn bomb is defused |
| `exploding.boom` | exploding: a player explodes and is knocked out |
| `trivia.move` | trivia: a piece lands on a square |
| `trivia.roll_again` | trivia: landing on a Roll Again square |
| `trivia.question` | trivia: a question is posed |
| `trivia.answer_submitted` | trivia: the active player submits their written answer |
| `trivia.reveal` | trivia: the correct answer is revealed |
| `trivia.judge_prompt` | trivia: the judge is asked to rule (targeted) |
| `trivia.correct` | trivia: an answer is judged correct |
| `trivia.wrong` | trivia: an answer is judged wrong |
| `trivia.wedge` | trivia: a wedge is earned |
| `trivia.wedges_complete` | trivia: all six wedges are collected |
| `trivia.final` | trivia: the final question begins |
| `trivia.win` | trivia: the final question is answered and the game is won |

---

## Engine announcements (overridable)

The engine **narrates** every event with an i18n key in the `game.*` namespace (the
server's authoritative voice: delivered as screen-reader text **and** a visual toast,
firing the matching earcon from the sound table). A package can **override any** of these
texts by including them in its `i18n/{lang}.json` under a `game` object; the loader
merges them over the engine's (deep-merge with override). No need to declare the ones you
don't change: the default applies.

Example — rewriting "three doubles → holding":

```jsonc
{
  "game": {
    "holding_speeding": "{{player}} breaks the speed of light and falls into {{holding}}!",
    "holding_speeding_self": "You break the speed of light! You fall into {{holding}}."
  }
}
```

**Conventions**

- **First person (`_self`)**: keys marked ✔ have a `<key>_self` variant shown to the
  acting player (everyone else sees the third-person base). Override **both**. Targeted
  lines (attacks, steals) may also have a `<key>_victim` second-person variant.
- **`{{…}}` variables**: keep them. `{{amount, money}}` formats with the board's
  currency; terms like `{{holding}}` or `{{start}}` come from your `terminology`,
  so you rarely need to touch them. A `$t({{card}})`-style variable carries an i18n KEY
  (a card name) resolved in the listener's own language — keep the `$t(…)` wrapper.
- The list is generated from the engine and may grow between versions.
- **Card families**: each brings its own namespace (`game.journey_*`,
  `game.assembly_*`, `game.draft_*`), listed in its family section below. The engine's
  defaults use **theme-neutral words** (piece, card, table…); a package themes the game
  by overriding them — that is the intended convention, not a workaround.

| Key (`game.…`) | Default (EN) | Variables | `_self` |
|---|---|---|:--:|
| `game.auction_no_bids` | No one bid on {{property}}. It remains unowned. | `{{property}}` | — |
| `game.auction_pass` | {{player}} passes on the auction | `{{player}}` | — |
| `game.auction_started` | Auction started for {{property}}! {{player}} declined to buy. | `{{property}}`, `{{player}}` | — |
| `game.auction_won` | 🎉 {{player}} wins {{property}} for {{amount, money}}! | `{{player}}`, `{{property}}`, `{{amount}}` | ✔ |
| `game.bid_placed` | {{player}} bids {{amount, money}} for {{property}} | `{{player}}`, `{{amount}}`, `{{property}}` | — |
| `game.building_built` | {{player}} built a {{building}} on {{property}} | `{{player}}`, `{{building}}`, `{{property}}` | ✔ |
| `game.buildings_sold` | {{player}} sold {{count}} {{buildings}} on {{property}} for {{amount, money}} | `{{player}}`, `{{count}}`, `{{buildings}}`, `{{property}}`, `{{amount}}` | ✔ |
| `game.cannot_afford_property` | {{player}} cannot afford {{property}} (costs {{price}} {{currencyName}}) | `{{player}}`, `{{property}}`, `{{price}}`, `{{currencyName}}` | ✔ |
| `game.card_drawn` | {{player}} draws a card | `{{player}}` | ✔ |
| `game.card_utility_rent_roll` | {{player}} throws the dice for the utility: {{die1}} + {{die2}} = {{total}}, so the rent is 10 times that. | `{{player}}`, `{{die1}}`, `{{die2}}`, `{{total}}` | ✔ |
| `game.collected_from_all` | {{player}} collected {{amount}} {{currencyName}} from every player | `{{player}}`, `{{amount}}`, `{{currencyName}}` | ✔ |
| `game.debt_cleared` | {{player}} has cleared all debt and can roll again | `{{player}}` | ✔ |
| `game.debt_created` | {{player}} owes {{amount, money}} to {{creditor}} | `{{player}}`, `{{amount}}`, `{{creditor}}` | ✔ |
| `game.debt_resolved` | {{player}} paid {{amount, money}} to {{creditor}} | `{{player}}`, `{{amount}}`, `{{creditor}}` | ✔ |
| `game.debts_remaining` | {{count}} debts remaining | `{{count}}` | ✔ |
| `game.dice_rolled` | {{player}} rolled {{die1}} + {{die2}} = {{total}} | `{{player}}`, `{{die1}}`, `{{die2}}`, `{{total}}` | ✔ |
| `game.dice_rolled_doubles` | {{player}} rolled {{die1}} + {{die2}} = {{total}}. Doubles! | `{{player}}`, `{{die1}}`, `{{die2}}`, `{{total}}` | ✔ |
| `game.doubles_roll_again` | {{player}} rolled doubles, roll again! | `{{player}}` | ✔ |
| `game.escaped_holding_doubles` | {{player}} rolled doubles and escapes {{holding}}! | `{{player}}`, `{{holding}}` | ✔ |
| `game.free_parking_collect` | {{player}} collects {{amount}} {{currencyName}} from {{freeparking}}! | `{{player}}`, `{{amount}}`, `{{currencyName}}`, `{{freeparking}}` | ✔ |
| `game.free_parking_empty` | {{player}} lands on {{freeparking}} but the pot is empty | `{{player}}`, `{{freeparking}}` | ✔ |
| `game.game_ended` | Game over! | — | — |
| `game.game_over` | Game Over! {{winner}} wins! | `{{winner}}` | ✔ |
| `game.game_started` | Game started with {{count}} players! | `{{count}}` | — |
| `game.send_to_holding` | {{player}} goes directly to {{holding}} | `{{player}}`, `{{holding}}` | ✔ |
| `game.group_completed` | {{player}} now owns the entire $t({{colorKey}}) group! | `{{player}}`, `{{colorKey}}` | ✔ |
| `game.release_passes_multiple` | {{player}} has {{count}} release passes | `{{player}}`, `{{count}}` | — |
| `game.release_passes_none` | {{player}} has no release passes | `{{player}}` | — |
| `game.release_passes_one` | {{player}} has 1 release pass | `{{player}}` | — |
| `game.holding_speeding` | {{player}} is caught speeding and goes straight to {{holding}}! | `{{player}}`, `{{holding}}` | ✔ |
| `game.holding_still_in` | {{player}} is still in {{holding}}. {{turns}} turns remaining | `{{player}}`, `{{holding}}`, `{{turns}}` | ✔ |
| `game.landed_on_big_building` | {{player}} lands on {{property}}. A whole {{bigBuilding}}, no less! This is going to hurt. | `{{player}}`, `{{property}}`, `{{bigBuilding}}` | ✔ |
| `game.landed_on_building` | {{player}} lands on {{property}}. Ouch! There's a {{building}} here, and it wants its rent. | `{{player}}`, `{{property}}`, `{{building}}` | ✔ |
| `game.landed_on_buildings` | {{player}} lands on {{property}}. Ouch! {{count}} {{buildings}} stand here, and they all want their rent. | `{{player}}`, `{{property}}`, `{{count}}`, `{{buildings}}` | ✔ |
| `game.landed_on_card` | {{player}} landed on a card square | `{{player}}` | ✔ |
| `game.landed_on_go` | {{player}} landed exactly on {{start}} and collects double: {{amount}} {{currencyName}} | `{{player}}`, `{{start}}`, `{{amount}}`, `{{currencyName}}` | ✔ |
| `game.landed_on_property` | {{player}} landed on {{square}} | `{{player}}`, `{{square}}` | ✔ |
| `game.landed_on_property_colored` | {{player}} landed on {{square}} ($t({{colorKey}})) | `{{player}}`, `{{square}}`, `{{colorKey}}` | ✔ |
| `game.mortgage_inherited_fee` | {{player}} is charged {{amount, money}} interest for inheriting mortgaged properties | `{{player}}`, `{{amount}}` | ✔ |
| `game.mortgage_transfer_fee` | {{player}} pays {{amount, money}} interest to the bank for the mortgaged {{property}} | `{{player}}`, `{{amount}}`, `{{property}}` | ✔ |
| `game.no_current_player` | No active player | — | — |
| `game.paid_all_players` | {{player}} paid {{amount}} {{currencyName}} to every player | `{{player}}`, `{{amount}}`, `{{currencyName}}` | ✔ |
| `game.paid_holding_release_cost` | {{player}} pays {{amount}} {{currencyName}} and leaves {{holding}} | `{{player}}`, `{{amount}}`, `{{currencyName}}`, `{{holding}}` | ✔ |
| `game.paid_repairs` | {{player}} paid {{amount}} {{currencyName}} for repairs ({{smallBuildings}} {{buildings}}, {{bigBuildings}} {{bigBuilding}}) | `{{player}}`, `{{amount}}`, `{{currencyName}}`, `{{smallBuildings}}`, `{{buildings}}`, `{{bigBuildings}}`, `{{bigBuilding}}` | ✔ |
| `game.passed_through_go` | {{player}} passed {{start}} and collects {{amount}} {{currencyName}} | `{{player}}`, `{{start}}`, `{{amount}}`, `{{currencyName}}` | ✔ |
| `game.player_bankrupt` | {{player}} has declared bankruptcy! | `{{player}}` | ✔ |
| `game.player_disconnected` | {{player}} has disconnected from the game | `{{player}}` | ✔ |
| `game.player_money` | {{player}} has {{amount}} {{currencyName}} | `{{player}}`, `{{amount}}`, `{{currencyName}}` | — |
| `game.player_reconnected` | {{player}} has reconnected | `{{player}}` | ✔ |
| `game.property_already_owned` | {{player}} already owns {{square}} | `{{player}}`, `{{square}}` | ✔ |
| `game.property_available` | {{player}} can buy {{property}} for {{price}} {{currencyName}} | `{{player}}`, `{{property}}`, `{{price}}`, `{{currencyName}}` | ✔ |
| `game.property_declined` | {{player}} decided not to buy {{property}} | `{{player}}`, `{{property}}` | ✔ |
| `game.property_mortgaged` | {{player}} mortgaged {{property}} for {{amount, money}} | `{{player}}`, `{{property}}`, `{{amount}}` | ✔ |
| `game.property_purchased` | {{player}} bought {{property}} for {{price}} {{currencyName}} | `{{player}}`, `{{property}}`, `{{price}}`, `{{currencyName}}` | ✔ |
| `game.property_unmortgaged` | {{player}} unmortgaged {{property}} for {{amount, money}} | `{{player}}`, `{{property}}`, `{{amount}}` | ✔ |
| `game.rent_not_due_mortgaged` | {{player}} lands on {{square}}, owned by {{landlord}}. No rent is due because it is mortgaged. | `{{player}}`, `{{square}}`, `{{landlord}}` | ✔ |
| `game.rent_paid` | {{player}} paid {{amount}} {{currencyName}} rent to {{landlord}} | `{{player}}`, `{{amount}}`, `{{currencyName}}`, `{{landlord}}` | ✔ |
| `game.sent_to_holding_by_card` | {{player}} is sent to {{holding}} by a card | `{{player}}`, `{{holding}}` | ✔ |
| `game.tax_debt_created` | {{player}} landed on {{square}} and owes {{amount}} {{currencyName}} in taxes | `{{player}}`, `{{square}}`, `{{amount}}`, `{{currencyName}}` | ✔ |
| `game.tax_paid` | {{player}} landed on {{square}} and paid {{amount}} {{currencyName}} in taxes | `{{player}}`, `{{square}}`, `{{amount}}`, `{{currencyName}}` | ✔ |
| `game.trade_cancelled` | {{initiator}} cancels the trade with {{target}}. | `{{initiator}}`, `{{target}}` | ✔ |
| `game.trade_completed` | {{target}} accepts the trade with {{initiator}}. {{initiator}} gives {{offered}}…; {{target}} gives {{requested}}…. | `{{target}}`, `{{initiator}}`, `{{offered}}`, `{{offeredCards}}`, `{{requested}}`, `{{requestedCards}}` | ✔ |
| `game.trade_declined` | {{target}} declines the trade from {{initiator}}. | `{{target}}`, `{{initiator}}` | ✔ |
| `game.trade_proposed` | {{initiator}} offers {{target}} a trade. | `{{initiator}}`, `{{target}}` | ✔ |
| `game.turn_of` | {{player}}'s turn | `{{player}}` | ✔ |
| `game.visiting_holding` | {{player}} is just visiting {{holding}} | `{{player}}`, `{{holding}}` | ✔ |

---

## The race family

A `"gameType": "race"` package reuses the common envelope (identity, `locales`,
`i18n/{lang}.json` by key, `tokens/` — required, `sounds/` and `help.<lang>.md` —
optional) but replaces the property-family sections: **no** `groups`, `decks`,
`cards.json`, `building`, `terminology`, `currency` or `rules`. `cards.json` may be
omitted entirely.

### board.json (race)

An object describing the shared circuit and each seat:

```jsonc
{
  "circuitLength": 68,        // squares in the shared ring (walk order 1..N, wrapping)
  "corridorLength": 7,        // private squares each seat crosses before its goal
  "piecesPerPlayer": 4,
  "safeSquares": [5, 12, 17, 22, 29, 34, 39, 46, 51, 56, 63, 68],
  "seats": [
    // One seat per playable colour. startSquare: where pieces land when leaving home
    // (MUST be listed in safeSquares). corridorEntry: the circuit square from which the
    // seat turns off — a piece ON it enters corridor square 1 with its next step.
    { "id": "rojo", "color": "#e0402f", "nameKey": "seats.rojo", "startSquare": 5,  "corridorEntry": 68 },
    { "id": "azul", "color": "#2f6fe0", "nameKey": "seats.azul", "startSquare": 22, "corridorEntry": 17 }
  ]
}
```

Validation: at least 2 seats with unique ids and distinct start squares; every
start/corridorEntry/safe square inside `1..circuitLength`; `players.max` may not exceed
the number of seats (nor the number of tokens).

### manifest raceRules

Classic parcheesi defaults; every field optional:

```jsonc
"raceRules": {
  "exitOn": 5,                        // die value that exits home (mandatory when legal)
  "extraRollOn": 6,                   // die value that grants another roll
  "threeSixesPenalty": true,          // third consecutive 6: last moved piece goes home
  "captureBonus": 20,                 // bonus steps after capturing
  "goalBonus": 10,                    // bonus steps after reaching the goal
  "sixWorthSevenWhenNoneHome": true,  // a 6 moves 7 once no piece is at home
  "barriers": true                    // same-seat pairs block passage; a 6 must open yours
}
```

### Race rules the engine implements

- **Exit**: rolling `exitOn` with pieces at home MUST exit (the only legal move). The
  exit **captures** an opponent camped on your start — the one exception to safe squares.
- **Captures**: landing on a lone rival off a safe square sends it home and awards
  `captureBonus` steps (played with any piece; bonuses chain; an unplayable bonus is lost
  and announced). Reaching the goal awards `goalBonus` likewise. Bonuses never exit home.
- **Occupancy**: a square holds at most two pieces; different seats share only on safe
  squares. Two same-seat pieces form a **barrier** nobody passes (owner included); rolling
  `extraRollOn` with a barrier obliges opening it when such a move is legal.
- **Corridor/goal**: pieces turn into their own corridor (forced) and need an **exact
  count** to land on the goal. The first player with every piece at the goal wins.
- The race family plays with **one die**, announced and explored with the same
  accessibility pipeline as the property family (the board arrows walk the circuit and
  zones topologically).

---

## The track family

A `"gameType": "track"` package is the smallest family: one piece per player, a single
shared track, **no player decisions** (roll-and-resolve). It reuses the common envelope
(identity, `locales`, `i18n/{lang}.json`, `tokens/` — required, `sounds/` and
`help.<lang>.md` — optional) and, like the race family, carries **none** of the
property-family sections. Because there are no seats, players are identified by their
chosen token and an engine-assigned colour.

### board.json (track)

```jsonc
{
  "trackLength": 100,   // squares on the path, walked 1..N; N is the goal
  "gridWidth": 10,      // squares per visual row (serpentine fold, starting bottom-left)
  "effects": [
    // Landing on `from` teleports the piece to `to`. `kind` is THEME data (it names the
    // connector drawn on the board and the i18n key `effects.<kind>` spoken while
    // exploring); the engine itself only follows the jump. Effects may chain: a ladder
    // may drop you on a snake's mouth (authoring cycles are cut, each edge fires once).
    { "from": 4,  "to": 14, "kind": "ladder" },
    { "from": 17, "to": 7,  "kind": "snake" }
  ]
}
```

Validation: `trackLength` ≥ 10; `gridWidth` in `2..trackLength`; every effect inside
`1..trackLength` with `from ≠ to`, at most one effect per square, none on the final
square, and a non-empty `kind`.

### manifest trackRules

```jsonc
"trackRules": {
  "exactFinish": "bounce",  // overshooting the goal: "bounce" back the excess (default)
                            // or "stay" (the move is lost, the piece does not move)
  "rollAgainOnMax": true    // rolling the die's maximum grants another roll
}
```

### Track rules the engine implements

- Pieces start **off the board** (square 0, the start tray) and enter with the first roll.
- Landing on an effect square teleports the piece and voices the jump **by direction**
  with `game.track_effect_up` / `game.track_effect_down` — a package themes those keys in
  its own i18n ("you find a ladder…", "a snake swallows you…") without touching the engine.
- The goal needs an **exact count**; `exactFinish` decides what an overshoot does. The
  first player to reach it wins; the game continues for the remaining places and closes
  when a single player is left, exactly like the race family.
- The track family plays with **one die**. The board arrows walk the serpentine path
  (←/→ = ±1 square, ↑/↓ = ±`gridWidth`), typed digits jump to a square (1-based), and
  every square announces its number, its effect (kind + destination) and its occupants.

---

## The journey family

A `"gameType": "journey"` package has **no `board.json` at all**:
`cards.json` **is** the game content — a flat list of card definitions with copy counts.
It reuses the common envelope (identity, `locales`, `i18n/{lang}.json`, `tokens/` —
required, `sounds/` and `help.<lang>.md` — optional) and carries none of the
property-family sections. Hands are **hidden information**: the server projects every
state per player before it leaves.

### cards.json (journey)

```jsonc
[
  { "id": "d25",      "type": "distance", "value": 25,  "count": 10, "nameKey": "cards.d25" },
  { "id": "d200",     "type": "distance", "value": 200, "count": 4,  "nameKey": "cards.d200",
                      "maxPlaysPerHand": 2, "premium": true },
  { "id": "stop",     "type": "attack",   "kind": "stop", "hazardClass": "stopper", "count": 5,
                      "nameKey": "cards.stop", "playedKey": "cards.stop_played" },
  { "id": "limit50",  "type": "attack",   "kind": "speedLimit", "hazardClass": "limiter", "count": 4,
                      "nameKey": "cards.limit50" },
  { "id": "go",       "type": "remedy",   "kind": "stop", "count": 14, "nameKey": "cards.go" },
  { "id": "priority", "type": "immunity", "shieldsKinds": ["stop", "speedLimit"], "count": 1,
                      "nameKey": "cards.priority" }
]
```

Card types (the engine implements the mechanics; a package cannot invent them):

- `distance` `{ value, maxPlaysPerHand?, premium? }` — advance `value` km toward the goal
  (exact finish; illegal under a `stopper`, capped under a `limiter`). `premium` cards
  count against the safe-trip bonus.
- `attack` `{ kind, hazardClass }` — inflict the package-defined hazard `kind` on a rival.
  `hazardClass` is `"stopper"` (blocks all distance play) or `"limiter"` (caps distance
  values at `journeyRules.limitCap`).
- `remedy` `{ kind }` — cure that hazard on yourself.
- `immunity` `{ shieldsKinds }` — permanent shield against those kinds; cures them on
  play, blocks them for the rest of the hand, and enables the **coup fourré**: attacked
  while holding it in HAND, the victim may flash it for a bonus and steal the turn.
- `playedKey` (any type, optional) — a themed play line replacing the engine's generic
  sentence + card name. Vars: `{{player}}`, `{{token}}`, `{{target}}` on attacks,
  `{{km}}`/`{{total}}` on distances. Follow the `_self`/`_victim` convention.

### manifest journeyRules

Classic defaults; every field optional:

```jsonc
"journeyRules": {
  "goalKm": 1000,          // kilometres that complete a hand (exact — no overshooting)
  "targetScore": 5000,     // hands repeat until someone crosses this; 0 = a single hand
  "handSize": 6,           // draw back up to this at the start of your turn
  "stackHazards": false,   // allow stacking DIFFERENT stoppers on an already-stopped victim
  "limitCap": 50,          // max distance value playable under a limiter
  "initialHazard": "stop", // every seat starts the hand under this hazard ("" = start free)
  // Scoring (official table; 0 disables a bonus):
  "pointsPerKm": 1, "immunityPoints": 100, "allImmunitiesBonus": 300,
  "coupFourreBonus": 300, "tripCompleteBonus": 400, "safeTripBonus": 300,
  "deckExhaustedBonus": 300, "capotBonus": 500
}
```

The lobby may seat **teams** (shared seats: members alternate turns over one common
kilometre count and hand-scoring seat).

### Overridable voice (`game.journey_*`)

Play lines: `journey_drew`, `journey_played_distance`, `journey_attacked`,
`journey_played_remedy`, `journey_played_immunity`, `journey_discarded`, `journey_coup`,
`journey_coup_offer`, `journey_now_rolling`, `journey_no_cards_skip` (each with `_self`
where it applies). Hand flow: `journey_hand_won`, `journey_hand_exhausted`,
`journey_hand_score`, `journey_new_hand`, `journey_round`. Refusals:
`journey_stopped`, `journey_over_limit`, `journey_overshoot`, `journey_card_limit`,
`journey_needs_target`, `journey_target_immune`, `journey_target_already`,
`journey_target_stopped`, `journey_nothing_to_cure`, `journey_deck_empty`,
`journey_no_coup`, `journey_no_attackable`, `journey_not_your_turn`,
`journey_already_drew`, `journey_coup_pending`, `journey_unknown_card`,
`journey_card_not_in_hand`. Status/surfaces: `journey_status_*`, `journey_team`,
`journey_deck_*`, `journey_pile_*`, `journey_discard_top`, `journey_coup_*` (dialog),
`journey_pick_victim`. Per-card help: `journey_help_*` — or write your own with a
`<nameKey>_help` key next to the card's name.

---

## The assembly family

A `"gameType": "assembly"` package also ships **only a deck**: collect one
FUNCTIONAL piece per colour while rivals damage them. Hands, the draw pile **and the
discard pile** (face-down in this genre, reshuffled when the pile dries) are hidden
information. The turn is: play ONE card or discard 1..`maxDiscard` face-down, then the
hand refills automatically.

### cards.json (assembly)

```jsonc
[
  { "id": "reactor",  "type": "piece",  "color": "red",  "count": 5, "nameKey": "cards.reactor" },
  { "id": "omni",     "type": "piece",  "color": "wild", "count": 1, "nameKey": "cards.omni" },
  { "id": "fuga",     "type": "attack", "color": "green", "count": 4, "nameKey": "cards.fuga",
                      "playedKey": "cards.fuga_played" },
  { "id": "sellador", "type": "remedy", "color": "green", "count": 4, "nameKey": "cards.sellador" },
  { "id": "grua",     "type": "special", "specialKind": "swapPiece", "count": 3, "nameKey": "cards.grua" }
]
```

- `piece` `{ color }` — install in your rack, one per colour. `"wild"` is the joker: it
  fills any missing colour and is hit by attacks of any colour.
- `attack` `{ color }` — on a colour-matching rival slot: healthy → damaged (doesn't
  count for the win); a second hit **destroys** the piece; on a shielded slot it burns
  the shield. Locked slots are untouchable. `"wild"` hits anything.
- `remedy` `{ color }` — on your own slot: damaged → cured; healthy → shielded; a second
  shield **locks** it forever. `"wild"` fixes anything.
- `special` `{ specialKind }` — one of the engine's five effects: `swapPiece` (one of
  mine ↔ one of a rival's, states carried, locked excluded), `stealPiece` (take a
  non-locked rival piece into my free colour), `plague` (my damages jump to rivals'
  CLEAN matching slots, deterministic), `scrapHands` (every rival discards their hand),
  `fullSwap` (whole racks swap, locked included).
- `playedKey` — themed play line as in the journey family (`_self`/`_victim` variants).

### manifest assemblyRules

```jsonc
"assemblyRules": {
  "handSize": 3,     // refilled up to this at the end of every turn
  "slotsToWin": 4,   // distinct FUNCTIONAL colours that complete the rack (wild fills one)
  "maxDiscard": 3    // max cards discardable in one turn (the alternative to playing)
}
```

Validation: unique card ids, known types/specialKinds, attacks/remedies answering piece
colours that exist, at least `slotsToWin` piece colours, a deck big enough for
`players.max` hands.

### Overridable voice (`game.assembly_*`)

Play lines: `assembly_played_piece`, `assembly_attacked` (+`_victim`),
`assembly_played_remedy`, `assembly_played_special`, `assembly_discarded`,
`assembly_passed`, `assembly_refilled` (+ `_self`, `_self_2`, `_self_3`, `_self_many`).
Outcomes: `assembly_hit_afflicted|destroyed|shieldBurned` (+`_victim`),
`assembly_remedy_cured|shielded|locked`, `assembly_stolen`/`assembly_swapped`
(+`_self`/`_victim`). Refusals: `assembly_color_taken(_theirs)`, `assembly_needs_target`,
`assembly_no_such_slot`, `assembly_slot_locked`, `assembly_color_mismatch`,
`assembly_already_locked`, `assembly_nothing_to_spread|fix|swap|steal`,
`assembly_no_hands_to_scrap`, `assembly_must_act`, `assembly_discard_too_many`,
`assembly_card_not_in_hand`, `assembly_unknown_card`, `assembly_no_attackable`,
`assembly_not_your_turn`. Pickers/status: `assembly_pick_*`, `assembly_piles_row`,
`assembly_status_*`, `assembly_state_ok|afflicted|shielded|locked` (the vocabulary that
most defines the theme — Taller Galáctico says averiado/blindado/certificado, a medical
theme says infectado/vacunado/inmunizado). Per-card help: `assembly_help_*` or
`<nameKey>_help`.

---

## The draft family

A `"gameType": "draft"` package ships **only a deck** and is the
engine's **simultaneous** family: there is no turn. Every trick, ALL players secretly
pick one card from their hand (re-pickable until the last one commits); the picks reveal
together onto each player's public table and the shrunken hands rotate **to the left**.
When the hands run out the round is scored; after `rounds` rounds the dessert race
settles the game. Hands, pending picks and the draw pile are hidden; tables, desserts
and scores are public.

### cards.json (draft)

```jsonc
[
  { "id": "gamba",       "type": "points",     "value": 3, "count": 4,  "nameKey": "cards.gamba" },
  { "id": "salsa-brava", "type": "multiplier", "factor": 3, "count": 6, "nameKey": "cards.salsa_brava" },
  { "id": "croqueta",    "type": "set",        "setSize": 2, "setPoints": 5, "count": 14, "nameKey": "cards.croqueta" },
  { "id": "aceitunas",   "type": "scale",      "scale": [1, 3, 6, 10, 15], "count": 14, "nameKey": "cards.aceitunas" },
  { "id": "racion-3",    "type": "majority",   "icons": 3, "count": 8,  "nameKey": "cards.racion_3" },
  { "id": "flan",        "type": "dessert",    "count": 12, "nameKey": "cards.flan" },
  { "id": "pinzas",      "type": "extra",      "count": 4,  "nameKey": "cards.pinzas" }
]
```

- `points` `{ value }` — worth `value` at round end; landing with an unused `multiplier`
  on your table, it lands ON it and multiplies.
- `multiplier` `{ factor }` — waits on your table and boosts the NEXT points card you
  play ×`factor`. Worth nothing alone.
- `set` `{ setSize, setPoints }` — every complete group of `setSize` copies scores
  `setPoints`; loose copies score nothing.
- `scale` `{ scale: [s1, s2, …] }` — k copies score the k-th step (capped at the last).
- `majority` `{ icons }` — feeds the round's single majority race: most icons split
  `majorityFirst`, the runners-up split `majoritySecond` (a tie up top eats it).
- `dessert` — kept across rounds; at game end most desserts split `dessertBonus`,
  fewest split `dessertPenalty` as a loss (waived in two-player games).
- `extra` — waits on your table; **spend it to pick TWO cards in one trick** (the client
  offers this through the hand's multi-select mode). The FIRST card resolves first — a
  multiplier picked ahead of a points card boosts it in that very trick — and the extra
  then **rejoins the hand you pass**: your neighbour inherits it. Worth no points.

### manifest draftRules

```jsonc
"draftRules": {
  "rounds": 3,
  "handSizeBase": 12,   // opening hand = handSizeBase - playerCount (2:10 … 5:7)
  "majorityFirst": 6, "majoritySecond": 3,
  "dessertBonus": 6, "dessertPenalty": 6
}
```

Validation: unique ids, known types with coherent scoring attributes, hands of at least
2 at every table size, and a deck with `rounds × players × handSize(players)` cards for
**every** supported player count (rounds deal from one shrinking pile; revealed cards
never return).

### Overridable voice (`game.draft_*`)

The pick (identity private, "who picked" public): `draft_picked` (+`_self`,
`_two_self`), `draft_repicked_self` (+`_two_self`), `draft_all_picked`. The reveal:
`draft_revealed` (+`_self`), `draft_revealed_boosted` (+`_self`),
`draft_extra_returned` (+`_self`), `draft_hands_passed`. Rounds:
`draft_round_started`, `draft_round_scored` (+`_self`), `draft_dessert_bonus|penalty`
(+`_self`), `draft_final_score` (+`_self`). Refusals: `draft_not_in_hand`,
`draft_not_seated`, `draft_unknown_card`, `draft_same_card`, `draft_needs_extra`,
`draft_too_many_picks`, `draft_game_over`. Surfaces/status: `draft_piles_row`,
`draft_card_picked`, `draft_table_boosted`, `draft_table_copies`, `draft_status_*`.
Per-card help: `draft_help_*` or `<nameKey>_help`. (The hand panel's multi-select voice
lives in the shared `game.hand_multi_*` keys, overridable the same way.)

---

## The shedding family

A `"gameType": "shedding"` package ships **only a deck**. Turn-based: play
one card matching the top of the discards — by **colour**, by **number value** or by
**action type** — or **draw one** and, if it fits, choose to play it or keep it (the
game pauses on the drawer's decision). First empty hand wins the **round** and collects
the points left in every rival hand; rounds repeat until `targetScore`, each round dealt
from a fresh full deck with the previous winner leading. Hands, the draw pile, the
discards **below the top card** and the drawer's pause are hidden information.

This family deliberately has **no one-card-left shout**: hand counts are on-demand
information (the S / Shift+S status keys), so noticing who runs short stays part of the
game for every player, sighted or not — never a reflex race.

### cards.json (shedding)

```jsonc
[
  { "id": "rojo-5",       "type": "number",       "color": "rojo", "value": 5, "count": 2, "nameKey": "cards.rojo_5" },
  { "id": "rojo-salta",   "type": "skip",         "color": "rojo", "count": 2, "nameKey": "cards.rojo_salta" },
  { "id": "verde-reversa","type": "reverse",      "color": "verde", "count": 2, "nameKey": "cards.verde_reversa" },
  { "id": "azul-roba2",   "type": "drawTwo",      "color": "azul", "count": 2, "nameKey": "cards.azul_roba2" },
  { "id": "comodin",      "type": "wild",         "count": 4, "nameKey": "cards.comodin" },
  { "id": "comodin-roba4","type": "wildDrawFour", "count": 4, "nameKey": "cards.comodin_roba4" }
]
```

- `number` `{ color, value }` — matches by colour or on an equal value; scores `value`.
- `skip` `{ color }` — the next player loses their turn.
- `reverse` `{ color }` — the direction flips (with two players it acts as a skip).
- `drawTwo` `{ color }` — the next player draws 2 and loses their turn.
- `wild` — always playable; the player names the colour in force.
- `wildDrawFour` — wild + the next player draws 4 and loses their turn. Legal only while
  the player holds **no card of the colour in force** — the server enforces it, so there
  is no bluffing and no challenge window.
- Action cards also match each other by TYPE (a skip on a skip, across colours).
- `points` (optional, any type) — round-scoring override; the default is the classic
  table: numbers their value, coloured actions 20, wilds 50.
- Colours are package-defined ids; **every colour needs a spoken name** under the
  package's `colors.<id>` i18n key (the wilds name it out loud; validated).
- The round opener flips from the pile until a NUMBER shows (flipped actions slide under
  the pile), so every deck needs at least one number card and two colours.

### manifest sheddingRules

```jsonc
"sheddingRules": {
  "handSize": 7,
  "targetScore": 500,             // 0 = a single round
  "drawnCardPlayable": true,      // the classic "draw one, play it if it fits" pause
  "wildDrawRequiresNoMatch": true // the honest wild-draw gate (false = always legal)
}
```

Validation: unique ids, known types, wilds colourless and everything else coloured and
named, at least two colours and one number card, non-negative values/points, and a deck
of at least `players.max × handSize + 1` cards (draws recirculate the buried discards).

### Overridable voice (`game.shedding_*`)

Plays and effects: `shedding_played`, `shedding_color_chosen`, `shedding_reversed`,
`shedding_skipped`, `shedding_drew_penalty` (each with `_self`),
`shedding_penalty_cards` (+`_2`, `_3`, `_4` — the victim's private identities). The draw
flow: `shedding_drew`, `shedding_drew_playable`, `shedding_drew_unplayable`,
`shedding_kept` (+`_self`), `shedding_deck_empty` (+`_self`). Rounds:
`shedding_round_started`, `shedding_round_won` (+`_self`). Refusals:
`shedding_not_playable`, `shedding_wild_needs_no_match`, `shedding_only_drawn`,
`shedding_bad_color`, `shedding_pending_decision`, `shedding_nothing_pending`,
`shedding_card_not_in_hand`, `shedding_unknown_card`, `shedding_not_seated`,
`shedding_not_your_turn`, `shedding_game_over`. Surfaces/status: `shedding_table_row`,
`shedding_card_drawn`, `shedding_pick_color`, `shedding_status_*`. Per-card help:
`shedding_help_*` or `<nameKey>_help`.

---

## The exploding family

A `"gameType": "exploding"` package ships **only a deck**. Turn-based
press-your-luck against a shared, **ordered** draw pile: on your turn you may play any number of
action cards and then you **must draw one** to end the turn. Draw a **bomb** you cannot **Defuse**
and you are knocked out — the last player standing wins. The engine plants **one fewer bomb than
there are players**, so everyone eventually explodes but one. Hands and the whole draw-pile ORDER
are hidden; what a peek (See the Future) or a Defuse tuck reveals is a **one-shot private
announcement**, never stored — so a rival never learns the order.

Playing an action does not resolve at once: it opens a real-time **Nope window**
(`nopeWindowMillis`, default 2s; each Nope restarts it) during which anyone holding a **Nope** may
cancel it. An **even** number of Nopes (including zero) leaves the action standing, an **odd**
number cancels it.

### cards.json (exploding)

```jsonc
[
  { "id": "grisu",        "type": "bomb",      "count": 4, "nameKey": "cards.grisu" },
  { "id": "cortar-mecha", "type": "defuse",    "count": 6, "nameKey": "cards.cortar_mecha" },
  { "id": "salir-pozo",   "type": "skip",      "count": 4, "nameKey": "cards.salir_pozo" },
  { "id": "derrumbe",     "type": "attack",    "count": 4, "nameKey": "cards.derrumbe" },
  { "id": "canario",      "type": "seeFuture", "count": 5, "nameKey": "cards.canario" },
  { "id": "revuelto",     "type": "shuffle",   "count": 4, "nameKey": "cards.revuelto" },
  { "id": "pico-prestado","type": "favor",     "count": 4, "nameKey": "cards.pico_prestado" },
  { "id": "ni-hablar",    "type": "nope",      "count": 5, "nameKey": "cards.ni_hablar" },
  { "id": "rata",         "type": "cat",       "count": 4, "nameKey": "cards.rata" }
]
```

- `bomb` — the danger. **Never** dealt into an opening hand; the engine plants (players − 1) into
  the draw pile. Drawing it knocks you out unless you hold a Defuse.
- `defuse` — cancels a bomb you just drew and lets you tuck it back into the draw pile at a secret
  **depth** of your choice (0 = the top, drawn next). `defusesPerPlayer` are dealt to each hand.
- `skip` — end your turn without drawing.
- `attack` — end your turn without drawing; the next player owes `attackDraws` extra draws.
- `seeFuture` — privately look at the top `seeFutureCount` cards of the draw pile.
- `shuffle` — shuffle the draw pile (erasing any known order).
- `favor` — a chosen player gives you a card. *(Catalog type recognised; play not yet wired.)*
- `nope` — the only **out-of-turn** card: cancels a pending action; a Nope can itself be Noped.
- `cat` — no power alone; two of the **same** cat card are a pair to steal a random card.
  *(Catalog type recognised; play not yet wired.)*
- A card is `{ id, type, count, nameKey }` — no colour or value axis.

### manifest explodingRules

```jsonc
"explodingRules": {
  "handSize": 7,           // non-bomb, non-defuse cards dealt to each player
  "defusesPerPlayer": 1,   // guaranteed defuses in every opening hand
  "seeFutureCount": 3,     // cards See the Future reveals
  "attackDraws": 2,        // draws an Attack forces on its victim
  "nopeWindowMillis": 2000 // the real-time suspense window before an action resolves
}
```

Validation: unique ids, known types, non-blank names, positive counts, no host house rules yet,
`players.min ≥ 2`, and enough of each ROLE for the largest table — at least (players.max − 1)
bombs, players.max × defusesPerPlayer defuses, and players.max × handSize non-bomb/non-defuse
cards for the opening hands.

### Overridable voice (`game.exploding_*`)

Plays and effects: `exploding_played`, `exploding_noped`, `exploding_action_cancelled`,
`exploding_skipped`, `exploding_attacked`, `exploding_shuffled`, `exploding_drew_bomb_defused`,
`exploding_exploded`, `exploding_again` (each with `_self`). Private lines: `exploding_drew_self`,
`exploding_tucked_self`, `exploding_future` (+`_2`, `_3`, `_empty`), `exploding_saw_future`,
`exploding_drew`. Opening: `exploding_game_started`. Refusals: `exploding_window_open`,
`exploding_resolve_bomb_first`, `exploding_not_seated`, `exploding_card_not_in_hand`,
`exploding_unknown_card`, `exploding_not_playable`, `exploding_nothing_to_nope`,
`exploding_not_a_nope`, `exploding_no_bomb_pending`. Surfaces/status: `exploding_status_*`,
`exploding_table_row`, `exploding_pick_depth`, `exploding_depth_*`. Per-card help:
`exploding_help_*` or `<nameKey>_help`.

---

## The trivia family

A `"gameType": "trivia"` package is a category quiz on a hub-and-spoke **wheel**.
It reuses the common envelope (identity, `locales`, `i18n/{lang}.json`, `tokens/` — required,
`sounds/` and `help.<lang>.md` — optional) and carries **none** of the property-family
sections. Players are identified by their token and an engine-assigned colour. The family
**supports no bots** (a bot holding the answer card is meaningless), so `players.min` must be
at least 2.

### board.json (trivia)

The board declares the wheel PARAMETERS; the engine builds the node graph from them. Node ids:
`"C"` = centre; `"S{i}.{j}"` = interior square j (`1..spokeLength`, from the centre out) of
spoke i (`0..5`); `"R{k}"` = ring slot k.

```jsonc
{
  "spokeLength": 3,        // interior squares on each spoke, between the centre and its wedge
  "ring": [
    // The outer ring in loop order. Exactly SIX slots must be wedges (category headquarters),
    // one per category (0..5). `category` (0..5) is the question colour a landing asks;
    // `wedge` marks a headquarters (a correct answer there earns that wedge); `rollAgain`
    // marks a free extra roll. Spoke i joins the centre to the i-th wedge slot in ring order.
    { "category": 0, "wedge": true },
    { "category": 1 },
    { "category": 2, "rollAgain": true },
    { "category": 1, "wedge": true }
    // …six wedge slots total, one per category 0..5…
  ]
}
```

Validation: `spokeLength` ≥ 1; the ring has ≥ 6 slots and **exactly six wedges covering
categories 0..5 once each**; every slot category in `0..5`; `answerMode` ∈
{`judge`,`choice`,`typed`}; `judgeMode` ∈ {`rotating`,`fixed`}; and **each shipped locale's
question deck covers every category** (choice mode additionally needs ≥ 2 choices per question).

### questions.&lt;lang&gt;.json (the deck)

The question deck is real content **per locale** (not a translation): one file per language,
resolved once at game start. Each question:

```jsonc
{
  "id": "geo_francia",
  "category": 0,               // 0..5, must match a board colour
  "prompt": "¿Cuál es la capital de Francia?",
  "answer": "París",           // the canonical answer, shown at the reveal
  "accept": ["paris"],         // extra accepted spellings for "typed" mode (normalised)
  "choices": ["París", "Londres", "Madrid", "Roma"],  // "choice" mode; [0] is the correct one
  "difficulty": 1
}
```

Order matters for E2E: the identity shuffle keeps the file order, so the opening questions are
known (reordering breaks `e2e/tests/trivia.spec.ts`).

### manifest triviaRules

```jsonc
"triviaRules": {
  "answerMode": "judge",     // "judge" (written + a human judge, default) | "choice" | "typed"
  "judgeMode": "rotating",   // "rotating" (the next player, default) | "fixed" (host picks at start)
  "exactFinish": true,       // the centre needs an exact count to win
  "centerWild": true,        // landing on the centre without all wedges asks a wild question
  "answerSeconds": 0         // answer-timer earcon countdown; 0 = off
}
```

### Trivia rules the engine implements

- Everyone starts at the **centre**. A roll gives a DISTANCE; the player chooses the landing
  square from the legal options (only the landing matters — the route is irrelevant, and a
  move never immediately backtracks). The centre doubles as a shortcut between spokes.
- Landing asks a question of the square's category. A **correct** answer earns the wedge when
  the square is a headquarters, and grants **another roll**; a **wrong** answer passes the turn.
- **Adjudication:** in `judge` mode the active player writes an answer, the server reads it to
  the table, and the judge — who alone hears the correct answer until the reveal — rules
  yes/no. `choice`/`typed` auto-adjudicate. In `judge`+`fixed` mode the first turn waits on a
  **start-time modal** where the host picks the judge from the human players.
- **Winning:** collect all six wedges, return to the centre and answer a final question.
- The board arrows follow the RADIAL invariant — ↑ toward the centre, ↓ toward the ring, ←/→
  turn — plus `E` (centre) and the colour letters `B/P/Y/R/G/O` (jump to a headquarters).

### Overridable voice (`game.trivia_*`)

The engine speaks neutral lines; a package themes them in its own i18n. In particular the six
category names `game.trivia_cat_a`…`game.trivia_cat_f` (indices 0..5) SHOULD be overridden
with the real category names — they are resolved via `$t` inside the lines below. Overridable
keys (each with its `_self` variant where the actor differs): `trivia_rolled`, `trivia_moved`,
`trivia_moved_wedge`, `trivia_moved_center`, `trivia_roll_again`, `trivia_question`,
`trivia_final`, `trivia_answered`, `trivia_reveal`, `trivia_correct`, `trivia_wrong`,
`trivia_wedge`, `trivia_wedges_complete`, `trivia_won`, plus `trivia_cat_a`…`trivia_cat_f`.

---

## Design notes

- **No brands in the engine**: the engine knows no game-specific terms; everything comes
  from the package (names, terminology, currency, buildings, sounds, announcements).
- **Channel parity**: every name/text feeds both the visual layer and the screen reader;
  `group.color` is a visual aid only (the accessible identity is the group's name + its
  keyboard shortcut).
- **Validation**: uploaded packages run through the package validator (a supported
  `gameType`, tokens present and drawable, every referenced i18n key resolvable
  somewhere, ownable/tax squares named, deck references valid…). Invalid packages are
  rejected with actionable messages.
