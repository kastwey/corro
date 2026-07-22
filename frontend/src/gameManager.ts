// gameManager.ts - Server-authoritative state manager
import { gameClient } from './gameClient.js';
import type { AnnouncementEvent } from './gameClient.js';
import type { AnnounceFn } from './announcer.js';
import { commitAnnouncerBeforeState } from './announcer.js';
import type { CardDrawnNotification } from './models.js';
import type { GameState, Player, Square, CommandResponse, PropertyMortgagedResponse, BuildingsSoldResponse, BuildingBuiltResponse, TradeSideDto } from './models.js';
import { translateServerErrorSync, i18nBinder } from './i18nBinder.js';
import { resolveSquareName } from './localizeSquare.js';
import type { Board } from './board.js';
import { GameSessionStore } from './sessionUtils.js';
import { createCommandRegistry, createAnnouncement } from './commands/registry.js';
import type { CommandContext } from './commands/registry.js';
import { TurnSequencer } from './turnSequencer.js';
import { localHandChanged } from './cardHandState.js';

export interface AuctionStartedData {
	squareIndex: number;
	squareName: string;
	startingPrice: number;
	initiatorPlayerId: string;
	initiatorPlayerName: string;
	bidTimeoutSeconds: number;
}

export interface BidPlacedData {
	squareIndex: number;
	squareName: string;
	bidderId: string;
	bidderName: string;
	amount: number;
	bidTimeoutSeconds: number;
	isMe: boolean;
}

export interface AuctionPassedData {
	squareIndex: number;
	playerId: string;
	playerName: string;
	remainingBidders: number;
	isMe: boolean;
}

export interface AuctionEndedData {
	squareIndex: number;
	squareName: string;
	winnerId?: string;
	winnerName?: string;
	winningBid?: number;
	propertySold: boolean;
	isWinner: boolean;
}

export interface TradeProposedData {
	tradeId: string;
	initiatorId: string;
	initiatorName: string;
	targetId: string;
	targetName: string;
	offered: TradeSideDto;
	requested: TradeSideDto;
	/** True when I am the target who must accept or decline. */
	isForMe: boolean;
	/** True when I am the one who proposed it. */
	isMine: boolean;
}

export interface TradeResolvedData {
	tradeId: string;
	outcome: 'accepted' | 'declined' | 'cancelled';
	initiatorId: string;
	targetId: string;
	/** True when I was a party to the trade (initiator or target). */
	involvesMe: boolean;
}

export interface GameManagerEvents {
	'gameStateUpdated': GameState;
	/** The join ack delivered this player's re-entry code (recovery key). */
	'rejoinCodeAvailable': string;
	'connectionStatusChanged': { status: 'connected' | 'reconnecting' | 'disconnected' };
	'reconnectionAttempt': { state: 'connecting' | 'success' | 'failed'; attempt?: number; error?: string };
	'turnChanged': { playerId: string };
	'diceRolled': { playerId: string; die1: number; die2: number; isDoubles?: boolean; isMe?: boolean };
	'auctionStarted': AuctionStartedData;
	'bidPlaced': BidPlacedData;
	'auctionPassed': AuctionPassedData;
	'auctionEnded': AuctionEndedData;
	'auctionTimerTick': { squareIndex: number; secondsRemaining: number; currentBid: number; highestBidderId?: string; highestBidderName?: string };
	// Debt & Bankruptcy events
	'propertyMortgaged': PropertyMortgagedResponse;
	'propertyUnmortgaged': any;
	'housesSold': BuildingsSoldResponse;
	'houseBuilt': BuildingBuiltResponse;
	// Trading
	'tradeProposed': TradeProposedData;
	'tradeResolved': TradeResolvedData;
	// Card reveal (the card decks)
	'cardDrawn': CardDrawnNotification;
	// A server-side validation error (e.g. an illegal action). Surfaced both
	// audibly (ARIA live) and visually (non-intrusive notification) so sighted
	// and screen-reader players alike learn WHY their action was rejected.
	'serverError': { code: string; message: string };
}

