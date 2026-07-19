// triviaBoard.ts — visual + keyboard component of a trivia (Trivial Pursuit style) WHEEL.
//
// The board is a graph: a centre hub, six spokes of interior squares, and one outer ring
// whose six wedge slots (category headquarters) are the spoke ends. It implements the same
// BoardNavigator surface as the other boards, but with a RADIAL invariant that reads without
// sight: ↑ always moves toward the centre, ↓ always away toward the ring, ←/→ turn (they
// cycle the spokes at the centre and walk the ring outside). On top of the arrows, a
// board-level key listener adds E (jump to the centre) and the colour letters
// B/P/Y/R/G/O (jump to a category's headquarters). Cells stay aria-hidden; the exploration
// cursor is visual (.focused) and voiced through the announcer.
//
// Node ids mirror the server: "C" = centre; "S{i}.{j}" = spoke i (0..5) interior square j
// (1..spokeLength, from the centre out); "R{k}" = ring slot k.

import type { GameState, TriviaBoardDef } from './models.js';
import { tokenIconHtml } from './tokenIcons.js';

export interface TriviaBoardDeps {
	getGameState: () => GameState | null;
	getMyPlayerId: () => string | null;
	announce: (text: string) => void;
	tSync: (key: string, vars?: Record<string, unknown>) => string;
}

const CATS = 6;
/** Colour letter (English initial) → category index. Brown takes R since there is no red. */
const KEY_TO_CATEGORY: Record<string, number> = { b: 0, p: 1, y: 2, r: 3, g: 4, o: 5 };

/** The six category colours, index → hex, matching the CSS .trivia-cat-N and the colour-letter
 *  jumps (0 blue, 1 pink, 2 yellow, 3 brown, 4 green, 5 orange). Used to paint the wheel's pie
 *  sectors and each player's wedge token. */
const CAT_HEX = ['#2f6fb0', '#d24d86', '#d8b42e', '#8d6e63', '#2f9e5f', '#d97a2b'];

const t = (deps: TriviaBoardDeps, key: string, vars?: Record<string, unknown>) =>
	deps.tSync(`game.${key}`, vars);

/** The i18n key for a category's (themeable) name — letter-suffixed a..f, matching the server. */
const catKey = (category: number) => `game.trivia_cat_${String.fromCharCode(97 + category)}`;

/** The i18n key for a category's fixed colour NAME (blue/pink/…). The colour is engine-level
 *  (index → colour, same as the CSS and the colour-jump letters), so it is not themed. */
const colorKey = (category: number) => `game.trivia_color_${String.fromCharCode(97 + category)}`;

// A wheel is a clock, so node directions carry spatial meaning a blind player can build a map
// from. Angle -90° is 12 o'clock (top) and increases clockwise, matching layoutWheel.
function ringAngle(k: number, n: number): number { return -90 + (k / n) * 360; }
function spokeAngle(spoke: number): number { return -90 + spoke * 60; }
/** The clock hour a direction points at (12, 1…). The six radios fall on 12/2/4/6/8/10. */
function clockHour(angleDeg: number): number {
	const a = (((angleDeg + 90) % 360) + 360) % 360;
	const h = Math.round(a / 30) % 12;
	return h === 0 ? 12 : h;
}
/** One of eight spatial regions (octants), for positions BETWEEN the exact hours. */
const REGION_KEYS = ['top', 'topright', 'right', 'bottomright', 'bottom', 'bottomleft', 'left', 'topleft'];
function octant(angleDeg: number): number {
	const a = (((angleDeg + 90) % 360) + 360) % 360;
	return Math.floor((a + 22.5) / 45) % 8;
}

interface WheelNode {
	id: string;
	kind: 'center' | 'spoke' | 'ring';
	x: number; // percent
	y: number; // percent
	category: number; // -1 for the centre
	wedge: boolean;
	rollAgain: boolean;
	ring?: number; // 1-based ring position, ring nodes only
	steps?: number; // distance from the centre, spoke nodes only
}

