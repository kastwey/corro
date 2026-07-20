import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { ExplodingBoard, type ExplodingBoardDeps } from '../src/explodingBoard.js';
import type { ExplodingCardDef, GameState } from '../src/models.js';

before(() => setupDom());

const DECK: ExplodingCardDef[] = [
	{ id: 'defuse', type: 'defuse', count: 2, nameKey: 'cards.defuse' },
	{ id: 'attack', type: 'attack', count: 2, nameKey: 'cards.attack' },
	{ id: 'cat-a', type: 'cat', count: 2, nameKey: 'cards.cat_a', svg: 'M1 1h10v10z' },
	{ id: 'cat-b', type: 'cat', count: 2, nameKey: 'cards.cat_b', svg: 'M2 2h11v11z' },
	{ id: 'cat-c', type: 'cat', count: 2, nameKey: 'cards.cat_c', svg: 'M3 3h12v12z' },
	{ id: 'cat-d', type: 'cat', count: 2, nameKey: 'cards.cat_d', svg: 'M4 4h13v13z' },
	{ id: 'cat-e', type: 'cat', count: 2, nameKey: 'cards.cat_e', svg: 'M5 5h14v14z' },
];

const instance = (cardId: string, n = 0) => ({ instanceId: `${cardId}#${n}`, cardId });
const t = (key: string, vars?: Record<string, unknown>) =>
	vars && Object.keys(vars).length ? `${key}(${Object.values(vars).join('|')})` : key;

let boardElement: HTMLElement;
let state: GameState;
let view: ExplodingBoard;

function game(): GameState {
	const hand = DECK.filter(card => card.id !== 'attack').map(card => instance(card.id));
	return {
		gameType: 'exploding',
		exploding: {
			seats: [
				{ playerId: 'me', hand, handCount: hand.length },
				{ playerId: 'rival', hand: [], handCount: 8 },
			],
			drawPile: [], drawCount: 37,
			discardPile: [instance('attack', 9)], discardCount: 1,
			drawsOwed: 1,
		},
		explodingDeck: DECK,
		explodingRules: {
			handSize: 7, defusesPerPlayer: 1, seeFutureCount: 3,
			attackDraws: 2, nopeWindowMillis: 1000,
		},
		players: [
			{ id: 'me', name: 'Ana', color: '#ed4747' },
			{ id: 'rival', name: 'Berto', color: '#268be8' },
		],
		bank: { money: 0 }, currentTurn: 'me', ownership: [], squares: [],
	} as unknown as GameState;
}

beforeEach(() => {
	try { localStorage.removeItem('corro.handPreferences'); } catch {}
	document.body.innerHTML = '<div id="board"></div>';
	boardElement = document.getElementById('board')!;
	state = game();
	const deps: ExplodingBoardDeps = {
		getGameState: () => state,
		getMyPlayerId: () => 'me',
		announce: () => {},
		tSync: t,
		onIdle: () => {},
		motionDisabled: () => true,
		commands: { play: () => {}, draw: () => {}, nope: () => {}, defuse: () => {}, give: () => {} },
	};
	view = new ExplodingBoard(boardElement, deps);
	view.update(state);
});

test('the real hand rows retain accessible names while mounting illustrated faces', () => {
	const rows = Array.from(boardElement.querySelectorAll<HTMLElement>('.hand-card:not(.hand-card--info)'));
	assert.equal(rows.length, 6);
	for (const row of rows) {
		assert.ok(row.getAttribute('aria-label')?.startsWith('cards.'), 'the localized name remains the spoken row');
		assert.equal(row.querySelector('.hand-card__art')?.getAttribute('aria-hidden'), 'true');
		assert.ok(row.classList.contains('hand-card--visual'));
		assert.ok(row.querySelector('.xcard'));
	}

	const packagePaths = rows
		.map(row => row.querySelector<SVGPathElement>('[data-card-art="package"] path')?.getAttribute('d'))
		.filter((path): path is string => !!path);
	assert.equal(packagePaths.length, 5);
	assert.equal(new Set(packagePaths).size, 5, 'the five package-owned faces remain distinct');
});

test('the hand deck row and the table use the same illustrated back and count', () => {
	const info = boardElement.querySelector<HTMLElement>('.hand-card--info')!;
	assert.ok(info.classList.contains('hand-card--visual'));
	assert.equal(info.querySelector('.xcard__back-label')?.textContent, '37');

	const table = boardElement.querySelector('.exploding-visual')!;
	assert.equal(table.getAttribute('aria-hidden'), 'true');
	assert.ok(table.querySelector('.exploding-discard .xcard--attack'));
	assert.equal(table.querySelector('.exploding-draw .xcard__back-label')?.textContent, '37');
});

test('the discard illustration follows the public top card on repaint', () => {
	assert.ok(boardElement.querySelector('.exploding-discard .xcard--attack'));
	state.exploding!.discardPile.push(instance('cat-d', 8));
	state.exploding!.discardCount++;
	view.update(state);
	assert.equal(boardElement.querySelector('.exploding-discard .xcard--attack'), null);
	assert.ok(boardElement.querySelector('.exploding-discard .xcard--cat [data-card-art="package"]'));
});

test('an empty discard still occupies a stable illustrated-card placeholder', () => {
	state.exploding!.discardPile = [];
	state.exploding!.discardCount = 0;
	view.update(state);
	assert.ok(boardElement.querySelector('.exploding-discard .xcard--empty'));
	assert.equal(boardElement.querySelector('.exploding-discard .xcard__empty-label')?.textContent, '—');
});

test('a just-drawn pending bomb is visibly revealed beside the piles until it is tucked', () => {
	state.explodingDeck!.push({ id: 'bomb', type: 'bomb', count: 1, nameKey: 'cards.bomb' });
	state.exploding!.pendingBomb = { playerId: 'me', instanceId: 'bomb#0', cardId: 'bomb' };
	view.update(state);
	assert.ok(boardElement.querySelector('.exploding-reveal .xcard--bomb'));
	assert.equal(boardElement.querySelector('.exploding-reveal .xcard__name')?.textContent, 'cards.bomb');

	state.exploding!.pendingBomb = null;
	view.update(state);
	assert.equal(boardElement.querySelector('.exploding-reveal'), null);
});
