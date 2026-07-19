import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { RovingToolbarList } from '../src/accessibleList.js';

/**
 * DOM regression tests for the context-menu handling shared by every list that uses
 * RovingToolbarList (players panel, notifications, manage-properties). The bug fixed
 * here: pressing Shift+F10 / the Applications key (or right-clicking) also popped the
 * browser's NATIVE context menu, because preventing the keydown's default does not
 * suppress the separate `contextmenu` event. The list (and the menu it opens) now
 * swallow that event, and a mouse right-click opens our accessible menu instead.
 */

function buildList(): { list: HTMLElement; controller: RovingToolbarList } {
	const list = document.createElement('ul');
	list.setAttribute('role', 'list');
	for (let i = 0; i < 2; i++) {
		const item = document.createElement('li');
		item.className = 'row';
		item.tabIndex = i === 0 ? 0 : -1;
		item.setAttribute('aria-label', `Row ${i}`);
		const toolbar = document.createElement('div');
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.setAttribute('aria-label', `Action ${i}`);
		toolbar.appendChild(btn);
		item.appendChild(toolbar);
		list.appendChild(item);
	}
	document.body.appendChild(list);
	const controller = new RovingToolbarList({
		list,
		itemSelector: '.row',
		toolbarButtonSelector: 'button',
		menuLabel: () => 'Actions',
		menuClass: 'ctx-menu',
		menuItemClass: 'ctx-menu-item',
	});
	return { list, controller };
}

function dispatchContextMenu(target: Element): boolean {
	const ev = new (globalThis as any).window.MouseEvent('contextmenu', { bubbles: true, cancelable: true });
	return target.dispatchEvent(ev);
}

before(() => {
	setupDom();
});

beforeEach(() => {
	document.body.innerHTML = '';
});

test('right-click on a row suppresses the native menu and opens our accessible menu', () => {
	const { list } = buildList();
	const row = list.querySelector('.row') as HTMLElement;

	const notCancelled = dispatchContextMenu(row);

	// dispatchEvent returns false when a listener called preventDefault().
	assert.equal(notCancelled, false, 'native context menu should be prevented');
	const menu = document.querySelector('.ctx-menu');
	assert.ok(menu, 'our accessible menu should be open');
	assert.equal(menu!.getAttribute('role'), 'menu');
});

test('right-click on a toolbar button inside a row also targets that row', () => {
	const { list } = buildList();
	const button = list.querySelector('.row button') as HTMLElement;

	const notCancelled = dispatchContextMenu(button);

	assert.equal(notCancelled, false);
	assert.ok(document.querySelector('.ctx-menu'));
});

test('right-clicking the same row while its menu is open does not stack menus', () => {
	const { list } = buildList();
	const row = list.querySelector('.row') as HTMLElement;

	dispatchContextMenu(row);
	dispatchContextMenu(row);

	assert.equal(document.querySelectorAll('.ctx-menu').length, 1);
});

test('the opened menu swallows its own native contextmenu (keyboard Shift+F10 follow-up)', () => {
	const { controller, list } = buildList();
	const row = list.querySelector('.row') as HTMLElement;
	controller.openContextMenu(row);
	const menu = document.querySelector('.ctx-menu') as HTMLElement;

	const notCancelled = dispatchContextMenu(menu);

	assert.equal(notCancelled, false, 'native menu over our menu should be prevented');
});

test('destroy detaches the contextmenu handler so the native menu is no longer suppressed', () => {
	const { controller, list } = buildList();
	const row = list.querySelector('.row') as HTMLElement;

	controller.destroy();
	const notCancelled = dispatchContextMenu(row);

	assert.equal(notCancelled, true, 'after destroy the list no longer intercepts contextmenu');
	assert.equal(document.querySelector('.ctx-menu'), null);
});
