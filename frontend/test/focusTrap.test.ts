import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { FocusTrap, focusableWithin } from '../src/focusTrap.js';

/**
 * Regression tests for the reusable Tab / Shift+Tab focus trap that keeps keyboard
 * focus inside the board and lobby pages (and, reused, inside the auction dialog).
 * We assert: focusable collection skips hidden / disabled / negative-tabindex /
 * closed-dialog elements; Tab wraps last → first and Shift+Tab wraps first → last;
 * a page trap scopes to an open modal <dialog> while keeping a non-modal one within
 * the body (so Tab never escapes to the browser chrome); and deactivate() detaches it.
 */

function dispatchTab(shiftKey = false): boolean {
	const ev = new (globalThis as any).window.KeyboardEvent('keydown', {
		key: 'Tab', shiftKey, bubbles: true, cancelable: true,
	});
	return document.dispatchEvent(ev);
}

function button(label: string): HTMLButtonElement {
	const b = document.createElement('button');
	b.type = 'button';
	b.textContent = label;
	document.body.appendChild(b);
	return b;
}

let trap: FocusTrap | null;

before(() => {
	setupDom();
});

beforeEach(() => {
	document.body.innerHTML = '';
	trap?.deactivate();
	trap = null;
});

test('focusableWithin skips disabled, aria-hidden, negative-tabindex and hidden elements', () => {
	const first = button('first');
	const disabled = button('disabled'); disabled.setAttribute('disabled', '');
	const hiddenAttr = button('hidden'); hiddenAttr.setAttribute('hidden', '');
	const ariaHidden = button('aria'); ariaHidden.setAttribute('aria-hidden', 'true');
	const rover = button('rover'); rover.tabIndex = -1;
	const displayNone = button('none'); displayNone.style.display = 'none';
	const last = button('last');

	const found = focusableWithin(document.body);
	assert.deepEqual(found, [first, last]);
});

test('a closed <dialog> hides its descendant buttons; an open one exposes them', () => {
	const outside = button('outside');
	const dialog = document.createElement('dialog');
	const inside = document.createElement('button');
	inside.textContent = 'inside';
	dialog.appendChild(inside);
	document.body.appendChild(dialog);

	assert.deepEqual(focusableWithin(document.body), [outside], 'closed dialog content is not focusable');

	(dialog as HTMLDialogElement).open = true;
	assert.deepEqual(focusableWithin(document.body), [outside, inside], 'open dialog content is focusable');
});

test('Tab on the last focusable wraps to the first', () => {
	const first = button('first');
	const last = button('last');
	trap = new FocusTrap({ getRoot: () => document.body });
	trap.activate();

	last.focus();
	const notCancelled = dispatchTab(false);

	assert.equal(notCancelled, false, 'Tab is consumed at the boundary');
	assert.equal(document.activeElement, first);
});

test('Shift+Tab on the first focusable wraps to the last', () => {
	const first = button('first');
	const last = button('last');
	trap = new FocusTrap({ getRoot: () => document.body });
	trap.activate();

	first.focus();
	const notCancelled = dispatchTab(true);

	assert.equal(notCancelled, false);
	assert.equal(document.activeElement, last);
});

test('Tab in the middle of the list is left untouched (normal browser advance)', () => {
	button('first');
	const middle = button('middle');
	button('last');
	trap = new FocusTrap({ getRoot: () => document.body });
	trap.activate();

	middle.focus();
	const notCancelled = dispatchTab(false);

	assert.equal(notCancelled, true, 'Tab is not consumed mid-list');
});

test('Tab from a roving tabindex=-1 element moves to the adjacent tab stop, never the chrome', () => {
	const first = button('first');
	const rover = button('rover'); rover.tabIndex = -1; // focusable via script, not a Tab stop
	const last = button('last');
	trap = new FocusTrap({ getRoot: () => document.body });
	trap.activate();

	// Forward Tab from the roving element advances to the next real tab stop (last).
	rover.focus();
	let cancelled = !dispatchTab(false);
	assert.equal(cancelled, true, 'Tab is consumed at a non-tab-stop');
	assert.equal(document.activeElement, last);

	// Shift+Tab from it steps back to the previous real tab stop (first).
	rover.focus();
	dispatchTab(true);
	assert.equal(document.activeElement, first);
});

