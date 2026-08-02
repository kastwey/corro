import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';
import { localizeBoardName, formatGameDate, parseHubErrorCode, isTableAtRestStatus, pickPackageName, renderBoardOptions } from '../src/lobby/ui.js';

before(() => {
	setupDom();
	installFakeI18next('es');
});

test('a known board id resolves to its localized name', () => {
	assert.equal(localizeBoardName('galactic-empire'), 'Imperio Galáctico');
});

test('an unmapped board id falls back to its capitalized id (never the bare key)', () => {
	assert.equal(localizeBoardName('france'), 'France');
});

// pickPackageName / renderBoardOptions — the shipped-board picker's per-locale name map and the
// language-switch re-render. Regression for bugs #1/#3: the picker stayed in the old language
// (English) after a runtime switch because it was never re-rendered. These pure helpers make the
// "re-localize AND keep the current choice" behaviour testable without the network-coupled lobby.
test('pickPackageName picks the active language, else en, es, any, else empty', () => {
	assert.equal(pickPackageName({ es: 'Clásico', en: 'Classic' }, 'es'), 'Clásico');
	assert.equal(pickPackageName({ es: 'Clásico', en: 'Classic' }, 'en'), 'Classic');
	assert.equal(pickPackageName({ es: 'Sólo ES' }, 'en'), 'Sólo ES');       // missing lang -> es
	assert.equal(pickPackageName({ fr: 'Seulement FR' }, 'en'), 'Seulement FR'); // no en/es -> any
	assert.equal(pickPackageName({}, 'en'), '');
});

test('renderBoardOptions fills the picker in the active language and keeps the current choice', () => {
	const select = document.createElement('select');
	const boards = [
			 { id: 'galactic-empire', name: { es: 'Imperio Galáctico', en: 'Galactic Empire' } },
		{ id: 'four-colours', name: { es: 'Cuatro Colores', en: 'Four Colours' } },
	];
	// Rendered in English, the host picks the second board.
	renderBoardOptions(select, boards, 'en');
	assert.deepEqual([...select.options].map(o => o.textContent), ['Galactic Empire', 'Four Colours']);
	select.value = 'four-colours';

	// The runtime language switch re-renders in Spanish and MUST keep the host's choice (#1/#3).
	renderBoardOptions(select, boards, 'es');
	assert.deepEqual([...select.options].map(o => o.textContent), ['Imperio Galáctico', 'Cuatro Colores']);
	assert.equal(select.value, 'four-colours', 'the chosen board survives the language switch');
});

test('renderBoardOptions falls back to the first option when the previous choice is gone', () => {
	const select = document.createElement('select');
	renderBoardOptions(select, [{ id: 'a', name: { en: 'A' } }, { id: 'b', name: { en: 'B' } }], 'en');
	select.value = 'b';
	// The board list no longer contains "b": the browser defaults to the first option.
	renderBoardOptions(select, [{ id: 'a', name: { en: 'A' } }, { id: 'c', name: { en: 'C' } }], 'en');
	assert.equal(select.value, 'a');
});

test('an empty board id yields an empty string', () => {
	assert.equal(localizeBoardName(''), '');
});

test('a valid ISO date formats to a non-empty localized string', () => {
	const out = formatGameDate('2026-06-25T10:30:00Z', 'es-ES');
	assert.ok(out.length > 0);
	assert.notEqual(out, '2026-06-25T10:30:00Z');
});

test('a missing or invalid date yields an empty string', () => {
	assert.equal(formatGameDate(''), '');
	assert.equal(formatGameDate('not-a-date'), '');
});

test('parseHubErrorCode extracts the code from a SignalR HubException message', () => {
	const err = new Error("An unexpected error occurred invoking 'GetGameByInviteCode' on the server. HubException: GAME_NOT_FOUND");
	assert.equal(parseHubErrorCode(err), 'GAME_NOT_FOUND');
});

test('parseHubErrorCode extracts a generic lookup error code', () => {
	const err = new Error('HubException: GAME_LOOKUP_ERROR');
	assert.equal(parseHubErrorCode(err), 'GAME_LOOKUP_ERROR');
});

test('parseHubErrorCode returns null when there is no recognizable HubException code', () => {
	assert.equal(parseHubErrorCode(new Error('Network connection lost')), null);
	assert.equal(parseHubErrorCode(undefined), null);
	assert.equal(parseHubErrorCode('plain string'), null);
});

test('a table with no match running is resumed by re-authenticating first', () => {
	assert.equal(isTableAtRestStatus('waiting_for_players'), true);
});

test('a table with a match in it is walked straight into', () => {
	assert.equal(isTableAtRestStatus('active'), false);
	assert.equal(isTableAtRestStatus('paused'), false);
	assert.equal(isTableAtRestStatus('starting'), false);
	assert.equal(isTableAtRestStatus(undefined), false);
});

test('PascalCase status values never match (guards against the old casing bug)', () => {
	// The hub serializes GameStatus as SnakeCaseLower; comparing against the C# spelling was a
	// real bug once, and it fails silently — everything just resumes to the wrong place.
	assert.equal(isTableAtRestStatus('WaitingForPlayers'), false);
});
