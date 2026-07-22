import test from 'node:test';
import assert from 'node:assert/strict';
import { localHandChanged, localHandInstanceIds } from '../src/cardHandState.js';
import type { GameState } from '../src/models.js';

const asState = (value: object): GameState => value as GameState;
const cards = (...ids: string[]) => ids.map(instanceId => ({ instanceId, cardId: instanceId }));

function familyState(family: 'journey' | 'assembly' | 'draft' | 'shedding' | 'exploding', ...ids: string[]): GameState {
	const hand = cards(...ids);
	const familyValue = family === 'journey'
		? { seats: [{ playerId: 'me', members: [{ playerId: 'me', hand, handCount: hand.length }] }] }
		: { seats: [{ playerId: 'me', hand, handCount: hand.length }] };
	return asState({ gameType: family, [family]: familyValue });
}

test('extracts the local projected hand from every card family', () => {
	for (const family of ['journey', 'assembly', 'draft', 'shedding', 'exploding'] as const) {
		assert.deepEqual(localHandInstanceIds(familyState(family, 'a', 'b'), 'me'), ['a', 'b'], family);
	}
});

test('detects additions, removals and replacements but ignores pure hand-order changes', () => {
	for (const family of ['journey', 'assembly', 'draft', 'shedding', 'exploding'] as const) {
		assert.equal(localHandChanged(familyState(family, 'a', 'b'), familyState(family, 'a', 'b', 'c'), 'me'), true);
		assert.equal(localHandChanged(familyState(family, 'a', 'b'), familyState(family, 'a', 'c'), 'me'), true);
		assert.equal(localHandChanged(familyState(family, 'a', 'b'), familyState(family, 'b', 'a'), 'me'), false);
	}
});

test('does not arm hand narration before the first projected state or outside card families', () => {
	assert.equal(localHandChanged(null, familyState('assembly', 'a'), 'me'), false);
	assert.equal(localHandChanged(asState({ gameType: 'property' }), asState({ gameType: 'property' }), 'me'), false);
	assert.equal(localHandChanged(familyState('assembly', 'a'), familyState('assembly', 'a'), null), false);
});
