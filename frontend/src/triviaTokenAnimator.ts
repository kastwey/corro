// triviaTokenAnimator.ts — walks a trivia piece node by node along the wheel toward its
// authoritative node, one hop per tick, so the move reads as travel (not a teleport) and a blind
// player can COUNT it by the hop earcons — the same contract as the track/race/property animators.
// While a piece is mid-walk the announcement gate holds the roll's consequences; onIdle releases
// them (so "you land on the Geography headquarters" is spoken on ARRIVAL).
//
// The wheel is a graph, so the path between two nodes is the shortest walk over its edges
// (centre ↔ spokes ↔ ring). Reduced motion (or a hidden tab) snaps straight to the target.

import type { GameState, TriviaBoardDef } from './models.js';

export interface TriviaTokenAnimatorDeps {
	gameState: () => GameState | null;
	/** Re-render the board with the current display positions (one call per hop). */
	render: () => void;
	stepDelayMs: number;
	/** Extra delay before the FIRST hop (a brief beat after the destination is chosen). */
	firstStepDelayMs: number;
	onStep: () => void;
	onIdle: () => void;
	motionDisabled: () => boolean;
	/** Injectable timers so tests drive the walk by hand (defaults to real setTimeout). */
	setTimer?: (fn: () => void, ms: number) => unknown;
	clearTimer?: (handle: unknown) => void;
}

export class TriviaTokenAnimator {
	/** Where each piece is DRAWN right now (may trail the authoritative node mid-walk). */
	private display = new Map<string, string>();
	/** The nodes each piece still has to hop through (excludes where it already is). */
	private paths = new Map<string, string[]>();
	private timer: unknown = null;
	private readonly setTimer: (fn: () => void, ms: number) => unknown;

	constructor(private readonly deps: TriviaTokenAnimatorDeps) {
		this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
	}

	get isAnimating(): boolean { return this.timer !== null; }

	/** The node to draw a piece on (authoritative when not tracked yet). */
	displayPosition(playerId: string): string | null {
		return this.display.get(playerId) ?? this.authoritative().get(playerId) ?? null;
	}

	/** Reconcile with the authoritative state: new pieces snap, moved pieces walk. */
	syncFromState(): void {
		const targets = this.authoritative();
		const board = this.deps.gameState()?.triviaBoard;
		let needsWalk = false;
		for (const [playerId, node] of targets) {
			const current = this.display.get(playerId);
			if (current === undefined) {
				this.display.set(playerId, node); // first sighting: appear in place
			} else if (current !== node) {
				const path = board && !this.deps.motionDisabled() ? wheelPath(board, current, node) : [];
				if (path.length === 0) {
					this.display.set(playerId, node); // reduced motion, or no walkable path: snap
					this.paths.delete(playerId);
				} else {
					this.paths.set(playerId, path);
					needsWalk = true;
				}
			}
		}
		// Forget pieces that left the state (a retired/removed player).
		for (const playerId of [...this.display.keys()]) {
			if (!targets.has(playerId)) { this.display.delete(playerId); this.paths.delete(playerId); }
		}

		if (needsWalk && !this.timer) {
			this.timer = this.setTimer(() => this.tick(), this.deps.firstStepDelayMs);
		} else if (!needsWalk) {
			this.deps.render();
			if (!this.timer) this.deps.onIdle();
		}
	}

	/** One hop per pending piece per tick (in practice a single piece moves per turn). */
	private tick(): void {
		// Motion went off mid-walk (typically the tab was hidden and timers are now clamped to
		// ≥1 s): finish INSTANTLY and silently rather than limp through the rest out of rhythm.
		if (this.deps.motionDisabled()) {
			for (const [playerId, node] of this.authoritative()) this.display.set(playerId, node);
			this.paths.clear();
			this.timer = null;
			this.deps.render();
			this.deps.onIdle();
			return;
		}
		let pending = false;
		for (const [playerId, path] of [...this.paths]) {
			const next = path.shift();
			if (next === undefined) { this.paths.delete(playerId); continue; }
			this.display.set(playerId, next);
			if (path.length > 0) pending = true; else this.paths.delete(playerId);
		}
		this.deps.onStep();
		this.deps.render();
		if (pending) {
			this.timer = this.setTimer(() => this.tick(), this.deps.stepDelayMs);
		} else {
			this.timer = null;
			this.deps.onIdle();
		}
	}

	private authoritative(): Map<string, string> {
		const players = this.deps.gameState()?.trivia?.players ?? [];
		return new Map(players.filter(p => !p.retired).map(p => [p.playerId, p.node]));
	}
}

/** The shortest walk (excluding the start, including the end) between two wheel nodes, over the
 *  graph's edges: centre ↔ each spoke's first square, spoke interiors, spoke end ↔ its headquarters,
 *  and around the ring. [] when already there or unreachable. */
export function wheelPath(board: TriviaBoardDef, from: string, to: string): string[] {
	if (from === to) return [];
	const adj = wheelAdjacency(board);
	const prev = new Map<string, string>();
	const seen = new Set<string>([from]);
	const queue: string[] = [from];
	while (queue.length) {
		const cur = queue.shift()!;
		if (cur === to) break;
		for (const nb of adj.get(cur) ?? []) {
			if (seen.has(nb)) continue;
			seen.add(nb);
			prev.set(nb, cur);
			queue.push(nb);
		}
	}
	if (!prev.has(to)) return [];
	const path: string[] = [];
	for (let cur = to; cur !== from; cur = prev.get(cur)!) path.unshift(cur);
	return path;
}

function wheelAdjacency(board: TriviaBoardDef): Map<string, string[]> {
	const adj = new Map<string, string[]>();
	const link = (a: string, b: string) => {
		(adj.get(a) ?? adj.set(a, []).get(a)!).push(b);
		(adj.get(b) ?? adj.set(b, []).get(b)!).push(a);
	};
	const L = board.spokeLength;
	const wedge: number[] = [];
	board.ring.forEach((slot, k) => { if (slot.wedge) wedge.push(k); });

	for (let i = 0; i < wedge.length; i++) {
		link('C', `S${i}.1`);                                  // hub → spoke start
		for (let j = 1; j < L; j++) link(`S${i}.${j}`, `S${i}.${j + 1}`); // spoke interior
		link(`S${i}.${L}`, `R${wedge[i]}`);                    // spoke end → its headquarters
	}
	const n = board.ring.length;
	for (let k = 0; k < n; k++) link(`R${k}`, `R${(k + 1) % n}`); // around the ring
	return adj;
}
