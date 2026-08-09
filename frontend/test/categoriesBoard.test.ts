import test from 'node:test';
import assert from 'node:assert/strict';
import { CategoriesBoard } from '../src/categoriesBoard.js';
import type {
	CategoriesAnswerState, CategoriesEntry, CategoriesRoundPhase, CategoriesRuling, GameState,
} from '../src/models.js';
import { installFakeI18next, setupDom } from './helpers/dom.js';

setupDom();
installFakeI18next('en');
document.documentElement.lang = 'en';

const translate = (key: string, vars?: Record<string, unknown>) =>
	(globalThis as any).window.i18next.t(key, vars);

function player(id: string, name: string) {
	return { id, name, token: id, position: 0, money: 0, properties: [], releasePasses: 0 };
}

function answer(playerId: string, text: string, extra: Partial<CategoriesAnswerState> = {}): CategoriesAnswerState {
	return { playerId, text, verdict: 'pending', duplicateGroup: -1, matchesLetter: true, ...extra };
}

function gameState(phase: CategoriesRoundPhase = 'preparing'): GameState {
	return {
		gameType: 'categories',
		players: [player('p0', 'Ada'), player('p1', 'Berto'), player('p2', 'Cora')],
		bank: { money: 0 },
		currentTurn: 'p0',
		ownership: [],
		squares: [],
		categoriesRules: { roundSeconds: 120, categoriesPerRound: 2, pointsPerAnswer: 1, cycles: 1 },
		categories: {
			players: [
				{ playerId: 'p0', score: 0, roundsJudged: 0 },
				{ playerId: 'p1', score: 2, roundsJudged: 0 },
				{ playerId: 'p2', score: 1, roundsJudged: 0 },
			],
			cycle: 1,
			categoryCursor: 2,
			letterCursor: 1,
			round: {
				roundNumber: 1,
				judgeId: 'p0',
				letter: 'R',
				phase,
				startedAt: phase === 'writing' ? new Date().toISOString() : null,
				durationSeconds: 120,
				finishedWriterIds: [],
				reviewIndex: 0,
				prompts: [
					{
						categoryId: 'animal',
						name: 'An animal',
						answers: [answer('p1', ''), answer('p2', '')],
					},
					{
						categoryId: 'city',
						name: 'A city',
						answers: [answer('p1', ''), answer('p2', '')],
					},
				],
			},
		},
	} as unknown as GameState;
}

interface Harness {
	board: CategoriesBoard;
	element: HTMLElement;
	state: GameState;
	writes: { round: number; entries: CategoriesEntry[] }[];
	rulings: { round: number; promptIndex: number; rulings: CategoriesRuling[] }[];
	started: number[];
	finished: number[];
	announced: string[];
	loops: string[];
	runTimers: () => void;
	render: () => void;
}

function harness(myId: string, phase: CategoriesRoundPhase = 'preparing'): Harness {
	const element = document.createElement('div');
	element.id = 'board';
	document.body.innerHTML = '';
	document.body.appendChild(element);

	const state = gameState(phase);
	const writes: Harness['writes'] = [];
	const rulings: Harness['rulings'] = [];
	const started: number[] = [];
	const finished: number[] = [];
	const announced: string[] = [];
	const loops: string[] = [];
	let pending: (() => void)[] = [];

	const board = new CategoriesBoard(element, {
		getGameState: () => state,
		getMyPlayerId: () => myId,
		announce: text => { announced.push(text); },
		tSync: translate,
		sounds: {
			playEvent: key => { loops.push(`play:${key}`); },
			startLoop: key => { loops.push(`start:${key}`); },
			stopLoop: key => { loops.push(`stop:${key}`); return true; },
		},
		commands: {
			startRound: round => { started.push(round); },
			write: (round, entries) => { writes.push({ round, entries }); },
			finishWriting: round => { finished.push(round); },
			rulePrompt: (round, promptIndex, entries) => {
				rulings.push({ round, promptIndex, rulings: entries });
			},
		},
		setTimer: handler => { pending.push(handler); return pending.length; },
		clearTimer: () => { pending = []; },
	});
	const render = () => board.update(state);
	render();
	return {
		board, element, state, writes, rulings, started, finished, announced, loops,
		runTimers: () => { const due = pending; pending = []; due.forEach(fn => fn()); },
		render,
	};
}

