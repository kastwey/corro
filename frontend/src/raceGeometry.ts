// raceGeometry.ts — pure exploration model of a race (parcheesi-style) board.
//
// The property board's arrows are spatial because its rectangle makes screen adjacency and
// walking order coincide. A race cross does not, so here the arrows follow the GAME topology:
//
//   ←/→  advance/go back along the current lane (the shared circuit, wrapping; or a seat's
//        home → corridor → goal strip), i.e. "what is ahead of my piece?".
//   ↑/↓  switch lane/zone: Circuit → seat 1's zone → seat 2's zone → … → Circuit.
//
// A cursor is either a circuit square or a cell in a seat's zone (home, corridor 1..L, goal).
// Everything here is DOM-free so the whole model is unit-testable; raceBoard.ts renders it.

import type { GameState, RaceBoardDef, RaceState, RaceMoveOption } from './models.js';

export type RaceCursor =
	| { zone: 'circuit'; square: number }
	| { zone: 'seat'; seatIndex: number; cell: number };

/** Cells of a seat zone: 0 = home, 1..corridorLength = corridor squares, corridorLength+1 = goal. */
export const HOME_CELL = 0;
export const goalCell = (board: RaceBoardDef) => board.corridorLength + 1;

/** Whether two cursors point at the same cell. */
export function cursorsEqual(a: RaceCursor, b: RaceCursor): boolean {
	if (a.zone === 'circuit') return b.zone === 'circuit' && a.square === b.square;
	return b.zone === 'seat' && a.seatIndex === b.seatIndex && a.cell === b.cell;
}

// ── movement ─────────────────────────────────────────────────────────────────

/** One step forward along the current lane (circuit wraps; a seat zone stops at its goal). */
export function cursorNext(board: RaceBoardDef, cursor: RaceCursor): RaceCursor {
	if (cursor.zone === 'circuit') {
		return { zone: 'circuit', square: cursor.square % board.circuitLength + 1 };
	}
	return { ...cursor, cell: Math.min(cursor.cell + 1, goalCell(board)) };
}

/** One step back along the current lane (circuit wraps; a seat zone stops at its home). */
export function cursorPrev(board: RaceBoardDef, cursor: RaceCursor): RaceCursor {
	if (cursor.zone === 'circuit') {
		return { zone: 'circuit', square: (cursor.square + board.circuitLength - 2) % board.circuitLength + 1 };
	}
	return { ...cursor, cell: Math.max(cursor.cell - 1, HOME_CELL) };
}

/** The board-seat indices actually taken by a player in this game. With fewer players
 *  than seats, the vacant seats are dead geometry: not rendered, not explored, and their
 *  circuit landmarks are not announced. */
export function activeSeatIndices(board: RaceBoardDef, race: RaceState): number[] {
	const occupied = new Set(race.seats.map(s => s.seatId));
	return board.seats.map((s, i) => (occupied.has(s.id) ? i : -1)).filter(i => i >= 0);
}

/**
 * Switch zone (Up = previous, Down = next) over [circuit, seat, seat, …], wrapping.
 * Only OCCUPIED seats take part when `activeSeats` is given (a 2-player game on a 4-seat
 * board is a 2-squadron race). Entering a seat zone lands on its home; returning to the
 * circuit restores the square the cursor last had there.
 */
export function cursorZone(
	board: RaceBoardDef, cursor: RaceCursor, delta: 1 | -1, lastCircuitSquare: number,
	activeSeats?: number[]
): RaceCursor {
	const seats = activeSeats ?? board.seats.map((_, i) => i);
	if (seats.length === 0) return cursor;
	const zoneCount = 1 + seats.length; // circuit + one zone per occupied seat
	const current = cursor.zone === 'circuit' ? 0 : 1 + Math.max(0, seats.indexOf(cursor.seatIndex));
	const next = (current + delta + zoneCount) % zoneCount;
	return next === 0
		? { zone: 'circuit', square: lastCircuitSquare }
		: { zone: 'seat', seatIndex: seats[next - 1], cell: HOME_CELL };
}

