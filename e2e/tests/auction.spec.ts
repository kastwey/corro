// auction.spec.ts — decline-triggered auction, end to end.
//
// The galactic board plays with auctionOnDecline: ending the turn with an unbought
// pending purchase puts the square under the hammer for everyone. This scenario has
// no single originating bug — it covers the whole modal class the family game
// exercised: the auction dialog opens on EVERY player's screen, names the square
// from the package i18n, resolves as soon as the last rival passes (no timer wait),
// and the win is announced in the board's currency with ownership propagated.

import { test, expect } from '../helpers/test';
import {
	actionButton,
	appI18n,
	createGame,
	declineByEndingTurn,
	expectAnnouncement,
	joinGame,
	newPlayerPage,
	packageI18n,
	resetDice,
	roll,
	square,
	startGame,
} from '../helpers/game';

const BOARD = 'imperio-galactico';

test.beforeEach(async () => {
	await resetDice();
});

test('auction: declining opens it for all, a lone bidder wins at once, ownership propagates', async ({ browser }) => {
	const pkg = packageI18n(BOARD, 'es');
	const app = appI18n('es');
	const sq3 = pkg.squares['3'];

	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);

	const code = await createGame(ana, 'Ana', BOARD);
	await joinGame(berto, code, 'Berto');
	await startGame(ana, [ana, berto]);

	// Ana lands on square 3 and DECLINES by ending her turn → the auction starts.
	await roll(ana, 1, 2);
	await declineByEndingTurn(ana);

	// The auction modal opens on BOTH screens, naming the square from the package.
	const anaDialog = ana.locator('.auction-dialog');
	const bertoDialog = berto.locator('.auction-dialog');
	await expect(anaDialog).toBeVisible();
	await expect(bertoDialog).toBeVisible();
	await expect(anaDialog).toContainText(sq3);
	await expect(bertoDialog).toContainText(sq3);

	// Ana passes; Berto bids 10. With every rival out, the auction resolves at once
	// (no waiting for the countdown) and both modals close.
	await anaDialog.locator('.auction-pass-btn').click();
	await bertoDialog.locator('#auction-bid-input').fill('10');
	await bertoDialog.locator('.auction-bid-btn').click();
	await expect(anaDialog).toBeHidden();
	await expect(bertoDialog).toBeHidden();

	// The win is voiced with the square's localized name and the board currency.
	await expectAnnouncement(ana, new RegExp(`Berto.*${sq3}.*10₡`));

	// Ownership propagated (asserted on Berto's page: Ana's cursor rests on square 3,
	// whose label is deliberately left unrewritten while focused).
	await expect(square(berto, 3)).toHaveAttribute('aria-label', new RegExp(`${sq3}.*${app.game.you_own_property}`));
});

test('a rival SEES each bid instantly, and the next auction opens at the minimum bid', async ({ browser }) => {
	// Two live-play bugs in one flow: (1) rivals only learned of a bid through the next
	// 1-second timer tick, so the "current bid" looked frozen; a bid now broadcasts to the
	// group and repaints at once. (2) The bid field kept the amount typed in the PREVIOUS
	// auction, so a second auction opened proposing it instead of the fresh minimum.
	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);

	const code = await createGame(ana, 'Ana', BOARD);
	await joinGame(berto, code, 'Berto');
	await startGame(ana, [ana, berto]);

	// ── Auction 1: Ana declines square 3, then BIDS while Berto is still an active rival.
	await roll(ana, 1, 2);
	await declineByEndingTurn(ana);
	const anaDialog = ana.locator('.auction-dialog');
	const bertoDialog = berto.locator('.auction-dialog');
	await expect(anaDialog).toBeVisible();
	await expect(bertoDialog).toBeVisible();

	await anaDialog.locator('#auction-bid-input').fill('25');
	await anaDialog.locator('.auction-bid-btn').click();

	// Berto's dialog shows the CURRENT bid + bidder without waiting for a timer tick.
	await expect(bertoDialog.locator('.auction-dlg-bid')).toContainText('25', { timeout: 2000 });
	await expect(bertoDialog.locator('.auction-dlg-bidder')).toContainText('Ana');
	// And his countdown is alive (the per-second tick reaches the group).
	await expect(bertoDialog.locator('.auction-dlg-timer-value')).not.toHaveText('20', { timeout: 5000 });

	// Berto passes → Ana (lone bidder) wins at 25; both modals close.
	await bertoDialog.locator('.auction-pass-btn').click();
	await expect(anaDialog).toBeHidden();
	await expect(bertoDialog).toBeHidden();

	// ── Auction 2: Berto declines square 6. Ana's bid field must propose the MINIMUM,
	// not the 25 she typed in the previous auction.
	await roll(berto, 2, 4);
	await declineByEndingTurn(berto);
	await expect(anaDialog).toBeVisible();
	await expect(anaDialog.locator('#auction-bid-input')).toHaveValue('1');
	await expect(anaDialog).toContainText(packageI18n(BOARD, 'es').squares['6']);

	// Close it out so the game ends cleanly: Ana passes, Berto bids and wins.
	await anaDialog.locator('.auction-pass-btn').click();
	await bertoDialog.locator('#auction-bid-input').fill('10');
	await bertoDialog.locator('.auction-bid-btn').click();
	await expect(bertoDialog).toBeHidden();
});

test('doubles: the "still buyable" confirm moves from End turn to Roll (rolling again forfeits it)', async ({ browser }) => {
	// Ana rolls DOUBLES onto a buyable square, so she owes another roll: ENTER can't end the turn, and
	// ROLLING AGAIN (Space) is what would forfeit the property — so the confirm lives on Roll, not End
	// turn. Mirrors RollDiceHandler, which declines a still-pending purchase before the owed re-roll.
	const pkg = packageI18n(BOARD, 'es');
	const sq6 = pkg.squares['6'];

	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);
	const code = await createGame(ana, 'Ana', BOARD);
	await joinGame(berto, code, 'Berto');
	await startGame(ana, [ana, berto]);

	// 3+3: doubles, landing on the buyable square 6.
	await roll(ana, 3, 3);

	// Rolling again would forfeit square 6, so it opens the confirm first (naming the property) rather
	// than silently giving it away — the whole point of moving the guard onto Roll in the doubles case.
	await actionButton(ana, 'rollDice').click();
	const confirm = ana.locator('.game-dialog.dialog-confirm');
	await expect(confirm).toBeVisible();
	await expect(confirm).toContainText(sq6);

	// Confirm → the property is declined (auction, on this board's auction-on-decline rule); Ana still
	// owes her doubles re-roll, taken after the auction resolves.
	await confirm.locator('.btn-primary').click();
	await expect(ana.locator('.auction-dialog')).toBeVisible();
});
