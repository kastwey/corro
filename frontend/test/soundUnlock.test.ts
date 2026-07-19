import test from 'node:test';
import assert from 'node:assert/strict';
import { soundManager } from '../src/sound.js';

// iOS/iPadOS Safari only unlocks audio OUTPUT after a real buffer plays inside a user
// gesture — resume() alone leaves earcons scheduled but silent. These tests pin that
// unlock() both resumes the context AND primes the output with a one-sample silent buffer,
// once, synchronously. Web Audio is not in jsdom/node, so we inject a fake AudioContext.

class FakeBufferSource {
	buffer: unknown = null;
	started: number | null = null;
	connect(): void { /* no-op graph node */ }
	start(when = 0): void { this.started = when; }
}

class FakeAudioContext {
	static instances: FakeAudioContext[] = [];
	state = 'suspended';
	resumeCalls = 0;
	destination = {};
	createdSources: FakeBufferSource[] = [];
	createdBuffers = 0;
	constructor() { FakeAudioContext.instances.push(this); }
	createGain() { return { gain: { value: 1 }, connect() { /* no-op */ } }; }
	createBuffer(): unknown { this.createdBuffers++; return {}; }
	createBufferSource(): FakeBufferSource { const s = new FakeBufferSource(); this.createdSources.push(s); return s; }
	resume(): Promise<void> { this.resumeCalls++; this.state = 'running'; return Promise.resolve(); }
}

function installFakeAudio(): void {
	FakeAudioContext.instances = [];
	(globalThis as any).window = (globalThis as any).window ?? {};
	(globalThis as any).window.AudioContext = FakeAudioContext as unknown as typeof AudioContext;
	delete (globalThis as any).window.webkitAudioContext;
}

// The SoundManager is a module singleton, so these tests run in sequence against the same
// instance: the first unlock primes; later assertions verify the priming is not repeated.

test('unlock() resumes a suspended context and primes the output with a silent buffer', () => {
	installFakeAudio();

	soundManager.unlock();

	const ctx = FakeAudioContext.instances[0];
	assert.ok(ctx, 'an AudioContext was created');
	assert.equal(ctx.resumeCalls, 1, 'a suspended context is resumed inside the gesture');
	assert.equal(ctx.createdSources.length, 1, 'a silent buffer source was created to prime output');
	assert.equal(ctx.createdSources[0].started, 0, 'the silent buffer was started synchronously');
	assert.equal(ctx.createdBuffers, 1);
});

test('unlock() primes the output only once across repeated gestures', () => {
	const ctx = FakeAudioContext.instances[0];
	const sourcesBefore = ctx.createdSources.length;

	soundManager.unlock();
	soundManager.unlock();

	assert.equal(ctx.createdSources.length, sourcesBefore, 'output is not re-primed once unlocked');
});

test('unlock() does not call resume() again once the context is running', () => {
	const ctx = FakeAudioContext.instances[0];
	assert.equal(ctx.state, 'running');
	const resumesBefore = ctx.resumeCalls;

	soundManager.unlock();

	assert.equal(ctx.resumeCalls, resumesBefore, 'a running context is not resumed redundantly');
});

test('isUnlocked() reports true once the context is running', () => {
	assert.equal(soundManager.isUnlocked(), true);
	assert.equal(soundManager.getAudioContextState(), 'running');
});

test('setOnStateChange subscriber is notified when unlock runs', () => {
	let lastState: string | null = null;
	soundManager.setOnStateChange((s) => { lastState = s; });

	soundManager.unlock();

	assert.equal(lastState, 'running', 'the subscriber receives the current audio state');
});
