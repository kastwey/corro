// Pure text and state helpers for the categories family: who is doing what this round, how a
// sheet is doing, how one answer reads under review. No DOM and no i18n table — every string
// comes back through the caller's translator, so all of it unit-tests without a browser.

import type {
	CategoriesAnswerState, CategoriesPromptState, CategoriesRoundState, CategoriesState,
	CategoriesVerdict, GameState,
} from './models.js';

type T = (key: string, vars?: Record<string, unknown>) => string;

/** The only role this family has. Everyone who is not judging is writing. */
export type CategoriesRole = 'judge' | 'writer';

export function categoriesRole(round: CategoriesRoundState, playerId: string): CategoriesRole {
	return round.judgeId === playerId ? 'judge' : 'writer';
}

export function categoriesPlayer(gs: GameState, playerId: string) {
	return gs.categories?.players.find(player => player.playerId === playerId) ?? null;
}

/** A player's display name, falling back to the id (a seat that already left). */
export function categoriesPlayerName(gs: GameState, playerId: string): string {
	return gs.players.find(player => player.id === playerId)?.name ?? playerId;
}

export function categoriesRoleLabel(role: CategoriesRole, t: T): string {
	return t(role === 'judge' ? 'game.categories_role_judge' : 'game.categories_role_writer');
}

/**
 * The headline of the round: which round, which letter, who rules on it. The letter is the one
 * fact every single answer depends on, so it is never left to a visual badge — it is said in the
 * same sentence as the round. While the round is being prepared there is no letter yet (the
 * server withholds it until the clock starts), and that phase's wording asks for none.
 */
export function categoriesNowPlayingText(gs: GameState, playerId: string, t: T): string | null {
	const state = gs.categories;
	const round = state?.round;
	if (!state || !round) return null;
	const judging = round.judgeId === playerId;
	const key = `game.categories_now_${round.phase}`;
	const headline = t(judging ? `${key}_self` : key, {
		round: round.roundNumber,
		letter: round.letter,
		judge: categoriesPlayerName(gs, round.judgeId),
	});
	return state.cycle > 1
		? `${headline} ${t('game.categories_sudden_death', { cycle: state.cycle })}`
		: headline;
}

/** What THIS player must do right now — their own job, nobody else's. */
export function categoriesDutyText(gs: GameState, playerId: string, t: T): string | null {
	const round = gs.categories?.round;
	if (!round) return null;
	const judge = categoriesRole(round, playerId) === 'judge';
	switch (round.phase) {
		case 'preparing':
			return t(judge ? 'game.categories_duty_preparing_judge' : 'game.categories_duty_preparing_writer', {
				judge: categoriesPlayerName(gs, round.judgeId),
			});
		case 'writing':
			return t(judge ? 'game.categories_duty_writing_judge' : 'game.categories_duty_writing_writer', {
				letter: round.letter,
			});
		case 'review':
			return t(judge ? 'game.categories_duty_review_judge' : 'game.categories_duty_review_writer', {
				judge: categoriesPlayerName(gs, round.judgeId),
			});
		default:
			return t('game.categories_duty_finished');
	}
}

/**
 * How far the round has got, in one sentence: while the sheets are being filled it is how many
 * writers are still writing; while the judge works through the categories it is how many are
 * left to rule. Both are the answer to "are we nearly there?", which is the question a player
 * who cannot see the screen keeps having to ask.
 */
export function categoriesProgressText(gs: GameState, t: T): string | null {
	const state = gs.categories;
	const round = state?.round;
	if (!state || !round) return null;
	switch (round.phase) {
		case 'writing': {
			const remaining = Math.max(
				0,
				categoriesWriters(state).length - round.finishedWriterIds.length);
			return remaining > 0
				? t('game.categories_progress_writing', { remaining })
				: t('game.categories_progress_writing_none');
		}
		case 'review':
			return t('game.categories_progress_review', {
				position: Math.min(round.reviewIndex + 1, round.prompts.length),
				count: round.prompts.length,
			});
		default:
			return null;
	}
}

