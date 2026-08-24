import test from 'node:test';
import assert from 'node:assert/strict';
import { makeInFlightGuard } from '../src/inFlightGuard.js';

// The window this closes: a confirmation closes before its answer goes out, so focus is back
// on the control that asked while the command is still travelling and the client's state is
// still the one that caused the question. A repeat activation there asks the same question
// again and sends the command twice. See inFlightGuard.ts.

/** A command whose completion the test controls. */
function deferred() {
	let resolve!: () => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
	return { promise, resolve, reject };
}

test('a key is busy from the moment its command starts until it settles', async () => {
	const guard = makeInFlightGuard();
	const d = deferred();
	let runs = 0;

	assert.equal(guard.busy('delete:1'), false);
	const inFlight = guard.run('delete:1', () => { runs++; return d.promise; });
	assert.equal(guard.busy('delete:1'), true, 'busy while travelling');

	d.resolve();
	await inFlight;
	assert.equal(guard.busy('delete:1'), false, 'free once it lands');
	assert.equal(runs, 1);
});

test('a repeat of the command already in flight is ignored, not queued', async () => {
	const guard = makeInFlightGuard();
	const d = deferred();
	let runs = 0;
	const command = () => { runs++; return d.promise; };

	const first = guard.run('delete:1', command);
	await guard.run('delete:1', command);   // the repeat
	await guard.run('delete:1', command);   // and another
	assert.equal(runs, 1, 'the repeats never reached the server');

	d.resolve();
	await first;
	// …and once it has landed, the same key may legitimately be used again.
	await guard.run('delete:1', async () => { runs++; });
	assert.equal(runs, 2);
});

test('different keys never block each other', async () => {
	// The point of keying: deleting one table must not swallow leaving another. A silently
	// dropped legitimate action is its own accessibility failure.
	const guard = makeInFlightGuard();
	const a = deferred();
	const b = deferred();
	const started: string[] = [];

	const first = guard.run('delete:1', () => { started.push('delete:1'); return a.promise; });
	const second = guard.run('leave:2', () => { started.push('leave:2'); return b.promise; });
	assert.deepEqual(started, ['delete:1', 'leave:2']);
	assert.equal(guard.busy('delete:1'), true);
	assert.equal(guard.busy('leave:2'), true);
	assert.equal(guard.busy('delete:3'), false, 'an untouched key is free');

	a.resolve(); b.resolve();
	await Promise.all([first, second]);
});

test('a command that FAILS still frees its key — it has finished travelling', async () => {
	// Otherwise one network error would lock the control for the rest of the session, and the
	// player would have no way to retry.
	const guard = makeInFlightGuard();
	await assert.rejects(
		guard.run('delete:1', async () => { throw new Error('network'); }),
		/network/);
	assert.equal(guard.busy('delete:1'), false);

	let retried = false;
	await guard.run('delete:1', async () => { retried = true; });
	assert.equal(retried, true, 'the player can try again');
});

test('the rejection reaches the caller, so an answer can still report the failure', async () => {
	const guard = makeInFlightGuard();
	let reported: string | null = null;
	await guard.run('leave:2', async () => { throw new Error('boom'); })
		.catch((e: Error) => { reported = e.message; });
	assert.equal(reported, 'boom');
});
