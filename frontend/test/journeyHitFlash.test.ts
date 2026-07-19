import test from 'node:test';
import assert from 'node:assert/strict';
import { addedHazard } from '../src/journeyBoard.js';

// The victim's dashboard banner names the attack that just LANDED (live-play bug: the
// victim saw nothing identifiable and asked "what happened?"). addedHazard is the pure
// diff that picks WHICH hazard is new between two renders.

test('a fresh hazard on a clean seat is the added one', () => {
	assert.equal(addedHazard([], ['limite']), 'limite');
});

test('the hazard whose COUNT grew wins, even when another kind was already there', () => {
	assert.equal(addedHazard(['pinchazo'], ['pinchazo', 'limite']), 'limite');
});

test('stacked hazards (same kind twice, stackHazards house rule) are detected by count', () => {
	assert.equal(addedHazard(['limite'], ['limite', 'limite']), 'limite');
});

test('no growth means nothing landed (repairs shrink the list, repaints keep it equal)', () => {
	assert.equal(addedHazard(['limite'], ['limite']), null);
	assert.equal(addedHazard(['limite', 'pinchazo'], ['pinchazo']), null);
	assert.equal(addedHazard([], []), null);
});

test('a swap that grows the list still names a NEW kind, not a kept one', () => {
	// e.g. repair removed "pinchazo" while an attack added two others in one update.
	assert.equal(addedHazard(['pinchazo'], ['semaforo', 'limite']), 'semaforo');
});
