import { resetCardBoard, registerStatusKeys, CARD_STATUS_SHORTCUTS } from './cardBoardShell.js';
import { teamDisplayName } from './enginePalette.js';
import { buildForbiddenRulesLines } from './rulesSummaries.js';
import {
	forbiddenCastLines,
	forbiddenDutyText,
	forbiddenNowPlayingText,
	forbiddenRivalStatus,
	forbiddenRole,
	forbiddenStatusText,
	forbiddenTurnContextText,
	formatForbiddenCard,
} from './forbiddenRules.js';
import { listenForShake, requestShakePermission } from './shakeGesture.js';
import type { GameState } from './models.js';
import type { HelpShortcut } from './shortcuts.js';

export interface ForbiddenBoardDeps {
	getGameState: () => GameState | null;
	getMyPlayerId: () => string | null;
	announce: (text: string) => void;
	tSync: (key: string, vars?: Record<string, unknown>) => string;
	sounds: {
		playEvent: (eventKey: string) => void;
		startLoop: (eventKey: string) => void;
		stopLoop: (eventKey: string) => boolean;
	};
	commands: {
		start: () => void;
		correct: (cardSequence: number) => void;
		pass: (cardSequence: number) => void;
		violation: (cardSequence: number) => void;
	};
	/** Where device-motion events come from. Defaults to `window`; tests supply their own. */
	motionTarget?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | null;
}

const TIMER_SOUND_EVENT = 'forbidden.tick';

export interface ProtectedTextAreaController {
	setValue(value: string): void;
}

/**
 * Makes an ordinary textarea semantically read-only without the native readonly state. The
 * control remains a real multiline text box: screen-reader reading commands, cursor movement,
 * selection and copying work normally. Every mutation route is blocked, including mobile
 * beforeinput/composition, paste, cut, drop and keyboard editing; events still bubble so game
 * shortcuts remain available. inputmode="none" avoids summoning a touch keyboard where browsers
 * honour it.
 */
export function protectReadOnlyTextArea(textarea: HTMLTextAreaElement): ProtectedTextAreaController {
	textarea.setAttribute('aria-readonly', 'true');
	textarea.setAttribute('inputmode', 'none');
	textarea.autocomplete = 'off';
	textarea.spellcheck = false;
	textarea.setAttribute('autocapitalize', 'off');
	textarea.setAttribute('autocorrect', 'off');

	let lockedValue = textarea.value;
	let selectionStart = 0;
	let selectionEnd = 0;
	const rememberSelection = () => {
		selectionStart = textarea.selectionStart ?? 0;
		selectionEnd = textarea.selectionEnd ?? selectionStart;
	};
	const restore = () => {
		if (textarea.value !== lockedValue) textarea.value = lockedValue;
		const max = lockedValue.length;
		textarea.setSelectionRange(Math.min(selectionStart, max), Math.min(selectionEnd, max));
	};

	textarea.addEventListener('select', rememberSelection);
	textarea.addEventListener('pointerup', rememberSelection);
	textarea.addEventListener('keyup', rememberSelection);
	textarea.addEventListener('beforeinput', event => {
		rememberSelection();
		event.preventDefault();
	});
	textarea.addEventListener('input', restore);
	for (const type of ['paste', 'cut', 'drop', 'compositionstart', 'textInput']) {
		textarea.addEventListener(type, event => {
			rememberSelection();
			event.preventDefault();
		});
	}
	textarea.addEventListener('compositionend', event => {
		rememberSelection();
		event.preventDefault();
		// Some IMEs commit after compositionend even when compositionstart/beforeinput were
		// cancelled. Restore in the next microtask as well as through the input guard below.
		queueMicrotask(restore);
	});
	textarea.addEventListener('keydown', event => {
		rememberSelection();
		const key = event.key.toLowerCase();
		const modifier = event.ctrlKey || event.metaKey;
		const clipboardMutation = modifier && (key === 'v' || key === 'x');
		const historyMutation = modifier && (key === 'z' || key === 'y');
		const keyboardPaste = event.shiftKey && key === 'insert';
		const plainCharacter = key.length === 1 && !modifier && !event.altKey;
		if (clipboardMutation || historyMutation || keyboardPaste || plainCharacter
			|| ['backspace', 'delete', 'enter'].includes(key)) {
			event.preventDefault();
		}
	});

	return {
		setValue(value: string) {
			lockedValue = value;
			if (textarea.value === value) return;
			const start = Math.min(textarea.selectionStart ?? 0, value.length);
			const end = Math.min(textarea.selectionEnd ?? start, value.length);
			textarea.value = value;
			selectionStart = start;
			selectionEnd = end;
			textarea.setSelectionRange(start, end);
		},
	};
}

