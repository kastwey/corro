// holdingMovement.ts — Decide which tokens teleport to holding (vs. animate the walk there).
//
// Classic "go directly to holding" places the piece IN holding with no slide across the board. But a
// nearby holding is a short move, which the token animator would otherwise animate — so we snap it.
// A board can opt into the walk (rules.holding.walk = true → GameState.walkToHolding), in which case
// nobody is snapped and the move animates like any other.

/** A minimal view of a player for the holding-teleport decision. */
export interface HoldingMovementPlayer {
	id: string;
	isHeld?: boolean;
}

/**
 * The set of player ids that just ENTERED holding on this state update and should teleport (snap) to it
 * rather than animate. A player counts as "just entered" when they are in holding now but were not on the
 * previous update. Returns an empty set when the board walks to holding (`walkToHolding`), so every move
 * animates normally.
 *
 * Mutates `wasHeld` in place to the new snapshot, so the caller keeps it across updates. (On the first
 * update — or a reconnect — a player already in holding counts as a fresh entry, which is harmless: the
 * animator places a first-seen token instantly anyway, so "snapping" it changes nothing visible.)
 */
export function holdingTeleports(
	players: ReadonlyArray<HoldingMovementPlayer>,
	wasHeld: Map<string, boolean>,
	walkToHolding: boolean,
): Set<string> {
	const snap = new Set<string>();
	for (const p of players) {
		const now = !!p.isHeld;
		if (now && !(wasHeld.get(p.id) ?? false) && !walkToHolding) snap.add(p.id);
		wasHeld.set(p.id, now);
	}
	return snap;
}
