<!-- Fill in the sections that apply and delete the ones that do not. The comments are
     guidance for the author and never render in the pull request. -->

## What changed

<!-- One or two sentences: what a player or contributor can now do that they could not
     before, or what stopped being broken. -->

## Why

<!-- The problem this solves. For a bug fix, say what went wrong and under what
     conditions — the reproduction is the most useful thing a reviewer can be handed. -->

## How it was verified

<!-- CI runs `frontend`, `server` and `e2e`. Tick what you actually ran locally, and paste
     the counts where you have them: a reviewer cannot tell a green run from an unrun one. -->

- [ ] Repository conventions — `pwsh -NoProfile -File tools/tests/repository-language.tests.ps1`
- [ ] Frontend — `cd frontend && npm run build && npm test`
- [ ] Backend — `dotnet test server.tests/CorroServer.Tests.csproj --nologo`
- [ ] E2E — `cd e2e && npm test` <!-- required for every UI or accessibility change; say so if it does not apply -->

<!-- Every change ships with the highest possible coverage, and every bug fix gets a
     regression test that has been PROVEN to fail without its fix (reinstate the bug, watch
     the test go red on the assertion you expect, restore). Say which test that is and what
     it asserts. If something genuinely could not be covered, say that instead — explicitly. -->

## Accessibility

<!-- Delete this section only if the change cannot reach a browser UI state.

     The Axe monitor inspects only states a scenario REACHES, so name the E2E transitions
     you added for new or changed views, themes, dialogs, menus, validation errors,
     loading/success/failure and disabled/unplayable states — and for anything a hoverless
     pointer sees differently, the touch context that reaches it.

     Worth stating explicitly when they apply:
     - which announcements the SERVER now makes, with the base and `_self` keys
     - that dialogs are native `<dialog>` and focus returns to the opener
     - that no control was given the `disabled` attribute
     - both themes reviewed visually, not only Axe-clean -->

## Translations

- [ ] Every new user-facing string exists in both `en.json` and `es.json` (base **and** `_self` where applicable)
- [ ] Not applicable — no user-facing strings changed

## Package impact

<!-- Some packages live in a private repository and never appear in a diff or a CI log,
     while they ship to real players. If this change touches a game family (its rules,
     house rules, keys, help or announcements), say which one: the maintainer has to land
     the same change in that family's hidden packages before merging — manifest, both
     locales, both help files. Only fill in the branch line if you have access to them:
     the private branch is named exactly like this one and is pushed BEFORE this PR's last
     push, so CI tests both halves together (AGENTS.md, "Branch to branch"). -->

- [ ] Not applicable — nothing a package can see changes
- [ ] Touches the `<family>` family — the hidden packages of that family need the same change
- [ ] Hidden packages already updated on private branch `<same name as this branch>`

## Notes for the reviewer

<!-- Anything that would otherwise cost somebody an afternoon: a decision you are unsure
     about, an alternative you rejected and why, a follow-up you deliberately left out of
     scope, or code you orphaned and deleted elsewhere. -->
