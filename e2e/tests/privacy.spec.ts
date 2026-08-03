// privacy.spec.ts — the footer leads to an ordinary localized document page, not a dialog.

import { test, expect } from '../helpers/test';
import { flushAxeAudit } from '../helpers/axeAudit';
import { gotoLobbyHome, newPlayerPage } from '../helpers/game';
import { E2E_BASE_URL } from '../playwright.config';

test('privacy is a real link to an Axe-clean localized document page', async ({ browser }) => {
	const page = await newPlayerPage(browser);
	await gotoLobbyHome(page);

	const privacyLink = page.locator('#privacy-link');
	await expect(privacyLink).toBeVisible();
	await expect(privacyLink).toHaveAttribute('href', '/es/privacy/');
	expect(await privacyLink.evaluate(element => element.tagName)).toBe('A');

	// Hold the document request so the loading state is a real reached state, not a DOM flash that
	// only exists between two task turns. The response then continues to the real server endpoint.
	let releaseNotice: (() => void) | undefined;
	let noticeRequested!: () => void;
	const requested = new Promise<void>(resolve => { noticeRequested = resolve; });
	await page.route('**/api/config/privacy?language=es', async route => {
		const held = new Promise<void>(resolve => { releaseNotice = resolve; });
		noticeRequested();
		await held;
		await route.continue();
	}, { times: 1 });

	await privacyLink.click();
	await expect(page).toHaveURL(`${E2E_BASE_URL}/es/privacy/`);
	await expect(page.locator('#privacy-loading')).toBeVisible();
	await expect(page.locator('#privacy-main')).toHaveAttribute('aria-busy', 'true');
	await flushAxeAudit(page);
	// The page paints "loading" before it issues the fetch, so reaching that state proves nothing
	// about the interceptor having run. Waiting for the hold to actually be in place is what makes
	// the release safe — without it this raced, and lost as "releaseNotice is not a function".
	await requested;
	releaseNotice!();

	await expect(page.locator('#privacy-document')).toBeVisible();
	await expect(page.locator('#privacy-loading')).toBeHidden();
	await expect(page.locator('#privacy-main')).toHaveAttribute('aria-busy', 'false');
	await expect(page.locator('main')).toHaveCount(1);
	await expect(page.locator('h1')).toHaveText('Aviso de privacidad');
	await expect(page.locator('#privacy-document')).toContainText('E2E Corro Operator');
	await expect(page.locator('#privacy-document')).toContainText('privacy@e2e.invalid');
	await expect(page.locator('#privacy-document dialog')).toHaveCount(0);
	await expect(page.locator('.board-help__contents')).toContainText('Contenido');
	// The SAME control the lobby has, not a row of links: a combobox that reports its own value,
	// already showing the language this page was built in.
	await expect(page.locator('#language-selector')).toHaveValue('es');
	await expect(page.locator('#language-selector')).toHaveAccessibleName('Seleccionar idioma');
	await expect(page.locator('[data-locale-home]')).toHaveAttribute('href', '/es/');
	await flushAxeAudit(page);

	// The document honours and controls both palettes rather than inheriting dialog chrome.
	await page.locator('#theme-toggle').click();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	await flushAxeAudit(page);

	// Long policy text must remain a single vertical reading flow on a phone-sized viewport.
	await page.setViewportSize({ width: 360, height: 800 });
	const extent = await page.evaluate(() => ({
		client: document.documentElement.clientWidth,
		scroll: document.documentElement.scrollWidth,
	}));
	expect(extent.scroll).toBeLessThanOrEqual(extent.client);
	await flushAxeAudit(page);

	// Applying a language navigates to another real document URL — the page BUILT in it — and
	// remembers the choice for the lobby, exactly as the same control does there.
	await page.locator('#language-selector').selectOption('en');
	await page.locator('#language-apply-btn').click();
	await expect(page).toHaveURL(`${E2E_BASE_URL}/privacy/`);
	await expect(page.locator('h1')).toHaveText('Privacy notice');
	await expect(page.locator('#language-selector')).toHaveValue('en');
	await expect(page.locator('[data-locale-home]')).toHaveAttribute('href', '/');
	await expect(page.locator('#privacy-document')).toContainText('E2E Corro Operator');
});

test('privacy page failure is a persistent, Axe-clean document state', async ({ browser }) => {
	const page = await newPlayerPage(browser);
	await page.route('**/api/config/privacy?language=es', route => route.fulfill({
		status: 503,
		contentType: 'application/json',
		body: JSON.stringify({ configured: false }),
	}));

	await page.goto('/es/privacy/');
	await expect(page.locator('#privacy-unavailable')).toBeVisible();
	await expect(page.locator('#privacy-loading')).toBeHidden();
	await expect(page.locator('#privacy-document')).toBeHidden();
	await expect(page.locator('#privacy-main')).toHaveAttribute('aria-busy', 'false');
	await expect(page.locator('#privacy-unavailable h2')).toHaveText('No se pudo cargar el aviso');
	await flushAxeAudit(page);
});
