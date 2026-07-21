// trade.spec.ts — the full player-to-player trade flow, end to end, on the shipped
// "Galactic Empire" board in Spanish. Two real browser contexts (Ana hosts, Berto
// joins), scripted dice, real SignalR.
//
// This is the scenario that concentrated the most bugs from a real family game:
//  * #3/#9  trade dialogs showed the raw hex colour instead of the group name;
//  * #4     a received trade showed no per-property price, and prices read "euros"
//           instead of the board's own currency (créditos/₡);
//  * #11    Enter only worked when a button was focused, not from the offer lines;
//  * the STATION regression: package ownables are typed by the board ("transit"), and a
//    legacy property/railroad/utility filter silently dropped them from every trade —
//    so Ana trades the STATION here, pinning behavior-based ownability end to end.
//
// Every text is asserted against the PACKAGE's i18n (server/Packages/…/i18n/es.json),
// so the suite verifies package ↔ screen coherence rather than hardcoded strings.

import { test, expect } from '../helpers/test';
import {
	actionButton,
	appI18n,
	buyPendingProperty,
	createGame,
	expectAnnouncement,
	joinGame,
	newPlayerPage,
	packageI18n,
	resetDice,
	roll,
	square,
	startGame,
} from '../helpers/game';

const BOARD = 'galactic-empire';

test.beforeEach(async () => {
	await resetDice();
});

