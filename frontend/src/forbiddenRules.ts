import { teamDisplayName } from './enginePalette.js';
import { forbiddenPlaysSolo } from './models.js';
import type { ForbiddenTeamState, ForbiddenTurnState, GameState } from './models.js';

type T = (key: string, vars?: Record<string, unknown>) => string;

export type ForbiddenRole = 'clue-giver' | 'guesser' | 'monitor' | 'spectator';

export function forbiddenRole(turn: ForbiddenTurnState, playerId: string): ForbiddenRole {
	if (turn.clueGiverId === playerId) return 'clue-giver';
	if (turn.guesserId === playerId) return 'guesser';
	if (turn.monitorId === playerId) return 'monitor';
	return 'spectator';
}

/** The side a player scores for: their team, or — everyone for themselves — just them. */
export function forbiddenTeamFor(gs: GameState, playerId: string): ForbiddenTeamState | null {
	return gs.forbidden?.teams.find(team => team.memberIds.includes(playerId)) ?? null;
}

/**
 * How a side is named aloud: the team's colour word in team play, the player's own name when
 * everyone plays for themselves — "Red team: 3 points" would be nonsense for a side of one.
 */
export function forbiddenSideName(gs: GameState, side: ForbiddenTeamState, t: T): string {
	if (!forbiddenPlaysSolo(gs.forbiddenRules)) return teamDisplayName(side.teamIndex, t);
	const id = side.memberIds[0];
	return gs.players.find(player => player.id === id)?.name ?? id;
}

export function forbiddenRoleLabel(role: ForbiddenRole, t: T, solo = false): string {
	switch (role) {
		case 'clue-giver': return t('game.forbidden_role_clue_giver');
		case 'guesser': return t('game.forbidden_role_guesser');
		case 'monitor': return t('game.forbidden_role_monitor');
		// With no team to support, a player with no job this turn is simply waiting their turn.
		default: return t(solo ? 'game.forbidden_role_spectator_solo' : 'game.forbidden_role_spectator');
	}
}

/**
 * Is this rotation one the match should already have ended in? The family adds a WHOLE extra
 * rotation when the rounds the host asked for run out with the scores level, and THAT is what
 * sudden death means here.
 *
 * Reported from play: a five-round match called every rotation from the second on sudden death.
 * The old test — cycle > 1 — was right only while a match lasted exactly one rotation. On a
 * target score there is no sudden death at all: play simply continues until somebody arrives.
 */
function inSuddenDeath(gs: GameState): boolean {
	if (!gs.forbidden) return false;
	if (gs.forbiddenRules?.endMode === 'score') return false;
	return gs.forbidden.cycle > (gs.forbiddenRules?.cycles ?? 1);
}

/**
 * The headline of the turn: which team is up — or, everyone for themselves, which player.
 * Nothing else — not the seconds (the timer owns those), not the duties (the cast below owns
 * those), and not the turn or cycle NUMBER, which was counting bookkeeping at a player who only
 * wanted to know whose turn it was.
 *
 * The cycle survives in one place only: a tie-breaker, where the extra rotation is the whole
 * reason the match is still going, and is named as sudden death rather than as "cycle 2".
 */
export function forbiddenNowPlayingText(gs: GameState, playerId: string, t: T): string | null {
	const state = gs.forbidden;
	const turn = state?.turn;
	if (!state || !turn) return null;
	const side = state.teams.find(team => team.teamIndex === turn.teamIndex);
	const mine = side?.memberIds.includes(playerId);
	const solo = forbiddenPlaysSolo(gs.forbiddenRules);
	const key = `${turn.phase === 'active' ? 'game.forbidden_now_active' : 'game.forbidden_now_preparing'}${solo ? '_solo' : ''}`;
	const headline = t(mine ? `${key}_self` : key, side
		? { team: teamDisplayName(turn.teamIndex, t), player: forbiddenSideName(gs, side, t) }
		: undefined);
	return inSuddenDeath(gs)
		? `${headline} ${t('game.forbidden_sudden_death', { cycle: state.cycle })}`
		: headline;
}

/** What THIS player must do while the turn runs — their own duty, nobody else's. */
export function forbiddenDutyText(gs: GameState, playerId: string, t: T): string | null {
	const turn = gs.forbidden?.turn;
	if (!turn) return null;
	const clueGiver = gs.players.find(player => player.id === turn.clueGiverId)?.name ?? turn.clueGiverId;
	switch (forbiddenRole(turn, playerId)) {
		case 'clue-giver': return t('game.forbidden_duty_clue_giver');
		case 'guesser': return t('game.forbidden_duty_guesser');
		case 'monitor': return t('game.forbidden_duty_monitor', { clueGiver });
		default: return t(forbiddenPlaysSolo(gs.forbiddenRules)
			? 'game.forbidden_duty_spectator_solo'
			: 'game.forbidden_duty_spectator');
	}
}

