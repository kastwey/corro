import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { reconcileChildren } from '../src/domReconcile.js';

// Unit tests for the shared keyed, focus-preserving reconciler that every surgical
// surface (players panel, action toolbar, manage-properties dialog) is built on. The
// contract: survivors are reused and mutated in place, new items created, gone ones
// removed, order fixed up, and the focused element is never destroyed while its item
// survives — and when it IS removed, focus is rescued instead of falling to <body>.

interface Item { id: string; label: string; }

before(() => {
	setupDom();
});

let parent: HTMLElement;

beforeEach(() => {
	document.body.innerHTML = '';
	parent = document.createElement('div');
	document.body.appendChild(parent);
});

function row(item: Item): HTMLElement {
	const el = document.createElement('button');
	el.dataset.key = item.id;
	el.textContent = item.label;
	return el;
}

function reconcile(items: Item[], opts: Partial<Parameters<typeof reconcileChildren<Item>>[1]> = {}) {
	return reconcileChildren<Item>(parent, {
		items,
		key: i => i.id,
		keyOf: el => (el as HTMLElement).dataset.key,
		create: row,
		update: (el, i) => { if (el.textContent !== i.label) el.textContent = i.label; },
		...opts,
	});
}

test('creates an element per item in order and returns them', () => {
	const result = reconcile([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]);
	assert.deepEqual(Array.from(parent.children).map(c => c.textContent), ['A', 'B']);
	assert.equal(result.length, 2);
	assert.equal(result[0], parent.children[0]);
});

test('reuses surviving elements (same node identity) and mutates only what changed', () => {
	reconcile([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]);
	const a = parent.children[0];
	const b = parent.children[1];

	reconcile([{ id: 'a', label: 'A' }, { id: 'b', label: 'B2' }]);
	// Same DOM nodes are reused…
	assert.equal(parent.children[0], a);
	assert.equal(parent.children[1], b);
	// …and only the changed label is updated.
	assert.equal(a.textContent, 'A');
	assert.equal(b.textContent, 'B2');
});

test('removes elements whose item vanished and reorders survivors', () => {
	reconcile([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }]);
	const c = parent.children[2];

	// Drop B and move C before A.
	reconcile([{ id: 'c', label: 'C' }, { id: 'a', label: 'A' }]);
	assert.deepEqual(Array.from(parent.children).map(el => (el as HTMLElement).dataset.key), ['c', 'a']);
	assert.equal(parent.children[0], c); // C kept its identity through the reorder
});

test('leaves children it does not manage (keyOf returns null) untouched', () => {
	const sticky = document.createElement('hr');
	parent.appendChild(sticky);

	reconcile([{ id: 'a', label: 'A' }]);
	// The unmanaged <hr> is neither indexed nor removed.
	assert.ok(sticky.isConnected);
	assert.ok(parent.querySelector('button'));
});

test('calls onRemoved for each element that is removed', () => {
	reconcile([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]);
	const removed: string[] = [];
	reconcile([{ id: 'a', label: 'A' }], { onRemoved: el => removed.push((el as HTMLElement).dataset.key!) });
	assert.deepEqual(removed, ['b']);
});

test('does not touch focus when the focused element survives', () => {
	reconcile([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]);
	const b = parent.children[1] as HTMLElement;
	b.focus();
	assert.equal(document.activeElement, b);

	reconcile([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], {
		rescueFocus: () => parent.children[0] as HTMLElement,
	});
	// Survivor kept focus; rescueFocus was NOT invoked.
	assert.equal(document.activeElement, b);
});

test('rescues focus to the fallback when the focused element is removed', () => {
	reconcile([{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]);
	const b = parent.children[1] as HTMLElement;
	b.focus();

	reconcile([{ id: 'a', label: 'A' }], {
		rescueFocus: () => parent.querySelector('button'),
	});
	assert.ok(!b.isConnected);
	// Focus landed on the remaining button, not <body>.
	assert.equal(document.activeElement, parent.children[0]);
});

test('does not rescue focus when focus was outside the parent', () => {
	const outside = document.createElement('button');
	document.body.appendChild(outside);
	reconcile([{ id: 'a', label: 'A' }]);
	outside.focus();

	let rescued = false;
	reconcile([{ id: 'b', label: 'B' }], { rescueFocus: () => { rescued = true; return null; } });
	// 'a' was removed but focus was never inside the parent, so no rescue runs.
	assert.equal(rescued, false);
	assert.equal(document.activeElement, outside);
});
