# Create your first Corro package

[Leer en español](package-authoring.es.md)

This guide takes you from an idea to an uploadable `.corro` game. It assumes that you can open a
terminal and edit text files, but **it does not assume that you know C#, TypeScript or web
programming**. A package is data: JSON, translations, Markdown help and SVG assets.

If you already know the format, use the [complete format reference](../CORRO_FORMAT.md) instead.

## What you need

For creating, checking and packing a game you only need:

1. The [.NET 10 SDK](https://dotnet.microsoft.com/download/dotnet/10.0).
2. A copy of this repository, downloaded as a ZIP or cloned with Git.
3. A text editor. [Visual Studio Code](https://code.visualstudio.com/) is recommended because every
   generated project includes completion and validation schemas.

You do **not** need Node.js, Docker, Azure or a database to create and pack a package. Those are only
needed for some ways of running the complete Corro server locally. You can upload the resulting file
directly to [imperio.kastwey.org](https://imperio.kastwey.org), Corro's public server, where updates
from this repository are deployed automatically.

## The short version

From the repository root, run these four commands:

```bash
# 1. Create a valid two-player starter.
dotnet run --project tools/Corro.PackageCli -p:SkipFrontendBuild=true -- new track games/my-first-game --id my-first-game --name-en "My First Game" --name-es "Mi primer juego" --author "Your name"

# 2. Check it after editing.
dotnet run --project tools/Corro.PackageCli -p:SkipFrontendBuild=true -- validate games/my-first-game

# 3. Review what the engine understood.
dotnet run --project tools/Corro.PackageCli -p:SkipFrontendBuild=true -- inspect games/my-first-game

# 4. Create the file to upload.
dotnet run --project tools/Corro.PackageCli -p:SkipFrontendBuild=true -- pack games/my-first-game --output artifacts/my-first-game.corro
```

The starter is valid immediately. The rest of this guide explains what to change without breaking it.

## Step 1: choose the closest family

A **family** is the interaction model implemented by the engine. Choose the family whose turn and
player decisions already resemble your idea; names and theme do not matter.

| Family | Choose it when your game… | Main file to customize | Difficulty |
| --- | --- | --- | --- |
| `property` | rolls around an economy board, buying groups, building and trading | `board.json`, then `cards.json` | Advanced |
| `race` | moves several pieces around a circuit, with captures and a final corridor | `board.json` | Medium |
| `track` | moves one piece along a path with forward/backward landing effects | `board.json` | Easiest |
| `journey` | plays distance, attack, remedy and permanent-immunity cards | `cards.json` | Medium |
| `assembly` | collects coloured pieces while rivals damage and you repair them | `cards.json` | Medium |
| `draft` | has everyone pick secretly, reveal together and rotate hands | `cards.json` | Advanced |
| `shedding` | matches the discard by colour, number or action and tries to empty a hand | `cards.json` | Easy |
| `exploding` | plays actions, then draws against elimination and reaction cards | `cards.json` | Medium |
| `trivia` | moves around a six-category wheel and answers questions | `questions.en.json` and `questions.es.json` | Medium |

For a first experiment, `track` or `shedding` is the shortest route. Use `property` only if the
economy, auctions, sets and construction are genuinely part of your game.

If the core turn does not fit any row, a package probably cannot express it yet. See
[When a package is not enough](#when-a-package-is-not-enough).

## Step 2: generate the project

Replace the family, destination, id, names and author in this example:

```bash
dotnet run --project tools/Corro.PackageCli -p:SkipFrontendBuild=true -- new journey games/my-journey --id my-journey --name-en "My Journey" --name-es "Mi viaje" --author "Your name"
```

The package id:

- uses lowercase letters, digits, hyphens or underscores;
- must remain stable after sharing the game;
- is not player-facing, so it does not need translation.

The English and Spanish names are player-facing. They live together in `manifest.json`; Corro shows
the right one for the current language.

The command refuses to overwrite a non-empty folder. This is deliberate protection against losing
an existing game.

## Step 3: open the generated folder

Open the newly generated package folder itself in VS Code: **File → Open Folder**. Do not open only
an individual JSON file.

The `.vscode` folder then connects each file to its local schema. As you type, VS Code suggests known
fields and underlines obvious type or spelling errors. The schemas are useful feedback, but
`validate` remains authoritative because it executes the real engine rules and checks relationships
between files.

Do not edit `.vscode/schemas` when designing the game. They describe Corro, not your content. They
are authoring aids and are automatically left out of the packed `.corro` file.

## Step 4: understand the generated files

| Path | Purpose | Start here? |
| --- | --- | --- |
| `manifest.json` | Identity, family, player count, rules and token list | Yes |
| `board.json` | Spatial layout for `property`, `race`, `track` and `trivia` | Depends on family |
| `cards.json` | Cards for `property` and the five card families | Depends on family |
| `cards/*.svg` | Optional illustration for a card with the matching id | Later |
| `questions.en.json`, `questions.es.json` | Real question banks for `trivia` | Trivia only |
| `i18n/en.json`, `i18n/es.json` | Names and text referenced by keys | Yes |
| `tokens/*.svg` | Player-piece geometry | Later |
| `CREDITS.md` | Sources and redistribution licences for art and sounds | Before sharing |
| `help.en.md`, `help.es.md` | F1 rules and screen-reader instructions | Before sharing |
| `README.md` | Short authoring checklist for this generated project | Read it |
| `.vscode/` | Local schemas and editor settings | Leave it alone |

Card families do not have a `board.json`. That is expected. `race` and `track` do not need a
`cards.json`. Do not create files merely because another family has them.

Every starter supports exactly two players so it stays small and easy to understand. To support
more players, increase `players.max`, add enough distinct tokens or seats, and expand card decks when
necessary. Run `validate`: it reports the exact capacity requirement for that family.

## Step 5: make the first safe edits

Change one kind of content at a time and validate after each step.

### Identity

Open `manifest.json` and review:

- `id`: stable technical identity;
- `name.en` and `name.es`: localized display names;
- `author` and `version`;
- `players.min` and `players.max`;
- the family rules block, such as `trackRules` or `journeyRules`.

Do not rename field names such as `gameType` or `players`; change their values.

### Names and text

Most content files contain references such as:

```json
{ "id": "step25", "nameKey": "cards.step25" }
```

The actual words live in both locale files:

```json
{
  "cards": {
    "step25": "Advance 25 units"
  }
}
```

The same key must resolve in at least one locale, and a package intended for both languages should
translate it in both. Keep the key stable and translate the value. Never put a secret such as an
unlock code in translations: translations are sent to browsers.

### Board, cards or questions

Use the family table above to find the main content file. Start by renaming existing neutral items.
Then change values or counts. Only after that should you add or remove entries.

The template deliberately demonstrates each family's essential mechanics. Compare it with the
richer reference package listed in the [SDK reference table](../sdk/README.md#starter-templates-and-reference-packages)
when you need a realistic example.

### Optional card drawings

Every card works without an image: Corro shows a neutral drawing based on its generic mechanic.
To replace it, add `cards/<card-id>.svg`; for example, card id `step25` uses
`cards/step25.svg`. Do not add an `svg` field to `cards.json`.

Use a `viewBox="0 0 64 64"` and flatten the drawing to `<path>` geometry. The package loader
discards colours and all other SVG markup for security; the card frame supplies a readable colour.
The picture is decorative — the localized card name and help remain the accessible information.
Run `validate`: a misspelled filename, an SVG without a usable path or oversized art is rejected
instead of being silently ignored.

Optionally add `"artColor": "#2F7185"` to that card in `cards.json` to colour its frame and
silhouette. It must be a complete `#RRGGBB` value. Treat this as a visual aid only: names and help
must still say the card's colour or identity.

## A tiny JSON survival guide

JSON is strict text notation:

- words need double quotes: `"name": "My game"`;
- properties are separated by commas;
- objects use `{ }` and lists use `[ ]`;
- numbers and `true`/`false` are not quoted;
- every opening brace or bracket needs a closing one.

If VS Code underlines a line, hover over it before continuing. If `validate` reports `Invalid JSON`,
it includes a line and byte position. Fix that syntax error first; later validation errors may be a
consequence of it.

## Step 6: keep the game accessible and bilingual

Corro is accessibility-first. Do not delete the screen-reader section from either help file. Rewrite
it so it describes your actual game:

- where keyboard focus normally lives;
- what the arrow keys explore;
- how a player performs the turn;
- what `S`, `Shift+S` or other family status keys announce;
- that `F6`/`Shift+F6` cycle game areas;
- that `Ctrl+Shift+R` opens chat and focuses the message box;
- which events are announced automatically.

Avoid instructions that rely only on sight, such as “press the red button” or “move to the icon on
the left.” Name the action and information instead. The generated family guide is a truthful
starting point, not placeholder prose.

Keep `help.en.md` and `help.es.md` equivalent. Also keep composed labels and announcements as flowing
sentences rather than visual separators. Read the [accessibility architecture](accessibility.md) if
you add complex terminology.

## Step 7: validate often

Run this from the repository root:

```bash
dotnet run --project tools/Corro.PackageCli -p:SkipFrontendBuild=true -- validate games/my-first-game
```

`VALID` means the same production loader and family validators used by the server accepted the
package. A schema warning may be useful, but only this command proves engine conformance.

Use `inspect` to check what Corro understood:

```bash
dotnet run --project tools/Corro.PackageCli -p:SkipFrontendBuild=true -- inspect games/my-first-game
```

It shows family, names, locales, players, token count and family-specific content counts. For a
hidden package it says `Hidden: yes` but never prints the unlock code.

## Common errors in plain language

| Message contains… | Meaning | What to check |
| --- | --- | --- |
| `Invalid JSON (line …)` | The file has broken JSON syntax | Quotes, commas and matching braces near that line |
| `resolves in no locale` | A `nameKey`/`textKey` has no text | Add the same dotted key under `i18n/en.json` and `i18n/es.json` |
| `token … has no icon` | A listed token has no usable SVG path | Check the id and corresponding `tokens/<id>.svg` file |
| `card illustration …` | An optional card SVG is malformed, oversized or names no card | Match `cards/<id>.svg` to a `cards.json` id and flatten it to paths |
| `unknown type` or `unknown effect` | The package names a mechanic the family does not implement | Use an option suggested by the schema or format reference |
| `deck … is too small` | The largest supported table cannot be dealt | Add card copies, reduce hand size or lower `players.max` |
| `players.max … tokens/seats` | More players are allowed than distinct pieces/seats exist | Add tokens/seats or lower `players.max` |
| `Destination folder is not empty` | `new` is protecting existing files | Choose an empty/new folder; it never force-overwrites |
| `output archive must be outside` | The archive would include itself | Put the `.corro` beside, not inside, the package folder |

Copy the **complete** validation message when asking for help; it is designed to identify the field,
card or square involved.

## Step 8: pack and upload

When validation is green:

```bash
dotnet run --project tools/Corro.PackageCli -p:SkipFrontendBuild=true -- pack games/my-first-game --output artifacts/my-first-game.corro
```

`pack` validates first, creates a deterministic archive, extracts it through the server's secure
upload path and validates it again before replacing the destination. It prints the size and SHA-256.

Open [imperio.kastwey.org](https://imperio.kastwey.org), Corro's public server, choose **Create game**,
then use **upload a game (.corro)** and select the file. Uploading does not install the package in the
server's public game catalog. It is staged for the game being created; the server may retain its bytes
so that game can be restored later.

For local self-hosting, an administrator may instead place the unpacked package under
`server/Packages/`. That is an advanced deployment choice; it is not required for ordinary authors.

## Original work and redistribution

You may privately experiment with any package your local laws permit. A package proposed for this
public repository must use original, public-domain or properly licensed names, text, art and sounds.
Do not submit a reproduction of a commercial game, even if the rules are familiar. Give it its own
title, terminology and visual identity. See [contribution rules](../CONTRIBUTING.md#contributing-a-game-package).

## When a package is not enough

A package configures mechanics already implemented by its family. It cannot introduce a completely
new turn model, hidden-information policy or interactive surface.

You probably need an engine-family proposal when your game requires, for example:

- a turn sequence unlike every existing family;
- secret information visible to a custom subset of players;
- a new kind of board or hand interaction;
- decisions or reactions the family cannot represent with existing card types;
- custom retirement, restore or bot behavior.

Before writing engine code, open an issue describing the player decisions and turn flow. Often the
smallest solution is a reusable declarative effect in an existing family rather than a new family or
a scripting language. See [game-family design](game-families.md#package-or-new-family).

## Where to look next

- [Spanish beginner guide](package-authoring.es.md)
- [Property-board tutorial](tutorial-city-board.md)
- [Package format reference](../CORRO_FORMAT.md)
- [CLI reference](../tools/Corro.PackageCli/README.md)
- [Schema scope and limitations](../sdk/Corro.PackageSdk/Schemas/README.md)
- [Reference packages by family](../sdk/README.md#starter-templates-and-reference-packages)
- [Contribution and licensing rules](../CONTRIBUTING.md#contributing-a-game-package)
