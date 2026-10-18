import test from 'node:test';
import assert from 'node:assert/strict';
import { BluffBoard } from '../src/bluffBoard.js';
import type { BluffBallotState, BluffPhase, GameState } from '../src/models.js';
import { installFakeI18next, setupDom } from './helpers/dom.js';

setupDom();
installFakeI18next('en');
document.documentElement.lang = 'en';

const translate = (key: string, vars?: Record<string, unknown>) =>
	(globalThis as any).window.i18next.t(key, vars);

function player(id: string, name: string) {
	return { id, name, token: 'seat', position: 0, money: 0, properties: [], releasePasses: 0 };
}

function ballot(playerId: string, extra: Partial<BluffBallotState> = {}): BluffBallotState {
	return {
		playerId,
		options: [
			{ index: 0, text: 'The Moon', key: '' },
			{ index: 1, text: 'A tortoise', key: '' },
			{ index: 2, text: 'Mars', key: '' },
		],
		asksFunny: true,
		truthKnown: false,
		truthPick: null,
		funnyPick: null,
		...extra,
	};
}

function gameState(phase: BluffPhase = 'preparing', overrides: Record<string, unknown> = {}): GameState {
	return {
		gameType: 'bluff',
		players: Array.from({ length: 12 }, (_, i) => player(`p${i}`, `Player ${i}`)),
		bank: { money: 0 },
		currentTurn: null,
		ownership: [],
		squares: [],
		bluffRules: { writeSeconds: 45, voteSeconds: 30, rounds: 3, truthPoints: 1000, foolPoints: 500, ballotSize: 7, finalists: 6 },
		bluff: {
			players: Array.from({ length: 12 }, (_, i) => ({ playerId: `p${i}`, score: (11 - i) * 100 })),
			masterId: 'p0',
			questionCursor: 1,
			roundsToPlay: 3,
			round: {
				roundNumber: 1,
				questionId: 'q0',
				question: 'An octopus has ___ hearts.',
				truth: '',
				phase,
				startedAt: phase === 'writing' || phase === 'voting' ? new Date().toISOString() : null,
				durationSeconds: 45,
				entries: Array.from({ length: 12 }, (_, i) => ({ playerId: `p${i}`, text: '', finished: false })),
				lies: [],
				ballots: phase === 'voting' ? [ballot('p1')] : [],
				hasFinal: false,
				finalBallots: [],
				truthFinderIds: [],
				finalTruthFinderIds: [],
				reveal: null,
				pendingCount: 12,
				...overrides,
			},
		},
	} as unknown as GameState;
}

interface Harness {
	board: BluffBoard;
	element: HTMLElement;
	state: GameState;
	writes: { round: number; text: string }[];
	votes: { round: number; final: boolean; truth?: number; funny?: number }[];
	started: number[];
	finished: number[];
	next: number[];
	announced: string[];
	loops: string[];
	runTimers: () => void;
	render: () => void;
}

function harness(myId: string, phase: BluffPhase = 'preparing', overrides: Record<string, unknown> = {}): Harness {
	const element = document.createElement('div');
	element.id = 'board';
	document.body.innerHTML = '';
	document.body.appendChild(element);

	const state = gameState(phase, overrides);
	const writes: Harness['writes'] = [];
	const votes: Harness['votes'] = [];
	const started: number[] = [];
	const finished: number[] = [];
	const next: number[] = [];
	const announced: string[] = [];
	const loops: string[] = [];
	let pending: (() => void)[] = [];

	const board = new BluffBoard(element, {
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
			write: (round, text) => { writes.push({ round, text }); },
			finishWriting: round => { finished.push(round); },
			vote: (round, final, truth, funny) => { votes.push({ round, final, truth, funny }); },
			nextRound: round => { next.push(round); },
		},
		setTimer: handler => { pending.push(handler); return pending.length; },
		clearTimer: () => { pending = []; },
	});
	const render = () => board.update(state);
	render();
	return {
		board, element, state, writes, votes, started, finished, next, announced, loops,
		runTimers: () => { const due = pending; pending = []; due.forEach(fn => fn()); },
		render,
	};
}

