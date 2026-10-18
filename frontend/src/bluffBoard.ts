import { resetCardBoard, registerStatusKeys, CARD_STATUS_SHORTCUTS } from './cardBoardShell.js';
import { buildBluffRulesLines } from './rulesSummaries.js';
import {
	BLUFF_SCOREBOARD_SIZE,
	bluffBallotComplete,
	bluffCanWrite,
	bluffDutyText,
	bluffFunnyOptions,
	bluffIsMaster,
	bluffMyBallot,
	bluffNowPlayingText,
	bluffOptionLabel,
	bluffPlayerName,
	bluffProgressText,
	bluffRevealLines,
	bluffRivalStatus,
	bluffStandings,
	bluffStatusText,
} from './bluffRules.js';
import { isTypingTarget } from './typingTarget.js';
import type { BluffBallotState, BluffRoundState, GameState } from './models.js';
import type { HelpShortcut } from './shortcuts.js';

export interface BluffBoardDeps {
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
		write: (roundNumber: number, text: string) => void;
		finishWriting: (roundNumber: number) => void;
		vote: (roundNumber: number, final: boolean, truthPick?: number, funnyPick?: number) => void;
		nextRound: (roundNumber: number) => void;
	};
	/** Deferred work, injectable so the save debounce is testable without real time. */
	setTimer?: (handler: () => void, ms: number) => number;
	clearTimer?: (handle: number) => void;
}

const TIMER_SOUND_EVENT = 'bluff.tick';

/** How long typing pauses before the tall tale is saved: long enough not to send a command per
 *  keystroke, short enough that a clock running out never costs more than a word. */
const SAVE_DEBOUNCE_MS = 500;

/** Below this many seconds the debounce is abandoned and every change saves at once. */
const URGENT_SAVE_SECONDS = 5;

/** How long the visible echo of a query stays on screen (see categoriesBoard for the reasoning:
 *  it is an answer to a question, not a status line, so it must not outlive its truth). */
const ECHO_LIFETIME_MS = 12_000;

/** The one text box's maximum, mirroring the server's BluffRulebook.MaxLieLength. */
const MAX_LIE_LENGTH = 80;

const visible = (element: HTMLElement) => !element.hidden;

/**
 * The bluff surface: the round card, the standings, and whichever of the three jobs this player
 * has right now — the text box while writing, the ballot while voting, the results at the reveal.
 * Only one job is ever shown, and focus is kept on it across phase changes.
 */
export class BluffBoard {
	private readonly shell: HTMLElement;
	private readonly scoreList: HTMLOListElement;
	private readonly nowLine: HTMLElement;
	private readonly questionLine: HTMLElement;
	private readonly dutyLine: HTMLElement;
	private readonly progressLine: HTMLElement;
	private readonly echo: HTMLElement;
	private readonly timerPanel: HTMLElement;
	private readonly timerValue: HTMLElement;
	private readonly timerProgress: HTMLProgressElement;
	private readonly startButton: HTMLButtonElement;
	private readonly nextButton: HTMLButtonElement;
	private readonly writeSection: HTMLElement;
	private readonly lieLabel: HTMLLabelElement;
	private readonly lieInput: HTMLInputElement;
	private readonly writeHint: HTMLElement;
	private readonly finishButton: HTMLButtonElement;
	private readonly finishHint: HTMLElement;
	private readonly voteSection: HTMLElement;
	private readonly truthLegend: HTMLElement;
	private readonly truthList: HTMLElement;
	private readonly funnyFieldset: HTMLFieldSetElement;
	private readonly funnyLegend: HTMLElement;
	private readonly funnyList: HTMLElement;
	private readonly voteStatus: HTMLElement;
	private readonly revealSection: HTMLElement;
	private readonly revealList: HTMLUListElement;

