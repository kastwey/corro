/**
 * The navigation surface the keyboard layer drives. The property Board satisfies it with its
 * spatial perimeter; the race board satisfies it with its topological lanes/zones — same keys,
 * per-family geometry.
 */
export interface BoardNavigator {
	moveLeft(): boolean;
	moveRight(): boolean;
	moveUp(): boolean;
	moveDown(): boolean;
	/** My own pieces: forward/backward cycle in a race; the single token in property
	 *  (where the direction is irrelevant and may be ignored). */
	goToMe(forward?: boolean): boolean;
	/** Navigate to the next piece on the board (any player). Optional for property board. */
	goToNextPiece?(): boolean;
	/** Navigate to the previous piece on the board (any player). Optional for property board. */
	goToPrevPiece?(): boolean;
	/** Beginning of the CURRENT lane/context (a11y Home convention): the property board's
	 *  GO corner; the race circuit's square 1 or a seat zone's first cell. */
	goToStart(): boolean;
	/** The board's route landmarks: in a race, a forward/backward cycle over EVERY active
	 *  seat's salida and corridor entry (in ring order); the property board treats it as
	 *  its GO corner (direction ignored). */
	goToMyStart(forward?: boolean): boolean;
	/** Race only: cycle the circuit's barriers (anyone's), forward/backward. */
	goToBarrier?(forward?: boolean): boolean;
	getActiveIndex(): number;
	setActiveIndex(index: number, triggerEvents?: boolean, announceMove?: boolean): void;
}
import { GameCommands } from './gameCommands.js';
import type { GameManager } from './gameManager.js';
import { isSimultaneousFamily } from './familyTraits.js';

export interface KeyHandlersOptions {
	board: HTMLElement;
	// optional mapper loaded from keymap.json
	keyMap?: Record<string, any>;
	// object instances that handle the logic
	gameBoard: BoardNavigator;
	/** The current game's family ("property" | "race" | "track"); gates the family-specific
	 *  keys — property-only commands go inert off the property board, and a keymap entry
	 *  tagged with a family only fires there. Defaults to "property" when absent. */
	gameFamily?: () => string;
	gameCommands: GameCommands;
	gameManager?: GameManager; // Reference to gameManager for squares
	focusPlayersPanel: () => void; // Move focus into the always-visible players panel
	showHelp?: () => void; // Opens the keyboard shortcuts help modal (Ctrl+F1)
	showBoardHelp?: () => void; // Opens the board guide / rules modal (F1)
	showGameRules?: () => void; // Opens the active game-rules modal (Ctrl+Shift+F1)
	openTradeBuilder?: () => void; // Opens the player-to-player trade builder modal
	reenterAuction?: () => void; // Reopens the auction modal I'm still part of (after dismissing it)
	history?: { prev: () => void; next: () => void; first: () => void; last: () => void }; // Announcement history navigation
	onInvalidSquareNumber?: (n: number) => void; // Typed a square number out of range
	// Panel navigation (F6 / Shift+F6 across landmark regions, Ctrl+Shift+A to the action
	// bar, Ctrl+D to the open non-modal dialog)
	panelNav?: { next: () => boolean; prev: () => boolean; focusActions: () => boolean; focusDialog: () => boolean };
	// Direct action shortcuts surfaced on the action bar
	onPayReleaseCost?: () => void;
	onUseReleasePass?: () => void;
	/** Roll from the bare key / shortcut. Preferred over gameManager.rollDice so app.ts can
	 *  route it through the settle guard (no rolling while the previous move is being told). */
	onRollDice?: () => void;
	onEndTurn?: () => void;
	onManageProperties?: () => void;
	onBuyProperty?: () => void;
	onShowPropertyInfo?: () => void; // Opens the property-info dialog for the cursor square
	onToggleSound?: () => void; // Toggles the game-event earcons on/off
	onLeaveGame?: () => void; // Opens the confirm dialog to abandon the game (bankruptcy)
	onToggleChat?: () => void; // Opens/collapses the chat panel (Ctrl+Shift+H)
	onFocusChatInput?: () => void; // Jumps to the chat compose box, opening the panel if needed (Ctrl+Shift+R)
	/** C off the property board: announce my board identity (squadron / piece colour). */
	onAnnounceIdentity?: () => boolean;
	/** The generic real-time REACTION key (exploding: play a Nope). Global — it fires off-turn
	 *  from anywhere the board doesn't already own the key. Returns whether it handled it. */
	onReaction?: () => boolean;
}

