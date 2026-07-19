import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';
import { actionBar } from '../src/actions/actionBar.js';
import { panelNavigator } from '../src/panelNavigator.js';
import type { ActionDescriptor } from '../src/actions/availableActions.js';

// DOM-bound behaviours of the accessible action toolbar and the F6 panel navigator.
// Screen-reader users rely on: a single ARIA toolbar with a roving tabindex (one tab
// stop), ArrowLeft/Right + Home/End movement, hiding when empty, and the panel
// navigator announcing the region it moved focus to.

before(() => {
	setupDom();
	installFakeI18next('en');
	// The toolbar inserts itself above #board.
	const board = document.createElement('div');
	board.id = 'board';
	document.body.appendChild(board);
});

const ACTIONS: ActionDescriptor[] = [
	{ id: 'payReleaseCost', labelKey: 'game.actions.pay_release_cost', shortcut: 'Control+J' },
	{ id: 'rollDice', labelKey: 'game.actions.roll_dice', shortcut: 'Space' },
	{ id: 'endTurn', labelKey: 'game.actions.end_turn', shortcut: 'Control+E' },
];

let activated: string[];
let announced: string[];

beforeEach(() => {
	activated = [];
	announced = [];
	actionBar.init((id) => activated.push(id), (text) => announced.push(text));
	actionBar.render([]);
});

function buttons(): HTMLButtonElement[] {
	return Array.from(document.querySelectorAll<HTMLButtonElement>('#action-bar .action-bar-button'));
}

function press(el: Element, key: string): boolean {
	const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
	el.dispatchEvent(ev);
	return ev.defaultPrevented;
}

test('toolbar is an ARIA toolbar hidden until it has actions', () => {
	const bar = document.getElementById('action-bar')!;
	assert.equal(bar.tagName, 'DIV', 'toolbar role uses a permitted neutral host');
	assert.equal(bar.getAttribute('role'), 'toolbar');
	assert.equal(bar.getAttribute('aria-label'), 'Available actions');
	assert.equal(bar.hidden, true);

	actionBar.render(ACTIONS);
	assert.equal(bar.hidden, false);
	assert.equal(buttons().length, 3);

	actionBar.render([]);
	assert.equal(bar.hidden, true);
});

test('buttons are localized and expose their keyboard shortcut', () => {
	actionBar.render(ACTIONS);
	const [releaseCost, roll] = buttons();
	assert.equal(releaseCost.textContent, 'Pay release cost');
	assert.equal(releaseCost.getAttribute('aria-keyshortcuts'), 'Control+J');
	assert.equal(roll.textContent, 'Roll dice');
});

test('roving tabindex: exactly one tab stop, arrows move it', () => {
	actionBar.render(ACTIONS);
	const btns = buttons();
	assert.deepEqual(btns.map(b => b.tabIndex), [0, -1, -1]);

	const bar = document.getElementById('action-bar')!;
	assert.equal(press(bar, 'ArrowRight'), true);
	assert.deepEqual(btns.map(b => b.tabIndex), [-1, 0, -1]);

	// Wraps around from the end back to the start.
	press(bar, 'End');
	assert.deepEqual(btns.map(b => b.tabIndex), [-1, -1, 0]);
	press(bar, 'ArrowRight');
	assert.deepEqual(btns.map(b => b.tabIndex), [0, -1, -1]);
	press(bar, 'ArrowLeft');
	assert.deepEqual(btns.map(b => b.tabIndex), [-1, -1, 0]);
	press(bar, 'Home');
	assert.deepEqual(btns.map(b => b.tabIndex), [0, -1, -1]);
});

test('activating a button reports its action id', () => {
	actionBar.render(ACTIONS);
	buttons()[2].click();
	assert.deepEqual(activated, ['endTurn']);
});