export class TriviaBoard {
	private cursor = 'C';
	/** Which spoke the centre currently points at (←/→ cycle it; ↓ enters it). */
	private centerSpoke = 0;
	/** The circle region last announced while walking the ring, so it is only re-stated when it
	 *  changes (null off the ring or after a jump, so it re-announces). */
	private lastRegion: number | null = null;
	/** The legal landings for the current roll: highlighted on the board; 'd' cycles them and
	 *  Enter picks the one under the cursor. Empty when there is no move to make. */
	private moveOptions: string[] = [];
	private onPickOption: ((node: string) => void) | null = null;
	private rendered = false;
	private nodes: WheelNode[] = [];
	private keyListener: ((ev: KeyboardEvent) => void) | null = null;
	/** Persistent piece elements, keyed by playerId, so a move CSS-glides between nodes instead
	 *  of the piece being torn down and rebuilt at the destination (a teleport). */
	private pieceEls = new Map<string, HTMLElement>();
	/** The animator's node for a piece (where to DRAW it, mid-walk); null → its authoritative node. */
	private displayPositionCb: ((playerId: string) => string | null) | null = null;

	constructor(private readonly element: HTMLElement, private readonly deps: TriviaBoardDeps) {}

	/** The animator supplies the node to draw each piece on while it walks; without it the piece
	 *  sits on its authoritative node. */
	setDisplayPositionCallback(cb: (playerId: string) => string | null): void { this.displayPositionCb = cb; }

	update(gs: GameState): void {
		const board = gs.triviaBoard;
		if (!board || !gs.trivia) return;
		if (!this.rendered) this.renderStatic(board);
		this.renderDynamic(gs);
		this.applyCursor(false);
	}

	// ── navigation surface (radial invariant) ──────────────────────────────────

	moveUp(): boolean {
		const board = this.board();
		if (!board) return false;
		if (this.cursor === 'C') return false;
		if (this.cursor[0] === 'S') {
			const { spoke, index } = parseSpoke(this.cursor);
			if (index === 1) { this.centerSpoke = spoke; return this.setCursor('C'); }
			return this.setCursor(`S${spoke}.${index - 1}`);
		}
		// ring: only a wedge junction leads inward, onto its spoke's outer square.
		const k = parseRing(this.cursor);
		if (!board.ring[k]?.wedge) return false;
		const spoke = this.wedgeIndices(board).indexOf(k);
		if (spoke < 0) return false;
		return this.setCursor(`S${spoke}.${board.spokeLength}`);
	}

	moveDown(): boolean {
		const board = this.board();
		if (!board) return false;
		if (this.cursor === 'C') return this.setCursor(`S${this.centerSpoke}.1`);
		if (this.cursor[0] === 'S') {
			const { spoke, index } = parseSpoke(this.cursor);
			if (index === board.spokeLength) return this.setCursor(`R${this.wedgeIndices(board)[spoke]}`);
			return this.setCursor(`S${spoke}.${index + 1}`);
		}
		return false; // the ring is the outermost track
	}

	moveLeft(): boolean { return this.turn(-1); }
	moveRight(): boolean { return this.turn(1); }

	private turn(dir: 1 | -1): boolean {
		const board = this.board();
		if (!board) return false;
		if (this.cursor === 'C') {
			// At the centre, ←/→ pick which spoke ↓ will enter — announce it by name so the
			// "choose a radio" step is audible.
			this.centerSpoke = (this.centerSpoke + dir + CATS) % CATS;
			this.deps.announce(t(this.deps, 'trivia_center_spoke', {
				cat: catKey(spokeDestCategory(board, this.centerSpoke)),
				hour: clockHour(spokeAngle(this.centerSpoke)),
			}));
			return true;
		}
		if (this.cursor[0] === 'R') {
			const n = board.ring.length;
			const k = parseRing(this.cursor);
			return this.setCursor(`R${(k + dir + n) % n}`);
		}
		return false; // spoke interiors do not turn
	}

	/** M jumps to MY piece. */
	goToMe(_forward = true): boolean {
		const node = this.nodeOf(this.deps.getMyPlayerId());
		if (!node) return false;
		this.lastRegion = null; // a jump: re-announce the region on arrival
		return this.setCursor(node);
	}

	/** N / Shift+N cycle the squares holding pieces (any player), cursor-relative. */
	goToNextPiece(): boolean { return this.stepAmong(this.occupiedNodes(), 1); }
	goToPrevPiece(): boolean { return this.stepAmong(this.occupiedNodes(), -1); }

