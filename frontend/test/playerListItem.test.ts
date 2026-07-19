import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { createPlayerIdentity } from '../src/lobby/playerListItem.js';

before(() => setupDom());

test('lobby player identity treats names and translated labels as text', () => {
	const attack = '<img src=x onerror="globalThis.pwned=true">';
	const identity = createPlayerIdentity({
		tokenKey: 'car',
		playerName: attack,
		tokenName: attack,
		statusText: attack,
		hostText: attack,
		botText: attack,
	});

	assert.equal(identity.querySelector('img'), null, 'untrusted values are not parsed as markup');
	assert.equal(identity.querySelector('.player-name')!.textContent, `${attack},\u00a0`);
	assert.equal(identity.querySelector('.player-token-name')!.textContent, `${attack},\u00a0`);
	assert.equal(identity.querySelector('.player-status')!.textContent, `${attack}${attack} ${attack}`);
});