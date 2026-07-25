import type { LobbyPlayer } from '../models.js';

export type TeamRosterStatus =
	| { kind: 'unassigned'; names: string[] }
	| { kind: 'waiting'; assigned: number; capacity: number; missing: number }
	| { kind: 'complete' };

/**
 * Describes whether a waiting-room team roster still has present players to place,
 * empty places awaiting future players, or is genuinely complete.
 */
export function teamRosterStatus(players: LobbyPlayer[], capacity: number): TeamRosterStatus {
	const names = players
		.filter(player => player.teamIndex == null)
		.map(player => player.name);
	if (names.length > 0) return { kind: 'unassigned', names };

	const missing = Math.max(0, capacity - players.length);
	if (missing > 0) {
		return {
			kind: 'waiting',
			assigned: players.length,
			capacity,
			missing,
		};
	}

	return { kind: 'complete' };
}

/**
 * Chooses the Add-player button that should receive focus after a team assignment.
 * Keep the originating team's button when that team still has room; otherwise move
 * forward through the team order to the next team that can accept a player.
 */
export function nextTeamAddFocus(
	preferredTeamIndex: number,
	addableTeamIndices: readonly number[],
	teamCount: number,
): number | null {
	if (addableTeamIndices.includes(preferredTeamIndex)) return preferredTeamIndex;
	for (let offset = 1; offset < teamCount; offset++) {
		const candidate = (preferredTeamIndex + offset) % teamCount;
		if (addableTeamIndices.includes(candidate)) return candidate;
	}
	return null;
}