/**
 * Build the spoken + visual feedback for a server error code. Pure (translator is
 * injected) so it can be unit-tested without i18next/DOM.
 *
 * `announceKey` feeds the ARIA live region (screen readers); `visualMessage` is the
 * already-translated text for the non-intrusive notification (sighted players).
 */
export function buildServerErrorFeedback(
	code: string | undefined,
	fallbackMessage: string | undefined,
	translateCode: (c: string) => string
): { code: string; announceKey: string; visualMessage: string } {
	const errorCode = code || fallbackMessage || 'UNKNOWN_ERROR';
	return {
		code: errorCode,
		announceKey: 'serverErrors.' + errorCode,
		visualMessage: translateCode(errorCode),
	};
}

/**
 * The state a CONSEQUENCE read (Free Parking pot, debt indicator) should use: the revealed
 * `presentation` state if the player has one, else the authoritative one. Pure so the precedence
 * — presentation wins mid-animation, authoritative before the first reveal — is unit-testable in
 * isolation from the announcement gate that advances it.
 */
export function pickConsequenceState(
	presentation: GameState | null,
	authoritative: GameState | null
): GameState | null {
	return presentation ?? authoritative;
}

export class GameManager {
	private eventHandlers = new Map<keyof GameManagerEvents, Array<(data: any) => void>>();
	private GameState: GameState | null = null;
	// Presentation state: the last state whose CONSEQUENCES the player has actually SEEN land (paced
	// to the token hop by the announcement gate). Consequence READS — the Free Parking pot, the debt
	// indicator — use this instead of the authoritative GameState, so a query fired mid-animation
	// shows what has been revealed, not the future the server already knows. Advanced by
	// revealPresentation() from the SAME deferVisual that paces the consequence renders, so its
	// timing (token settle, or immediate when nothing animates) is identical. Logic (available
	// actions, legality, sending commands) keeps reading the authoritative GameState.
	private PresentationState: GameState | null = null;
	private board: Board | null = null;
	private announce: AnnounceFn | null = null;
	// Paces a VISUAL side-effect to the token hop (the announcement gate's deferVisual).
	// Defaults to running immediately so the manager works before app.ts wires the gate.
	private deferVisual: (run: () => void) => void = (run) => run();
	// Arms the announcement gate for an incoming movement (the gate's armForMove). A command
	// RESPONSE (e.g. DICE_ROLLED) arrives before the sequencer plays its announcements+state
	// segment, so at response time the gate is still unarmed and deferVisual would run at
	// once — revealing the destination while the token is still travelling. Defaults to no-op.
	private armForMove: () => void = () => {};
	private myPlayerId: string | null = null;
	/** This player's re-entry code, delivered privately on every authenticated join. */
	private myRejoinCode: string | null = null;

	// Token-animation probe; app.ts injects the real one so the sequencer can pace a
	// compound move's segments to the hop. Defaults to "never animating" (apply at once).
	private animationProbe: () => boolean = () => false;

	// Serializes a compound move's segments to token-hop completion: each segment's
	// announcements + state play, the
	// hop runs, then the next segment follows. A single-segment action plays immediately.
	private readonly turnSequencer = new TurnSequencer({
		deliverEvents: (events) => {
			// My OWN action's story must WIN over the focus-change reading the screen
			// reader does when the played card leaves the hand (live-play: hearing the
			// next card's name before your own move was tedious). A batch containing any
			// line I authored goes out assertive; everyone else's stays polite.
			const myId = this.getMyPlayerId();
			const mine = myId !== null && events.some(event => event.vars?.actorId === myId);
			for (const event of events) this.announce?.(event, mine ? { assertive: true } : undefined);
		},
		// SignalR already sends GameEvents before GameStateChanged, but the sequencer used to
		// buffer both and write the live region in the SAME task that repainted the hand. NVDA
		// could process the resulting focus/list mutation first. Commit the audible batch and
		// give the accessibility tree its own timer turn before any state-driven DOM mutation.
		beforeApplyState: (_events, state) => commitAnnouncerBeforeState({
			focusChangingHand: localHandChanged(this.GameState, state, this.getMyPlayerId()),
		}),
		applyState: (state) => {
			this.GameState = state;
			this.emit('gameStateUpdated', state);
		},
		isAnimating: () => this.animationProbe(),
	});

