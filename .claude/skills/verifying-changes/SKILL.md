---
name: verifying-changes
description: Runs Corro's verification gates in the right order — repository conventions, the frontend build and node:test suite, dotnet test, and the sharded Playwright E2E suite. Use when finishing a change, before pushing, when a suite has to be run or narrowed to a single spec, when deciding whether E2E applies, or when the E2E coverage map needs regenerating.
---

# Verifying a change

The rules about WHAT must be tested live in [AGENTS.md](../../../AGENTS.md) ("Testing
discipline", "Automatic Axe gate"). This is the *procedure*: the order, the commands, and the
traps that cost time.

Run the gates in this order. Each is cheap relative to the next, so a failure surfaces before
you have paid for the slower one.

```
- [ ] 1. Repository conventions
- [ ] 2. Frontend: build, then tests
- [ ] 3. Backend: dotnet test
- [ ] 4. E2E: only when the change touches a flow it covers
```

## 1. Repository conventions

Checks the English-only rule and the shared agent instructions. Seconds, and the pre-push hook
runs it first for that reason.

```bash
pwsh -NoProfile -File tools/tests/repository-language.tests.ps1
```

## 2. Frontend

From `frontend/`. The build must precede the tests: it is what copies i18n and assets into
`dist/`, and the translation-parity suite reads them.

```bash
cd frontend && npm run build && npm test
```

One suite while iterating:

```bash
node --import tsx --test test/tableView.test.ts
```

## 3. Backend

A running dev server holds `CorroServer.dll` and the build fails on a locked file. Stop it
first — this needs PowerShell, not bash.

```powershell
Get-Process -Name CorroServer -ErrorAction SilentlyContinue | Stop-Process -Force
dotnet test server.tests/CorroServer.Tests.csproj --nologo
```

Integration tests that need Cosmos or Azurite **skip** when the emulator is absent. A run
reporting `Skipped: 12` with no failures is green, not degraded.

Narrow to one class while iterating:

```bash
dotnet test server.tests/CorroServer.Tests.csproj --nologo --filter "FullyQualifiedName~GameHubInvitation"
```

## 4. E2E

Always from `e2e/`, never the repo root — from the root Playwright picks up the frontend's unit
tests instead. See [e2e/README.md](../../../e2e/README.md) for how sharding, balancing and the
coverage map work; the commands you need day to day:

```bash
cd e2e && npm test                            # sharded across servers (the gate)
npm test 1                                    # one server, serial — to pin down a failure
npm test 1 tests/invites.spec.ts              # a single spec
npm test 1 tests/invites.spec.ts -- --grep "hidden from you"   # a single test
npm run test:affected                         # inner loop: only specs your change could break
```

Run it when the change touches a flow it covers — lobby, tables, invitations, trades,
purchases, announcements — and for **every** UI or accessibility change, because the Axe gate
only inspects states a scenario actually reaches.

### Confirming the whole suite really ran

A sharded run prints thousands of lines, and piping it through `tail` throws away everything
but the end — which looks identical to a run that skipped most of the suite. The reliable
check is the ledger every run writes:

```bash
node -e "const m=require('./.durations/by-file.json');console.log(Object.keys(m).length+' specs measured')"
```

Compare that with `ls tests/*.spec.ts | wc -l`. Equal means every spec ran.

### The coverage map

`npm run test:affected` selects from a **measured** map. Adding a spec or a frontend module
makes it stale, which costs speed and never coverage — `affected.mjs` falls open to the whole
suite for anything it has not seen. Refresh it once the change has settled:

```bash
cd e2e && npm run test:map
```

It is a full instrumented run (slower than `npm test`), and it is a build artefact: regenerate
it, never hand-edit it.

## Proving a regression test

AGENTS.md requires a regression test for every bug fix. A test that passes both with and
without the fix is not one. Before calling a fix done:

1. Reinstate the bug — revert just the guard, in place.
2. Run the new test alone. It **must** fail, on the assertion you expect.
3. Restore the fix and run it again.

Copy the file you are about to break somewhere outside the repo first and restore from that
copy. Do not use `git checkout` to undo it: these files usually carry other uncommitted work
that the checkout would take with it.

## Before pushing

The `pre-push` hook runs conventions, frontend and backend on every push, and E2E only when
asked. Bypassing it is for genuine emergencies.

```bash
RUN_E2E=1 git push
```