const inputs = (h: Harness) =>
	Array.from(h.element.querySelectorAll<HTMLInputElement>('.categories-sheet-input'));
const rows = (h: Harness) =>
	Array.from(h.element.querySelectorAll<HTMLElement>('.categories-answer'));
const visible = (selector: string, h: Harness) => {
	const found = h.element.querySelector<HTMLElement>(selector);
	return !!found && !found.hidden;
};

function type(input: HTMLInputElement, value: string): void {
	input.value = value;
	input.dispatchEvent(new window.Event('input', { bubbles: true }));
}

test('the sheet is one labelled text box per category, and the judge is given none', () => {
	const writer = harness('p1');
	const judge = harness('p0');

	assert.equal(inputs(writer).length, 2);
	for (const input of inputs(writer)) {
		const label = writer.element.querySelector<HTMLLabelElement>(`label[for="${input.id}"]`);
		assert.ok(label && label.textContent, 'every field is named by a real label');
	}
	assert.equal(visible('.categories-sheet', judge), false);
	assert.equal(visible('.categories-start', judge), true, 'the judge starts the clock');
	assert.equal(visible('.categories-start', writer), false);
});

test('the letter die shows the round letter and re-rolls only when a new round deals one', () => {
	const h = harness('p1');
	const die = h.element.querySelector<HTMLElement>('.categories-die')!;

	assert.equal(die.getAttribute('aria-hidden'), 'true', 'the die is decoration, never the only copy');
	assert.equal(h.element.querySelector('.categories-die__letter')!.textContent, 'R');
	assert.equal(die.classList.contains('categories-die--rolling'), true);

	// A repaint for any other reason must not re-roll a die that is already sitting there.
	die.classList.remove('categories-die--rolling');
	h.render();
	assert.equal(die.classList.contains('categories-die--rolling'), false);

	h.state.categories!.round = {
		...h.state.categories!.round,
		roundNumber: 2,
		letter: 'M',
	};
	h.render();
	assert.equal(h.element.querySelector('.categories-die__letter')!.textContent, 'M');
	assert.equal(die.classList.contains('categories-die--rolling'), true);
});

test('the round heading names the letter every answer has to start with', () => {
	const writer = harness('p1');

	const heading = writer.element.querySelector('#categories-sheet-title')!.textContent!;

	assert.match(heading, /\bR\b/);
});

test('typing saves the WHOLE sheet once, after the pause, and never a command per keystroke', () => {
	const h = harness('p1', 'writing');
	const [first] = inputs(h);

	type(first, 'r');
	type(first, 'ra');
	type(first, 'rabbit');
	assert.deepEqual(h.writes, [], 'nothing is sent while the writer is still typing');

	h.runTimers();

	assert.equal(h.writes.length, 1);
	assert.equal(h.writes[0].round, 1);
	assert.deepEqual(h.writes[0].entries, [
		{ categoryId: 'animal', text: 'rabbit' },
		{ categoryId: 'city', text: '' },
	]);
});

test('leaving a field saves it immediately: a decision never waits out the debounce', () => {
	const h = harness('p1', 'writing');

	type(inputs(h)[0], 'rabbit');
	h.element.querySelector('.categories-sheet-list')!
		.dispatchEvent(new window.Event('focusout', { bubbles: true }));

	assert.equal(h.writes.length, 1);
	assert.equal(h.writes[0].entries[0].text, 'rabbit');
});

