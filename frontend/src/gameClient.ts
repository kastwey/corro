// gameClient.ts - Unified SignalR client for lobby + game
declare const signalR: any; // UMD global from the <script> tag (runtime); types come from the import below.

import type { HubConnection } from '@microsoft/signalr';

import type {
	GameState, GameInfo,
	CreateGameRequest, CreateGameResponse, JoinGameRequest, JoinGameResponse,
	ResolvedJoinCode, SeatClaimedSession,
	StartGameRequest, StartGameResponse, AddressedGameCommand, CommandResponse,
	CardDrawnNotification, AuctionTimerTick, SavedGameInfo, PackageUploadResponse, ShippedBoard,
	ChatMessageDto,
} from './models.js';
import { UNLOCK_HEADER, unlockHeaderValue } from './unlockCodes.js';

// Compatibility re-exports.
export type {
	TokenKey, Player, Square, GameState, GameInfo, LobbyPlayer,
	CreateGameRequest, CreateGameResponse, JoinGameRequest, JoinGameResponse,
	ResolvedJoinCode, SeatClaimedSession,
	StartGameRequest, StartGameResponse, GameCommand, AddressedGameCommand, CommandResponse,
	CardDrawnNotification
} from './models.js';

/**
 * The unlock-codes header for a board request, or no headers when the player holds none (so a plain
 * public request stays header-free). `candidate` optionally folds in a not-yet-saved code to test it.
 */
function unlockHeaders(candidate?: string): Record<string, string> {
	const value = unlockHeaderValue(candidate);
	return value ? { [UNLOCK_HEADER]: value } : {};
}

/** How long a handover warning may hold up the navigation that follows it (see declareHandoff). */
const HANDOFF_WARNING_TIMEOUT_MS = 1500;

// Type for server announcements (frontend translates)
export interface AnnouncementEvent {
	key: string;  // Translation key (e.g., "game.dice_rolled")
	vars: Record<string, any>;  // Variables for interpolation
	/**
	 * When the client should reveal this line relative to a token's movement animation.
	 * `move` lines (the dice roll) are spoken immediately; `resolve` lines (landing rent,
	 * taxes, cards…) are held until the token finishes hopping. Absent on client-created
	 * announcements, which are always spoken immediately.
	 */
	phase?: 'move' | 'resolve';
}

// Alias for compatibility
export type ServerGameState = GameState;

// ==========================================
// EVENTS
// ==========================================

export interface GameClientEvents {
	'connected': void;
	'disconnected': void;
	'connectionError': Error;
	'reconnecting': void;
	'reconnected': void;
	'gameCreated': CreateGameResponse;
	'gameJoined': JoinGameResponse;
	'gameStarted': StartGameResponse;
	'lobbyUpdated': GameInfo;
	'teamAssigned': { gameId: string; playerId: string; playerName: string; teamIndex: number | null };
	'teamsFilled': { gameId: string };
	'contentLanguageChanged': { gameId: string; language: string };
	/** The table as it stands, sent to a player who authenticates while no match is running. */
	'lobbyState': GameInfo;
	/** The match ended and its TABLE is back at rest, with the roster that is still sitting at it. */
	'matchEnded': GameInfo;
	/** Somebody gave up their seat for good; `newHostName` is set when the sceptre moved with them. */
	'playerLeftTable': {
		gameId: string; playerId: string; playerName: string;
		newHostId?: string | null; newHostName?: string | null;
	};
	/** The host handed the sceptre over without leaving. */
	'hostChanged': { gameId: string; hostId: string; hostName?: string | null };
	'playerJoined': { playerId: string; playerName: string };
	'playerLeft': { playerId: string };
	'gameStateChanged': GameState;
	'commandResponse': CommandResponse;
	'gameEvents': AnnouncementEvent[];
	'cardDrawn': CardDrawnNotification;
	'auctionTimerTick': AuctionTimerTick;
	'forbiddenTimerTick': { secondsRemaining: number };
	'gameDeleted': { gameId: string };
	'chatMessage': ChatMessageDto;
	'chatHistory': ChatMessageDto[];
	'voiceChatEnabledChanged': { enabled: boolean };
	'voiceParticipantMutedByHost': {
		targetPlayerId: string;
		targetPlayerName: string;
		hostPlayerId: string;
		hostPlayerName: string;
	};
	'error': string;
}

// ==========================================
// CLIENT
// ==========================================

