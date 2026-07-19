import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { attachKeyHandlers } from '../src/keys.js';

// Regression: while a modal owns focus, global shortcuts are suppressed so they cannot
// disrupt the flow — EXCEPT read-only "announce" queries (auction status, money, release-pass
// cards, Free Parking pot, turn, history), which only speak state and never mutate the
// game. Before the fix `if (isInDialog) return;` swallowed every key in the dialog, so a
// blind player could not check their situation without first dismissing the modal. These
// tests drive the real keydown handler through jsdom.

before(() => {
	setupDom();
});

interface Harness {
	detach: () => void;
	calls: { auction: number; players: number; money: number; holding: number; parking: number; dialog: number; nextPanel: number };
}

function attach(): Harness {
	const calls = { auction: 0, players: 0, money: 0, holding: 0, parking: 0, dialog: 0, nextPanel: 0 };
	const gameBoard: any = {
		getActiveIndex: () => -1,
		setActiveIndex: () => {},
		goToMe: () => true,
		goToStart: () => true,
		moveLeft: () => true, moveRight: () => true, moveUp: () => true, moveDown: () => true,
	};
	const gameCommands: any = {
		announceAuctionStatus: () => { calls.auction++; return true; },
		announceCurrentPlayerMoney: () => { calls.money++; return true; },
		announceCurrentPlayerReleasePasses: () => { calls.holding++; return true; },
		announceFreeParkingPot: () => { calls.parking++; return true; },
	};
	const detach = attachKeyHandlers({
		board: document.body,
		keyMap: {
			a: 'AnnounceAuction',
			p: 'FocusPlayers',
			c: 'AnnounceCurrentPlayerMoney',
			j: 'AnnounceCurrentPlayerReleasePasses',
			f: 'AnnounceFreeParkingPot',
			'ctrl+d': 'FocusDialog',
			f6: 'NextPanel',
		},
		gameBoard,
		gameCommands,
		gameManager: { getSquares: () => [] } as any,
		focusPlayersPanel: () => { calls.players++; },
		panelNav: {
			next: () => { calls.nextPanel++; return true; },
			prev: () => true,
			focusActions: () => true,
			focusDialog: () => { calls.dialog++; return true; },
		},
	});
	return { detach, calls };
}

function pressKey(target: Element, key: string, init: KeyboardEventInit = {}): boolean {
	const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
	target.dispatchEvent(ev);
	return ev.defaultPrevented;
}

test('"a" inside the auction dialog reads the auction status and is consumed', () => {
	const h = attach();
	try {
		const dialog = document.createElement('dialog');
		dialog.setAttribute('open', '');
		dialog.className = 'game-dialog auction-dialog';
		const input = document.createElement('input');
		input.type = 'number'; // the auction bid field — letters do nothing, so the query rides along
		dialog.appendChild(input);
		document.body.appendChild(dialog);

		const prevented = pressKey(input, 'a');

		assert.equal(h.calls.auction, 1, 'announceAuctionStatus should run once');
		assert.equal(prevented, true, 'the key should be consumed (preventDefault)');
		dialog.remove();
	} finally {
		h.detach();
	}
});

test('a different shortcut ("p") is still suppressed inside the auction dialog', () => {
	const h = attach();
	try {
		const dialog = document.createElement('dialog');
		dialog.setAttribute('open', '');
		dialog.className = 'game-dialog auction-dialog';
		const input = document.createElement('input');
		dialog.appendChild(input);
		document.body.appendChild(dialog);

		pressKey(input, 'p');

		assert.equal(h.calls.players, 0, 'players panel must not be focused from within the auction modal');
		dialog.remove();
	} finally {
		h.detach();
	}
});