test('trade: prices in board currency, group names (not hex), Enter accepts, ownership swaps', async ({ browser }) => {
	const pkg = packageI18n(BOARD, 'es');
	const app = appI18n('es');
	const sq5 = pkg.squares['5'];   // the STATION — group "transit", 200₡ (type is package-defined)
	const sq6 = pkg.squares['6'];   // Roca Tycho  — g2, 100₡

	const ana = await newPlayerPage(browser);    // host → joins first → moves first (E2E order)
	const berto = await newPlayerPage(browser);

	const code = await createGame(ana, 'Ana', BOARD);
	await joinGame(berto, code, 'Berto');
	await startGame(ana, [ana, berto]);

	const propertyOf = (owner: string) =>
		(app.game.property_of as string).replace('{{owner}}', owner);

	// NOTE on label assertions: the board deliberately never rewrites the aria-label of
	// the square the exploration cursor SITS ON (so a refresh can't make JAWS re-read it),
	// and each player's cursor rests on the square they just landed on. Ownership is
	// therefore asserted on the OTHER player's page — which also proves the authoritative
	// state propagated across clients.

	// ── Ana rolls 2+3 → square 5 (the STATION) and buys it ──────────────────
	await roll(ana, 2, 3);
	// The SPECTATOR's dice tray paints the roll too (live-play bug: "I only see dice
	// when I roll" — DICE_ROLLED used to reach only the roller).
	await expect(berto.locator('.dice-tray .die').nth(0)).toHaveAttribute('data-face', '2');
	await expect(berto.locator('.dice-tray .die').nth(1)).toHaveAttribute('data-face', '3');
	// Presence rings (live-play request): Ana's landing square rings as MINE on her own
	// board and as a rival's on Berto's; and the players panel marks who holds the turn.
	await expect(square(ana, 5)).toHaveClass(/square--me-here/);
	await expect(square(berto, 5)).toHaveClass(/square--other-here/);
	await expect(berto.locator('.player-card[data-player-id]').first().locator('.player-card__turn')).toBeVisible();
	await buyPendingProperty(ana);
	// Berto HEARS the purchase in the board's own words: localized square name and
	// the board currency word ("créditos"), never a hardcoded euro (bug #4b class).
	await expectAnnouncement(berto, new RegExp(`Ana.*${sq5}.*200 ${pkg.currency.name}`));
	await expect(square(berto, 5)).toHaveAttribute('aria-label', new RegExp(`${sq5}.*${propertyOf('Ana')}`));
	await actionButton(ana, 'endTurn').click();

	// ── Berto rolls 2+4 → square 6 (Roca Tycho) and buys it ─────────────────
	await roll(berto, 2, 4);
	await buyPendingProperty(berto);
	await expect(square(ana, 6)).toHaveAttribute('aria-label', new RegExp(`${sq6}.*${propertyOf('Berto')}`));
	await actionButton(berto, 'endTurn').click();

	// ── Ana proposes: her STATION for Berto's Roca Tycho ────────────────────
	await actionButton(ana, 'proposeTrade').click();
	const builder = ana.locator('#trade-dialog.trade-builder');
	await expect(builder).toBeVisible();

	// Bug #3/#9 (+ the station regression): the builder LISTS the transit-typed station
	// and reads each property with its GROUP NAME (from the package i18n) and its price
	// in the board currency — never the raw hex.
	const giveLabel = builder.locator('label[for="trade-give-prop-5"]');
	await expect(giveLabel).toContainText(sq5);
	await expect(giveLabel).toContainText(pkg.groups.transit);
	await expect(giveLabel).toContainText('200₡');
	await expect(giveLabel).not.toContainText('#');
	const reqLabel = builder.locator('label[for="trade-req-prop-6"]');
	await expect(reqLabel).toContainText(sq6);
	await expect(reqLabel).toContainText(pkg.groups.g2);
	await expect(reqLabel).toContainText('100₡');
	await expect(reqLabel).not.toContainText('#');

	await builder.locator('#trade-give-prop-5').check();
	await builder.locator('#trade-req-prop-6').check();

	// ── Live-play 2026-07-12 (Eric): asking MORE money than the partner has must show an
	// explicit error and refuse the proposal — never go out silently clamped. ──────────
	const reqMoney = builder.locator('#trade-req-money');
	await reqMoney.fill('9999');
	const reqError = builder.locator('#trade-req-money-error');
	await expect(reqError).toBeVisible();
	await expect(reqError).toContainText(/Berto solo tiene/);
	await builder.locator('.trade-propose-btn').click();
	await expect(builder).toBeVisible();       // still open: nothing was sent
	await expect(reqMoney).toBeFocused();      // focus lands on the offending amount
	await reqMoney.fill('0');                  // correct it: the error clears
	await expect(reqError).toBeHidden();

	await builder.locator('.trade-propose-btn').click();

	// ── Berto reviews: every property carries its GROUP and its price in ₡ ───
	// (bug #4 for the price; live-play 2026-07-12 for the group — it was missing and the
	// group is the whole basis for weighing an offer.)
	const review = berto.locator('#trade-dialog.trade-review');
	await expect(review).toBeVisible();
	const lines = review.locator('.trade-review-line');
	await expect(lines.nth(0)).toContainText(`${sq5} (${pkg.groups.transit}, 200₡)`);  // what Berto receives
	await expect(lines.nth(1)).toContainText(`${sq6} (${pkg.groups.g2}, 100₡)`);       // what Berto gives
	await expect(review).not.toContainText('euro');

	// ── And the review VERDICTS the deal from Berto's side (live-play 2026-07-12):
	// he receives 200₡ of value for 100₡, so counting money only he comes out ahead. ──
	const verdict = review.locator('.trade-valuation');
	await expect(verdict).toContainText('Entregas 100');
	await expect(verdict).toContainText('recibes 200');
	await expect(verdict).toContainText(app.game.trade_verdict_favorable);
	await expect(verdict).toHaveAttribute('tabindex', '0');

	// ── The review FLOATS: the decision needs the board (verify prices, then decide) ──
	// Escape parks Berto on the board WITHOUT dismissing the pending offer; the board
	// keys work (he checks the offered square's price with the exploration keys); and
	// Ctrl+D drops him back into the dialog.
	await expect(review).toHaveAttribute('data-modal', 'false');
	await expect(lines.nth(0)).toBeFocused();
	await berto.keyboard.press('Escape');
	await expect(berto.locator('#board')).toBeFocused();
	await expect(review).toBeVisible(); // the offer is state-driven, not dismissed
	await berto.keyboard.press('Control+d');
	await expect(lines.nth(0)).toBeFocused();

	// ── And it can be DRAGGED aside by its title bar ─────────────────────────
	const titleBox = (await review.locator('.dialog-title').boundingBox())!;
	const before = (await review.boundingBox())!;
	await berto.mouse.move(titleBox.x + titleBox.width / 2, titleBox.y + titleBox.height / 2);
	await berto.mouse.down();
	await berto.mouse.move(titleBox.x + titleBox.width / 2 + 120, titleBox.y + titleBox.height / 2 + 60, { steps: 4 });
	await berto.mouse.up();
	const after = (await review.boundingBox())!;
	expect(Math.round(after.x - before.x)).toBe(120);
	expect(Math.round(after.y - before.y)).toBe(60);

	// ── Bug #11: Enter from the offer line (not a button) accepts the trade ──
	// The dialog lands focus on the first review line; Enter must fire Accept.
	await berto.keyboard.press('Enter');
	await expect(review).toBeHidden();

	// ── Ownership swapped on BOTH boards (authoritative state round-tripped) ─
	// Cursor-free squares only (see NOTE above): Ana's cursor rests on 5, Berto's on 6.
	await expect(square(ana, 6)).toHaveAttribute('aria-label', new RegExp(`${sq6}.*${app.game.you_own_property}`));
	await expect(square(berto, 5)).toHaveAttribute('aria-label', new RegExp(`${sq5}.*${app.game.you_own_property}`));
});
