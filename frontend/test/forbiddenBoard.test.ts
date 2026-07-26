import test from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenBoard, protectReadOnlyTextArea } from '../src/forbiddenBoard.js';
import {
	forbiddenRivalStatus,
	forbiddenRole,
	forbiddenStatusText,
	forbiddenTurnContextText,
	formatForbiddenCard,
} from '../src/forbiddenRules.js';
import type { GameState } from '../src/models.js';
import { installFakeI18next, setupDom } from './helpers/dom.js';

setupDom();
installFakeI18next('en');
document.documentElement.lang = 'en';

function player(id: string, name: string) {
	return {
		id,
		name,
		token: id,
		position: 0,
		money: 0,
		properties: [],
		releasePasses: 0,
	};
}

function gameState(): GameState {
	return {
		gameType: 'forbidden',
		players: [
			player('p0', 'Ada'),
			player('p1', 'Berto'),
			player('p2', 'Cora'),
			player('p3', 'Dani'),
		],
		bank: { money: 0 },
		currentTurn: 'p0',
		ownership: [],
		squares: [],
		forbiddenRules: {
			turnSeconds: 60,
			passesPerTurn: 3,
			correctPoints: 1,
			violationPenalty: 1,
			cycles: 1,
		},
		forbidden: {
			teams: [
				{ teamIndex: 0, memberIds: ['p0', 'p1'], score: 0, turnsTaken: 0 },
				{ teamIndex: 1, memberIds: ['p2', 'p3'], score: 0, turnsTaken: 0 },
			],
			activeTeamIndex: 0,
			cycle: 1,
			cardCursor: 1,
			cardSequence: 1,
			turn: {
				turnNumber: 1,
				teamIndex: 0,
				clueGiverId: 'p0',
				guesserId: 'p1',
				monitorId: 'p2',
				phase: 'preparing',
				startedAt: null,
				durationSeconds: 60,
				passesUsed: 0,
				correctCount: 0,
				violationCount: 0,
				cardSequence: 1,
				cardId: 'lighthouse',
				target: 'lighthouse',
				forbiddenWords: ['tower', 'coast', 'beam', 'ship', 'sea'],
			},
		},
	};
}

const translate = (key: string, vars?: Record<string, unknown>) =>
	(globalThis as any).window.i18next.t(key, vars);

function soundSpy() {
	const played: string[] = [];
	const started: string[] = [];
	const stopped: string[] = [];
	return {
		played,
		started,
		stopped,
		player: {
			playEvent: (eventKey: string) => { played.push(eventKey); },
			startLoop: (eventKey: string) => { started.push(eventKey); },
			stopLoop: (eventKey: string) => { stopped.push(eventKey); return true; },
		},
	};
}

test('protected card is ARIA-readonly, never native readonly, and blocks every mutation route', async () => {
	const textarea = document.createElement('textarea');
	textarea.value = 'Target word: lighthouse.';
	document.body.appendChild(textarea);
	protectReadOnlyTextArea(textarea);

	assert.equal(textarea.getAttribute('aria-readonly'), 'true');
	assert.equal(textarea.hasAttribute('readonly'), false);
	assert.equal(textarea.getAttribute('inputmode'), 'none');
	assert.equal(textarea.autocomplete, 'off');
	assert.equal(textarea.spellcheck, false);

	textarea.setSelectionRange(7, 11);
	for (const type of ['beforeinput', 'paste', 'cut', 'drop', 'compositionstart', 'textInput']) {
		const event = new window.Event(type, { bubbles: true, cancelable: true });
		textarea.dispatchEvent(event);
		assert.equal(event.defaultPrevented, true, type);
	}

	const typed = new window.KeyboardEvent('keydown', { key: 'x', bubbles: true, cancelable: true });
	textarea.dispatchEvent(typed);
	assert.equal(typed.defaultPrevented, true);
	const backspace = new window.KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true });
	textarea.dispatchEvent(backspace);
	assert.equal(backspace.defaultPrevented, true);
	const cut = new window.KeyboardEvent('keydown', { key: 'x', ctrlKey: true, bubbles: true, cancelable: true });
	textarea.dispatchEvent(cut);
	assert.equal(cut.defaultPrevented, true);

	const copy = new window.KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true });
	textarea.dispatchEvent(copy);
	assert.equal(copy.defaultPrevented, false);
	const selectAll = new window.KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true });
	textarea.dispatchEvent(selectAll);
	assert.equal(selectAll.defaultPrevented, false);
	const move = new window.KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true, cancelable: true });
	textarea.dispatchEvent(move);
	assert.equal(move.defaultPrevented, false);
	const moveByLine = new window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
	textarea.dispatchEvent(moveByLine);
	assert.equal(moveByLine.defaultPrevented, false, 'line-by-line review remains available');
	const moveByWord = new window.KeyboardEvent('keydown', {
		key: 'ArrowLeft', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true,
	});
	textarea.dispatchEvent(moveByWord);
	assert.equal(moveByWord.defaultPrevented, false, 'word navigation and selection remain available');
	const find = new window.KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true });
	textarea.dispatchEvent(find);
	assert.equal(find.defaultPrevented, false, 'non-mutating browser commands remain available');
	const paste = new window.KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true });
	textarea.dispatchEvent(paste);
	assert.equal(paste.defaultPrevented, true);

	textarea.value = 'mutated';
	textarea.dispatchEvent(new window.Event('input', { bubbles: true }));
	assert.equal(textarea.value, 'Target word: lighthouse.');
	assert.equal(textarea.selectionStart, 7);
	assert.equal(textarea.selectionEnd, 11);

	const compositionEnd = new window.Event('compositionend', { bubbles: true, cancelable: true });
	textarea.dispatchEvent(compositionEnd);
	textarea.value = 'late IME commit';
	await Promise.resolve();
	assert.equal(compositionEnd.defaultPrevented, true);
	assert.equal(textarea.value, 'Target word: lighthouse.');

	textarea.remove();
});

