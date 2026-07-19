# Corro Package SDK

This directory is the reusable package-authoring layer. Its first milestone deliberately focuses on
the operations that must never drift from the engine:

- validate a folder or `.corro` archive with the production loader and every family validator;
- inspect safe metadata without exposing hidden-package unlock codes;
- create deterministic, upload-compatible archives and round-trip them through secure extraction.

The .NET API lives in [Corro.PackageSdk](Corro.PackageSdk/) and the command-line interface in
[tools/Corro.PackageCli](../tools/Corro.PackageCli/README.md).

## Reference packages by family

Until neutral starter templates are added, these distributable packages are the executable examples
for each supported interaction model:

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

These examples supplement, but do not replace, the normative [package format](../CORRO_FORMAT.md).
Neutral templates and editor schemas belong in the next author-experience milestone; validation
remains authoritative even after schemas are introduced.

## Security boundary

The SDK references the server assembly to reuse its rules, but its build output is scrubbed of
server packages, sounds, web assets and static-web-assets metadata. Build targets fail if any of
those deployable trees remain. This matters for maintainers who keep private, gitignored packages
under `server/Packages/`: building or distributing the CLI must never copy them.
