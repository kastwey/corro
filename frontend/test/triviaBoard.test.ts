import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';
import { TriviaBoard, triviaNodeLabel } from '../src/triviaBoard.js';
import type { GameState, TriviaBoardDef } from '../src/models.js';

/**
 * The trivia (Trivial Pursuit style) WHEEL board: navigated with the radial invariant Juanjo
 * designed — ↑ toward the centre, ↓ toward the ring, ←/→ turn — plus E (centre) and the
 * colour letters (headquarters jumps). Voiced through the announcer; cells stay aria-hidden.
 */

const BOARD: TriviaBoardDef = {
	spokeLength: 2,
	ring: [
		{ category: 0, wedge: true }, { category: 1, wedge: true }, { category: 2, wedge: true },
		{ category: 3, wedge: true }, { category: 4, wedge: true }, { category: 5, wedge: true },
	],
};

function gameState(): GameState {
	return {
		gameType: 'trivia',
		triviaBoard: BOARD,
		trivia: {
			players: [
				{ playerId: 'A', node: 'C', wedges: [] },
				{ playerId: 'B', node: 'C', wedges: [] },
			],
			categoryCursors: [0, 0, 0, 0, 0, 0],
		},
		players: [
			{ id: 'A', name: 'Ana', token: 'compass' as any, color: '#e00', position: 0, money: 0, properties: [], releasePasses: 0 },
			{ id: 'B', name: 'Berto', token: 'book' as any, color: '#00e', position: 0, money: 0, properties: [], releasePasses: 0 },
		],
		bank: { money: 0 }, currentTurn: 'A', ownership: [], squares: [],
	} as unknown as GameState;
}

before(() => {
	setupDom();
	installFakeI18next('en', { 'game.trivia_cell_center': 'Centre' });
});

function make(): { board: TriviaBoard; el: HTMLElement; spoken: string[]; gs: GameState } {
	document.body.innerHTML = '';
	const el = document.createElement('div');
	document.body.appendChild(el);
	const spoken: string[] = [];
	const gs = gameState();
	const board = new TriviaBoard(el, {
		getGameState: () => gs,
		getMyPlayerId: () => 'A',
		announce: text => spoken.push(text),
		tSync: (key: string, vars?: Record<string, unknown>) => (globalThis as any).window.i18next.t(key, vars),
	});
	board.update(gs);
	return { board, el, spoken, gs };
}

function focused(el: HTMLElement): string | null {
	return el.querySelector('.trivia-cell.focused')?.getAttribute('data-node') ?? null;
}

function press(el: HTMLElement, key: string, shiftKey = false): void {
	el.dispatchEvent(new (globalThis as any).KeyboardEvent('keydown', { key, shiftKey, bubbles: true }));
}

test('the cursor starts at the centre', () => {
	const { el } = make();
	assert.equal(focused(el), 'C');
});

test('down enters the first spoke; up returns to the centre', () => {
	const { board, el } = make();
	board.moveDown();
	assert.equal(focused(el), 'S0.1');
	board.moveUp();
	assert.equal(focused(el), 'C');
});

test('the radial invariant: down goes outward, up goes back inward', () => {
	const { board, el } = make();
	board.moveDown();               // C -> S0.1
	board.moveDown();               // S0.1 -> S0.2
	assert.equal(focused(el), 'S0.2');
	board.moveDown();               // S0.2 -> R0 (the wedge junction)
	assert.equal(focused(el), 'R0');
	board.moveUp();                 // R0 -> S0.2 (inward again)
	assert.equal(focused(el), 'S0.2');
});

test('left/right turn: cycle spokes at the centre, walk the ring outside', () => {
	const { board, el } = make();
	board.moveRight();              // at the centre: selects the next spoke (cursor stays C)
	assert.equal(focused(el), 'C');
	board.moveDown();               // enters spoke 1
	assert.equal(focused(el), 'S1.1');
	board.moveDown();               // S1.2
	board.moveDown();               // R1 (spoke 1's wedge)
	assert.equal(focused(el), 'R1');
	board.moveRight();              // walk the ring
	assert.equal(focused(el), 'R2');
	board.moveLeft();
	assert.equal(focused(el), 'R1');
});

