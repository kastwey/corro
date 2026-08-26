/**
 * End screen: shown once the match is over. It is a PARALLEL presentation layer for sighted
 * players — the spoken voice of the win is owned by the server (game.game_over, with
 * first-person support). The screen shows the final standings as a ranked list and offers a
 * single button back to the table. It opens as a native modal <dialog> via the dialogManager,
 * so focus is trapped and restored and the title/content are exposed to assistive tech when
 * it opens.
 *
 * Two shapes, decided by the server. A family that counts something seals its own table into
 * state.finalStandings — one row per SIDE (a player, or a whole team named together) with the
 * number that side ended on — and the screen adds a third column headed by whatever that
 * family counts. Without one (the property family ends with everyone else bankrupt; the
 * exploding family only records who fell first; and any match that finished before this
 * existed) the screen keeps the plain ranked list of names it has always shown.
 *
 * The order is the server's either way, never the number: a shedding match played with the
 * penalty count is won by the LOWEST score.
 *
 * The pure logic (computeStandings / standingsRows) is unit-tested in isolation.
 */

import { dialogManager } from './dialogManager.js';
import { teamDisplayName } from './enginePalette.js';
import { tSync } from './i18nBinder.js';
import { joinList } from './listFormat.js';
import type { GameState } from './models.js';

const t = (key: string, vars?: Record<string, any>): string => tSync(`game.${key}`, vars);

/**
 * Who actually WON: the winnerId alone, every member of a winning Journey seat, or every
 * member of the winning Forbidden Words team, plus the team name for the banner.
 */
export function winningSide(state: GameState): { ids: Set<string>; teamName: string | null } {
	const ids = new Set<string>();
	if (state.winnerId) ids.add(state.winnerId);
	const forbiddenTeam = state.winnerId
		? state.forbidden?.teams.find(team => team.memberIds.includes(state.winnerId!)) ?? null
		: null;
	if (forbiddenTeam) {
		for (const memberId of forbiddenTeam.memberIds) ids.add(memberId);
		return {
			ids,
			teamName: teamDisplayName(forbiddenTeam.teamIndex, (k, v) => tSync(k, v)),
		};
	}
	const seats = state.journey?.seats ?? [];
	const seat = state.winnerId
		? seats.find(s => s.members?.some(m => m.playerId === state.winnerId)) ?? null
		: null;
	if (!seat || (seat.members?.length ?? 0) < 2) return { ids, teamName: null };
	for (const member of seat.members) ids.add(member.playerId);
	return { ids, teamName: teamDisplayName(seats.indexOf(seat), (k, v) => tSync(k, v)) };
}

export interface StandingRow {
	playerId: string;
	/** Everyone this row stands for: one player, or a whole team playing together. */
	memberIds: string[];
	/** What the row reads as: a name, or "the red team: Ana and Berto". */
	name: string;
	/** Finishing position: 1 = winner, 2 = runner-up (last eliminated), … */
	place: number;
	isBankrupt: boolean;
	isWinner: boolean;
	/** The number this side ended on, or null when the family counts nothing. */
	value: number | null;
}

/**
 * Final standings as a ranked list: the winner first, then the eliminated players ordered by how
 * long they survived — the last one knocked out is the runner-up, the first one out finishes last.
 * The server stamps each player's finishing place when they go bankrupt (Player.finishPlace) and
 * the winner comes from state.winnerId — EVERY member of the winning journey seat counts as a
 * winner (partners win together). Name is only a stable tie-breaker for unexpected states.
 */
export function computeStandings(state: GameState, winnerIds?: Set<string>): StandingRow[] {
	const winners = winnerIds ?? winningSide(state).ids;
	const rows: StandingRow[] = (state.players ?? []).map(p => {
		const isWinner = winners.has(p.id);
		return {
			playerId: p.id,
			memberIds: [p.id],
			name: p.name,
			place: isWinner ? 1 : (p.finishPlace ?? 0),
			isBankrupt: p.isBankrupt === true,
			isWinner,
			value: null,
		};
	});

	rows.sort((a, b) => {
		if (a.isWinner !== b.isWinner) return a.isWinner ? -1 : 1;
		// Ascending place: winner (1) first, then runner-up (2), … first-out (highest) last.
		if (a.place !== b.place) return a.place - b.place;
		return a.name.localeCompare(b.name);
	});
	return rows;
}

/**
 * The rows to show: the server's sealed table when the family sealed one, and the plain ranked
 * list of players otherwise. A team row names the team first and its members after — the same
 * words the victory banner uses ("the red team") — so the table and the voice agree; a family
 * whose own announcements name the two partners instead passes no team index and the row simply
 * reads "Ana and Berto".
 */
