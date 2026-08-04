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
