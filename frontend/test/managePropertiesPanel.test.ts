import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';
import { managePropertiesDialog, type ManageablePropertyItem } from '../src/managePropertiesDialog.js';

/**
 * DOM regression tests for the accessible "manage properties" dialog. It reuses the
 * same roving-tabindex / toolbar / context-menu model as the notifications panel
 * (RovingToolbarList), so we assert the shared keyboard behaviour end-to-end here:
 *  - each property is a single focusable row whose aria-label reads its name + state;
 *  - the per-row action buttons live in a toolbar reached with Right arrow (Left/Esc out);
 *  - Up/Down move between rows; Shift+F10 opens a context menu mirroring the actions;
 *  - Escape inside the toolbar backs out WITHOUT closing the dialog, while Escape on a
 *    row fires the modal's `cancel` and closes it.
 */

function dispatchKey(target: Element, key: string, init: KeyboardEventInit = {}): Element {
	target.dispatchEvent(new (globalThis as any).window.KeyboardEvent('keydown', { key, bubbles: true, ...init }));
	return document.activeElement as Element;
}

let calls: { build: number[]; sell: number[]; mortgage: number[]; unmortgage: number[]; closed: number };

const PROPERTIES: ManageablePropertyItem[] = [
	// A buildable property with no houses → build + mortgage actions.
	{ index: 1, name: 'Old Kent Road', smallBuildings: 0, bigBuildings: 0, mortgaged: false, housePrice: 50, mortgageValue: 30, price: 60, canBuild: true },
	// A mortgaged property → a single unmortgage action.
	{ index: 3, name: 'Whitechapel Road', smallBuildings: 0, bigBuildings: 0, mortgaged: true, housePrice: 50, mortgageValue: 30, price: 60, canBuild: false },
];

function openDialog(properties: ManageablePropertyItem[] = PROPERTIES): void {
	managePropertiesDialog.open({
		getProperties: () => properties,
		onBuild: (i) => calls.build.push(i),
		onSell: (i) => calls.sell.push(i),
		onMortgage: (i) => calls.mortgage.push(i),
		onUnmortgage: (i) => calls.unmortgage.push(i),
		onClose: () => { calls.closed++; },
	});
}

before(() => {
	setupDom();
	installFakeI18next('en');
});

beforeEach(() => {
	// Close any dialog left open by a prior test BEFORE resetting the call log, so its
	// onClose (which closes over the `calls` variable) cannot pollute the fresh counters.
	if (managePropertiesDialog.isOpen()) managePropertiesDialog.close();
	calls = { build: [], sell: [], mortgage: [], unmortgage: [], closed: 0 };
});

test('the native modal dialog contains a named application surface', () => {
	openDialog();
	const dialog = document.querySelector('dialog.manage-dialog') as HTMLDialogElement;
	assert.ok(dialog, 'renders a native <dialog> element');
	assert.equal(dialog.tagName, 'DIALOG');
	assert.equal(dialog.open, true, 'opened via showModal()');
	// Operated in focus mode (roving-tabindex list + per-row toolbars): an application surface
	// so the reader keeps its virtual cursor off and arrow keys drive the list navigation.
	assert.equal(dialog.getAttribute('role'), null);
	const application = dialog.querySelector('.manage-panel')!;
	assert.equal(application.getAttribute('role'), 'application');
	assert.equal(application.getAttribute('aria-labelledby'), 'manage-title');
	assert.equal(dialog.querySelector('.manage-panel__header')?.tagName, 'DIV', 'no nested banner landmark');
	// It must NOT carry the legacy div-dialog aria-modal — the native element provides modality.
	assert.equal(dialog.getAttribute('aria-modal'), null);
	assert.equal(dialog.getAttribute('aria-labelledby'), 'manage-title');
});

