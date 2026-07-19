// journey-bot.spec.ts — a HUMAN versus a BOT on "La Gran Ruta", end to end.
//
// One real browser, Spanish locale. The host seats a bot in the waiting room, starts with
// just the two of them, and plays a turn; the bot then completes its WHOLE turn unattended
// (draw → play/discard, announced like any player's) and hands the turn back. The bot is
// driven entirely server-side (Services/Bots) — no client code plays for it.

import { test, expect } from '../helpers/test';
import { createGame, expectAnnouncement, newPlayerPage, resetDice, startGame } from '../helpers/game';

const BOARD = 'la-gran-ruta';

test.beforeEach(async () => {
	await resetDice();
});

test('the host seats a bot; it plays its whole turn unattended and hands the turn back', async ({ browser }) => {
	const ana = await newPlayerPage(browser);
	const code = await createGame(ana, 'Ana', BOARD);
	void code;

	// The bot takes a chair: the host NAMES it in the dialog (or rolls the silly-name
	// hat), it shows tagged in the room — and counts towards the start guard.
	await ana.click('#add-bot-btn');
	const nameDialog = ana.locator('.game-dialog.dialog-bot-name');
	await expect(nameDialog).toBeVisible();
	await nameDialog.locator('#bot-name-random').click();
	await expect(nameDialog.locator('#bot-name-input')).not.toHaveValue(''); // the hat filled it
	await nameDialog.locator('#bot-name-input').fill('Doña Rotonda');
	await nameDialog.locator('.btn-primary').click();
	await expect(ana.locator('#host-player-list')).toContainText('Doña Rotonda');
	await expect(ana.locator('#host-player-list')).toContainText('(bot)');

	// The host-only remove control is another waiting-room state: remove the bot, verify the
	// chair returns, then seat it again so the gameplay half of this scenario remains unchanged.
	await ana.locator('#host-player-list .player-item', { hasText: 'Doña Rotonda' })
		.locator('.player-item__remove-bot').dispatchEvent('click');
	await expect(ana.locator('#host-player-list')).not.toContainText('Doña Rotonda');
	await ana.locator('#add-bot-btn').dispatchEvent('click');
	const replacementDialog = ana.locator('.game-dialog.dialog-bot-name');
	await replacementDialog.locator('#bot-name-input').fill('Doña Rotonda');
	await replacementDialog.locator('.btn-primary').click();
	await expect(ana.locator('#host-player-list')).toContainText('Doña Rotonda');

	await startGame(ana, [ana]);

	// Ana's turn: draw, then play her known As del volante (identity deal → first row).
	await ana.locator('#board').focus();
	await ana.keyboard.press(' ');
	await expectAnnouncement(ana, /Robas:/);
	await ana.keyboard.press('Enter');
	await expectAnnouncement(ana, /¡Te coronas como As del volante!/);

	// The BOT takes over — its turn is spoken like any player's, no one at the keyboard:
	// it draws, plays, and hands the turn back (Ana hears the first-person turn line).
	await expectAnnouncement(ana, /Turno de Doña Rotonda/);
	await expectAnnouncement(ana, /Doña Rotonda roba una carta/);
	await expectAnnouncement(ana, /Es tu turno/);
});
