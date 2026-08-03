import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { ComboBox, filterItems, normalizeForSearch, sortItems } from '../src/comboBox.js';

/**
 * The game picker: an editable combobox whose list you can also just walk.
 *
 * The properties worth pinning are the ones a reader would notice going wrong — the list is never
 * a tab stop, the arrows make it a loop hanging off the field, a keystroke from inside the list
 * lands in the field where it belongs, and the count is shown at once but SPOKEN late so a
 * four-letter search is one announcement rather than four.
 */

setupDom();

const GAMES = [
	{ id: 'uno', label: 'Uno' },
	{ id: 'espana', label: 'España moderna' },
	{ id: 'mine', label: 'La mina' },
	{ id: 'sushi', label: 'Sushi Go' },
];

interface Harness {
	combo: ComboBox;
	input: HTMLInputElement;
	listbox: HTMLElement;
	visual: HTMLElement;
	live: HTMLElement;
	options: () => HTMLElement[];
	labels: () => string[];
	press: (key: string, from?: HTMLElement) => void;
	type: (text: string) => void;
	/** Run the pending debounced announcement, as a real 500 ms pause would. */
	settle: () => void;
	selected: string[];
}

function harness(items = GAMES): Harness {
	document.body.innerHTML = `
		<input id="board-selector" role="combobox" aria-expanded="false" aria-controls="board-listbox">
		<ul id="board-listbox" role="listbox"></ul>
		<p id="board-results" aria-hidden="true"></p>
		<p id="board-results-live" role="status" aria-live="polite"></p>`;
	const input = document.getElementById('board-selector') as HTMLInputElement;
	const listbox = document.getElementById('board-listbox') as HTMLElement;
	const visual = document.getElementById('board-results') as HTMLElement;
	const live = document.getElementById('board-results-live') as HTMLElement;
	const selected: string[] = [];

	let pending: (() => void) | null = null;
	const combo = new ComboBox({
		input,
		listbox,
		visualStatus: visual,
		liveStatus: live,
		locale: 'es',
		describeResults: count => (count === 0 ? 'Sin resultados' : `${count} resultados`),
		onSelect: item => selected.push(item?.id ?? '<none>'),
		schedule: callback => { pending = callback; return 1; },
		cancel: () => { pending = null; },
	});
	combo.setItems(items);

	const options = () => Array.from(listbox.querySelectorAll<HTMLElement>('[role="option"]'));
	const press = (key: string, from?: HTMLElement) => {
		(from ?? (document.activeElement as HTMLElement) ?? input).dispatchEvent(
			new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
	};
	return {
		combo, input, listbox, visual, live, options, selected,
		labels: () => options().map(option => option.textContent ?? ''),
		press,
		type: (text: string) => {
			input.value = text;
			input.dispatchEvent(new window.Event('input', { bubbles: true }));
		},
		settle: () => { const run = pending; pending = null; run?.(); },
	};
}

test('the catalogue is alphabetical in the reader language, not in code-point order', () => {
	// "España" sorts under E in Spanish; a naive sort would file it after every ASCII letter.
	assert.deepEqual(
		sortItems(GAMES, 'es').map(item => item.label),
		['España moderna', 'La mina', 'Sushi Go', 'Uno']);
});

test('searching ignores case and accents', () => {
	assert.equal(normalizeForSearch('  España  '), 'espana');
	assert.deepEqual(filterItems(GAMES, 'espana').map(item => item.id), ['espana']);
	assert.deepEqual(filterItems(GAMES, 'ESPAÑA').map(item => item.id), ['espana']);
	assert.deepEqual(filterItems(GAMES, 'go').map(item => item.id), ['sushi']);
	assert.deepEqual(filterItems(GAMES, '').length, GAMES.length, 'no query means everything');
});

test('the list is on screen in full, and is never a tab stop', () => {
	const h = harness();

	assert.deepEqual(h.labels(), ['España moderna', 'La mina', 'Sushi Go', 'Uno']);
	// The way in is the arrow key, which is the bargain the combobox role advertises.
	assert.deepEqual(h.options().map(option => option.tabIndex), [-1, -1, -1, -1]);
	assert.equal(h.input.getAttribute('aria-expanded'), 'true');
	assert.equal(h.listbox.getAttribute('role'), 'listbox');
});

test('Down enters the list at the top; Up jumps straight to its end', () => {
	const h = harness();
	h.input.focus();

	h.press('ArrowDown');
	assert.equal(document.activeElement, h.options()[0]);

	h.input.focus();
	h.press('ArrowUp');
	assert.equal(document.activeElement, h.options()[3], 'Up from the field is a shortcut to the end');
});

test('the list is a loop hanging off the field, not a wall at either end', () => {
	const h = harness();
	h.input.focus();

	h.press('ArrowDown');
	h.press('ArrowUp');
	assert.equal(document.activeElement, h.input, 'up past the first item comes back to the field');

	h.press('ArrowUp');           // to the last
	h.press('ArrowDown');
	assert.equal(document.activeElement, h.input, 'down past the last item comes back too');
});

test('Home and End reach the ends of the list from anywhere in it', () => {
	const h = harness();
	h.input.focus();
	h.press('ArrowDown');

	h.press('End');
	assert.equal(document.activeElement, h.options()[3]);
	h.press('Home');
	assert.equal(document.activeElement, h.options()[0]);
});

test('typing filters, and the field keeps the whole catalogue when emptied', () => {
	const h = harness();

	h.type('s');
	assert.deepEqual(h.labels(), ['España moderna', 'Sushi Go']);
	h.type('sus');
	assert.deepEqual(h.labels(), ['Sushi Go']);
	h.type('');
	assert.equal(h.labels().length, 4);
});

// The rule that makes the list a place you can stay: correcting a search you can SEE is wrong
// must not require knowing you have to travel back to the field first.
test('a keystroke from inside the list lands in the field, and the filter follows', () => {
	const h = harness();
	h.input.focus();
	h.press('ArrowDown');
	assert.equal(document.activeElement, h.options()[0]);

	h.press('s');
	assert.equal(document.activeElement, h.input, 'typing belongs to the field');
	assert.equal(h.input.value, 's');
	assert.deepEqual(h.labels(), ['España moderna', 'Sushi Go']);

	// …and so does erasing.
	h.press('ArrowDown');
	assert.equal(document.activeElement, h.options()[0]);
	h.press('Backspace');
	assert.equal(document.activeElement, h.input);
	assert.equal(h.input.value, '');
	assert.equal(h.labels().length, 4);
});

test('choosing an item names it in the field and reports it once', () => {
	const h = harness();
	h.input.focus();
	h.press('ArrowDown');
	h.press('Enter');

	assert.equal(h.combo.value, 'espana');
	assert.equal(h.input.value, 'España moderna');
	assert.equal(document.activeElement, h.input, 'the reader is put back where they can carry on');
	assert.deepEqual(h.selected, ['espana']);
	// The whole list comes back: a field showing "España moderna" that is ALSO filtering by it
	// would leave one item on screen and read as "there is only one".
	assert.equal(h.labels().length, 4);
	assert.equal(h.options()[0].getAttribute('aria-selected'), 'true');
	assert.equal(h.options()[1].getAttribute('aria-selected'), 'false');
});

test('with one candidate left, Enter in the field takes it — and never submits the form', () => {
	const h = harness();
	h.type('sus');
	const enter = new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
	h.input.dispatchEvent(enter);

	assert.equal(enter.defaultPrevented, true, 'Enter must not reach the create form');
	assert.equal(h.combo.value, 'sushi');
});

test('an empty result set is not an expanded popup, whatever is on screen', () => {
	const h = harness();
	h.type('zzzz');

	assert.deepEqual(h.labels(), []);
	assert.equal(h.input.getAttribute('aria-expanded'), 'false');
	assert.equal(h.visual.textContent, 'Sin resultados');
});

// One element cannot be both instant and patient, which is why there are two.
test('the count is shown at once and spoken only once the typing stops', () => {
	const h = harness();

	h.type('s');
	assert.equal(h.visual.textContent, '2 resultados', 'the eye gets it immediately');
	assert.equal(h.live.textContent, '', 'nothing is spoken mid-word');

	h.type('su');
	h.type('sus');
	assert.equal(h.visual.textContent, '1 resultados');
	assert.equal(h.live.textContent, '', 'still nothing: every keystroke pushed it back');

	h.settle();
	assert.equal(h.live.textContent, '1 resultados', 'one announcement for the whole search');
});

test('the visible count is hidden from assistive tech, so it is never said twice', () => {
	const h = harness();
	assert.equal(h.visual.getAttribute('aria-hidden'), 'true');
	assert.equal(h.live.getAttribute('aria-live'), 'polite');
});

test('Escape restores the chosen game and the full list rather than emptying the field', () => {
	const h = harness();
	h.combo.setValue('uno');
	h.type('sus');
	assert.deepEqual(h.labels(), ['Sushi Go']);

	h.input.focus();
	h.press('Escape');
	assert.equal(h.input.value, 'Uno');
	assert.equal(h.labels().length, 4);
	assert.equal(h.combo.value, 'uno', 'looking around is not choosing');
});

test('a catalogue that loses the chosen game says so instead of silently picking another', () => {
	const h = harness();
	h.combo.setValue('uno');
	h.selected.length = 0;

	h.combo.setItems([{ id: 'mine', label: 'La mina' }]);

	assert.equal(h.combo.value, null);
	assert.deepEqual(h.selected, ['<none>']);
});

// Typing continues the SEARCH, never the committed name: appending to "Sushi Go" would look for
// something nobody asked for and find nothing.
test('typing from the list after a choice starts a fresh search, not a longer name', () => {
	const h = harness();
	h.combo.setValue('sushi');
	assert.equal(h.input.value, 'Sushi Go');

	h.input.focus();
	h.press('ArrowDown');
	h.press('e');

	assert.equal(h.input.value, 'e', 'the game name was replaced, not extended');
	assert.deepEqual(h.labels(), ['España moderna'], 'only one game has an e in it');
});

test('Escape from inside the list comes back to the field without choosing', () => {
	const h = harness();
	h.input.focus();
	h.press('ArrowDown');
	h.press('Escape');

	assert.equal(document.activeElement, h.input);
	assert.equal(h.combo.value, null);
});