test('with the clock nearly out every change saves at once, so the last word is not lost', () => {
	const h = harness('p1', 'writing');
	h.board.handleTimerTick(3);

	type(inputs(h)[0], 'rabbit');

	assert.equal(h.writes.length, 1, 'no debounce is left to outlive the deadline');
});

test('Enter walks the sheet and stops on "I have finished" without pressing it', () => {
	const h = harness('p1', 'writing');
	const [first, second] = inputs(h);
	first.focus();

	first.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
	assert.equal(document.activeElement, second);

	second.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
	const finish = h.element.querySelector<HTMLButtonElement>('.categories-finish')!;
	assert.equal(document.activeElement, finish);
	assert.deepEqual(h.finished, [], 'ending the round early is never an accident of Enter');

	finish.click();
	assert.deepEqual(h.finished, [1]);
});

test('the letters the board uses as commands are typed, not swallowed, inside the sheet', () => {
	const h = harness('p1', 'writing');
	const [first] = inputs(h);
	first.focus();

	for (const key of ['r', 's', 'S']) {
		const event = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
		first.dispatchEvent(event);
		assert.equal(event.defaultPrevented, false, key);
	}
	assert.deepEqual(h.announced, []);
});

test('R says the time remaining from outside a text field, and says so when nothing is running', () => {
	const h = harness('p1', 'writing');
	h.board.handleTimerTick(42);

	h.element.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'r', bubbles: true, cancelable: true }));
	assert.match(h.announced.at(-1)!, /42/);

	const idle = harness('p1', 'preparing');
	idle.element.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'r', bubbles: true, cancelable: true }));
	assert.match(idle.announced.at(-1)!, /not running/i);
});

test('the clock is entirely aria-hidden, and its loop follows the phase', () => {
	const h = harness('p1', 'writing');

	const timer = h.element.querySelector<HTMLElement>('.categories-timer')!;
	assert.equal(timer.getAttribute('aria-hidden'), 'true');
	assert.equal(timer.hidden, false);
	assert.ok(h.loops.some(entry => entry === 'start:categories.tick'));

	h.state.categories!.round.phase = 'review';
	h.render();
	assert.equal(h.element.querySelector<HTMLElement>('.categories-timer')!.hidden, true);
	assert.equal(h.loops.at(-1), 'stop:categories.tick');
});

test('a finished writer keeps the control, with a spoken reason instead of a vanished button', () => {
	const h = harness('p1', 'writing');
	h.state.categories!.round.finishedWriterIds = ['p1'];
	h.render();

	const finish = h.element.querySelector<HTMLButtonElement>('.categories-finish')!;
	assert.equal(finish.hidden, false);
	assert.equal(finish.hasAttribute('disabled'), false, 'the disabled attribute is never used');
	assert.equal(finish.getAttribute('aria-disabled'), 'true');
	const hint = h.element.querySelector<HTMLElement>(`#${finish.getAttribute('aria-describedby')}`)!;
	assert.equal(hint.hidden, false);

	finish.click();
	assert.deepEqual(h.finished, [], 'the control explains itself instead of acting');
	assert.equal(h.announced.at(-1), hint.textContent);
});

// ── Review ────────────────────────────────────────────────────────────────────

function reviewHarness(myId: string): Harness {
	const h = harness(myId, 'review');
	const prompt = h.state.categories!.round.prompts[0];
	prompt.answers = [
		answer('p1', 'rabbit'),
		answer('p2', 'cat', { matchesLetter: false }),
	];
	h.render();
	return h;
}

test('every answer is one focus stop whose label reads the whole line and its verdict', () => {
	const h = reviewHarness('p0');

	const [first, second] = rows(h);
	assert.equal(first.tabIndex, 0, 'the list is a single tab stop');
	assert.equal(second.tabIndex, -1);
	assert.match(first.getAttribute('aria-label')!, /Berto wrote rabbit\./);
	assert.match(first.getAttribute('aria-label')!, /Valid/);
	assert.match(second.getAttribute('aria-label')!, /does not start with R/i);
	assert.match(second.getAttribute('aria-label')!, /Invalid/);
});

