import test from 'node:test';
import assert from 'node:assert/strict';
import {
	attackableRivals, canDraw, canDiscard, canPlayCard, isLimited, isStopped, journeyCatalog, journeySeat,
} from '../src/journeyRules.js';
import type { GameState, JourneyCardDef, JourneySeatState } from '../src/models.js';

// Client-side mirror of the server's journey legality (the server re-checks on play): the
// hand panel's playable flags + refusal reason keys, the victim picker's attackable list,
// and the Space (draw) gate — all computed from PUBLIC wire data + my projected view.

const DECK: JourneyCardDef[] = [
	{ id: 'distance-25', type: 'distance', value: 25, count: 10, nameKey: 'cards.distance_25' },
	{ id: 'distance-200', type: 'distance', value: 200, count: 4, premium: true, maxPlaysPerHand: 2, nameKey: 'cards.distance_200' },
	{ id: 'stop', type: 'attack', kind: 'stop', hazardClass: 'stopper', value: 0, count: 5, nameKey: 'cards.stop' },
	{ id: 'limit', type: 'attack', kind: 'speedLimit', hazardClass: 'limiter', value: 0, count: 4, nameKey: 'cards.limit' },
	{ id: 'flat', type: 'attack', kind: 'flat', hazardClass: 'stopper', value: 0, count: 3, nameKey: 'cards.flat' },
	{ id: 'go', type: 'remedy', kind: 'stop', value: 0, count: 14, nameKey: 'cards.go' },
	{ id: 'priority', type: 'immunity', shieldsKinds: ['stop', 'speedLimit'], value: 0, count: 1, nameKey: 'cards.priority' },
];

function seat(id: string, over: Partial<Omit<JourneySeatState, 'members' | 'playerId'>> = {}): JourneySeatState {
	return {
		playerId: id, members: [{ playerId: id, hand: [], handCount: 0 }],
		km: 0, hazards: [], immunities: [],
		premiumPlays: 0, coupFourres: 0, score: 0, ...over,
	};
}

function game(seats: JourneySeatState[], over: Record<string, unknown> = {}): GameState {
	return {
		gameType: 'journey',
		journey: {
			seats, drawPile: [], drawCount: 10, discardPile: [],
			hasDrawn: false, round: 1, lastHandScores: [],
		},
		journeyDeck: DECK,
		journeyRules: { goalKm: 1000, targetScore: 5000, handSize: 6, stackHazards: false, limitCap: 50, initialHazard: 'stop' },
		players: [], bank: { money: 0 }, currentTurn: 'me', ownership: [], squares: [],
		...over,
	} as unknown as GameState;
}

test('distance: blocked while stopped, capped under a limit, exact at the goal', () => {
	const gs = game([seat('me', { hazards: ['stop'] }), seat('rival')]);
	assert.equal(canPlayCard(gs, 'me', 'distance-25').reasonKey, 'game.journey_stopped');

	const rolling = game([seat('me', { hazards: ['speedLimit'] }), seat('rival')]);
	assert.equal(canPlayCard(rolling, 'me', 'distance-200').reasonKey, 'game.journey_over_limit');
	assert.equal(canPlayCard(rolling, 'me', 'distance-25').playable, true);

	const near = game([seat('me', { km: 900 }), seat('rival')]);
	assert.equal(canPlayCard(near, 'me', 'distance-200').reasonKey, 'game.journey_overshoot');
	assert.equal(canPlayCard(near, 'me', 'distance-25').playable, true);
});

test('the per-hand play limit mirrors the server (two 200s)', () => {
	const gs = game([seat('me', { playsByCard: { 'distance-200': 2 } }), seat('rival')]);
	assert.equal(canPlayCard(gs, 'me', 'distance-200').reasonKey, 'game.journey_card_limit');
});

test('attacks are playable only with an attackable rival, and the picker list matches', () => {
	// A rolling, unshielded rival: attackable.
	const open = game([seat('me'), seat('r1')]);
	assert.equal(canPlayCard(open, 'me', 'stop').playable, true);
	assert.deepEqual(attackableRivals(open, 'me', DECK[2]).map(s => s.playerId), ['r1']);

	// Shielded (multi-shield right of way) and stopped rivals fall out of the list.
	const closed = game([
		seat('me'),
		seat('r1', { immunities: ['priority'] }), // shields stop + speedLimit
		seat('r2', { hazards: ['flat'] }),        // already stopped by another stopper
	]);
	assert.deepEqual(attackableRivals(closed, 'me', DECK[2]), []);
	assert.equal(canPlayCard(closed, 'me', 'stop').reasonKey, 'game.journey_no_attackable');
	// …but the LIMITER still lands on the stopped rival (its own pile), not on the shielded one.
	assert.deepEqual(attackableRivals(closed, 'me', DECK[3]).map(s => s.playerId), ['r2']);
	// And the stacking house rule reopens the stopped rival for a DIFFERENT stopper.
	const stacking = game(
		[seat('me'), seat('r2', { hazards: ['flat'] })],
		{ journeyRules: { goalKm: 1000, targetScore: 5000, handSize: 6, stackHazards: true, limitCap: 50, initialHazard: 'stop' } });
	assert.deepEqual(attackableRivals(stacking, 'me', DECK[2]).map(s => s.playerId), ['r2']);
});

test('remedies need their hazard; immunities always play', () => {
	const gs = game([seat('me', { hazards: ['stop'] }), seat('rival')]);
	assert.equal(canPlayCard(gs, 'me', 'go').playable, true);
	assert.equal(canPlayCard(gs, 'me', 'priority').playable, true);

	const cured = game([seat('me'), seat('rival')]);
	assert.equal(canPlayCard(cured, 'me', 'go').reasonKey, 'game.journey_nothing_to_cure');
});

