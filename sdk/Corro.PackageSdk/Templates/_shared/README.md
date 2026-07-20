# Corro starter package

This folder is a complete, valid game created from a neutral family template. It is intentionally small: replace its names, rules, cards or board with your own design while preserving the family interaction model.

First package? Follow the [English beginner guide](https://github.com/kastwey/corro/blob/main/docs/package-authoring.md) or the [Spanish guide](https://github.com/kastwey/corro/blob/main/docs/package-authoring.es.md).

## Authoring loop

1. Edit `manifest.json` and the family content in `board.json`, `cards.json` or `questions.*.json`.
2. Keep every player-facing string in both `i18n/en.json` and `i18n/es.json`.
3. Optional card art belongs in `cards/<card-id>.svg` (64×64, path geometry only). A card may add `artColor: "#RRGGBB"`; missing art uses Corro's neutral fallback. Never put package-specific drawings in engine code.
4. Update `CREDITS.md` for every art or sound asset you add.
5. Rewrite both help files, including the screen-reader section.
6. Validate after each meaningful change.
7. Pack only when validation succeeds.

```text
corro-package validate .
corro-package inspect .
corro-package pack . --output ../my-game.corro
```

Open this generated folder as the VS Code workspace root. Its `.vscode` folder associates the included schemas with the package files for completion and early editing feedback. Schemas are guidance; `corro-package validate` is authoritative because it executes the real engine validators.

See the Corro package format and family documentation for every supported field and mechanic. A package can configure known mechanics but cannot invent a new turn model; that belongs in a new engine family.