/** The cursor pointing at where a given piece currently stands. */
export function cursorForPiece(
	board: RaceBoardDef, race: RaceState, playerId: string, pieceIndex: number
): RaceCursor | null {
	const seat = race.seats.find(s => s.playerId === playerId);
	if (!seat) return null;
	const seatIndex = board.seats.findIndex(s => s.id === seat.seatId);
	const piece = seat.pieces[pieceIndex];
	if (!piece || seatIndex < 0) return null;
	switch (piece.location) {
		case 'circuit': return { zone: 'circuit', square: piece.square };
		case 'corridor': return { zone: 'seat', seatIndex, cell: piece.square };
		case 'goal': return { zone: 'seat', seatIndex, cell: goalCell(board) };
		default: return { zone: 'seat', seatIndex, cell: HOME_CELL };
	}
}

// ── contents ─────────────────────────────────────────────────────────────────

export interface CircuitOccupancy { playerId: string; count: number }

/** Who stands on a circuit square, grouped per player (count 2 = a barrier). */
export function circuitOccupants(race: RaceState, square: number): CircuitOccupancy[] {
	const result: CircuitOccupancy[] = [];
	for (const seat of race.seats) {
		const count = seat.pieces.filter(p => p.location === 'circuit' && p.square === square).length;
		if (count > 0) result.push({ playerId: seat.playerId, count });
	}
	return result;
}

/** Pieces a seat has in each part of its own zone. */
export function seatZoneCounts(board: RaceBoardDef, race: RaceState, seatIndex: number) {
	const seatId = board.seats[seatIndex]?.id;
	const seat = race.seats.find(s => s.seatId === seatId);
	const home = seat?.pieces.filter(p => p.location === 'home').length ?? 0;
	const goal = seat?.pieces.filter(p => p.location === 'goal').length ?? 0;
	const corridorAt = (cell: number) =>
		seat?.pieces.filter(p => p.location === 'corridor' && p.square === cell).length ?? 0;
	return { home, goal, corridorAt, playerId: seat?.playerId ?? null };
}

// ── description (what the announcer voices for a cursor) ─────────────────────

export interface RaceDescribeContext {
	board: RaceBoardDef;
	race: RaceState;
	/** Player id → display name (an unseated seat announces as vacant). */
	playerName: (playerId: string | null) => string | null;
	/** Seat display name (resolved from its nameKey, falling back to its id). */
	seatName: (seatIndex: number) => string;
	/** Game-namespace translator. */
	t: (key: string, vars?: Record<string, unknown>) => string;
}

/** The full spoken description of a cursor position (square + landmarks + pieces). */
export function describeCursor(cursor: RaceCursor, ctx: RaceDescribeContext): string {
	const { board, race, t } = ctx;
	const parts: string[] = [];

	if (cursor.zone === 'circuit') {
		parts.push(t('race_cell_circuit', { square: cursor.square, total: board.circuitLength }));
		if (board.safeSquares.includes(cursor.square)) parts.push(t('race_cell_safe'));
		const occupied = new Set(race.seats.map(s => s.seatId));
		board.seats.forEach((seat, i) => {
			if (!occupied.has(seat.id)) return; // a vacant squadron's landmarks are noise
			if (seat.startSquare === cursor.square) {
				parts.push(t('race_cell_start_of', { name: ctx.seatName(i) }));
			}
			if (seat.corridorEntry === cursor.square) {
				parts.push(t('race_cell_entry_of', { name: ctx.seatName(i) }));
			}
		});
		for (const occ of circuitOccupants(race, cursor.square)) {
			const name = ctx.playerName(occ.playerId) ?? occ.playerId;
			parts.push(occ.count >= 2
				? t('race_cell_barrier_of', { name })
				: t('race_cell_piece_of', { name }));
		}
		return parts.join('. ');
	}

	const counts = seatZoneCounts(board, race, cursor.seatIndex);
	const owner = ctx.playerName(counts.playerId) ?? ctx.seatName(cursor.seatIndex);
	if (cursor.cell === HOME_CELL) {
		parts.push(t('race_cell_home', { name: owner, count: counts.home }));
	} else if (cursor.cell === goalCell(board)) {
		parts.push(t('race_cell_goal', { name: owner, count: counts.goal }));
	} else {
		parts.push(t('race_cell_corridor', {
			name: owner, cell: cursor.cell, total: board.corridorLength,
		}));
		const here = counts.corridorAt(cursor.cell);
		if (here === 1) parts.push(t('race_cell_piece_of', { name: owner }));
		if (here >= 2) parts.push(t('race_cell_barrier_of', { name: owner }));
	}
	return parts.join('. ');
}

