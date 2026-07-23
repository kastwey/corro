import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { attachKeyHandlers } from '../src/keys.js';

before(() => setupDom());

function press(target: Element, key: string): boolean {
	const event = new KeyboardEvent('keydown', {
		key,
		ctrlKey: true,
		altKey: true,
		bubbles: true,
		cancelable: true,
	});
	target.dispatchEvent(event);
	return event.defaultPrevented;
}

function harness() {
	const calls = { panel: 0, mute: 0, speakers: 0 };
	const board = document.createElement('div');
	board.id = 'board';
	board.setAttribute('role', 'application');
	const range = document.createElement('input');
	range.type = 'range';
	document.body.append(board, range);
	const detach = attachKeyHandlers({
		board,
		keyMap: {
			'ctrl+alt+v': 'ToggleVoicePanel',
			'ctrl+alt+x': 'ToggleVoiceMute',
			'ctrl+alt+a': 'AnnounceVoiceSpeakers',
		},
		gameBoard: { getActiveIndex: () => 0, setActiveIndex: () => {} } as any,
		gameCommands: {} as any,
		focusPlayersPanel: () => {},
		onToggleVoicePanel: () => { calls.panel++; },
		onToggleVoiceMute: () => { calls.mute++; },
		onAnnounceVoiceSpeakers: () => { calls.speakers++; return true; },
	});
	return { calls, board, range, detach };
}

test('voice shortcuts are global from the board and a focused volume control', () => {
	const h = harness();
	try {
		assert.equal(press(h.board, 'v'), true);
		assert.equal(press(h.range, 'x'), true);
		assert.equal(press(h.range, 'a'), true);
		assert.deepEqual(h.calls, { panel: 1, mute: 1, speakers: 1 });
	} finally {
		h.detach();
		h.board.remove();
		h.range.remove();
	}
});

test('active-speaker query remains available inside a modal dialog', () => {
	const h = harness();
	const dialog = document.createElement('dialog');
	dialog.dataset.modal = 'true';
	dialog.setAttribute('open', '');
	const button = document.createElement('button');
	dialog.appendChild(button);
	document.body.appendChild(dialog);
	try {
		assert.equal(press(button, 'a'), true);
		assert.equal(h.calls.speakers, 1);
		assert.equal(press(button, 'x'), false, 'microphone mutation stays suppressed inside a modal');
		assert.equal(h.calls.mute, 0);
	} finally {
		h.detach();
		dialog.remove();
		h.board.remove();
		h.range.remove();
	}
});
