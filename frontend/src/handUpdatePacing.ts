// handUpdatePacing.ts — Give screen-reader narration a head start over hand mutation.
//
// ARIA live output is asynchronous, while removing the focused card immediately emits a
// high-priority list/focus event. In live JAWS/NVDA play, a short lead is enough for the
// action sentence to begin; the later list position then follows it naturally. Only the
// accessible hand repaint is delayed — authoritative state and every other surface update
// remain immediate.

/** Empirically sufficient lead without making a turn feel stalled. */
export const HAND_UPDATE_LEAD_MS = 400;

let updateNotBefore = 0;

/** Arm the next mounted hand update after an announcement has actually been written. */
export function armHandUpdateAfterAnnouncement(
	leadMs = HAND_UPDATE_LEAD_MS,
	now: () => number = () => performance.now(),
): void {
	updateNotBefore = Math.max(updateNotBefore, now() + Math.max(0, leadMs));
}

/** Consume the lead for the next hand repaint. Zero means repaint immediately. */
export function takeHandUpdateDelay(now: () => number = () => performance.now()): number {
	const delay = Math.max(0, updateNotBefore - now());
	updateNotBefore = 0;
	return delay;
}

/** Test/lifecycle hygiene: never let a discarded page/panel leak pacing into another. */
export function clearHandUpdatePacing(): void {
	updateNotBefore = 0;
}
