import test from 'node:test';
import assert from 'node:assert/strict';
import { GameSessionStore, SavedGame, reconcileRejoinCode } from '../src/sessionUtils.js';

/**
 * Minimal localStorage mock backed by a Map, covering the bits GameSessionStore
 * relies on: getItem / setItem / removeItem.
 */
function installLocalStorageMock(): void {
	const store = new Map<string, string>();
	Object.defineProperty(globalThis, 'localStorage', {
		configurable: true,
		value: {
			getItem: (k: string): string | null => (store.has(k) ? store.get(k)! : null),
			setItem: (k: string, v: string): void => { store.set(k, String(v)); },
			removeItem: (k: string): void => { store.delete(k); },
			clear: (): void => { store.clear(); }
		}
	});
}

function entry(gameId: string, overrides: Partial<SavedGame> = {}): Omit<SavedGame, 'updatedAt'> {
	return {
		gameId,
		playerId: 'p_' + gameId,
		playerSecretId: 's_' + gameId,
		playerName: 'Name ' + gameId,
		token: 'disc',
		board: 'spain',
		isHost: false,
		...overrides
	};
}

test('saves and retrieves a game by id', () => {
	installLocalStorageMock();
	GameSessionStore.saveGame(entry('g1', { isHost: true }));

	const game = GameSessionStore.getGame('g1');
	assert.ok(game);
	assert.equal(game!.gameId, 'g1');
	assert.equal(game!.playerId, 'p_g1');
	assert.equal(game!.playerSecretId, 's_g1');
	assert.equal(game!.isHost, true);
	assert.ok(typeof game!.updatedAt === 'number');
});

test('stores multiple games and returns them newest first', () => {
	installLocalStorageMock();
	GameSessionStore.saveGame(entry('g1'));
	GameSessionStore.saveGame(entry('g2'));
	GameSessionStore.saveGame(entry('g3'));

	const games = GameSessionStore.getGames();
	assert.equal(games.length, 3);
	// g3 was saved last, so it must be first.
	assert.equal(games[0].gameId, 'g3');
	assert.equal(games[2].gameId, 'g1');
});

test('saveGame upserts (no duplicates) and refreshes ordering', () => {
	installLocalStorageMock();
	GameSessionStore.saveGame(entry('g1', { playerName: 'Old' }));
	GameSessionStore.saveGame(entry('g2'));
	GameSessionStore.saveGame(entry('g1', { playerName: 'New' }));

	const games = GameSessionStore.getGames();
	assert.equal(games.length, 2);
	assert.equal(games[0].gameId, 'g1');
	assert.equal(games[0].playerName, 'New');
});

test('removeGame drops a single entry, leaving the rest', () => {
	installLocalStorageMock();
	GameSessionStore.saveGame(entry('g1'));
	GameSessionStore.saveGame(entry('g2'));
	GameSessionStore.removeGame('g1');

	assert.equal(GameSessionStore.getGame('g1'), null);
	assert.ok(GameSessionStore.getGame('g2'));
	assert.equal(GameSessionStore.getGames().length, 1);
});

test('clear removes everything', () => {
	installLocalStorageMock();
	GameSessionStore.saveGame(entry('g1'));
	GameSessionStore.saveGame(entry('g2'));
	GameSessionStore.clear();

	assert.deepEqual(GameSessionStore.getGames(), []);
});

test('returns an empty list when storage is empty', () => {
	installLocalStorageMock();
	assert.deepEqual(GameSessionStore.getGames(), []);
	assert.equal(GameSessionStore.getGame('nope'), null);
});

test('prunes stale entries older than a week on read', () => {
	installLocalStorageMock();
	const eightDays = 8 * 24 * 60 * 60 * 1000;
	const stale: SavedGame = { ...entry('old'), updatedAt: Date.now() - eightDays };
	const fresh: SavedGame = { ...entry('new'), updatedAt: Date.now() };
	localStorage.setItem('corro_games', JSON.stringify([stale, fresh]));

	const games = GameSessionStore.getGames();
	assert.equal(games.length, 1);
	assert.equal(games[0].gameId, 'new');
});

test('recovers gracefully from corrupted storage', () => {
	installLocalStorageMock();
	localStorage.setItem('corro_games', 'not-json{');
	assert.deepEqual(GameSessionStore.getGames(), []);

	localStorage.setItem('corro_games', JSON.stringify({ not: 'an array' }));
	assert.deepEqual(GameSessionStore.getGames(), []);
});

/**
 * The re-entry code answers one question — how somebody gets back to a seat after losing the
 * browser data holding it — and an account answers it better, from a device that has never seen
 * the table. So the server withholds it from a signed-in player, and this is the browser taking
 * that answer seriously in both directions.
 */

const SEAT: SavedGame = {
	gameId: 'g1',
	playerId: 'p1',
	playerSecretId: 's1',
	playerName: 'Ana',
	token: 'red_hat',
	board: 'classic',
	isHost: false,
	updatedAt: 1,
};

test('a code arriving for the first time is kept', () => {
	assert.deepEqual(
		reconcileRejoinCode(SEAT, 'A2B3C4D5'),
		{ ...SEAT, rejoinCode: 'A2B3C4D5' });
});

// The bug this exists for: signing in withholds the code, and the copy stored while anonymous
// would otherwise stay on the table forever, asking to be noted down for nothing.
test('a stale code is dropped when the server says there is none', () => {
	assert.deepEqual(
		reconcileRejoinCode({ ...SEAT, rejoinCode: 'A2B3C4D5' }, null),
		{ ...SEAT, rejoinCode: undefined });
});

// Every authenticated join asks this. Writing an unchanged answer would touch updatedAt and keep
// a table the player has finished with alive in the saved list.
test('an unchanged answer writes nothing', () => {
	assert.equal(reconcileRejoinCode({ ...SEAT, rejoinCode: 'A2B3C4D5' }, 'A2B3C4D5'), null);
	assert.equal(reconcileRejoinCode(SEAT, null), null);
});

test('a table this browser does not hold is not invented', () => {
	assert.equal(reconcileRejoinCode(null, 'A2B3C4D5'), null);
});
