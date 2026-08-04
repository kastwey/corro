// presence.spec.ts — the public name, the switch that publishes it, and who is connected.
//
// The list is the first place in this app where one player is shown something ABOUT another
// outside a game, so most of what is asserted here is what it refuses to say: never the account
// display name (which usually comes from a sign-in provider and is a real name), never which
// table, and nothing at all about somebody who opted out.

import { test, expect } from '../helpers/test';
import { flushAxeAudit } from '../helpers/axeAudit';
import {
	appI18n, chooseBoard, closeAccountSettings, createGame, gotoLobbyHome, newPlayerPage, openAccountSettings,
} from '../helpers/game';

const account = appI18n('es').account.settings as Record<string, string>;
const online = appI18n('es').lobby.online as Record<string, string>;

async function signIn(page: import('../helpers/test').Page, subject: string) {
	await page.goto(`/api/auth/signin/e2e?returnUrl=%2F&subject=${subject}`);
	await expect(page.locator('#account-bar .account-status')).toBeVisible();
}

async function openSettings(page: import('../helpers/test').Page) {
	await openAccountSettings(page);
	// A screen lands on its heading, which is the top of what was just opened.
	await expect(page.locator('#settings-heading')).toBeFocused();
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
	await page.locator('#account-visibility-everyone').check();
	await expect(page.locator('#account-settings-status'))
		.toHaveText(account.visibilitySavedEveryone);
	await closeAccountSettings(page);
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
	// One flowing line: the name, and roughly what they are doing. Asserted on the row's LABEL,
	// because the row also contains its action buttons and their names are not part of the
	// sentence a screen reader reads for the person.
	await expect(rows.filter({ hasText: 'anaonline' }))
		.toHaveAttribute('aria-label', `anaonline, ${online.activityInLobby}.`);

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
	await ana.locator('#account-visibility-nobody').check();
	await expect(ana.locator('#account-settings-status'))
		.toHaveText(account.visibilitySavedNobody);
	await closeAccountSettings(ana);

	// gotoLobbyHome rather than reload(): the lobby's own startup settles the view last, so a
	// click that lands before it finishes is undone by it.
	await gotoLobbyHome(berto);
	await berto.locator('#go-online-btn').click();
	// Her NAME is gone completely. What remains is a number, which is all anybody hidden ever
	// becomes — and the room still says it is empty of people, because it is.
	await expect(berto.locator('#online-list')).not.toContainText('anaonline');
	await expect(berto.locator('#online-empty')).toBeVisible();
	await expect(berto.locator('#online-list .online-player')).toHaveText(
		appI18n('es').lobby.online.anonymous_one as string);
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
		.toHaveAttribute('aria-label', `anaplaying, ${online.activityInLobby}.`);

	// Ana sits down at a table. The status follows what the SERVER knows — nobody reports their
	// own, so nobody can lie about it.
	const code = await createGame(ana, 'Ana', 'snakes-and-ladders');

	await gotoLobbyHome(watcher);
	await watcher.locator('#go-online-btn').click();
	await expect(watcher.locator('#online-list .online-player'))
		.toHaveAttribute('aria-label', `anaplaying, ${online.activityAtTable}.`);
	// The invite code is what would let a stranger follow her there. It is not in the list.
	await expect(watcher.locator('#online-list')).not.toContainText(code);
	await flushAxeAudit(watcher);
});

// Somebody who has just ticked "list me" has no other way to check it worked. A player who cannot
// glance at anything would otherwise have to take the whole room on faith.
test('you appear in the room yourself, marked, with nothing to do about it', async ({ browser }) => {
	const ana = await newPlayerPage(browser, 'es-ES');
	await signIn(ana, 'presence-self');
	await becomeListed(ana, 'selfana');

	await gotoLobbyHome(ana);
	await ana.locator('#go-online-btn').click();

	const mine = ana.locator('#online-list .online-player');
	await expect(mine).toHaveAttribute(
		'aria-label',
		`selfana, ${online.activityInLobby}. ${appI18n('es').lobby.friends.stateSelf}`);
	// Nobody asks themselves to be friends.
	await expect(mine.getByRole('button')).toHaveCount(0);
	await flushAxeAudit(ana);
});

// A checkbox or radio is not a text field, and a stylesheet that forgets the difference does not
// fail Axe:
// the control keeps its name, its role and its place in the tab order. It just stops LOOKING like
// the option it belongs to. This one was stretched to the full width of the dialog by the blanket
// `input { width: 100% }` rule, so it rendered as a stray square floating on its own line above its
// label — reachable, and unrecognisable. Measured rather than eyeballed, because a screenshot test
// would fail for a hundred reasons that do not matter and this one does.
test('the visibility choices look like radios, beside the words they decide', async ({ browser }) => {
	const ana = await newPlayerPage(browser, 'es-ES');
	await signIn(ana, 'presence-checkbox');
	await openSettings(ana);

	const box = ana.locator('#account-visibility-friends');
	const size = await box.boundingBox();
	expect(size, 'the control has no box at all').not.toBeNull();
	expect(size!.width, 'a radio stretched into a strip is not a radio').toBeLessThan(40);

	// On the SAME line as its label, not stacked above it: they are one thing to read.
	const label = ana.locator('label[for="account-visibility-friends"]');
	const labelBox = (await label.boundingBox())!;
	const boxCentre = size!.y + size!.height / 2;
	expect(boxCentre).toBeGreaterThan(labelBox.y);
	expect(boxCentre).toBeLessThan(labelBox.y + labelBox.height);
	// And it comes first, where the box belongs.
	expect(size!.x).toBeLessThan(labelBox.x + 40);

	// Every other checkbox and radio in the app relies on the same rule, so one of each is pinned
	// here too — the fix was made once, in forms.css, and this is what says so.
	await closeAccountSettings(ana);
	await gotoLobbyHome(ana);
	await ana.locator('#go-create-btn').click();
	await chooseBoard(ana, 'four-colours');
	const radio = ana.locator('.rule-choice__option input[type="radio"]').first();
	expect((await radio.boundingBox())!.width).toBeLessThan(40);
});

