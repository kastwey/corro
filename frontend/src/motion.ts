// motion.ts — Single source of truth for whether board MOTION should play.
//
// The token-hop animation is a sighted-player aid (see tokenAnimator.ts). Some players
// want it shorter or gone entirely — both for comfort and because, while a token hops, the
// consequences of the roll (money changes, the buy offer) are intentionally held back until
// it lands (see announcementGate.ts). So suppressing motion must ALSO make those
// consequences land immediately, with no artificial wait.
//
// This module centralises that decision. By default it follows the OS
// `prefers-reduced-motion` setting (the same signal cardReveal.ts already honours); a
// future in-game setting can override it at runtime via {@link setMotionPreference}.

export type MotionPreference =
	/** Follow the OS `prefers-reduced-motion` setting (default). */
	| 'system'
	/** Always animate token hops, regardless of the OS setting. */
	| 'on'
	/** Never animate: tokens snap to their square and consequences land at once. */
	| 'off';

let preference: MotionPreference = 'system';

/** Override the motion preference (e.g. from a settings UI). */
export function setMotionPreference(p: MotionPreference): void {
	preference = p;
}

/** The current motion preference. */
export function getMotionPreference(): MotionPreference {
	return preference;
}

function systemPrefersReducedMotion(): boolean {
	return typeof window !== 'undefined'
		&& typeof window.matchMedia === 'function'
		&& window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * True when token-hop animation should be SKIPPED — the token snaps straight to its
 * authoritative square, so the announcement gate releases the roll's consequences (money,
 * buy offer, action bar) immediately instead of pacing them to a hop that won't play.
 *
 * A HIDDEN window (minimized, fully covered, or a background tab) never animates,
 * whatever the preference: browsers clamp its timers to ≥1 s, so a hop chain would play
 * late and out of rhythm — heard from a second window on the same machine as the same
 * move "replaying" slowly after the real one. Nobody is watching a hidden window; its
 * pieces snap and the announcements release at once.
 */
export function isTokenMotionDisabled(): boolean {
	if (typeof document !== 'undefined' && document.hidden) return true;
	if (preference === 'off') return true;
	if (preference === 'on') return false;
	return systemPrefersReducedMotion();
}
