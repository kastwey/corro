import test from 'node:test';
import assert from 'node:assert/strict';
import { translateWithSelfFallback, adjustHistoryCursorAfterPush, resolveLocalizedVars } from '../src/announcer.js';

/**
 * Fake translator emulating i18next/tSync: returns the translation for a known
 * key, or the key unchanged when missing (the same contract tSync exposes).
 */
function makeTranslate(catalog: Record<string, string>) {
	return (key: string) => (key in catalog ? catalog[key] : key);
}

test('uses the first-person _self variant when it exists', () => {
	const translate = makeTranslate({
		'game.bought_self': 'Has comprado la propiedad',
		'game.bought': 'Ana ha comprado la propiedad'
	});

	const text = translateWithSelfFallback('game.bought_self', {}, translate);

	assert.equal(text, 'Has comprado la propiedad');
});

test('falls back to the base key when _self has no translation', () => {
	const translate = makeTranslate({
		'game.passed_through_go': 'Ana pasa por la salida'
		// no game.passed_through_go_self
	});

	const text = translateWithSelfFallback('game.passed_through_go_self', {}, translate);

	assert.equal(text, 'Ana pasa por la salida');
});

test('the _victim variant resolves, and falls back to the base when missing', () => {
	const translate = makeTranslate({
		'cards.limite_played': '¡Pepe lanza un límite a Ana!',
		'cards.limite_played_victim': '¡Pepe te lanza un límite! ¡Modo tortuga!',
		'cards.pinchazo_played': '¡Pepe pincha una rueda a Ana!',
		// no cards.pinchazo_played_victim
	});

	assert.equal(
		translateWithSelfFallback('cards.limite_played_victim', {}, translate),
		'¡Pepe te lanza un límite! ¡Modo tortuga!');
	assert.equal(
		translateWithSelfFallback('cards.pinchazo_played_victim', {}, translate),
		'¡Pepe pincha una rueda a Ana!');
});

test('the _victim_team variant falls down the chain: plural → singular → base', () => {
	const translate = makeTranslate({
		'cards.limite_played': '¡Pepe lanza un límite al Equipo Rojo!',
		'cards.limite_played_victim': '¡Pepe te lanza un límite!',
		'cards.limite_played_victim_team': '¡Pepe os lanza un límite! ¡Vais en modo tortuga!',
		'cards.pinchazo_played': '¡Pepe pincha una rueda al Equipo Rojo!',
		'cards.pinchazo_played_victim': '¡Pepe te pincha una rueda!',
		// no cards.pinchazo_played_victim_team → the singular victim line
		'cards.accidente_played': '¡Crash! Pepe provoca un accidente',
		// no accidente victim variants at all → the base line
	});

	assert.equal(
		translateWithSelfFallback('cards.limite_played_victim_team', {}, translate),
		'¡Pepe os lanza un límite! ¡Vais en modo tortuga!');
	assert.equal(
		translateWithSelfFallback('cards.pinchazo_played_victim_team', {}, translate),
		'¡Pepe te pincha una rueda!');
	assert.equal(
		translateWithSelfFallback('cards.accidente_played_victim_team', {}, translate),
		'¡Crash! Pepe provoca un accidente');
});

test('leaves a non-_self key untouched', () => {
	const translate = makeTranslate({ 'game.game_ended': 'La partida ha terminado' });

	const text = translateWithSelfFallback('game.game_ended', {}, translate);

	assert.equal(text, 'La partida ha terminado');
});

test('returns the original key when neither variant exists', () => {
	const translate = makeTranslate({});

	// Base also missing → returns the (base) key unchanged, signalling "not found".
	const text = translateWithSelfFallback('game.unknown_self', {}, translate);

	assert.equal(text, 'game.unknown');
});

test('redirects a bank debt to its dedicated grammatical line', () => {
	const translate = makeTranslate({
		'game.debt_created_bank_self': 'Debes 5€ al banco',
		'game.debt_created_self': 'Debes 5€ a bank' // the wrong, generic line must NOT be used
	});

	const text = translateWithSelfFallback('game.debt_created_self', { creditor: 'bank', amount: 5 }, translate);

	assert.equal(text, 'Debes 5€ al banco');
});

test('a player-name creditor keeps the generic debt line', () => {
	const translate = makeTranslate({ 'game.debt_created': 'Ana debe 5€ a Bob' });

	const text = translateWithSelfFallback('game.debt_created', { creditor: 'Bob', amount: 5 }, translate);

	assert.equal(text, 'Ana debe 5€ a Bob');
});

// ── Localized announcement vars (e.g. a bilingual board's square name) ───────

test('resolveLocalizedVars resolves a localized-text var to the player language', () => {
	const vars = { player: 'Ana', square: { es: 'Calle Mayor', en: 'Main Street' } };
	assert.deepEqual(resolveLocalizedVars(vars, 'en'), { player: 'Ana', square: 'Main Street' });
	assert.deepEqual(resolveLocalizedVars(vars, 'es'), { player: 'Ana', square: 'Calle Mayor' });
});

test('resolveLocalizedVars falls back to any translation when the language is missing', () => {
	const vars = { square: { es: 'Solo español' } };
	assert.deepEqual(resolveLocalizedVars(vars, 'en'), { square: 'Solo español' });
});

test('resolveLocalizedVars leaves plain string/number vars untouched', () => {
	const vars = { player: 'Ana', amount: 200 };
	assert.equal(resolveLocalizedVars(vars, 'en'), vars); // same object, nothing to resolve
});

// ── History cursor after a new announcement arrives ──────────────────────────

test('a new announcement keeps the live edge live (cursor stays -1)', () => {
	// Not browsing: the next backwards step should still start from the newest message.
	assert.equal(adjustHistoryCursorAfterPush(-1, 0), -1);
	assert.equal(adjustHistoryCursorAfterPush(-1, 1), -1);
});

test('a new announcement does not yank a reviewing reader to the bottom', () => {
	// Reviewing entry 3, nothing trimmed → stay on entry 3.
	assert.equal(adjustHistoryCursorAfterPush(3, 0), 3);
});

test('a reviewing cursor shifts down by the number of trimmed entries', () => {
	// Reviewing entry 3, two entries trimmed off the front → same logical entry is now 1.
	assert.equal(adjustHistoryCursorAfterPush(3, 2), 1);
});

test('a reviewing cursor clamps to the oldest survivor when its entry was trimmed', () => {
	// Reviewing entry 1 but three entries were trimmed → clamp to 0 rather than go negative.
	assert.equal(adjustHistoryCursorAfterPush(1, 3), 0);
});