	/** Home: the centre (start and finish). */
	goToStart(): boolean { return this.setCursor('C'); }
	goToMyStart(forward = true): boolean { return this.goToMe(forward); }

	// BoardNavigator numeric compatibility: index into the node list.
	getActiveIndex(): number { return this.nodes.findIndex(n => n.id === this.cursor); }
	setActiveIndex(index: number, _triggerEvents = true, announceMove = true): void {
		const node = this.nodes[index];
		if (!node) return;
		this.lastRegion = null;
		this.cursor = node.id;
		this.applyCursor(announceMove);
	}

	focus(): void { this.element.focus(); }

	/** Jump the cursor onto a specific node (used by "go to player"). */
	focusNode(node: string): void { this.lastRegion = null; this.cursor = node; this.applyCursor(true); }

	/** Offer the roll's legal landings for direct board selection: highlight them and set the
	 *  callback fired when the player picks one (Enter on a highlighted square; 'd' cycles them).
	 *  Pass null to clear. Mirrors the race board's setMoveOptions. */
	setMoveOptions(options: string[] | null, onPick: ((node: string) => void) | null): void {
		// Clear the previous options' highlight AND the button semantics we granted them (cells are
		// normally aria-hidden: the announcer speaks, cells stay silent).
		this.element.querySelectorAll('.trivia-cell--option').forEach(c => {
			c.classList.remove('trivia-cell--option');
			c.removeAttribute('role');
			c.removeAttribute('aria-label');
			c.setAttribute('aria-hidden', 'true');
		});
		this.moveOptions = options ?? [];
		this.onPickOption = onPick;
		const board = this.board();
		// While an option is choosable, its cell IS an action: it leaves the aria-hidden curtain
		// and becomes a labelled button, so a mouse click (or a touch screen reader) can pick it —
		// the same target the keyboard reaches with 'd'/Enter and the non-modal dialog lists.
		for (const node of this.moveOptions) {
			const cell = this.cellEl(node);
			if (!cell) continue;
			cell.classList.add('trivia-cell--option');
			if (board) {
				cell.removeAttribute('aria-hidden');
				cell.setAttribute('role', 'button');
				cell.setAttribute('aria-label', this.optionLabel(board, node));
			}
		}
	}

	/** The same text the destination dialog button reads: identity + clock/region anchor. */
	private optionLabel(board: TriviaBoardDef, node: string): string {
		const base = triviaNodeLabel(board, node, this.deps.tSync);
		const pos = triviaPositionSuffix(board, node, this.deps.tSync);
		return pos ? `${base}, ${pos}` : base;
	}

	/** A click on a highlighted landing selects it (mouse/touch equivalent of Enter on it). */
	private handleCellClick(ev: Event): void {
		if (this.moveOptions.length === 0) return;
		const cell = (ev.target as HTMLElement | null)?.closest<HTMLElement>('.trivia-cell[data-node]');
		const node = cell?.dataset.node;
		if (!node || !this.moveOptions.includes(node)) return;
		ev.preventDefault();
		ev.stopPropagation();
		this.cursor = node;
		this.lastRegion = null;
		this.moveHighlight();
		this.onPickOption?.(node);
	}

	announceCursor(): void {
		const text = this.describe(this.cursor);
		if (text) this.deps.announce(text);
	}

	/** E jumps to the centre. */
	private jumpToCenter(): boolean { return this.setCursor('C'); }

	/** A colour letter visits every square of its category — first the headquarters, then the
	 *  rest swept clockwise. Repeats advance through them (Shift reverses), like a screen-reader
	 *  rotor, so a player can survey where a category lives on the wheel without walking it all. */
	private jumpToCategory(category: number, dir = 1): boolean {
		const nodes = this.categoryNodes(category);
		if (!nodes.length) return false;
		const i = nodes.indexOf(this.cursor);
		const next = i < 0 ? nodes[0] : nodes[(i + dir + nodes.length) % nodes.length];
		return this.setCursor(next);
	}