export class UnifiedGameClient {
	private connection: HubConnection | null = null;
	private eventHandlers = new Map<keyof GameClientEvents, ((data: any) => void)[]>();
	private isConnected = false;
	private hubUrl: string;

	constructor(hubUrl = '/gamehub') {
		this.hubUrl = hubUrl;
	}

	// ==========================================
	// CONNECTION MANAGEMENT
	// ==========================================

	async connect(): Promise<boolean> {
		try {
			const connection: HubConnection = new signalR.HubConnectionBuilder()
				.withUrl(this.hubUrl)
				.withAutomaticReconnect()
				.build();
			this.connection = connection;
			// Debug/E2E hook: the live connection must be reachable from the console (and
			// from Playwright) to simulate a TRANSPORT drop — the auto-reconnect path
			// cannot be exercised any other way without reloading the page.
			(window as any).__corroConnection = connection;

			this.instrumentInvoke();
			this.setupEventHandlers();

			await connection.start();
			this.isConnected = true;

			console.debug('UnifiedGameClient connected successfully');
			this.emit('connected');

			return true;
		} catch (error) {
			console.error('Error connecting UnifiedGameClient:', error);
			this.emit('connectionError', error as Error);
			return false;
		}
	}

	async disconnect(): Promise<void> {
		if (this.connection) {
			await this.connection.stop();
			this.connection = null;
			this.isConnected = false;
			this.emit('disconnected');
			console.debug('UnifiedGameClient disconnected');
		}
	}

	/** Wrap the SignalR connection's `invoke` to log per-command round-trip latency
	 *  (client → server → ack). One central hook covers every hub call, so turn lag
	 *  (e.g. from persistence) is diagnosable without touching each call site. */
	private instrumentInvoke(): void {
		const conn = this.connection;
		if (!conn) return;
		const originalInvoke = conn.invoke.bind(conn);
		conn.invoke = async (method: string, ...args: any[]) => {
			const start = performance.now();
			try {
				return await originalInvoke(method, ...args);
			} finally {
				console.debug(`[rtt] ${method}: ${Math.round(performance.now() - start)}ms`);
			}
		};
	}

	private setupEventHandlers(): void {
		if (!this.connection) return;
		// Connection events
		this.connection.onclose(() => {
			this.isConnected = false;
			this.emit('disconnected');
		});

		this.connection.onreconnecting(() => {
			this.isConnected = false;
			this.emit('reconnecting');
		});

		this.connection.onreconnected(() => {
			this.isConnected = true;
			this.emit('reconnected');
		});

		// Lobby events
		this.connection.on('GameCreated', (data: CreateGameResponse) => {
			this.emit('gameCreated', data);
		});

		this.connection.on('GameJoined', (data: JoinGameResponse) => {
			this.emit('gameJoined', data);
		});

		this.connection.on('GameStarted', (data: StartGameResponse) => {
			this.emit('gameStarted', data);
		});

		this.connection.on('LobbyUpdated', (data: GameInfo) => {
			this.emit('lobbyUpdated', data);
		});

		// Journey team mode: the host moved a player between teams / the pool.
		this.connection.on('TeamAssigned', (data: { gameId: string; playerId: string; playerName: string; teamIndex: number | null }) => {
			this.emit('teamAssigned', data);
		});

		// The host dealt the whole room into the teams in one move.
		this.connection.on('TeamsFilled', (data: { gameId: string }) => {
			this.emit('teamsFilled', data);
		});

		this.connection.on('ContentLanguageChanged', (data: { gameId: string; language: string }) => {
			this.emit('contentLanguageChanged', data);
		});

		this.connection.on('PlayerJoined', (data: any) => {
			this.emit('playerJoined', data);
		});

		this.connection.on('PlayerLeft', (data: any) => {
			this.emit('playerLeft', data);
		});

		this.connection.on('LobbyState', (table: GameInfo) => {
			this.emit('lobbyState', table);
		});

		this.connection.on('MatchEnded', (table: GameInfo) => {
			this.emit('matchEnded', table);
		});

		this.connection.on('PlayerLeftTable', (data: GameClientEvents['playerLeftTable']) => {
			this.emit('playerLeftTable', data);
		});

		this.connection.on('HostChanged', (data: GameClientEvents['hostChanged']) => {
			this.emit('hostChanged', data);
		});

		// Game events
		this.connection.on('GameStateChanged', (data: ServerGameState) => {
			this.emit('gameStateChanged', data);
		});

		this.connection.on('CommandResponse', (data: CommandResponse) => {
			this.emit('commandResponse', data);
		});

		this.connection.on('GameEvents', (events: AnnouncementEvent[]) => {
			this.emit('gameEvents', events);
		});

		this.connection.on('CardDrawn', (card: CardDrawnNotification) => {
			this.emit('cardDrawn', card);
		});

		// Auction events
		this.connection.on('AuctionTimerTick', (data: AuctionTimerTick) => {
			console.debug('Received AuctionTimerTick:', data);
			this.emit('auctionTimerTick', data);
		});

		this.connection.on('ForbiddenTimerTick', (data: { secondsRemaining: number }) => {
			this.emit('forbiddenTimerTick', data);
		});

		// A game was permanently deleted by its host.
		this.connection.on('ChatMessage', (message: any) => {
			this.emit('chatMessage', message);
		});

		this.connection.on('ChatHistory', (messages: any[]) => {
			this.emit('chatHistory', messages);
		});

		this.connection.on('VoiceChatEnabledChanged', (data: { enabled: boolean }) => {
			this.emit('voiceChatEnabledChanged', data);
		});

		this.connection.on('VoiceParticipantMutedByHost', (data: GameClientEvents['voiceParticipantMutedByHost']) => {
			this.emit('voiceParticipantMutedByHost', data);
		});

		this.connection.on('GameDeleted', (data: { gameId: string }) => {
			this.emit('gameDeleted', data);
		});

		// Error events
		this.connection.on('Error', (message: string) => {
			this.emit('error', message);
		});
	}

