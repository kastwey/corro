import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { attachKeyHandlers } from '../src/keys.js';

// Board-scoped shortcuts: movement (arrows, digits), reading the focused square, and the
// bare Space/Enter (roll / end turn) only act while the board container (role="application")
// owns focus, so they can't fire by accident from another panel. The same actions keep their
// GLOBAL modifier shortcuts (Ctrl+E / Ctrl+B) and their action-bar buttons, which must work
// regardless of where focus is.

before(() => {
	setupDom();
});

interface Harness {
	detach: () => void;
	board: HTMLElement;
	outside: HTMLElement;
	calls: { roll: number; endTurn: number; moveLeft: number; setIndex: number };
}

function attach(): Harness {
	const calls = { roll: 0, endTurn: 0, moveLeft: 0, setIndex: 0 };

	const board = document.createElement('div');
	board.id = 'board';
	board.setAttribute('role', 'application');
	document.body.appendChild(board);

	const outside = document.createElement('div');
	outside.id = 'somewhere-else';
	outside.tabIndex = -1;
	document.body.appendChild(outside);

	const gameBoard: any = {
		getActiveIndex: () => -1,
		setActiveIndex: () => { calls.setIndex++; },
		moveLeft: () => { calls.moveLeft++; return true; },
	};

	const detach = attachKeyHandlers({
		board,
		keyMap: { space: 'RollDice', enter: 'EndTurn', 'ctrl+e': 'EndTurn', arrowleft: 'MoveLeft' },
		gameBoard,
		gameCommands: {} as any,
		gameManager: { getSquares: () => [{}, {}, {}], rollDice: () => { calls.roll++; } } as any,
		focusPlayersPanel: () => {},
		onEndTurn: () => { calls.endTurn++; },
	});

	return {
		detach,
		board,
		outside,
		calls,
	};
}

function pressKey(target: Element, key: string, opts: { ctrlKey?: boolean; shiftKey?: boolean } = {}): boolean {
	const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts });
	target.dispatchEvent(ev);
	return ev.defaultPrevented;
}

function cleanup(h: Harness): void {
	h.detach();
	h.board.remove();
	h.outside.remove();
}

test('Space on the board rolls the dice and is consumed', () => {
	const h = attach();
	try {
		const prevented = pressKey(h.board, ' ');
		assert.equal(h.calls.roll, 1);
		assert.equal(prevented, true);
	} finally {
		cleanup(h);
	}
});

test('Space outside the board does NOT roll', () => {
	const h = attach();
	try {
		const prevented = pressKey(h.outside, ' ');
		assert.equal(h.calls.roll, 0);
		assert.equal(prevented, false);
	} finally {
		cleanup(h);
	}
});

test('Enter on the board ends the turn and is consumed', () => {
	const h = attach();
	try {
		const prevented = pressKey(h.board, 'Enter');
		assert.equal(h.calls.endTurn, 1);
		assert.equal(prevented, true);
	} finally {
		cleanup(h);
	}
});

test('Enter outside the board does NOT end the turn', () => {
	const h = attach();
	try {
		const prevented = pressKey(h.outside, 'Enter');
		assert.equal(h.calls.endTurn, 0);
		assert.equal(prevented, false);
	} finally {
		cleanup(h);
	}
});

test('Ctrl+E ends the turn from ANYWHERE (global action shortcut)', () => {
	const h = attach();
	try {
		pressKey(h.outside, 'e', { ctrlKey: true });
		assert.equal(h.calls.endTurn, 1, 'Ctrl+E must work outside the board');

		pressKey(h.board, 'e', { ctrlKey: true });
		assert.equal(h.calls.endTurn, 2, 'Ctrl+E must also work on the board');
	} finally {
		cleanup(h);
	}
});

test('Arrow keys navigate the board ONLY while it owns focus', () => {
	const h = attach();
	try {
		const onBoard = pressKey(h.board, 'ArrowLeft');
		assert.equal(h.calls.moveLeft, 1, 'ArrowLeft on the board must move the cursor');
		assert.equal(onBoard, true, 'ArrowLeft on the board is consumed');

		const offBoard = pressKey(h.outside, 'ArrowLeft');
		assert.equal(h.calls.moveLeft, 1, 'ArrowLeft outside the board must NOT move the cursor');
		assert.equal(offBoard, false, 'ArrowLeft outside the board is left for the browser');
	} finally {
		cleanup(h);
	}
});

