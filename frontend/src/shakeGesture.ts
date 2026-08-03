// shakeGesture.ts — "shake the phone" as an input, for the one place a player's hands are busy.
//
// A screen-reader user playing a talking party game holds the phone, listens, and talks. Finding a
// button on a glass screen in the middle of that is the expensive part; shaking the thing they are
// already holding is free. So a shake is offered as an ALIAS for an action that always also has a
// key and a button — never as the only way to do something.
//
// The decision is a pure class (feed a reading, get a yes or no) so the thresholds can be tested
// without a device, a DOM or a clock. The wiring below is the thin part: subscribe, unsubscribe,
// and the permission gate iOS puts in front of motion events.

/** One accelerometer sample, in m/s², stamped with the time it was taken. */
export interface ShakeReading {
	x: number;
	y: number;
	z: number;
	at: number;
}

export interface ShakeOptions {
	/**
	 * How fast the device has to be changing direction to count, in m/s² per second. Carrying a
	 * phone about lands around 30 and gesturing with one in your hand around 100; a deliberate
	 * flick of the wrist clears 300. The default sits in the gap.
	 */
	threshold?: number;
	/** Silence after a recognised shake: one flick of the wrist is one action, not five. */
	cooldownMs?: number;
	/** Readings closer together than this are ignored, so the rate the device happens to report
	 *  cannot change what counts as a shake. */
	minIntervalMs?: number;
}

/**
 * Recognises a shake from a stream of accelerometer readings. Deliberately the same shape as the
 * long-standing Android recipe: the speed at which the acceleration vector is CHANGING, which
 * cancels out gravity and the orientation the phone happens to be held in.
 */
export class ShakeGesture {
	private last: ShakeReading | null = null;
	private lastShakeAt: number | null = null;

	constructor(private readonly options: ShakeOptions = {}) {}

	/** Feed one reading. True exactly on the reading that completes a shake. */
	feed(reading: ShakeReading): boolean {
		const minIntervalMs = this.options.minIntervalMs ?? 80;
		const previous = this.last;
		if (!previous) {
			this.last = reading;
			return false;
		}
		const elapsed = reading.at - previous.at;
		// Too soon to say anything, so the sample is dropped and the reference reading kept:
		// consuming it would shorten the baseline and inflate the next speed.
		if (elapsed < minIntervalMs) return false;
		this.last = reading;

		const travelled = Math.abs(reading.x - previous.x)
			+ Math.abs(reading.y - previous.y)
			+ Math.abs(reading.z - previous.z);
		const speed = (travelled / elapsed) * 1000;
		if (speed < (this.options.threshold ?? 200)) return false;

		const cooldownMs = this.options.cooldownMs ?? 1200;
		if (this.lastShakeAt !== null && reading.at - this.lastShakeAt < cooldownMs) return false;
		this.lastShakeAt = reading.at;
		return true;
	}

	/** Forget the stream (the surface went away, or the turn changed hands). */
	reset(): void {
		this.last = null;
		this.lastShakeAt = null;
	}
}

/** The part of a DeviceMotionEvent this module reads. Declared here so nothing needs the DOM lib's
 *  device-motion types to compile, and so tests can hand over a plain object. */
export interface MotionEventLike {
	acceleration?: { x: number | null; y: number | null; z: number | null } | null;
	accelerationIncludingGravity?: { x: number | null; y: number | null; z: number | null } | null;
}

/** Pull a reading out of a motion event, preferring the gravity-free one when the device has a
 *  gyroscope to produce it. Null when the event carries no usable numbers at all. */
export function readingFrom(event: MotionEventLike, at: number): ShakeReading | null {
	const source = event.acceleration?.x !== null && event.acceleration?.x !== undefined
		? event.acceleration
		: event.accelerationIncludingGravity;
	if (!source) return null;
	const { x, y, z } = source;
	if (x === null || y === null || z === null || x === undefined || y === undefined || z === undefined) {
		return null;
	}
	return { x, y, z, at };
}

export interface ShakeListenerOptions extends ShakeOptions {
	/** Where to subscribe. Defaults to `window`; tests pass their own target. */
	target?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | null;
	/** The clock, for tests. Motion events carry no timestamp we can rely on across engines. */
	now?: () => number;
}

/**
 * Subscribe to device motion and call `onShake` for each recognised shake. Returns the function
 * that unsubscribes. Safe to call where there is no motion API at all: it simply never fires.
 */
export function listenForShake(onShake: () => void, options: ShakeListenerOptions = {}): () => void {
	const target = options.target ?? (typeof window === 'undefined' ? null : window);
	if (!target) return () => {};
	const now = options.now ?? (() => Date.now());
	const gesture = new ShakeGesture(options);
	const handler = (event: Event) => {
		const reading = readingFrom(event as MotionEventLike, now());
		if (reading && gesture.feed(reading)) onShake();
	};
	target.addEventListener('devicemotion', handler);
	return () => target.removeEventListener('devicemotion', handler);
}

/**
 * iOS hands out motion events only after the person has agreed, and only when asked from inside a
 * real user gesture — so this is called from the first touch or key press on the surface that
 * wants it, not on load. Everywhere else there is nothing to ask, and it resolves true.
 */
export async function requestShakePermission(): Promise<boolean> {
	const api = (globalThis as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } })
		.DeviceMotionEvent;
	if (typeof api?.requestPermission !== 'function') return true;
	try {
		return await api.requestPermission() === 'granted';
	} catch {
		// Asked outside a gesture, or declined earlier. The keys and buttons all still work.
		return false;
	}
}
