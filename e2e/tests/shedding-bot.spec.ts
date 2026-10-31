// shedding-bot.spec.ts — a HUMAN versus a BOT on "Four Colours", end to end.
//
// The host seats a bot and starts. Ana opens on the colour; the bot answers unattended
// (its policy sheds across colours by VALUE — the known mirrored hand makes its choice
// deterministic: 7 verde on 7 amarillo) and the turn comes back. Driven entirely
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

	await ana.click('#table-add-bot');
	const nameDialog = ana.locator('.game-dialog.dialog-bot-name');
	await expect(nameDialog).toBeVisible();
	await nameDialog.locator('#bot-name-input').fill('Crupier');
	await nameDialog.locator('.btn-primary').click();
	await expect(ana.locator('#table-players')).toContainText('Crupier');

	await startGame(ana, [ana]);

	// Ana opens on the colour in force (0 amarillo flipped).
	await ana.locator('#board').focus();
	await ana.locator('.hand-card:not(.hand-card--info)', { hasText: /7 amarillo/ }).first().focus();
	await ana.keyboard.press('Enter');
	await expectAnnouncement(ana, /Juegas un 7 amarillo/);

	// The bot answers by VALUE across colours, and the turn returns to Ana.
	await expectAnnouncement(ana, /Crupier juega un 7 verde/);
	await expectAnnouncement(ana, /Es tu turno|Turno de Ana/);
});