	// Command handler registry (OCP)
	private commandRegistry = createCommandRegistry();

	// Credentials of the last authenticated join, so a transport-level reconnection can
	// re-join on its own (the new connection is a stranger to the server until it does).
	private lastAuthJoin: { gameId: string; playerId: string; playerSecretId: string } | null = null;

	constructor() {
		this.setupEventHandlers();
	}

	private setupEventHandlers(): void {
		gameClient.on('connected', () => {
			this.emit('connectionStatusChanged', { status: 'connected' });
		});

		gameClient.on('disconnected', () => {
			this.emit('connectionStatusChanged', { status: 'disconnected' });
		});

		gameClient.on('reconnecting', () => {
			this.emit('connectionStatusChanged', { status: 'reconnecting' });
		});

		gameClient.on('reconnected', () => {
			this.emit('connectionStatusChanged', { status: 'connected' });
			void this.rejoinAfterReconnect();
		});

		gameClient.on('connectionError', (error: Error) => {
			this.announce?.(createAnnouncement('game.connection_error', { message: error.message }));
		});

		gameClient.on('gameCreated', (response: any) => {
			if (response.gameState) {
				this.GameState = response.gameState;
				this.emit('gameStateUpdated', response.gameState);
			}
			this.announce?.(createAnnouncement('game.game_created', { gameId: response.gameId }));
		});

		gameClient.on('gameJoined', (data) => {
			// The board ack carries this player's RE-ENTRY code (their account-less
			// recovery key): surface it for the connection panel and keep the saved
			// session in sync so pre-feature entries get backfilled.
			const rejoinCode = data?.rejoinCode;
			const gameId = data?.gameId;
			if (rejoinCode) {
				this.myRejoinCode = rejoinCode;
				if (gameId) {
					const saved = GameSessionStore.getGame(gameId);
					if (saved && saved.rejoinCode !== rejoinCode) {
						GameSessionStore.saveGame({ ...saved, rejoinCode });
					}
				}
				// The ack arrives AFTER the state snapshot: tell the UI directly, or the
				// connection panel would only learn the code on the next state push.
				this.emit('rejoinCodeAvailable', rejoinCode);
			}
			// No client-side "joined" line: the SERVER owns the entry voice (it announces
			// the reconnection transition) — a second line here just echoed it.
		});

		gameClient.on('gameStarted', (response: any) => {
			if (response.gameState) {
				this.GameState = response.gameState;
				this.emit('gameStateUpdated', response.gameState);
			}
			this.announce?.(createAnnouncement('game.game_has_started', {}));
		});

		gameClient.on('gameStateChanged', (gameState: GameState) => {
			if (!gameState.squares?.length) {
				console.warn('GameState received without squares from server');
			}
			// Route through the sequencer: it closes the current segment (pairing this state
			// with the events buffered since the last one) and applies it once the previous
			// segment's token hop has settled. A single-segment action applies immediately.
			this.turnSequencer.enqueueState(gameState);
		});

		gameClient.on('lobbyState', (lobbyState: any) => {
			this.announce?.(createAnnouncement('game.waiting_for_start', { status: lobbyState.status }));
		});

		gameClient.on('commandResponse', (response: CommandResponse) => {
			this.handleCommandResponse(response);
		});

		gameClient.on('error', (error: any) => {
			// SignalR "Error" messages arrive as a bare error-code string.
			this.reportServerError(typeof error === 'string' ? error : error?.message);
		});

		// Server game events arrive as one ordered batch per action (AnnouncementEvent[]).
		// We buffer them in the sequencer; they pair with the NEXT state into one segment and
		// are handed to announce() in order when that segment plays (the announcer coalesces
		// the burst into a single utterance and the sound layer fires each earcon). The
		// server already personalizes by audience (the acting player gets the first-person
		// "_self" lines), so the client just plays whatever arrives, in order.
		gameClient.on('gameEvents', (events: AnnouncementEvent[]) => {
			this.turnSequencer.enqueueEvents(events);
		});

		// Auction timer ticks from server
		gameClient.on('auctionTimerTick', (data) => {
			this.emit('auctionTimerTick' as keyof GameManagerEvents, data);
		});

		// Card drawn (the card decks) - drives the visual reveal
		gameClient.on('cardDrawn', (data) => {
			this.emit('cardDrawn', data);
		});
	}

