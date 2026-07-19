import test from 'node:test';
import assert from 'node:assert/strict';
import { AnnouncementGate } from '../src/announcementGate.js';
import type { AnnouncementEvent } from '../src/gameClient.js';
import type { AnnounceOptions } from '../src/announcer.js';

// The gate paces an action's `resolve`-phase announcements to the token hop:
//   move-phase line  → spoken immediately (it starts the hop)
//   resolve-phase    → held while the token animates, released when it settles
// Errors (priority), on-demand queries (instant) and client lines (no phase) bypass it.

interface GateHarness {
	gate: AnnouncementGate;
	delivered: Array<{ event: AnnouncementEvent; options?: AnnounceOptions }>;
	setAnimating: (v: boolean) => void;
	fireSafety: () => void;
	safetyArmed: () => boolean;
}

function makeGate(): GateHarness {
	const delivered: Array<{ event: AnnouncementEvent; options?: AnnounceOptions }> = [];
	const animating = { value: false };
	let safetyFn: (() => void) | null = null;
	const gate = new AnnouncementGate({
		deliver: (event, options) => { delivered.push({ event, options }); },
		isAnimating: () => animating.value,
		safetyTimeoutMs: 1000,
		setTimer: (fn) => { safetyFn = fn; return 1; },
		clearTimer: () => { safetyFn = null; },
	});
	return {
		gate,
		delivered,
		setAnimating: (v) => { animating.value = v; },
		fireSafety: () => { const f = safetyFn; safetyFn = null; if (f) f(); },
		safetyArmed: () => safetyFn !== null,
	};
}

const ev = (key: string, phase?: 'move' | 'resolve'): AnnouncementEvent => ({ key, vars: {}, phase });
const keys = (h: GateHarness) => h.delivered.map(d => d.event.key);

test('a move-phase line is delivered immediately', () => {
	const h = makeGate();
	h.gate.announce(ev('game.dice_rolled', 'move'));
	assert.deepEqual(keys(h), ['game.dice_rolled']);
});

test('resolve lines after a move are held while the token hops, then released on settle', () => {
	const h = makeGate();
	h.gate.announce(ev('game.dice_rolled', 'move'));     // arms the gate, spoken now
	h.gate.announce(ev('game.landed_on', 'resolve'));    // held
	h.gate.announce(ev('game.paid_rent', 'resolve'));    // held
	assert.deepEqual(keys(h), ['game.dice_rolled'], 'consequences are buffered');

	h.setAnimating(true);
	h.gate.onStateApplied();                             // hop in progress → keep waiting
	assert.deepEqual(keys(h), ['game.dice_rolled']);

	h.gate.settle();                                     // hop finished → release in order
	assert.deepEqual(keys(h), ['game.dice_rolled', 'game.landed_on', 'game.paid_rent']);
});

test('when the move snaps (no animation) the consequences are released at onStateApplied', () => {
	const h = makeGate();
	h.gate.announce(ev('game.dice_rolled', 'move'));
	h.gate.announce(ev('game.landed_on', 'resolve'));

	h.setAnimating(false);       // long teleport snapped — no hop to wait for
	h.gate.onStateApplied();
	assert.deepEqual(keys(h), ['game.dice_rolled', 'game.landed_on']);
});

test('resolve lines in an action with NO movement are spoken immediately (gate never armed)', () => {
	const h = makeGate();
	h.gate.announce(ev('game.bought_property', 'resolve'));
	h.gate.announce(ev('game.built_house', 'resolve'));
	assert.deepEqual(keys(h), ['game.bought_property', 'game.built_house']);
	// A trailing state update must not double-deliver or stall anything.
	h.gate.onStateApplied();
	assert.deepEqual(keys(h), ['game.bought_property', 'game.built_house']);
});

test('priority and instant announcements bypass the gate even while it is armed', () => {
	const h = makeGate();
	h.gate.announce(ev('game.dice_rolled', 'move'));
	h.gate.announce(ev('game.resolve_line', 'resolve'));    // buffered
	h.gate.announce(ev('serverErrors.SOME', 'resolve'), { priority: true });
	h.gate.announce(ev('_raw', 'resolve'), { instant: true });

	assert.deepEqual(keys(h), ['game.dice_rolled', 'serverErrors.SOME', '_raw'],
		'urgent lines jump the buffer');
});