test('role surface lets the clue-giver start directly and keeps unavailable controls focusable', () => {
	const root = document.createElement('div');
	document.body.appendChild(root);
	const state = gameState();
	let myId = 'p0';
	const announced: string[] = [];
	const commands = { start: 0, correct: [] as number[], pass: [] as number[], violation: [] as number[] };
	const board = new ForbiddenBoard(root, {
		getGameState: () => state,
		getMyPlayerId: () => myId,
		announce: text => announced.push(text),
		tSync: translate,
		sounds: soundSpy().player,
		commands: {
			start: () => { commands.start++; },
			correct: sequence => commands.correct.push(sequence),
			pass: sequence => commands.pass.push(sequence),
			violation: sequence => commands.violation.push(sequence),
		},
	});

	board.update(state);
	const card = root.querySelector<HTMLTextAreaElement>('.forbidden-secret__text')!;
	const cardPanel = root.querySelector<HTMLElement>('.forbidden-secret')!;
	const start = root.querySelector<HTMLButtonElement>('.forbidden-start')!;
	const correct = root.querySelector<HTMLButtonElement>('.forbidden-correct')!;
	const pass = root.querySelector<HTMLButtonElement>('.forbidden-pass')!;
	const violation = root.querySelector<HTMLButtonElement>('.forbidden-violation')!;
	const roleDetail = root.querySelector<HTMLElement>('.forbidden-role-detail')!;
	const cardLabel = root.querySelector<HTMLLabelElement>('.forbidden-secret__label')!;

	assert.equal(cardPanel.hidden, false);
	assert.equal(cardLabel.textContent, 'Clue-giver: target and forbidden words');
	assert.equal(roleDetail.textContent,
		'Red team. You are the clue-giver: describe the target without saying it or using its forbidden words. '
		+ 'Berto guesses, and Cora monitors the target and forbidden words.');
	assert.match(root.querySelector('#forbidden-card-hint')!.textContent!, /press Enter to start the timer/);
	assert.equal(card.rows, 7);
	assert.equal(card.value,
		'Target word: lighthouse.\nForbidden words:\ntower,\ncoast,\nbeam,\nship,\nsea.');
	assert.equal(card.hasAttribute('readonly'), false);
	assert.equal(start.hidden, false);
	assert.equal(start.hasAttribute('aria-disabled'), false);
	assert.equal(start.hasAttribute('aria-describedby'), false);
	assert.equal(start.disabled, false);
	assert.equal(correct.hidden, true);
	assert.equal(pass.hidden, true);
	assert.equal(violation.hidden, true);
	assert.equal(root.querySelector('[disabled]'), null);
	assert.equal(root.querySelector('.forbidden-ready'), null);
	assert.equal(root.querySelector('.forbidden-ready-list'), null);

	card.focus();
	let timerKeyLeakedToDocument = 0;
	const documentTimerKey = () => { timerKeyLeakedToDocument++; };
	document.addEventListener('keydown', documentTimerKey);
	const inactiveTimerKey = new window.KeyboardEvent('keydown', {
		key: 'r', bubbles: true, cancelable: true,
	});
	card.dispatchEvent(inactiveTimerKey);
	document.removeEventListener('keydown', documentTimerKey);
	assert.equal(inactiveTimerKey.defaultPrevented, true);
	assert.equal(timerKeyLeakedToDocument, 0, 'family-local R never reaches document shortcuts');
	assert.equal(announced.at(-1), 'The timer is not running.');
	assert.equal(document.activeElement, card);
	assert.deepEqual(
		board.helpShortcuts().find(shortcut => shortcut.descKey === 'game.help_cmd_forbidden_timer'),
		{ keys: 'r', descKey: 'game.help_cmd_forbidden_timer' },
	);

	const enterToStart = new window.KeyboardEvent('keydown', {
		key: 'Enter', bubbles: true, cancelable: true,
	});
	card.dispatchEvent(enterToStart);
	assert.equal(enterToStart.defaultPrevented, true);
	assert.equal(commands.start, 1);
	assert.equal(document.activeElement, card, 'starting from the protected card keeps its reading position');
	assert.deepEqual(
		board.helpShortcuts().find(shortcut => shortcut.descKey === 'game.help_cmd_forbidden_start'),
		{ keys: 'enter', descKey: 'game.help_cmd_forbidden_start' },
	);

	state.forbidden!.turn.phase = 'active';
	state.forbidden!.turn.startedAt = new Date(Date.now() - 5_000).toISOString();
	board.update(state);
	card.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
	assert.equal(commands.start, 1, 'Enter cannot restart an active clock');
	assert.equal(start.hidden, true);
	assert.equal(correct.hidden, false);
	assert.equal(pass.hidden, false);
	assert.equal(violation.hidden, true);
	card.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'v', bubbles: true, cancelable: true }));
	assert.deepEqual(commands.violation, [], 'V cannot report a violation for the clue-giver');
	correct.click();
	pass.click();
	assert.deepEqual(commands.correct, [1]);
	assert.deepEqual(commands.pass, [1]);

	board.handleTimerTick(42);
	const progress = root.querySelector<HTMLProgressElement>('.forbidden-timer__progress')!;
	assert.equal(progress.value, 42);
	assert.equal(progress.getAttribute('aria-label'), '42 seconds remaining');
	card.focus();
	const activeTimerKey = new window.KeyboardEvent('keydown', {
		key: 'r', bubbles: true, cancelable: true,
	});
	card.dispatchEvent(activeTimerKey);
	assert.equal(activeTimerKey.defaultPrevented, true);
	assert.equal(announced.at(-1), '42 seconds remaining');
	assert.equal(document.activeElement, card, 'the timer query keeps the private-card reading position');

	state.forbidden!.turn.passesUsed = 3;
	board.update(state);
	assert.equal(pass.getAttribute('aria-disabled'), 'true');
	assert.ok(pass.getAttribute('aria-describedby'));
	pass.click();
	assert.deepEqual(commands.pass, [1]);
	assert.equal(announced.at(-1), 'No passes remain in this turn.');

	card.focus();
	assert.equal(document.activeElement, card);
	myId = 'p3';
	board.update(state);
	assert.equal(cardPanel.hidden, true);
	assert.equal(roleDetail.textContent,
		'Red team. Ada gives clues, Cora monitors the target and forbidden words, and Berto guesses.');
	assert.equal(document.activeElement, root.querySelector('.forbidden-shell'));

	myId = 'p2';
	board.update(state);
	assert.equal(cardPanel.hidden, false);
	assert.equal(cardLabel.textContent, 'Monitor: target and forbidden words');
	assert.equal(roleDetail.textContent,
		'Red team. You are the monitor: press V if Ada says the target or any forbidden word. '
		+ 'Ada gives clues, and Berto guesses.');
	assert.equal(violation.hidden, false);
	assert.equal(violation.getAttribute('aria-keyshortcuts'), 'V');
	assert.match(root.querySelector('#forbidden-card-hint')!.textContent!, /press V if the clue-giver says the target/);
	let leakedToDocument = 0;
	const documentKey = () => { leakedToDocument++; };
	document.addEventListener('keydown', documentKey);
	card.focus();
	const violationKey = new window.KeyboardEvent('keydown', {
		key: 'v', bubbles: true, cancelable: true,
	});
	card.dispatchEvent(violationKey);
	document.removeEventListener('keydown', documentKey);
	assert.equal(violationKey.defaultPrevented, true);
	assert.equal(leakedToDocument, 0, 'family-local V never reaches the global bank-inventory binding');
	assert.equal(document.activeElement, card);
	assert.deepEqual(commands.violation, [1]);
	assert.deepEqual(
		board.helpShortcuts().find(shortcut => shortcut.descKey === 'game.help_cmd_forbidden_violation'),
		{ keys: 'v', descKey: 'game.help_cmd_forbidden_violation' },
	);

	myId = 'p1';
	board.update(state);
	assert.equal(cardPanel.hidden, true);
	assert.equal(roleDetail.textContent,
		'Red team. You guess the target word this turn. Ada gives clues, and Cora monitors the target and forbidden words.');
	assert.equal(root.querySelectorAll('.forbidden-controls button:not([hidden])').length, 0);

	root.remove();
});

