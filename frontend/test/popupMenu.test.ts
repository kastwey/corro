import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { popupMenu, nextMenuIndex, typeaheadMatch, type PopupMenuItem } from '../src/popupMenu.js';

/**
 * Tests for the reusable ARIA menu popup (popupMenu.ts) used by the board square context
 * menu. Pure keyboard/typeahead logic is covered without a DOM; the rest exercises the live
 * role="menu" / role="menuitem" structure, roving tabindex, focus, and the aria-disabled
 * "voice the reason" rule in jsdom.
 */

before(() => {
	setupDom();
});

// === Pure keyboard mapping ===

test('nextMenuIndex moves with arrows and wraps around', () => {
	assert.equal(nextMenuIndex('ArrowDown', 0, 3), 1);
	assert.equal(nextMenuIndex('ArrowDown', 2, 3), 0); // wrap to first
	assert.equal(nextMenuIndex('ArrowUp', 0, 3), 2);   // wrap to last
	assert.equal(nextMenuIndex('ArrowUp', 2, 3), 1);
});

test('nextMenuIndex jumps to first/last and maps activate/close keys', () => {
	assert.equal(nextMenuIndex('Home', 2, 3), 0);
	assert.equal(nextMenuIndex('End', 0, 3), 2);
	assert.equal(nextMenuIndex('Enter', 1, 3), 'activate');
	assert.equal(nextMenuIndex(' ', 1, 3), 'activate');
	assert.equal(nextMenuIndex('Escape', 1, 3), 'close');
	assert.equal(nextMenuIndex('Tab', 1, 3), 'close');
	assert.equal(nextMenuIndex('x', 1, 3), null);
});

test('nextMenuIndex with no items still closes on Escape/Tab', () => {
	assert.equal(nextMenuIndex('Escape', 0, 0), 'close');
	assert.equal(nextMenuIndex('Tab', 0, 0), 'close');
	assert.equal(nextMenuIndex('ArrowDown', 0, 0), null);
});

// === Pure typeahead ===

test('typeaheadMatch finds the next item starting with the character, wrapping', () => {
	const labels = ['Build house', 'Mortgage', 'Sell house', 'Buy'];
	assert.equal(typeaheadMatch(labels, 'm', 0)?.index, 1);
	assert.equal(typeaheadMatch(labels, 's', 0)?.index, 2);
	// From "Sell" (idx 2), 'b' wraps forward to "Buy" (idx 3), not back to "Build".
	assert.equal(typeaheadMatch(labels, 'b', 2)?.index, 3);
	// From "Buy" (idx 3), 'b' wraps around to "Build" (idx 0).
	assert.equal(typeaheadMatch(labels, 'b', 3)?.index, 0);
});

test('typeaheadMatch is case-insensitive and ignores non-character keys', () => {
	const labels = ['Alpha', 'beta'];
	assert.equal(typeaheadMatch(labels, 'B', 0)?.index, 1);
	assert.equal(typeaheadMatch(labels, 'z', 0), null);
	assert.equal(typeaheadMatch(labels, ' ', 0), null);
	assert.equal(typeaheadMatch(labels, 'Enter', 0), null);
});

test('typeaheadMatch flags a sole match as unique, and a shared first letter as not', () => {
	const labels = ['Build house', 'Mortgage', 'Sell house', 'Buy'];
	// 'm' → only "Mortgage" → unique.
	assert.deepEqual(typeaheadMatch(labels, 'm', 0), { index: 1, unique: true });
	// 'b' → "Build" and "Buy" → two matches → not unique, cycles forward.
	assert.deepEqual(typeaheadMatch(labels, 'b', 0), { index: 3, unique: false });
	assert.deepEqual(typeaheadMatch(labels, 'b', 3), { index: 0, unique: false });
});

// === DOM behaviour ===

function press(key: string): void {
	const el = document.activeElement as HTMLElement;
	el.dispatchEvent(new (globalThis as any).window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
	if (popupMenu.isOpen()) popupMenu.close();
	document.body.innerHTML = '';
});

