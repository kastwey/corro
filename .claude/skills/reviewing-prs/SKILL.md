---
name: reviewing-prs
description: Reviews a pull request against Corro's own failure modes and drives it to green — how to read the change, how to prove a finding before claiming it, how to explain it to somebody who has not read the diff, and what to do when CI is red (job logs, the Playwright artefact, reproducing locally, telling a real defect from a race). Findings are explained and proposed, never acted on unprompted. Use whenever a PR is to be reviewed, analysed, commented on, watched, babysat or fixed, whenever a CI check fails on one, and whenever somebody asks "what's wrong with this PR" or "why is CI red" — including on the reviewer's own PRs.
---

# Reviewing a pull request

[AGENTS.md](../../../AGENTS.md) holds the rules a change has to satisfy, and
[verifying-changes](../verifying-changes/SKILL.md) holds the procedure for running the suites.
This is the third thing: reading somebody's change, proving what you think is wrong before you
say it, saying it well, and getting the branch to green afterwards.

## The posture: explain, propose, wait

**A review produces findings, not changes.** Explain each one, propose a fix, and then stop and
let the person you are talking to decide. Nothing is acted on — no edit to the branch, no
comment posted on the PR — until they say so, and their "yes" to one finding is not a "yes" to
the next one.

This is not caution for its own sake. Three things go wrong when a review starts fixing:

- **The decision was not yours to take.** The author has to live with this code and answer for
  it later. A finding is information they act on; a push is a choice made for them.
- **A review that edits the branch destroys what was under review.** The author opens the diff
  expecting their change and finds somebody else's mixed into it.
- **A finding you were certain of is sometimes wrong.** An explanation costs a reply; a push
  costs a revert, and the next review gets read with one eye closed.

An obvious one-line fix is not an exception — say in the finding that it is a one-liner and
offer it. "Do it" takes two words, and then you have an instruction rather than a guess.

## Explaining a finding

Write for somebody who has not read the diff, does not have the file open, and should not have
to. They are deciding whether this matters and what to do about it; they can only decide from
what you tell them.

Work in this order, and resist starting at the third step — that is the failure mode, and it
reads as noise even when the finding is real:

1. **What the thing is.** "Ctrl+F1 opens a table of every shortcut; for a screen-reader player
   that table *is* the documentation." Name the feature in plain words before naming the defect.
2. **What it does today**, concretely — the actual rows, the actual string, the actual
   keystroke. Concrete beats accurate-but-abstract: six named rows that lie land where "the
   default is unsound" does not.
3. **Why that is wrong, and who it hurts.** A defect with no victim is a preference. "A blind
   player concludes their screen reader ate the keystroke" is the sentence that makes a finding
   worth acting on.
4. **The smallest fix you can see**, offered as a proposal with its trade-off, not as a verdict.

Assume none of the vocabulary. Module names, helper functions and repo idioms are shorthand for
things the reader may know perfectly well and still not have in mind right now; spell out what
each one does the first time it appears. Cite `file.ts:line` so the claim can be checked — but
never let the citation stand in for the explanation.

The test: could somebody who has not opened the repository today tell you whether this finding
matters? If not, it is not explained yet.

## 1. Read the change

There is no `gh` here; the GitHub MCP tools do the same jobs (`pull_request_read` with `get`,
`get_files`, `get_diff`, `get_review_comments`, `get_check_runs`). Get the branch locally too —
a diff shows what moved, not what it now means:

```bash
git fetch origin <branch> && git checkout <branch>
```

**CI on a `pull_request` builds the MERGE of the branch and its base, not the branch.** A PR
that has been open for a week is tested against a main it has never seen. When reproducing
anything, merge first, or you are testing something CI is not:

```bash
git fetch origin main && git merge origin/main --no-edit
```

## 2. What to look for

Every repository produces its own defects. These are Corro's — each one has shipped here, and
each is invisible unless looked for on purpose.

**Text that asserts something the code does not do.** A label, a hint, a help table is a promise
made to somebody who cannot check it by looking. Read the claim, then read the handler that has
to keep it. And remember that *silence is a claim too*: an empty table cell, a default value, a
column that fills itself in for rows nobody thought about — a screen reader reads those as fact.

**State drawn on screen that nothing takes down.** Anything painted for the sighted player:
find what clears it. A number that was true when it was asked for and reads as current five
minutes later is worse than never showing it, because now it is trusted.

**One fact, two voices.** The server owns the spoken voice; a client handler that announces the
same event says it twice. The same goes for the screen: two panels carrying one fact is one
panel too many, and the reader has to work out which is authoritative.

**Translations.** The parity suite compares the two locale files with each other, so a key that
is wrong or missing in *both* passes it. Check that the key exists, that something uses it, that
both locales carry it, and that a server announcement also has its `_self`. When a key is
deleted, grep for it before believing it is dead.

**Packages that never appear in a diff.** `git check-ignore server/Packages/<id>` tells you
which are local. They ship, so a rule, key or help change in one package of a family belongs in
every package of that family — and no diff, review or CI run will ever show you that it is
missing.

