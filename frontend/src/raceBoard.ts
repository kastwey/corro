// raceBoard.ts — visual + keyboard component of a race (parcheesi-style) board.
//
// Implements the same navigation surface as the property Board (moveLeft/Right/Up/Down,
// goToMe, goToStart…) so the keyboard layer works unchanged, but maps the arrows onto the
// race topology defined in raceGeometry.ts: ←/→ walk the current lane, ↑/↓ switch between
// the shared circuit and each seat's home/corridor/goal zone. The component is a single
// focusable application surface; the exploration cursor is visual (.focused) and voiced
// through the announcer, exactly like the property board.

import type { GameState, RaceBoardDef } from './models.js';
import {
	activeSeatIndices, barrierCursors, cursorNext, cursorPrev, cursorsEqual, cursorZone,
	describeCursor, goalCell, HOME_CELL, myPieceCursors, allPieceCursors, seatDisplayName,
	type RaceCursor, type RaceDescribeContext,
} from './raceGeometry.js';

export interface RaceBoardDeps {
	getGameState: () => GameState | null;
	getMyPlayerId: () => string | null;
	/** Instant cursor narration (interrupts, like the property board's square voice). */
	announce: (text: string) => void;
	/** Full-key translator (seat nameKeys are package keys). */
	tSync: (key: string, vars?: Record<string, unknown>) => string;
}

const t = (deps: RaceBoardDeps, key: string, vars?: Record<string, unknown>) =>
	deps.tSync(`game.${key}`, vars);

/** Perimeter walk of a W×H grid, clockwise from the top-left: exactly the cell coordinates
 *  (col,row 1-based) for a ring of N squares. W/H are derived from N (2W+2H-4 = N). */
export function ringPositions(n: number): Array<{ col: number; row: number }> {
	// Closest to square: W ≈ H. Perimeter = 2(W+H) - 4 = n → W+H = n/2 + 2.
	const sum = Math.floor(n / 2) + 2;
	const w = Math.ceil(sum / 2);
	const h = sum - w;
	const cells: Array<{ col: number; row: number }> = [];
	for (let c = 1; c <= w; c++) cells.push({ col: c, row: 1 });
	for (let r = 2; r <= h; r++) cells.push({ col: w, row: r });
	for (let c = w - 1; c >= 1; c--) cells.push({ col: c, row: h });
	for (let r = h - 1; r >= 2; r--) cells.push({ col: 1, row: r });
	return cells.slice(0, n);
}

export class RaceBoard {
	private cursor: RaceCursor = { zone: 'circuit', square: 1 };
	/** Last circuit square, restored when zone-hopping back to the ring. */
	private lastCircuitSquare = 1;
	private rendered = false;
	/** Optional callback to get animated piece positions (from tokenAnimator). */
	private displayPosition: ((seatIndex: number, pieceIndex: number) => any) | null = null;
	/** Direct manipulation: pending move options to highlight + clickable destinations. */
	private moveOptions: Array<{ cursor: RaceCursor; pieceIndex: number; label?: string }> | null = null;
	private onMoveSelected: ((pieceIndex: number) => void) | null = null;
	/** The option whose dialog button holds focus (its destination gets the strong ring). */
	private focusedOptionPiece: number | null = null;

	constructor(private readonly element: HTMLElement, private readonly deps: RaceBoardDeps) {}

	/** Set a callback to retrieve animated piece positions instead of using authoritative state. */
	setDisplayPositionCallback(cb: (seatIndex: number, pieceIndex: number) => any): void {
		this.displayPosition = cb;
	}

	/** Direct manipulation: set available move destinations and the callback when one is clicked.
	 *  Each option's `label` is the SAME text its dialog button reads ("Piece 2: advances to
	 *  square 7. Captures Berto's counter"), so a screen reader exploring the board — by touch
	 *  or with the arrows — hears the move, not just the cell's contents. */
	setMoveOptions(
		options: Array<{ cursor: RaceCursor; pieceIndex: number; label?: string }> | null,
		onSelect: ((pieceIndex: number) => void) | null,
	): void {
		this.moveOptions = options;
		this.onMoveSelected = onSelect;
		if (!options) this.focusedOptionPiece = null;
		this.updateHighlights();
	}

