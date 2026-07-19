import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { nextRovingIndex, RovingCheckboxList } from '../src/accessibleList.js';

// ── Pure navigation decision ───────────────────────────────────────────────────

test('nextRovingIndex moves down/right and clamps at the last item', () => {
	assert.equal(nextRovingIndex(0, 'ArrowDown', 3), 1);
	assert.equal(nextRovingIndex(0, 'ArrowRight', 3), 1);
	assert.equal(nextRovingIndex(2, 'ArrowDown', 3), 2); // already last, clamps
});

test('nextRovingIndex moves up/left and clamps at the first item', () => {
	assert.equal(nextRovingIndex(2, 'ArrowUp', 3), 1);
	assert.equal(nextRovingIndex(2, 'ArrowLeft', 3), 1);
	assert.equal(nextRovingIndex(0, 'ArrowUp', 3), 0); // already first, clamps
});

test('nextRovingIndex jumps to the ends with Home and End', () => {
	assert.equal(nextRovingIndex(2, 'Home', 4), 0);
	assert.equal(nextRovingIndex(0, 'End', 4), 3);
});

test('nextRovingIndex returns null for non-navigation keys and empty lists', () => {
	assert.equal(nextRovingIndex(0, ' ', 3), null);    // Space stays native (toggle)
	assert.equal(nextRovingIndex(0, 'Tab', 3), null);  // Tab leaves the list
	assert.equal(nextRovingIndex(0, 'a', 3), null);
	assert.equal(nextRovingIndex(0, 'ArrowDown', 0), null);
});

// ── DOM controller ─────────────────────────────────────────────────────────────

before(() => {
	setupDom();
});

function buildGroup(count: number): { container: HTMLElement; checks: HTMLInputElement[] } {
	document.body.innerHTML = '<fieldset id="group"></fieldset>';
	const container = document.getElementById('group') as HTMLElement;
	const checks: HTMLInputElement[] = [];
	for (let i = 0; i < count; i++) {
		const cb = document.createElement('input');
		cb.type = 'checkbox';
		cb.className = 'roving-check';
		container.appendChild(cb);
		checks.push(cb);
	}
	return { container, checks };
}

let nav: RovingCheckboxList | null = null;
beforeEach(() => {
	nav?.destroy();
	nav = null;
});

test('refreshRovingTabindex leaves exactly one tab stop on the first item', () => {
	const { container, checks } = buildGroup(3);
	nav = new RovingCheckboxList({ container, itemSelector: 'input.roving-check' });
	nav.refreshRovingTabindex();

	assert.equal(checks.filter(c => c.tabIndex === 0).length, 1);
	assert.equal(checks[0].tabIndex, 0);
	assert.equal(checks[1].tabIndex, -1);
	assert.equal(checks[2].tabIndex, -1);
});

test('arrow keys move focus and the single tab stop between checkboxes', () => {
	const { container, checks } = buildGroup(3);
	nav = new RovingCheckboxList({ container, itemSelector: 'input.roving-check' });
	nav.refreshRovingTabindex();

	checks[0].focus();
	checks[0].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
	assert.equal(document.activeElement, checks[1]);
	assert.equal(checks[1].tabIndex, 0);
	assert.equal(checks[0].tabIndex, -1);

	checks[1].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'End', bubbles: true }));
	assert.equal(document.activeElement, checks[2]);
	assert.equal(checks[2].tabIndex, 0);
});

test('Space is left to native handling so the checkbox still toggles', () => {
	const { container, checks } = buildGroup(2);
	nav = new RovingCheckboxList({ container, itemSelector: 'input.roving-check' });
	nav.refreshRovingTabindex();

	checks[0].focus();
	const ev = new window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
	checks[0].dispatchEvent(ev);
	// The controller must not preventDefault on Space (would block the native toggle).
	assert.equal(ev.defaultPrevented, false);
	assert.equal(document.activeElement, checks[0]);
});

test('destroy detaches the keydown handler', () => {
	const { container, checks } = buildGroup(2);
	nav = new RovingCheckboxList({ container, itemSelector: 'input.roving-check' });
	nav.refreshRovingTabindex();
	nav.destroy();
	nav = null;

	checks[0].focus();
	checks[0].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
	assert.equal(document.activeElement, checks[0]); // no navigation after destroy
});
