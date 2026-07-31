// audioGating.ts — the decisions buried in the board's audio lifecycle, without the browser.
//
// Unlocking an AudioContext, listening for the first gesture and preloading an earcon pack are
// side effects that belong in app.ts. The RULES inside them are not: when a suspended context is
// worth resuming, and which cue a token's hop should play. Both were inline in a 2,000-line
// closure and therefore untestable, while being exactly the kind of thing that regresses silently
// — a muted game that still ticks, a themed hop that never replaces the fallback.

/** The AudioContext states browsers report. "interrupted" is Safari's (a call, an alarm). */
export type AudioContextState = 'running' | 'suspended' | 'closed' | 'interrupted' | 'unknown';

/**
 * Whether a context in this state should be resumed when the page comes back to the foreground.
 *
 * Browsers suspend a background tab's audio, so a second window opened to watch another player
 * falls silent and stays silent after regaining focus — which reads as earcons firing
 * unpredictably in one window or the other. A "closed" context cannot be revived, and a running
 * one must be left alone: resuming it needlessly costs a gesture the player has not made.
 */
export function shouldResumeAudioContext(state: AudioContextState | string): boolean {
	return state === 'suspended' || state === 'interrupted';
}

/** What a travelling token's hop should sound like on this step. */
export type TokenHopCue =
	/** The package ships a themed `token.hop` (a car's vroom, a die's tap): it wins. */
	| 'package'
	/** No package cue: the client's built-in navigation earcon, so a hop is never silent. */
	| 'fallback'
	/** Muted, or audio never came up: play nothing. */
	| 'silent';

export interface TokenHopContext {
	/** True once the sound bank actually loaded (audio may be unsupported or still locked). */
	readonly loaded: boolean;
	/** The player's mute toggle. */
	readonly muted: boolean;
	/** Whether the active package supplies its own `token.hop` earcon. */
	readonly hasPackageCue: boolean;
}

/**
 * Which cue a single hop plays. Mute wins over everything — including a package's own cue, which
 * is the point: a themed sound must never sneak past the toggle.
 */
export function tokenHopCue(context: TokenHopContext): TokenHopCue {
	if (!context.loaded || context.muted) return 'silent';
	return context.hasPackageCue ? 'package' : 'fallback';
}

/**
 * The gesture types that may unlock audio. A tap surfaces as pointerdown, touchstart, touchend or
 * click depending on iPadOS/iOS Safari's mood, and a keyboard player produces none of them — so
 * keydown is listed too, and whichever lands first wins.
 */
export const AUDIO_UNLOCK_EVENTS: readonly string[] = [
	'pointerdown', 'touchstart', 'touchend', 'click', 'keydown',
];