test('each property is a focusable row whose aria-label reads name + state', () => {
	openDialog();
	const rows = Array.from(document.querySelectorAll('.manage-item')) as HTMLElement[];
	assert.equal(rows.length, 2);

	// The list names itself "My properties" (not the dialog title) so a screen reader
	// doesn't read "Manage properties" twice (dialog title + list label).
	assert.equal(document.querySelector('.manage-list')!.getAttribute('aria-label'), 'My properties');

	assert.equal(rows[0].getAttribute('role'), 'listitem');
	assert.equal(rows[0].getAttribute('aria-label'), 'Old Kent Road. sale price 60 euros');
	// The visible name is hidden from the screen reader to avoid a double read.
	assert.equal(rows[0].querySelector('.manage-item__name')!.getAttribute('aria-hidden'), 'true');

	// The mortgaged row surfaces its state in the accessible name.
	assert.equal(rows[1].getAttribute('aria-label'), 'Whitechapel Road. sale price 60 euros. mortgaged');

	// The actions live in a per-property labelled toolbar; its buttons are managed
	// (tabindex -1). The label names the property so a screen reader knows which one.
	const toolbar = rows[0].querySelector('.manage-item__actions')!;
	assert.equal(toolbar.getAttribute('role'), 'toolbar');
	assert.equal(toolbar.getAttribute('aria-label'), 'Actions for Old Kent Road');
	assert.equal((toolbar.querySelector('button') as HTMLElement).tabIndex, -1);
});

test('the row reads the colour group alongside the name and state (bug 14)', () => {
	openDialog([
		{ index: 1, name: 'Old Kent Road', color: 'brown', smallBuildings: 2, bigBuildings: 0, mortgaged: false, housePrice: 50, mortgageValue: 30, price: 60, canBuild: true },
		{ index: 5, name: 'Kings Cross Station', smallBuildings: 0, bigBuildings: 0, mortgaged: false, housePrice: 0, mortgageValue: 100, price: 200, canBuild: false },
	]);
	const rows = Array.from(document.querySelectorAll('.manage-item')) as HTMLElement[];

	// Colour comes right after the name, then the sale price, then the building/mortgage state.
	assert.equal(rows[0].getAttribute('aria-label'), 'Old Kent Road. Brown. sale price 60 euros. 2 buildings');
	assert.match(rows[0].querySelector('.manage-item__name')!.textContent!, /Brown/);

	// A colourless square (railroad) reads no colour clause, but still reads its sale price.
	assert.equal(rows[1].getAttribute('aria-label'), 'Kings Cross Station. sale price 200 euros');
});

test('the row reads the sale price so a player can gauge its trade value', () => {
	openDialog([
		{ index: 1, name: 'Old Kent Road', color: 'brown', smallBuildings: 0, bigBuildings: 0, mortgaged: false, housePrice: 50, mortgageValue: 30, price: 60, canBuild: true },
	]);
	const row = document.querySelector('.manage-item') as HTMLElement;
	assert.match(row.getAttribute('aria-label') ?? '', /sale price 60 euros/);
	assert.match(row.querySelector('.manage-item__name')!.textContent ?? '', /sale price 60 euros/);
});

test('opening focuses the first row (roving tab stop)', () => {
	openDialog();
	const first = document.querySelector('.manage-item') as HTMLElement;
	assert.equal(document.activeElement, first);
	assert.equal(first.tabIndex, 0);
});

test('Up/Down arrows move focus between rows', () => {
	openDialog();
	const rows = Array.from(document.querySelectorAll('.manage-item')) as HTMLElement[];
	assert.equal(document.activeElement, rows[0]);

	assert.equal(dispatchKey(rows[0], 'ArrowDown'), rows[1]);
	assert.equal(dispatchKey(rows[1], 'ArrowUp'), rows[0]);
});

test('Right arrow enters the toolbar, Left arrow returns to the row', () => {
	openDialog();
	const row = document.querySelector('.manage-item') as HTMLElement;
	const firstBtn = row.querySelector('.manage-item__actions button') as HTMLElement;

	assert.equal(dispatchKey(row, 'ArrowRight'), firstBtn);
	assert.equal(dispatchKey(firstBtn, 'ArrowLeft'), row);
});

