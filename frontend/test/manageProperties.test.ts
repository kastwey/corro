import test from 'node:test';
import assert from 'node:assert/strict';
import { buildManageableProperties, MORTGAGE_RATE } from '../src/managePropertiesDialog.js';
import type { Square } from '../src/models.js';

// Regression: the manage-properties dialog used to read `square.housePrice` and
// `square.mortgageValue`, fields the server never sends (it sends `buildingCost` and
// `price`). That made "Mortgage (get 0)" / "Build (price 0)" appear. The pure
// projection must derive the values from the fields that actually arrive.

function sq(partial: Partial<Square> & { id: number }): Square {
	return { name: `Square ${partial.id}`, x: 0, y: 0, ...partial } as Square;
}

test('mortgage value is derived as 50% of the face price (not a missing field)', () => {
	const squares: Square[] = [
		sq({ id: 0, name: 'Avenida Central', color: 'blue', price: 400, buildingCost: 200 }),
	];
	const items = buildManageableProperties(squares, new Set([0]));

	assert.equal(items.length, 1);
	assert.equal(items[0].mortgageValue, 200, 'mortgage value must be floor(price * 0.5)');
	assert.equal(items[0].mortgageValue, Math.floor(400 * MORTGAGE_RATE));
});

test('house price maps from the server buildingCost field', () => {
	const squares: Square[] = [
		sq({ id: 0, color: 'red', price: 220, buildingCost: 150 }),
	];
	const items = buildManageableProperties(squares, new Set([0]));
	assert.equal(items[0].housePrice, 150);
});

test('mortgage value floors odd prices like the server cast to int', () => {
	const squares: Square[] = [
		sq({ id: 0, color: 'brown', price: 60, buildingCost: 50 }),
	];
	const items = buildManageableProperties(squares, new Set([0]));
	assert.equal(items[0].mortgageValue, 30);

	const odd = buildManageableProperties([sq({ id: 0, color: 'brown', price: 61, buildingCost: 50 })], new Set([0]));
	assert.equal(odd[0].mortgageValue, 30, 'price 61 -> floor(30.5) = 30');
});

test('canBuild is true only when the whole colour group is owned and buildingCost > 0', () => {
	const squares: Square[] = [
		sq({ id: 0, color: 'green', price: 300, buildingCost: 200 }),
		sq({ id: 1, color: 'green', price: 300, buildingCost: 200 }),
		sq({ id: 2, color: 'green', price: 320, buildingCost: 200 }),
	];

	// Own only two of the three green squares -> cannot build.
	const partial = buildManageableProperties(squares, new Set([0, 1]));
	assert.deepEqual(partial.map(p => p.canBuild), [false, false]);

	// Own the full group -> can build.
	const full = buildManageableProperties(squares, new Set([0, 1, 2]));
	assert.deepEqual(full.map(p => p.canBuild), [true, true, true]);
});

// Regression: the menu used to OFFER "build" on lots where the server would reject it
// (uneven build, or a mortgaged group-mate), so a click produced a server error. The
// projection now hides those actions by dropping canBuild — matching the mortgage rule.
test('canBuild follows the even-build rule: only the least-built lots of the group', () => {
	const squares: Square[] = [
		sq({ id: 0, color: 'green', price: 300, buildingCost: 200, smallBuildings: 1 }),
		sq({ id: 1, color: 'green', price: 300, buildingCost: 200, smallBuildings: 0 }),
		sq({ id: 2, color: 'green', price: 320, buildingCost: 200, smallBuildings: 0 }),
	];
	// Lot 0 already has a house; building there again would open a >1 gap over 1 and 2,
	// so only the two least-built lots may take the next house.
	assert.deepEqual(buildManageableProperties(squares, new Set([0, 1, 2])).map(p => p.canBuild), [false, true, true]);
});

test('canBuild is false for the WHOLE group when any lot in it is mortgaged', () => {
	const squares: Square[] = [
		sq({ id: 0, color: 'green', price: 300, buildingCost: 200 }),
		sq({ id: 1, color: 'green', price: 300, buildingCost: 200, mortgaged: true }),
		sq({ id: 2, color: 'green', price: 320, buildingCost: 200 }),
	];
	assert.deepEqual(buildManageableProperties(squares, new Set([0, 1, 2])).map(p => p.canBuild), [false, false, false]);
});

test('groupHasBuildings flags every lot when any lot in the group is built', () => {
	const built: Square[] = [
		sq({ id: 0, color: 'orange', price: 200, buildingCost: 100, smallBuildings: 0 }),
		sq({ id: 1, color: 'orange', price: 200, buildingCost: 100, smallBuildings: 1 }),
	];
	// Even the building-free lot (0) is flagged, so the dialog hides its mortgage action.
	assert.deepEqual(buildManageableProperties(built, new Set([0, 1])).map(p => p.groupHasBuildings), [true, true]);

	const clean: Square[] = [
		sq({ id: 0, color: 'orange', smallBuildings: 0 }),
		sq({ id: 1, color: 'orange', smallBuildings: 0 }),
	];
	assert.deepEqual(buildManageableProperties(clean, new Set([0, 1])).map(p => p.groupHasBuildings), [false, false]);
});

test('a station-style square (no buildingCost) is never buildable', () => {
	const squares: Square[] = [
		sq({ id: 0, name: 'Estación', type: 'station', price: 200 }),
	];
	const items = buildManageableProperties(squares, new Set([0]));
	assert.equal(items[0].canBuild, false);
	assert.equal(items[0].housePrice, 0);
	assert.equal(items[0].mortgageValue, 100);
});

test('only owned squares are projected', () => {
	const squares: Square[] = [
		sq({ id: 0, color: 'pink', price: 140, buildingCost: 100 }),
		sq({ id: 1, color: 'pink', price: 140, buildingCost: 100 }),
	];
	const items = buildManageableProperties(squares, new Set([1]));
	assert.equal(items.length, 1);
	assert.equal(items[0].index, 1);
});