test('Tab from a roving tabindex=-1 sitting after the last tab stop wraps to the first', () => {
	const first = button('first');
	button('last');
	const rover = button('rover'); rover.tabIndex = -1; // sits AFTER every real tab stop
	trap = new FocusTrap({ getRoot: () => document.body });
	trap.activate();

	rover.focus();
	dispatchTab(false);
	assert.equal(document.activeElement, first, 'no following tab stop → wrap to the first, not the chrome');
});

test('a <summary> disclosure toggle is a real Tab stop, so focus is not trapped on it', () => {
	const first = button('first');
	const details = document.createElement('details');
	const summary = document.createElement('summary');
	summary.textContent = 'rules';
	details.appendChild(summary);
	document.body.appendChild(details);
	const last = button('last');

	// The toggle is collected as a focus stop, in DOM order between the two buttons.
	assert.deepEqual(focusableWithin(document.body), [first, summary, last]);

	trap = new FocusTrap({ getRoot: () => document.body });
	trap.activate();

	// Focused mid-list, Tab is left to the browser to advance natively (not consumed and
	// not redirected as if it were a roving tabindex=-1 element), so focus can leave the
	// toggle instead of getting stuck on it.
	summary.focus();
	assert.equal(document.activeElement, summary);
	const notCancelled = dispatchTab(false);
	assert.equal(notCancelled, true, 'Tab from a summary advances natively, never trapped');
});

test('a page trap scopes to an open modal <dialog>: focus stays inside it, never the inert body', () => {
	const outside = button('outside');
	const dialog = document.createElement('dialog');
	dialog.dataset.modal = 'true'; // jsdom has no :modal — mark it as our isModalDialog fallback
	const inFirst = document.createElement('button'); inFirst.textContent = 'in-first';
	const inLast = document.createElement('button'); inLast.textContent = 'in-last';
	dialog.append(inFirst, inLast);
	document.body.appendChild(dialog);
	(dialog as HTMLDialogElement).open = true;

	trap = new FocusTrap({ getRoot: () => document.body, scopeToOpenModal: true });
	trap.activate();

	// Tab on the dialog's last control wraps to its first — it does NOT reach the
	// inert body control nor the browser chrome.
	inLast.focus();
	const cancelled = !dispatchTab(false);
	assert.equal(cancelled, true, 'the trap acts within the modal');
	assert.equal(document.activeElement, inFirst);

	// Shift+Tab on the dialog's first control wraps to its last, still inside the dialog.
	inFirst.focus();
	dispatchTab(true);
	assert.equal(document.activeElement, inLast);
	assert.notEqual(document.activeElement, outside);
});

test('a page trap keeps a NON-modal <dialog> within the body (Tab never escapes)', () => {
	const outside = button('outside');
	const dialog = document.createElement('dialog'); // no data-modal → treated as non-modal
	const inside = document.createElement('button'); inside.textContent = 'inside';
	dialog.appendChild(inside);
	document.body.appendChild(dialog);
	(dialog as HTMLDialogElement).open = true;

	trap = new FocusTrap({ getRoot: () => document.body, scopeToOpenModal: true });
	trap.activate();

	// The body is the root, so focus circulates the whole page (outside button + the
	// non-modal dialog's control) but Tab on the last one wraps back to the first.
	inside.focus(); // 'inside' is the last focusable in DOM order
	dispatchTab(false);
	assert.equal(document.activeElement, outside, 'Tab wraps to the first body control, never the chrome');
});

test('deactivate() detaches the trap so Tab is no longer wrapped', () => {
	const first = button('first');
	const last = button('last');
	trap = new FocusTrap({ getRoot: () => document.body });
	trap.activate();
	trap.deactivate();

	last.focus();
	const notCancelled = dispatchTab(false);

	assert.equal(notCancelled, true);
	assert.equal(document.activeElement, last);
});

test('when focus escaped the root, Tab pulls it back to the first focusable', () => {
	const root = document.createElement('section');
	const inner = document.createElement('button');
	inner.textContent = 'inner';
	root.appendChild(inner);
	document.body.appendChild(root);
	const outside = button('outside'); // sibling, not inside root

	trap = new FocusTrap({ getRoot: () => root });
	trap.activate();

	outside.focus();
	const notCancelled = dispatchTab(false);

	assert.equal(notCancelled, false);
	assert.equal(document.activeElement, inner);
});
