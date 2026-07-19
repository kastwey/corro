import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { contextMenuSquareIndex } from '../src/board.js';

/**
 * Unit tests for the pure square-resolution used by the board's context-menu gesture
 * (right-click / Applications key / Shift+F10). The square under the pointer wins; otherwise
 * the gesture is attributed to the focused board container and falls back to the exploration
 * cursor; -1 means "let the browser's native menu through".
 */

let container: HTMLElement;

before(() => {
	setupDom();
});

beforeEach(() => {
	document.body.innerHTML = '';
	container = document.createElement('div');
	container.id = 'board';
	document.body.appendChild(container);
});

function addSquare(index: number): HTMLElement {
	const sq = document.createElement('button');
	sq.className = 'square';
	sq.dataset.index = String(index);
	const label = document.createElement('span');
	label.className = 'label';
	sq.appendChild(label);
	container.appendChild(sq);
	return sq;
}

test('a right-click on a square returns that square index regardless of the cursor', () => {
	const sq = addSquare(7);
	assert.equal(contextMenuSquareIndex(sq, 2), 7);
});

test('a right-click on a child inside a square resolves to the owning square', () => {
	const sq = addSquare(7);
	const inner = sq.querySelector('.label') as HTMLElement;
	assert.equal(contextMenuSquareIndex(inner, -1), 7);
});

test('a gesture on the focused board container falls back to the active cursor', () => {
	assert.equal(contextMenuSquareIndex(container, 5), 5);
});

test('returns -1 when off any square and there is no cursor yet', () => {
	assert.equal(contextMenuSquareIndex(container, -1), -1);
});

test('returns -1 for a null target with no cursor', () => {
	assert.equal(contextMenuSquareIndex(null, -1), -1);
});

test('a square with a non-numeric data-index returns -1', () => {
	const sq = addSquare(0);
	sq.dataset.index = 'oops';
	assert.equal(contextMenuSquareIndex(sq, 3), -1);
});
