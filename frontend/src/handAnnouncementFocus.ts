// handAnnouncementFocus.ts — Deterministic narration focus for changing card hands.
//
// A live-region mutation and a subsequent focus move have no guaranteed ordering in a
// screen reader. JAWS can therefore announce the replacement row ("1 of 3") before the
// server's own play/draw/discard line even when the live region changed first. Card hands
// register one stable, programmatically-focusable status target here. When the paired state
// will change the local hand, the announcer can deliver the complete utterance through that
// target; focus then survives reconciliation and no replacement row is announced until the
// player deliberately navigates back into the list.

export type HandAnnouncementFocusTarget = (utterance: string) => boolean;

const targets = new Set<HandAnnouncementFocusTarget>();

/** Register one mounted hand. Returns an idempotent unregister callback. */
export function registerHandAnnouncementFocusTarget(target: HandAnnouncementFocusTarget): () => void {
	targets.add(target);
	return () => { targets.delete(target); };
}

/**
 * Ask the mounted hand that currently owns focus to present this utterance as focused
 * content. Returns false when focus is elsewhere, so the ordinary live region remains the
 * delivery channel.
 */
export function focusHandAnnouncement(utterance: string): boolean {
	for (const target of targets) {
		if (target(utterance)) return true;
	}
	return false;
}
