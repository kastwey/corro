import { test as base, expect } from '@playwright/test';
import { beginAxeAudit, finishAxeAudit } from './axeAudit';

/**
 * Every E2E test gets an automatic Axe lifecycle. Player contexts install the
 * browser-side monitor in newPlayerPage(); teardown flushes every live page and
 * fails with an attached JSON report if any settled UI state had a violation.
 */
export const test = base.extend<{ _axeAudit: void }>({
	_axeAudit: [async ({}, use, testInfo) => {
		beginAxeAudit(testInfo);
		await use();
		await finishAxeAudit(testInfo);
	}, { auto: true }],
});

export { expect };
export type { Browser, BrowserContext, Locator, Page, TestInfo } from '@playwright/test';
