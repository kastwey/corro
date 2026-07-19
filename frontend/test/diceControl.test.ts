import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';
import { diceControl } from '../src/diceControl.js';

let rollCount = 0;
let unavailableReason = '';

/**
 * The dice control shows the roll result. With motion ON it tumbles first; with motion OFF it
 * must set the faces at once — otherwise the die keeps "rolling" while the token has already
 * snapped to its destination, leaking where the player lands before the roll finishes (bug #14).
 */

before(() => {
	setupDom();
	installFakeI18next('en');
	// The control is a singleton; mount it once (init() is a no-op after the first call).
	const mount = document.createElement('div');
	document.body.appendChild(mount);
	diceControl.init(mount, {
		onRoll: () => { rollCount++; },
		onUnavailable: reason => { unavailableReason = reason; },
	});
});

function faces(): { die1: HTMLElement; die2: HTMLElement } {
	const [die1, die2] = Array.from(document.querySelectorAll('.die')) as HTMLElement[];
	return { die1, die2 };
}

test('with motion OFF the faces are set immediately with no tumbling class', () => {
	diceControl.animateRoll(3, 5, /* animate */ false);

	const { die1, die2 } = faces();
	assert.equal(die1.dataset.face, '3');
	assert.equal(die2.dataset.face, '5');
	assert.equal(die1.classList.contains('die--rolling'), false);
	assert.equal(die2.classList.contains('die--rolling'), false);
});

test('with motion ON the dice tumble first (faces revealed only after the roll)', () => {
	// Start from a known face so we can prove the result is NOT shown yet mid-tumble.
	diceControl.animateRoll(1, 1, false);
	diceControl.animateRoll(6, 2, /* animate */ true);

	const { die1, die2 } = faces();
	assert.equal(die1.classList.contains('die--rolling'), true, 'die is tumbling');
	assert.equal(die2.classList.contains('die--rolling'), true);
	// The final faces are not shown while still tumbling (only after the timeout).
	assert.notEqual(die1.dataset.face, '6');
});

test('the unavailable roll button stays focusable and explains why it cannot act', () => {
	const button = document.getElementById('dice-button') as HTMLButtonElement;
	diceControl.setEnabled(false);
	button.focus();
	button.click();

	assert.equal(button.disabled, false, 'native disabled must not remove the button from the tab order');
	assert.equal(button.getAttribute('aria-disabled'), 'true');
	assert.equal(document.activeElement, button);
	assert.equal(rollCount, 0);
	assert.equal(unavailableReason, 'Roll dice (not your turn)');
	assert.equal(
		document.getElementById(button.getAttribute('aria-describedby')!)!.textContent,
		'Roll dice (not your turn)');
});

test('the available roll button performs the action', () => {
	const button = document.getElementById('dice-button') as HTMLButtonElement;
	diceControl.setEnabled(true);
	button.click();

	assert.equal(button.getAttribute('aria-disabled'), 'false');
	assert.equal(button.hasAttribute('aria-describedby'), false);
	assert.equal(rollCount, 1);
});
