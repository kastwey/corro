import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';
import { turnIndicator } from '../src/turnIndicator.js';
import type { Player } from '../src/models.js';

// The turn indicator is a purely-visual, aria-hidden banner above the board (the announcer
// owns the spoken turn voice). It highlights the local player's turn with a "your turn" badge.

before(() => {
	setupDom();
	installFakeI18next('en');
});

function player(over: Partial<Player> = {}): Player {
	return { id: 'me', name: 'Me', token: 'car' as any, position: 0, money: 0, properties: [], releasePasses: 0, ...over };
}

test('the turn indicator shows a "your turn" badge only on the local player\'s turn', () => {
	// init() mounts the indicator next to #board.
	const frame = document.createElement('div');
	const board = document.createElement('div');
	board.id = 'board';
	frame.appendChild(board);
	document.body.appendChild(frame);

	turnIndicator.init();
	const el = document.getElementById('turn-indicator')!;
	assert.ok(el, 'indicator is mounted');
	// Visual only: it must never enter the screen-reader tree.
	assert.equal(el.getAttribute('aria-hidden'), 'true');

	turnIndicator.setCurrentTurn(player(), true);
	const badge = el.querySelector('.turn-indicator__you');
	assert.ok(badge, 'badge shown on my turn');
	assert.equal(badge!.textContent, 'Your turn!');

	turnIndicator.setCurrentTurn(player({ id: 'other', name: 'Other' }), false);
	assert.equal(el.querySelector('.turn-indicator__you'), null, 'badge hidden on another player\'s turn');
});

test('the turn indicator flags a current player with no live connection', () => {
	// The table is effectively paused waiting for them — the indicator says why.
	turnIndicator.setCurrentTurn(player({ id: 'other', name: 'Other', isConnected: false }), false);
	const el = document.getElementById('turn-indicator')!;
	const tag = el.querySelector('.turn-indicator__offline');
	assert.ok(tag, 'offline tag shown for a disconnected current player');
	assert.equal(tag!.textContent, 'Disconnected');

	// Reconnected (or simply connected): the tag disappears.
	turnIndicator.setCurrentTurn(player({ id: 'other', name: 'Other', isConnected: true }), false);
	assert.equal(el.querySelector('.turn-indicator__offline'), null);
	// And an old-style state with no flag at all stays clean too.
	turnIndicator.setCurrentTurn(player({ id: 'other', name: 'Other' }), false);
	assert.equal(el.querySelector('.turn-indicator__offline'), null);
});

test('the turn indicator treats player names and colours as untrusted data', () => {
	const attack = '<img src=x onerror="globalThis.pwned=true">';
	turnIndicator.setCurrentTurn(player({ name: attack, color: 'red;" onmouseover="globalThis.pwned=true' }), false);

	const el = document.getElementById('turn-indicator')!;
	assert.equal(el.querySelector('img'), null, 'the player name is not parsed as markup');
	assert.equal(el.querySelector('.turn-indicator__name')!.textContent, attack);
	assert.match(
		el.querySelector('.turn-indicator__player')!.getAttribute('style')!,
		/--player-color:\s*#888/,
		'an invalid CSS colour falls back instead of breaking out of the style attribute');
});

test('the turn indicator chooses a contrasting foreground for player colours', () => {
	const el = document.getElementById('turn-indicator')!;
	turnIndicator.setCurrentTurn(player({ color: '#ecc23a' }), true);
	assert.match(el.querySelector('.turn-indicator__player')!.getAttribute('style')!,
		/--player-foreground:\s*#000000/, 'bright yellow gets black text');

	turnIndicator.setCurrentTurn(player({ color: '#2f6fe0' }), true);
	assert.match(el.querySelector('.turn-indicator__player')!.getAttribute('style')!,
		/--player-foreground:\s*#ffffff/, 'dark blue gets white text');
});