test('Escape inside the toolbar backs out without closing the dialog', () => {
	openDialog();
	const row = document.querySelector('.manage-item') as HTMLElement;
	const firstBtn = dispatchKey(row, 'ArrowRight') as HTMLElement;

	// Escape on a toolbar button returns to its row and keeps the dialog open.
	assert.equal(dispatchKey(firstBtn, 'Escape'), row);
	assert.ok(managePropertiesDialog.isOpen());
	assert.equal(calls.closed, 0);
});

test('the modal cancel (Escape on a row) closes the dialog', () => {
	openDialog();
	const dialog = document.querySelector('dialog.manage-dialog') as HTMLDialogElement;
	// Escape on a modal <dialog> fires `cancel`; our handler owns the teardown.
	const cancel = new (globalThis as any).window.Event('cancel', { cancelable: true });
	dialog.dispatchEvent(cancel);
	assert.equal(cancel.defaultPrevented, true, 'we preventDefault to run our own close()');
	assert.equal(managePropertiesDialog.isOpen(), false);
	assert.equal(calls.closed, 1);
});

test('Shift+F10 opens a context menu mirroring the row actions', () => {
	openDialog();
	const row = document.querySelector('.manage-item') as HTMLElement;
	dispatchKey(row, 'F10', { shiftKey: true });

	const menu = document.querySelector('.manage-context-menu')!;
	assert.ok(menu, 'context menu should be present');
	const items = menu.querySelectorAll('.manage-context-menu-item');
	// The buildable row offers two actions (build + mortgage).
	assert.equal(items.length, 2);
});

test('the context menu is hosted INSIDE the modal dialog, not on inert <body> (bug #12)', () => {
	// Under showModal() everything outside the dialog is inert; a menu left on <body> would be
	// unreachable/unreadable. It must be appended within the dialog so it stays interactive.
	openDialog();
	const dialog = document.querySelector('dialog.manage-dialog') as HTMLElement;
	const row = document.querySelector('.manage-item') as HTMLElement;
	dispatchKey(row, 'F10', { shiftKey: true });

	const menu = document.querySelector('.manage-context-menu') as HTMLElement;
	assert.ok(dialog.contains(menu), 'menu must live inside the dialog, not on <body>');
});