test('the auction-style clock loops only during an active timed turn', () => {
	const root = document.createElement('div');
	document.body.appendChild(root);
	const state = gameState();
	const sounds = soundSpy();
	const board = new ForbiddenBoard(root, {
		getGameState: () => state,
		getMyPlayerId: () => 'p0',
		announce() {},
		tSync: translate,
		sounds: sounds.player,
		commands: { start() {}, correct() {}, pass() {}, violation() {} },
	});

	board.update(state);
	assert.deepEqual(sounds.started, [], 'the preparing turn has no ticking clock');
	assert.deepEqual(sounds.stopped, ['forbidden.tick']);

	state.forbidden!.turn.phase = 'active';
	state.forbidden!.turn.startedAt = new Date().toISOString();
	board.update(state);
	assert.deepEqual(sounds.started, ['forbidden.tick']);

	board.handleTimerTick(42);
	assert.deepEqual(sounds.started, ['forbidden.tick', 'forbidden.tick'],
		'each server tick retries the idempotent loop in case package loading raced the start');
	board.handleTimerTick(10);
	assert.deepEqual(sounds.played, ['forbidden.warning'], 'the existing ten-second warning remains');

	board.handleTimerTick(0);
	assert.equal(sounds.stopped.at(-1), 'forbidden.tick');
	assert.equal(root.querySelector<HTMLProgressElement>('.forbidden-timer__progress')!.value, 0);

	state.forbidden!.turn.phase = 'finished';
	board.update(state);
	assert.equal(sounds.stopped.at(-1), 'forbidden.tick', 'leaving the active phase always stops the clock');

	board.handleTimerTick(9);
	assert.equal(sounds.stopped.at(-1), 'forbidden.tick', 'a stale tick cannot restart a finished turn');
	root.remove();
});