	// ==========================================
	// EVENT SYSTEM
	// ==========================================

	on<K extends keyof GameClientEvents>(
		event: K,
		handler: (data: GameClientEvents[K]) => void
	): void {
		if (!this.eventHandlers.has(event)) {
			this.eventHandlers.set(event, []);
		}
		this.eventHandlers.get(event)!.push(handler);
	}

	off<K extends keyof GameClientEvents>(
		event: K,
		handler: (data: GameClientEvents[K]) => void
	): void {
		const handlers = this.eventHandlers.get(event);
		if (handlers) {
			const index = handlers.indexOf(handler);
			if (index > -1) {
				handlers.splice(index, 1);
			}
		}
	}

	private emit<K extends keyof GameClientEvents>(
		event: K,
		data?: GameClientEvents[K]
	): void {
		const handlers = this.eventHandlers.get(event);
		if (handlers) {
			handlers.forEach(handler => handler(data as any));
		}
	}

	// ==========================================
	// LOBBY OPERATIONS
	// ==========================================

	async createGame(request: CreateGameRequest): Promise<void> {
		await this.invoke("CreateGameLobby", request);
	}

	/** Journey team mode (host only): place a player in a team, or back in the pool (null). */
	async assignTeam(request: { gameId: string; hostId: string; playerId: string; teamIndex: number | null }): Promise<void> {
		await this.invoke("AssignTeam", request);
	}

	/** Team mode (host only): deal every player in the room into the teams at random. */
	async fillTeamsAtRandom(request: { gameId: string; hostId: string }): Promise<void> {
		await this.invoke("FillTeamsAtRandom", request);
	}

	/** Change the one shared content deck (words to guess, questions to answer) while waiting. */
	async setContentLanguage(request: { gameId: string; hostId: string; language: string }): Promise<void> {
		await this.invoke('SetContentLanguage', request);
	}

	/** Rejoin the authenticated waiting-room SignalR group after a page reload. */
	async reconnectLobby(gameId: string, playerId: string, playerSecretId: string): Promise<GameInfo> {
		return await this.invoke<GameInfo>('ReconnectLobby', gameId, playerId, playerSecretId);
	}

	/** Seat a bot in the waiting room (host only; families with a bot policy).
	 *  An empty name falls back to the server's plain "Bot N". */
	async addBot(request: { gameId: string; hostId: string; name?: string }): Promise<void> {
		await this.invoke("AddBot", request);
	}

	/** Remove a previously added bot from the waiting room (host only). */
	async removeBot(request: { gameId: string; hostId: string; playerId: string }): Promise<void> {
		await this.invoke("RemoveBot", request);
	}

	async joinGame(request: JoinGameRequest): Promise<void> {
		if (!this.isConnected || !this.connection) {
			throw new Error("Not connected to server");
		}

		console.debug('gameClient.joinGame called');

		try {
			console.debug('Invoking JoinGameLobby...');
			await this.connection.invoke("JoinGameLobby", request);
			console.debug('JoinGameLobby invoke completed');
		} catch (error) {
			console.error("Error joining game:", error);
			throw error;
		}
	}

