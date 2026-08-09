import { RovingToolbarList } from './accessibleList.js';
import { resetCardBoard, registerStatusKeys, CARD_STATUS_SHORTCUTS } from './cardBoardShell.js';
import { buildCategoriesRulesLines } from './rulesSummaries.js';
import {
	CATEGORIES_VERDICTS,
	categoriesAnswerLabel,
	categoriesCanWrite,
	categoriesDutyText,
	categoriesNowPlayingText,
	categoriesPlayerName,
	categoriesProgressText,
	categoriesRivalStatus,
	categoriesStatusText,
	categoriesSuggestedVerdicts,
	categoriesVerdictLabel,
} from './categoriesRules.js';
import { isTypingTarget } from './typingTarget.js';
import type {
	CategoriesEntry, CategoriesPromptState, CategoriesRuling, CategoriesVerdict, GameState,
} from './models.js';
import type { HelpShortcut } from './shortcuts.js';

export interface CategoriesBoardDeps {
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
		startRound: (roundNumber: number) => void;
		write: (roundNumber: number, entries: CategoriesEntry[]) => void;
		finishWriting: (roundNumber: number) => void;
		rulePrompt: (roundNumber: number, promptIndex: number, rulings: CategoriesRuling[]) => void;
	};
	/** Deferred work, injectable so the save debounce is testable without real time. */
	setTimer?: (handler: () => void, ms: number) => number;
	clearTimer?: (handle: number) => void;
}

const TIMER_SOUND_EVENT = 'categories.tick';

/** How long typing pauses before the sheet is saved. Long enough not to send a command per
 *  keystroke, short enough that a clock running out never costs more than a word. */
const SAVE_DEBOUNCE_MS = 500;

/** Below this many seconds the debounce is abandoned and every change saves at once: the
 *  difference between a saved answer and a lost one is measured in exactly these seconds. */
const URGENT_SAVE_SECONDS = 5;

const visible = (element: HTMLElement) => !element.hidden;

type Verdict = Exclude<CategoriesVerdict, 'pending'>;

export class CategoriesBoard {
	private readonly shell: HTMLElement;
	private readonly scoreList: HTMLOListElement;
	private readonly nowLine: HTMLElement;
	private readonly dutyLine: HTMLElement;
	private readonly progressLine: HTMLElement;
	private readonly timerPanel: HTMLElement;
	private readonly timerValue: HTMLElement;
	private readonly timerProgress: HTMLProgressElement;
	private readonly sheetSection: HTMLElement;
	private readonly sheetHeading: HTMLElement;
	private readonly sheetList: HTMLOListElement;
	private readonly startButton: HTMLButtonElement;
	private readonly finishButton: HTMLButtonElement;
	private readonly finishHint: HTMLElement;
	private readonly reviewSection: HTMLElement;
	private readonly reviewHeading: HTMLElement;
	private readonly reviewCategory: HTMLElement;
	private readonly reviewList: HTMLOListElement;
	private readonly confirmButton: HTMLButtonElement;
	private readonly reviewNav: RovingToolbarList;

	/** The sheet as this player has typed it, keyed by category id. It is the client's own copy:
	 *  the server's projection of my answers can lag a keystroke behind, and re-rendering from it
	 *  would yank text out from under the cursor. */
	private readonly sheet = new Map<string, string>();
	/** The judge's verdicts for the category under review, keyed by player id. */
	private verdicts = new Map<string, Verdict>();
	private verdictsForPrompt = '';
	private saveHandle: number | null = null;
	/** The round whose sheet is currently built, so typing is never re-rendered out from under
	 *  the caret. */
	private sheetRound = -1;
	/** "<round>:<prompt>" of the review rows currently built, for the same reason. */
	private reviewKey = '';
	private timerStartedAt: string | null = null;
	private secondsRemaining = 0;
	private lastTick = -1;