test('spoke interiors do not turn', () => {
	const { board, el } = make();
	board.moveDown();               // C -> S0.1
	assert.equal(board.moveLeft(), false);
	assert.equal(focused(el), 'S0.1');
});

test('E jumps to the centre and colour letters jump to a headquarters', () => {
	const { board, el } = make();
	board.moveDown();
	board.moveDown();
	press(el, 'e');
	assert.equal(focused(el), 'C');
	press(el, 'b');                 // B = blue = category 0 -> R0
	assert.equal(focused(el), 'R0');
	press(el, 'g');                 // G = green = category 4 -> R4
	assert.equal(focused(el), 'R4');
});

test('a colour letter is a rotor: repeats cycle every square of that category, headquarters first', () => {
	// Blue (category 0) lives on: the R0 headquarters, plus the spoke squares S4.2 and S5.1
	// (both (spoke + step) % 6 === 0, step 1-based). Swept clockwise from 12 after the house.
	const { el } = make();
	press(el, 'b');                 // from the centre → the blue headquarters
	assert.equal(focused(el), 'R0');
	press(el, 'b');                 // → the next blue square clockwise (spoke 4, at ~8 o'clock)
	assert.equal(focused(el), 'S4.2');
	press(el, 'b');                 // → the next (spoke 5, at ~10 o'clock)
	assert.equal(focused(el), 'S5.1');
	press(el, 'b');                 // wraps back to the headquarters
	assert.equal(focused(el), 'R0');
});

test('Shift+colour reverses the rotor', () => {
	const { el } = make();
	press(el, 'b');                 // → R0 (headquarters)
	press(el, 'B', true);           // Shift reverses: back to the last blue square
	assert.equal(focused(el), 'S5.1');
});

test('D cycles the roll destinations (Shift+D reverses, with wraparound); Enter picks', () => {
	const { el, board } = make();
	const picked: string[] = [];
	board.setMoveOptions(['R0', 'R2', 'R4'], n => picked.push(n));
	press(el, 'd');                 // the centre is not an option → jump to the first
	assert.equal(focused(el), 'R0');
	press(el, 'D', true);           // Shift+D reverses, wrapping to the last option
	assert.equal(focused(el), 'R4');
	press(el, 'd');                 // forward wraps back to the first
	assert.equal(focused(el), 'R0');
	press(el, 'Enter');             // Enter on an option picks it
	assert.deepEqual(picked, ['R0']);
});

test('a piece is drawn at its animator display node (mid-walk), not only its authoritative node', () => {
	const { board, el, gs } = make();          // both players are authoritatively at the centre
	board.setDisplayPositionCallback(pid => (pid === 'A' ? 'S1.1' : null));
	board.update(gs);
	const a = el.querySelector('.trivia-piece[data-player-id="A"]') as HTMLElement;
	const b = el.querySelector('.trivia-piece[data-player-id="B"]') as HTMLElement;
	// B has no display override → drawn on its authoritative centre; A is drawn mid-walk on S1.1.
	assert.equal(`${b.style.left},${b.style.top}`, '50%,50%');
	assert.notEqual(`${a.style.left},${a.style.top}`, `${b.style.left},${b.style.top}`);
});

test('M jumps to my piece', () => {
	const { board, el, gs } = make();
	(gs as any).trivia.players[0].node = 'R3';
	board.goToMe();
	assert.equal(focused(el), 'R3');
});

test('the cursor is voiced on a move', () => {
	const { board, spoken } = make();
	spoken.length = 0;
	board.moveDown();
	assert.ok(spoken.length > 0);
});

test('L announces the position on the circle on demand', () => {
	const { el, spoken } = make();
	spoken.length = 0;
	press(el, 'l');
	assert.ok(spoken.length > 0);
});

test('triviaNodeLabel names the wheel positions', () => {
	assert.equal(triviaNodeLabel(BOARD, 'C', (k) => (globalThis as any).window.i18next.t(k)), 'Centre');
});