	/** Resolve what the lobby's code box holds: an invite code or a re-entry code. */
	async resolveJoinCode(code: string): Promise<ResolvedJoinCode> {
		if (!this.connection) {
			throw new Error('Not connected to server');
		}
		return await this.connection.invoke("ResolveJoinCode", code);
	}

	/** Reclaim a seat with its re-entry code; the returned session has a FRESH secret. */
	async claimSeatByRejoinCode(code: string): Promise<SeatClaimedSession> {
		if (!this.connection) {
			throw new Error('Not connected to server');
		}
		return await this.connection.invoke("ClaimSeatByRejoinCode", code);
	}

	/**
	 * Reclaim the seat this ACCOUNT holds at a table — no code to type and none to have kept.
	 * Refuses exactly as the code path does when somebody is sitting on that seat.
	 */
	async claimSeatAsAccount(gameId: string): Promise<SeatClaimedSession> {
		if (!this.connection) {
			throw new Error('Not connected to server');
		}
		return await this.connection.invoke("ClaimSeatAsAccount", gameId);
	}

	/**
	 * The tables this ACCOUNT holds a seat at, wherever they were opened. The sibling of
	 * getGamesInfo, which describes the ones THIS BROWSER remembers; signed out, the answer is
	 * simply empty.
	 */
	async getMyTables(): Promise<SavedGameInfo[]> {
		if (!this.isConnected || !this.connection) {
			throw new Error("Not connected to server");
		}
		return await this.connection.invoke("GetMyTables");
	}

	/**
	 * Offer this browser's seats to the signed-in account. Each carries the seat's own secret,
	 * which is the proof; the server takes only the ones that check out and that nobody else owns,
	 * and answers with how many. Signed out, the answer is 0.
	 */
	async adoptSeats(seats: { gameId: string; playerId: string; playerSecretId: string }[]): Promise<number> {
		if (!this.isConnected || !this.connection || seats.length === 0) {
			return 0;
		}
		return await this.connection.invoke("AdoptSeats", seats);
	}

	async getGameByInviteCode(inviteCode: string): Promise<GameInfo> {
		if (!this.isConnected || !this.connection) {
			throw new Error("Not connected to server");
		}

		try {
			// Use invoke for direct response
			return await this.connection.invoke("GetGameByInviteCode", inviteCode);
		} catch (error) {
			console.error("Error getting game by code:", error);
			throw error;
		}
	}

	async startGame(request: StartGameRequest): Promise<void> {
		await this.invoke("StartGameLobby", request);
	}

	/** Resolve live info (status, players, who is connected) for locally-saved games. */
	async getGamesInfo(gameIds: string[]): Promise<SavedGameInfo[]> {
		if (!this.isConnected || !this.connection) {
			throw new Error("Not connected to server");
		}

		try {
			return await this.connection.invoke("GetGamesInfo", gameIds);
		} catch (error) {
			console.error("Error getting saved games info:", error);
			throw error;
		}
	}

	/** Permanently delete a game (host only). Confirmation arrives via the 'gameDeleted' event. */
	async deleteGame(gameId: string, hostId: string, hostSecretId: string): Promise<void> {
		await this.invoke("DeleteGameLobby", gameId, hostId, hostSecretId);
	}

	// ==========================================
	// GAME OPERATIONS (with authentication)
	// ==========================================

	async joinGameWithAuth(gameId: string, playerId: string, playerSecretId: string): Promise<void> {
		await this.invoke("JoinGameWithAuth", gameId, playerId, playerSecretId);
	}

	/**
	 * Warns the server that this page is about to navigate to another page of the same game, so the
	 * disconnection that follows reads as a handover instead of the player walking away.
	 *
	 * Best effort by construction. A page that is already disconnected has nothing to hand over, and
	 * a warning that does not come straight back is abandoned rather than reconnected for: losing it
	 * costs the false "left / came back" pair this prevents, while waiting on it would hold the
	 * player out of a game that has already started.
	 */
	async declareHandoff(): Promise<void> {
		if (!this.isConnected || !this.connection) return;
		try {
			await Promise.race([
				this.connection.invoke('DeclareHandoff'),
				new Promise(resolve => setTimeout(resolve, HANDOFF_WARNING_TIMEOUT_MS)),
			]);
		} catch (error) {
			console.error('Error invoking DeclareHandoff:', error);
		}
	}