// ── choice labels (the "which piece moves?" dialog) ─────────────────────────

/** Where a piece currently stands, for the choice dialog ("desde tu salida / la casilla 12 /
 *  tu pasillo 3"). Null for a piece at home (its only move is the exit, already explicit). */
export function describePieceOrigin(
	board: RaceBoardDef, race: RaceState, playerId: string, pieceIndex: number,
	t: (key: string, vars?: Record<string, unknown>) => string
): string | null {
	const seat = race.seats.find(s => s.playerId === playerId);
	const piece = seat?.pieces[pieceIndex];
	if (!piece) return null;
	if (piece.location === 'circuit') {
		const seatDef = board.seats.find(s => s.id === seat!.seatId);
		if (piece.square === seatDef?.startSquare) return t('race_option_from_start');
		// Leaving a SAFE square is a tactical decision (the piece becomes capturable):
		// the origin says so, so the player knows what the move gives up.
		return board.safeSquares.includes(piece.square)
			? t('race_option_from_square_safe', { square: piece.square })
			: t('race_option_from_square', { square: piece.square });
	}
	if (piece.location === 'corridor') return t('race_option_from_corridor', { square: piece.square });
	return null; // home (the exit option says it) or goal (never movable)
}

/** The spoken/visible label of one legal move option in the piece-choice dialog. */
export function describeMoveOption(
	option: RaceMoveOption,
	ctx: {
		t: (key: string, vars?: Record<string, unknown>) => string;
		playerName: (id: string) => string;
		/** Optional richer piece label (e.g. "Nave estelar 2" from the player's token). */
		pieceLabel?: (pieceIndex: number) => string;
		/** Optional origin line ("desde tu salida") appended after the piece label. */
		origin?: (pieceIndex: number) => string | null;
		/** Optional current location of the piece to distinguish "enters" vs "advances". */
		pieceLocation?: (pieceIndex: number) => 'home' | 'circuit' | 'corridor' | 'goal' | null;
		/** Whether a circuit square is SAFE — landing there shelters the piece, so the
		 *  destination says so (the player must know what the move will win). */
		isSafeSquare?: (square: number) => boolean;
	}
): string {
	let piece = ctx.pieceLabel?.(option.pieceIndex)
		?? ctx.t('race_option_piece', { number: option.pieceIndex + 1 });
	const from = ctx.origin?.(option.pieceIndex);
	if (from) piece += `, ${from}`;
	let dest: string;
	if (option.exitsHome) dest = ctx.t('race_option_exit');
	else if (option.toLocation === 'goal') dest = ctx.t('race_option_goal');
	else if (option.toLocation === 'corridor') {
		// If already in corridor, use "advances" instead of "enters"
		const currentLoc = ctx.pieceLocation?.(option.pieceIndex);
		const key = currentLoc === 'corridor' ? 'race_option_corridor_move' : 'race_option_corridor';
		dest = ctx.t(key, { square: option.toSquare });
	}
	else {
		dest = ctx.isSafeSquare?.(option.toSquare)
			? ctx.t('race_option_square_safe', { square: option.toSquare })
			: ctx.t('race_option_square', { square: option.toSquare });
	}

	const extras: string[] = [];
	if (option.capturesPlayerId) extras.push(ctx.t('race_option_captures', { name: ctx.playerName(option.capturesPlayerId) }));
	if (option.breaksOwnBarrier) extras.push(ctx.t('race_option_breaks_barrier'));
	return [piece + ': ' + dest, ...extras].join('. ');
}