/** One flowing status sentence for the players panel and the S shortcut. */
export function categoriesStatusText(gs: GameState, playerId: string, t: T): string | null {
	const state = gs.categories;
	const player = categoriesPlayer(gs, playerId);
	if (!state || !player) return null;
	const status = t('game.categories_status_self', {
		score: player.score,
		role: categoriesRoleLabel(categoriesRole(state.round, playerId), t),
	});
	return state.cycle > 1
		? `${status} ${t('game.categories_sudden_death', { cycle: state.cycle })}`
		: status;
}

/** Rival standings for Shift+S — my own line is left out, S already says it. */
export function categoriesRivalStatus(gs: GameState, playerId: string, t: T): string | null {
	const rivals = gs.categories?.players.filter(player => player.playerId !== playerId) ?? [];
	if (rivals.length === 0) return null;
	return rivals
		.slice()
		.sort((a, b) => b.score - a.score)
		.map(player => t('game.categories_status_rival', {
			player: categoriesPlayerName(gs, player.playerId),
			score: player.score,
		}))
		.join(' ');
}

/**
 * How one answer reads while the judge is ruling on it: who wrote it, what they wrote, and the
 * two things the engine noticed about it. The hints are worded as observations, never as
 * verdicts, because the judge is the one who decides — and because a screen-reader user hears
 * this line INSTEAD of seeing a row of icons, so an icon's worth of meaning has to be in words.
 */
export function categoriesAnswerLabel(
	gs: GameState,
	answer: CategoriesAnswerState,
	letter: string,
	t: T,
): string {
	const player = categoriesPlayerName(gs, answer.playerId);
	if (!answer.text.trim()) {
		return t('game.categories_answer_blank', { player });
	}
	const hints: string[] = [];
	if (!answer.matchesLetter) hints.push(t('game.categories_hint_letter', { letter }));
	if (answer.duplicateGroup >= 0) hints.push(t('game.categories_hint_duplicate'));
	const line = t('game.categories_answer_line', { player, answer: answer.text });
	return hints.length > 0 ? `${line} ${hints.join(' ')}` : line;
}

/** The judge's verdict options, in the order they are offered. */
export const CATEGORIES_VERDICTS: readonly Exclude<CategoriesVerdict, 'pending'>[] =
	['accepted', 'rejected', 'duplicate'];

export function categoriesVerdictLabel(verdict: CategoriesVerdict, t: T): string {
	switch (verdict) {
		case 'accepted': return t('game.categories_verdict_accepted');
		case 'rejected': return t('game.categories_verdict_rejected');
		case 'duplicate': return t('game.categories_verdict_duplicate');
		default: return t('game.categories_verdict_pending');
	}
}

/**
 * The verdicts a judge would reach by agreeing with every hint — blanks and wrong initials
 * rejected, coincidences repeated, everything else accepted. This MIRRORS the server's
 * SuggestedRulings so the controls open pre-filled and a clean category is one confirmation
 * instead of one decision per player. It is only ever a starting point: every control stays
 * editable, and the server re-derives nothing from it.
 */
export function categoriesSuggestedVerdicts(
	prompt: CategoriesPromptState,
): Map<string, Exclude<CategoriesVerdict, 'pending'>> {
	const suggested = new Map<string, Exclude<CategoriesVerdict, 'pending'>>();
	for (const answer of prompt.answers) {
		if (!answer.text.trim() || !answer.matchesLetter) suggested.set(answer.playerId, 'rejected');
		else if (answer.duplicateGroup >= 0) suggested.set(answer.playerId, 'duplicate');
		else suggested.set(answer.playerId, 'accepted');
	}
	return suggested;
}

/** Everyone expected to write this round: the table minus its judge. */
export function categoriesWriters(state: CategoriesState): string[] {
	return state.players
		.map(player => player.playerId)
		.filter(id => id !== state.round.judgeId);
}

/** Whether this player still has a sheet to fill (they write, and they have not finished). */
export function categoriesCanWrite(round: CategoriesRoundState, playerId: string): boolean {
	return round.phase === 'writing'
		&& round.judgeId !== playerId
		&& !round.finishedWriterIds.includes(playerId);
}
