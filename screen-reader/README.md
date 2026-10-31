# Screen-reader suite (NVDA through Guidepup)

This suite listens to a **real screen reader**. [Guidepup](https://github.com/guidepup/guidepup)
starts a portable NVDA, sends it keys and returns every phrase it speaks, through the same remote
protocol the NVDA Remote add-on uses; `@guidepup/playwright` wraps that as a Playwright fixture
(`nvdaTest`). The tests open the [component gallery](../frontend/src/gallery/) one widget at a
time and assert the facts a player relies on being *spoken*: a menu is called a menu, a submenu
says so, a refused action is "unavailable" and its reason is read, a tab is "selected", a search
count is announced once the typing stops, a reading dialog is walked in browse mode.

None of that can be checked on the DOM. The e2e suite proves the markup is right and Axe-clean;
this one proves that Chromium's accessibility tree and NVDA's reading of it still turn that
markup into the right words. When an NVDA or browser update stops saying "sub menu", this is the
only layer that notices before a player does.

## Where it runs

Only on a **Windows desktop session**: NVDA is a Windows screen reader and reads whatever window
has focus, so the browser is headed, there is one worker, and the files run serially
(`withGuidepup` in `playwright.config.ts` enforces all three). GitHub's `windows-latest` runners
are such a session: [`.github/workflows/screen-reader.yml`](../.github/workflows/screen-reader.yml)
runs the suite on every pull request that reaches it, nightly whatever changed (the browser and
NVDA move without us), and on demand. The spoken-phrase log of every test is attached to the
report, so a red run is read, not retried.

**What "reaches it" means is derived, never listed by hand.** `affected.mjs` walks the gallery's
runtime import graph from `frontend/src/gallery/index.ts`, adds the page and the stylesheets it
links, the locale files and the suite's own folder, and a pull request runs the suite when it
changes any of those. The gallery is a closed world (no SignalR, no game state), so its import
graph *is* what it exercises — the same reason `e2e/affected.mjs` refuses a hand-kept map, solved
statically because the measured map lives outside the repository. A story that gains an import
gains its trigger with it; anything the script cannot account for means "run".

```bash
node screen-reader/affected.mjs --list                      # what the suite listens to, now
node screen-reader/affected.mjs --base main --head HEAD     # run=true|false for a range
node --test screen-reader/affected.test.mjs                 # the decision's own tests
```

Locally, on a Windows machine with no other screen reader running:

```powershell
cd screen-reader
npm install
npx playwright install chromium
npm run setup        # once per machine: guidepup setup --ci, then the portable NVDA it drives
npm test             # starts the server in E2E mode on port 5699, runs every spec
npm run report       # the HTML report, with the NVDA phrase logs attached
```

The server is the real one in its E2E environment (`dotnet run`, the same launch as `e2e/`), so
the .NET 10 SDK and Node 20+ are needed. `SR_PORT` moves the port; `SR_PREBUILT=1` skips the
server's own build when one already happened.

## Writing a scenario

- Import `nvdaTest` from `@guidepup/playwright` as `test`; the `nvda` fixture is a started NVDA.
- Open a story with `page.goto('/gallery.html?story=<id>')`, bring the browser window to the
  front with `bringWindowToFront(await page.title())` (`helpers/windowFocus.ts`; Guidepup's own
  search only tries the next ten windows, which a developer's desktop exceeds), call
  `nvda.navigateToWebContent()`, put DOM focus on the story's first control, then press keys
  **through `nvda.press`** so the screen reader owns the keyboard, exactly as a player's does.
  `openStory` in `tests/gallery-nvda.spec.ts` does all of that.
- Start NVDA with `capture: true` (the spec's `test.use`). Guidepup's default keeps only the
  first phrase after a key, and the widgets say their most important things second: the answer a
  dialog focuses a moment after opening, the tab selected as the arrow lands, the search count
  spoken once the typing pauses. Speech nobody's key caused is never recorded, so a live-region
  line is heard only inside the window of the key that caused it.
- Read what was said with `heard(nvda)` (`helpers/speech.ts`): the whole phrase log since the last
  `nvda.clearSpokenPhraseLog()`, lower-cased and whitespace-normalised. Assert **facts**, with the
  loose patterns in `NVDA` (`NVDA.submenu`, `NVDA.unavailable`, `NVDA.selected`, `NVDA.position`…)
  and `toContain` for the component's own words. Never assert a whole sentence: the wording is
  NVDA's and changes between versions; the fact is ours. NVDA does not name the role of a plain
  menu entry ("Rename, 1 of 4"): the position count is what says it sits in a menu. And a
  container's role ("tool bar", "menu") is spoken when focus *enters* it, never by re-reporting
  the focused control, so a test that wants to hear it opens the story on the control before the
  widget and sends the Tab through NVDA.
- Keep NVDA on its defaults and the page in English. The role words asserted are NVDA's English
  ones; the component's content comes from the gallery, which `?lang=es` can switch when a
  Spanish scenario is wanted.

## Keeping it honest

- Guidepup pins the NVDA it drives to its own version: bumping `@guidepup/guidepup` means a new
  NVDA, and the first nightly after it is the place to read the logs.
- A phrase that stops being spoken is a regression somewhere in the widget, Chromium or NVDA;
  find which before loosening a pattern. Loosening is the last resort, and only to NVDA's new
  wording for the *same* fact.
- This suite covers what the gallery shows. A new reusable widget gets a story in
  `frontend/src/gallery/catalogue.ts`, a spec in `e2e/tests/gallery.spec.ts`, and a scenario here
  when what it says matters, which for an accessibility-first client is nearly always.
