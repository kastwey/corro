import test from 'node:test';
import assert from 'node:assert/strict';
import { isTypingTarget } from '../src/typingTarget.js';
import { setupDom } from './helpers/dom.js';

setupDom();

function input(type: string, apply: (element: HTMLInputElement) => void = () => {}): HTMLInputElement {
	const element = document.createElement('input');
	element.type = type;
	apply(element);
	return element;
}

test('a field somebody could be typing a word into owns its letters', () => {
	assert.equal(isTypingTarget(input('text')), true);
	assert.equal(isTypingTarget(input('search')), true);
	assert.equal(isTypingTarget(document.createElement('textarea')), true);
});

test('a field that cannot take a letter anyway leaves the shortcuts alone', () => {
	assert.equal(isTypingTarget(input('number')), false);
	assert.equal(isTypingTarget(input('range')), false);
	assert.equal(isTypingTarget(document.createElement('button')), false);
	assert.equal(isTypingTarget(document.createElement('div')), false);
	assert.equal(isTypingTarget(null), false);
});

test('a read-only field is a reading surface, so the reading keys still reach the game', () => {
	// The forbidden family's private card: a real, selectable, screen-reader navigable textarea
	// that refuses every mutation. S and R have to work from inside it.
	const aria = document.createElement('textarea');
	aria.setAttribute('aria-readonly', 'true');
	assert.equal(isTypingTarget(aria), false);

	const native = document.createElement('textarea');
	native.readOnly = true;
	assert.equal(isTypingTarget(native), false);
	assert.equal(isTypingTarget(input('text', element => { element.readOnly = true; })), false);
});
