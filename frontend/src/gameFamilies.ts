// The client-side game-family registry: every "if (gameType === 'race'/'track')" that used to
// live in app.ts asks this module instead — the board+animator factory, the players-panel
// identity line, the C-key identity announcement and "go to player". Adding a fourth family
// means one traits line (familyTraits.ts) plus one spec here, not editing app.ts.
//
// The PROPERTY family is intentionally NOT in the registry: it is the default every surface
// falls back to (the eagerly-built perimeter board, the money line, the economy toolbar), so
// `familyFor` returns null for it and callers keep their historical default path.

import type { BoardNavigator } from './keys.js';
import type { GameState, Player } from './models.js';
import type { HelpShortcut } from './shortcuts.js';
import { buildRaceRulesLines, buildTrackRulesLines, buildTriviaRulesLines } from './rulesSummaries.js';
import { familyTraitsFor, type FamilyTraits } from './familyTraits.js';
import { RaceBoard } from './raceBoard.js';
import { RaceTokenAnimator } from './raceTokenAnimator.js';
import { TrackBoard } from './trackBoard.js';
import { TrackTokenAnimator } from './trackTokenAnimator.js';
import { TriviaTokenAnimator } from './triviaTokenAnimator.js';
import { TriviaBoard } from './triviaBoard.js';
import { JourneyBoard, journeyStatusText } from './journeyBoard.js';
import { AssemblyBoard } from './assemblyBoard.js';
import { assemblyStatusText } from './assemblyRules.js';
import { DraftBoard } from './draftBoard.js';
import { draftStatusText } from './draftRules.js';
import { SheddingBoard } from './sheddingBoard.js';
import { sheddingStatusText } from './sheddingRules.js';
import { ExplodingBoard } from './explodingBoard.js';
import { explodingStatusText } from './explodingRules.js';
import { gameManager } from './gameManager.js';
import { seatDisplayName } from './raceGeometry.js';
import { i18nBinder, localizeColor } from './i18nBinder.js';

/** Colour WORDS for the track family's engine palette (mirror of the server's TrackFamily):
 *  the state only carries the hex, but "your colour is #1e88e5" is meaningless aloud. */
const ENGINE_PALETTE_WORDS: Record<string, string> = {
  '#e53935': 'red', '#1e88e5': 'blue', '#fdd835': 'yellow', '#43a047': 'green',
  '#8e24aa': 'purple', '#fb8c00': 'orange', '#00acc1': 'lightblue', '#6d4c41': 'brown',
};

/** Everything a family needs to build its board and animator (closures over app.ts state). */
export interface FamilyDeps {
  /** The shared board container (board.html's #board). */
  boardElement: HTMLElement;
  getGameState(): GameState | null;
  getMyPlayerId(): string | null;
  /** Instant, assertive raw-text announcement (cursor narration). */
  announce(text: string): void;
  /** Full-key translator (seat/effect names are package keys). */
  tSync(key: string, vars?: Record<string, unknown>): string;
  /** The "move token" earcon, one call per visible hop. */
  onStep(): void;
  /** Animation went idle: release gated announcements + advance the turn sequencer. */
  onIdle(): void;
  motionDisabled(): boolean;
  /** Move keyboard focus to the board container (after a cursor jump). */
  focusBoard(): void;
}

/** A family's live surfaces: its navigation board and its animation pacing. */
export interface FamilyView {
  /** The navigation surface the keyboard facade delegates to while this family is active. */
  board: BoardNavigator;
  /** Repaint from a fresh server state and let the animator pace announcements to motion. */
  onStateUpdated(gs: GameState): void;
  /** True while this family's piece animation is walking the board. */
  isAnimating(): boolean;
  /** Jump the exploration cursor to this player's piece. True = handled (even as a no-op);
   *  false = the caller runs the property default (player.position on the perimeter). */
  goToPlayer(playerId: string): boolean;
  /** Focus landed on the #board CONTAINER itself: a family whose home surface lives inside
   *  it (journey's hand) forwards the focus and returns true; others leave the default
   *  cursor narration alone. */
  onBoardFocus?(): boolean;
  /** The family's own shortcuts for the help dialog — its keys that live OUTSIDE the shared
   *  keymap.json (the card families' hand and status keys). Absent for board families,
   *  whose keys all come from keymap.json. */
  helpShortcuts?(): HelpShortcut[];
  /** The active game rules as readable lines (Ctrl+Shift+F1); null/absent when the family
   *  lists none, in which case the rules command reports there is nothing to show. */
  rulesSummary?(): string[] | null;
}

