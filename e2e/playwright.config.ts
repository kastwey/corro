import { defineConfig } from '@playwright/test';
import path from 'node:path';

/**
 * E2E suite against the REAL server in its deterministic test mode:
 * ASPNETCORE_ENVIRONMENT=E2E gives scripted dice (fed over POST /e2e/random),
 * decks in cards.json order, join-order turns and in-memory persistence.
 *
 * The dice queue lives in the server process and is shared by every game in it, so tests
 * inside ONE server can never run in parallel: one worker, serial files. That is a property
 * of the SERVER, not of the suite — which is why `npm test` shards instead (run-sharded.mjs):
 * several servers on their own ports, each with its own queue, each running a slice of the
 * files serially. Same determinism, a fraction of the wall clock.
 */
export const E2E_PORT = Number(process.env.E2E_PORT ?? 5599);
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

/** Set by run-sharded.mjs so concurrent shards never write to each other's report folders. */
const SHARD_SUFFIX = process.env.E2E_SHARD_ID ? `-${process.env.E2E_SHARD_ID}` : '';
/** How many shards share this machine right now (1 = a plain serial run). */
const SHARD_COUNT = Number(process.env.E2E_SHARD_COUNT ?? 1);

export default defineConfig({
	testDir: './tests',
	// Fail fast with a clear message when .NET / Node are missing, instead of the webServer's
	// 4-minute "timed out" when `dotnet run` can't start (see global-setup.ts).
	globalSetup: './global-setup.ts',
	workers: 1,
	fullyParallel: false,
	// A full lobby → game → trade round trip involves two browsers and a SignalR server.
	//
	// Sharing the machine with other shards makes every one of them slower, so the ceiling moves
	// with the contention — a reload-heavy test that takes 25s alone was tripping the 90s limit at
	// six shards. This weakens no assertion: each `expect` keeps its own 15s deadline (also
	// widened under load), and this number only decides when a slow-but-correct run is declared
	// hung. Judging a shared machine by a solo-machine stopwatch made the suite flaky, and a
	// flaky accessibility gate is worth less than a slow one.
	timeout: SHARD_COUNT > 1 ? 180_000 : 90_000,
	expect: { timeout: SHARD_COUNT > 1 ? 25_000 : 15_000 },
	// Shards run as separate processes at the same time, so each needs its own folders — one
	// shared report folder means four processes overwriting each other's failure traces.
	outputDir: `test-results${SHARD_SUFFIX}`,
	reporter: [
		['list'],
		['html', { open: 'never', outputFolder: `playwright-report${SHARD_SUFFIX}` }],
		// How long each file actually took, so the next sharded run can balance the slices by
		// TIME instead of by file count — see run-sharded.mjs. Written for every run, sharded or
		// not, because a serial run measures the same thing.
		['json', { outputFile: `.durations/run${SHARD_SUFFIX || '-serial'}.json` }],
	],
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
		//
		// E2E_PREBUILT is set by run-sharded.mjs, which has ALREADY built once for everybody.
		// Without it, four shards would race four `npm run build`s into the same frontend/dist
		// and four MSBuilds into the same obj/ — the client the suite tests would be whatever
		// survived the collision.
		command: process.env.E2E_PREBUILT
			? 'dotnet run --no-build --no-launch-profile --project ../server/CorroServer.csproj'
			: 'dotnet run --no-launch-profile --project ../server/CorroServer.csproj',
		url: E2E_BASE_URL,
		reuseExistingServer: !process.env.CI,
		timeout: 240_000,
		env: {
			ASPNETCORE_ENVIRONMENT: 'E2E',
			ASPNETCORE_URLS: E2E_BASE_URL,
			// Exercise the real built-in privacy page in browser tests. These values are public
			// placeholders for the isolated E2E server, never production configuration.
			Privacy__ControllerName: 'E2E Corro Operator',
			Privacy__Jurisdiction: 'Dublin, Ireland',
			Privacy__Contact: 'privacy@e2e.invalid',
			// The public liveness line is off by default, so a suite that never turns it on would
			// only ever audit the footer WITHOUT it. Turned on here, every lobby state in every
			// scenario carries it through Axe.
			PublicMetrics__ShowActivity: 'true',
			// Additional shipped-package root read only in E2E mode. It never enters the
			// server's production Packages directory or publish artifact.
			E2E__PackagesRoot: path.resolve(__dirname, 'fixtures', 'packages'),
		},
	},
});
