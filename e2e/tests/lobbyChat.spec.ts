// lobbyChat.spec.ts — writing to people from the lobby, on real browsers.
//
// The rule the whole panel exists to enforce is asserted first: there is NO general channel here,
// and a line that names nobody is refused with the reason instead of going somewhere surprising. A
// lobby-wide channel would be a stream of strangers talking, which for somebody listening to every
// line is not a feature.
//
// The rest is what a person would actually try: "@" in the middle of a sentence, two people at
// once, and a bare "@" meaning "you again".

import { test, expect } from '../helpers/test';
import { flushAxeAudit } from '../helpers/axeAudit';
import {
	appI18n, closeAccountSettings, expectAnnouncement, gotoLobbyHome, newPlayerPage,
	openAccountSettings,
} from '../helpers/game';
import type { Page } from '../helpers/test';

const account = appI18n('es').account.settings as Record<string, string>;
const chat = appI18n('es').lobby.chat as Record<string, string>;
const home = appI18n('es').lobby.home as Record<string, string>;

/** Messages are a screen of their own now, reached from the home page's People block. */
async function openMessages(page: Page): Promise<void> {
	await page.locator('#go-messages-btn').click();
	await expect(page.locator('#view-messages')).toBeVisible();
}

/** A signed-in player with a public name, visible to everyone and open to messages. */
async function chatter(
	browser: import('@playwright/test').Browser, subject: string, handle: string,
	options: { messages?: 'nobody' | 'friends' | 'anyone' } = {},
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
	await page.locator('#account-visibility-everyone').check();
	await expect(page.locator('#account-settings-status'))
		.toHaveText(account.visibilitySavedEveryone);
	await page.locator(`#account-messages-${options.messages ?? 'anyone'}`).check();
	await closeAccountSettings(page);

	await gotoLobbyHome(page);
	await openMessages(page);
	return page;
}

const write = async (page: Page, text: string) => {
	await page.locator('#lobby-chat-input').fill(text);
	await page.locator('#lobby-chat-send').click();
};

test('a message with no name is refused with the reason, and never sent anywhere', async ({ browser }) => {
	const ana = await chatter(browser, 'lchat-alone', 'lchatana');

	await write(ana, 'hola a todos');

	await expect(ana.locator('#lobby-chat-status')).toHaveText(chat.noRecipient);
	// What they typed is still there to fix rather than swallowed, and nothing was logged.
	await expect(ana.locator('#lobby-chat-input')).toHaveValue('hola a todos');
	await expect(ana.locator('#lobby-chat-log .lobby-chat__line')).toHaveCount(0);
	await flushAxeAudit(ana);
});

test('naming somebody delivers to them, and a bare @ replies to the whole group', async ({ browser }) => {
	const ana = await chatter(browser, 'lchat-ana', 'lchatana2');
	const berto = await chatter(browser, 'lchat-berto', 'lchatberto');
	const cora = await chatter(browser, 'lchat-cora', 'lchatcora');

	// The @ in the middle of a sentence, and two people at once.
	await write(ana, 'buenas @lchatberto y @lchatcora, ¿jugamos?');

	await expect(ana.locator('#lobby-chat-status'))
		.toHaveText(chat.sent.replace('{{to}}', 'lchatberto, lchatcora'));

	// It arrives at both, saying who else heard it — which is part of what was said.
	for (const page of [berto, cora]) {
		await expect(page.locator('#lobby-chat-log .lobby-chat__line')).toHaveCount(1);
	}
	const arrived = berto.locator('#lobby-chat-log .lobby-chat__line');
	await expect(arrived).toContainText('lchatana2');
	await expect(arrived).toContainText('lchatcora');
	await expect(arrived).toContainText('¿jugamos?');
	await flushAxeAudit(berto);

	// A bare "@" answers the same conversation — Ana and Cora, never Berto himself.
	await write(berto, '@ claro que sí');
	await expect(ana.locator('#lobby-chat-log .lobby-chat__line').last())
		.toContainText('claro que sí');
	await expect(cora.locator('#lobby-chat-log .lobby-chat__line').last())
		.toContainText('claro que sí');
	await expect(berto.locator('#lobby-chat-log .lobby-chat__line')).toHaveCount(2);
});

// Away, unknown, and "does not accept messages from you" must be impossible to tell apart, or this
// becomes a way to learn who exists and who has quietly shut somebody out.
test('a refusal reads the same whoever refused and for whatever reason', async ({ browser }) => {
	const ana = await chatter(browser, 'lchat-sender', 'lchatsender');
	await chatter(browser, 'lchat-closed', 'lchatclosed', { messages: 'nobody' });

	const status = ana.locator('#lobby-chat-status');

	// Somebody who accepts nothing…
	await write(ana, '@lchatclosed hola');
	await expect(status).toHaveText(chat.unreachable.replace('{{handles}}', 'lchatclosed'));
	const refused = (await status.textContent())!;

	// …and a name nobody holds.
	await write(ana, '@lchatnobodyatall hola');
	await expect(status).toHaveText(chat.unreachable.replace('{{handles}}', 'lchatnobodyatall'));
	const unknown = (await status.textContent())!;

	// Same sentence, different name: nothing in it says which of the two happened.
	expect(refused.replace('lchatclosed', 'X')).toBe(unknown.replace('lchatnobodyatall', 'X'));
	// And nothing was logged either way: a message that was not delivered did not happen.
	await expect(ana.locator('#lobby-chat-log .lobby-chat__line')).toHaveCount(0);
});

