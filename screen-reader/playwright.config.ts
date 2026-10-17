import { defineConfig } from '@playwright/test';
import { withGuidepup } from '@guidepup/playwright';
import path from 'node:path';

/**
 * Screen-reader suite: a real NVDA, driven by Guidepup, over the component gallery served by the
 * real server in its E2E mode (the same server the e2e/ suite uses, on its own port).
 *
 * Everything that makes this suite different from e2e/ follows from one fact: there is ONE screen
 * reader on the machine and it reads whatever window has focus. So `withGuidepup` forces a single
 * worker, serial files and a HEADED browser (a screen reader has nothing to read in a headless
 * one), and the suite runs only where NVDA runs: a Windows desktop session. GitHub's
 * `windows-latest` runners are one; see .github/workflows/screen-reader.yml.
 *
 * It is not sharded and not on every PR: the point is to hear what the widgets SAY, nightly and on
 * demand, and to catch a browser or NVDA update changing that before a player does.
 */
export const SR_PORT = Number(process.env.SR_PORT ?? 5699);
export const SR_BASE_URL = `http://localhost:${SR_PORT}`;

export default defineConfig(withGuidepup({
	testDir: './tests',
	// NVDA starts once per test and every spoken phrase is waited for: slow by nature, and a loaded
	// runner makes it slower. The deadline only decides when a slow-but-correct run is declared hung.
	timeout: 5 * 60 * 1000,
	expect: { timeout: 20_000 },
	// Guidepup's own guidance: a screen reader session occasionally loses a keystroke to the OS, and
	// a retried test that then passes is reported as FLAKY, never as green.
	retries: process.env.CI ? 2 : 0,
	reportSlowTests: null,
	reporter: [
		['list'],
		['html', { open: 'never', outputFolder: 'playwright-report' }],
	],
	use: {
		baseURL: SR_BASE_URL,
		// Motion off, as in e2e/: the gallery widgets snap, so a phrase is never heard mid-animation.
		reducedMotion: 'reduce',
		// NVDA speaks the page's content in the page's language; the gallery is served in English and
		// the role words asserted ("menu", "sub menu", "unavailable") are NVDA's English ones.
		locale: 'en-US',
		trace: 'retain-on-failure',
		// A headed browser needs a window big enough for the gallery to lay out as on a desktop.
		viewport: { width: 1280, height: 900 },
	},
	webServer: {
		// The same launch as e2e/playwright.config.ts: --no-launch-profile keeps launchSettings.json
		// from forcing the Development environment, and the server builds the frontend into wwwroot
		// itself unless SR_PREBUILT says a build already happened (the CI workflow builds once).
		command: process.env.SR_PREBUILT
			? 'dotnet run --no-build --no-launch-profile --project ../server/CorroServer.csproj'
			: 'dotnet run --no-launch-profile --project ../server/CorroServer.csproj',
		url: `${SR_BASE_URL}/gallery.html`,
		reuseExistingServer: !process.env.CI,
		timeout: 240_000,
		env: {
			ASPNETCORE_ENVIRONMENT: 'E2E',
			ASPNETCORE_URLS: SR_BASE_URL,
			E2E__PackagesRoot: path.resolve(__dirname, '..', 'e2e', 'fixtures', 'packages'),
		},
	},
}));
