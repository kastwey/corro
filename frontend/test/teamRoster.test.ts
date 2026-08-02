import test from 'node:test';
import assert from 'node:assert/strict';
import type { LobbyPlayer } from '../src/models.js';
import { nextTeamAddFocus, teamPanelFocusPlan, teamRosterStatus } from '../src/lobby/teamRoster.js';

function player(name: string, teamIndex: number | null): LobbyPlayer {
	return {
		id: name.toLowerCase(),
		name,
		token: 'token',
		isHost: false,
		isReady: true,
		teamIndex,
		joinedAt: '2026-01-01T00:00:00Z',
	};
}

test('an assigned host does not make an otherwise empty team roster complete', () => {
	assert.deepEqual(teamRosterStatus([player('Ana', 0)], 4), {
		kind: 'waiting',
		assigned: 1,
		capacity: 4,
		missing: 3,
	});
});

test('present unassigned players take priority over empty future places', () => {
	assert.deepEqual(teamRosterStatus([
		player('Ana', 0),
		player('Berto', null),
	], 4), {
		kind: 'unassigned',
		names: ['Berto'],
	});
});

test('only a full assigned roster is complete', () => {
	assert.deepEqual(teamRosterStatus([
		player('Ana', 0),
		player('Berto', 0),
		player('Carla', 1),
		player('David', 1),
	], 4), { kind: 'complete' });
});

test('the waiting status reports a single remaining place precisely', () => {
	assert.deepEqual(teamRosterStatus([
		player('Ana', 0),
		player('Berto', 0),
		player('Carla', 1),
	], 4), {
		kind: 'waiting',
		assigned: 3,
		capacity: 4,
		missing: 1,
	});
});

test('team assignment focus stays on the same Add button while it survives', () => {
	assert.equal(nextTeamAddFocus(0, [0, 1], 2), 0);
});

test('team assignment focus advances when the originating team becomes full', () => {
	assert.equal(nextTeamAddFocus(0, [1], 2), 1);
	assert.equal(nextTeamAddFocus(2, [0], 3), 0, 'the search wraps through team order');
	assert.equal(nextTeamAddFocus(1, [], 2), null);
});
// The waiting room repaints for EVERYTHING — an arrival, a rename, a rules change. A move the
// host asked for may only carry focus on the repaint that proves the server did it; anything
// else must leave the host's hands where they were.

test('a pending move takes focus only on the repaint that confirms it', () => {
	const pending = { preferredTeamIndex: 0, playerId: 'p2', expectedTeamIndex: 0 };
	const players = [
		{ id: 'p1', teamIndex: 0 },
		{ id: 'p2', teamIndex: 0 },
		{ id: 'p3', teamIndex: null },
	];

	const confirmed = teamPanelFocusPlan(pending, null, players, [1], 2);
	assert.deepEqual(confirmed.target, { kind: 'add', teamIndex: 1 });
	assert.equal(confirmed.pending, null, 'the request is spent once it lands');
});

test('an unconfirmed repaint neither steals focus nor forgets the move', () => {
	const pending = { preferredTeamIndex: 0, playerId: 'p2', expectedTeamIndex: 0 };
	// Somebody just joined; the move itself is still in flight, so p2 is still unassigned.
	const arrival = [
		{ id: 'p1', teamIndex: 0 },
		{ id: 'p2', teamIndex: null },
		{ id: 'p4', teamIndex: null },
	];

	const plan = teamPanelFocusPlan(pending, null, arrival, [0, 1], 2);
	assert.equal(plan.target, null, 'an arrival must not drag the host to an Add button');
	assert.deepEqual(plan.pending, pending, 'the move is still waiting for its own repaint');
});

test('a full team sends the confirmed move to the moved row instead of a button', () => {
	const pending = { preferredTeamIndex: 0, playerId: 'p2', expectedTeamIndex: 0 };
	const plan = teamPanelFocusPlan(pending, null, [{ id: 'p2', teamIndex: 0 }], [], 2);
	assert.deepEqual(plan.target, { kind: 'member', playerId: 'p2' });
});

test('with no move in flight the panel restores where focus already was', () => {
	const players = [{ id: 'p1', teamIndex: 0 }];
	assert.deepEqual(
		teamPanelFocusPlan(null, { kind: 'add', teamIndex: 1 }, players, [0, 1], 2).target,
		{ kind: 'add', teamIndex: 1 });
	assert.deepEqual(
		teamPanelFocusPlan(null, { kind: 'action', teamIndex: 0, playerId: 'p1' }, players, [], 2).target,
		{ kind: 'action', playerId: 'p1' });
	// Focus outside the panel: capture returns null and nothing is touched.
	assert.equal(teamPanelFocusPlan(null, null, players, [0], 2).target, null);
});

test('the button that dealt the teams keeps focus through its own repaint', () => {
	const plan = teamPanelFocusPlan(
		null, { kind: 'shuffle', teamIndex: -1 }, [{ id: 'p1', teamIndex: 0 }], [0, 1], 2);
	assert.deepEqual(plan.target, { kind: 'shuffle' });
});