function normalizeKeySpec(ev: KeyboardEvent) {
	const parts: string[] = [];
	if (ev.ctrlKey) parts.push('ctrl');
	if (ev.altKey) parts.push('alt');
	if (ev.shiftKey) parts.push('shift');
	if (ev.metaKey) parts.push('meta');
	const k = normalizeKeyName(ev.key);
	parts.push(k);
	return parts.join('+');
}

/** Canonical, keymap-friendly name for a key. The space bar reports " " (or the
 *  legacy "Spacebar"); we expose it as "space" so it can be mapped in keymap.json. */
function normalizeKeyName(rawKey: string): string {
	const k = rawKey.toLowerCase();
	return k === ' ' || k === 'spacebar' ? 'space' : k;
}

/** Commands that act on the board cursor (navigation + reading the focused
 *  square) or activate the current turn from the bare keys. They only run while
 *  the board (role="application") owns focus, so they can't be triggered by
 *  accident from another panel. Their modifier-based aliases stay global because
 *  they carry ctrl/alt/meta (e.g. Ctrl+E end turn, Ctrl+B buy, Ctrl+arrows
 *  history) — see the isBareKey check in the handler. */
const BOARD_SCOPED_COMMANDS = new Set([
	'MoveLeft', 'MoveRight', 'MoveUp', 'MoveDown',
	'GoToMe', 'GoToStart', 'GoToMyStart', 'GoToBarrier', 'GoToNextPiece', 'GoToPrevPiece', 'NextOccupied', 'GroupNext', 'OwnedNext', 'UnownedNext',
	'WhoIsOnSquare', 'AnnounceOwner', 'AnnounceGroup', 'AnnouncePrice',
	'ShowPropertyInfo',
	'RollDice', 'EndTurn',
]);

/** Directional board movement. At the edge of the board these are a no-op (moveInDirection
 *  returns false because there's no neighbouring square), but the key must STILL be consumed
 *  while the board owns focus: with the browser's "caret browsing" (F7) enabled, an unhandled
 *  ArrowUp on the top row would move the document's text caret OUT of the board and steal
 *  focus to the page chrome. Consuming it keeps the caret inside the board. */
/** Commands that only make sense in the PROPERTY family (economy, squares, trades,
 *  auctions, manual turn end). On the other families' boards they go inert and disappear
 *  from the shortcuts help — pressing "c" must not announce a meaningless 0€.
 *  NextOccupied is NOT here: off the property board the executor redirects it to the
 *  all-pieces cycle (N / Shift+N), so it stays live in every family. */
export const PROPERTY_ONLY_COMMANDS = new Set([
	'WhoIsOnSquare', 'ShowPropertyInfo', 'AnnounceOwner', 'AnnounceGroup', 'AnnouncePrice',
	'AnnounceCurrentPlayerMoney', 'AnnounceCurrentPlayerReleasePasses', 'AnnounceFreeParkingPot',
	'AnnounceAuction', 'AnnounceCurrentBid', 'ReenterAuction', 'OpenTradeBuilder',
	'PayReleaseCost', 'UseReleasePass', 'BuyProperty', 'ManageProperties', 'EndTurn',
	'OwnedNext', 'UnownedNext', 'GroupNext',
]);

const BOARD_MOVEMENT_COMMANDS = new Set([
	'MoveLeft', 'MoveRight', 'MoveUp', 'MoveDown',
]);

