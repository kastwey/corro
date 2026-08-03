import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';

// A dialog places its opening focus on a short timer, because doing it in the same turn as
// showModal() bounced. That timer used to focus UNCONDITIONALLY, which made it a keystroke thief:
// the browser has already put focus in the dialog when it opens, so somebody who starts typing
// straight away — a fast typist, or anyone driving this from a braille display — had the caret
// yanked to the first field mid-word and lost what they had written.
//
// So the rule these tests pin down is: the late pass may PLACE focus, never MOVE it.

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

/** Longer than the placement delay, so a test observes where focus actually settled. */
const settled = () => new Promise(resolve => setTimeout(resolve, 80));

/** A form with two fields, the shape that made the loss visible: name first, handle second. */
function twoFieldForm(): { content: HTMLElement; first: HTMLInputElement; second: HTMLInputElement } {
	const content = document.createElement('div');
	const first = document.createElement('input');
	first.id = 'first-field';
	const second = document.createElement('input');
	second.id = 'second-field';
	content.append(first, second);
	return { content, first, second };
}

function showForm(content: HTMLElement, initialFocus: HTMLElement): void {
	dialogManager.show({
		title: 'Your account',
		contentElement: content,
		initialFocus,
		buttons: [{ label: 'Close', action: () => dialogManager.close() }],
	});
}

test('a form dialog opens on the field it names', async () => {
	const { content, first } = twoFieldForm();
	showForm(content, first);

	await settled();

	assert.equal(document.activeElement, first);
});

test('typing in another field is not interrupted by the opening focus', async () => {
	const { content, first, second } = twoFieldForm();
	showForm(content, first);

	// Somebody who went straight for the second field — inside the placement delay, which is the
	// whole point: this is the window in which their keystrokes used to disappear.
	second.focus();
	second.value = 'KASTWEY';

	await settled();

	assert.equal(document.activeElement, second, 'the opening focus stole the caret');
	assert.equal(second.value, 'KASTWEY');
});

test('a dialog whose focus was taken away entirely still gets opened properly', async () => {
	const outside = document.createElement('button');
	document.body.appendChild(outside);
	const { content, first } = twoFieldForm();
	showForm(content, first);

	// Focus left the dialog altogether — a stray script, or a control that vanished. Nobody is
	// holding anything inside, so placing focus is a rescue rather than a theft.
	outside.focus();

	await settled();

	assert.equal(document.activeElement, first);
});

test('the same protection covers a question dialog and its default button', async () => {
	dialogManager.show({
		title: 'Sell?',
		content: '<p><button id="inside-link">Details</button></p>',
		buttons: [
			{ label: 'No', action: () => dialogManager.close() },
			{ label: 'Yes', focus: true, action: () => dialogManager.close() },
		],
	});

	const inside = document.getElementById('inside-link') as HTMLButtonElement;
	inside.focus();

	await settled();

	assert.equal(document.activeElement, inside);
});