/** The race view also exposes its concrete board: the move-options UI (highlights,
 *  click-to-select, focus→ring) drives race-specific methods on it. */
export interface RaceFamilyView extends FamilyView {
  raceBoard: RaceBoard;
}

/** The trivia view also exposes its concrete board: the destination-choice UI (highlight the
 *  legal landings, 'd' to cycle, Enter to pick) drives trivia-specific methods on it. */
export interface TriviaFamilyView extends FamilyView {
  triviaBoard: TriviaBoard;
}

/** What the C key should announce for "how am I doing?" in this family. */
export interface FamilyIdentityAnnouncement {
  key: string;
  vars: Record<string, unknown>;
}

/** One non-property game family (race, track…): its pure traits + the lazy view factory. */
export interface GameFamily extends FamilyTraits {
  /** The players-panel identity line replacing the money line (the race squadron, the track
   *  piece name); null falls back to the panel default. */
  boardIdentity(gs: GameState, playerId: string, getPlayer: (id: string) => Player | null | undefined): string | null;
  /** The C-key identity announcement ("you are the red squadron"); null = not handled. */
  identityAnnouncement(gs: GameState, myId: string, getPlayer: (id: string) => Player | null | undefined): FamilyIdentityAnnouncement | null;
  /** Build the family's board + animator (called lazily, once, when its state first arrives). */
  createView(deps: FamilyDeps): FamilyView;
}

function raceSeatIndex(gs: GameState, playerId: string): number {
  const seatId = gs.race?.seats.find(st => st.playerId === playerId)?.seatId;
  return gs.raceBoard?.seats.findIndex(st => st.id === seatId) ?? -1;
}

const raceFamily: GameFamily = {
  ...familyTraitsFor('race')!,

  boardIdentity(gs, playerId) {
	if (!gs.race || !gs.raceBoard) return null;
	const seatIndex = raceSeatIndex(gs, playerId);
	return seatIndex >= 0 ? seatDisplayName(gs.raceBoard, seatIndex, k => i18nBinder.tSync(k)) : null;
  },

  identityAnnouncement(gs, myId) {
	if (!gs.race || !gs.raceBoard) return null;
	const seatIndex = raceSeatIndex(gs, myId);
	if (seatIndex < 0) return null;
	const squadron = seatDisplayName(gs.raceBoard, seatIndex, k => i18nBinder.tSync(k));
	return { key: 'game.identity_race', vars: { squadron } };
  },

  createView(deps): RaceFamilyView {
	const raceBoard = new RaceBoard(deps.boardElement, {
	  getGameState: deps.getGameState,
	  getMyPlayerId: deps.getMyPlayerId,
	  announce: deps.announce,
	  tSync: deps.tSync,
	});
	const animator = new RaceTokenAnimator({
	  raceBoard: () => raceBoard,
	  gameState: deps.getGameState,
	  // Render the race board with animated positions
	  render: () => raceBoard.update(deps.getGameState() ?? (undefined as unknown as GameState)),
	  stepDelayMs: 200,
	  firstStepDelayMs: 1100, // wait for the dice sound to finish, like the property board
	  // Each visible hop plays the same "move token" earcon as the property board: for a
	  // blind player the tap-tap-tap IS the length of the move (overlap-safe at 200 ms).
	  onStep: deps.onStep,
	  onIdle: deps.onIdle,
	  motionDisabled: deps.motionDisabled,
	});
	// Wire the animator to the race board so it renders animated positions
	raceBoard.setDisplayPositionCallback((seatIndex, pieceIndex) =>
	  animator.displayPosition(seatIndex, pieceIndex)
	);
	return {
	  board: raceBoard,
	  raceBoard,
	  onStateUpdated: (gs) => {
		raceBoard.update(gs);
		// Animate pieces moving between squares, pacing announcements with motion
		animator.syncFromState();
	  },
	  isAnimating: () => animator.isAnimating,
	  // Several pieces per player: nothing to jump to (the panel hides the action anyway).
	  goToPlayer: () => true,
	  rulesSummary: () => {
		const gs = deps.getGameState();
		return buildRaceRulesLines(gs?.raceRules, gs?.raceBoard, gs?.race?.teamsMode ?? false,
		  deps.tSync);
	  },
	};
  },
};