/** What the shortcuts help hides in a CARD family (journey, assembly, draft, shedding).
 *  On top of the property economy, these families have no spatial board at all: no squares
 *  to walk (Move*, GoToStart, NextOccupied), no piece to jump to (GoToMe), no dice
 *  (RollDice) and no circuit landmarks (GoToMyStart/GoToBarrier — race-tagged anyway).
 *  Their own S key is the documented "how am I doing?", so C (AnnounceMyStatus) is a
 *  redundant alias here and is dropped too. All still route at runtime — they simply
 *  don't belong in this game's shortcut list. */
export const CARD_FAMILY_HIDDEN_COMMANDS = new Set<string>([
	...PROPERTY_ONLY_COMMANDS,
	...BOARD_MOVEMENT_COMMANDS,
	'GoToMe', 'GoToStart', 'GoToMyStart', 'GoToBarrier',
	'NextOccupied', 'RollDice', 'AnnounceMyStatus',
]);

/** Read-only "announce" commands that merely speak the current state (money, release-pass
 *  cards, the Free Parking pot, the turn, the auction status, announcement history). They
 *  mutate nothing, so they stay available even while a modal dialog owns focus — a blind
 *  player can check their situation without first dismissing the dialog. */
const DIALOG_READONLY_COMMANDS = new Set([
	'AnnounceAuction',
	'AnnounceCurrentBid',
	'AnnounceCurrentPlayerMoney',
	'AnnounceMyStatus',
	'AnnounceCurrentPlayerReleasePasses',
	'AnnounceFreeParkingPot',
	'AnnounceTurn',
	'HistoryPrev', 'HistoryNext', 'HistoryFirst', 'HistoryLast',
	'ToggleSound',
]);

/** The active family, defaulting to "property" (lobby, tests, property boards). */
function familyOf(opts: KeyHandlersOptions): string {
	return opts.gameFamily?.() ?? 'property';
}