test('An arrow that is a no-op at the board edge is STILL consumed (caret-browsing guard)', () => {
	// Regression: with the browser's caret browsing (F7) on, an unhandled ArrowUp on the top
	// row used to move the document text caret OUT of the board and steal focus to the page.
	const board = document.createElement('div');
	board.id = 'board';
	board.setAttribute('role', 'application');
	document.body.appendChild(board);

	const outside = document.createElement('div');
	outside.tabIndex = -1;
	document.body.appendChild(outside);

	// moveUp returns false: there's no square above (edge of the board).
	const gameBoard: any = {
		getActiveIndex: () => 0,
		setActiveIndex: () => {},
		moveUp: () => false,
	};
	const detach = attachKeyHandlers({
		board,
		keyMap: { arrowup: 'MoveUp' },
		gameBoard,
		gameCommands: {} as any,
		gameManager: { getSquares: () => [{}, {}, {}] } as any,
		focusPlayersPanel: () => {},
		onEndTurn: () => {},
	});
	try {
		const onBoard = pressKey(board, 'ArrowUp');
		assert.equal(onBoard, true, 'a no-op edge arrow on the board is consumed so caret browsing cannot escape');

		const offBoard = pressKey(outside, 'ArrowUp');
		assert.equal(offBoard, false, 'off the board the arrow is left for the browser');
	} finally {
		detach();
		board.remove();
		outside.remove();
	}
});

test('Digit square-jump works ONLY while the board owns focus', () => {
	const h = attach();
	try {
		pressKey(h.board, '2');
		assert.equal(h.calls.setIndex, 1, 'A digit on the board jumps to a square');

		pressKey(h.outside, '2');
		assert.equal(h.calls.setIndex, 1, 'A digit outside the board does nothing');
	} finally {
		cleanup(h);
	}
});

test('Escape outside the board returns focus to the board and is consumed', () => {
	const h = attach();
	h.board.tabIndex = -1; // make the board container focusable for the assertion
	try {
		h.outside.focus();
		const prevented = pressKey(h.outside, 'Escape');
		assert.equal(document.activeElement, h.board, 'Escape moves focus to the board');
		assert.equal(prevented, true, 'Escape is consumed');
	} finally {
		cleanup(h);
	}
});

test('Escape already on the board does nothing (no focus change, not consumed)', () => {
	const h = attach();
	h.board.tabIndex = -1;
	try {
		h.board.focus();
		const prevented = pressKey(h.board, 'Escape');
		assert.equal(document.activeElement, h.board);
		assert.equal(prevented, false, 'Escape on the board is left alone');
	} finally {
		cleanup(h);
	}
});

test('Escape inside an open dialog does NOT jump to the board (the dialog owns ESC)', () => {
	const h = attach();
	h.board.tabIndex = -1;
	const dialog = document.createElement('dialog');
	dialog.setAttribute('open', '');
	const field = document.createElement('input');
	dialog.appendChild(field);
	document.body.appendChild(dialog);
	try {
		field.focus();
		const prevented = pressKey(field, 'Escape');
		assert.notEqual(document.activeElement, h.board, 'focus stays in the dialog');
		assert.equal(prevented, false, 'the native dialog cancel handles ESC, not the board jump');
	} finally {
		dialog.remove();
		cleanup(h);
	}
});

test('native scroll keys in a modal reading region do not invoke overlapping game shortcuts', () => {
	const calls = { roll: 0, down: 0, start: 0 };
	const board = document.createElement('div');
	board.id = 'board';
	board.setAttribute('role', 'application');
	document.body.appendChild(board);
	const dialog = document.createElement('dialog');
	dialog.setAttribute('open', '');
	dialog.dataset.modal = 'true';
	const content = document.createElement('div');
	content.className = 'dialog-content';
	content.tabIndex = 0;
	dialog.appendChild(content);
	document.body.appendChild(dialog);

	const detach = attachKeyHandlers({
		board,
		keyMap: { space: 'RollDice', arrowdown: 'MoveDown', home: 'GoToStart' },
		gameBoard: {
			moveDown: () => { calls.down++; return true; },
			goToStart: () => { calls.start++; return true; },
			getActiveIndex: () => -1,
			setActiveIndex: () => {},
		} as any,
		gameCommands: {} as any,
		gameManager: { getSquares: () => [], rollDice: () => { calls.roll++; } } as any,
		focusPlayersPanel: () => {},
	});

	try {
		content.focus();
		for (const key of ['ArrowDown', 'PageDown', 'Home', ' ']) {
			assert.equal(pressKey(content, key), false, `${key} remains available to native scrolling`);
		}
		assert.deepEqual(calls, { roll: 0, down: 0, start: 0 });
	} finally {
		detach();
		dialog.remove();
		board.remove();
	}
});


