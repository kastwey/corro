import { test, expect } from '../helpers/test';
import {
	axeViolationsFor,
	clearAxeViolationsFor,
	flushAxeAudit,
} from '../helpers/axeAudit';
import { gotoLobbyHome, newPlayerPage } from '../helpers/game';

test('the automatic Axe monitor retains a violation from a transient UI state', async ({ browser }) => {
	const page = await newPlayerPage(browser);
	await gotoLobbyHome(page);
	await flushAxeAudit(page);
	// Other E2E flows own the real lobby audit; isolate this test's deliberate probe.
	clearAxeViolationsFor(page);

	await page.evaluate(() => {
		const probe = document.createElement('img');
		probe.id = 'axe-missing-alt-probe';
		probe.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
		(document.querySelector('main') ?? document.body).append(probe);
	});

	await expect.poll(
		() => axeViolationsFor(page).some(violation => violation.id === 'image-alt'),
		{ message: 'the mutation-triggered Axe scan should report the missing alt text' },
	).toBe(true);

	await page.locator('#axe-missing-alt-probe').evaluate(element => element.remove());
	await flushAxeAudit(page);
	expect(axeViolationsFor(page).some(violation => violation.id === 'image-alt')).toBe(true);

	// The expected violation must not fail this monitor regression test's automatic teardown.
	clearAxeViolationsFor(page);
});
