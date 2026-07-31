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

import type {
	GameState, PendingRaceMove, Square, TradeOfferDto, TradeSideDto, TriviaPendingQuestion,
} from './models.js';

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

export interface BusDestination {
	name?: string;
	colorKey?: string;
}

export interface BusChoiceModalData {
	die1: number;
	die2: number;
	both: number;
	fromPosition: number;
	dest1: BusDestination;
	dest2: BusDestination;
	destBoth: BusDestination;
	rent1?: number;
	rent2?: number;
	rentBoth?: number;
}

export type DesiredModal =
	| { kind: 'none' }
	| { kind: 'auction'; data: AuctionModalData }
	| { kind: 'tradeReview'; data: TradeReviewModalData }
	| { kind: 'tradeWaiting'; data: TradeWaitingModalData }
	| { kind: 'busChoice'; data: BusChoiceModalData }
	| { kind: 'raceChoice'; data: PendingRaceMove };

/** Default bid window (seconds) when the state carries no parseable timeout. */
const DEFAULT_BID_WINDOW_SECONDS = 10;

/** Parse a TimeSpan-style "hh:mm:ss(.fff)" string into whole seconds. */
function parseTimeoutSeconds(bidTimeout: string | undefined): number {
	if (typeof bidTimeout === 'string') {
		const m = /(\d+):(\d+):(\d+)/.exec(bidTimeout);
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

function busDestination(squares: Square[], from: number, spaces: number): BusDestination {
	if (squares.length === 0) return {};
	const square = squares[((from + spaces) % squares.length + squares.length) % squares.length];
	return { name: square?.name, colorKey: square?.groupNameKey };
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

	const bus = state.pendingBusChoice;
	if (bus && bus.playerId === myPlayerId) {
		const squares = state.squares ?? [];
		const both = bus.die1 + bus.die2;
		return {
			kind: 'busChoice',
			data: {
				die1: bus.die1,
				die2: bus.die2,
				both,
				fromPosition: bus.fromPosition,
				dest1: busDestination(squares, bus.fromPosition, bus.die1),
				dest2: busDestination(squares, bus.fromPosition, bus.die2),
				destBoth: busDestination(squares, bus.fromPosition, both),
				rent1: bus.rentDie1 ?? undefined,
				rent2: bus.rentDie2 ?? undefined,
				rentBoth: bus.rentBoth ?? undefined,
			},
		};
	}

	const auction = state.activeAuction;
	if (auction?.isActive) {
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

// ── Trivia family: which of its four dialogs the state calls for ────────────────────────────
//
// Trivia drives a chain of dialogs — pick the judge, pick a destination, answer, rule on the
// answer — and WHICH one belongs to me depends on my role in the pending question, not on an
// event. That decision lived inline in app.ts while every other modal's lived here, so it was the
// one nobody could unit-test. It is the same shape as `desiredModal`: pure in, description out.

export type DesiredTriviaDialog =
	| { kind: 'none' }
	/** The host must name the judge before the first turn (judgeMode "fixed"). */
	| { kind: 'judgeSetup' }
	/** My roll landed several legal squares; I pick where to stop. */
	| { kind: 'move'; options: string[] }
	/** The pending question is mine and unanswered. */
	| { kind: 'answer'; question: TriviaPendingQuestion }
	/** I am the judge and the answer is in. */
	| { kind: 'judge'; question: TriviaPendingQuestion };

/**
 * A stable identity for the dialog a state calls for. Reconciliation compares this to what is
 * already open: an unchanged key means "leave it alone" — without it, every state push would tear
 * down and rebuild the open dialog, stealing focus mid-answer. The key therefore includes what
 * makes a dialog DIFFERENT (the question, the offered destinations), not just its kind.
 */
export function triviaDialogKey(dialog: DesiredTriviaDialog): string | null {
	switch (dialog.kind) {
		case 'none': return null;
		case 'judgeSetup': return 'judgeSetup';
		case 'move': return `move:${dialog.options.join(',')}`;
		case 'answer': return `answer:${dialog.question.questionId}`;
		case 'judge': return `judge:${dialog.question.questionId}`;
	}
}

/**
 * The trivia dialog the local player should be seeing. At most one applies: the roles are
 * exclusive (the judge never answers their own question), and a player with no part in the
 * pending question gets `none` and keeps exploring the board.
 */
export function desiredTriviaDialog(
	state: GameState | null | undefined,
	myPlayerId: string | null,
): DesiredTriviaDialog {
	const trivia = state?.trivia;
	if (!state || !trivia || !myPlayerId) return { kind: 'none' };

	if (trivia.pendingJudgeSetup?.hostId === myPlayerId) return { kind: 'judgeSetup' };
	if (trivia.pendingMove?.playerId === myPlayerId) {
		return { kind: 'move', options: trivia.pendingMove.options };
	}

	const question = trivia.pendingQuestion;
	if (question) {
		// Unanswered and mine: I answer. Answered and I am the judge: I rule.
		if (question.playerId === myPlayerId && !question.submitted) {
			return { kind: 'answer', question };
		}
		if (question.judgeId === myPlayerId && question.submitted) {
			return { kind: 'judge', question };
		}
	}

	return { kind: 'none' };
}

// ── Content fingerprints for the choice dialogs ─────────────────────────────────────────────
//
// The race and Bus pickers reconcile the same way the trivia dialogs do, and for the same reason:
// the key must describe WHAT is being offered, not merely that something is. A boolean "is the
// dialog open?" guard once left a previous roll's options on screen while the voice asked the
// player to move the bonus steps — the pending move had been replaced, but the flag had not
// changed. Comparing content instead makes a replaced choice re-render and an unchanged one stay
// put (so it never re-announces or steals focus mid-read).

/** Fingerprint of a pending race move: its kind, its distance, and every option it offers. */
export function raceChoiceKey(pending: PendingRaceMove): string {
	const options = pending.options
		.map(option => `${option.pieceIndex}>${option.toLocation}${option.toSquare}`)
		.join(',');
	return `${pending.kind}:${pending.steps}:${options}`;
}

/**
 * Fingerprint of a pending Bus choice. The two dice and where they are counted from fully
 * determine the three destinations, so they identify the offer without recomputing it.
 */
export function busChoiceKey(choice: { fromPosition: number; die1: number; die2: number }): string {
	return `${choice.fromPosition}:${choice.die1}:${choice.die2}`;
}
