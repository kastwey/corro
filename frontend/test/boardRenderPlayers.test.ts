import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';
import { Board } from '../src/board.js';
import type { Player, Square } from '../src/models.js';

// renderPlayers draws each player's token on its (display) square. A token that is still
// walking toward its destination gets the `player-token--moving` class, which the CSS turns
// into the hop-and-grow movement animation; once it lands the class is gone and it renders
// at natural size. These tests pin that wiring (the visual keyframes live in CSS).

before(() => {
	setupDom();
	installFakeI18next('en');
});

beforeEach(() => {
	document.body.innerHTML = '';
});

function makeBoard(gameManager: any = {}): { board: Board; el: HTMLElement } {
	const el = document.createElement('div');
	el.id = 'board';
	for (let i = 0; i < 5; i++) {
		const sq = document.createElement('div');
		sq.className = 'square';
		sq.dataset.index = String(i);
		el.appendChild(sq);
	}
	document.body.appendChild(el);
	const squares: Square[] = [];
	const board = new Board(el, 11, () => [], () => squares, gameManager);
	return { board, el };
}

function player(over: Partial<Player>): Player {
	return { id: 'a', name: 'Ann', token: 'car' as any, position: 0, money: 0, properties: [], releasePasses: 0, ...over };
}

const t = (k: string) => k;

test('only the travelling token gets the hop-and-grow movement class', () => {
	const { board, el } = makeBoard();
	const players = [player({ id: 'a', position: 1 }), player({ id: 'b', name: 'Bob', token: 'hat' as any, position: 3 })];

	board.renderPlayers(players, t, undefined, (id) => id === 'a');

	const aTok = el.querySelector('.square[data-index="1"] .player-token')!;
	const bTok = el.querySelector('.square[data-index="3"] .player-token')!;
	assert.ok(aTok.classList.contains('player-token--moving'), 'the moving token hops and grows');
	assert.ok(!bTok.classList.contains('player-token--moving'), 'a stationary token stays natural');
});

test('tokens render at natural size when no movement predicate is supplied', () => {
	const { board, el } = makeBoard();

	board.renderPlayers([player({ position: 2 })], t);

	const tok = el.querySelector('.player-token')!;
	assert.ok(!tok.classList.contains('player-token--moving'));
});

// Presence rings (live-play request): MY square rings in the accent, rivals' squares in a
// softer neutral, so a sighted player finds everyone at a glance. Rings are recomputed on
// every render (a token that moved leaves no stale ring behind).
test('the local player\'s square and rival squares get their presence rings', () => {
	const { board, el } = makeBoard({ getMyPlayerId: () => 'a' });
	const players = [player({ id: 'a', position: 1 }), player({ id: 'b', name: 'Bob', token: 'hat' as any, position: 3 })];

	board.renderPlayers(players, t);

	assert.ok(el.querySelector('.square[data-index="1"]')!.classList.contains('square--me-here'));
	assert.ok(el.querySelector('.square[data-index="3"]')!.classList.contains('square--other-here'));
	assert.ok(!el.querySelector('.square[data-index="1"]')!.classList.contains('square--other-here'));

	// Bob moves on: his old square drops the ring, the new one takes it.
	players[1].position = 4;
	board.renderPlayers(players, t);
	assert.ok(!el.querySelector('.square[data-index="3"]')!.classList.contains('square--other-here'));
	assert.ok(el.querySelector('.square[data-index="4"]')!.classList.contains('square--other-here'));
});

test('a held player is shown behind bars and labelled as in holding', () => {
	const { board, el } = makeBoard();
	// Two players on the same (holding) square: one sent to holding, one just visiting.
	const players = [
		player({ id: 'a', name: 'Ann', position: 2, isHeld: true }),
		player({ id: 'b', name: 'Bob', token: 'hat' as any, position: 2, isHeld: false }),
	];

	board.renderPlayers(players, (k, vars) => (vars ? `${k}:${vars.name}` : k));

	const held = el.querySelector('.player-token[data-player-id="a"]')!;
	const visiting = el.querySelector('.player-token[data-player-id="b"]')!;
	assert.ok(held.classList.contains('player-token--held'), 'the held token gets the behind-bars class');
	assert.equal(held.getAttribute('aria-label'), 'player_token_held:Ann');
	assert.ok(!visiting.classList.contains('player-token--held'), 'a just-visiting token is plain');
	assert.equal(visiting.getAttribute('aria-label'), 'Bob');
});
