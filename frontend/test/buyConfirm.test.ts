import test from 'node:test';
import assert from 'node:assert/strict';
import { decideBuyConfirm, type BuyConfirmInput } from '../src/actions/buyConfirm.js';

/**
 * Pure-logic tests for the "Buy" activation guard. The key regression it protects
 * is the duplicate-buy under network lag: after a confirmed purchase the client
 * keeps showing the stale "Buy" action until the authoritative state lands, and a
 * second activation must NOT send another BuyProperty (which the server rejects as
 * NO_PENDING_PURCHASE, surfacing a confusing delayed error).
 */

function input(overrides: Partial<BuyConfirmInput> = {}): BuyConfirmInput {
	return {
		pendingPurchase: { playerId: 'me', squareIndex: 5, price: 100 },
		myId: 'me',
		myMoney: 200,
		inFlightSquare: null,
		...overrides,
	};
}

test('opens the confirmation when there is an affordable pending purchase for me', () => {
	assert.equal(decideBuyConfirm(input()), 'open');
});

test('no pending purchase at all → noPending', () => {
	assert.equal(decideBuyConfirm(input({ pendingPurchase: null })), 'noPending');
});

test('pending purchase belongs to another player → noPending', () => {
	assert.equal(
		decideBuyConfirm(input({ pendingPurchase: { playerId: 'rival', squareIndex: 5, price: 100 } })),
		'noPending',
	);
});

test('I have not been identified yet → noPending', () => {
	assert.equal(decideBuyConfirm(input({ myId: null })), 'noPending');
});

test('a buy for the same square is already in flight → inFlight (prevents the duplicate buy)', () => {
	assert.equal(decideBuyConfirm(input({ inFlightSquare: 5 })), 'inFlight');
});

test('in-flight guard is scoped to the matching square only', () => {
	// A buy in flight for a different square must not block this pending purchase.
	assert.equal(decideBuyConfirm(input({ inFlightSquare: 9 })), 'open');
});

test('in-flight takes precedence over affordability', () => {
	assert.equal(decideBuyConfirm(input({ inFlightSquare: 5, myMoney: 0 })), 'inFlight');
});

test('cannot afford the pending purchase → cannotAfford', () => {
	assert.equal(decideBuyConfirm(input({ myMoney: 50 })), 'cannotAfford');
});

test('exactly enough money is affordable → open', () => {
	assert.equal(decideBuyConfirm(input({ myMoney: 100 })), 'open');
});
