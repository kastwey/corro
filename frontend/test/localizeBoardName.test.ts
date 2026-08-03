import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';
import { localizeBoardName, formatGameDate, parseHubErrorCode, isTableAtRestStatus, pickPackageName, syncSelectOptions } from '../src/lobby/ui.js';

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

// pickPackageName — the shipped-board picker's per-locale name map and the
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

// ── syncSelectOptions ───────────────────────────────────────────────────────
//
// Reported from a real session: choosing a game made a screen reader read the player-count combo's
// selected text out of nowhere. Staging a board rebuilt that <select> every time — even when the
// new board offered the same range — inside a form whose aria-busy was flipping back to false,
// which is exactly when assistive technology re-reads what changed underneath it.
//
// The fix is not to announce less. It is not to CHANGE anything: rebuilding a control to the state
// it was already in is work nobody asked for, and a screen reader is right to report it.

test('an unchanged set of choices leaves the control completely untouched', () => {
	const select = document.createElement('select');
	select.innerHTML = '<option value="2">2 players</option><option value="3">3 players</option>';
	const before = Array.from(select.options);
	select.value = '3';

	const rebuilt = syncSelectOptions(select, [
		{ value: '2', label: '2 players' },
		{ value: '3', label: '3 players' },
	]);

	assert.equal(rebuilt, false, 'nothing changed, so nothing was rewritten');
	// The very same nodes: a screen reader has nothing to report, because nothing happened.
	assert.deepEqual(Array.from(select.options), before);
	assert.equal(select.value, '3', 'and the answer the host already gave survives');
});

test('a genuinely different set of choices is rebuilt', () => {
	const select = document.createElement('select');
	select.innerHTML = '<option value="2">2 players</option>';

	const rebuilt = syncSelectOptions(select, [
		{ value: '2', label: '2 players' },
		{ value: '4', label: '4 players' },
	]);

	assert.equal(rebuilt, true);
	assert.deepEqual(Array.from(select.options).map(option => option.value), ['2', '4']);
});

test('a label that changed language is a change, even at the same values', () => {
	const select = document.createElement('select');
	select.innerHTML = '<option value="2">2 players</option>';

	assert.equal(syncSelectOptions(select, [{ value: '2', label: '2 jugadores' }]), true);
	assert.equal(select.options[0].textContent, '2 jugadores');
});
