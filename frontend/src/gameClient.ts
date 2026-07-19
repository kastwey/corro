// gameClient.ts - Unified SignalR client for lobby + game
declare const signalR: any; // UMD global from the <script> tag (runtime); types come from the import below.

import type { HubConnection } from '@microsoft/signalr';

import type {
	GameState, GameInfo,
	CreateGameRequest, CreateGameResponse, JoinGameRequest, JoinGameResponse,
	ResolvedJoinCode, SeatClaimedSession,
	StartGameRequest, StartGameResponse, GameCommand, CommandResponse,
	CardDrawnNotification, AuctionTimerTick, SavedGameInfo, PackageUploadResponse, ShippedBoard,
	ChatMessageDto,
} from './models.js';
import { UNLOCK_HEADER, unlockHeaderValue } from './unlockCodes.js';

// Compatibility re-exports.
export type {
	TokenKey, Player, Square, GameState, GameInfo, LobbyPlayer,
	CreateGameRequest, CreateGameResponse, JoinGameRequest, JoinGameResponse,
	ResolvedJoinCode, SeatClaimedSession,
	StartGameRequest, StartGameResponse, GameCommand, CommandResponse,
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
	'lobbyState': { gameId: string; status: string; players: any[] };
	'playerJoined': { playerId: string; playerName: string };
	'playerLeft': { playerId: string };
	'gameStateChanged': GameState;
	'commandResponse': CommandResponse;
	'gameEvents': AnnouncementEvent[];
	'cardDrawn': CardDrawnNotification;
	'auctionTimerTick': AuctionTimerTick;
	'gameDeleted': { gameId: string };
	'chatMessage': ChatMessageDto;
	'chatHistory': ChatMessageDto[];
	'error': string;
}

// ==========================================
// CLIENT
// ==========================================

export class UnifiedGameClient {
	private connection: HubConnection | null = null;
	private eventHandlers = new Map<keyof GameClientEvents, Array<(data: any) => void>>();
	private isConnected = false;
	private hubUrl: string;