test('client-created announcements (no phase) are never buffered', () => {
	const h = makeGate();
	h.gate.announce(ev('game.dice_rolled', 'move'));   // arm
	h.gate.announce(ev('game.connected_to_game'));     // no phase → immediate
	assert.deepEqual(keys(h), ['game.dice_rolled', 'game.connected_to_game']);
});

test('the safety net releases buffered consequences if the hop never reports settled', () => {
	const h = makeGate();
	h.gate.announce(ev('game.dice_rolled', 'move'));
	h.gate.announce(ev('game.landed_on', 'resolve'));
	h.gate.onStateApplied();   // no animation started (e.g. dropped state update on reconnect)
	assert.deepEqual(keys(h), ['game.dice_rolled', 'game.landed_on'],
		'with nothing animating onStateApplied already releases');

	// Re-arm to exercise the timer path directly: a move with no following hop at all.
	h.gate.announce(ev('game.roll2', 'move'));
	h.gate.announce(ev('game.land2', 'resolve'));
	assert.equal(h.safetyArmed(), true);
	h.setAnimating(false);     // the hop never started…
	h.fireSafety();            // …so the net flushes the buffer
	assert.deepEqual(keys(h), ['game.dice_rolled', 'game.landed_on', 'game.roll2', 'game.land2']);
});

test('the safety net reschedules (not flushes) while the token is still hopping', () => {
	const h = makeGate();
	h.gate.announce(ev('game.dice_rolled', 'move'));
	h.gate.announce(ev('game.landed_on', 'resolve'));
	h.setAnimating(true);
	h.gate.onStateApplied();   // long hop in progress

	// A long move can outlast one safety window; firing it mid-hop must NOT release early.
	h.fireSafety();
	assert.deepEqual(keys(h), ['game.dice_rolled'], 'consequences stay buffered mid-hop');
	assert.equal(h.safetyArmed(), true, 'the net rescheduled to keep waiting for settle');

	// The real end-of-animation event is what releases them.
	h.setAnimating(false);
	h.gate.settle();
	assert.deepEqual(keys(h), ['game.dice_rolled', 'game.landed_on']);
});

test('a hop that stops without settling is flushed on the next safety poll', () => {
	const h = makeGate();
	h.gate.announce(ev('game.dice_rolled', 'move'));
	h.gate.announce(ev('game.landed_on', 'resolve'));
	h.setAnimating(true);
	h.gate.onStateApplied();

	h.fireSafety();            // still hopping → reschedule
	assert.deepEqual(keys(h), ['game.dice_rolled']);

	h.setAnimating(false);     // hop ended but settle was missed
	h.fireSafety();            // next poll sees no animation → flush
	assert.deepEqual(keys(h), ['game.dice_rolled', 'game.landed_on']);
});

test('settle clears the safety timer so it cannot double-flush later', () => {
	const h = makeGate();
	h.gate.announce(ev('game.dice_rolled', 'move'));
	h.gate.announce(ev('game.landed_on', 'resolve'));
	h.setAnimating(true);
	h.gate.onStateApplied();

	h.gate.settle();
	assert.deepEqual(keys(h), ['game.dice_rolled', 'game.landed_on']);
	assert.equal(h.safetyArmed(), false, 'safety timer was cancelled on release');

	h.fireSafety(); // no-op (already cleared)
	assert.deepEqual(keys(h), ['game.dice_rolled', 'game.landed_on']);
});

test('settle with nothing armed is a no-op (a stray hop end does not replay anything)', () => {
	const h = makeGate();
	h.gate.announce(ev('game.bought_property', 'resolve')); // not armed
	h.gate.settle();
	assert.deepEqual(keys(h), ['game.bought_property']);
});