	/** Sends an in-game chat message (authenticated with the player's secret, like the rejoin). */
	async sendChatMessage(gameId: string, playerId: string, playerSecretId: string, text: string): Promise<void> {
		await this.invoke("SendChatMessage", { gameId, playerId, playerSecretId, text });
	}

	/** Short-lived LiveKit credentials for the already-authenticated SignalR player. */
	async requestVoiceToken(): Promise<{ url: string; token: string }> {
		if (!this.isConnected || !this.connection) {
			const revived = await this.kickReconnect();
			if (!revived) throw new Error('Not connected to server');
		}
		return await this.connection!.invoke('RequestVoiceToken');
	}

	/** Host-only authoritative switch. Players disconnect immediately when it becomes false. */
	async setVoiceChatEnabled(enabled: boolean): Promise<void> {
		await this.invoke('SetVoiceChatEnabled', enabled);
	}

	/** Host-only one-shot mute. The target remains free to unmute afterwards. */
	async muteVoiceParticipant(targetPlayerId: string): Promise<void> {
		await this.invoke('MuteVoiceParticipant', targetPlayerId);
	}

	/**
	 * Invoke a hub method with the shared transport guard: fail fast when disconnected and
	 * surface the server error to the caller (gameManager turns it into a spoken message).
	 */
	private async invoke<TResult = void>(method: string, ...args: unknown[]): Promise<TResult> {
		if (!this.isConnected || !this.connection) {
			// A user ACTION is the best reconnect trigger there is: instead of failing
			// (or making them wait out the automatic backoff's next attempt), kick an
			// immediate reconnect + re-auth and carry the action through.
			const revived = await this.kickReconnect();
			if (!revived) throw new Error("Not connected to server");
		}
		try {
			return await this.connection!.invoke<TResult>(method, ...args);
		} catch (error) {
			console.error(`Error invoking ${method}:`, error);
			throw error;
		}
	}

	/**
	 * Immediate reconnection attempt driven by a user action. Cancels a pending automatic
	 * backoff wait (stop() while Reconnecting), starts the connection NOW, and — since a
	 * new connection id is a stranger to the server — waits for the re-auth join (the
	 * 'reconnected' listeners re-join with stored credentials; 'gameJoined' confirms)
	 * before letting the action proceed. Returns false if this immediate attempt fails
	 * too; the automatic policy resumes on the next drop either way.
	 */
	private async kickReconnect(): Promise<boolean> {
		try {
			const existing = this.connection;
			if (existing && existing.state === signalR.HubConnectionState.Reconnecting) {
				await existing.stop(); // cancel the backoff timer; we retry NOW
			}
			if (!existing) {
				// A deliberate disconnect tore the connection down entirely: rebuild it
				// (connect() emits 'connected'; re-auth still comes from 'reconnected').
				if (!await this.connect()) return false;
			} else {
				if (existing.state !== signalR.HubConnectionState.Disconnected) {
					return existing.state === signalR.HubConnectionState.Connected;
				}
				await existing.start();
			}
			this.isConnected = true;

			// Wait (briefly) for the re-join handshake so the action doesn't bounce off
			// NOT_AUTHENTICATED on the fresh connection id.
			const rejoined = new Promise<void>(resolve => {
				const timer = setTimeout(() => { this.off('gameJoined', onJoined); resolve(); }, 2500);
				const onJoined = () => { clearTimeout(timer); this.off('gameJoined', onJoined); resolve(); };
				this.on('gameJoined', onJoined);
			});
			this.emit('reconnected');
			await rejoined;
			return true;
		} catch (error) {
			console.warn('Immediate reconnect on user action failed:', error);
			return false;
		}
	}

	/**
	 * Sends one player action. Every in-game command — a roll, a card play, a mortgage, a bid —
	 * travels through this single hub call: {@link AddressedGameCommand} is polymorphic on the
	 * wire and the server materialises it only into a type on its derived-type allowlist. There
	 * is deliberately no per-action method here; the typed, turn-guarded surface lives in
	 * gameManager, and the wire contract is the command shape itself.
	 */
	async executeCommand(command: AddressedGameCommand): Promise<void> {
		await this.invoke("ExecuteCommand", command);
	}

