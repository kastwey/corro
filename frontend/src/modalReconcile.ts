// modalReconcile.ts — pure decision of WHICH blocking modal the authoritative game state
// requires for the local player.
//
// The auction and trade modals are time-boxed operations the server persists in
// the game state. They used to be opened only
// by one-time SignalR events, so on a reconnect (the server resends the full state but never
// replays those events) the modal stayed closed. This module derives the desired modal purely
// from the state so app.ts can reconcile the open dialogs on every state update — the events
// become unnecessary and reconnection "just works".
//
// Kept DOM-free and i18n-free (like squareMenu.ts) so it is unit-testable;
// app.ts attaches the callbacks and localizes the labels.

import type { GameState, PendingRaceMove, Square, TradeOfferDto, TradeSideDto } from './models.js';

export interface AuctionModalData {
	squareIndex: number;
	squareName: string;
	currentBid: number;
	highestBidderName: string | null;
	/** Best-effort countdown; the per-second server tick corrects it within a second. */
	secondsRemaining: number;
}

export interface TradeReviewModalData {
	tradeId: string;
	initiatorName: string;
	/** What I (the target) receive. */
	offered: TradeSideDto;
	/** What I (the target) give away. */
	requested: TradeSideDto;
}

export interface TradeWaitingModalData {
	tradeId: string;
	targetName: string;
}

export type DesiredModal =
	| { kind: 'none' }
	| { kind: 'auction'; data: AuctionModalData }
	| { kind: 'tradeReview'; data: TradeReviewModalData }
	| { kind: 'tradeWaiting'; data: TradeWaitingModalData }
	| { kind: 'raceChoice'; data: PendingRaceMove };

/** Default bid window (seconds) when the state carries no parseable timeout. */
const DEFAULT_BID_WINDOW_SECONDS = 10;

/** Parse a TimeSpan-style "hh:mm:ss(.fff)" string into whole seconds. */
function parseTimeoutSeconds(bidTimeout: string | undefined): number {
	if (typeof bidTimeout === 'string') {
		const m = bidTimeout.match(/(\d+):(\d+):(\d+)/);
		if (m) return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
	}
	return DEFAULT_BID_WINDOW_SECONDS;
}

/** Whole seconds left in the current bid window, estimated from the phase start. */
function auctionSecondsRemaining(
	bidTimeout: string | undefined,
	currentPhaseStartedAt: string | undefined,
	now: number
): number {
	const window = parseTimeoutSeconds(bidTimeout);
	if (!currentPhaseStartedAt) return window;
	const startedMs = Date.parse(currentPhaseStartedAt);
	if (Number.isNaN(startedMs)) return window;
	const elapsed = Math.floor((now - startedMs) / 1000);
	return Math.max(0, Math.min(window, window - elapsed));
}

/** Enrich a stored trade offer (square indices) into a display side (named properties). */
function sideFromOffer(offer: TradeOfferDto, squares: Square[]): TradeSideDto {
	return {
		properties: (offer.properties ?? []).map(i => ({
			index: i,
			name: squares[i]?.name ?? '',
			color: squares[i]?.color,
			// Without the group-name key a package property (hex colour group) reads with NO
			// group in the review — and this state-driven path is the one that actually
			// renders it (the state lands before the TRADE_PROPOSED broadcast).
			groupNameKey: squares[i]?.groupNameKey,
			price: squares[i]?.price,
		})),
		money: offer.money ?? 0,
		releasePasses: offer.releasePasses ?? 0,
	};
}

/**
 * Decide the single blocking modal the local player should see for the given state. At most
 * one blocking operation is ever active (each freezes the game), but if several were present
 * the priority is auction → trade. Returns `{ kind: 'none' }` when nothing
 * blocking applies to this player.
 */
export function desiredModal(
	state: GameState | null | undefined,
	myPlayerId: string | null,
	now: number = Date.now()
): DesiredModal {
	if (!state) return { kind: 'none' };

	// Race family: the only blocking choice is "which piece moves?" (mine only).
	const racePending = state.race?.pendingMove;
	if (racePending && racePending.playerId === myPlayerId) {
		return { kind: 'raceChoice', data: racePending };
	}

	const auction = state.activeAuction;
	if (auction && auction.isActive) {
		// A player who already passed has opted out: no modal for them (the game stays
		// blocked until the auction ends, but they no longer bid). Everyone else — including
		// the player who declined the purchase that started it — still bids.
		const passed = auction.passedPlayers ?? [];
		if (myPlayerId && passed.includes(myPlayerId)) {
			return { kind: 'none' };
		}
		return {
			kind: 'auction',
			data: {
				squareIndex: auction.squareIndex,
				squareName: auction.squareName,
				currentBid: auction.currentBid ?? 0,
				highestBidderName: auction.highestBidderName ?? null,
				secondsRemaining: auctionSecondsRemaining(
					auction.bidTimeout,
					auction.currentPhaseStartedAt,
					now
				),
			},
		};
	}

	const trade = state.activeTrade;
	if (trade && trade.isActive && myPlayerId) {
		const squares = state.squares ?? [];
		if (trade.targetId === myPlayerId) {
			return {
				kind: 'tradeReview',
				data: {
					tradeId: trade.id,
					initiatorName: trade.initiatorName,
					offered: sideFromOffer(trade.initiator, squares),
					requested: sideFromOffer(trade.target, squares),
				},
			};
		}
		if (trade.initiatorId === myPlayerId) {
			return {
				kind: 'tradeWaiting',
				data: { tradeId: trade.id, targetName: trade.targetName },
			};
		}
	}

	return { kind: 'none' };
}
