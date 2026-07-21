import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { ExplodingBoard, type ExplodingBoardDeps } from '../src/explodingBoard.js';
import { popupMenu } from '../src/popupMenu.js';
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
let announcements: string[];
let played: Array<[string, string | undefined, string | undefined]>;
let defuseDepths: number[];
let motionDisabled: boolean;
let timers: Array<{ callback: () => void; delayMs: number; cancelled: boolean }>;

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

function key(target: EventTarget, keyName: string): void {
	target.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true }));
}

function addFavor(): HTMLElement {
	state.explodingDeck!.push({ id: 'favor', type: 'favor', count: 1, nameKey: 'cards.favor' });
	const mine = state.exploding!.seats[0];
	mine.hand.push(instance('favor'));
	mine.handCount = mine.hand.length;
	view.update(state);
	return Array.from(boardElement.querySelectorAll<HTMLElement>('.hand-card'))
		.find(row => row.getAttribute('aria-label') === 'cards.favor')!;
}

beforeEach(() => {
	popupMenu.close();
	try { localStorage.removeItem('corro.handPreferences'); } catch {}
	try { localStorage.removeItem('corro.handPreferences.exploding'); } catch {}
	document.body.innerHTML = '<div id="board"></div>';
	boardElement = document.getElementById('board')!;
	state = game();
	announcements = [];
	played = [];
	defuseDepths = [];
	motionDisabled = true;
	timers = [];
	const deps: ExplodingBoardDeps = {
		getGameState: () => state,
		getMyPlayerId: () => 'me',
		announce: text => announcements.push(text),
		tSync: t,
		onIdle: () => {},
		motionDisabled: () => motionDisabled,
		setTimer: (callback, delayMs) => {
			const timer = { callback, delayMs, cancelled: false };
			timers.push(timer);
			return timer;
		},
		clearTimer: handle => { (handle as typeof timers[number]).cancelled = true; },
		commands: {
			play: (instanceId, targetId, secondInstanceId) => {
				played.push([instanceId, targetId, secondInstanceId]);
			},
			draw: () => {}, nope: () => {},
			defuse: depth => defuseDepths.push(depth), give: () => {},
		},
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

test('the hand replaces value sorting with pair, attack, name and original orderings', () => {
	state.explodingDeck = state.explodingDeck!.map(def =>
		def.id === 'attack' ? { ...def, nameKey: 'cards.zz_attack' } : def);
	const mine = state.exploding!.seats[0];
	mine.hand = [instance('cat-b'), instance('defuse'), instance('cat-a'), instance('attack'), instance('cat-c')];
	mine.handCount = mine.hand.length;
	view.update(state);

	const labels = () => Array.from(boardElement.querySelectorAll<HTMLElement>(
		'.hand-card:not(.hand-card--info) .hand-card__name')).map(name => name.textContent);
	const tools = () => Array.from(boardElement.querySelectorAll<HTMLElement>(
		'.hand-panel__list-actions button')).map(button => button.dataset.focusId);
	const sort = (id: string) => boardElement.querySelector<HTMLButtonElement>(
		`.hand-panel__list-actions [data-focus-id="sort-${id}"]`)!;

	assert.deepEqual(tools(), ['sort-pairs', 'sort-attacks', 'sort-name', 'sort-hand', 'filter-playable']);
	assert.equal(boardElement.querySelector('[data-focus-id="sort-value"]'), null);
	assert.equal(sort('pairs').getAttribute('aria-pressed'), 'true');
	assert.deepEqual(labels(), ['cards.cat_a', 'cards.cat_b', 'cards.cat_c', 'cards.defuse', 'cards.zz_attack'],
		'pair cards lead and are alphabetized by their package-owned labels');

	sort('attacks').click();
	assert.deepEqual(labels(), ['cards.zz_attack', 'cards.cat_a', 'cards.cat_b', 'cards.cat_c', 'cards.defuse']);
	assert.deepEqual(announcements, ['game.exploding_sorted_attacks_first']);
	assert.deepEqual(JSON.parse(localStorage.getItem('corro.handPreferences.exploding')!), {
		sort: 'attacks', onlyPlayable: false,
	});
	assert.equal(localStorage.getItem('corro.handPreferences'), null);

	sort('name').click();
	assert.deepEqual(labels(), ['cards.cat_a', 'cards.cat_b', 'cards.cat_c', 'cards.defuse', 'cards.zz_attack']);
	sort('hand').click();
	assert.deepEqual(labels(), ['cards.cat_b', 'cards.defuse', 'cards.cat_a', 'cards.zz_attack', 'cards.cat_c']);
});

test('the playable filter retains rule-legal cards off turn and activation speaks the turn gate', () => {
	const mine = state.exploding!.seats[0];
	mine.hand = [instance('attack'), instance('defuse')];
	mine.handCount = mine.hand.length;
	view.update(state);
	boardElement.querySelector<HTMLButtonElement>('[data-focus-id="filter-playable"]')!.click();
	announcements = [];

	let rows = Array.from(boardElement.querySelectorAll<HTMLElement>('.hand-card'));
	assert.deepEqual(rows.map(row => row.getAttribute('aria-label')), ['cards.attack']);

	state.currentTurn = 'rival';
	view.update(state);
	rows = Array.from(boardElement.querySelectorAll<HTMLElement>('.hand-card'));
	assert.deepEqual(rows.map(row => row.getAttribute('aria-label')), ['cards.attack'],
		'the card remains in the filtered list without being relabelled as unplayable');

	rows[0].focus();
	key(rows[0], 'Enter');
	assert.deepEqual(played, []);
	assert.deepEqual(announcements, ['game.exploding_not_your_turn']);
});

test('a pending reaction window does not clear ordinary cards from the playable filter', () => {
	const mine = state.exploding!.seats[0];
	mine.hand = [instance('attack'), instance('defuse')];
	mine.handCount = mine.hand.length;
	view.update(state);
	boardElement.querySelector<HTMLButtonElement>('[data-focus-id="filter-playable"]')!.click();
	announcements = [];

	state.exploding!.pendingAction = { actorId: 'me', cardId: 'attack', nopeCount: 0 };
	view.update(state);
	const row = boardElement.querySelector<HTMLElement>('.hand-card')!;
	assert.equal(row.getAttribute('aria-label'), 'cards.attack');

	row.focus();
	key(row, 'Enter');
	assert.deepEqual(played, []);
	assert.deepEqual(announcements, ['game.exploding_window_open']);
});

test('P cycles pair cards, documents the key and announces when none are held', () => {
	const pairRows = () => Array.from(boardElement.querySelectorAll<HTMLElement>('.hand-card'))
		.filter(row => row.getAttribute('aria-label')?.startsWith('cards.cat_'));
	const first = pairRows()[0];
	first.focus();
	key(first, 'p');
	assert.equal(document.activeElement, pairRows()[1]);
	assert.deepEqual(
		view.helpShortcuts().find(shortcut => shortcut.descKey === 'game.help_cmd_exploding_pair'),
		{ keys: 'p', descKey: 'game.help_cmd_exploding_pair' },
	);

	const mine = state.exploding!.seats[0];
	mine.hand = mine.hand.filter(card => !card.cardId.startsWith('cat-'));
	mine.handCount = mine.hand.length;
	view.update(state);
	const remaining = boardElement.querySelector<HTMLElement>('.hand-card')!;
	remaining.focus();
	key(remaining, 'p');
	assert.deepEqual(announcements, ['game.exploding_no_pair']);
});

test('the deck count stays visual on the hidden table and never becomes a hand row', () => {
	assert.equal(boardElement.querySelector('.hand-card--info'), null);
	assert.equal(boardElement.querySelectorAll('.hand-card').length, 6, 'the list contains only held cards');
	const table = boardElement.querySelector('.exploding-visual')!;
	assert.equal(table.getAttribute('aria-hidden'), 'true');
	assert.ok(table.querySelector('.exploding-discard .xcard--attack'));
	assert.equal(table.querySelector('.exploding-draw .xcard__back-label')?.textContent, '37');
});

test('D reads the deck on demand from a hand card while C and Ctrl+D remain unclaimed', () => {
	const card = boardElement.querySelector<HTMLElement>('.hand-card')!;
	card.focus();
	const readDeck = new KeyboardEvent('keydown', { key: 'd', bubbles: true, cancelable: true });
	assert.equal(card.dispatchEvent(readDeck), false, 'the family consumes its deck query');
	assert.deepEqual(announcements, ['game.exploding_status_deck(37|cards.attack)']);
	assert.deepEqual(
		view.helpShortcuts().find(shortcut => shortcut.descKey === 'game.help_cmd_exploding_top'),
		{ keys: 'd', descKey: 'game.help_cmd_exploding_top' },
	);

	announcements = [];
	const oldKey = new KeyboardEvent('keydown', { key: 'c', bubbles: true, cancelable: true });
	assert.equal(card.dispatchEvent(oldKey), true, 'C remains available to the shared identity query');
	const globalChord = new KeyboardEvent('keydown', {
		key: 'd', ctrlKey: true, bubbles: true, cancelable: true,
	});
	assert.equal(card.dispatchEvent(globalChord), true, 'Ctrl+D remains available to focus dialogs');
	assert.deepEqual(announcements, []);
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
	const reveal = boardElement.querySelector('.exploding-reveal')!;
	assert.ok(reveal.classList.contains('exploding-reveal--defusing'));
	assert.ok(reveal.classList.contains('exploding-reveal--static'));
	assert.ok(reveal.querySelector('.exploding-reveal__bomb .xcard--bomb'));
	assert.equal(reveal.querySelector('.exploding-reveal__bomb .xcard__name')?.textContent, 'cards.bomb');
	assert.ok(reveal.querySelector('.exploding-reveal__defuse .xcard--defuse'));
	assert.equal(reveal.querySelector('.exploding-reveal__defuse .xcard__name')?.textContent, 'cards.defuse');
	assert.equal(reveal.closest('.exploding-visual')?.getAttribute('aria-hidden'), 'true');
	assert.equal(timers.length, 1);
	assert.equal(document.querySelector('.popup-menu'), null, 'the picker must not steal focus immediately');

	state.exploding!.pendingBomb = null;
	view.update(state);
	assert.equal(timers[0].cancelled, true);
	assert.equal(boardElement.querySelector('.exploding-reveal'), null);
	// Even a timer callback already queued by the browser validates current state before opening.
	timers[0].callback();
	assert.equal(document.querySelector('.popup-menu'), null);
});

test('the defuse picker waits two seconds before announcing and taking focus', async () => {
	state.explodingDeck!.push({ id: 'bomb', type: 'bomb', count: 1, nameKey: 'cards.bomb' });
	state.exploding!.pendingBomb = { playerId: 'me', instanceId: 'bomb#0', cardId: 'bomb' };
	motionDisabled = false;
	view.update(state);

	assert.equal(timers.length, 1);
	assert.equal(timers[0].delayMs, 2000);
	assert.equal(timers[0].cancelled, false);
	assert.equal(document.querySelector('.popup-menu'), null);
	assert.ok(!boardElement.querySelector('.exploding-reveal')?.classList.contains('exploding-reveal--static'));

	// A repaint of the same authoritative pending state must not restart the grace period.
	view.update(state);
	assert.equal(timers.length, 1);

	timers[0].callback();
	const menu = document.querySelector<HTMLElement>('.popup-menu[role="menu"]')!;
	assert.ok(menu);
	assert.equal(menu.getAttribute('aria-label'), 'game.exploding_pick_depth');
	assert.deepEqual(announcements, ['game.exploding_pick_depth']);
	const first = menu.querySelector<HTMLButtonElement>('.popup-menu__item')!;
	assert.equal(document.activeElement, first);

	// Let popupMenu install its outside-click listener before closing through a real choice.
	await new Promise(resolve => setTimeout(resolve, 0));
	first.click();
	assert.deepEqual(defuseDepths, [0]);
	assert.equal(document.querySelector('.popup-menu'), null);
});

test('a Favor auto-targets the only active rival without opening or announcing a picker', () => {
	state.exploding!.seats.push({ playerId: 'retired', hand: [], handCount: 0, retired: true });
	state.players.push({ id: 'retired', name: 'Carla', color: '#5b9b42' });
	const favor = addFavor();

	favor.focus();
	key(favor, 'Enter');

	assert.deepEqual(played, [['favor#0', 'rival', undefined]]);
	assert.equal(document.querySelector('[role="menu"]'), null);
	assert.deepEqual(announcements, [], 'the authoritative server will announce the play');
});

test('a cat pair auto-targets the only active rival and sends both cards', () => {
	const mine = state.exploding!.seats[0];
	mine.hand.push(instance('cat-a', 1));
	mine.handCount = mine.hand.length;
	view.update(state);
	const cat = Array.from(boardElement.querySelectorAll<HTMLElement>('.hand-card'))
		.find(row => row.getAttribute('aria-label') === 'cards.cat_a')!;

	cat.focus();
	key(cat, 'Enter');

	assert.deepEqual(played, [['cat-a#0', 'rival', 'cat-a#1']]);
	assert.equal(document.querySelector('[role="menu"]'), null);
});

test('a targeted card still opens the rival picker when several active targets exist', () => {
	state.exploding!.seats.push({ playerId: 'rival-2', hand: [], handCount: 6 });
	state.players.push({ id: 'rival-2', name: 'Carla', color: '#5b9b42' });
	const favor = addFavor();

	favor.focus();
	key(favor, 'Enter');

	assert.deepEqual(played, []);
	const options = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
	assert.deepEqual(options.map(option => option.textContent), ['Berto', 'Carla']);
	assert.deepEqual(announcements, ['game.exploding_pick_target(cards.favor)']);

	options[1].click();
	assert.deepEqual(played, [['favor#0', 'rival-2', undefined]]);
});
