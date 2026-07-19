import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { makeDialogDraggable } from '../src/dialogDrag.js';

/**
 * Floating dialogs can be dragged by their title bar so the player can uncover the board
 * area they want to verify. Dragging is a pointer convenience — keyboard users leave and
 * re-enter the dialog instead — and must never survive a close: the next open re-centers.
 */

before(() => setupDom());

function makeDialog(): HTMLDialogElement {
	document.body.innerHTML = '';
	const dialog = document.createElement('dialog');
	dialog.innerHTML = `<h2 class="dialog-title">Un trato</h2><div class="dialog-content"></div>`;
	document.body.appendChild(dialog);
	makeDialogDraggable(dialog);
	dialog.show();
	return dialog;
}

/** jsdom needs ITS OWN constructors; PointerEvent may be missing, MouseEvent works for the
 *  listener (events dispatch by type name, not by class). */
function pointer(type: string, x: number, y: number): Event {
	const w = (globalThis as any).window;
	const Ctor = w.PointerEvent ?? w.MouseEvent;
	return new Ctor(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0 });
}

test('dragging the title moves the dialog to fixed coordinates following the pointer', () => {
	const dialog = makeDialog();
	const title = dialog.querySelector('.dialog-title')!;

	title.dispatchEvent(pointer('pointerdown', 100, 100));
	assert.equal(dialog.style.position, 'fixed', 'the dialog re-anchors on grab');
	document.dispatchEvent(pointer('pointermove', 140, 130));

	// jsdom rects are all zeros, so the dialog starts at 0,0 and the deltas read directly.
	assert.equal(dialog.style.left, '40px');
	assert.equal(dialog.style.top, '30px');

	document.dispatchEvent(pointer('pointerup', 140, 130));
	document.dispatchEvent(pointer('pointermove', 500, 500));
	assert.equal(dialog.style.left, '40px', 'released: the dialog no longer follows');
});

test('grabbing anywhere OUTSIDE the title does not start a drag', () => {
	const dialog = makeDialog();
	dialog.querySelector('.dialog-content')!.dispatchEvent(pointer('pointerdown', 10, 10));
	assert.equal(dialog.style.position, '', 'content clicks are not drag handles');
});

test('closing clears the dragged position so the next open re-centers', async () => {
	const dialog = makeDialog();
	dialog.querySelector('.dialog-title')!.dispatchEvent(pointer('pointerdown', 0, 0));
	document.dispatchEvent(pointer('pointermove', 60, 60));
	document.dispatchEvent(pointer('pointerup', 60, 60));
	assert.notEqual(dialog.style.left, '');

	dialog.close();
	await new Promise(r => setTimeout(r, 0)); // jsdom queues the close event as a task
	assert.equal(dialog.style.left, '');
	assert.equal(dialog.style.position, '');
	assert.equal(dialog.style.margin, '');
});

test('marks the dialog as draggable for the CSS handle affordance', () => {
	const dialog = makeDialog();
	assert.ok(dialog.classList.contains('dialog--draggable'));
});