test('the draw gate: turn, coup pause, once per turn, cards left', () => {
	const gs = game([seat('me'), seat('rival')]);
	assert.equal(canDraw(gs, 'me').playable, true);
	assert.equal(canDraw(gs, 'rival').reasonKey, 'game.journey_not_your_turn');

	gs.journey!.hasDrawn = true;
	assert.equal(canDraw(gs, 'me').reasonKey, 'game.journey_already_drew');

	gs.journey!.hasDrawn = false;
	gs.journey!.drawCount = 0;
	assert.equal(canDraw(gs, 'me').reasonKey, 'game.journey_deck_empty');

	gs.journey!.drawCount = 5;
	gs.journey!.pendingCoup = { victimId: 'rival', attackerId: 'me', hazardKind: 'stop', immunityInstanceId: '' };
	assert.equal(canDraw(gs, 'me').reasonKey, 'game.journey_coup_pending');
});

test('the discard gate: must draw first unless the deck is empty', () => {
	const gs = game([seat('me'), seat('rival')]);
	// Not drawn yet, deck has cards: discarding is refused with "draw a card first".
	assert.equal(canDiscard(gs, 'me').reasonKey, 'game.journey_draw_first');
	assert.equal(canDiscard(gs, 'rival').reasonKey, 'game.journey_not_your_turn');

	// Once drawn, discard is allowed.
	gs.journey!.hasDrawn = true;
	assert.equal(canDiscard(gs, 'me').playable, true);

	// An exhausted deck removes the draw requirement (hands only shrink).
	gs.journey!.hasDrawn = false;
	gs.journey!.drawCount = 0;
	assert.equal(canDiscard(gs, 'me').playable, true);

	// A pending coup pauses everything.
	gs.journey!.drawCount = 5;
	gs.journey!.hasDrawn = true;
	gs.journey!.pendingCoup = { victimId: 'rival', attackerId: 'me', hazardKind: 'stop', immunityInstanceId: '' };
	assert.equal(canDiscard(gs, 'me').reasonKey, 'game.journey_coup_pending');
});

test('team seats: any member resolves the SHARED seat; the partner is never a target', () => {
	const team = (ids: string[]): JourneySeatState => ({
		playerId: ids[0],
		members: ids.map(id => ({ playerId: id, hand: [], handCount: 0 })),
		km: 0, hazards: [], immunities: [], premiumPlays: 0, coupFourres: 0, score: 0,
	});
	const gs = game([team(['me', 'p2']), team(['r1', 'r2'])]);

	assert.equal(journeySeat(gs, 'me'), journeySeat(gs, 'p2')); // one seat, both partners
	// Attacks only ever list the RIVAL seat — my partner's seat is my own.
	assert.deepEqual(attackableRivals(gs, 'me', DECK[2]).map(s => s.playerId), ['r1']);
	assert.deepEqual(attackableRivals(gs, 'r2', DECK[2]).map(s => s.playerId), ['me']);
});

test('helpers: catalog lookup, seat lookup, stopped/limited classification', () => {
	const gs = game([seat('me', { hazards: ['speedLimit'] }), seat('rival', { hazards: ['flat'] })]);
	const catalog = journeyCatalog(gs);
	assert.equal(catalog.get('distance-25')?.value, 25);
	const me = journeySeat(gs, 'me')!;
	const rival = journeySeat(gs, 'rival')!;
	assert.equal(isLimited(me, catalog), true);
	assert.equal(isStopped(me, catalog), false);
	assert.equal(isStopped(rival, catalog), true);
});

// ── Per-card Help (live-play request): engine-composed from the card's data and the
// EFFECTIVE rules, naming the exact counter-cards; a package override (<nameKey>_help) wins.

import { journeyCardHelp } from '../src/journeyRules.js';

const t = (key: string, vars?: Record<string, unknown>) =>
	vars && Object.keys(vars).length ? `${key}(${Object.values(vars).join('|')})` : key;

test('card help: a stopper attack names its remedy, a limiter carries the cap', () => {
	const gs = game([seat('me'), seat('rival')]);
	assert.equal(journeyCardHelp(gs, 'stop', t), 'game.journey_help_attack_stopper(cards.go)');
	// The limiter's remedy is absent from this mini deck: the phrasing still stands.
	assert.equal(journeyCardHelp(gs, 'limit', t), 'game.journey_help_attack_limiter(50|)');
});

test('card help: distances carry goal and per-hand limits; the go-remedy is special', () => {
	const gs = game([seat('me'), seat('rival')]);
	assert.equal(journeyCardHelp(gs, 'distance-25', t), 'game.journey_help_distance(25|1000)');
	assert.equal(
		journeyCardHelp(gs, 'distance-200', t),
		'game.journey_help_distance(200|1000) game.journey_help_distance_limit(2) game.journey_help_distance_over_cap(50)');
	assert.equal(journeyCardHelp(gs, 'go', t), 'game.journey_help_remedy_go');
});

test('card help: an immunity lists the attacks it shields', () => {
	const gs = game([seat('me'), seat('rival')]);
	assert.equal(journeyCardHelp(gs, 'priority', t), 'game.journey_help_immunity(cards.stop, cards.limit)');
});

test('card help: a package override wins over the engine text', () => {
	const gs = game([seat('me'), seat('rival')]);
	const withOverride = (key: string, vars?: Record<string, unknown>) =>
		key === 'cards.stop_help' ? 'El semáforo detiene al rival.' : t(key, vars);
	assert.equal(journeyCardHelp(gs, 'stop', withOverride), 'El semáforo detiene al rival.');
});
