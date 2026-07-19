import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';
import { TrackBoard, trackCellPosition } from '../src/trackBoard.js';
import type { GameState, TrackBoardDef } from '../src/models.js';

/**
 * The track (snakes-and-ladders style) board: a serpentine 1..N grid plus a start tray
 * (square 0), navigated with the same keyboard surface as the other boards — ←/→ walk the
 * track, ↑/↓ jump a row — and voiced through the announcer with the square's number, its
 * effect (where it leads) and its occupants.
 */

const BOARD: TrackBoardDef = {
	trackLength: 30,
	gridWidth: 6,
	effects: [
		{ from: 3, to: 12, kind: 'ladder' },
		{ from: 15, to: 6, kind: 'snake' },
	],
};

function gameState(): GameState {
	return {
		gameType: 'track',
		trackBoard: BOARD,
		track: { positions: [{ playerId: 'A', square: 4 }, { playerId: 'B', square: 0 }] },
		players: [
			{ id: 'A', name: 'Ana', token: 'estrella' as any, color: '#e00', position: 0, money: 0, properties: [], releasePasses: 0 },
			{ id: 'B', name: 'Berto', token: 'luna' as any, color: '#00e', position: 0, money: 0, properties: [], releasePasses: 0 },
		],
		bank: { money: 0 }, currentTurn: 'A', ownership: [], squares: [],
	} as unknown as GameState;
}

before(() => {
	setupDom();
	// The package names the effect kinds; the engine falls back to the bare direction line.
	installFakeI18next('en', { 'effects.ladder': 'Ladder', 'effects.snake': 'Snake' });
});

function make(): { board: TrackBoard; el: HTMLElement; spoken: string[]; gs: GameState } {
	document.body.innerHTML = '';
	const el = document.createElement('div');
	document.body.appendChild(el);
	const spoken: string[] = [];
	const gs = gameState();
	const board = new TrackBoard(el, {
		getGameState: () => gs,
		getMyPlayerId: () => 'A',
		announce: text => spoken.push(text),
		tSync: (key: string, vars?: Record<string, unknown>) => (globalThis as any).window.i18next.t(key, vars),
	});
	board.update(gs);
	return { board, el, spoken, gs };
}

// ── geometry ─────────────────────────────────────────────────────────────────

test('the serpentine fold starts bottom-left and reverses every row', () => {
	// 30 squares, 6 wide → 5 rows. Square 1 bottom-left; 6 bottom-right; 7 right end of
	// the row ABOVE (the fold); 12 left end of that row. With FIVE rows the top row runs
	// left→right again, so 30 ends top-right.
	assert.deepEqual(trackCellPosition(1, 6, 30), { col: 1, row: 5 });
	assert.deepEqual(trackCellPosition(6, 6, 30), { col: 6, row: 5 });
	assert.deepEqual(trackCellPosition(7, 6, 30), { col: 6, row: 4 });
	assert.deepEqual(trackCellPosition(12, 6, 30), { col: 1, row: 4 });
	assert.deepEqual(trackCellPosition(13, 6, 30), { col: 1, row: 3 });
	assert.deepEqual(trackCellPosition(30, 6, 30), { col: 6, row: 1 });
	// The classic 100/10 board has TEN rows: its top row is reversed, 100 ends top-LEFT.
	assert.deepEqual(trackCellPosition(91, 10, 100), { col: 10, row: 1 });
	assert.deepEqual(trackCellPosition(100, 10, 100), { col: 1, row: 1 });
});

test('renders every track square, the start tray, and marks effects and the goal', () => {
	const { el } = make();
	assert.equal(el.querySelectorAll('.track-cell').length, 31); // 30 squares + tray
	assert.ok(el.querySelector('.track-cell[data-square="0"]')?.classList.contains('track-cell--tray'));
	assert.ok(el.querySelector('.track-cell[data-square="3"]')?.classList.contains('track-cell--up'));
	assert.ok(el.querySelector('.track-cell[data-square="15"]')?.classList.contains('track-cell--down'));
	assert.ok(el.querySelector('.track-cell[data-square="30"]')?.classList.contains('track-cell--goal'));
	// Cells stay silent for the screen reader; the announcer speaks.
	assert.equal(el.querySelector('.track-cell[data-square="3"]')?.getAttribute('aria-hidden'), 'true');
});

