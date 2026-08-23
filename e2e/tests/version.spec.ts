// version.spec.ts — the footer says which build this is, and the dialog behind it says it in words.

import { test, expect } from '../helpers/test';
import { flushAxeAudit } from '../helpers/axeAudit';
import { gotoLobbyHome, newPlayerPage } from '../helpers/game';

/** The stamp the E2E server is started with (see playwright.config.ts). */
const VERSION = '20260823-001';
const COMMIT = '0123456789abcdef0123456789abcdef01234567';

test('the footer states the build, and opening it explains what that means', async ({ browser }) => {
	const page = await newPlayerPage(browser);
	await gotoLobbyHome(page);

	// A button, not a link: there is nowhere to navigate to, and it announces what it opens.
	const entry = page.locator('#site-version-btn');
	await expect(entry).toBeVisible();
	await expect(entry).toHaveText(`Versión ${VERSION}`);
	await expect(entry).toHaveAttribute('aria-haspopup', 'dialog');
	expect(await entry.evaluate(element => element.tagName)).toBe('BUTTON');
	await flushAxeAudit(page);

	await entry.click();
	const dialog = page.locator('.game-dialog.dialog-version');
	await expect(dialog).toBeVisible();
	// The code alone is not the answer: the dialog states the build as a sentence, with the date
	// in the reader's own language, and offers the commit as the way to see what actually changed.
	await expect(dialog).toContainText(`Versión ${VERSION}, desplegada el`);
	await expect(dialog).toContainText('de agosto de 2026');

	const commitLink = dialog.locator('a');
	await expect(commitLink).toHaveText('Ver el commit 0123456 en GitHub');
	await expect(commitLink).toHaveAttribute('href', `https://github.com/kastwey/corro/commit/${COMMIT}`);
	await expect(commitLink).toHaveAttribute('target', '_blank');
	await expect(commitLink).toHaveAttribute('rel', 'noopener noreferrer');
	// The new window is announced before it opens, and the name still contains what is written.
	await expect(commitLink).toHaveAccessibleName(
		'Ver el commit 0123456 en GitHub, se abre en una ventana nueva');
	await flushAxeAudit(page);

	// Escape closes it and focus comes back to the control that opened it, not to the top of
	// the page — somebody who pressed the version entry is still standing in the footer.
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	await expect(entry).toBeFocused();
	await flushAxeAudit(page);

	// Both palettes: the entry and the dialog are read in whichever one the player chose.
	await page.locator('#theme-toggle').click();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
	await flushAxeAudit(page);

	await entry.click();
	await expect(dialog).toBeVisible();
	await expect(dialog).toContainText(`Versión ${VERSION}, desplegada el`);
	await flushAxeAudit(page);
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
});

test('a build that was never stamped shows no version at all', async ({ browser }) => {
	const page = await newPlayerPage(browser);
	// What a clone run from source answers: there is no stamp, so there is nothing to say.
	await page.route('**/api/config/version', route => route.fulfill({
		status: 200,
		contentType: 'application/json',
		body: JSON.stringify({ configured: false }),
	}));

	await gotoLobbyHome(page);
	await expect(page.locator('#site-version')).toBeHidden();
	// The rest of the footer is unaffected: the quiet state is a footer with one fact fewer.
	await expect(page.locator('.app-footer__brand')).toBeVisible();
	await flushAxeAudit(page);
});
