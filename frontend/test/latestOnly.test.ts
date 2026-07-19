import test from 'node:test';
import assert from 'node:assert/strict';
import { LatestOnly } from '../src/lobby/latestOnly.js';

// Regression: the lobby staged a board over two awaited hops (stage + i18n) before setting
// its tokens. Switching boards mid-stage let the SLOWER (older) chain finish last and overwrite
// the chosen board's tokens with a stale default's. LatestOnly makes the superseded chains
// stop; these tests pin that contract.

test('a fresh ticket is current until a newer one is begun', () => {
	const g = new LatestOnly();
	const a = g.begin();
	assert.equal(g.isCurrent(a), true);
	const b = g.begin();
	assert.equal(g.isCurrent(b), true, 'the newest ticket is current');
	assert.equal(g.isCurrent(a), false, 'the superseded ticket is no longer current');
});

test('tickets are strictly increasing (a late older chain never looks current)', () => {
	const g = new LatestOnly();
	const first = g.begin();
	const second = g.begin();
	const third = g.begin();
	assert.ok(second > first && third > second, 'each begin() supersedes the last');
	// Simulate the race: the OLDEST chain resolves LAST and asks whether to apply — it must not.
	assert.equal(g.isCurrent(first), false);
	assert.equal(g.isCurrent(second), false);
	assert.equal(g.isCurrent(third), true);
});

test('an unrelated (never-issued) ticket is never current', () => {
	const g = new LatestOnly();
	g.begin();
	assert.equal(g.isCurrent(0), false, 'the initial state (no op begun) is not current');
	assert.equal(g.isCurrent(999), false);
});