test('a fresh move re-arms after the previous action was released', () => {
	const h = makeGate();
	// First roll + landing
	h.gate.announce(ev('game.roll1', 'move'));
	h.gate.announce(ev('game.land1', 'resolve'));
	h.setAnimating(true);
	h.gate.onStateApplied();
	h.gate.settle();
	// Second roll (doubles) + landing
	h.gate.announce(ev('game.roll2', 'move'));
	h.gate.announce(ev('game.land2', 'resolve'));
	assert.deepEqual(keys(h), ['game.roll1', 'game.land1', 'game.roll2'], 'land2 held again');
	h.setAnimating(true);
	h.gate.onStateApplied();
	h.gate.settle();
	assert.deepEqual(keys(h), ['game.roll1', 'game.land1', 'game.roll2', 'game.land2']);
});

test('deferVisual runs immediately when the gate is not armed (no movement)', () => {
	const h = makeGate();
	let ran = 0;
	h.gate.deferVisual(() => { ran++; });
	assert.equal(ran, 1, 'no hop in progress → the visual fires at once');
});

test('deferVisual holds the visual until the token settles, alongside the consequences', () => {
	const h = makeGate();
	const order: string[] = [];
	h.gate.announce(ev('game.dice_rolled', 'move'));         // arms the gate
	h.gate.deferVisual(() => { order.push('card'); });       // card reveal — held
	h.gate.announce(ev('game.card_effect', 'resolve'));      // spoken consequence — held
	assert.deepEqual(order, [], 'the card does not flash before the token arrives');

	h.setAnimating(true);
	h.gate.onStateApplied();
	assert.deepEqual(order, [], 'still travelling');

	h.gate.settle();
	assert.deepEqual(keys(h), ['game.dice_rolled', 'game.card_effect']);
	assert.deepEqual(order, ['card'], 'the visual is released with the consequences');
});

test('deferVisual buffered visuals are released even when there are no buffered announcements', () => {
	const h = makeGate();
	let ran = 0;
	h.gate.announce(ev('game.dice_rolled', 'move'));   // arm, but no resolve lines buffered
	h.gate.deferVisual(() => { ran++; });
	assert.equal(ran, 0, 'held while armed');
	h.setAnimating(true);
	h.gate.onStateApplied();
	h.gate.settle();
	assert.equal(ran, 1, 'flush runs visuals regardless of the announcement buffer');
});


// === Live-play 2026-07-12: a handler's deferred RE-EMIT of the applied state must not
// count as a fresh application. The dice handler refreshes the turn indicator 600 ms after
// DICE_ROLLED by re-emitting the CURRENT state; when the real (moved) state was slower than
// that, the re-emit reached onStateApplied with nothing animating and flushed the armed
// gate — the buffered cursor move ran and spoiled the destination before the hop began.

test('a re-emit of the SAME state object does not flush an armed gate (deferred turn refresh)', () => {
	const h = makeGate();
	const preRollState = { turn: 1 };
	h.gate.onStateApplied(preRollState);               // the state on screen before the roll

	let cursorMoved = 0;
	h.gate.armForMove();                               // DICE_ROLLED arrived (response outruns the segment)
	h.gate.deferVisual(() => { cursorMoved++; });      // the cursor move, paced to the hop

	// The 600 ms turn refresh re-emits the SAME (pre-move) state; nothing is animating yet
	// because the authoritative moved state is still in flight. It must NOT flush.
	h.setAnimating(false);
	h.gate.onStateApplied(preRollState);
	assert.equal(cursorMoved, 0, 'the synthetic re-emit must not reveal the destination');

	// The real moved state arrives and its hop starts: still held, released on settle.
	const movedState = { turn: 1, moved: true };
	h.setAnimating(true);
	h.gate.onStateApplied(movedState);
	assert.equal(cursorMoved, 0, 'held while the token travels');
	h.gate.settle();
	assert.equal(cursorMoved, 1, 'released when the hop lands');
});

test('a FRESH state object still releases a snapped (non-animating) move', () => {
	const h = makeGate();
	h.gate.onStateApplied({ turn: 1 });
	let ran = 0;
	h.gate.armForMove();
	h.gate.deferVisual(() => { ran++; });

	// The moved state applies but the move snapped (motion off / teleport): release now.
	h.setAnimating(false);
	h.gate.onStateApplied({ turn: 1, moved: true });
	assert.equal(ran, 1, 'a genuine application with no animation releases immediately');
});