	constructor(hubUrl: string = '/gamehub') {
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

		this.connection.on('PlayerJoined', (data: any) => {
			this.emit('playerJoined', data);
		});

		this.connection.on('PlayerLeft', (data: any) => {
			this.emit('playerLeft', data);
		});

		this.connection.on('LobbyState', (data: { gameId: string; status: string; players: any[] }) => {
			this.emit('lobbyState', data);
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

		// A game was permanently deleted by its host.
		this.connection.on('ChatMessage', (message: any) => {
			this.emit('chatMessage', message);
		});

		this.connection.on('ChatHistory', (messages: any[]) => {
			this.emit('chatHistory', messages);
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

	/** Sends an in-game chat message (authenticated with the player's secret, like the rejoin). */
	async sendChatMessage(gameId: string, playerId: string, playerSecretId: string, text: string): Promise<void> {
		await this.invoke("SendChatMessage", { gameId, playerId, playerSecretId, text });
	}

	/**
	 * Invoke a hub method with the shared transport guard: fail fast when disconnected and
	 * surface the server error to the caller (gameManager turns it into a spoken message).
	 */
	private async invoke(method: string, ...args: unknown[]): Promise<void> {
		if (!this.isConnected || !this.connection) {
			// A user ACTION is the best reconnect trigger there is: instead of failing
			// (or making them wait out the automatic backoff's next attempt), kick an
			// immediate reconnect + re-auth and carry the action through.
			const revived = await this.kickReconnect();
			if (!revived) throw new Error("Not connected to server");
		}
		try {
			await this.connection!.invoke(method, ...args);
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

	async executeCommand(command: GameCommand): Promise<void> {
		await this.invoke("ExecuteCommand", command);
	}

	async endTurn(playerId: string): Promise<void> {
		await this.invoke("EndTurn", playerId);
	}

	async rollDice(playerId: string): Promise<void> {
		await this.invoke("RollDice", playerId);
	}

	/** Race family: resolve the pending piece choice by picking which piece moves. */
	async moveRacePiece(playerId: string, pieceIndex: number): Promise<void> {
		await this.invoke("MoveRacePiece", playerId, pieceIndex);
	}

	/** Trivia family: the host picks the judge before play begins. */
	async triviaChooseJudge(playerId: string, judgeId: string): Promise<void> {
		await this.invoke("TriviaChooseJudge", playerId, judgeId);
	}

	/** Trivia family: choose which legal square to land on after a roll. */
	async triviaMove(playerId: string, node: string): Promise<void> {
		await this.invoke("TriviaMove", playerId, node);
	}

	/** Trivia family: submit an answer (written text, or a choice index; -1 when unused). */
	async triviaAnswer(playerId: string, text: string | null, choice: number): Promise<void> {
		await this.invoke("TriviaAnswer", playerId, text, choice);
	}

	/** Trivia family: the judge rules on the submitted answer. */
	async triviaJudge(playerId: string, correct: boolean): Promise<void> {
		await this.invoke("TriviaJudge", playerId, correct);
	}

	/** Journey family: draw the top card (the start of your turn). */
	async journeyDraw(playerId: string): Promise<void> {
		await this.invoke("JourneyDraw", playerId);
	}

	/** Journey family: play a card from the hand (attacks carry the victim's id). */
	async journeyPlay(playerId: string, instanceId: string, targetId: string | null): Promise<void> {
		await this.invoke("JourneyPlay", playerId, instanceId, targetId);
	}

	/** Journey family: discard instead of playing. */
	async journeyDiscard(playerId: string, instanceId: string): Promise<void> {
		await this.invoke("JourneyDiscard", playerId, instanceId);
	}

	/** Journey family: answer the coup fourré window (the victim, out of turn). */
	async journeyCoup(playerId: string, accept: boolean): Promise<void> {
		await this.invoke("JourneyCoup", playerId, accept);
	}

	/** Assembly family: play a card (attacks/specials carry their targeting). */
	async assemblyPlay(playerId: string, instanceId: string, targetPlayerId: string | null,
		targetColor: string | null, giveColor: string | null): Promise<void> {
		await this.invoke("AssemblyPlay", playerId, instanceId, targetPlayerId, targetColor, giveColor);
	}

	/** Assembly family: discard 1..N cards face-down (empty list = pass). */
	async assemblyDiscard(playerId: string, instanceIds: string[]): Promise<void> {
		await this.invoke("AssemblyDiscard", playerId, instanceIds);
	}

	/** Draft family: commit (or replace) this trick's secret pick — never turn-bound.
	 *  The second card rides an "extra" waiting on the picker's table. */
	async draftPick(playerId: string, instanceId: string, secondInstanceId: string | null): Promise<void> {
		await this.invoke("DraftPick", playerId, instanceId, secondInstanceId);
	}

	/** Shedding family: play a matching card (wilds carry the chosen colour). `extraInstanceIds`
	 *  are further identical copies for a doubles play (the "doubles" house rule). */
	async sheddingPlay(playerId: string, instanceId: string, chosenColor: string | null,
		extraInstanceIds: string[] | null = null): Promise<void> {
		await this.invoke("SheddingPlay", playerId, instanceId, chosenColor, extraInstanceIds);
	}

	/** Shedding family: draw one card (maybe pausing on the play-or-keep choice). */
	async sheddingDraw(playerId: string): Promise<void> {
		await this.invoke("SheddingDraw", playerId);
	}

	/** Shedding family: declare the last card (optional house rule; off-turn). */
	async sheddingDeclareLastCard(playerId: string): Promise<void> {
		await this.invoke("SheddingDeclareLastCard", playerId);
	}

	/** Shedding family: catch a rival who forgot the last-card declaration (off-turn). */
	async sheddingCatchLastCard(playerId: string): Promise<void> {
		await this.invoke("SheddingCatchLastCard", playerId);
	}

	/** Exploding family: play an action card. targetId = favor/cat victim; secondInstanceId = the
	 *  matching cat of a pair. */
	async explodingPlay(playerId: string, instanceId: string,
		targetId: string | null = null, secondInstanceId: string | null = null): Promise<void> {
		await this.invoke("ExplodingPlay", playerId, instanceId, targetId, secondInstanceId);
	}

	/** Exploding family: as a Favor's target, give the requester a card of your choice. */
	async explodingGive(playerId: string, instanceId: string): Promise<void> {
		await this.invoke("ExplodingGive", playerId, instanceId);
	}

	/** Exploding family: Nope the pending action — OFF-TURN (anyone holding a Nope, during the window). */
	async explodingNope(playerId: string, instanceId: string): Promise<void> {
		await this.invoke("ExplodingNope", playerId, instanceId);
	}

	/** Exploding family: draw one card, ending the turn (or detonating on a bomb). */
	async explodingDraw(playerId: string): Promise<void> {
		await this.invoke("ExplodingDraw", playerId);
	}

	/** Exploding family: tuck the just-drawn (defused) bomb back at `depth` cards from the top. */
	async explodingDefuse(playerId: string, depth: number): Promise<void> {
		await this.invoke("ExplodingDefuse", playerId, depth);
	}

	/** Shedding family: keep the just-drawn card and pass the turn. */
	async sheddingKeep(playerId: string): Promise<void> {
		await this.invoke("SheddingKeep", playerId);
	}

	async buyProperty(playerId: string, squareIndex: number): Promise<void> {
		await this.invoke("BuyProperty", playerId, squareIndex);
	}

	// ==========================================
	// AUCTION OPERATIONS
	// ==========================================

	async placeBid(playerId: string, squareIndex: number, amount: number): Promise<void> {
		await this.invoke("PlaceBid", playerId, squareIndex, amount);
	}

	async passAuction(playerId: string, squareIndex: number): Promise<void> {
		await this.invoke("PassAuction", playerId, squareIndex);
	}

	// ==========================================
	// TRADE OPERATIONS
	// ==========================================

	async proposeTrade(
		playerId: string,
		targetPlayerId: string,
		offeredProperties: number[],
		offeredMoney: number,
		offeredReleasePasses: number,
		requestedProperties: number[],
		requestedMoney: number,
		requestedReleasePasses: number
	): Promise<void> {
		await this.invoke(
				"ProposeTrade",
				playerId,
				targetPlayerId,
				offeredProperties,
				offeredMoney,
				offeredReleasePasses,
				requestedProperties,
				requestedMoney,
				requestedReleasePasses
			);
	}

	async respondTrade(playerId: string, tradeId: string, accept: boolean): Promise<void> {
		await this.invoke("RespondTrade", playerId, tradeId, accept);
	}

	async cancelTrade(playerId: string, tradeId: string | null): Promise<void> {
		await this.invoke("CancelTrade", playerId, tradeId);
	}

	// ==========================================
	// DEBT & BANKRUPTCY OPERATIONS
	// ==========================================

	async mortgageProperty(playerId: string, squareIndex: number): Promise<void> {
		await this.invoke("MortgageProperty", playerId, squareIndex);
	}

	async unmortgageProperty(playerId: string, squareIndex: number): Promise<void> {
		await this.invoke("UnmortgageProperty", playerId, squareIndex);
	}

	async sellBuildings(playerId: string, squareIndex: number, count: number): Promise<void> {
		await this.invoke("SellBuildings", playerId, squareIndex, count);
	}

	async build(playerId: string, squareIndex: number, count: number): Promise<void> {
		await this.invoke("Build", playerId, squareIndex, count);
	}

	async declareBankruptcy(playerId: string): Promise<void> {
		await this.invoke("DeclareBankruptcy", playerId);
	}

	async payReleaseCost(playerId: string): Promise<void> {
		await this.invoke("PayReleaseCost", playerId);
	}

	async useReleasePass(playerId: string): Promise<void> {
		await this.invoke("UseReleasePass", playerId);
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
				gameId: gameDocument.id || gameDocument.gameId,
				hostId: gameDocument.hostId,
				inviteCode: gameDocument.inviteCode,
				status: gameDocument.status,
				maxPlayers: gameDocument.maxPlayers || 4,
				players: gameDocument.players || []
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
