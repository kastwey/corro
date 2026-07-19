# Tutorial: build a property board of your own city

A step-by-step, do-it-with-me guide to making a **complete 40-square property board** as an
`.corro` package — themed around the streets of *your* city. No coding: a package is
just data (a few text files). You'll end with a real board you can load and play.

> This is the friendly walkthrough. The full reference for every field is
> [CORRO_FORMAT.md](../CORRO_FORMAT.md) — keep it open in another tab for the details.
> If a word here is new ("group", "transit", "deck"), the format spec defines it.

**Use an original title and visual identity.** Mechanics may be reused, but familiar commercial names and board
art are not. Give your game its own name (we'll use *"My City"* as a placeholder) and your
own street names — which, being your city, they already are.

---

## Step 0 — Gather your ingredients (do this before any file)

The classic board has a fixed shape: **22 streets, 4 stations, 2 services (utilities), 2
taxes, and the four corners.** So make a **numbered list** of your city's landmarks to fill
those slots. If you're not sure what to pick, ask any AI assistant:

> "Give me the **22 most famous streets, plazas or neighbourhoods** of `<my city>`, ordered
> roughly from the humblest/cheapest area to the grandest/most expensive. Then **4 transport
> hubs** (train/metro stations, bus terminal, airport, port…) and **2 utility companies**
> (water, electricity, gas, internet…)."

Write the answer down as three numbered lists:

- **Streets 1–22**, cheapest → priciest. (The board gets more expensive as you go around, so
  this order matters — #1 will be the first, humblest property; #22 the grandest.)
- **Stations 1–4.**
- **Services 1–2.**

Also decide, in a sentence each:

- **A name** for your game and a short **id** (lowercase, dashes: e.g. `mi-ciudad`).
- **A currency** — its symbol, a 2–3 letter code, and a name (e.g. `€` / `EUR` / "euros",
  or invent one: `✦` / "CDT" / "city credits").
- What your **two card decks** are called (the "chance-like" and "community-like" piles —
  e.g. "Town Hall" and "Local News").
- What your **buildings** are called (classic: "house" and "hotel" — or "kiosk" and "mall",
  "stall" and "market"…).

Keep this list next to you. Everything below just pours it into the files.

---

## Step 1 — Make the folder

Create a folder for your package under the server's packages directory:

```
server/Packages/mi-ciudad/
├── manifest.json
├── board.json
├── cards.json
├── i18n/
│   ├── en.json
│   └── es.json
├── tokens/
│   └── <one .svg per player piece>
└── help.en.md   (optional)
```

Create the empty folders now; we'll fill each file in the next steps.

---

## Step 2 — `manifest.json` (identity, groups, rules)

This declares *what kind of game* it is and its knobs. Copy this and edit the marked bits.
Everything is explained in [CORRO_FORMAT.md](../CORRO_FORMAT.md#manifestjson).

```jsonc
{
  "format": "corro/v1",
  "gameType": "property",              // the family: a trading board
  "engineVersion": "^1.0",
  "id": "mi-ciudad",                   // ← your id (matches the folder)
  "name": { "en": "My City", "es": "Mi Ciudad" },  // ← your game's name (shown in the lobby)
  "author": "your name",
  "version": "0.1.0",
  "locales": ["en", "es"],

  "currency": { "symbol": "€", "code": "EUR", "nameKey": "currency.name" },  // ← symbol/code inline; name by key
  "centerBrand": "MY CITY",            // the diagonal text in the middle of the board

  // The four corners' names come from here (not per-square):
  "terminology": {
    "start":       "terminology.start",
    "holding":        "terminology.holding",
    "freeparking": "terminology.freeparking",
    "sendtoholding":    "terminology.sendtoholding"
  },

  // The 8 street colour-groups + the two special groups. "key" is an optional board shortcut.
  "groups": [
    { "id": "g1", "color": "#8a5a2b", "colorName": "groups.g1" },
    { "id": "g2", "color": "#7ec8e3", "colorName": "groups.g2" },
    { "id": "g3", "color": "#d84e9b", "colorName": "groups.g3" },
    { "id": "g4", "color": "#e8912d", "colorName": "groups.g4" },
    { "id": "g5", "color": "#d62f2f", "colorName": "groups.g5" },
    { "id": "g6", "color": "#f2d02f", "colorName": "groups.g6" },
    { "id": "g7", "color": "#3aa757", "colorName": "groups.g7" },
    { "id": "g8", "color": "#2f4fd6", "colorName": "groups.g8" },
    { "id": "transit", "color": "#cfd2d6", "colorName": "groups.transit", "icon": "transit" },
    { "id": "utility", "color": "#b9a04a", "colorName": "groups.utility", "icon": "utility" }
  ],

  // Your two card piles:
  "decks": [
    { "id": "chance", "nameKey": "decks.chance", "icon": "question" },
    { "id": "chest",  "nameKey": "decks.chest",  "icon": "chest" }
  ],

  "players": { "min": 2, "max": 6 },

  // Buildings: 4 small ones then they become the big one. Rename via i18n (Step 5).
  "building": {
    "levels": 4,
    "smallKey": "building.small",
    "smallPluralKey": "building.smallPlural",
    "bigKey": "building.big"
  },

  // The economy. These defaults play like the classic game; tweak later if you like.
  "rules": {
    "startingMoney": 1500,
    "passStartBonus": 200,
    "rentStrategies": {
      "property": "buildingTable",   // rent from the rent[] table; x2 for a full unbuilt group
      "transit":  "ownedCountScale", // a station charges more the more of the 4 you own
      "utility":  "diceMultiplier"   // a service charges dice × multiplier
    },
    "transitRent": [25, 50, 100, 200],
    "utilityMultiplier": { "single": 4, "all": 10 },
    "holding": { "releaseCost": 50, "maxTurns": 3, "walk": false },
    "mortgageInterestRate": 10,
    "buildingShortage": true,
    "evenBuildRule": true,
    "auctionOnDecline": true,
    "freeParkingJackpot": false
  },

  // The player pieces (REQUIRED). Each needs a tokens/<id>.svg (Step 6).
  "tokens": [
    { "id": "circle",   "nameKey": "tokens.circle" },
    { "id": "square",   "nameKey": "tokens.square" },
    { "id": "triangle", "nameKey": "tokens.triangle" },
    { "id": "star",     "nameKey": "tokens.star" },
    { "id": "diamond",  "nameKey": "tokens.diamond" },
    { "id": "heart",    "nameKey": "tokens.heart" }
  ]
}
```

You mostly change: `id`, `name`, `author`, `currency`, `centerBrand`. The rest can stay.

---

## Step 3 — `board.json` (the 40 squares)

This is the ring the pieces walk. **You do not need to edit the numbers** — this is a
complete, sensible 40-square board. You only fill the *names* later (Step 5). Copy it as-is.

Here's how your **numbered list** maps onto it (board order = cheapest → priciest, same as
your list):

| Your list | Board squares | Group |
| --- | --- | --- |
| Streets 1–2 | 1, 3 | g1 |
| Streets 3–5 | 6, 8, 9 | g2 |
| Streets 6–8 | 11, 13, 14 | g3 |
| Streets 9–11 | 16, 18, 19 | g4 |
| Streets 12–14 | 21, 23, 24 | g5 |
| Streets 15–17 | 26, 27, 29 | g6 |
| Streets 18–20 | 31, 32, 34 | g7 |
| Streets 21–22 | 37, 39 | g8 |
| Stations 1–4 | 5, 15, 25, 35 | transit |
| Services 1–2 | 12, 28 | utility |

```jsonc
[
  { "id": 0,  "type": "start" },
  { "id": 1,  "type": "property", "group": "g1", "nameKey": "squares.1",  "price": 60,  "buildCost": 50,  "rent": [2, 10, 30, 90, 160, 250] },
  { "id": 2,  "type": "deck", "deck": "chest" },
  { "id": 3,  "type": "property", "group": "g1", "nameKey": "squares.3",  "price": 60,  "buildCost": 50,  "rent": [4, 20, 60, 180, 320, 450] },
  { "id": 4,  "type": "tax", "nameKey": "squares.4", "amount": 200 },
  { "id": 5,  "type": "transit", "group": "transit", "nameKey": "squares.5", "price": 200 },
  { "id": 6,  "type": "property", "group": "g2", "nameKey": "squares.6",  "price": 100, "buildCost": 50,  "rent": [6, 30, 90, 270, 400, 550] },
  { "id": 7,  "type": "deck", "deck": "chance" },
  { "id": 8,  "type": "property", "group": "g2", "nameKey": "squares.8",  "price": 100, "buildCost": 50,  "rent": [6, 30, 90, 270, 400, 550] },
  { "id": 9,  "type": "property", "group": "g2", "nameKey": "squares.9",  "price": 120, "buildCost": 50,  "rent": [8, 40, 100, 300, 450, 600] },
  { "id": 10, "type": "holding" },
  { "id": 11, "type": "property", "group": "g3", "nameKey": "squares.11", "price": 140, "buildCost": 100, "rent": [10, 50, 150, 450, 625, 750] },
  { "id": 12, "type": "utility", "group": "utility", "nameKey": "squares.12", "price": 150 },
  { "id": 13, "type": "property", "group": "g3", "nameKey": "squares.13", "price": 140, "buildCost": 100, "rent": [10, 50, 150, 450, 625, 750] },
  { "id": 14, "type": "property", "group": "g3", "nameKey": "squares.14", "price": 160, "buildCost": 100, "rent": [12, 60, 180, 500, 700, 900] },
  { "id": 15, "type": "transit", "group": "transit", "nameKey": "squares.15", "price": 200 },
  { "id": 16, "type": "property", "group": "g4", "nameKey": "squares.16", "price": 180, "buildCost": 100, "rent": [14, 70, 200, 550, 750, 950] },
  { "id": 17, "type": "deck", "deck": "chest" },
  { "id": 18, "type": "property", "group": "g4", "nameKey": "squares.18", "price": 180, "buildCost": 100, "rent": [14, 70, 200, 550, 750, 950] },
  { "id": 19, "type": "property", "group": "g4", "nameKey": "squares.19", "price": 200, "buildCost": 100, "rent": [16, 80, 220, 600, 800, 1000] },
  { "id": 20, "type": "freeparking" },
  { "id": 21, "type": "property", "group": "g5", "nameKey": "squares.21", "price": 220, "buildCost": 150, "rent": [18, 90, 250, 700, 875, 1050] },
  { "id": 22, "type": "deck", "deck": "chance" },
  { "id": 23, "type": "property", "group": "g5", "nameKey": "squares.23", "price": 220, "buildCost": 150, "rent": [18, 90, 250, 700, 875, 1050] },
  { "id": 24, "type": "property", "group": "g5", "nameKey": "squares.24", "price": 240, "buildCost": 150, "rent": [20, 100, 300, 750, 925, 1100] },
  { "id": 25, "type": "transit", "group": "transit", "nameKey": "squares.25", "price": 200 },
  { "id": 26, "type": "property", "group": "g6", "nameKey": "squares.26", "price": 260, "buildCost": 150, "rent": [22, 110, 330, 800, 975, 1150] },
  { "id": 27, "type": "property", "group": "g6", "nameKey": "squares.27", "price": 260, "buildCost": 150, "rent": [22, 110, 330, 800, 975, 1150] },
  { "id": 28, "type": "utility", "group": "utility", "nameKey": "squares.28", "price": 150 },
  { "id": 29, "type": "property", "group": "g6", "nameKey": "squares.29", "price": 280, "buildCost": 150, "rent": [24, 120, 360, 850, 1025, 1200] },
  { "id": 30, "type": "sendtoholding" },
  { "id": 31, "type": "property", "group": "g7", "nameKey": "squares.31", "price": 300, "buildCost": 200, "rent": [26, 130, 390, 900, 1100, 1275] },
  { "id": 32, "type": "property", "group": "g7", "nameKey": "squares.32", "price": 300, "buildCost": 200, "rent": [26, 130, 390, 900, 1100, 1275] },
  { "id": 33, "type": "deck", "deck": "chest" },
  { "id": 34, "type": "property", "group": "g7", "nameKey": "squares.34", "price": 320, "buildCost": 200, "rent": [28, 150, 450, 1000, 1200, 1400] },
  { "id": 35, "type": "transit", "group": "transit", "nameKey": "squares.35", "price": 200 },
  { "id": 36, "type": "deck", "deck": "chance" },
  { "id": 37, "type": "property", "group": "g8", "nameKey": "squares.37", "price": 350, "buildCost": 200, "rent": [35, 175, 500, 1100, 1300, 1500] },
  { "id": 38, "type": "tax", "nameKey": "squares.38", "amount": 100 },
  { "id": 39, "type": "property", "group": "g8", "nameKey": "squares.39", "price": 400, "buildCost": 200, "rent": [50, 200, 600, 1400, 1700, 2000] }
]
```

**Why the `rent` array has 6 numbers:** `[base, 1 building, 2, 3, 4 buildings, big building]`.
With `building.levels = 4`, that's 4 small levels + the big one + the base rent = 6 entries.
(If you change `levels`, the array length must be `levels + 2`.)

---

## Step 4 — `cards.json` (the two decks)

A few cards per pile. The **effect** is what the engine does (it can't invent new ones —
see the [effect catalog](../CORRO_FORMAT.md#cardsjson)); the **text** is yours (by key).
Start with these and add more later.

```jsonc
[
  { "id": "c1", "deck": "chance", "textKey": "cards.c1", "effect": { "type": "moveTo", "target": 0, "collectPass": true } },
  { "id": "c2", "deck": "chance", "textKey": "cards.c2", "effect": { "type": "moveTo", "target": "nearest:transit", "rentMultiplier": 2 } },
  { "id": "c3", "deck": "chance", "textKey": "cards.c3", "effect": { "type": "money", "amount": -50 } },
  { "id": "c4", "deck": "chance", "textKey": "cards.c4", "effect": { "type": "sendToHolding" } },
  { "id": "c5", "deck": "chance", "textKey": "cards.c5", "effect": { "type": "grantReleasePass" } },

  { "id": "h1", "deck": "chest", "textKey": "cards.h1", "effect": { "type": "money", "amount": 100 } },
  { "id": "h2", "deck": "chest", "textKey": "cards.h2", "effect": { "type": "collectFromEach", "amount": 20 } },
  { "id": "h3", "deck": "chest", "textKey": "cards.h3", "effect": { "type": "money", "amount": -100 } },
  { "id": "h4", "deck": "chest", "textKey": "cards.h4", "effect": { "type": "moveBy", "steps": -3 } },
  { "id": "h5", "deck": "chest", "textKey": "cards.h5", "effect": { "type": "grantReleasePass" } }
]
```

---

## Step 5 — `i18n/en.json` and `i18n/es.json` (the names — including your streets!)

This is where **your city goes in.** Every `nameKey` above resolves here. Replace each
`<< … >>` placeholder with a name from your numbered list.

`i18n/en.json`:

```jsonc
{
  "currency": { "name": "euros" },
  "terminology": {
    "start": "Town Square",
    "holding": "Town Hall Waiting Room",
    "freeparking": "City Park",
    "sendtoholding": "Report to Town Hall!"
  },
  "building": { "small": "house", "smallPlural": "houses", "big": "hotel" },
  "groups": {
    "g1": "Old Town", "g2": "Riverside", "g3": "Market District", "g4": "The Docks",
    "g5": "Midtown", "g6": "University Quarter", "g7": "The Heights", "g8": "Grand Avenue",
    "transit": "Stations", "utility": "Utilities"
  },
  "decks": { "chance": "Town Hall", "chest": "Local News" },
  "tokens": {
    "circle": "Circle", "square": "Square", "triangle": "Triangle",
    "star": "Star", "diamond": "Diamond", "heart": "Heart"
  },
  "squares": {
    "1":  "<< street #1 >>",  "3":  "<< street #2 >>",
    "6":  "<< street #3 >>",  "8":  "<< street #4 >>",  "9":  "<< street #5 >>",
    "11": "<< street #6 >>",  "13": "<< street #7 >>",  "14": "<< street #8 >>",
    "16": "<< street #9 >>",  "18": "<< street #10 >>", "19": "<< street #11 >>",
    "21": "<< street #12 >>", "23": "<< street #13 >>", "24": "<< street #14 >>",
    "26": "<< street #15 >>", "27": "<< street #16 >>", "29": "<< street #17 >>",
    "31": "<< street #18 >>", "32": "<< street #19 >>", "34": "<< street #20 >>",
    "37": "<< street #21 >>", "39": "<< street #22 >>",
    "5":  "<< station #1 >>", "15": "<< station #2 >>", "25": "<< station #3 >>", "35": "<< station #4 >>",
    "12": "<< service #1 >>", "28": "<< service #2 >>",
    "4":  "City Tax", "38": "Luxury Tax"
  },
  "cards": {
    "c1": "Head back to the Town Square and collect your pass bonus.",
    "c2": "Take the next train — pay double the fare when you arrive.",
    "c3": "Parking fine: pay 50.",
    "c4": "A permit problem sends you straight to the Town Hall Waiting Room.",
    "c5": "Priority appointment: keep this release pass until you need it.",
    "h1": "You win the local lottery: collect 100.",
    "h2": "It's your birthday: collect 20 from each player.",
    "h3": "Hospital bill: pay 100.",
    "h4": "You forgot your umbrella — go back 3 spaces.",
    "h5": "Community service credit: keep this release pass until you need it."
  }
}
```

For `i18n/es.json`: **copy the file and translate the fixed words** (currency, terminology,
groups, buildings, tokens, decks, cards). You can translate the street names or leave them
in your language — but **both files must define the same keys** (an automated check fails
the build otherwise; a street present in only one locale is fine — it falls back). If you
only speak one language, it's OK to copy the same values into both for now.

---

## Step 6 — `tokens/` (the player pieces, required)

Every board must ship its own pieces — the engine has none built in. Each token in the
manifest needs a `tokens/<id>.svg`. The loader keeps **only the `<path>` shape** and
sanitises it, so draw your tokens as a single path (in any editor: draw, then "flatten to
path"). Here are six ready-to-use ones — copy each into `tokens/<id>.svg`:

`tokens/circle.svg`
```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 3 A9 9 0 1 0 12.1 3 z"/></svg>
```
`tokens/square.svg`
```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M4 4 L20 4 L20 20 L4 20 z"/></svg>
```
`tokens/triangle.svg`
```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 3 L21 20 L3 20 z"/></svg>
```
`tokens/star.svg`
```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2 L14.9 8.6 L22 9.3 L16.7 14.1 L18.2 21.2 L12 17.5 L5.8 21.2 L7.3 14.1 L2 9.3 L9.1 8.6 z"/></svg>
```
`tokens/diamond.svg`
```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 2 L20 12 L12 22 L4 12 z"/></svg>
```
`tokens/heart.svg`
```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M12 21 C5 15 3 10 6 7 C9 4 12 7 12 8 C12 7 15 4 18 7 C21 10 19 15 12 21 z"/></svg>
```

To make **themed** pieces (a tram, a landmark, a local mascot), draw them in a vector editor,
flatten to a single `<path>`, and drop the SVG in with a matching `tokens/<id>.svg` +
manifest entry + `tokens.<id>` name.

---

## Step 7 — `help.en.md` (optional, but nice)

A short rules / flavour page shown behind the F1 / Help button. Just markdown:

```markdown
# My City

Race around the streets of the city, buy them up, and charge rent when rivals land on
yours! Complete a whole colour group to build, and drive everyone else into bankruptcy.

Roll the dice, land, and buy or pay. Land on a **card square** to draw from the Town Hall
or Local News. Three doubles in a row and you're off to the Police Station!
```

(Add `help.es.md` too if you want it in Spanish.)

---

## Step 8 — Load it and play

The server reads `server/Packages/` from disk, so your folder is picked up **without
committing anything** — it's your private board until you decide to share it.

1. Start the server (see the repo [README](../README.md) — `tools/dev.ps1`, or
   `dotnet run` in `server/`).
2. Open the app, go to **Create game**, and pick **My City** from the board list.
3. Choose your token, add a friend or a bot, and start. That's your city on the board.

To hand the board to someone else as a single file, zip it into a `.corro` (there's a
`tools/pack-corro.ps1` helper) and they upload it in the lobby.

---

## Step 9 — If something doesn't work

The server **validates** your package when it loads and rejects it with a clear message.
The common ones:

- **"square N (type 'property') has no name"** — a property/transit/utility/tax square is
  missing its `nameKey`, or the key isn't in `squares` in your i18n. Every ownable square
  must be named.
- **"key 'squares.N' resolves in no locale"** — you referenced a name that isn't defined in
  *any* `i18n/*.json`. Add it (a placeholder counts).
- **"token 'x' has no icon"** — a manifest token is missing its `tokens/x.svg`.
- **"gameType '…' is not supported"** — check `"gameType": "property"` is spelled exactly.
- **The board isn't in the lobby list** — the folder isn't under `server/Packages/`, or the
  `manifest.json` failed to parse (a stray comma? a missing quote?). Validate your JSON.

Partial translations are fine (a name in one locale falls back). A key referenced but
defined in **no** locale is the only i18n error that stops you.

---

## What next

- **Tweak the economy**: prices, rents, `startingMoney`, `passStartBonus`, holding `releaseCost`,
  building costs. It's all in `manifest.json` + `board.json`.
- **Add sounds**: drop a `sounds/pack.json` and `.ogg` files to give your city its own
  audio — see the sounds section of [CORRO_FORMAT.md](../CORRO_FORMAT.md#sounds-optional).
- **Rewrite the voice**: override any spoken line (e.g. the "three doubles → holding" message)
  by adding a `game` object to your i18n — see
  [Engine announcements](../CORRO_FORMAT.md#engine-announcements-overridable).
- **Other genres**: the same package idea builds race, track and the card games — each has
  its own section in [CORRO_FORMAT.md](../CORRO_FORMAT.md).

Have fun turning your neighbourhood into a board. 🎲
