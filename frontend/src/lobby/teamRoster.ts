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

/** A move the host asked for, waiting for the repaint that proves the server did it. */
export type PendingTeamFocus = {
	preferredTeamIndex: number;
	playerId: string;
	expectedTeamIndex: number | null;
};

/** Where focus was, in terms that survive the panel being rebuilt. */
export type PreservedTeamFocus = {
	kind: 'add' | 'member' | 'action' | 'shuffle';
	teamIndex: number;
	playerId?: string;
};

export type TeamFocusTarget =
	| { kind: 'add'; teamIndex: number }
	| { kind: 'member'; playerId: string }
	| { kind: 'action'; playerId: string }
	| { kind: 'shuffle' }
	| null;

/**
 * Where focus belongs once the team panel has been rebuilt.
 *
 * The host's own move is followed to the next Add button, but ONLY on the repaint that
 * actually carries it: the waiting room repaints for everything — someone arriving, a name
 * changing, the host picking a word language — and a move still waiting for its answer must
 * not drag focus along with those. It stays armed instead, so the repaint that does confirm
 * the move still moves focus (the request may simply be in flight). Anything else keeps the
 * host exactly where they were, which for focus outside the panel means not touching it.
 */
export function teamPanelFocusPlan(
	pending: PendingTeamFocus | null,
	preserved: PreservedTeamFocus | null,
	players: readonly { id: string; teamIndex: number | null }[],
	addableTeamIndices: readonly number[],
	teamCount: number,
): { target: TeamFocusTarget; pending: PendingTeamFocus | null } {
	if (pending) {
		const moved = players.find(player => player.id === pending.playerId);
		const confirmed = !!moved && (moved.teamIndex ?? null) === pending.expectedTeamIndex;
		if (confirmed) {
			const index = nextTeamAddFocus(pending.preferredTeamIndex, addableTeamIndices, teamCount);
			return {
				target: index === null
					? { kind: 'member', playerId: pending.playerId }
					: { kind: 'add', teamIndex: index },
				pending: null,
			};
		}
	}

	if (!preserved) return { target: null, pending };
	// The random deal rebuilds every team at once, including the button that ordered it.
	if (preserved.kind === 'shuffle') return { target: { kind: 'shuffle' }, pending };
	if (preserved.kind === 'add') {
		const index = nextTeamAddFocus(preserved.teamIndex, addableTeamIndices, teamCount);
		return { target: index === null ? null : { kind: 'add', teamIndex: index }, pending };
	}
	if (!preserved.playerId) return { target: null, pending };
	return { target: { kind: preserved.kind, playerId: preserved.playerId }, pending };
}