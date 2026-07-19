import test from 'node:test';
import assert from 'node:assert/strict';
import { RaceTokenAnimator } from '../src/raceTokenAnimator.js';
import type { GameState, RaceBoardDef, RaceState } from '../src/models.js';

/**
 * The race piece animator walks each moved piece square by square toward its authoritative
 * position and calls onIdle when the LAST travelling piece lands — that callback is what
 * settles the announcement gate, so its timing is what makes "dice → hop → consequences"
 * read in order. These tests drive the timers by hand to pin: the hop path, the single
 * settle, snap-on-unpathable transitions (exits from home), retargets silencing the stale
 * chain, and the reduced-motion snap.
 */

const BOARD: RaceBoardDef = {
	circuitLength: 20,
	corridorLength: 3,
	piecesPerPlayer: 2,
	safeSquares: [1, 11],
	seats: [
		{ id: 'sa', startSquare: 1, corridorEntry: 20 },
		{ id: 'sb', startSquare: 11, corridorEntry: 10 },
	],
};

type PieceSpec = { location: 'home' | 'circuit' | 'corridor' | 'goal'; square: number };

function gameState(aPieces: PieceSpec[], bPieces: PieceSpec[] = [{ location: 'home', square: 0 }]): GameState {
	const race: RaceState = {
		seats: [
			{ playerId: 'A', seatId: 'sa', pieces: aPieces.map(p => ({ ...p })) },
			{ playerId: 'B', seatId: 'sb', pieces: bPieces.map(p => ({ ...p })) },
		],
		consecutiveSixes: 0,
		pendingBonuses: [],
		pendingBonusKinds: [],
	};
	return { gameType: 'race', race, raceBoard: BOARD } as unknown as GameState;
}

/** Manual timer queue: each scheduled callback is run explicitly by the test. */
function makeTimers() {
	const queue: Array<{ fn: () => void; ms: number }> = [];
	return {
		queue,
		setTimer: (fn: () => void, ms: number) => { queue.push({ fn, ms }); return queue.length; },
		clearTimer: () => {},
		/** Runs the oldest pending callback (FIFO — delays are inspected, not simulated). */
		tick(): void {
			const next = queue.shift();
			assert.ok(next, 'expected a pending timer');
			next!.fn();
		},
	};
}

function makeAnimator(gs: { state: GameState }) {
	const timers = makeTimers();
	let idleCount = 0;
	let renderCount = 0;
	let motionDisabled = false;
	const animator = new RaceTokenAnimator({
		raceBoard: () => ({} as any), // getPath only checks it exists
		gameState: () => gs.state,
		render: () => { renderCount++; },
		stepDelayMs: 200,
		firstStepDelayMs: 1100,
		motionDisabled: () => motionDisabled,
		onIdle: () => { idleCount++; },
		setTimer: timers.setTimer,
		clearTimer: timers.clearTimer,
	});
	return {
		animator, timers,
		idleCount: () => idleCount,
		renderCount: () => renderCount,
		disableMotion: () => { motionDisabled = true; },
	};
}

test('a circuit move walks square by square and settles exactly once at the end', () => {
	const gs = { state: gameState([{ location: 'circuit', square: 2 }]) };
	const h = makeAnimator(gs);

	gs.state = gameState([{ location: 'circuit', square: 5 }]);
	h.animator.syncFromState();

	assert.equal(h.animator.isAnimating, true, 'animating starts synchronously with the state apply');
	// First hop waits for the dice earcon; later hops use the step cadence.
	assert.equal(h.timers.queue[0]!.ms, 1100);
	h.timers.tick(); // → 3
	assert.deepEqual(h.animator.displayPosition(0, 0), { location: 'circuit', square: 3, seatIndex: 0 });
	assert.equal(h.timers.queue[0]!.ms, 200);
	h.timers.tick(); // → 4
	h.timers.tick(); // → 5
	assert.equal(h.animator.isAnimating, true, 'still animating until the settle tick');
	assert.equal(h.idleCount(), 0, 'consequences must not release mid-hop');
	h.timers.tick(); // settle
	assert.equal(h.animator.isAnimating, false);
	assert.equal(h.idleCount(), 1);
	assert.deepEqual(h.animator.displayPosition(0, 0), { location: 'circuit', square: 5, seatIndex: 0 });
});

test('an exit from home SNAPS the display to the circuit square (no walkable path)', () => {
	// Regression: the empty-path early return used to leave the display entry stale, and
	// the board always prefers the display position — the exited piece stayed painted at
	// home forever.
	const gs = { state: gameState([{ location: 'home', square: 0 }]) };
	const h = makeAnimator(gs);

	gs.state = gameState([{ location: 'circuit', square: 1 }]);
	h.animator.syncFromState();

	assert.equal(h.animator.isAnimating, false, 'a snap shows no hop');
	assert.deepEqual(h.animator.displayPosition(0, 0), { location: 'circuit', square: 1, seatIndex: 0 });
	assert.equal(h.timers.queue.length, 0, 'nothing left ticking');
});

test('a piece sent home (three-sixes penalty) snaps back too', () => {
	const gs = { state: gameState([{ location: 'circuit', square: 7 }]) };
	const h = makeAnimator(gs);

	gs.state = gameState([{ location: 'home', square: 0 }]);
	h.animator.syncFromState();

	assert.deepEqual(h.animator.displayPosition(0, 0), { location: 'home', square: 0, seatIndex: 0 });
});

