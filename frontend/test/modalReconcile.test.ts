import test from 'node:test';
import assert from 'node:assert/strict';
import { desiredModal } from '../src/modalReconcile.js';
import type { GameState, Square } from '../src/models.js';
import type { TradeReviewModalData } from '../src/modalReconcile.js';

/**
 * Pure-logic tests for desiredModal: which blocking modal the authoritative game state
 * requires for the local player. This is the source of truth that reopens the auction /
 * trade dialogs on reconnect, so its decisions are covered exhaustively here.
 */

function sq(partial: Partial<Square>): Square {
	return { id: 0, name: '', x: 0, y: 0, ...partial } as Square;
}

/** A small board used to enrich trade properties. */
function ring(): Square[] {
	return [
		sq({ name: 'GO' }),
		sq({ name: 'A', color: 'brown', groupNameKey: 'game.color_brown', type: 'property' }),
		sq({ name: 'B', color: 'red', groupNameKey: 'game.color_red', type: 'property', price: 200 }),
		sq({ name: 'C', type: 'railroad', price: 200 }),
	];
}

function state(partial: Partial<GameState>): GameState {
	return {
		players: [],
		bank: { money: 0 },
		currentTurn: null,
		ownership: [],
		squares: [],
		...partial,
	} as GameState;
}

test('returns none for a null or empty state', () => {
	assert.deepEqual(desiredModal(null, 'me'), { kind: 'none' });
	assert.deepEqual(desiredModal(undefined, 'me'), { kind: 'none' });
	assert.deepEqual(desiredModal(state({}), 'me'), { kind: 'none' });
});

// ── Bonus-die Bus choice ───────────────────────────────────────────────────

test('my persisted Bus choice reopens with wrapped destinations and rent previews', () => {
	const squares = ring();
	const result = desiredModal(state({
		squares,
		pendingBusChoice: {
			playerId: 'me', die1: 1, die2: 3, fromPosition: 3,
			rentDie1: null, rentDie2: 40, rentBoth: 75,
		},
	}), 'me');

	assert.equal(result.kind, 'busChoice');
	if (result.kind !== 'busChoice') return;
	assert.equal(result.data.dest1.name, 'GO'); // 3 + 1 wraps to 0
	assert.equal(result.data.dest2.name, 'B');  // 3 + 3 wraps to 2
	assert.equal(result.data.destBoth.name, 'C');
	assert.equal(result.data.rent1, undefined);
	assert.equal(result.data.rent2, 40);
	assert.equal(result.data.rentBoth, 75);
});

test('another player never sees the Bus picker', () => {
	assert.equal(desiredModal(state({
		pendingBusChoice: { playerId: 'rival', die1: 2, die2: 3, fromPosition: 0 },
	}), 'me').kind, 'none');
});

// ── Auction ────────────────────────────────────────────────────────────────

test('an active auction opens the auction modal for a bidding player', () => {
	const result = desiredModal(state({
		activeAuction: {
			squareIndex: 2,
			squareName: 'B',
			startingPrice: 1,
			currentBid: 50,
			highestBidderName: 'Ana',
			bids: [],
			passedPlayers: [],
			startedAt: '',
			initiatorPlayerId: 'p1',
			isActive: true,
		},
	}), 'me');
	assert.equal(result.kind, 'auction');
	if (result.kind !== 'auction') return;
	assert.equal(result.data.squareIndex, 2);
	assert.equal(result.data.squareName, 'B');
	assert.equal(result.data.currentBid, 50);
	assert.equal(result.data.highestBidderName, 'Ana');
});

test('an inactive auction does not open the modal', () => {
	const result = desiredModal(state({
		activeAuction: {
			squareIndex: 2, squareName: 'B', startingPrice: 1, currentBid: 0,
			bids: [], passedPlayers: [], startedAt: '', initiatorPlayerId: 'p1', isActive: false,
		},
	}), 'me');
	assert.deepEqual(result, { kind: 'none' });
});

test('a player who already passed gets no auction modal', () => {
	const result = desiredModal(state({
		activeAuction: {
			squareIndex: 2, squareName: 'B', startingPrice: 1, currentBid: 0,
			bids: [], passedPlayers: ['me', 'p3'], startedAt: '', initiatorPlayerId: 'p1', isActive: true,
		},
	}), 'me');
	assert.deepEqual(result, { kind: 'none' });
});