**Keyboard bindings live in three scopes**: the engine keymap, the family's own keys, and the
lobby's page chords. A new key has to be searched for in all three, and then against what the
browser and the screen readers already own (`BROWSER_RESERVED_CHORDS` in `frontend/src/shortcuts.ts`).
Two traps worth naming, because they are invisible on a Linux CI runner: Windows turns
**Ctrl+Alt into AltGr**, so `Ctrl+Alt+Q` is how a Latin American keyboard types `@`; and on
macOS **Ctrl+Option is the VoiceOver modifier**, i.e. the entire vocabulary of the screen reader
this game exists for.

**The accessibility invariants a diff breaks quietly**: a dialog that is not a native
`<dialog>`, a `disabled` attribute, a heading level that skips, a second `main`, a scrollable
region no key can reach, focus not restored to the opener, a visual layer that forgot its
`aria-hidden`.

**Axe only audits states the scenario reaches.** A new or changed view, theme, error, menu,
loading or disabled state needs an E2E transition that arrives there — and `flushAxeAudit`
before anything that disappears fast, or the state is never inspected at all.

**Dead code the change orphaned**: a field now only assigned, a key nothing reads, a CSS class
with no element. Grep for each symbol the change stopped using.

**Tests that have stopped guarding what they claim.** A guard that walks a hand-listed set of
files silently stops covering the next file somebody adds — which is the exact failure it was
written to prevent. An assertion scoped to the whole page couples it to every other panel. And a
regression test that passes with *and* without the fix is not a regression test; reinstate the
bug and watch it fail before believing it.

## 3. Prove it before you say it

A review that is wrong twice stops being read. Before writing a finding down:

- Follow the code path yourself and cite it as `file.ts:line`. The PR description is the
  author's belief about their change, not evidence.
- A claim about behaviour ("this key does nothing while typing") needs the handler that decides
  it, not the label that describes it.
- Run the suites (see [verifying-changes](../verifying-changes/SKILL.md)). "The tests pass" is
  worth saying only if you ran them.
- If you could not check something, say which part you could not check rather than rounding it
  up to a claim.

## 4. Deliver it

Give the findings in one pass, ordered by severity, each explained as above, and say plainly
which you would act on first and why. Then hand the decision over: which findings to take, in
what order, and whether each becomes a PR comment or a change. Waiting is the work here, not an
interruption of it.

Once something is confirmed, publishing it follows the repo's usual rules: English, like every
other artefact here. A design-level argument goes in one general comment where the reasoning can
be followed; a defect in a specific line goes inline on that line. Several nits from one cause
are one comment, not six. Every comment ends with the attribution footer, so a reader knows what
wrote it.

## 5. When CI is red

Work in this order, because each step is cheaper than the next and any of them can end the
hunt:

```
- [ ] 1. Is the same job red on main? Then it is not this PR's.
- [ ] 2. Reproduce against the MERGE, not the branch.
- [ ] 3. Read the job log — the failing assertion, not the summary.
- [ ] 4. Pull the artefact: the page state and console at the moment of failure.
- [ ] 5. Reproduce locally, and only then start changing things.
```

For step 4, a failed E2E job uploads `playwright-report`. It holds two things worth more than
the log: an accessibility snapshot of the page **at the moment of failure** (which answers "was
a dialog open? where was focus? what was actually on screen?") and the trace, which carries the
page's console:

```bash
# MCP: actions_list → list_workflow_run_artifacts, then actions_get → download_workflow_run_artifact
curl -sS -o report.zip "<signed url from the tool>"
unzip -q report.zip -d report
cat report/playwright-report/data/*.md                    # the failure's a11y snapshot
unzip -q report/playwright-report/data/<hash>.zip -d trace
grep -o '"type":"console"[^}]*' trace/*.trace | head      # and the page's console
```

No page errors in that trace means the application was healthy and the test's expectation was
not met for some other reason — which redirects the hunt rather than ending it.

### Causality is not a streak

**The same code passing somewhere else disproves your theory, and two failures in a row do not
prove it.** A load-sensitive race falls the same way twice quite happily. Before telling anybody
a failure is theirs, find a run where the same code passed — a later commit that contains it, a
local run, the base branch — and if you find one, say so plainly and correct yourself.

The temptations to refuse: skipping, disabling or quarantining the test; loosening the assertion
until it passes; calling it a flake because it is inconvenient. A test that is hard to satisfy
is usually describing something true.

### When the sandbox cannot run the suite

Diagnosing an E2E failure from logs alone is guesswork, and a sandbox that lacks .NET or ships a
different Chromium than the repo pins is fixable in two minutes:

```bash
curl -sSL -o dotnet-install.sh https://dot.net/v1/dotnet-install.sh
bash dotnet-install.sh --channel 10.0 --install-dir "$HOME/.dotnet"
export PATH="$HOME/.dotnet:$PATH"
```

For the browser, check what is actually installed (`ls $PLAYWRIGHT_BROWSERS_PATH`) and, if the
build differs from the pinned one, write a config beside `e2e/playwright.config.ts` that spreads
it and adds `use.launchOptions.executablePath`. It has to live in `e2e/` because the config's
`globalSetup` and `testDir` are resolved relative to it. Keep it out of the commit with
`.git/info/exclude` rather than `.gitignore` — it is scaffolding for one machine, not a fact
about the repository — and delete both when the run is done.

## 6. Done

A review is finished when every finding has an answer — fixed, argued, or explicitly deferred —
and the branch is green on its own merge. Green with findings still unanswered is not finished,
and neither is a set of answers on a red branch.
