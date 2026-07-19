import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';
import { initSoundToggle } from '../src/soundToggle.js';

/**
 * DOM regression tests for the header sound on/off toggle button. It mirrors the theme
 * toggle: an icon button reflecting the current mute state via aria-pressed and a
 * localized action label, delegating the actual toggle to an onToggle callback.
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

test('reflects the unmuted initial state (pressed, "turn off" label)', () => {
	const { btn } = mountToggle(false);
	assert.equal(btn.getAttribute('aria-pressed'), 'true');
	assert.equal(btn.getAttribute('aria-label'), 'Turn sound effects off');
	assert.equal(btn.title, 'Turn sound effects off');
});

test('reflects the muted initial state (not pressed, "turn on" label)', () => {
	const { btn } = mountToggle(true);
	assert.equal(btn.getAttribute('aria-pressed'), 'false');
	assert.equal(btn.getAttribute('aria-label'), 'Turn sound effects on');
});

test('click invokes the onToggle callback', () => {
	let calls = 0;
	const { btn } = mountToggle(false, () => { calls++; });
	btn.click();
	btn.click();
	assert.equal(calls, 2);
});

test('sync repaints aria-pressed and the label', () => {
	const { controller, btn } = mountToggle(false);
	controller.sync(true);
	assert.equal(btn.getAttribute('aria-pressed'), 'false');
	assert.equal(btn.getAttribute('aria-label'), 'Turn sound effects on');

	controller.sync(false);
	assert.equal(btn.getAttribute('aria-pressed'), 'true');
	assert.equal(btn.getAttribute('aria-label'), 'Turn sound effects off');
});

test('a blocked initial state shows the "tap to enable" hint, not pressed', () => {
	const mount = document.createElement('div');
	document.body.appendChild(mount);
	initSoundToggle(mount, { initialMuted: false, initialBlocked: true, onToggle: () => {} });
	const btn = document.getElementById('sound-toggle') as HTMLButtonElement;
	assert.equal(btn.getAttribute('aria-pressed'), 'false');
	assert.equal(btn.getAttribute('aria-label'), 'Enable sound (blocked by your browser)');
	assert.ok(btn.classList.contains('is-sound-blocked'), 'carries the blocked styling hook');
});

test('sync(blocked) toggles the blocked hint on and off', () => {
	const { controller, btn } = mountToggle(false);
	assert.ok(!btn.classList.contains('is-sound-blocked'));

	controller.sync(false, true);
	assert.ok(btn.classList.contains('is-sound-blocked'));
	assert.equal(btn.getAttribute('aria-pressed'), 'false');
	assert.equal(btn.getAttribute('aria-label'), 'Enable sound (blocked by your browser)');

	// Once audio unlocks, the hint clears and the button reads as on.
	controller.sync(false, false);
	assert.ok(!btn.classList.contains('is-sound-blocked'));
	assert.equal(btn.getAttribute('aria-pressed'), 'true');
	assert.equal(btn.getAttribute('aria-label'), 'Turn sound effects off');
});

test('a muted player never shows the blocked hint (they chose silence)', () => {
	const { controller, btn } = mountToggle(true);
	controller.sync(true, true);
	assert.ok(!btn.classList.contains('is-sound-blocked'), 'muted wins over blocked');
	assert.equal(btn.getAttribute('aria-pressed'), 'false');
	assert.equal(btn.getAttribute('aria-label'), 'Turn sound effects on');
});

test('re-translates its label on a runtime language change (regression: stale until reload)', () => {
	const { btn } = mountToggle(false);
	assert.equal(btn.getAttribute('aria-label'), 'Turn sound effects off');

	// Simulate the lobby applying Spanish at runtime: i18next swaps, then languageChanged fires.
	// The label is set imperatively, so the toggle must repaint itself using its last state.
	installFakeI18next('es');
	document.dispatchEvent(new window.CustomEvent('languageChanged', { bubbles: true }));

	assert.equal(btn.getAttribute('aria-label'), 'Desactivar efectos de sonido');
	assert.equal(btn.title, 'Desactivar efectos de sonido');
});