// ── Family gate: property-only commands are inert in race games ───────────────

function attachFamily(family: string) {
	const calls = { money: 0, endTurn: 0, roll: 0 };
	const board = document.createElement('div');
	board.id = 'board';
	board.setAttribute('role', 'application');
	document.body.appendChild(board);

	const detach = attachKeyHandlers({
		board,
		keyMap: { c: 'AnnounceCurrentPlayerMoney', 'ctrl+e': 'EndTurn', space: 'RollDice' },
		gameBoard: { getActiveIndex: () => -1, setActiveIndex: () => {} } as any,
		gameCommands: { announceCurrentPlayerMoney: () => { calls.money++; return true; } } as any,
		gameManager: { getSquares: () => [], rollDice: () => { calls.roll++; } } as any,
		focusPlayersPanel: () => {},
		onEndTurn: () => { calls.endTurn++; },
		gameFamily: () => family,
	});
	return { calls, board, detach };
}

test('in a race game, the money key and manual end-turn are inert; Roll still works', () => {
	const h = attachFamily('race');
	try {
		pressKey(h.board, 'c');
		pressKey(h.board, 'e', { ctrlKey: true });
		assert.equal(h.calls.money, 0, 'no 0€ announcement in a race');
		assert.equal(h.calls.endTurn, 0, 'race turns end themselves');
		pressKey(h.board, ' ');
		assert.equal(h.calls.roll, 1, 'rolling is family-agnostic');
	} finally {
		h.detach();
		h.board.remove();
	}
});

test('in a property game the same keys keep working', () => {
	const h = attachFamily('property');
	try {
		pressKey(h.board, 'c');
		pressKey(h.board, 'e', { ctrlKey: true });
		assert.equal(h.calls.money, 1);
		assert.equal(h.calls.endTurn, 1);
	} finally {
		h.detach();
		h.board.remove();
	}
});

// ── T = "whose turn?": a real turn, or "no turns" in a simultaneous game ──────

function attachTurn(family: string) {
	const calls = { turn: 0, noTurns: 0 };
	const board = document.createElement('div');
	board.id = 'board';
	board.setAttribute('role', 'application');
	document.body.appendChild(board);

	const detach = attachKeyHandlers({
		board,
		keyMap: { t: 'AnnounceTurn' },
		gameBoard: { getActiveIndex: () => -1, setActiveIndex: () => {} } as any,
		gameCommands: {
			announceTurn: () => { calls.turn++; return true; },
			announceNoTurns: () => { calls.noTurns++; return true; },
		} as any,
		gameManager: { getSquares: () => [] } as any,
		focusPlayersPanel: () => {},
		gameFamily: () => family,
	});
	return { calls, board, detach };
}

test('T announces the turn in turn-based families', () => {
	const h = attachTurn('shedding');
	try {
		pressKey(h.board, 't');
		assert.equal(h.calls.turn, 1);
		assert.equal(h.calls.noTurns, 0);
	} finally { h.detach(); h.board.remove(); }
});

test('T says "no turns" in a SIMULTANEOUS family (draft), keeping the key useful', () => {
	const h = attachTurn('draft');
	try {
		pressKey(h.board, 't');
		assert.equal(h.calls.noTurns, 1, 'draft has no turn order');
		assert.equal(h.calls.turn, 0);
	} finally { h.detach(); h.board.remove(); }
});

// ── C = "how am I doing?": money in property, board identity elsewhere ────────

function attachStatus(family: string) {
	const calls = { money: 0, identity: 0 };
	const board = document.createElement('div');
	board.id = 'board';
	board.setAttribute('role', 'application');
	document.body.appendChild(board);

	const detach = attachKeyHandlers({
		board,
		keyMap: { c: 'AnnounceMyStatus' },
		gameBoard: { getActiveIndex: () => -1, setActiveIndex: () => {} } as any,
		gameCommands: { announceCurrentPlayerMoney: () => { calls.money++; return true; } } as any,
		gameManager: { getSquares: () => [] } as any,
		focusPlayersPanel: () => {},
		onAnnounceIdentity: () => { calls.identity++; return true; },
		gameFamily: () => family,
	});
	return { calls, board, detach };
}

