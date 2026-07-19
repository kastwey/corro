// sessionUtils.ts - Local store of the games this browser is part of.
//
// We deliberately use localStorage (not a cookie): the server never reads this data
// — authentication happens by sending the playerSecretId explicitly over SignalR — so
// a cookie would only add weight to every HTTP request. localStorage is same-origin,
// larger, and never travels to the server, which is exactly what we want for a list of
// saved games that both the lobby and the board read by gameId.

export interface SavedGame {
	gameId: string;
	playerId: string;
	playerSecretId: string;
	playerName: string;
	/** Token key (snake_case) kept only to show an icon in the saved-games list. */
	token: string;
	board: string;
	isHost: boolean;
	/** The player's RE-ENTRY code: typed in the lobby's code box it reclaims this seat
	 *  from any browser (the account-less recovery key). Absent on entries saved before
	 *  the feature; the board backfills it on the next authenticated join. */
	rejoinCode?: string;
	/** Epoch ms of the last time this entry was created/touched. */
	updatedAt: number;
}

/**
 * Persistent, account-less store of the games the player has joined, so the lobby can
 * offer to resume them and the board can authenticate by gameId.
 */
export class GameSessionStore {
	private static readonly KEY = 'corro_games';
	// Saved games older than this are considered stale and pruned on read.
	private static readonly MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

	/** All saved games, newest first, with stale entries pruned. */
	static getGames(): SavedGame[] {
		let raw: string | null;
		try {
			raw = localStorage.getItem(this.KEY);
		} catch {
			return [];
		}
		if (!raw) return [];

		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch {
			this.clear();
			return [];
		}
		if (!Array.isArray(parsed)) {
			this.clear();
			return [];
		}

		const now = Date.now();
		const all = parsed as SavedGame[];
		const games = all
			.filter(g => g && typeof g.gameId === 'string' && typeof g.updatedAt === 'number')
			.filter(g => now - g.updatedAt <= this.MAX_AGE_MS)
			.sort((a, b) => b.updatedAt - a.updatedAt);

		// Persist the pruned list so expired/invalid entries don't linger.
		if (games.length !== all.length) {
			this.write(games);
		}
		return games;
	}

	/** The saved game for a given id, or null if this browser doesn't know it. */
	static getGame(gameId: string): SavedGame | null {
		return this.getGames().find(g => g.gameId === gameId) ?? null;
	}

	/** Insert or update (upsert) a saved game, refreshing its timestamp. */
	static saveGame(entry: Omit<SavedGame, 'updatedAt'>): void {
		const games = this.getGames().filter(g => g.gameId !== entry.gameId);
		games.unshift({ ...entry, updatedAt: Date.now() });
		this.write(games);
	}

	/** Remove a single saved game from this browser's list (local only). */
	static removeGame(gameId: string): void {
		const games = this.getGames().filter(g => g.gameId !== gameId);
		this.write(games);
	}

	/** Drop every saved game. */
	static clear(): void {
		try {
			localStorage.removeItem(this.KEY);
		} catch {
			/* ignore */
		}
	}

	private static write(games: SavedGame[]): void {
		try {
			localStorage.setItem(this.KEY, JSON.stringify(games));
		} catch {
			/* ignore quota / disabled storage */
		}
	}
}
