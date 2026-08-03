import test from 'node:test';
import assert from 'node:assert/strict';
import {
	ShakeGesture, listenForShake, readingFrom, requestShakePermission,
} from '../src/shakeGesture.js';

/**
 * Shaking the phone as an input. The thresholds are the whole product here — too low and a game
 * marks words correct while somebody walks across the room, too high and nobody can reach the
 * action they were promised — so the decision is a pure class and every case below is a device
 * that never has to exist.
 */

/** A device sitting still: gravity, unchanging. */
function still(gesture: ShakeGesture, from: number, samples: number): boolean {
	let fired = false;
	for (let index = 0; index < samples; index++) {
		if (gesture.feed({ x: 0, y: 9.8, z: 0, at: from + index * 100 })) fired = true;
	}
	return fired;
}

test('a device held still, or merely carried about, is never a shake', () => {
	const gesture = new ShakeGesture();
	assert.equal(still(gesture, 0, 10), false);

	// Walking: the phone swings, but slowly — well under a wrist flick.
	let fired = false;
	for (let index = 0; index < 20; index++) {
		const wobble = index % 2 === 0 ? 1.5 : -1.5;
		if (gesture.feed({ x: wobble, y: 9.8, z: 0, at: 2_000 + index * 100 })) fired = true;
	}
	assert.equal(fired, false, 'a walk is not an action');
});

test('one flick of the wrist is one action, however many readings it spans', () => {
	const gesture = new ShakeGesture();
	still(gesture, 0, 3);

	// The flick: the acceleration vector swings hard, several times, over about a third of a second.
	const fires: number[] = [];
	for (let index = 0; index < 6; index++) {
		const at = 1_000 + index * 100;
		if (gesture.feed({ x: index % 2 === 0 ? 18 : -18, y: 9.8, z: 0, at })) fires.push(at);
	}
	assert.equal(fires.length, 1, 'the cooldown collapses the whole flick into a single action');
	assert.equal(fires[0], 1_100);
});

test('a second, deliberate shake is heard once the cooldown has passed', () => {
	const gesture = new ShakeGesture({ cooldownMs: 500 });
	let sign = 1;
	// Each reading swings the device the other way, hard enough to count on its own merits.
	const swing = (at: number) => {
		sign = -sign;
		return gesture.feed({ x: sign * 20, y: 9.8, z: 0, at });
	};

	// Shaken without pause, at the rate a real device reports.
	const fired = [0, 100, 200, 300, 400, 500, 600, 700].filter(at => swing(at));
	assert.deepEqual(fired, [100, 600], 'the cooldown, and then a second action');
});

test('readings that arrive too close together are dropped without shortening the baseline', () => {
	// A device reporting at 200 Hz must not read as five times more violent than one at 40 Hz.
	const fast = new ShakeGesture();
	fast.feed({ x: 0, y: 9.8, z: 0, at: 0 });
	assert.equal(fast.feed({ x: 2, y: 9.8, z: 0, at: 5 }), false, 'a 5 ms gap says nothing yet');
	assert.equal(fast.feed({ x: 4, y: 9.8, z: 0, at: 10 }), false);
	// …and the baseline is still the reading at 0, so 4 m/s² over 100 ms stays a gentle tilt.
	assert.equal(fast.feed({ x: 4, y: 9.8, z: 0, at: 100 }), false);
});

test('resetting forgets the stream, so the next reading is a baseline and not a shake', () => {
	const gesture = new ShakeGesture();
	gesture.feed({ x: 0, y: 9.8, z: 0, at: 0 });
	gesture.reset();
	assert.equal(gesture.feed({ x: 25, y: 9.8, z: 0, at: 100 }), false);
});

test('the gravity-free reading is preferred, and an event with no numbers is ignored', () => {
	assert.deepEqual(
		readingFrom({
			acceleration: { x: 1, y: 2, z: 3 },
			accelerationIncludingGravity: { x: 10, y: 20, z: 30 },
		}, 7),
		{ x: 1, y: 2, z: 3, at: 7 });

	// A device with no gyroscope reports nulls in `acceleration`; gravity is all there is.
	assert.deepEqual(
		readingFrom({
			acceleration: { x: null, y: null, z: null },
			accelerationIncludingGravity: { x: 0, y: 9.8, z: 0 },
		}, 7),
		{ x: 0, y: 9.8, z: 0, at: 7 });

	assert.equal(readingFrom({}, 7), null);
	assert.equal(readingFrom({ acceleration: null, accelerationIncludingGravity: null }, 7), null);
});

test('the listener subscribes, reports shakes, and lets go when asked', () => {
	const handlers: Record<string, ((event: any) => void)[]> = {};
	const target = {
		addEventListener: (type: string, handler: any) => { (handlers[type] ??= []).push(handler); },
		removeEventListener: (type: string, handler: any) => {
			handlers[type] = (handlers[type] ?? []).filter(entry => entry !== handler);
		},
	};
	let clock = 0;
	let shakes = 0;
	const stop = listenForShake(() => { shakes++; }, { target, now: () => clock });

	const move = (x: number, at: number) => {
		clock = at;
		for (const handler of handlers.devicemotion ?? []) {
			handler({ acceleration: { x, y: 0, z: 0 } });
		}
	};
	move(0, 0);
	move(0, 100);
	assert.equal(shakes, 0);
	move(25, 200);
	assert.equal(shakes, 1);

	stop();
	assert.equal(handlers.devicemotion?.length, 0);
	move(-25, 2_000);
	assert.equal(shakes, 1, 'a released listener hears nothing');
});

test('a platform with no motion API at all is simply quiet, never a crash', () => {
	const stop = listenForShake(() => assert.fail('nothing can fire'), { target: null });
	stop();
});

test('permission is granted by default, asked for where iOS requires it, and never throws', async () => {
	const scope = globalThis as { DeviceMotionEvent?: unknown };
	const original = scope.DeviceMotionEvent;
	try {
		delete scope.DeviceMotionEvent;
		assert.equal(await requestShakePermission(), true, 'nothing to ask means nothing to refuse');

		scope.DeviceMotionEvent = { requestPermission: async () => 'granted' };
		assert.equal(await requestShakePermission(), true);

		scope.DeviceMotionEvent = { requestPermission: async () => 'denied' };
		assert.equal(await requestShakePermission(), false);

		// Asked outside a user gesture, which iOS rejects outright. The keys and buttons still work.
		scope.DeviceMotionEvent = { requestPermission: async () => { throw new Error('no gesture'); } };
		assert.equal(await requestShakePermission(), false);
	} finally {
		if (original === undefined) delete scope.DeviceMotionEvent;
		else scope.DeviceMotionEvent = original;
	}
});