test('"a" in a non-auction modal now reads the auction status too (read-only query)', () => {
	const h = attach();
	try {
		const dialog = document.createElement('dialog');
		dialog.setAttribute('open', '');
		const input = document.createElement('input');
		input.type = 'number';
		dialog.appendChild(input);
		document.body.appendChild(dialog);

		const prevented = pressKey(input, 'a');

		assert.equal(h.calls.auction, 1, 'read-only announce queries work in any modal');
		assert.equal(prevented, true, 'the key is consumed');
		dialog.remove();
	} finally {
		h.detach();
	}
});

// A NON-modal dialog (data-modal="false", e.g. the race piece choice) does not trap focus:
// it behaves like one more panel, so global shortcuts keep working from inside it.
test('inside a non-modal dialog, global shortcuts are NOT suppressed', () => {
	const h = attach();
	try {
		const dialog = document.createElement('dialog');
		dialog.setAttribute('open', '');
		dialog.dataset.modal = 'false';
		const button = document.createElement('button');
		dialog.appendChild(button);
		document.body.appendChild(dialog);

		pressKey(button, 'p');
		assert.equal(h.calls.players, 1, 'FocusPlayers works from inside a non-modal dialog');

		pressKey(button, 'f6');
		assert.equal(h.calls.nextPanel, 1, 'F6 panel cycling works from inside a non-modal dialog');
		dialog.remove();
	} finally {
		h.detach();
	}
});

test('Ctrl+D focuses the open dialog from anywhere', () => {
	const h = attach();
	try {
		const prevented = pressKey(document.body, 'd', { ctrlKey: true });

		assert.equal(h.calls.dialog, 1, 'FocusDialog runs');
		assert.equal(prevented, true, 'the key is consumed');
	} finally {
		h.detach();
	}
});

test('F6 is still suppressed inside a MODAL dialog (focus is trapped there)', () => {
	const h = attach();
	try {
		const dialog = document.createElement('dialog');
		dialog.setAttribute('open', '');
		dialog.dataset.modal = 'true';
		const button = document.createElement('button');
		dialog.appendChild(button);
		document.body.appendChild(dialog);

		pressKey(button, 'f6');

		assert.equal(h.calls.nextPanel, 0, 'panel cycling must not run under a modal');
		dialog.remove();
	} finally {
		h.detach();
	}
});

test('read-only money / holding / parking queries work inside a modal dialog', () => {
	const h = attach();
	try {
		const dialog = document.createElement('dialog');
		dialog.setAttribute('open', '');
		const input = document.createElement('input');
		input.type = 'number';
		dialog.appendChild(input);
		document.body.appendChild(dialog);

		assert.equal(pressKey(input, 'c'), true);
		assert.equal(pressKey(input, 'j'), true);
		assert.equal(pressKey(input, 'f'), true);

		assert.equal(h.calls.money, 1, 'money query runs in the dialog');
		assert.equal(h.calls.holding, 1, 'release-pass-cards query runs in the dialog');
		assert.equal(h.calls.parking, 1, 'Free Parking pot query runs in the dialog');
		dialog.remove();
	} finally {
		h.detach();
	}
});

// A TEXT field in a modal (the trivia answer box) must own every key it can type — the
// read-only query hijack is for NUMERIC fields (which ignore letters), never a text one.
test('a text field in a modal keeps its letters — no query hijack', () => {
	const h = attach();
	try {
		const dialog = document.createElement('dialog');
		dialog.setAttribute('open', '');
		const input = document.createElement('input');
		input.type = 'text';
		dialog.appendChild(input);
		document.body.appendChild(dialog);

		const preventedA = pressKey(input, 'a'); // was hijacked as "announce auction"
		const preventedF = pressKey(input, 'f'); // was hijacked as "announce Free Parking pot"

		assert.equal(h.calls.auction, 0, 'no auction query stolen from the text field');
		assert.equal(h.calls.parking, 0, 'no Free Parking query stolen from the text field');
		assert.equal(preventedA, false, "'a' is left for the input to type");
		assert.equal(preventedF, false, "'f' is left for the input to type");
		dialog.remove();
	} finally {
		h.detach();
	}
});
