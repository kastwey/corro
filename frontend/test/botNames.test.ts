import test from 'node:test';
import assert from 'node:assert/strict';
import { BOT_NAMES, randomBotName } from '../src/botNames.js';

// The silly-name hat: pure picks per language, English fallback, never the same name
// twice in a row when re-rolling.

test('picks from the language list, falling back to English', () => {
	for (let i = 0; i < 20; i++) {
		assert.ok(BOT_NAMES.es.includes(randomBotName('es')));
		assert.ok(BOT_NAMES.en.includes(randomBotName('en')));
		assert.ok(BOT_NAMES.en.includes(randomBotName('fr'))); // unknown language → English
	}
});

test('re-rolling never repeats the name currently in the box', () => {
	const current = BOT_NAMES.es[0];
	for (let i = 0; i < 50; i++) {
		assert.notEqual(randomBotName('es', current), current);
	}
});
