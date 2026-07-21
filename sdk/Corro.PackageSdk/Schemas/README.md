# Corro package schemas

These JSON Schema 2020-12 documents provide editor completion and catch basic shape/type mistakes:

- `manifest.schema.json` covers common fields and all nine family rule blocks;
- `board.schema.json` contains a definition for each board-based family;
- `cards.schema.json` contains one deck definition per card family;
- `questions.schema.json` covers locale-specific trivia decks;
- `i18n.schema.json` accepts nested translation objects with string leaves.

`corro-package new` copies the schemas locally and writes family-specific VS Code associations using schema fragments such as `#/$defs/journeyDeck`. This avoids applying journey fields to an assembly deck even though both files are named `cards.json`.

For every card object, the `id` completion/hover documents the optional sibling-art convention:
`assets/cards/<id>.svg`, fixed `viewBox="0 0 64 64"`, path geometry only. Art is intentionally **not** an
`svg` JSON property, so `additionalProperties: false` flags that mistake in the editor. The actual
SVG file is checked by the production validator; JSON Schema cannot validate sibling-file contents.
The optional `artColor` property is the one visual field that does belong in JSON: completion
requires a safe `#RRGGBB` value used for the frame/silhouette, never as the sole semantic channel.

Schemas are intentionally not the final authority. Some constraints depend on relationships between files or engine behavior: referenced groups, sufficient deck size, exact board topology, known house-rule codes and complete translation keys. Always run `corro-package validate`, which uses the production loader and current family validators.
