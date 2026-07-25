import test from 'node:test';
import assert from 'node:assert/strict';
import type { LobbyPlayer } from '../src/models.js';
import { nextTeamAddFocus, teamRosterStatus } from '../src/lobby/teamRoster.js';

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