	/**
	 * Lists the shipped, approved boards the lobby offers. These are the engine's built-in boards
	 * served as packages; the chosen one is staged via {@link stageShippedBoard}. The player's unlock
	 * codes are replayed in a header so hidden boards they have unlocked appear too; pass `candidate`
	 * to also try a not-yet-saved code (used by the unlock prompt to see what it would reveal).
	 */
	async getShippedBoards(candidate?: string): Promise<ShippedBoard[]> {
		const response = await fetch('/api/packages/shipped', { headers: unlockHeaders(candidate) });
		if (!response.ok) {
			throw new Error(`HTTP Error: ${response.status}`);
		}
		return await response.json() as ShippedBoard[];
	}

	/**
	 * Stages a shipped board by id and returns the same summary an upload does (token + rule
	 * defaults + tokens), so a built-in board flows through the exact same path as an uploaded one.
	 * A HIDDEN board is 404 here unless the player's unlock codes (sent in the header) cover it.
	 */
	async stageShippedBoard(id: string): Promise<PackageUploadResponse> {
		const response = await fetch(`/api/packages/shipped/${encodeURIComponent(id)}`,
			{ method: 'POST', headers: unlockHeaders() });
		if (!response.ok) {
			const message = await response.text().catch(() => '');
			throw new Error(message || `HTTP Error: ${response.status}`);
		}
		return await response.json() as PackageUploadResponse;
	}

	/**
	 * The package THIS table plays: its pieces, its rule catalogue, its player range. Asked over
	 * the hub rather than by token over REST, because a staged package lives in the process and a
	 * table outlives processes — only the server, holding the game document, can put it back. It
	 * does so here, which is also what makes the package's translations and guide fetchable again,
	 * so this is the first thing a table asks for.
	 */
	async getTablePackage(): Promise<PackageUploadResponse | null> {
		return await this.invoke<PackageUploadResponse | null>('GetTablePackage');
	}

	/**
	 * Give up this seat for good: forfeits a match in progress, hands the sceptre on if this was
	 * the host, and deletes the table when nobody is left at it. Not the same as disconnecting,
	 * which keeps the seat and is how a player comes back.
	 */
	async leaveTable(): Promise<void> {
		await this.invoke('LeaveTable');
	}

	/** Host only: hand the sceptre to another human at this table. */
	async transferHost(newHostId: string): Promise<void> {
		await this.invoke('TransferHost', newHostId);
	}

	/** Host only: the board's house-rule values for the NEXT match at this table. */
	async setTableRules(request: {
		gameId: string; hostId: string; ruleValues?: Record<string, boolean | number | string>;
	}): Promise<void> {
		await this.invoke('SetTableRules', request);
	}

	/**
	 * Uploads a .corro package and stages it on the server, returning its token (passed to
	 * createGame), localized name, and rule defaults. Throws with the server's message on a
	 * rejected upload (too large / not a valid package).
	 */
	async uploadPackage(file: File): Promise<PackageUploadResponse> {
		const form = new FormData();
		form.append('package', file);
		const response = await fetch('/api/packages', { method: 'POST', body: form });
		if (!response.ok) {
			const message = await response.text().catch(() => '');
			throw new Error(message || `HTTP Error: ${response.status}`);
		}
		return await response.json() as PackageUploadResponse;
	}

	/**
	 * Gets a game's state by its ID using the REST API
	 * Useful for reconnecting to an existing game
	 */
	async getGameState(gameId: string): Promise<GameInfo | null> {
		try {
			const response = await fetch(`/api/game/${gameId}`);
			if (!response.ok) {
				if (response.status === 404) {
					console.warn(`Game ${gameId} not found`);
					return null;
				}
				throw new Error(`HTTP Error: ${response.status}`);
			}
			const gameDocument = await response.json();

			// Adapt GameDocument to GameInfo
			return {
				gameId: gameDocument.gameId || gameDocument.id,
				hostId: gameDocument.hostId,
				inviteCode: gameDocument.inviteCode,
				status: gameDocument.status,
				maxPlayers: gameDocument.maxPlayers || 4,
				players: gameDocument.players || [],
				board: gameDocument.board,
				language: gameDocument.language,
				contentLanguages: gameDocument.contentLanguages || [],
				packageToken: gameDocument.packageToken,
				teamCount: gameDocument.teamCount,
				voiceChatEnabled: gameDocument.voiceChatEnabled,
			} as GameInfo;
		} catch (error) {
			console.error("Error getting game state:", error);
			return null;
		}
	}

	// ==========================================
	// UTILITY METHODS
	// ==========================================

	get connected(): boolean {
		return this.isConnected;
	}

	getConnectionState(): string {
		if (!this.connection) return 'Disconnected';
		return this.connection.state;
	}
}

// Shared singleton instance.
export const gameClient = new UnifiedGameClient();
