import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';
import { RaceBoard, ringPositions } from '../src/raceBoard.js';
import type { GameState, RaceBoardDef, RaceState } from '../src/models.js';

/**
 * The race board component: renders the circuit ring + per-seat zones, keeps the exploration
 * cursor in sync with the topological navigation (←/→ lanes, ↑/↓ zones) and voices each cell
 * through the announcer — the same conventions as the property board, different geometry.
 */

const BOARD: RaceBoardDef = {
	circuitLength: 20,
	corridorLength: 3,
	piecesPerPlayer: 2,
	safeSquares: [1, 11],
	seats: [
		{ id: 'sa', color: '#e00', startSquare: 1, corridorEntry: 20, nameKey: 'seats.sa' },
		{ id: 'sb', color: '#00e', startSquare: 11, corridorEntry: 10, nameKey: 'seats.sb' },
	],
};

function gameState(): GameState {
	const race: RaceState = {
		seats: [
			{ playerId: 'A', seatId: 'sa', pieces: [{ location: 'home', square: 0 }, { location: 'circuit', square: 5 }] },
			{ playerId: 'B', seatId: 'sb', pieces: [{ location: 'circuit', square: 7 }, { location: 'circuit', square: 7 }] },
		],
		consecutiveSixes: 0,
		pendingBonuses: [],
		pendingBonusKinds: [],
	};
	return {
		gameType: 'race', race, raceBoard: BOARD,
		players: [
			{ id: 'A', name: 'Ana', token: 'ufo' as any, position: 0, money: 0, properties: [], releasePasses: 0 },
			{ id: 'B', name: 'Berto', token: 'star' as any, position: 0, money: 0, properties: [], releasePasses: 0 },
		],
		bank: { money: 0 }, currentTurn: 'A', ownership: [], squares: [],
	} as unknown as GameState;
}

before(() => {
	setupDom();
	installFakeI18next('en');
});

function make(): { board: RaceBoard; el: HTMLElement; spoken: string[]; gs: GameState } {
	document.body.innerHTML = '';
	const el = document.createElement('div');
	document.body.appendChild(el);
	const spoken: string[] = [];
	const gs = gameState();
	const board = new RaceBoard(el, {
		getGameState: () => gs,
		getMyPlayerId: () => 'A',
		announce: text => spoken.push(text),
		tSync: (key: string, vars?: Record<string, unknown>) => (globalThis as any).window.i18next.t(key, vars),
	});
	board.update(gs);
	return { board, el, spoken, gs };
}

test('ringPositions walks a clean rectangle perimeter with exactly N cells', () => {
	const cells = ringPositions(20);
	assert.equal(cells.length, 20);
	const keys = new Set(cells.map(c => `${c.col},${c.row}`));
	assert.equal(keys.size, 20); // no duplicates
	assert.deepEqual(cells[0], { col: 1, row: 1 });
});

test('renders the circuit, safe/start markers and the per-seat zones', () => {
	const { el } = make();
	assert.equal(el.querySelectorAll('.race-cell--circuit').length, 20);
	assert.ok(el.querySelector('.race-cell[data-square="1"]')!.classList.contains('race-cell--safe'));
	assert.ok(el.querySelector('.race-cell[data-square="1"]')!.classList.contains('race-cell--start'));
	// Two seats × (home + 3 corridor + goal) = 10 zone cells.
	assert.equal(el.querySelectorAll('.race-zone .race-cell').length, 10);
	assert.equal(el.getAttribute('role'), 'application');
});

test('pieces render on their squares; a pair of the same seat reads as a barrier', () => {
	const { el } = make();
	assert.equal(el.querySelector('.race-cell[data-square="5"]')!.querySelectorAll('.race-piece').length, 1);
	const barrier = el.querySelector('.race-cell[data-square="7"]')!;
	assert.equal(barrier.querySelectorAll('.race-piece--barrier').length, 2);
	// Home/goal boxes show counts (Ana: 1 home, 0 goal).
	assert.equal(el.querySelector('.race-cell[data-seat="0"][data-cell="0"] .race-count')!.textContent, '1');
});

test('vacant seats render no zone strip and no start band', () => {
	document.body.innerHTML = '';
	const el = document.createElement('div');
	document.body.appendChild(el);
	const gs = gameState();
	// A 3-seat board where only sa/sb are seated: the third squadron is dead geometry.
	gs.raceBoard = {
		...BOARD,
		seats: [...BOARD.seats, { id: 'sc', color: '#0a0', startSquare: 16, corridorEntry: 15 }],
	};
	const board = new RaceBoard(el, {
		getGameState: () => gs,
		getMyPlayerId: () => 'A',
		announce: () => {},
		tSync: (key: string, vars?: Record<string, unknown>) => (globalThis as any).window.i18next.t(key, vars),
	});
	board.update(gs);
	assert.equal(el.querySelectorAll('.race-zone').length, 2); // not 3
	assert.ok(!el.querySelector('.race-cell[data-square="16"]')!.classList.contains('race-cell--start'));
});

