// auctionCountdown.ts - Pure helper for the auction time-warning thresholds.
//
// The per-second auction timer tick is silent in the modal (it is not an aria-live
// region, to avoid spamming the screen reader). Instead we speak the remaining time
// only at a few thresholds. This decision is isolated here as a pure function so it can
// be unit-tested without a DOM / SignalR.

/** Seconds-remaining values at which the countdown is spoken. */
export const AUCTION_WARN_SECONDS: ReadonlySet<number> = new Set([15, 10, 5, 4, 3, 2, 1]);

export interface AuctionWarnResult {
	/** Whether the remaining time should be announced now. */
	announce: boolean;
	/** The updated "last warned" second to carry into the next tick. */
	lastWarned: number;
}

/**
 * Decide whether to voice the auction countdown for the current tick.
 *
 * Announces once when `seconds` hits a threshold (and differs from the last spoken
 * value). When the bid timer resets after a new bid the countdown jumps back up; we then
 * just refresh `lastWarned` (no announcement) so the thresholds can fire again as it
 * counts back down.
 */
export function nextAuctionWarning(
	seconds: number,
	lastWarned: number,
	warnSet: ReadonlySet<number> = AUCTION_WARN_SECONDS
): AuctionWarnResult {
	if (seconds > lastWarned) {
		// Timer reset (new bid): the jump up is silent; thresholds re-arm on the way down.
		return { announce: false, lastWarned: seconds };
	}
	if (seconds !== lastWarned && warnSet.has(seconds)) {
		return { announce: true, lastWarned: seconds };
	}
	return { announce: false, lastWarned };
}
