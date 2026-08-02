import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setupDom, installFakeI18next } from './helpers/dom.js';
import { showSecondAccountNotice } from '../src/secondAccountNotice.js';
import { dialogManager } from '../src/dialogManager.js';

/**
 * Signing in with a second provider that reports the same address makes a SECOND account, on
 * purpose. This is the notice that stops somebody meeting that as "where did my tables go?".
 *
 * What it is tested for is being USABLE by a person who did not expect to be doing any of this:
 * the steps are there, they are in order, and they are a real ordered list rather than a paragraph
 * that happens to contain numbers.
 */

before(() => {
	setupDom();
	installFakeI18next('en');
});

beforeEach(() => {
	// The manager owns its dialog element and builds it once, so the DOM is NOT wiped between
	// tests — clearing it would leave the singleton holding a node no longer in the document.
	dialogManager.init();
	dialogManager.close();
});

const dialog = () => document.querySelector('.game-dialog') as HTMLElement;

test('it explains what happened and how to undo it, in order', () => {
	showSecondAccountNotice();

	const steps = dialog().querySelectorAll('ol li');
	assert.equal(steps.length, 5, 'five steps, none of them optional');
	// An ordered list, so a screen reader says "1 of 5" — the position is half the instruction.
	assert.ok(dialog().querySelector('ol'), 'the steps are a real ordered list');

	const text = Array.from(steps).map(s => s.textContent ?? '');
	assert.equal(text.filter(Boolean).length, 5, 'no step is blank');
});

// It is instructions to READ, not a form. documentMode keeps a screen reader in browse mode, where
// the steps can be arrowed through and re-read — the alternative announces the button and nothing
// else, which is useless for something you are meant to follow.
test('it opens as a document, not as a widget', () => {
	showSecondAccountNotice();

	// Inside role="application" a screen reader builds no browse buffer and reads ONLY the focused
	// button — which for a list of steps to follow is the same as reading nothing.
	const buttons = dialog().querySelector('.dialog-buttons');
	assert.notEqual(buttons?.getAttribute('role'), 'application');
});

// The words are what this feature IS, so they are checked against the locale files rather than
// trusted: a missing key would render a raw dotted path as a step somebody is asked to follow.
test('every step is written in both languages', () => {
	const keys = ['heading', 'body', 'why', 'howHeading', 'step1', 'step2', 'step3', 'step4', 'step5', 'dismiss'];
	for (const lang of ['en', 'es']) {
		const locale = JSON.parse(
			readFileSync(new URL(`../i18n/locales/${lang}.json`, import.meta.url), 'utf8'));
		const table = locale.account?.secondAccount ?? {};
		for (const key of keys) {
			assert.ok(typeof table[key] === 'string' && table[key].trim(),
				`account.secondAccount.${key} is missing from ${lang}.json`);
		}
	}
});
