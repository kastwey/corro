import test from 'node:test';
import assert from 'node:assert/strict';
import { pickConsequenceState } from '../src/gameManager.js';
import type { GameState } from '../src/models.js';

// Regression (playtest): consequence reads leaked the future. Pressing "f" mid-animation announced
// the Free Parking pot the server had ALREADY grown, and the debt indicator lit up while the
// triggering roll was still travelling on the client. The fix reads a lagged "presentation" state
// for those consequences, advanced only as each segment is revealed. pickConsequenceState is that
// precedence; these pin it so the spoiler can't come back.

const state = (freeParkingPot: number, anyoneInDebt: boolean): GameState =>
	({ bank: { freeParkingPot }, players: [{ id: 'p1', inDebt: anyoneInDebt }] } as unknown as GameState);

test('mid-animation, the REVEALED (presentation) state wins over the authoritative future', () => {
	const revealed = state(0, false);      // what the player has seen land
	const future = state(500, true);       // what the server already applied, token still travelling
	const picked = pickConsequenceState(revealed, future);
	assert.equal(picked, revealed);
	// The "f" pot query and the debt indicator both read the picked state: no spoiler.
	assert.equal(picked?.bank?.freeParkingPot, 0, 'pot shows the revealed value, not the grown one');
});

test('before the first reveal, it falls back to the authoritative state (nothing is animating)', () => {
	const authoritative = state(250, false);
	assert.equal(pickConsequenceState(null, authoritative), authoritative);
	assert.equal(pickConsequenceState(null, authoritative)?.bank?.freeParkingPot, 250);
});

test('with neither state it is null (a fresh manager reads 0 downstream)', () => {
	assert.equal(pickConsequenceState(null, null), null);
});
