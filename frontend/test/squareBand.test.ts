import test from 'node:test';
import assert from 'node:assert/strict';
import { squareBandHtml } from '../src/board.js';

// The property colour band: themed CSS class for the eight classic groups, an inline colour for
// any other group (so packages using hex colours still paint a band), and injection-safe input.

test('a classic group uses its themed CSS class (no inline colour)', () => {
	const html = squareBandHtml('brown');
	assert.match(html, /class="square__band group-brown"/);
	assert.doesNotMatch(html, /style=/);
});

test('classic group names are matched case-insensitively', () => {
	assert.match(squareBandHtml('LightBlue'), /group-lightblue/);
});

test('a package hex colour is painted inline', () => {
	const html = squareBandHtml('#8a5a2b');
	assert.match(html, /style="background:#8a5a2b"/);
	assert.doesNotMatch(html, /group-/); // no themed class for an unknown group
});

test('an arbitrary CSS colour word (not one of the eight) is painted inline', () => {
	assert.match(squareBandHtml('teal'), /style="background:teal"/);
});

test('a non-colour value is ignored (band shows, but no inline style) — no injection', () => {
	const html = squareBandHtml('red;}</style><script>alert(1)</script>');
	assert.doesNotMatch(html, /<script>/);
	assert.doesNotMatch(html, /style=/);
	assert.match(html, /class="square__band"/);
});
