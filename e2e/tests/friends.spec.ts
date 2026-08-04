// friends.spec.ts — asking, answering, and what a refusal does.
//
// The relationship is what the two surfaces are FOR, so most of what is asserted here is that a row
// says where two people stand before anybody presses anything: somebody arrowing down the list has
// to hear it, not discover it by opening a menu.
//
// The refusal cases are the ones worth having in a real browser. They are the only place where what
// one person is shown deliberately differs from what happened, and a change that "simplified" that
// would look perfectly reasonable in a diff.

import { test, expect } from '../helpers/test';
import { flushAxeAudit } from '../helpers/axeAudit';
import { appI18n, gotoLobbyHome, newPlayerPage } from '../helpers/game';
import type { Page } from '../helpers/test';

const account = appI18n('es').account.settings as Record<string, string>;
const friends = appI18n('es').lobby.friends as Record<string, string>;
const online = appI18n('es').lobby.online as Record<string, string>;

const withHandle = (template: string, handle: string) =>
	template.replace('{{handle}}', handle);

/** A signed-in player who has claimed a public name and asked to be listed. */
async function listedPlayer(
	browser: import('@playwright/test').Browser, subject: string, handle: string,
): Promise<Page> {
	const page = await newPlayerPage(browser, 'es-ES');
	await page.goto(`/api/auth/signin/e2e?returnUrl=%2F&subject=${subject}`);
	await expect(page.locator('#account-bar .account-status')).toBeVisible();

	await page.getByRole('button', { name: appI18n('es').account.manage as string }).click();
	await expect(page.locator('.account-settings')).toBeVisible();
	const field = page.locator('#account-handle-input');
	await field.fill(handle);
	await expect(field).toHaveValue(handle);
	await page.locator('#account-handle-save').click();
	await expect(page.locator('#account-settings-status')).toHaveText(account.handleSaved);
	await page.locator('#account-listed-input').check();
	await expect(page.locator('#account-settings-status')).toHaveText(account.listedOn);
	await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
	return page;
}

/** Open the list of who is connected, freshly read. */
async function openOnline(page: Page) {
	await gotoLobbyHome(page);
	await page.locator('#go-online-btn').click();
	return page.locator('#online-list .online-player');
}

/** Open the friends list, freshly read. */
async function openFriends(page: Page) {
	await gotoLobbyHome(page);
	await page.locator('#go-friends-btn').click();
	return page.locator('#friends-list .friend-row');
}

test('a request is asked from the room, answered from the friends list, and ended by either side', async ({ browser }) => {
	const ana = await listedPlayer(browser, 'friends-ana', 'anafr');
	const berto = await listedPlayer(browser, 'friends-berto', 'bertofr');

	// Ana finds Berto in the room. A stranger's row offers exactly one thing.
	const rows = await openOnline(ana);
	const bertoRow = rows.filter({ hasText: 'bertofr' });
	await expect(bertoRow).toHaveAttribute(
		'aria-label', `bertofr, ${online.activityInLobby}.`);
	await bertoRow.getByRole('button', { name: withHandle(friends.actionRequest, 'bertofr') })
		.click();

	// What she did is said once, and her row now carries the standing — with nothing left to press.
	await expect(ana.locator('#online-status'))
		.toHaveText(withHandle(friends.resultSent, 'bertofr'));
	await expect(bertoRow).toHaveAttribute(
		'aria-label', `bertofr, ${online.activityInLobby}. ${friends.stateSent}`);
	await expect(bertoRow.getByRole('button')).toHaveCount(0);
	await flushAxeAudit(ana);

	// Berto is told from the home page that something is waiting, before he opens anything.
	await gotoLobbyHome(berto);
	await expect(berto.locator('#go-friends-btn'))
		.toHaveText(appI18n('es').lobby.home.friendsButtonWaiting_one as string);

	const waiting = await openFriends(berto);
	// Asserted on the label rather than the text: the row CONTAINS its buttons, and their names
	// are not part of the sentence a screen reader reads for the person.
	await expect(waiting).toHaveAttribute('aria-label', `anafr. ${friends.stateReceived}`);
	await flushAxeAudit(berto);

	await waiting.getByRole('button', { name: withHandle(friends.actionAccept, 'anafr') }).click();
	await expect(berto.locator('#friends-status'))
		.toHaveText(withHandle(friends.resultAccepted, 'anafr'));
	await expect(waiting).toHaveAttribute('aria-label', `anafr. ${friends.stateFriends}`);
	// And the way in stops asking for an answer.
	await gotoLobbyHome(berto);
	await expect(berto.locator('#go-friends-btn'))
		.toHaveText(appI18n('es').lobby.home.friendsButton as string);

	// Both sides agree, and the room says so too.
	const anaRows = await openOnline(ana);
	await expect(anaRows.filter({ hasText: 'bertofr' })).toHaveAttribute(
		'aria-label', `bertofr, ${online.activityInLobby}. ${friends.stateFriends}`);

	// Either of them can end it, and afterwards they are strangers who may ask again.
	const anaFriends = await openFriends(ana);
	await anaFriends.getByRole('button', { name: withHandle(friends.actionRemove, 'bertofr') })
		.click();
	await expect(ana.locator('#friends-status'))
		.toHaveText(withHandle(friends.resultRemoved, 'bertofr'));
	await expect(ana.locator('#friends-empty')).toBeVisible();
	await flushAxeAudit(ana);

	const afterwards = await openOnline(ana);
	await expect(afterwards.filter({ hasText: 'bertofr' })
		.getByRole('button', { name: withHandle(friends.actionRequest, 'bertofr') }))
		.toBeVisible();
});

