import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';

let dialogManager: typeof import('../src/dialogManager.js').dialogManager;
before(async () => { setupDom(); installFakeI18next('es'); ({ dialogManager } = await import('../src/dialogManager.js')); });
beforeEach(() => {
	document.body.innerHTML = '';
	(dialogManager as any).dialog = null; (dialogManager as any).nonModalDialog = null;
	dialogManager.init();
});
const settle = (ms=100) => new Promise(r => setTimeout(r, ms));

test('REPRO add-bot: input focus + close + async re-render → focus back on button', async () => {
	const list = document.createElement('ul'); list.id = 'host-player-list'; document.body.appendChild(list);
	const btn = document.createElement('button'); btn.id = 'add-bot-btn'; btn.textContent = 'Add bot'; document.body.appendChild(btn);
	btn.focus();
	assert.equal(document.activeElement, btn, 'button focused before open');

	const input = document.createElement('input'); input.id = 'bot-name-input';
	const content = document.createElement('div'); content.appendChild(input);
	const submit = () => { dialogManager.close(); void (async () => { await settle(20); list.innerHTML = '<li>Bot 1</li>'; })(); };
	input.addEventListener('keydown', e => { if ((e as KeyboardEvent).key === 'Enter') { e.preventDefault(); submit(); } });
	dialogManager.show({ title: 'Bot', contentElement: content, buttons: [{ label: 'Add', variant: 'primary', action: submit }] });
	setTimeout(() => input.focus(), 80);

	await settle(90); // let the input take focus like the real dialog
	assert.equal(document.activeElement, input, 'input focused inside dialog');

	input.dispatchEvent(new (globalThis as any).window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
	await settle(60); // let the async re-render run

	assert.equal((document.activeElement as HTMLElement)?.id, 'add-bot-btn', 'focus returned to the button');
});
