import { test as base, expect } from '@playwright/test';
import { beginAxeAudit, finishAxeAudit } from './axeAudit';
import { closePlayerContexts } from './playerContexts';
import { beginCoverage, finishCoverage } from './coverage';

/**
 * Every E2E test gets an automatic Axe lifecycle. Player contexts install the
 * browser-side monitor in newPlayerPage(); teardown flushes every live page and
 * fails with an attached JSON report if any settled UI state had a violation.
 *
 * …and then gives the browser contexts back. Playwright only disposes contexts when the WORKER
 * ends, so before this a full run finished with dozens of them alive (see playerContexts.ts).
 *
 * The ORDER matters, and is why these are two fixtures rather than one: a dependent fixture is
 * set up after its dependency and torn down BEFORE it. `_axeAudit` depending on `_playerContexts`
 * therefore means the audit flushes every live page first and the contexts close afterwards.
 * The other way round, teardown would be auditing pages that no longer exist.
 */
export const test = base.extend<{ _playerContexts: void; _axeAudit: void }>({
	_playerContexts: [async ({}, use, testInfo) => {
		// Off unless E2E_COVERAGE is set. It records which client modules this spec actually
		// EXERCISES, so a later change to one of them knows which specs could care (coverage.ts).
		//
		// Both ends live in THIS fixture, and that is the whole point: closePlayerContexts is what
		// reads each page's coverage before the page goes away, so the ledger is only complete
		// after it. Written into the dependent fixture below — the obvious place — it was flushed
		// before a single page had been read, and every measured run produced an empty map.
		beginCoverage(testInfo);
		await use();
		await closePlayerContexts();
		await finishCoverage();
	}, { auto: true }],

	_axeAudit: [async ({ _playerContexts }, use, testInfo) => {
		void _playerContexts; // depended upon for teardown ORDER only — see above
		beginAxeAudit(testInfo);
		await use();
		await finishAxeAudit(testInfo);
	}, { auto: true }],
});

export { expect };
export type { Browser, BrowserContext, Locator, Page, TestInfo } from '@playwright/test';
