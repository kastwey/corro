// Pure text and state helpers for the bluff family: what the round is doing, what THIS player
// should be doing, how a ballot line reads, how the reveal reads. No DOM and no i18n table —
// every string comes back through the caller's translator, so all of it unit-tests without a
// browser.

import type {
	BluffBallotState, BluffLieState, BluffPlayerState, BluffRoundState, BluffState, GameState,
} from './models.js';

type T = (key: string, vars?: Record<string, unknown>) => string;

/** How many standings lines the scoreboard shows: a hall of two hundred reads its top ten. */
export const BLUFF_SCOREBOARD_SIZE = 10;

export function bluffPlayerName(gs: GameState, playerId: string): string {
	return gs.players.find(player => player.id === playerId)?.name ?? playerId;
}

export function bluffIsMaster(state: BluffState, playerId: string): boolean {
	return state.masterId === playerId;
}

/** The players in score order, best first (seat order breaks ties, so the list is stable). */
export function bluffStandings(state: BluffState): BluffPlayerState[] {
	return state.players.slice().sort((a, b) => b.score - a.score);
}

/** This player's place, 1-based; 0 when they are not at the table. */
export function bluffPlace(state: BluffState, playerId: string): number {
	return bluffStandings(state).findIndex(player => player.playerId === playerId) + 1;
}

/** My own ballot in the vote now open, if any. */
export function bluffMyBallot(round: BluffRoundState, playerId: string): BluffBallotState | null {
	const ballots = round.phase === 'final_voting' ? round.finalBallots : round.ballots;
	return ballots.find(ballot => ballot.playerId === playerId) ?? null;
}

export function bluffBallotComplete(ballot: BluffBallotState): boolean {
	return ballot.truthPick != null && (!ballot.asksFunny || ballot.funnyPick != null);
}

/** Whether this player still has a tall tale to write (the clock runs, and they are not done). */
export function bluffCanWrite(round: BluffRoundState, playerId: string): boolean {
	return round.phase === 'writing'
		&& round.entries.some(entry => entry.playerId === playerId && !entry.finished);
}

/**
 * The headline of the round: which round of how many, and what the table is doing. Said in the
 * same sentence, because a player who cannot see the screen keeps asking exactly that.
 */
export function bluffNowPlayingText(gs: GameState, playerId: string, t: T): string | null {
	const state = gs.bluff;
	const round = state?.round;
	if (!state || !round) return null;
	const master = bluffIsMaster(state, playerId);
	const key = `game.bluff_now_${round.phase}`;
	return t(master && (round.phase === 'preparing' || round.phase === 'reveal') ? `${key}_self` : key, {
		round: round.roundNumber,
		total: state.roundsToPlay,
		master: bluffPlayerName(gs, state.masterId),
	});
}

/** What THIS player must do right now — their own job, nobody else's. */
export function bluffDutyText(gs: GameState, playerId: string, t: T): string | null {
	const state = gs.bluff;
	const round = state?.round;
	if (!state || !round) return null;
	const master = bluffIsMaster(state, playerId);
	switch (round.phase) {
		case 'preparing':
			return t(master ? 'game.bluff_duty_preparing_master' : 'game.bluff_duty_preparing', {
				master: bluffPlayerName(gs, state.masterId),
			});
		case 'writing':
			return t(bluffCanWrite(round, playerId) ? 'game.bluff_duty_writing' : 'game.bluff_duty_written');
		case 'voting':
		case 'final_voting': {
			const ballot = bluffMyBallot(round, playerId);
			if (!ballot) return t('game.bluff_duty_no_ballot');
			if (bluffBallotComplete(ballot)) return t('game.bluff_duty_voted');
			if (ballot.truthKnown) return t('game.bluff_duty_final_known');
			if (round.phase === 'final_voting') return t('game.bluff_duty_final');
			return t(ballot.truthPick == null ? 'game.bluff_duty_vote_truth' : 'game.bluff_duty_vote_funny');
		}
		case 'reveal':
			return t(master ? 'game.bluff_duty_reveal_master' : 'game.bluff_duty_reveal', {
				master: bluffPlayerName(gs, state.masterId),
			});
		default:
			return t('game.bluff_duty_finished');
	}
}

/**
 * How far the phase has got, in one sentence: how many are still writing, or still voting.
 * The count is the server's (the other ballots never reach this client), so it is never guessed.
 */
