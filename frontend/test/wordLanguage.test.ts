import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseWordLanguage, wordLanguageName } from '../src/lobby/wordLanguage.js';

test('word language defaults to the host interface language when the package supplies it', () => {
	assert.equal(chooseWordLanguage(['en', 'es'], 'es-ES'), 'es');
	assert.equal(chooseWordLanguage(['en', 'es'], 'en-US'), 'en');
});

test('word language falls back deterministically without inventing a missing deck', () => {
	assert.equal(chooseWordLanguage(['es', 'en'], 'fr'), 'en');
	assert.equal(chooseWordLanguage(['es'], 'en'), 'es');
	assert.equal(chooseWordLanguage([], 'es'), '');
});

test('word language names use the listener interface translations', () => {
	const en = (key: string) => ({ 'language.english': 'English', 'language.spanish': 'Spanish' })[key] ?? key;
	const es = (key: string) => ({ 'language.english': 'Inglés', 'language.spanish': 'Español' })[key] ?? key;
	assert.equal(wordLanguageName('en', es), 'Inglés');
	assert.equal(wordLanguageName('es-ES', en), 'Spanish');
	assert.equal(wordLanguageName('ca', en), 'CA');
});
