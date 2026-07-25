// chat.spec.ts — the in-game chat, end to end on two real browsers.
//
// Covers: the visible header button and Ctrl+Shift+H toggle landing focus on the compose box; the @mention
// autocomplete moving REAL focus into the floating list and completing on Enter; Enter
// sending; the receiver hearing it through the persistent role="log" region even with
// their panel CLOSED; the actionable unread notification; global announcement-history review;
// non-dialog Ctrl+D behavior; and history surviving a full reload.

import { test, expect } from '../helpers/test';
import { flushAxeAudit } from '../helpers/axeAudit';
import { appI18n, createGame, joinGame, newPlayerPage, resetDice, startGame } from '../helpers/game';

const es = appI18n('es').game as Record<string, string>;

test.beforeEach(async () => {
	await resetDice();
});

test('chat: mention autocompletes, both sides get it, history survives a reload', async ({ browser }) => {
	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);
	const code = await createGame(ana, 'Ana', 'galactic-empire');
	await joinGame(berto, code, 'Berto');
	await startGame(ana, [ana, berto]);

	// Sighted mouse/touch players get a persistent speech-bubble button; it exposes the
	// same shortcut and panel state as the keyboard route. FIRST contact lands on the
	// unencrypted-messages notice (a focusable stop, so it cannot be missed).
	const anaChatToggle = ana.locator('#chat-toggle');
	await expect(anaChatToggle).toBeVisible();
	await expect(anaChatToggle).toHaveAttribute('aria-controls', 'chat-panel');
	await expect(anaChatToggle).not.toHaveAttribute('aria-haspopup', 'dialog');
	await expect(anaChatToggle).toHaveAttribute('aria-keyshortcuts', 'Control+Shift+H');
	await expect(anaChatToggle).toHaveAttribute('aria-expanded', 'false');
	await expect(anaChatToggle).toHaveAttribute('aria-label', es.chat_open);
	await anaChatToggle.click();
	await expect(ana.locator('#chat-panel')).toBeVisible();
	await expect(anaChatToggle).toHaveAttribute('aria-expanded', 'true');
	await expect(anaChatToggle).toHaveAttribute('aria-label', es.chat_close);
	await expect(ana.locator('#chat-disclaimer-text')).toBeFocused();
	await flushAxeAudit(ana);
	await ana.locator('#chat-disclaimer-dismiss').click();
	await expect(ana.locator('#chat-panel-disclaimer')).toBeHidden();
	await expect(ana.locator('#chat-input')).toBeFocused();
	await flushAxeAudit(ana);

	// Typing "@be" moves focus INTO the suggestion list (typed characters keep landing in
	// the textarea); Enter completes the mention and hands focus back.
	await ana.keyboard.type('hola @be');
	const option = ana.locator('#chat-mention-list li');
	await expect(option).toHaveText('Berto');
	await expect(option).toBeFocused();
	await ana.keyboard.press('Enter');
	await expect(ana.locator('#chat-input')).toHaveValue('hola @Berto ');
	await expect(ana.locator('#chat-input')).toBeFocused();

	// Enter sends. Ana sees it in her history; Berto — panel CLOSED — gets it spoken via
	// the persistent role="log" region in <body>.
	await ana.keyboard.type('el trato va en serio');
	await ana.keyboard.press('Enter');
	await expect(ana.locator('#chat-messages li').last()).toContainText('Ana: hola @Berto el trato va en serio');
	await expect(berto.locator('#chat-panel')).toBeHidden();
	await expect(berto.locator('#chat-log')).toContainText('Ana: hola @Berto el trato va en serio');
	const unread = berto.locator('#chat-notification');
	await expect(unread).toBeVisible();
	await expect(unread).toContainText('Ana');
	await expect(berto.locator('#chat-toggle .chat-toggle__badge')).toHaveText('1');
	await flushAxeAudit(berto);

	// Chat uses its own role=log for live speech but also records into the global review history.
	await berto.locator('#board').focus();
	await berto.keyboard.press('Control+End');
	await expect(berto.locator('#sr-live-assertive')).toContainText('Ana: hola @Berto el trato va en serio');

	// The notification itself is actionable (first contact: notice → acknowledge), reads and replies.
	await unread.click();
	await expect(berto.locator('#chat-toggle')).toHaveAttribute('aria-expanded', 'true');
	await expect(unread).toBeHidden();
	await expect(berto.locator('#chat-disclaimer-text')).toBeFocused();
	await flushAxeAudit(berto);
	await berto.locator('#chat-disclaimer-dismiss').click();
	await expect(berto.locator('#chat-messages li').last()).toContainText('el trato va en serio');
	await berto.locator('#chat-input').fill('que sí, pesada');
	await berto.keyboard.press('Enter');
	await expect(ana.locator('#chat-messages li').last()).toContainText('Berto: que sí, pesada');

	// Chat is ordinary panel content, not the board-choice dialog reached by Ctrl+D.
	await berto.locator('#board').focus();
	await berto.keyboard.press('Control+d');
	await expect(berto.locator('#chat-input')).not.toBeFocused();
	await expect(berto.locator('#sr-live-assertive')).toContainText(es.no_dialog);

	// A full reload rejoins with auth and repopulates the history from the document.
	await berto.reload();
	await expect(berto.locator('#board .square, #board .race-cell').first()).toBeVisible();
	await berto.locator('#chat-toggle').click();
	await berto.locator('#chat-disclaimer-dismiss').click();
	await expect(berto.locator('#chat-messages li')).toHaveCount(2);
	await expect(berto.locator('#chat-messages li').first()).toContainText('hola @Berto');
});
