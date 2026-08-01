import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A player who selected Spanish still met an English page for a moment: the markup ships English
 * fallbacks and i18n can only replace them once the locale files have been fetched.
 *
 * The strings cannot be made synchronous, but the document's LANGUAGE can — and that is the half
 * that matters most here, because a screen reader picks its voice from it. Announcing Spanish
 * copy through an English voice (or the reverse) is far worse than seeing a word change.
 *
 * The rest of the gap is narrowed rather than removed: see the parallel-fetch test below.
 */

const root = join(import.meta.dirname, '..');
const read = (...parts: string[]) => readFileSync(join(root, ...parts), 'utf-8');
const PAGES = ['src/board.html', 'src/index.html'];

test('both pages set the document language BEFORE first paint, like the theme does', () => {
	for (const page of PAGES) {
		const html = read(page);
		const head = html.slice(0, html.indexOf('</head>'));

		// Inline and in <head>: a module import would run after the first paint, which is the
		// whole problem being solved.
		assert.match(head, /corro_language/, `${page} never reads the language cookie before paint`);
		assert.match(head, /documentElement\.lang\s*=/, `${page} never sets the document language`);
	}
});

test('the pre-paint language honours the saved choice over the browser locale', () => {
	for (const page of PAGES) {
		const head = read(page).slice(0, read(page).indexOf('</head>'));

		// The cookie is the player's explicit choice; navigator.language is only the fallback,
		// so an English browser with Spanish selected must still start in Spanish.
		assert.ok(head.indexOf('corro_language') < head.indexOf('navigator.language'),
			`${page} consults the browser before the player's own choice`);
		// An unsupported value must land on a supported one rather than propagate.
		assert.match(head, /lang !== 'en' && lang !== 'es'/, `${page} does not validate the cookie`);
	}
});

test('a failure in the pre-paint script never blocks the page', () => {
	for (const page of PAGES) {
		const head = read(page).slice(0, read(page).indexOf('</head>'));

		// Cookies can throw (sandboxed contexts). The page must still render, and the binder
		// re-applies the language once the strings arrive.
		assert.match(head, /catch \(e\) \{/, `${page} lets a cookie failure escape`);
	}
});

test('the locales are fetched in parallel, so the untranslated moment stays short', () => {
	// Sequential awaits made the wait the SUM of both files while only one was needed to paint.
	assert.match(read('src/i18nBinder.ts'), /Promise\.all\(this\.config\.supportedLanguages\.map/,
		'locale files are still fetched one after another');
});

test('the board defers the copy that must not be read in the wrong language', () => {
	// board.html carries almost no static copy, and the one first-paint paragraph uses the
	// existing data-i18n-defer convention: hidden until the pass runs, then revealed translated.
	assert.match(read('src/board.html'), /data-i18n-defer/,
		'the board intro no longer waits for the locale');
});
