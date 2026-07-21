// shedding-bot.spec.ts — a HUMAN versus a BOT on "Four Colours", end to end.
//
// The host seats a bot and starts. Ana opens on the colour; the bot answers unattended
// (its policy sheds across colours by VALUE — the known mirrored hand makes its choice
// deterministic: Verde 7 on Amarillo 7) and the turn comes back. Driven entirely
// server-side (Services/Bots) — no client code plays for it.

import { test, expect } from '../helpers/test';
import { createGame, expectAnnouncement, newPlayerPage, resetDice, startGame } from '../helpers/game';

const BOARD = 'four-colours';

test.beforeEach(async () => {
	await resetDice();
});

test('the host seats a bot; it sheds by value unattended and hands the turn back', async ({ browser }) => {
	const ana = await newPlayerPage(browser);
	await createGame(ana, 'Ana', BOARD);

	await ana.click('#add-bot-btn');
	const nameDialog = ana.locator('.game-dialog.dialog-bot-name');
	await expect(nameDialog).toBeVisible();
	await nameDialog.locator('#bot-name-input').fill('Crupier');
	await nameDialog.locator('.btn-primary').click();
	await expect(ana.locator('#host-player-list')).toContainText('Crupier');

	await startGame(ana, [ana]);

	// Ana opens on the colour in force (Amarillo 0 flipped).
	await ana.locator('#board').focus();
	await ana.locator('.hand-card:not(.hand-card--info)', { hasText: /Amarillo 7/ }).first().focus();
	await ana.keyboard.press('Enter');
	await expectAnnouncement(ana, /Juegas Amarillo 7/);

	// The bot answers by VALUE across colours, and the turn returns to Ana.
	await expectAnnouncement(ana, /Crupier juega Verde 7/);
	await expectAnnouncement(ana, /Es tu turno|Turno de Ana/);
});
