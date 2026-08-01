// table.spec.ts — the table itself: what a group can do between games.
//
// A table outlives its matches (docs/tables.md), so the rules the NEXT one will be played with
// are the host's to change while nothing is running. The board-specific effect of each rule is
// covered by the server's rulebook tests; what matters here is that the change reaches the
// server and comes back — which is exactly what a reload proves.

import { test, expect } from '../helpers/test';
import { flushAxeAudit } from '../helpers/axeAudit';
import { createGame, expectAnnouncement, joinGame, newPlayerPage } from '../helpers/game';

const PROPERTY_BOARD = 'galactic-empire';
const TRACK_BOARD = 'snakes-and-ladders';

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