function createCommandExecutor(opts: KeyHandlersOptions) {
	return function executeCommand(cmd: string, args?: any): boolean {
		try {
			switch (cmd) {
				case 'WhoIsOnSquare':
					return opts.gameCommands.announcePlayersOnSquare(opts.gameBoard.getActiveIndex());
				case 'AnnounceOwner':
					return opts.gameCommands.announceOwner(opts.gameBoard.getActiveIndex(), opts.gameManager?.getSquares() || []);
				case 'AnnounceTurn':
					// T is kept in every family (players reach for it), but a SIMULTANEOUS
					// game (draft) has no turn order — so it answers "no turns here" instead
					// of a nonexistent turn. Same family-aware pattern as C (AnnounceMyStatus).
					return isSimultaneousFamily(familyOf(opts))
						? opts.gameCommands.announceNoTurns()
						: opts.gameCommands.announceTurn();
				case 'AnnounceCurrentPlayerMoney':
					return opts.gameCommands.announceCurrentPlayerMoney();
				case 'AnnounceMyStatus':
					// One key, one question — "how am I doing?" — answered per family:
					// your cash on a property board; your squadron / piece colour on the
					// others, where money is meaningless and used to leave C dead.
					return familyOf(opts) === 'property'
						? opts.gameCommands.announceCurrentPlayerMoney()
						: opts.onAnnounceIdentity?.() ?? false;
				case 'AnnounceCurrentPlayerReleasePasses':
					return opts.gameCommands.announceCurrentPlayerReleasePasses();
				case 'AnnounceGroup':
					return opts.gameCommands.announceGroup(opts.gameBoard.getActiveIndex(), opts.gameManager?.getSquares() || []);
				case 'AnnouncePrice':
					return opts.gameCommands.announcePrice(opts.gameBoard.getActiveIndex(), opts.gameManager?.getSquares() || []);
				case 'GoToMe':
					return opts.gameBoard.goToMe(args?.forward !== false);
				case 'GoToNextPiece':
					return opts.gameBoard.goToNextPiece?.() ?? false;
				case 'GoToPrevPiece':
					return opts.gameBoard.goToPrevPiece?.() ?? false;
				case 'GoToStart':
					return opts.gameBoard.goToStart();
				case 'GoToMyStart':
					return opts.gameBoard.goToMyStart(args?.forward !== false);
				case 'GoToBarrier':
					return opts.gameBoard.goToBarrier?.(args?.forward !== false) ?? false;
				case 'NextOccupied': {
					// Exploding: there is no board to cycle, so N is repurposed (family-scoped) as
					// the real-time REACTION key — play a Nope. Global: it works off-turn from
					// anywhere the board didn't already consume N (the board-local N does the
					// deliberate jump-to-Nope when it holds focus).
					if (familyOf(opts) === 'exploding') return opts.onReaction?.() ?? false;
					// On the race and track boards, N/Shift+N cycle every piece on the board;
					// on the property board, the occupied squares.
					if (familyOf(opts) !== 'property') {
						const forward = args && typeof args.forward === 'boolean' ? args.forward : true;
						return forward ? opts.gameBoard.goToNextPiece?.() ?? false : opts.gameBoard.goToPrevPiece?.() ?? false;
					}
					const forward = args && typeof args.forward === 'boolean' ? args.forward : true;
					const start = opts.gameBoard.getActiveIndex() === -1 ? 0 : opts.gameBoard.getActiveIndex();
					return opts.gameCommands.nextOccupied(start, forward, opts.gameManager?.getSquares() || []);
				}
				case 'FocusPlayers':
					opts.focusPlayersPanel();
					return true;
				case 'OpenTradeBuilder':
					if (opts.openTradeBuilder) {
						opts.openTradeBuilder();
						return true;
					}
					return false;
				case 'ReenterAuction':
					if (opts.reenterAuction) {
						opts.reenterAuction();
						return true;
					}
					return false;
				case 'GroupNext': {
					const group = args && args.group ? String(args.group) : '';
					const forward = args && typeof args.forward === 'boolean' ? args.forward : true;
					return opts.gameCommands.groupNext(opts.gameBoard.getActiveIndex(), group, forward);
				}
				case 'OwnedNext': {
					const forward = args && typeof args.forward === 'boolean' ? args.forward : true;
					return opts.gameCommands.ownedNext(
						opts.gameBoard.getActiveIndex(),
						forward,
						opts.gameManager?.getSquares() || []
					);
				}
				case 'UnownedNext': {
					const forward = args && typeof args.forward === 'boolean' ? args.forward : true;
					return opts.gameCommands.unownedNext(
						opts.gameBoard.getActiveIndex(),
						forward,
						opts.gameManager?.getSquares() || []
					);
				}
				case 'MoveLeft':
					return opts.gameBoard.moveLeft();
				case 'MoveRight':
					return opts.gameBoard.moveRight();
				case 'MoveUp':
					return opts.gameBoard.moveUp();
				case 'MoveDown':
					return opts.gameBoard.moveDown();
				case 'RollDice':
					if (opts.onRollDice) {
						opts.onRollDice();
						return true;
					}
					if (opts.gameManager?.rollDice) {
						opts.gameManager.rollDice();
						return true;
					}
					return false;
				case 'AnnounceFreeParkingPot':
					return opts.gameCommands.announceFreeParkingPot();
				case 'AnnounceAuction':
					return opts.gameCommands.announceAuctionStatus();
				case 'AnnounceCurrentBid':
					return opts.gameCommands.announceCurrentBid();
				case 'ToggleChat':
					if (opts.onToggleChat) { opts.onToggleChat(); return true; }
					return false;
				case 'FocusChatInput':
					// Returning true consumes the keystroke — important here, or the
					// browser's own Ctrl+Shift+R (hard reload) would fire.
					if (opts.onFocusChatInput) { opts.onFocusChatInput(); return true; }
					return false;
				case 'ShowHelp':
					if (opts.showHelp) {
						opts.showHelp();
						return true;
					}
					return false;
				case 'ShowBoardHelp':
					if (opts.showBoardHelp) {
						opts.showBoardHelp();
						return true;
					}
					return false;
				case 'ShowGameRules':
					if (opts.showGameRules) {
						opts.showGameRules();
						return true;
					}
					return false;
				case 'HistoryPrev':
					if (opts.history) { opts.history.prev(); return true; }
					return false;
				case 'HistoryNext':
					if (opts.history) { opts.history.next(); return true; }
					return false;
				case 'HistoryFirst':
					if (opts.history) { opts.history.first(); return true; }
					return false;
				case 'HistoryLast':
					if (opts.history) { opts.history.last(); return true; }
					return false;
				case 'NextPanel':
					return opts.panelNav ? opts.panelNav.next() : false;
				case 'PrevPanel':
					return opts.panelNav ? opts.panelNav.prev() : false;
				case 'FocusActions':
					return opts.panelNav ? opts.panelNav.focusActions() : false;
				case 'FocusDialog':
					return opts.panelNav ? opts.panelNav.focusDialog() : false;
				case 'PayReleaseCost':
					if (opts.onPayReleaseCost) { opts.onPayReleaseCost(); return true; }
					return false;
				case 'UseReleasePass':
					if (opts.onUseReleasePass) { opts.onUseReleasePass(); return true; }
					return false;
				case 'EndTurn':
					if (opts.onEndTurn) { opts.onEndTurn(); return true; }
					return false;
				case 'BuyProperty':
					if (opts.onBuyProperty) { opts.onBuyProperty(); return true; }
					return false;
				case 'ManageProperties':
					if (opts.onManageProperties) { opts.onManageProperties(); return true; }
					return false;
				case 'ShowPropertyInfo':
					if (opts.onShowPropertyInfo) { opts.onShowPropertyInfo(); return true; }
					return false;
				case 'ToggleSound':
					if (opts.onToggleSound) { opts.onToggleSound(); return true; }
					return false;
				case 'LeaveGame':
					if (opts.onLeaveGame) { opts.onLeaveGame(); return true; }
					return false;
				default:
					return false;
			}
		} catch (e) {
			console.debug('command execution error', cmd, e);
			return false;
		}
	};
}