const visible = (element: HTMLElement) => !element.hidden;

export class ForbiddenBoard {
	private readonly shell: HTMLElement;
	private readonly scoreList: HTMLOListElement;
	private readonly nowLine: HTMLElement;
	private readonly roleDetail: HTMLElement;
	private readonly roleList: HTMLUListElement;
	private readonly cardPanel: HTMLElement;
	private readonly cardLabel: HTMLLabelElement;
	private readonly cardText: HTMLTextAreaElement;
	private readonly protectedCard: ProtectedTextAreaController;
	private readonly timerPanel: HTMLElement;
	private readonly timerValue: HTMLElement;
	private readonly timerProgress: HTMLProgressElement;
	private readonly turnSummary: HTMLElement;
	private readonly startButton: HTMLButtonElement;
	private readonly correctButton: HTMLButtonElement;
	private readonly passButton: HTMLButtonElement;
	private readonly violationButton: HTMLButtonElement;
	private readonly passHint: HTMLElement;
	private timerStartedAt: string | null = null;
	private secondsRemaining = 0;
	private lastTick = -1;

	constructor(private readonly element: HTMLElement, private readonly deps: ForbiddenBoardDeps) {
		resetCardBoard(element, 'forbidden-board');
		element.setAttribute('aria-label', this.t('forbidden_surface_label'));
		element.setAttribute('role', 'application');

		this.shell = document.createElement('div');
		this.shell.className = 'forbidden-shell';
		this.shell.tabIndex = -1;
		this.shell.innerHTML = `
			<div class="forbidden-hero" aria-hidden="true">
				<span class="forbidden-hero__halo"></span>
				<span class="forbidden-hero__mark">!</span>
			</div>
			<div class="forbidden-headline">
				<h2 class="forbidden-title"></h2>
				<p class="forbidden-subtitle"></p>
			</div>
			<section class="forbidden-scoreboard" aria-labelledby="forbidden-score-title">
				<h3 id="forbidden-score-title"></h3>
				<ol class="forbidden-score-list"></ol>
			</section>
			<section class="forbidden-now" aria-labelledby="forbidden-now-title">
				<h3 id="forbidden-now-title"></h3>
				<p class="forbidden-now__line"></p>
			</section>
			<section class="forbidden-turn-card" aria-labelledby="forbidden-turn-title">
				<div class="forbidden-turn-card__heading">
					<div>
						<h3 id="forbidden-turn-title"></h3>
					</div>
					<!-- Entirely aria-hidden, on purpose. NVDA sonifies a progress bar, and this one
					     moves every second and runs BACKWARDS, so it beeped its way down the whole
					     turn over the top of the game. Nothing here is the only copy of anything:
					     the clock is heard as the ticking loop, and R says the seconds on demand. -->
					<div class="forbidden-timer" aria-hidden="true" hidden>
						<span class="forbidden-timer__value"></span>
						<progress class="forbidden-timer__progress"></progress>
					</div>
				</div>
				<p class="forbidden-role-detail"></p>
				<ul class="forbidden-role-list"></ul>
				<div class="forbidden-secret" hidden>
					<div class="forbidden-secret__eyebrow"></div>
					<label class="forbidden-secret__label" for="forbidden-card-text"></label>
					<textarea id="forbidden-card-text" class="forbidden-secret__text" rows="7"></textarea>
				</div>
				<p class="forbidden-turn-summary"></p>
				<div class="forbidden-controls">
					<button type="button" class="btn btn--primary forbidden-start"></button>
					<button type="button" class="btn forbidden-correct"></button>
					<button type="button" class="btn forbidden-pass" aria-keyshortcuts="P"></button>
					<button type="button" class="btn forbidden-violation" aria-keyshortcuts="V"></button>
				</div>
				<p id="forbidden-pass-hint" class="forbidden-control-hint" hidden></p>
			</section>
		`;
		element.appendChild(this.shell);

		this.scoreList = this.required('.forbidden-score-list');
		this.nowLine = this.required('.forbidden-now__line');
		this.roleList = this.required('.forbidden-role-list');
		this.roleDetail = this.required('.forbidden-role-detail');
		this.cardPanel = this.required('.forbidden-secret');
		this.cardLabel = this.required('.forbidden-secret__label');
		this.cardText = this.required('.forbidden-secret__text');
		this.protectedCard = protectReadOnlyTextArea(this.cardText);
		this.timerPanel = this.required('.forbidden-timer');
		this.timerValue = this.required('.forbidden-timer__value');
		this.timerProgress = this.required('.forbidden-timer__progress');
		this.turnSummary = this.required('.forbidden-turn-summary');
		this.startButton = this.required('.forbidden-start');
		this.correctButton = this.required('.forbidden-correct');
		this.passButton = this.required('.forbidden-pass');
		this.violationButton = this.required('.forbidden-violation');
		this.passHint = this.required('#forbidden-pass-hint');

		this.startButton.addEventListener('click', () => {
			deps.commands.start();
			this.returnToCard();
		});
		this.correctButton.addEventListener('click', () => {
			const sequence = this.deps.getGameState()?.forbidden?.turn.cardSequence;
			if (sequence !== undefined) deps.commands.correct(sequence);
			this.returnToCard();
		});
		this.passButton.addEventListener('click', () => this.activate(this.passButton, this.passHint, () => {
			const sequence = this.deps.getGameState()?.forbidden?.turn.cardSequence;
			if (sequence !== undefined) deps.commands.pass(sequence);
			this.returnToCard();
		}));
		this.violationButton.addEventListener('click', () => {
			const sequence = this.deps.getGameState()?.forbidden?.turn.cardSequence;
			if (sequence !== undefined) deps.commands.violation(sequence);
			this.returnToCard();
		});
		this.cardText.addEventListener('keydown', event => {
			if (event.key !== 'Enter' || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey
				|| event.repeat) return;
			// The protected field cannot accept a newline, so Enter is free — and the card is the
			// board as far as this family is concerned. Whichever of the two things the clue-giver
			// can do from here is what Enter does: get the clock going, or bank the word they have
			// just heard guessed. One key, no hunting for a button between every card.
			const action = this.primaryCardAction();
			if (!action) return;
			event.preventDefault();
			event.stopPropagation();
			action.click();
		});
		this.element.addEventListener('keydown', event => {
			if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.repeat) return;
			const key = event.key.toLowerCase();
			// The card is this family's board: Escape from anywhere on the surface comes back to it,
			// the way Escape leaves a menu and lands where the menu was opened from.
			if (event.key === 'Escape' && visible(this.cardPanel) && document.activeElement !== this.cardText) {
				event.preventDefault();
				event.stopPropagation();
				this.cardText.focus();
				return;
			}
			if (key === 'r') {
				const turn = this.deps.getGameState()?.forbidden?.turn;
				if (!turn) return;
				// R is family-local: "reloj" in Spanish and "remaining" in English. The
				// latest value comes from the server timer tick, so querying it never starts
				// a client-side spoken countdown or depends on animation frames.
				event.preventDefault();
				event.stopPropagation();
				this.deps.announce(turn.phase === 'active'
					? this.t('forbidden_timer_label', { seconds: this.secondsRemaining })
					: this.t('forbidden_timer_not_running'));
				return;
			}
			if (key === 'p') {
				// P is "pasar" and "pass", the same bilingual mnemonic R and V already use. Pass was
				// the only clue-giver action without a key: Enter banks a guessed word, so skipping
				// one meant tabbing away from the card with the clock running. Going through the
				// button keeps the out-of-passes case spoken instead of silently ignored.
				//
				// The key belongs to the ROLE, not to the button. Before the clock starts the button
				// does not exist, and the card is a textarea, so the document keymap skips the key
				// too: P answered nothing at all, which reads as a dead app. R already answers in
				// that same moment, and its line is the right one — there is no word on the card yet.
				const turn = this.deps.getGameState()?.forbidden?.turn;
				const myId = this.deps.getMyPlayerId();
				if (!turn || !myId || forbiddenRole(turn, myId) !== 'clue-giver') return;
				event.preventDefault();
				event.stopPropagation();
				if (visible(this.passButton)) {
					this.passButton.click();
					return;
				}
				this.deps.announce(this.t('forbidden_timer_not_running'));
				return;
			}
			if (key !== 'v' || !visible(this.violationButton)) return;
			// V is bank inventory in the engine keymap, but that command is property-only.
			// Forbidden owns it locally and stops it before the document keymap, including while
			// the protected card has focus. One action covers saying the target or any listed word.
			event.preventDefault();
			event.stopPropagation();
			this.violationButton.click();
		});