/** Seat display name resolver shared by board + dialogs (nameKey → translated, else player, else id). */
export function seatDisplayName(
	board: RaceBoardDef, seatIndex: number,
	tSync: (key: string) => string
): string {
	const seat = board.seats[seatIndex];
	if (!seat) return '';
	if (seat.nameKey) {
		const resolved = tSync(seat.nameKey);
		if (resolved && resolved !== seat.nameKey) return resolved;
	}
	return seat.id;
}

/** The DISTINCT places the local player's pieces stand, for goToMe cycling: pieces
 *  sharing a square (home, a barrier, the goal) are ONE stop — its narration already
 *  carries the count — so M never repeats the same place back to back. */
export function myPieceCursors(gs: GameState, myId: string | null): RaceCursor[] {
	if (!gs.race || !gs.raceBoard || !myId) return [];
	const seat = gs.race.seats.find(s => s.playerId === myId);
	if (!seat) return [];
	const seen = new Set<string>();
	const result: RaceCursor[] = [];
	for (let i = 0; i < seat.pieces.length; i++) {
		const cursor = cursorForPiece(gs.raceBoard, gs.race, myId, i);
		if (!cursor) continue;
		const key = cursor.zone === 'circuit' ? `c:${cursor.square}` : `s:${cursor.seatIndex}:${cursor.cell}`;
		if (seen.has(key)) continue;
		seen.add(key);
		result.push(cursor);
	}
	return result;
}

/** All pieces on the board (mine and other players'), for N key navigation. */
/** Circuit squares holding a BARRIER (two same-seat pieces), ascending: the B key's
 *  route. Corridors can stack pieces too, but nobody else ever passes there — only the
 *  ring's barriers gate anyone's movement, so only they are landmarks. */
export function barrierCursors(gs: GameState): RaceCursor[] {
	if (!gs.race || !gs.raceBoard) return [];
	const bySquare = new Map<number, Map<string, number>>();
	for (const seat of gs.race.seats) {
		for (const piece of seat.pieces) {
			if (piece.location !== 'circuit') continue;
			const counts = bySquare.get(piece.square) ?? new Map<string, number>();
			counts.set(seat.seatId, (counts.get(seat.seatId) ?? 0) + 1);
			bySquare.set(piece.square, counts);
		}
	}
	return [...bySquare.entries()]
		.filter(([, counts]) => [...counts.values()].some(n => n >= 2))
		.map(([square]) => square)
		.sort((a, b) => a - b)
		.map(square => ({ zone: 'circuit', square } as RaceCursor));
}

export function allPieceCursors(gs: GameState): RaceCursor[] {
	if (!gs.race || !gs.raceBoard) return [];
	const seen = new Set<string>();
	const result: RaceCursor[] = [];
	for (const seat of gs.race.seats) {
		const playerId = seat.playerId;
		for (let i = 0; i < seat.pieces.length; i++) {
			const cursor = cursorForPiece(gs.raceBoard, gs.race, playerId, i);
			if (!cursor) continue;
			const key = cursor.zone === 'circuit' ? `c:${cursor.square}` : `s:${cursor.seatIndex}:${cursor.cell}`;
			if (seen.has(key)) continue;
			seen.add(key);
			result.push(cursor);
		}
	}
	// N / Shift+N must walk a PREDICTABLE route (feedback: seat order felt like random
	// jumps around the ring): circuit squares ascending first, then each seat's zone
	// stops — corridor cells ascending, then the goal, then the home box.
	const zoneRank = (c: RaceCursor & { zone: 'seat' }) =>
		c.cell === HOME_CELL ? Number.MAX_SAFE_INTEGER : c.cell;
	result.sort((a, b) => {
		if (a.zone !== b.zone) return a.zone === 'circuit' ? -1 : 1;
		if (a.zone === 'circuit' && b.zone === 'circuit') return a.square - b.square;
		const sa = a as RaceCursor & { zone: 'seat' };
		const sb = b as RaceCursor & { zone: 'seat' };
		return sa.seatIndex - sb.seatIndex || zoneRank(sa) - zoneRank(sb);
	});
	return result;
}