const visible = (selector: string, h: Harness) => {
	const found = h.element.querySelector<HTMLElement>(selector);
	return !!found && !found.hidden && !found.closest('[hidden]');
};
const input = (h: Harness) => h.element.querySelector<HTMLInputElement>('.bluff-lie-input')!;
const radios = (h: Harness, group: 'truth' | 'funny') =>
	Array.from(h.element.querySelectorAll<HTMLInputElement>(`.bluff-options--${group} input[type="radio"]`));

function type(field: HTMLInputElement, value: string): void {
	field.value = value;
	field.dispatchEvent(new window.Event('input', { bubbles: true }));
}

function check(radio: HTMLInputElement): void {
	radio.checked = true;
	radio.dispatchEvent(new window.Event('change', { bubbles: true }));
}

test('only the master is offered the start, and the question stays unread until the clock starts', () => {
	const master = harness('p0');
	const guest = harness('p1');

	assert.equal(visible('.bluff-start', master), true);
	assert.equal(visible('.bluff-start', guest), false);
	assert.equal(visible('.bluff-question', master), false, 'nobody gets a head start thinking');
	assert.equal(visible('.bluff-write', master), false);

	master.element.querySelector<HTMLButtonElement>('.bluff-start')!.click();
	assert.deepEqual(master.started, [1]);
});

test('while writing everyone gets one labelled text box, the question on the card, and a finish button', () => {
	const h = harness('p1', 'writing');

	assert.equal(visible('.bluff-write', h), true);
	assert.equal(h.element.querySelector('.bluff-question')!.textContent, 'An octopus has ___ hearts.');
	const field = input(h);
	const label = h.element.querySelector<HTMLLabelElement>(`label[for="${field.id}"]`);
	assert.ok(label && label.textContent, 'the field is named by a real label');
	assert.equal(field.maxLength, 80);
	assert.equal(visible('.bluff-finish', h), true);
	assert.equal(visible('.bluff-start', h), false);
	assert.equal(visible('.bluff-vote', h), false);
});

test('typing saves the whole text once after the pause, and leaving the field saves at once', () => {
	const h = harness('p1', 'writing');
	const field = input(h);

	type(field, 'tw');
	type(field, 'two');
	assert.equal(h.writes.length, 0, 'nothing is sent per keystroke');
	h.runTimers();
	assert.deepEqual(h.writes, [{ round: 1, text: 'two' }]);

	type(field, 'two hearts');
	field.dispatchEvent(new window.Event('focusout', { bubbles: true }));
	assert.equal(h.writes.at(-1)!.text, 'two hearts');
});

test('with the clock nearly out every change saves at once', () => {
	const h = harness('p1', 'writing');
	h.board.handleTimerTick(4);

	type(input(h), 'late word');
	assert.equal(h.writes.length, 1);
});

test('Enter in the text box goes to "I have finished" without pressing it', () => {
	const h = harness('p1', 'writing');
	const field = input(h);
	type(field, 'two');
	field.focus();

	field.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

	assert.equal(document.activeElement, h.element.querySelector('.bluff-finish'));
	assert.equal(h.finished.length, 0);
	assert.equal(h.writes.at(-1)!.text, 'two', 'and the text is saved on the way');
});

test('a finished writer keeps the control, with a spoken reason instead of a vanished button', () => {
	const h = harness('p1', 'writing');
	h.element.querySelector<HTMLButtonElement>('.bluff-finish')!.click();
	assert.deepEqual(h.finished, [1]);

	h.state.bluff!.round.entries[1].finished = true;
	h.render();
	const button = h.element.querySelector<HTMLButtonElement>('.bluff-finish')!;
	assert.equal(button.hidden, false);
	assert.equal(button.getAttribute('aria-disabled'), 'true');
	assert.equal(button.hasAttribute('disabled'), false);
	assert.equal(button.getAttribute('aria-describedby'), 'bluff-finish-hint');
	button.click();
	assert.equal(h.finished.length, 1, 'pressing it again sends nothing');
	assert.match(h.announced.at(-1)!, /already finished/);
});

