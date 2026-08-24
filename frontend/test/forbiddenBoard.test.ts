import test from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenBoard, protectReadOnlyTextArea } from '../src/forbiddenBoard.js';
import {
	forbiddenCastLines,
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
				// A preparing turn carries no card: the server withholds the words until the
				// clock is running, so this is what the two authorised roles really receive.
				cardId: null,
				target: null,
				forbiddenWords: [],
			},
		},
	};
}

/** What the server sends those two roles once the turn goes live. */
function dealCard(state: GameState): void {
	const turn = state.forbidden!.turn;
	turn.cardId = 'lighthouse';
	turn.target = 'lighthouse';
	turn.forbiddenWords = ['tower', 'coast', 'beam', 'ship', 'sea'];
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
	// One word, and nothing repeated on every focus: no role, no "this box cannot be edited",
	// no key list — that toll was paid on every visit, worst of all on a phone.
	assert.equal(cardLabel.textContent, 'Words');
	assert.equal(root.querySelector('#forbidden-card-hint'), null);
	assert.equal(card.hasAttribute('aria-describedby'), false);
	// The turn card says MY duty; the three jobs the turn has are the list below it.
	assert.equal(roleDetail.textContent,
		'You are the clue-giver: describe the target without saying it or using its forbidden words.');
	assert.deepEqual(
		[...root.querySelectorAll('.forbidden-role-list li')].map(item => item.textContent),
		['You give the clues.', 'Berto guesses.', 'Cora monitors.']);
	// The headline section: who is playing, and nothing else. No turn count, no cycle number.
	assert.equal(root.querySelector('#forbidden-now-title')!.textContent, 'Who is playing');
	assert.equal(root.querySelector('.forbidden-now__line')!.textContent,
		'Your Red team is about to play.');
	assert.equal(card.rows, 7);
	// Before the clock starts there is nothing to read. The card itself stays: hiding the panel
	// would drop focus and rebuild it under a screen-reader user on every single turn.
	assert.equal(cardPanel.hidden, false);
	assert.equal(card.value, 'The word appears when the turn starts.');
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

	// Found in review: P said nothing at all in this same moment. The pass button only exists
	// once the clock runs, and the card is a textarea, so the document keymap skips the key too
	// — total silence, which reads as a dead app. The key answers for the role, like R.
	let earlyPassKeyLeaked = 0;
	const documentEarlyPassKey = () => { earlyPassKeyLeaked++; };
	document.addEventListener('keydown', documentEarlyPassKey);
	const earlyPassKey = new window.KeyboardEvent('keydown', { key: 'p', bubbles: true, cancelable: true });
	card.dispatchEvent(earlyPassKey);
	document.removeEventListener('keydown', documentEarlyPassKey);
	assert.equal(earlyPassKey.defaultPrevented, true);
	assert.equal(earlyPassKeyLeaked, 0, 'family-local P never reaches document shortcuts');
	assert.deepEqual(commands.pass, [], 'and no word is passed before there is one to pass');
	assert.equal(announced.at(-1), 'The timer is not running.');
	assert.equal(document.activeElement, card);

	const enterToStart = new window.KeyboardEvent('keydown', {
		key: 'Enter', bubbles: true, cancelable: true,
	});
	card.dispatchEvent(enterToStart);
	assert.equal(enterToStart.defaultPrevented, true);
	assert.equal(commands.start, 1);
	assert.equal(document.activeElement, card, 'starting from the protected card keeps its reading position');
	assert.deepEqual(
		board.helpShortcuts().find(shortcut => shortcut.descKey === 'game.help_cmd_forbidden_enter'),
		{ keys: 'enter', descKey: 'game.help_cmd_forbidden_enter' },
	);

	state.forbidden!.turn.phase = 'active';
	state.forbidden!.turn.startedAt = new Date(Date.now() - 5_000).toISOString();
	dealCard(state);
	board.update(state);
	assert.equal(start.hidden, true);
	assert.equal(correct.hidden, false);
	assert.equal(pass.hidden, false);
	assert.equal(violation.hidden, true);
	// And now, with the clock running, the words are there — same card, no focus move.
	assert.equal(card.value,
		'Target word: lighthouse.\nForbidden words:\ntower,\ncoast,\nbeam,\nship,\nsea.');
	assert.equal(document.activeElement, card);
	// Enter is the ONE key of this surface: it starts the clock while there is a clock to start,
	// and from then on it banks each word as it is guessed. No hunting for a button between cards.
	card.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
	assert.equal(commands.start, 1, 'Enter cannot restart an active clock');
	assert.deepEqual(commands.correct, [1], 'and now marks the word guessed instead');
	assert.equal(document.activeElement, card, 'which never moves the reading position off the words');
	// A shake is the same action, for a phone with no keyboard and a hand already holding it.
	board.handleShake();
	assert.deepEqual(commands.correct, [1, 1]);
	card.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'v', bubbles: true, cancelable: true }));
	assert.deepEqual(commands.violation, [], 'V cannot report a violation for the clue-giver');
	correct.click();
	pass.click();
	assert.deepEqual(commands.correct, [1, 1, 1]);
	assert.deepEqual(commands.pass, [1]);
	// Reported live: pressing "correct" left the clue-giver standing on a button while the next
	// word — the only thing they need — sat behind them. The words ARE the board here.
	assert.equal(document.activeElement, card, 'acting comes back to the words');

	// P is the clue-giver's other key. Before it existed, a word they could not get out was the
	// one action that forced them to tab off the words with the clock running.
	card.focus();
	let passKeyLeakedToDocument = 0;
	const documentPassKey = () => { passKeyLeakedToDocument++; };
	document.addEventListener('keydown', documentPassKey);
	const passKey = new window.KeyboardEvent('keydown', { key: 'p', bubbles: true, cancelable: true });
	card.dispatchEvent(passKey);
	document.removeEventListener('keydown', documentPassKey);
	assert.equal(passKey.defaultPrevented, true);
	assert.equal(passKeyLeakedToDocument, 0, 'family-local P never reaches document shortcuts');
	assert.deepEqual(commands.pass, [1, 1]);
	assert.equal(document.activeElement, card, 'passing comes back to the words too');
	assert.equal(pass.getAttribute('aria-keyshortcuts'), 'P');
	assert.deepEqual(
		board.helpShortcuts().find(shortcut => shortcut.descKey === 'game.help_cmd_forbidden_pass'),
		{ keys: 'p', descKey: 'game.help_cmd_forbidden_pass' },
	);

	board.handleTimerTick(42);
	const timerPanel = root.querySelector<HTMLElement>('.forbidden-timer')!;
	const progress = root.querySelector<HTMLProgressElement>('.forbidden-timer__progress')!;
	assert.equal(progress.value, 42);
	// NVDA sonifies a progress bar, and this one moves every second and runs BACKWARDS: it beeped
	// its way down the whole turn. Nothing in the panel is the only copy of anything.
	assert.equal(timerPanel.getAttribute('aria-hidden'), 'true');
	assert.equal(progress.hasAttribute('aria-label'), false);
	card.focus();
	const activeTimerKey = new window.KeyboardEvent('keydown', {
		key: 'r', bubbles: true, cancelable: true,
	});
	card.dispatchEvent(activeTimerKey);
	assert.equal(activeTimerKey.defaultPrevented, true);
	// The number first: a listener who only wanted the seconds does not sit through a preamble.
	assert.equal(announced.at(-1), '42 seconds remaining.');
	assert.equal(document.activeElement, card, 'the timer query keeps the private-card reading position');

	// Escape is how you leave anything else and land where you came from; here that is the words.
	correct.focus();
	const escape = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
	correct.dispatchEvent(escape);
	assert.equal(escape.defaultPrevented, true);
	assert.equal(document.activeElement, card);

	state.forbidden!.turn.passesUsed = 3;
	board.update(state);
	assert.equal(pass.getAttribute('aria-disabled'), 'true');
	assert.ok(pass.getAttribute('aria-describedby'));
	pass.click();
	assert.deepEqual(commands.pass, [1, 1]);
	assert.equal(announced.at(-1), 'No passes remain in this turn.');

	// Out of passes, the key says why instead of going quiet: the control is never `disabled`,
	// so its shortcut must not be the one route that silently does nothing.
	announced.length = 0;
	card.focus();
	card.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'p', bubbles: true, cancelable: true }));
	assert.deepEqual(commands.pass, [1, 1], 'a spent pass sends no command');
	assert.equal(announced.at(-1), 'No passes remain in this turn.');

	card.focus();
	assert.equal(document.activeElement, card);
	myId = 'p3';
	board.update(state);
	assert.equal(cardPanel.hidden, true);
	// The player with no assignment has a line of their own, and still hears the cast — but is
	// never named as "supporting", a job that does not exist and that pushed the three real ones
	// further down a sentence somebody listens to on every turn.
	assert.equal(roleDetail.textContent, 'You support your team this turn, with no action of your own.');
	assert.deepEqual(
		[...root.querySelectorAll('.forbidden-role-list li')].map(item => item.textContent),
		['Ada gives the clues.', 'Berto guesses.', 'Cora monitors.']);
	assert.equal(root.querySelector('.forbidden-now__line')!.textContent, 'The Red team is playing.');
	assert.equal(document.activeElement, root.querySelector('.forbidden-shell'));

	myId = 'p2';
	board.update(state);
	assert.equal(cardPanel.hidden, false);
	assert.equal(cardLabel.textContent, 'Words'); // the same one word for every role
	assert.equal(roleDetail.textContent,
		'You are the monitor: press V if Ada says the target or any forbidden word.');
	assert.equal(violation.hidden, false);
	assert.equal(violation.getAttribute('aria-keyshortcuts'), 'V');
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
	// The monitor's phone: a shake is routed to the only thing a monitor can do.
	board.handleShake();
	assert.deepEqual(commands.violation, [1, 1]);
	// Enter is NOT: reporting costs the rivals a point, so it stays a key pressed on purpose.
	card.focus();
	card.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
	assert.deepEqual(commands.violation, [1, 1]);
	// P belongs to the clue-giver. The monitor's card is not theirs to skip. (The keystroke is
	// still cancelled, but by the protected card that refuses every character, not by the board.)
	const monitorPassKey = new window.KeyboardEvent('keydown', { key: 'p', bubbles: true, cancelable: true });
	const beforeMonitorPass = announced.at(-1);
	card.dispatchEvent(monitorPassKey);
	assert.deepEqual(commands.pass, [1, 1], 'P cannot pass a word for the monitor');
	assert.equal(announced.at(-1), beforeMonitorPass, 'nor does it explain a clock that is running');
	assert.deepEqual(
		board.helpShortcuts().find(shortcut => shortcut.descKey === 'game.help_cmd_forbidden_violation'),
		{ keys: 'v', descKey: 'game.help_cmd_forbidden_violation' },
	);

	myId = 'p1';
	board.update(state);
	assert.equal(cardPanel.hidden, true);
	assert.equal(roleDetail.textContent, 'You guess the target word this turn, out loud.');
	assert.equal(root.querySelectorAll('.forbidden-controls button:not([hidden])').length, 0);
	// A guesser holds no action at all, so a shake — like Enter — has nothing to fire.
	const before = commands.correct.length + commands.violation.length;
	board.handleShake();
	assert.equal(commands.correct.length + commands.violation.length, before);

	// A table plays match after match: the next one builds a new surface over the same element,
	// and this board's shake listener is still on the window. It must go quiet, or a shake in the
	// second match would also fire the first board's detached — but still wired — buttons.
	myId = 'p0';
	state.forbidden!.turn.phase = 'active';
	board.update(state);
	root.replaceChildren();
	const beforeStale = commands.correct.length;
	board.handleShake();
	assert.equal(commands.correct.length, beforeStale, 'a board that lost the surface acts no more');

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
	// T answers "whose turn is this?" — the team, then the three people the turn runs through.
	// It used to also read my duty in full, which made a key pressed several times per turn into
	// a paragraph, and it counted the turn and the cycle at a player who had asked neither.
	assert.equal(
		forbiddenTurnContextText(state, 'p0', translate),
		'Your Red team is about to play. You give the clues. Berto guesses. Cora monitors.',
	);
	assert.equal(
		forbiddenTurnContextText(state, 'p3', translate),
		'The Red team is about to play. Ada gives the clues. Berto guesses. Cora monitors.',
		'a player with no assignment hears the cast, and is never named as doing nothing',
	);
	// A tie-breaker is the ONE time a second rotation is worth saying — and it is named as sudden
	// death, not as "cycle 2", which was bookkeeping nobody had asked to hear.
	state.forbidden!.cycle = 2;
	assert.equal(
		forbiddenTurnContextText(state, 'p3', translate),
		'The Red team is about to play. Sudden death, round 2. '
		+ 'Ada gives the clues. Berto guesses. Cora monitors.',
	);
	assert.match(forbiddenStatusText(state, 'p0', translate)!, /Sudden death, round 2\./);
	state.forbidden!.cycle = 1;
	assert.doesNotMatch(forbiddenStatusText(state, 'p0', translate)!, /round|cycle/i,
		'an ordinary match never mentions rounds or cycles at all');
	assert.deepEqual(
		forbiddenCastLines(state, 'p0', translate).length, 3,
		'the three jobs the turn has, no more and no fewer');
	assert.equal(
		formatForbiddenCard('faro', ['costa', 'luz', 'torre'], 'en', translate),
		'Target word: faro.\nForbidden words:\ncosta,\nluz,\ntorre.',
		'host-selected Spanish content remains Spanish while English supplies connective UI words',
	);

	root.remove();
});
