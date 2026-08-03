// presence.spec.ts — the public name, the switch that publishes it, and who is connected.
//
// The list is the first place in this app where one player is shown something ABOUT another
// outside a game, so most of what is asserted here is what it refuses to say: never the account
// display name (which usually comes from a sign-in provider and is a real name), never which
// table, and nothing at all about somebody who opted out.

import { test, expect } from '../helpers/test';
import { flushAxeAudit } from '../helpers/axeAudit';
import { appI18n, createGame, gotoLobbyHome, newPlayerPage } from '../helpers/game';

const account = appI18n('es').account.settings as Record<string, string>;
const online = appI18n('es').lobby.online as Record<string, string>;

async function signIn(page: import('../helpers/test').Page, subject: string) {
	await page.goto(`/api/auth/signin/e2e?returnUrl=%2F&subject=${subject}`);
	await expect(page.locator('#account-bar .account-status')).toBeVisible();
}

async function openSettings(page: import('../helpers/test').Page) {
	await page.getByRole('button', { name: appI18n('es').account.manage as string }).click();
	await expect(page.locator('.account-settings')).toBeVisible();
	await expect(page.locator('#account-name-input')).toBeFocused();
}

/**
 * Claim a public name and ask to be listed — the two steps that put somebody in the room.
 *
 * The value is asserted between filling and saving on purpose. Under the heaviest load this suite
 * runs (four shards WITH coverage instrumentation) this once saved an empty field and failed on
 * "needs at least 3 characters", which says nothing about where the typing went. Pinning the field
 * first means a recurrence names the culprit instead of the symptom.
 */
async function becomeListed(page: import('../helpers/test').Page, handle: string) {
	await openSettings(page);
	const field = page.locator('#account-handle-input');
	await field.fill(handle);
	await expect(field).toHaveValue(handle);
	await page.locator('#account-handle-save').click();
	await expect(page.locator('#account-settings-status')).toHaveText(account.handleSaved);
	await page.locator('#account-listed-input').check();
	await expect(page.locator('#account-settings-status')).toHaveText(account.listedOn);
	await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
}

test('a public name is claimed, refused when taken, and the reasons are Axe-clean', async ({ browser }) => {
	const ana = await newPlayerPage(browser, 'es-ES');
	await signIn(ana, 'presence-ana');
	await openSettings(ana);

	const field = ana.locator('#account-handle-input');
	const status = ana.locator('#account-settings-status');

	/** Type a name and save it, pinning the field first — see becomeListed for why. */
	const claim = async (handle: string) => {
		await field.fill(handle);
		await expect(field).toHaveValue(handle);
		await ana.locator('#account-handle-save').click();
	};

	// The narrow alphabet is the impersonation defence: no accents, so no lookalikes.
	await claim('núria');
	await expect(status).toHaveText(account.handleBadCharacters);
	await flushAxeAudit(ana);

	await claim('ad');
	await expect(status).toHaveText(account.handleTooShort);

	await claim('admin');
	await expect(status).toHaveText(account.handleReserved);
	await flushAxeAudit(ana);

	await claim('Kastwey');
	await expect(status).toHaveText(account.handleSaved);
	await flushAxeAudit(ana);

	// Somebody else asking for the same name, in any casing, is told no.
	const berto = await newPlayerPage(browser, 'es-ES');
	await signIn(berto, 'presence-berto');
	await openSettings(berto);
	const bertoField = berto.locator('#account-handle-input');
	await bertoField.fill('KASTWEY');
	await expect(bertoField).toHaveValue('KASTWEY');
	await berto.locator('#account-handle-save').click();
	await expect(berto.locator('#account-settings-status')).toHaveText(account.handleTaken);
	await flushAxeAudit(berto);
});

test('the list is members-only, opt-in, and never names an account', async ({ browser }) => {
	// Signed out: no way in at all, rather than a button that would turn them away.
	const stranger = await newPlayerPage(browser, 'es-ES');
	await gotoLobbyHome(stranger);
	await expect(stranger.locator('#go-online-btn')).toBeHidden();
	await flushAxeAudit(stranger);

	const ana = await newPlayerPage(browser, 'es-ES');
	await signIn(ana, 'presence-listed');
	await becomeListed(ana, 'anaonline');

	const berto = await newPlayerPage(browser, 'es-ES');
	await signIn(berto, 'presence-watcher');
	await gotoLobbyHome(berto);
	await expect(berto.locator('#go-online-btn')).toBeVisible();
	await berto.locator('#go-online-btn').click();

	const rows = berto.locator('#online-list .online-player');
	await expect(rows.filter({ hasText: 'anaonline' })).toHaveCount(1);
	// One flowing line: the name, and roughly what they are doing.
	await expect(rows.filter({ hasText: 'anaonline' }))
		.toHaveText(`anaonline, ${online.activityInLobby}.`);

	// The account display name — seeded from the provider, usually somebody's real name — is
	// nowhere in this list, and neither is any table.
	await expect(berto.locator('#online-list')).not.toContainText('E2E');
	// Berto has not asked to be listed, so he is not in it — and nothing hints that anybody is
	// hidden either.
	await expect(rows).toHaveCount(1);
	await flushAxeAudit(berto);

	// The roster bargain, the same one the table and the players panel make: one tab stop, arrows
	// inside. role="application" is what makes those arrows mean something to a screen reader.
	await expect(berto.locator('.online-surface')).toHaveAttribute('role', 'application');
	await expect(rows.first()).toHaveAttribute('tabindex', '0');

	// Opting out removes the person completely.
	await openSettings(ana);
	await ana.locator('#account-listed-input').uncheck();
	await expect(ana.locator('#account-settings-status')).toHaveText(account.listedOff);
	await ana.getByRole('button', { name: 'Cerrar', exact: true }).click();

	// gotoLobbyHome rather than reload(): the lobby's own startup settles the view last, so a
	// click that lands before it finishes is undone by it.
	await gotoLobbyHome(berto);
	await berto.locator('#go-online-btn').click();
	await expect(berto.locator('#online-empty')).toBeVisible();
	await expect(berto.locator('#online-list .online-player')).toHaveCount(0);
	await flushAxeAudit(berto);
});

test('the list says what somebody is doing, never which game', async ({ browser }) => {
	const ana = await newPlayerPage(browser, 'es-ES');
	await signIn(ana, 'presence-player');
	await becomeListed(ana, 'anaplaying');

	const watcher = await newPlayerPage(browser, 'es-ES');
	await signIn(watcher, 'presence-onlooker');
	await gotoLobbyHome(watcher);
	await watcher.locator('#go-online-btn').click();
	await expect(watcher.locator('#online-list .online-player'))
		.toHaveText(`anaplaying, ${online.activityInLobby}.`);

	// Ana sits down at a table. The status follows what the SERVER knows — nobody reports their
	// own, so nobody can lie about it.
	const code = await createGame(ana, 'Ana', 'snakes-and-ladders');

	await gotoLobbyHome(watcher);
	await watcher.locator('#go-online-btn').click();
	await expect(watcher.locator('#online-list .online-player'))
		.toHaveText(`anaplaying, ${online.activityAtTable}.`);
	// The invite code is what would let a stranger follow her there. It is not in the list.
	await expect(watcher.locator('#online-list')).not.toContainText(code);
	await flushAxeAudit(watcher);
});
