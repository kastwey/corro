import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStandings, winningSide } from '../src/endScreen.js';
import type { GameState, Player } from '../src/models.js';

/**
 * Pure-logic tests for the end-screen standings. The DOM rendering (showEndScreen) is a thin
 * wrapper over this; only the ordering is covered here.
 */

// winningSide builds the team name through tSync, which probes window.i18next: give it a
// bare window (no i18next → keys come back unchanged, which is all these tests need).
(globalThis as any).window ??= {};

function player(partial: Partial<Player>): Player {
	return { id: '', name: '', money: 0, position: 0, properties: [], ...partial } as Player;
}

function state(partial: Partial<GameState>): GameState {
	return { players: [], squares: [], ...partial } as unknown as GameState;
}

test('computeStandings ranks the winner first, then eliminated players by how long they survived', () => {
	// The server stamps finishPlace at bankruptcy: first out of 4 finishes 4th, last out finishes
	// 2nd (runner-up). So the order must be winner, last-out, …, first-out — not alphabetical.
	const players = [
		player({ id: 'doga', name: 'Doga', isBankrupt: true, finishPlace: 4 }),   // out first
		player({ id: 'me', name: 'Me' }),                                          // winner
		player({ id: 'eric', name: 'Eric', isBankrupt: true, finishPlace: 3 }),
		player({ id: 'nuria', name: 'Núria', isBankrupt: true, finishPlace: 2 }),  // out last
	];
	const rows = computeStandings(state({ players, winnerId: 'me' }));
	assert.deepEqual(rows.map(r => r.playerId), ['me', 'nuria', 'eric', 'doga']);
	assert.deepEqual(rows.map(r => r.place), [1, 2, 3, 4]);
});

test('computeStandings marks the winner (place 1) and flags bankrupt players', () => {
	const players = [
		player({ id: 'a', name: 'Ana' }),
		player({ id: 'b', name: 'Bea', isBankrupt: true, finishPlace: 2 }),
	];
	const rows = computeStandings(state({ players, winnerId: 'a' }));
	assert.equal(rows[0].isWinner, true);
	assert.equal(rows[0].place, 1);
	assert.equal(rows.find(r => r.playerId === 'b')!.isBankrupt, true);
});

test('journey pairs: BOTH partners of the winning seat are winners, ranks tie 1-1-2-2', () => {
	const players = [
		player({ id: 'a', name: 'Ana', finishPlace: 1 }),
		player({ id: 'b', name: 'Berto', finishPlace: 1 }),
		player({ id: 'c', name: 'Carla', finishPlace: 2 }),
		player({ id: 'd', name: 'David', finishPlace: 2 }),
	];
	const gs = state({
		players,
		winnerId: 'a', // the seat's wire id: its FIRST member
		journey: {
			seats: [
				{ playerId: 'a', members: [{ playerId: 'a' }, { playerId: 'b' }] },
				{ playerId: 'c', members: [{ playerId: 'c' }, { playerId: 'd' }] },
			],
		} as any,
	});

	const side = winningSide(gs);
	assert.deepEqual([...side.ids].sort(), ['a', 'b']); // the PARTNER wins too
	assert.ok(side.teamName, 'a shared seat has a team name for the banner');

	const rows = computeStandings(gs);
	assert.deepEqual(rows.map(r => r.isWinner), [true, true, false, false]);
	assert.deepEqual(rows.map(r => r.place), [1, 1, 2, 2]);
});

test('winningSide is the lone winner outside team play (no team name)', () => {
	const gs = state({ players: [player({ id: 'a', name: 'Ana' })], winnerId: 'a' });
	const side = winningSide(gs);
	assert.deepEqual([...side.ids], ['a']);
	assert.equal(side.teamName, null);
});

test('computeStandings breaks a finishPlace tie by name (defensive, for odd states)', () => {
	const players = [
		player({ id: 'z', name: 'Zoe', isBankrupt: true, finishPlace: 2 }),
		player({ id: 'm', name: 'Mia', isBankrupt: true, finishPlace: 2 }),
		player({ id: 'w', name: 'Win' }),
	];
	const rows = computeStandings(state({ players, winnerId: 'w' }));
	assert.deepEqual(rows.map(r => r.name), ['Win', 'Mia', 'Zoe']);
});
