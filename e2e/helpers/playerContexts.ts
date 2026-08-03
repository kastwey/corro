// playerContexts.ts — every browser context a test opened, so the test can give them back.
//
// `newPlayerPage` opens one context per player and nothing ever closed them. Playwright only
// disposes contexts when the WORKER ends, so a full run finished with dozens alive: dozens of
// live SignalR connections, dozens of pages still reconciling state, dozens of games the server
// still considered occupied. The trace of a single failing test carried 36 of them.
//
// That is not merely untidy. It is the load under which timing windows open — the Favor test
// only ever failed deep into a full run, never alone — and it is why Playwright's failure
// snapshot showed a different game's page entirely, which cost an afternoon of chasing the wrong
// bug. A test that leaves its contexts behind is a test that makes every later test flakier and
// every later failure harder to read.
//
// Registered here rather than through a fixture parameter so the thirty-odd call sites of
// newPlayerPage() stay as they are; the suite runs with `workers: 1`, so one module-level list
// is exactly one test's worth.

import type { BrowserContext } from '@playwright/test';
import { collectCoverage } from './coverage';

const open = new Set<BrowserContext>();

/** Remember a context so teardown can close it. Called by newPlayerPage(). */
export function trackPlayerContext(context: BrowserContext): void {
	open.add(context);
	// A context closed by the test itself (the disconnection flows do this) drops out on its own.
	context.on('close', () => open.delete(context));
}

/**
 * Close everything this test opened. Runs AFTER the Axe audit has flushed every live page —
 * the fixture order in test.ts guarantees it, and getting it backwards would mean auditing
 * pages that are already gone.
 *
 * Failures are swallowed on purpose: a context that is already closing, or whose browser is
 * being torn down, must not turn a passing test red on the way out.
 */
export async function closePlayerContexts(): Promise<void> {
	const contexts = [...open];
	open.clear();
	// Coverage dies with the page, so it is read here — the last moment every page still exists.
	// A no-op unless the run is measuring (coverage.ts).
	await Promise.all(contexts.flatMap(context =>
		context.pages().map(page => collectCoverage(page).catch(() => { /* already gone */ }))));
	await Promise.all(contexts.map(context => context.close().catch(() => { /* already gone */ })));
}
