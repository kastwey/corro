import test from 'node:test';
import assert from 'node:assert/strict';
import { TrackTokenAnimator } from '../src/trackTokenAnimator.js';
import type { GameState } from '../src/models.js';

/**
 * The track piece animator walks a moved piece square by square toward its authoritative
 * position (backwards too — a bounce or a snake may pull it down) and calls onIdle when it
 * lands: that callback settles the announcement gate, so its timing is what makes
 * "dice → hop → consequences" read in order. Timers are driven by hand.
 */

function gameState(positions: Record<string, number>): GameState {
	return {
		gameType: 'track',
		track: { positions: Object.entries(positions).map(([playerId, square]) => ({ playerId, square })) },
	} as unknown as GameState;
}

function makeTimers() {
	const queue: Array<{ fn: () => void; ms: number }> = [];
	return {
		queue,
		setTimer: (fn: () => void, ms: number) => { queue.push({ fn, ms }); return queue.length; },
		tick(): void {
			const next = queue.shift();
			assert.ok(next, 'expected a pending timer');
			next!.fn();
		},
	};
}

function makeAnimator(gs: { state: GameState }) {
	const timers = makeTimers();
	let idleCount = 0, stepCount = 0, motionDisabled = false;
	const animator = new TrackTokenAnimator({
		gameState: () => gs.state,
		render: () => {},
		stepDelayMs: 200,
		firstStepDelayMs: 1100,
		onStep: () => { stepCount++; },
		onIdle: () => { idleCount++; },
		motionDisabled: () => motionDisabled,
		setTimer: timers.setTimer,
	});
	return { animator, timers, idleCount: () => idleCount, stepCount: () => stepCount,
		disableMotion: () => { motionDisabled = true; } };
}

test('a first sighting snaps in place and reports idle at once', () => {
	const gs = { state: gameState({ A: 4 }) };
	const h = makeAnimator(gs);
	h.animator.syncFromState();
	assert.equal(h.animator.displayPosition('A'), 4);
	assert.equal(h.idleCount(), 1);
	assert.equal(h.timers.queue.length, 0, 'nothing scheduled');
});

test('a move walks square by square, one hop per tick, and settles once at the end', () => {
	const gs = { state: gameState({ A: 2 }) };
	const h = makeAnimator(gs);
	h.animator.syncFromState();

	gs.state = gameState({ A: 5 });
	h.animator.syncFromState();
	assert.equal(h.animator.isAnimating, true);
	assert.equal(h.timers.queue[0]!.ms, 1100, 'the first hop waits for the dice sound');

	h.timers.tick(); // 2 → 3
	assert.equal(h.animator.displayPosition('A'), 3);
	assert.equal(h.timers.queue[0]!.ms, 200, 'subsequent hops use the step delay');
	h.timers.tick(); // 3 → 4
	h.timers.tick(); // 4 → 5 (lands)
	assert.equal(h.animator.displayPosition('A'), 5);
	assert.equal(h.animator.isAnimating, false);
	assert.equal(h.stepCount(), 3, 'one hop earcon per square');
	assert.equal(h.idleCount(), 2, 'the initial snap plus the single landing settle');
});

test('a snake (or a bounce) walks the piece BACKWARDS to its final square', () => {
	const gs = { state: gameState({ A: 20 }) };
	const h = makeAnimator(gs);
	h.animator.syncFromState();

	gs.state = gameState({ A: 18 });
	h.animator.syncFromState();
	h.timers.tick(); // 20 → 19
	assert.equal(h.animator.displayPosition('A'), 19);
	h.timers.tick(); // 19 → 18
	assert.equal(h.animator.displayPosition('A'), 18);
	assert.equal(h.animator.isAnimating, false);
});

test('a retarget mid-walk redirects the remaining hops to the new authoritative square', () => {
	const gs = { state: gameState({ A: 1 }) };
	const h = makeAnimator(gs);
	h.animator.syncFromState();

	gs.state = gameState({ A: 4 });
	h.animator.syncFromState();
	h.timers.tick(); // 1 → 2
	gs.state = gameState({ A: 2 }); // server correction arrives mid-walk
	h.animator.syncFromState();
	assert.equal(h.animator.displayPosition('A'), 2, 'already there: nothing further to walk');
});

test('motion going off MID-walk (window hidden) snaps the rest silently', () => {
	const gs = { state: gameState({ A: 0 }) };
	const h = makeAnimator(gs);
	h.animator.syncFromState();

	gs.state = gameState({ A: 4 });
	h.animator.syncFromState();
	h.timers.tick(); // hop to 1 (audible)
	assert.equal(h.animator.displayPosition('A'), 1);
	assert.equal(h.stepCount(), 1);

	h.disableMotion(); // the window went hidden: timers are now throttled
	h.timers.tick();   // the pending (late) tick fires…
	assert.equal(h.animator.displayPosition('A'), 4, '…and snaps straight to the destination');
	assert.equal(h.stepCount(), 1, 'no hop earcons for the silent snap');
	assert.equal(h.animator.isAnimating, false);
});

test('with motion off the piece snaps and consequences release immediately', () => {
	const gs = { state: gameState({ A: 2 }) };
	const h = makeAnimator(gs);
	h.animator.syncFromState();
	h.disableMotion();

	gs.state = gameState({ A: 9 });
	h.animator.syncFromState();
	assert.equal(h.animator.displayPosition('A'), 9);
	assert.equal(h.animator.isAnimating, false);
	assert.equal(h.timers.queue.length, 0);
	assert.equal(h.idleCount(), 2);
});