	/** Every square of a category, headquarters first, then the others swept clockwise from
	 *  12 o'clock — so pressing the colour repeatedly reads as a lap of the wheel. */
	private categoryNodes(category: number): string[] {
		const clockwise = (n: WheelNode) => (Math.atan2(n.y - 50, n.x - 50) * 180 / Math.PI + 450) % 360;
		return this.nodes
			.filter(n => n.category === category)
			.sort((a, b) => (a.wedge === b.wedge ? clockwise(a) - clockwise(b) : a.wedge ? -1 : 1))
			.map(n => n.id);
	}

	// ── internals ──────────────────────────────────────────────────────────────

	private board(): TriviaBoardDef | null { return this.deps.getGameState()?.triviaBoard ?? null; }

	private wedgeIndices(board: TriviaBoardDef): number[] {
		const out: number[] = [];
		board.ring.forEach((slot, k) => { if (slot.wedge) out.push(k); });
		return out;
	}

	private setCursor(node: string): boolean {
		this.cursor = node;
		this.applyCursor(true);
		return true;
	}

	private stepAmong(nodeIds: string[], dir: 1 | -1): boolean {
		if (nodeIds.length === 0) return false;
		const at = nodeIds.indexOf(this.cursor);
		const index = at >= 0
			? (at + dir + nodeIds.length) % nodeIds.length
			: dir === 1 ? 0 : nodeIds.length - 1;
		this.lastRegion = null;
		return this.setCursor(nodeIds[index]);
	}

	/** 'd' / Shift+D: move the cursor to the next legal landing, spoken as its full destination
	 *  label (identity + clock/region), so the player feels where each option is on the board. */
	private cycleOptions(dir: 1 | -1): void {
		if (this.moveOptions.length === 0) return;
		const at = this.moveOptions.indexOf(this.cursor);
		const idx = at >= 0
			? (at + dir + this.moveOptions.length) % this.moveOptions.length
			: dir === 1 ? 0 : this.moveOptions.length - 1;
		this.cursor = this.moveOptions[idx];
		this.lastRegion = null;
		this.moveHighlight();
		const board = this.board();
		if (!board) return;
		const base = triviaNodeLabel(board, this.cursor, this.deps.tSync);
		const pos = triviaPositionSuffix(board, this.cursor, this.deps.tSync);
		this.deps.announce(pos ? `${base}, ${pos}` : base);
	}

	private occupiedNodes(): string[] {
		const gs = this.deps.getGameState();
		if (!gs?.trivia) return [];
		const set = new Set(gs.trivia.players.filter(p => !p.retired).map(p => p.node));
		// Order by their position in the node list, so cycling walks the wheel predictably.
		return this.nodes.map(n => n.id).filter(id => set.has(id));
	}

	private nodeOf(playerId: string | null): string | null {
		const gs = this.deps.getGameState();
		return gs?.trivia?.players.find(p => p.playerId === playerId)?.node ?? null;
	}

	private moveHighlight(): void {
		this.element.querySelector('.trivia-cell.focused')?.classList.remove('focused');
		this.cellEl(this.cursor)?.classList.add('focused');
	}

	private applyCursor(announce: boolean): void {
		this.moveHighlight();
		if (announce) {
			const text = this.describe(this.cursor);
			if (text) this.deps.announce(text);
		}
	}

	private cellEl(node: string): HTMLElement | null {
		return this.element.querySelector<HTMLElement>(`.trivia-cell[data-node="${cssEscape(node)}"]`);
	}

	/** "Geography headquarters, ring position 1. Ana's piece." — position, kind, occupants. */
	private describe(nodeId: string): string {
		const gs = this.deps.getGameState();
		const board = gs?.triviaBoard;
		if (!gs?.trivia || !board) return '';
		const parts = [triviaNodeLabel(board, nodeId, this.deps.tSync)];

		// Spatial anchor: name the region of the circle you are in, but only when it CHANGES
		// while walking the ring (a wedge already gives its exact clock hour, so it skips the
		// region). Off the ring, forget it so re-entering re-announces.
		if (nodeId[0] === 'R') {
			const k = parseRing(nodeId);
			const oct = octant(ringAngle(k, board.ring.length));
			const changed = oct !== this.lastRegion;
			this.lastRegion = oct;
			if (changed && !board.ring[k].wedge) parts.push(t(this.deps, `trivia_region_${REGION_KEYS[oct]}`));
		} else {
			this.lastRegion = null;
		}

		for (const p of gs.trivia.players) {
			if (p.node !== nodeId || p.retired) continue;
			const name = gs.players.find(pl => pl.id === p.playerId)?.name ?? p.playerId;
			parts.push(t(this.deps, 'trivia_cell_piece_of', { player: name }));
		}
		return parts.join('. ');
	}

