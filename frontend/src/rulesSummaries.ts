// rulesSummaries.ts — how EVERY family describes its active rules for the rules dialog
// (Ctrl+Shift+F1). One pure builder per family: it turns the effective config into localized
// lines through the caller's translator, so they unit-test without a DOM. The mechanics are
// engine-level, so the wording lives in the app i18n (game.<family>_rules_*), not packages.

import type {
	GameSettings, RaceRulesConfig, RaceBoardDef, TrackRulesConfig, TrackBoardDef,
	JourneyRulesConfig, AssemblyRulesConfig, DraftRulesConfig, SheddingRulesConfig,
	TriviaRulesConfig,
} from './models.js';

type T = (key: string, vars?: Record<string, unknown>) => string;

/** "on"/"off" in the player's language — shared by every family's toggles. */
const onOff = (t: T, on: boolean) => t(on ? 'game.rules_on' : 'game.rules_off');

// ── Property (the classic economy) ─────────────────────────────────────────────

export function buildPropertyRulesLines(settings: GameSettings | null | undefined, t: T): string[] {
	const s = settings ?? {};
	return [
		t('game.property_rules_starting_money', { amount: s.startingMoney ?? 1500 }),
		t('game.property_rules_go_bonus', { amount: s.goBonus ?? 200 }),
		t('game.property_rules_double_go', { state: onOff(t, !!s.doubleGoSalary) }),
		t('game.property_rules_auction', { state: onOff(t, s.auctionOnDecline ?? true) }),
		t('game.property_rules_shortage', { state: onOff(t, !!s.buildingShortage) }),
		t('game.property_rules_even_build', { state: onOff(t, s.evenBuildRule ?? true) }),
		t('game.property_rules_mortgage', { rate: s.mortgageInterestRate ?? 10 }),
		t('game.property_rules_holding_release_cost', { amount: s.holdingReleaseCost ?? 50 }),
		t('game.property_rules_max_holding', { count: s.maxHoldingTurns ?? 3 }),
		t('game.property_rules_rent_while_held', { state: onOff(t, s.collectRentWhileHeld ?? true) }),
		t('game.property_rules_free_parking', { state: onOff(t, !!s.freeParkingJackpot) }),
	];
}

// ── Race (parcheesi-style) ─────────────────────────────────────────────────────

export function buildRaceRulesLines(
	rules: RaceRulesConfig | null | undefined,
	board: RaceBoardDef | null | undefined,
	teamsMode: boolean,
	t: T,
): string[] {
	const r = rules;
	const lines: string[] = [];
	if (board) lines.push(t('game.race_rules_pieces', { count: board.piecesPerPlayer }));
	if (r) {
		lines.push(
			t('game.race_rules_exit_on', { value: r.exitOn }),
			t('game.race_rules_extra_roll', { value: r.extraRollOn }),
			t('game.race_rules_barriers', { state: onOff(t, r.barriers) }),
			t('game.race_rules_three_sixes', { state: onOff(t, r.threeSixesPenalty) }),
			t('game.race_rules_six_seven', { state: onOff(t, r.sixWorthSevenWhenNoneHome) }),
			t('game.race_rules_capture_bonus', { steps: r.captureBonus }),
			t('game.race_rules_goal_bonus', { steps: r.goalBonus }),
		);
	}
	lines.push(t('game.race_rules_pairs', { state: onOff(t, teamsMode) }));
	return lines;
}

// ── Track (snakes & ladders) ───────────────────────────────────────────────────

export function buildTrackRulesLines(
	rules: TrackRulesConfig | null | undefined,
	board: TrackBoardDef | null | undefined,
	t: T,
): string[] {
	const lines: string[] = [];
	if (board) lines.push(t('game.track_rules_size', { count: board.trackLength }));
	const finish = rules?.exactFinish === 'stay'
		? t('game.track_rules_finish_stay')
		: t('game.track_rules_finish_bounce');
	lines.push(t('game.track_rules_exact_finish', { mode: finish }));
	lines.push(t('game.track_rules_roll_again', { state: onOff(t, !!rules?.rollAgainOnMax) }));
	return lines;
}

// ── Trivia (Trivial Pursuit-style) ─────────────────────────────────────────────