test('the judge opens each category pre-filled with the hints, and can overrule any of them', () => {
	const h = reviewHarness('p0');
	const [first, second] = rows(h);

	const pressed = (row: HTMLElement) => Array.from(row.querySelectorAll<HTMLButtonElement>('.categories-verdict'))
		.filter(button => button.getAttribute('aria-pressed') === 'true')
		.map(button => button.dataset.verdict);
	assert.deepEqual(pressed(first), ['accepted']);
	assert.deepEqual(pressed(second), ['rejected'], 'the wrong initial opens rejected');

	second.querySelector<HTMLButtonElement>('.categories-verdict[data-verdict="accepted"]')!.click();
	assert.deepEqual(pressed(second), ['accepted'], 'the judge has the last word, not the hint');
	assert.match(h.announced.at(-1)!, /Cora/);

	h.element.querySelector<HTMLButtonElement>('.categories-confirm')!.click();
	assert.equal(h.rulings.length, 1);
	assert.deepEqual(h.rulings[0].rulings, [
		{ playerId: 'p1', verdict: 'accepted' },
		{ playerId: 'p2', verdict: 'accepted' },
	]);
});

test('a writer reads the same answers under review but is given no verdict to press', () => {
	const h = reviewHarness('p1');

	assert.equal(rows(h).length, 2);
	assert.equal(h.element.querySelectorAll('.categories-verdict').length, 0);
	assert.equal(visible('.categories-confirm', h), false);
	assert.equal(visible('.categories-sheet', h), false);
});

test('a blank answer carries no verdict buttons and never reaches the ruling', () => {
	const h = harness('p0', 'review');
	h.state.categories!.round.prompts[0].answers = [answer('p1', 'rabbit'), answer('p2', '  ')];
	h.render();

	const [, blank] = rows(h);
	assert.equal(blank.querySelectorAll('.categories-verdict').length, 0);
	assert.match(blank.getAttribute('aria-label')!, /nothing/i);

	h.element.querySelector<HTMLButtonElement>('.categories-confirm')!.click();
	assert.deepEqual(h.rulings[0].rulings, [{ playerId: 'p1', verdict: 'accepted' }]);
});

test('moving to the next category rebuilds the rows and re-arms the suggestions', () => {
	const h = reviewHarness('p0');
	h.element.querySelector<HTMLButtonElement>('.categories-confirm')!.click();

	h.state.categories!.round.reviewIndex = 1;
	h.state.categories!.round.prompts[1].answers = [answer('p1', 'Rome'), answer('p2', 'Reus')];
	h.render();

	assert.match(h.element.querySelector('.categories-review__category')!.textContent!, /A city/);
	assert.equal(rows(h).length, 2);
	assert.equal(
		rows(h)[0].querySelector<HTMLButtonElement>('.categories-verdict[aria-pressed="true"]')!.dataset.verdict,
		'accepted');
});

test('focus never falls off the surface when a phase change hides what was focused', () => {
	const h = harness('p1', 'writing');
	inputs(h)[0].focus();

	h.state.categories!.round.phase = 'review';
	h.state.categories!.round.prompts[0].answers = [answer('p1', 'rabbit'), answer('p2', 'rat')];
	h.render();

	assert.ok(h.element.contains(document.activeElement), 'focus stayed inside the family surface');
	assert.ok(document.activeElement?.classList.contains('categories-answer'));
});

test('T answers with the round headline and this player\'s own job', () => {
	const h = harness('p1', 'writing');

	assert.equal(h.board.announceTurn(), true);
	assert.match(h.announced.at(-1)!, /Round 1/);
	assert.match(h.announced.at(-1)!, /Write one answer/i);
});