	/** L: say the current position ON THE CIRCLE — a clock hour on a radio or a junction, the
	 *  region between hours, or simply "centre". An on-demand spatial "where am I?". */
	positionAnnouncement(): void {
		const board = this.board();
		if (!board) return;
		const node = this.cursor;
		let text = '';
		if (node === 'C') {
			text = t(this.deps, 'trivia_pos_center');
		} else if (node[0] === 'S') {
			const { spoke, index } = parseSpoke(node);
			text = t(this.deps, 'trivia_pos_spoke', {
				dest: catKey(spokeDestCategory(board, spoke)),
				hour: clockHour(spokeAngle(spoke)),
				steps: index,
			});
		} else {
			const k = parseRing(node);
			text = board.ring[k]?.wedge
				? t(this.deps, 'trivia_pos_wedge', { hour: clockHour(ringAngle(k, board.ring.length)) })
				: t(this.deps, `trivia_region_${REGION_KEYS[octant(ringAngle(k, board.ring.length))]}`);
		}
		if (text) this.deps.announce(text);
	}

	/** S: your own wedges (how many, which categories). */
	private announceMyWedges(): void {
		const gs = this.deps.getGameState();
		const me = gs?.trivia?.players.find(p => p.playerId === this.deps.getMyPlayerId());
		if (!me) return;
		this.deps.announce(me.wedges.length
			? t(this.deps, 'trivia_wedges_self', { count: me.wedges.length, cats: this.wedgeCats(me.wedges) })
			: t(this.deps, 'trivia_wedges_self_none'));
	}

	/** Shift+S: every rival's wedges. */
	private announceRivalWedges(): void {
		const gs = this.deps.getGameState();
		if (!gs?.trivia) return;
		const myId = this.deps.getMyPlayerId();
		const lines = gs.trivia.players
			.filter(p => p.playerId !== myId && !p.retired)
			.map(p => {
				const name = gs.players.find(pl => pl.id === p.playerId)?.name ?? p.playerId;
				return p.wedges.length
					? t(this.deps, 'trivia_wedges_of', { player: name, count: p.wedges.length, cats: this.wedgeCats(p.wedges) })
					: t(this.deps, 'trivia_wedges_of_none', { player: name });
			});
		if (lines.length) this.deps.announce(lines.join('. '));
	}

	private wedgeCats(wedges: number[]): string {
		return wedges.map(c => this.deps.tSync(catKey(c))).join(', ');
	}