	/**
	 * Creates the context object for command handlers
	 */
	private createCommandContext(): CommandContext {
		const manager = this;
		return {
			// Live getter, NOT a snapshot: a handler that reads `gameState` from a deferred
			// callback (e.g. DiceRolledHandler's 600 ms turn-indicator refresh) must see the
			// CURRENT authoritative state, not the one captured when the response arrived.
			// Otherwise a stale snapshot can resurrect already-cleared state and reopen a
			// state-driven dialog after the operation has already completed.
			get gameState() { return manager.GameState; },
			board: this.board,
			myPlayerId: this.myPlayerId,
			announce: (event) => this.announce?.(event),
			emit: (event, data) => this.emit(event as keyof GameManagerEvents, data),
			updateGameState: (state) => { this.GameState = state; },
			deferVisual: (run) => this.deferVisual(run),
			armForMove: () => this.armForMove()
		};
	}

	/**
	 * Delegates command response handling to the appropriate handler via registry.
	 * Following OCP: new response types = new handlers, no modification here.
	 */
	private handleCommandResponse(response: CommandResponse): void {
		if (!response.type) {
			console.warn('CommandResponse without type:', response);
			return;
		}

		// Command-validation errors are cross-cutting: there is no per-type visual
		// handler for them. Surface them to BOTH sighted and screen-reader players
		// instead of swallowing them silently in an "unhandled type" log.
		if (response.type === 'ERROR') {
			this.reportServerError(response.code, response.message);
			return;
		}

		const context = this.createCommandContext();
		const handled = this.commandRegistry.dispatch(response, context);

		if (!handled) {
			console.debug(`Unhandled command response type: ${response.type}`);
		}
	}

	/**
	 * Surface a server-side error to the player. Screen-reader users hear it via the
	 * priority ARIA live region; sighted users see a non-intrusive notification (the
	 * UI layer renders the emitted 'serverError'). Previously these errors were
	 * swallowed silently, so neither audience learned why an action was rejected.
	 */
	private reportServerError(code?: string, message?: string): void {
		const feedback = buildServerErrorFeedback(code, message, translateServerErrorSync);
		this.announce?.(createAnnouncement(feedback.announceKey, {}), { priority: true });
		this.emit('serverError', { code: feedback.code, message: feedback.visualMessage });
	}

	// === CONNECTION ===

	async connectToServer(): Promise<boolean> {
		return await gameClient.connect();
	}

	async disconnect(): Promise<void> {
		await gameClient.disconnect();
	}

	async joinGameWithAuth(gameId: string, playerId: string, playerSecretId: string): Promise<void> {
		this.myPlayerId = playerId;
		// Kept for the automatic re-join after a transport reconnection (see 'reconnected').
		this.lastAuthJoin = { gameId, playerId, playerSecretId };
		await gameClient.joinGameWithAuth(gameId, playerId, playerSecretId);
		// No announcement: the SERVER voices the entry (the reconnection transition line).
	}

	/**
	 * A SignalR automatic reconnect opens a NEW connection id: the server no longer has
	 * it in the game group nor authenticated, so without re-joining the game goes SILENT
	 * (no announcements, no state updates reach this player) while their commands bounce
	 * with NOT_AUTHENTICATED. Re-join with the stored credentials: the server re-maps the
	 * connection, flips the connected flag (announcing the return) and pushes a fresh
	 * authoritative state, so play resumes exactly where it left off.
	 */
	private async rejoinAfterReconnect(): Promise<void> {
		const auth = this.lastAuthJoin;
		if (!auth) return;

		const maxAttempts = 3;
		for (let attempt = 1; attempt <= maxAttempts; attempt++) {
			this.emit('reconnectionAttempt', { state: 'connecting', attempt });
			try {
				await gameClient.joinGameWithAuth(auth.gameId, auth.playerId, auth.playerSecretId);
				this.emit('reconnectionAttempt', { state: 'success' });
				return;
			} catch (e) {
				const isLastAttempt = attempt === maxAttempts;
				const message = e instanceof Error ? e.message : String(e);
				if (isLastAttempt) {
					this.emit('reconnectionAttempt', { state: 'failed', error: message });
				} else {
					// Wait 1 second before retrying
					await new Promise(resolve => setTimeout(resolve, 1000));
				}
			}
		}
	}

