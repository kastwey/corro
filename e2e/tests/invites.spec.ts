// invites.spec.ts — getting somebody to your table.
//
// The whole point is that this works when the invite code is not the point: a friend who is already
// here somewhere should not have to be sent a string to type. So the assertions follow one person
// from a table with room to another sitting in the lobby, and back again into a seat.

import { test, expect } from '../helpers/test';
import { flushAxeAudit } from '../helpers/axeAudit';
import {
	appI18n, closeAccountSettings, createGame, expectAnnouncement, gotoLobbyHome, newPlayerPage, openAccountSettings,
} from '../helpers/game';
import type { Page } from '../helpers/test';

const account = appI18n('es').account.settings as Record<string, string>;
const table = appI18n('es').table as Record<string, string>;
const invites = appI18n('es').lobby.invites as Record<string, string>;

/** A signed-in player with a public name, open to being asked by anybody. */
async function member(
	browser: import('@playwright/test').Browser, subject: string, handle: string,
): Promise<Page> {
	const page = await newPlayerPage(browser, 'es-ES');
	await page.goto(`/api/auth/signin/e2e?returnUrl=%2F&subject=${subject}`);
	await expect(page.locator('#account-bar .account-status')).toBeVisible();

	await openAccountSettings(page);
	const field = page.locator('#account-handle-input');
	await field.fill(handle);
	await expect(field).toHaveValue(handle);
	await page.locator('#account-handle-save').click();
	await expect(page.locator('#account-settings-status')).toHaveText(account.handleSaved);
	await page.locator('#account-messages-anyone').check();
	// Visible to everyone, so these tests can find each other in the room before they are friends.
	// A new account is friends-only, which is right for people and unhelpful for a fixture.
	await page.locator('#account-visibility-everyone').check();
	await expect(page.locator('#account-settings-status'))
		.toHaveText(account.visibilitySavedEveryone);
	await closeAccountSettings(page);
	return page;
}

test('a table with room can ask somebody by name, and they land in a seat', async ({ browser }) => {
	const ana = await member(browser, 'inv-host', 'invhost');
	const berto = await member(browser, 'inv-guest', 'invguest');

	await createGame(ana, 'Ana', 'snakes-and-ladders');
	await expect(ana.locator('#table-view')).toBeVisible();

	// The control only appears for somebody who could actually invite.
	const invite = ana.locator('#table-invite-someone');
	await expect(invite).toBeVisible();
	await invite.locator('#table-invite-handle').fill('invguest');
	await invite.locator('#table-invite-send').click();
	await expectAnnouncement(ana, new RegExp(table.inviteSent.replace('{{handle}}','invguest')));
	await flushAxeAudit(ana);

	// It is waiting for Berto in the lobby, named and answerable, without any code changing hands.
	await gotoLobbyHome(berto);
	const waiting = berto.locator('#lobby-invites-list .lobby-invite');
	await expect(waiting).toHaveCount(1);
	await expect(waiting).toContainText('invhost');
	await flushAxeAudit(berto);

	// Accepting walks the ordinary join: he still picks his piece.
	await waiting.getByRole('button', { name: invites.accept }).click();
	await expect(berto.locator('#join-step2')).toBeVisible();
});

test('nothing is waiting when nothing is waiting, and the region takes no tab stop', async ({ browser }) => {
	const alone = await member(browser, 'inv-alone', 'invalone');
	await gotoLobbyHome(alone);

	await expect(alone.locator('#lobby-invites')).toBeHidden();
	await flushAxeAudit(alone);
});

// Half the feature was unreachable from where people actually sit: the server pushed the
// invitation to every connection, and only the lobby listened. Somebody at a table — which is
// where you are when a friend wants you at theirs — saw nothing at all.
test('an invitation reaches you at a table, and accepting takes you to the other one', async ({ browser }) => {
	const ana = await member(browser, 'inv-at-table-host', 'invtablehost');
	const berto = await member(browser, 'inv-at-table-guest', 'invtableguest');

	// Berto is already sitting at his own table when the invitation arrives.
	await createGame(berto, 'Berto', 'snakes-and-ladders');
	await expect(berto.locator('#table-view')).toBeVisible();
	await expect(berto.locator('#table-my-invites-section')).toBeHidden();

	const anaCode = await createGame(ana, 'Ana', 'snakes-and-ladders');
	await ana.locator('#table-invite-handle').fill('invtableguest');
	await ana.locator('#table-invite-send').click();
	await expectAnnouncement(ana, new RegExp(table.inviteSent.replace('{{handle}}', 'invtableguest')));

	// It lands where he is, said once and shown in a region only he can see.
	await expectAnnouncement(berto, new RegExp(invites.arrived));
	const waiting = berto.locator('#table-my-invites .player-item');
	await expect(waiting).toHaveCount(1);
	await expect(waiting).toContainText('invtablehost');
	await flushAxeAudit(berto);

	// Accepting leaves this table for the other one, through the ordinary join.
	await waiting.getByRole('button', { name: invites.accept }).click();
	await expect(berto.locator('#join-step2')).toBeVisible();
	expect(anaCode.length).toBeGreaterThan(0);
});

test('a table you are already at never asks you to join it', async ({ browser }) => {
	const ana = await member(browser, 'inv-self-table', 'invselftable');
	await createGame(ana, 'Ana', 'snakes-and-ladders');

	await expect(ana.locator('#table-view')).toBeVisible();
	await expect(ana.locator('#table-my-invites-section')).toBeHidden();
	await flushAxeAudit(ana);
});

// Nobody should have to know a public name by heart to ask a friend to play.
test('a friend can be invited from a list instead of by typing their name', async ({ browser }) => {
	const ana = await member(browser, 'inv-picker-host', 'invpickerhost');
	const berto = await member(browser, 'inv-picker-friend', 'invpickerfriend');

	// They become friends the ordinary way, from the room.
	await gotoLobbyHome(berto);
	await berto.locator('#go-online-btn').click();
	await berto.locator('#online-list .online-player').filter({ hasText: 'invpickerhost' })
		.getByRole('button', { name: /invpickerhost/ }).click();
	await gotoLobbyHome(ana);
	await ana.locator('#go-friends-btn').click();
	await ana.locator('#friends-tab-requests').click();
	await ana.locator('#friends-requests-list .friend-row')
		.getByRole('button', { name: /invpickerfriend/ }).first().click();

	await createGame(ana, 'Ana', 'snakes-and-ladders');
	await expect(ana.locator('#table-view')).toBeVisible();

	// A real listbox, not loose buttons: without the roles each one is announced alone, with no
	// position and no idea how many more there are.
	const picker = ana.locator('#table-invite-friends');
	await expect(picker).toHaveRole('listbox');
	const options = picker.getByRole('option');
	await expect(options).toHaveCount(1);
	await expect(options.first()).toHaveText('invpickerfriend');
	await flushAxeAudit(ana);

	// One tab stop, arrows inside, and choosing invites without anybody typing a name.
	await expect(options.first()).toHaveAttribute('tabindex', '0');
	await options.first().click();
	await expectAnnouncement(
		ana, new RegExp(table.inviteSent.replace('{{handle}}', 'invpickerfriend')));

	await gotoLobbyHome(berto);
	await expect(berto.locator('#lobby-invites-list .lobby-invite')).toHaveCount(1);
});