		registerStatusKeys(element, {
			getGameState: deps.getGameState,
			getMyPlayerId: deps.getMyPlayerId,
			announce: deps.announce,
			mine: (gs, id) => forbiddenStatusText(gs, id, deps.tSync),
			rivals: (gs, id) => forbiddenRivalStatus(gs, id, deps.tSync),
		});

		// On a phone there is no keyboard and no comfortable way to find a button while holding the
		// device, listening and talking. A shake is the same single action the surface already
		// offers — whichever one is mine right now — and never the only way to reach it.
		listenForShake(() => this.handleShake(), { target: deps.motionTarget });
		// iOS only hands out motion events after the person agrees, and only asks from inside a real
		// gesture. The first touch or key on the surface is that gesture; it is asked once.
		const askForMotion = () => {
			element.removeEventListener('pointerdown', askForMotion);
			element.removeEventListener('keydown', askForMotion);
			void requestShakePermission();
		};
		element.addEventListener('pointerdown', askForMotion);
		element.addEventListener('keydown', askForMotion);
	}

	/** The first of these controls that is on offer AND available, or null. */
	private offered(...buttons: HTMLButtonElement[]): HTMLButtonElement | null {
		const candidate = buttons.find(button => visible(button));
		if (!candidate || candidate.getAttribute('aria-disabled') === 'true') return null;
		return candidate;
	}

	/**
	 * What Enter does from the private card: get the clock going, then bank each word as it is
	 * guessed. The monitor's report is deliberately NOT here — it costs their rivals a point, and
	 * a key that big should be pressed on purpose (V), not by an Enter aimed at something else.
	 */
	private primaryCardAction(): HTMLButtonElement | null {
		return this.offered(this.startButton, this.correctButton);
	}

	/**
	 * A shake, on a phone: the clue-giver starts the clock and then banks each word as it is
	 * guessed; the monitor reports the slip. A shake is a whole-arm movement nobody makes by
	 * accident, so unlike Enter it does carry the monitor's action — the one role whose hands are
	 * otherwise free and whose button is hardest to find while listening. Public so the routing
	 * can be tested without an accelerometer.
	 */
	handleShake(): void {
		// A table plays match after match, and each one builds a new surface over the same element
		// while this listener is on `window`. Without this, a shake in the second match would also
		// fire the FIRST board's buttons — detached, still holding their handlers, still able to
		// send a real command. A board that no longer owns the surface does nothing.
		if (!this.element.contains(this.shell)) return;
		this.offered(this.startButton, this.correctButton, this.violationButton)?.click();
	}

	/**
	 * Back to the card after acting. The words ARE the board here: a clue-giver who tabbed to
	 * "correct" and pressed it was left standing on a button while the next word — the only thing
	 * they need — sat behind them.
	 */
	private returnToCard(): void {
		if (visible(this.cardPanel)) this.cardText.focus();
	}

	update(gs: GameState): void {
		const state = gs.forbidden;
		const myId = this.deps.getMyPlayerId();
		if (!state || !myId) return;
		const focusedInside = this.element.contains(document.activeElement);
		const turn = state.turn;
		const role = forbiddenRole(turn, myId);
		const locale = document.documentElement.lang || navigator.language || 'en';

		this.localizeStatic();
		this.renderScores(gs);
		this.nowLine.textContent = forbiddenNowPlayingText(gs, myId, this.deps.tSync) ?? '';
		this.roleDetail.textContent = forbiddenDutyText(gs, myId, this.deps.tSync) ?? '';
		this.renderRoles(gs, myId);
		this.localizeCardLabel();

		// The card stays put between turns and only its CONTENT waits. Hiding the whole panel
		// would drop focus and make it reappear under a screen-reader user every single turn;
		// the words are withheld by the server, so an empty card gives nothing away.
		const holdsCard = role === 'clue-giver' || role === 'monitor';
		this.cardPanel.hidden = !holdsCard;
		if (holdsCard) {
			this.protectedCard.setValue(turn.target
				? formatForbiddenCard(turn.target, turn.forbiddenWords, locale, this.deps.tSync)
				: this.t('forbidden_card_waiting'));
		}

		this.renderTimer(turn.startedAt ?? null, turn.durationSeconds, turn.phase === 'active');
		this.turnSummary.textContent = turn.phase === 'active'
			? this.t('forbidden_active_summary', {
				correct: turn.correctCount,
				passes: turn.passesUsed,
				violations: turn.violationCount,
			})
			: this.t('forbidden_preparing_summary');

		const preparing = turn.phase === 'preparing';
		const active = turn.phase === 'active';
		this.startButton.hidden = !(preparing && role === 'clue-giver');
		this.correctButton.hidden = !(active && role === 'clue-giver');
		this.passButton.hidden = !(active && role === 'clue-giver');
		this.violationButton.hidden = !(active && role === 'monitor');

		const passLimit = gs.forbiddenRules?.passesPerTurn ?? 3;
		this.availability(
			this.passButton,
			turn.passesUsed < passLimit,
			this.passHint,
			turn.passesUsed >= passLimit ? this.t('forbidden_no_passes') : '',
		);

		// A timeout or role rotation can hide the card/button that currently owns focus. Keep
		// keyboard and screen-reader users on the family surface instead of dropping to body.
		const focusedAfterUpdate = document.activeElement;
		if (focusedInside && (!(focusedAfterUpdate instanceof HTMLElement)
			|| !this.element.contains(focusedAfterUpdate)
			|| focusedAfterUpdate.closest('[hidden]'))) {
			this.focusHand();
		}
	}

	handleTimerTick(secondsRemaining: number): void {
		if (this.deps.getGameState()?.forbidden?.turn.phase !== 'active') {
			this.syncTimerSound(0, false);
			return;
		}
		// startLoop is idempotent, so every authoritative tick safely retries a start that
		// may have raced the package sound download without ever stacking another clock.
		this.syncTimerSound(secondsRemaining, true);
		if (secondsRemaining === 10 && this.lastTick !== 10) {
			this.deps.sounds.playEvent('forbidden.warning');
		}
		this.lastTick = secondsRemaining;
		this.updateTimer(secondsRemaining);
	}

	isAnimating(): boolean { return false; }

	/** T uses the same complete role context that remains visible in the turn card. */
	announceTurn(): boolean {
		const gs = this.deps.getGameState();
		const myId = this.deps.getMyPlayerId();
		if (!gs || !myId) return false;
		const text = forbiddenTurnContextText(gs, myId, this.deps.tSync);
		if (!text) return false;
		this.deps.announce(text);
		return true;
	}

	focusHand(): void {
		if (visible(this.cardPanel)) {
			this.cardText.focus();
			return;
		}
		const action = [this.startButton, this.correctButton, this.passButton, this.violationButton]
			.find(button => visible(button));
		(action ?? this.shell).focus();
	}

	helpShortcuts(): HelpShortcut[] {
		return [
			...CARD_STATUS_SHORTCUTS,
			{ keys: 'enter', descKey: 'game.help_cmd_forbidden_enter' },
			{ keys: 'escape', descKey: 'game.help_cmd_forbidden_card' },
			{ keys: 'p', descKey: 'game.help_cmd_forbidden_pass' },
			{ keys: 'r', descKey: 'game.help_cmd_forbidden_timer' },
			{ keys: 'v', descKey: 'game.help_cmd_forbidden_violation' },
			{ keys: 'tab', descKey: 'game.help_cmd_forbidden_controls' },
		];
	}

	rulesSummary(): string[] {
		return buildForbiddenRulesLines(this.deps.getGameState()?.forbiddenRules, this.deps.tSync);
	}

	private localizeStatic(): void {
		this.required('.forbidden-title').textContent = this.t('forbidden_title');
		this.required('.forbidden-subtitle').textContent = this.t('forbidden_subtitle');
		this.required('#forbidden-score-title').textContent = this.t('forbidden_scores_title');
		this.required('#forbidden-now-title').textContent = this.t('forbidden_now_title');
		this.required('#forbidden-turn-title').textContent = this.t('forbidden_turn_title');
		this.required('.forbidden-secret__eyebrow').textContent = this.t('forbidden_secret_eyebrow');
		this.startButton.textContent = this.t('forbidden_start_button');
		this.correctButton.textContent = this.t('forbidden_correct_button');
		this.passButton.textContent = this.t('forbidden_pass_button');
		this.violationButton.textContent = this.t('forbidden_violation_button');
	}

	/** The card's label is deliberately one word. Whatever a screen reader repeats on every
	 *  focus — who I am, that the box does not take typing, which keys work here — is a toll
	 *  paid on every visit, and worst on a phone; the duty line above says what to do, and F1
	 *  holds the keys. */
	private localizeCardLabel(): void {
		this.cardLabel.textContent = this.t('forbidden_card_label');
	}

	/** The three assignments this turn actually has, one row each, in the order they happen. */
	private renderRoles(gs: GameState, myId: string): void {
		this.roleList.innerHTML = '';
		for (const line of forbiddenCastLines(gs, myId, this.deps.tSync)) {
			const item = document.createElement('li');
			item.className = 'forbidden-role-item';
			item.textContent = line;
			this.roleList.appendChild(item);
		}
	}

	private renderScores(gs: GameState): void {
		const focusedTeam = document.activeElement?.closest<HTMLElement>('[data-team-index]')?.dataset.teamIndex;
		this.scoreList.innerHTML = '';
		for (const team of gs.forbidden!.teams) {
			const item = document.createElement('li');
			item.className = `forbidden-score forbidden-score--${team.teamIndex}`;
			item.dataset.teamIndex = String(team.teamIndex);
			const teamName = teamDisplayName(team.teamIndex, this.deps.tSync);
			item.textContent = this.t('forbidden_score_line', { team: teamName, score: team.score });
			item.setAttribute('aria-label', this.t('forbidden_score_line', { team: teamName, score: team.score }));
			this.scoreList.appendChild(item);
		}
		if (focusedTeam) this.scoreList.querySelector<HTMLElement>(`[data-team-index="${focusedTeam}"]`)?.focus();
	}

	private renderTimer(startedAt: string | null, duration: number, active: boolean): void {
		this.timerPanel.hidden = !active;
		this.timerProgress.max = duration;
		if (!active) {
			this.syncTimerSound(0, false);
			this.timerStartedAt = null;
			this.lastTick = -1;
			return;
		}
		if (startedAt !== this.timerStartedAt) {
			this.timerStartedAt = startedAt;
			this.lastTick = -1;
			const deadline = startedAt ? Date.parse(startedAt) + duration * 1000 : Date.now() + duration * 1000;
			this.secondsRemaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
		}
		const seconds = startedAt ? this.secondsRemaining : duration;
		this.updateTimer(seconds);
		this.syncTimerSound(seconds, true);
	}

	private syncTimerSound(secondsRemaining: number, active: boolean): void {
		if (active && secondsRemaining > 0) {
			this.deps.sounds.startLoop(TIMER_SOUND_EVENT);
			return;
		}
		this.deps.sounds.stopLoop(TIMER_SOUND_EVENT);
	}

	private updateTimer(seconds: number): void {
		this.secondsRemaining = Math.max(0, seconds);
		this.timerValue.textContent = this.t('forbidden_timer_value', { seconds: this.secondsRemaining });
		this.timerProgress.value = this.secondsRemaining;
		this.timerPanel.dataset.urgent = String(this.secondsRemaining <= 10);
	}

	private availability(button: HTMLButtonElement, available: boolean, hint: HTMLElement, reason: string): void {
		if (button.hidden) {
			hint.hidden = true;
			hint.textContent = '';
			button.removeAttribute('aria-describedby');
			return;
		}
		button.setAttribute('aria-disabled', String(!available));
		hint.hidden = available;
		hint.textContent = available ? '' : reason;
		if (available) button.removeAttribute('aria-describedby');
		else button.setAttribute('aria-describedby', hint.id);
	}

	private activate(button: HTMLButtonElement, hint: HTMLElement, action: () => void): void {
		if (button.getAttribute('aria-disabled') === 'true') {
			if (hint.textContent) this.deps.announce(hint.textContent);
			return;
		}
		action();
	}

	private t(key: string, vars?: Record<string, unknown>): string {
		return this.deps.tSync(`game.${key}`, vars);
	}

	private required<T extends HTMLElement>(selector: string): T {
		const found = this.shell?.querySelector<T>(selector) ?? this.element.querySelector<T>(selector);
		if (!found) throw new Error(`ForbiddenBoard missing ${selector}`);
		return found;
	}
}