	/** Build the wheel nodes (with polar positions) and the DOM cells. Structure only. */
	private renderStatic(board: TriviaBoardDef): void {
		this.nodes = layoutWheel(board);

		this.element.classList.add('trivia-board');
		this.element.setAttribute('role', 'application');
		this.element.setAttribute('aria-label', t(this.deps, 'trivia_board_label'));
		this.element.tabIndex = 0;
		this.element.style.removeProperty('display');
		this.element.style.removeProperty('grid-template-columns');
		this.element.style.removeProperty('grid-auto-rows');
		this.element.innerHTML = '';

		// The decorative wheel (spokes + ring + colour sectors) goes in first, so the cells and
		// pieces paint on top of it. Sighted players see a Trivial-style wheel with visible spokes.
		this.element.insertAdjacentHTML('beforeend', wheelBackgroundSvg(board));

		for (const node of this.nodes) {
			const cell = document.createElement('div');
			cell.className = `trivia-cell trivia-cell--${node.kind}`;
			if (node.wedge) cell.classList.add('trivia-cell--wedge');
			if (node.rollAgain) cell.classList.add('trivia-cell--roll-again');
			if (node.category >= 0) cell.classList.add(`trivia-cat-${node.category}`);
			cell.dataset.node = node.id;
			cell.style.left = `${node.x}%`;
			cell.style.top = `${node.y}%`;
			cell.setAttribute('aria-hidden', 'true');
			this.element.appendChild(cell);
		}

		// Wheel-specific keys that can't live in keymap.json (single letters collide across
		// families there): E → centre, and the colour letters → each headquarters.
		this.keyListener = (ev: KeyboardEvent) => {
			if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
			const key = ev.key.toLowerCase();
			if (key === 'e') { ev.preventDefault(); ev.stopPropagation(); this.jumpToCenter(); }
			else if (key === 'l') { ev.preventDefault(); ev.stopPropagation(); this.positionAnnouncement(); }
			else if (key === 's') { ev.preventDefault(); ev.stopPropagation(); if (ev.shiftKey) this.announceRivalWedges(); else this.announceMyWedges(); }
			else if (key === 'd' && this.moveOptions.length) { ev.preventDefault(); ev.stopPropagation(); this.cycleOptions(ev.shiftKey ? -1 : 1); }
			else if (key === 'enter' && this.moveOptions.length) {
				ev.preventDefault(); ev.stopPropagation();
				if (this.moveOptions.includes(this.cursor)) this.onPickOption?.(this.cursor);
			}
			else if (key in KEY_TO_CATEGORY) { ev.preventDefault(); ev.stopPropagation(); this.jumpToCategory(KEY_TO_CATEGORY[key], ev.shiftKey ? -1 : 1); }
		};
		this.element.addEventListener('keydown', this.keyListener);
		this.element.addEventListener('click', (ev) => this.handleCellClick(ev));

		this.rendered = true;
	}

	/** Pieces (the wheel + cells are static). Each piece is a board-level overlay at its DISPLAY
	 *  node — the animator's node while it walks — so its size is independent of the (tiny) cell
	 *  and a move CSS-glides between nodes. Elements persist across renders (keyed by playerId) so
	 *  moving one only updates its position; pieces sharing a node fan out so all stay visible. */
	private renderDynamic(gs: GameState): void {
		const byNode = new Map<string, { playerId: string; color?: string; token: string; wedges: number[] }[]>();
		for (const p of gs.trivia!.players) {
			if (p.retired) continue;
			const player = gs.players.find(pl => pl.id === p.playerId);
			const node = this.displayPositionCb?.(p.playerId) ?? p.node;
			const list = byNode.get(node) ?? [];
			list.push({ playerId: p.playerId, color: player?.color, token: player?.token ?? '', wedges: p.wedges });
			byNode.set(node, list);
		}

		const active = new Set<string>();
		for (const [nodeId, list] of byNode) {
			const node = this.nodes.find(n => n.id === nodeId);
			if (!node) continue;
			list.forEach((pl, k) => {
				active.add(pl.playerId);
				let piece = this.pieceEls.get(pl.playerId);
				if (!piece) {
					piece = buildPiece(pl);
					this.pieceEls.set(pl.playerId, piece);
					this.element.appendChild(piece);
				}
				// Refresh the quesito holder (wedges grow over the game); the icon/colour are fixed.
				const holder = piece.querySelector<HTMLElement>('.trivia-piece__holder');
				if (holder) holder.style.background = wedgeTokenGradient(pl.wedges);
				const [dx, dy] = clusterOffset(k, list.length);
				piece.style.left = `${node.x}%`;
				piece.style.top = `${node.y}%`;
				piece.style.setProperty('--dx', dx.toFixed(3));
				piece.style.setProperty('--dy', dy.toFixed(3));
			});
		}
		for (const [playerId, piece] of [...this.pieceEls]) {
			if (!active.has(playerId)) { piece.remove(); this.pieceEls.delete(playerId); }
		}
	}
}

/** A player's board piece: the themed token icon on a disc in the player's colour, wrapped by the
 *  quesito holder — a segmented ring whose slices fill in as wedges are earned (Trivial-style). */
