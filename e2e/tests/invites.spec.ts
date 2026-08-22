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

// Nobody should have to know a public name by heart to ask somebody to play — and nobody should be
// offered a name that would only be refused. The list and the field are ONE control: it opens
// showing who is available and narrows as a name is typed.
test('anybody connected and open to invitations can be picked from a list, and typing narrows it',
	async ({ browser }) => {
	const ana = await member(browser, 'inv-picker-host', 'invpickerhost');
	const berto = await member(browser, 'inv-picker-friend', 'invpickerfriend');
	// A stranger, never befriended, who simply accepts invitations from anybody. Under the old
	// friends-only list they were unreachable without knowing their name by heart.
	const carla = await member(browser, 'inv-picker-stranger', 'invpickerstranger');
	await gotoLobbyHome(carla);

	// Ana and Berto become friends the ordinary way, from the room.
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
	const picker = ana.locator('#table-invite-people');
	await expect(picker).toHaveRole('listbox');
	// Both are offered — the friend AND the stranger who takes invitations from anyone. Asserted by
	// name rather than by count: everybody else connected to this server belongs here too.
	await expect(picker.getByRole('option').filter({ hasText: 'invpickerfriend' })).toHaveCount(1);
	await expect(picker.getByRole('option').filter({ hasText: 'invpickerstranger' })).toHaveCount(1);
	await flushAxeAudit(ana);

	// Typing narrows the SAME list rather than replacing it, and says how many are left.
	await ana.locator('#table-invite-handle').fill('invpickerfr');
	await expect(picker.getByRole('option')).toHaveCount(1);
	await expect(ana.locator('#table-invite-status')).toContainText(/1/);
	await flushAxeAudit(ana);

	// One tab stop, and choosing invites without anybody typing the rest of a name.
	const chosen = picker.getByRole('option').first();
	await expect(chosen).toHaveAttribute('tabindex', '0');
	await chosen.click();
	await expectAnnouncement(
		ana, new RegExp(table.inviteSent.replace('{{handle}}', 'invpickerfriend')));

	await gotoLobbyHome(berto);
	await expect(berto.locator('#lobby-invites-list .lobby-invite')).toHaveCount(1);
});

// Seeing comes first and on its own: the picker must never become a way around the presence
// setting. Somebody hidden is still invitable BY NAME, which is what keeps the two ways distinct.
test('somebody hidden from you is not offered, but can still be invited by name',
	async ({ browser }) => {
	const ana = await member(browser, 'inv-hidden-host', 'invhiddenhost');
	const berto = await member(browser, 'inv-hidden-guest', 'invhiddenguest');
	// Somebody ordinary, offered as usual. She is here to prove the list actually ANSWERED:
	// asserting only that Berto is absent would pass just as well against a picker that never
	// loaded, which is the one way this test could go quietly false.
	const carla = await member(browser, 'inv-hidden-watcher', 'invhiddenwatcher');
	await gotoLobbyHome(carla);

	// Berto takes invitations from anybody, but shows himself to nobody.
	await openAccountSettings(berto);
	await berto.locator('#account-visibility-nobody').check();
	await expect(berto.locator('#account-settings-status')).toBeVisible();
	await closeAccountSettings(berto);
	await gotoLobbyHome(berto);

	await createGame(ana, 'Ana', 'snakes-and-ladders');
	await expect(ana.locator('#table-view')).toBeVisible();
	const picker = ana.locator('#table-invite-people');
	// Wait for the list to have ANSWERED before reading anything into what is missing from it.
	await expect(picker.getByRole('option').filter({ hasText: 'invhiddenwatcher' }))
		.toHaveCount(1);
	await expect(picker.getByRole('option').filter({ hasText: 'invhiddenguest' }))
		.toHaveCount(0);

	// The name still reaches him: the field answers "I know who I want", the list "who is about?".
	await ana.locator('#table-invite-handle').fill('invhiddenguest');
	await ana.locator('#table-invite-send').click();
	await expectAnnouncement(
		ana, new RegExp(table.inviteSent.replace('{{handle}}', 'invhiddenguest')));
	await flushAxeAudit(ana);

	await gotoLobbyHome(berto);
	await expect(berto.locator('#lobby-invites-list .lobby-invite')).toHaveCount(1);
});
