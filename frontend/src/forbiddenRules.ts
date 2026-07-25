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