	getConnectionState(): string | object {
		return gameClient.getConnectionState();
	}

	retryReconnect(): void {
		void this.rejoinAfterReconnect();
	}

	// === INITIALIZATION ===

	initialize(
		board: Board,
		announce: AnnounceFn,
		deferVisual?: (run: () => void) => void,
		armForMove?: () => void,
	): void {
		this.board = board;
		this.announce = announce;
		if (deferVisual) this.deferVisual = deferVisual;
		if (armForMove) this.armForMove = armForMove;
	}

	/**
	 * Inject the token-animation probe so the turn sequencer can pace a compound move's
	 * segments to the hop. Without it the sequencer treats every segment as non-animating
	 * and applies states immediately (the pre-sequencer behaviour).
	 */
	setAnimationProbe(isAnimating: () => boolean): void {
		this.animationProbe = isAnimating;
	}

	/**
	 * Advance the turn sequencer because the current segment's token hop has settled. Wired
	 * to the token animator's `onIdle` so the next segment
	 * plays only after the previous landing's hop completes.
	 */
	notifyAnimationSettled(): void {
		this.turnSequencer.onSettle();
	}

	// === STATE ACCESS ===

	getAllPlayers(): Player[] {
		return this.GameState?.players || [];
	}

	/** The re-entry code of the local player (null until the join ack delivers it). */
	getMyRejoinCode(): string | null {
		return this.myRejoinCode;
	}

	getMyPlayerId(): string | null {
		return this.myPlayerId;
	}

	getMyPlayer(): Player | null {
		return this.myPlayerId ? this.getPlayer(this.myPlayerId) : null;
	}

	getSquares(): Square[] {
		const squares = this.GameState?.squares || [];
		// Resolve each square's display name to the player's language, with fallbacks so a package
		// board that doesn't name every square is never blank: a card square reads as its deck's
		// name, and corners get a generic label from their behaviour.
		const lang = i18nBinder.getCurrentLanguage();
		const decks = this.getDecks();
		return squares.map(s => {
			const name = resolveSquareName(s, lang, decks, k => i18nBinder.tSync(k));
			return name !== s.name ? { ...s, name } : s;
		});
	}

	getPlayer(id: string): Player | null {
		return this.GameState?.players?.find(p => p.id === id) || null;
	}

	getCurrentPlayer(): Player | null {
		const currentTurnId = this.GameState?.currentTurn;
		return currentTurnId ? this.getPlayer(currentTurnId) : null;
	}

	getCurrentGameState(): GameState | null {
		return this.GameState;
	}

	/** The state whose consequences have been REVEALED to the player (paced to the token hop) — what
	 *  they have actually seen/heard. Consequence reads (pot, debt) use this so a mid-animation query
	 *  doesn't spoil what the token hasn't reached yet. Falls back to the authoritative state before
	 *  the first reveal (nothing is animating at game start). */
	getPresentationState(): GameState | null {
		return pickConsequenceState(this.PresentationState, this.GameState);
	}

	/** Advance the presentation state to a just-revealed segment. Called from the announcement gate's
	 *  deferVisual, so its timing (token settle, or immediate when nothing animates) matches the paced
	 *  consequence renders exactly. */
	revealPresentation(state: GameState): void {
		this.PresentationState = state;
	}

	getPlayerMoney(id: string): number {
		return this.getPlayer(id)?.money || 0;
	}

	getBankMoney(): number {
		return this.GameState?.bank?.money || 0;
	}

	getFreeParkingPot(): number {
		// Presentation state, NOT authoritative: a mid-animation "f" query must read the pot the
		// player has seen land, not the future the server already applied (the token hasn't reached
		// the square that fed it yet). See PresentationState.
		return this.getPresentationState()?.bank?.freeParkingPot || 0;
	}

	/** The package's central brand text for the board centre (e.g. "CORRO"); '' for a classic game. */
	getCenterBrand(): string {
		return this.GameState?.centerBrand ?? '';
	}

