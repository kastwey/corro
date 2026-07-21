import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { DraftBoard, type DraftBoardDeps } from '../src/draftBoard.js';
import type { DraftSeatState, GameState } from '../src/models.js';

/**
 * The draft surface: the hand renders from MY projected seat (every card pickable, the
 * committed one announcing itself as the current pick), Enter commits — and re-commits —
 * the secret pick, the discard/draw affordances don't exist in this family, S speaks the
 * shared status line and Shift+S the rivals only. The tables region stays aria-hidden.
 */

before(() => setupDom());

const DECK = [
	{ id: 'bite3', type: 'points', value: 3, count: 6, nameKey: 'c.bite3', svg: 'M3 3h58v58z' },
	{ id: 'sauce', type: 'multiplier', factor: 3, count: 4, nameKey: 'c.sauce', svg: 'M6 6h52v52z' },
	{ id: 'pair', type: 'set', setSize: 2, setPoints: 5, count: 8, nameKey: 'c.pair' },
	{ id: 'caramel-custard', type: 'dessert', count: 8, nameKey: 'c.flan' },
	{ id: 'stick', type: 'extra', count: 4, nameKey: 'c.stick' },
];

const inst = (cardId: string, n = 0) => ({ instanceId: `${cardId}@${n}`, cardId });

function seat(id: string, over: Partial<DraftSeatState> = {}): DraftSeatState {
	return {
		playerId: id, hand: [], handCount: 0, hasPicked: false,
		table: [], desserts: [], score: 0, roundScores: [], ...over,
	};
}

function game(seats: DraftSeatState[], over: Record<string, unknown> = {}): GameState {
	return {
		gameType: 'draft',
		draft: { round: 1, trick: 1, seats, drawPile: [], drawCount: 85 },
		draftDeck: DECK,
		draftRules: {
			rounds: 3, handSizeBase: 12,
			majorityFirst: 6, majoritySecond: 3, dessertBonus: 6, dessertPenalty: 6,
		},
		players: seats.map(s => ({ id: s.playerId, name: `N-${s.playerId}`, color: '#e53935' })),
		bank: { money: 0 }, currentTurn: null, ownership: [], squares: [],
		...over,
	} as unknown as GameState;
}

let gs: GameState;
let boardEl: HTMLElement;
let view: DraftBoard;
let picked: Array<[string, string | null]>;
let announced: string[];

/** Full-key fake translator: key + compact vars, so asserts read naturally. */
const t = (key: string, vars?: Record<string, unknown>) =>
	vars && Object.keys(vars).length ? `${key}(${Object.values(vars).join('|')})` : key;

function key(target: EventTarget, keyName: string, opts: Record<string, unknown> = {}): void {
	const w = (globalThis as any).window;
	target.dispatchEvent(new w.KeyboardEvent('keydown', { key: keyName, bubbles: true, cancelable: true, ...opts }));
}

function rows(): HTMLElement[] {
	return Array.from(document.querySelectorAll<HTMLElement>('.hand-card'));
}

beforeEach(() => {
	document.body.innerHTML = '<div id="board"></div>';
	boardEl = document.getElementById('board')!;
	picked = [];
	announced = [];
	gs = game([
		seat('me', { hand: [inst('bite3'), inst('pair'), inst('caramel-custard')], handCount: 3 }),
		seat('r1', { handCount: 3, hasPicked: true, score: 7, desserts: [inst('caramel-custard', 5)] }),
	]);
	const deps: DraftBoardDeps = {
		getGameState: () => gs,
		getMyPlayerId: () => 'me',
		announce: text => announced.push(text),
		tSync: t,
		onIdle: () => {},
		motionDisabled: () => true,
		commands: { pick: (id, second) => picked.push([id, second ?? null]) },
	};
	view = new DraftBoard(boardEl, deps);
	view.update(gs);
});

test('helpShortcuts reports the REAL wiring: Enter picks, Ctrl+Space arms multi, + status', () => {
	assert.deepEqual(view.helpShortcuts(), [
		{ keys: 'enter', descKey: 'game.help_cmd_pick_card' },
		{ keys: 'ctrl+space', descKey: 'game.help_cmd_multi_select' },
		{ keys: 'shift+f1', descKey: 'game.help_cmd_card_help' },
		{ keys: 's', descKey: 'game.help_cmd_status_mine' },
		{ keys: 'shift+s', descKey: 'game.help_cmd_status_rivals' },
		{ keys: 'd', descKey: 'game.help_cmd_draft_deck' },
	]);
});

test('the hand renders my seat with every card pickable and no draw/discard affordances', () => {
	assert.equal(rows().length, 3);
	// Hand-order sort so the asserts are positional.
	assert.ok(rows()[0].getAttribute('aria-label')!.includes('c.bite3'));
	assert.equal(document.querySelector('.hand-panel__draw'), null); // no draw in this family
	assert.equal(document.querySelector('[data-focus-id="discard"]'), null); // nor discard
	assert.ok(rows()[0].querySelector('[data-card-art="package"]'), 'package art wins on its card');
	assert.ok(rows()[1].querySelector('[data-card-art="neutral"]'), 'missing art gets the neutral face');
	assert.equal(document.querySelector('.hand-card--info'), null, 'the deck is not a hand row');
	assert.equal(document.querySelector('[data-pile="deck"] .gcard__back-label')?.textContent, '85');
	assert.equal(document.querySelector('[data-pile="deck"] .card-table-pile__label')?.textContent,
		'game.draft_pile_deck');
});