function buildPiece(pl: { playerId: string; color?: string; token: string; wedges: number[] }): HTMLElement {
	const piece = document.createElement('span');
	piece.className = 'trivia-piece';
	piece.dataset.playerId = pl.playerId;
	piece.setAttribute('aria-hidden', 'true'); // decorative; the announcer names who stands where

	const holder = document.createElement('span');
	holder.className = 'trivia-piece__holder';
	holder.style.background = wedgeTokenGradient(pl.wedges);

	const chip = document.createElement('span');
	chip.className = 'trivia-piece__chip';
	chip.style.background = pl.color ?? '#607d8b';
	chip.innerHTML = tokenIconHtml(pl.token, 'trivia-piece__icon');

	piece.append(holder, chip);
	return piece;
}

/** A small fan of unit offsets (in piece-widths) so co-located pieces don't hide each other: one
 *  piece sits centred; several spread evenly round a small circle. */
function clusterOffset(k: number, n: number): [number, number] {
	if (n <= 1) return [0, 0];
	const angle = (k / n) * 2 * Math.PI - Math.PI / 2;
	const radius = 0.62;
	return [Math.cos(angle) * radius, Math.sin(angle) * radius];
}

/** A node's spoken label (position + kind), shared by the board's cursor narration and the
 *  destination picker in app.ts. Occupants are appended by the board only. */
export function triviaNodeLabel(
	board: TriviaBoardDef,
	node: string,
	tSync: (key: string, vars?: Record<string, unknown>) => string,
): string {
	const g = (key: string, vars?: Record<string, unknown>) => tSync(`game.${key}`, vars);
	if (node === 'C') return g('trivia_cell_center');
	if (node[0] === 'S') {
		const { spoke, index } = parseSpoke(node);
		const squareCat = (spoke + index) % CATS; // this square's own category (spokes are multicoloured)
		return g('trivia_cell_spoke', {
			dest: catKey(spokeDestCategory(board, spoke)),
			steps: index,
			cat: catKey(squareCat),
			color: colorKey(squareCat),
		});
	}
	const k = parseRing(node);
	const slot = board.ring[k];
	if (!slot) return node;
	if (slot.wedge) return g('trivia_cell_wedge', {
		cat: catKey(slot.category), color: colorKey(slot.category),
		hour: clockHour(ringAngle(k, board.ring.length)), num: k + 1,
	});
	if (slot.rollAgain) return g('trivia_cell_roll_again', { num: k + 1 });
	return g('trivia_cell_ring', { cat: catKey(slot.category), color: colorKey(slot.category), num: k + 1 });
}

/** The spatial anchor to append to a DESTINATION option so the player anticipates WHERE it lands:
 *  a clock hour for a radio, the circle region for a ring filler. Wedges already carry their clock
 *  hour in their own label; the centre has none. */
export function triviaPositionSuffix(
	board: TriviaBoardDef,
	node: string,
	tSync: (key: string, vars?: Record<string, unknown>) => string,
): string {
	if (node === 'C') return '';
	if (node[0] === 'S') return tSync('game.trivia_pos_clock', { hour: clockHour(spokeAngle(parseSpoke(node).spoke)) });
	const k = parseRing(node);
	const slot = board.ring[k];
	if (!slot || slot.wedge) return '';
	return tSync(`game.trivia_region_${REGION_KEYS[octant(ringAngle(k, board.ring.length))]}`);
}

function parseSpoke(node: string): { spoke: number; index: number } {
	const [spoke, index] = node.slice(1).split('.').map(Number);
	return { spoke, index };
}

/** The category of a spoke's destination wedge — the spoke's identity colour ("the Geografía
 *  spoke"). Every square of the spoke shares it, so navigation and questions stay consistent. */
function spokeDestCategory(board: TriviaBoardDef, spoke: number): number {
	let seen = -1;
	for (let k = 0; k < board.ring.length; k++) {
		if (board.ring[k].wedge) { seen++; if (seen === spoke) return board.ring[k].category; }
	}
	return 0;
}

function parseRing(node: string): number { return Number(node.slice(1)); }

/** data-node ids contain a dot ("S0.1"); escape it for the attribute selector. */
function cssEscape(node: string): string { return node.replace(/\./g, '\\.'); }

/** The wheel's backdrop as one SVG: six pie sectors tinted by each spoke's destination colour,
 *  the six spokes drawn as lines from the hub out to their headquarters, and the ring track.
 *  This is what makes it read as a Trivial-style wheel; the cells and pieces render on top.
 *  Purely decorative — aria-hidden, so the screen reader never sees it. */
