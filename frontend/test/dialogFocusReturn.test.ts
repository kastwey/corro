import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';

// Accessibility rule: closing a MODAL dialog returns focus to the control that opened it,
// so a keyboard / screen-reader user lands back where they were instead of on <body>. The
// dialogManager does it centrally — even when a re-render replaced the opener node (same id).

let dialogManager: typeof import('../src/dialogManager.js').dialogManager;

before(async () => {
	setupDom();
	installFakeI18next('es');
	({ dialogManager } = await import('../src/dialogManager.js'));
});

beforeEach(() => {
	document.body.innerHTML = '';
	// The body reset detached the dialog singleton's cached element: drop the cache so it
	// rebuilds fresh (same convention as the other dialog tests).
	(dialogManager as any).dialog = null;
	(dialogManager as any).nonModalDialog = null;
	dialogManager.init();
});

function openerButton(id = 'add-bot-btn'): HTMLButtonElement {
	const btn = document.createElement('button');
	btn.id = id;
	btn.textContent = 'Add bot';
	document.body.appendChild(btn);
	return btn;
}

function showSimple(): void {
	dialogManager.show({
		title: 'Bot',
		content: '<p>name</p>',
		buttons: [{ label: 'Add', variant: 'primary', action: () => dialogManager.close() }],
	});
}

test('closing returns focus to the button that opened the dialog', () => {
	const btn = openerButton();
	btn.focus();
	assert.equal(document.activeElement, btn);

	showSimple();
	// Simulate the dialog having taken focus (its primary button).
	(document.querySelector('#game-dialog button') as HTMLButtonElement).focus();

	dialogManager.close();
	assert.equal(document.activeElement, btn, 'focus is back on the opener');
});

test('when a re-render replaced the opener, focus lands on its replacement by id', () => {
	const btn = openerButton();
	btn.focus();
	showSimple();

	// A re-render (e.g. adding a bot repaints the lobby) swaps the opener for a fresh node
	// carrying the same id — the original is now detached.
	btn.remove();
	const replacement = openerButton(); // same id, new node
	dialogManager.close();

	assert.equal(document.activeElement, replacement, 'focus followed the id to the new node');
});

test('a non-focused opener (body) leaves focus alone — no throw', () => {
	// Nothing was focused: activeElement is <body>. Closing must not crash nor grab focus.
	showSimple();
	assert.doesNotThrow(() => dialogManager.close());
});

test('returnFocusTo restores to the named control even when it never held DOM focus', () => {
	// Simulates a screen-reader browse-mode activation: the button opened the dialog but
	// DOM focus was on <body>, so the auto-capture alone would miss it.
	const btn = openerButton('add-bot-btn');
	assert.notEqual(document.activeElement, btn, 'the opener is NOT focused at open time');

	dialogManager.show({
		title: 'Bot', content: '<p>name</p>', returnFocusTo: 'add-bot-btn',
		buttons: [{ label: 'Add', variant: 'primary', action: () => dialogManager.close() }],
	});
	dialogManager.close();

	assert.equal(document.activeElement, btn, 'focus went to the explicit returnFocusTo control');
});

test('returnFocusTo survives a re-render that swapped the control (by id)', () => {
	const btn = openerButton('add-bot-btn');
	dialogManager.show({
		title: 'Bot', content: '<p>name</p>', returnFocusTo: 'add-bot-btn',
		buttons: [{ label: 'Add', variant: 'primary', action: () => dialogManager.close() }],
	});
	btn.remove();
	const replacement = openerButton('add-bot-btn'); // repaint swapped the node, same id
	dialogManager.close();

	assert.equal(document.activeElement, replacement, 'focus followed the id to the fresh node');
});
