import test from 'node:test';
import assert from 'node:assert/strict';
import { boardPageTitle } from '../src/boardTitle.js';

// The board tab title is "<board name> - <site title>": a package game's localized name, a built-in
// board's localized id, or just the deployment title when neither is known.
const tr = (k: string) => (({ 'lobby.boards.galactic-empire': 'Galactic Empire' }) as Record<string, string>)[k] ?? k;

test('a package game uses its localized board name', () => {
	const name = { es: 'Imperio Galáctico', en: 'Galactic Empire' };
	assert.equal(boardPageTitle(name, 'es', undefined, tr), 'Imperio Galáctico - All Welcome');
	assert.equal(boardPageTitle(name, 'en', undefined, tr), 'Galactic Empire - All Welcome');
});

test('a built-in board localizes its saved id', () => {
	assert.equal(boardPageTitle(undefined, 'en', 'galactic-empire', tr), 'Galactic Empire - All Welcome');
});

test('a built-in board with no translation falls back to the raw id', () => {
	assert.equal(boardPageTitle(undefined, 'en', 'custom-x', tr), 'custom-x - All Welcome');
});

test('with nothing known, the title is just the site title', () => {
	assert.equal(boardPageTitle(undefined, 'en', undefined, tr), 'All Welcome');
	assert.equal(boardPageTitle(undefined, 'en', '', tr), 'All Welcome');
});

test('a package name is preferred over a saved built-in id', () => {
	assert.equal(boardPageTitle({ en: 'My Pack' }, 'en', 'galactic-empire', tr), 'My Pack - All Welcome');
});

test('a self-hosted deployment supplies its own title', () => {
	assert.equal(boardPageTitle({ en: 'My Pack' }, 'en', undefined, tr, 'Community Games'), 'My Pack - Community Games');
	assert.equal(boardPageTitle(undefined, 'en', undefined, tr, 'Community Games'), 'Community Games');
});
