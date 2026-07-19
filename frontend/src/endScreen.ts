/**
 * End screen: shown once the game is over (a single solvent player remains). It is a
 * PARALLEL presentation layer for sighted players — the spoken voice of the win is owned
 * by the server (game.game_over, with first-person support). The screen shows the final
 * standings as a ranked list (winner first, then the eliminated players ordered by how long
 * they survived) and offers a single button back to the home page. It opens as a native modal
 * <dialog> via the dialogManager, so focus is trapped and restored and the title/content are
 * exposed to assistive tech when it opens.
 *
 * Money / net worth are intentionally NOT shown: this game only ends when a single solvent
 * player remains, so every other player is bankrupt with 0 cash and 0 property (the creditor
 * who bankrupts a player keeps their assets). The meaningful result is the finishing order.
 *
 * The pure logic (computeStandings) is unit-tested in isolation.
 */

import { dialogManager } from './dialogManager.js';
import { teamDisplayName } from './enginePalette.js';
import { tSync } from './i18nBinder.js';
import type { GameState } from './models.js';

const t = (key: string, vars?: Record<string, any>): string => tSync(`game.${key}`, vars);

/**
 * Who actually WON: the winnerId alone, or — journey pairs — every member of the winning
 * SEAT (partners win together), plus the seat's team name for the banner.
 */
export function winningSide(state: GameState): { ids: Set<string>; teamName: string | null } {
	const ids = new Set<string>();
	if (state.winnerId) ids.add(state.winnerId);
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
	name: string;
	/** Finishing position: 1 = winner, 2 = runner-up (last eliminated), … */
	place: number;
	isBankrupt: boolean;
	isWinner: boolean;
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
			name: p.name,
			place: isWinner ? 1 : (p.finishPlace ?? 0),
			isBankrupt: p.isBankrupt === true,
			isWinner,
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

function escapeHtml(s: string): string {
	return s.replace(/[&<>"']/g, c =>
		({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

let shown = false;

/**
 * Show the end screen once. Subsequent gameStateUpdated pushes (the server may emit a few
 * more before the game is deleted) are ignored thanks to the once-guard.
 */
export function showEndScreen(state: GameState, myPlayerId: string | null): void {
	if (shown) return;
	shown = true;

	const side = winningSide(state);
	const standings = computeStandings(state, side.ids);
	const iWon = !!myPlayerId && side.ids.has(myPlayerId);
	const winnerName = side.teamName ?? state.winnerName ?? standings[0]?.name ?? '';

	// Journey pairs: the banner names the TEAM and celebrates BOTH partners.
	const bannerText = iWon
		? (side.teamName ? t('end_winner_team_you', { team: side.teamName }) : t('end_winner_you'))
		: (side.teamName ? t('end_winner_team_other', { team: side.teamName }) : t('end_winner_other', { player: winnerName }));
	const banner = `<p class="end-screen__banner${iWon ? ' end-screen__banner--win' : ''}">${escapeHtml(bannerText)}</p>`;

	const rows = standings.map((row, i) => {
		// Partners share their seat's place: show it (tied "1, 1, 2, 2"), not the row index.
		const rank = row.place > 0 ? row.place : i + 1;
		const you = row.playerId === myPlayerId
			? ` <span class="end-screen__you">${escapeHtml(t('end_you'))}</span>` : '';
		return `<tr${row.isWinner ? ' class="end-screen__winner-row"' : ''}>`
			+ `<td>${rank}</td>`
			+ `<th scope="row">${escapeHtml(row.name)}${you}</th>`
			+ `</tr>`;
	}).join('');

	const table = `<table class="end-screen__standings">`
		+ `<thead><tr>`
		+ `<th scope="col">${escapeHtml(t('end_col_rank'))}</th>`
		+ `<th scope="col">${escapeHtml(t('end_col_player'))}</th>`
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
			label: t('end_back_home'),
			variant: 'primary',
			action: () => dialogManager.close(),
		}],
		// Closing the finished game (button or Escape) returns to the home page.
		onClose: () => { window.location.href = '/'; },
	});
}