export function bluffProgressText(gs: GameState, t: T): string | null {
	const round = gs.bluff?.round;
	if (!round) return null;
	switch (round.phase) {
		case 'writing':
			return round.pendingCount > 0
				? t('game.bluff_progress_writing', { remaining: round.pendingCount })
				: t('game.bluff_progress_writing_none');
		case 'voting':
		case 'final_voting':
			return round.pendingCount > 0
				? t('game.bluff_progress_voting', { remaining: round.pendingCount })
				: t('game.bluff_progress_voting_none');
		default:
			return null;
	}
}

/** One flowing status sentence for the players panel and the S shortcut. */
export function bluffStatusText(gs: GameState, playerId: string, t: T): string | null {
	const state = gs.bluff;
	const player = state?.players.find(entry => entry.playerId === playerId);
	if (!state || !player) return null;
	return t('game.bluff_status_self', {
		score: player.score,
		place: bluffPlace(state, playerId),
		count: state.players.length,
	});
}

/** The leaders for Shift+S — the top of the table, my own line left out (S already says it). */
export function bluffRivalStatus(gs: GameState, playerId: string, t: T): string | null {
	const state = gs.bluff;
	if (!state) return null;
	const leaders = bluffStandings(state)
		.filter(player => player.playerId !== playerId)
		.slice(0, 3);
	if (leaders.length === 0) return null;
	return leaders
		.map(player => t('game.bluff_status_rival', {
			player: bluffPlayerName(gs, player.playerId),
			score: player.score,
		}))
		.join(' ');
}

/** How one ballot line reads: its number and its text, and nothing else. The tales carry no
 *  names until the reveal, and the truth carries no mark at all. */
export function bluffOptionLabel(option: { index: number; text: string }, t: T): string {
	return t('game.bluff_option_line', { number: option.index + 1, text: option.text });
}

/** The lines the ballot's second question offers: everything but the line taken for the truth. */
export function bluffFunnyOptions(ballot: BluffBallotState) {
	return ballot.options.filter(option => option.index !== ballot.truthPick);
}

/** A tall tale with its authors, as one sentence: one name, or the first name and how many more. */
export function bluffLieLine(gs: GameState, lie: BluffLieState, keyBase: string, count: number, t: T): string {
	const author = bluffPlayerName(gs, lie.authorIds[0] ?? '');
	return lie.authorIds.length > 1
		? t(`${keyBase}_more`, { lie: lie.text, author, others: lie.authorIds.length - 1, count })
		: t(keyBase, { lie: lie.text, author, count });
}

/** The reveal, as the lines a player reads: the truth, the best tale, the funniest, and my own
 *  result. Every line is a sentence; the lists of believers are counts, never names read out. */
export function bluffRevealLines(gs: GameState, playerId: string, t: T): string[] {
	const round = gs.bluff?.round;
	const reveal = round?.reveal;
	if (!round || !reveal) return [];
	const lines = [t('game.bluff_reveal_truth_line', { truth: round.truth, count: reveal.truthFinderCount })];
	const best = round.lies.find(lie => lie.id === reveal.bestLieId);
	if (best) {
		lines.push(bluffLieLine(gs, best, 'game.bluff_reveal_best_line',
			best.believerIds.length + best.finalBelieverIds.length, t));
	}
	const funniest = round.lies.find(lie => lie.id === reveal.funniestLieId);
	if (funniest) {
		lines.push(bluffLieLine(gs, funniest, 'game.bluff_reveal_funniest_line', funniest.funnyVoterIds.length, t));
	}
	const mine = reveal.results.find(result => result.playerId === playerId);
	if (mine) {
		const key = mine.foundTruth
			? (mine.shownCount === 0 ? 'game.bluff_result_truth_nolie' : mine.fooledCount > 0 ? 'game.bluff_result_truth_fooled' : 'game.bluff_result_truth_none')
			: (mine.shownCount === 0 ? 'game.bluff_result_miss_nolie' : mine.fooledCount > 0 ? 'game.bluff_result_miss_fooled' : 'game.bluff_result_miss_none');
		lines.push(t(key, {
			truthPoints: mine.truthPoints,
			fooled: mine.fooledCount,
			shown: mine.shownCount,
			foolPoints: mine.foolPoints,
			points: mine.truthPoints + mine.foolPoints,
			total: mine.total,
		}));
	}
	return lines;
}

/** My own tall tale this round, once the reveal names them all: its text, and who fell for it. */
export function bluffMyLie(round: BluffRoundState, playerId: string): BluffLieState | null {
	return round.lies.find(lie => lie.authorIds.includes(playerId)) ?? null;
}