function openSimpleMenu(extra: Partial<{ onSelect0: () => void; spoken: string[] }> = {}) {
	const spoken = extra.spoken ?? [];
	const items: PopupMenuItem[] = [
		{ label: 'Info', onSelect: extra.onSelect0 ?? (() => {}) },
		{ label: 'Build for 50', onSelect: () => {} },
		{ label: 'Mortgage', disabled: true, reason: 'Not enough money, missing 120', onSelect: () => { throw new Error('disabled item must not run'); } },
	];
	popupMenu.open({ ariaLabel: 'Actions for Old Kent Road', items, announce: (t) => spoken.push(t), openAnnouncement: 'Old Kent Road' });
	return { items, spoken };
}

test('open renders a role=menu with menuitems, roving tabindex, and focuses the first item', () => {
	openSimpleMenu();
	const menu = document.querySelector('[role="menu"]') as HTMLElement;
	assert.ok(menu);
	assert.equal(menu.getAttribute('aria-label'), 'Actions for Old Kent Road');
	const items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
	assert.equal(items.length, 3);
	assert.equal((items[0] as HTMLElement).tabIndex, 0);
	assert.equal((items[1] as HTMLElement).tabIndex, -1);
	assert.equal(document.activeElement, items[0]);
});

test('the popup is hosted inside the page landmark instead of orphaned under body', () => {
	document.body.innerHTML = '<main><button id="square">Square</button></main>';
	const anchor = document.getElementById('square')!;
	popupMenu.open({
		ariaLabel: 'Square actions',
		anchor,
		items: [{ label: 'Inspect', onSelect: () => {} }],
	});

	assert.equal(document.querySelector('.popup-menu')?.parentElement?.tagName, 'MAIN');
});

test('the open announcement is spoken', () => {
	const { spoken } = openSimpleMenu();
	assert.ok(spoken.includes('Old Kent Road'));
});

test('ArrowDown moves focus and the roving tabindex to the next item', () => {
	openSimpleMenu();
	const items = Array.from(document.querySelectorAll('[role="menuitem"]')) as HTMLElement[];
	press('ArrowDown');
	assert.equal(document.activeElement, items[1]);
	assert.equal(items[1].tabIndex, 0);
	assert.equal(items[0].tabIndex, -1);
});

test('Enter on an enabled item runs its handler and closes the menu', () => {
	let ran = false;
	openSimpleMenu({ onSelect0: () => { ran = true; } });
	press('Enter');
	assert.ok(ran);
	assert.equal(popupMenu.isOpen(), false);
	assert.equal(document.querySelector('[role="menu"]'), null);
});

test('Escape closes the menu and restores focus via onClose', () => {
	const anchor = document.createElement('button');
	document.body.appendChild(anchor);
	let closed = false;
	popupMenu.open({
		ariaLabel: 'Actions',
		items: [{ label: 'One', onSelect: () => {} }],
		anchor,
		onClose: () => { closed = true; anchor.focus(); },
	});
	assert.equal(anchor.getAttribute('aria-expanded'), 'true');
	press('Escape');
	assert.equal(popupMenu.isOpen(), false);
	assert.ok(closed);
	assert.equal(anchor.getAttribute('aria-expanded'), 'false');
	assert.equal(document.activeElement, anchor);
});

// Live-play ("pulsé Tab y desapareció"): closing the menu without choosing silently
// ABORTS a pending multi-step play — onCancel lets the opener say so. A real selection
// must never fire it.
test('closing without a selection fires onCancel; selecting does not', () => {
	let cancelled = 0;
	popupMenu.open({
		ariaLabel: 'Pick',
		items: [{ label: 'One', onSelect: () => {} }],
		onCancel: () => { cancelled++; },
	});
	press('Escape');
	assert.equal(cancelled, 1, 'Escape without choosing cancels');

	popupMenu.open({
		ariaLabel: 'Pick',
		items: [{ label: 'One', onSelect: () => {} }],
		onCancel: () => { cancelled++; },
	});
	press('Enter');
	assert.equal(cancelled, 1, 'a selection is not a cancellation');
	assert.equal(popupMenu.isOpen(), false);
});