	/** The tall tale as this player has typed it. The client's own copy: the server's projection
	 *  can lag a keystroke behind, and re-rendering from it would yank text out from under the
	 *  cursor. */
	private lie = '';
	private saveHandle: number | null = null;
	private echoHandle: number | null = null;
	private echoContext: string | null = null;
	/** The round whose text box is currently built, so typing is never re-rendered out from
	 *  under the caret. */
	private writeRound = -1;
	/** "<round>:<phase>:<options>" of the ballot currently built, for the same reason. */
	private ballotKey = '';
	/** Which line the funniest question was last built around, so a changed truth mark rebuilds
	 *  it and an unchanged one leaves the radios (and the focus on them) alone. */
	private funnyBuiltFor: number | null | undefined = undefined;
	private funnyPrompted = '';
	private timerStartedAt: string | null = null;
	private secondsRemaining = 0;
	private lastTick = -1;

	constructor(private readonly element: HTMLElement, private readonly deps: BluffBoardDeps) {
		resetCardBoard(element, 'bluff-board');
		element.setAttribute('aria-label', this.t('bluff_surface_label'));
		element.setAttribute('role', 'application');

		this.shell = document.createElement('div');
		this.shell.className = 'bluff-shell';
		this.shell.tabIndex = -1;
		this.shell.innerHTML = `
			<div class="bluff-headline">
				<h2 class="bluff-title"></h2>
				<p class="bluff-subtitle"></p>
			</div>
			<section class="bluff-scoreboard" aria-labelledby="bluff-score-title">
				<h3 id="bluff-score-title"></h3>
				<ol class="bluff-score-list"></ol>
			</section>
			<section class="bluff-now" aria-labelledby="bluff-now-title">
				<h3 id="bluff-now-title"></h3>
				<p class="bluff-now__line"></p>
				<p class="bluff-question"></p>
				<p class="bluff-duty"></p>
				<p class="bluff-progress"></p>
				<!-- Entirely aria-hidden, like the categories clock: a progress bar that moves every
				     second and runs BACKWARDS is sonified by NVDA over the top of the game. The clock
				     is heard as the ticking loop, and R says the seconds on demand. -->
				<div class="bluff-timer" aria-hidden="true" hidden>
					<span class="bluff-timer__value"></span>
					<progress class="bluff-timer__progress"></progress>
				</div>
				<div class="bluff-controls">
					<button type="button" class="btn btn--primary bluff-start"></button>
					<button type="button" class="btn btn--primary bluff-next"></button>
				</div>
				<!-- The answer to a shortcut this player pressed: personal, aria-hidden (the live
				     region already said it), self-replacing and short-lived. -->
				<p class="bluff-echo" aria-hidden="true" hidden></p>
			</section>
			<section class="bluff-write" aria-labelledby="bluff-write-title" hidden>
				<h3 id="bluff-write-title"></h3>
				<label class="bluff-lie-label" for="bluff-lie-input"></label>
				<input type="text" id="bluff-lie-input" class="bluff-lie-input" autocomplete="off" spellcheck="false" aria-describedby="bluff-write-hint" />
				<p id="bluff-write-hint" class="bluff-write-hint"></p>
				<div class="bluff-controls">
					<button type="button" class="btn bluff-finish"></button>
				</div>
				<p id="bluff-finish-hint" class="bluff-control-hint" hidden></p>
			</section>
			<section class="bluff-vote" aria-labelledby="bluff-vote-title" hidden>
				<h3 id="bluff-vote-title"></h3>
				<!-- Two questions, one group of radios each. A ballot that put two radios on every
				     line would make the arrow keys hop between questions instead of between lines. -->
				<fieldset class="bluff-ballot bluff-ballot--truth">
					<legend class="bluff-ballot__legend"></legend>
					<div class="bluff-options bluff-options--truth"></div>
				</fieldset>
				<fieldset class="bluff-ballot bluff-ballot--funny" hidden>
					<legend class="bluff-ballot__legend"></legend>
					<div class="bluff-options bluff-options--funny"></div>
				</fieldset>
				<p class="bluff-vote-status"></p>
			</section>
			<section class="bluff-reveal" aria-labelledby="bluff-reveal-title" hidden>
				<h3 id="bluff-reveal-title"></h3>
				<ul class="bluff-reveal-list"></ul>
			</section>
		`;
		element.appendChild(this.shell);

		this.scoreList = this.required('.bluff-score-list');
		this.nowLine = this.required('.bluff-now__line');
		this.questionLine = this.required('.bluff-question');
		this.dutyLine = this.required('.bluff-duty');
		this.progressLine = this.required('.bluff-progress');
		this.echo = this.required('.bluff-echo');
		this.timerPanel = this.required('.bluff-timer');
		this.timerValue = this.required('.bluff-timer__value');
		this.timerProgress = this.required('.bluff-timer__progress');
		this.startButton = this.required('.bluff-start');
		this.nextButton = this.required('.bluff-next');
		this.writeSection = this.required('.bluff-write');
		this.lieLabel = this.required('.bluff-lie-label');
		this.lieInput = this.required('.bluff-lie-input');
		this.writeHint = this.required('#bluff-write-hint');
		this.finishButton = this.required('.bluff-finish');
		this.finishHint = this.required('#bluff-finish-hint');
		this.voteSection = this.required('.bluff-vote');
		this.truthLegend = this.required('.bluff-ballot--truth .bluff-ballot__legend');
		this.truthList = this.required('.bluff-options--truth');
		this.funnyFieldset = this.required('.bluff-ballot--funny');
		this.funnyLegend = this.required('.bluff-ballot--funny .bluff-ballot__legend');
		this.funnyList = this.required('.bluff-options--funny');
		this.voteStatus = this.required('.bluff-vote-status');
		this.revealSection = this.required('.bluff-reveal');
		this.revealList = this.required('.bluff-reveal-list');
		this.lieInput.maxLength = MAX_LIE_LENGTH;

		this.startButton.addEventListener('click', () => {
			const round = this.round();
			if (round) this.deps.commands.startRound(round.roundNumber);
		});
		this.nextButton.addEventListener('click', () => {
			const round = this.round();
			if (round) this.deps.commands.nextRound(round.roundNumber);
		});
		this.finishButton.addEventListener('click', () => {
			if (this.finishButton.getAttribute('aria-disabled') === 'true') {
				// Spoken only: the reason is already ON SCREEN in the hint the button points at.
				this.deps.announce(this.finishHint.textContent ?? '');
				return;
			}
			this.finishWriting();
		});

		this.lieInput.addEventListener('input', () => {
			this.lie = this.lieInput.value;
			this.scheduleSave();
		});
		// Leaving the field is a decision: never let the debounce outlive it.
		this.lieInput.addEventListener('focusout', () => this.saveNow());
		this.lieInput.addEventListener('keydown', event => this.onInputKeydown(event));

		this.truthList.addEventListener('change', event => this.onPick(event, 'truth'));
		this.funnyList.addEventListener('change', event => this.onPick(event, 'funny'));

		this.element.addEventListener('keydown', event => this.onSurfaceKeydown(event));

		registerStatusKeys(element, {
			getGameState: deps.getGameState,
			getMyPlayerId: deps.getMyPlayerId,
			announce: deps.announce,
			mine: (gs, id) => bluffStatusText(gs, id, deps.tSync),
			rivals: (gs, id) => bluffRivalStatus(gs, id, deps.tSync),
		});
	}