test('P says the question and R the clock from the surface, never from inside the text box', () => {
	const h = harness('p1', 'writing');
	h.board.handleTimerTick(42);

	h.element.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'p', bubbles: true, cancelable: true }));
	assert.match(h.announced.at(-1)!, /An octopus has/);
	h.element.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'r', bubbles: true, cancelable: true }));
	assert.match(h.announced.at(-1)!, /42 seconds/);
	const echo = h.element.querySelector<HTMLElement>('.bluff-echo')!;
	assert.equal(echo.hidden, false);
	assert.equal(echo.getAttribute('aria-hidden'), 'true');

	const before = h.announced.length;
	const field = input(h);
	field.focus();
	const typed = new window.KeyboardEvent('keydown', { key: 'p', bubbles: true, cancelable: true });
	field.dispatchEvent(typed);
	assert.equal(typed.defaultPrevented, false, 'a letter inside the box is typed');
	assert.equal(h.announced.length, before);
});

test('the clock is entirely aria-hidden and its loop follows the timed phases', () => {
	const h = harness('p1', 'writing');
	const timer = h.element.querySelector<HTMLElement>('.bluff-timer')!;
	assert.equal(timer.getAttribute('aria-hidden'), 'true');
	assert.equal(timer.hidden, false);
	assert.ok(h.loops.includes('start:bluff.tick'));

	h.board.handleTimerTick(10);
	assert.ok(h.loops.includes('play:bluff.warning'));

	h.state.bluff!.round.phase = 'reveal';
	h.state.bluff!.round.startedAt = null;
	h.render();
	assert.equal(timer.hidden, true);
	assert.equal(h.loops.at(-1), 'stop:bluff.tick');
});

test('a ballot is two questions, each ONE group of radios, and the second appears from the first answer', () => {
	const h = harness('p1', 'voting');

	assert.equal(visible('.bluff-vote', h), true);
	assert.equal(visible('.bluff-write', h), false);
	assert.equal(radios(h, 'truth').length, 3);
	assert.equal(new Set(radios(h, 'truth').map(radio => radio.name)).size, 1, 'one radio group');
	assert.equal(radios(h, 'truth')[0].closest('label')!.textContent, '1: The Moon');
	assert.equal(visible('.bluff-ballot--funny', h), false);
	assert.equal(h.element.querySelectorAll('.bluff-ballot--truth legend')[0].textContent, 'Which one is the truth?');

	check(radios(h, 'truth')[1]);
	assert.deepEqual(h.votes, [{ round: 1, final: false, truth: 1, funny: undefined }]);
	assert.equal(visible('.bluff-ballot--funny', h), true);
	assert.deepEqual(radios(h, 'funny').map(radio => radio.value), ['0', '2'], 'the line taken for the truth is not a tall tale to me');
	assert.match(h.announced.at(-1)!, /funniest/);

	check(radios(h, 'funny')[1]);
	assert.deepEqual(h.votes.at(-1), { round: 1, final: false, truth: undefined, funny: 2 });
});

test('a state repaint reflects the server marks without rebuilding the radios under the arrow keys', () => {
	const h = harness('p1', 'voting');
	const first = radios(h, 'truth')[0];
	first.focus();

	h.state.bluff!.round.ballots = [ballot('p1', { truthPick: 1, funnyPick: 0 })];
	h.render();

	assert.equal(radios(h, 'truth')[0], first, 'the same element is still there');
	assert.equal(radios(h, 'truth')[1].checked, true);
	assert.equal(radios(h, 'funny').find(radio => radio.value === '0')!.checked, true);
	assert.match(h.element.querySelector('.bluff-vote-status')!.textContent!, /ballot is in/);
});

