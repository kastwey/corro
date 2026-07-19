// tokenAnimator.ts — Client-side, step-by-step token movement.
//
// The server is authoritative and broadcasts only the FINAL board position in a single
// `GameStateChanged`. For sighted players (e.g. someone watching over a screen-reader
// user's shoulder) a token that teleports from one square to a distant one is hard to
// follow — especially when a card sends a piece across the board. This module walks the token square by
// square toward its authoritative position so the journey is visible.
//
// The spoken voice is unaffected: announcements come from the server and are coalesced by
// the announcer. This is a purely visual aid driven entirely from authoritative state, so
// it never disagrees with the server — it only catches up to it gradually.

/**
 * The ordered squares a token visits moving from `from` to `to` on a ring board of
 * `boardSize` squares, NOT including the starting square. The shorter direction wins
 * (so a "go back 3 spaces" card steps backwards rather than walking the whole board);
 * ties resolve forwards. Returns an empty array when there is no movement.
 */
export function animationSteps(from: number, to: number, boardSize: number): number[] {
	if (boardSize <= 0 || from === to) return [];
	const forward = (((to - from) % boardSize) + boardSize) % boardSize;
	const backward = boardSize - forward;
	const useForward = forward <= backward;
	const count = useForward ? forward : backward;
	const dir = useForward ? 1 : -1;
	const path: number[] = [];
	for (let i = 1; i <= count; i++) {
		path.push((((from + dir * i) % boardSize) + boardSize) % boardSize);
	}
	return path;
}

export interface TokenAnimatorOptions {
	/** Current number of squares on the board (read lazily; the board may render late). */
	boardSize: () => number;
	/** Re-render tokens from the animator's current display positions. */
	render: () => void;
	/** Delay between steps, in ms. */
	stepDelayMs?: number;
	/**
	 * Lead-in before the FIRST hop of a journey, in ms (defaults to {@link stepDelayMs}).
	 * A longer lead-in lets a just-played cause earcon (e.g. the ~1.5 s dice-roll sound)
	 * finish before the first hop earcon fires, so they don't overlap and mask each other.
	 */
	firstStepDelayMs?: number;
	/**
	 * Moves longer than this snap instantly (e.g. go-to-holding, long card teleports). A single
	 * two-dice roll moves at most 12 squares, so the default covers every ordinary roll while
	 * genuine long-range jumps still snap.
	 */
	maxAnimatedSteps?: number;
	/**
	 * When this returns true, EVERY move snaps to its destination instead of hopping (read
	 * lazily so a runtime motion-preference change takes effect on the next move). With no
	 * hop there is no `onIdle`, so anything paced to the hop (the announcement gate) is
	 * released at once — i.e. turning motion off makes the roll's consequences land
	 * immediately. Defaults to motion enabled.
	 */
	motionDisabled?: () => boolean;
	/**
	 * Called once per tick in which at least one token actually advanced a square. Used to
	 * play the "move token" earcon on every visible hop, so a travelling token sounds like
	 * it is being moved square by square. Never fires for a snap (no animated step shown).
	 */
	onStep?: () => void;
	/** Injectable timer hooks (defaults to the global timers) — for deterministic tests. */
	setTimer?: (fn: () => void, ms: number) => unknown;
	clearTimer?: (handle: unknown) => void;
	/**
	 * Called once each time the animator transitions from "animating" to "idle" (the last
	 * travelling token has reached its authoritative square). Used to pace consequence
	 * reveal — e.g. holding landing announcements until the token finishes its hop. Never
	 * fires for a snap (a move applied without stepping), since no animation was shown.
	 */
	onIdle?: () => void;
}

/**
 * Drives the visible ("display") position of each player's token toward the authoritative
 * position one square at a time. Feed it authoritative positions via {@link sync}; it owns
 * a timer that advances tokens and calls `render()` after each step. The board reads the
 * current display position through {@link displayPosition}.
 */
export class TokenAnimator {
	private readonly display = new Map<string, number>();
	private readonly paths = new Map<string, number[]>();
	private timer: unknown = null;
	/** True once the first hop of the current journey has been scheduled; reset at idle. */
	private started = false;

	private readonly boardSize: () => number;
	private readonly render: () => void;
	private readonly stepDelayMs: number;
	private readonly firstStepDelayMs: number;
	private readonly maxAnimatedSteps: number;
	private readonly motionDisabled?: () => boolean;
	private readonly setTimer: (fn: () => void, ms: number) => unknown;
	private readonly clearTimer: (handle: unknown) => void;
	private readonly onStep?: () => void;
	private readonly onIdle?: () => void;

	constructor(opts: TokenAnimatorOptions) {
		this.boardSize = opts.boardSize;
		this.render = opts.render;
		this.stepDelayMs = opts.stepDelayMs ?? 200;
		this.firstStepDelayMs = opts.firstStepDelayMs ?? this.stepDelayMs;
		this.maxAnimatedSteps = opts.maxAnimatedSteps ?? 12;
		this.motionDisabled = opts.motionDisabled;
		this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
		this.clearTimer = opts.clearTimer ?? (h => clearTimeout(h as ReturnType<typeof setTimeout>));
		this.onStep = opts.onStep;
		this.onIdle = opts.onIdle;
	}

