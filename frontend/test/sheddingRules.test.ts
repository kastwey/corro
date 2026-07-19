import test from 'node:test';
import assert from 'node:assert/strict';
import {
	canPlayCard, canStackOn, deckColors, sheddingCardHelp, sheddingStatusText, topDef,
} from '../src/sheddingRules.js';
import type { GameState, SheddingSeatState } from '../src/models.js';

// Client-side mirror of the shedding legality: matching by colour / value /
// action type, the honest wild-draw gate, the drawn-card pause, and the shared status
// line (counts on demand — this family deliberately has no one-card-left shout).

const DECK = [
	{ id: 'red-5', type: 'number', color: 'red', value: 5, count: 2, nameKey: 'c.red5' },
	{ id: 'red-7', type: 'number', color: 'red', value: 7, count: 2, nameKey: 'c.red7' },
	{ id: 'blue-5', type: 'number', color: 'blue', value: 5, count: 2, nameKey: 'c.blue5' },
	{ id: 'blue-7', type: 'number', color: 'blue', value: 7, count: 2, nameKey: 'c.blue7' },
	{ id: 'skip-red', type: 'skip', color: 'red', count: 2, nameKey: 'c.skipred' },
	{ id: 'skip-blue', type: 'skip', color: 'blue', count: 2, nameKey: 'c.skipblue' },
	{ id: 'wild', type: 'wild', count: 2, nameKey: 'c.wild' },
	{ id: 'wild4', type: 'wildDrawFour', count: 2, nameKey: 'c.wild4' },
];

const inst = (cardId: string, n = 0) => ({ instanceId: `${cardId}@${n}`, cardId });

function seat(id: string, hand: string[] = [], over: Partial<SheddingSeatState> = {}): SheddingSeatState {
	return {
		playerId: id, hand: hand.map(inst), handCount: hand.length,
		score: 0, roundScores: [], ...over,
	};
}

function game(seats: SheddingSeatState[], over: Record<string, unknown> = {}): GameState {
	return {
		gameType: 'shedding',
		shedding: {
			round: 1, seats, drawPile: [], drawCount: 60,
			discardPile: [inst('red-5', 9)], discardCount: 1,
			currentColor: 'red', direction: 1, ...((over.shedding as object) ?? {}),
		},
		sheddingDeck: DECK,
		sheddingRules: { handSize: 7, targetScore: 500, drawnCardPlayable: true, wildDrawRequiresNoMatch: true },
		players: seats.map(s => ({ id: s.playerId, name: `N-${s.playerId}` })),
		currentTurn: seats[0]?.playerId ?? null,
	} as unknown as GameState;
}

/** Full-key fake translator: key + compact vars, so asserts read naturally. */
const t = (key: string, vars?: Record<string, unknown>) =>
	vars && Object.keys(vars).length ? `${key}(${Object.values(vars).join('|')})` : key;

test('matching follows the colour in force, equal values and action types', () => {
	const me = seat('me', ['red-7', 'blue-5', 'blue-7', 'skip-blue']);
	const gs = game([me, seat('r1')]);

	assert.equal(canPlayCard(gs, 'me', 'red-7@0').playable, true);  // colour
	assert.equal(canPlayCard(gs, 'me', 'blue-5@1').playable, true); // value 5 on 5
	assert.equal(canPlayCard(gs, 'me', 'blue-7@2').reasonKey, 'game.shedding_not_playable');
	assert.equal(canPlayCard(gs, 'me', 'skip-blue@3').reasonKey, 'game.shedding_not_playable');
});

test('the wild always fits; the wild-draw only with no card of the colour in force', () => {
	const holding = seat('me', ['wild', 'wild4', 'red-7']);
	const gs = game([holding, seat('r1')]);
	assert.equal(canPlayCard(gs, 'me', 'wild@0').playable, true);
	assert.equal(canPlayCard(gs, 'me', 'wild4@1').reasonKey, 'game.shedding_wild_needs_no_match');

	const clean = seat('me', ['wild4', 'blue-7']);
	assert.equal(canPlayCard(game([clean, seat('r1')]), 'me', 'wild4@0').playable, true);
});

