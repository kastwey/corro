// unlockCodes.test.ts — the browser-side store of unlock codes for hidden boards.
//
// This is the load-bearing client logic of the self-hosting unlock feature: codes are normalized,
// de-duplicated, persisted in localStorage and replayed to the server in a header. The dialog and
// lobby glue on top are thin and verified in the browser; the rules live and are tested here.

import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';

// setupDom maps jsdom's localStorage onto the global the module reads.
before(() => { setupDom(); });
beforeEach(() => { localStorage.clear(); });

import {
	getUnlockCodes, hasUnlockCode, addUnlockCode, unlockHeaderValue, UNLOCK_HEADER,
} from '../src/unlockCodes.js';

test('starts empty: no codes, no header value, nothing held', () => {
	assert.deepEqual(getUnlockCodes(), []);
	assert.equal(unlockHeaderValue(), '');
	assert.equal(hasUnlockCode('anything'), false);
});

test('addUnlockCode persists a normalized, de-duplicated code', () => {
	addUnlockCode('  OnlyWithBlinds ');
	assert.deepEqual(getUnlockCodes(), ['onlywithblinds']);      // trimmed + lower-cased
	addUnlockCode('ONLYWITHBLINDS');                             // same code, different case
	assert.deepEqual(getUnlockCodes(), ['onlywithblinds']);      // → no duplicate
	assert.equal(hasUnlockCode('onlywithblinds'), true);
	assert.equal(hasUnlockCode(' onlywithblinds '), true);       // membership is forgiving too
});

test('a blank code is ignored', () => {
	addUnlockCode('   ');
	assert.deepEqual(getUnlockCodes(), []);
});

test('unlockHeaderValue joins stored codes and folds in a not-yet-saved candidate', () => {
	addUnlockCode('alpha');
	addUnlockCode('beta');
	assert.equal(unlockHeaderValue(), 'alpha,beta');
	// The candidate is normalized and appended for the test request, but NOT persisted.
	assert.equal(unlockHeaderValue('  GAMMA '), 'alpha,beta,gamma');
	assert.deepEqual(getUnlockCodes(), ['alpha', 'beta']);
	// A candidate already held isn't duplicated in the header.
	assert.equal(unlockHeaderValue('alpha'), 'alpha,beta');
});

test('the header name matches the one the server reads', () => {
	assert.equal(UNLOCK_HEADER, 'X-Corro-Unlock');
});
