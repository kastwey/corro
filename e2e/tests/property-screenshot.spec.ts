// property-screenshot.spec.ts — visual review of the PROPERTY game, step by step.
//
// Captures every stage of a short galactico game (lobby, start, a roll seen from BOTH
// sides, the buy dialog, a trade builder, a live auction) in light AND dark theme, so a
// sighted reviewer — or Claude reading the PNGs — can audit contrast and layout. Born from
// live-play feedback: "the top of the screen reads black-on-gray", "I can't see the other
// player's dice", "the current bid is invisible". The screenshots are attached to
// Playwright's managed output and exposed through the HTML report.

import { test, expect } from '../helpers/test';
import { captureScreenshot } from '../helpers/screenshot';
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

const BOARD = 'galactic-empire';

test.beforeEach(async () => {
	await resetDice();
});

test('visual: property board gameplay, dialogs and both themes', async ({ browser }, testInfo) => {
	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);

	const code = await createGame(ana, 'Ana', BOARD);
	// The lobby BEFORE starting (players list, house rules, copy buttons).
	await captureScreenshot(ana, testInfo, 'property-01-lobby.png');

	await joinGame(berto, code, 'Berto');
	await startGame(ana, [ana, berto]);
	await captureScreenshot(ana, testInfo, 'property-02-board-start.png');

	// ── Ana rolls 2+3 → the station. Capture BOTH sides right after the roll: the
	// roller's view and the SPECTATOR's view (are the dice visible to Berto?).
	await roll(ana, 2, 3);
	await ana.waitForTimeout(400); // mid/just-after hop
	await captureScreenshot(ana, testInfo, 'property-03-ana-rolled-own-view.png');
	await captureScreenshot(berto, testInfo, 'property-04-ana-rolled-berto-view.png');

	// The buy confirmation dialog.
	await expect(actionButton(ana, 'buyProperty')).toBeVisible();
	await actionButton(ana, 'buyProperty').click();
	const buyDialog = ana.locator('.game-dialog.dialog-purchase');
	await expect(buyDialog).toBeVisible();
	await captureScreenshot(ana, testInfo, 'property-05-buy-dialog.png');
	await buyDialog.locator('.btn-primary').click();
	const propertyNarrative = ana.locator('.board-center > .visual-narrative--property');
	await expect(propertyNarrative).toBeVisible();
	await expect(propertyNarrative).toHaveClass(/visual-narrative--neutral/);
	await expect(propertyNarrative).not.toBeEmpty();
	await expect(ana.locator('.board-toast')).toHaveCount(0);
	await captureScreenshot(ana, testInfo, 'property-06-after-buy.png');

	// ── The trade builder (owner side populated).
	await actionButton(ana, 'proposeTrade').click();
	const builder = ana.locator('#trade-dialog.trade-builder');
	await expect(builder).toBeVisible();
	await captureScreenshot(ana, testInfo, 'property-07-trade-builder.png');
	await ana.keyboard.press('Escape');
	await actionButton(ana, 'endTurn').click();
	await expect(berto.locator('#turn-indicator .turn-indicator__name')).toHaveText('Berto');
	await expect(actionButton(berto, 'rollDice')).not.toHaveAttribute('aria-disabled', 'true');

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
	await captureScreenshot(berto, testInfo, 'property-08-auction-rival-view.png');
	await captureScreenshot(ana, testInfo, 'property-09-auction-bidder-view.png');
	await bertoAuction.locator('.auction-pass-btn').click();
	await expect(anaAuction).toBeHidden();

	// ── Dark theme: same board, header and players panel.
	await ana.locator('#theme-toggle').click();
	await ana.waitForTimeout(300);
	await captureScreenshot(ana, testInfo, 'property-10-dark-board.png');

	console.log('✅ Property screenshots captured successfully');
});
