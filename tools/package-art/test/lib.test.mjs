import test from 'node:test';
import assert from 'node:assert/strict';
import { circle, rect, union, diff, toPath, bounds, stroke } from '../lib.mjs';
import { C, R, G, Ln, svgFile, inner, dark, light } from '../draw.mjs';
import { digit, number } from '../motifs.mjs';

function rings(d) {
	return d.split('M').filter(Boolean).map((chunk) => chunk.replace(/Z$/, '').split('L').map((p) => p.trim().split(' ').map(Number)));
}
function signedArea(ring) {
	let a = 0;
	for (let i = 0; i < ring.length; i++) {
		const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
		a += x1 * y2 - x2 * y1;
	}
	return a / 2;
}

test('a hole is emitted with the opposite winding to its outer ring, so nonzero and evenodd agree', () => {
	const washer = diff(circle(12, 12, 10), circle(12, 12, 4));
	const [outer, hole] = rings(toPath(washer, 2));
	assert.ok(signedArea(outer) > 0, 'outer ring winds clockwise on screen');
	assert.ok(signedArea(hole) < 0, 'hole winds the other way');
});

test('union merges overlapping shapes into one ring', () => {
	const merged = union(rect(0, 0, 10, 10), rect(5, 5, 10, 10));
	assert.equal(rings(toPath(merged, 1)).length, 1);
	assert.deepEqual([bounds(merged).minX, bounds(merged).maxX], [0, 15]);
});

test('a stroked polyline has round caps at both ends', () => {
	const b = bounds(stroke([[0, 5], [10, 5]], 4));
	assert.ok(Math.abs(b.minX - -2) < 0.05 && Math.abs(b.maxX - 12) < 0.05, 'the caps extend half a width beyond each end');
	assert.ok(Math.abs(b.minY - 3) < 0.05 && Math.abs(b.maxY - 7) < 0.05);
});

test('path data uses only the characters the engine whitelists', () => {
	const d = toPath(union(circle(32, 32, 20), rect(10, 10, 5, 5, 2)), 1);
	assert.match(d, /^[MLZ0-9.\- ]+$/);
	assert.match(d, /^M/);
});

test('every digit draws and keeps to its glyph box', () => {
	for (let n = 0; n <= 9; n++) {
		const b = bounds(digit(String(n), 0, 0, 40));
		assert.ok(b.width > 8 && b.width <= 26, `digit ${n} width ${b.width}`);
		assert.ok(Math.abs(b.height - 40) < 1, `digit ${n} height ${b.height}`);
	}
	assert.ok(bounds(number('200', 32, 32, 20)).width > bounds(number('25', 32, 32, 20)).width);
});

test('elements serialise with canonical attribute names and a 24 or 64 viewBox', () => {
	const drawing = [G([C(12, 12, 5, { fill: '#AbCdEf', sw: 1.5, cap: 'round' }), Ln(0, 0, 24, 24, { stroke: 'currentColor' })], { opacity: 0.5 })];
	const file = svgFile(drawing, 24);
	assert.match(file, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 24 24">/);
	assert.match(file, /<g opacity="0.5"><circle cx="12" cy="12" r="5" fill="#AbCdEf" stroke-width="1.5" stroke-linecap="round"\/>/);
	assert.match(file, /<line x1="0" y1="0" x2="24" y2="24" fill="none" stroke="currentColor"\/>/);
	assert.equal(inner([R(1, 2, 3, 4, 1)]), '<rect x="1" y="2" width="3" height="4" rx="1"/>');
});

test('shade helpers stay within hex colours', () => {
	assert.match(dark('#e53935'), /^#[0-9a-f]{6}$/);
	assert.match(light('#e53935'), /^#[0-9a-f]{6}$/);
	assert.equal(dark('#ffffff'), '#9e9e9e');
	assert.equal(light('#000000'), '#737373');
});
