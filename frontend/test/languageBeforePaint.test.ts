import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Where each page's language comes from, and why the two differ.
 *
 * The LOBBY is built once per language and served already translated, so its language is a fact
 * of the served document — guessing it again in the browser could contradict the text on screen.
 * The BOARD is still translated at runtime (it carries five translatable attributes and a private
 * session URL), so it resolves the language itself before the first paint: a screen reader picks
 * its voice from <html lang>, and it must not be wrong even briefly.
 */

const root = join(import.meta.dirname, '..');
const read = (...parts: string[]) => readFileSync(join(root, ...parts), 'utf-8');
const headOf = (page: string) => {
	const html = read(page);
	return html.slice(0, html.indexOf('</head>'));
};

test('the board resolves the language before its first paint, like the theme does', () => {
	const head = headOf('src/board.html');

	// Inline and in <head>: a module import would run after the first paint, which is the whole
	// problem being avoided.
	assert.match(head, /corro_language/, 'the board never reads the language cookie before paint');
	assert.match(head, /documentElement\.lang\s*=/, 'the board never sets the document language');
});

test('the board prefers the saved choice over the browser locale, and validates it', () => {
	const head = headOf('src/board.html');

	// The cookie is the player's explicit choice; navigator.language is only the fallback, so an
	// English browser with Spanish selected must still start in Spanish.
	assert.ok(head.indexOf('corro_language') < head.indexOf('navigator.language'),
		"the board consults the browser before the player's own choice");
	assert.match(head, /lang !== 'en' && lang !== 'es'/, 'the board does not validate the cookie');
});

test('a failure in the board script never blocks the page', () => {
	// Cookies can throw in a sandboxed context. The page must still render; the binder re-applies
	// the language once the strings arrive.
	assert.match(headOf('src/board.html'), /catch \(e\) \{/, 'a cookie failure escapes');
});

test('the lobby does NOT guess: it is served already translated', () => {
	// Having both would be a contradiction waiting to happen — the script would set lang from the
	// browser while the served text is whatever language that build produced.
	assert.doesNotMatch(headOf('src/index.html'), /corro_language/,
		'the lobby still guesses a language it is already served with');
});

test('the binder trusts the page it is running on above any other signal', () => {
	const binder = read('src/i18nBinder.ts');
	const detect = binder.slice(binder.indexOf('private detectInitialLanguage'));

	// A pre-translated page declares its language; re-detecting from the cookie or the browser
	// could disagree with the text already on screen and re-translate a correct page.
	assert.ok(detect.indexOf('documentElement.lang') < detect.indexOf('getLanguageFromCookie'),
		'the binder consults the cookie before the page it is on');
});

test('the locales are fetched in parallel, so runtime translation stays short', () => {
	// Sequential awaits made the wait the SUM of both files while only one was needed to paint.
	assert.match(read('src/i18nBinder.ts'), /Promise\.all\(this\.config\.supportedLanguages\.map/,
		'locale files are still fetched one after another');
});
