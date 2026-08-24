// lobbyError.test.ts — how the lobby says what went wrong.
//
// Reported from a real session: a delete the server refused, and nothing to show for it on the
// home page. The message WAS produced; it was written into a region that had just been revealed,
// at the bottom of a page taller than the window. Both halves of that are tested here — the shape
// of the region (a permanent one, emptied rather than hidden) and the fact that nothing is
// focused, which is what silently failed while the confirmation dialog was still open.

import test, { before, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';

let showError: typeof import('../src/lobby/ui.js').showError;
let hideError: typeof import('../src/lobby/ui.js').hideError;

before(async () => {
	setupDom();
	({ showError, hideError } = await import('../src/lobby/ui.js'));
});

beforeEach(() => {
	// The element the real index.html ships: permanent, empty, and an alert.
	document.body.innerHTML = `
		<button id="opener" type="button">Delete</button>
		<div id="error-message" class="error" role="alert"></div>`;
	// jsdom has no layout, so scrollIntoView is not implemented; showError calls it.
	(document.getElementById('error-message') as HTMLElement).scrollIntoView = () => {};
});

afterEach(() => hideError());

test('the message is written into the region, which is never hidden or shown', () => {
	const region = document.getElementById('error-message')!;

	showError('Only the host can do that.');

	assert.equal(region.textContent, 'Only the host can do that.');
	// The two things that used to happen here and made it missable: a region that is revealed in
	// the same breath as its text may never reach a screen reader at all.
	assert.equal(region.classList.contains('hidden'), false);
	assert.equal((region as HTMLElement).style.display, '', 'display is left to the stylesheet');
});

// It ran focus() "to announce to screen readers". role=alert is what announces it; focus() does
// nothing at all while a modal dialog is open — which is exactly the case that was reported — and
// takes the keyboard away from whatever somebody was doing when it does work.
test('showing a message never moves the keyboard', () => {
	const opener = document.getElementById('opener') as HTMLButtonElement;
	opener.focus();

	showError('Something went wrong.');

	assert.equal(document.activeElement, opener);
});

test('it is scrolled into view, because a message where the eye is not says nothing', () => {
	const region = document.getElementById('error-message')!;
	let scrolled = 0;
	region.scrollIntoView = () => { scrolled++; };

	showError('Only the host can do that.');

	assert.equal(scrolled, 1);
});

test('taking it away empties it rather than hiding it', () => {
	const region = document.getElementById('error-message')!;
	showError('Only the host can do that.');

	hideError();

	assert.equal(region.textContent, '');
	assert.equal(region.classList.contains('hidden'), false);
	assert.equal((region as HTMLElement).style.display, '');
});

test('a second message replaces the first and lives its own full life', () => {
	const region = document.getElementById('error-message')!;
	showError('First.');
	showError('Second.');

	assert.equal(region.textContent, 'Second.');
	// One pending wipe, not two: the first one's clock must not take the second one away early.
	hideError();
	assert.equal(region.textContent, '');
});