const trackFamily: GameFamily = {
  ...familyTraitsFor('track')!,

  boardIdentity(_gs, playerId, getPlayer) {
	const token = getPlayer(playerId)?.token;
	return token ? i18nBinder.tSync(`tokens.${token}`) : null;
  },

  identityAnnouncement(_gs, myId, getPlayer) {
	const me = getPlayer(myId);
	if (!me) return null;
	const token = me.token ? i18nBinder.tSync(`tokens.${me.token}`) : '';
	const color = localizeColor(ENGINE_PALETTE_WORDS[me.color ?? ''] ?? '');
	return { key: color ? 'game.identity_track' : 'game.identity_track_plain', vars: { token, color } };
  },

  createView(deps): FamilyView {
	const trackBoard = new TrackBoard(deps.boardElement, {
	  getGameState: deps.getGameState,
	  getMyPlayerId: deps.getMyPlayerId,
	  announce: deps.announce,
	  tSync: deps.tSync,
	});
	const animator = new TrackTokenAnimator({
	  gameState: deps.getGameState,
	  render: () => {
		const gs = deps.getGameState();
		if (gs) trackBoard.update(gs);
	  },
	  stepDelayMs: 200,
	  firstStepDelayMs: 1100, // wait for the dice sound to finish, like the other families
	  // Each visible hop plays the "move token" earcon: the tap-tap-tap IS the length of
	  // the move for a blind player.
	  onStep: deps.onStep,
	  onIdle: deps.onIdle,
	  motionDisabled: deps.motionDisabled,
	});
	trackBoard.setDisplayPositionCallback(playerId => animator.displayPosition(playerId));
	return {
	  board: trackBoard,
	  onStateUpdated: (gs) => {
		trackBoard.update(gs);
		animator.syncFromState();
	  },
	  isAnimating: () => animator.isAnimating,
	  goToPlayer: (playerId) => {
		// The one piece per player lives in the track sub-state, not player.position.
		const square = deps.getGameState()?.track?.positions.find(pos => pos.playerId === playerId)?.square;
		if (square !== undefined) {
		  trackBoard.setActiveIndex(square, true);
		  deps.focusBoard();
		}
		return true;
	  },
	  rulesSummary: () => {
		const gs = deps.getGameState();
		return buildTrackRulesLines(gs?.trackRules, gs?.trackBoard, deps.tSync);
	  },
	};
  },
};

const triviaFamily: GameFamily = {
  ...familyTraitsFor('trivia')!,

  boardIdentity(gs, playerId, getPlayer) {
	// The players panel shows the token AND how many wedges they hold (strategic at a glance).
	const token = getPlayer(playerId)?.token;
	const name = token ? i18nBinder.tSync(`tokens.${token}`) : '';
	const count = gs.trivia?.players.find(p => p.playerId === playerId)?.wedges.length ?? 0;
	const wedges = i18nBinder.tSync('game.trivia_wedges_count', { count });
	return name ? `${name}. ${wedges}` : wedges;
  },

  identityAnnouncement(_gs, myId, getPlayer) {
	const me = getPlayer(myId);
	if (!me) return null;
	const token = me.token ? i18nBinder.tSync(`tokens.${me.token}`) : '';
	const color = localizeColor(ENGINE_PALETTE_WORDS[me.color ?? ''] ?? '');
	return { key: color ? 'game.identity_trivia' : 'game.identity_trivia_plain', vars: { token, color } };
  },

  createView(deps): TriviaFamilyView {
	const triviaBoard = new TriviaBoard(deps.boardElement, {
	  getGameState: deps.getGameState,
	  getMyPlayerId: deps.getMyPlayerId,
	  announce: deps.announce,
	  tSync: deps.tSync,
	});
	const animator = new TriviaTokenAnimator({
	  gameState: deps.getGameState,
	  render: () => { const gs = deps.getGameState(); if (gs) triviaBoard.update(gs); },
	  stepDelayMs: 220,
	  firstStepDelayMs: 400, // a brief beat after the destination is chosen, then the walk begins
	  // Each visible hop plays the "move token" earcon: the tap-tap-tap IS the move's length for
	  // a blind player, and the consequence ("you land on…") is held until the walk settles.
	  onStep: deps.onStep,
	  onIdle: deps.onIdle,
	  motionDisabled: deps.motionDisabled,
	});
	triviaBoard.setDisplayPositionCallback(playerId => animator.displayPosition(playerId));
	return {
	  board: triviaBoard,
	  triviaBoard,
	  onStateUpdated: (gs) => {
		triviaBoard.update(gs);
		animator.syncFromState(); // walk any piece whose node changed (else settle immediately)
	  },
	  isAnimating: () => animator.isAnimating,
	  goToPlayer: (playerId) => {
		const node = deps.getGameState()?.trivia?.players.find(p => p.playerId === playerId)?.node;
		if (node) { triviaBoard.focusNode(node); deps.focusBoard(); }
		return true;
	  },
	  rulesSummary: () => buildTriviaRulesLines(deps.getGameState()?.triviaRules, deps.tSync),
	};
  },
};

