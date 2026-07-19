import test from 'node:test';
import assert from 'node:assert/strict';
import {
	activeSeatIndices, cursorNext, cursorPrev, cursorZone, cursorForPiece, circuitOccupants,
	describeCursor, describeMoveOption, describePieceOrigin, goalCell, HOME_CELL, myPieceCursors,
	type RaceCursor, type RaceDescribeContext,
} from '../src/raceGeometry.js';
import type { GameState, RaceBoardDef, RaceState } from '../src/models.js';

/**
 * The race board's exploration model: arrows follow the GAME topology (the walking order),
 * not screen adjacency — ←/→ advance along the current lane, ↑/↓ switch between the circuit
 * and each seat's home/corridor/goal zone.
 */

const BOARD: RaceBoardDef = {
	circuitLength: 20,
	corridorLength: 3,
	piecesPerPlayer: 2,
	safeSquares: [1, 6, 11, 16],
	seats: [
		{ id: 'sa', startSquare: 1, corridorEntry: 20, nameKey: 'seats.sa' },
		{ id: 'sb', startSquare: 11, corridorEntry: 10, nameKey: 'seats.sb' },
	],
};

function race(): RaceState {
	return {
		seats: [
			{ playerId: 'A', seatId: 'sa', pieces: [{ location: 'home', square: 0 }, { location: 'circuit', square: 5 }] },
			{ playerId: 'B', seatId: 'sb', pieces: [{ location: 'circuit', square: 5 }, { location: 'corridor', square: 2 }] },
		],
		consecutiveSixes: 0,
		pendingBonuses: [],
		pendingBonusKinds: [],
	};
}

const circuit = (square: number): RaceCursor => ({ zone: 'circuit', square });

// ── lane movement (←/→) ──────────────────────────────────────────────────────

test('right/left move along the circuit and wrap at both ends', () => {
	assert.deepEqual(cursorNext(BOARD, circuit(5)), circuit(6));
	assert.deepEqual(cursorNext(BOARD, circuit(20)), circuit(1));   // wraps forward
	assert.deepEqual(cursorPrev(BOARD, circuit(5)), circuit(4));
	assert.deepEqual(cursorPrev(BOARD, circuit(1)), circuit(20));   // wraps backward
});

test('inside a seat zone the lane runs home → corridor → goal and clamps at the ends', () => {
	const home: RaceCursor = { zone: 'seat', seatIndex: 0, cell: HOME_CELL };
	const c1 = cursorNext(BOARD, home);
	assert.deepEqual(c1, { zone: 'seat', seatIndex: 0, cell: 1 });
	const goal = { zone: 'seat', seatIndex: 0, cell: goalCell(BOARD) } as RaceCursor;
	assert.deepEqual(cursorNext(BOARD, goal), goal);                // clamps at the goal
	assert.deepEqual(cursorPrev(BOARD, home), home);                // clamps at home
});

// ── zone switching (↑/↓) ─────────────────────────────────────────────────────

test('down cycles circuit → seat zones → back to the circuit, keeping the circuit square', () => {
	const inSeat0 = cursorZone(BOARD, circuit(7), 1, 7);
	assert.deepEqual(inSeat0, { zone: 'seat', seatIndex: 0, cell: HOME_CELL });
	const inSeat1 = cursorZone(BOARD, inSeat0, 1, 7);
	assert.deepEqual(inSeat1, { zone: 'seat', seatIndex: 1, cell: HOME_CELL });
	const backToCircuit = cursorZone(BOARD, inSeat1, 1, 7);
	assert.deepEqual(backToCircuit, circuit(7)); // remembered where we were on the ring
});

test('up cycles the zones in the opposite direction', () => {
	const lastSeat = cursorZone(BOARD, circuit(3), -1, 3);
	assert.deepEqual(lastSeat, { zone: 'seat', seatIndex: 1, cell: HOME_CELL });
});

// ── piece cursors (goToMe cycling) ───────────────────────────────────────────

test('cursorForPiece maps every piece location to its exploration cell', () => {
	const st = race();
	assert.deepEqual(cursorForPiece(BOARD, st, 'A', 0), { zone: 'seat', seatIndex: 0, cell: HOME_CELL });
	assert.deepEqual(cursorForPiece(BOARD, st, 'A', 1), circuit(5));
	assert.deepEqual(cursorForPiece(BOARD, st, 'B', 1), { zone: 'seat', seatIndex: 1, cell: 2 });
});

test('myPieceCursors lists the local player pieces for goToMe cycling', () => {
	const gs = { race: race(), raceBoard: BOARD } as unknown as GameState;
	const cursors = myPieceCursors(gs, 'A');
	assert.equal(cursors.length, 2);
	assert.deepEqual(cursors[1], circuit(5));
});