test('currentBid and highestBidderName default cleanly when absent', () => {
	const result = desiredModal(state({
		activeAuction: {
			squareIndex: 2, squareName: 'B', startingPrice: 1, currentBid: 0,
			bids: [], passedPlayers: [], startedAt: '', initiatorPlayerId: 'p1', isActive: true,
		},
	}), 'me');
	assert.equal(result.kind, 'auction');
	if (result.kind !== 'auction') return;
	assert.equal(result.data.currentBid, 0);
	assert.equal(result.data.highestBidderName, null);
});

test('secondsRemaining is estimated from the bid window and the current phase start', () => {
	const now = Date.parse('2024-01-01T00:00:04Z'); // 4s into the window
	const result = desiredModal(state({
		activeAuction: {
			squareIndex: 2, squareName: 'B', startingPrice: 1, currentBid: 0,
			bids: [], passedPlayers: [], startedAt: '', initiatorPlayerId: 'p1', isActive: true,
			bidTimeout: '00:00:10',
			currentPhaseStartedAt: '2024-01-01T00:00:00Z',
		},
	}), 'me', now);
	assert.equal(result.kind, 'auction');
	if (result.kind !== 'auction') return;
	assert.equal(result.data.secondsRemaining, 6);
});

test('secondsRemaining never goes negative and falls back to the full window without a phase start', () => {
	const expired = desiredModal(state({
		activeAuction: {
			squareIndex: 2, squareName: 'B', startingPrice: 1, currentBid: 0,
			bids: [], passedPlayers: [], startedAt: '', initiatorPlayerId: 'p1', isActive: true,
			bidTimeout: '00:00:10',
			currentPhaseStartedAt: '2024-01-01T00:00:00Z',
		},
	}), 'me', Date.parse('2024-01-01T00:01:00Z'));
	assert.equal(expired.kind === 'auction' && expired.data.secondsRemaining, 0);

	const noStart = desiredModal(state({
		activeAuction: {
			squareIndex: 2, squareName: 'B', startingPrice: 1, currentBid: 0,
			bids: [], passedPlayers: [], startedAt: '', initiatorPlayerId: 'p1', isActive: true,
			bidTimeout: '00:00:15',
		},
	}), 'me');
	assert.equal(noStart.kind === 'auction' && noStart.data.secondsRemaining, 15);
});

// ── Trade ──────────────────────────────────────────────────────────────────

const tradeState = (overrides: Partial<GameState['activeTrade'] & object> = {}) => state({
	squares: ring(),
	activeTrade: {
		id: 't1',
		initiatorId: 'p1',
		initiatorName: 'Ana',
		targetId: 'me',
		targetName: 'Me',
		initiator: { properties: [1], money: 100, releasePasses: 0 },
		target: { properties: [2], money: 0, releasePasses: 1 },
		isActive: true,
		...overrides,
	},
});

test('the trade target sees the review modal with enriched offer sides', () => {
	const result = desiredModal(tradeState(), 'me');
	assert.equal(result.kind, 'tradeReview');
	if (result.kind !== 'tradeReview') return;
	assert.equal(result.data.tradeId, 't1');
	assert.equal(result.data.initiatorName, 'Ana');
	// offered = what the initiator gives (square 1 "A"), requested = what I give (square 2 "B").
	// The group-name key rides along so the review can NAME the colour group (a package
	// board's raw colour is a hex, useless to say aloud).
	assert.deepEqual(result.data.offered.properties,
		[{ index: 1, name: 'A', color: 'brown', groupNameKey: 'game.color_brown', price: undefined }]);
	assert.equal(result.data.offered.money, 100);
	assert.deepEqual(result.data.requested.properties,
		[{ index: 2, name: 'B', color: 'red', groupNameKey: 'game.color_red', price: 200 }]);
	assert.equal(result.data.requested.releasePasses, 1);
});

test('the trade initiator sees the waiting modal', () => {
	const result = desiredModal(tradeState(), 'p1');
	assert.equal(result.kind, 'tradeWaiting');
	if (result.kind !== 'tradeWaiting') return;
	assert.equal(result.data.tradeId, 't1');
	assert.equal(result.data.targetName, 'Me');
});

test('a third party sees no trade modal', () => {
	assert.deepEqual(desiredModal(tradeState(), 'p3'), { kind: 'none' });
});

