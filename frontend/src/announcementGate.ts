// announcementGate.ts — Pace consequence reveal to the token-hop animation.
//
// The server is authoritative and, per action, sends its announcements as one ordered
// batch BEFORE the state update that moves a token. Each announcement carries a `phase`:
//   • `move`    — the dice roll (the cause of the movement). Spoken immediately.
//   • `resolve` — the consequence of landing (rent, tax, card…). The DEFAULT, and what we
//                 hold back until the token finishes hopping to its destination square.
//
// So a turn reads naturally: you hear the dice, watch (or are told) the token hop, and only
// THEN hear what happened where you landed — instead of the whole turn being narrated at
// once while the token is still travelling.
//
// Anything urgent (errors via `priority`, on-demand queries via `instant`) and any
// client-created announcement (which has no `phase`) bypasses the gate entirely. Actions
// with no movement (buy, build, auction…) carry the default `resolve` phase but are never
// armed (no `move` line precedes them), so they too are spoken immediately.

import type { AnnouncementEvent } from './gameClient.js';
import type { AnnounceFn, AnnounceOptions } from './announcer.js';

export interface AnnouncementGateOptions {
	/** Where un-gated / released announcements actually go (sound + toast + live region). */
	deliver: AnnounceFn;
	/** Whether a token is currently mid-hop (typically `() => tokenAnimator.isAnimating`). */
	isAnimating: () => boolean;
	/**
	 * Safety net poll interval. The net is a *stuck-hop* detector, not a hard deadline: a
	 * long but healthy move (e.g. a 12-square hop) can legitimately outlast this, and its
	 * real end is signalled by {@link AnnouncementGate.settle}. So when the timer fires
	 * while the token is still hopping we reschedule and keep waiting; we only flush early
	 * when nothing is animating (the settle was genuinely missed, e.g. a dropped state
	 * update on reconnect), so consequences are never lost.
	 */
	safetyTimeoutMs?: number;
	/** Injectable timer hooks (defaults to the global timers) — for deterministic tests. */
	setTimer?: (fn: () => void, ms: number) => unknown;
	clearTimer?: (handle: unknown) => void;
}

/**
 * Buffers an action's `resolve`-phase announcements while its token hops, releasing them
 * the moment the animation settles (or immediately when there is no movement). Drop-in for
 * an {@link AnnounceFn}: hand {@link announce} to whatever produces server announcements,
 * call {@link onStateApplied} right after applying authoritative state (so the gate can
 * decide wait-vs-release), and call {@link settle} when the token animation finishes.
 */
export class AnnouncementGate {
	private readonly buffer: Array<{ event: AnnouncementEvent; options?: AnnounceOptions }> = [];
	/** Visual side-effects (e.g. the card-reveal flip) paced to the same hop as the buffer. */
	private readonly visualBuffer: Array<() => void> = [];
	/** True once a `move` line has arrived: this action's `resolve` lines are being paced. */
	private armed = false;
	private safetyTimer: unknown = null;
	/** The last state object seen by {@link onStateApplied}, to ignore synthetic re-emits. */
	private lastAppliedState: unknown = null;

	private readonly deliver: AnnounceFn;
	private readonly isAnimating: () => boolean;
	private readonly safetyTimeoutMs: number;
	private readonly setTimer: (fn: () => void, ms: number) => unknown;
	private readonly clearTimer: (handle: unknown) => void;

	constructor(opts: AnnouncementGateOptions) {
		this.deliver = opts.deliver;
		this.isAnimating = opts.isAnimating;
		this.safetyTimeoutMs = opts.safetyTimeoutMs ?? 4000;
		this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
		this.clearTimer = opts.clearTimer ?? (h => clearTimeout(h as ReturnType<typeof setTimeout>));
	}

