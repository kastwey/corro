import test from 'node:test';
import assert from 'node:assert/strict';
import { flightStep, type FlightRect } from '../src/cardFlight.js';

// flightStep is the pure geometry behind the card-draw flight: it positions a card of a
// fixed natural size so its CENTER lands on the center of a target rect, scaled to the
// target's height. The DOM/animation orchestration in cardFlight.play() is purely visual
// (Web Animations API) and not unit-tested; this pins the maths it relies on.

const CARD_W = 150;
const CARD_H = 210;

test('the card center lands on the target center', () => {
	const target: FlightRect = { left: 100, top: 200, width: 60, height: 80 };
	const step = flightStep(target, CARD_W, CARD_H);

	// top-left + half the card size should equal the target center.
	assert.equal(step.x + CARD_W / 2, target.left + target.width / 2);
	assert.equal(step.y + CARD_H / 2, target.top + target.height / 2);
});

test('the scale matches the target height relative to the card height', () => {
	const target: FlightRect = { left: 0, top: 0, width: 40, height: 105 };
	const step = flightStep(target, CARD_W, CARD_H);

	assert.equal(step.scale, 105 / CARD_H); // 0.5
});

test('the scale boost enlarges the landing waypoint (so a tiny token still reads)', () => {
	const token: FlightRect = { left: 10, top: 10, width: 24, height: 28 };
	const plain = flightStep(token, CARD_W, CARD_H, 1);
	const boosted = flightStep(token, CARD_W, CARD_H, 3.5);

	assert.equal(boosted.scale, plain.scale * 3.5);
	// The boost scales only the size, never the center position.
	assert.equal(boosted.x, plain.x);
	assert.equal(boosted.y, plain.y);
});