test('C answers per family: money on property boards, board identity on race and track', () => {
	for (const [family, expected] of [['property', 'money'], ['race', 'identity'], ['track', 'identity']] as const) {
		const h = attachStatus(family);
		try {
			assert.equal(pressKey(h.board, 'c'), true, `${family}: C is consumed`);
			assert.equal(h.calls.money, expected === 'money' ? 1 : 0, `${family}: money calls`);
			assert.equal(h.calls.identity, expected === 'identity' ? 1 : 0, `${family}: identity calls`);
		} finally {
			h.detach();
			h.board.remove();
		}
	}
});

// ── N / Shift+N: occupied squares in property games, ALL pieces in race games ─

function attachPieceNav(family: string) {
	const calls = { nextPiece: 0, prevPiece: 0, nextOccupied: 0 };
	const board = document.createElement('div');
	board.id = 'board';
	board.setAttribute('role', 'application');
	document.body.appendChild(board);

	const detach = attachKeyHandlers({
		board,
		keyMap: {
			n: { cmd: 'NextOccupied', args: { forward: true } },
			'shift+n': { cmd: 'NextOccupied', args: { forward: false } },
		},
		gameBoard: {
			getActiveIndex: () => 0,
			setActiveIndex: () => {},
			goToNextPiece: () => { calls.nextPiece++; return true; },
			goToPrevPiece: () => { calls.prevPiece++; return true; },
		} as any,
		gameCommands: { nextOccupied: () => { calls.nextOccupied++; return true; } } as any,
		gameManager: { getSquares: () => [{}, {}] } as any,
		focusPlayersPanel: () => {},
		gameFamily: () => family,
	});
	return { calls, board, detach };
}

test('in a race game N / Shift+N cycle the pieces (regression: the family gate ate them)', () => {
	// NextOccupied used to sit in PROPERTY_ONLY_COMMANDS, so the race redirect to the
	// all-pieces cycle was dead code: the key was swallowed before dispatch.
	const h = attachPieceNav('race');
	try {
		assert.equal(pressKey(h.board, 'n'), true, 'N is consumed');
		assert.equal(h.calls.nextPiece, 1);
		assert.equal(pressKey(h.board, 'N', { shiftKey: true }), true, 'Shift+N is consumed');
		assert.equal(h.calls.prevPiece, 1);
		assert.equal(h.calls.nextOccupied, 0, 'the property navigation is not used in a race');
	} finally {
		h.detach();
		h.board.remove();
	}
});

test('in a track game the family gate also silences property keys and N cycles pieces', () => {
	const f = attachFamily('track');
	try {
		pressKey(f.board, 'c');
		assert.equal(f.calls.money, 0, 'no 0€ announcement on the track either');
		pressKey(f.board, ' ');
		assert.equal(f.calls.roll, 1, 'rolling is family-agnostic');
	} finally {
		f.detach();
		f.board.remove();
	}
	const h = attachPieceNav('track');
	try {
		pressKey(h.board, 'n');
		assert.equal(h.calls.nextPiece, 1, 'N cycles the pieces on the track too');
		assert.equal(h.calls.nextOccupied, 0);
	} finally {
		h.detach();
		h.board.remove();
	}
});

test('in a property game N keeps walking the occupied squares', () => {
	const h = attachPieceNav('property');
	try {
		pressKey(h.board, 'n');
		assert.equal(h.calls.nextOccupied, 1);
		assert.equal(h.calls.nextPiece, 0);
	} finally {
		h.detach();
		h.board.remove();
	}
});

// ── typed square numbers: 1-based on the race circuit, 0-based property indices ─

