// property-bot.spec.ts — a HUMAN versus a BOT on the galactic (property) board, end to end.
//
// The property family never seated bots before; now it does. The host adds one and starts. Ana
// takes her turn, then the bot plays its OWN turn UNATTENDED — rolls, buys the property it lands
// on, ends the turn — and control returns to Ana. The real point is deadlock-safety: a bot seat
// must never wedge the table, so its turn always completes and hands back. Driven entirely
// server-side (Services/Bots) — no client code plays for it.

import { test, expect } from '../helpers/test';
import {
	actionButton,
	buyPendingProperty,
	createGame,
	expectAnnouncement,
	newPlayerPage,
	resetDice,
	roll,
	scriptDice,
	startGame,
} from '../helpers/game';

const BOARD = 'imperio-galactico';

test.beforeEach(async () => {
	await resetDice();
});

test('the host seats a bot on a property board; it plays its turn unattended and hands it back', async ({ browser }) => {
	const ana = await newPlayerPage(browser);
	await createGame(ana, 'Ana', BOARD);

	// The "add bot" chair now exists for property (it was hidden before — no bot policy).
	await ana.click('#add-bot-btn');
	const nameDialog = ana.locator('.game-dialog.dialog-bot-name');
	await expect(nameDialog).toBeVisible();
	await nameDialog.locator('#bot-name-input').fill('Crupier');
	await nameDialog.locator('.btn-primary').click();
	await expect(ana.locator('#host-player-list')).toContainText('Crupier');

	await startGame(ana, [ana]);

	// Ana rolls to square 3, buys it, and ends her turn.
	await roll(ana, 1, 2);
	await buyPendingProperty(ana);
	// Queue the BOT's dice before handing it the turn (2+4 = square 6, a buyable it can afford).
	await scriptDice(2, 4);
	await actionButton(ana, 'endTurn').click();

	// The bot plays unattended — Ana HEARS it act — and the turn returns to her (no wedge).
	await expectAnnouncement(ana, /Crupier/);
	await expectAnnouncement(ana, /Es tu turno|Turno de Ana/);
});
