// exploding-screenshot.spec.ts — capture the exploding-family board on the
// shipped "La Mina" mining package. Doubles as a smoke test that the whole stack — server
// rulebook + package + client family — loads and renders a two-player game.

import { test, expect } from '../helpers/test';
import { createGame, joinGame, newPlayerPage, resetDice, startGame } from '../helpers/game';

const BOARD = 'la-mina';

test.beforeEach(async () => {
	await resetDice();
});

test('exploding: board and the defuse picker (screenshots)', async ({ browser }) => {
	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);

	const code = await createGame(ana, 'Ana', BOARD);
	await joinGame(berto, code, 'Berto');
	await startGame(ana, [ana, berto]);

	// The table at start: 8-card hands (1 defuse + 7), the draw affordance (Space), no dice.
	await expect(ana.locator('.hand-card:not(.hand-card--info)')).toHaveCount(8);
	await expect(ana.locator('.hand-panel__draw')).toBeVisible();
	await expect(ana.locator('.dice-control')).toBeHidden();
	await ana.screenshot({ path: 'exploding-01-start.png', fullPage: true });

	// Ana's first draw is the planted bomb; she holds a defuse, so the depth picker opens.
	await ana.locator('#board').focus();
	await ana.keyboard.press(' ');
	await expect(ana.locator('.popup-menu[role="menu"]')).toBeVisible();
	await ana.screenshot({ path: 'exploding-02-defuse-picker.png', fullPage: true });

	// Dark mode via the app's own toggle (it sets <html data-theme="dark">, not a media query).
	await ana.locator('#theme-toggle').click();
	await ana.screenshot({ path: 'exploding-03-dark.png', fullPage: true });
});