	/** Emphasizes ONE destination (the dialog option holding focus); null clears the emphasis. */
	setFocusedMoveOption(pieceIndex: number | null): void {
		this.focusedOptionPiece = pieceIndex;
		this.updateHighlights();
	}

	/** Build the static ring + seat zones once, then keep pieces in sync via update(). */
	update(gs: GameState): void {
		const board = gs.raceBoard;
		if (!board || !gs.race) return;
		if (!this.rendered) {
			this.renderStatic(board, gs);
			// Park the exploration cursor on MY start square, not an arbitrary "square 1":
			// it's the player's anchor on the ring (a first-time player took square 1 for
			// their entry point), and the first → press then walks their actual route.
			const start = this.mySeatDef(gs)?.startSquare;
			if (start) this.cursor = { zone: 'circuit', square: start };
		}
		this.renderDynamic(gs, board);
		this.applyCursor(false);
	}

	// ── navigation surface (same shape the keyboard layer drives on the property board) ──

	moveRight(): boolean { return this.moveCursor(c => cursorNext(this.board()!, c)); }
	moveLeft(): boolean { return this.moveCursor(c => cursorPrev(this.board()!, c)); }
	moveDown(): boolean { return this.moveCursor(c => cursorZone(this.board()!, c, 1, this.lastCircuitSquare, this.activeSeats())); }
	moveUp(): boolean { return this.moveCursor(c => cursorZone(this.board()!, c, -1, this.lastCircuitSquare, this.activeSeats())); }

	/** Board-seat indices taken by a player (vacant seats are dead geometry). */
	private activeSeats(): number[] {
		const gs = this.deps.getGameState();
		return gs?.raceBoard && gs.race ? activeSeatIndices(gs.raceBoard, gs.race) : [];
	}

	/** M / Shift+M cycle the exploration cursor through MY pieces, wherever they stand. */
	goToMe(forward = true): boolean {
		const gs = this.deps.getGameState();
		if (!gs) return false;
		return this.stepAmong(myPieceCursors(gs, this.deps.getMyPlayerId()), forward ? 1 : -1);
	}

	/** B / Shift+B cycle the circuit's BARRIERS (anyone's), in ring order: the walls
	 *  that shape everybody's route. Silent no-op when none stand. */
	goToBarrier(forward = true): boolean {
		const gs = this.deps.getGameState();
		if (!gs) return false;
		return this.stepAmong(barrierCursors(gs), forward ? 1 : -1);
	}

	/** Cycle to the next piece (mine or other players') on the board. */
	goToNextPiece(): boolean { return this.stepAmong(this.piecesCursors(), 1); }

	/** Cycle to the previous piece (mine or other players') on the board. */
	goToPrevPiece(): boolean { return this.stepAmong(this.piecesCursors(), -1); }

	private piecesCursors(): RaceCursor[] {
		const gs = this.deps.getGameState();
		return gs ? allPieceCursors(gs) : [];
	}

	/**
	 * Every "cycle" key (M, N, S…) walks its squares RELATIVE TO THE CURSOR — like the
	 * property board's occupied-square navigation — not via a stored counter: a counter
	 * re-announced the square the cursor already stood on, and its next/prev pointers
	 * disagreed by one (N, N, Shift+N landed you back on the same square). Off-cycle, the
	 * key enters at the first square (forward) or the last (backward).
	 */
	private stepAmong(cursors: RaceCursor[], dir: 1 | -1): boolean {
		if (cursors.length === 0) return false;
		const at = cursors.findIndex(c => cursorsEqual(c, this.cursor));
		const index = at >= 0
			? (at + dir + cursors.length) % cursors.length
			: dir === 1 ? 0 : cursors.length - 1;
		this.cursor = cursors[index];
		this.applyCursor(true);
		return true;
	}

	/** Home convention: the beginning of the CURRENT lane — square 1 on the circuit,
	 *  or the first cell (the home box) of the seat zone being explored. */
	goToStart(): boolean {
		if (!this.board()) return false;
		this.cursor = this.cursor.zone === 'circuit'
			? { zone: 'circuit', square: 1 }
			: { ...this.cursor, cell: HOME_CELL };
		this.applyCursor(true);
		return true;
	}

