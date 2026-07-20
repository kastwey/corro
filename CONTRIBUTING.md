# Contributing

Thanks for your interest in improving this project! Contributions of all sizes are
welcome — bug reports, documentation fixes, accessibility improvements, new features,
and board packages.

There are two main ways to contribute.

## 1. Open an issue

Use the project's **GitHub Issues** page to:

- **Report a bug.** Include what you did, what you expected, what happened, and (if you
  can) steps to reproduce, your OS/browser, and any relevant console or server output.
- **Request a feature or change.** Describe the problem you're trying to solve, not just
  the solution you have in mind — it helps us find the best fit.
- **Ask a question** about the architecture or how something works.

A quick search first avoids duplicates. Small, focused issues are easier to act on than
large catch-all ones.

## 2. Open a pull request

For code and documentation changes:

1. **Fork** the repository and create a branch from `main`
   (e.g. `fix/auction-timeout`, `feat/spectator-mode`).
2. **Set up your environment** — see
   [Getting started (local)](README.md#getting-started-local) in the README. The
   quick mode (no Azure) is enough for almost everything.
3. **Make your change**, following the project conventions (see below).
4. **Add tests.** Every change ships with tests; a bug fix should come with a test that
   fails before the fix and passes after it.
5. **Run the checks locally** and make sure they're green:

   ```bash
   # Frontend
   cd frontend && npm run build && npm test

   # Backend
   dotnet build server/CorroServer.csproj -p:SkipFrontendBuild=true
   dotnet test  server.tests/CorroServer.Tests.csproj

   # End to end (when your change touches a flow it covers: lobby, trades,
   # purchases, auctions, announcements) — run from e2e/, not the repo root
   cd e2e && npm test
   ```

6. **Open the PR** against `main` with a clear description of *what* changed and *why*.
   Link any related issue. Keep PRs focused — one logical change per PR reviews faster.

### Project conventions

The essentials are:

- **The server owns the game's "voice."** Rules announce via `context.Announce(...)`; client
  handlers only drive visuals — never hardcode game narration in the client.
- **Accessibility is a feature, not a nice-to-have.** Keyboard navigation, ARIA live
  regions, native `<dialog>` modals, and semantic HTML are required. Never use the
  `disabled` attribute (use `aria-disabled` with a reason).
- **Internationalisation parity.** Every user-facing string must be translated in **both**
  `en.json` and `es.json` (including the `_self` variant of any announcement).
- **Leave no dead code.** Remove what your change makes obsolete, in the same change.

## Contributing a game package

Every game is a `.corro` package (board or deck, pieces, translations and sounds).
If you have not made one before, follow the [beginner guide](docs/package-authoring.md)
([español](docs/package-authoring.es.md)) before using the format reference.
We'd love more packages, but there's an important rule about
which ones can be **bundled into this repository**:

- **Only content that is free to distribute.** A package you submit for inclusion must be
  your own original work, or material under a licence (or in the public domain) that
  clearly allows redistribution.
- **No reproductions of existing games.** Please don't submit packages that recreate a
  copyrighted or trademarked game — its layout, names, card texts,
  artwork, or overall look — even as a "clone" or "tribute." Those cannot be accepted.
- **Every bundled board is reviewed and approved individually**, at the maintainer's
  discretion, before it's added to the repository. Inclusion is not automatic and may be
  declined; the goal is to keep the public project unambiguously clean.

None of this limits what you can do **privately**: the engine treats uploaded and shipped
packages identically, so you can build any game and load it at runtime (upload a `.corro`,
or drop it under `server/Packages/` on your own machine) without submitting it. The review
above applies only to boards meant to ship in the public repository.

Before sharing or testing a package in the lobby, run the same validation as the server:

```bash
dotnet run --project tools/Corro.PackageCli -p:SkipFrontendBuild=true -- new property path/to/my-game
dotnet run --project tools/Corro.PackageCli -p:SkipFrontendBuild=true -- validate path/to/my-game
dotnet run --project tools/Corro.PackageCli -p:SkipFrontendBuild=true -- inspect path/to/my-game
dotnet run --project tools/Corro.PackageCli -p:SkipFrontendBuild=true -- pack path/to/my-game --output my-game.corro
```

`new` offers neutral bilingual starters for every family, with local editor schemas. `pack`
validates first, creates a reproducible archive and reloads it through the secure upload path before
writing the result. See the [Package SDK guide](tools/Corro.PackageCli/README.md) for JSON output
and exit codes, and [`CORRO_FORMAT.md`](CORRO_FORMAT.md) for the format itself.

## License of contributions

The repository is licensed under **AGPL-3.0-only** except where a file or package states
another license (see [`LICENSE`](LICENSE) and [`NOTICE.md`](NOTICE.md)). By submitting a
pull request you agree that your contribution is licensed under the same terms.

## Code of conduct

Be respectful and constructive. Assume good faith, keep discussions on the technical
merits, and help make this a welcoming project for contributors of all backgrounds.