test('a truth finder\'s final ballot asks a different question and nothing about the funniest', () => {
	const h = harness('p1', 'final_voting', {
		finalBallots: [ballot('p1', { truthKnown: true, asksFunny: false })],
		startedAt: new Date().toISOString(),
	});

	assert.match(h.element.querySelector('.bluff-ballot--truth legend')!.textContent!, /already found the truth/);
	check(radios(h, 'truth')[2]);
	assert.deepEqual(h.votes, [{ round: 1, final: true, truth: 2, funny: undefined }]);
	assert.equal(visible('.bluff-ballot--funny', h), false);
});

test('the reveal is a list of sentences, and only the master is offered the way on', () => {
	const overrides = {
		truth: 'three',
		lies: [{ id: 'l1', text: 'two', authorIds: ['p2'], shownCount: 4, believerIds: ['p1'], funnyVoterIds: ['p3'], finalist: false, finalBelieverIds: [] }],
		reveal: {
			truthFinderCount: 3,
			bestLieId: 'l1',
			funniestLieId: 'l1',
			results: [{ playerId: 'p1', foundTruth: false, truthPoints: 0, fooledCount: 0, foolPoints: 0, shownCount: 0, total: 0 }],
		},
	};
	const guest = harness('p1', 'reveal', overrides);
	const master = harness('p0', 'reveal', overrides);

	const lines = Array.from(guest.element.querySelectorAll('.bluff-reveal__line')).map(line => line.textContent);
	assert.equal(lines[0], 'The truth was three. Players who found it: 3.');
	assert.match(lines[1]!, /two, by Player 2: it fooled 1/);
	assert.match(lines[3]!, /^You missed the truth, and wrote no tall tale/);
	assert.equal(visible('.bluff-next', guest), false);
	assert.equal(visible('.bluff-next', master), true);
	assert.equal(master.element.querySelector('.bluff-next')!.textContent, 'Next round');
	master.element.querySelector<HTMLButtonElement>('.bluff-next')!.click();
	assert.deepEqual(master.next, [1]);

	master.state.bluff!.round.roundNumber = 3;
	master.render();
	assert.equal(master.element.querySelector('.bluff-next')!.textContent, 'End the match');
});

test('the scoreboard shows the top ten and my own line when I am below it', () => {
	const top = harness('p0', 'writing');
	assert.equal(top.element.querySelectorAll('.bluff-score').length, 10);
	assert.match(top.element.querySelector('.bluff-score--me')!.textContent!, /^1\. Player 0 \(you\): 1100 points\./);

	const low = harness('p11', 'writing');
	const rows = Array.from(low.element.querySelectorAll('.bluff-score')).map(row => row.textContent);
	assert.equal(rows.length, 11);
	assert.match(rows[10]!, /^12\. Player 11 \(you\): 0 points\./);
});

test('focus never falls off the surface when a phase change hides what was focused', () => {
	const h = harness('p1', 'writing');
	input(h).focus();
	assert.equal(document.activeElement, input(h));

	h.state.bluff!.round.phase = 'voting';
	h.state.bluff!.round.ballots = [ballot('p1')];
	h.render();

	assert.equal(document.activeElement, radios(h, 'truth')[0], 'the ballot is the new job');
});

test('Escape goes home: the text box, the ballot or the results', () => {
	const h = harness('p1', 'voting');
	h.element.querySelector<HTMLElement>('.bluff-shell')!.focus();

	h.element.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

	assert.equal(document.activeElement, radios(h, 'truth')[0]);
});

test('T answers with the round headline and this player\'s own job', () => {
	const h = harness('p1', 'writing');
	assert.equal(h.board.announceTurn(), true);
	assert.match(h.announced.at(-1)!, /^Round 1 of 3: everybody is writing a tall tale\. Write one tall tale/);
});

test('the surface declares its queries to the shortcuts help and its rules to the rules dialog', () => {
	const h = harness('p1');
	const keys = h.board.helpShortcuts().map(shortcut => shortcut.keys);
	assert.ok(keys.includes('p') && keys.includes('r') && keys.includes('escape') && keys.includes('s'));
	const rules = h.board.rulesSummary();
	assert.equal(rules.length, 7);
	assert.equal(rules[0], 'Rounds: 3');
});