	/** The package's card decks (id + label localized to the current language); [] for a classic game. */
	getDecks(): { id: string; label: string }[] {
		return (this.GameState?.decks ?? []).map(d => {
			const resolved = d.nameKey ? i18nBinder.tSync(d.nameKey) : '';
			return { id: d.id, label: (resolved && resolved !== d.nameKey) ? resolved : (d.nameKey || d.id) };
		});
	}

	/**
	 * Whether the Free Parking jackpot house rule is active. The board uses this to decide
	 * whether to show the centre pot at all: with the rule off there is no pot to show, so the
	 * decorative cash/label are hidden entirely (rather than showing a permanent "0 €").
	 */
	isFreeParkingJackpot(): boolean {
		return this.GameState?.bank?.freeParkingJackpot ?? false;
	}

	/** Sum of every pending debt the player still owes (0 when debt-free). */
	getTotalDebt(playerId: string): number {
		return (this.GameState?.pendingDebts ?? [])
			.filter(d => d.debtorId === playerId)
			.reduce((sum, d) => sum + d.amount, 0);
	}

	// === SERVER COMMANDS ===

	async sendCommand(command: any): Promise<void> {
		try {
			await gameClient.executeCommand(command);
		} catch (error) {
			this.announce?.(createAnnouncement('game.command_error', { error: String(error) }));
		}
	}

	async disconnectFromServer(): Promise<void> {
		await this.disconnect();
	}

	async initializeGame(players: any[]): Promise<void> {
		await this.sendCommand({ type: 'initializeGame', players });
	}

	async endTurn(playerId: string): Promise<void> {
		await gameClient.endTurn(playerId);
	}

	/**
	 * Run a command as the local player: resolve my id (announcing if unknown), optionally guard
	 * that it is my turn, then invoke and turn any transport error into a spoken message. Centralizes
	 * the guard boilerplate every command method used to repeat.
	 */
	private async runAsMe(op: (myId: string) => Promise<void>, opts: { requireTurn?: boolean } = {}): Promise<void> {
		const myId = this.getMyPlayerId();
		if (!myId) { this.announce?.(createAnnouncement('game.player_not_identified', {})); return; }
		if (opts.requireTurn && this.GameState?.currentTurn !== myId) {
			this.announce?.(createAnnouncement('game.not_your_turn', {}));
			return;
		}
		try { await op(myId); }
		catch (error) { this.announce?.(createAnnouncement('game.command_error', { error: String(error) })); }
	}

	async rollDice(): Promise<void> {
		await this.runAsMe(id => gameClient.rollDice(id), { requireTurn: true });
	}

	/** Race family: answer the pending "which piece moves?" choice. */
	async moveRacePiece(pieceIndex: number): Promise<void> {
		await this.runAsMe(id => gameClient.moveRacePiece(id, pieceIndex), { requireTurn: true });
	}

	/** Trivia family: the host picks the judge before play begins (off-turn setup). */
	async triviaChooseJudge(judgeId: string): Promise<void> {
		await this.runAsMe(id => gameClient.triviaChooseJudge(id, judgeId));
	}

	/** Trivia family: choose which legal square to land on after a roll. */
	async triviaMove(node: string): Promise<void> {
		await this.runAsMe(id => gameClient.triviaMove(id, node), { requireTurn: true });
	}

	/** Trivia family: submit an answer to the pending question (the active player). */
	async triviaAnswer(text: string | null, choice: number): Promise<void> {
		await this.runAsMe(id => gameClient.triviaAnswer(id, text, choice));
	}

	/** Trivia family: rule on the submitted answer (off-turn — the judge is not the active player). */
	async triviaJudge(correct: boolean): Promise<void> {
		await this.runAsMe(id => gameClient.triviaJudge(id, correct));
	}

	/** Journey family: draw the top card (the start of your turn). */
	async journeyDraw(): Promise<void> {
		await this.runAsMe(id => gameClient.journeyDraw(id), { requireTurn: true });
	}

	/** Journey family: play a card (attacks carry the victim's id). */
	async journeyPlay(instanceId: string, targetId: string | null = null): Promise<void> {
		await this.runAsMe(id => gameClient.journeyPlay(id, instanceId, targetId), { requireTurn: true });
	}