	/** The square where a player's token should currently be drawn. */
	displayPosition(playerId: string, authoritative: number): number {
		const d = this.display.get(playerId);
		return d === undefined ? authoritative : d;
	}

	/**
	 * Project players onto the squares where their tokens are CURRENTLY VISIBLE. While a
	 * token is mid-hop its authoritative `position` already points at the destination, so
	 * board navigation ("next occupied", "who is here") would otherwise let a screen-reader
	 * user jump ahead and learn where a moving player will land before the token arrives.
	 * Substituting the visible square defers that reveal until the hop settles; it is a
	 * no-op once every token has caught up (displayPosition returns the authoritative square).
	 */
	visiblePlayers<T extends { id: string; position: number }>(players: T[]): T[] {
		return players.map(p => {
			const visible = this.displayPosition(p.id, p.position);
			return visible === p.position ? p : { ...p, position: visible };
		});
	}

	/** True while at least one token is still catching up to its authoritative square. */
	get isAnimating(): boolean {
		return this.paths.size > 0;
	}

	/** True while THIS player's token is still mid-journey (has pending steps). The board
	 *  uses it to give the travelling token its hop-and-grow animation; once the token
	 *  lands on its destination square the path is cleared, so it renders at natural size. */
	isPlayerMoving(playerId: string): boolean {
		return this.paths.has(playerId);
	}

	/**
	 * Reconcile the display positions toward the given authoritative positions. New players
	 * are placed instantly; short moves animate; long moves (or no movement) snap. Safe to
	 * call on every state update — non-movement updates are no-ops.
	 */
	sync(positions: Map<string, number>, snap?: ReadonlySet<string>): void {
		const size = this.boardSize();
		// Motion off (OS reduced-motion or an explicit preference): snap every token to its
		// authoritative square so nothing animates and consequences are not held back.
		const snapAll = this.motionDisabled?.() ?? false;
		for (const [id, target] of positions) {
			const current = this.display.get(id);
			if (current === undefined) {
				// First sighting of this player: place immediately, never animate.
				this.display.set(id, target);
				this.paths.delete(id);
				continue;
			}
			if (current === target) {
				this.paths.delete(id);
				continue;
			}
			// snapAll (motion off) or a per-move snap (e.g. a teleport to holding): place at the
			// destination with no hop. With no hop there is no onIdle, so paced consequences are
			// released via the gate's onStateApplied instead.
			if (snapAll || snap?.has(id)) {
				this.display.set(id, target);
				this.paths.delete(id);
				continue;
			}
			const path = animationSteps(current, target, size);
			if (path.length === 0 || path.length > this.maxAnimatedSteps) {
				this.display.set(id, target);
				this.paths.delete(id);
			} else {
				this.paths.set(id, path);
			}
		}
		// Forget players who left the game.
		for (const id of [...this.display.keys()]) {
			if (!positions.has(id)) {
				this.display.delete(id);
				this.paths.delete(id);
			}
		}
		this.ensureRunning();
	}

	/** Stop all animation and forget every tracked position. */
	reset(): void {
		if (this.timer !== null) {
			this.clearTimer(this.timer);
			this.timer = null;
		}
		this.display.clear();
		this.paths.clear();
		this.started = false;
	}

	private ensureRunning(): void {
		if (this.timer !== null || this.paths.size === 0) return;
		// The first hop of a fresh journey waits `firstStepDelayMs` (a lead-in) so it does
		// not collide with the dice-roll earcon still playing; later hops use the regular
		// per-step cadence.
		const delay = this.started ? this.stepDelayMs : this.firstStepDelayMs;
		this.started = true;
		this.timer = this.setTimer(() => this.tick(), delay);
	}

	private tick(): void {
		this.timer = null;
		// Motion went off mid-journey (typically the window was hidden and its timers are
		// now clamped to ≥1 s): snap every traveller to its destination, silently, instead
		// of replaying the rest of the walk late and out of rhythm.
		if (this.motionDisabled?.()) {
			for (const [id, path] of [...this.paths]) {
				const last = path[path.length - 1];
				if (last !== undefined) this.display.set(id, last);
				this.paths.delete(id);
			}
		}
		let advanced = false;
		for (const [id, path] of [...this.paths]) {
			const next = path.shift();
			if (next === undefined) {
				this.paths.delete(id);
				continue;
			}
			this.display.set(id, next);
			advanced = true;
			if (path.length === 0) this.paths.delete(id);
		}
		this.render();
		// One earcon per visible hop (covers the final landing step too).
		if (advanced) this.onStep?.();
		if (this.paths.size === 0) {
			// The last travelling token just landed: clear `started` so the NEXT movement
			// gets its own lead-in, then signal idle so callers can release anything they
			// were pacing to the hop (e.g. buffered landing announcements).
			this.started = false;
			this.onIdle?.();
		}
		this.ensureRunning();
	}
}