	/** S / Shift+S survey the circuit landmarks of EVERY seat in play — each squadron's
	 *  start square and corridor entry, in ring order — so one key walks the anchors of
	 *  the whole table's routes, not just mine (each cell voices WHOSE landmark it is).
	 *  Vacant seats are dead geometry and stay out of the cycle. */
	goToMyStart(forward = true): boolean {
		const gs = this.deps.getGameState();
		const board = gs?.raceBoard;
		if (!board || !gs?.race) return false;
		const active = new Set(this.activeSeats());
		const squares = [...new Set(board.seats
			.filter((_, i) => active.has(i))
			.flatMap(s => [s.startSquare, s.corridorEntry]))]
			.sort((a, b) => a - b);
		if (squares.length === 0) return false;
		const landmarks: RaceCursor[] = squares.map(square => ({ zone: 'circuit', square }));
		return this.stepAmong(landmarks, forward ? 1 : -1);
	}

	// BoardNavigator compatibility: the ordinal is the circuit square for ring cells
	// (property-family callers that read it get something stable and harmless).
	getActiveIndex(): number { return this.cursor.zone === 'circuit' ? this.cursor.square : -1; }
	setActiveIndex(index: number, _triggerEvents = true, announceMove = true): void {
		const board = this.board();
		if (!board || index < 1 || index > board.circuitLength) return;
		this.cursor = { zone: 'circuit', square: index };
		this.applyCursor(announceMove);
	}

	focus(): void { this.element.focus(); }

	/** Announce the current cursor position (e.g. on board focus). */
	announceCursor(): void {
		const text = this.describe(this.cursor);
		if (text) this.deps.announce(text);
	}

	// ── direct manipulation ──────────────────────────────────────────────────

	private updateHighlights(): void {
		// Clear all highlights — and the button semantics we granted along with them
		// (cells are normally aria-hidden: the announcer speaks, cells stay silent).
		this.element.querySelectorAll('.race-cell--highlight').forEach(el => {
			el.classList.remove('race-cell--highlight', 'race-cell--highlight-focus');
			el.removeAttribute('role');
			el.removeAttribute('aria-label');
			el.setAttribute('aria-hidden', 'true');
		});

		// Highlight destination squares. While an option is choosable its cell IS an
		// action: it leaves the aria-hidden curtain and gets role=button with the option's
		// text as its accessible name, so a touch screen reader exploring the board hears
		// the MOVE and can double-tap it.
		if (this.moveOptions) {
			for (const { cursor, pieceIndex, label } of this.moveOptions) {
				const cell = this.cellEl(cursor);
				if (!cell) continue;
				cell.classList.add('race-cell--highlight');
				if (pieceIndex === this.focusedOptionPiece) cell.classList.add('race-cell--highlight-focus');
				if (label) {
					cell.removeAttribute('aria-hidden');
					cell.setAttribute('role', 'button');
					cell.setAttribute('aria-label', label);
				}
			}
		}
	}

	private handleSquareClick(event: Event, cursor: RaceCursor): void {
		// During move selection, clicks ONLY select the destination.
		// If not selecting a move or not a valid destination, ignore completely.
		if (!this.moveOptions || !this.onMoveSelected) return;

		// Find the option that corresponds to this destination
		const option = this.moveOptions.find(
			opt => opt.cursor.zone === cursor.zone &&
				   (opt.cursor.zone === 'circuit'
					   ? (opt.cursor as any).square === (cursor as any).square
					   : (opt.cursor as any).seatIndex === (cursor as any).seatIndex &&
						 (opt.cursor as any).cell === (cursor as any).cell)
		);

		// If it's a valid move destination, select it (and stop all propagation).
		if (option) {
			event.preventDefault();
			event.stopPropagation();
			this.onMoveSelected(option.pieceIndex);
		}
		// If not a valid destination, also prevent propagation so no other handlers fire.
		// This keeps the board silent during selection.
		else if (this.moveOptions.length > 0) {
			event.preventDefault();
			event.stopPropagation();
		}
	}

	// ── internals ────────────────────────────────────────────────────────────

	private board(): RaceBoardDef | null { return this.deps.getGameState()?.raceBoard ?? null; }

