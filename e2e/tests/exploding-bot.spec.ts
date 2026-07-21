// exploding-bot.spec.ts — a HUMAN versus a BOT on "La Mina", end to end.
//
// These regressions follow the real lobby, SignalR, Nope-window timer and bot driver: a bot
// reinserts a defused bomb safely in the middle and resolves an off-turn Favor without a wedge.

import { test, expect, type Browser } from '../helpers/test';
import { createGame, expectAnnouncement, newPlayerPage, resetDice, startGame } from '../helpers/game';

const BOARD = 'the-mine';

test.beforeEach(async () => {
	await resetDice();
});

async function startHumanVsBot(browser: Browser) {
	const ana = await newPlayerPage(browser);
	await createGame(ana, 'Ana', BOARD);

	await ana.click('#add-bot-btn');
	const nameDialog = ana.locator('.game-dialog.dialog-bot-name');
	await expect(nameDialog).toBeVisible();
	await nameDialog.locator('#bot-name-input').fill('Bot Minero');
	await nameDialog.locator('.btn-primary').click();
	await startGame(ana, [ana]);
	return ana;
}

test('a bot reinserts its defused bomb in the middle instead of drawing it next turn', async ({ browser }) => {
	const ana = await startHumanVsBot(browser);

	// Put Ana's opening bomb on top so Bot Minero draws and defuses it. Its automatic
	// reinsertion must now use the middle of the 36-card remainder, not depth one.
	await ana.locator('#board').focus();
	await ana.keyboard.press(' ');
	await expectAnnouncement(ana, /Destapas gris.*cortas la mecha/i);
	await ana.locator('.popup-menu__item', { hasText: /Arriba/ }).click();
	await expectAnnouncement(ana, /Bot Minero destapa gris.*corta la mecha/i);

	const anaTurn = ana.locator('.exploding-seat--turn .exploding-seat__name', { hasText: 'Ana' });
	await expect(anaTurn).toBeVisible();

	// Ana consumes the first ordinary card above the reinserted bomb. With the old depth-one
	// strategy, the bot immediately drew the bomb here without a Defuse and lost. A middle
	// insertion leaves another ordinary card for its next draw and play continues.
	await ana.locator('.hand-panel__draw').click();
	await expectAnnouncement(ana, /Bot Minero roba una carta/i);
	await expect(ana.locator('.end-screen')).toBeHidden();
	await expect(anaTurn).toBeVisible();
});

test('a bot pays a Favor directed at it without wedging the game', async ({ browser }) => {
	const ana = await startHumanVsBot(browser);

	// The identity deal reaches Ana's Favor after the known opening and ordinary draws.
	// First move the planted bomb to the bottom so the deterministic sequence can continue.
	await ana.locator('#board').focus();
	await ana.keyboard.press(' ');
	await expectAnnouncement(ana, /Destapas gris.*cortas la mecha/i);
	await ana.locator('.popup-menu__item', { hasText: /Abajo del todo/ }).click();

	// The bot draws between Ana's turns. After enough deterministic draws, Ana receives
	// Pico prestado, the package's Favor card.
	const cards = ana.locator('.hand-card:not(.hand-card--info)');
	const anaTurn = ana.locator('.exploding-seat--turn .exploding-seat__name', { hasText: 'Ana' });
	let expectedCards = await cards.count();
	for (let turn = 0; turn < 15; turn++) {
		await expect(anaTurn).toBeVisible();
		await ana.locator('.hand-panel__draw').click();
		expectedCards++;
		await expect(cards).toHaveCount(expectedCards);
		await expect(anaTurn).toBeVisible();
	}
	const favor = ana.locator('.hand-card:not(.hand-card--info)', { hasText: 'Pico prestado' }).first();
	await expect(favor).toBeVisible();
	const handBefore = await cards.count();

	await favor.focus();
	await ana.keyboard.press('Enter');
	await ana.locator('.popup-menu__item', { hasText: 'Bot Minero' }).click();
	await expectAnnouncement(ana, /Ana pide un favor a Bot Minero/i);

	// Paying the Favor is an off-turn bot obligation. Its chosen card reaches Ana and the
	// pending interaction clears, so she can draw and finish the same turn normally.
	await expectAnnouncement(ana, /Bot Minero te da/i);
	await expect(cards).toHaveCount(handBefore);
	await ana.locator('#board').focus();
	await ana.keyboard.press(' ');
	await expectAnnouncement(ana, /Robas /i);
});