test('arrows walk the circuit with wrap and voice each cell', () => {
	const { board, el, spoken } = make();
	board.moveRight(); // 1 → 2
	assert.ok(el.querySelector('.race-cell[data-square="2"]')!.classList.contains('focused'));
	board.moveLeft();
	board.moveLeft(); // 2 → 1 → 20 (wraps)
	assert.ok(el.querySelector('.race-cell[data-square="20"]')!.classList.contains('focused'));
	assert.equal(spoken.length, 3); // every step spoke
});

test('down/up switch zones and return to the remembered circuit square', () => {
	const { board, el } = make();
	board.setActiveIndex(7, false, false);
	board.moveDown(); // → seat 0 home
	assert.ok(el.querySelector('.race-cell[data-seat="0"][data-cell="0"]')!.classList.contains('focused'));
	board.moveRight(); // corridor 1
	assert.ok(el.querySelector('.race-cell[data-seat="0"][data-cell="1"]')!.classList.contains('focused'));
	board.moveDown(); // → seat 1 home
	board.moveDown(); // → back to the circuit, square 7 remembered
	assert.ok(el.querySelector('.race-cell[data-square="7"]')!.classList.contains('focused'));
});

test('goToMe cycles through my pieces wherever they stand', () => {
	const { board, el } = make();
	board.goToMe(); // piece 0: home → seat 0 home cell
	assert.ok(el.querySelector('.race-cell[data-seat="0"][data-cell="0"]')!.classList.contains('focused'));
	board.goToMe(); // piece 1: circuit 5
	assert.ok(el.querySelector('.race-cell[data-square="5"]')!.classList.contains('focused'));
});

test('Shift+M steps back through my pieces (same forward/backward convention as N)', () => {
	const { board, el } = make();
	const focused = () => (el.querySelector('.race-cell.focused') as HTMLElement).dataset;
	board.goToMe();       // home box
	board.goToMe();       // circuit 5
	assert.equal(focused().square, '5');
	board.goToMe(false);  // truly BACK to the home box
	assert.equal(focused().cell, '0');
	board.goToMe(false);  // wraps to the last of my squares
	assert.equal(focused().square, '5');
});

test('S / Shift+S survey the circuit landmarks of EVERY seat in ring order', () => {
	// Landmarks of both occupied seats, ascending: sa start 1, sb corridor entry 10,
	// sb start 11, sa corridor entry 20. The cursor starts ON square 1.
	const { board, el } = make();
	const focused = () => (el.querySelector('.race-cell.focused') as HTMLElement).dataset;
	board.goToMyStart();       // 1 → the NEXT landmark on the ring: sb's corridor entry
	assert.equal(focused().square, '10');
	board.goToMyStart();       // → sb's start
	assert.equal(focused().square, '11');
	board.goToMyStart();       // → sa's corridor entry
	assert.equal(focused().square, '20');
	board.goToMyStart();       // wraps back to sa's start
	assert.equal(focused().square, '1');
	board.goToMyStart(false);  // backward from 1 → 20 (reverse of the same cycle)
	assert.equal(focused().square, '20');
	board.moveRight();         // 20 wraps to 1…
	board.moveRight();         // …then 2: a non-landmark square
	board.goToMyStart();       // off-cycle, forward enters at the FIRST landmark
	assert.equal(focused().square, '1');
});

test('N / Shift+N walk the piece squares in RING order, both directions agreeing', () => {
	// Piece stops in the new PREDICTABLE order (feedback: seat order felt like random
	// jumps): circuit squares ascending first (5, then 7 — the barrier counts once),
	// then the seat zones (Ana's home box). The cursor starts on square 1 (no piece),
	// so the first N enters the cycle at its first stop.
	const { board, el } = make();
	const focusedSquare = () => (el.querySelector('.race-cell.focused') as HTMLElement).dataset;

	board.goToNextPiece();
	assert.equal(focusedSquare().square, '5');
	board.goToNextPiece();
	assert.equal(focusedSquare().square, '7');
	board.goToNextPiece();
	assert.equal(focusedSquare().cell, '0'); // Ana's home box, after the ring
	// Regression: the stored-counter version re-announced the square you stood on and
	// N, N, Shift+N landed back on the SAME square. Prev must truly step back.
	board.goToPrevPiece();
	assert.equal(focusedSquare().square, '7');
	board.goToPrevPiece();
	assert.equal(focusedSquare().square, '5');
	// And the cycle wraps in both directions: backward from the first stop → the last.
	board.goToPrevPiece();
	assert.equal(focusedSquare().cell, '0');
});

test('the exploration cursor starts on MY start square, not square 1', () => {
	// Berto's seat starts at 11: his first anchor on the ring must be his own entry point
	// (a first-time player took the arbitrary "square 1" for where they enter the track).
	document.body.innerHTML = '';
	const el = document.createElement('div');
	document.body.appendChild(el);
	const gs = gameState();
	const board = new RaceBoard(el, {
		getGameState: () => gs,
		getMyPlayerId: () => 'B',
		announce: () => {},
		tSync: (key: string, vars?: Record<string, unknown>) => (globalThis as any).window.i18next.t(key, vars),
	});
	board.update(gs);
	assert.ok(el.querySelector('.race-cell[data-square="11"]')!.classList.contains('focused'));
});

