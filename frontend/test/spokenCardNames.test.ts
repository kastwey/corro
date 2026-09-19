import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import i18next from 'i18next';

// The article in "Ana juega un 7 rojo" belongs to the DECK, not to the engine sentence: "un"
// fits *7 rojo* and betrays *Reversa roja*, and a shedding deck the engine has never seen
// decides which one it ships. So the sentence asks each card for its own indefinite form and
// falls back to the plain name when the deck ships none. Both halves are pinned here against
// the REAL locale files and the REAL i18next, because a hardcoded article looks perfect on the
// one deck it was written for and only goes wrong on the next.

// Frontend root (this file lives in frontend/test/) and the repository root above it.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPO_ROOT = join(ROOT, '..');

const readJson = (...parts: string[]): Record<string, any> =>
	JSON.parse(readFileSync(join(...parts), 'utf8'));

const ENGINE_ES = readJson(ROOT, 'i18n', 'locales', 'es.json');
const FOUR_COLOURS = readJson(REPO_ROOT, 'server', 'Packages', 'four-colours', 'i18n', 'es.json');
// The E2E fixture deck names its cards "Azul 2" and ships no indefinite form: it stands here
// for every deck written before the form existed, and for the SDK template's feminine names.
const NO_FORMS = readJson(REPO_ROOT, 'e2e', 'fixtures', 'packages', 'one-play-match', 'i18n', 'es.json');

/** Speaks as the client does: the package's own translations merged over the app's (I18nBinder.loadPackageResources). */
async function speaking(pack: Record<string, unknown>) {
	const instance = i18next.createInstance();
	await instance.init({
		lng: 'es',
		resources: { es: { translation: { ...ENGINE_ES, ...pack } } },
		interpolation: { escapeValue: false },
	});
	return instance;
}

test('a play names the card with the article its own deck gives it', async () => {
	const t = await speaking(FOUR_COLOURS);

	assert.equal(t.t('game.shedding_played', { player: 'Ana', card: 'cards.red_7' }), 'Ana juega un 7 rojo');
	assert.equal(t.t('game.shedding_played_self', { card: 'cards.wild' }), 'Juegas un Comodín');
	assert.equal(
		t.t('game.shedding_drew_playable', { card: 'cards.blue_2' }),
		'Robas un 2 azul: Intro la juega, Espacio te la quedas y pasas.');
	assert.equal(
		t.t('game.shedding_drew_unplayable', { card: 'cards.green_skip' }),
		'Robas un Saltar verde. No encaja: el turno pasa.');
});

test('a deck with no indefinite forms is announced by its plain names, articleless', async () => {
	const t = await speaking(NO_FORMS);

	for (const line of [
		t.t('game.shedding_played', { player: 'Ana', card: 'cards.blue_2' }),
		t.t('game.shedding_played_self', { card: 'cards.blue_2' }),
		t.t('game.shedding_drew_playable', { card: 'cards.blue_2' }),
		t.t('game.shedding_drew_unplayable', { card: 'cards.blue_2' }),
	]) {
		assert.match(line, /Azul 2/);
		assert.doesNotMatch(line, /\bun\b/); // never "juega un Azul 2" — the deck did not ask for it
	}
});
