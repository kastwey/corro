// lobby-localization.spec.ts — the lobby must arrive already translated, not translate itself.
//
// The page used to ship English with `data-i18n` keys and swap all 81 strings once the locale
// files had been fetched. That swap can never beat the first paint (the strings are fetched and
// the app is an ES module), so a Spanish player read an English lobby and watched it change —
// and a screen reader could begin reading it that way. The pages are now pre-translated at build
// time, so this asserts the property that matters: the Spanish text is in the RESPONSE, not
// applied afterwards.

import { test, expect } from '../helpers/test';
import { flushAxeAudit } from '../helpers/axeAudit';
import { appI18n, gotoLobbyHome, newPlayerPage } from '../helpers/game';
import { E2E_BASE_URL } from '../playwright.config';

test('the Spanish lobby is translated in the served HTML, before any script runs', async ({ browser }) => {
	const page = await newPlayerPage(browser, 'en-US');

	// Read the bytes the server sent, with scripts irrelevant: whatever is here is what the
	// browser paints first.
	const response = await page.request.get(`${E2E_BASE_URL}/es/`);
	const html = await response.text();

	expect(html).toContain(appI18n('es').lobby.createGame);
	// The English fallback the source file carries must not survive into the Spanish build.
	expect(html).not.toContain(appI18n('en').lobby.createGame);
	expect(html).toContain('<html lang="es"');
});

// Reported from play: the name field said "Enter your name" in a Spanish lobby. The markup asked
// for a placeholder with a hyphen — data-i18n-attr-placeholder — where both the build-time
// localizer and the runtime binder match "data-i18n-attr:", so neither ever saw it and the English
// fallback shipped in every language. The hints are now paragraphs the fields point at, which also
// fixes what a placeholder could never do: stay put once there is something in the box.
test('the field hints are translated, and stay while you type', async ({ browser }) => {
	// Spanish, because the second half walks the real lobby: gotoLobbyHome follows the browser's
	// own language, and an English page would compare the hint against the wrong words.
	const page = await newPlayerPage(browser, 'es-ES');
	const es = appI18n('es').lobby as Record<string, string>;
	const en = appI18n('en').lobby as Record<string, string>;

	const html = await (await page.request.get(`${E2E_BASE_URL}/es/`)).text();
	for (const key of ['playerNamePlaceholder', 'gameCodePlaceholder']) {
		expect(html, `${key} reaches the Spanish page`).toContain(`>${es[key]}<`);
		expect(html, `${key} leaves no English behind`).not.toContain(`>${en[key]}<`);
	}

	await gotoLobbyHome(page);
	await page.click('#go-join-btn');
	const code = page.locator('#lobby-code-input');
	expect(await code.getAttribute('aria-describedby'), 'the field names its hint')
		.toBe('lobby-code-hint');
	await expect(page.locator('#lobby-code-hint')).toHaveText(es.gameCodePlaceholder);

	// The whole point of the change: a placeholder would be gone by now.
	await code.fill('ABC123');
	await expect(page.locator('#lobby-code-hint')).toBeVisible();
	await flushAxeAudit(page);
});

test('a saved Spanish choice moves the player off the default page, and stays there', async ({ browser }) => {
	const page = await newPlayerPage(browser, 'en-US');
	await page.context().addCookies([{ name: 'corro_language', value: 'es', url: E2E_BASE_URL }]);

	await page.goto('/');

	// The redirect leaves no history entry, so Back does not bounce them straight in again.
	await expect(page).toHaveURL(/\/es\/$/);
	await expect(page.locator('html')).toHaveAttribute('lang', 'es');
	// Asserted on the document rather than a specific control: the lobby swaps between panels,
	// so which element is visible depends on state that has nothing to do with language.
	await expect(page.locator('body')).toContainText(appI18n('es').lobby.createGame);
	await flushAxeAudit(page);
});

test('a first visit follows the browser language, with no choice saved yet', async ({ browser }) => {
	// A Spanish speaker's first visit must not be in English just because they have never
	// clicked the selector.
	const page = await newPlayerPage(browser, 'es-ES');

	await page.goto('/');

	await expect(page).toHaveURL(/\/es\/$/);
	await expect(page.locator('html')).toHaveAttribute('lang', 'es');
	await flushAxeAudit(page);
});

test('applying a language takes the player to that language own page, and it sticks', async ({ browser }) => {
	// The selector used to retranslate the page in place, leaving a Spanish lobby served from the
	// English URL: nothing to share, nothing to bookmark, and a reload was the only way to agree.
	const page = await newPlayerPage(browser, 'es-ES');
	await page.goto('/');
	await expect(page).toHaveURL(/\/es\/$/);

	await page.locator('#language-selector').selectOption('en');
	await page.locator('#language-apply-btn').click();

	await expect(page).toHaveURL(new RegExp(`${E2E_BASE_URL}/?$`));
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');

	// The choice must be SAVED before the navigation: the root page redirects by cookie, so a stale
	// one would bounce the player straight back into the language they just left.
	await page.goto('/');
	await expect(page).toHaveURL(new RegExp(`${E2E_BASE_URL}/?$`));
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');
	await flushAxeAudit(page);
});

test('an English browser stays on the default page, so a crawler can index it', async ({ browser }) => {
	// The redirect is decided in the BROWSER, from a cookie or navigator.language. A crawler
	// sends no cookie and reports English, so it is never bounced and always indexes `/` —
	// hreflang is what tells it `/es/` exists.
	const page = await newPlayerPage(browser, 'en-US');

	await page.goto('/');

	await expect(page).toHaveURL(new RegExp(`${E2E_BASE_URL}/?$`));
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');
	await flushAxeAudit(page);
});

test('both language versions cross-link each other for search engines', async ({ browser }) => {
	const page = await newPlayerPage(browser, 'en-US');

	for (const path of ['/', '/es/']) {
		const html = await (await page.request.get(`${E2E_BASE_URL}${path}`)).text();
		expect(html, `${path} does not point at English`).toContain('hreflang="en" href="/"');
		expect(html, `${path} does not point at Spanish`).toContain('hreflang="es" href="/es/"');
		expect(html, `${path} declares no x-default`).toContain('hreflang="x-default"');
	}
});

test('a private game session is marked non-indexable', async ({ browser }) => {
	const page = await newPlayerPage(browser, 'en-US');

	const html = await (await page.request.get(`${E2E_BASE_URL}/board.html`)).text();

	expect(html).toContain('noindex');
});
