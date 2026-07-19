import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { reconcileToolbarButtons, type ToolbarAction } from '../src/toolbarButtons.js';

// Unit tests for the shared accessible toolbar-button builder used by both the players
// panel (data-action) and the manage-properties dialog (data-focus-id). It wraps the
// keyed reconciler with the button shape both surfaces need: a text button per action,
// each a roving-tabindex stop keyed by a configurable dataset attribute, reused across
// refreshes so the focused button survives and a removed focused button rescues focus.

before(() => {
	setupDom();
});

let toolbar: HTMLElement;

beforeEach(() => {
	document.body.innerHTML = '';
	toolbar = document.createElement('div');
	toolbar.setAttribute('role', 'toolbar');
	document.body.appendChild(toolbar);
});

function action(key: string, label: string, onClick: () => void = () => {}): ToolbarAction {
	return { key, label, onClick };
}

test('creates a button per action with the configured class and dataset key', () => {
	reconcileToolbarButtons(toolbar, [action('info', 'Info'), action('goto', 'Go to')], {
		buttonClass: 'player-card__btn',
		keyAttr: 'action',
	});

	const btns = Array.from(toolbar.querySelectorAll('button'));
	assert.equal(btns.length, 2);
	assert.equal(btns[0].dataset.action, 'info');
	assert.equal(btns[0].textContent, 'Info');
	assert.equal(btns[0].className, 'player-card__btn');
	assert.equal(btns[0].type, 'button');
	assert.equal(btns[0].tabIndex, -1);
	assert.equal(btns[1].dataset.action, 'goto');
});

test('honours keyAttr so manage buttons keep data-focus-id', () => {
	reconcileToolbarButtons(toolbar, [action('build-3', 'Build'), action('mortgage-3', 'Mortgage')], {
		buttonClass: 'manage-item__btn',
		keyAttr: 'focusId',
	});

	const btns = Array.from(toolbar.querySelectorAll('button'));
	assert.equal(btns[0].dataset.focusId, 'build-3');
	assert.equal(btns[1].dataset.focusId, 'mortgage-3');
	assert.equal(btns[0].className, 'manage-item__btn');
});

test('clicking a button invokes its handler', () => {
	let clicked = '';
	reconcileToolbarButtons(toolbar, [action('info', 'Info', () => { clicked = 'info'; })], {
		buttonClass: 'player-card__btn',
		keyAttr: 'action',
	});

	(toolbar.querySelector('button') as HTMLButtonElement).click();
	assert.equal(clicked, 'info');
});

test('labelAsAriaLabel mirrors the label into aria-label when set', () => {
	reconcileToolbarButtons(toolbar, [action('info', 'Info')], {
		buttonClass: 'player-card__btn',
		keyAttr: 'action',
		labelAsAriaLabel: true,
	});
	assert.equal(toolbar.querySelector('button')!.getAttribute('aria-label'), 'Info');

	// Without the flag, no aria-label is set (a plain text button is self-describing).
	document.body.innerHTML = '';
	const bare = document.createElement('div');
	document.body.appendChild(bare);
	reconcileToolbarButtons(bare, [action('build-1', 'Build')], {
		buttonClass: 'manage-item__btn',
		keyAttr: 'focusId',
	});
	assert.equal(bare.querySelector('button')!.hasAttribute('aria-label'), false);
});

test('reuses the same button node across refreshes and updates only the label', () => {
	reconcileToolbarButtons(toolbar, [action('build-1', 'Build (50€)')], {
		buttonClass: 'manage-item__btn',
		keyAttr: 'focusId',
	});
	const first = toolbar.querySelector('button')!;

	reconcileToolbarButtons(toolbar, [action('build-1', 'Build (100€)')], {
		buttonClass: 'manage-item__btn',
		keyAttr: 'focusId',
	});
	const second = toolbar.querySelector('button')!;

	assert.equal(second, first, 'the surviving button keeps node identity');
	assert.equal(second.textContent, 'Build (100€)');
});

test('rebinds onClick on reuse so a button always targets its row current data', () => {
	let target = '';
	reconcileToolbarButtons(toolbar, [action('info', 'Info', () => { target = 'old'; })], {
		buttonClass: 'player-card__btn',
		keyAttr: 'action',
	});
	reconcileToolbarButtons(toolbar, [action('info', 'Info', () => { target = 'new'; })], {
		buttonClass: 'player-card__btn',
		keyAttr: 'action',
	});

	(toolbar.querySelector('button') as HTMLButtonElement).click();
	assert.equal(target, 'new', 'the latest handler fires, not the stale one');
});

test('does not disturb the focused button while its action survives', () => {
	reconcileToolbarButtons(toolbar, [action('info', 'Info'), action('goto', 'Go to')], {
		buttonClass: 'player-card__btn',
		keyAttr: 'action',
	});
	const info = toolbar.querySelector('[data-action="info"]') as HTMLButtonElement;
	info.focus();
	assert.equal(document.activeElement, info);

	reconcileToolbarButtons(toolbar, [action('info', 'Info'), action('goto', 'Travel')], {
		buttonClass: 'player-card__btn',
		keyAttr: 'action',
	});
	assert.equal(document.activeElement, info, 'focus stays on the same node');
});

test('rescues focus when the focused button is removed', () => {
	const row = document.createElement('li');
	row.tabIndex = -1;
	document.body.appendChild(row);
	row.appendChild(toolbar);

	reconcileToolbarButtons(toolbar, [action('info', 'Info'), action('trade', 'Trade')], {
		buttonClass: 'player-card__btn',
		keyAttr: 'action',
		rescueFocus: () => row,
	});
	const trade = toolbar.querySelector('[data-action="trade"]') as HTMLButtonElement;
	trade.focus();

	// "trade" disappears (e.g. off-turn): focus must land on the owning row, not <body>.
	reconcileToolbarButtons(toolbar, [action('info', 'Info')], {
		buttonClass: 'player-card__btn',
		keyAttr: 'action',
		rescueFocus: () => row,
	});
	assert.equal(document.activeElement, row);
});
