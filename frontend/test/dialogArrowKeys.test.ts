import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';

// Arrow keys move focus between a dialog's buttons, in addition to Tab — a keyboard / screen
// reader user on "Accept" reaches "Cancel" with Down (or Right). Only inside the application
// buttons row (confirmations, choices); a reading dialog (documentMode) keeps the arrows for the
// screen reader's own browse-mode line navigation.

let dialogManager: typeof import('../src/dialogManager.js').dialogManager;

before(async () => {
	setupDom();
	installFakeI18next('es');
	({ dialogManager } = await import('../src/dialogManager.js'));
});

beforeEach(() => {
	document.body.innerHTML = '';
	(dialogManager as any).dialog = null;
	(dialogManager as any).nonModalDialog = null;
	dialogManager.init();
});

function buttons(): HTMLButtonElement[] {
	return Array.from(document.querySelectorAll('#game-dialog .dialog-buttons button')) as HTMLButtonElement[];
}
function arrow(key: string): void {
	(document.activeElement as HTMLElement).dispatchEvent(
		new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

test('arrows move between an accept/cancel dialog\'s buttons, both ways, wrapping', () => {
	dialogManager.showConfirm({ title: 'T', message: 'm', onConfirm: () => {}, onCancel: () => {} });
	const [cancel, confirm] = buttons();

	cancel.focus();
	arrow('ArrowDown');
	assert.equal(document.activeElement, confirm, 'Down advances to the next button');
	arrow('ArrowDown');
	assert.equal(document.activeElement, cancel, 'Down wraps back to the first');
	arrow('ArrowUp');
	assert.equal(document.activeElement, confirm, 'Up wraps to the last');
	arrow('ArrowRight');
	assert.equal(document.activeElement, cancel, 'Right also advances');
	arrow('ArrowLeft');
	assert.equal(document.activeElement, confirm, 'Left also goes back');
});

test('a reading (documentMode) dialog does NOT hijack the arrows', () => {
	dialogManager.show({
		title: 'Guide', documentMode: true,
		buttons: [
			{ label: 'A', action: () => {} },
			{ label: 'B', action: () => {} },
		],
	});
	const [a] = buttons();
	a.focus();
	arrow('ArrowDown');
	assert.equal(document.activeElement, a, 'focus stays put — the screen reader owns the arrows here');
});

test('a single-button dialog ignores the arrows (nothing to move to)', () => {
	dialogManager.showInfo({ title: 'T', message: 'm' });
	const [ok] = buttons();
	ok.focus();
	arrow('ArrowDown');
	assert.equal(document.activeElement, ok);
});
