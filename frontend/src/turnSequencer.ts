// turnSequencer.ts — Serialize an action's authoritative segments to the token animation.
//
// The server is authoritative and usually sends ONE announcement batch + ONE state per
// action. But a compound card move can be split by the server (via
// CheckpointTurnSegmentAsync)
// into two segments:
//   segment 1: [landing-here + card draw] then [state at the card square]
//   segment 2: [card move + landing-there] then [state at the destination]
//
// The two SignalR messages of a segment arrive within milliseconds, but a token hop takes
// seconds. If segment 2's state were applied straight away, the animator would recompute
// its path from the start directly to the final square (skipping the visible stop at the
// first one) and the announcement gate would dump both consequences together. This
// sequencer plays one segment at a time: deliver its announcements, cross the optional
// accessibility barrier, apply its state (which starts the hop), and only advance to the
// next segment once that hop settles — so the turn reads
// "announcement → state/move → consequence → announcement → state/move → consequence".
//
// With a single segment (the overwhelmingly common case), only an audible batch adds the
// short accessibility commit lead; states without announcements still apply immediately.

import type { AnnouncementEvent } from './gameClient.js';
import type { GameState } from './models.js';

export interface TurnSequencerOptions {
	/** Deliver a segment's announcements (each goes through the announcement gate). */
	deliverEvents: (events: AnnouncementEvent[]) => void;
	/**
	 * Optional accessibility barrier after event delivery and before state application.
	 * Card surfaces use it to commit the live-region utterance before their hand mutates.
	 */
	beforeApplyState?: (events: AnnouncementEvent[], state: GameState) => void | Promise<void>;
	/** Apply a segment's authoritative state (assigns it and starts the token hop). */
	applyState: (state: GameState) => void;
	/** Whether a token is currently mid-hop (typically `() => tokenAnimator.isAnimating`). */
	isAnimating: () => boolean;
}

interface Segment {
	events: AnnouncementEvent[];
	state: GameState;
}

/**
 * Serializes (events + state) segments of an action to token-hop completion. Feed it the
 * raw server streams — {@link enqueueEvents} for each `GameEvents` batch and
 * {@link enqueueState} for each `GameStateChanged` — and call {@link onSettle} when a hop
 * finishes. Announcements buffered since the last state pair with the NEXT state into one
 * segment, mirroring how the server flushes a segment (events) right before its state.
 */
export class TurnSequencer {
	private pendingEvents: AnnouncementEvent[] = [];
	private readonly queue: Segment[] = [];
	/** True while announcements are crossing the accessibility barrier. */
	private preparingState = false;
	/** True while the current segment's hop is animating: the next segment waits. */
	private waitingForAnimation = false;

	private readonly deliverEvents: (events: AnnouncementEvent[]) => void;
	private readonly beforeApplyState?: (events: AnnouncementEvent[], state: GameState) => void | Promise<void>;
	private readonly applyState: (state: GameState) => void;
	private readonly isAnimating: () => boolean;

	constructor(opts: TurnSequencerOptions) {
		this.deliverEvents = opts.deliverEvents;
		this.beforeApplyState = opts.beforeApplyState;
		this.applyState = opts.applyState;
		this.isAnimating = opts.isAnimating;
	}

	/** Buffer a server announcement batch; it pairs with the NEXT state into one segment. */
	enqueueEvents(events: AnnouncementEvent[]): void {
		if (events.length > 0) this.pendingEvents.push(...events);
	}

	/** Close a segment with its authoritative state and play it (or queue it if busy). */
	enqueueState(state: GameState): void {
		const events = this.pendingEvents;
		this.pendingEvents = [];
		this.queue.push({ events, state });
		this.pump();
	}

	/** Call when the current segment's token hop settles, to advance to the next segment. */
	onSettle(): void {
		if (!this.waitingForAnimation) return;
		this.waitingForAnimation = false;
		this.pump();
	}

	private pump(): void {
		if (this.preparingState || this.waitingForAnimation || this.queue.length === 0) return;
		const segment = this.queue.shift()!;
		this.deliverEvents(segment.events);

		let barrier: void | Promise<void>;
		try {
			barrier = this.beforeApplyState?.(segment.events, segment.state);
		} catch {
			// Accessibility pacing must never strand authoritative state if its hook fails.
			this.applySegmentState(segment.state);
			return;
		}
		if (barrier) {
			this.preparingState = true;
			void barrier.then(
				() => this.applySegmentState(segment.state),
				() => this.applySegmentState(segment.state),
			);
			return;
		}

		this.applySegmentState(segment.state);
	}

	private applySegmentState(state: GameState): void {
		this.preparingState = false;
		this.applyState(state);
		// If applying the state started a hop, hold the next segment until it settles;
		// otherwise (a snap, or no movement at all) this segment is already done, so
		// continue immediately.
		if (this.isAnimating()) {
			this.waitingForAnimation = true;
		} else {
			this.pump();
		}
	}
}
