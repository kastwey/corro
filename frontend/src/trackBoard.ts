// trackBoard.ts — visual + keyboard component of a track (snakes-and-ladders style) board.
//
// The board is a single 1..N path folded into a serpentine grid (bottom-left start, each
// row reversing direction), plus a start tray (square 0) where pieces wait before entering.
// It implements the same navigation surface as the other boards (BoardNavigator) so the
// keyboard layer works unchanged: ←/→ walk the TRACK itself (always ±1 square, however the
// row folds), ↑/↓ jump ±gridWidth — the arithmetic neighbour, predictable without sight.
// Cells stay aria-hidden; the exploration cursor is visual (.focused) and voiced through
// the announcer, exactly like the property and race boards.
//
// The connectors (ladders up, snakes down — or whatever the package's effects are) are
// drawn on an SVG overlay generated here from the cells' real geometry, so the board
// itself remains plain CSS grid.

import type { GameState, TrackBoardDef, TrackEffectDef } from './models.js';
import { tokenIconHtml } from './tokenIcons.js';

export interface TrackBoardDeps {
	getGameState: () => GameState | null;
	getMyPlayerId: () => string | null;
	/** Instant cursor narration (interrupts, like the property board's square voice). */
	announce: (text: string) => void;
	/** Full-key translator (effect kind names are package keys). */
	tSync: (key: string, vars?: Record<string, unknown>) => string;
}

const t = (deps: TrackBoardDeps, key: string, vars?: Record<string, unknown>) =>
	deps.tSync(`game.${key}`, vars);

/** Grid geometry of a serpentine track: square 1 sits at the BOTTOM-LEFT and each row
 *  reverses direction (boustrophedon), the classic snakes-and-ladders fold. */
export function trackCellPosition(square: number, gridWidth: number, trackLength: number):
	{ col: number; row: number } {
	const rows = Math.ceil(trackLength / gridWidth);
	const rowFromBottom = Math.floor((square - 1) / gridWidth);
	const indexInRow = (square - 1) % gridWidth;
	const col0 = rowFromBottom % 2 === 0 ? indexInRow : gridWidth - 1 - indexInRow;
	return { col: col0 + 1, row: rows - rowFromBottom };
}

export class TrackBoard {
	/** Exploration cursor: 0 is the start tray (off board), 1..N the track squares. */
	private cursor = 0;
	private rendered = false;
	/** Optional callback to get animated piece positions (from the token animator). */
	private displayPosition: ((playerId: string) => number) | null = null;
	private resizeHandler: (() => void) | null = null;

	constructor(private readonly element: HTMLElement, private readonly deps: TrackBoardDeps) {}

	/** Set a callback to retrieve animated piece positions instead of authoritative state. */
	setDisplayPositionCallback(cb: (playerId: string) => number): void {
		this.displayPosition = cb;
	}

	/** Build the static grid + overlay once, then keep pieces in sync via update(). */
	update(gs: GameState): void {
		const board = gs.trackBoard;
		if (!board || !gs.track) return;
		if (!this.rendered) this.renderStatic(board);
		this.renderDynamic(gs);
		this.applyCursor(false);
	}

	// ── navigation surface (same shape the keyboard layer drives on the other boards) ──

	moveRight(): boolean { return this.moveTo(this.cursor + 1); }
	moveLeft(): boolean { return this.moveTo(this.cursor - 1); }
	/** ↑/↓ jump a whole row (±gridWidth): the arithmetic neighbour on the folded path. */
	moveUp(): boolean { return this.moveTo(this.cursor + (this.board()?.gridWidth ?? 0)); }
	moveDown(): boolean { return this.moveTo(this.cursor - (this.board()?.gridWidth ?? 0)); }

	/** M jumps to MY piece, wherever it stands (start tray included). */
	goToMe(_forward = true): boolean {
		const square = this.positionOf(this.deps.getMyPlayerId());
		if (square === null) return false;
		this.cursor = square;
		this.applyCursor(true);
		return true;
	}

	/** N / Shift+N cycle the squares holding pieces (any player), cursor-relative. */
	goToNextPiece(): boolean { return this.stepAmong(this.occupiedSquares(), 1); }
	goToPrevPiece(): boolean { return this.stepAmong(this.occupiedSquares(), -1); }

