import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeI18next, setupDom } from './helpers/dom.js';
import {
	attachCommandPrefix, isStandaloneModifier, matchesCommandPrefix, spokenKeyName,
} from '../src/commandPrefix.js';
import { modeCueTones } from '../src/soundEvents.js';

setupDom();
installFakeI18next('en');

interface Harness {
	input: HTMLInputElement;
	surface: HTMLElement;
	/** Keydowns that reached the surface, i.e. keystrokes replayed as commands. */
	replayed: KeyboardEvent[];
	announced: string[];
	cues: string[];
	/** Whether the surface pretends to be a shortcut handler that consumes what it answers. */
	answers: (event: KeyboardEvent) => boolean;
	detach: () => void;
	press: (target: EventTarget, init: KeyboardEventInit) => KeyboardEvent;
}

function harness(options: { answers?: (event: KeyboardEvent) => boolean } = {}): Harness {
	document.body.innerHTML = '';
	const surface = document.createElement('div');
	surface.id = 'board';
	const input = document.createElement('input');
	input.type = 'text';
	document.body.append(surface, input);

	const h: Harness = {
		input, surface,
		replayed: [],
		announced: [],
		cues: [],
		answers: options.answers ?? (() => true),
		detach: () => {},
		press: (target, init) => {
			const event = new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
			target.dispatchEvent(event);
			return event;
		},
	};

	surface.addEventListener('keydown', event => {
		h.replayed.push(event);
		// Every real handler in the app consumes the events it answers; that is the signal
		// the prefix reads back to tell a shortcut from a key that means nothing here.
		if (h.answers(event)) event.preventDefault();
	});

	h.detach = attachCommandPrefix({
		surface: () => surface,
		announce: text => { h.announced.push(text); },
		t: (key, vars) => (vars ? `${key}:${JSON.stringify(vars)}` : key),
		cue: kind => { h.cues.push(kind); },
	});
	return h;
}

const PREFIX: KeyboardEventInit = { key: ' ', ctrlKey: true, shiftKey: true };

test('the prefix arms from a text box, and says so in both channels', () => {
	const h = harness();

	const armed = h.press(h.input, PREFIX);

	assert.equal(armed.defaultPrevented, true, 'the prefix never reaches the field');
	assert.deepEqual(h.cues, ['armed']);
	assert.deepEqual(h.announced, ['game.typing_command_armed']);
	h.detach();
});

test('the armed keystroke is replayed on the surface instead of typed', () => {
	const h = harness();
	h.press(h.input, PREFIX);

	const command = h.press(h.input, { key: 's' });

	assert.equal(command.defaultPrevented, true, 'the letter never becomes a character');
	assert.equal(h.replayed.length, 1);
	assert.equal(h.replayed[0].key, 's');
	// The replay carries no trace of the text box: that is what makes every existing handler
	// answer it exactly as it would from the board.
	assert.equal(h.replayed[0].target, h.surface);
	assert.deepEqual(h.cues, ['armed', 'released']);
	h.detach();
});

test('it lasts exactly one keystroke', () => {
	const h = harness();
	h.press(h.input, PREFIX);
	h.press(h.input, { key: 's' });

	const afterwards = h.press(h.input, { key: 's' });

	assert.equal(afterwards.defaultPrevented, false, 'back to typing at once');
	assert.equal(h.replayed.length, 1, 'and nothing further is replayed');
	h.detach();
});

test('reaching for Shift does not spend the prefix', () => {
	const h = harness();
	h.press(h.input, PREFIX);

	// Pressing Shift+S means pressing Shift first: if that ended the mode, no shortcut with a
	// modifier would ever be reachable from a field.
	h.press(h.input, { key: 'Shift', shiftKey: true });
	assert.equal(h.replayed.length, 0);

	h.press(h.input, { key: 'S', shiftKey: true });
	assert.equal(h.replayed.length, 1);
	assert.equal(h.replayed[0].shiftKey, true);
	h.detach();
});

test('a key that is no shortcut is swallowed and said, never typed', () => {
	const h = harness({ answers: () => false });
	h.press(h.input, PREFIX);

	const stray = h.press(h.input, { key: 'ñ' });

	assert.equal(stray.defaultPrevented, true, 'a stray character in an answer is worse than a refusal');
	assert.equal(h.announced.at(-1), 'game.typing_command_unknown:{"key":"Ñ"}');
	h.detach();
});

test('Escape and a second prefix both cancel without running anything', () => {
	for (const cancel of [{ key: 'Escape' }, PREFIX] as KeyboardEventInit[]) {
		const h = harness();
		h.press(h.input, PREFIX);

		h.press(h.input, cancel);

		assert.equal(h.replayed.length, 0, JSON.stringify(cancel));
		assert.deepEqual(h.cues, ['armed', 'released']);
		assert.equal(h.announced.at(-1), 'game.typing_command_cancelled');
		h.detach();
	}
});

