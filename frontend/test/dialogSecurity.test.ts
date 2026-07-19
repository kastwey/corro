import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';

let dialogManager: typeof import('../src/dialogManager.js').dialogManager;

before(async () => {
	setupDom();
	installFakeI18next('en');
	({ dialogManager } = await import('../src/dialogManager.js'));
});

beforeEach(() => {
	document.body.innerHTML = '';
	(dialogManager as any).dialog = null;
	(dialogManager as any).nonModalDialog = null;
	dialogManager.init();
});

test('buy confirmation treats package and player text as untrusted', () => {
	const attack = '<img src=x onerror="globalThis.pwned=true">';
	dialogManager.showBuyConfirm({
		squareName: attack,
		price: 100,
		groupStatusMessage: attack,
		onConfirm: () => {},
	});

	const dialog = document.getElementById('game-dialog')!;
	assert.equal(dialog.querySelector('img'), null);
	assert.match(dialog.querySelector('.dialog-property-info')!.textContent!, /<img src=x/);
	assert.equal(dialog.querySelector('.dialog-group-status')!.textContent, attack);
});

test('plain confirmation and information messages are not parsed as HTML', () => {
	const attack = '<svg onload="globalThis.pwned=true"></svg>';
	dialogManager.showConfirm({ title: 'Confirm', message: attack, onConfirm: () => {} });
	assert.equal(document.querySelector('#game-dialog .dialog-content svg'), null);
	assert.equal(document.querySelector('#game-dialog .dialog-content p')!.textContent, attack);
	dialogManager.close();

	dialogManager.showInfo({ title: 'Info', message: attack });
	assert.equal(document.querySelector('#game-dialog .dialog-content svg'), null);
	assert.equal(document.querySelector('#game-dialog .dialog-content p')!.textContent, attack);
});