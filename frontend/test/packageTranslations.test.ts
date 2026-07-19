import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizePackageTranslations } from '../src/i18nBinder.js';

test('package translations discard prototype-pollution keys at every depth', () => {
	const input = JSON.parse(`{
		"cards": {
			"safe": "Safe card",
			"__proto__": { "polluted": true },
			"constructor": { "prototype": { "polluted": true } }
		},
		"prototype": "bad"
	}`);

	const safe = sanitizePackageTranslations(input);
	assert.equal((safe.cards as Record<string, unknown>).safe, 'Safe card');
	assert.equal(Object.hasOwn(safe, 'prototype'), false);
	assert.equal(Object.hasOwn(safe.cards as object, '__proto__'), false);
	assert.equal(Object.hasOwn(safe.cards as object, 'constructor'), false);
	assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test('package translations reject arrays and non-object roots', () => {
	assert.deepEqual({ ...sanitizePackageTranslations(['bad']) }, {});
	assert.deepEqual({ ...sanitizePackageTranslations('bad') }, {});
});