	/** Home convention: the beginning of the track (the start tray). */
	goToStart(): boolean {
		if (!this.board()) return false;
		this.cursor = 0;
		this.applyCursor(true);
		return true;
	}

	/** There are no per-player route landmarks on a single shared track: S goes to my piece. */
	goToMyStart(forward = true): boolean { return this.goToMe(forward); }

	// BoardNavigator compatibility: the track is 1-based as announced (digits type the
	// square number directly; 0 — the tray — is reachable with ← from square 1).
	getActiveIndex(): number { return this.cursor; }
	setActiveIndex(index: number, _triggerEvents = true, announceMove = true): void {
		const board = this.board();
		if (!board || index < 0 || index > board.trackLength) return;
		this.cursor = index;
		this.applyCursor(announceMove);
	}

	focus(): void { this.element.focus(); }

	/** Announce the current cursor position (e.g. on board focus). */
	announceCursor(): void {
		const text = this.describe(this.cursor);
		if (text) this.deps.announce(text);
	}

	// ── internals ────────────────────────────────────────────────────────────

	private board(): TrackBoardDef | null { return this.deps.getGameState()?.trackBoard ?? null; }

	private moveTo(square: number): boolean {
		const board = this.board();
		if (!board || square < 0 || square > board.trackLength) return false;
		this.cursor = square;
		this.applyCursor(true);
		return true;
	}

	/** Cursor-relative cycle (same contract as the race board's stepAmong): off-cycle the
	 *  key enters at the first square (forward) or the last (backward). */
	private stepAmong(squares: number[], dir: 1 | -1): boolean {
		if (squares.length === 0) return false;
		const at = squares.indexOf(this.cursor);
		const index = at >= 0
			? (at + dir + squares.length) % squares.length
			: dir === 1 ? 0 : squares.length - 1;
		this.cursor = squares[index];
		this.applyCursor(true);
		return true;
	}

	/** Squares holding at least one piece (display positions when animating), ascending. */
	private occupiedSquares(): number[] {
		const gs = this.deps.getGameState();
		if (!gs?.track) return [];
		const squares = new Set<number>();
		for (const pos of gs.track.positions) {
			squares.add(this.displayPosition?.(pos.playerId) ?? pos.square);
		}
		return [...squares].sort((a, b) => a - b);
	}

	private positionOf(playerId: string | null): number | null {
		const gs = this.deps.getGameState();
		const pos = gs?.track?.positions.find(p => p.playerId === playerId);
		if (!pos) return null;
		return this.displayPosition?.(pos.playerId) ?? pos.square;
	}

	private applyCursor(announce: boolean): void {
		this.element.querySelector('.track-cell.focused')?.classList.remove('focused');
		this.cellEl(this.cursor)?.classList.add('focused');
		if (announce) {
			const text = this.describe(this.cursor);
			if (text) this.deps.announce(text);
		}
	}

	private cellEl(square: number): HTMLElement | null {
		return this.element.querySelector<HTMLElement>(`.track-cell[data-square="${square}"]`);
	}

	/** "Square 12 of 100. Ladder: climbs to 38. Piece of Ana." — position, effect, occupants. */
	private describe(square: number): string {
		const gs = this.deps.getGameState();
		const board = gs?.trackBoard;
		if (!gs?.track || !board) return '';
		const parts: string[] = [];

		if (square === 0) {
			parts.push(t(this.deps, 'track_cell_tray'));
		} else {
			parts.push(t(this.deps, 'track_cell', { square, total: board.trackLength }));
			if (square === board.trackLength) parts.push(t(this.deps, 'track_cell_goal'));
		}

		const effect = board.effects.find(e => e.from === square);
		if (effect) {
			const dirText = effect.to > effect.from
				? t(this.deps, 'track_cell_up', { to: effect.to })
				: t(this.deps, 'track_cell_down', { to: effect.to });
			// The package may name the effect kind ("Escalera", "Serpiente"…); without a
			// name the direction line alone still tells the player everything that matters.
			const kindKey = `effects.${effect.kind}`;
			const kindName = this.deps.tSync(kindKey);
			parts.push(kindName !== kindKey ? `${kindName}: ${dirText}` : dirText);
		}

		for (const pos of gs.track.positions) {
			const at = this.displayPosition?.(pos.playerId) ?? pos.square;
			if (at !== square) continue;
			const name = gs.players.find(p => p.id === pos.playerId)?.name ?? pos.playerId;
			parts.push(t(this.deps, 'track_cell_piece_of', { player: name }));
		}
		return parts.join('. ');
	}