/** The shared shape of a card family's board: repaint, animation state and focus. No
 *  spatial navigation — the hand list owns its own cursor. */
interface CardFamilyBoard {
  update(gs: GameState): void;
  isAnimating(): boolean;
  focusHand(): void;
  /** This board's shortcuts for the help dialog: its live hand keys + the status keys
   *  (cardBoardHelpShortcuts). The keys are declared where they are routed, never here. */
  helpShortcuts(): HelpShortcut[];
  /** The active game rules as readable lines, for the rules dialog (Ctrl+Shift+F1); null
   *  when the family lists none. Optional — only families with tunable rules implement it. */
  rulesSummary?(): string[] | null;
}

/**
 * The shared CHASSIS for card families (journey, assembly, draft, shedding). They all
 * wire the SAME scaffolding: the status line IS the identity (players panel + S/Shift+S),
 * D reads shared piles, and the view is a hand-only surface behind an inert spatial navigator (every
 * "go home" lands on the hand). Only three things differ — the gameType, the status text
 * and how the board is built (its class + command wiring) — so those are the parameters
 * and the rest lives here once. Factors out the copy-pasted wiring WITHOUT touching any
 * family's rules, voice or wire contract.
 */
function makeCardFamily(
  gameType: string,
  statusText: (gs: GameState, playerId: string, t: (k: string, v?: Record<string, unknown>) => string) => string | null,
  createBoard: (deps: FamilyDeps) => CardFamilyBoard,
): GameFamily {
  const status = (gs: GameState, playerId: string) =>
	statusText(gs, playerId, (k, v) => i18nBinder.tSync(k, v));
  return {
	...familyTraitsFor(gameType)!,
	boardIdentity: (gs, playerId) => status(gs, playerId),
	identityAnnouncement(gs, myId) {
	  // '_raw' is the announcer's literal-text channel (the status is already translated).
	  const text = status(gs, myId);
	  return text ? { key: '_raw', vars: { text } } : null;
	},
	createView(deps): FamilyView {
	  const board = createBoard(deps);
	  const focusHand = () => { board.focusHand(); return true; };
	  return {
		board: {
		  moveLeft: () => false, moveRight: () => false, moveUp: () => false, moveDown: () => false,
		  goToMe: focusHand,
		  goToStart: focusHand,
		  goToMyStart: focusHand,
		  getActiveIndex: () => -1,
		  setActiveIndex: () => false,
		} as unknown as BoardNavigator,
		onStateUpdated: gs => board.update(gs),
		isAnimating: () => board.isAnimating(),
		goToPlayer: () => true, // nothing spatial to jump to (the surface is a hand)
		onBoardFocus: focusHand,
		helpShortcuts: () => board.helpShortcuts(),
		rulesSummary: () => board.rulesSummary?.() ?? null,
	  };
	},
  };
}

