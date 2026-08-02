// bonus-die.spec.ts — optional property-family third die, real server and browser.

import { test, expect } from '../helpers/test';
import { flushAxeAudit } from '../helpers/axeAudit';
import {
	actionButton, createGame, joinGame, newPlayerPage, resetDice, scriptDice, startGame,
} from '../helpers/game';

test.beforeEach(async () => {
	await resetDice();
});

test('bonus die: V reports stock, Bus shows a reconnect-safe choice and moves by the selection', async ({ browser }) => {
	const ana = await newPlayerPage(browser, 'es-ES');
	const berto = await newPlayerPage(browser, 'es-ES');
	const code = await createGame(ana, 'Ana', 'galactic-empire', {
		houseRules: { bonusDie: true },
	});
	await joinGame(berto, code, 'Berto');
	await startGame(ana, [ana, berto]);

	// V uses the board's own construction nouns (cúpulas/ciudades), not hardcoded houses/hotels.
	await ana.locator('#board').focus();
	await ana.keyboard.press('v');
	await expect(ana.locator('#sr-live-assertive')).toContainText(/32 piezas de cúpula.*12 piezas de ciudad/i);

	// Bonus die activates after lap one. Reach that precondition through the E2E-only setup API,
	// then script two white dice + face index 5 (Bus).
	const gameId = await ana.evaluate(() => {
		const games = JSON.parse(localStorage.getItem('corro_games') ?? '[]');
		return games[0]?.gameId as string | undefined;
	});
	expect(gameId).toBeTruthy();
	const setup = await ana.request.post(`/e2e/games/${gameId}/current-player/laps/1`);
	expect(setup.ok()).toBe(true);
	// Whoever's turn it is: the action bar offers a roll only to them, which is exactly the
	// question being asked here (the header's second roll button used to answer it less precisely,
	// going on isMyTurn alone, and is gone).
	const roller = await actionButton(ana, 'rollDice').count() > 0 ? ana : berto;
	await expect(actionButton(roller, 'rollDice')).toBeVisible();
	await scriptDice(2, 3, 5);
	await actionButton(roller, 'rollDice').click();

	const bonus = roller.locator('.dice-tray .die--bonus');
	await expect(bonus).toBeVisible();
	await expect(bonus).toHaveAttribute('data-face', 'bus');
	await expect(bonus.locator('.die-glyph')).toHaveText('B');

	const choice = roller.locator('#game-dialog-nonmodal.dialog-bus-choice');
	await expect(choice).toBeVisible();
	await expect(choice).toContainText('Transbordador Cuántico');
	const buttons = choice.locator('.dialog-buttons button');
	await expect(buttons).toHaveCount(3);
	await expect(buttons.nth(2)).toContainText('5');
	await flushAxeAudit(roller);

	await buttons.nth(2).click();
	await expect(choice).toBeHidden();
	await expect(roller.locator('#board .square[data-index="5"] .player-token')).toHaveCount(1);
});