test('Tab closes without choosing and also fires onCancel', () => {
	let cancelled = false;
	popupMenu.open({
		ariaLabel: 'Pick',
		items: [{ label: 'One', onSelect: () => {} }],
		onCancel: () => { cancelled = true; },
	});
	press('Tab');
	assert.equal(popupMenu.isOpen(), false);
	assert.ok(cancelled);
});

test('a disabled item is aria-disabled with a describing hint and voices the reason instead of acting', () => {
	const { spoken } = openSimpleMenu();
	const disabled = document.querySelectorAll('[role="menuitem"]')[2] as HTMLElement;
	assert.equal(disabled.getAttribute('aria-disabled'), 'true');
	const hintId = disabled.getAttribute('aria-describedby')!;
	assert.equal(document.getElementById(hintId)?.textContent, 'Not enough money, missing 120');
	// Activating it must NOT throw (its onSelect would), must keep the menu open, and must speak the reason.
	disabled.click();
	assert.equal(popupMenu.isOpen(), true);
	assert.ok(spoken.includes('Not enough money, missing 120'));
});

test('typing a letter with several matches cycles focus instead of activating', () => {
	const items: PopupMenuItem[] = [
		{ label: 'Build for 50', onSelect: () => {} },
		{ label: 'Buy', onSelect: () => {} },
		{ label: 'Mortgage', onSelect: () => {} },
	];
	popupMenu.open({ ariaLabel: 'Actions', items });
	const menuItems = Array.from(document.querySelectorAll('[role="menuitem"]')) as HTMLElement[];
	// Opens focused on item 0 ("Build"). 'b' matches items 0 and 1, so it cycles to the
	// NEXT match after the current position: item 1 ("Buy"). Menu stays open.
	press('b');
	assert.equal(popupMenu.isOpen(), true);
	assert.equal(document.activeElement, menuItems[1]);
	press('b'); // cycles forward again, wrapping back to item 0 ("Build")
	assert.equal(document.activeElement, menuItems[0]);
});

test('typing a letter with a SINGLE match activates it and closes the menu', () => {
	let ran = false;
	const items: PopupMenuItem[] = [
		{ label: 'Build for 50', onSelect: () => {} },
		{ label: 'Mortgage', onSelect: () => { ran = true; } },
	];
	popupMenu.open({ ariaLabel: 'Actions', items });
	press('m'); // only "Mortgage" starts with 'm' → activate outright
	assert.ok(ran, 'the sole match runs without a second Enter press');
	assert.equal(popupMenu.isOpen(), false);
});

test('typing a letter matching a single DISABLED item voices its reason without closing', () => {
	const spoken: string[] = [];
	const items: PopupMenuItem[] = [
		{ label: 'Build for 50', onSelect: () => {} },
		{ label: 'Mortgage', disabled: true, reason: 'Not enough money', onSelect: () => { throw new Error('must not run'); } },
	];
	popupMenu.open({ ariaLabel: 'Actions', items, announce: (t) => spoken.push(t) });
	const menuItems = Array.from(document.querySelectorAll('[role="menuitem"]')) as HTMLElement[];
	press('m'); // sole match but disabled → focus + voice reason, stay open
	assert.equal(popupMenu.isOpen(), true);
	assert.equal(document.activeElement, menuItems[1]);
	assert.ok(spoken.includes('Not enough money'));
});

test('a pointerdown outside the open menu closes it', async () => {
	openSimpleMenu();
	await flush(); // the outside-click listener is armed on the next tick
	document.body.dispatchEvent(new (globalThis as any).window.MouseEvent('pointerdown', { bubbles: true }));
	assert.equal(popupMenu.isOpen(), false);
});