// The dashboards are the identity (km, battle state, immunities, score). No hop earcon:
// each distance card carries its own per-value sound, which already IS the move's audio.
const journeyFamily = makeCardFamily('journey', journeyStatusText, deps =>
  new JourneyBoard(deps.boardElement, {
	getGameState: deps.getGameState,
	getMyPlayerId: deps.getMyPlayerId,
	announce: deps.announce,
	tSync: deps.tSync,
	onIdle: deps.onIdle,
	motionDisabled: deps.motionDisabled,
	commands: {
	  draw: () => { void gameManager.journeyDraw(); },
	  play: (instanceId, targetId) => { void gameManager.journeyPlay(instanceId, targetId ?? null); },
	  discard: (instanceId) => { void gameManager.journeyDiscard(instanceId); },
	  coup: (accept) => { void gameManager.journeyCoup(accept); },
	},
  }));

// The rack IS the identity: operational progress, each slot's piece + state, hand size.
const assemblyFamily = makeCardFamily('assembly', assemblyStatusText, deps =>
  new AssemblyBoard(deps.boardElement, {
	getGameState: deps.getGameState,
	getMyPlayerId: deps.getMyPlayerId,
	announce: deps.announce,
	tSync: deps.tSync,
	onIdle: deps.onIdle,
	motionDisabled: deps.motionDisabled,
	commands: {
	  play: (instanceId, targeting) => { void gameManager.assemblyPlay(instanceId, targeting ?? {}); },
	  discard: (instanceIds) => { void gameManager.assemblyDiscard(instanceIds); },
	},
  }));

// The scoreboard IS the identity: round, points, the table's contents, the dessert stash.
const draftFamily = makeCardFamily('draft', draftStatusText, deps =>
  new DraftBoard(deps.boardElement, {
	getGameState: deps.getGameState,
	getMyPlayerId: deps.getMyPlayerId,
	announce: deps.announce,
	tSync: deps.tSync,
	onIdle: deps.onIdle,
	motionDisabled: deps.motionDisabled,
	commands: {
	  pick: (instanceId, secondInstanceId) => {
		void gameManager.draftPick(instanceId, secondInstanceId ?? null);
	  },
	},
  }));

// The status IS the identity: hand size, the colour in force and the top card, the
// reversed direction when it applies, and the match score.
const sheddingFamily = makeCardFamily('shedding', sheddingStatusText, deps =>
  new SheddingBoard(deps.boardElement, {
	getGameState: deps.getGameState,
	getMyPlayerId: deps.getMyPlayerId,
	announce: deps.announce,
	tSync: deps.tSync,
	onIdle: deps.onIdle,
	motionDisabled: deps.motionDisabled,
	commands: {
	  play: (instanceId, chosenColor, extraInstanceIds) => {
		void gameManager.sheddingPlay(instanceId, chosenColor ?? null, extraInstanceIds ?? null);
	  },
	  draw: () => { void gameManager.sheddingDraw(); },
	  keep: () => { void gameManager.sheddingKeep(); },
	  declareLastCard: () => { void gameManager.sheddingDeclareLastCard(); },
	  catchLastCard: () => { void gameManager.sheddingCatchLastCard(); },
	},
  }));

// The status IS the identity: how many cards each player is holding (or "eliminated"). The
// deck count and the discard top are the on-demand D readout instead.
const explodingFamily = makeCardFamily('exploding', explodingStatusText, deps =>
  new ExplodingBoard(deps.boardElement, {
	getGameState: deps.getGameState,
	getMyPlayerId: deps.getMyPlayerId,
	announce: deps.announce,
	tSync: deps.tSync,
	onIdle: deps.onIdle,
	motionDisabled: deps.motionDisabled,
	commands: {
	  play: (instanceId, targetId, secondInstanceId) => {
		void gameManager.explodingPlay(instanceId, targetId, secondInstanceId);
	  },
	  draw: () => { void gameManager.explodingDraw(); },
	  nope: (instanceId) => { void gameManager.explodingNope(instanceId); },
	  defuse: (depth) => { void gameManager.explodingDefuse(depth); },
	  give: (instanceId) => { void gameManager.explodingGive(instanceId); },
	},
  }));

const FAMILIES: readonly GameFamily[] = [
	raceFamily, trackFamily, triviaFamily, journeyFamily, assemblyFamily, draftFamily, sheddingFamily,
	explodingFamily,
];

/** The registered family for a state's gameType — null for property/unknown (default surfaces). */
export function familyFor(gameType: string | null | undefined): GameFamily | null {
  return FAMILIES.find(f => f.gameType === gameType) ?? null;
}