export function attachKeyHandlers(opts: KeyHandlersOptions) {
	const execute = createCommandExecutor(opts);

	/** True when keyboard focus is on the board container (or one of its children). */
	function isOnBoard(target: HTMLElement | null): boolean {
		return !!(target && (target === opts.board || opts.board.contains(target)));
	}

	// Numeric square navigation: typing a digit jumps to that square. Consecutive
	// digits typed within a short window compose a multi-digit number (e.g. "2"
	// then "3" -> square 23). After the window lapses the next digit starts fresh.
	const digitWindowMs = 500;
	let numberBuffer = '';
	let lastDigitAt = 0;

	function handleDigit(digit: string): void {
		const now = Date.now();
		if (now - lastDigitAt > digitWindowMs) numberBuffer = '';
		// Ignore a leading zero so it never becomes "0" or pads the number.
		if (numberBuffer === '' && digit === '0') return;
		lastDigitAt = now;
		numberBuffer += digit;

		const n = parseInt(numberBuffer, 10);
		// The typed number is the square AS ANNOUNCED to the player. The boards index
		// differently: the race circuit and the track are 1-based ("Casilla 1..68/100" ARE
		// their indices), while the property board stores squares 0-based behind its
		// 1-based labels.
		const gs = opts.gameManager?.getCurrentGameState?.();
		const oneBasedSize = gs?.raceBoard?.circuitLength ?? gs?.trackBoard?.trackLength;
		const size = oneBasedSize ?? opts.gameManager?.getSquares().length ?? 0;

		// No spatial board at all (card families): digits mean nothing here — stay silent
		// instead of announcing "square not found" for a square that cannot exist.
		if (size === 0) return;

		if (n >= 1 && n <= size) {
			opts.gameBoard.setActiveIndex(oneBasedSize ? n : n - 1);
		} else {
			// Out of range: reset so the next digit starts a fresh number.
			numberBuffer = '';
			lastDigitAt = 0;
			opts.onInvalidSquareNumber?.(n);
		}
	}

	function globalKeyHandler(ev: KeyboardEvent) {
		const target = ev.target as HTMLElement | null;
		const key = ev.key.toLowerCase();
		const fullSpec = normalizeKeySpec(ev);
		const isTextInput = !!(target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || (target as any).isContentEditable));

		// Don't hijack activation keys (Enter / Space) when focus is on a native
		// interactive control (links, buttons, selects): let the browser activate
		// it, otherwise e.g. the "go to board" link would never open because Enter
		// is mapped to rolling the dice.
		const isActivationKey = key === 'enter' || key === ' ' || key === 'spacebar';
		const role = target?.getAttribute('role');
		const isInteractive = !!(target && (
			(target.tagName === 'A' && target.hasAttribute('href')) ||
			target.tagName === 'BUTTON' ||
			target.tagName === 'SELECT' ||
			role === 'link' ||
			role === 'button'
		));
		if (isInteractive && isActivationKey) return;

		// check if focus is inside a dialog (every dialog is a native <dialog>; div-based
		// role="dialog" surfaces are forbidden — see copilot-instructions Accessibility).
		// A NON-modal dialog (data-modal="false") does not trap focus: it behaves like one
		// more panel, so global shortcuts (F6 cycling, Escape back to the board, Ctrl+D)
		// keep working from inside it and it is skipped here.
		const openDialog = target?.closest('dialog[open]') as HTMLElement | null;
		const isInDialog = !!openDialog && openDialog.dataset.modal !== 'false';

		// While a modal dialog owns focus we ignore global shortcuts so they can't disrupt
		// the flow — EXCEPT read-only "announce" queries (money, release passes, Free Parking
		// pot, turn, auction status, history). Those only speak state and never mutate the
		// game, so a blind player can check their situation without leaving the dialog.
		if (isInDialog) {
			// A TEXT field in the dialog (the trivia answer box) must own every key it can
			// type — do NOT hijack letters as queries there. A numeric bid/amount field ignores
			// letters, so the queries stay a harmless convenience only for those.
			const typingText = isTextInput
				&& (target as HTMLInputElement).type !== 'number'
				&& (target as HTMLInputElement).type !== 'range';
			if (!typingText) {
				const dlgMapping = (opts.keyMap || {})[fullSpec] ?? (opts.keyMap || {})[key];
				const dlgCmd = typeof dlgMapping === 'string' ? dlgMapping : dlgMapping?.cmd;
				// Read-only queries only, and NEVER a property-only one outside the property
				// family — auction, Free Parking pot, owner… don't exist in trivia/race/track.
				const propertyOnlyElsewhere = familyOf(opts) !== 'property' && PROPERTY_ONLY_COMMANDS.has(dlgCmd ?? '');
				if (dlgCmd && DIALOG_READONLY_COMMANDS.has(dlgCmd) && !propertyOnlyElsewhere && execute(dlgCmd)) {
					ev.preventDefault();
				}
			}
			return;
		}

		// Escape from anywhere that isn't the board (and isn't a dialog, which owns its
		// own ESC-to-close handled above) returns focus to the board. This gives a
		// keyboard / screen-reader user a single, predictable way back to the game from
		// any panel, list or control. ESC handled within a list toolbar or context menu
		// stops propagation before reaching here, so it still backs out one level first.
		if (key === 'escape' && !isOnBoard(target)) {
			// Escape out of the floating board PICKER (race/trivia/bus destinations) MINIMIZES it
			// to its title bar on the way to the board — it never CLOSES it (that would abandon the
			// pending choice). The highlighted squares stay clickable and the board is now fully
			// visible. Only the minimizable picker responds (it carries `syncMinimize`): the other
			// non-modal dialogs — the trade review, the coup fourré — are decisions to READ, not
			// pickers, so Escape just parks focus on the board and leaves them expanded.
			const minimize = openDialog?.dataset.modal === 'false'
				? (openDialog as unknown as { syncMinimize?: () => void }).syncMinimize
				: undefined;
			if (minimize && openDialog) {
				openDialog.classList.add('dialog--minimized');
				minimize();
			}
			opts.board.focus();
			ev.preventDefault();
			return;
		}

		// The action bar (role="toolbar") governs its own keyboard model: arrows,
		// Home/End move the roving focus and Enter/Space activate the focused
		// button. While focus is inside it, suppress the board's single-key
		// shortcuts so they don't fight the toolbar — but still let F6/Shift+F6
		// (panel cycling) and any modifier combo (e.g. Ctrl+Shift+A) through so
		// the user can leave the toolbar.
		const isInToolbar = !!(target && target.closest('[role="toolbar"]'));
		if (isInToolbar && !ev.ctrlKey && !ev.altKey && !ev.metaKey && key !== 'f6') {
			return;
		}

		// Numeric square navigation (digits compose a number within a short window).
		// Skip when typing in a field or when modifier keys are held. Only acts while
		// the board owns focus, so digits don't move the board cursor from a panel.
		if (!isTextInput && !ev.ctrlKey && !ev.altKey && !ev.metaKey && /^[0-9]$/.test(key)) {
			if (isOnBoard(target)) {
				handleDigit(key);
				ev.preventDefault();
			}
			return;
		}
		// Any other key breaks an in-progress number.
		numberBuffer = '';

		// 1) check mapper
		const rawMap = opts.keyMap || {};
		const specKey = fullSpec.includes('+') ? fullSpec : normalizeKeyName(ev.key);
		const mapping = rawMap[specKey];

		// if there's no explicit mapping, do nothing
		if (mapping === undefined) return;

		// avoid interfering with typing: if focus is in an input/textarea and no modifiers, ignore shortcuts
		if (isTextInput && !fullSpec.includes('ctrl') && !fullSpec.includes('meta') && !fullSpec.includes('alt')) return;

		const spec = typeof mapping === 'string' ? { cmd: mapping } : mapping;
		if (spec && spec.cmd) {
			// Board-scoped commands (movement, reading the focused square, roll/end via
			// the bare keys) only act while the board owns focus, so they can't be fired
			// by accident from another panel. Their modifier aliases (Ctrl+E, Ctrl+B,
			// Ctrl+arrows) carry ctrl/alt/meta and stay global.
			const isBareKey = !ev.ctrlKey && !ev.altKey && !ev.metaKey;
			if (BOARD_SCOPED_COMMANDS.has(spec.cmd) && isBareKey && !isOnBoard(target)) return;

			// Family gates: property-only commands are inert off the property board, and a
			// keymap entry tagged with a family (e.g. "s" = route landmarks, family:"race")
			// only fires there — elsewhere its letter belongs to other uses (package group
			// keys on property boards).
			if (familyOf(opts) !== 'property' && PROPERTY_ONLY_COMMANDS.has(spec.cmd)) return;
			if (spec.family && spec.family !== familyOf(opts)) return;

			const handled = execute(spec.cmd, spec.args || {});
			if (handled) { ev.preventDefault(); return; }

			// A directional move that fell on a board edge is a no-op, but we still consume
			// the arrow so it can't leak to the browser's caret browsing (F7) and drag focus
			// off the board. Only while the board owns focus, so panels keep their own keys.
			if (BOARD_MOVEMENT_COMMANDS.has(spec.cmd) && isBareKey && isOnBoard(target)) {
				ev.preventDefault();
			}
		}
	}

	document.addEventListener('keydown', globalKeyHandler);

	return () => {
		document.removeEventListener('keydown', globalKeyHandler);
	};
}
