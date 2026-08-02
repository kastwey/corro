import test from 'node:test';
import assert from 'node:assert/strict';
import {
	AUDIO_UNLOCK_EVENTS, shouldResumeAudioContext, tokenHopCue,
} from '../src/audioGating.js';

test('a backgrounded tab resumes; a running or dead context is left alone', () => {
	// The bug this guards: a second window opened to watch another player goes silent when
	// backgrounded and stays silent after regaining focus.
	assert.equal(shouldResumeAudioContext('suspended'), true);
	// Safari's own word for "a call interrupted us".
	assert.equal(shouldResumeAudioContext('interrupted'), true);

	// Resuming a running context costs a gesture the player never made.
	assert.equal(shouldResumeAudioContext('running'), false);
	// A closed context cannot be revived at all.
	assert.equal(shouldResumeAudioContext('closed'), false);
	assert.equal(shouldResumeAudioContext('unknown'), false);
});

test('mute silences the hop even when the package ships its own cue', () => {
	// The important direction: a themed sound must never sneak past the toggle.
	assert.equal(tokenHopCue({ loaded: true, muted: true, hasPackageCue: true }), 'silent');
	assert.equal(tokenHopCue({ loaded: true, muted: true, hasPackageCue: false }), 'silent');
});

test('a package cue wins, and its absence still leaves the hop audible', () => {
	assert.equal(tokenHopCue({ loaded: true, muted: false, hasPackageCue: true }), 'package');
	// Never silent by omission: a board with no themed hop falls back to the engine earcon.
	assert.equal(tokenHopCue({ loaded: true, muted: false, hasPackageCue: false }), 'fallback');
});

test('nothing plays before the sound bank has actually loaded', () => {
	// Audio may be unsupported, or still locked behind the first gesture.
	assert.equal(tokenHopCue({ loaded: false, muted: false, hasPackageCue: true }), 'silent');
	assert.equal(tokenHopCue({ loaded: false, muted: false, hasPackageCue: false }), 'silent');
});

test('the unlock gesture list covers touch, pointer, mouse AND keyboard', () => {
	// A keyboard-only player produces none of the pointer events, and iPadOS Safari may deliver
	// any one of the touch variants first — dropping one of these makes a whole input mode silent.
	for (const event of ['pointerdown', 'touchstart', 'touchend', 'click', 'keydown']) {
		assert.ok(AUDIO_UNLOCK_EVENTS.includes(event), `${event} must unlock audio`);
	}
});