test('myPieceCursors collapses pieces sharing a place into ONE stop', () => {
	const st = race();
	// Three pieces: two at home + one on the circuit → two distinct stops, not three.
	st.seats[0].pieces = [
		{ location: 'home', square: 0 },
		{ location: 'home', square: 0 },
		{ location: 'circuit', square: 7 },
	];
	const gs = { race: st, raceBoard: BOARD } as unknown as GameState;
	const cursors = myPieceCursors(gs, 'A');
	assert.equal(cursors.length, 2);
	assert.deepEqual(cursors[0], { zone: 'seat', seatIndex: 0, cell: HOME_CELL });
	assert.deepEqual(cursors[1], circuit(7));
	// A barrier (two pieces on one circuit square) is also a single stop.
	st.seats[0].pieces = [
		{ location: 'circuit', square: 7 },
		{ location: 'circuit', square: 7 },
		{ location: 'circuit', square: 12 },
	];
	assert.equal(myPieceCursors(gs, 'A').length, 2);
});

// ── occupancy + descriptions ─────────────────────────────────────────────────

test('circuitOccupants groups pieces per player (two = a barrier)', () => {
	const st = race();
	st.seats[1].pieces[1] = { location: 'circuit', square: 5 };
	const occ = circuitOccupants(st, 5);
	assert.deepEqual(occ, [{ playerId: 'A', count: 1 }, { playerId: 'B', count: 2 }]);
});

const ctx = (st: RaceState): RaceDescribeContext => ({
	board: BOARD,
	race: st,
	playerName: id => (id === 'A' ? 'Ana' : id === 'B' ? 'Berto' : null),
	seatName: i => (i === 0 ? 'Rojo' : 'Azul'),
	t: (key, vars) => {
		const v = vars ?? {};
		switch (key) {
			case 'race_cell_circuit': return `Casilla ${v.square} de ${v.total}`;
			case 'race_cell_safe': return 'Seguro';
			case 'race_cell_start_of': return `Salida de ${v.name}`;
			case 'race_cell_entry_of': return `Entrada al pasillo de ${v.name}`;
			case 'race_cell_piece_of': return `Una ficha de ${v.name}`;
			case 'race_cell_barrier_of': return `Barrera de ${v.name}`;
			case 'race_cell_home': return `Casa de ${v.name}: ${v.count} fichas`;
			case 'race_cell_goal': return `Meta de ${v.name}: ${v.count} fichas`;
			case 'race_cell_corridor': return `Pasillo de ${v.name}, ${v.cell} de ${v.total}`;
			default: return key;
		}
	},
});

test('a circuit square voices its landmarks and occupants', () => {
	const st = race();
	assert.equal(
		describeCursor(circuit(1), ctx(st)),
		'Casilla 1 de 20. Seguro. Salida de Rojo');
	assert.equal(
		describeCursor(circuit(5), ctx(st)),
		'Casilla 5 de 20. Una ficha de Ana. Una ficha de Berto');
});

test('a barrier is voiced as such', () => {
	const st = race();
	st.seats[1].pieces[1] = { location: 'circuit', square: 5 };
	assert.match(describeCursor(circuit(5), ctx(st)), /Barrera de Berto/);
});

test('seat zone cells voice home, corridor position and goal with their counts', () => {
	const st = race();
	assert.equal(
		describeCursor({ zone: 'seat', seatIndex: 0, cell: HOME_CELL }, ctx(st)),
		'Casa de Ana: 1 fichas');
	assert.equal(
		describeCursor({ zone: 'seat', seatIndex: 1, cell: 2 }, ctx(st)),
		'Pasillo de Berto, 2 de 3. Una ficha de Berto');
	assert.equal(
		describeCursor({ zone: 'seat', seatIndex: 1, cell: goalCell(BOARD) }, ctx(st)),
		'Meta de Berto: 0 fichas');
});

// ── choice-option labels ─────────────────────────────────────────────────────

test('describeMoveOption labels exits, destinations, captures and barrier breaks', () => {
	const t = (key: string, vars?: Record<string, unknown>) => {
		const v = vars ?? {};
		switch (key) {
			case 'race_option_piece': return `Ficha ${v.number}`;
			case 'race_option_exit': return 'sale al tablero';
			case 'race_option_square': return `a la casilla ${v.square}`;
			case 'race_option_square_safe': return `a la casilla ${v.square}, segura`;
			case 'race_option_corridor': return `al pasillo, casilla ${v.square}`;
			case 'race_option_goal': return 'a la meta';
			case 'race_option_captures': return `come a ${v.name}`;
			case 'race_option_breaks_barrier': return 'rompe tu barrera';
			default: return key;
		}
	};
	const playerName = (id: string) => (id === 'B' ? 'Berto' : id);

	assert.equal(
		describeMoveOption({ pieceIndex: 0, toLocation: 'circuit', toSquare: 1, exitsHome: true }, { t, playerName }),
		'Ficha 1: sale al tablero');
	assert.equal(
		describeMoveOption({ pieceIndex: 2, toLocation: 'circuit', toSquare: 8, capturesPlayerId: 'B' }, { t, playerName }),
		'Ficha 3: a la casilla 8. come a Berto');
	assert.equal(
		describeMoveOption({ pieceIndex: 1, toLocation: 'goal', toSquare: 0 }, { t, playerName }),
		'Ficha 2: a la meta');
	assert.equal(
		describeMoveOption({ pieceIndex: 1, toLocation: 'corridor', toSquare: 2, breaksOwnBarrier: true }, { t, playerName }),
		'Ficha 2: al pasillo, casilla 2. rompe tu barrera');

	// A SAFE destination says so — the player must know what the move will win —
	// while ordinary squares stay untouched even with the probe wired.
	const isSafeSquare = (square: number) => BOARD.safeSquares.includes(square);
	assert.equal(
		describeMoveOption({ pieceIndex: 0, toLocation: 'circuit', toSquare: 11 }, { t, playerName, isSafeSquare }),
		'Ficha 1: a la casilla 11, segura');
	assert.equal(
		describeMoveOption({ pieceIndex: 0, toLocation: 'circuit', toSquare: 8 }, { t, playerName, isSafeSquare }),
		'Ficha 1: a la casilla 8');
});