test('mid drawn-card pause only the drawn card is playable', () => {
	const me = seat('me', ['red-7', 'blue-5']);
	const gs = game([me, seat('r1')], {
		shedding: { pendingDrawnPlay: { playerId: 'me', instanceId: 'blue-5@1' } },
	});

	assert.equal(canPlayCard(gs, 'me', 'red-7@0').reasonKey, 'game.shedding_only_drawn');
	assert.equal(canPlayCard(gs, 'me', 'blue-5@1').playable, true);
});

test('the status line: cards, the top and its colour, the reversed exception, the score', () => {
	const me = seat('me', ['red-7'], { score: 120 });
	const gs = game([me, seat('r1')]);

	assert.equal(sheddingStatusText(gs, 'me', t), [
		'game.shedding_status_cards_one',
		'game.shedding_status_top(c.red5|colors.red)',
		'game.shedding_status_score(120)',
	].join(', '));

	gs.shedding!.direction = -1;
	assert.ok(sheddingStatusText(gs, 'me', t)!.includes('game.shedding_status_reversed'));

	const gone = seat('me', [], { retired: true, score: 88 });
	assert.equal(sheddingStatusText(game([gone, seat('r1')]), 'me', t),
		'game.status_retired, game.shedding_status_score(88)');
});

// Stacking (house rule): while a penalty pile is in flight, only a stacking draw card is
// playable — colour/number matching is bypassed — mirroring the server.
test('a pending penalty admits only a stacking draw card', () => {
	const me = seat('me', ['wild4', 'red-7']);
	const gs = game([me, seat('r1')]);
	gs.shedding!.pendingPenalty = { amount: 2, lastType: 'drawTwo' };
	gs.sheddingRules!.stacking = 'cross';

	// cross: a +4 answers the +2; a plain number cannot.
	assert.equal(canPlayCard(gs, 'me', 'wild4@0').playable, true);
	const refused = canPlayCard(gs, 'me', 'red-7@1');
	assert.equal(refused.playable, false);
	assert.equal(refused.reasonKey, 'game.shedding_must_stack');

	// sameType: a +4 cannot answer a +2.
	gs.sheddingRules!.stacking = 'sameType';
	assert.equal(canPlayCard(gs, 'me', 'wild4@0').playable, false);
});

test('canStackOn mirrors the server: sameType needs the kind, cross takes any draw card', () => {
	assert.equal(canStackOn('drawTwo', 'drawTwo', 'sameType'), true);
	assert.equal(canStackOn('wildDrawFour', 'drawTwo', 'sameType'), false);
	assert.equal(canStackOn('wildDrawFour', 'drawTwo', 'cross'), true);
	assert.equal(canStackOn('number', 'drawTwo', 'cross'), false); // not a draw card
	assert.equal(canStackOn('drawTwo', 'drawTwo', 'none'), false); // rule off
});

test('helpers: deck colours in order, the top definition, per-type help', () => {
	const gs = game([seat('me'), seat('r1')]);
	assert.deepEqual(deckColors(gs), ['red', 'blue']);
	assert.equal(topDef(gs)?.id, 'red-5');
	assert.equal(sheddingCardHelp(gs, 'red-5', t), 'game.shedding_help_number(5)');
	assert.equal(sheddingCardHelp(gs, 'skip-red', t), 'game.shedding_help_skip');
	assert.equal(sheddingCardHelp(gs, 'wild4', t), 'game.shedding_help_wild_draw_four');
	const override = (key: string) => key === 'c.wild_help' ? 'La casa manda.' : key;
	assert.equal(sheddingCardHelp(gs, 'wild', override), 'La casa manda.');
});
