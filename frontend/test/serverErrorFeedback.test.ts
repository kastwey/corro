import test from 'node:test';
import assert from 'node:assert/strict';
import { buildServerErrorFeedback } from '../src/gameManager.js';

/**
 * The client used to swallow server-side validation errors (ErrorResponse, type
 * "ERROR") in a silent console.log, so neither a screen-reader user (no ARIA
 * announcement) nor a sighted user (no visual notification) learned WHY their
 * action was rejected. buildServerErrorFeedback is the pure decision that turns an
 * error code into the spoken key + the translated visual message.
 */

// Fake translator: mirrors translateServerErrorSync (returns the mapped text or
// the raw code when there is no translation).
const fakeTranslate = (code: string): string =>
	code === 'HIGHEST_BIDDER_CANNOT_PASS' ? 'You are winning the auction' : code;

test('maps a known error code to its announcement key and translated message', () => {
	const fb = buildServerErrorFeedback('HIGHEST_BIDDER_CANNOT_PASS', 'The highest bidder cannot pass', fakeTranslate);
	assert.equal(fb.code, 'HIGHEST_BIDDER_CANNOT_PASS');
	assert.equal(fb.announceKey, 'serverErrors.HIGHEST_BIDDER_CANNOT_PASS');
	assert.equal(fb.visualMessage, 'You are winning the auction');
});

test('falls back to the message when no code is provided', () => {
	const fb = buildServerErrorFeedback(undefined, 'BID_TOO_LOW', fakeTranslate);
	assert.equal(fb.code, 'BID_TOO_LOW');
	assert.equal(fb.announceKey, 'serverErrors.BID_TOO_LOW');
});

test('falls back to UNKNOWN_ERROR when neither code nor message is provided', () => {
	const fb = buildServerErrorFeedback(undefined, undefined, fakeTranslate);
	assert.equal(fb.code, 'UNKNOWN_ERROR');
	assert.equal(fb.announceKey, 'serverErrors.UNKNOWN_ERROR');
	assert.equal(fb.visualMessage, 'UNKNOWN_ERROR');
});
