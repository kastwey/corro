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

## Explaining the change, and then the findings

Write for somebody who has not read the diff, does not have the file open, and should not have
to. They are deciding whether this matters and what to do about it; they can only decide from
what you tell them.

**Start with the change itself, before a single finding.** What is this PR for, in a couple of
sentences, and then what it actually does — each thing it changes and what that thing is trying
to achieve. Skipping this is easy to do and hard to notice, because by the time you write the
review you have had the diff in your head for an hour and the purpose feels like background.

It is not background: **a finding is a deviation from an intent**, and a reader who has not been
told the intent cannot weigh the deviation. Praise has the same problem — "this part is right"
says nothing until they know what "this part" was for. Assume they know only the PR's title,
because often that is true.

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

## 3. Look at it, because the reviewer cannot

**The person reading this review is blind.** That single fact changes what a review has to do,
and it is the easiest thing in this repository to forget while reading a diff that looks
correct.

A visual defect announces itself to nobody here. It is not in the diff, not in the spoken
output, not in the test log — a subtitle painted over a title, a panel clipped at the edge, a
column that stopped scrolling: every one of those passes review in silence and reaches a sighted
player as a broken game. Axe does not fill the gap either. It rules on contrast and structure
and says nothing whatsoever about geometry: an element can sit exactly on top of another with
perfect contrast and pass every rule there is.

So the design has to be *checked*, deliberately, three ways:

**Read the pictures.** `property-screenshot`, `race-screenshot`, `card-piles-screenshot` and
`exploding-screenshot` capture each stage of a real game in both themes for exactly this reason
— their own header says "so a sighted reviewer, or Claude reading the PNGs, can audit contrast
and layout". They are attached to the Playwright report, so open them and actually look. And
notice what they do *not* cover: a view those scenarios never reach is a view no picture exists
of, which is itself a finding on a PR that adds one.

**Assert the geometry rather than trusting the eye.** The patterns are already written, in
`forbidden.spec.ts`, each born from a real complaint — copy them rather than inventing:

- nothing spills past the viewport at 390px (collect every element whose `right` exceeds
  `clientWidth` and assert the list is empty — a list, so the failure names the culprit);
- boxes that share a cell do not overlap (`subtitle.top >= title.bottom`);
- headings that *announce* at the same level also *render* at the same size, or a new section
  that missed the shared rule paints at the browser default and only a sighted player ever
  finds out.

**Enlarge the text — and note that today nothing does.** No spec raises the font size or zooms,
so the whole suite only ever proves the layout works at one size. A player who needs 200% text
meets a different application: lines clip, panels ride over each other, and content pushed out
of a box is unreachable if that box does not scroll. When a PR touches layout, that coverage is
what it is missing. Raising the root font size is the faithful version where the CSS is
rem-based; otherwise emulate browser zoom — and then re-run the three checks above plus the one
that matters most at that size: whatever no longer fits can still be scrolled to, and reached
from the keyboard (AGENTS.md, "a scrollable region needs keyboard access").

## 4. Prove it before you say it

A review that is wrong twice stops being read. Before writing a finding down:

- Follow the code path yourself and cite it as `file.ts:line`. The PR description is the
  author's belief about their change, not evidence — and neither is a comment in the diff. A
  comment saying "tables wrap rather than scroll, because a scrolling one would need a keyboard
  handle" is the author explaining their reasoning; the repository's actual rule was narrower
  (a region that scrolls must be *reachable*, which is two attributes, not a prohibition).
  Repeating a justification as though it were the rule puts the author's belief in your mouth.
- A claim about behaviour ("this key does nothing while typing") needs the handler that decides
  it, not the label that describes it.
- **Try a proposed fix on inputs other than the one that prompted it.** A rule inferred from a
  single example usually fits that example perfectly. Marking the first cell of every table row
  as a header reads beautifully on a table whose first column is a label, and turns a plain data
  column into a heading everywhere else. If the fix generalises, say what it generalises over;
  if it does not, that is not a fix, it is a request for a decision.