function attachDigits(family: string) {
	const jumps: number[] = [];
	const board = document.createElement('div');
	board.id = 'board';
	board.setAttribute('role', 'application');
	board.tabIndex = -1;
	document.body.appendChild(board);

	const detach = attachKeyHandlers({
		board,
		keyMap: {},
		gameBoard: { getActiveIndex: () => 0, setActiveIndex: (i: number) => { jumps.push(i); } } as any,
		gameCommands: {} as any,
		gameManager: {
			getSquares: () => new Array(40).fill({}),
			getCurrentGameState: () => (family === 'race' ? { raceBoard: { circuitLength: 68 } }
				: family === 'track' ? { trackBoard: { trackLength: 100, gridWidth: 10, effects: [] } }
				: {}),
		} as any,
		focusPlayersPanel: () => {},
		gameFamily: () => family,
	});
	return { jumps, board, detach };
}

test('typing a number on the race board goes to that 1-based circuit square', () => {
	// Regression: the property 0-based translation leaked into the race board — typing
	// "1" did nothing (square 0 does not exist) and "2" landed on casilla 1.
	const h = attachDigits('race');
	try {
		h.board.focus();
		pressKey(h.board, '1');
		pressKey(h.board, '5'); // composes 15 within the digit window
		assert.deepEqual(h.jumps, [1, 15]);
	} finally {
		h.detach();
		h.board.remove();
	}
});

test('typing a number on the track board goes to that 1-based square', () => {
	const h = attachDigits('track');
	try {
		h.board.focus();
		pressKey(h.board, '4');
		pressKey(h.board, '7'); // composes 47 within the digit window
		assert.deepEqual(h.jumps, [4, 47]);
	} finally {
		h.detach();
		h.board.remove();
	}
});

test('typing a number on the property board keeps its 0-based index translation', () => {
	const h = attachDigits('property');
	try {
		h.board.focus();
		pressKey(h.board, '2');
		assert.deepEqual(h.jumps, [1]);
	} finally {
		h.detach();
		h.board.remove();
	}
});

// ── family:"race" keymap entries (S = route landmarks) and directional M ─────

function attachRaceKeys(family: string) {
	const calls: Array<{ cmd: string; forward: boolean }> = [];
	const board = document.createElement('div');
	board.id = 'board';
	board.setAttribute('role', 'application');
	document.body.appendChild(board);

	const detach = attachKeyHandlers({
		board,
		keyMap: {
			m: { cmd: 'GoToMe', args: { forward: true } },
			'shift+m': { cmd: 'GoToMe', args: { forward: false } },
			s: { cmd: 'GoToMyStart', args: { forward: true }, family: 'race' },
			'shift+s': { cmd: 'GoToMyStart', args: { forward: false }, family: 'race' },
		},
		gameBoard: {
			getActiveIndex: () => 0,
			setActiveIndex: () => {},
			goToMe: (forward = true) => { calls.push({ cmd: 'me', forward }); return true; },
			goToMyStart: (forward = true) => { calls.push({ cmd: 'start', forward }); return true; },
		} as any,
		gameCommands: {} as any,
		gameManager: { getSquares: () => [{}, {}] } as any,
		focusPlayersPanel: () => {},
		gameFamily: () => family,
	});
	return { calls, board, detach };
}

test('M / Shift+M carry the direction, and race-family S works in a race game', () => {
	const h = attachRaceKeys('race');
	try {
		pressKey(h.board, 'm');
		pressKey(h.board, 'M', { shiftKey: true });
		pressKey(h.board, 's');
		pressKey(h.board, 'S', { shiftKey: true });
		assert.deepEqual(h.calls, [
			{ cmd: 'me', forward: true },
			{ cmd: 'me', forward: false },
			{ cmd: 'start', forward: true },
			{ cmd: 'start', forward: false },
		]);
	} finally {
		h.detach();
		h.board.remove();
	}
});

test('a family:"race" binding is inert on the track board too (S has no route landmarks there)', () => {
	const h = attachRaceKeys('track');
	try {
		assert.equal(pressKey(h.board, 's'), false, 'S is not consumed in a track game');
		assert.deepEqual(h.calls, []);
	} finally {
		h.detach();
		h.board.remove();
	}
});

test('a family:"race" binding is inert in a property game (its letter belongs to group keys)', () => {
	const h = attachRaceKeys('property');
	try {
		assert.equal(pressKey(h.board, 's'), false, 'S is not consumed in a property game');
		assert.deepEqual(h.calls, []);
		pressKey(h.board, 'm'); // untagged bindings keep working in both families
		assert.deepEqual(h.calls, [{ cmd: 'me', forward: true }]);
	} finally {
		h.detach();
		h.board.remove();
	}
});