test('a disabled action stays focusable, exposes its reason, and speaks it instead of acting', () => {
	actionBar.render([
		{ id: 'rollDice', labelKey: 'game.actions.roll_dice', shortcut: 'Space' },
		{ id: 'endTurn', labelKey: 'game.actions.end_turn', shortcut: 'Control+E', disabledReasonKey: 'game.actions.cannot_end_must_roll' },
	]);
	const btns = buttons();
	const endTurn = btns[1];

	// Marked unavailable WITHOUT the native `disabled` attribute (stays in tab order).
	assert.equal(endTurn.getAttribute('aria-disabled'), 'true');
	assert.equal(endTurn.hasAttribute('disabled'), false);

	// The reason is associated via aria-describedby and rendered as a hint element.
	const hintId = endTurn.getAttribute('aria-describedby');
	assert.ok(hintId);
	const hint = document.getElementById(hintId!);
	assert.ok(hint);
	assert.equal(hint!.textContent, 'You can\'t end your turn yet: you rolled doubles, roll again.');

	// Activating it speaks the reason and does NOT perform the action.
	endTurn.click();
	assert.deepEqual(activated, []);
	assert.deepEqual(announced, ['You can\'t end your turn yet: you rolled doubles, roll again.']);
});

test('a disabled button still participates in the roving tabindex', () => {
	actionBar.render([
		{ id: 'buyProperty', labelKey: 'game.actions.buy_property', disabledReasonKey: 'game.actions.cannot_buy_no_money' },
		{ id: 'endTurn', labelKey: 'game.actions.end_turn' },
	]);
	const btns = buttons();
	assert.deepEqual(btns.map(b => b.tabIndex), [0, -1]);
	const bar = document.getElementById('action-bar')!;
	press(bar, 'ArrowRight');
	assert.deepEqual(btns.map(b => b.tabIndex), [-1, 0]);
});

test('a refresh keeps focus on the same logical action', () => {
	actionBar.render(ACTIONS);
	const bar = document.getElementById('action-bar')!;
	press(bar, 'ArrowRight'); // focus rollDice (index 1)
	buttons()[1].focus();

	// Re-render with pay the release cost gone: rollDice shifts to index 0 but stays focused.
	actionBar.render([
		{ id: 'rollDice', labelKey: 'game.actions.roll_dice' },
		{ id: 'endTurn', labelKey: 'game.actions.end_turn' },
	]);
	const btns = buttons();
	assert.equal(btns[0].dataset.actionId, 'rollDice');
	assert.equal(btns[0].tabIndex, 0);
});

// ── Surgical reconcile: reuse buttons, never re-announce a survivor ───────────────

test('a refresh reuses surviving buttons (same DOM nodes) instead of rebuilding', () => {
	actionBar.render(ACTIONS);
	const before = buttons();
	const roll = before[1];

	// An unrelated state change re-renders the same three actions.
	actionBar.render([
		{ id: 'payReleaseCost', labelKey: 'game.actions.pay_release_cost', shortcut: 'Control+J' },
		{ id: 'rollDice', labelKey: 'game.actions.roll_dice', shortcut: 'Space' },
		{ id: 'endTurn', labelKey: 'game.actions.end_turn', shortcut: 'Control+E' },
	]);
	const after = buttons();
	// The very same node instances are reused (nothing torn down → no focus churn).
	assert.equal(after[0], before[0]);
	assert.equal(after[1], roll);
	assert.equal(after[2], before[2]);
});

test('a refresh does NOT move focus off a surviving focused button', () => {
	actionBar.render(ACTIONS);
	const roll = buttons()[1];
	roll.focus();
	assert.equal(document.activeElement, roll);

	// Re-render the same actions: focus must stay on the identical node, untouched.
	actionBar.render(ACTIONS);
	assert.equal(document.activeElement, roll);
	assert.equal(roll.tabIndex, 0);
});

test('a focused button that disappears hands focus back to the toolbar', () => {
	actionBar.render(ACTIONS);
	const releaseCost = buttons()[0];
	releaseCost.focus();
	assert.equal(document.activeElement, releaseCost);

	// Pay the release cost is gone; focus should land on the first remaining action, not <body>.
	actionBar.render([
		{ id: 'rollDice', labelKey: 'game.actions.roll_dice' },
		{ id: 'endTurn', labelKey: 'game.actions.end_turn' },
	]);
	const btns = buttons();
	assert.ok(!releaseCost.isConnected);
	assert.equal(document.activeElement, btns[0]);
	assert.equal(btns[0].dataset.actionId, 'rollDice');
});