	private mySeatDef(gs: GameState | null) {
		const myId = this.deps.getMyPlayerId();
		const seatId = gs?.race?.seats.find(s => s.playerId === myId)?.seatId;
		return gs?.raceBoard?.seats.find(s => s.id === seatId) ?? null;
	}

	private moveCursor(step: (c: RaceCursor) => RaceCursor): boolean {
		if (!this.board()) return false;
		this.cursor = step(this.cursor);
		this.applyCursor(true);
		return true;
	}

	private applyCursor(announce: boolean): void {
		// Remember the ring position however the cursor got there (arrows, goTo…, jumps),
		// so zone-hopping always returns to the player's place on the circuit.
		if (this.cursor.zone === 'circuit') this.lastCircuitSquare = this.cursor.square;
		this.element.querySelector('.race-cell.focused')?.classList.remove('focused');
		this.cellEl(this.cursor)?.classList.add('focused');
		if (announce) {
			const text = this.describe(this.cursor);
			if (text) this.deps.announce(text);
		}
	}

	private cellEl(cursor: RaceCursor): HTMLElement | null {
		return cursor.zone === 'circuit'
			? this.element.querySelector<HTMLElement>(`.race-cell[data-square="${cursor.square}"]`)
			: this.element.querySelector<HTMLElement>(`.race-cell[data-seat="${cursor.seatIndex}"][data-cell="${cursor.cell}"]`);
	}

	private describe(cursor: RaceCursor): string {
		const gs = this.deps.getGameState();
		if (!gs?.race || !gs.raceBoard) return '';
		const ctx: RaceDescribeContext = {
			board: gs.raceBoard,
			race: gs.race,
			playerName: id => gs.players.find(p => p.id === id)?.name ?? null,
			seatName: i => seatDisplayName(gs.raceBoard!, i, k => this.deps.tSync(k)),
			t: (key, vars) => t(this.deps, key, vars),
		};
		const base = describeCursor(cursor, ctx);
		// While a move choice is open, arrowing onto a destination also voices the MOVE it
		// offers, so the board exploration is a full alternative to the choice dialog.
		const option = this.moveOptions?.find(o => cursorsEqual(o.cursor, cursor));
		return option?.label ? `${base}. ${option.label}` : base;
	}

	/** The ring + the per-seat zones (home / corridor / goal). Structure only; no pieces.
	 *  Vacant seats (no player) render neither a zone strip nor a start-colour band. */
	private renderStatic(board: RaceBoardDef, gs: GameState): void {
		const occupied = new Set(gs.race!.seats.map(st => st.seatId));
		const positions = ringPositions(board.circuitLength);
		const cols = Math.max(...positions.map(p => p.col));
		const rows = Math.max(...positions.map(p => p.row));

		this.element.classList.add('race-board');
		this.element.setAttribute('role', 'application');
		this.element.setAttribute('aria-label', t(this.deps, 'race_board_label'));
		this.element.tabIndex = 0;
		this.element.style.setProperty('--race-cols', String(cols));
		this.element.style.setProperty('--race-rows', String(rows));
		this.element.innerHTML = '';

		positions.forEach((pos, i) => {
			const square = i + 1;
			const cell = document.createElement('div');
			cell.className = 'race-cell race-cell--circuit';
			cell.dataset.square = String(square);
			cell.style.gridColumn = String(pos.col);
			cell.style.gridRow = String(pos.row);
			if (board.safeSquares.includes(square)) cell.classList.add('race-cell--safe');
			const seatIdx = board.seats.findIndex(s => s.startSquare === square);
			if (seatIdx >= 0 && occupied.has(board.seats[seatIdx].id)) {
				cell.classList.add('race-cell--start');
				cell.style.setProperty('--seat-color', board.seats[seatIdx].color ?? '#888');
			}
			cell.setAttribute('aria-hidden', 'true'); // the announcer speaks; cells stay silent
			// Direct manipulation: make cells clickable when move options are available
			cell.addEventListener('click', (e) => this.handleSquareClick(e, { zone: 'circuit', square }));
			this.element.appendChild(cell);
		});

		// Seat zones live in the ring's hollow centre: one row per seat.
		const center = document.createElement('div');
		center.className = 'race-center';
		center.setAttribute('aria-hidden', 'true');
		center.style.gridColumn = `2 / ${cols}`;
		center.style.gridRow = `2 / ${rows}`;
		board.seats.forEach((seat, seatIndex) => {
			if (!occupied.has(seat.id)) return; // vacant squadron: no zone strip
			const zone = document.createElement('div');
			zone.className = 'race-zone';
			zone.style.setProperty('--seat-color', seat.color ?? '#888');

			const home = document.createElement('div');
			home.className = 'race-cell race-zone__home';
			home.dataset.seat = String(seatIndex);
			home.dataset.cell = String(HOME_CELL);
			home.addEventListener('click', (e) => this.handleSquareClick(e, { zone: 'seat', seatIndex, cell: HOME_CELL }));
			zone.appendChild(home);

			for (let c = 1; c <= board.corridorLength; c++) {
				const cc = document.createElement('div');
				cc.className = 'race-cell race-zone__corridor';
				cc.dataset.seat = String(seatIndex);
				cc.dataset.cell = String(c);
				cc.addEventListener('click', (e) => this.handleSquareClick(e, { zone: 'seat', seatIndex, cell: c }));
				zone.appendChild(cc);
			}

			const goal = document.createElement('div');
			goal.className = 'race-cell race-zone__goal';
			goal.dataset.seat = String(seatIndex);
			goal.dataset.cell = String(goalCell(board));
			goal.addEventListener('click', (e) => this.handleSquareClick(e, { zone: 'seat', seatIndex, cell: goalCell(board) }));
			zone.appendChild(goal);

			center.appendChild(zone);
		});
		this.element.appendChild(center);
		this.rendered = true;
	}

