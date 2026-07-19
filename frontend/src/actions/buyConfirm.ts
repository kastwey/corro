// buyConfirm.ts — Pure decision for whether activating "Buy" should open the
// purchase confirmation, and if not, why. Extracted from app.ts so the
// duplicate-buy guard is unit-testable with NO DOM and NO game side effects.
//
// Why the guard exists: the game state is server-authoritative and arrives over
// the network. After a player confirms a purchase the client keeps showing the
// "Buy" action until the authoritative update lands. Under network lag that
// window can be seconds long, during which the stale Buy action stays active —
// so a second activation (e.g. pressing Enter on the still-focused Buy button,
// meaning to end the turn) would send a SECOND BuyProperty that the server
// rejects as NO_PENDING_PURCHASE, surfacing a confusing delayed error. While a
// buy for the same pending purchase is already in flight we therefore decline to
// open the confirmation or send another command.

export interface PendingPurchaseLike {
	playerId: string;
	squareIndex: number;
	price: number;
}

export interface BuyConfirmInput {
	/** The pending purchase recorded in the (possibly stale) client game state. */
	pendingPurchase: PendingPurchaseLike | null;
	/** My player id (null until identified). */
	myId: string | null;
	/** My current cash. */
	myMoney: number;
	/** Square index of a buy already sent and awaiting the authoritative result. */
	inFlightSquare: number | null;
}

export type BuyConfirmDecision = 'open' | 'noPending' | 'inFlight' | 'cannotAfford';

/**
 * Decide what activating "Buy" should do:
 * - `noPending`   — no pending purchase belongs to me; do nothing.
 * - `inFlight`    — I already sent a buy for this exact square and it hasn't
 *                   resolved yet; do nothing (prevents the duplicate-buy error).
 * - `cannotAfford`— there is a pending purchase but I can't afford it; speak the
 *                   reason instead of opening the confirmation.
 * - `open`        — open the Yes/No confirmation.
 */
export function decideBuyConfirm(input: BuyConfirmInput): BuyConfirmDecision {
	const { pendingPurchase: pp, myId, myMoney, inFlightSquare } = input;
	if (!pp || pp.playerId !== myId) return 'noPending';
	if (inFlightSquare === pp.squareIndex) return 'inFlight';
	if (myMoney < pp.price) return 'cannotAfford';
	return 'open';
}
