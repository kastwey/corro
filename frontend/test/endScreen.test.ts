import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeStandings, standingsRows, winningSide } from '../src/endScreen.js';
import type { GameState, Player } from '../src/models.js';

/**
 * Pure-logic tests for the end-screen standings. The DOM rendering (showEndScreen) is a thin
 * wrapper over this; only the ordering is covered here.
 */

// winningSide and the team rows compose their text through tSync, which probes window.i18next.
// The Spanish resources are loaded for real and interpolated the way i18next does, so the tests
// that assert a spoken line assert the line players actually hear — those strings are a contract.
const es = JSON.parse(
	readFileSync(new URL('../i18n/locales/es.json', import.meta.url), 'utf8'));

(globalThis as any).window ??= {};
(globalThis as any).window.i18next = {
	language: 'es',
	t: (key: string, vars?: Record<string, any>) => {
		const [section, name] = key.split('.');
		const text = es[section]?.[name];
		if (typeof text !== 'string') return key;
		return text.replace(/\{\{(\w+)\}\}/g, (_m, v) => String(vars?.[v] ?? `{{${v}}}`));
	},
};

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

test('forbidden teams: every member of the winning team shares first place', () => {
	const players = [
		player({ id: 'a', name: 'Ana', finishPlace: 1 }),
		player({ id: 'b', name: 'Berto', finishPlace: 1 }),
		player({ id: 'c', name: 'Carla', finishPlace: 2 }),
		player({ id: 'd', name: 'David', finishPlace: 2 }),
	];
	const gs = state({
		players,
		winnerId: 'a',
		forbidden: {
			teams: [
				{ teamIndex: 0, memberIds: ['a', 'b'], score: 5, turnsTaken: 2 },
				{ teamIndex: 1, memberIds: ['c', 'd'], score: 3, turnsTaken: 2 },
			],
		} as any,
	});

	const side = winningSide(gs);
	assert.deepEqual([...side.ids].sort(), ['a', 'b']);
	assert.ok(side.teamName);
	const rows = computeStandings(gs);
	assert.deepEqual(rows.map(row => row.isWinner), [true, true, false, false]);
	assert.deepEqual(rows.map(row => row.place), [1, 1, 2, 2]);
});

test('winningSide is the lone winner outside team play (no team name)', () => {
	const gs = state({ players: [player({ id: 'a', name: 'Ana' })], winnerId: 'a' });
	const side = winningSide(gs);
	assert.deepEqual([...side.ids], ['a']);
	assert.equal(side.teamName, null);
});

test('a sealed table is shown as the server ordered it, numbers and all', () => {
	// Four Colours played with the penalty count: the winner has the LOWEST score. The rows must
	// come out in the server's order, so reading the numbers must not put 'b' on top.
	const players = [
		player({ id: 'a', name: 'Ana', finishPlace: 1 }),
		player({ id: 'b', name: 'Berto', finishPlace: 2 }),
	];
	const rows = standingsRows(state({
		players,
		winnerId: 'a',
		finalStandings: {
			measureKey: 'game.end_measure_points',
			sides: [
				{ memberIds: ['a'], place: 1, value: 0 },
				{ memberIds: ['b'], place: 2, value: 50 },
			],
		},
	} as any));

	assert.deepEqual(rows.map(r => r.name), ['Ana', 'Berto']);
	assert.deepEqual(rows.map(r => r.value), [0, 50]);
	assert.deepEqual(rows.map(r => r.isWinner), [true, false]);
});

test('a team row stands for both partners and carries the team score', () => {
	const players = [
		player({ id: 'a', name: 'Ana', finishPlace: 1 }),
		player({ id: 'b', name: 'Berto', finishPlace: 1 }),
		player({ id: 'c', name: 'Carla', finishPlace: 2 }),
		player({ id: 'd', name: 'Dani', finishPlace: 2 }),
	];
	const rows = standingsRows(state({
		players,
		winnerId: 'a',
		forbidden: {
			teams: [
				{ teamIndex: 0, memberIds: ['a', 'b'], score: 12, turnsTaken: 4 },
				{ teamIndex: 1, memberIds: ['c', 'd'], score: 9, turnsTaken: 4 },
			],
		} as any,
		finalStandings: {
			measureKey: 'game.end_measure_points',
			sides: [
				{ memberIds: ['a', 'b'], place: 1, teamIndex: 0, value: 12 },
				{ memberIds: ['c', 'd'], place: 2, teamIndex: 1, value: 9 },
			],
		},
	} as any));

	// Two rows for four players: the table says who was with whom.
	assert.equal(rows.length, 2);
	assert.deepEqual(rows[0].memberIds, ['a', 'b']);
	assert.deepEqual(rows.map(r => r.value), [12, 9]);
	assert.equal(rows[0].isWinner, true);
	assert.equal(rows[1].isWinner, false);
	// The whole row is ONE spoken line: the team, then who was on it, joined by a spoken
	// connector ("Ana y Berto") — never juxtaposed or split by a separator that does not speak.
	// (The list's language is the binder's, which no test initializes, so the connector itself
	// is matched as a word rather than as Spanish.)
	assert.match(rows[0].name, /^Equipo rojo: Ana \w+ Berto$/iu, rows[0].name);
	assert.match(rows[1].name, /^Equipo azul: Carla \w+ Dani$/iu, rows[1].name);
});

test('a side that names its partners instead of a colour reads as a plain list of names', () => {
	// Race teams: the winning announcement names the two players, so the row does too.
	const players = [
		player({ id: 'a', name: 'Ana', finishPlace: 1 }),
		player({ id: 'b', name: 'Berto', finishPlace: 1 }),
	];
	const rows = standingsRows(state({
		players,
		winnerId: 'a',
		finalStandings: {
			measureKey: 'game.end_measure_pieces_home',
			sides: [{ memberIds: ['a', 'b'], place: 1, value: 8 }],
		},
	} as any));

	assert.ok(rows[0].name.includes('Ana') && rows[0].name.includes('Berto'), rows[0].name);
	assert.ok(!rows[0].name.includes('end_team_members'), 'no team name is composed without a team index');
});

test('without a sealed table the standings stay the plain ranked list, with no number', () => {
	const players = [
		player({ id: 'a', name: 'Ana' }),
		player({ id: 'b', name: 'Bea', isBankrupt: true, finishPlace: 2 }),
	];
	const rows = standingsRows(state({ players, winnerId: 'a' }));

	assert.deepEqual(rows.map(r => r.name), ['Ana', 'Bea']);
	assert.deepEqual(rows.map(r => r.value), [null, null]);
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
