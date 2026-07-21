import test from 'node:test';
import assert from 'node:assert/strict';
import { canPlayCard, catPairPartner } from '../src/explodingRules.js';
import type { ExplodingSeatState, GameState } from '../src/models.js';

const DECK = [
	{ id: 'rat', type: 'cat', count: 4, nameKey: 'cards.rat' },
	{ id: 'bat', type: 'cat', count: 4, nameKey: 'cards.bat' },
	{ id: 'skip', type: 'skip', count: 4, nameKey: 'cards.skip' },
	{ id: 'nope', type: 'nope', count: 4, nameKey: 'cards.nope' },
];

const inst = (cardId: string, copy: number) => ({
	instanceId: `${cardId}#${copy}`,
	cardId,
});

function game(hand: Array<ReturnType<typeof inst>>): GameState {
	const me: ExplodingSeatState = { playerId: 'me', hand, handCount: hand.length };
	const rival: ExplodingSeatState = { playerId: 'rival', hand: [], handCount: 3 };
	return {
		gameType: 'exploding',
		currentTurn: 'me',
		players: [{ id: 'me', name: 'Me' }, { id: 'rival', name: 'Rival' }],
		explodingDeck: DECK,
		exploding: {
			seats: [me, rival],
			drawPile: [],
			drawCount: 20,
			discardPile: [],
			discardCount: 0,
			drawsOwed: 1,
		},
	} as unknown as GameState;
}

test('a cat is unplayable alone or beside a different cat', () => {
	const gs = game([inst('rat', 0), inst('bat', 0)]);

	assert.equal(catPairPartner(gs, 'me', 'rat#0'), null);
	assert.deepEqual(canPlayCard(gs, 'me', 'rat#0'), {
		playable: false,
		reasonKey: 'game.exploding_cat_needs_pair',
	});
});

test('activating one cat deterministically finds the other matching copy', () => {
	const gs = game([inst('rat', 0), inst('bat', 0), inst('rat', 1)]);

	assert.equal(catPairPartner(gs, 'me', 'rat#0'), 'rat#1');
	assert.equal(catPairPartner(gs, 'me', 'rat#1'), 'rat#0');
	assert.deepEqual(canPlayCard(gs, 'me', 'rat#0'), { playable: true });
});

test('ordinary card playability stays stable off turn and through a reaction window', () => {
	const gs = game([inst('skip', 0), inst('nope', 0)]);

	assert.deepEqual(canPlayCard(gs, 'me', 'skip#0'), { playable: true });
	gs.currentTurn = 'rival';
	assert.deepEqual(canPlayCard(gs, 'me', 'skip#0'), { playable: true },
		'the turn gate must not empty a filtered hand');

	gs.exploding!.pendingAction = { actorId: 'rival', cardId: 'skip', nopeCount: 0 };
	assert.deepEqual(canPlayCard(gs, 'me', 'skip#0'), { playable: true },
		'the temporary window is checked when the card is activated, not by the filter');
	assert.deepEqual(canPlayCard(gs, 'me', 'nope#0'), { playable: true },
		'the real off-turn reaction still enters the playable filter while its window is open');
});
