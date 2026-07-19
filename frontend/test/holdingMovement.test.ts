import test from 'node:test';
import assert from 'node:assert/strict';
import { holdingTeleports, type HoldingMovementPlayer } from '../src/holdingMovement.js';

// Exercises the "teleport to holding or not" decision: who gets snapped straight to holding (default) vs.
// who animates the walk (board opted in), and that only the moment of ENTERING holding counts.

const P = (id: string, isHeld: boolean): HoldingMovementPlayer => ({ id, isHeld });

test('a player who just entered holding is teleported (default board)', () => {
	const was = new Map<string, boolean>();
	was.set('a', false); // a was free last update
	const snap = holdingTeleports([P('a', true)], was, false);
	assert.deepEqual([...snap], ['a']);
	assert.equal(was.get('a'), true); // snapshot updated
});

test('a board that walks to holding teleports nobody', () => {
	const was = new Map([['a', false]]);
	const snap = holdingTeleports([P('a', true)], was, true /* walkToHolding */);
	assert.equal(snap.size, 0);
	assert.equal(was.get('a'), true); // snapshot still tracked, so a later update sees no fresh entry
});

test('staying in holding across updates is not a fresh entry (no re-teleport)', () => {
	const was = new Map<string, boolean>();
	// First update: a enters holding -> snapped.
	assert.deepEqual([...holdingTeleports([P('a', true)], was, false)], ['a']);
	// Next update: still in holding -> not snapped again (would otherwise re-place every tick).
	assert.equal(holdingTeleports([P('a', true)], was, false).size, 0);
});

test('leaving holding is never a teleport and updates the snapshot', () => {
	const was = new Map([['a', true]]);
	const snap = holdingTeleports([P('a', false)], was, false); // rolled out / paid the release cost
	assert.equal(snap.size, 0);
	assert.equal(was.get('a'), false);
});

test('only the players who transitioned into holding are snapped', () => {
	const was = new Map([['a', false], ['b', true], ['c', false]]);
	// a newly held, b already held, c still free.
	const snap = holdingTeleports([P('a', true), P('b', true), P('c', false)], was, false);
	assert.deepEqual([...snap].sort(), ['a']);
});

test('first sighting (empty history / reconnect) counts an already-held player as an entry', () => {
	const was = new Map<string, boolean>(); // nothing known yet
	const snap = holdingTeleports([P('a', true)], was, false);
	assert.deepEqual([...snap], ['a']); // harmless: the animator places a first-seen token instantly
});
