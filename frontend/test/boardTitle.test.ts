import test from 'node:test';
import assert from 'node:assert/strict';
import { boardPageTitle } from '../src/boardTitle.js';

// The board tab title is "<board name> - Corro": a package game's localized name, a built-in
// board's localized id, or just "Corro" when neither is known.
const tr = (k: string) => (({ 'lobby.boards.imperio-galactico': 'Galactic Empire' }) as Record<string, string>)[k] ?? k;

test('a package game uses its localized board name', () => {
	const name = { es: 'Imperio Galáctico', en: 'Galactic Empire' };
	assert.equal(boardPageTitle(name, 'es', undefined, tr), 'Imperio Galáctico - Corro');
	assert.equal(boardPageTitle(name, 'en', undefined, tr), 'Galactic Empire - Corro');
});

test('a built-in board localizes its saved id', () => {
	assert.equal(boardPageTitle(undefined, 'en', 'imperio-galactico', tr), 'Galactic Empire - Corro');
});

test('a built-in board with no translation falls back to the raw id', () => {
	assert.equal(boardPageTitle(undefined, 'en', 'custom-x', tr), 'custom-x - Corro');
});

test('with nothing known, the title is just "Corro"', () => {
	assert.equal(boardPageTitle(undefined, 'en', undefined, tr), 'Corro');
	assert.equal(boardPageTitle(undefined, 'en', '', tr), 'Corro');
});

test('a package name is preferred over a saved built-in id', () => {
	assert.equal(boardPageTitle({ en: 'My Pack' }, 'en', 'imperio-galactico', tr), 'My Pack - Corro');
});