test('a retarget mid-hop silences the stale chain: one settle, at the NEW target', () => {
	const gs = { state: gameState([{ location: 'circuit', square: 2 }]) };
	const h = makeAnimator(gs);

	gs.state = gameState([{ location: 'circuit', square: 4 }]);
	h.animator.syncFromState();
	h.timers.tick(); // → 3 (mid-hop)

	// A fresh authoritative state arrives while the piece is still travelling.
	gs.state = gameState([{ location: 'circuit', square: 6 }]);
	h.animator.syncFromState();

	// The old chain's pending tick is now stale: running it must not move the piece,
	// must not settle, and must not end the animation.
	h.timers.tick();
	assert.equal(h.animator.isAnimating, true);
	assert.equal(h.idleCount(), 0);

	// The new chain walks 3 → 4 → 5 → 6 and settles once.
	h.timers.tick(); // → 4
	h.timers.tick(); // → 5
	h.timers.tick(); // → 6
	h.timers.tick(); // settle
	assert.equal(h.idleCount(), 1);
	assert.equal(h.animator.isAnimating, false);
	assert.deepEqual(h.animator.displayPosition(0, 0), { location: 'circuit', square: 6, seatIndex: 0 });
	assert.equal(h.timers.queue.length, 0);
});

test('a snap retarget of the last travelling piece still settles the animation', () => {
	// If the piece mid-hop is captured (sent home — a snap), nothing else is animating and
	// no chain will ever finish: the snap itself must settle so gated announcements are
	// not left waiting for the safety timeout.
	const gs = { state: gameState([{ location: 'circuit', square: 2 }]) };
	const h = makeAnimator(gs);

	gs.state = gameState([{ location: 'circuit', square: 5 }]);
	h.animator.syncFromState();
	h.timers.tick(); // → 3 (mid-hop)

	gs.state = gameState([{ location: 'home', square: 0 }]);
	h.animator.syncFromState();

	assert.equal(h.animator.isAnimating, false);
	assert.equal(h.idleCount(), 1, 'the snap settles the interrupted animation');
	assert.deepEqual(h.animator.displayPosition(0, 0), { location: 'home', square: 0, seatIndex: 0 });
});

test('motion going off MID-walk (window hidden) jumps to the destination silently', () => {
	const gs = { state: gameState([{ location: 'circuit', square: 1 }]) };
	const h = makeAnimator(gs);
	h.animator.syncFromState();

	gs.state = gameState([{ location: 'circuit', square: 5 }]);
	h.animator.syncFromState();
	h.timers.tick(); // hop onto 2
	const before = h.idleCount();

	h.disableMotion(); // the window went hidden: timers are now throttled
	h.timers.tick();   // the pending (late) tick fires…
	assert.equal(h.animator.isAnimating, false, '…and the walk is over at once');
	assert.equal(h.idleCount(), before + 1, 'settling exactly once');
});

test('reduced motion snaps every move with no hop and no settle', () => {
	const gs = { state: gameState([{ location: 'circuit', square: 2 }]) };
	const h = makeAnimator(gs);
	h.disableMotion();

	gs.state = gameState([{ location: 'circuit', square: 5 }]);
	h.animator.syncFromState();

	assert.equal(h.animator.isAnimating, false);
	assert.equal(h.idleCount(), 0, 'nothing was animating, so there is nothing to settle');
	assert.deepEqual(h.animator.displayPosition(0, 0), { location: 'circuit', square: 5, seatIndex: 0 });
	assert.equal(h.timers.queue.length, 0);
});

test('a move across the ring seam walks 19 → 20 → 1 → 2, never a square 0', () => {
	// Regression: the wrap arithmetic treated squares as 0-based, so the hop crossing the
	// seam landed on a nonexistent square 0 and the piece vanished for that step.
	const gs = { state: gameState([{ location: 'circuit', square: 18 }]) };
	const h = makeAnimator(gs);

	gs.state = gameState([{ location: 'circuit', square: 2 }]);
	h.animator.syncFromState();

	const walked: number[] = [];
	while (h.timers.queue.length > 0) {
		h.timers.tick();
		const pos = h.animator.displayPosition(0, 0)!;
		walked.push(pos.square);
	}
	assert.deepEqual(walked, [19, 20, 1, 2, 2]); // last tick is the settle (position holds)
	assert.equal(h.idleCount(), 1);
});

test('a circuit-to-corridor move walks to the entry and then inside', () => {
	const gs = { state: gameState([{ location: 'circuit', square: 18 }]) };
	const h = makeAnimator(gs);

	gs.state = gameState([{ location: 'corridor', square: 2 }]);
	h.animator.syncFromState();

	h.timers.tick(); // → 19
	h.timers.tick(); // → 20 (seat sa's corridor entry)
	assert.deepEqual(h.animator.displayPosition(0, 0), { location: 'circuit', square: 20, seatIndex: 0 });
	h.timers.tick(); // → corridor 1
	assert.deepEqual(h.animator.displayPosition(0, 0), { location: 'corridor', square: 1, seatIndex: 0 });
	h.timers.tick(); // → corridor 2
	h.timers.tick(); // settle
	assert.equal(h.idleCount(), 1);
	assert.deepEqual(h.animator.displayPosition(0, 0), { location: 'corridor', square: 2, seatIndex: 0 });
});
