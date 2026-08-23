---
name: verifying-changes
description: Runs Corro's verification gates in the right order — repository conventions, the frontend build and node:test suite, dotnet test, and the sharded Playwright E2E suite — and how to look at a UI change in both themes without trusting a screenshot's colours. Use when finishing a change, before pushing, when a suite has to be run or narrowed to a single spec, when deciding whether E2E applies, when the E2E coverage map needs regenerating, or when a visual/contrast claim has to be checked.
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

## Looking at a UI change

AGENTS.md asks for a visual review of both themes, and a screenshot is how that gets done. It is
an honest channel for SHAPE — what wrapped, what is next to what, how the headings step, whether
a block reads as one thing — and an unreliable one for COLOUR. The image is rescaled and
recompressed on its way to you, and a surface painted `#1a2236` can read as white. The mistake
goes one way: towards restyling something that was never broken.

So split the review. **Eyes for shape, measurement for colour.** Anything you are about to say
with a colour in it — "the dark theme is not applying here", "that text is unreadable on that
surface" — and any change you are about to make BECAUSE a screenshot looked wrong, gets measured
first.

Two measurements, and they answer different questions, which is why it is worth taking both:

- `getComputedStyle` — what the CSS resolved to. *Which token won?*
- the painted pixel — what landed after stacking, opacity, ancestors and the screenshot
  pipeline. *What does somebody actually see?*

When they disagree, the pixel is the one describing the product. When they agree, an image that
still looks wrong is the image being wrong.

The lobby needs no server to be looked at — it is static once built, and its failing SignalR
calls do not stop the chrome from rendering:

```bash
cd frontend && npm run build
(cd dist && python3 -m http.server 8099 &)
```

Then drive it with the browser the E2E suite already installed (on a remote session,
`executablePath: '/opt/pw-browsers/chromium'`):

```js
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
await page.goto('http://localhost:8099/index.html');
// Both themes are one attribute apart; check the one you are NOT developing in too.
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));

// 1. What the CSS resolved to.
console.log(await page.evaluate(sel => {
	const cs = getComputedStyle(document.querySelector(sel));
	return { background: cs.backgroundColor, color: cs.color, position: cs.position };
}, '.player-context-menu'));

// 2. What was painted there. Decoded in the browser, which needs no image library.
const shot = (await page.screenshot()).toString('base64');
console.log(await page.evaluate(async data => {
	const img = new Image();
	img.src = 'data:image/png;base64,' + data;
	await img.decode();
	const canvas = document.createElement('canvas');
	canvas.width = img.width; canvas.height = img.height;
	const ctx = canvas.getContext('2d');
	ctx.drawImage(img, 0, 0);
	const at = (x, y) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3);
	return { surface: at(345, 400), text: at(352, 357) };   // coordinates from a boundingBox()
}, shot));
```

For a contrast claim the number is the WCAG ratio, not the two colours: relative luminance of
each (`c/255`, then `c <= 0.03928 ? c/12.92 : ((c+0.055)/1.055) ** 2.4`, weighted
`0.2126/0.7152/0.0722`), and `(lighter + 0.05) / (darker + 0.05)`. Under 4.5 for body text is a
finding; the Axe gate says the same thing but only about states a scenario reaches, and this
works on a state you are still building.

None of this replaces the Axe gate or a look at the whole page. It is what turns "that looks
off" into something worth acting on.

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
