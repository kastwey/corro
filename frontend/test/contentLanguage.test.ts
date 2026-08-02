import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseContentLanguage, contentLanguageName } from '../src/lobby/contentLanguage.js';

test('content language defaults to the host interface language when the package supplies it', () => {
	assert.equal(chooseContentLanguage(['en', 'es'], 'es-ES'), 'es');
	assert.equal(chooseContentLanguage(['en', 'es'], 'en-US'), 'en');
});

test('content language falls back deterministically without inventing a missing deck', () => {
	assert.equal(chooseContentLanguage(['es', 'en'], 'fr'), 'en');
	assert.equal(chooseContentLanguage(['es'], 'en'), 'es');
	assert.equal(chooseContentLanguage([], 'es'), '');
});

test('content language names use the listener interface translations', () => {
	const en = (key: string) => ({ 'language.english': 'English', 'language.spanish': 'Spanish' })[key] ?? key;
	const es = (key: string) => ({ 'language.english': 'Inglés', 'language.spanish': 'Español' })[key] ?? key;
	assert.equal(contentLanguageName('en', es), 'Inglés');
	assert.equal(contentLanguageName('es-ES', en), 'Spanish');
	assert.equal(contentLanguageName('ca', en), 'CA');
});
