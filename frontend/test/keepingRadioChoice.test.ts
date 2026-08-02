import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { keepingRadioChoice } from '../src/lobby/ui.js';
import { renderSeatSelector } from '../src/lobby/seats.js';
import type { LobbySeatInfo } from '../src/models.js';

/**
 * A package's own words (piece names, squadron seats) are painted with t(), which `applyI18n`
 * cannot reach — so a language change has to REPAINT those groups outright. This is what makes
 * that repaint survivable: the player's choice comes back, and so does the keyboard.
 *
 * Without it the fix would have been worse than the bug: switching language mid-form would
 * silently un-pick somebody's piece, or drop focus onto <body> when the focused radio was
 * replaced under it.
 */

const SEATS: LobbySeatInfo[] = [
	{ id: 'red', color: '#e00', nameKey: 'seats.red' },
	{ id: 'blue', color: '#00e', nameKey: 'seats.blue' },
	{ id: 'green', color: '#0a0', nameKey: 'seats.green' },
];

let container: HTMLElement;

before(() => setupDom());

beforeEach(() => {
	document.body.innerHTML = '<ul id="seat-list"></ul>';
	container = document.getElementById('seat-list')!;
});

/** Repaint in a different language, exactly as onLanguageChanged does. */
const repaint = (lang: string, taken?: Map<string, string>) =>
	keepingRadioChoice(container, 'seat', () =>
		renderSeatSelector(container, SEATS, (key: string) => `${key}:${lang}`, taken));

test('a repaint keeps the chosen option, in the new language', () => {
	repaint('en');
	const blue = container.querySelector<HTMLInputElement>('input[value="blue"]')!;
	blue.checked = true;

	repaint('es');

	const after = container.querySelector<HTMLInputElement>('input[name="seat"]:checked')!;
	assert.equal(after.value, 'blue', 'the player still holds the seat they picked');
	assert.match(container.textContent ?? '', /seats\.blue:es/, 'and it is now named in Spanish');
});

test('a repaint keeps the keyboard where it was', () => {
	repaint('en');
	container.querySelector<HTMLInputElement>('input[value="green"]')!.focus();

	repaint('es');

	const focused = document.activeElement as HTMLInputElement;
	assert.equal(focused.value, 'green', 'not dropped onto <body> when the radio was replaced');
});

// Nothing is preserved that the player is no longer entitled to: a seat someone else took while
// they were reading belongs to that someone else, and the renderer has already said so.
test('a choice that has since been taken is not restored', () => {
	repaint('en');
	container.querySelector<HTMLInputElement>('input[value="red"]')!.checked = true;

	repaint('es', new Map([['red', 'Ana']]));

	const after = container.querySelector<HTMLInputElement>('input[name="seat"]:checked');
	assert.notEqual(after?.value, 'red', "a seat taken meanwhile is not handed back");
});

test('an untouched group is left exactly as the renderer built it', () => {
	// Nothing chosen yet: the helper must not invent a selection of its own.
	repaint('en');
	const checkedBefore = container.querySelector('input[name="seat"]:checked')?.getAttribute('value');
	repaint('es');
	assert.equal(container.querySelector('input[name="seat"]:checked')?.getAttribute('value'), checkedBefore);
});
