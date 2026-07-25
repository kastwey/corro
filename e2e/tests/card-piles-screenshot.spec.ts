// card-piles-screenshot.spec.ts — visual review of the shared full-size card-table piles.

import { test, expect, type Page } from '../helpers/test';
import { flushAxeAudit } from '../helpers/axeAudit';
import { createGame, joinGame, newPlayerPage, resetDice, startGame } from '../helpers/game';
import { captureScreenshot } from '../helpers/screenshot';

async function forceTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
	await page.evaluate(value => {
		document.documentElement.setAttribute('data-theme', value);
		localStorage.setItem('corro-theme', value);
	}, theme);
	await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
}

async function openBoard(browser: Parameters<typeof newPlayerPage>[0], board: string) {
	const ana = await newPlayerPage(browser, 'es-ES');
	const berto = await newPlayerPage(browser, 'es-ES');
	const code = await createGame(ana, 'Ana', board);
	await joinGame(berto, code, 'Berto');
	await startGame(ana, [ana, berto]);
	return ana;
}

test.beforeEach(async () => {
	await resetDice();
});

test('journey piles: full desktop cards and responsive mobile cards', async ({ browser }, testInfo) => {
	const page = await openBoard(browser, 'great-route');
	await forceTheme(page, 'light');
	const pile = page.locator('.journey-centre__pile .jcard').first();
	let box = await pile.boundingBox();
	expect(box?.width).toBe(112);
	expect(box?.height).toBe(156);
	await captureScreenshot(page, testInfo, 'journey-piles-light-desktop.png');

	await page.setViewportSize({ width: 390, height: 844 });
	box = await pile.boundingBox();
	expect(box?.width).toBe(92);
	expect(box?.height).toBe(128);
	const mobileOverflow = await page.locator('#board').evaluate(board => board.scrollWidth - board.clientWidth);
	expect(mobileOverflow, 'journey dashboard or piles overflow the mobile board').toBeLessThanOrEqual(1);
	await flushAxeAudit(page);
	await captureScreenshot(page, testInfo, 'journey-piles-light-mobile.png');

	await page.setViewportSize({ width: 1280, height: 720 });
	await forceTheme(page, 'dark');
	await flushAxeAudit(page);
	await captureScreenshot(page, testInfo, 'journey-piles-dark-desktop.png');
});

test('shedding piles: full desktop cards and responsive mobile cards', async ({ browser }, testInfo) => {
	const page = await openBoard(browser, 'four-colours');
	await forceTheme(page, 'light');
	const pile = page.locator('.shedding-piles .gcard').first();
	let box = await pile.boundingBox();
	expect(box?.width).toBe(112);
	expect(box?.height).toBe(156);
	await captureScreenshot(page, testInfo, 'shedding-piles-light-desktop.png');

	await page.setViewportSize({ width: 390, height: 844 });
	box = await pile.boundingBox();
	expect(box?.width).toBe(92);
	expect(box?.height).toBe(128);
	await flushAxeAudit(page);
	await captureScreenshot(page, testInfo, 'shedding-piles-light-mobile.png');

	await page.setViewportSize({ width: 1280, height: 720 });
	await forceTheme(page, 'dark');
	await flushAxeAudit(page);
	await captureScreenshot(page, testInfo, 'shedding-piles-dark-desktop.png');
});