/**
 * The three people the turn actually runs through, in the order it runs through them: who gives
 * the clues, who guesses, who monitors. Three short sentences, naming the player — or saying
 * "you" when it is me — and nothing else.
 *
 * There used to be a fourth kind of line, one per player with no assignment, saying they were
 * supporting their team. It named a role that does not exist: a player holding no job hears
 * their own name read back at them for doing nothing, and every extra name pushes the three that
 * MATTER further down a sentence somebody has to listen to on every turn.
 */
export function forbiddenCastLines(gs: GameState, playerId: string, t: T): string[] {
	const turn = gs.forbidden?.turn;
	if (!turn) return [];
	const cast: [ForbiddenRole, string | null][] = [
		['clue-giver', turn.clueGiverId],
		['guesser', turn.guesserId],
		['monitor', turn.monitorId],
	];
	const key: Record<string, string> = {
		'clue-giver': 'game.forbidden_cast_clue_giver',
		guesser: 'game.forbidden_cast_guesser',
		monitor: 'game.forbidden_cast_monitor',
	};
	return cast
		.filter((entry): entry is [ForbiddenRole, string] => !!entry[1])
		.map(([role, id]) => t(id === playerId ? `${key[role]}_self` : key[role], {
			player: gs.players.find(player => player.id === id)?.name ?? id,
		}));
}

/**
 * The complete turn context the T shortcut speaks — the headline and the cast, exactly what the
 * turn card shows, so hearing it and reading it can never diverge.
 *
 * It used to also carry my own duty in full ("describe the target without saying it or using its
 * forbidden words"), which made a key pressed several times per turn into a paragraph. The duty
 * stays where it can be read at leisure, on the turn card; T answers "whose turn is this?".
 */
export function forbiddenTurnContextText(gs: GameState, playerId: string, t: T): string | null {
	const now = forbiddenNowPlayingText(gs, playerId, t);
	if (!now) return null;
	return [now, ...forbiddenCastLines(gs, playerId, t)].join(' ');
}

/** One flowing status sentence for the player panel and S shortcut. */
export function forbiddenStatusText(gs: GameState, playerId: string, t: T): string | null {
	const state = gs.forbidden;
	const team = forbiddenTeamFor(gs, playerId);
	if (!state || !team) return null;
	const solo = forbiddenPlaysSolo(gs.forbiddenRules);
	const role = forbiddenRoleLabel(forbiddenRole(state.turn, playerId), t, solo);
	// My side is me, everyone for themselves: "Ana: 3 points" read back to Ana would be odd.
	const status = solo
		? t('game.forbidden_status_self_solo', { score: team.score, role })
		: t('game.forbidden_status_self', { team: teamDisplayName(team.teamIndex, t), score: team.score, role });
	return inSuddenDeath(gs)
		? `${status} ${t('game.forbidden_sudden_death', { cycle: state.cycle })}`
		: status;
}

/** Rival status for Shift+S: the other team, or every other player, each with their score. */
export function forbiddenRivalStatus(gs: GameState, playerId: string, t: T): string | null {
	const mine = forbiddenTeamFor(gs, playerId);
	const rivals = gs.forbidden?.teams.filter(team => team.teamIndex !== mine?.teamIndex) ?? [];
	if (rivals.length === 0) return null;
	const key = forbiddenPlaysSolo(gs.forbiddenRules) ? 'game.forbidden_status_player' : 'game.forbidden_status_team';
	return rivals.map(side => t(key, {
		team: forbiddenSideName(gs, side, t),
		player: forbiddenSideName(gs, side, t),
		score: side.score,
	})).join(' ');
}

/**
 * The protected text area's line-oriented card. Content stays in the host-selected game
 * language; only the target/forbidden headings use this player's interface language.
 * One forbidden word per line lets a screen-reader user review the list with Up/Down
 * instead of memorising one long sentence.
 */
export function formatForbiddenCard(
	target: string,
	forbiddenWords: readonly string[],
	_locale: string,
	t: T,
): string {
	const wordLines = forbiddenWords.map((word, index) =>
		`${word}${index === forbiddenWords.length - 1 ? '.' : ','}`);
	return [
		t('game.forbidden_card_target_line', { target }),
		t('game.forbidden_card_words_heading'),
		...wordLines,
	].join('\n');
}
