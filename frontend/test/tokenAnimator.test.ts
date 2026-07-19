import test from 'node:test';
import assert from 'node:assert/strict';
import { animationSteps, TokenAnimator } from '../src/tokenAnimator.js';

// ── Pure path helper ───────────────────────────────────────────────────────────

test('animationSteps walks forward over the squares between from and to', () => {
	assert.deepEqual(animationSteps(0, 3, 40), [1, 2, 3]);
});

test('animationSteps wraps forward across GO (square 0)', () => {
	assert.deepEqual(animationSteps(38, 2, 40), [39, 0, 1, 2]);
});

test('animationSteps steps backward when that is the shorter way (e.g. go back 3)', () => {
	assert.deepEqual(animationSteps(20, 17, 40), [19, 18, 17]);
});

test('animationSteps returns nothing when there is no movement', () => {
	assert.deepEqual(animationSteps(7, 7, 40), []);
	assert.deepEqual(animationSteps(5, 9, 0), []);
});

// ── Animator with an injected fake timer ────────────────────────────────────────

interface Harness {
	animator: TokenAnimator;
	flush: () => void;       // run the single pending timer once
	renders: number;
	idles: number;           // how many times onIdle has fired
	steps: number;           // how many times onStep has fired
	lastDelay: number;       // ms passed to the most recently scheduled timer
	pending: () => boolean;
}

function harness(boardSize = 40, opts: { stepDelayMs?: number; maxAnimatedSteps?: number; firstStepDelayMs?: number; motionDisabled?: () => boolean } = {}): Harness {
	let timerFn: (() => void) | null = null;
	let lastDelay = 0;
	const state = { renders: 0, idles: 0, steps: 0 };
	const animator = new TokenAnimator({
		boardSize: () => boardSize,
		render: () => { state.renders++; },
		stepDelayMs: opts.stepDelayMs,
		firstStepDelayMs: opts.firstStepDelayMs,
		maxAnimatedSteps: opts.maxAnimatedSteps,
		motionDisabled: opts.motionDisabled,
		onStep: () => { state.steps++; },
		onIdle: () => { state.idles++; },
		setTimer: (fn, ms) => { timerFn = fn; lastDelay = ms; return 1; },
		clearTimer: () => { timerFn = null; },
	});
	return {
		animator,
		get renders() { return state.renders; },
		get idles() { return state.idles; },
		get steps() { return state.steps; },
		get lastDelay() { return lastDelay; },
		pending: () => timerFn !== null,
		flush: () => { const fn = timerFn; timerFn = null; if (fn) fn(); },
	} as Harness;
}

test('the first sighting of a player places the token instantly, no animation', () => {
	const h = harness();
	h.animator.sync(new Map([['a', 5]]));
	assert.equal(h.animator.displayPosition('a', 5), 5);
	assert.equal(h.animator.isAnimating, false);
	assert.equal(h.pending(), false);
});

test('a multi-square move advances one square per tick and renders each step', () => {
	const h = harness();
	h.animator.sync(new Map([['a', 0]]));      // place at GO
	h.animator.sync(new Map([['a', 3]]));      // roll a 3
	assert.equal(h.animator.isAnimating, true);

	h.flush();
	assert.equal(h.animator.displayPosition('a', 3), 1);
	h.flush();
	assert.equal(h.animator.displayPosition('a', 3), 2);
	h.flush();
	assert.equal(h.animator.displayPosition('a', 3), 3);
	assert.equal(h.animator.isAnimating, false);
	assert.equal(h.renders, 3);
	assert.equal(h.pending(), false); // stops once it arrives
});

test('a move longer than maxAnimatedSteps snaps instantly (e.g. go to holding)', () => {
	const h = harness(40, { maxAnimatedSteps: 12 });
	h.animator.sync(new Map([['a', 30]]));
	h.animator.sync(new Map([['a', 10]])); // 20 forward / 20 back — both exceed 12
	assert.equal(h.animator.displayPosition('a', 10), 10);
	assert.equal(h.animator.isAnimating, false);
});

