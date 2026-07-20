# Corro Package SDK

This directory is the reusable package-authoring layer. Its first milestone deliberately focuses on
the operations that must never drift from the engine:

- validate a folder or `.corro` archive with the production loader and every family validator;
- inspect safe metadata without exposing hidden-package unlock codes;
- create deterministic, upload-compatible archives and round-trip them through secure extraction.
- generate a neutral, bilingual and valid starter project for every supported family;
- provide local JSON schemas and VS Code associations for early authoring feedback.

The .NET API lives in [Corro.PackageSdk](Corro.PackageSdk/) and the command-line interface in
[tools/Corro.PackageCli](../tools/Corro.PackageCli/README.md).
Schema scope and limitations are documented in
[Corro.PackageSdk/Schemas](Corro.PackageSdk/Schemas/README.md).

## Starter templates and reference packages

Run `corro-package new <family> <folder>` to create the neutral starter. These distributable packages
remain richer executable examples of each supported interaction model:

| Family | Reference package |
| --- | --- |
| `property` | [Imperio Galáctico](../server/Packages/imperio-galactico/) |
| `race` | [Carrera Galáctica](../server/Packages/carrera-galactica/) |
| `track` | [Escaleras y serpientes](../server/Packages/escaleras-y-serpientes/) |
| `journey` | [La Gran Ruta](../server/Packages/la-gran-ruta/) |
| `assembly` | [Taller Galáctico](../server/Packages/taller-galactico/) |
| `draft` | [Gran Tapeo](../server/Packages/gran-tapeo/) |
| `shedding` | [Cuatro Colores](../server/Packages/cuatro-colores/) |
| `exploding` | [La Mina](../server/Packages/la-mina/) |
| `trivia` | [La Rueda del Saber](../server/Packages/la-rueda-del-saber/) |

Templates and examples supplement, but do not replace, the normative
[package format](../CORRO_FORMAT.md). Schemas provide completion and early feedback; validation
remains authoritative because it executes the current engine and family rules.

## Security boundary

The SDK references the server assembly to reuse its rules, but its build output is scrubbed of
server packages, sounds, web assets and static-web-assets metadata. Build targets fail if any of
those deployable trees remain. This matters for maintainers who keep private, gitignored packages
under `server/Packages/`: building or distributing the CLI must never copy them.
