import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';
import { ConnectionPanel } from '../src/connectionPanel.js';

/**
 * DOM regression tests for the always-visible connection panel: it shows the live
 * connection status (an aria-live region) and offers "Leave game" (confirmed
 * bankruptcy) and "Disconnect" buttons. We assert the accessible structure, the
 * status transitions, the button wiring and that focus() lands on the container.
 */

let calls: { leave: number; disconnect: number; copied: string[] };

function makePanel(): { panel: ConnectionPanel; mount: HTMLElement } {
	const mount = document.createElement('div');
	document.body.appendChild(mount);
	const panel = new ConnectionPanel();
	panel.init(mount, {
		onLeaveGame: () => { calls.leave++; },
		onDisconnect: () => { calls.disconnect++; },
		onCopyRejoinCode: (code) => { calls.copied.push(code); },
	});
	return { panel, mount };
}

before(() => {
	setupDom();
	installFakeI18next('en');
});

beforeEach(() => {
	document.body.innerHTML = '';
	calls = { leave: 0, disconnect: 0, copied: [] };
});

test('renders a labelled toolbar with status and two action buttons', () => {
	makePanel();
	const aside = document.getElementById('connection-panel')!;
	assert.equal(aside.tagName, 'DIV', 'toolbar role uses a permitted neutral host');
	assert.equal(aside.getAttribute('role'), 'toolbar');
	assert.equal(aside.getAttribute('aria-label'), 'Connection');
	assert.equal(aside.dataset.status, 'connected');

	const statusText = aside.querySelector('.connection-panel__status-text')!;
	assert.equal(statusText.getAttribute('aria-live'), 'polite');
	assert.equal(statusText.textContent, 'Connected');
	// The toolbar is described by the status node so entering it reads the current
	// connection status, not just the label.
	assert.equal(statusText.id, 'connection-panel-status');
	assert.equal(aside.getAttribute('aria-describedby'), 'connection-panel-status');

	const buttons = aside.querySelectorAll('.connection-panel__btn');
	assert.equal(buttons.length, 2);
	assert.equal(buttons[0].textContent, 'Leave game');
	assert.equal(buttons[1].textContent, 'Disconnect');
	// Roving tabindex: only the first action is in the tab order.
	assert.equal((buttons[0] as HTMLButtonElement).tabIndex, 0);
	assert.equal((buttons[1] as HTMLButtonElement).tabIndex, -1);
});

test('setStatus updates the live status text and the styling hook', () => {
	const { panel } = makePanel();
	const aside = document.getElementById('connection-panel')!;
	const statusText = aside.querySelector('.connection-panel__status-text')!;

	panel.setStatus('reconnecting');
	assert.equal(aside.dataset.status, 'reconnecting');
	assert.equal(statusText.textContent, 'Reconnecting…');

	panel.setStatus('disconnected');
	assert.equal(aside.dataset.status, 'disconnected');
	assert.equal(statusText.textContent, 'Disconnected');

	panel.setStatus('connected');
	assert.equal(aside.dataset.status, 'connected');
	assert.equal(statusText.textContent, 'Connected');
});

test('the buttons invoke their respective callbacks', () => {
	makePanel();
	const buttons = document.querySelectorAll<HTMLButtonElement>('.connection-panel__btn');
	buttons[0].click();
	buttons[1].click();
	assert.equal(calls.leave, 1);
	assert.equal(calls.disconnect, 1);
});

test('focus() lands on the first action so the toolbar (and status) is read on entry', () => {
	const { panel } = makePanel();
	const ok = panel.focus();
	assert.equal(ok, true);
	const buttons = document.querySelectorAll<HTMLButtonElement>('.connection-panel__btn');
	assert.equal(document.activeElement, buttons[0]);
});

test('arrow keys move the roving focus between the actions', () => {
	const { panel } = makePanel();
	panel.focus();
	const buttons = document.querySelectorAll<HTMLButtonElement>('.connection-panel__btn');
	const aside = document.getElementById('connection-panel')!;

	aside.dispatchEvent(new (globalThis as any).window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
	assert.equal(document.activeElement, buttons[1]);
	assert.equal(buttons[1].tabIndex, 0);
	assert.equal(buttons[0].tabIndex, -1);

	aside.dispatchEvent(new (globalThis as any).window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
	assert.equal(document.activeElement, buttons[0]);
});

test('the re-entry code appears as a copyable toolbar action once known', () => {
	const { panel } = makePanel();
	// Before the join ack delivers it, there is no code action.
	assert.equal(document.querySelector('.connection-panel__btn--rejoin-code'), null);

	panel.setRejoinCode('A2B3C4D5');
	const btn = document.querySelector<HTMLButtonElement>('.connection-panel__btn--rejoin-code')!;
	assert.ok(btn, 'the code action exists');
	assert.match(btn.textContent!, /A2B3C4D5/, 'its name carries the code (re-readable any time)');
	btn.click();
	assert.deepEqual(calls.copied, ['A2B3C4D5'], 'activating copies the code');

	// Idempotent: re-setting the same code neither duplicates nor re-renders the button.
	panel.setRejoinCode('A2B3C4D5');
	assert.equal(document.querySelectorAll('.connection-panel__btn--rejoin-code').length, 1);

	// The roving arrows reach it (it is part of the toolbar's button set).
	panel.focus();
	const aside = document.getElementById('connection-panel')!;
	aside.dispatchEvent(new (window as any).KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
	aside.dispatchEvent(new (window as any).KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
	assert.equal(document.activeElement, btn, 'ArrowRight twice lands on the code action');
});

test('init is idempotent (a second call does not duplicate the panel)', () => {
	const { panel, mount } = makePanel();
	panel.init(mount, { onLeaveGame: () => {}, onDisconnect: () => {} });
	assert.equal(document.querySelectorAll('#connection-panel').length, 1);
});