// ── navigation + narration ───────────────────────────────────────────────────

test('←/→ walk the track and speak the square; ↑/↓ jump a whole row', () => {
	const { board, spoken } = make();
	board.setActiveIndex(1, true, false);
	board.moveRight();
	assert.match(spoken.at(-1)!, /Square 2 of 30/);
	board.moveUp();
	assert.match(spoken.at(-1)!, /Square 8 of 30/); // +gridWidth
	board.moveDown();
	assert.match(spoken.at(-1)!, /Square 2 of 30/);
	board.moveLeft();
	assert.match(spoken.at(-1)!, /Square 1 of 30/);
	// One more step left reaches the start tray (square 0)…
	assert.equal(board.moveLeft(), true);
	assert.match(spoken.at(-1)!, /Start\. Off the board/);
	// …and the edges refuse to move (the keyboard layer still consumes the arrow).
	assert.equal(board.moveLeft(), false);
	board.setActiveIndex(30, true, false);
	assert.equal(board.moveRight(), false);
	assert.equal(board.moveUp(), false);
});

test('a square with an effect announces its kind and destination; occupants are voiced', () => {
	const { board, spoken } = make();
	board.setActiveIndex(3);
	assert.match(spoken.at(-1)!, /Ladder: climbs to square 12/);
	board.setActiveIndex(15);
	assert.match(spoken.at(-1)!, /Snake: goes down to square 6/);
	board.setActiveIndex(4);
	assert.match(spoken.at(-1)!, /Ana's piece/);
	board.setActiveIndex(30);
	assert.match(spoken.at(-1)!, /Goal/);
});

test('M goes to my piece; the tray counts as a position (a piece not yet entered)', () => {
	const { board, spoken, gs } = make();
	assert.equal(board.goToMe(), true);
	assert.equal(board.getActiveIndex(), 4);
	assert.match(spoken.at(-1)!, /Square 4 of 30/);
	gs.track!.positions[0].square = 0; // my piece back in the tray
	board.goToMe();
	assert.equal(board.getActiveIndex(), 0);
});

test('N / Shift+N cycle the squares holding pieces, cursor-relative', () => {
	const { board } = make();
	// Pieces stand on 0 (Berto) and 4 (Ana).
	board.setActiveIndex(10, true, false);
	assert.equal(board.goToNextPiece(), true);
	assert.equal(board.getActiveIndex(), 0); // off-cycle forward enters at the first
	board.goToNextPiece();
	assert.equal(board.getActiveIndex(), 4);
	board.goToNextPiece();
	assert.equal(board.getActiveIndex(), 0); // wraps
	board.goToPrevPiece();
	assert.equal(board.getActiveIndex(), 4);
});

test('pieces render as coloured dots on their squares (display positions win)', () => {
	const { board, el, gs } = make();
	const dot = el.querySelector<HTMLElement>('.track-cell[data-square="4"] .track-piece');
	assert.ok(dot, "Ana's piece stands on square 4");
	assert.notEqual(dot!.style.background, '', 'the dot wears the player colour');
	assert.ok(el.querySelector('.track-cell[data-square="0"] .track-piece'), "Berto's piece waits in the tray");
	// An animator override draws the piece mid-walk, away from its authoritative square.
	board.setDisplayPositionCallback(id => (id === 'A' ? 2 : 0));
	board.update(gs);
	assert.ok(el.querySelector('.track-cell[data-square="2"] .track-piece'));
	assert.equal(el.querySelector('.track-cell[data-square="4"] .track-piece'), null);
});