test('leaving the field ends the mode', () => {
	const h = harness();
	h.press(h.input, PREFIX);

	h.input.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true }));

	assert.deepEqual(h.cues, ['armed', 'released']);
	assert.equal(h.announced.at(-1), 'game.typing_command_cancelled');
	const afterwards = h.press(h.input, { key: 's' });
	assert.equal(afterwards.defaultPrevented, false, 'the next letter is a letter again');
	assert.equal(h.replayed.length, 0);
	h.detach();
});

test('outside a text box there is nothing to arm', () => {
	const h = harness();
	const button = document.createElement('button');
	document.body.appendChild(button);

	const pressed = h.press(button, PREFIX);

	// The keys already work there; arming would only let a board key act from a panel that
	// deliberately ignores it.
	assert.equal(pressed.defaultPrevented, false);
	assert.deepEqual(h.cues, []);
	// And the keystroke after it is nobody's business but the button's.
	assert.equal(h.press(button, { key: 's' }).defaultPrevented, false);
	assert.equal(h.replayed.length, 0);
	h.detach();
});

test('a modal dialog keeps its own rules: the prefix does not arm inside one', () => {
	const h = harness();
	const dialog = document.createElement('dialog');
	dialog.setAttribute('open', '');
	const field = document.createElement('input');
	dialog.appendChild(field);
	document.body.appendChild(dialog);

	const pressed = h.press(field, PREFIX);

	// A modal dialog answers only its own read-only queries; the prefix must not become a way
	// around that.
	assert.equal(pressed.defaultPrevented, false);
	assert.deepEqual(h.cues, []);
	h.detach();
});

test('a non-modal dialog is just another panel, so the prefix works there', () => {
	const h = harness();
	const dialog = document.createElement('dialog');
	dialog.setAttribute('open', '');
	dialog.dataset.modal = 'false';
	const field = document.createElement('input');
	dialog.appendChild(field);
	document.body.appendChild(dialog);

	const pressed = h.press(field, PREFIX);

	assert.equal(pressed.defaultPrevented, true);
	assert.deepEqual(h.cues, ['armed']);
	h.detach();
});

test('a keystroke that belongs to a composition is left alone', () => {
	const h = harness();

	// A dead key on the way to "á", or an IME picking a candidate: those keystrokes belong to
	// the text being written, never to us.
	const composing = h.press(h.input, { ...PREFIX, isComposing: true });

	assert.equal(composing.defaultPrevented, false);
	assert.deepEqual(h.cues, []);
	h.detach();
});

test('the prefix is Ctrl+Shift+Space and nothing else', () => {
	assert.equal(matchesCommandPrefix({ key: ' ', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false }), true);
	assert.equal(matchesCommandPrefix({ key: 'Spacebar', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false }), true);
	// Alt is Option on macOS and AltGr on Windows; neither may creep into this chord.
	assert.equal(matchesCommandPrefix({ key: ' ', ctrlKey: true, shiftKey: true, altKey: true, metaKey: false }), false);
	assert.equal(matchesCommandPrefix({ key: ' ', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false }), false);
	assert.equal(matchesCommandPrefix({ key: 's', ctrlKey: true, shiftKey: true, altKey: false, metaKey: false }), false);
});

test('the modifier keys an armed prefix has to survive', () => {
	for (const key of ['Shift', 'Control', 'Alt', 'AltGraph', 'Meta', 'CapsLock', 'Dead']) {
		assert.equal(isStandaloneModifier(key), true, key);
	}
	for (const key of ['s', 'Escape', 'Enter', 'ArrowUp']) {
		assert.equal(isStandaloneModifier(key), false, key);
	}
});

test('a key is spoken with the same name the shortcuts table gives it', () => {
	assert.equal(spokenKeyName('s'), 'S');
	// Not the raw event key: " " would be announced as a blank, and "ArrowUp" as one word.
	assert.equal(spokenKeyName(' '), 'Space');
	assert.equal(spokenKeyName('ArrowUp'), 'Up arrow');
});

test('the mode cue rises on the way in and falls on the way out', () => {
	const [inLow, inHigh] = modeCueTones(true);
	const [outHigh, outLow] = modeCueTones(false);

	assert.ok(inLow < inHigh, 'entering a mode rises');
	assert.ok(outHigh > outLow, 'leaving it falls');
	assert.deepEqual(modeCueTones(true), [...modeCueTones(false)].reverse(), 'the same two tones');
});
