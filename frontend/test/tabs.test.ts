import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { Tabs, nextTabIndex } from '../src/tabs.js';

/**
 * The tab pattern, once.
 *
 * Two surfaces want it and there was none, so what these tests pin down is the contract both will
 * rely on: one tab stop for the whole strip, the arrows doing the rest, and exactly one panel
 * showing. The last of those is the one a stylesheet can quietly break — a `hidden` that does not
 * hide leaves every panel on screen at the same time, which reads as one long page of everything.
 */

setupDom();

function harness() {
	document.body.innerHTML = `
		<div role="tablist" id="strip">
			<button role="tab" id="tab-a" aria-controls="panel-a">A</button>
			<button role="tab" id="tab-b" aria-controls="panel-b">B</button>
			<button role="tab" id="tab-c" aria-controls="panel-c">C</button>
		</div>
		<div role="tabpanel" id="panel-a">first</div>
		<div role="tabpanel" id="panel-b">second</div>
		<div role="tabpanel" id="panel-c">third</div>`;

	const selected: string[] = [];
	const tabs = new Tabs({
		tablist: document.getElementById('strip') as HTMLElement,
		onSelect: id => selected.push(id),
	});
	return {
		tabs,
		selected,
		tab: (id: string) => document.getElementById(id) as HTMLElement,
		panel: (id: string) => document.getElementById(id) as HTMLElement,
		press: (key: string) => (document.activeElement as HTMLElement).dispatchEvent(
			new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })),
	};
}

// The wrapping at the ends is the part everybody gets wrong, so it is tested without a DOM at all.
test('the arrows wrap, and Home and End go to the ends', () => {
	assert.equal(nextTabIndex(0, 'ArrowRight', 3), 1);
	assert.equal(nextTabIndex(2, 'ArrowRight', 3), 0);
	assert.equal(nextTabIndex(0, 'ArrowLeft', 3), 2);
	assert.equal(nextTabIndex(1, 'Home', 3), 0);
	assert.equal(nextTabIndex(1, 'End', 3), 2);
	// Anything else leaves it where it is, and an empty strip has nowhere to go.
	assert.equal(nextTabIndex(1, 'Enter', 3), 1);
	assert.equal(nextTabIndex(0, 'ArrowRight', 0), -1);
});

test('exactly one panel shows, and the first tab is the one that starts selected', () => {
	const h = harness();

	assert.equal(h.tab('tab-a').getAttribute('aria-selected'), 'true');
	assert.deepEqual(
		['panel-a', 'panel-b', 'panel-c'].map(id => h.panel(id).hidden),
		[false, true, true]);
});

test('the strip is ONE tab stop; the arrows move between tabs', () => {
	const h = harness();

	assert.deepEqual(
		['tab-a', 'tab-b', 'tab-c'].map(id => h.tab(id).tabIndex),
		[0, -1, -1]);

	h.tab('tab-a').focus();
	h.press('ArrowRight');

	assert.equal(document.activeElement, h.tab('tab-b'));
	assert.equal(h.tab('tab-b').getAttribute('aria-selected'), 'true');
	assert.deepEqual(
		['tab-a', 'tab-b', 'tab-c'].map(id => h.tab(id).tabIndex),
		[-1, 0, -1]);
	// And the panels followed.
	assert.deepEqual(
		['panel-a', 'panel-b', 'panel-c'].map(id => h.panel(id).hidden),
		[true, false, true]);
});

// Selection follows the arrows because every panel is already in the page: a reader arrowing along
// the strip should land in the content they asked for, not learn that they must press something
// else to actually get there.
test('arrowing selects as it goes, and reports each one', () => {
	const h = harness();
	h.tab('tab-a').focus();

	h.press('ArrowRight');
	h.press('End');
	h.press('ArrowRight');

	assert.deepEqual(h.selected, ['tab-b', 'tab-c', 'tab-a']);
});

test('clicking a tab selects it too', () => {
	const h = harness();

	(h.tab('tab-c') as HTMLButtonElement).click();

	assert.equal(h.tabs.selected(), 'tab-c');
	assert.equal(h.panel('panel-c').hidden, false);
});

// The initial paint must not steal focus: the view decides where somebody lands when it opens.
test('the first paint selects without moving the keyboard', () => {
	const h = harness();

	assert.deepEqual(h.selected, []);
	assert.notEqual(document.activeElement, h.tab('tab-a'));
});

// A count that changes ("Requests, 2 waiting") is the whole reason a label is not fixed markup.
test('a tab can be re-labelled without losing its place', () => {
	const h = harness();
	h.tab('tab-a').focus();
	h.press('ArrowRight');

	h.tabs.setLabel('tab-a', 'A, 2 waiting');

	assert.equal(h.tab('tab-a').textContent, 'A, 2 waiting');
	assert.equal(h.tabs.selected(), 'tab-b');
});