test('a per-move snap teleports even a SHORT move (e.g. going to holding from nearby)', () => {
	const h = harness();
	h.animator.sync(new Map([['a', 6]]));                 // place near holding
	h.animator.sync(new Map([['a', 10]]), new Set(['a'])); // 4 squares: would animate, but snap wins
	assert.equal(h.animator.displayPosition('a', 10), 10); // placed at once, no slide
	assert.equal(h.animator.isAnimating, false);
	// A player NOT in the snap set still animates its short move.
	h.animator.sync(new Map([['a', 10], ['b', 0]]));
	h.animator.sync(new Map([['a', 10], ['b', 3]]), new Set(['a']));
	assert.equal(h.animator.isPlayerMoving('b'), true);
});

test('the default cap animates a full two-dice roll (up to 12 squares)', () => {
	const h = harness(); // no maxAnimatedSteps override → the production default
	h.animator.sync(new Map([['a', 0]]));
	h.animator.sync(new Map([['a', 12]]));
	assert.equal(h.animator.isAnimating, true, 'a 12-square roll walks square by square');
	assert.equal(h.animator.isPlayerMoving('a'), true);
});

test('the default cap snaps a move beyond an ordinary roll', () => {
	const h = harness();
	h.animator.sync(new Map([['a', 0]]));
	h.animator.sync(new Map([['a', 13]]));
	assert.equal(h.animator.displayPosition('a', 13), 13);
	assert.equal(h.animator.isAnimating, false);
});

// ── motionDisabled (reduced-motion / preference: snap instead of hop) ───────────────

test('motion going off MID-journey (window hidden) snaps the rest silently', () => {
	let disabled = false;
	const h = harness(40, { motionDisabled: () => disabled });
	h.animator.sync(new Map([['a', 0]]));
	h.animator.sync(new Map([['a', 4]])); // journey 0 → 4 begins
	h.flush(); // hop to 1 (audible)
	assert.equal(h.animator.displayPosition('a', 4), 1);
	assert.equal(h.steps, 1);

	disabled = true; // the window is hidden: its timers are now throttled
	h.flush(); // the pending (late) tick fires…
	assert.equal(h.animator.displayPosition('a', 4), 4, '…and snaps straight to the destination');
	assert.equal(h.steps, 1, 'no hop earcons for the silent snap');
	assert.equal(h.idles, 1, 'the journey settles once');
	assert.equal(h.pending(), false, 'nothing left scheduled');
});

test('motionDisabled snaps every move to its square, never animating', () => {
	const h = harness(40, { motionDisabled: () => true });
	h.animator.sync(new Map([['a', 0]]));   // first sighting
	h.animator.sync(new Map([['a', 3]]));   // a short roll that would normally hop
	assert.equal(h.animator.displayPosition('a', 3), 3, 'jumps straight to the target');
	assert.equal(h.animator.isAnimating, false, 'no hop in progress');
	assert.equal(h.pending(), false, 'no timer scheduled');
	assert.equal(h.steps, 0, 'no hop earcon');
});

test('motionDisabled leaves isPlayerMoving false so consequences are not held back', () => {
	const h = harness(40, { motionDisabled: () => true });
	h.animator.sync(new Map([['a', 0]]));
	h.animator.sync(new Map([['a', 4]]));
	assert.equal(h.animator.isPlayerMoving('a'), false);
});

test('motionDisabled is read per move, so toggling it back on resumes hopping', () => {
	let disabled = true;
	const h = harness(40, { motionDisabled: () => disabled });
	h.animator.sync(new Map([['a', 0]]));
	h.animator.sync(new Map([['a', 3]]));   // snaps while disabled
	assert.equal(h.animator.isAnimating, false);

	disabled = false;
	h.animator.sync(new Map([['a', 6]]));   // now it should walk
	assert.equal(h.animator.isAnimating, true);
	assert.equal(h.animator.isPlayerMoving('a'), true);
});

test('a forward move walks across Start through every intermediate square', () => {
	const h = harness();
	h.animator.sync(new Map([['a', 36]]));     // before the dice roll
	h.animator.sync(new Map([['a', 5]]));      // final spot after dice + bonus jump (crosses GO)
	const visited: number[] = [];
	for (let i = 0; i < 9; i++) { h.flush(); visited.push(h.animator.displayPosition('a', 5)); }
	assert.deepEqual(visited, [37, 38, 39, 0, 1, 2, 3, 4, 5]);
	assert.equal(h.animator.isAnimating, false);
});

