import { teamDisplayName } from './enginePalette.js';
import type { ForbiddenTeamState, ForbiddenTurnState, GameState } from './models.js';

type T = (key: string, vars?: Record<string, unknown>) => string;

export type ForbiddenRole = 'clue-giver' | 'guesser' | 'monitor' | 'spectator';

export function forbiddenRole(turn: ForbiddenTurnState, playerId: string): ForbiddenRole {
	if (turn.clueGiverId === playerId) return 'clue-giver';
	if (turn.guesserId === playerId) return 'guesser';
	if (turn.monitorId === playerId) return 'monitor';
	return 'spectator';
}

export function forbiddenTeamFor(gs: GameState, playerId: string): ForbiddenTeamState | null {
	return gs.forbidden?.teams.find(team => team.memberIds.includes(playerId)) ?? null;
}

export function forbiddenRoleLabel(role: ForbiddenRole, t: T): string {
	switch (role) {
		case 'clue-giver': return t('game.forbidden_role_clue_giver');
		case 'guesser': return t('game.forbidden_role_guesser');
		case 'monitor': return t('game.forbidden_role_monitor');
		default: return t('game.forbidden_role_spectator');
	}
}

/**
 * The headline of the turn: which team is up, whose voice carries it, and where we are in the
 * match. It is the answer to "who is playing?" at a glance, so it deliberately leaves out the
 * seconds (the timer panel owns those) and every duty (the turn card owns those).
 */
export function forbiddenNowPlayingText(gs: GameState, playerId: string, t: T): string | null {
	const state = gs.forbidden;
	const turn = state?.turn;
	if (!state || !turn) return null;
	const mine = turn.clueGiverId === playerId;
	const vars = {
		turn: turn.turnNumber,
		cycle: state.cycle,
		team: teamDisplayName(turn.teamIndex, t),
		clueGiver: gs.players.find(player => player.id === turn.clueGiverId)?.name ?? turn.clueGiverId,
	};
	const key = turn.phase === 'active' ? 'game.forbidden_now_active' : 'game.forbidden_now_preparing';
	return t(mine ? `${key}_self` : key, vars);
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
		default: return t('game.forbidden_duty_spectator');
	}
}

/**
 * Everyone ELSE at the table this turn, one flowing sentence each, in the order the turn runs
 * through them: the clue-giver, the guesser, the monitor, then the players supporting from
 * their seats — who hold no assignment and were, until now, invisible to a player who cannot
 * see the table. Each line names the team it belongs to, since the monitor comes from the rival one.
 */
export function forbiddenOtherRoleLines(gs: GameState, playerId: string, t: T): string[] {
	const state = gs.forbidden;
	const turn = state?.turn;
	if (!state || !turn) return [];

	const roleOf = (id: string): ForbiddenRole => forbiddenRole(turn, id);
	const order: Record<ForbiddenRole, number> = {
		'clue-giver': 0, guesser: 1, monitor: 2, spectator: 3,
	};
	const key: Record<ForbiddenRole, string> = {
		'clue-giver': 'game.forbidden_role_item_clue_giver',
		guesser: 'game.forbidden_role_item_guesser',
		monitor: 'game.forbidden_role_item_monitor',
		spectator: 'game.forbidden_role_item_supporter',
	};

	return state.teams
		.flatMap(team => team.memberIds.map(id => ({ id, teamIndex: team.teamIndex })))
		.filter(member => member.id !== playerId)
		.sort((a, b) => order[roleOf(a.id)] - order[roleOf(b.id)])
		.map(member => t(key[roleOf(member.id)], {
			player: gs.players.find(player => player.id === member.id)?.name ?? member.id,
			team: teamDisplayName(member.teamIndex, t),
		}));
}

/**
 * The complete turn context the T shortcut speaks: exactly what the turn card shows — the
 * headline, my own duty, and everyone else's — so hearing it and reading it can never diverge.
 */
export function forbiddenTurnContextText(gs: GameState, playerId: string, t: T): string | null {
	const now = forbiddenNowPlayingText(gs, playerId, t);
	const duty = forbiddenDutyText(gs, playerId, t);
	if (!now || !duty) return null;
	return [now, duty, ...forbiddenOtherRoleLines(gs, playerId, t)].join(' ');
}

/** One flowing status sentence for the player panel and S shortcut. */
export function forbiddenStatusText(gs: GameState, playerId: string, t: T): string | null {
	const state = gs.forbidden;
	const team = forbiddenTeamFor(gs, playerId);
	if (!state || !team) return null;
	return t('game.forbidden_status_self', {
		team: teamDisplayName(team.teamIndex, t),
		score: team.score,
		cycle: state.cycle,
		role: forbiddenRoleLabel(forbiddenRole(state.turn, playerId), t),
	});
}

/** Rival status for Shift+S. */
export function forbiddenRivalStatus(gs: GameState, playerId: string, t: T): string | null {
	const mine = forbiddenTeamFor(gs, playerId);
	const rivals = gs.forbidden?.teams.filter(team => team.teamIndex !== mine?.teamIndex) ?? [];
	if (rivals.length === 0) return null;
	return rivals.map(team => t('game.forbidden_status_team', {
		team: teamDisplayName(team.teamIndex, t),
		score: team.score,
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
