// cardHandState.ts — Compare the local projected hand across every card family.
//
// The server projects only this player's card instances into the browser. A changed set of
// instance ids means reconciliation may add/remove the focused row, so the announcement
// must use the hand's stable narration focus rather than racing a live region against the
// replacement row's focus event.

import type { GameState } from './models.js';

/** The local player's projected physical card ids, or null outside a known card hand. */
export function localHandInstanceIds(state: GameState | null, playerId: string | null): string[] | null {
	if (!state || !playerId) return null;

	if (state.journey) {
		const member = state.journey.seats
			.flatMap(seat => seat.members)
			.find(candidate => candidate.playerId === playerId);
		return member ? member.hand.map(card => card.instanceId) : null;
	}

	const directHand = state.assembly?.seats.find(seat => seat.playerId === playerId)?.hand
		?? state.draft?.seats.find(seat => seat.playerId === playerId)?.hand
		?? state.shedding?.seats.find(seat => seat.playerId === playerId)?.hand
		?? state.exploding?.seats.find(seat => seat.playerId === playerId)?.hand;
	return directHand ? directHand.map(card => card.instanceId) : null;
}

/** True when a state transition adds or removes at least one local physical card. */
export function localHandChanged(
	before: GameState | null,
	after: GameState,
	playerId: string | null,
): boolean {
	const previous = localHandInstanceIds(before, playerId);
	const next = localHandInstanceIds(after, playerId);
	if (previous === null || next === null || previous.length !== next.length) {
		return previous !== null && next !== null;
	}
	const previousIds = new Set(previous);
	return next.some(id => !previousIds.has(id));
}
