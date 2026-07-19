import test from 'node:test';
import assert from 'node:assert/strict';
import { GameSessionStore, SavedGame } from '../src/sessionUtils.js';

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