	/** Journey family: discard instead of playing. */
	async journeyDiscard(instanceId: string): Promise<void> {
		await this.runAsMe(id => gameClient.journeyDiscard(id, instanceId), { requireTurn: true });
	}

	/** Journey family: answer the coup fourré window — the VICTIM answers OUT of turn,
	 *  so no turn gate here (the server validates they own the pending coup). */
	async journeyCoup(accept: boolean): Promise<void> {
		await this.runAsMe(id => gameClient.journeyCoup(id, accept));
	}

	/** Assembly family: play a card (attacks/specials carry their targeting). */
	async assemblyPlay(instanceId: string, targeting: { targetPlayerId?: string | null; targetColor?: string | null; giveColor?: string | null } = {}): Promise<void> {
		await this.runAsMe(id => gameClient.assemblyPlay(id, instanceId,
			targeting.targetPlayerId ?? null, targeting.targetColor ?? null, targeting.giveColor ?? null),
			{ requireTurn: true });
	}

	/** Assembly family: discard cards face-down (empty list = the empty-hand pass). */
	async assemblyDiscard(instanceIds: string[]): Promise<void> {
		await this.runAsMe(id => gameClient.assemblyDiscard(id, instanceIds), { requireTurn: true });
	}

	/** Draft family: commit (or replace) this trick's secret pick — optionally two
	 *  cards riding a table "extra". The family is SIMULTANEOUS — there is no turn to
	 *  guard (currentTurn stays null all game). */
	async draftPick(instanceId: string, secondInstanceId: string | null = null): Promise<void> {
		await this.runAsMe(id => gameClient.draftPick(id, instanceId, secondInstanceId));
	}

	/** Shedding family: play a matching card (wilds carry the chosen colour). `extraInstanceIds`
	 *  carry the further identical copies of a doubles play (the "doubles" house rule). */
	async sheddingPlay(instanceId: string, chosenColor: string | null = null,
		extraInstanceIds: string[] | null = null): Promise<void> {
		await this.runAsMe(id => gameClient.sheddingPlay(id, instanceId, chosenColor, extraInstanceIds),
			{ requireTurn: true });
	}

	/** Shedding family: draw one card (maybe pausing on the play-or-keep choice). */
	async sheddingDraw(): Promise<void> {
		await this.runAsMe(id => gameClient.sheddingDraw(id), { requireTurn: true });
	}

	/** Shedding family: keep the just-drawn card and pass the turn. */
	async sheddingKeep(): Promise<void> {
		await this.runAsMe(id => gameClient.sheddingKeep(id), { requireTurn: true });
	}

	/** Shedding family: declare the last card — OFF-TURN (during the window after playing
	 *  your penultimate card, when it is no longer your turn). */
	async sheddingDeclareLastCard(): Promise<void> {
		await this.runAsMe(id => gameClient.sheddingDeclareLastCard(id));
	}

	/** Shedding family: catch a rival who forgot the declaration — OFF-TURN (anyone but the exposed
	 *  player, until the next action closes the window). */
	async sheddingCatchLastCard(): Promise<void> {
		await this.runAsMe(id => gameClient.sheddingCatchLastCard(id));
	}

	/** Exploding family: play an action card (with an optional target / cat pair). ON-TURN. */
	async explodingPlay(instanceId: string, targetId?: string, secondInstanceId?: string): Promise<void> {
		await this.runAsMe(
			id => gameClient.explodingPlay(id, instanceId, targetId ?? null, secondInstanceId ?? null),
			{ requireTurn: true });
	}

	/** Exploding family: as a Favor's target, give the requester a card — OFF-TURN (it's their turn). */
	async explodingGive(instanceId: string): Promise<void> {
		await this.runAsMe(id => gameClient.explodingGive(id, instanceId));
	}

	/** Exploding family: draw one card, ending my turn (or detonating on a bomb). ON-TURN. */
	async explodingDraw(): Promise<void> {
		await this.runAsMe(id => gameClient.explodingDraw(id), { requireTurn: true });
	}

