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

	await ana.click('#table-add-bot');
	const nameDialog = ana.locator('.game-dialog.dialog-bot-name');
	await expect(nameDialog).toBeVisible();
	await nameDialog.locator('#bot-name-input').fill('Bot Minero');
	await nameDialog.locator('.btn-primary').click();
	await startGame(ana, [ana]);
	// A match now starts IN the page the table was showing, so "the board is up" no longer implies
	// "the deal has landed". Anchor on the known opening hand before touching it: these tests count
	// cards from wherever they start, and a baseline read mid-deal is off by one for the whole test.
	await expect(ana.locator('.hand-card:not(.hand-card--info)')).toHaveCount(8);
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
	// Waiting for the turn to come BACK to Ana is the whole difficulty of this test, and the seat
	// indicator cannot do it. `expect(anaTurn).toBeVisible()` asks "does the seat say Ana?", which
	// is still true for the instant between her action and the repaint that moves the turn — so it
	// returns immediately and the next click lands during the bot's ~50ms turn. From the trace of
	// a failing run, eight milliseconds apart:
	//
	//   POLITE     "Escondes el gris… de vuelta en la galería. Turno de Bot Minero."
	//   ASSERTIVE  "No es tu turno."                       ← the refused draw
	//   ASSERTIVE  "Bot Minero roba una carta. Es tu turno."
	//
	// The server was right to refuse it and said so; the test was the one acting out of turn. It
	// only shows up under a loaded machine (about one full-suite run in four, never in isolation),
	// because the window is exactly the gap between the click and the repaint.
	//
	// So the wait hangs off the announcement log, which only ever GROWS and therefore cannot be
	// missed by polling the way a transient DOM state can: the turn is Ana's again once the bot
	// has taken one more draw than it had before she acted.
	const botDraws = () => ana.evaluate(() =>
		((window as unknown as { __announcements?: string[] }).__announcements ?? [])
			.filter(line => /Bot Minero roba una carta/i.test(line)).length);
	const afterBotPlays = async (before: number) =>
		await expect.poll(botDraws, { timeout: 15_000 }).toBeGreaterThan(before);

	// Hiding the bomb ENDED Ana's turn — this is where the failure actually began, before the loop
	// had even started.
	await afterBotPlays(0);

	for (let turn = 0; turn < 15; turn++) {
		// Sampled HERE, once the turn is back with Ana — not once before the loop. The hand also
		// changes while the bot plays between her turns, so a baseline captured earlier is already
		// stale by the first draw, and every assertion after it is off by one.
		const before = await cards.count();
		const botDrawsBefore = await botDraws();
		await ana.locator('.hand-panel__draw').click();
		await expect(cards).toHaveCount(before + 1);
		// Her draw ended her turn too, so it is hers again only once the bot has answered. Anchored
		// on the count taken just above rather than on the loop index, so a bot that needs two
		// draws to get through a bomb cannot leave the counter running ahead of the turns.
		await afterBotPlays(botDrawsBefore);
		await expect(anaTurn).toBeVisible();
	}
	const favor = ana.locator('.hand-card:not(.hand-card--info)', { hasText: 'Pico prestado' }).first();
	await expect(favor).toBeVisible();
	const handBefore = await cards.count();

	await favor.focus();
	await ana.keyboard.press('Enter');
	await expect(ana.locator('.popup-menu[role="menu"]')).toHaveCount(0);
	await expectAnnouncement(ana, /Pides un favor a Bot Minero/i);

	// Paying the Favor is an off-turn bot obligation. Its chosen card reaches Ana and the
	// pending interaction clears, so she can draw and finish the same turn normally.
	await expectAnnouncement(ana, /Bot Minero te da/i);
	await expect(cards).toHaveCount(handBefore);
	await ana.locator('#board').focus();
	await ana.keyboard.press(' ');
	await expectAnnouncement(ana, /Robas /i);
});