test('status shortcuts and pure role helpers produce flowing team sentences', () => {
	const root = document.createElement('div');
	document.body.appendChild(root);
	const state = gameState();
	const announced: string[] = [];
	const board = new ForbiddenBoard(root, {
		getGameState: () => state,
		getMyPlayerId: () => 'p0',
		announce: text => announced.push(text),
		tSync: translate,
		sounds: soundSpy().player,
		commands: { start() {}, correct() {}, pass() {}, violation() {} },
	});
	board.update(state);

	root.dispatchEvent(new window.KeyboardEvent('keydown', { key: 's', bubbles: true, cancelable: true }));
	assert.equal(announced.at(-1), forbiddenStatusText(state, 'p0', translate));
	root.dispatchEvent(new window.KeyboardEvent('keydown', {
		key: 'S', shiftKey: true, bubbles: true, cancelable: true,
	}));
	assert.equal(announced.at(-1), forbiddenRivalStatus(state, 'p0', translate));

	assert.equal(forbiddenRole(state.forbidden!.turn, 'p0'), 'clue-giver');
	assert.equal(forbiddenRole(state.forbidden!.turn, 'p1'), 'guesser');
	assert.equal(forbiddenRole(state.forbidden!.turn, 'p2'), 'monitor');
	assert.equal(forbiddenRole(state.forbidden!.turn, 'p3'), 'spectator');
	assert.equal(
		forbiddenTurnContextText(state, 'p0', translate),
		'Red team. You are the clue-giver: describe the target without saying it or using its forbidden words. '
		+ 'Berto guesses, and Cora monitors the target and forbidden words.',
	);
	assert.equal(
		forbiddenTurnContextText(state, 'p3', translate),
		'Red team. Ada gives clues, Cora monitors the target and forbidden words, and Berto guesses.',
		'an unassigned player hears every role without being assigned a fictitious one',
	);
	assert.equal(
		formatForbiddenCard('faro', ['costa', 'luz', 'torre'], 'en', translate),
		'Target word: faro.\nForbidden words:\ncosta,\nluz,\ntorre.',
		'host-selected Spanish content remains Spanish while English supplies connective UI words',
	);

	root.remove();
});
