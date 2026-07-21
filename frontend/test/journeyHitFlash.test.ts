import test from 'node:test';
import assert from 'node:assert/strict';
import { addedHazard } from '../src/journeyBoard.js';

// The victim's dashboard banner names the attack that just LANDED (live-play bug: the
// victim saw nothing identifiable and asked "what happened?"). addedHazard is the pure
// diff that picks WHICH hazard is new between two renders.

test('a fresh hazard on a clean seat is the added one', () => {
	assert.equal(addedHazard([], ['speed-limit']), 'speed-limit');
});

test('the hazard whose COUNT grew wins, even when another kind was already there', () => {
	assert.equal(addedHazard(['flat-tyre'], ['flat-tyre', 'speed-limit']), 'speed-limit');
});

test('stacked hazards (same kind twice, stackHazards house rule) are detected by count', () => {
	assert.equal(addedHazard(['speed-limit'], ['speed-limit', 'speed-limit']), 'speed-limit');
});

test('no growth means nothing landed (repairs shrink the list, repaints keep it equal)', () => {
	assert.equal(addedHazard(['speed-limit'], ['speed-limit']), null);
	assert.equal(addedHazard(['speed-limit', 'flat-tyre'], ['flat-tyre']), null);
	assert.equal(addedHazard([], []), null);
});

test('a swap that grows the list still names a NEW kind, not a kept one', () => {
	// e.g. repair removed "flat-tyre" while an attack added two others in one update.
	assert.equal(addedHazard(['flat-tyre'], ['red-light', 'speed-limit']), 'red-light');
});
