import test from 'node:test';
import assert from 'node:assert/strict';
import { vehicleSvgFor, vehicleKeyFor } from '../src/journeyVehicles.js';

// The road strip draws each seat as ITS chosen vehicle (live-play bug: a player picked the
// motorbike and still saw a car). Art is keyed by the pack's token ids; unknown ids fall
// back to the car so any future pack still renders.

const KNOWN = ['coche', 'moto', 'furgoneta', 'autobus', 'camion', 'taxi'];

test('every shipped token id has its own distinct side-view art', () => {
	const svgs = KNOWN.map(vehicleSvgFor);
	for (const svg of svgs) {
		assert.ok(svg.startsWith('<svg'), 'renders an inline svg');
		assert.ok(svg.includes('currentColor'), 'body tinted by the seat colour');
	}
	assert.equal(new Set(svgs).size, KNOWN.length, 'no two vehicles share the same art');
});

test('unknown or missing token ids fall back to the car', () => {
	assert.equal(vehicleSvgFor('nave-espacial'), vehicleSvgFor('coche'));
	assert.equal(vehicleSvgFor(undefined), vehicleSvgFor('coche'));
	assert.equal(vehicleKeyFor('nave-espacial'), 'coche');
	assert.equal(vehicleKeyFor(undefined), 'coche');
	assert.equal(vehicleKeyFor('moto'), 'moto');
});