test('toggling an action between enabled and disabled mutates the same button in place', () => {
	actionBar.render([
		{ id: 'endTurn', labelKey: 'game.actions.end_turn', shortcut: 'Control+E' },
	]);
	const btn = buttons()[0];
	assert.equal(btn.getAttribute('aria-disabled'), null);

	// Becomes disabled: same node gains aria-disabled + a hint, without being recreated.
	actionBar.render([
		{ id: 'endTurn', labelKey: 'game.actions.end_turn', shortcut: 'Control+E', disabledReasonKey: 'game.actions.cannot_end_must_roll' },
	]);
	assert.equal(buttons()[0], btn);
	assert.equal(btn.getAttribute('aria-disabled'), 'true');
	const hintId = btn.getAttribute('aria-describedby');
	assert.ok(hintId && document.getElementById(hintId));

	// Becomes enabled again: same node loses aria-disabled and its hint is removed.
	actionBar.render([
		{ id: 'endTurn', labelKey: 'game.actions.end_turn', shortcut: 'Control+E' },
	]);
	assert.equal(buttons()[0], btn);
	assert.equal(btn.getAttribute('aria-disabled'), null);
	assert.equal(btn.getAttribute('aria-describedby'), null);
	assert.equal(document.getElementById(hintId!), null);
});

test('focus() returns false when the toolbar is empty, true when it has actions', () => {
	actionBar.render([]);
	assert.equal(actionBar.focus(), false);
	actionBar.render(ACTIONS);
	assert.equal(actionBar.focus(), true);
	assert.equal(actionBar.hasActions, true);
});

test('panel navigator announces the region it focuses and cycles with next/prev', () => {
	panelNavigator.reset();
	const announced: string[] = [];
	panelNavigator.init((key) => announced.push(key));

	const board = document.getElementById('board')!;
	board.tabIndex = -1;
	const players = document.createElement('div');
	players.id = 'players';
	players.tabIndex = -1;
	document.body.appendChild(players);

	panelNavigator.register({ id: 'board', labelKey: 'game.panels.board', getElement: () => board, focus: () => { board.focus(); return true; } });
	panelNavigator.register({ id: 'players', labelKey: 'game.panels.players', getElement: () => players, focus: () => { players.focus(); return true; } });

	assert.equal(panelNavigator.next(), true);
	assert.equal(document.activeElement, board);
	assert.equal(announced.at(-1), 'game.panels.board');

	assert.equal(panelNavigator.next(), true);
	assert.equal(document.activeElement, players);
	assert.equal(announced.at(-1), 'game.panels.players');

	assert.equal(panelNavigator.prev(), true);
	assert.equal(document.activeElement, board);
});

test('panel navigator skips unavailable regions and focuses by id', () => {
	panelNavigator.reset();
	panelNavigator.init(() => {});

	const board = document.getElementById('board')!;
	board.tabIndex = -1;
	const actions = document.getElementById('action-bar')!;

	let actionsAvailable = false;
	panelNavigator.register({ id: 'board', labelKey: 'game.panels.board', getElement: () => board, focus: () => { board.focus(); return true; } });
	panelNavigator.register({
		id: 'actions', labelKey: 'game.panels.actions', getElement: () => actions,
		focus: () => { (actions.querySelector('button') as HTMLButtonElement | null)?.focus(); return true; },
		isAvailable: () => actionsAvailable,
	});

	// Unavailable: focusById fails.
	assert.equal(panelNavigator.focusById('actions'), false);

	// Available with a button: focusById moves focus into it.
	actionsAvailable = true;
	actionBar.render(ACTIONS);
	assert.equal(panelNavigator.focusById('actions'), true);
	assert.equal(document.activeElement, buttons()[0]);
});