test('a mouse right-click on a row also opens the context menu inside the dialog (bug #12)', () => {
	openDialog();
	const dialog = document.querySelector('dialog.manage-dialog') as HTMLElement;
	const row = document.querySelector('.manage-item') as HTMLElement;
	row.dispatchEvent(new (globalThis as any).window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

	const menu = document.querySelector('.manage-context-menu') as HTMLElement;
	assert.ok(menu, 'right-click opens the accessible menu');
	assert.ok(dialog.contains(menu), 'menu must live inside the dialog');
});

test('activating an action invokes the matching dependency', () => {
	openDialog();
	const row = document.querySelector('.manage-item') as HTMLElement;
	const mortgageBtn = Array.from(row.querySelectorAll('.manage-item__actions button'))
		.find((b) => (b as HTMLElement).dataset.focusId === 'mortgage-1') as HTMLButtonElement;
	mortgageBtn.click();
	assert.deepEqual(calls.mortgage, [1]);
});

/**
 * Surgical refresh regression tests (bugs 1 & 2). A server-confirmed build / sell /
 * mortgage triggers `refresh()`, which must reconcile the list IN PLACE: the modal,
 * its rows and their buttons survive so a screen reader is not thrown back to the top
 * of the dialog and keyboard focus is never lost to <body> (which drops JAWS into
 * browse mode). Earlier the dialog tore itself down and rebuilt on every update.
 */
function openMutableDialog(initial: ManageablePropertyItem[]): { set: (next: ManageablePropertyItem[]) => void } {
	let current = initial;
	managePropertiesDialog.open({
		getProperties: () => current,
		onBuild: (i) => calls.build.push(i),
		onSell: (i) => calls.sell.push(i),
		onMortgage: (i) => calls.mortgage.push(i),
		onUnmortgage: (i) => calls.unmortgage.push(i),
		onClose: () => { calls.closed++; },
	});
	return { set: (next) => { current = next; } };
}

test('refresh() updates the list in place without recreating the <dialog>', () => {
	openMutableDialog([
		{ index: 1, name: 'Old Kent Road', color: 'brown', smallBuildings: 0, bigBuildings: 0, mortgaged: false, housePrice: 50, mortgageValue: 30, price: 60, canBuild: true },
	]);
	const dialogBefore = document.querySelector('dialog.manage-dialog');
	const rowBefore = document.querySelector('.manage-item');

	managePropertiesDialog.refresh();

	// The very same DOM nodes survive a refresh — nothing was torn down and rebuilt.
	assert.strictEqual(document.querySelector('dialog.manage-dialog'), dialogBefore);
	assert.strictEqual(document.querySelector('.manage-item'), rowBefore);
});

test('refresh() keeps focus on a surviving toolbar button', () => {
	const ctl = openMutableDialog([
		{ index: 1, name: 'Old Kent Road', color: 'brown', smallBuildings: 0, bigBuildings: 0, mortgaged: false, housePrice: 50, mortgageValue: 30, price: 60, canBuild: true },
		{ index: 3, name: 'Whitechapel Road', color: 'brown', smallBuildings: 0, bigBuildings: 0, mortgaged: false, housePrice: 50, mortgageValue: 30, price: 60, canBuild: true },
	]);
	// Focus the build button on the FIRST row.
	const row = document.querySelector('.manage-item') as HTMLElement;
	const buildBtn = dispatchKey(row, 'ArrowRight') as HTMLElement;
	assert.equal(buildBtn.dataset.focusId, 'build-1');

	// A no-op refresh (same data) must leave focus exactly where it was.
	ctl.set([
		{ index: 1, name: 'Old Kent Road', color: 'brown', smallBuildings: 0, bigBuildings: 0, mortgaged: false, housePrice: 50, mortgageValue: 30, price: 60, canBuild: true },
		{ index: 3, name: 'Whitechapel Road', color: 'brown', smallBuildings: 0, bigBuildings: 0, mortgaged: false, housePrice: 50, mortgageValue: 30, price: 60, canBuild: true },
	]);
	managePropertiesDialog.refresh();
	assert.strictEqual(document.activeElement, buildBtn, 'the surviving button keeps focus');
	assert.ok(buildBtn.isConnected);
});

test('refresh() lands focus on the owning row when the focused button disappears', () => {
	const ctl = openMutableDialog([
		{ index: 1, name: 'Old Kent Road', color: 'brown', smallBuildings: 0, bigBuildings: 0, mortgaged: false, housePrice: 50, mortgageValue: 30, price: 60, canBuild: true },
	]);
	const row = document.querySelector('.manage-item') as HTMLElement;
	// Enter the toolbar and focus the "mortgage" button, then mortgage the property so
	// that action is replaced by "unmortgage" (a different focus id → the button is gone).
	dispatchKey(row, 'ArrowRight');
	const mortgageBtn = Array.from(row.querySelectorAll('.manage-item__actions button'))
		.find((b) => (b as HTMLElement).dataset.focusId === 'mortgage-1') as HTMLButtonElement;
	mortgageBtn.focus();
	assert.strictEqual(document.activeElement, mortgageBtn);

	ctl.set([
		{ index: 1, name: 'Old Kent Road', color: 'brown', smallBuildings: 0, bigBuildings: 0, mortgaged: true, housePrice: 50, mortgageValue: 30, price: 60, canBuild: true },
	]);
	managePropertiesDialog.refresh();

	// The mortgage button is gone; focus must fall back to its owning row, never <body>.
	assert.equal(mortgageBtn.isConnected, false);
	assert.strictEqual(document.activeElement, row, 'focus returns to the owning row');
	assert.notEqual(document.activeElement, document.body);
	// The row now offers a single unmortgage action (state reconciled in place).
	const ids = Array.from(row.querySelectorAll('.manage-item__actions button'))
		.map((b) => (b as HTMLElement).dataset.focusId);
	assert.deepEqual(ids, ['unmortgage-1']);
});

test('refresh() re-labels a row in place when its state changes', () => {
	const ctl = openMutableDialog([
		{ index: 1, name: 'Old Kent Road', color: 'brown', smallBuildings: 0, bigBuildings: 0, mortgaged: false, housePrice: 50, mortgageValue: 30, price: 60, canBuild: true },
	]);
	const row = document.querySelector('.manage-item') as HTMLElement;
	assert.equal(row.getAttribute('aria-label'), 'Old Kent Road. Brown. sale price 60 euros');

	// A house was built — the SAME row node now reads the new state.
	ctl.set([
		{ index: 1, name: 'Old Kent Road', color: 'brown', smallBuildings: 1, bigBuildings: 0, mortgaged: false, housePrice: 50, mortgageValue: 30, price: 60, canBuild: true },
	]);
	managePropertiesDialog.refresh();
	assert.strictEqual(document.querySelector('.manage-item'), row, 'same row node reused');
	assert.equal(row.getAttribute('aria-label'), 'Old Kent Road. Brown. sale price 60 euros. 1 buildings');
});

test('refresh() adds and removes rows as the portfolio changes', () => {
	const ctl = openMutableDialog([
		{ index: 1, name: 'Old Kent Road', color: 'brown', smallBuildings: 0, bigBuildings: 0, mortgaged: false, housePrice: 50, mortgageValue: 30, price: 60, canBuild: true },
	]);
	assert.equal(document.querySelectorAll('.manage-item').length, 1);

	// Acquire a second property.
	ctl.set([
		{ index: 1, name: 'Old Kent Road', color: 'brown', smallBuildings: 0, bigBuildings: 0, mortgaged: false, housePrice: 50, mortgageValue: 30, price: 60, canBuild: true },
		{ index: 3, name: 'Whitechapel Road', color: 'brown', smallBuildings: 0, bigBuildings: 0, mortgaged: false, housePrice: 50, mortgageValue: 30, price: 60, canBuild: true },
	]);
	managePropertiesDialog.refresh();
	assert.deepEqual(
		Array.from(document.querySelectorAll('.manage-item')).map((r) => (r as HTMLElement).dataset.focusId),
		['item-1', 'item-3'],
	);

	// Lose the first one (e.g. sold in a trade).
	ctl.set([
		{ index: 3, name: 'Whitechapel Road', color: 'brown', smallBuildings: 0, bigBuildings: 0, mortgaged: false, housePrice: 50, mortgageValue: 30, price: 60, canBuild: true },
	]);
	managePropertiesDialog.refresh();
	assert.deepEqual(
		Array.from(document.querySelectorAll('.manage-item')).map((r) => (r as HTMLElement).dataset.focusId),
		['item-3'],
	);
});

test('refresh() shows the empty state when the last property is gone', () => {
	const ctl = openMutableDialog([
		{ index: 1, name: 'Old Kent Road', color: 'brown', smallBuildings: 0, bigBuildings: 0, mortgaged: false, housePrice: 50, mortgageValue: 30, price: 60, canBuild: true },
	]);
	const list = document.querySelector('.manage-list') as HTMLElement;
	const empty = document.querySelector('.manage-panel__empty') as HTMLElement;
	assert.equal(empty.hidden, true);
	assert.equal(list.hidden, false);

	ctl.set([]);
	managePropertiesDialog.refresh();
	assert.equal(empty.hidden, false, 'empty message is revealed');
	assert.equal(list.hidden, true, 'the (now empty) list is hidden');
});