	/** The {@link AnnounceFn} to feed server announcements through. */
	readonly announce: AnnounceFn = (event, options) => {
		const phase = event.phase;

		// Urgent (priority/instant) and client-created (no phase) lines are never paced.
		if (options?.instant || options?.priority || !phase) {
			this.deliver(event, options);
			return;
		}

		if (phase === 'move') {
			// A movement just started this action: start pacing its consequences to the hop.
			this.arm();
			this.deliver(event, options);
			return;
		}

		// phase === 'resolve'
		if (this.armed) {
			this.buffer.push({ event, options });
		} else {
			this.deliver(event, options);
		}
	};

	/**
	 * Pace a VISUAL side-effect (e.g. the animated card reveal) to the same hop as the
	 * spoken consequences. If a movement is being paced, the callback is buffered and runs
	 * when the token settles (alongside the `resolve` announcements); otherwise it runs now.
	 * This keeps a drawn card from flashing on screen before the token reaches the square.
	 */
	deferVisual(run: () => void): void {
		if (this.armed) {
			this.visualBuffer.push(run);
		} else {
			run();
		}
	}

	/**
	 * Arm the gate from OUTSIDE a `move`-phase announcement, for a family whose MOVE is a
	 * separate action from its roll (trivia: you roll, then pick a landing square — the roll's
	 * arm has already flushed by the time you pick). The client calls this the instant it sends
	 * the move, so the landing's `resolve` announcements and its dialog (deferVisual) pace to the
	 * piece's walk. Idempotent and safe to call speculatively: {@link onStateApplied} releases it
	 * at once if nothing ends up animating, and the safety net flushes a move that never settles.
	 */
	armForMove(): void {
		if (!this.armed) this.arm();
	}

	/**
	 * Call right after applying an authoritative state update (which is what starts the
	 * token animation). If a movement is being paced and its token is now hopping, the
	 * buffer waits for {@link settle}; otherwise (the move snapped, or nothing moved) it is
	 * released at once.
	 *
	 * Pass the state object itself when available: handlers also RE-EMIT the currently
	 * applied state as a deferred UI refresh (e.g. the dice handler's 600 ms turn-indicator
	 * refresh), and that synthetic emit reaches the same app handler. Deduplicating by
	 * reference keeps such a re-emit from counting as a fresh application — before this
	 * guard, a real state slower than the refresh timer let the refresh flush an armed
	 * gate ("nothing is animating yet") and the buffered cursor move spoiled the
	 * destination before the token had even started its hop.
	 */
	onStateApplied(state?: unknown): void {
		if (state !== undefined) {
			if (state === this.lastAppliedState) return; // synthetic re-emit, not a fresh application
			this.lastAppliedState = state;
		}
		if (!this.armed) return;
		if (this.isAnimating()) return; // settle() will release the buffer when the hop ends
		this.flush();
	}

	/** Call when the token animation settles (the last travelling token has landed). */
	settle(): void {
		if (this.armed) this.flush();
	}

	private arm(): void {
		this.armed = true;
		this.scheduleSafety();
	}

	private scheduleSafety(): void {
		if (this.safetyTimer !== null) this.clearTimer(this.safetyTimer);
		this.safetyTimer = this.setTimer(() => this.onSafetyTimeout(), this.safetyTimeoutMs);
	}

	/**
	 * The safety net fired. If the token is still hopping, the move is healthy but longer
	 * than one safety window (its real end will arrive via {@link settle}) — reschedule and
	 * keep waiting rather than releasing mid-hop. Only when nothing is animating do we treat
	 * the settle as genuinely missed and flush so consequences are never lost.
	 */
	private onSafetyTimeout(): void {
		this.safetyTimer = null;
		if (!this.armed) return;
		if (this.isAnimating()) {
			this.scheduleSafety();
			return;
		}
		this.flush();
	}

	private flush(): void {
		this.armed = false;
		if (this.safetyTimer !== null) {
			this.clearTimer(this.safetyTimer);
			this.safetyTimer = null;
		}
		if (this.buffer.length > 0) {
			const items = this.buffer.splice(0, this.buffer.length);
			for (const { event, options } of items) {
				this.deliver(event, options);
			}
		}
		if (this.visualBuffer.length > 0) {
			const visuals = this.visualBuffer.splice(0, this.visualBuffer.length);
			for (const run of visuals) run();
		}
	}
}