	// ── Keyboard ──────────────────────────────────────────────────────────────

	/** Enter in the text box goes to "I have finished" and FOCUSES it rather than pressing it:
	 *  ending your round early is not something an Enter aimed at a word should ever do. */
	private onInputKeydown(event: KeyboardEvent): void {
		if (event.key !== 'Enter' || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
		event.preventDefault();
		event.stopPropagation();
		this.saveNow();
		if (visible(this.finishButton)) this.finishButton.focus();
	}

	/**
	 * The surface's two queries: P for the question ("pregunta" in Spanish, "prompt" in
	 * English), R for the clock. Both are bare letters, which inside the text box type
	 * themselves — the command prefix (Ctrl+Shift+Space, then the letter) replays them here.
	 */
	private onSurfaceKeydown(event: KeyboardEvent): void {
		if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.repeat) return;
		if (isTypingTarget(event.target)) return;

		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			this.focusHand();
			return;
		}

		const key = event.key.toLowerCase();
		const query = key === 'p' ? 'question' : key === 'r' ? 'time' : null;
		if (!query) return;
		const round = this.round();
		if (!round) return;
		event.preventDefault();
		event.stopPropagation();
		if (query === 'question') {
			this.say(round.phase === 'preparing'
				? this.t('bluff_question_none')
				: this.t('bluff_question_label', { question: round.question }));
			return;
		}
		this.say(this.timed(round)
			? this.t('bluff_timer_label', { seconds: this.secondsRemaining })
			: this.t('bluff_timer_not_running'));
	}

	private say(text: string): void {
		this.deps.announce(text);
		this.showEcho(text);
	}

	private showEcho(text: string): void {
		this.cancelEcho();
		if (!text.trim()) return;
		this.echo.textContent = text;
		this.echo.hidden = false;
		this.echoContext = this.echoContextKey();
		const setTimer = this.deps.setTimer ?? ((handler, ms) => window.setTimeout(handler, ms));
		this.echoHandle = setTimer(() => {
			this.echoHandle = null;
			this.clearEcho();
		}, ECHO_LIFETIME_MS);
	}

	private clearEcho(): void {
		this.cancelEcho();
		this.echoContext = null;
		this.echo.textContent = '';
		this.echo.hidden = true;
	}

	private echoContextKey(): string | null {
		const round = this.round();
		return round ? `${round.roundNumber}:${round.phase}` : null;
	}

	private cancelEcho(): void {
		if (this.echoHandle === null) return;
		const clearTimer = this.deps.clearTimer ?? ((handle: number) => window.clearTimeout(handle));
		clearTimer(this.echoHandle);
		this.echoHandle = null;
	}

	// ── Commands ──────────────────────────────────────────────────────────────

	private scheduleSave(): void {
		this.cancelSave();
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

	/** Send the WHOLE text. Idempotent, so a dropped message costs nothing. */
	private saveNow(): void {
		this.cancelSave();
		const round = this.round();
		const myId = this.deps.getMyPlayerId();
		if (!round || !myId || !bluffCanWrite(round, myId)) return;
		this.deps.commands.write(round.roundNumber, this.lie);
	}

	private finishWriting(): void {
		const round = this.round();
		if (!round) return;
		this.saveNow();
		this.deps.commands.finishWriting(round.roundNumber);
	}

	/** A radio changed: send that one mark. The server keeps the other, so a lost message costs
	 *  one line at most, and the next state repaints whatever it holds. */
	private onPick(event: Event, question: 'truth' | 'funny'): void {
		const input = event.target;
		if (!(input instanceof HTMLInputElement) || !input.checked) return;
		const round = this.round();
		if (!round) return;
		const index = Number(input.value);
		const final = round.phase === 'final_voting';
		if (question === 'truth') {
			this.deps.commands.vote(round.roundNumber, final, index, undefined);
			// The second question is built from the first answer, right away, so the next arrow
			// press has somewhere to go — and it is announced, because a group that appears below
			// the one you are in is silent otherwise.
			const ballot = this.myBallot();
			if (ballot && ballot.asksFunny) {
				this.renderFunny({ ...ballot, truthPick: index, funnyPick: ballot.funnyPick === index ? null : ballot.funnyPick });
				const promptKey = `${round.roundNumber}:${round.phase}`;
				if (this.funnyPrompted !== promptKey) {
					this.funnyPrompted = promptKey;
					this.deps.announce(this.t('bluff_funny_prompt'));
				}
			}
			return;
		}
		this.deps.commands.vote(round.roundNumber, final, undefined, index);
	}

	// ── Rendering ─────────────────────────────────────────────────────────────

	update(gs: GameState): void {
		const state = gs.bluff;
		const myId = this.deps.getMyPlayerId();
		if (!state || !myId) return;
		const focusedInside = this.element.contains(document.activeElement);
		const round = state.round;
		const master = bluffIsMaster(state, myId);

		if (this.echoContext !== null && this.echoContext !== `${round.roundNumber}:${round.phase}`) {
			this.clearEcho();
		}

		this.localizeStatic();
		this.renderScores(gs, myId);
		this.nowLine.textContent = bluffNowPlayingText(gs, myId, this.deps.tSync) ?? '';
		// The question is on the card from the moment it is read until the round is over; before
		// that the card says so rather than showing an empty line.
		this.questionLine.textContent = round.phase === 'preparing' ? '' : round.question;
		this.questionLine.hidden = round.phase === 'preparing';
		this.dutyLine.textContent = bluffDutyText(gs, myId, this.deps.tSync) ?? '';
		this.progressLine.textContent = bluffProgressText(gs, this.deps.tSync) ?? '';

		const voting = round.phase === 'voting' || round.phase === 'final_voting';
		this.writeSection.hidden = round.phase !== 'writing';
		this.voteSection.hidden = !(voting && this.myBallot() !== null);
		this.revealSection.hidden = round.phase !== 'reveal';
		this.startButton.hidden = !(round.phase === 'preparing' && master);
		this.nextButton.hidden = !(round.phase === 'reveal' && master);
		this.nextButton.textContent = this.t(round.roundNumber >= state.roundsToPlay ? 'bluff_end_button' : 'bluff_next_button');
		this.finishButton.hidden = round.phase !== 'writing';
		this.availability(this.finishButton, bluffCanWrite(round, myId), this.finishHint, this.t('bluff_already_finished'));

		if (!this.writeSection.hidden) this.renderWrite(round, myId);
		if (!this.voteSection.hidden) this.renderVote(round);
		if (!this.revealSection.hidden) this.renderReveal(gs, myId);

		this.renderTimer(round.startedAt ?? null, round.durationSeconds, this.timed(round));

		// A phase change hides whatever owned focus. Keep keyboard and screen-reader users on
		// the surface, on their new job, instead of dropping them on body.
		const focusedAfterUpdate = document.activeElement;
		if (focusedInside && (!(focusedAfterUpdate instanceof HTMLElement)
			|| !this.element.contains(focusedAfterUpdate)
			|| focusedAfterUpdate.closest('[hidden]'))) {
			this.focusHand();
		}
	}

	/** The text box is built ONCE per round and then left alone: rebuilding it on every state
	 *  update would destroy the field the writer is typing in. */
	private renderWrite(round: BluffRoundState, myId: string): void {
		this.lieLabel.textContent = this.t('bluff_lie_label');
		this.writeHint.textContent = this.t('bluff_write_hint');
		if (this.writeRound === round.roundNumber) return;
		this.writeRound = round.roundNumber;
		const mine = round.entries.find(entry => entry.playerId === myId);
		this.lie = mine?.text ?? '';
		this.lieInput.value = this.lie;
	}

	/**
	 * The ballot: one radio group for the truth, built once per vote, and the funniest group
	 * built from whatever the truth mark is. Both are rebuilt only when their lines change, so a
	 * state update never moves the focus off the radio the voter is on.
	 */
	private renderVote(round: BluffRoundState): void {
		const ballot = this.myBallot();
		if (!ballot) return;
		this.truthLegend.textContent = this.t(ballot.truthKnown ? 'bluff_truth_legend_known' : 'bluff_truth_legend');
		this.voteStatus.textContent = bluffBallotComplete(ballot) ? this.t('bluff_ballot_in') : '';

		const key = [round.roundNumber, round.phase, ballot.options.map(option => option.text).join('|')].join(':');
		if (this.ballotKey !== key) {
			this.ballotKey = key;
			this.funnyBuiltFor = undefined;
			this.funnyPrompted = '';
			this.truthList.innerHTML = '';
			for (const option of ballot.options) {
				this.truthList.appendChild(this.radio('bluff-truth', option, ballot.truthPick === option.index));
			}
		} else {
			this.syncChecked(this.truthList, ballot.truthPick);
		}

		if (!ballot.asksFunny || ballot.truthPick == null) {
			this.funnyFieldset.hidden = true;
			this.funnyList.innerHTML = '';
			this.funnyBuiltFor = undefined;
			return;
		}
		this.renderFunny(ballot);
	}

	private renderFunny(ballot: BluffBallotState): void {
		this.funnyFieldset.hidden = false;
		this.funnyLegend.textContent = this.t('bluff_funny_legend');
		if (this.funnyBuiltFor === ballot.truthPick) {
			this.syncChecked(this.funnyList, ballot.funnyPick);
			return;
		}
		this.funnyBuiltFor = ballot.truthPick;
		this.funnyList.innerHTML = '';
		for (const option of bluffFunnyOptions(ballot)) {
			this.funnyList.appendChild(this.radio('bluff-funny', option, ballot.funnyPick === option.index));
		}
	}

	private radio(name: string, option: { index: number; text: string }, checked: boolean): HTMLElement {
		const label = document.createElement('label');
		label.className = 'bluff-option';
		const input = document.createElement('input');
		input.type = 'radio';
		input.name = name;
		input.value = String(option.index);
		input.className = 'bluff-option__input';
		input.checked = checked;
		const text = document.createElement('span');
		text.className = 'bluff-option__text';
		text.textContent = bluffOptionLabel(option, this.deps.tSync);
		label.append(input, text);
		return label;
	}

	/** Reflect the server's mark without rebuilding: a repaint must never take a radio away from
	 *  under the arrow keys. */
	private syncChecked(list: HTMLElement, index: number | null | undefined): void {
		for (const input of Array.from(list.querySelectorAll<HTMLInputElement>('input[type="radio"]'))) {
			input.checked = index != null && Number(input.value) === index;
		}
	}

	private renderReveal(gs: GameState, myId: string): void {
		this.revealList.innerHTML = '';
		for (const line of bluffRevealLines(gs, myId, this.deps.tSync)) {
			const item = document.createElement('li');
			item.className = 'bluff-reveal__line';
			item.textContent = line;
			this.revealList.appendChild(item);
		}
	}

	/** The top of the table, and my own line when I am below it: a hall of two hundred reads
	 *  its leaders, not its whole roster (the players panel still has everyone). */
	private renderScores(gs: GameState, myId: string): void {
		this.scoreList.innerHTML = '';
		const standings = bluffStandings(gs.bluff!);
		const shown = standings.slice(0, BLUFF_SCOREBOARD_SIZE);
		const myIndex = standings.findIndex(player => player.playerId === myId);
		if (myIndex >= BLUFF_SCOREBOARD_SIZE) shown.push(standings[myIndex]);
		for (const player of shown) {
			const item = document.createElement('li');
			item.className = 'bluff-score';
			if (player.playerId === myId) item.classList.add('bluff-score--me');
			item.textContent = this.t(player.playerId === myId ? 'bluff_score_line_self' : 'bluff_score_line', {
				place: standings.indexOf(player) + 1,
				player: bluffPlayerName(gs, player.playerId),
				score: player.score,
			});
			this.scoreList.appendChild(item);
		}
	}

	// ── Clock ─────────────────────────────────────────────────────────────────

	handleTimerTick(secondsRemaining: number): void {
		const round = this.round();
		if (!round || !this.timed(round)) {
			this.syncTimerSound(0, false);
			return;
		}
		this.syncTimerSound(secondsRemaining, true);
		if (secondsRemaining === 10 && this.lastTick !== 10) {
			this.deps.sounds.playEvent('bluff.warning');
		}
		this.lastTick = secondsRemaining;
		this.updateTimer(secondsRemaining);
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
		this.timerValue.textContent = this.t('bluff_timer_value', { seconds: this.secondsRemaining });
		this.timerProgress.value = this.secondsRemaining;
		this.timerPanel.dataset.urgent = String(this.secondsRemaining <= 10);
	}

	// ── Family chassis ────────────────────────────────────────────────────────

	isAnimating(): boolean { return false; }

	/** T answers with the round headline and this player's own job. */
	announceTurn(): boolean {
		const gs = this.deps.getGameState();
		const myId = this.deps.getMyPlayerId();
		if (!gs || !myId) return false;
		const now = bluffNowPlayingText(gs, myId, this.deps.tSync);
		if (!now) return false;
		const duty = bluffDutyText(gs, myId, this.deps.tSync);
		this.deps.announce(duty ? `${now} ${duty}` : now);
		return true;
	}

	/** Home is wherever this player's job is: the text box, the ballot, the results. */
	focusHand(): void {
		if (visible(this.writeSection)) {
			if (bluffCanWrite(this.round()!, this.deps.getMyPlayerId() ?? '')) {
				this.lieInput.focus();
			} else {
				this.finishButton.focus();
			}
			return;
		}
		if (visible(this.voteSection)) {
			const pending = this.funnyFieldset.hidden ? this.truthList : this.funnyList;
			const radios = Array.from(pending.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
			(radios.find(radio => radio.checked) ?? radios[0] ?? this.shell).focus();
			return;
		}
		if (visible(this.revealSection) && visible(this.nextButton)) {
			this.nextButton.focus();
			return;
		}
		if (visible(this.revealSection)) {
			this.revealSection.querySelector<HTMLElement>('h3')?.setAttribute('tabindex', '-1');
			(this.revealSection.querySelector<HTMLElement>('h3') ?? this.shell).focus();
			return;
		}
		(visible(this.startButton) ? this.startButton : this.shell).focus();
	}

	helpShortcuts(): HelpShortcut[] {
		return [
			...CARD_STATUS_SHORTCUTS,
			{ keys: 'enter', descKey: 'game.help_cmd_bluff_next_field' },
			{ keys: 'escape', descKey: 'game.help_cmd_bluff_home' },
			{ keys: 'p', descKey: 'game.help_cmd_bluff_question' },
			{ keys: 'r', descKey: 'game.help_cmd_bluff_timer' },
			{ keys: 'up/down', descKey: 'game.help_cmd_bluff_lines' },
		];
	}

	rulesSummary(): string[] {
		return buildBluffRulesLines(this.deps.getGameState()?.bluffRules, this.deps.tSync);
	}

	// ── Helpers ───────────────────────────────────────────────────────────────

	private round() {
		return this.deps.getGameState()?.bluff?.round ?? null;
	}

	private myBallot(): BluffBallotState | null {
		const round = this.round();
		const myId = this.deps.getMyPlayerId();
		return round && myId ? bluffMyBallot(round, myId) : null;
	}

	private timed(round: BluffRoundState): boolean {
		return round.phase === 'writing' || round.phase === 'voting' || round.phase === 'final_voting';
	}

	private localizeStatic(): void {
		this.required('.bluff-title').textContent = this.t('bluff_title');
		this.required('.bluff-subtitle').textContent = this.t('bluff_subtitle');
		this.required('#bluff-score-title').textContent = this.t('bluff_scores_title');
		this.required('#bluff-now-title').textContent = this.t('bluff_now_title');
		this.required('#bluff-write-title').textContent = this.t('bluff_write_title');
		this.required('#bluff-vote-title').textContent = this.t('bluff_vote_title');
		this.required('#bluff-reveal-title').textContent = this.t('bluff_reveal_title');
		this.startButton.textContent = this.t('bluff_start_button');
		this.finishButton.textContent = this.t('bluff_finish_button');
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
		if (!found) throw new Error(`BluffBoard missing ${selector}`);
		return found;
	}
}