test('describePieceOrigin locates a piece at its start, a plain square or the corridor', () => {
	const t = (key: string, vars?: Record<string, unknown>) => {
		const v = vars ?? {};
		switch (key) {
			case 'race_option_from_start': return 'desde tu salida';
			case 'race_option_from_square': return `desde la casilla ${v.square}`;
			case 'race_option_from_square_safe': return `desde la casilla ${v.square}, segura`;
			case 'race_option_from_corridor': return `desde tu pasillo, casilla ${v.square}`;
			default: return key;
		}
	};
	const st = race();
	// A#1 at circuit 5 (an ordinary square); B#1 at corridor 2; A#0 at home (null).
	assert.equal(describePieceOrigin(BOARD, st, 'A', 1, t), 'desde la casilla 5');
	assert.equal(describePieceOrigin(BOARD, st, 'B', 1, t), 'desde tu pasillo, casilla 2');
	assert.equal(describePieceOrigin(BOARD, st, 'A', 0, t), null);
	// A piece parked exactly on its own start says so.
	st.seats[0].pieces[1] = { location: 'circuit', square: 1 }; // seat sa starts at 1
	assert.equal(describePieceOrigin(BOARD, st, 'A', 1, t), 'desde tu salida');
	// Leaving a SAFE square (11 — sb's start, but for A just a safe square) is a
	// tactical trade-off: the origin flags it.
	st.seats[0].pieces[1] = { location: 'circuit', square: 11 };
	assert.equal(describePieceOrigin(BOARD, st, 'A', 1, t), 'desde la casilla 11, segura');
});

test('describeMoveOption uses the richer piece label and origin when provided', () => {
	const t = (key: string, vars?: Record<string, unknown>) => {
		const v = vars ?? {};
		return key === 'race_option_square' ? `avanza a la casilla ${v.square}` : key;
	};
	const label = describeMoveOption(
		{ pieceIndex: 1, toLocation: 'circuit', toSquare: 9 },
		{
			t, playerName: id => id,
			pieceLabel: i => `Nave estelar ${i + 1}`,
			origin: () => 'desde tu salida',
		});
	assert.equal(label, 'Nave estelar 2, desde tu salida: avanza a la casilla 9');
});

// ── Vacant seats (fewer players than board seats) are dead geometry ───────────

test('zone cycling skips vacant seats (a 2-player game on a 3-seat board)', () => {
	const board3 = {
		...BOARD,
		seats: [...BOARD.seats, { id: 'sc', startSquare: 16, corridorEntry: 15, nameKey: 'seats.sc' }],
	};
	const st = race(); // only sa (A) and sb (B) are seated; sc is vacant
	const active = activeSeatIndices(board3, st);
	assert.deepEqual(active, [0, 1]);

	const down1 = cursorZone(board3, { zone: 'circuit', square: 4 }, 1, 4, active);
	assert.deepEqual(down1, { zone: 'seat', seatIndex: 0, cell: HOME_CELL });
	const down2 = cursorZone(board3, down1, 1, 4, active);
	assert.deepEqual(down2, { zone: 'seat', seatIndex: 1, cell: HOME_CELL });
	const down3 = cursorZone(board3, down2, 1, 4, active); // skips vacant sc → back to the ring
	assert.deepEqual(down3, { zone: 'circuit', square: 4 });
});

test('a vacant seat start square announces safety but not the phantom squadron', () => {
	const board3 = {
		...BOARD,
		safeSquares: [...BOARD.safeSquares, 16],
		seats: [...BOARD.seats, { id: 'sc', startSquare: 16, corridorEntry: 15, nameKey: 'seats.sc' }],
	};
	const st = race();
	const text = describeCursor({ zone: 'circuit', square: 16 }, { ...ctx(st), board: board3 });
	assert.match(text, /Seguro/);
	assert.doesNotMatch(text, /Salida/); // no player commands that squadron
});
