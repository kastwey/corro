import test from 'node:test';
import assert from 'node:assert/strict';
import { BOT_NAME_COUNT, botNamePool, localizedBotNames, randomBotName } from '../src/botNames.js';

// The silly-name hat: localized content in, pure random selection out.

test('reads every name from i18n and picks only from that list', () => {
	const translate = (key: string) => `translated ${key}`;
	const names = localizedBotNames(translate);
	assert.equal(names.length, BOT_NAME_COUNT);
	assert.equal(names[0], 'translated lobby.botNames.0');
	assert.equal(names.at(-1), `translated lobby.botNames.${BOT_NAME_COUNT - 1}`);
	for (let i = 0; i < 20; i++) {
		assert.ok(names.includes(randomBotName(translate)));
	}
});

test('re-rolling never repeats the name currently in the box', () => {
	const translate = (key: string) => key;
	const current = localizedBotNames(translate)[0];
	for (let i = 0; i < 50; i++) {
		assert.notEqual(randomBotName(translate, current), current);
	}
});

// A board's opponents belong to its world. The engine's list is the fallback, not the law: a
// package declares its own names as i18n keys, exactly as it declares its pieces and its seats.
test('a package that names its own bots is the one that gets asked', () => {
	const words: Record<string, string> = { 'bots.foreman': 'Capataz Escombro', 'bots.canary': 'Pepe Canario' };
	const translate = (key: string) => words[key] ?? key;
	const keys = ['bots.foreman', 'bots.canary'];

	assert.deepEqual(botNamePool(translate, keys), ['Capataz Escombro', 'Pepe Canario']);
	for (let i = 0; i < 20; i++) {
		assert.ok(keys.map(k => words[k]).includes(randomBotName(translate, undefined, keys)));
	}
});

test('a board that names none keeps the engine list', () => {
	const translate = (key: string) => `translated ${key}`;
	assert.deepEqual(botNamePool(translate, []), localizedBotNames(translate));
	assert.deepEqual(botNamePool(translate, undefined), localizedBotNames(translate));
});

// A package whose translations have not landed yet — or that names a key it never defined —
// must not offer the host a raw key as a name to accept.
test('an unresolved key is never offered as a name', () => {
	const translate = (key: string) => (key === 'bots.real' ? 'Tiznado' : key);

	assert.deepEqual(botNamePool(translate, ['bots.real', 'bots.missing']), ['Tiznado']);
	// …and a package where NOTHING resolves falls back rather than offering keys.
	assert.deepEqual(botNamePool(translate, ['bots.missing']), localizedBotNames(translate));
});

// One name is a legitimate thing for a board to declare; rolling the hat again must still answer.
test('a single declared name survives a re-roll', () => {
	const translate = (key: string) => (key === 'bots.only' ? 'Solo' : key);
	assert.equal(randomBotName(translate, 'Solo', ['bots.only']), 'Solo');
});
