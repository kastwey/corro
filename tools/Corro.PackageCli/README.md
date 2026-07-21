# Corro Package SDK

The package SDK checks and builds `.corro` games without starting the web server. It calls the
**same C# loader, family validators and content validator as Corro itself**, so a package accepted
here follows the same rules as an upload.

Requires the [.NET 10 SDK](https://dot.net/download).

If this is your first package, follow the [beginner guide](../../docs/package-authoring.md)
([Spanish guide](../../docs/package-authoring.es.md)) rather than reading the command reference
in isolation.

## Create a starter package

```powershell
dotnet run --project tools/Corro.PackageCli -p:SkipFrontendBuild=true -- new journey games/my-journey --id my-journey --name-en "My Journey" --name-es "Mi viaje" --author "Your name"
```

`new` supports `property`, `race`, `track`, `journey`, `assembly`, `draft`, `shedding`,
`exploding` and `trivia`. Every template is neutral, original, bilingual and immediately valid.
The destination must be absent or empty; the command never overwrites an author's files.

The generated project contains:

- the smallest useful board/deck for its family;
- one optional `assets/cards/<card-id>.svg` example in every card-bearing starter;
- two original geometric tokens;
- English and Spanish translations and help guides;
- local JSON schemas plus VS Code associations;
- a `CREDITS.md` seeded with the licence of the neutral SVG examples;
- an authoring README.

The package id defaults to a safe slug derived from the destination folder. Use `--json` for a
machine-readable result.

## Validate

```powershell
dotnet run --project tools/Corro.PackageCli -p:SkipFrontendBuild=true -- validate path/to/my-game

dotnet run --project tools/Corro.PackageCli -p:SkipFrontendBuild=true -- validate path/to/my-game.corro --json
```

Validation includes:

- safe extraction and archive limits;
- the package structure required by its game family;
- known card effects and house rules;
- player, token, deck and board coherence;
- translation references;
- optional card-art filenames, 64×64 canvas, path geometry and size limits;
- family-specific playability checks.

The command returns `0` when valid and `1` when package validation fails.

## Inspect

```powershell
dotnet run --project tools/Corro.PackageCli -p:SkipFrontendBuild=true -- inspect path/to/my-game
```

This prints identity, family, supported players, locales and family-specific content counts,
including `cardIllustrations`. A hidden package is reported as hidden, but its `unlockCode` is
deliberately never printed or included in JSON.

## Optional card illustrations

For any card declared in `cards.json`, place optional art at `assets/cards/<card-id>.svg`. Use
`viewBox="0 0 64 64"` and flatten the drawing to `<path>` elements. Do not add an `svg` property
to JSON: the schema and validator reject that form and point to the file convention. Packages that
omit an illustration receive Corro's neutral mechanic-based drawing. `inspect` reports how many
card definitions have package art, and `pack` preserves those SVG files in the archive.

An optional `"artColor": "#2F7185"` in the card definition supplies the package-owned accent for
the frame and silhouette. Validation accepts only full `#RRGGBB` values. Colour is supplementary;
the localized name/help must still identify the card without sight.

## Pack

```powershell
dotnet run --project tools/Corro.PackageCli -p:SkipFrontendBuild=true -- pack path/to/my-game

dotnet run --project tools/Corro.PackageCli -p:SkipFrontendBuild=true -- pack path/to/my-game --output artifacts/my-game.corro
```

`pack` refuses an invalid package. It creates a reproducible archive with stable file ordering and
timestamps, enforces the server's upload limits, reloads the result through the secure zip extraction
path, and only then atomically replaces the destination. It prints the final byte count and SHA-256.
The output must be outside the source folder so the archive cannot include itself.

## Machine-readable output

Every command accepts `--json`. Human-readable diagnostics go to standard error only for command or
file-system failures; JSON mode emits one structured JSON document to standard output.

## Exit codes

| Code | Meaning |
| ---: | --- |
| `0` | Success, or package valid |
| `1` | Package invalid |
| `2` | Invalid command or options |
| `3` | Missing/inaccessible path or another file-system error |

For the package format and family catalog, see [CORRO_FORMAT.md](../../CORRO_FORMAT.md). The
property-family walkthrough is [docs/tutorial-city-board.md](../../docs/tutorial-city-board.md).
