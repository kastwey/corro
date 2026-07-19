import test from 'node:test';
import assert from 'node:assert/strict';
import {
	getMotionPreference,
	setMotionPreference,
	isTokenMotionDisabled,
	type MotionPreference,
} from '../src/motion.js';

// motion.ts decides whether the token hop animates. The decision is consumed by both the
// TokenAnimator (snap vs hop) and, transitively, the announcement gate (release consequences
// now vs at settle), so these tests pin the three-way preference and its OS fallback.

// matchMedia is not implemented in jsdom/node, so each test installs a fake on the global
// `window` to drive the 'system' branch deterministically. Tests restore state afterwards.
function withMatchMedia(prefersReduced: boolean, body: () => void): void {
	const g = globalThis as unknown as { window?: { matchMedia?: unknown } };
	const hadWindow = 'window' in g;
	const prevWindow = g.window;
	g.window = {
		matchMedia: (query: string) => ({
			matches: query.includes('reduce') ? prefersReduced : false,
		}),
	};
	try {
		body();
	} finally {
		if (hadWindow) g.window = prevWindow;
		else delete g.window;
	}
}

function withPreference(p: MotionPreference, body: () => void): void {
	const prev = getMotionPreference();
	setMotionPreference(p);
	try {
		body();
	} finally {
		setMotionPreference(prev);
	}
}

test('default preference is "system"', () => {
	assert.equal(getMotionPreference(), 'system');
});

test('preference "off" disables motion regardless of the OS setting', () => {
	withPreference('off', () => {
		withMatchMedia(false, () => assert.equal(isTokenMotionDisabled(), true));
		withMatchMedia(true, () => assert.equal(isTokenMotionDisabled(), true));
	});
});

test('preference "on" enables motion regardless of the OS setting', () => {
	withPreference('on', () => {
		withMatchMedia(true, () => assert.equal(isTokenMotionDisabled(), false));
		withMatchMedia(false, () => assert.equal(isTokenMotionDisabled(), false));
	});
});

test('preference "system" follows the OS prefers-reduced-motion setting', () => {
	withPreference('system', () => {
		withMatchMedia(true, () => assert.equal(isTokenMotionDisabled(), true));
		withMatchMedia(false, () => assert.equal(isTokenMotionDisabled(), false));
	});
});

test('preference "system" treats a missing matchMedia as motion enabled', () => {
	withPreference('system', () => {
		const g = globalThis as unknown as { window?: unknown };
		const had = 'window' in g;
		const prev = g.window;
		delete g.window;
		try {
			assert.equal(isTokenMotionDisabled(), false);
		} finally {
			if (had) g.window = prev;
		}
	});
});

test('a hidden document disables motion whatever the preference', () => {
	// A hidden window's timers are clamped to >=1s: a hop chain there would replay the
	// move late and out of rhythm (heard as "the animation repeating" from a second
	// window on the same machine), so hidden always snaps.
	const g = globalThis as unknown as { document?: unknown };
	const had = 'document' in g;
	const prev = g.document;
	g.document = { hidden: true };
	try {
		withPreference('on', () => assert.equal(isTokenMotionDisabled(), true));
		(g.document as { hidden: boolean }).hidden = false;
		withPreference('on', () => assert.equal(isTokenMotionDisabled(), false));
	} finally {
		if (had) g.document = prev;
		else delete g.document;
	}
});

test('setMotionPreference round-trips through getMotionPreference', () => {
	withPreference('system', () => {
		setMotionPreference('off');
		assert.equal(getMotionPreference(), 'off');
		setMotionPreference('on');
		assert.equal(getMotionPreference(), 'on');
	});
});