test('Home goes to the beginning of the CURRENT lane (circuit → 1, seat zone → its home)', () => {
	const { board, el } = make();
	board.setActiveIndex(9, false, false);
	board.goToStart(); // on the circuit → square 1
	assert.ok(el.querySelector('.race-cell[data-square="1"]')!.classList.contains('focused'));
	board.moveDown();  // into seat 0's zone
	board.moveRight(); // corridor 1
	board.goToStart(); // inside a zone → its first cell (the home box)
	assert.ok(el.querySelector('.race-cell[data-seat="0"][data-cell="0"]')!.classList.contains('focused'));
});

test('goToMyStart from inside a zone enters the landmark cycle at its first square', () => {
	const { board, el } = make();
	board.setActiveIndex(9, false, false);
	board.moveDown(); // wander into a zone first
	board.goToMyStart(); // off-cycle → the first landmark of the ring (sa's start, 1)
	assert.ok(el.querySelector('.race-cell[data-square="1"]')!.classList.contains('focused'));
	board.goToMyStart(); // → the next landmark on the ring (sb's corridor entry, 10)
	assert.ok(el.querySelector('.race-cell[data-square="10"]')!.classList.contains('focused'));
});

test('B / Shift+B cycle the circuit barriers (Berto keeps two pieces on 7)', () => {
	const { board, el, gs } = make();
	const focused = () => (el.querySelector('.race-cell.focused') as HTMLElement).dataset;
	assert.equal(board.goToBarrier(), true);
	assert.equal(focused().square, '7', 'the only barrier on the board');
	// Give Ana a second piece on 5: two barriers, cycled in ring order from the cursor.
	gs.race!.seats[0].pieces[0] = { location: 'circuit', square: 5 };
	board.update(gs);
	board.goToBarrier();      // from 7 → wraps to 5
	assert.equal(focused().square, '5');
	board.goToBarrier(false); // and back
	assert.equal(focused().square, '7');
});

// === Direct manipulation: highlighted destinations speak their MOVE ===

test('a highlighted destination becomes a labelled button; clearing restores the plain cell', () => {
	const { board, el } = make();
	board.setMoveOptions([
		{ cursor: { zone: 'circuit', square: 8 }, pieceIndex: 1, label: 'Ficha 2: avanza a la casilla 8' },
	], () => {});

	const cell = el.querySelector('.race-cell[data-square="8"]')!;
	assert.ok(cell.classList.contains('race-cell--highlight'));
	assert.equal(cell.getAttribute('role'), 'button');
	assert.equal(cell.getAttribute('aria-label'), 'Ficha 2: avanza a la casilla 8');

	board.setMoveOptions(null, null);
	assert.equal(cell.getAttribute('role'), null, 'the button semantics leave with the highlight');
	assert.equal(cell.getAttribute('aria-label'), null);
	assert.ok(!cell.classList.contains('race-cell--highlight'));
});

test('arrowing onto a highlighted destination also voices its move option', () => {
	const { board, spoken } = make();
	board.setMoveOptions([
		{ cursor: { zone: 'circuit', square: 2 }, pieceIndex: 0, label: 'Ficha 1: avanza a la casilla 2' },
	], () => {});

	board.setActiveIndex(2, false, true); // cursor onto the destination, announcing
	const last = spoken[spoken.length - 1];
	assert.match(last, /Square 2 of 20/); // the cell description first (the fake i18n is EN)…
	assert.match(last, /Ficha 1: avanza a la casilla 2/); // …then the option's own label

	board.setActiveIndex(3, false, true); // a plain square stays plain
	assert.doesNotMatch(spoken[spoken.length - 1], /Ficha 1/);
});

test('setFocusedMoveOption emphasizes ONE destination and follows the focus', () => {
	const { board, el } = make();
	board.setMoveOptions([
		{ cursor: { zone: 'circuit', square: 8 }, pieceIndex: 0, label: 'a' },
		{ cursor: { zone: 'circuit', square: 10 }, pieceIndex: 1, label: 'b' },
	], () => {});
	const cell8 = el.querySelector('.race-cell[data-square="8"]')!;
	const cell10 = el.querySelector('.race-cell[data-square="10"]')!;

	board.setFocusedMoveOption(1);
	assert.ok(!cell8.classList.contains('race-cell--highlight-focus'));
	assert.ok(cell10.classList.contains('race-cell--highlight-focus'));

	board.setFocusedMoveOption(0); // focus moved to the other option
	assert.ok(cell8.classList.contains('race-cell--highlight-focus'));
	assert.ok(!cell10.classList.contains('race-cell--highlight-focus'));
	assert.ok(cell10.classList.contains('race-cell--highlight'), 'the sibling keeps its normal highlight');
});
