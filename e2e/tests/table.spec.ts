// table.spec.ts — the table itself: what a group can do between games.
//
// A table outlives its matches (docs/tables.md), so the rules the NEXT one will be played with
// are the host's to change while nothing is running. The board-specific effect of each rule is
// covered by the server's rulebook tests; what matters here is that the change reaches the
// server and comes back — which is exactly what a reload proves.

import { test, expect } from '../helpers/test';
import { flushAxeAudit } from '../helpers/axeAudit';
import { E2E_BASE_URL } from '../playwright.config';
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

	// The actions are a named ARIA toolbar: announced as one, so the reader knows the arrows mean
	// something here — which only holds if they really move. Nothing is hidden; an action that is
	// not on offer is simply not built.
	const actions = ana.getByRole('toolbar', { name: appI18n('es').table.actionsLabel as string });
	await expect(actions.getByRole('button')).toHaveCount(4); // start, back, leave, delete

	// Reported from a real session: reloading a table spoke the server's raw enum — "Esperando
	// para empezar. Estado: WaitingForPlayers" — untranslated in every language, and never on the
	// page, because it was only ever an announcement. The table itself answers that question now.
	// A negative assertion, so it is made after the state that used to trigger it has arrived.
	await ana.reload();
	await expect(ana.locator('#table-view')).toBeVisible();
	await expect(ana.locator('#table-intro')).toHaveText(appI18n('es').table.introHost as string);
	const heard: string[] = await ana.evaluate(() => (window as never as { __announcements?: string[] }).__announcements ?? []);
	expect(heard.filter(line => /WaitingForPlayers|waiting_for_start|Estado:/i.test(line))).toEqual([]);

	await ana.locator('#table-start-btn').focus();
	const focusedId = () => ana.evaluate(() => document.activeElement?.id);
	await ana.keyboard.press('ArrowRight');
	expect(await focusedId()).toBe('table-back');
	await ana.keyboard.press('End');
	expect(await focusedId()).toBe('table-delete');
	await ana.keyboard.press('Home');
	expect(await focusedId()).toBe('table-start-btn');
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
	// …and the actions a guest is not offered are absent, not hidden: nothing to be counted.
	await expect(berto.getByRole('toolbar', { name: appI18n('es').table.actionsLabel as string })
		.getByRole('button')).toHaveCount(2); // back, leave — no start, no delete

	await ana.locator('#table-start-btn').click();
	for (const page of [ana, berto]) {
		await expect(page.locator('#game-layout')).toBeVisible();
		await expect(page.locator('#table-view')).toBeHidden();
		// …and the keyboard enters the game, which is the whole point of a board appearing.
		await expect(page.locator('#board')).toBeFocused();
	}
});

test('leaving a table passes the sceptre on, and the table hears both', async ({ browser }) => {
	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);
	const carla = await newPlayerPage(browser);
	const code = await createGame(ana, 'Ana', TRACK_BOARD);
	await joinGame(berto, code, 'Berto');
	await joinGame(carla, code, 'Carla');

	// Nobody but the host is offered the way to end the table for everyone.
	await expect(berto.locator('#table-delete')).toBeHidden();
	await expect(ana.locator('#table-delete')).toBeVisible();

	// The host leaves: the sceptre goes to the next person who arrived, not to the last.
	await ana.locator('#table-abandon').click();
	const confirm = ana.locator('.game-dialog.dialog-confirm, .game-dialog');
	await confirm.getByRole('button', { name: appI18n('es').table.abandonConfirmYes as string }).click();
	// The lobby is served per language (/ or /es/), so assert the PLACE, not the address.
	await expect(ana.locator('#view-home')).toBeVisible();

	for (const page of [berto, carla]) {
		await expect(page.locator('#table-players li')).toHaveCount(2);
		await expectAnnouncement(page, /Ana ha abandonado la mesa/i);
		await expectAnnouncement(page, /Berto es el anfitrión/i);
	}
	// And the sceptre is not just spoken: Berto can now start a match, Carla still cannot.
	await expect(berto.locator('#table-start-btn')).toBeVisible();
	await expect(carla.locator('#table-start-btn')).toBeHidden();
	await expect(berto.locator('#table-delete')).toBeVisible();
});

test('the host can hand the sceptre over without leaving', async ({ browser }) => {
	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);
	const code = await createGame(ana, 'Ana', TRACK_BOARD);
	await joinGame(berto, code, 'Berto');

	await ana.locator('#table-players .player-item__make-host').click();

	await expect(berto.locator('#table-start-btn')).toBeVisible();
	await expect(ana.locator('#table-start-btn')).toBeHidden();
	// Ana is still sitting at her table — she gave the sceptre away, not her seat.
	await expect(ana.locator('#table-players li')).toHaveCount(2);
	await expectAnnouncement(ana, /Berto es el anfitrión/i);
});

test('the host deleting the table takes everyone home with it', async ({ browser }) => {
	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);
	const code = await createGame(ana, 'Ana', TRACK_BOARD);
	await joinGame(berto, code, 'Berto');

	await ana.locator('#table-delete').click();
	// Scoped to the dialog: its confirm button carries the same words as the one that opened it.
	await ana.locator('.game-dialog')
		.getByRole('button', { name: appI18n('es').table.deleteConfirmYes as string }).click();

	// Nobody is left staring at a page with nothing behind it.
	await expect(ana.locator('#view-home')).toBeVisible();
	await expect(berto.locator('#view-home')).toBeVisible();
	// …and it is gone from the list too, not offering a way back into nothing.
	await expect(berto.locator('#your-games-empty')).toBeVisible();
});

test('the host changes the board rules for the next match, and the change sticks', async ({ browser }) => {
	const ana = await newPlayerPage(browser);
	await createGame(ana, 'Ana', PROPERTY_BOARD);
	await expect(ana.locator('#table-view')).toBeVisible();

	const rules = ana.locator('#table-rules');
	await expect(rules).toBeVisible();
	await rules.evaluate(el => { (el as HTMLDetailsElement).open = true; });
	await flushAxeAudit(ana);

	// Reported from a real session: "al expandir las reglas, todas aparecen con sus claves de
	// traducción". The panel is built from the package's rule CATALOGUE, which arrives before its
	// WORDS do — and it is built once, so the labels have to be re-resolved where they stand. The
	// previous test only read checkbox states, which are just as true in a panel full of keys.
	const fields = ana.locator('#table-rules-fields');
	const packageWords = packageI18n(PROPERTY_BOARD, 'es').rules;
	await expect(fields).toContainText(packageWords.group.auctions as string);
	await expect(fields).toContainText(packageWords.startingMoney as string);
	await expect(fields).not.toContainText(/rules\./);

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
