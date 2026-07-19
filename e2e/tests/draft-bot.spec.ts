// draft-bot.spec.ts — a HUMAN versus a BOT on "Gran Tapeo", end to end.
//
// The host seats a bot and starts. There is NO turn in this family: the bot commits its
// secret pick unattended as soon as the round opens (its greedy policy grabs the brava
// sauce — a multiplier with a full tray ahead outshines a 3-point skewer), the human
// picks second, and the reveal fires by itself. Driven entirely server-side
// (Services/Bots) — no client code plays for it.

import { test, expect } from '../helpers/test';
import { createGame, expectAnnouncement, newPlayerPage, resetDice, startGame } from '../helpers/game';

const BOARD = 'gran-tapeo';

test.beforeEach(async () => {
	await resetDice();
});

test('the host seats a bot; it picks unattended and the reveal fires on the last pick', async ({ browser }) => {
	const ana = await newPlayerPage(browser);
	await createGame(ana, 'Ana', BOARD);

	await ana.click('#add-bot-btn');
	const nameDialog = ana.locator('.game-dialog.dialog-bot-name');
	await expect(nameDialog).toBeVisible();
	await nameDialog.locator('#bot-name-input').fill('Camarero');
	await nameDialog.locator('.btn-primary').click();
	await expect(ana.locator('#host-player-list')).toContainText('Camarero');

	await startGame(ana, [ana]);

	// The bot needs no turn: it has cards and no pick, so it commits on its own —
	// usually before Ana's browser even lands on the board (that early "Camarero ya ha
	// pedido" line is not assertable). Ana answers with her known skewer; once BOTH
	// picks are in, the reveal fires by itself.
	await ana.locator('#board').focus();
	await ana.locator('.hand-card:not(.hand-card--info)', { hasText: /Pincho de gamba/ }).first().focus();
	await ana.keyboard.press('Enter');
	await expectAnnouncement(ana, /Pides Pincho de gamba/);

	await expectAnnouncement(ana, /¡Toda la mesa ha pedido!/);
	await expectAnnouncement(ana, /Camarero se sirve Salsa brava/);
	await expectAnnouncement(ana, /Gira la cinta de bandejas: 9 tapas/);
	await expect(ana.locator('#board .draft-table').nth(1)).toContainText('Salsa brava');
});