test('D reads the deck count on demand without moving hand focus', () => {
	const card = rows()[0];
	card.focus();
	key(card, 'd');
	assert.deepEqual(announced, ['game.draft_status_deck(85)']);
	assert.equal(document.activeElement, card);
});

test('Enter commits the pick, and Enter on another card re-commits', () => {
	const w = (globalThis as any).window;
	rows()[0].focus();
	key(rows()[0], 'Enter');
	assert.deepEqual(picked, [['bite3@0', null]]);

	// The server confirms and the state comes back with my pick committed…
	gs.draft!.seats[0].committedInstanceId = 'bite3@0';
	gs.draft!.seats[0].hasPicked = true;
	view.update(gs);
	// …and the committed card announces itself as the current pick.
	assert.ok(rows()[0].getAttribute('aria-label')!.startsWith('game.draft_card_picked'));

	// Changing my mind is one Enter on another card (the server replaces the pick).
	key(rows()[1], 'Enter');
	assert.deepEqual(picked, [['bite3@0', null], ['pair@0', null]]);
	assert.equal(w.document.querySelectorAll('dialog[open]').length, 0); // no confirm dialog
});

test('a finished game refuses the pick out loud', () => {
	gs.isGameOver = true;
	key(rows()[0], 'Enter');
	assert.deepEqual(picked, []);
	assert.deepEqual(announced, ['game.draft_game_over']);
});

test('S speaks MY status; Shift+S the rivals only, each led by their name', () => {
	key(boardEl, 's');
	assert.equal(announced.length, 1);
	assert.ok(announced[0].includes('game.draft_status_round(1|3)'));
	assert.ok(!announced[0].includes('N-r1'));

	key(boardEl, 'S', { shiftKey: true });
	assert.equal(announced.length, 2);
	assert.ok(announced[1].startsWith('N-r1:'));
	assert.ok(!announced[1].includes('N-me'));
});

test('multi-select sends a DOUBLE pick only over a waiting extra, in marking order', () => {
	// Enter the mode (Ctrl+Space) and mark bite3 then pair.
	key(rows()[0], ' ', { ctrlKey: true });
	rows()[0].focus();
	key(rows()[0], ' ');
	rows()[1].focus();
	key(rows()[1], ' ');

	// No extra on my table yet: the family refuses with its own words.
	key(rows()[1], 'Enter');
	assert.deepEqual(picked, []);
	assert.ok(announced.includes('game.draft_needs_extra'));

	// An extra lands on my table (an earlier trick): the same send now travels.
	gs.draft!.seats[0].table.push({ card: inst('stick', 9) });
	view.update(gs);
	key(rows()[1], 'Enter');
	assert.deepEqual(picked, [['bite3@0', 'pair@0']]);
});

test('a single marked card sends as the plain pick; three are refused', () => {
	key(rows()[0], ' ', { ctrlKey: true });
	rows()[0].focus();
	key(rows()[0], ' ');
	key(rows()[0], 'Enter');
	assert.deepEqual(picked, [['bite3@0', null]]);

	for (const row of rows().slice(0, 3)) { row.focus(); key(row, ' '); }
	key(rows()[0], 'Enter');
	assert.equal(picked.length, 1); // still just the first send
	assert.ok(announced.includes('game.draft_too_many_picks'));
});

test('a retired seat renders dimmed, with no hand counter', () => {
	gs.draft!.seats[1].retired = true;
	gs.draft!.seats[1].handCount = 0;
	view.update(gs);

	const row = boardEl.querySelectorAll<HTMLElement>('.draft-table')[1];
	assert.ok(row.classList.contains('draft-table--retired'));
	assert.equal(row.querySelector('.draft-table__cards'), null);
});

test('the tables are an aria-hidden echo: names, picked tick, score and desserts', () => {
	const visual = boardEl.querySelector('.draft-visual')!;
	assert.equal(visual.getAttribute('aria-hidden'), 'true');
	const tables = Array.from(boardEl.querySelectorAll<HTMLElement>('.draft-table'));
	assert.equal(tables.length, 2);
	assert.ok(tables[1].querySelector('.draft-table__picked')); // r1 already picked
	assert.equal(tables[1].querySelector('.draft-table__score')!.textContent, '7');
	assert.ok(tables[1].querySelector('.draft-card--stack')!.textContent!.includes('1')); // dessert stack tile
	assert.ok(tables[1].querySelector('.draft-card--stack [data-card-art="neutral"]'));
	assert.equal(tables[0].querySelector('.draft-table__picked'), null);
});

test('a multiplier badge keeps its vivid type colour and receives contrasting ink', () => {
	gs.draft!.seats[1].table.push({ card: inst('bite3', 8), onMultiplier: inst('sauce', 9) });
	view.update(gs);

	const badge = boardEl.querySelector('.draft-card__badge') as HTMLElement;
	assert.equal(badge.textContent, '×3');
	assert.ok(boardEl.querySelector('.draft-card [data-card-art="package"]'));
	assert.ok(boardEl.querySelector('.draft-card__multiplier-art[data-card-art="package"]'));
	assert.equal((badge.parentElement as HTMLElement).style.getPropertyValue('--type-color'), '#2f9e5f');
	assert.equal((badge.parentElement as HTMLElement).style.getPropertyValue('--type-ink'), '#000000');
});
