import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSettleGuard } from '../src/settleGuard.js';

// settleGuard: turn-flow commands wait for the client's telling of the current move to
// finish. While settling, the wrapped command must NOT fire and the player hears a reason;
// once settled, the command fires normally.

function harness(initiallySettling: boolean) {
	let settling = initiallySettling;
	let blocked = 0;
	let fired = 0;
	const guard = makeSettleGuard(() => settling, () => { blocked++; });
	const guarded = guard(() => { fired++; });
	return {
		guarded,
		setSettling: (v: boolean) => { settling = v; },
		get blocked() { return blocked; },
		get fired() { return fired; },
	};
}

test('while settling, the command is blocked and the reason is spoken instead', () => {
	const h = harness(true);
	h.guarded();
	assert.equal(h.fired, 0, 'command must not run ahead of the narration');
	assert.equal(h.blocked, 1, 'the player hears why nothing happened');
});

test('once settled, the command fires normally with no reason spoken', () => {
	const h = harness(false);
	h.guarded();
	assert.equal(h.fired, 1);
	assert.equal(h.blocked, 0);
});

test('the probe is read at call time: a blocked press works after the story settles', () => {
	const h = harness(true);
	h.guarded();
	h.setSettling(false);
	h.guarded();
	assert.equal(h.blocked, 1, 'only the mid-story press was refused');
	assert.equal(h.fired, 1, 'the retry goes through');
});