	/** Pieces + counts, rebuilt on every state update (cells themselves survive). */
	private renderDynamic(gs: GameState, board: RaceBoardDef): void {
		this.element.querySelectorAll('.race-piece, .race-count').forEach(n => n.remove());

		const seatColor = new Map(board.seats.map(s => [s.id, s.color ?? '#888']));
		for (const seat of gs.race!.seats) {
			const color = seatColor.get(seat.seatId) ?? '#888';
			const seatIndex = board.seats.findIndex(s => s.id === seat.seatId);

			const circuitCounts = new Map<number, number>();
			let home = 0, goal = 0;
			const corridor = new Map<number, number>();

			for (let pieceIndex = 0; pieceIndex < seat.pieces.length; pieceIndex++) {
				const piece = seat.pieces[pieceIndex];
				// Use animated position if available, otherwise use authoritative position
				const displayPos = this.displayPosition?.(seatIndex, pieceIndex) ?? piece;
				const location = displayPos.location ?? piece.location;
				const square = displayPos.square ?? piece.square;

				if (location === 'circuit') circuitCounts.set(square, (circuitCounts.get(square) ?? 0) + 1);
				else if (location === 'corridor') corridor.set(square, (corridor.get(square) ?? 0) + 1);
				else if (location === 'home') home++;
				else goal++;
			}

			for (const [square, count] of circuitCounts) {
				this.addPieces(this.cellEl({ zone: 'circuit', square }), color, count, seat.playerId);
			}
			for (const [cell, count] of corridor) {
				this.addPieces(this.cellEl({ zone: 'seat', seatIndex, cell }), color, count, seat.playerId);
			}
			this.addCount(this.cellEl({ zone: 'seat', seatIndex, cell: HOME_CELL }), home);
			this.addCount(this.cellEl({ zone: 'seat', seatIndex, cell: goalCell(board) }), goal);
		}
	}

	private addPieces(cell: HTMLElement | null, color: string, count: number, playerId: string): void {
		if (!cell) return;
		for (let i = 0; i < count; i++) {
			const dot = document.createElement('span');
			dot.className = 'race-piece' + (count >= 2 ? ' race-piece--barrier' : '');
			dot.dataset.playerId = playerId;
			dot.style.background = color;
			cell.appendChild(dot);
		}
	}

	private addCount(cell: HTMLElement | null, count: number): void {
		if (!cell) return;
		const el = document.createElement('span');
		el.className = 'race-count';
		el.textContent = String(count);
		cell.appendChild(el);
	}
}
