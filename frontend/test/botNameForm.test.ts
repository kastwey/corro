import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom } from './helpers/dom.js';
import { buildBotNameForm } from '../src/lobby/botNameForm.js';

/**
 * The "add a bot" name form. The point of this whole change: pressing Enter in the name
 * box adds the bot straight away, exactly as the Add button does — no trip to the button.
 */

before(() => setupDom());

const t = (key: string) => key;

/** jsdom needs ITS OWN KeyboardEvent constructor, not Node's global one. */
const keydown = (key: string) =>
	new (globalThis as any).window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });

test('Enter in the name box submits the trimmed name — same path as the Add button', () => {
	const submitted: (string | undefined)[] = [];
	const { input } = buildBotNameForm({ t, rollName: () => 'x', onSubmit: (n) => submitted.push(n) });

	input.value = '  Rueda Libre  ';
	input.dispatchEvent(keydown('Enter'));

	assert.deepEqual(submitted, ['Rueda Libre']);
});

test('Enter with an empty box submits undefined so the server picks "Bot N"', () => {
	const submitted: (string | undefined)[] = [];
	const { input } = buildBotNameForm({ t, rollName: () => 'x', onSubmit: (n) => submitted.push(n) });

	input.value = '   ';
	input.dispatchEvent(keydown('Enter'));

	assert.deepEqual(submitted, [undefined]);
});

test('Enter cancels the default so it never bubbles into a form submit', () => {
	const { input } = buildBotNameForm({ t, rollName: () => 'x', onSubmit: () => {} });
	const evt = keydown('Enter');
	input.dispatchEvent(evt);
	assert.equal(evt.defaultPrevented, true);
});

test('other keys are left alone — typing does not add the bot', () => {
	let calls = 0;
	const { input } = buildBotNameForm({ t, rollName: () => 'x', onSubmit: () => { calls++; } });

	input.value = 'Pit';
	input.dispatchEvent(keydown('t'));

	assert.equal(calls, 0);
});

test('the explicit submit() (wired to the Add button) shares the same behaviour', () => {
	const submitted: (string | undefined)[] = [];
	const { input, submit } = buildBotNameForm({ t, rollName: () => 'x', onSubmit: (n) => submitted.push(n) });

	input.value = 'Chispa';
	submit();

	assert.deepEqual(submitted, ['Chispa']);
});

test('rolling the hat fills the box from rollName and keeps focus for typing', () => {
	const { content, input } = buildBotNameForm({ t, rollName: (cur) => `${cur || ''}rolled`, onSubmit: () => {} });
	document.body.appendChild(content);

	content.querySelector<HTMLButtonElement>('#bot-name-random')!.click();

	assert.equal(input.value, 'rolled');
	assert.equal(document.activeElement, input);
	content.remove();
});
