import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DEFAULT_LANGUAGE, isLobbyPathFor, lobbyPathFor } from '../src/languageUrl.js';

const require = createRequire(import.meta.url);
const { localePath, DEFAULT_LOCALE, LOCALES } =
	require('../localizePages.js') as typeof import('../localizePages.js');

// The build decides where each language is written; the selector decides where a player is sent.
// The two derive that path independently, so they are pinned to each other here: move one without
// the other and every language switch lands on a page that does not exist.
test('the selector sends players exactly where the build writes each language', () => {
	assert.equal(DEFAULT_LANGUAGE, DEFAULT_LOCALE);
	for (const locale of LOCALES) assert.equal(lobbyPathFor(locale), localePath(locale));
});

test('the default language is the site root and every other one its own directory', () => {
	assert.equal(lobbyPathFor('en'), '/');
	assert.equal(lobbyPathFor('es'), '/es/');
});

test('applying the language already on screen is recognised, so it never reloads the page', () => {
	// Including the forms a bookmark or a typed URL can carry.
	assert.ok(isLobbyPathFor('/', 'en'));
	assert.ok(isLobbyPathFor('/index.html', 'en'));
	assert.ok(isLobbyPathFor('/es/', 'es'));
	assert.ok(isLobbyPathFor('/es', 'es'));
	assert.ok(isLobbyPathFor('/es/index.html', 'es'));
});

test('the other language is never mistaken for the current one', () => {
	// The regression this guards: treating every path as "already right" would swallow the switch
	// and leave the player on the same page, which is exactly the bug being fixed.
	assert.ok(!isLobbyPathFor('/es/', 'en'));
	assert.ok(!isLobbyPathFor('/es/index.html', 'en'));
	assert.ok(!isLobbyPathFor('/', 'es'));
	assert.ok(!isLobbyPathFor('/index.html', 'es'));
});
