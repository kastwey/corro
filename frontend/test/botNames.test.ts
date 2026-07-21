import test from 'node:test';
import assert from 'node:assert/strict';
import { BOT_NAME_COUNT, localizedBotNames, randomBotName } from '../src/botNames.js';

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
