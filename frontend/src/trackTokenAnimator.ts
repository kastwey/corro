// trackTokenAnimator.ts — walks track pieces square by square toward their authoritative
// position, one hop per tick, so a blind player can COUNT the move by its hop earcons
// (the same contract as the property and race animators). While any piece is mid-walk the
// announcement gate holds the roll's consequences; onIdle releases them.
//
// A move that ends on a snake or ladder walks straight to the FINAL square (the walk may
// even run backwards): the voice already tells the story ("you land on 20… you slide down
// to 10"), the animation just paces it.

import type { GameState } from './models.js';

export interface TrackTokenAnimatorDeps {
	gameState: () => GameState | null;
	/** Re-render the board with the current display positions (one call per hop). */
	render: () => void;
	stepDelayMs: number;
	/** Extra delay before the FIRST hop (lets the dice sound finish). */
	firstStepDelayMs: number;
	onStep: () => void;
	onIdle: () => void;
	motionDisabled: () => boolean;
	/** Injectable timers so tests drive the walk by hand (defaults to real setTimeout). */
	setTimer?: (fn: () => void, ms: number) => unknown;
	clearTimer?: (handle: unknown) => void;
}

export class TrackTokenAnimator {
	/** Where each piece is DRAWN right now (may trail the authoritative square mid-walk). */
	private display = new Map<string, number>();
	private timer: unknown = null;
	private readonly setTimer: (fn: () => void, ms: number) => unknown;

	constructor(private readonly deps: TrackTokenAnimatorDeps) {
		this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
	}

	get isAnimating(): boolean { return this.timer !== null; }

	/** The square to draw a piece on (authoritative when not tracked yet). */
	displayPosition(playerId: string): number {
		return this.display.get(playerId)
			?? this.authoritative().get(playerId)
			?? 0;
	}

	/** Reconcile with the authoritative state: new pieces snap, moved pieces walk. */
	syncFromState(): void {
		const targets = this.authoritative();
		let needsWalk = false;
		for (const [playerId, square] of targets) {
			const current = this.display.get(playerId);
			if (current === undefined) {
				this.display.set(playerId, square); // first sighting: appear in place
			} else if (current !== square) {
				if (this.deps.motionDisabled()) this.display.set(playerId, square);
				else needsWalk = true;
			}
		}
		// Forget pieces that left the state (a player removed on game over cleanup).
		for (const playerId of [...this.display.keys()]) {
			if (!targets.has(playerId)) this.display.delete(playerId);
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
		const targets = this.authoritative();
		// Motion went off mid-walk (typically the window was hidden and its timers are now
		// throttled): finish INSTANTLY and silently instead of limping through the rest of
		// the hops at the browser's clamped ≥1 s cadence.
		if (this.deps.motionDisabled()) {
			for (const [playerId, target] of targets) this.display.set(playerId, target);
			this.timer = null;
			this.deps.render();
			this.deps.onIdle();
			return;
		}
		let pending = false;
		for (const [playerId, target] of targets) {
			const current = this.display.get(playerId) ?? target;
			if (current === target) continue;
			this.display.set(playerId, current + Math.sign(target - current));
			if (this.display.get(playerId) !== target) pending = true;
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

	private authoritative(): Map<string, number> {
		const positions = this.deps.gameState()?.track?.positions ?? [];
		return new Map(positions.map(p => [p.playerId, p.square]));
	}
}