	/** The serpentine grid + start tray + SVG connector overlay. Structure only; no pieces. */
	private renderStatic(board: TrackBoardDef): void {
		const rows = Math.ceil(board.trackLength / board.gridWidth);

		this.element.classList.add('track-board');
		this.element.setAttribute('role', 'application');
		this.element.setAttribute('aria-label', t(this.deps, 'track_board_label'));
		this.element.tabIndex = 0;
		this.element.style.setProperty('--track-cols', String(board.gridWidth));
		this.element.style.setProperty('--track-rows', String(rows + 1)); // +1: the tray row
		this.element.innerHTML = '';

		// Start tray (square 0): pieces wait here before their first roll. It sits on its
		// own row under the grid, aligned with the track's first square.
		const tray = document.createElement('div');
		tray.className = 'track-cell track-cell--tray';
		tray.dataset.square = '0';
		tray.style.gridColumn = `1 / ${board.gridWidth + 1}`;
		tray.style.gridRow = String(rows + 1);
		tray.setAttribute('aria-hidden', 'true');
		this.element.appendChild(tray);

		for (let square = 1; square <= board.trackLength; square++) {
			const pos = trackCellPosition(square, board.gridWidth, board.trackLength);
			const cell = document.createElement('div');
			cell.className = 'track-cell';
			cell.dataset.square = String(square);
			cell.style.gridColumn = String(pos.col);
			cell.style.gridRow = String(pos.row);
			const effect = board.effects.find(e => e.from === square);
			if (effect) {
				cell.classList.add(effect.to > effect.from ? 'track-cell--up' : 'track-cell--down');
			}
			if (square === board.trackLength) {
				cell.classList.add('track-cell--goal');
				const flag = document.createElement('span');
				flag.className = 'track-cell__flag';
				flag.textContent = '🏁';
				cell.appendChild(flag);
			}
			const num = document.createElement('span');
			num.className = 'track-cell__num';
			num.textContent = String(square);
			cell.appendChild(num);
			cell.setAttribute('aria-hidden', 'true'); // the announcer speaks; cells stay silent
			this.element.appendChild(cell);
		}

		// The connector overlay spans the whole board; its content is drawn from the cells'
		// laid-out geometry, so it (re)draws after layout and on resize.
		const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		overlay.setAttribute('class', 'track-overlay');
		overlay.setAttribute('aria-hidden', 'true');
		this.element.appendChild(overlay);
		 // Absent in jsdom; drawOverlay would abort on the zero-sized layout there anyway.
		const raf: ((cb: () => void) => void) | undefined = (globalThis as any).requestAnimationFrame;
		if (raf) raf(() => this.drawOverlay());
		this.resizeHandler = () => this.drawOverlay();
		window.addEventListener('resize', this.resizeHandler);

		this.rendered = true;
	}

	/** Draw every effect connector from the real cell geometry. Ladders are two rails with
	 *  rungs; snakes an S-curved body with a head at the mouth (the `from` square); any
	 *  other kind falls back to a plain line. Skipped when the board has no layout yet. */
	private drawOverlay(): void {
		const board = this.board();
		const overlay = this.element.querySelector<SVGSVGElement>('.track-overlay');
		if (!board || !overlay) return;
		const bounds = this.element.getBoundingClientRect();
		if (bounds.width === 0 || bounds.height === 0) return; // not laid out (or jsdom)

		overlay.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
		overlay.innerHTML = '';
		const center = (square: number): { x: number; y: number } | null => {
			const cell = this.cellEl(square);
			if (!cell) return null;
			const r = cell.getBoundingClientRect();
			return { x: r.left - bounds.left + r.width / 2, y: r.top - bounds.top + r.height / 2 };
		};

		for (const effect of board.effects) {
			const a = center(effect.from);
			const b = center(effect.to);
			if (!a || !b) continue;
			const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
			group.setAttribute('class', `track-connector track-connector--${effect.kind}`);
			group.setAttribute('data-from', String(effect.from));
			group.setAttribute('data-to', String(effect.to));
			if (effect.kind === 'ladder') this.drawLadder(group, a, b);
			else if (effect.kind === 'snake') this.drawSnake(group, a, b);
			else this.drawPlainConnector(group, a, b, effect);
			overlay.appendChild(group);
		}
	}

