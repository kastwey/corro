// settleGuard.ts — Keep turn-flow commands from running ahead of the story.
//
// The server resolves an action atomically and the CLIENT paces its telling (token hops,
// turn segments, gated announcements). While that telling is still playing out, the
// authoritative state is already ahead of what the player has seen/heard — so acting on it
// (buying a square you haven't heard yourself land on) would be answering a question that
// hasn't been asked yet. The guard wraps a command's entry points (keyboard shortcut, dice
// button, action-bar activation): while the presentation is settling it speaks a brief
// reason instead of firing; otherwise it fires normally.
//
// Deliberately NOT applied to ambient management commands (manage properties, trades,
// reading dialogs): those are not consequences of the move being told, matching how the
// action bar keeps them available while landing-driven actions are withheld.

/**
 * Build a wrapper factory: `guard(fn)` returns a function that runs `fn` only when
 * `isSettling()` is false, and calls `onBlocked` (e.g. speak "the move is still playing
 * out") instead while the presentation is draining.
 */
export function makeSettleGuard(
	isSettling: () => boolean,
	onBlocked: () => void,
): (fn: () => void) => () => void {
	return (fn) => () => {
		if (isSettling()) {
			onBlocked();
			return;
		}
		fn();
	};
}
