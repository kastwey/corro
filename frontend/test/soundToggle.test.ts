import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';
import { initSoundToggle } from '../src/soundToggle.js';

/**
 * DOM regression tests for the header sound on/off button. It mirrors the theme toggle: an
 * icon button whose crossed-out speaker and localized action label BOTH state the current
 * mute state, delegating the actual toggle to an onToggle callback.
 *
 * It carries no aria-pressed, on purpose. A button that renames itself is not a toggle
 * button, and stating the same state a third time is what made it unclear: "turn sound
 * effects on, not pressed" leaves a listener working out the state from a double negative.
 */

before(() => {
	setupDom();
	installFakeI18next('en');
});

beforeEach(() => {
	document.body.innerHTML = '';
});

function mountToggle(initialMuted: boolean, onToggle: () => void = () => {}) {
	const mount = document.createElement('div');
	document.body.appendChild(mount);
	const controller = initSoundToggle(mount, { initialMuted, onToggle });
	const btn = document.getElementById('sound-toggle') as HTMLButtonElement;
	return { controller, btn };
}

test('renders an icon button mounted in the container', () => {
	const { btn } = mountToggle(false);
	assert.ok(btn, 'button exists');
	assert.equal(btn.type, 'button');
	assert.equal(btn.className, 'icon-btn');
	assert.ok(btn.querySelector('svg'), 'has an icon');
});

test('reflects the unmuted initial state ("turn off" label, no pressed state)', () => {
	const { btn } = mountToggle(false);
	assert.equal(btn.getAttribute('aria-label'), 'Turn sound effects off');
	assert.equal(btn.title, 'Turn sound effects off');
	assert.equal(btn.getAttribute('aria-pressed'), null);
});

test('reflects the muted initial state ("turn on" label, no pressed state)', () => {
	const { btn } = mountToggle(true);
	assert.equal(btn.getAttribute('aria-label'), 'Turn sound effects on');
	assert.equal(btn.getAttribute('aria-pressed'), null);
});

test('click invokes the onToggle callback', () => {
	let calls = 0;
	const { btn } = mountToggle(false, () => { calls++; });
	btn.click();
	btn.click();
	assert.equal(calls, 2);
});

test('sync repaints the icon and the label', () => {
	const { controller, btn } = mountToggle(false);
	controller.sync(true);
	assert.equal(btn.getAttribute('aria-label'), 'Turn sound effects on');

	controller.sync(false);
	assert.equal(btn.getAttribute('aria-label'), 'Turn sound effects off');
	assert.equal(btn.getAttribute('aria-pressed'), null, 'never gains a pressed state');
});

test('a blocked initial state shows the "tap to enable" hint', () => {
	const mount = document.createElement('div');
	document.body.appendChild(mount);
	initSoundToggle(mount, { initialMuted: false, initialBlocked: true, onToggle: () => {} });
	const btn = document.getElementById('sound-toggle') as HTMLButtonElement;
	assert.equal(btn.getAttribute('aria-pressed'), null);
	assert.equal(btn.getAttribute('aria-label'), 'Enable sound (blocked by your browser)');
	assert.ok(btn.classList.contains('is-sound-blocked'), 'carries the blocked styling hook');
});

test('sync(blocked) toggles the blocked hint on and off', () => {
	const { controller, btn } = mountToggle(false);
	assert.ok(!btn.classList.contains('is-sound-blocked'));

	controller.sync(false, true);
	assert.ok(btn.classList.contains('is-sound-blocked'));
	assert.equal(btn.getAttribute('aria-label'), 'Enable sound (blocked by your browser)');

	// Once audio unlocks, the hint clears and the button reads as on.
	controller.sync(false, false);
	assert.ok(!btn.classList.contains('is-sound-blocked'));
	assert.equal(btn.getAttribute('aria-label'), 'Turn sound effects off');
});

test('a muted player never shows the blocked hint (they chose silence)', () => {
	const { controller, btn } = mountToggle(true);
	controller.sync(true, true);
	assert.ok(!btn.classList.contains('is-sound-blocked'), 'muted wins over blocked');
	assert.equal(btn.getAttribute('aria-label'), 'Turn sound effects on');
});

