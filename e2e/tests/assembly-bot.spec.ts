// assembly-bot.spec.ts — a HUMAN versus a BOT on "Taller Galáctico", end to end.
//
// The host seats a bot, starts with the two of them, installs a piece; the bot then plays
// its WHOLE turn unattended (its policy installs its own known Reactor) and hands the turn
// back. Driven entirely server-side (Services/Bots) — no client code plays for it.

import { test, expect } from '../helpers/test';
import { createGame, expectAnnouncement, newPlayerPage, resetDice, startGame } from '../helpers/game';

const BOARD = 'taller-galactico';

test.beforeEach(async () => {
	await resetDice();
});

test('the host seats a bot; it installs a module unattended and hands the turn back', async ({ browser }) => {
	const ana = await newPlayerPage(browser);
	await createGame(ana, 'Ana', BOARD);

	await ana.click('#add-bot-btn');
	const nameDialog = ana.locator('.game-dialog.dialog-bot-name');
	await expect(nameDialog).toBeVisible();
	await nameDialog.locator('#bot-name-input').fill('Chatarrín');
	await nameDialog.locator('.btn-primary').click();
	await expect(ana.locator('#host-player-list')).toContainText('Chatarrín');

	await startGame(ana, [ana]);

	// Ana installs her known Reactor (identity deal → first row).
	await ana.locator('#board').focus();
	await ana.keyboard.press('Enter');
	await expectAnnouncement(ana, /Instalas un módulo|instala un módulo/);

	// The BOT takes over: its turn is spoken like any player's, and the turn comes back.
	await expectAnnouncement(ana, /Turno de Chatarrín/);
	await expectAnnouncement(ana, /Chatarrín instala un módulo/);
	await expectAnnouncement(ana, /Es tu turno/);
});
