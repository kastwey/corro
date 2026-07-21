// board-localization.spec.ts — first paint must not expose the English HTML fallback while
// the board page is still loading the player's selected locale.

import { test, expect } from '../helpers/test';
import { flushAxeAudit } from '../helpers/axeAudit';
import { appI18n, newPlayerPage } from '../helpers/game';
import { E2E_BASE_URL } from '../playwright.config';

test('the board loading introduction waits for the selected Spanish locale', async ({ browser }) => {
	// Match a player whose browser is English but who explicitly selected Spanish in Corro.
	const page = await newPlayerPage(browser, 'en-US');
	await page.context().addCookies([{
		name: 'corro_language',
		value: 'es',
		url: E2E_BASE_URL,
	}]);

	let releaseLocale!: () => void;
	const localeGate = new Promise<void>(resolve => { releaseLocale = resolve; });
	let localeRequested!: () => void;
	const requested = new Promise<void>(resolve => { localeRequested = resolve; });
	await page.route('**/i18n/locales/es.json', async route => {
		localeRequested();
		await localeGate;
		await route.continue();
	});

	const navigation = page.goto('/board.html');
	await requested;
	const intro = page.locator('#game-surface-intro');

	try {
		await expect(intro).toBeAttached();
		await expect(intro).toBeHidden();
		await expect(intro).toHaveText(appI18n('en').game.surface_intro.loading);
		await flushAxeAudit(page);
	} finally {
		releaseLocale();
	}

	await navigation;
	await expect(page.locator('html')).toHaveAttribute('lang', 'es');
	await expect(intro).toBeVisible();
	await expect(intro).toHaveText(appI18n('es').game.surface_intro.loading);
	await flushAxeAudit(page);
});