- Run the suites (see [verifying-changes](../verifying-changes/SKILL.md)). "The tests pass" is
  worth saying only if you ran them.
- If you could not check something, say which part you could not check rather than rounding it
  up to a claim.

**A state you can build in a test is not a state the game can reach.** A fixture assembles
whatever you type into it; what decides which states exist is the rulebook — that is where the
transitions live. So before reporting that some state renders badly, find the code that produces
it. A phase can be set and replaced a few statements later inside one method, in which case no
client ever sees it and the finding is about a situation the game does not have. The suites sit
downstream of the rules: they can tell you a state is handled, never that it happens.

That makes the rulebook the authority — **unless the PR is changing the rulebook itself**, and
then the code cannot vouch for its own correctness. There the question is not "what does this do"
but "what should it do", and the answer lives outside the repository: the published rules of the
game being modelled, which are older than this code and settle most arguments on their own. When
the rule turns out to be Corro's own invention — a house rule, with no outside authority to check
it against — that is a question for the maintainer, not a gap to fill with a plausible guess.

## 5. Deliver it

Give the findings in one pass, ordered by severity, each explained as above, and say plainly
which you would act on first and why. Then hand the decision over: which findings to take, in
what order, and whether each becomes a PR comment or a change. Waiting is the work here, not an
interruption of it.

**Some findings are not this PR's to fix, and saying so is part of the finding.** A change can
be right and still sit inside something questionable — a format that cannot express what the
author needs, a mechanism worth replacing wholesale. Those are real, and they are not this
author's to answer: the guide renderer growing a fourth special case is a question about the
renderer, and only the guide's own author can say whether a table's first column is a label.
File them where a decision can be made — an issue, with the reasoning that got you there — and
say plainly in the review that they do not block the change. A good fix parked for weeks under
an architectural argument helps nobody, least of all the players waiting for the bug to go.

**A PR from a fork can only be answered, not pushed to.** The git proxy injects credentials for
this repository alone, so a branch living on somebody's fork is unreachable from here — and it
is theirs to change in any case. There, the comment *is* the deliverable, with the patch inside
it. Preparing the fix locally first is still worth the detour: a proposal you have actually run,
carrying a regression test that fails without it, is a different thing from a suggestion.

Once something is confirmed, publishing it follows the repo's usual rules: English, like every
other artefact here. A design-level argument goes in one general comment where the reasoning can
be followed; a defect in a specific line goes inline on that line. Several nits from one cause
are one comment, not six. Every comment ends with the attribution footer, so a reader knows what
wrote it.

## 6. When CI is red

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

## 7. Done

A review is finished when every finding has an answer — fixed, argued, or explicitly deferred —
and the branch is green on its own merge. Green with findings still unanswered is not finished,
and neither is a set of answers on a red branch.

## Keeping this list worth reading

A review will turn up defects this file does not name, and the reflex is to add each one to
section 2. Resist it. **A catalogue that grows without limit stops being applied** — not because
anybody decides to ignore it, but because thirty entries read as a wall and get skimmed, and a
skimmed list catches less than a short one that is actually worked through. Every line added
costs attention that the lines already there were paying for.

So a new entry has to earn its place. Ask, in this order:

- **Has it happened more than once, or could it plausibly?** A one-off mistake somebody has
  already learnt from is a story, not a pattern.
- **Would it be missed without the note?** If the diff shows it, the compiler catches it or a
  suite already fails on it, writing it down buys nothing.
- **Does something else already cover it?** AGENTS.md holds the rules and
  [verifying-changes](../verifying-changes/SKILL.md) the procedure. A rule restated here is a
  rule with two homes that will disagree eventually.
- **Can it replace an entry rather than join it?** Two specific traps often share one underlying
  shape, and the shape catches more than either. Prefer rewriting to appending.

When an entry does earn its place and nothing can be merged away, that is the moment to move the
catalogue into `references/` and leave a pointer here — better a second file somebody opens when
they need it than a first file nobody finishes.