test('an inactive trade opens no modal', () => {
	assert.deepEqual(desiredModal(tradeState({ isActive: false }), 'me'), { kind: 'none' });
});

// ── Priority ─────────────────────────────────────────────────────────────────

test('an active auction takes priority over a pending trade', () => {
	const result = desiredModal(state({
		squares: ring(),
		activeAuction: {
			squareIndex: 2, squareName: 'B', startingPrice: 1, currentBid: 0,
			bids: [], passedPlayers: [], startedAt: '', initiatorPlayerId: 'p1', isActive: true,
		},
		activeTrade: {
			id: 't1', initiatorId: 'p1', initiatorName: 'Ana', targetId: 'me', targetName: 'Me',
			initiator: { properties: [], money: 0, releasePasses: 0 },
			target: { properties: [], money: 0, releasePasses: 0 }, isActive: true,
		},
	}), 'me');
	assert.equal(result.kind, 'auction');
});

// ── Race family: the pending piece choice is the single blocking modal ────────

test('a pending race move for ME resolves to the raceChoice modal', () => {
	const state = {
		gameType: 'race',
		race: {
			seats: [], consecutiveSixes: 0, pendingBonuses: [], pendingBonusKinds: [],
			pendingMove: { playerId: 'me', steps: 3, kind: 'roll', rolled: 3, options: [{ pieceIndex: 0, toLocation: 'circuit', toSquare: 4 }] },
		},
		players: [], bank: { money: 0 }, currentTurn: 'me', ownership: [], squares: [],
	} as any;
	const desired = desiredModal(state, 'me');
	assert.equal(desired.kind, 'raceChoice');
	assert.equal((desired as any).data.steps, 3);
});

test('another player\'s pending race move shows me nothing', () => {
	const state = {
		gameType: 'race',
		race: {
			seats: [], consecutiveSixes: 0, pendingBonuses: [], pendingBonusKinds: [],
			pendingMove: { playerId: 'rival', steps: 3, kind: 'roll', rolled: 3, options: [] },
		},
		players: [], bank: { money: 0 }, currentTurn: 'rival', ownership: [], squares: [],
	} as any;
	assert.equal(desiredModal(state, 'me').kind, 'none');
});

test('a trade review names properties as the PLAYER reads them, not canonically', () => {
	// Live-play report: "en los tratos, cuando dice tú das / tú recibes, las propiedades aparecen
	// en inglés aunque el juego esté en español". The authoritative state carries the board's
	// canonical names; GameManager.getSquares() resolves them to the player's language, and the
	// review has to use THAT — the rest of the board already does.
	const canonical = [
		{ id: 0, name: 'Go', x: 0, y: 0 },
		{ id: 1, name: 'Orion Hyperspace Station', x: 0, y: 1, color: 'blue', price: 200 },
	] as Square[];
	const localized = [
		canonical[0],
		{ ...canonical[1], name: 'Estación Hiperespacial Orión' },
	] as Square[];

	const withTrade = state({
		squares: canonical,
		activeTrade: {
			id: 't1', isActive: true,
			initiatorId: 'other', initiatorName: 'Berto',
			targetId: 'me', targetName: 'Ana',
			initiator: { properties: [1], money: 0, releasePasses: 0 },
			target: { properties: [], money: 50, releasePasses: 0 },
		},
	});

	const review = desiredModal(withTrade, 'me', Date.now(), localized);

	assert.equal(review.kind, 'tradeReview');
	assert.equal((review as { data: TradeReviewModalData }).data.offered.properties[0].name,
		'Estación Hiperespacial Orión');
});

test('without localized squares the review still names the property, canonically', () => {
	// A missing translation must never leave the offer blank — the canonical name is worse than
	// the player's own language, but far better than nothing.
	const canonical = [
		{ id: 0, name: 'Go', x: 0, y: 0 },
		{ id: 1, name: 'Orion Hyperspace Station', x: 0, y: 1 },
	] as Square[];

	const review = desiredModal(state({
		squares: canonical,
		activeTrade: {
			id: 't1', isActive: true,
			initiatorId: 'other', initiatorName: 'Berto',
			targetId: 'me', targetName: 'Ana',
			initiator: { properties: [1], money: 0, releasePasses: 0 },
			target: { properties: [], money: 0, releasePasses: 0 },
		},
	}), 'me');

	assert.equal((review as { data: TradeReviewModalData }).data.offered.properties[0].name,
		'Orion Hyperspace Station');
});
