import test from 'node:test';
import assert from 'node:assert/strict';
import { TurnSequencer } from '../src/turnSequencer.js';
import type { AnnouncementEvent } from '../src/gameClient.js';
import type { GameState } from '../src/models.js';

// A minimal GameState stand-in: the sequencer never inspects its shape, it only forwards it.
function state(label: string): GameState {
	return { label } as unknown as GameState;
}

function ev(key: string, phase?: 'move' | 'resolve'): AnnouncementEvent {
	return { key, vars: {}, phase } as AnnouncementEvent;
}

interface Recorder {
	sequencer: TurnSequencer;
	log: string[];
	/** Toggle the "is a token hopping" probe (true after an animating state is applied). */
	setAnimating: (v: boolean) => void;
}

function recorder(): Recorder {
	const log: string[] = [];
	let animating = false;
	const sequencer = new TurnSequencer({
		deliverEvents: (events) => {
			for (const e of events) log.push(`event:${e.key}`);
		},
		applyState: (s) => log.push(`state:${(s as unknown as { label: string }).label}`),
		isAnimating: () => animating,
	});
	return { sequencer, log, setAnimating: (v) => { animating = v; } };
}

// ── Single segment (the common case) ────────────────────────────────────────────

test('a single segment plays immediately: events then state, in order', () => {
	const r = recorder();
	r.sequencer.enqueueEvents([ev('dice', 'move'), ev('rent', 'resolve')]);
	r.sequencer.enqueueState(state('X'));
	assert.deepEqual(r.log, ['event:dice', 'event:rent', 'state:X']);
});

test('a non-animating second segment follows immediately with no settle needed', () => {
	const r = recorder();
	// First segment does not animate (e.g. no movement), so the queued second segment runs
	// right after without waiting for a hop.
	r.sequencer.enqueueEvents([ev('a')]);
	r.sequencer.enqueueState(state('X'));
	r.sequencer.enqueueEvents([ev('b')]);
	r.sequencer.enqueueState(state('Y'));
	assert.deepEqual(r.log, ['event:a', 'state:X', 'event:b', 'state:Y']);
});

// ── Compound move: two segments serialized to the hop ───────────────────────

test('the second segment waits for the first hop to settle', () => {
	const r = recorder();

	// Segment 1 arrives and starts a hop.
	r.setAnimating(true);
	r.sequencer.enqueueEvents([ev('dice', 'move'), ev('landingA', 'resolve')]);
	r.sequencer.enqueueState(state('X'));
	assert.deepEqual(r.log, ['event:dice', 'event:landingA', 'state:X']);

	// Segment 2 arrives mid-hop: it must NOT play yet.
	r.sequencer.enqueueEvents([ev('advance', 'move'), ev('landingB', 'resolve')]);
	r.sequencer.enqueueState(state('Y'));
	assert.deepEqual(r.log, ['event:dice', 'event:landingA', 'state:X'], 'segment 2 held until settle');

	// Hop settles → segment 2 plays (and starts its own hop).
	r.setAnimating(true);
	r.sequencer.onSettle();
	assert.deepEqual(r.log, [
		'event:dice', 'event:landingA', 'state:X',
		'event:advance', 'event:landingB', 'state:Y',
	]);
});

test('events buffered before a state pair into that state\'s segment', () => {
	const r = recorder();
	// Two GameEvents batches can arrive before the single state that closes the segment.
	r.sequencer.enqueueEvents([ev('a')]);
	r.sequencer.enqueueEvents([ev('b')]);
	r.sequencer.enqueueState(state('X'));
	assert.deepEqual(r.log, ['event:a', 'event:b', 'state:X']);
});

test('onSettle is a no-op when nothing is waiting', () => {
	const r = recorder();
	r.sequencer.onSettle(); // no busy segment
	r.sequencer.enqueueEvents([ev('a')]);
	r.sequencer.enqueueState(state('X'));
	r.sequencer.onSettle(); // segment already finished (non-animating)
	assert.deepEqual(r.log, ['event:a', 'state:X']);
});

test('a state with no preceding events still forms a segment', () => {
	const r = recorder();
	r.sequencer.enqueueState(state('X'));
	assert.deepEqual(r.log, ['state:X']);
});

test('three segments serialize one hop at a time', () => {
	const r = recorder();

	r.setAnimating(true);
	r.sequencer.enqueueEvents([ev('s1')]);
	r.sequencer.enqueueState(state('1'));

	r.sequencer.enqueueEvents([ev('s2')]);
	r.sequencer.enqueueState(state('2'));

	r.sequencer.enqueueEvents([ev('s3')]);
	r.sequencer.enqueueState(state('3'));

	assert.deepEqual(r.log, ['event:s1', 'state:1'], 'only first segment plays');

	r.setAnimating(true);
	r.sequencer.onSettle();
	assert.deepEqual(r.log, ['event:s1', 'state:1', 'event:s2', 'state:2']);

	// Last segment does not animate, so onSettle drains it immediately.
	r.setAnimating(false);
	r.sequencer.onSettle();
	assert.deepEqual(r.log, ['event:s1', 'state:1', 'event:s2', 'state:2', 'event:s3', 'state:3']);
});