// The question has three answers, so it is a radio group in a real fieldset — that is what makes a
// screen reader read the QUESTION before each option, instead of three bare words with no idea what
// they answer.
test('who can see you is one question with three answers, and each is kept exactly', async ({ browser }) => {
	const ana = await newPlayerPage(browser, 'es-ES');
	await signIn(ana, 'presence-radio');
	await openSettings(ana);

	const group = ana.getByRole('group', { name: account.visibilityLegend });
	await expect(group).toBeVisible();
	await expect(group.getByRole('radio')).toHaveCount(3);
	// A new account starts at "only friends", which shows them to nobody until they accept anyone.
	await expect(ana.locator('#account-visibility-friends')).toBeChecked();
	await flushAxeAudit(ana);

	// Each choice is stored, said back, and still there when the dialog is reopened.
	for (const [id, said] of [
		['account-visibility-everyone', account.visibilitySavedEveryone],
		['account-visibility-nobody', account.visibilitySavedNobody],
	] as const) {
		await ana.locator(`#${id}`).check();
		await expect(ana.locator('#account-settings-status')).toHaveText(said);
		await closeAccountSettings(ana);
		await openSettings(ana);
		await expect(ana.locator(`#${id}`)).toBeChecked();
	}
});

// "Only friends" is the setting that needs two people to test, and the one most likely to be got
// wrong: it has to mean the reader's OWN friends, not anybody's.
test('only friends means only friends, and everybody else is a number', async ({ browser }) => {
	const quiet = await newPlayerPage(browser, 'es-ES');
	await signIn(quiet, 'presence-quiet');
	await becomeListed(quiet, 'quietone');
	// Visible to everyone for a moment, so the stranger below can ask to be friends at all.

	const stranger = await newPlayerPage(browser, 'es-ES');
	await signIn(stranger, 'presence-stranger');
	await becomeListed(stranger, 'strangerone');

	// The quiet player narrows to friends only. The stranger is not one.
	await openSettings(quiet);
	await quiet.locator('#account-visibility-friends').check();
	await expect(quiet.locator('#account-settings-status'))
		.toHaveText(account.visibilitySavedFriends);
	await closeAccountSettings(quiet);

	await gotoLobbyHome(stranger);
	await stranger.locator('#go-online-btn').click();
	const rows = stranger.locator('#online-list .online-player');
	// Their own row, and a count for the player they may not see. Never the name.
	await expect(rows.filter({ hasText: 'quietone' })).toHaveCount(0);
	await expect(stranger.locator('#online-list')).not.toContainText('quietone');
	await expect(rows.last()).toHaveAttribute(
		'aria-label', appI18n('es').lobby.online.anonymous_one as string);
	// The count row is not a person: there is nothing to do to it.
	await expect(rows.last().getByRole('button')).toHaveCount(0);
	await flushAxeAudit(stranger);

	// And the view says who can see the READER, so nobody has to infer it from their own absence.
	await expect(stranger.locator('#online-standing'))
		.toHaveText(appI18n('es').lobby.online.youEveryone as string);
	await gotoLobbyHome(quiet);
	await quiet.locator('#go-online-btn').click();
	await expect(quiet.locator('#online-standing'))
		.toHaveText(appI18n('es').lobby.online.youFriends as string);
});

// The whole point of putting unlock codes on the account: a hidden board unlocked on one device is
// there on the next, without anybody having to find the code again. The browser copy is what makes
// the feature work signed out, and it must not be disturbed by any of this.
test('an unlock code follows the account to a browser that never saw it', async ({ browser }) => {
	const laptop = await newPlayerPage(browser, 'es-ES');
	await signIn(laptop, 'unlock-carrier');
	await gotoLobbyHome(laptop);
	await laptop.locator('#go-create-btn').click();
	await expect(laptop.locator('#board-listbox [data-item-id="hidden"]')).toHaveCount(0);

	// Unlocked here, while signed in: the code goes to the account as well as to this browser.
	await laptop.keyboard.press('Control+Shift+Alt+C');
	const unlock = laptop.locator('.game-dialog.dialog-unlock');
	await unlock.locator('#unlock-code-input').fill('e2e-hidden');
	await unlock.locator('#unlock-code-input').press('Enter');
	await expect(laptop.locator('#board-listbox [data-item-id="hidden"]')).toHaveCount(1);

	// A different browser: same person, nothing in its storage, and it has never seen the code.
	const phone = await newPlayerPage(browser, 'es-ES');
	await gotoLobbyHome(phone);
	await phone.locator('#go-create-btn').click();
	await expect(phone.locator('#board-listbox [data-item-id="hidden"]')).toHaveCount(0);

	await signIn(phone, 'unlock-carrier');
	await gotoLobbyHome(phone);
	await phone.locator('#go-create-btn').click();
	await expect(phone.locator('#board-listbox [data-item-id="hidden"]')).toHaveCount(1);
	await flushAxeAudit(phone);
});
