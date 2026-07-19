import test from 'node:test';
import assert from 'node:assert/strict';
import { squareMenuActions, type SquareMenuContext } from '../src/squareMenu.js';
import type { Square, PendingPurchase } from '../src/models.js';

/**
 * Pure-logic tests for the board square contextual menu: which actions (build / sell /
 * mortgage / unmortgage / buy) a square offers the local player, and whether each is
 * affordable. Info is added by the dialog, not here, so it never appears in this list.
 */

function sq(partial: Partial<Square>): Square {
	return { id: 0, name: 'Sq', x: 0, y: 0, ...partial } as Square;
}

function ctx(overrides: Partial<SquareMenuContext> = {}): SquareMenuContext {
	return {
		squares: [],
		index: 0,
		myId: 'me',
		currentTurn: 'me',
		myMoney: 1500,
		pendingPurchase: null,
		...overrides,
	};
}

// A full brown colour group owned by "me" (house cost 50, price 100).
function brownFullGroup(first: Partial<Square>): Square[] {
	return [
		sq({ id: 0, name: 'Brown 1', type: 'property', color: 'brown', price: 100, buildingCost: 50, ownerId: 'me', ...first }),
		sq({ id: 1, name: 'Brown 2', type: 'property', color: 'brown', price: 100, buildingCost: 50, ownerId: 'me' }),
	];
}

test('non-ownable squares (tax, go, ...) offer no actions', () => {
	const squares = [sq({ type: 'tax', name: 'Income Tax' })];
	assert.deepEqual(squareMenuActions(ctx({ squares })), []);
});

test('a property I do not own and cannot buy offers no actions', () => {
	const squares = [sq({ type: 'property', color: 'brown', price: 100, ownerId: 'other' })];
	assert.deepEqual(squareMenuActions(ctx({ squares })), []);
});

test('owning the full group with no buildings offers build and mortgage', () => {
	const actions = squareMenuActions(ctx({ squares: brownFullGroup({}) }));
	assert.deepEqual(actions.map(a => a.id), ['build', 'mortgage']);
	const build = actions[0];
	assert.equal(build.enabled, true);
	assert.equal(build.amount, 50);
	assert.equal(build.big, false);
	assert.equal(actions[1].amount, 50); // mortgage = 50% of 100
});

test('build is disabled with a shortfall reason when I cannot afford it', () => {
	const actions = squareMenuActions(ctx({ squares: brownFullGroup({}), myMoney: 30 }));
	const build = actions.find(a => a.id === 'build')!;
	assert.equal(build.enabled, false);
	assert.equal(build.reasonKey, 'game.square_menu_need_money');
	assert.deepEqual(build.reasonVars, { amount: 20 }); // 50 - 30
});

test('build is flagged as a hotel once the lot has four houses', () => {
	const actions = squareMenuActions(ctx({ squares: brownFullGroup({ smallBuildings: 4 }) }));
	const build = actions.find(a => a.id === 'build')!;
	assert.equal(build.big, true);
});

test('with houses present, offers build and sell house but not mortgage', () => {
	const actions = squareMenuActions(ctx({ squares: brownFullGroup({ smallBuildings: 2 }) }));
	assert.deepEqual(actions.map(a => a.id), ['build', 'sellHouse']);
	assert.equal(actions.find(a => a.id === 'sellHouse')!.amount, 25); // half of house cost
});

test('with a hotel, offers only sell hotel (no build, no mortgage)', () => {
	const actions = squareMenuActions(ctx({ squares: brownFullGroup({ smallBuildings: 4, bigBuildings: 1 }) }));
	assert.deepEqual(actions.map(a => a.id), ['sellHotel']);
});

test('a mortgaged property offers only lifting the mortgage', () => {
	const actions = squareMenuActions(ctx({ squares: brownFullGroup({ mortgaged: true }) }));
	assert.deepEqual(actions.map(a => a.id), ['unmortgage']);
	// 50 (mortgage value) * 1.1 = 55.
	assert.equal(actions[0].amount, 55);
	assert.equal(actions[0].enabled, true);
});

test('lifting a mortgage is disabled with a reason when I cannot afford it', () => {
	const actions = squareMenuActions(ctx({ squares: brownFullGroup({ mortgaged: true }), myMoney: 40 }));
	const a = actions[0];
	assert.equal(a.enabled, false);
	assert.deepEqual(a.reasonVars, { amount: 15 }); // 55 - 40
});

test('owning a property without the full group offers only mortgage', () => {
	const squares = [
		sq({ id: 0, name: 'Brown 1', type: 'property', color: 'brown', price: 100, buildingCost: 50, ownerId: 'me' }),
		sq({ id: 1, name: 'Brown 2', type: 'property', color: 'brown', price: 100, buildingCost: 50, ownerId: 'other' }),
	];
	assert.deepEqual(squareMenuActions(ctx({ squares })).map(a => a.id), ['mortgage']);
});

test('a railroad I own offers only mortgage (no building)', () => {
	const squares = [sq({ type: 'railroad', name: 'North', price: 200, ownerId: 'me' })];
	assert.deepEqual(squareMenuActions(ctx({ squares })).map(a => a.id), ['mortgage']);
});

const pending = (squareIndex: number, price: number): PendingPurchase =>
	({ playerId: 'me', squareIndex, squareName: 'Brown 1', price });

test('offers buy on my turn for the pending purchase square', () => {
	const squares = [sq({ type: 'property', color: 'brown', price: 100 })];
	const actions = squareMenuActions(ctx({ squares, pendingPurchase: pending(0, 100) }));
	assert.deepEqual(actions.map(a => a.id), ['buy']);
	assert.equal(actions[0].enabled, true);
	assert.equal(actions[0].amount, 100);
});

test('buy is disabled with a reason when I cannot afford it', () => {
	const squares = [sq({ type: 'property', color: 'brown', price: 100 })];
	const actions = squareMenuActions(ctx({ squares, pendingPurchase: pending(0, 100), myMoney: 70 }));
	assert.equal(actions[0].enabled, false);
	assert.deepEqual(actions[0].reasonVars, { amount: 30 });
});

test('no buy when it is not my turn', () => {
	const squares = [sq({ type: 'property', color: 'brown', price: 100 })];
	const actions = squareMenuActions(ctx({ squares, pendingPurchase: pending(0, 100), currentTurn: 'other' }));
	assert.deepEqual(actions, []);
});

test('no buy when the pending purchase is for another square', () => {
	const squares = [sq({ type: 'property', color: 'brown', price: 100 })];
	const actions = squareMenuActions(ctx({ squares, pendingPurchase: pending(5, 100) }));
	assert.deepEqual(actions, []);
});

test('an out-of-range index yields no actions', () => {
	assert.deepEqual(squareMenuActions(ctx({ squares: brownFullGroup({}), index: 99 })), []);
});
