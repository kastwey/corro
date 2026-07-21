// chat.spec.ts — the in-game chat, end to end on two real browsers.
//
// Covers: the Ctrl+Shift+H toggle landing focus on the compose box; the @mention
// autocomplete moving REAL focus into the floating list and completing on Enter; Enter
// sending; the receiver hearing it through the persistent role="log" region even with
// their panel CLOSED; and the history surviving a full reload (authenticated rejoin →
// ChatHistory), because the conversation is persisted with the game.

import { test, expect } from '../helpers/test';
import { createGame, joinGame, newPlayerPage, resetDice, startGame } from '../helpers/game';

test.beforeEach(async () => {
	await resetDice();
});

test('chat: mention autocompletes, both sides get it, history survives a reload', async ({ browser }) => {
	const ana = await newPlayerPage(browser);
	const berto = await newPlayerPage(browser);
	const code = await createGame(ana, 'Ana', 'galactic-empire');
	await joinGame(berto, code, 'Berto');
	await startGame(ana, [ana, berto]);

	// Ctrl+Shift+H opens the floating panel. FIRST contact lands on the
	// unencrypted-messages notice (a focusable stop, so it cannot be missed);
	// acknowledging it hands focus to the compose box.
	await ana.keyboard.press('Control+Shift+H');
	await expect(ana.locator('#chat-panel')).toBeVisible();
	await expect(ana.locator('#chat-disclaimer-text')).toBeFocused();
	await ana.locator('#chat-disclaimer-dismiss').click();
	await expect(ana.locator('#chat-panel-disclaimer')).toBeHidden();
	await expect(ana.locator('#chat-input')).toBeFocused();

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

	// Berto opens his panel (first contact: notice → acknowledge), reads and replies.
	await berto.keyboard.press('Control+Shift+H');
	await berto.locator('#chat-disclaimer-dismiss').click();
	await expect(berto.locator('#chat-messages li').last()).toContainText('el trato va en serio');
	await berto.locator('#chat-input').fill('que sí, pesada');
	await berto.keyboard.press('Enter');
	await expect(ana.locator('#chat-messages li').last()).toContainText('Berto: que sí, pesada');

	// A full reload rejoins with auth and repopulates the history from the document.
	await berto.reload();
	await expect(berto.locator('#board .square, #board .race-cell').first()).toBeVisible();
	await berto.keyboard.press('Control+Shift+H');
	await berto.locator('#chat-disclaimer-dismiss').click();
	await expect(berto.locator('#chat-messages li')).toHaveCount(2);
	await expect(berto.locator('#chat-messages li').first()).toContainText('hola @Berto');
});
