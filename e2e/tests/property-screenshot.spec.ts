// property-screenshot.spec.ts — visual review of the PROPERTY game, step by step.
//
// Captures every stage of a short galactico game (lobby, start, a roll seen from BOTH
// sides, the buy dialog, a trade builder, a live auction) in light AND dark theme, so a
// sighted reviewer — or Claude reading the PNGs — can audit contrast and layout. Born from
// live-play feedback: "the top of the screen reads black-on-gray", "I can't see the other
// player's dice", "the current bid is invisible". The screenshots land in e2e/*.png
// (gitignored, regenerated on every run).

import { test, expect } from '../helpers/test';
import {
	actionButton,
	createGame,
	declineByEndingTurn,
	joinGame,
	newPlayerPage,
	resetDice,
	roll,
	startGame,
} from '../helpers/game';

const BOARD = 'imperio-galactico';

test.beforeEach(async () => {
	await resetDice();
});

test('visual: property board gameplay, dialogs and both themes', async ({ browser }) => {
	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);

	const code = await createGame(ana, 'Ana', BOARD);
	// The lobby BEFORE starting (players list, house rules, copy buttons).
	await ana.screenshot({ path: 'property-01-lobby.png', fullPage: true });

	await joinGame(berto, code, 'Berto');
	await startGame(ana, [ana, berto]);
	await ana.screenshot({ path: 'property-02-board-start.png', fullPage: true });

	// ── Ana rolls 2+3 → the station. Capture BOTH sides right after the roll: the
	// roller's view and the SPECTATOR's view (are the dice visible to Berto?).
	await roll(ana, 2, 3);
	await ana.waitForTimeout(400); // mid/just-after hop
	await ana.screenshot({ path: 'property-03-ana-rolled-own-view.png', fullPage: true });
	await berto.screenshot({ path: 'property-04-ana-rolled-berto-view.png', fullPage: true });

	// The buy confirmation dialog.
	await expect(actionButton(ana, 'buyProperty')).toBeVisible();
	await actionButton(ana, 'buyProperty').click();
	const buyDialog = ana.locator('.game-dialog.dialog-purchase');
	await expect(buyDialog).toBeVisible();
	await ana.screenshot({ path: 'property-05-buy-dialog.png', fullPage: true });
	await buyDialog.locator('.btn-primary').click();
	await ana.screenshot({ path: 'property-06-after-buy.png', fullPage: true });

	// ── The trade builder (owner side populated).
	await actionButton(ana, 'proposeTrade').click();
	const builder = ana.locator('#trade-dialog.trade-builder');
	await expect(builder).toBeVisible();
	await ana.screenshot({ path: 'property-07-trade-builder.png', fullPage: true });
	await ana.keyboard.press('Escape');
	await actionButton(ana, 'endTurn').click();

	// ── Berto lands on square 3 and declines → live auction on both screens.
	await roll(berto, 1, 2);
	await declineByEndingTurn(berto);
	const anaAuction = ana.locator('.auction-dialog');
	const bertoAuction = berto.locator('.auction-dialog');
	await expect(anaAuction).toBeVisible();
	await expect(bertoAuction).toBeVisible();
	// Ana bids 25 so there is a CURRENT BID to show; capture the rival's dialog (can
	// Berto see what the current bid is?), then the bidder's own.
	await anaAuction.locator('#auction-bid-input').fill('25');
	await anaAuction.locator('.auction-bid-btn').click();
	await berto.waitForTimeout(300);
	await berto.screenshot({ path: 'property-08-auction-rival-view.png', fullPage: true });
	await ana.screenshot({ path: 'property-09-auction-bidder-view.png', fullPage: true });
	await bertoAuction.locator('.auction-pass-btn').click();
	await expect(anaAuction).toBeHidden();

	// ── Dark theme: same board, header and players panel.
	await ana.locator('#theme-toggle').click();
	await ana.waitForTimeout(300);
	await ana.screenshot({ path: 'property-10-dark-board.png', fullPage: true });

	console.log('✅ Property screenshots captured successfully');
});
