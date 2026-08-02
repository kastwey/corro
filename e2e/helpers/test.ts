import { test as base, expect } from '@playwright/test';
import { beginAxeAudit, finishAxeAudit } from './axeAudit';
import { closePlayerContexts } from './playerContexts';

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
	_playerContexts: [async ({}, use) => {
		await use();
		await closePlayerContexts();
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