test('a non-movement update does not start the timer', () => {
	const h = harness();
	h.animator.sync(new Map([['a', 5]]));
	h.animator.sync(new Map([['a', 5]])); // same position (e.g. a money change elsewhere)
	assert.equal(h.pending(), false);
	assert.equal(h.animator.isAnimating, false);
});

test('isPlayerMoving tracks a single token: true while it walks, false once it lands', () => {
	const h = harness();
	h.animator.sync(new Map([['a', 0], ['b', 10]])); // first sighting, no movement
	assert.equal(h.animator.isPlayerMoving('a'), false);
	assert.equal(h.animator.isPlayerMoving('b'), false);

	h.animator.sync(new Map([['a', 2], ['b', 10]])); // only "a" rolls a 2
	assert.equal(h.animator.isPlayerMoving('a'), true, 'a is travelling');
	assert.equal(h.animator.isPlayerMoving('b'), false, 'b stays put');

	h.flush(); // step onto square 1 — still one step to go
	assert.equal(h.animator.isPlayerMoving('a'), true);

	h.flush(); // land on square 2 — path cleared, back to natural
	assert.equal(h.animator.isPlayerMoving('a'), false);
	assert.equal(h.animator.displayPosition('a', 2), 2);
});

test('a player who leaves the game is forgotten', () => {
	const h = harness();
	h.animator.sync(new Map([['a', 5], ['b', 9]]));
	h.animator.sync(new Map([['a', 5]])); // b left
	assert.equal(h.animator.displayPosition('b', 9), 9); // falls back to authoritative
});

test('reset cancels the pending timer and clears tracked positions', () => {
	const h = harness();
	h.animator.sync(new Map([['a', 0]]));
	h.animator.sync(new Map([['a', 4]]));
	assert.equal(h.pending(), true);
	h.animator.reset();
	assert.equal(h.pending(), false);
	assert.equal(h.animator.isAnimating, false);
});

// ── visiblePlayers (defer revealing where a moving token will land) ─────────────────

test('visiblePlayers reports a mid-hop token at its VISIBLE square, not its destination', () => {
	const h = harness();
	h.animator.sync(new Map([['a', 0], ['b', 10]])); // first sighting, settled
	h.animator.sync(new Map([['a', 3]]));            // a rolls a 3 → animating to 3

	// Authoritative state already says a.position === 3, but the token is still at GO.
	const players = [{ id: 'a', position: 3 }, { id: 'b', position: 10 }];
	let visible = h.animator.visiblePlayers(players);
	assert.equal(visible.find(p => p.id === 'a')!.position, 0, 'still shown at GO while travelling');
	assert.equal(visible.find(p => p.id === 'b')!.position, 10, 'a settled token is unchanged');

	h.flush(); // hop onto square 1
	visible = h.animator.visiblePlayers(players);
	assert.equal(visible.find(p => p.id === 'a')!.position, 1);

	h.flush(); h.flush(); // land on square 3
	visible = h.animator.visiblePlayers(players);
	assert.equal(visible.find(p => p.id === 'a')!.position, 3, 'destination revealed only once settled');
});

test('visiblePlayers returns the same objects when nothing is moving', () => {
	const h = harness();
	h.animator.sync(new Map([['a', 5]]));
	const players = [{ id: 'a', position: 5 }];
	const visible = h.animator.visiblePlayers(players);
	assert.equal(visible[0], players[0], 'no copy is made for a settled token');
});

// ── onIdle (used to pace consequence reveal to the hop) ────────────────────────────

test('onIdle fires once when the last travelling token lands, not on intermediate steps', () => {
	const h = harness();
	h.animator.sync(new Map([['a', 0]]));
	h.animator.sync(new Map([['a', 3]])); // roll a 3
	assert.equal(h.idles, 0);

	h.flush(); // square 1
	assert.equal(h.idles, 0, 'no idle mid-journey');
	h.flush(); // square 2
	assert.equal(h.idles, 0);
	h.flush(); // lands on square 3
	assert.equal(h.idles, 1, 'idle fires exactly once on landing');
	assert.equal(h.animator.isAnimating, false);
});