function wheelBackgroundSvg(board: TriviaBoardDef): string {
	const cx = 50, cy = 50, sectorR = 47, ringR = 44, hubR = 8;
	const p = (deg: number, r: number) => {
		const a = deg * Math.PI / 180;
		return { x: (cx + r * Math.cos(a)).toFixed(2), y: (cy + r * Math.sin(a)).toFixed(2) };
	};
	let sectors = '', spokes = '';
	for (let i = 0; i < CATS; i++) {
		const mid = -90 + i * 60;                 // spoke i points here (12, 2, 4… o'clock)
		const a = p(mid - 30, sectorR), b = p(mid + 30, sectorR);
		const fill = CAT_HEX[spokeDestCategory(board, i)];
		sectors += `<path d="M ${cx} ${cy} L ${a.x} ${a.y} A ${sectorR} ${sectorR} 0 0 1 ${b.x} ${b.y} Z" fill="${fill}"/>`;
		const inner = p(mid, hubR), outer = p(mid, ringR);
		spokes += `<line x1="${inner.x}" y1="${inner.y}" x2="${outer.x}" y2="${outer.y}"/>`;
	}
	return `<svg viewBox="0 0 100 100" class="trivia-wheel-svg" aria-hidden="true">`
		+ `<g class="trivia-sectors">${sectors}</g>`
		+ `<circle class="trivia-ring-track" cx="${cx}" cy="${cy}" r="${ringR}"/>`
		+ `<g class="trivia-spokes">${spokes}</g>`
		+ `<circle class="trivia-hub-ring" cx="${cx}" cy="${cy}" r="${hubR}"/>`
		+ `</svg>`;
}

/** A player's token is a little wheel: a conic gradient of the six category slices, each filled
 *  in its colour when that wedge is earned and left faint when not — so the quesitos are visible
 *  and fill up as in Trivial Pursuit. The token's rim (set inline) carries the player's colour. */
function wedgeTokenGradient(wedges: number[]): string {
	const owned = new Set(wedges);
	const step = 360 / CATS;
	const stops: string[] = [];
	for (let g = 0; g < CATS; g++) {
		const colour = owned.has(g) ? CAT_HEX[g] : '#cbd3d8'; // opaque neutral so an unearned slice
		//                                                        never lets the cell colour show through
		stops.push(`${colour} ${(g * step).toFixed(0)}deg ${((g + 1) * step).toFixed(0)}deg`);
	}
	return `conic-gradient(from -90deg, ${stops.join(', ')})`;
}

/** Polar positions (percent) for every wheel node, so the board renders as a wheel. The centre
 *  is the hub; spoke i points at angle -90 + i*60°; the ring is evenly spaced. */
function layoutWheel(board: TriviaBoardDef): WheelNode[] {
	const nodes: WheelNode[] = [];
	const hub = 8, ringR = 44;
	const L = board.spokeLength;

	nodes.push({ id: 'C', kind: 'center', x: 50, y: 50, category: -1, wedge: false, rollAgain: false });

	const wedgeIdx: number[] = [];
	board.ring.forEach((slot, k) => { if (slot.wedge) wedgeIdx.push(k); });

	for (let i = 0; i < CATS; i++) {
		const angle = (-90 + i * 60) * Math.PI / 180;
		for (let j = 1; j <= L; j++) {
			const r = hub + (j / (L + 1)) * (ringR - hub);
			nodes.push({
				id: `S${i}.${j}`, kind: 'spoke',
				x: 50 + r * Math.cos(angle), y: 50 + r * Math.sin(angle),
				category: (i + j) % CATS, wedge: false, rollAgain: false, steps: j,
			});
		}
	}

	const n = board.ring.length;
	board.ring.forEach((slot, k) => {
		const angle = (-90 + (k / n) * 360) * Math.PI / 180;
		nodes.push({
			id: `R${k}`, kind: 'ring',
			x: 50 + ringR * Math.cos(angle), y: 50 + ringR * Math.sin(angle),
			category: slot.category, wedge: !!slot.wedge, rollAgain: !!slot.rollAgain, ring: k + 1,
		});
	});

	return nodes;
}
