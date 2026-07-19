import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import i18next from 'i18next';

// These tests render announcements with the REAL i18next engine (not the fake used
// elsewhere) so they exercise `$t(...)` nesting. The parity test only checks that keys
// exist in both locales; it cannot catch a nested colour reference that resolves to the
// raw key (e.g. "color_orange") because the wrong namespace prefix was used. That is the
// bug these cover: spoken landing prompts must read a translated colour, never a
// leftover key or empty parentheses.

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LOCALES = join(ROOT, 'i18n', 'locales');

function load(lang: 'en' | 'es'): unknown {
	return JSON.parse(readFileSync(join(LOCALES, `${lang}.json`), 'utf8'));
}

before(async () => {
	await i18next.init({
		lng: 'es',
		fallbackLng: 'en',
		resources: {
			en: { translation: load('en') },
			es: { translation: load('es') },
		},
		interpolation: { escapeValue: false },
	});
});

test('landing on a coloured street reads the translated colour in parentheses (es)', () => {
	i18next.changeLanguage('es');
	const text = i18next.t('game.landed_on_property_colored_self', { square: 'Paseo Marítimo', colorKey: 'game.color_darkblue' });
	assert.equal(text, 'Caes en Paseo Marítimo (Azul oscuro)');
	assert.ok(!text.includes('color_'), 'must not leak the raw colour key');
	assert.ok(!text.includes('$t('), 'nesting must be resolved');
});

test('landing on a coloured street reads the translated colour in parentheses (en)', () => {
	i18next.changeLanguage('en');
	const text = i18next.t('game.landed_on_property_colored', { player: 'Ana', square: 'Main Square', colorKey: 'game.color_darkblue' });
	assert.equal(text, 'Ana landed on Main Square (Dark blue)');
	i18next.changeLanguage('es');
});

test('completing a full group reads the translated colour, not the raw key', () => {
	i18next.changeLanguage('es');
	const text = i18next.t('game.group_completed_self', { colorKey: 'game.color_brown' });
	assert.ok(text.includes('Marrón'), `expected the colour name, got: ${text}`);
	assert.ok(!text.includes('color_') && !text.includes('$t('));
});

test('group ownership hint agrees in gender and uses the board member noun (es)', () => {
	i18next.changeLanguage('es');
	// feminine group (central): "ninguna central"
	const fem = i18next.t('game.group_member_none', { context: 'f', member: 'central', group: 'Suministros', total: 2 });
	assert.equal(fem, 'Aún no tienes ninguna central del grupo Suministros (2 en total).');
	// masculine group (planeta): "ningún planeta"
	const masc = i18next.t('game.group_member_none', { context: 'm', member: 'planeta', group: 'Sistema Rojo', total: 3 });
	assert.equal(masc, 'Aún no tienes ningún planeta del grupo Sistema Rojo (3 en total).');
	// "some" uses the plural noun + a number, so no article gender is needed
	const some = i18next.t('game.group_member_some', { count: 1, total: 2, memberPlural: 'centrales', group: 'Suministros' });
	assert.equal(some, 'Ya tienes 1 de 2 centrales del grupo Suministros.');
});

test('group ownership hint in English ignores gender (no _f divergence)', () => {
	i18next.changeLanguage('en');
	const none = i18next.t('game.group_member_none', { context: 'f', member: 'power plant', group: 'Utilities', total: 2 });
	assert.equal(none, "You don't own any power plant in the Utilities group yet (2 total).");
	i18next.changeLanguage('es');
});

test('a package group key (hex-coloured board) resolves to the group name, never a leaked key', () => {
	// The bug: package boards have hex colours with no game.color_* key, so the old
	// $t(game.color_{{color}}) leaked "game.color_#b9a04a". Now the group's own name key is
	// nested directly, so a package key like "groups.utility" resolves to its merged name.
	i18next.addResource('es', 'translation', 'groups.utility', 'Suministros');
	i18next.changeLanguage('es');

	const landed = i18next.t('game.landed_on_property_colored_self', { square: 'Central de Antimateria', colorKey: 'groups.utility' });
	assert.equal(landed, 'Caes en Central de Antimateria (Suministros)');
	assert.ok(!landed.includes('game.color_') && !landed.includes('groups.utility'), `leaked a raw key: ${landed}`);

});