	constructor(private readonly element: HTMLElement, private readonly deps: CategoriesBoardDeps) {
		resetCardBoard(element, 'categories-board');
		element.setAttribute('aria-label', this.t('categories_surface_label'));
		element.setAttribute('role', 'application');

		this.shell = document.createElement('div');
		this.shell.className = 'categories-shell';
		this.shell.tabIndex = -1;
		this.shell.innerHTML = `
			<div class="categories-hero" aria-hidden="true">
				<span class="categories-hero__halo"></span>
				<span class="categories-hero__letter"></span>
			</div>
			<div class="categories-headline">
				<h2 class="categories-title"></h2>
				<p class="categories-subtitle"></p>
			</div>
			<section class="categories-scoreboard" aria-labelledby="categories-score-title">
				<h3 id="categories-score-title"></h3>
				<ol class="categories-score-list"></ol>
			</section>
			<section class="categories-now" aria-labelledby="categories-now-title">
				<h3 id="categories-now-title"></h3>
				<p class="categories-now__line"></p>
				<p class="categories-duty"></p>
				<p class="categories-progress"></p>
				<!-- Entirely aria-hidden, like the forbidden clock: a progress bar that moves every
				     second and runs BACKWARDS is sonified by NVDA over the top of the game. Nothing
				     here is the only copy of anything — the clock is heard as the ticking loop, and
				     R says the seconds on demand. -->
				<div class="categories-timer" aria-hidden="true" hidden>
					<span class="categories-timer__value"></span>
					<progress class="categories-timer__progress"></progress>
				</div>
				<div class="categories-controls">
					<button type="button" class="btn btn--primary categories-start"></button>
				</div>
			</section>
			<section class="categories-sheet" aria-labelledby="categories-sheet-title" hidden>
				<h3 id="categories-sheet-title"></h3>
				<ol class="categories-sheet-list"></ol>
				<div class="categories-controls">
					<button type="button" class="btn categories-finish"></button>
				</div>
				<p id="categories-finish-hint" class="categories-control-hint" hidden></p>
			</section>
			<section class="categories-review" aria-labelledby="categories-review-title" hidden>
				<h3 id="categories-review-title"></h3>
				<p class="categories-review__category"></p>
				<ol class="categories-review-list"></ol>
				<div class="categories-controls">
					<button type="button" class="btn btn--primary categories-confirm"></button>
				</div>
			</section>
		`;
		element.appendChild(this.shell);

		this.scoreList = this.required('.categories-score-list');
		this.nowLine = this.required('.categories-now__line');
		this.dutyLine = this.required('.categories-duty');
		this.progressLine = this.required('.categories-progress');
		this.timerPanel = this.required('.categories-timer');
		this.timerValue = this.required('.categories-timer__value');
		this.timerProgress = this.required('.categories-timer__progress');
		this.sheetSection = this.required('.categories-sheet');
		this.sheetHeading = this.required('#categories-sheet-title');
		this.sheetList = this.required('.categories-sheet-list');
		this.startButton = this.required('.categories-start');
		this.finishButton = this.required('.categories-finish');
		this.finishHint = this.required('#categories-finish-hint');
		this.reviewSection = this.required('.categories-review');
		this.reviewHeading = this.required('#categories-review-title');
		this.reviewCategory = this.required('.categories-review__category');
		this.reviewList = this.required('.categories-review-list');
		this.confirmButton = this.required('.categories-confirm');

		this.reviewNav = new RovingToolbarList({
			list: this.reviewList,
			itemSelector: '.categories-answer',
			toolbarButtonSelector: '.categories-verdict',
			menuLabel: () => this.t('categories_answer_menu'),
			menuClass: 'categories-answer-context-menu',
			menuItemClass: 'categories-answer-context-menu-item',
			// Keep the popup inside the active page landmark, never orphaned under body.
			menuHost: () => this.element.closest('main') ?? this.element,
			fallbackFocus: () => (visible(this.confirmButton) ? this.confirmButton : this.shell),
		});

		this.startButton.addEventListener('click', () => {
			const round = this.round();
			if (round) this.deps.commands.startRound(round.roundNumber);
		});
		this.finishButton.addEventListener('click', () => {
			if (this.finishButton.getAttribute('aria-disabled') === 'true') {
				this.deps.announce(this.finishHint.textContent ?? '');
				return;
			}
			this.finishWriting();
		});
		this.confirmButton.addEventListener('click', () => this.confirmPrompt());

		this.sheetList.addEventListener('input', event => {
			const input = event.target;
			if (!(input instanceof HTMLInputElement)) return;
			this.sheet.set(input.dataset.categoryId ?? '', input.value);
			this.scheduleSave();
		});
		// Leaving a field is a decision: never let the debounce outlive it.
		this.sheetList.addEventListener('focusout', () => this.saveNow());
		this.sheetList.addEventListener('keydown', event => this.onSheetKeydown(event));

		this.element.addEventListener('keydown', event => this.onSurfaceKeydown(event));

		registerStatusKeys(element, {
			getGameState: deps.getGameState,
			getMyPlayerId: deps.getMyPlayerId,
			announce: deps.announce,
			mine: (gs, id) => categoriesStatusText(gs, id, deps.tSync),
			rivals: (gs, id) => categoriesRivalStatus(gs, id, deps.tSync),
		});
	}

