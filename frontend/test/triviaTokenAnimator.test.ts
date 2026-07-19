import test from 'node:test';
import assert from 'node:assert/strict';
import { TriviaTokenAnimator, wheelPath } from '../src/triviaTokenAnimator.js';
import type { GameState, TriviaBoardDef } from '../src/models.js';

/**
 * The trivia piece animator walks a moved piece NODE by node along the wheel graph toward its
 * authoritative node, one hop per tick, and calls onIdle when it lands (that settles the
 * announcement gate, so "roll → hop → you land on…" reads in order). The path is the shortest
 * walk over the wheel's edges. Timers are driven by hand.
 */

const BOARD: TriviaBoardDef = {
	spokeLength: 2,
	ring: [
		{ category: 0, wedge: true }, { category: 1, wedge: true }, { category: 2, wedge: true },
		{ category: 3, wedge: true }, { category: 4, wedge: true }, { category: 5, wedge: true },
	],
};

function gameState(nodes: Record<string, string>): GameState {
	return {
		gameType: 'trivia',
		triviaBoard: BOARD,
		trivia: { players: Object.entries(nodes).map(([playerId, node]) => ({ playerId, node, wedges: [] })) },
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
	const animator = new TriviaTokenAnimator({
		gameState: () => gs.state,
		render: () => {},
		stepDelayMs: 220,
		firstStepDelayMs: 400,
		onStep: () => { stepCount++; },
		onIdle: () => { idleCount++; },
		motionDisabled: () => motionDisabled,
		setTimer: timers.setTimer,
	});
	return { animator, timers, idleCount: () => idleCount, stepCount: () => stepCount,
		disableMotion: () => { motionDisabled = true; } };
}

test('wheelPath walks the shortest route over the wheel edges', () => {
	assert.deepEqual(wheelPath(BOARD, 'C', 'R0'), ['S0.1', 'S0.2', 'R0']); // out the spoke to the HQ
	assert.deepEqual(wheelPath(BOARD, 'R0', 'C'), ['S0.2', 'S0.1', 'C']);  // back in the same spoke
	assert.deepEqual(wheelPath(BOARD, 'R0', 'R2'), ['R1', 'R2']);          // around the ring (short way)
	assert.deepEqual(wheelPath(BOARD, 'R0', 'R0'), []);                    // already there
});

test('a first sighting snaps in place and reports idle at once', () => {
	const gs = { state: gameState({ A: 'C' }) };
	const h = makeAnimator(gs);
	h.animator.syncFromState();
	assert.equal(h.animator.displayPosition('A'), 'C');
	assert.equal(h.idleCount(), 1);
	assert.equal(h.timers.queue.length, 0, 'nothing scheduled');
});

test('a move walks node by node, one hop per tick, and settles once at the end', () => {
	const gs = { state: gameState({ A: 'C' }) };
	const h = makeAnimator(gs);
	h.animator.syncFromState();               // first sighting at the centre

	gs.state = gameState({ A: 'R0' });         // A rolls and lands on the R0 headquarters
	h.animator.syncFromState();
	assert.equal(h.animator.displayPosition('A'), 'C', 'still at the origin until the first hop');
	assert.equal(h.timers.queue.length, 1);

	h.timers.tick();                           // hop 1
	assert.equal(h.animator.displayPosition('A'), 'S0.1');
	h.timers.tick();                           // hop 2
	assert.equal(h.animator.displayPosition('A'), 'S0.2');
	h.timers.tick();                           // hop 3 (arrival)
	assert.equal(h.animator.displayPosition('A'), 'R0');

	assert.equal(h.stepCount(), 3, 'one hop earcon per node walked');
	assert.equal(h.idleCount(), 2, 'idle at the first sighting, then once on arrival');
	assert.equal(h.animator.isAnimating, false);
});

test('reduced motion snaps to the destination without walking', () => {
	const gs = { state: gameState({ A: 'C' }) };
	const h = makeAnimator(gs);
	h.animator.syncFromState();
	h.disableMotion();

	gs.state = gameState({ A: 'R0' });
	h.animator.syncFromState();
	assert.equal(h.animator.displayPosition('A'), 'R0', 'snapped straight to the target');
	assert.equal(h.timers.queue.length, 0, 'no walk scheduled');
	assert.equal(h.animator.isAnimating, false);
});
