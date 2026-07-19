import test from 'node:test';
import assert from 'node:assert/strict';
import { localizedSquareName, pickLocale, resolveSquareName, squareGroupLabel, groupDisplayName } from '../src/localizeSquare.js';

// A localized .corro board carries per-locale square names; the client picks the player's
// language and falls back gracefully, so partial translations and single-language boards work.

test('uses the name for the requested language when present', () => {
	const sq = { name: 'Planeta Cuñao', names: { es: 'Planeta Cuñao', en: 'Bro Planet' } };
	assert.equal(localizedSquareName(sq, 'en'), 'Bro Planet');
	assert.equal(localizedSquareName(sq, 'es'), 'Planeta Cuñao');
});

test('falls back to the canonical name when that language is missing (partial translation)', () => {
	const sq = { name: 'Calle Mayor', names: { es: 'Calle Mayor' } }; // no 'en'
	assert.equal(localizedSquareName(sq, 'en'), 'Calle Mayor');
});

test('a single-language board (no names) returns the plain name', () => {
	const sq = { name: 'Salida' };
	assert.equal(localizedSquareName(sq, 'en'), 'Salida');
	assert.equal(localizedSquareName(sq, 'es'), 'Salida');
});

// resolveSquareName — display-name fallback so a package board that doesn't name every square
// (corners, card squares) is never blank.
const TR: Record<string, string> = {
	'game.square_start': 'Go',
	'game.square_holding': 'Holding (just visiting)',
	'game.square_free_parking': 'Free Parking',
	'game.square_send_to_holding': 'Go to Holding',
};
const translate = (k: string) => TR[k] ?? k; // missing keys come back unchanged

test('resolveSquareName: an explicit per-locale name always wins', () => {
	const sq = { name: 'Planeta Cuñao', names: { es: 'Planeta Cuñao', en: 'Bro Planet' } };
	assert.equal(resolveSquareName(sq, 'en', [], translate), 'Bro Planet');
});

test('resolveSquareName: an unnamed card square falls back to its deck name', () => {
	const decks = [{ id: 'fortune', label: 'Quantum Anomaly' }, { id: 'blackmarket', label: 'Black Market' }];
	assert.equal(resolveSquareName({ name: '', deck: 'blackmarket', behavior: 'drawCard' }, 'en', decks, translate), 'Black Market');
});

test('resolveSquareName: an unnamed corner falls back to a generic label from its behaviour', () => {
	assert.equal(resolveSquareName({ name: '', behavior: 'start' }, 'en', [], translate), 'Go');
	assert.equal(resolveSquareName({ name: '', behavior: 'freeParking' }, 'en', [], translate), 'Free Parking');
	assert.equal(resolveSquareName({ name: '', behavior: 'sendToHolding' }, 'en', [], translate), 'Go to Holding');
});

test('resolveSquareName: with no name/deck/known behaviour (or no translation) returns the canonical name', () => {
	assert.equal(resolveSquareName({ name: '' }, 'en', [], translate), '');
	// An untranslated corner key (translate echoes the key) counts as "no translation".
	assert.equal(resolveSquareName({ name: '', behavior: 'start' }, 'en', [], k => k), '');
});

// squareGroupLabel — the group/colour text a screen reader announces for a square.
const tg = (k: string) => (({
	'game.group': 'Group', 'game.color': 'Color',
	'game.color_brown': 'Brown', 'groups.g1': 'Bro System',
	'game.term_transit': 'Station', 'game.term_utility': 'Utility',
}) as Record<string, string>)[k] ?? k;
const colorWord = (c: string) => c;

test('squareGroupLabel: a group key is resolved via the (merged) translations', () => {
	assert.equal(squareGroupLabel({ groupNameKey: 'game.color_brown' }, tg, colorWord), 'Group: Brown');
	assert.equal(squareGroupLabel({ groupNameKey: 'groups.g1' }, tg, colorWord), 'Group: Bro System');
});

test('squareGroupLabel: an unresolved group key is shown literally (upload fallback)', () => {
	assert.equal(squareGroupLabel({ groupNameKey: 'Sistema Cuñao' }, tg, colorWord), 'Group: Sistema Cuñao');
});

test('squareGroupLabel: a real colour word is announced when there is no group key', () => {
	assert.equal(squareGroupLabel({ color: 'brown' }, tg, colorWord), 'Color: brown');
});

test('squareGroupLabel: a station/utility announces its TYPE, not "Color: transit"', () => {
	// A station carries color:"transit" and no group key; navigating onto it must read "Station",
	// not "Color: transit" — a station is not a colour group (playtest bug #4).
	assert.equal(squareGroupLabel({ color: 'transit' }, tg, colorWord), 'Station');
	assert.equal(squareGroupLabel({ color: 'utility' }, tg, colorWord), 'Utility');
});

test('squareGroupLabel: a raw hex colour (no group key) is NOT announced', () => {
	assert.equal(squareGroupLabel({ color: '#8a5a2b' }, tg, colorWord), '');
	assert.equal(squareGroupLabel({ color: 'a1b2c3' }, tg, colorWord), '');
	assert.equal(squareGroupLabel({}, tg, colorWord), '');
});

// groupDisplayName — the group NAME (no "Group:" prefix) for trade / manage / player-detail swatch
// labels. Regression for bugs #3/#9/#10 (dialogs showed the raw hex instead of the group name).
test('groupDisplayName: resolves the group name key (package or classic), never the raw hex', () => {
	assert.equal(groupDisplayName({ groupNameKey: 'groups.g1', color: '#8a5a2b' }, tg, colorWord), 'Bro System');
	assert.equal(groupDisplayName({ groupNameKey: 'game.color_brown', color: 'brown' }, tg, colorWord), 'Brown');
});

test('groupDisplayName: a classic colour word with no group key is localized', () => {
	assert.equal(groupDisplayName({ color: 'brown' }, tg, colorWord), 'brown');
});

test('groupDisplayName: a type-named group (transit/utility) resolves the board TERM, not the raw word', () => {
	// A station carries color:"transit" and no group key; the trade list must read "Station",
	// not the raw "transit" (bug: "Estación de las Delicias, transit").
	assert.equal(groupDisplayName({ color: 'transit' }, tg, colorWord), 'Station');
	assert.equal(groupDisplayName({ color: 'utility' }, tg, colorWord), 'Utility');
	// A non-type, unknown colour word still falls back to the localized colour, not a term.
	assert.equal(groupDisplayName({ color: 'brown' }, tg, colorWord), 'brown');
});

test('groupDisplayName: a bare hex with no group key yields empty (not the hex)', () => {
	assert.equal(groupDisplayName({ color: '#8a5a2b' }, tg, colorWord), '');
	assert.equal(groupDisplayName({}, tg, colorWord), '');
});

// pickLocale — used for content with no canonical fallback (e.g. a package card's text).
test('pickLocale returns the requested language, else any available, else empty', () => {
	assert.equal(pickLocale({ es: 'Texto ES', en: 'Text EN' }, 'en'), 'Text EN');
	assert.equal(pickLocale({ es: 'Texto ES', en: 'Text EN' }, 'es'), 'Texto ES');
	assert.equal(pickLocale({ es: 'Solo ES' }, 'en'), 'Solo ES'); // missing lang -> any translation
	assert.equal(pickLocale(undefined, 'en'), '');
	assert.equal(pickLocale({}, 'en'), '');
});