	// ── Keyboard ──────────────────────────────────────────────────────────────

	/**
	 * Enter walks the sheet: the next field, and from the last one to "I have finished" — which it
	 * FOCUSES rather than presses. Ending your round early is not something an Enter aimed at the
	 * next word should ever do by accident.
	 */
	private onSheetKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter' || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
		const inputs = Array.from(this.sheetList.querySelectorAll<HTMLInputElement>('.categories-sheet-input'));
		const index = inputs.findIndex(input => input === document.activeElement);
		if (index < 0) return;
		event.preventDefault();
		event.stopPropagation();
		this.saveNow();
		const next = inputs[index + 1];
		if (next) next.focus();
		else if (visible(this.finishButton)) this.finishButton.focus();
	}

	private onSurfaceKeydown(event: KeyboardEvent): void {
		if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.repeat) return;
		const key = event.key.toLowerCase();

		// Escape comes back to whatever this player's job is, the way Escape leaves a menu and
		// lands where the menu was opened from.
		if (event.key === 'Escape' && !isTypingTarget(event.target)) {
			event.preventDefault();
			event.stopPropagation();
			this.focusHand();
			return;
		}
		if (key !== 'r' || isTypingTarget(event.target)) return;

		// R is family-local: "reloj" in Spanish, "remaining" in English. The value comes from the
		// server clock tick, so asking never starts a client-side spoken countdown.
		const round = this.round();
		if (!round) return;
		event.preventDefault();
		event.stopPropagation();
		this.deps.announce(round.phase === 'writing'
			? this.t('categories_timer_label', { seconds: this.secondsRemaining })
			: this.t('categories_timer_not_running'));
	}

	// ── Commands ──────────────────────────────────────────────────────────────

	private scheduleSave(): void {
		this.cancelSave();
		// In the last seconds the debounce is the difference between an answer and nothing.
		if (this.secondsRemaining > 0 && this.secondsRemaining <= URGENT_SAVE_SECONDS) {
			this.saveNow();
			return;
		}
		const setTimer = this.deps.setTimer ?? ((handler, ms) => window.setTimeout(handler, ms));
		this.saveHandle = setTimer(() => {
			this.saveHandle = null;
			this.saveNow();
		}, SAVE_DEBOUNCE_MS);
	}

	private cancelSave(): void {
		if (this.saveHandle === null) return;
		const clearTimer = this.deps.clearTimer ?? ((handle: number) => window.clearTimeout(handle));
		clearTimer(this.saveHandle);
		this.saveHandle = null;
	}

	/** Send the WHOLE sheet. It is idempotent, so a dropped message costs nothing. */
	private saveNow(): void {
		this.cancelSave();
		const round = this.round();
		const myId = this.deps.getMyPlayerId();
		if (!round || !myId || !categoriesCanWrite(round, myId) || this.sheet.size === 0) return;
		this.deps.commands.write(
			round.roundNumber,
			round.prompts.map(prompt => ({
				categoryId: prompt.categoryId,
				text: this.sheet.get(prompt.categoryId) ?? '',
			})),
		);
	}

	private finishWriting(): void {
		const round = this.round();
		if (!round) return;
		this.saveNow();
		this.deps.commands.finishWriting(round.roundNumber);
	}

	private confirmPrompt(): void {
		const round = this.round();
		if (!round || round.phase !== 'review') return;
		const prompt = round.prompts[round.reviewIndex];
		if (!prompt) return;
		const rulings: CategoriesRuling[] = prompt.answers
			.filter(answer => answer.text.trim().length > 0)
			.map(answer => ({
				playerId: answer.playerId,
				verdict: this.verdicts.get(answer.playerId) ?? 'rejected',
			}));
		this.deps.commands.rulePrompt(round.roundNumber, round.reviewIndex, rulings);
	}

	// ── Rendering ─────────────────────────────────────────────────────────────

	update(gs: GameState): void {
		const state = gs.categories;
		const myId = this.deps.getMyPlayerId();
		if (!state || !myId) return;
		const focusedInside = this.element.contains(document.activeElement);
		const round = state.round;
		const judging = round.judgeId === myId;

		this.localizeStatic();
		this.renderScores(gs);
		this.nowLine.textContent = categoriesNowPlayingText(gs, myId, this.deps.tSync) ?? '';
		this.dutyLine.textContent = categoriesDutyText(gs, myId, this.deps.tSync) ?? '';
		this.progressLine.textContent = categoriesProgressText(gs, this.deps.tSync) ?? '';
		this.required<HTMLElement>('.categories-hero__letter').textContent = round.letter;

		// The sheet is the writers' surface; the judge never has one. Both are hidden during
		// review, when the answers themselves are the only thing on the table.
		const writingPhase = round.phase === 'preparing' || round.phase === 'writing';
		this.sheetSection.hidden = !(writingPhase && !judging);
		this.reviewSection.hidden = round.phase !== 'review';
		this.startButton.hidden = !(round.phase === 'preparing' && judging);
		// Finishing stays on offer once used, saying why it no longer does anything, rather than
		// vanishing from under the hand that just pressed it.
		const writer = writingPhase && !judging;
		this.finishButton.hidden = !(writer && round.phase === 'writing');
		this.availability(
			this.finishButton,
			categoriesCanWrite(round, myId),
			this.finishHint,
			this.t('categories_already_finished'),
		);

		if (!this.sheetSection.hidden) this.renderSheet(gs);
		if (!this.reviewSection.hidden) this.renderReview(gs, judging);

		this.renderTimer(round.startedAt ?? null, round.durationSeconds, round.phase === 'writing');

		// A timeout or a phase change can hide whatever currently owns focus. Keep keyboard and
		// screen-reader users on the family surface instead of dropping them on body.
		const focusedAfterUpdate = document.activeElement;
		if (focusedInside && (!(focusedAfterUpdate instanceof HTMLElement)
			|| !this.element.contains(focusedAfterUpdate)
			|| focusedAfterUpdate.closest('[hidden]'))) {
			this.focusHand();
		}
	}

	/**
	 * The sheet is built ONCE per round and then left alone: rebuilding it on every state update
	 * would destroy the field the writer is typing in, and with it their caret and their word.
	 */
	private renderSheet(gs: GameState): void {
		const round = gs.categories!.round;
		this.sheetHeading.textContent = this.t('categories_sheet_title', { letter: round.letter });
		if (this.sheetRound === round.roundNumber) return;

		this.sheetRound = round.roundNumber;
		this.sheet.clear();
		this.sheetList.innerHTML = '';
		const myId = this.deps.getMyPlayerId();
		for (const prompt of round.prompts) {
			const mine = prompt.answers.find(answer => answer.playerId === myId);
			this.sheet.set(prompt.categoryId, mine?.text ?? '');

			const item = document.createElement('li');
			item.className = 'categories-sheet-item';
			const inputId = `categories-answer-${prompt.categoryId}`;
			const label = document.createElement('label');
			label.className = 'categories-sheet-label';
			label.htmlFor = inputId;
			label.textContent = prompt.name;
			const input = document.createElement('input');
			input.type = 'text';
			input.id = inputId;
			input.className = 'categories-sheet-input';
			input.dataset.categoryId = prompt.categoryId;
			input.value = mine?.text ?? '';
			input.autocomplete = 'off';
			input.spellcheck = false;
			input.maxLength = 60;
			item.append(label, input);
			this.sheetList.appendChild(item);
		}
	}

	/**
	 * One category at a time, with every answer to it. The judge's rows carry the three verdicts
	 * as toolbar buttons (Right enters, Left leaves), so a category is walked with Up/Down and
	 * ruled without ever leaving the list. Everyone else gets the same rows to read, with no
	 * actions on them: the answers under discussion are the table's, not a secret of the judge's.
	 */
	private renderReview(gs: GameState, judging: boolean): void {
		const round = gs.categories!.round;
		const prompt = round.prompts[round.reviewIndex];
		if (!prompt) return;

		this.reviewHeading.textContent = this.t('categories_review_title');
		this.reviewCategory.textContent = this.t('categories_review_category', {
			category: prompt.name,
			position: round.reviewIndex + 1,
			count: round.prompts.length,
			letter: round.letter,
		});
		this.confirmButton.hidden = !judging;
		this.confirmButton.textContent = this.t('categories_confirm_button');

		// The answers themselves are part of the key. They are frozen when the review opens, but
		// a surface that keyed on the category alone would keep the verdicts it worked out from
		// the rivals' answers while they were still hidden — which is every one of them blank.
		const key = [
			round.roundNumber,
			round.reviewIndex,
			prompt.answers.map(entry => `${entry.playerId}=${entry.text}`).join('|'),
		].join(':');
		if (this.verdictsForPrompt !== key) {
			// Open the category pre-filled with the hints, so agreeing with all of them is one
			// confirmation and disagreeing with one is one button.
			this.verdicts = categoriesSuggestedVerdicts(prompt);
			this.verdictsForPrompt = key;
		}
		if (this.reviewKey === key) {
			this.refreshVerdictButtons(gs, prompt, round.letter);
			return;
		}
		this.reviewKey = key;

		this.reviewList.innerHTML = '';
		for (const answer of prompt.answers) {
			const item = document.createElement('li');
			item.className = 'categories-answer';
			item.tabIndex = -1;
			item.dataset.playerId = answer.playerId;

			const text = document.createElement('span');
			text.className = 'categories-answer__text';
			text.textContent = categoriesAnswerLabel(gs, answer, round.letter, this.deps.tSync);
			item.appendChild(text);

			// A blank answer has nothing to rule on, so it carries no actions: the judge walks
			// past it instead of being asked a question with one possible answer.
			if (judging && answer.text.trim().length > 0) {
				const actions = document.createElement('span');
				actions.className = 'categories-answer__actions';
				for (const verdict of CATEGORIES_VERDICTS) {
					const button = document.createElement('button');
					button.type = 'button';
					button.className = 'btn btn--small categories-verdict';
					button.dataset.verdict = verdict;
					button.tabIndex = -1;
					button.textContent = categoriesVerdictLabel(verdict, this.deps.tSync);
					button.addEventListener('click', () => {
						this.verdicts.set(answer.playerId, verdict);
						this.refreshVerdictButtons(gs, prompt, round.letter);
						this.deps.announce(this.t('categories_verdict_set', {
							player: categoriesPlayerName(gs, answer.playerId),
							verdict: categoriesVerdictLabel(verdict, this.deps.tSync),
						}));
					});
					actions.appendChild(button);
				}
				item.appendChild(actions);
			}
			this.reviewList.appendChild(item);
		}
		this.refreshVerdictButtons(gs, prompt, round.letter);
		this.reviewNav.refreshRovingTabindex();
	}

	/** Each row says its own verdict, and each verdict button says whether it is the one in
	 *  force. Colour alone never carries that: pressed state is the announcement. */
	private refreshVerdictButtons(gs: GameState, prompt: CategoriesPromptState, letter: string): void {
		for (const item of Array.from(this.reviewList.querySelectorAll<HTMLElement>('.categories-answer'))) {
			const playerId = item.dataset.playerId ?? '';
			const answer = prompt.answers.find(entry => entry.playerId === playerId);
			if (!answer) continue;
			const verdict = this.verdicts.get(playerId);
			const line = categoriesAnswerLabel(gs, answer, letter, this.deps.tSync);
			item.setAttribute('aria-label', answer.text.trim() && verdict
				? `${line} ${this.t('categories_verdict_in_force', { verdict: categoriesVerdictLabel(verdict, this.deps.tSync) })}`
				: line);
			for (const button of Array.from(item.querySelectorAll<HTMLButtonElement>('.categories-verdict'))) {
				button.setAttribute('aria-pressed', String(button.dataset.verdict === verdict));
			}
		}
	}

	private renderScores(gs: GameState): void {
		const focused = document.activeElement?.closest<HTMLElement>('[data-score-player]')?.dataset.scorePlayer;
		this.scoreList.innerHTML = '';
		const ranked = (gs.categories?.players ?? []).slice().sort((a, b) => b.score - a.score);
		for (const player of ranked) {
			const item = document.createElement('li');
			item.className = 'categories-score';
			item.dataset.scorePlayer = player.playerId;
			item.textContent = this.t('categories_score_line', {
				player: categoriesPlayerName(gs, player.playerId),
				score: player.score,
			});
			this.scoreList.appendChild(item);
		}
		if (focused) {
			this.scoreList.querySelector<HTMLElement>(`[data-score-player="${focused}"]`)?.focus();
		}
	}

	// ── Clock ─────────────────────────────────────────────────────────────────

	handleTimerTick(secondsRemaining: number): void {
		if (this.round()?.phase !== 'writing') {
			this.syncTimerSound(0, false);
			return;
		}
		// startLoop is idempotent, so every authoritative tick safely retries a start that may
		// have raced the package sound download without ever stacking another clock.
		this.syncTimerSound(secondsRemaining, true);
		if (secondsRemaining === 10 && this.lastTick !== 10) {
			this.deps.sounds.playEvent('categories.warning');
		}
		this.lastTick = secondsRemaining;
		this.updateTimer(secondsRemaining);
		// The clock is nearly out: stop batching, so the last word typed is the last word saved.
		if (secondsRemaining <= URGENT_SAVE_SECONDS && this.saveHandle !== null) this.saveNow();
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
		this.timerValue.textContent = this.t('categories_timer_value', { seconds: this.secondsRemaining });
		this.timerProgress.value = this.secondsRemaining;
		this.timerPanel.dataset.urgent = String(this.secondsRemaining <= 10);
	}

	// ── Family chassis ────────────────────────────────────────────────────────

	isAnimating(): boolean { return false; }

	/** T answers with the round headline and this player's own job, which is exactly what the
	 *  round card shows — hearing it and reading it can never diverge. */
	announceTurn(): boolean {
		const gs = this.deps.getGameState();
		const myId = this.deps.getMyPlayerId();
		if (!gs || !myId) return false;
		const now = categoriesNowPlayingText(gs, myId, this.deps.tSync);
		if (!now) return false;
		const duty = categoriesDutyText(gs, myId, this.deps.tSync);
		this.deps.announce(duty ? `${now} ${duty}` : now);
		return true;
	}

	/** Home is wherever this player's job is: the sheet while writing, the answers while ruling. */
	focusHand(): void {
		if (visible(this.reviewSection) && this.reviewNav.focusItem()) return;
		const input = this.sheetList.querySelector<HTMLInputElement>('.categories-sheet-input');
		if (visible(this.sheetSection) && input) {
			input.focus();
			return;
		}
		const action = [this.startButton, this.finishButton, this.confirmButton].find(visible);
		(action ?? this.shell).focus();
	}

	helpShortcuts(): HelpShortcut[] {
		return [
			...CARD_STATUS_SHORTCUTS,
			{ keys: 'enter', descKey: 'game.help_cmd_categories_next_field' },
			{ keys: 'escape', descKey: 'game.help_cmd_categories_home' },
			{ keys: 'r', descKey: 'game.help_cmd_categories_timer' },
			{ keys: 'up/down', descKey: 'game.help_cmd_categories_answers' },
			{ keys: 'right/left', descKey: 'game.help_cmd_categories_verdicts' },
		];
	}

	rulesSummary(): string[] {
		return buildCategoriesRulesLines(this.deps.getGameState()?.categoriesRules, this.deps.tSync);
	}

	// ── Helpers ───────────────────────────────────────────────────────────────

	private round() {
		return this.deps.getGameState()?.categories?.round ?? null;
	}

	private localizeStatic(): void {
		this.required('.categories-title').textContent = this.t('categories_title');
		this.required('.categories-subtitle').textContent = this.t('categories_subtitle');
		this.required('#categories-score-title').textContent = this.t('categories_scores_title');
		this.required('#categories-now-title').textContent = this.t('categories_now_title');
		this.startButton.textContent = this.t('categories_start_button');
		this.finishButton.textContent = this.t('categories_finish_button');
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

	private t(key: string, vars?: Record<string, unknown>): string {
		return this.deps.tSync(`game.${key}`, vars);
	}

	private required<T extends HTMLElement>(selector: string): T {
		const found = this.shell?.querySelector<T>(selector) ?? this.element.querySelector<T>(selector);
		if (!found) throw new Error(`CategoriesBoard missing ${selector}`);
		return found;
	}
}