	/** Exploding family: tuck the just-drawn (defused) bomb back at `depth`. ON-TURN
	 *  (only the drawer, while pendingBomb is theirs). */
	async explodingDefuse(depth: number): Promise<void> {
		await this.runAsMe(id => gameClient.explodingDefuse(id, depth), { requireTurn: true });
	}

	/** Exploding family: Nope the pending action — OFF-TURN (anyone holding a Nope during the window). */
	async explodingNope(instanceId: string): Promise<void> {
		await this.runAsMe(id => gameClient.explodingNope(id, instanceId));
	}

	async announceTurn(playerId?: string): Promise<void> {
		const player = playerId ? this.getPlayer(playerId) : this.getCurrentPlayer();
		if (player) {
			this.announce?.(createAnnouncement('game.turn_of', { player: player.name }));
		}
	}

	async buyProperty(squareIndex: number): Promise<void> {
		await this.runAsMe(id => gameClient.buyProperty(id, squareIndex));
	}

	// === HOLDING ACTIONS ===

	async payReleaseCost(): Promise<void> {
		await this.runAsMe(id => gameClient.payReleaseCost(id), { requireTurn: true });
	}

	async useReleasePass(): Promise<void> {
		await this.runAsMe(id => gameClient.useReleasePass(id), { requireTurn: true });
	}

	// === AUCTION ACTIONS ===

	async placeBid(squareIndex: number, amount: number): Promise<void> {
		await this.runAsMe(id => gameClient.placeBid(id, squareIndex, amount));
	}

	async passAuction(squareIndex: number): Promise<void> {
		await this.runAsMe(id => gameClient.passAuction(id, squareIndex));
	}

	// === DEBT & BANKRUPTCY ACTIONS ===

	async mortgageProperty(squareIndex: number): Promise<void> {
		await this.runAsMe(id => gameClient.mortgageProperty(id, squareIndex));
	}

	async unmortgageProperty(squareIndex: number): Promise<void> {
		await this.runAsMe(id => gameClient.unmortgageProperty(id, squareIndex));
	}

	async sellBuildings(squareIndex: number, count: number): Promise<void> {
		await this.runAsMe(id => gameClient.sellBuildings(id, squareIndex, count));
	}

	async build(squareIndex: number, count: number): Promise<void> {
		await this.runAsMe(id => gameClient.build(id, squareIndex, count));
	}

	async declareBankruptcy(): Promise<void> {
		await this.runAsMe(id => gameClient.declareBankruptcy(id));
	}

	// === TRADE ACTIONS ===

	async proposeTrade(
		targetId: string,
		offered: { properties: number[]; money: number; releasePasses: number },
		requested: { properties: number[]; money: number; releasePasses: number }
	): Promise<void> {
		await this.runAsMe(id => gameClient.proposeTrade(
				id,
				targetId,
				offered.properties,
				offered.money,
				offered.releasePasses,
				requested.properties,
				requested.money,
				requested.releasePasses
			));
	}

	async respondToTrade(tradeId: string, accept: boolean): Promise<void> {
		await this.runAsMe(id => gameClient.respondTrade(id, tradeId, accept));
	}

	async cancelTrade(tradeId: string): Promise<void> {
		await this.runAsMe(id => gameClient.cancelTrade(id, tradeId));
	}

	// === EVENTS ===

	on<K extends keyof GameManagerEvents>(event: K, handler: (data: GameManagerEvents[K]) => void): void {
		if (!this.eventHandlers.has(event)) {
			this.eventHandlers.set(event, []);
		}
		this.eventHandlers.get(event)!.push(handler);
	}

	off<K extends keyof GameManagerEvents>(event: K, handler: (data: GameManagerEvents[K]) => void): void {
		const handlers = this.eventHandlers.get(event);
		if (handlers) {
			const index = handlers.indexOf(handler);
			if (index > -1) handlers.splice(index, 1);
		}
	}

	private emit<K extends keyof GameManagerEvents>(event: K, data: GameManagerEvents[K]): void {
		this.eventHandlers.get(event)?.forEach(handler => {
			try { handler(data); } catch (e) { console.error(`GameManager event error:`, e); }
		});
	}
}

export const gameManager = new GameManager();
