import { defineConfig } from '@playwright/test';
import path from 'node:path';

/**
 * E2E suite against the REAL server in its deterministic test mode:
 * ASPNETCORE_ENVIRONMENT=E2E gives scripted dice (fed over POST /e2e/random),
 * decks in cards.json order, join-order turns and in-memory persistence.
 *
 * The dice queue lives in the server process and is shared, so tests can NEVER
 * run in parallel: one worker, serial files.
 */
export const E2E_PORT = 5599;
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

export default defineConfig({
	testDir: './tests',
	// Fail fast with a clear message when .NET / Node are missing, instead of the webServer's
	// 4-minute "timed out" when `dotnet run` can't start (see global-setup.ts).
	globalSetup: './global-setup.ts',
	workers: 1,
	fullyParallel: false,
	// A full lobby → game → trade round trip involves two browsers and a SignalR server.
	timeout: 90_000,
	expect: { timeout: 15_000 },
	reporter: [['list'], ['html', { open: 'never' }]],
	use: {
		baseURL: E2E_BASE_URL,
		// Motion off: tokens snap and the announcement gate releases consequences at
		// once, so tests assert outcomes instead of racing animations.
		reducedMotion: 'reduce',
		// The suite asserts Spanish texts against the packages' es i18n.
		locale: 'es-ES',
		trace: 'retain-on-failure',
	},
	webServer: {
		// dotnet run WITHOUT SkipFrontendBuild: it rebuilds the frontend and mirrors it
		// into wwwroot, so the suite always exercises the current client code.
		// --no-launch-profile is ESSENTIAL: launchSettings.json would otherwise force
		// ASPNETCORE_ENVIRONMENT=Development (real Cosmos, no /e2e endpoints) and its own port.
		command: 'dotnet run --no-launch-profile --project ../server/CorroServer.csproj',
		url: E2E_BASE_URL,
		reuseExistingServer: !process.env.CI,
		timeout: 240_000,
		env: {
			ASPNETCORE_ENVIRONMENT: 'E2E',
			ASPNETCORE_URLS: E2E_BASE_URL,
			// Exercise deployment overrides (including both theme assets) through the real
			// configuration endpoint rather than special-casing the browser test.
			SiteBranding__Title: 'All Welcome',
			SiteBranding__Tagline: 'Play together, play your way.',
			SiteBranding__LogoUrl: 'assets/brand/corro-logo-on-light.svg',
			SiteBranding__LogoDarkUrl: 'assets/brand/corro-logo-on-dark.svg',
			SiteBranding__FaviconUrl: 'assets/brand/corro-favicon-light.svg',
			SiteBranding__FaviconDarkUrl: 'assets/brand/corro-favicon-dark.svg',
			// Additional shipped-package root read only in E2E mode. It never enters the
			// server's production Packages directory or publish artifact.
			E2E__PackagesRoot: path.resolve(__dirname, 'fixtures', 'packages'),
		},
	},
});