export function standingsRows(state: GameState, winnerIds?: Set<string>): StandingRow[] {
	const winners = winnerIds ?? winningSide(state).ids;
	const sides = state.finalStandings?.sides;
	if (!sides || sides.length === 0) return computeStandings(state, winners);

	const players = state.players ?? [];
	const nameOf = (id: string) => players.find(p => p.id === id)?.name ?? id;
	return sides.map(side => {
		const members = joinList(side.memberIds.map(nameOf));
		const named = side.teamIndex != null && side.memberIds.length > 1
			? tSync('game.end_team_members', {
				team: teamDisplayName(side.teamIndex, (k, v) => tSync(k, v)),
				members,
			})
			: members;
		return {
			playerId: side.memberIds[0] ?? '',
			memberIds: side.memberIds,
			name: named,
			place: side.place,
			isBankrupt: side.memberIds.every(id => players.find(p => p.id === id)?.isBankrupt === true),
			isWinner: side.memberIds.some(id => winners.has(id)),
			value: side.value,
		};
	});
}

function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, c =>
		({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

let shown = false;

/** Forget that a match's end screen was shown, so the NEXT match at this table can show its own. */
export function resetEndScreen(): void {
	shown = false;
}

/**
 * Show the end screen once. Subsequent gameStateUpdated pushes (the server emits a few more as
 * the match is retired) are ignored thanks to the once-guard.
 *
 * `onDismissed` runs when the player closes it, by button or Escape. That is the way back to
 * the table: a finished match no longer ends the group that played it, so nobody is sent home.
 */
export function showEndScreen(
	state: GameState,
	myPlayerId: string | null,
	options: { onDismissed: () => void },
): void {
	if (shown) return;
	shown = true;

	const side = winningSide(state);
	const standings = standingsRows(state, side.ids);
	const iWon = !!myPlayerId && side.ids.has(myPlayerId);
	const winnerName = side.teamName ?? state.winnerName ?? standings[0]?.name ?? '';

	// Team games: the banner names the team and celebrates every member.
	const bannerText = iWon
		? (side.teamName ? t('end_winner_team_you', { team: side.teamName }) : t('end_winner_you'))
		: (side.teamName ? t('end_winner_team_other', { team: side.teamName }) : t('end_winner_other', { player: winnerName }));
	const banner = `<p class="end-screen__banner${iWon ? ' end-screen__banner--win' : ''}">${escapeHtml(bannerText)}</p>`;

	// The measure column only exists when the family sealed a table; its heading is the family's
	// own word for what it counts, resolved in THIS player's language (and overridable by a
	// package, like every other game.* key).
	const measureKey = state.finalStandings?.measureKey ?? null;
	const measureLabel = measureKey && standings.some(row => row.value !== null)
		? tSync(measureKey) : null;
	// A table of teams says "Team"; one of people keeps saying "Player".
	const everyRowIsATeam = standings.length > 0 && standings.every(row => row.memberIds.length > 1);

	const rows = standings.map((row, i) => {
		// Partners share their seat's place: show it (tied "1, 1, 2, 2"), not the row index.
		const rank = row.place > 0 ? row.place : i + 1;
		// "(you)" on your own row — or "(your team)", since a team row carries several names and
		// a bare "(you)" hanging off the end of it would not say which one is yours.
		const mine = !!myPlayerId && row.memberIds.includes(myPlayerId);
		const you = mine
			? ` <span class="end-screen__you">${escapeHtml(t(row.memberIds.length > 1 ? 'end_your_team' : 'end_you'))}</span>`
			: '';
		return `<tr${row.isWinner ? ' class="end-screen__winner-row"' : ''}>`
			+ `<td>${rank}</td>`
			+ `<th scope="row">${escapeHtml(row.name)}${you}</th>`
			+ (measureLabel ? `<td>${row.value ?? ''}</td>` : '')
			+ `</tr>`;
	}).join('');

	const table = `<table class="end-screen__standings">`
		+ `<thead><tr>`
		+ `<th scope="col">${escapeHtml(t('end_col_rank'))}</th>`
		+ `<th scope="col">${escapeHtml(t(everyRowIsATeam ? 'end_col_team' : 'end_col_player'))}</th>`
		+ (measureLabel ? `<th scope="col">${escapeHtml(measureLabel)}</th>` : '')
		+ `</tr></thead>`
		+ `<tbody>${rows}</tbody>`
		+ `</table>`;

	const content = `<div class="end-screen">`
		+ banner
		+ `<h3 class="end-screen__standings-heading">${escapeHtml(t('end_standings_heading'))}</h3>`
		+ table
		+ `</div>`;

	dialogManager.show({
		title: t('end_title'),
		content,
		className: 'dialog-end-screen',
		// Reading dialog: the banner and the standings are a DOCUMENT to browse (no
		// role="application" anywhere — NVDA builds no buffer inside one, so only the
		// back-home button was readable), and focus starts at the title.
		documentMode: true,
		buttons: [{
			label: t('end_back_to_table'),
			variant: 'primary',
			action: () => dialogManager.close(),
		}],
		// Closing the finished match (button or Escape) hands the page back to the table.
		onClose: options.onDismissed,
	});
}