export function buildTriviaRulesLines(rules: TriviaRulesConfig | null | undefined, t: T): string[] {
	const r = rules ?? { answerMode: 'judge', judgeMode: 'rotating', exactFinish: true, centerWild: true, answerSeconds: 0 };
	const answerMode = r.answerMode === 'choice' ? t('game.trivia_rules_answer_choice')
		: r.answerMode === 'typed' ? t('game.trivia_rules_answer_typed')
		: t('game.trivia_rules_answer_judge');
	const lines = [t('game.trivia_rules_answer', { mode: answerMode })];
	if (r.answerMode === 'judge') {
		const judge = r.judgeMode === 'fixed'
			? t('game.trivia_rules_judge_fixed')
			: t('game.trivia_rules_judge_rotating');
		lines.push(t('game.trivia_rules_judge', { mode: judge }));
	}
	lines.push(t('game.trivia_rules_exact_finish', { state: onOff(t, r.exactFinish) }));
	lines.push(t('game.trivia_rules_center_wild', { state: onOff(t, r.centerWild) }));
	return lines;
}

// ── Journey (mille-bornes-style) ───────────────────────────────────────────────

export function buildJourneyRulesLines(rules: JourneyRulesConfig | null | undefined, t: T): string[] {
	const r = rules;
	if (!r) return [];
	return [
		t('game.journey_rules_goal', { km: r.goalKm }),
		r.targetScore > 0
			? t('game.journey_rules_target', { score: r.targetScore })
			: t('game.journey_rules_target_single'),
		t('game.journey_rules_hand', { count: r.handSize }),
		t('game.journey_rules_limit', { max: r.limitCap }),
		t('game.journey_rules_stack', { state: onOff(t, r.stackHazards) }),
		t('game.journey_rules_immunities_bonus', { points: r.allImmunitiesBonus ?? 0 }),
	];
}

// ── Assembly ───────────────────────────────────────────────────────────────────

export function buildAssemblyRulesLines(rules: AssemblyRulesConfig | null | undefined, t: T): string[] {
	const r = rules;
	if (!r) return [];
	return [
		t('game.assembly_rules_slots', { count: r.slotsToWin }),
		t('game.assembly_rules_hand', { count: r.handSize }),
		t('game.assembly_rules_max_discard', { count: r.maxDiscard }),
	];
}

// ── Draft ──────────────────────────────────────────────────────────────────────

export function buildDraftRulesLines(rules: DraftRulesConfig | null | undefined, t: T): string[] {
	const r = rules;
	if (!r) return [];
	return [
		t('game.draft_rules_rounds', { count: r.rounds }),
		t('game.draft_rules_hand', { count: r.handSizeBase }),
		t('game.draft_rules_majority', { first: r.majorityFirst, second: r.majoritySecond }),
		t('game.draft_rules_dessert', { bonus: r.dessertBonus, penalty: r.dessertPenalty }),
	];
}

// ── Shedding ───────────────────────────────────────────────────────────────────

export function buildSheddingRulesLines(rules: SheddingRulesConfig | null | undefined, t: T): string[] {
	const r = rules ?? { handSize: 7, targetScore: 500, drawnCardPlayable: true, wildDrawRequiresNoMatch: true };
	return [
		t('game.shedding_rules_hand_size', { count: r.handSize }),
		r.targetScore > 0
			? t('game.shedding_rules_target', { score: r.targetScore })
			: t('game.shedding_rules_target_single'),
		t('game.shedding_rules_draw_play', { state: onOff(t, r.drawnCardPlayable) }),
		t('game.shedding_rules_honest_wild', { state: onOff(t, r.wildDrawRequiresNoMatch) }),
		t('game.shedding_rules_doubles', { state: onOff(t, !!r.allowDoubles) }),
		t('game.shedding_rules_stacking', { mode: stackingLabel(r.stacking, t) }),
		t('game.shedding_rules_last_card', { state: onOff(t, !!r.lastCardCall) }),
	];
}

function stackingLabel(stacking: string | undefined, t: T): string {
	switch (stacking) {
		case 'sameType': return t('game.shedding_rules_stacking_same');
		case 'cross': return t('game.shedding_rules_stacking_cross');
		default: return t('game.shedding_rules_stacking_none');
	}
}
