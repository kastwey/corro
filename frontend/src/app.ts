// app.ts — frontend (server mode only)

import { createAnnouncer } from './announcer.js';
import type { AnnounceFn } from './announcer.js';
import {
  announceHistoryPrev,
  announceHistoryNext,
  announceHistoryFirst,
  announceHistoryLast,
} from './announcer.js';
import { attachKeyHandlers, PROPERTY_ONLY_COMMANDS, CARD_FAMILY_HIDDEN_COMMANDS } from './keys.js';
import { buildGroupKeyMap } from './groupKeys.js';
import { Board } from './board.js';
import { TokenAnimator } from './tokenAnimator.js';
import { makeSettleGuard } from './settleGuard.js';
import { holdingTeleports } from './holdingMovement.js';
import { isTokenMotionDisabled } from './motion.js';
import { AnnouncementGate } from './announcementGate.js';
import { GameCommands, ownsWholeColorGroup } from './gameCommands.js';
import { i18nBinder, tSync, localizeColor, money } from './i18nBinder.js';
import { soundManager, playSound } from './sound.js';
import { soundEvents } from './soundEvents.js';
import { boardToast } from './boardToast.js';
import { visualNarrative } from './visualNarrative.js';
import { dialogManager } from './dialogManager.js';
import { showHelpDialog } from './helpDialog.js';
import { showGameRulesDialog } from './gameRulesDialog.js';
import { buildPropertyRulesLines } from './rulesSummaries.js';
import { loadBoardHelp, showBoardHelpDialog, initHelpButton } from './boardHelp.js';
import { showEndScreen } from './endScreen.js';
import { turnIndicator } from './turnIndicator.js';
import { cardReveal } from './cardReveal.js';
import { squareGroupLabel } from './localizeSquare.js';
import { boardPageTitle } from './boardTitle.js';
import { initializeSiteBranding } from './siteBranding.js';
import { updateGameSurfaceIntro } from './gameSurfaceIntro.js';
import { setPackageTokens } from './tokenIcons.js';
import { setBoardVocabulary } from './boardVocabulary.js';
import { cardFlight } from './cardFlight.js';
import { auctionDialog } from './auctionDialog.js';
import { tradeDialog } from './tradeDialog.js';
import { nextAuctionWarning } from './auctionCountdown.js';
import { diceControl } from './diceControl.js';
import { playerPanel } from './playerPanel.js';
import { connectionPanel } from './connectionPanel.js';
import { initThemeToggle } from './themeToggle.js';
import { initSoundToggle, type SoundToggleController } from './soundToggle.js';
import { groupStatusMessage } from './groupStatus.js';
import { desiredModal } from './modalReconcile.js';
import type {
  AuctionModalData,
  TradeReviewModalData,
  TradeWaitingModalData,
} from './modalReconcile.js';
import type { GameState, CardDrawnNotification } from './models.js';
import type { AnnouncementEvent } from './gameClient.js';
import { gameManager } from './gameManager.js';
import { gameClient } from './gameClient.js';
import { chatPanel } from './chatPanel.js';
import { voicePanel } from './voicePanel.js';
import { loadLiveKitClient } from './liveKitLoader.js';
import { GameSessionStore } from './sessionUtils.js';
import { actionBar } from './actions/actionBar.js';
import { computeAvailableActions, deriveActionContext, rollForfeitGuard, endTurnForfeitGuard } from './actions/availableActions.js';
import type { ActionContext, ActionId } from './actions/availableActions.js';
import { decideBuyConfirm } from './actions/buyConfirm.js';
import { getTokenName } from './lobby/tokens.js';
import { panelNavigator } from './panelNavigator.js';
import { managePropertiesDialog, buildManageableProperties as projectManageableProperties } from './managePropertiesDialog.js';
import type { ManageablePropertyItem } from './managePropertiesDialog.js';
import { playerDetailDialog, projectPlayerProperties } from './playerDetailDialog.js';
import { propertyInfoDialog, projectPropertyInfo } from './propertyInfoDialog.js';
import { squareMenuActions } from './squareMenu.js';
import type { SquareMenuAction } from './squareMenu.js';
import { popupMenu } from './popupMenu.js';
import type { PopupMenuItem } from './popupMenu.js';
import { FocusTrap } from './focusTrap.js';
import { copyToClipboard } from './lobby/ui.js';
import type { RaceBoard } from './raceBoard.js';
import { familyFor, type FamilyDeps, type FamilyView, type RaceFamilyView, type TriviaFamilyView } from './gameFamilies.js';
import { triviaNodeLabel, triviaPositionSuffix } from './triviaBoard.js';
import { familyHasTrades, isToolbarlessFamily } from './familyTraits.js';
import { describeMoveOption, describePieceOrigin, seatDisplayName, type RaceCursor } from './raceGeometry.js';
import type { BoardNavigator } from './keys.js';
import type { PendingRaceMove, TriviaPendingQuestion } from './models.js';

const GRID_SIZE = 11;

// Helper for game translations (prefix 'game.')
const t = (key: string, vars?: Record<string, any>): string => tSync(`game.${key}`, vars);

// Helper to create AnnouncementEvent
const createAnnouncement = (key: string, vars: Record<string, any> = {}): AnnouncementEvent =>
	({ key, vars });

/** Human label (including the price/value) for a board-square contextual action. */
const squareActionLabel = (a: SquareMenuAction): string => {
	switch (a.id) {
		case 'build': return a.big
			? t('square_menu_build_hotel', { price: a.amount })
			: t('square_menu_build_house', { price: a.amount });
		case 'sellHotel': return t('square_menu_sell_hotel', { value: a.amount });
		case 'sellHouse': return t('square_menu_sell_house', { value: a.amount });
		case 'mortgage': return t('square_menu_mortgage', { value: a.amount });
		case 'unmortgage': return t('square_menu_unmortgage', { value: a.amount });
		case 'buy': return t('square_menu_buy', { price: a.amount });
	}
};

let gameBoard: Board;
let globalAnnounce: AnnounceFn;

// Paces the reveal of an action's landing consequences (rent, tax, cards…) to the visible
// token hop: assigned once the announcer + sound + toast funnel exists (see below).
let announcementGate: AnnouncementGate | undefined;

// Plays the "move token" earcon as a travelling token lands on each square. Wired to the
// real sound once audio is initialised (see initBoard); a no-op until then.
let playTokenHopSound: () => void = () => {};

// Walks tokens square by square toward their authoritative position so long moves and
// card teleports are visible rather than a jump.
const tokenAnimator = new TokenAnimator({
  boardSize: () => gameManager.getSquares().length,
  render: () => renderPlayers(),
  // ~350 ms per square: slow enough to read as a deliberate, human-paced move rather than
  // an instant jump (feedback: "nobody would move it that fast").
  stepDelayMs: 350,
  // Hold the first hop back ~1.1 s so it starts after the dice-roll earcon has finished;
  // otherwise the first tap overlaps the dice sound and is hard to hear.
  firstStepDelayMs: 1100,
  // Each visible hop plays the "move token" earcon, so the token sounds like it is being
  // walked square by square rather than teleporting silently.
  onStep: () => playTokenHopSound(),
  // When the hop finishes, release any consequence announcements held back during it, then
	// advance the turn sequencer so the next segment of a compound card move plays only
	// after this landing's consequences were spoken.
  onIdle: () => {
	announcementGate?.settle();
	gameManager.notifyAnimationSettled();
  },
  // Honour the player's (or OS's) reduced-motion preference: when motion is off, every move
  // snaps to its square and the gated consequences are released immediately (no hop to wait
  // for), so the action bar and money update at once instead of pacing to an animation.
  motionDisabled: () => isTokenMotionDisabled(),
});

// Tracks who was in holding on the previous state, so we can spot the exact moment a player is
// sent there and (unless the board opted into walking) place the token in holding with no slide.
const wasHeld = new Map<string, boolean>();

// Family boards + animators from the gameFamilies registry, built lazily when their state
// first arrives (board.html is shared) and memoized. Module-scoped so the board container's
// focus listener (below, outside initBoard) can ask the active family first.
const familyViews = new Map<string, FamilyView>();
/** The already-built view of the current game's family (never creates one). */
const currentFamilyView = (): FamilyView | null => {
  const gameType = gameManager.getCurrentGameState()?.gameType;
  return gameType ? familyViews.get(gameType) ?? null : null;
};
/** True while any family's piece animation is walking the board. */
const familyAnimating = (): boolean => [...familyViews.values()].some(v => v.isAnimating());
/**
 * True while THIS client is still telling the current action: a token or family piece is
 * walking the board. The turn sequencer holds a compound move's later segments exactly
 * while this is true (it only waits on animation), so "no animation" means the story has
 * fully caught up with the authoritative state. Turn-flow actions (roll, buy, end turn,
 * holding exits) wait for this to clear — both in the action bar (movementSettling) and at
 * their direct entry points (the settle guard on shortcuts and the dice button).
 */
const presentationSettling = (): boolean => tokenAnimator.isAnimating || familyAnimating();

const board = document.getElementById('board') as HTMLElement;
if (!board) throw new Error('#board not found in DOM');
const gameSurfaceIntro = document.getElementById('game-surface-intro') as HTMLElement;
if (!gameSurfaceIntro) throw new Error('#game-surface-intro not found in DOM');

board.style.display = 'grid';
board.style.gridTemplateColumns = `repeat(${GRID_SIZE}, var(--square-size))`;
board.style.gridAutoRows = 'var(--square-size)';