	private drawLadder(group: SVGGElement, a: { x: number; y: number }, b: { x: number; y: number }): void {
		const dx = b.x - a.x, dy = b.y - a.y;
		const len = Math.hypot(dx, dy) || 1;
		// Perpendicular unit vector: offsets the two rails either side of the centre line.
		const px = -dy / len, py = dx / len;
		const rail = 7;
		for (const side of [-1, 1]) {
			const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
			line.setAttribute('x1', String(a.x + px * rail * side));
			line.setAttribute('y1', String(a.y + py * rail * side));
			line.setAttribute('x2', String(b.x + px * rail * side));
			line.setAttribute('y2', String(b.y + py * rail * side));
			line.setAttribute('class', 'track-ladder__rail');
			group.appendChild(line);
		}
		const rungs = Math.max(2, Math.floor(len / 26));
		for (let i = 1; i < rungs; i++) {
			const f = i / rungs;
			const cx = a.x + dx * f, cy = a.y + dy * f;
			const rung = document.createElementNS('http://www.w3.org/2000/svg', 'line');
			rung.setAttribute('x1', String(cx + px * rail));
			rung.setAttribute('y1', String(cy + py * rail));
			rung.setAttribute('x2', String(cx - px * rail));
			rung.setAttribute('y2', String(cy - py * rail));
			rung.setAttribute('class', 'track-ladder__rung');
			group.appendChild(rung);
		}
	}

	private drawSnake(group: SVGGElement, a: { x: number; y: number }, b: { x: number; y: number }): void {
		// The head is at the MOUTH (the `from` square, where you are swallowed); the body
		// S-curves down to the tail. Two mirrored control points give the wiggle.
		const dx = b.x - a.x, dy = b.y - a.y;
		const len = Math.hypot(dx, dy) || 1;
		const px = -dy / len, py = dx / len;
		const wiggle = Math.min(34, len / 4);
		const c1x = a.x + dx / 3 + px * wiggle, c1y = a.y + dy / 3 + py * wiggle;
		const c2x = a.x + 2 * dx / 3 - px * wiggle, c2y = a.y + 2 * dy / 3 - py * wiggle;
		const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
		path.setAttribute('d', `M ${a.x} ${a.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${b.x} ${b.y}`);
		path.setAttribute('class', 'track-snake__body');
		group.appendChild(path);
		const head = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
		head.setAttribute('cx', String(a.x));
		head.setAttribute('cy', String(a.y));
		head.setAttribute('r', '7');
		head.setAttribute('class', 'track-snake__head');
		group.appendChild(head);
	}

	private drawPlainConnector(group: SVGGElement, a: { x: number; y: number }, b: { x: number; y: number }, effect: TrackEffectDef): void {
		const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
		line.setAttribute('x1', String(a.x));
		line.setAttribute('y1', String(a.y));
		line.setAttribute('x2', String(b.x));
		line.setAttribute('y2', String(b.y));
		line.setAttribute('class', effect.to > effect.from ? 'track-plain--up' : 'track-plain--down');
		group.appendChild(line);
	}

	/** Pieces, rebuilt on every state update (cells themselves survive). */
	private renderDynamic(gs: GameState): void {
		this.element.querySelectorAll('.track-piece').forEach(n => n.remove());
		const counts = new Map<number, number>(); // stagger stacked pieces on a square
		for (const pos of gs.track!.positions) {
			const square = this.displayPosition?.(pos.playerId) ?? pos.square;
			const cell = this.cellEl(square);
			if (!cell) continue;
			const player = gs.players.find(p => p.id === pos.playerId);
			const piece = document.createElement('span');
			piece.className = 'track-piece';
			piece.dataset.playerId = pos.playerId;
			piece.style.background = player?.color ?? '#888'; // the chip holds the player's colour…
			piece.innerHTML = tokenIconHtml(player?.token ?? '', 'track-piece__icon'); // …and their token
			const nth = counts.get(square) ?? 0;
			counts.set(square, nth + 1);
			piece.style.setProperty('--stack-index', String(nth));
			cell.appendChild(piece);
		}
	}
}
