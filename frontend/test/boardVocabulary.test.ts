import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, installFakeI18next } from './helpers/dom.js';
import { setBoardVocabulary } from '../src/boardVocabulary.js';
import { tSync, money } from '../src/i18nBinder.js';

before(() => { setupDom(); });

// setBoardVocabulary installs the active board's words into i18next. Everything translatable is an
// i18n KEY resolved against the merged package translations (only the board `name` stays inline) —
// so generic app strings resolve the board's currency/terminology/building without any override.

function gs(overrides: any = {}) {
	return {
		currency: { symbol: '₡', code: 'CR', nameKey: 'currency.name' },
		terminology: { holding: 'terminology.holding', freeparking: 'terminology.freeparking' },
		groups: [
			{ id: 'transit', colorName: 'groups.transit' },
			{ id: 'utility', colorName: 'groups.utility' },
		],
		...overrides,
	} as any;
}

test('amounts use the board currency symbol after the board loads', () => {
	installFakeI18next('en');
	setBoardVocabulary(gs(), 'en');
	assert.equal(money(1500), '1500₡');
	assert.equal(tSync('game.debt_created_bank', { player: 'A', amount: 1500 }),
		'A owes 1500₡ to the bank');
});

test('the spoken currency name comes from the board key (créditos), not a hardcoded euros', () => {
	installFakeI18next('es', { 'currency.name': 'créditos' });
	setBoardVocabulary(gs(), 'es');
	assert.equal(tSync('game.player_money', { player: 'A', amount: 1500 }), 'A tiene 1500 créditos');
});

test('terminology words come from the board keys (holding, free parking)', () => {
	installFakeI18next('es', { 'terminology.holding': 'Agujero Negro', 'terminology.freeparking': 'Cinturón de Asteroides' });
	setBoardVocabulary(gs(), 'es');
	assert.equal(tSync('game.player_token_held', { name: 'A' }), 'A (en Agujero Negro)');
	assert.equal(tSync('game.help_cmd_free_parking'), 'Anunciar el bote de Cinturón de Asteroides');
});

test('transit/utility names come from the like-named group key', () => {
	installFakeI18next('es', { 'groups.transit': 'Saltos Hiperespaciales', 'groups.utility': 'Suministros' });
	setBoardVocabulary(gs(), 'es');
	assert.ok(tSync('game.property_info_rent_railroad', { count: 2, amount: 100, currencyName: '€' }).includes('Saltos Hiperespaciales'));
	assert.ok(tSync('game.property_info_rent_utility_one').includes('Suministros'));
});

test('building tiers come from the board keys (its own small/big construction names)', () => {
	installFakeI18next('es', { 'building.small': 'colonia', 'building.smallPlural': 'colonias', 'building.big': 'metrópolis' });
	setBoardVocabulary(gs({
		building: { levels: 5, smallKey: 'building.small', smallPluralKey: 'building.smallPlural', bigKey: 'building.big' },
	}), 'es');
	assert.equal(tSync('game.building_built', { player: 'A', property: 'Marte' }), 'A construye una colonia en Marte');
	assert.equal(tSync('game.houses_count', { count: 3 }), '3 colonias');
	assert.equal(tSync('game.hotel_label'), 'metrópolis');
});

test('building tiers fall back to generic words when the board declares none', () => {
	installFakeI18next('en');
	setBoardVocabulary({ currency: { symbol: '€' } } as any, 'en'); // no building keys
	assert.equal(tSync('game.hotel_label'), 'large building');
	assert.equal(tSync('game.houses_count', { count: 2 }), '2 buildings');
});

test('falls back to generic words when the board declares no terminology/groups', () => {
	installFakeI18next('en');
	setBoardVocabulary({ currency: { symbol: '£' } } as any, 'en'); // no terminology, no groups
	assert.equal(tSync('game.player_token_held', { name: 'A' }), 'A (in holding)');
	assert.ok(tSync('game.property_info_rent_railroad', { count: 2, amount: 100, currencyName: '£' }).includes('station'));
	assert.equal(money(50), '50£');
});

test('with no board (lobby/pre-game) amounts default to the euro symbol', () => {
	installFakeI18next('en');
	setBoardVocabulary(undefined, 'en');
	assert.equal(money(200), '200€');
});

test('the GO/start announcement uses the board start name, not a hardcoded "Salida" (bug #5)', () => {
	installFakeI18next('es', { 'terminology.start': 'Puerto Estelar' });
	setBoardVocabulary(gs({ terminology: { start: 'terminology.start' } }), 'es');
	const line = tSync('game.landed_on_go', { player: 'Aelin', amount: 400, currencyName: 'créditos' });
	assert.ok(line.includes('Puerto Estelar'), line);
	assert.ok(!line.includes('Salida'), 'must not fall back to the hardcoded word');
});

test('release-pass labels stay theme-neutral', () => {
	installFakeI18next('es', { 'terminology.holding': 'Agujero Negro' });
	setBoardVocabulary(gs({ terminology: { holding: 'terminology.holding' } }), 'es');
	assert.equal(tSync('game.trade_release_passes_label'), 'Pases de liberación');
	assert.equal(tSync('game.release_passes_one', { player: 'Aelin' }), 'Aelin tiene 1 pase de liberación');
	assert.equal(tSync('game.announce_release_passes_none'), 'Sin pases de liberación');
});
