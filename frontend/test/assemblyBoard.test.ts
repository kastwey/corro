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
let announced: string[];

function key(target: EventTarget, keyName: string, opts: Record<string, unknown> = {}): void {
	target.dispatchEvent(new KeyboardEvent('keydown', {
		key: keyName, bubbles: true, cancelable: true, ...opts,
	}));
}

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
	announced = [];
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
		announce: text => announced.push(text),
		tSync: t,
		onIdle: () => {},
		motionDisabled: () => true,
		commands: { play: () => {}, discard: () => {} },
	};
	view = new AssemblyBoard(boardElement, deps);
	view.update(state);
});

test('assembly uses package art when present and neutral art otherwise without changing labels', () => {
	const rows = Array.from(boardElement.querySelectorAll<HTMLElement>('.hand-card'));
	assert.equal(rows.length, 2);
	const packageRow = rows.find(row => row.getAttribute('aria-label')?.startsWith('cards.piece_a'))!;
	const neutralRow = rows.find(row => row.getAttribute('aria-label')?.startsWith('cards.attack_a'))!;
	assert.ok(packageRow.querySelector('[data-card-art="package"]'));
	assert.ok(neutralRow.querySelector('[data-card-art="neutral"]'));
	assert.equal(packageRow.querySelector('.hand-card__art')?.getAttribute('aria-hidden'), 'true');
});

test('assembly keeps both hidden piles on the visual table, never at the end of the hand', () => {
	const visual = boardElement.querySelector('.assembly-visual')!;
	assert.equal(visual.getAttribute('aria-hidden'), 'true');
	assert.ok(visual.querySelector('.assembly-module [data-card-art="package"]'));
	assert.ok(visual.querySelector('.assembly-module__attachments [data-card-art="neutral"]'));
	assert.equal(boardElement.querySelector('.hand-card--info'), null);
	assert.equal(boardElement.querySelectorAll('.hand-card').length, 2);
	assert.equal(visual.querySelector('[data-pile="deck"] .gcard__back-label')?.textContent, '30');
	assert.equal(visual.querySelector('[data-pile="discard"] .gcard__back-label')?.textContent, '4');
	assert.equal(visual.querySelector('[data-pile="deck"] .card-table-pile__label')?.textContent,
		'game.assembly_pile_deck');
	assert.equal(visual.querySelector('[data-pile="discard"] .card-table-pile__label')?.textContent,
		'game.assembly_pile_discard');
});

test('D reads both pile counts and is listed in the localized shortcuts help', () => {
	const card = boardElement.querySelector<HTMLElement>('.hand-card')!;
	card.focus();
	key(card, 'd');
	assert.deepEqual(announced, ['game.assembly_status_piles(30|4)']);
	assert.equal(document.activeElement, card);
	assert.deepEqual(view.helpShortcuts().at(-1), {
		keys: 'd', descKey: 'game.help_cmd_assembly_piles',
	});

	announced = [];
	key(card, 'd', { ctrlKey: true });
	assert.deepEqual(announced, [], 'Ctrl+D remains available to the global dialog shortcut');
});
