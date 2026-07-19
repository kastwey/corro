import test from 'node:test';
import assert from 'node:assert/strict';
import { nextAuctionWarning, AUCTION_WARN_SECONDS } from '../src/auctionCountdown.js';

test('announces once when a threshold is reached', () => {
	const r = nextAuctionWarning(10, 11);
	assert.equal(r.announce, true);
	assert.equal(r.lastWarned, 10);
});

test('does not announce a non-threshold second', () => {
	const r = nextAuctionWarning(9, 10);
	assert.equal(r.announce, false);
	assert.equal(r.lastWarned, 10); // unchanged
});

test('does not re-announce the same threshold second twice', () => {
	const r = nextAuctionWarning(5, 5);
	assert.equal(r.announce, false);
	assert.equal(r.lastWarned, 5);
});

test('a bid resetting the timer (seconds jump up) re-arms thresholds without announcing', () => {
	// Counted down to 1, then a new bid resets the timer back to 10.
	const reset = nextAuctionWarning(10, 1);
	assert.equal(reset.announce, false, 'the jump up itself is silent');
	assert.equal(reset.lastWarned, 10);

	// Counting down again, 5 is a threshold and must fire once more.
	const again = nextAuctionWarning(5, reset.lastWarned);
	assert.equal(again.announce, true);
	assert.equal(again.lastWarned, 5);
});

test('a full countdown announces exactly the threshold seconds in order', () => {
	let last = 10; // opening value, skipped so it is not announced immediately
	const spoken: number[] = [];
	for (let s = 10; s >= 0; s--) {
		const r = nextAuctionWarning(s, last);
		last = r.lastWarned;
		if (r.announce) spoken.push(s);
	}
	// From a 10s opening value: 10 is the start (skipped), then 5,4,3,2,1.
	assert.deepEqual(spoken, [5, 4, 3, 2, 1]);
	// Sanity: every spoken value is a configured threshold.
	assert.ok(spoken.every(s => AUCTION_WARN_SECONDS.has(s)));
});