// The one place the app deliberately shows somebody less than the truth, and the reason it does.
test('a refusal is remembered, never reported, and cannot be reset by asking again', async ({ browser }) => {
	const ana = await listedPlayer(browser, 'friends-asker', 'askerfr');
	const berto = await listedPlayer(browser, 'friends-refuser', 'refuserfr');

	const rows = await openOnline(ana);
	await rows.filter({ hasText: 'refuserfr' })
		.getByRole('button', { name: withHandle(friends.actionRequest, 'refuserfr') }).click();
	await expect(ana.locator('#online-status'))
		.toHaveText(withHandle(friends.resultSent, 'refuserfr'));

	// Berto says no. He is told what that means, because it is not undoable.
	const waiting = await openFriends(berto);
	await waiting.getByRole('button', { name: withHandle(friends.actionDecline, 'askerfr') })
		.click();
	await expect(berto.locator('#friends-status'))
		.toHaveText(withHandle(friends.resultDeclined, 'askerfr'));
	// And it leaves nothing behind on his list: a refusal is not a relationship he carries around.
	await expect(berto.locator('#friends-list .friend-row')).toHaveCount(0);
	await expect(berto.locator('#friends-empty')).toBeVisible();
	await flushAxeAudit(berto);

	// Ana is shown what SHE did — that she asked — and nothing about the answer.
	const anaAfter = await openOnline(ana);
	const refuserRow = anaAfter.filter({ hasText: 'refuserfr' });
	await expect(refuserRow).toHaveAttribute(
		'aria-label', `refuserfr, ${online.activityInLobby}. ${friends.stateSent}`);
	// There is no button at all, so there is nothing that could fail and give the answer away.
	await expect(refuserRow.getByRole('button')).toHaveCount(0);

	// Asking again from her own list reaches nobody: Berto is not asked a second time.
	await expect(berto.locator('#friends-list .friend-row')).toHaveCount(0);
	await gotoLobbyHome(berto);
	await expect(berto.locator('#go-friends-btn'))
		.toHaveText(appI18n('es').lobby.home.friendsButton as string);
});

test('the roster is one tab stop with arrows inside it, and Shift+F10 opens a person actions', async ({ browser }) => {
	const ana = await listedPlayer(browser, 'friends-keys-a', 'keysana');
	await listedPlayer(browser, 'friends-keys-b', 'keysberto');

	const rows = await openOnline(ana);
	await expect(rows).toHaveCount(2);

	// The same bargain as the table roster and the players panel: one way in, arrows for the rest.
	await expect(rows.first()).toHaveAttribute('tabindex', '0');
	await expect(rows.nth(1)).toHaveAttribute('tabindex', '-1');
	await expect(ana.locator('.online-surface')).toHaveAttribute('role', 'application');

	await rows.first().focus();
	await ana.keyboard.press('ArrowDown');
	await expect(rows.nth(1)).toBeFocused();

	// The menu is the same actions as the row's toolbar, hosted INSIDE the view so it stays within
	// a landmark rather than floating as an orphan under <body>.
	await ana.keyboard.press('Shift+F10');
	const menu = ana.locator('#view-online .player-context-menu');
	await expect(menu).toBeVisible();
	await expect(menu.getByRole('menuitem')).toHaveCount(1);
	await flushAxeAudit(ana);
	await ana.keyboard.press('Escape');
	await expect(menu).toBeHidden();
});

test('signed out, neither way in is offered at all', async ({ browser }) => {
	const stranger = await newPlayerPage(browser, 'es-ES');
	await gotoLobbyHome(stranger);

	await expect(stranger.locator('#go-online-btn')).toBeHidden();
	await expect(stranger.locator('#go-friends-btn')).toBeHidden();
	await flushAxeAudit(stranger);
});
