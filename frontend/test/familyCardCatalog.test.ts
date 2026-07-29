import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';
import type { GameState } from '../src/models.js';

let familyCardFaceHtml: typeof import('../src/familyCardCatalog.js').familyCardFaceHtml;
let familyCardBackHtml: typeof import('../src/familyCardCatalog.js').familyCardBackHtml;

before(async () => {
	setupDom();
	installFakeI18next('en');
	({ familyCardFaceHtml, familyCardBackHtml } = await import('../src/familyCardCatalog.js'));
});

/** A state carrying one family's catalog — the shape the card-flight layer reads. */
function stateWith(gameType: string, catalog: Partial<GameState> = {}): GameState {
	return { gameType, ...catalog } as GameState;
}

const exploding = stateWith('exploding', {
	explodingDeck: [{ id: 'bomb-1', type: 'bomb', nameKey: 'c.bomb', count: 1 }],
} as Partial<GameState>);

const journey = stateWith('journey', {
	journeyDeck: [{ id: 'km-100', type: 'distance', value: 100, nameKey: 'c.km' }],
} as Partial<GameState>);

const shedding = stateWith('shedding', {
	sheddingDeck: [{ id: 'red-5', type: 'number', value: 5, nameKey: 'c.r5', color: 'red', count: 1 }],
} as Partial<GameState>);

test('each family draws its card with ITS OWN renderer', () => {
	// The renderers are told apart by their class prefix: exploding "xcard", journey "jcard",
	// everyone else the neutral "gcard". A family wired to the wrong renderer shows up here.
	assert.match(familyCardFaceHtml(exploding, 'bomb-1'), /class="xcard xcard--/);
	assert.match(familyCardFaceHtml(journey, 'km-100'), /class="jcard jcard--/);
	assert.match(familyCardFaceHtml(shedding, 'red-5'), /class="gcard gcard--/);
});

test('each family reads its OWN catalog slot on the state', () => {
	// The value only reaches the face if the right deck slot was consulted; a wrong slot would
	// find nothing and silently fall back to a card back, which no class assertion would catch.
	assert.match(familyCardFaceHtml(journey, 'km-100'), />100</);
	assert.match(familyCardFaceHtml(shedding, 'red-5'), />5</);

	// And the catalogs do not bleed: journey's id is unknown to shedding.
	assert.equal(familyCardFaceHtml(shedding, 'km-100'), familyCardBackHtml(shedding));
});

test('a card the catalog does not hold falls back to the back, never to empty markup', () => {
	// A rival's card the per-player projection stripped, and a deliberately face-down move.
	assert.equal(familyCardFaceHtml(shedding, 'blue-9'), familyCardBackHtml(shedding));
	assert.equal(familyCardFaceHtml(shedding, null), familyCardBackHtml(shedding));
	assert.notEqual(familyCardBackHtml(shedding), '');
});

test('exploding and journey keep their own backs; other families share the neutral one', () => {
	const explodingBack = familyCardBackHtml(exploding);
	const journeyBack = familyCardBackHtml(journey);
	const sheddingBack = familyCardBackHtml(shedding);

	assert.match(explodingBack, /xcard--back/);
	assert.match(journeyBack, /jcard--back/);
	assert.match(sheddingBack, /gcard--back/);
	// The families with no art of their own resolve to the SAME neutral back.
	assert.equal(sheddingBack, familyCardBackHtml(stateWith('draft')));
	assert.equal(sheddingBack, familyCardBackHtml(stateWith('assembly')));
});

test('a family with no card art at all still gets the neutral back instead of throwing', () => {
	// The spatial families never reach the card layer, and an unknown gameType must not throw.
	const neutral = familyCardBackHtml(stateWith('property'));

	assert.match(neutral, /gcard--back/);
	assert.equal(familyCardBackHtml(stateWith('not-a-family')), neutral);
	assert.equal(familyCardBackHtml(null), neutral);
	assert.equal(familyCardFaceHtml(null, 'anything'), neutral);
});
