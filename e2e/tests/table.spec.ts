// table.spec.ts — the table itself: what a group can do between games.
//
// A table outlives its matches (docs/tables.md), so the rules the NEXT one will be played with
// are the host's to change while nothing is running. The board-specific effect of each rule is
// covered by the server's rulebook tests; what matters here is that the change reaches the
// server and comes back — which is exactly what a reload proves.

import { test, expect } from '../helpers/test';
import { flushAxeAudit } from '../helpers/axeAudit';
import {
	appI18n, createGame, expectAnnouncement, joinGame, newPlayerPage, packageI18n,
} from '../helpers/game';

const PROPERTY_BOARD = 'galactic-empire';
const TRACK_BOARD = 'snakes-and-ladders';

// Reported from a real session: creating a table landed on an empty board. The page focused the
// board container on load — a habit from when it only ever served matches — so a player who was
// merely sitting down at their table was parked inside a role="application" with nothing in it:
// nothing painted, nothing to arrow through, and no browse mode either, because NVDA builds no
// virtual buffer inside an application.
test('creating a table lands ON the table, with no empty board in sight', async ({ browser }) => {
	const ana = await newPlayerPage(browser);
	await createGame(ana, 'Ana', TRACK_BOARD);

	await expect(ana.locator('#table-view')).toBeVisible();
	await expect(ana.locator('#game-layout')).toBeHidden();
	await expect(ana.locator('#table-heading')).toBeFocused();

	// Reported from a real session: "Kastwey, game.token_stout_pint, (anfitrión)". A package's
	// piece names live in ITS bundle, which the table loads a moment after painting, so the
	// roster has to be rebuilt when those words arrive — and never print a key meanwhile.
	const roster = ana.locator('#table-players');
	await expect(roster).toContainText(packageI18n(TRACK_BOARD, 'es').tokens.star as string);
	await expect(roster).not.toContainText(/game\.token_|tokens\./);

	// And the copy is written for whoever reads it: the host is not waiting for the host.
	await expect(ana.locator('#table-intro')).toHaveText(appI18n('es').table.introHost as string);
	await expect(ana.locator('#table-start-btn')).toHaveText(appI18n('es').table.start as string);
});

test('joining a table lands there too, and the board only appears with a match in it', async ({ browser }) => {
	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);
	const code = await createGame(ana, 'Ana', TRACK_BOARD);

	await joinGame(berto, code, 'Berto');
	await expect(berto.locator('#table-view')).toBeVisible();
	await expect(berto.locator('#game-layout')).toBeHidden();
	// A guest IS waiting for the host, and is told so instead of being given a dead button.
	await expect(berto.locator('#table-intro')).toHaveText(appI18n('es').table.introGuest as string);
	await expect(berto.locator('#table-start-btn')).toBeHidden();

	await ana.locator('#table-start-btn').click();
	for (const page of [ana, berto]) {
		await expect(page.locator('#game-layout')).toBeVisible();
		await expect(page.locator('#table-view')).toBeHidden();
		// …and the keyboard enters the game, which is the whole point of a board appearing.
		await expect(page.locator('#board')).toBeFocused();
	}
});

test('the host changes the board rules for the next match, and the change sticks', async ({ browser }) => {
	const ana = await newPlayerPage(browser);
	await createGame(ana, 'Ana', PROPERTY_BOARD);
	await expect(ana.locator('#table-view')).toBeVisible();

	const rules = ana.locator('#table-rules');
	await expect(rules).toBeVisible();
	await rules.evaluate(el => { (el as HTMLDetailsElement).open = true; });
	await flushAxeAudit(ana);

	// The panel opens on the board's own default; flipping one is saved for the next match.
	const auction = ana.locator('#table-rules-fields [data-rule-id="auctionOnDecline"]');
	await expect(auction).toBeChecked();
	await auction.dispatchEvent('click');
	await expectAnnouncement(ana, /reglas guardadas/i);

	// The proof it reached the server: a reload rebuilds the panel from the table, not from the
	// board's defaults.
	await ana.reload();
	await expect(ana.locator('#table-view')).toBeVisible();
	await ana.locator('#table-rules').evaluate(el => { (el as HTMLDetailsElement).open = true; });
	await expect(ana.locator('#table-rules-fields [data-rule-id="auctionOnDecline"]')).not.toBeChecked();
});

test('a guest is not offered the rules, and a board that declares none offers them to nobody', async ({ browser }) => {
	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);

	// A board with no declared house rules: not even the host gets a panel.
	const code = await createGame(ana, 'Ana', TRACK_BOARD);
	await expect(ana.locator('#table-view')).toBeVisible();
	await expect(ana.locator('#table-rules')).toBeHidden();

	// And the rules are the host's to set: a guest reads the game's own guide instead.
	await joinGame(berto, code, 'Berto');
	await expect(berto.locator('#table-view')).toBeVisible();
	await expect(berto.locator('#table-rules')).toBeHidden();
});
