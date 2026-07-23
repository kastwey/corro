import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
	armHandUpdateAfterAnnouncement,
	clearHandUpdatePacing,
	HAND_UPDATE_LEAD_MS,
	takeHandUpdateDelay,
} from '../src/handUpdatePacing.js';

beforeEach(() => clearHandUpdatePacing());

test('the next hand repaint receives the configured lead from the announcement write', () => {
	armHandUpdateAfterAnnouncement(HAND_UPDATE_LEAD_MS, () => 1000);
	assert.equal(takeHandUpdateDelay(() => 1100), HAND_UPDATE_LEAD_MS - 100);
	assert.equal(takeHandUpdateDelay(() => 1100), 0, 'the deadline is consumed once');
});

test('a later announcement extends an already armed deadline', () => {
	armHandUpdateAfterAnnouncement(200, () => 1000); // deadline 1200
	armHandUpdateAfterAnnouncement(300, () => 1100); // deadline 1400
	assert.equal(takeHandUpdateDelay(() => 1150), 250);
});

test('expired and negative leads never delay a hand', () => {
	armHandUpdateAfterAnnouncement(-1, () => 1000);
	assert.equal(takeHandUpdateDelay(() => 1001), 0);
});