async function initBoard() {
  // Initialize DialogManager
  dialogManager.init();

  // Initialize CardReveal overlay
  cardReveal.init();

  // Initialize the accessible auction modal
  auctionDialog.init();

  // Initialize TurnIndicator
  turnIndicator.init();

	// The deployment owns the shell identity around every game; Corro attribution remains in the
	// footer. Load it before the rest of startup so the heading and browser title agree immediately.
	const siteBranding = await initializeSiteBranding();

  // i18n must be ready BEFORE any dialog/announcement below, otherwise the
  // session-validation dialogs render raw translation keys (e.g. a screen reader
  // reads "session.invalidTitle" instead of the translated text).
  // Respect the language the player picked in the lobby (persisted in a cookie and
  // detected by init()); then apply it to the static board markup. Mirrors the lobby's
  // own init — do NOT force a language here, or the lobby choice is silently overridden.
  await i18nBinder.init();
  await i18nBinder.applyI18n();

  // Get gameId from URL
  const urlParams = new URLSearchParams(window.location.search);
  const gameId = urlParams.get('gameId');

  if (!gameId) {
	console.error('gameId not found in URL');
	globalAnnounce?.(createAnnouncement('game.game_id_not_found', {}));
	return;
  }

  // Verify player session for this specific game.
  const playerSession = GameSessionStore.getGame(gameId);
  if (!playerSession) {
	console.error('No valid player session');
	dialogManager.init();
	dialogManager.showInfo({
	  title: 'Session Error',
	  titleI18nKey: 'session.invalidTitle',
	  message: 'No valid session found.',
	  messageI18nKey: 'session.noSession',
	  onClose: () => { window.location.href = '/'; }
	});
	return;
  }

  // === Visual controls: dice button, theme toggle, sound toggle, players panel ===
  // Load the persisted sound preference up front so the toggle button paints the
  // correct initial state.
  soundEvents.init();
  // Single source of truth for muting: both the header button and the keyboard
  // shortcut call this, so the visual state and the spoken announcement stay in sync.
  let soundToggleController: SoundToggleController | null = null;
  // Audio is "blocked" until the AudioContext is actually running. Browsers like
  // iOS/Safari refuse to start it until a DIRECT user interaction, so before then the
  // toggle shows a "tap to enable" hint instead of a plain on/off state.
  const audioBlocked = () => soundManager.isSupported() && !soundManager.isUnlocked();
  const refreshSoundToggle = () => soundToggleController?.sync(soundEvents.isMuted(), audioBlocked());
  function toggleSound(): void {
	// If the browser is still blocking audio (and the player hasn't muted on purpose),
	// THIS click is the direct gesture browsers require: unlock synchronously and load
	// the sounds, without flipping the mute preference. The AudioContext state-change
	// listener repaints the button to "on" once it actually starts running.
	if (audioBlocked() && !soundEvents.isMuted()) {
	  soundManager.unlock();
	  void initSoundOnFirstInteraction();
	  userInteractionDetected = true;
	  globalAnnounce(createAnnouncement('game.sound_unmuted', {}), { instant: true });
	  refreshSoundToggle();
	  return;
	}
	const muted = soundEvents.toggleMute();
	soundToggleController?.sync(muted, audioBlocked());
	// Speak the new state instantly (assertive) so the player gets immediate
	// feedback even mid-utterance.
	globalAnnounce(createAnnouncement(muted ? 'game.sound_muted' : 'game.sound_unmuted', {}), { instant: true });
  }
  // Turn-flow commands wait for the story to catch up: while this client is still playing
  // out the current action (token walking, queued segments), acting on the NEXT thing —
  // buying a square you haven't heard yourself land on — would run ahead of the narration.
  // The action bar already withholds these (movementSettling); the guard covers their
  // direct entry points (keyboard shortcuts, the dice button, action-bar activation) with
  // a spoken reason instead of a silent no-op. Ambient management commands (manage
  // properties, trades) are deliberately not guarded — they are not consequences of the
  // move being told.
  const guardSettled = makeSettleGuard(
	presentationSettling,
	() => globalAnnounce(createAnnouncement('game.actions.wait_settling', {}), { instant: true }),
  );
  // Standing on a buyable property you haven't bought? The turn-ADVANCING key forfeits it (auction or
  // plain discard, per the house rule) — players do it by mistake and lose the property, so confirm
  // first. The dialog opens focused on Cancel, so an accidental keypress never forfeits.
  const confirmForfeitBuyable = (onConfirm: () => void) => {
	const gs = gameManager.getCurrentGameState();
	const pp = gs?.pendingPurchase ?? null;
	if (!pp) { onConfirm(); return; }
	const auctions = !!gs?.settings?.auctionOnDecline;
	dialogManager.showConfirm({
	  title: tSync('game.actions.confirm_pass_title'),
	  titleI18nKey: 'game.actions.confirm_pass_title',
	  message: tSync(auctions ? 'game.actions.confirm_pass_auction' : 'game.actions.confirm_pass_discard',
		{ property: pp.squareName }),
	  confirmI18nKey: 'game.actions.confirm_pass_yes',
	  onConfirm,
	});
  };

  const rollDiceSettled = guardSettled(() => {
	const myId = gameManager.getMyPlayerId();
	if (!myId) return;
	const gs = gameManager.getCurrentGameState();
	const pp = gs?.pendingPurchase ?? null;
	const mine = !!pp && pp.playerId === myId;
	// A doubles re-roll while standing on a property I haven't bought forfeits it — in the doubles
	// case ROLLING AGAIN (Space) is what advances the turn, so the confirm lives here, not on Enter.
	if (rollForfeitGuard(mine, !!gs?.mustRollAgain) === 'confirm') {
	  confirmForfeitBuyable(() => gameManager.rollDice());
	  return;
	}
	gameManager.rollDice();
  });
  const endTurnSettled = guardSettled(() => {
	const myId = gameManager.getMyPlayerId();
	if (!myId) return;
	const gs = gameManager.getCurrentGameState();
	const pp = gs?.pendingPurchase ?? null;
	const mine = !!pp && pp.playerId === myId;
	const guard = endTurnForfeitGuard(mine, !!gs?.mustRollAgain);
	// A doubles re-roll is owed: Enter can't end the turn — the buy is forfeited by rolling again
	// (Space), which carries the confirm. Speak the same reason the disabled "End turn" action gives.
	if (guard === 'blocked') {
	  globalAnnounce(createAnnouncement('game.actions.cannot_end_must_roll', {}), { instant: true });
	  return;
	}
	// The turn really will end and I'm standing on a buyable property: confirm so an accidental
	// Enter never forfeits it.
	if (guard === 'confirm') {
	  confirmForfeitBuyable(() => gameManager.endTurn(myId));
	  return;
	}
	gameManager.endTurn(myId);
  });
  const buyPropertySettled = guardSettled(() => openBuyConfirm());
  const payReleaseCostSettled = guardSettled(() => gameManager.payReleaseCost());
  const useReleasePassSettled = guardSettled(() => gameManager.useReleasePass());

  const appControls = document.getElementById('app-controls');
  if (appControls) {
	diceControl.init(appControls, {
	  onRoll: rollDiceSettled,
	  onUnavailable: reason => globalAnnounce(createAnnouncement('_raw', { text: reason }), { instant: true }),
	});
	initHelpButton(appControls); // opens the board guide (F1 / click); shortcuts live on Ctrl+F1
	initThemeToggle(appControls);
	soundToggleController = initSoundToggle(appControls, {
	  initialMuted: soundEvents.isMuted(),
	  initialBlocked: audioBlocked(),
	  onToggle: () => toggleSound(),
	});
	// Keep the "blocked" hint accurate: when the context finally unlocks after a tap (or
	// gets suspended in a background tab), repaint the toggle accordingly.
	soundManager.setOnStateChange(() => refreshSoundToggle());
  }
  const panelMount = document.getElementById('players-panel-mount');
  if (panelMount) {
	playerPanel.init(panelMount, {
	  getPlayers: () => gameManager.getAllPlayers(),
	  getSquares: () => gameManager.getSquares(),
	  getCurrentTurnId: () => gameManager.getCurrentGameState()?.currentTurn ?? null,
	  getMyId: () => gameManager.getMyPlayerId(),
	  getTotalDebt: (pid) => gameManager.getTotalDebt(pid),
	// Non-property families replace the money line with the player's board identity:
	// the race squadron (from the seat's package i18n key) or the track piece name.
	getBoardIdentity: (playerId) => {
	  const gs = gameManager.getCurrentGameState();
	  const family = gs && familyFor(gs.gameType);
	  return gs && family ? family.boardIdentity(gs, playerId, id => gameManager.getPlayer(id)) : null;
	},
	  isMyTurn,
	  // A family may hide the row's action (a race player has several pieces: no single
	  // square to jump to — N / M cycle the pieces). Property and track keep it.
	  showGoToPlayer: () => familyFor(gameManager.getCurrentGameState()?.gameType)?.showGoToPlayer ?? true,
	  // Trading is the property family's economy: everyone else hides the action.
	  showTrade: () => familyHasTrades(gameManager.getCurrentGameState()?.gameType),
	  onShowInfo: (pid) => openPlayerDetail(pid),
	  onProposeTrade: (pid) => openTradeBuilder(pid),
	  onGoToPlayer: (pid) => {
		const gs = gameManager.getCurrentGameState();
		if (ensureFamilyView(gs?.gameType)?.goToPlayer(pid)) return;
		const player = gameManager.getPlayer(pid);
		if (player) { gameBoard.setActiveIndex(player.position, true); board.focus(); }
	  },
	});
  }

  const connectionMount = document.getElementById('connection-panel-mount');
  if (connectionMount) {
	connectionPanel.init(connectionMount, {
	  onLeaveGame: confirmLeaveGame,
	  // Disconnecting drops the connection AND returns to the lobby, rather than leaving the
	  // player staring at a frozen board with no way out (live-play report).
	  onDisconnect: () => { void gameManager.disconnect().then(() => { window.location.href = '/'; }); },
	  // The re-entry code is the player's only recovery key: copying it announces the
	  // outcome so a screen-reader user knows it is safe in the clipboard.
	  onCopyRejoinCode: (code) => {
		void copyToClipboard(code).then(ok => {
		  announce(createAnnouncement(ok ? 'game.rejoin_code_copied' : 'game.rejoin_code_copy_failed', {}), { instant: true });
		});
	  },
	});
  }

  // announcer - define early for initialization messages
  const announce = createAnnouncer();
  globalAnnounce = announce;
	auctionDialog.setUnavailableAnnouncer(text =>
		announce(createAnnouncement('_raw', { text }), { instant: true }));

	// Voice is an optional deployment capability. The public probe contains one boolean only;
	// the authenticated token call returns the relay URL just in time for an explicit join.
	if (appControls) {
		voicePanel.init(appControls, {
			t: (key, vars) => tSync(key, vars),
			gameId,
			getMyPlayerId: () => playerSession.playerId,
			isHost: () => playerSession.isHost,
			requestToken: () => gameClient.requestVoiceToken(),
			setEnabled: enabled => gameClient.setVoiceChatEnabled(enabled),
			muteParticipant: playerId => gameClient.muteVoiceParticipant(playerId),
			announce: (key, vars = {}, instant = false) =>
				announce(createAnnouncement(key, vars), { instant }),
			onPresenceChanged: participants => playerPanel.setVoiceParticipants(participants),
			beforeOpen: () => { if (chatPanel.isOpen()) chatPanel.closePanel(); },
		});
		try {
			const response = await fetch('/api/config/voice');
			const config = response.ok ? await response.json() as { available?: boolean } : null;
			const available = !!config?.available && await loadLiveKitClient();
			voicePanel.setDeploymentAvailable(available);
		} catch {
			voicePanel.setDeploymentAvailable(false);
		}
	}

  announce(createAnnouncement('game.loading_board', {}));

  // board
  gameBoard = new Board(board, GRID_SIZE, () => gameManager.getAllPlayers(), () => gameManager.getSquares(), gameManager);

  // Narrate cursor movement through the page announcer. Navigation is user-initiated,
  // so it speaks instantly (assertive), interrupting any in-progress utterance.
  gameBoard.setAnnouncer((text: string, instant = true) => announce(createAnnouncement('_raw', { text }), { instant }));

  // ── Active-board facade ─────────────────────────────────────────────────────
  // The keyboard layer drives ONE navigation surface; which board answers depends on the
  // game family (the property perimeter, or the race circuit/zones). The facade delegates
  // to whichever is active, so keys.ts stays family-agnostic.
  const familyDeps: FamilyDeps = {
	boardElement: board,
	getGameState: () => gameManager.getCurrentGameState(),
	getMyPlayerId: () => gameManager.getMyPlayerId(),
	announce: (text: string) => announce(createAnnouncement('_raw', { text }), { instant: true }),
	tSync: (key, vars) => i18nBinder.tSync(key, vars),
	onStep: () => playTokenHopSound(),
	onIdle: () => {
	  // Release pending announcements once animation finishes
	  announcementGate?.settle();
	  gameManager.notifyAnimationSettled();
	},
	motionDisabled: () => isTokenMotionDisabled(),
	focusBoard: () => board.focus(),
  };
  function ensureFamilyView(gameType: string | undefined): FamilyView | null {
	const family = familyFor(gameType);
	if (!family) return null; // property: the default surfaces handle it
	let view = familyViews.get(family.gameType);
	if (!view) {
	  view = family.createView(familyDeps);
	  familyViews.set(family.gameType, view);
	}
	return view;
  }
  const activeBoard = (): BoardNavigator => currentFamilyView()?.board ?? gameBoard;
  const boardNav: BoardNavigator = {
	moveLeft: () => activeBoard().moveLeft(),
	moveRight: () => activeBoard().moveRight(),
	moveUp: () => activeBoard().moveUp(),
	moveDown: () => activeBoard().moveDown(),
	goToMe: (forward?: boolean) => activeBoard().goToMe(forward),
	// Race only (N / Shift+N cycle every piece on the board); the property board doesn't
	// implement them and the executor's optional call falls back to false there.
	goToNextPiece: () => activeBoard().goToNextPiece?.() ?? false,
	goToPrevPiece: () => activeBoard().goToPrevPiece?.() ?? false,
	goToStart: () => activeBoard().goToStart(),
	goToMyStart: (forward?: boolean) => activeBoard().goToMyStart(forward),
	goToBarrier: (forward?: boolean) => activeBoard().goToBarrier?.(forward) ?? false,
	getActiveIndex: () => activeBoard().getActiveIndex(),
	setActiveIndex: (i, trigger, announceMove) => activeBoard().setActiveIndex(i, trigger, announceMove),
  };

  /** The race board, for the move-options UI (highlights, click-to-select, focus→ring). */
  function ensureRaceBoard(): RaceBoard {
	return (ensureFamilyView('race') as RaceFamilyView).raceBoard;
  }

  // aria-labels builder — now uses gameManager for players
  const labelBuilder = (i: number) => {
	const s = gameBoard.getSquare(i);
	const labelParts: string[] = [s.name || `${t('square')} ${i + 1}`];
	// Purchase price (ownable squares) vs the tax to pay (non-ownable tax squares) are distinct
	// fields, so a tax is never announced as a price.
	if (s.price) labelParts.push(`${t('price')}: ${money(s.price)}`);
	else if (s.amount) labelParts.push(`${t('tax')}: ${money(s.amount)}`);
	// Prefer the group's name ("Bro System") for screen readers; else a real colour word; a raw
	// hex value (e.g. "#8a5a2b") is meaningless read aloud, so it is skipped entirely.
	// Pass the raw full-key translator (NOT the game.-prefixing `t`): the group name key is already
	// a full key (e.g. "groups.g1"); squareGroupLabel prefixes its own fixed labels.
	const groupLabel = squareGroupLabel(s, tSync, localizeColor);
	if (groupLabel) labelParts.push(groupLabel);
	if (s.ownerId) {
	  const myId = gameManager.getMyPlayerId();
	  if (s.ownerId === myId) {
		// This is my property. Owning the WHOLE colour group is what unlocks building
		// houses and doubles the bare rent, so surface it distinctly from owning a
		// single square in the group.
		if (ownsWholeColorGroup(gameManager.getSquares(), s.color, myId)) {
		  labelParts.push(t('you_own_whole_group'));
		} else {
		  labelParts.push(t('you_own_property'));
		}
	  } else {
		// Property belongs to another player
		const owner = gameManager.getAllPlayers().find(p => p.id === s.ownerId);
		const ownerName = owner ? owner.name : String(s.ownerId);
		labelParts.push(t('property_of', { owner: ownerName }));
	  }
	  // Buildings and mortgage state (so screen-reader users hear them too).
	  const hotels = s.bigBuildings ?? 0;
	  const houses = s.smallBuildings ?? 0;
	  if (hotels > 0) labelParts.push(t('hotel_label'));
	  else if (houses > 0) labelParts.push(t('houses_count', { count: houses }));
	  if (s.mortgaged) labelParts.push(t('mortgaged_label'));
	}
	let label = labelParts.join('. ') + `. ${t('square')} ${i + 1}.`;
	if (s.key === 'free_parking') {
	  // Surface the accumulated Free Parking pot right on the corner square so a
	  // screen-reader user hears it while arrow-navigating (it is otherwise only shown
	  // in the board centre). Stays silent when empty / the house rule is off (pot 0).
	  const pot = gameManager.getFreeParkingPot();
	  if (pot > 0) label += ` ${t('free_parking_pot_label', { amount: i18nBinder.formatNumber(pot) })}`;
	}
	const playersHere = tokenAnimator.visiblePlayers(gameManager.getAllPlayers()).filter(p => p.position === i);
	if (playersHere.length > 0) {
	  const playersList = playersHere.map(p => p.name).join(', ');
	  label += ` ${t('players_label')}: ${playersList}.`;
	}
	return label;
  };

  // We don't render immediately - we wait for server data
  // Initial render happens in the gameStateUpdated handler

  // sound (same logic)
  let soundEnabled = false;
  let soundInitialized = false;
  let userInteractionDetected = false;

  const initSoundOnFirstInteraction = async () => {
	if (soundInitialized) return;
	soundInitialized = true;
	try {
	  if (!soundManager.isSupported()) {
		console.debug('[sound] initSound: Web Audio API not supported');
		return;
	  }
	  console.debug('[sound] initSound: loading finger sound…');
	  const loaded = await soundManager.loadSound('finger', 'assets/sounds/finger.ogg');
	  if (loaded) {
		soundEnabled = true;
		// The travelling-token hop: a package MAY ship a themed `token.hop` cue (a car "vroom",
		// a die tap…); when it doesn't, we fall back to the client's built-in navigation
		// "finger" earcon so the hop is never silent. Honour the game-sound mute toggle and the
		// chosen volume, softened a touch since a hop fires repeatedly across a multi-square move.
		playTokenHopSound = () => {
		  if (!soundEnabled || soundEvents.isMuted()) return;
		  if (soundEvents.hasEvent('token.hop')) {
			soundEvents.playEventOverlap('token.hop', 0.5);
			return;
		  }
		  // overlap: each hop is fire-and-forget so consecutive taps don't cut each other
		  // off (otherwise a fast multi-square move blurs into fewer audible hops).
		  playSound('finger', { volume: soundEvents.getVolume() * 0.5, overlap: true }).catch(() => {});
		};
	  }
	  console.debug('[sound] initSound: finger loaded =', loaded, '| AudioContext =', soundManager.getAudioContextState());
	  // Preload the game-event earcon pack from the server (decoding needs an
	  // AudioContext, which browsers only unlock after this first gesture).
	  console.debug('[sound] initSound: preloading earcon pack…');
	  // In a package game, preload that game's bundled sounds (its token is the pack id);
	  // otherwise the default pack. Known once the game state has arrived.
	  await soundEvents.preload(gameManager.getCurrentGameState()?.packageToken ?? undefined);
	  console.debug('[sound] initSound: earcon pack preloaded | AudioContext =', soundManager.getAudioContextState());
	} catch (e) { console.debug('[sound] initSound: error initializing sound', e); }
  };

  // The very FIRST user gesture (anywhere on the page) unlocks the AudioContext and must
  // preload the earcon pack — otherwise a player who rolls the dice with Enter without ever
  // arrow-navigating a square would never hear any game sound (the buffers stay unloaded).
  const enableAudioOnFirstInteraction = (e: Event) => {
	if (userInteractionDetected) return;
	userInteractionDetected = true;
	console.debug('[sound] first interaction detected via', e.type);
	// Resume the AudioContext SYNCHRONOUSLY inside the gesture so browsers actually
	// unlock it (a deferred resume() after an await can be ignored, which delayed sound).
	soundManager.unlock();
	void initSoundOnFirstInteraction();
  };
  // Cover the gesture types iPadOS/iOS Safari may deliver first: a tap can surface as
  // pointerdown / touchstart / touchend / click depending on context, and keyboard players
  // get keydown. Any one of them unlocks (the handler self-guards against re-entry).
  ['pointerdown', 'touchstart', 'touchend', 'click', 'keydown'].forEach(event =>
	document.addEventListener(event, enableAudioOnFirstInteraction, { once: true }));

  // Browsers suspend a tab's AudioContext when it goes to the background. When a second
  // (in-private) window is open to simulate another player, only the focused tab keeps
  // audio "running" — the backgrounded one falls to "suspended" and its earcons go silent
  // until it regains focus, which looks like sound playing unpredictably in one window or
  // the other. Proactively resume the context whenever this page becomes visible/focused
  // again so earcons stay reliable across windows.
  const resumeAudioOnForeground = (reason: string) => {
	const state = soundManager.getAudioContextState();
	if (state === 'suspended' || state === 'interrupted') {
	  console.debug(`[sound] ${reason}: resuming AudioContext (was "${state}")`);
	  soundManager.unlock();
	}
  };
  document.addEventListener('visibilitychange', () => {
	if (!document.hidden) resumeAudioOnForeground('page visible');
  });
  window.addEventListener('focus', () => resumeAudioOnForeground('window focus'));

  gameBoard.onSquareSelected(async (_squareIndex, square) => {
	if (!soundInitialized && userInteractionDetected) await initSoundOnFirstInteraction();
	if (soundEnabled) {
	  const panValue = (square.x / (GRID_SIZE - 1)) * 2 - 1;
	  const pitchValue = 1.8 - (square.y / (GRID_SIZE - 1)) * 0.8;
	  playSound('finger', { volume: 0.3, pan: panValue, pitch: pitchValue }).catch(() => {});
	}
  });

  // Clicking / tapping a square (or activating it with a touch screen reader) opens its
  // contextual menu (info plus build/sell/mortgage/buy when applicable).
  gameBoard.onSquareActivated((squareIndex) => openSquareMenu(squareIndex));

	// Every authoritative announcement fans out here exactly once: earcon, persistent
	// visual narrative and spoken live region. BoardToast is reserved for explicit errors.
  const announceWithSound: AnnounceFn = (event, options) => {
	soundEvents.playForAnnouncement(event.key, event.vars);
	visualNarrative.playForAnnouncement(event);
	globalAnnounce(event, options);
  };
  // Hold an action's landing consequences (sound + toast + voice) until its token finishes
  // hopping, so the turn reads "dice → hop → what happened" instead of all at once. Server
  // `resolve`-phase lines are buffered while the actor's token animates; `move` lines (the
  // dice roll), errors and client UI announcements pass straight through.
  announcementGate = new AnnouncementGate({
	deliver: announceWithSound,
	isAnimating: () => tokenAnimator.isAnimating || familyAnimating(),
  });
	visualNarrative.init({
	getGameState: () => gameManager.getCurrentGameState(),
	getMyPlayerId: () => gameManager.getMyPlayerId(),
	});
  gameManager.initialize(
	gameBoard,
	announcementGate.announce,
	(run) => announcementGate!.deferVisual(run),
	// Command responses (DICE_ROLLED) arrive before their announcements+state segment
	// plays, so the handler arms the gate itself before deferring the cursor move.
	() => announcementGate!.armForMove(),
  );
  // Let the turn sequencer pace a compound move's segments to the token hop (a single
  // segment still applies immediately when nothing is animating).
  gameManager.setAnimationProbe(() => tokenAnimator.isAnimating || familyAnimating());

  // Flag to know if we've already rendered with server data
  let hasRenderedWithServerData = false;

  // === Action bar context bookkeeping ===
  // The action bar reflects the turn-flow actions that have no other on-screen
  // control. Every flag below — including whether an auction/trade modal is open on
  // MY screen — is derived from the server-authoritative game state, so the bar (and
  // the modals, see reconcileModals) are correct after a reconnect, when the server
  // resends the full state but never replays the one-time "auction/trade started" events.

  function buildActionContext(): ActionContext {
	const myId = gameManager.getMyPlayerId();
	// The flag derivation lives in a pure, tested helper; here we just gather the raw pieces.
	// movementSettling withholds the turn-flow actions while this client is still telling
	// the current move (any walking token/piece) — same probe as the settle guard on the
	// shortcuts, so the bar and the keys agree.
	return deriveActionContext(
	  gameManager.getCurrentGameState(),
	  myId,
	  gameManager.getMyPlayer(),
	  gameManager.getAllPlayers().filter(p => p.id !== myId).length,
	  presentationSettling(),
	);
  }

  function refreshActionBar(): void {
	actionBar.render(computeAvailableActions(buildActionContext()));
	if (managePropertiesDialog.isOpen()) managePropertiesDialog.refresh();
  }

  // Build the list of my properties for the manage-properties dialog. A property
  // can be built on only when I own the full color group; the server enforces
  // the rest (even-build, building shortage, mortgaged neighbours, turn).
  function buildManageableProperties(): ManageablePropertyItem[] {
	const me = gameManager.getMyPlayer();
	if (!me) return [];
	return projectManageableProperties(gameManager.getSquares(), new Set(me.properties));
  }

  function openManageProperties(): void {
	if (managePropertiesDialog.isOpen()) return;
	const board = document.getElementById('board');
	managePropertiesDialog.open({
	  getProperties: buildManageableProperties,
	  onBuild: (i) => gameManager.build(i, 1),
	  onSell: (i) => gameManager.sellBuildings(i, 1),
	  onMortgage: (i) => gameManager.mortgageProperty(i),
	  onUnmortgage: (i) => gameManager.unmortgageProperty(i),
	  onClose: () => board?.focus(),
	  announce: (text) => globalAnnounce(createAnnouncement('_raw', { text }), { instant: true }),
	});
  }

  function openTradeBuilder(preselectedTargetId?: string): void {
	// Proposing a trade is turn-bound (server rule), so this is a no-op off-turn. The action
	// bar and players panel already hide the affordance; this also guards the global Ctrl+T
	// shortcut — speak a brief reason instead of opening a dialog the server would reject.
	if (!isMyTurn()) {
	  globalAnnounce(createAnnouncement('game.not_your_turn', {}), { instant: true });
	  return;
	}
	const me = gameManager.getMyPlayer();
	if (!me) return;
	const others = gameManager.getAllPlayers().filter(p => p.id !== me.id);
	tradeDialog.openBuilder({
	  myPlayer: me,
	  others,
	  squares: gameManager.getSquares(),
	  preselectedTargetId,
	  // Live reads so the builder's caps track the game while it's open (a partner who mortgages
	  // to raise cash mid-build now shows the higher "request money" cap).
	  getPlayers: () => gameManager.getAllPlayers(),
	  getSquares: () => gameManager.getSquares(),
	  onPropose: async (targetId, offered, requested) => {
		await gameManager.proposeTrade(targetId, offered, requested);
	  }
	});
  }

  // True when it is the local player's turn (gates trade actions in the players panel).
  function isMyTurn(): boolean {
	const myId = gameManager.getMyPlayerId();
	return !!myId && gameManager.getCurrentGameState()?.currentTurn === myId;
  }

  // Open the read-only player-detail modal (money, position, holding, properties).
  function openPlayerDetail(playerId: string): void {
	const player = gameManager.getPlayer(playerId);
	if (!player) return;
	playerDetailDialog.open({
	  getData: () => {
		const p = gameManager.getPlayer(playerId)!;
		const squares = gameManager.getSquares();
		return {
		  name: p.name,
		  // Resolve the board's own token name (its package nameKey, a full key) with a fallback, not
		  // the removed game.token_* keys. Uses tSync (full keys), not the game-prefixed t.
		  tokenName: getTokenName(p.token, (key, fallback) => {
			const v = tSync(key);
			return v && v !== key ? v : (fallback ?? key);
		  }),
		  money: p.money,
		  positionName: squares[p.position]?.name ?? '',
		  held: !!p.isHeld,
		  releasePasses: p.releasePasses ?? 0,
		  isBankrupt: !!p.isBankrupt,
		  properties: projectPlayerProperties(squares, p.properties),
		};
	  },
	  canProposeTrade: isMyTurn() && playerId !== gameManager.getMyPlayerId(),
	  onProposeTrade: () => openTradeBuilder(playerId),
	  onClose: () => board?.focus(),
	  announce: (text) => globalAnnounce(createAnnouncement('_raw', { text }), { instant: true }),
	});
  }

  // Open the read-only property-info modal for a board square (colour, price, owner,
  // buildings, mortgage and rent table). Triggered by clicking a square or Shift+I.
  function openPropertyInfo(index: number): void {
	if (index < 0) return;
	const squares = gameManager.getSquares();
	if (!squares[index]) return;
	propertyInfoDialog.open({
	  getData: () => projectPropertyInfo(
		gameManager.getSquares(),
		index,
		gameManager.getAllPlayers(),
		gameManager.getMyPlayerId() ?? undefined,
	  )!,
	  onClose: () => board?.focus(),
	  announce: (text) => globalAnnounce(createAnnouncement('_raw', { text }), { instant: true }),
	});
  }

  // Open the contextual menu for a board square: the read-only info plus the actions the
  // square currently offers the local player (build / sell / mortgage / unmortgage / buy).
  // When no action applies (non-ownable square, or a property I neither own nor can buy
  // now) it falls back to the read-only info dialog so a single keystroke still does the
  // most useful thing.
  function openSquareMenu(index: number): void {
	if (index < 0) return;
	const squares = gameManager.getSquares();
	const square = squares[index];
	if (!square) return;
	const me = gameManager.getMyPlayer();
	const gs = gameManager.getCurrentGameState();
	const actions = squareMenuActions({
	  squares,
	  index,
	  myId: gameManager.getMyPlayerId(),
	  currentTurn: gs?.currentTurn ?? null,
	  myMoney: me?.money ?? 0,
	  pendingPurchase: gs?.pendingPurchase ?? null,
	});
	if (actions.length === 0) { openPropertyInfo(index); return; }

	const board = document.getElementById('board');
	const anchor = document.querySelector(`.square[data-index="${index}"]`) as HTMLElement | null;
	const announce = (text: string) => globalAnnounce(createAnnouncement('_raw', { text }), { instant: true });

	const items: PopupMenuItem[] = [
		// Property info is always available (every holding is public in Corro).
		{ label: t('square_menu_info'), onSelect: () => openPropertyInfo(index) },
		...actions.map<PopupMenuItem>((a) => ({
			label: squareActionLabel(a),
			disabled: !a.enabled,
			reason: a.enabled ? undefined : (a.reasonKey ? tSync(a.reasonKey, a.reasonVars) : undefined),
			onSelect: () => {
				switch (a.id) {
					case 'build': gameManager.build(index, 1); break;
					case 'sellHotel':
					case 'sellHouse': gameManager.sellBuildings(index, 1); break;
					case 'mortgage': gameManager.mortgageProperty(index); break;
					case 'unmortgage': gameManager.unmortgageProperty(index); break;
					case 'buy': openBuyConfirm(); break;
				}
			},
		})),
	];

	popupMenu.open({
		ariaLabel: t('actions_for', { name: square.name }),
		items,
		anchor,
		openAnnouncement: square.name,
		onClose: () => board?.focus(),
		announce,
	});
  }

  // bank, like a bankruptcy), so confirm before doing it.
  function confirmLeaveGame(): void {
	// The consequences are the PROPERTY family's only in the property family: everywhere
	// else there is no estate to forfeit — leaving is a plain retirement, and the dialog
	// must not threaten a bankruptcy that doesn't exist (live-play report).
	const retire = !!familyFor(gameManager.getCurrentGameState()?.gameType);
	dialogManager.show({
	  title: tSync('game.conn_leave_confirm_title'),
	  content: `<p>${tSync(retire ? 'game.conn_leave_confirm_message_retire' : 'game.conn_leave_confirm_message')}</p>`,
	  buttons: [
		{
		  label: 'Leave',
		  i18nKey: 'game.conn_leave_confirm_yes',
		  variant: 'danger',
		  action: async () => {
			dialogManager.close();
			// Leaving the game sends the player home, rather than stranding them on the board
			// as a spectator (live-play report). The bankruptcy/retirement fires first.
			await gameManager.declareBankruptcy();
			window.location.href = '/';
		  },
		},
		{
		  label: 'Cancel',
		  i18nKey: 'game.conn_leave_confirm_no',
		  variant: 'secondary',
		  action: () => dialogManager.close(),
		},
	  ],
	});
  }

  // Map an action-bar id to the matching gameManager call / dialog.
  function activateAction(id: ActionId): void {
	// Turn-flow actions go through the settle guard: the bar already withholds them while
	// the move is being told, but a button rendered an instant earlier can still be
	// activated — the guard turns that race into a spoken "wait" instead of a command.
	switch (id) {
	  case 'payReleaseCost': payReleaseCostSettled(); break;
	  case 'useReleasePass': useReleasePassSettled(); break;
	  case 'rollDice': rollDiceSettled(); break;
	  case 'buyProperty': buyPropertySettled(); break;
	  case 'endTurn': endTurnSettled(); break;
	  case 'manageProperties': openManageProperties(); break;
	  case 'proposeTrade': openTradeBuilder(); break;
	  case 'reenterAuction': reenterAuction(); break;
	}
  }

  // Mount the action bar and wire up F6/Shift+F6 panel navigation across the
  // board's landmark regions (announcing each region's name on entry). The action
  // bar speaks a disabled action's reason (e.g. "roll again first") when activated.
  actionBar.init(activateAction, (text) => globalAnnounce(createAnnouncement('_raw', { text }), { instant: true }));
  panelNavigator.init((labelKey, vars) => globalAnnounce(createAnnouncement(labelKey, vars ?? {}), { instant: true }));
  panelNavigator.register({
	id: 'board',
	labelKey: 'game.panels.board',
	getElement: () => document.getElementById('board'),
	focus: () => { const b = document.getElementById('board'); if (!b) return false; b.focus(); return true; },
  });
  panelNavigator.register({
	id: 'actions',
	labelKey: 'game.panels.actions',
	getElement: () => actionBar.element,
	focus: () => actionBar.focus(),
	isAvailable: () => actionBar.hasActions,
  });
  panelNavigator.register({
	id: 'players',
	labelKey: 'game.panels.players',
	getElement: () => document.getElementById('players-panel'),
	focus: () => playerPanel.focus(),
  });
  panelNavigator.register({
	id: 'connection',
	labelKey: 'game.panels.connection',
	getElement: () => document.getElementById('connection-panel'),
	focus: () => connectionPanel.focus(),
  });
  // An open NON-modal dialog (e.g. the race piece choice) joins the F6 ring as one more
  // panel and is reachable directly with Ctrl+D. Modal dialogs trap focus on their own
  // and never appear here.
  const openNonModalDialog = () =>
	document.querySelector<HTMLElement>('dialog[open][data-modal="false"]:not(#chat-panel):not(#voice-panel)');
  panelNavigator.register({
	id: 'dialog',
	labelKey: 'game.panels.dialog',
	// Entering the dialog re-states its TITLE (the reason it is open): without a focus
	// trap the player walks in and out, and "dialog" alone doesn't say what it asks.
	getLabel: () => {
	  const title = openNonModalDialog()?.querySelector('.dialog-title')?.textContent?.trim();
	  return title
		? { key: 'game.panels.dialog_titled', vars: { title } }
		: { key: 'game.panels.dialog' };
	},
	getElement: openNonModalDialog,
	focus: () => {
	  const dlg = openNonModalDialog();
	  if (!dlg) return false;
	  // Re-entering the picker RESTORES it: if it was minimized to its title bar (Escape or the
	  // corner button), its buttons are display:none and can't take focus, so expand it first.
	  if (dlg.classList.contains('dialog--minimized')) {
		dlg.classList.remove('dialog--minimized');
		(dlg as unknown as { syncMinimize?: () => void }).syncMinimize?.();
	  }
	  // First focusable in DOCUMENT order — including tabindex="0" stops (the trade
	  // review's offer lines come before its buttons and re-read the deal on entry,
	  // matching where the dialog itself lands focus when it opens).
	  const target = dlg.querySelector<HTMLElement>('[tabindex="0"], button, [href], input, select, textarea');
	  if (!target) return false;
	  target.focus();
	  return true;
	},
	isAvailable: () => !!openNonModalDialog(),
  });
  // The chat joins the F6 ring while open (its own floating <dialog>, so it can coexist
  // with a pending choice dialog). Entering lands on the compose box.
  panelNavigator.register({
	id: 'chat',
	labelKey: 'game.panels.chat',
	getElement: () => (chatPanel.isOpen() ? document.getElementById('chat-panel') : null),
	focus: () => chatPanel.focusInput(),
	isAvailable: () => chatPanel.isOpen(),
  });
	panelNavigator.register({
	id: 'voice',
	labelKey: 'game.panels.voice',
	getElement: () => (voicePanel.isOpen() ? document.getElementById('voice-panel') : null),
	focus: () => voicePanel.focus(),
	isAvailable: () => voicePanel.isOpen(),
  });

  // Subscribe to server updates
  // A drawn card is a CONSEQUENCE of landing: its visual reveal must be paced to the token
  // hop just like rent/tax. The server pushes the `CardDrawn` SignalR event mid-action —
  // BEFORE the `GameEvents` batch that arms the announcement gate — so revealing it straight
  // from the 'cardDrawn' handler would flash the card before the token even moves. Instead we
  // stash it here and reveal it from the gated gameStateUpdated block below, which always runs
  // after the gate is armed and releases on settle.
  let pendingCardReveal: CardDrawnNotification | null = null;
  let packageI18nLoaded = false;

  gameManager.on('gameStateUpdated', (gs) => {
	if (!gs) return;
	voicePanel.setGameEnabled(!!gs.voiceChatEnabled);

	// The page starts with a truthful loading message. Once the authoritative state tells us
	// the family, explain the surface focus actually enters: a spatial board or a card hand.
	// Focus is moved there automatically below, so neither variant tells the player to press Tab.
	updateGameSurfaceIntro(gameSurfaceIntro, gs.gameType, key => i18nBinder.tSync(key));

	// If I'm building a trade and the partner's balance changed (they mortgaged to raise cash),
	// re-sync the builder's caps/valuation to the live state without disturbing my selections.
	tradeDialog.refreshBuilder();

	// Tab title: "<board name> - <site title>". A package game carries its localized name in the
	// state (shared by all players); a built-in board localizes its saved id. Refreshed on each
	// update so it also tracks a mid-game language switch.
	document.title = boardPageTitle(
	  gs.boardName, i18nBinder.getCurrentLanguage(),
	  GameSessionStore.getGame(gameId)?.board, k => i18nBinder.tSync(k), siteBranding.title);

	// A package game brings its own tokens + translations. Register the tokens so the board/panels
	// render the package's icons, and merge its i18n once, then re-render so its keys resolve.
	setPackageTokens(gs.tokens);
	// Load THIS game's earcon pack once its token is known: the first-gesture preload may have
	// run in the lobby (no token yet) and cached only the engine platform pack, so game sounds
	// would otherwise stay silent. No-op if already loaded or before the first gesture.
	void soundEvents.switchPack(gs.packageToken ?? undefined);
	// Install the board's vocabulary (currency symbol + terminology) so announcements and the help
	// use the board's own words. Done every update so it also tracks a mid-game language switch; the
	// currency symbol is in the state immediately, while transit/utility names sharpen once the
	// package i18n is merged (the re-run below).
	setBoardVocabulary(gs, i18nBinder.getCurrentLanguage());
	if (gs.packageToken && !packageI18nLoaded) {
	  packageI18nLoaded = true;
	  const lang = i18nBinder.getCurrentLanguage();
	  void i18nBinder.loadPackageResources(gs.packageToken).then(() => {
		setBoardVocabulary(gs, i18nBinder.getCurrentLanguage()); // now resolve package group names
		void i18nBinder.applyI18n();
		if (hasRenderedWithServerData) {
		  // render() REBUILDS the squares, wiping the player tokens, owner badges and
		  // building chips. Redraw them from the current state right away: during live
		  // play the next state update repainted them within a move, but after a
		  // mid-game reload NO further state arrives — the board sat looking unowned
		  // and empty until someone acted (live-play bug: "after Ctrl+F5 it looks like
		  // nobody bought anything").
		  gameBoard.render(labelBuilder);
		  renderPlayers();
		}
		// The players panel may have rendered BEFORE the package keys merged (e.g. the
		// race squadron names): repaint it now, or it shows raw seat ids until the next
		// state update arrives.
		playerPanel.update();
		// Family surfaces speak package keys too (the journey hand's card names, seat
		// names): repaint the active one now that the package bundle is merged.
		const fresh = gameManager.getCurrentGameState();
		if (fresh) ensureFamilyView(fresh.gameType)?.onStateUpdated(fresh);
	  });
	  // Load the board's guide (rules + how to play) for F1 / the Help button — the player's
	  // language first, then the others as a fallback.
	  const fallbackLangs = i18nBinder.getSupportedLanguages().filter(l => l !== lang);
	  void loadBoardHelp(gs.packageToken, [lang, ...fallbackLangs]);
	}

	// Surface the re-entry code once the join ack has delivered it (idempotent).
	connectionPanel.setRejoinCode(gameManager.getMyRejoinCode());

	// Non-property families: their board renders/updates from their own sub-state and
	// their animator paces announcements with motion; the property rendering below is
	// naturally inert there (gs.squares is empty in those families).
	ensureFamilyView(gs.gameType)?.onStateUpdated(gs);

	// Render with server data the first time it arrives
	// Afterwards we only update labels and positions to avoid losing focus
	if (gs.squares && gs.squares.length > 0 && !hasRenderedWithServerData) {
	  gameBoard.render(labelBuilder);
	  hasRenderedWithServerData = true;
	  // Place the exploration cursor on my own token so it reflects where I am
	  // on the board (not the GO square). Announce it only if the board already
	  // has focus, so a player waiting on the board hears where they landed.
	  const myPos = gameManager.getMyPlayer()?.position ?? 0;
	  gameBoard.setActiveIndex(myPos, false, document.activeElement === board);
	} else if (hasRenderedWithServerData) {
	  // Board already exists with server data: update labels without recreating DOM
	  gameBoard.updateLabels();
	}

	// Ownership is rendered from the authoritative square state in renderPlayers().

	// Update turn indicator
	const currentPlayer = gameManager.getCurrentPlayer();
	const myPlayerId = gameManager.getMyPlayerId();
	const isMyTurn = currentPlayer?.id === myPlayerId;
	turnIndicator.setCurrentTurn(currentPlayer, isMyTurn);
	// Families without dice (journey) hide the die entirely; the hand's draw button is
	// their visible turn affordance.
	diceControl.setVisible(!isToolbarlessFamily(gs.gameType));
	diceControl.setEnabled(isMyTurn);

	// Start (or refresh) the token hop, then draw the tokens at their (possibly mid-hop)
	// display position. renderPlayers also runs on every hop tick via the animator.
	// Going to holding teleports by default ("go directly to holding" — no slide across the board): snap
	// any player who just entered holding this update, unless the board opts into walking there.
	const allPlayers = gameManager.getAllPlayers();
	const snapToHolding = holdingTeleports(allPlayers, wasHeld, !!gs.walkToHolding);
	tokenAnimator.sync(new Map(allPlayers.map(p => [p.id, p.position])), snapToHolding);
	renderPlayers();

	// Reconcile blocking modals (auction / trade) against the authoritative
	// state, so a mid-modal reconnect reopens the right dialog and resolution closes it.
	reconcileModals(gs);

	// Refresh the bar NOW so a just-taken action (e.g. the roll) stops being offered; while
	// my own token is mid-hop, buildActionContext reports movementSettling, which withholds
	// the landing-driven actions (buy / end turn) until it settles.
	refreshActionBar();

	// The money panel, Free Parking pot and the landing-driven action bar are CONSEQUENCES
	// of the roll: pace them to the token hop so they reveal when it lands. The gate buffers
	// them while the token travels and releases them on settle — or immediately when nothing
	// is animating (a buy, another player's turn already settled, or motion turned off).
	announcementGate?.deferVisual(() => {
	  // Advance the presentation state HERE, paced to the hop: the consequence reads below — and any
	  // on-demand query like the Free Parking "f" — then reflect the just-landed square, not the
	  // future the server already applied while the token was still travelling.
	  gameManager.revealPresentation(gs);
	  playerPanel.update();
	  gameBoard.updateFreeParkingPot(gameManager.getFreeParkingPot());
	  // The debtor indicator is a CONSEQUENCE of the roll too (it used to run immediately, so
	  // "so-and-so is in debt" flashed up while the roll was still animating): pace it to the hop.
	  updateDebtWaitingNotification(gameManager.getPresentationState()!);
	  refreshActionBar();
	  // Reveal a freshly drawn card now that the token has settled on its square. For
	  // sighted players the card first sails out of its deck pile in the center, tumbling
	  // toward the drawing player's token, then the centered reveal lets them read it. The
	  // flight is purely visual: it is skipped under reduced motion (or when the deck/token
	  // rects are unavailable), and the server's voice already spoke the card either way.
	  if (pendingCardReveal) {
		const card = pendingCardReveal;
		pendingCardReveal = null;
		// The server now speaks every card's text (classic and package, via a key resolved against
		// the merged package i18n), so the client only drives the visual reveal here.
		const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		// Fly from whichever pile this deck has on the board — classic (chance/community) or a
		// package deck id — matched by data-deck-id; getDeckRect returns null if there's no pile.
		const deckRect = card.deckType ? gameBoard.getDeckRect(card.deckType) : null;
		const tokenRect = gameBoard.getTokenRect(card.playerId);
		if (!reduceMotion && deckRect && tokenRect) {
		  void cardFlight.play(card, deckRect, tokenRect).then(() => cardReveal.show(card));
		} else {
		  cardReveal.show(card);
		}
	  }
	  // The game is over: show the end screen (winner + final standings + awards). The
	  // server already voiced the win; this is the visual layer + the way out. Paced with
	  // the other consequences so a race won on the final hop lets the piece visibly reach
	  // the goal (and the winning line be spoken) before the screen covers the board. The
	  // once-guard inside ignores any further state pushes before deletion.
	  if (gs.isGameOver) {
		showEndScreen(gs, gameManager.getMyPlayerId());
	  }
	});
	// Now that authoritative state is applied (and any token hop has started), let the gate
	// decide whether to hold this action's consequences for the hop or release them now.
	// Pass the state object so the gate can tell a fresh application from a handler's
	// deferred RE-EMIT of the same state (e.g. the dice handler's 600 ms turn refresh) —
	// that synthetic emit must never flush a movement armed but not yet applied.
	announcementGate?.onStateApplied(gs);
  });

  // Reflect the live SignalR connection state in the connection panel.
  gameManager.on('connectionStatusChanged', ({ status }) => {
	connectionPanel.setStatus(status);
  });

  // The re-entry code arrives on the join ack (after the state snapshot): surface it
  // in the connection panel the moment it is known.
  gameManager.on('rejoinCodeAvailable', (code) => {
	connectionPanel.setRejoinCode(code);
  });

  // Handle reconnection attempts: show modal during retries, error if failed
  gameManager.on('reconnectionAttempt', (data) => {
	if (data.state === 'success') {
	  // Reconnected successfully, close the modal
	  if (reconnectModalState) {
		dialogManager.close();
		reconnectModalState = null;
	  }
	} else if (data.state === 'connecting') {
	  // Show/update the reconnecting modal
	  reconnectModalState = data;
	  const attempt = data.attempt || 1;
	  const message = attempt === 1
		? t('reconnect_modal_connecting')
		: t('reconnect_modal_attempt', { attempt, max: 3 });
	  dialogManager.show({
		title: t('reconnect_modal_title'),
		buttons: [],
		content: message,
	  });
	} else if (data.state === 'failed') {
	  // Show error modal with retry/close options
	  reconnectModalState = data;
	  dialogManager.show({
		title: t('reconnect_modal_title'),
		buttons: [
		  {
			label: t('reconnect_modal_retry'),
			action: () => gameManager.retryReconnect(),
		  },
		  {
			label: t('reconnect_modal_close'),
			action: () => {
			  dialogManager.close();
			  reconnectModalState = null;
			  // Navigate back to lobby
			  window.location.href = '/';
			},
		  },
		],
		content: t('reconnect_modal_failed'),
	  });
	}
  });

  // Surface server-side validation errors (e.g. an illegal action) to sighted
  // players as a transient, colour-coded center-board toast. Screen-reader users
  // already hear the reason via the priority ARIA live region (announced from
  // gameManager), so the toast is purely a glanceable visual cue.
  gameManager.on('serverError', (data) => {
	// Earcon so a sighted player hears that something was rejected.
	soundEvents.playEvent('error');
	// A fatal error BEFORE the game ever loaded means the link is dead (the game doesn't exist,
	// has ended, or this session isn't part of it). A transient toast over a blank board is
	// both ugly and unhelpful — show a clear "game not found" screen and return to the lobby.
	const FATAL_JOIN_ERRORS = ['GAME_NOT_FOUND', 'PLAYER_NOT_FOUND', 'GAME_SERVICE_NOT_FOUND'];
	if (!hasRenderedWithServerData && FATAL_JOIN_ERRORS.includes(data.code)) {
	  dialogManager.showInfo({
		title: 'Game not found',
		titleI18nKey: 'game.not_found_title',
		message: "This game doesn't exist or has ended.",
		messageI18nKey: 'game.not_found_message',
		onClose: () => { window.location.href = '/'; },
	  });
	  return;
	}
	boardToast.show(data.message, 'loss');
  });

  // Animate the visual dice when any player rolls.
  gameManager.on('diceRolled', (d: any) => {
	if (d && typeof d.die1 === 'number' && typeof d.die2 === 'number') {
	  // With motion off the token snaps to its destination the instant the state arrives, so a
	  // tumbling die would still be "rolling" while the board already shows the landing — leaking
	  // where the player lands before the roll visibly finishes (bug #14). Skip the tumble then.
	  diceControl.animateRoll(d.die1, d.die2, !isTokenMotionDisabled());
	}
	// The turn phase (have I rolled? do I owe a re-roll?) is server-authoritative;
	// the action bar recomputes from the game state on every gameStateUpdated, so
	// there is no client-side "have I rolled" bookkeeping to maintain here.
  });

  // Visual reveal for drawn the card decks cards (non-blocking). The card's flavour
  // text is already spoken by the server's Announcement stream (and kept in the
  // announcement history), so the on-screen overlay is purely the sighted-player visual.
  gameManager.on('cardDrawn', (card) => {
	// Stash the card; it is revealed from the gated gameStateUpdated block once the token
	// has finished its hop. Revealing here would flash it before the token moves, because
	// this SignalR event arrives ahead of the gate-arming GameEvents batch.
	pendingCardReveal = card;
  });

  // Helper to show/hide debt waiting notification for other players
  function updateDebtWaitingNotification(gs: GameState): void {
	const myPlayerId = gameManager.getMyPlayerId();
	const pendingDebts = gs.pendingDebts || [];

	// Find if any OTHER player has debts
	const otherPlayerDebts = pendingDebts.filter(d => d.debtorId !== myPlayerId);

	if (otherPlayerDebts.length > 0) {
	  const debtor = gs.players.find(p => p.id === otherPlayerDebts[0].debtorId);
	  if (debtor) {
		const totalDebt = otherPlayerDebts
		  .filter(d => d.debtorId === debtor.id)
		  .reduce((sum, d) => sum + d.amount, 0);

		// The turn indicator shows who everyone is waiting for (and how much they owe).
		turnIndicator.setDebtorPlayer(debtor, totalDebt);
	  }
	} else {
	  turnIndicator.clearDebtor();
	}
  }

  // === Helper function to compute group status message ===
  function computeGroupStatusMessage(squareIndex: number): string {
	const squares = gameManager.getSquares();
	// Pure builder (groupStatus.ts); package keys resolve top-level via tSync, app templates via t.
	return groupStatusMessage(squares[squareIndex], {
	  squares,
	  players: gameManager.getAllPlayers(),
	  myId: gameManager.getMyPlayerId(),
	  t,
	  pkg: tSync,
	});
  }

  // === Property purchase (buy as a turn action) ===
  // Buying is no longer a blocking modal. When I land on an unowned property the
  // server records a pending purchase in the game state, which surfaces a "Buy"
  // action in the toolbar. Activating it opens a Yes/No confirmation showing the
  // group-ownership context; leaving it pending lets me mortgage/trade and buy
  // later, or end the turn to decline (auctioned if the house rule is enabled).
  //
  // The client state is server-authoritative and arrives over the network, so it
  // can lag behind a buy I just confirmed. While a buy for the current pending
  // purchase is in flight we refuse to open a second confirmation or send another
  // command, so a stray activation during the lag window can't trigger a
  // duplicate buy that the server rejects as NO_PENDING_PURCHASE.
  let buyInFlightSquare: number | null = null;
  function openBuyConfirm(): void {
	const gs = gameManager.getCurrentGameState();
	const myId = gameManager.getMyPlayerId();
	const pp = gs?.pendingPurchase ?? null;
	const me = gameManager.getMyPlayer();
	const decision = decideBuyConfirm({
	  pendingPurchase: pp,
	  myId,
	  myMoney: me?.money ?? 0,
	  inFlightSquare: buyInFlightSquare,
	});
	if (decision === 'cannotAfford') {
	  // Reached via the keyboard shortcut while I can't afford it: speak the reason.
	  globalAnnounce(createAnnouncement('game.actions.cannot_buy_no_money', {}), { instant: true });
	  return;
	}
	if (decision !== 'open' || !pp) return;

	const groupStatusMessage = computeGroupStatusMessage(pp.squareIndex);
	const board = document.getElementById('board');
	dialogManager.showBuyConfirm({
	  squareName: pp.squareName,
	  price: pp.price,
	  groupStatusMessage,
	  onConfirm: async () => {
		buyInFlightSquare = pp.squareIndex;
		try {
		  await gameManager.buyProperty(pp.squareIndex);
		} finally {
		  buyInFlightSquare = null;
		}
	  },
	  onCancel: () => { board?.focus(); },
	});
  }

  // === Blocking modals: live events + state reconciliation ===
	// The auction and trade modals are blocking operations the server persists in
	// the game state. Two paths drive them
  // through the SAME idempotent open/close helpers below:
  //   1. Live one-time events (auctionStarted, tradeProposed, …) — instant feedback in play.
  //   2. reconcileModals(state), run on every state update — the source of truth. On a
  //      reconnect the server resends the full state but never replays the one-time events,
  //      so this is what reopens the right modal (e.g. after a Ctrl+F5 mid-auction) and
  //      closes it once the operation clears.
  // Because both paths funnel through the guarded helpers, they never double-open or fight:
  // whichever runs first opens the modal, the other is a no-op.

  // Skip the countdown warning at the opening value; set when the auction modal opens.
  let lastAuctionWarnSecond = -1;
  // Which trade modal is open ('review' for the target, 'waiting' for the proposer), so the
  // reconciler never closes the proposer's BUILDER dialog (which is NOT state-driven). Null
  // when no review/waiting modal is open.
  let tradeModalMode: 'review' | 'waiting' | null = null;
  // State of the reconnection modal (null when not showing, otherwise the attempt state)
  let reconnectModalState: { state: 'connecting' | 'success' | 'failed'; attempt?: number; error?: string } | null = null;
  // Fingerprint of the pending race move the open dialog SHOWS. Content-keyed (not a mere
  // open/closed flag): a chained bonus replaces the pending move with NEW steps/options, and
  // the dialog must re-render for it — a boolean guard once left the previous roll's options
  // on screen while the voice asked to move the bonus steps.
  let raceChoiceKey: string | null = null;
  // Which trivia dialog is showing (judge setup / destination / answer / verdict) — keyed by
  // content so we only reopen (and re-announce) when the pending step actually changes.
  let triviaDialogKey: string | null = null;
  const racePendingKey = (p: PendingRaceMove) =>
	`${p.kind}:${p.steps}:${p.options.map(o => `${o.pieceIndex}>${o.toLocation}${o.toSquare}`).join(',')}`;
  // Grace before the choice dialog takes focus, so the screen reader finishes the roll
  // announcement ("sacas un 6") before the dialog entry interrupts it. Short: field
  // testing found a longer pause reads as a hang.
  const RACE_CHOICE_OPEN_DELAY_MS = 800;
  let raceChoiceOpenTimer: number | null = null;
  // The square index of an auction I just passed. Guards against a stale in-flight broadcast
  // (generated before the server recorded my pass) reopening the modal I just left.
  let myPassedAuctionSquare: number | null = null;

  // ── Idempotent open/close helpers (shared by the live events and reconcileModals) ──

  function openAuctionModal(d: AuctionModalData): void {
	if (auctionDialog.isOpen() || d.squareIndex === myPassedAuctionSquare) return;
	lastAuctionWarnSecond = d.secondsRemaining;
	const squareIndex = d.squareIndex;
	const myPlayer = gameManager.getMyPlayer();
	auctionDialog.open({
	  squareIndex,
	  squareName: d.squareName,
	  currentBid: d.currentBid,
	  highestBidderName: d.highestBidderName,
	  secondsRemaining: d.secondsRemaining,
	  playerMoney: myPlayer?.money ?? 0,
	  onBid: async (amount: number) => { await gameManager.placeBid(squareIndex, amount); },
	  onPass: async () => {
		myPassedAuctionSquare = squareIndex;
		await gameManager.passAuction(squareIndex);
	  }
	});
	// The countdown clock ticks while I'm in the auction; it stops in closeAuctionModal.
	soundEvents.startLoop('auction.tick');
  }

  function closeAuctionModal(): void {
	// Clearing the pass guard is safe here: the authoritative "auction over / I passed" state
	// that triggers this always arrives after any stale pre-pass broadcast (SignalR preserves
	// per-connection order), so no in-flight message can reopen the modal afterwards.
	myPassedAuctionSquare = null;
	soundEvents.stopLoop('auction.tick');
	if (auctionDialog.isOpen()) auctionDialog.end();
  }

  // Reopen the auction modal I'm still part of (e.g. after I dismissed it by accident
  // with Esc). Driven from the action bar and a keyboard shortcut. openAuctionModal is
  // idempotent (no-op if already open or if I passed this square), and the desiredModal
  // check ensures there really is an auction I may rejoin before reopening anything.
  function reenterAuction(): void {
	const desired = desiredModal(gameManager.getCurrentGameState(), gameManager.getMyPlayerId());
	if (desired.kind === 'auction') openAuctionModal(desired.data);
  }

  function openTradeReviewModal(d: TradeReviewModalData): void {
	if (tradeModalMode === 'review') return;
	const tradeId = d.tradeId;
	tradeDialog.openReview({
	  initiatorName: d.initiatorName,
	  offered: d.offered,
	  requested: d.requested,
	  // Live board squares so the review's valuation line counts mortgaged lots correctly.
	  squares: gameManager.getSquares(),
	  onAccept: async () => { await gameManager.respondToTrade(tradeId, true); },
	  onDecline: async () => { await gameManager.respondToTrade(tradeId, false); }
	});
	tradeModalMode = 'review';
  }

  function openTradeWaitingModal(d: TradeWaitingModalData): void {
	if (tradeModalMode === 'waiting') return;
	const tradeId = d.tradeId;
	tradeDialog.openWaiting({
	  targetName: d.targetName,
	  onCancel: async () => { await gameManager.cancelTrade(tradeId); }
	});
	tradeModalMode = 'waiting';
  }

  function closeTradeModal(): void {
	if (tradeModalMode === null) return; // not a review/waiting modal (e.g. the builder)
	tradeModalMode = null;
	tradeDialog.close();
  }

  // Reconcile the open modals against the authoritative state (the reconnect source of truth).
  /** Race family: the "which piece moves?" choice, driven purely by state (reopens on
   *  reconnect, closes when the server clears the pending move). */
  /**
   * Everything needed to voice a pending move's options, resolved against the MOVER's seat
   * (the actor's own, or their partner's once the actor finished — teams mode). Shared by
   * the choice dialog's buttons and the board's highlighted destination cells, so both
   * read the exact same text for the same option.
   */
  function raceOptionDescriber(pending: PendingRaceMove) {
	const gs = gameManager.getCurrentGameState();
	const moverId = pending.moverId ?? pending.playerId;
	const mover = gameManager.getAllPlayers().find(p => p.id === moverId) ?? null;
	const playerName = (id: string) => gameManager.getAllPlayers().find(p => p.id === id)?.name ?? id;
	const tokenName = mover ? getTokenName(mover.token, (key, fallback) => {
	  const v = i18nBinder.tSync(key);
	  return v && v !== key ? v : (fallback ?? key);
	}) : null;
	const pieceLabel = tokenName
	  ? (i: number) => tSync('game.race_option_piece_named', { token: tokenName, number: i + 1 })
	  : undefined;
	const origin = (i: number) => (gs?.raceBoard && gs.race)
	  ? describePieceOrigin(gs.raceBoard, gs.race, moverId, i, (k, v) => tSync(`game.${k}`, v))
	  : null;
	const moverSeatIdx = gs?.raceBoard && gs.race
	  ? gs.raceBoard.seats.findIndex(st => st.id === gs.race!.seats.find(x => x.playerId === moverId)?.seatId)
	  : -1;
	const seatName = moverSeatIdx >= 0 ? seatDisplayName(gs!.raceBoard!, moverSeatIdx, k => i18nBinder.tSync(k)) : null;
	const label = (option: PendingRaceMove['options'][number]) => describeMoveOption(option, {
	  t: (k, v) => tSync(`game.${k}`, v),
	  playerName,
	  pieceLabel,
	  origin,
	  pieceLocation: (idx) => {
		const piece = gs?.race?.seats.find(s => s.playerId === moverId)?.pieces[idx];
		return piece?.location as 'home' | 'circuit' | 'corridor' | 'goal' | undefined ?? null;
	  },
	  isSafeSquare: (square) => !!gs?.raceBoard?.safeSquares.includes(square),
	});
	return { moverId, seatName, label };
  }

  function openRaceChoiceModal(pending: PendingRaceMove): void {
	const key = racePendingKey(pending);
	if (raceChoiceKey === key) return; // already showing exactly this choice
	raceChoiceKey = key;
	if (raceChoiceOpenTimer !== null) { clearTimeout(raceChoiceOpenTimer); raceChoiceOpenTimer = null; }

	// Highlight valid move destinations (direct manipulation — phase 2)
	const rb = ensureRaceBoard();
	const gs = gameManager.getCurrentGameState();
	const board = gs?.raceBoard;
	if (board && gs?.race) {
	  // Each destination carries its option's spoken label, so exploring the board (touch
	  // or arrows) reads the move exactly as its dialog button would.
	  const { moverId, label } = raceOptionDescriber(pending);
	  const moveOptions = pending.options.map(option => {
		const cursor: RaceCursor = option.toLocation === 'circuit'
		  ? { zone: 'circuit', square: option.toSquare }
		  : { zone: 'seat', seatIndex: board.seats.findIndex(s => s.id === gs.race!.seats.find(x => x.playerId === moverId)?.seatId), cell: option.toSquare };
		return { cursor, pieceIndex: option.pieceIndex, label: label(option) };
	  });
	  rb.setMoveOptions(moveOptions, pieceIndex => {
		document.getElementById('board')?.focus();
		void gameManager.moveRacePiece(pieceIndex);
	  });
	}

	// FIRST open after a roll: wait before taking focus. The screen reader's dialog
	// entry (title + content) CUTS OFF whatever is being spoken, and the player must
	// hear what they rolled before being asked what to move. A re-render of an already
	// open dialog (a chained bonus) updates in place instead: leaving the stale options
	// on screen for the delay would invite a click the server resolves against the NEW
	// pending move.
	const alreadyOpen = !!document.querySelector('dialog[open][data-modal="false"]');
	if (alreadyOpen) {
	  renderRaceChoiceDialog(pending);
	  return;
	}
	raceChoiceOpenTimer = window.setTimeout(() => {
	  raceChoiceOpenTimer = null;
	  renderRaceChoiceDialog(pending);
	}, RACE_CHOICE_OPEN_DELAY_MS);
  }

  function renderRaceChoiceDialog(pending: PendingRaceMove): void {
	// Labels, origins and the seat heading all speak about the MOVER's seat (the actor's
	// own, or their partner's once the actor finished — teams mode), via the same
	// describer the board's highlighted destinations use.
	const { seatName, label } = raceOptionDescriber(pending);
	dialogManager.show({
	  title: seatName
		? tSync('game.race_choose_title_seat', { seat: seatName, steps: pending.steps })
		: tSync('game.race_choose_title', { steps: pending.steps }),
	  className: 'dialog-race-choice',
	  // Non-modal: focus starts on the options but the player can leave to explore the
	  // board (the choice needs the board!) and come back with F6 / Ctrl+D. Escape does
	  // not dismiss it — the pending move is state-driven and must be resolved.
	  modal: false,
	  buttons: pending.options.map((option, i) => ({
		label: label(option),
		variant: i === 0 ? 'primary' as const : 'secondary' as const,
		action: () => {
		  dialogManager.closeNonModal();
		  raceChoiceKey = null;
		  // Closing a non-modal dialog does not restore focus by itself (only showModal
		  // remembers the opener), so hand it back to the board explicitly.
		  document.getElementById('board')?.focus();
		  void gameManager.moveRacePiece(option.pieceIndex);
		},
	  })),
	});
	// Focus in the dialog and the board tell the same story: the option holding focus
	// gets a stronger ring on its destination square (sighted players see WHERE each
	// option lands while tabbing through them).
	const dialogButtons = document.querySelectorAll<HTMLButtonElement>(
	  'dialog.dialog-race-choice[open] .dialog-buttons button');
	dialogButtons.forEach((btn, i) => {
	  const option = pending.options[i];
	  if (!option) return;
	  btn.addEventListener('focus', () => ensureRaceBoard().setFocusedMoveOption(option.pieceIndex));
	  // The dialog focused its first button BEFORE these listeners existed: reflect the
	  // focus that is already there.
	  if (document.activeElement === btn) ensureRaceBoard().setFocusedMoveOption(option.pieceIndex);
	});
  }

  function closeRaceChoiceModal(): void {
	if (raceChoiceKey === null) return;
	raceChoiceKey = null;
	// A pending delayed open must never fire after the server resolved the choice.
	if (raceChoiceOpenTimer !== null) { clearTimeout(raceChoiceOpenTimer); raceChoiceOpenTimer = null; }
	// Clear move highlights (direct manipulation — phase 2). Only if the race board was
	// ever built — never create it just to clear it.
	(familyViews.get('race') as RaceFamilyView | undefined)?.raceBoard.setMoveOptions(null, null);
	// If the player was inside the dialog when the server resolved the choice, put them
	// back on the board (a closed non-modal dialog drops focus to <body> otherwise).
	// When they were already exploring elsewhere, leave their focus alone.
	const dlg = document.querySelector('dialog[open][data-modal="false"]');
	const hadFocus = !!dlg && dlg.contains(document.activeElement);
	dialogManager.closeNonModal();
	if (hadFocus) document.getElementById('board')?.focus();
  }

  // ── Trivia family: state-driven dialogs (judge setup → destination → answer → verdict) ──

  function openTriviaJudgeSetup(gs: GameState): void {
	dialogManager.show({
	  title: tSync('game.trivia_pick_judge_title'),
	  plainButtons: true,
	  dismissable: false, // mandatory: closing it with Escape would strand the table before the game starts
	  buttons: gs.players.map((p, i) => ({
		label: p.name,
		variant: i === 0 ? 'primary' as const : 'secondary' as const,
		action: () => { dialogManager.close(); triviaDialogKey = null; void gameManager.triviaChooseJudge(p.id); },
	  })),
	});
  }

  function openTriviaMove(gs: GameState, options: string[]): void {
	const board = gs.triviaBoard ?? null;
	const triviaBoard = (familyViews.get('trivia') as TriviaFamilyView | undefined)?.triviaBoard;
	const pick = (node: string): void => {
	  dialogManager.closeNonModal();
	  triviaBoard?.setMoveOptions(null, null);
	  triviaDialogKey = null;
	  document.getElementById('board')?.focus();
	  // Arm the gate NOW (the move is a separate action from the roll): the landing announcement
	  // and the question dialog then pace to the piece's walk, releasing when it arrives.
	  announcementGate?.armForMove();
	  void gameManager.triviaMove(node);
	};
	// Direct manipulation: highlight the legal landings on the board so the player can Escape the
	// (non-modal) dialog, cycle them with 'd', and press Enter on the one they want.
	triviaBoard?.setMoveOptions(options, pick);
	dialogManager.show({
	  title: tSync('game.trivia_choose_destination'),
	  modal: false,
	  plainButtons: true,
	  buttons: options.map((node, i) => {
		const base = board ? triviaNodeLabel(board, node, tSync) : node;
		const pos = board ? triviaPositionSuffix(board, node, tSync) : '';
		return {
		  label: pos ? `${base}, ${pos}` : base,
		  variant: i === 0 ? 'primary' as const : 'secondary' as const,
		  action: () => pick(node),
		};
	  }),
	});
  }

  function openTriviaAnswer(gs: GameState, q: TriviaPendingQuestion): void {
	const mode = gs.triviaRules?.answerMode ?? 'judge';
	if (mode === 'choice') {
	  dialogManager.show({
		title: q.prompt || tSync('game.trivia_choice_title'),
		plainButtons: true,
		dismissable: false, // mandatory: you must answer, so Escape can't strand your own turn
		buttons: q.choices.map((choice, i) => ({
		  label: choice,
		  variant: i === 0 ? 'primary' as const : 'secondary' as const,
		  action: () => { dialogManager.close(); triviaDialogKey = null; void gameManager.triviaAnswer(null, i); },
		})),
	  });
	  return;
	}
	const content = document.createElement('div');
	const label = document.createElement('label');
	label.textContent = tSync('game.trivia_answer_label');
	const input = document.createElement('input');
	input.type = 'text';
	input.autocomplete = 'off';
	label.appendChild(input);
	content.appendChild(label);
	const submit = (): void => {
	  const value = input.value.trim();
	  if (!value) return;
	  dialogManager.close();
	  triviaDialogKey = null;
	  void gameManager.triviaAnswer(value, -1);
	};
	input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
	// The QUESTION is the dialog TITLE — announced on open like every other dialog — and the
	// input takes focus directly (initialFocus) so NVDA reads the title then lands on the field,
	// with no 3-way focus bounce that left it stuck and silent before.
	dialogManager.show({
	  title: q.prompt || tSync('game.trivia_answer_title'),
	  contentElement: content,
	  initialFocus: input,
	  plainButtons: true,
	  dismissable: false, // mandatory: you must answer, so Escape can't strand your own turn
	  buttons: [{ label: tSync('game.trivia_answer_submit'), variant: 'primary' as const, action: submit }],
	});
  }

  function openTriviaJudge(gs: GameState, q: TriviaPendingQuestion): void {
	const content = document.createElement('div');
	// The QUESTION first (and emphasised): the judge can't rule "right or wrong" without seeing
	// what was asked. It leads the content so a screen reader reads it right after the title.
	if (q.prompt) {
	  const question = document.createElement('p');
	  question.className = 'trivia-judge-question';
	  const strong = document.createElement('strong');
	  strong.textContent = tSync('game.trivia_judge_question', { prompt: q.prompt });
	  question.appendChild(strong);
	  content.appendChild(question);
	}
	const answered = document.createElement('p');
	const answererName = gs.players.find(p => p.id === q.playerId)?.name ?? '';
	answered.textContent = tSync('game.trivia_answered', { player: answererName, answer: q.submitted ?? '' });
	content.appendChild(answered);
	if (q.correctAnswer) {
	  const reveal = document.createElement('p');
	  reveal.textContent = tSync('game.trivia_reveal', { correct: q.correctAnswer });
	  content.appendChild(reveal);
	}
	dialogManager.show({
	  title: tSync('game.trivia_judge_title', { answer: q.submitted ?? '' }),
	  contentElement: content,
	  plainButtons: true,
	  dismissable: false, // mandatory: the verdict is the only way forward — Núria's accidental Escape stalled the whole table
	  buttons: [
		{ label: tSync('game.trivia_judge_correct'), variant: 'primary' as const, action: () => { dialogManager.close(); triviaDialogKey = null; void gameManager.triviaJudge(true); } },
		{ label: tSync('game.trivia_judge_wrong'), variant: 'secondary' as const, action: () => { dialogManager.close(); triviaDialogKey = null; void gameManager.triviaJudge(false); } },
	  ],
	});
  }

  function reconcileTriviaModals(gs: GameState | null | undefined, myId: string | null): void {
	const trivia = gs?.trivia;
	let desiredKey: string | null = null;
	let open: (() => void) | null = null;
	if (gs && trivia && myId) {
	  if (trivia.pendingJudgeSetup && trivia.pendingJudgeSetup.hostId === myId) {
		desiredKey = 'judgeSetup';
		open = () => openTriviaJudgeSetup(gs);
	  } else if (trivia.pendingMove && trivia.pendingMove.playerId === myId) {
		const options = trivia.pendingMove.options;
		desiredKey = `move:${options.join(',')}`;
		open = () => openTriviaMove(gs, options);
	  } else if (trivia.pendingQuestion) {
		const q = trivia.pendingQuestion;
		if (q.playerId === myId && !q.submitted) {
		  desiredKey = `answer:${q.questionId}`;
		  open = () => openTriviaAnswer(gs, q);
		} else if (q.judgeId === myId && q.submitted) {
		  desiredKey = `judge:${q.questionId}`;
		  open = () => openTriviaJudge(gs, q);
		}
	  }
	}
	if (desiredKey === triviaDialogKey) return;
	if (triviaDialogKey !== null) closeTriviaDialog(triviaDialogKey);
	triviaDialogKey = desiredKey;
	// Pace the dialog to the piece's walk: deferVisual holds the open until the move settles when
	// the gate is armed (a move just happened), and runs it immediately otherwise (roll, judge…).
	if (open) {
	  const show = open;
	  if (announcementGate) announcementGate.deferVisual(show);
	  else show();
	}
  }

  // The destination picker is NON-modal (you can leave it to explore the board); the rest are
  // modal. Close each the right way, and clear the board's move highlights when leaving the picker.
  function closeTriviaDialog(key: string): void {
	if (key.startsWith('move:')) {
	  dialogManager.closeNonModal();
	  (familyViews.get('trivia') as TriviaFamilyView | undefined)?.triviaBoard.setMoveOptions(null, null);
	} else {
	  dialogManager.close();
	}
  }

  function reconcileModals(gs: GameState | null | undefined): void {
	const desired = desiredModal(gs, gameManager.getMyPlayerId());

	if (desired.kind === 'raceChoice') openRaceChoiceModal(desired.data);
	else closeRaceChoiceModal();

	if (desired.kind === 'auction') openAuctionModal(desired.data);
	else closeAuctionModal();

	if (desired.kind === 'tradeReview') openTradeReviewModal(desired.data);
	else if (desired.kind === 'tradeWaiting') openTradeWaitingModal(desired.data);
	else closeTradeModal();

	reconcileTriviaModals(gs, gameManager.getMyPlayerId());
  }

  // ── Live events (instant feedback; the reconciler covers reconnect) ──

  gameManager.on('auctionStarted', (data) => {
	openAuctionModal({
	  squareIndex: data.squareIndex,
	  squareName: data.squareName,
	  currentBid: 0,
	  highestBidderName: null,
	  secondsRemaining: data.bidTimeoutSeconds,
	});
  });

  gameManager.on('auctionEnded', () => {
	// The server announces the result by voice; we just close the modal (which restores focus).
	// A client that was still bidding when the gavel fell hears the clock stop with a final
	// ding; one who already passed (modal closed, clock stopped) stays silent.
	const wasBidding = auctionDialog.isOpen();
	closeAuctionModal();
	if (wasBidding) soundEvents.playEvent('auction.end');
  });

  gameManager.on('bidPlaced', (data) => {
	const myPlayer = gameManager.getMyPlayer();
	auctionDialog.update({
	  secondsRemaining: data.bidTimeoutSeconds,
	  currentBid: data.amount,
	  highestBidderName: data.bidderName,
	  playerMoney: myPlayer?.money ?? 0
	});
  });

  gameManager.on('auctionTimerTick', (data) => {
	const myPlayer = gameManager.getMyPlayer();
	auctionDialog.update({
	  secondsRemaining: data.secondsRemaining,
	  currentBid: data.currentBid,
	  highestBidderName: data.highestBidderName ?? null,
	  playerMoney: myPlayer?.money ?? 0
	});

	// Voice the countdown at thresholds, only while this client is still bidding.
	const warn = nextAuctionWarning(data.secondsRemaining, lastAuctionWarnSecond);
	lastAuctionWarnSecond = warn.lastWarned;
	if (warn.announce && auctionDialog.isOpen()) {
	  announce(createAnnouncement('game.auction_seconds_left', { seconds: data.secondsRemaining }));
	}
  });

  // A trade was proposed. The server voices it; we open the right modal: the target reviews
  // the offer, the proposer waits (frozen) with the option to cancel. Other players see nothing.
  gameManager.on('tradeProposed', (data) => {
	if (data.isForMe) {
	  openTradeReviewModal({
		tradeId: data.tradeId,
		initiatorName: data.initiatorName,
		offered: data.offered,
		requested: data.requested,
	  });
	} else if (data.isMine) {
	  openTradeWaitingModal({ tradeId: data.tradeId, targetName: data.targetName });
	}
  });

  // A trade was resolved (accepted / declined / cancelled). The server announces the outcome;
  // we just dismiss any open trade modal for the two parties and restore focus to the board.
  gameManager.on('tradeResolved', (data) => {
	if (data.involvesMe) closeTradeModal();
  });

  // ============================================
  // DEBT & BANKRUPTCY EVENTS
  // ============================================
  // Bankruptcy and game-over are entirely state-driven: the server owns the spoken voice
  // (game.player_bankrupt / game.game_over) and the end screen + board update from the
  // gameStateUpdated push (state.isGameOver). There is no client bankruptcy event to wire.

  // The host permanently deleted this game: inform the player, drop the local entry,
  // and send them back to the lobby (their progress is gone).
  gameClient.on('gameDeleted', (data) => {
	if (data?.gameId && data.gameId !== gameId) return;
	GameSessionStore.removeGame(gameId);
	dialogManager.init();
	dialogManager.showInfo({
	  title: 'Game deleted',
	  titleI18nKey: 'game.game_deleted_title',
	  message: 'The host deleted this game.',
	  messageI18nKey: 'game.game_deleted_message',
	  onClose: () => { window.location.href = '/'; }
	});
  });

  // In-game chat: floating accessible panel + persistent role="log" voicing. Sends are
  // authenticated with the same session secret the rejoin uses.
  chatPanel.init({
	t: (key, vars) => tSync(key, vars),
	getPlayers: () => gameManager.getAllPlayers(),
	getMyPlayerId: () => gameManager.getMyPlayerId(),
	send: text => gameClient.sendChatMessage(gameId, playerSession.playerId, playerSession.playerSecretId, text),
	focusBoard: () => board.focus(),
  });
  gameClient.on('chatMessage', m => chatPanel.addMessage(m));
  gameClient.on('chatHistory', ms => chatPanel.setHistory(ms));
	gameClient.on('voiceChatEnabledChanged', data => voicePanel.setGameEnabled(data.enabled, true));
	gameClient.on('voiceParticipantMutedByHost', data => voicePanel.handleHostMute(data));

  // Try to connect automatically and join the game
  try {
	const connected = await gameManager.connectToServer();

	if (connected) {
	  // joinGameWithAuth announces "connected to game" itself — announcing here too made
	  // the line (and the code that follows it) read twice.
	  await gameManager.joinGameWithAuth(gameId, playerSession.playerId, playerSession.playerSecretId);
	} else {
	  console.warn('Could not connect to server');
	  globalAnnounce(createAnnouncement('game.connection_failed', {}));
	}
  } catch (e) {
	console.warn('Error connecting or joining game:', e);
	const errorMsg = e instanceof Error ? e.message : String(e);
	globalAnnounce(createAnnouncement('game.connection_error', { message: errorMsg }));
  }

  // initial render
  renderPlayers();

  // build the group map (squares indexed by their group's colour value) for group-navigation shortcuts
  const groupMap = new Map<string, number[]>();
  gameManager.getSquares().forEach((s, i) => { if (s.color) { const c = String(s.color).toLowerCase().replace(/[^a-z]/g, ''); const arr = groupMap.get(c) || []; arr.push(i); groupMap.set(c, arr); } });

  // load keymap (served by the server as the single source of truth — see EngineKeymap)
  let keyMap: Record<string, any> = {};
  try { const kmResp = await fetch('/api/config/keymap'); if (kmResp.ok) keyMap = await kmResp.json(); } catch (e) {}
  // The board's group-navigation shortcuts are package-specific (each board brings its own colours),
  // so build them from the game's groups and merge them over the static engine keymap.
  Object.assign(keyMap, buildGroupKeyMap(gameManager.getCurrentGameState()?.groups));

  // global announcer already created

  // create game commands instance (uses gameManager for data)
  // Wrapper that converts already-translated text to AnnouncementEvent.
  // These are user-initiated info queries (money, release passes, navigation), so
  // they are announced instantly instead of waiting behind the game-event queue.
  const announceText = (text: string) => globalAnnounce(createAnnouncement('_raw', { text }), { instant: true });

  const gameCommands = new GameCommands({
	getPlayers: () => tokenAnimator.visiblePlayers(gameManager.getAllPlayers()),
	announce: announceText,
	t,
	getGroupMap: () => groupMap,
	groupLabel: (square) => squareGroupLabel(square, tSync, localizeColor),
	nextOccupiedFn: (start: number, forward = true) => {
	  // Optimized: search directly in memory state. Use the VISIBLE positions so a
	  // mid-hop token counts as occupying the square it is currently on, not its
	  // destination — this defers revealing where a moving player will land.
	  const players = tokenAnimator.visiblePlayers(gameManager.getAllPlayers());
	  return gameBoard.nextOccupied(start, forward, players);
	},
	setActiveIndex: (i: number, announceMove = true) => gameBoard.setActiveIndex(i, true, announceMove),
	getCurrentTurn: () => gameManager.getCurrentGameState()?.currentTurn ?? undefined,
	getMyPlayerId: () => gameManager.getMyPlayerId() ?? undefined,
	getPlayerMoney: (id: string) => gameManager.getPlayerMoney(id),
	getPlayerReleasePasses: (id: string) => gameManager.getPlayer(id)?.releasePasses || 0,
	getPendingDebts: () => gameManager.getCurrentGameState()?.pendingDebts || [],
	getFreeParkingPot: () => gameManager.getFreeParkingPot(),
	formatNumber: (value) => i18nBinder.formatNumber(value),
	getActiveAuction: () => {
	  const a = auctionDialog.getStatus();
	  if (!a) return null;
	  return {
		squareName: a.squareName,
		currentBid: a.currentBid,
		highestBidderName: a.highestBidderName,
		secondsRemaining: a.secondsRemaining,
		playerMoney: a.playerMoney
	  };
	}
  });

  // attach key handlers
  attachKeyHandlers({
	board,
	keyMap,
	gameBoard: boardNav,
	gameFamily: () => gameManager.getCurrentGameState()?.gameType ?? 'property',
	gameCommands,
	gameManager,
	focusPlayersPanel: () => { playerPanel.focus(); },
	showHelp: () => {
	  const family = gameManager.getCurrentGameState()?.gameType ?? 'property';
	  // Card families have no spatial board: they hide the movement/dice/economy keymap
	  // rows and the "0–9 jump to a square" row, and add their own hand/status keys (which
	  // live outside keymap.json). Board families keep the keymap as their whole story.
	  const isCard = isToolbarlessFamily(family);
	  showHelpDialog(keyMap, {
		hiddenCommands: family === 'property' ? undefined
		  : isCard ? CARD_FAMILY_HIDDEN_COMMANDS : PROPERTY_ONLY_COMMANDS,
		// Bindings tagged with another family (e.g. "s" = route landmarks, family "race")
		// are inert here — and their letters may be shadowed by package group keys — so
		// their rows don't belong in this game's help.
		activeFamily: family,
		// The card families' hand/status keys live outside keymap.json; the active board
		// is their single source of truth (it declares them where it routes them).
		extraShortcuts: currentFamilyView()?.helpShortcuts?.() ?? [],
		showNumberNav: !isCard,
	  });
	},
	showBoardHelp: () => showBoardHelpDialog(),
	showGameRules: () => {
	  // Ctrl+Shift+F1: the active family's rule list. Property isn't in the family registry
	  // (it's the default surface), so it builds from the state's settings directly; every
	  // other family answers through its view.
	  const gs = gameManager.getCurrentGameState();
	  const lines = (gs?.gameType ?? 'property') === 'property'
		? buildPropertyRulesLines(gs?.settings, (k, v) => i18nBinder.tSync(k, v))
		: currentFamilyView()?.rulesSummary?.() ?? null;
	  if (lines && lines.length > 0) showGameRulesDialog(lines);
	  else globalAnnounce(createAnnouncement('game.game_rules_none', {}), { instant: true });
	},
	openTradeBuilder,
	reenterAuction,
	panelNav: {
	  next: () => panelNavigator.next(),
	  prev: () => panelNavigator.prev(),
	  focusActions: () => panelNavigator.focusById('actions'),
	  focusDialog: () => {
		// Always consume the Ctrl+D keystroke to prevent the browser from intercepting it
		const success = panelNavigator.focusById('dialog');
		if (!success) {
		  globalAnnounce(createAnnouncement('game.no_dialog', {}), { instant: true });
		}
		return true; // Always return true to prevent browser's "add to favorites" on Ctrl+D
	  },
	},
	onPayReleaseCost: payReleaseCostSettled,
	onUseReleasePass: useReleasePassSettled,
	onEndTurn: endTurnSettled,
	onManageProperties: openManageProperties,
	onBuyProperty: buyPropertySettled,
	onRollDice: rollDiceSettled,
	onShowPropertyInfo: () => openSquareMenu(gameBoard.getActiveIndex()),
	onToggleSound: () => toggleSound(),
	onLeaveGame: confirmLeaveGame,
	history: {
	  prev: announceHistoryPrev,
	  next: announceHistoryNext,
	  first: announceHistoryFirst,
	  last: announceHistoryLast,
	},
	onToggleChat: () => { if (voicePanel.isOpen()) voicePanel.closePanel(); chatPanel.toggle(); },
	onFocusChatInput: () => { if (voicePanel.isOpen()) voicePanel.closePanel(); chatPanel.focusInput(); },
	onToggleVoicePanel: () => voicePanel.togglePanel(),
	onToggleVoiceMute: () => { void voicePanel.toggleSelfMute(); },
	onAnnounceVoiceSpeakers: () => voicePanel.announceActiveSpeakers(),
	// C off the property board: "how am I doing?" is your board identity there —
	// the race squadron, or the track piece and its colour. The family owns the phrasing.
	onAnnounceIdentity: () => {
	  const gs = gameManager.getCurrentGameState();
	  const myId = gameManager.getMyPlayerId();
	  const family = gs && familyFor(gs.gameType);
	  if (!gs || !myId || !family) return false;
	  const identity = family.identityAnnouncement(gs, myId, id => gameManager.getPlayer(id));
	  if (!identity) return false;
	  announce(createAnnouncement(identity.key, identity.vars), { instant: true });
	  return true;
	},
	onReaction: () => {
	  // The exploding reaction key (N): play my Nope on the pending action, from anywhere. A
	  // silent-ish miss (no Nope in hand) still consumes the key and says so.
	  const gs = gameManager.getCurrentGameState();
	  const myId = gameManager.getMyPlayerId();
	  if (gs?.gameType !== 'exploding' || !myId) return false;
	  const hand = gs.exploding?.seats.find(s => s.playerId === myId)?.hand ?? [];
	  const deck = gs.explodingDeck ?? [];
	  const nope = hand.find(c => deck.find(d => d.id === c.cardId)?.type === 'nope');
	  if (!nope) {
		announce(createAnnouncement('game.exploding_no_nope', {}), { instant: true });
		return true;
	  }
	  void gameManager.explodingNope(nope.instanceId);
	  return true;
	},
	onInvalidSquareNumber: () => {
	  // Speak the error so a screen-reader user knows the typed number was out of range,
	  // and flash a transient toast so a sighted player sees the same cue.
	  globalAnnounce(createAnnouncement('game.square_not_found', {}), { instant: true });
	  boardToast.show(tSync('game.square_not_found'), 'loss');
	}
  });

  // Keep keyboard focus inside the game page: Tab / Shift+Tab wrap around the board's
  // controls instead of escaping to the browser chrome. While a modal <dialog> is open
  // the trap scopes to that dialog so focus stays inside it; a non-modal dialog keeps the
  // body root so Tab circulates the whole page without ever leaving it.
  new FocusTrap({ getRoot: () => document.body, scopeToOpenModal: true }).activate();

  // initial focus: put the real DOM focus on the board container so keyboard
  // navigation works immediately. The cursor itself is placed on my token once
  // the server state arrives (see the gameStateUpdated handler).
  setTimeout(() => board.focus(), 0);
}

initBoard();

board.addEventListener('focus', (e) => {
  if (e.target !== board) return;
  // A family whose home surface lives INSIDE the container (journey's hand) takes the
  // focus — there is no perimeter cursor to narrate there. ESC-parks-to-board and every
  // "back to the board" flow land on the hand through this same door.
  if (currentFamilyView()?.onBoardFocus?.()) return;
  if (!gameBoard) return;
  // Entering the board: place the cursor if unset, then narrate where we are.
  if (gameBoard.getActiveIndex() === -1) gameBoard.setActiveIndex(0, false, false);
  gameBoard.announceCursor();
}, true);

function renderPlayers() {
  if (!gameBoard) return;
  // Use in-memory state directly - no copies or synchronization. The token animator
  // overrides where each token is DRAWN so multi-step moves walk square by square, and
  // flags the travelling token so the board gives it the hop-and-grow movement animation.
  gameBoard.renderPlayers(
	gameManager.getAllPlayers(),
	t,
	(id, pos) => tokenAnimator.displayPosition(id, pos),
	(id) => tokenAnimator.isPlayerMoving(id)
  );
}

export { };
