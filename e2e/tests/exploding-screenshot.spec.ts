// exploding-screenshot.spec.ts — capture the exploding-family board on the shipped
// "The Mine" mining package. Doubles as a smoke test that the whole stack — server rulebook,
// package SVG overrides and client family — loads and renders.

import { test, expect } from '../helpers/test';
import { flushAxeAudit } from '../helpers/axeAudit';
import { createGame, joinGame, newPlayerPage, resetDice, startGame } from '../helpers/game';
import { captureScreenshot } from '../helpers/screenshot';

const BOARD = 'the-mine';

test.beforeEach(async () => {
	await resetDice();
});

test('exploding: board and the defuse picker (screenshots)', async ({ browser }, testInfo) => {
	// Unlike the rule-flow suite, this visual smoke test deliberately enables motion so it
	// verifies the animated presentation as well as the reduced-motion tableau.
	const ana = await newPlayerPage(browser, 'es-ES', { reducedMotion: 'no-preference' });
	const berto = await newPlayerPage(browser, 'es-ES', { reducedMotion: 'no-preference' });

	const code = await createGame(ana, 'Ana', BOARD);
	await joinGame(berto, code, 'Berto');
	await startGame(ana, [ana, berto]);

	// The table at start: 8-card hands (1 defuse + 7), the draw affordance (Space), no dice.
	await expect(ana.locator('.hand-card:not(.hand-card--info)')).toHaveCount(8);
	await expect(ana.locator('.hand-card--info')).toHaveCount(0);
	await expect(ana.locator('.exploding-draw .xcard__back-label')).toHaveText(/^\d+$/);
	await expect(ana.locator('.exploding-hand [data-card-art="package"]')).toHaveCount(8);
	await expect(ana.locator('.exploding-hand [data-card-art="neutral"]')).toHaveCount(0);
	await expect(ana.locator('.hand-panel__draw')).toBeVisible();
	await expect(ana.locator('.dice-control')).toBeHidden();
	await captureScreenshot(ana, testInfo, 'exploding-01-start.png');

	// Ana's first draw is the planted bomb. Its package-owned defuse face gets a two-second
	// visual beat of its own before the focus-taking depth picker opens.
	await ana.locator('#board').focus();
	await ana.keyboard.press(' ');
	const reveal = ana.locator('.exploding-reveal--defusing');
	await expect(reveal).toBeVisible();
	await expect(reveal).not.toHaveClass(/exploding-reveal--static/);
	await expect(ana.locator('.exploding-reveal .xcard--bomb [data-card-art="package"]')).toBeVisible();
	await expect(ana.locator('.exploding-reveal__defuse .xcard--defuse [data-card-art="package"]')).toBeVisible();
	const animationNames = await reveal.evaluate(element => [
		getComputedStyle(element.querySelector('.exploding-reveal__bomb')!).animationName,
		getComputedStyle(element.querySelector('.exploding-reveal__defuse')!).animationName,
		getComputedStyle(element.querySelector('.exploding-reveal__safe')!).animationName,
	]);
	expect(animationNames).toEqual([
		'exploding-bomb-defused', 'exploding-defuse-drop', 'exploding-safe-pop',
	]);
	await expect(ana.locator('.popup-menu[role="menu"]')).toHaveCount(0);
	await ana.waitForTimeout(800); // capture the package defuse card halfway through its drop
	await captureScreenshot(ana, testInfo, 'exploding-02-defusing.png');

	await expect(ana.locator('.popup-menu[role="menu"]')).toBeVisible();
	await captureScreenshot(ana, testInfo, 'exploding-03-defuse-picker.png');

	// Dark mode via the app's own toggle (it sets <html data-theme="dark">, not a media query).
	await ana.locator('#theme-toggle').click();
	await flushAxeAudit(ana);
	await captureScreenshot(ana, testInfo, 'exploding-04-dark.png');
});
