import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';

// Regression (issue #23): a confirmation must CLOSE before it runs the answer, never after
// awaiting it.
//
// The answer to a confirmation is usually a server command, and it used to be awaited with
// the modal still on screen. A native modal <dialog> makes the rest of the page inert for
// as long as it is open, so anything the server opened in reply — the auction that ending a
// turn on a pending purchase starts — could not take focus; and then the close handed focus
// back to the opener. The player who declined a property heard the auction run and never got
// into it: the dialog was open on their screen, unfocused, while focus sat on the action bar.
//
// The ordering is what these tests pin, so they observe it directly: the answer records
// whether the dialog was still open when it ran.

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

/** Drain the microtask queue: the button handler is async, so its `await`s land there. */
async function flushMicrotasks(): Promise<void> {
	for (let i = 0; i < 5; i++) await Promise.resolve();
}

/** The dialog element the manager renders modal dialogs into. */
function modal(): HTMLDialogElement {
	return document.getElementById('game-dialog') as HTMLDialogElement;
}

function primaryButton(): HTMLButtonElement {
	return modal().querySelector('.btn-primary') as HTMLButtonElement;
}

test('showConfirm closes before running the answer, not after awaiting it', async () => {
	let openWhenAnswerRan: boolean | null = null;
	let resolveCommand!: () => void;
	const command = new Promise<void>(resolve => { resolveCommand = resolve; });

	dialogManager.showConfirm({
		title: 'End turn',
		message: 'You can still buy this square.',
		onConfirm: () => {
			openWhenAnswerRan = modal().open;
			return command;
		},
	});
	assert.equal(modal().open, true, 'the confirmation is on screen');

	primaryButton().click();
	// The answer ran synchronously from the click; the dialog was already gone.
	assert.equal(openWhenAnswerRan, false, 'the answer runs with the page no longer inert');
	assert.equal(modal().open, false);

	// And the in-flight command does not reopen or otherwise disturb it when it resolves.
	resolveCommand();
	await command;
	assert.equal(modal().open, false);
});

test('the confirmation does not steal focus back once the answer has placed it elsewhere', async () => {
	// What the auction does: the answer opens another surface and focuses it. The
	// opener-restore on close must already have happened by then, so the surface keeps focus.
	const opener = document.createElement('button');
	opener.id = 'end-turn-btn';
	document.body.appendChild(opener);
	opener.focus();

	const elsewhere = document.createElement('input');
	elsewhere.id = 'auction-bid-input';
	document.body.appendChild(elsewhere);

	dialogManager.showConfirm({
		title: 'End turn',
		message: 'You can still buy this square.',
		onConfirm: () => { elsewhere.focus(); },
	});
	primaryButton().click();
	// The click handler is async, so let every microtask it queued run before looking: the
	// close that steals focus back used to happen in exactly one of them.
	await flushMicrotasks();

	assert.equal(document.activeElement, elsewhere, 'focus is where the answer put it');
});

test('a cancelled confirmation still returns focus to its opener', () => {
	const opener = document.createElement('button');
	opener.id = 'end-turn-btn';
	document.body.appendChild(opener);
	opener.focus();

	let cancelled = false;
	dialogManager.showConfirm({
		title: 'End turn',
		message: 'You can still buy this square.',
		onConfirm: () => { assert.fail('confirm must not run'); },
		onCancel: () => { cancelled = true; },
	});
	(modal().querySelector('.btn-secondary') as HTMLButtonElement).click();

	assert.equal(cancelled, true);
	assert.equal(modal().open, false);
	assert.equal(document.activeElement, opener, 'focus is back on the control that asked');
});

test('showBuyConfirm closes before sending the purchase too', () => {
	let openWhenAnswerRan: boolean | null = null;
	dialogManager.showBuyConfirm({
		squareName: 'Main Square',
		price: 200,
		onConfirm: () => { openWhenAnswerRan = modal().open; },
	});
	assert.equal(modal().open, true);

	primaryButton().click();
	assert.equal(openWhenAnswerRan, false);
	assert.equal(modal().open, false);
});
