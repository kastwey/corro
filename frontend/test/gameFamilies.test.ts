import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';
import { familyHomeSurface, familyTraitsFor, isRollOnlyFamily } from '../src/familyTraits.js';
import { familyFor } from '../src/gameFamilies.js';

// The family registry replaced app.ts's per-gameType branches: these pin its lookup contract
// (race/track registered, property = null default), the pure traits pure modules rely on, and
// the identity phrasing (players-panel line + the C key) each family owns.

setupDom();
installFakeI18next('en', {
	'seats.red': 'Red squadron',
	'tokens.duck': 'the duck',
});

const raceState = () => ({
	gameType: 'race',
	race: { seats: [{ seatId: 's-red', playerId: 'p1', pieces: [] }] },
	raceBoard: { seats: [{ id: 's-red', nameKey: 'seats.red' }] },
}) as any;

test('familyFor resolves race, track and journey; property and unknown fall back to null', () => {
	assert.equal(familyFor('race')?.gameType, 'race');
	assert.equal(familyFor('track')?.gameType, 'track');
	assert.equal(familyFor('journey')?.gameType, 'journey');
	assert.equal(familyFor('shedding')?.gameType, 'shedding'); // "someday" arrived 2026-07-05
	assert.equal(familyFor('property'), null);
	assert.equal(familyFor(undefined), null);
	assert.equal(familyFor('deckbuilder'), null); // an unknown genre still falls back
});

test('traits: race and track are roll-only; race hides "go to player"', () => {
	assert.equal(isRollOnlyFamily('race'), true);
	assert.equal(isRollOnlyFamily('track'), true);
	assert.equal(isRollOnlyFamily('property'), false);
	assert.equal(isRollOnlyFamily(undefined), false);
	assert.equal(familyTraitsFor('race')?.showGoToPlayer, false);
	assert.equal(familyTraitsFor('track')?.showGoToPlayer, true);
});

test('traits distinguish spatial boards from card hands', () => {
	for (const gameType of ['property', 'race', 'track', 'trivia']) {
		assert.equal(familyHomeSurface(gameType), 'board', gameType);
	}
	for (const gameType of ['journey', 'assembly', 'draft', 'shedding', 'exploding']) {
		assert.equal(familyHomeSurface(gameType), 'hand', gameType);
	}
	assert.equal(familyHomeSurface('unknown'), 'board');
});

test('race identity: the seat name is the panel line and the C announcement', () => {
	const gs = raceState();
	const family = familyFor('race')!;
	assert.equal(family.boardIdentity(gs, 'p1', () => null), 'Red squadron');
	const said = family.identityAnnouncement(gs, 'p1', () => null);
	assert.deepEqual(said, { key: 'game.identity_race', vars: { squadron: 'Red squadron' } });
});

test('race identity yields nothing for a player without a seat', () => {
	const gs = raceState();
	const family = familyFor('race')!;
	assert.equal(family.boardIdentity(gs, 'ghost', () => null), null);
	assert.equal(family.identityAnnouncement(gs, 'ghost', () => null), null);
});

test('track identity: the token name is the panel line; C speaks token + colour word', () => {
	const family = familyFor('track')!;
	const me = { id: 'p1', token: 'duck', color: '#e53935' } as any;
	const getPlayer = (id: string) => (id === 'p1' ? me : null);
	const gs = { gameType: 'track' } as any;

	assert.equal(family.boardIdentity(gs, 'p1', getPlayer), 'the duck');

	const said = family.identityAnnouncement(gs, 'p1', getPlayer)!;
	// The engine palette hex resolves to a spoken colour WORD ("your colour is #e53935"
	// would be meaningless aloud).
	assert.equal(said.key, 'game.identity_track');
	assert.equal(said.vars.token, 'the duck');
	assert.ok(String(said.vars.color).length > 0);
});

test('track identity without an engine colour uses the plain phrasing', () => {
	const family = familyFor('track')!;
	const me = { id: 'p1', token: 'duck' } as any;
	const said = family.identityAnnouncement({ gameType: 'track' } as any, 'p1', () => me)!;
	assert.equal(said.key, 'game.identity_track_plain');
});
