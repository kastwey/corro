import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { AssemblyBoard, type AssemblyBoardDeps } from '../src/assemblyBoard.js';
import type { AssemblyCardDef, AssemblySeatState, GameState } from '../src/models.js';

before(() => setupDom());

const DECK: AssemblyCardDef[] = [
	{ id: 'piece-a', type: 'piece', color: 'a', count: 4, nameKey: 'cards.piece_a', svg: 'M4 4h56v56z' },
	{ id: 'piece-b', type: 'piece', color: 'b', count: 4, nameKey: 'cards.piece_b' },
	{ id: 'piece-c', type: 'piece', color: 'c', count: 4, nameKey: 'cards.piece_c' },
	{ id: 'piece-d', type: 'piece', color: 'd', count: 4, nameKey: 'cards.piece_d' },
	{ id: 'attack-a', type: 'attack', color: 'a', count: 4, nameKey: 'cards.attack_a' },
];
const instance = (cardId: string, n = 0) => ({ instanceId: `${cardId}#${n}`, cardId });
const t = (key: string, vars?: Record<string, unknown>) =>
	vars && Object.keys(vars).length ? `${key}(${Object.values(vars).join('|')})` : key;

let boardElement: HTMLElement;
let state: GameState;
let view: AssemblyBoard;

function seat(id: string, hand: string[], withPiece = false): AssemblySeatState {
	return {
		playerId: id,
		hand: hand.map(instance),
		handCount: hand.length,
		slots: withPiece ? [{
			color: 'a', piece: instance('piece-a', 9),
			afflictions: [instance('attack-a', 8)], shields: [],
		}] : [],
	};
}

beforeEach(() => {
	try { localStorage.removeItem('corro.handPreferences'); } catch {}
	document.body.innerHTML = '<div id="board"></div>';
	boardElement = document.getElementById('board')!;
	state = {
		gameType: 'assembly',
		assembly: {
			seats: [seat('me', ['piece-a', 'attack-a']), seat('rival', [], true)],
			drawPile: [], drawCount: 30, discardPile: [], discardCount: 4,
		},
		assemblyDeck: DECK,
		assemblyRules: { handSize: 3, slotsToWin: 4, maxDiscard: 3 },
		players: [
			{ id: 'me', name: 'Ana', color: '#ed4747' },
			{ id: 'rival', name: 'Berto', color: '#268be8' },
		],
		bank: { money: 0 }, currentTurn: 'me', ownership: [], squares: [],
	} as unknown as GameState;
	const deps: AssemblyBoardDeps = {
		getGameState: () => state,
		getMyPlayerId: () => 'me',
		announce: () => {},
		tSync: t,
		onIdle: () => {},
		motionDisabled: () => true,
		commands: { play: () => {}, discard: () => {} },
	};
	view = new AssemblyBoard(boardElement, deps);
	view.update(state);
});

test('assembly uses package art when present and neutral art otherwise without changing labels', () => {
	const rows = Array.from(boardElement.querySelectorAll<HTMLElement>('.hand-card:not(.hand-card--info)'));
	assert.equal(rows.length, 2);
	const packageRow = rows.find(row => row.getAttribute('aria-label')?.startsWith('cards.piece_a'))!;
	const neutralRow = rows.find(row => row.getAttribute('aria-label')?.startsWith('cards.attack_a'))!;
	assert.ok(packageRow.querySelector('[data-card-art="package"]'));
	assert.ok(neutralRow.querySelector('[data-card-art="neutral"]'));
	assert.equal(packageRow.querySelector('.hand-card__art')?.getAttribute('aria-hidden'), 'true');
});

test('assembly reuses the same art on installed modules and a neutral back for hidden piles', () => {
	const visual = boardElement.querySelector('.assembly-visual')!;
	assert.equal(visual.getAttribute('aria-hidden'), 'true');
	assert.ok(visual.querySelector('.assembly-module [data-card-art="package"]'));
	assert.ok(visual.querySelector('.assembly-module__attachments [data-card-art="neutral"]'));
	const info = boardElement.querySelector('.hand-card--info')!;
	assert.equal(info.getAttribute('aria-label'), 'game.assembly_piles_row(30|4)');
	assert.equal(info.querySelector('.gcard__back-label')?.textContent, '30/4');
});
