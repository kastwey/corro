import test from 'node:test';
import assert from 'node:assert/strict';
import {
	buildPropertyRulesLines, buildRaceRulesLines, buildTrackRulesLines,
	buildJourneyRulesLines, buildAssemblyRulesLines, buildDraftRulesLines,
	buildSheddingRulesLines,
} from '../src/rulesSummaries.js';
import type {
	GameSettings, RaceRulesConfig, RaceBoardDef, TrackRulesConfig, TrackBoardDef,
	JourneyRulesConfig, AssemblyRulesConfig, DraftRulesConfig, SheddingRulesConfig,
} from '../src/models.js';

// The in-game "active rules" dialog content (Ctrl+Shift+F1): each family's effective config
// turned into readable lines. Pure — DOM-free. The fake `t` echoes key(vars) so the asserts
// read the shape; on/off resolves to the shared game.rules_on / game.rules_off keys.

const t = (key: string, vars?: Record<string, unknown>) =>
	vars && Object.keys(vars).length ? `${key}(${Object.values(vars).join('|')})` : key;

// ── Shedding ───────────────────────────────────────────────────────────────────

const sheddingBase: SheddingRulesConfig = {
	handSize: 7, targetScore: 500, drawnCardPlayable: true, wildDrawRequiresNoMatch: true,
};

test('shedding: lists the house rules by their state, shared on/off keys', () => {
	const lines = buildSheddingRulesLines(
		{ ...sheddingBase, allowDoubles: true, stacking: 'cross', lastCardCall: true }, t);
	assert.deepEqual(lines, [
		'game.shedding_rules_hand_size(7)',
		'game.shedding_rules_target(500)',
		'game.shedding_rules_draw_play(game.rules_on)',
		'game.shedding_rules_honest_wild(game.rules_on)',
		'game.shedding_rules_doubles(game.rules_on)',
		'game.shedding_rules_stacking(game.shedding_rules_stacking_cross)',
		'game.shedding_rules_last_card(game.rules_on)',
	]);
});

test('shedding: a zero target is a single round; missing rules fall back to defaults', () => {
	assert.equal(buildSheddingRulesLines({ ...sheddingBase, targetScore: 0 }, t)[1],
		'game.shedding_rules_target_single');
	assert.equal(buildSheddingRulesLines(null, t)[0], 'game.shedding_rules_hand_size(7)');
});

// ── Property ─────────────────────────────────────────────────────────────────---

test('property: reads the economy settings, defaulting the classic values', () => {
	const s: GameSettings = { startingMoney: 1500 };
	const lines = buildPropertyRulesLines(s, t);
	assert.ok(lines.includes('game.property_rules_starting_money(1500)'));
	// An unspecified toggle takes its classic default (auction on decline = on).
	assert.ok(lines.includes('game.property_rules_auction(game.rules_on)'));
	// Empty settings still produce the full defaulted list without throwing.
	assert.equal(buildPropertyRulesLines(null, t).length, lines.length);
});

// ── Race ─────────────────────────────────────────────────────────────────────---

const raceRules: RaceRulesConfig = {
	exitOn: 5, extraRollOn: 6, threeSixesPenalty: true, captureBonus: 20, goalBonus: 10,
	sixWorthSevenWhenNoneHome: true, barriers: true,
};
const raceBoard = { piecesPerPlayer: 4 } as RaceBoardDef;

test('race: pieces from the board, the die rules, and the pairs flag', () => {
	const lines = buildRaceRulesLines(raceRules, raceBoard, true, t);
	assert.equal(lines[0], 'game.race_rules_pieces(4)');
	assert.ok(lines.includes('game.race_rules_exit_on(5)'));
	assert.ok(lines.includes('game.race_rules_barriers(game.rules_on)'));
	assert.ok(lines.includes('game.race_rules_pairs(game.rules_on)'));
});

// ── Track ────────────────────────────────────────────────────────────────────---

test('track: board size and the exact-finish behaviour', () => {
	const rules: TrackRulesConfig = { exactFinish: 'stay', rollAgainOnMax: true };
	const board = { trackLength: 100 } as TrackBoardDef;
	const lines = buildTrackRulesLines(rules, board, t);
	assert.equal(lines[0], 'game.track_rules_size(100)');
	assert.equal(lines[1], 'game.track_rules_exact_finish(game.track_rules_finish_stay)');
	assert.equal(lines[2], 'game.track_rules_roll_again(game.rules_on)');
});

// ── Journey / Assembly / Draft ─────────────────────────────────────────────────

test('journey: goal, target (single when zero), caps and bonuses', () => {
	const r = { goalKm: 700, targetScore: 0, handSize: 6, stackHazards: true, limitCap: 2,
		initialHazard: 'stop', allImmunitiesBonus: 300 } as JourneyRulesConfig;
	const lines = buildJourneyRulesLines(r, t);
	assert.equal(lines[0], 'game.journey_rules_goal(700)');
	assert.equal(lines[1], 'game.journey_rules_target_single');
	assert.ok(lines.includes('game.journey_rules_stack(game.rules_on)'));
	assert.deepEqual(buildJourneyRulesLines(null, t), []);
});

test('assembly + draft: their handful of tunables', () => {
	const a = { handSize: 3, slotsToWin: 4, maxDiscard: 3 } as AssemblyRulesConfig;
	assert.deepEqual(buildAssemblyRulesLines(a, t), [
		'game.assembly_rules_slots(4)',
		'game.assembly_rules_hand(3)',
		'game.assembly_rules_max_discard(3)',
	]);
	const d = { rounds: 3, handSizeBase: 10, majorityFirst: 6, majoritySecond: 3,
		dessertBonus: 6, dessertPenalty: -6 } as DraftRulesConfig;
	assert.deepEqual(buildDraftRulesLines(d, t), [
		'game.draft_rules_rounds(3)',
		'game.draft_rules_hand(10)',
		'game.draft_rules_majority(6|3)',
		'game.draft_rules_dessert(6|-6)',
	]);
});