test('the matching names are counted out loud and walked with the arrows', async ({ browser }) => {
	await chatter(browser, 'lchat-match-one', 'lchatmatchone');
	await chatter(browser, 'lchat-match-two', 'lchatmatchtwo');
	const ana = await chatter(browser, 'lchat-typer', 'lchattyper');

	const input = ana.locator('#lobby-chat-input');
	await input.click();
	await input.pressSequentially('@lchatmatch');

	// Said, not merely shown: a list that appears in silence is one somebody listening never
	// learns about.
	await expect(ana.locator('#lobby-chat-status'))
		.toHaveText(chat.matches.replace('{{count}}', '2'));
	// A real listbox of options, not loose buttons: without the roles a screen reader announces
	// each one alone, with no position and no idea how many more there are.
	const suggestions = ana.locator('#lobby-chat-suggestions');
	await expect(suggestions).toHaveRole('listbox');
	const options = suggestions.getByRole('option');
	await expect(options).toHaveCount(2);
	await flushAxeAudit(ana);

	// Down from the box reaches them, exactly as the announcement invites.
	await input.press('ArrowDown');
	await expect(options.first()).toBeFocused();
	await expect(options.first()).toHaveAttribute('aria-selected', 'true');

	// The arrows walk it, and the selection follows the focus.
	await ana.keyboard.press('ArrowDown');
	await expect(options.nth(1)).toBeFocused();
	await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
	await ana.keyboard.press('ArrowUp');

	await options.first().press('Enter');
	await expect(input).toHaveValue('@lchatmatchone ');
});

test('signed out, there is no way in and no screen behind it', async ({ browser }) => {
	const stranger = await newPlayerPage(browser, 'es-ES');
	await gotoLobbyHome(stranger);

	// The whole People block is withheld: writing needs an account on both ends, so a door that
	// could only ever answer "sign in first" is a dead end with extra steps.
	await expect(stranger.locator('#home-people')).toBeHidden();
	await expect(stranger.locator('#go-messages-btn')).toBeHidden();
	await expect(stranger.locator('#view-messages')).toBeHidden();
	await flushAxeAudit(stranger);
});

// The screen moved off the home page, so a message landing while somebody is reading their tables
// must still reach them: said once, and then WAITING somewhere they can find it. A count painted
// in a corner would be invisible to exactly the people this lobby is for, so it is in the name of
// the button.
test('a message that lands while you are elsewhere is said once and waits in the button name', async ({ browser }) => {
	const ana = await chatter(browser, 'lchat-teller', 'lchatteller');
	const berto = await chatter(browser, 'lchat-away', 'lchataway');

	// Berto goes back to his tables: the messages screen is no longer where he is.
	await berto.locator('#messages-back-btn').click();
	await expect(berto.locator('#view-home')).toBeVisible();

	await write(ana, '@lchataway ¿jugamos?');

	// Who wrote, never what they wrote: the lobby says there is something to read, and reading it
	// stays the reader's own move.
	await expectAnnouncement(berto, /lchatteller te ha escrito\./);
	await expect(berto.locator('#go-messages-btn')).toHaveText(home.messagesButtonUnread_one);
	await flushAxeAudit(berto);

	// Opening the screen IS reading it, so the mark goes.
	await openMessages(berto);
	await expect(berto.locator('#lobby-chat-log .lobby-chat__line')).toHaveCount(1);
	await expect(berto.locator('#go-messages-btn')).toHaveText(home.messagesButton);
	await flushAxeAudit(berto);
});

// Regression: the server sends a copy of every message to the sender's OTHER tabs, so that a
// conversation reads the same everywhere. The copy carries the SENDER's handle, and read as an
// arrival it told somebody they had written to themselves and left an unread mark on a line they
// had just written.
test('your own line reaching your other tab is not somebody writing to you', async ({ browser }) => {
	const ana = await chatter(browser, 'lchat-echo', 'lchatecho');
	await chatter(browser, 'lchat-echo-peer', 'lchatechopeer');

	// The same person, signed in again in another tab. The account already has its public name, so
	// there is nothing to set up here: this is simply somebody with the lobby open twice.
	const otherTab = await newPlayerPage(browser, 'es-ES');
	await otherTab.goto('/api/auth/signin/e2e?returnUrl=%2F&subject=lchat-echo');
	await expect(otherTab.locator('#account-bar .account-status')).toBeVisible();
	await gotoLobbyHome(otherTab);

	await write(ana, '@lchatechopeer ¿jugamos?');

	// It reaches the other tab written as what it is — their own line, to somebody — and leaves no
	// mark on the way in, because there is nothing there they have not read.
	const echoed = otherTab.locator('#lobby-chat-log .lobby-chat__line');
	await expect(echoed).toHaveCount(1);
	await expect(echoed).toHaveText(
		chat.lineMine.replace('{{to}}', 'lchatechopeer').replace('{{text}}', '¿jugamos?'));
	await expect(otherTab.locator('#go-messages-btn')).toHaveText(home.messagesButton);
	await flushAxeAudit(otherTab);
});
