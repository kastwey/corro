import test from 'node:test';
import assert from 'node:assert/strict';
import {
	draftCardHelp, draftCatalog, draftHandSize, draftSeat, draftStatusText, tableSummary,
} from '../src/draftRules.js';
import type { DraftSeatState, DraftTableSlot, GameState } from '../src/models.js';

// Client-side mirror of the draft family (simultaneous pick-and-pass): the table summary
// (grouped copies, boosted cards naming their multiplier), the shared status line every
// surface speaks, and the per-card help composed from the scoring data.

const DECK = [
	{ id: 'bite1', type: 'points', value: 1, count: 6, nameKey: 'c.bite1' },
	{ id: 'bite3', type: 'points', value: 3, count: 6, nameKey: 'c.bite3' },
	{ id: 'sauce', type: 'multiplier', factor: 3, count: 4, nameKey: 'c.sauce' },
	{ id: 'pair', type: 'set', setSize: 2, setPoints: 5, count: 8, nameKey: 'c.pair' },
	{ id: 'olive', type: 'scale', scale: [1, 3, 6], count: 8, nameKey: 'c.olive' },
	{ id: 'icon3', type: 'majority', icons: 3, count: 6, nameKey: 'c.icon3' },
	{ id: 'caramel-custard', type: 'dessert', count: 8, nameKey: 'c.flan' },
];

const inst = (cardId: string, n = 0) => ({ instanceId: `${cardId}@${n}`, cardId });
const onTable = (cardId: string, n = 0): DraftTableSlot => ({ card: inst(cardId, n) });

function seat(id: string, over: Partial<DraftSeatState> = {}): DraftSeatState {
	return {
		playerId: id, hand: [], handCount: 0, hasPicked: false,
		table: [], desserts: [], score: 0, roundScores: [], ...over,
	};
}

function game(seats: DraftSeatState[]): GameState {
	return {
		gameType: 'draft',
		draft: { round: 2, trick: 3, seats, drawPile: [], drawCount: 40 },
		draftDeck: DECK,
		draftRules: {
			rounds: 3, handSizeBase: 12,
			majorityFirst: 6, majoritySecond: 3, dessertBonus: 6, dessertPenalty: 6,
		},
		players: seats.map(s => ({ id: s.playerId, name: `N-${s.playerId}` })),
		currentTurn: null,
	} as unknown as GameState;
}

/** Full-key fake translator: key + compact vars, so asserts read naturally. */
const t = (key: string, vars?: Record<string, unknown>) =>
	vars && Object.keys(vars).length ? `${key}(${Object.values(vars).join('|')})` : key;

test('the hand size follows the base-minus-players curve', () => {
	assert.equal(draftHandSize(game([seat('a'), seat('b')])), 10);
	assert.equal(draftHandSize(game([seat('a'), seat('b'), seat('c')])), 9);
});

test('tableSummary groups plain copies and keeps boosted cards individual', () => {
	const me = seat('me', {
		table: [
			onTable('pair', 0),
			{ card: inst('bite3'), onMultiplier: inst('sauce') },
			onTable('pair', 1),
			onTable('icon3'),
		],
	});
	const items = tableSummary(me, draftCatalog(game([me])), t);

	assert.deepEqual(items, [
		'game.draft_table_copies(c.pair|2)',      // grouped at first appearance
		'game.draft_table_boosted(c.bite3|c.sauce|3)',
		'c.icon3',                                // a single copy is just its name
	]);
});

test('the status line composes round, score, table, desserts and the sent pick', () => {
	const me = seat('me', {
		score: 14, handCount: 5, hasPicked: true,
		table: [onTable('olive', 0), onTable('olive', 1)],
		desserts: [inst('caramel-custard', 0), inst('caramel-custard', 1)],
	});
	const status = draftStatusText(game([me, seat('r1')]), 'me', t);

	assert.equal(status, [
		'game.draft_status_round(2|3)',
		'game.draft_status_score(14)',
		'game.draft_status_table(game.draft_table_copies(c.olive|2))',
		'game.draft_status_desserts(2)',
		'game.draft_status_picked',
	].join(', '));
});

test('an empty table and no desserts stay silent; one dessert is singular', () => {
	const quiet = draftStatusText(game([seat('me'), seat('r1')]), 'me', t)!;
	assert.ok(!quiet.includes('draft_status_table'));
	assert.ok(!quiet.includes('desserts'));

	const one = seat('me', { desserts: [inst('caramel-custard')] });
	assert.ok(draftStatusText(game([one, seat('r1')]), 'me', t)!.includes('game.draft_status_dessert_one'));
});

test('a retired seat tells its exit and its banked score, nothing else', () => {
	const gone = seat('me', { retired: true, score: 21, hasPicked: false });
	assert.equal(
		draftStatusText(game([gone, seat('r1')]), 'me', t),
		'game.status_retired, game.draft_status_score(21)');
});

test('status is null for a player without a seat', () => {
	assert.equal(draftStatusText(game([seat('a'), seat('b')]), 'ghost', t), null);
	assert.equal(draftSeat(game([seat('a'), seat('b')]), 'ghost'), null);
});

test('card help composes from the scoring data, one shape per type', () => {
	const gs = game([seat('me'), seat('r1')]);
	assert.equal(draftCardHelp(gs, 'bite3', t), 'game.draft_help_points(3)');
	assert.equal(draftCardHelp(gs, 'sauce', t), 'game.draft_help_multiplier(3)');
	assert.equal(draftCardHelp(gs, 'pair', t), 'game.draft_help_set(2|5)');
	assert.equal(draftCardHelp(gs, 'olive', t), 'game.draft_help_scale(1, 3, 6)');
	assert.equal(draftCardHelp(gs, 'icon3', t), 'game.draft_help_majority(3|6|3)');
	assert.equal(draftCardHelp(gs, 'caramel-custard', t), 'game.draft_help_dessert(6|6)');
	assert.equal(draftCardHelp(gs, 'ghost', t), null);
});

test('a package may override a card help via <nameKey>_help', () => {
	const gs = game([seat('me'), seat('r1')]);
	const override = (key: string) => key === 'c.flan_help' ? 'La abuela manda.' : key;
	assert.equal(draftCardHelp(gs, 'caramel-custard', override), 'La abuela manda.');
});
