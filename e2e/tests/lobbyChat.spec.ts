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
import { appI18n, gotoLobbyHome, newPlayerPage } from '../helpers/game';
import type { Page } from '../helpers/test';

const account = appI18n('es').account.settings as Record<string, string>;
const chat = appI18n('es').lobby.chat as Record<string, string>;

/** A signed-in player with a public name, visible to everyone and open to messages. */
async function chatter(
	browser: import('@playwright/test').Browser, subject: string, handle: string,
	options: { messages?: 'nobody' | 'friends' | 'anyone' } = {},
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
	await page.locator('#account-visibility-everyone').check();
	await expect(page.locator('#account-settings-status'))
		.toHaveText(account.visibilitySavedEveryone);
	await page.locator(`#account-messages-${options.messages ?? 'anyone'}`).check();
	await page.getByRole('button', { name: 'Cerrar', exact: true }).click();

	await gotoLobbyHome(page);
	await expect(page.locator('#lobby-chat')).toBeVisible();
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
	const options = ana.locator('#lobby-chat-suggestions button');
	await expect(options).toHaveCount(2);
	await flushAxeAudit(ana);

	// Down from the box reaches them, exactly as the announcement invites.
	await input.press('ArrowDown');
	await expect(options.first()).toBeFocused();

	await options.first().press('Enter');
	await expect(input).toHaveValue('@lchatmatchone ');
});

test('signed out, there is no panel at all', async ({ browser }) => {
	const stranger = await newPlayerPage(browser, 'es-ES');
	await gotoLobbyHome(stranger);

	await expect(stranger.locator('#lobby-chat')).toBeHidden();
	await flushAxeAudit(stranger);
});