test('onIdle does NOT fire for a snap (a move applied without any animated step)', () => {
	const h = harness(40, { maxAnimatedSteps: 12 });
	h.animator.sync(new Map([['a', 30]]));
	h.animator.sync(new Map([['a', 10]])); // 20 squares either way — snaps, never steps
	assert.equal(h.animator.isAnimating, false);
	assert.equal(h.idles, 0, 'a snap shows no hop, so nothing is paced to it');
});

test('onIdle fires once per movement when several tokens travel together', () => {
	const h = harness();
	h.animator.sync(new Map([['a', 0], ['b', 0]]));
	h.animator.sync(new Map([['a', 2], ['b', 3]])); // a needs 2 steps, b needs 3
	h.flush(); // a->1, b->1
	h.flush(); // a lands on 2 (done), b->2  — a's path cleared but b still travels
	assert.equal(h.idles, 0, 'not idle while b is still moving');
	h.flush(); // b lands on 3 — now everyone is settled
	assert.equal(h.idles, 1);
});

// ── onStep (the per-hop "move token" earcon) ───────────────────────────────────────

test('onStep fires once per visible hop, including the final landing step', () => {
	const h = harness();
	h.animator.sync(new Map([['a', 0]]));
	h.animator.sync(new Map([['a', 3]])); // roll a 3 — three hops
	assert.equal(h.steps, 0, 'no hop sound before the first tick');

	h.flush(); // square 1
	assert.equal(h.steps, 1);
	h.flush(); // square 2
	assert.equal(h.steps, 2);
	h.flush(); // lands on square 3 — the landing hop still sounds
	assert.equal(h.steps, 3);
});

test('onStep does NOT fire for a snap (a move applied without any animated step)', () => {
	const h = harness(40, { maxAnimatedSteps: 12 });
	h.animator.sync(new Map([['a', 30]]));
	h.animator.sync(new Map([['a', 10]])); // 20 squares either way — snaps instantly
	assert.equal(h.steps, 0, 'a silent teleport plays no hop');
});

test('onStep fires once per tick even when several tokens hop together', () => {
	const h = harness();
	h.animator.sync(new Map([['a', 0], ['b', 0]]));
	h.animator.sync(new Map([['a', 2], ['b', 3]])); // a: 2 hops, b: 3 hops
	h.flush(); // a->1, b->1  (both moved, but one shared hop sound)
	assert.equal(h.steps, 1);
	h.flush(); // a lands on 2, b->2
	assert.equal(h.steps, 2);
	h.flush(); // b lands on 3 (a already done — b still moved, so it sounds)
	assert.equal(h.steps, 3);
});

// ── firstStepDelayMs (lead-in so the first hop clears the dice earcon) ────────────────

test('the first hop waits the lead-in delay, then later hops use the step cadence', () => {
	const h = harness(40, { stepDelayMs: 350, firstStepDelayMs: 1100 });
	h.animator.sync(new Map([['a', 0]]));
	h.animator.sync(new Map([['a', 2]])); // roll a 2
	assert.equal(h.lastDelay, 1100, 'first tick is scheduled after the lead-in');
	h.flush(); // first hop
	assert.equal(h.lastDelay, 350, 'subsequent ticks use the regular per-step delay');
	h.flush(); // lands
	assert.equal(h.animator.isAnimating, false);
});

test('each new journey gets its own lead-in, not the step cadence', () => {
	const h = harness(40, { stepDelayMs: 350, firstStepDelayMs: 1100 });
	h.animator.sync(new Map([['a', 0]]));
	h.animator.sync(new Map([['a', 1]])); // one-step move
	assert.equal(h.lastDelay, 1100);
	h.flush(); // lands, journey settles
	assert.equal(h.animator.isAnimating, false);

	h.animator.sync(new Map([['a', 2]])); // a brand-new movement
	assert.equal(h.lastDelay, 1100, 'the next movement leads in again');
});

test('firstStepDelayMs defaults to stepDelayMs when not set', () => {
	const h = harness(40, { stepDelayMs: 350 });
	h.animator.sync(new Map([['a', 0]]));
	h.animator.sync(new Map([['a', 2]]));
	assert.equal(h.lastDelay, 350, 'no lead-in configured → first hop uses the step delay');
});
