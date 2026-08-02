import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { I18nBinder } from '../src/i18nBinder.js';

// Regression guard: the language a player picks in the lobby is persisted in the
// `corro_language` cookie. When they open a game, init() must honour that cookie instead
// of forcing a hardcoded language (the game page used to force Spanish, ignoring the lobby).

// A minimal i18next stand-in: init just records the active language so the binder can run
// without the real engine or network resources.
function fakeI18next(translations: Record<string, string> = {}) {
	const obj: any = {
		language: 'en',
		init: async (opts: any) => { obj.language = opts?.lng ?? obj.language; },
		changeLanguage: async (lng: string) => { obj.language = lng; },
		t: (k: string) => translations[k] ?? k,
	};
	return obj;
}

function newBinder(): I18nBinder {
	// Default 'es' on purpose: a correct binder must still pick the cookie's language over it.
	return new I18nBinder({ defaultLanguage: 'es', supportedLanguages: ['en', 'es'], resourcesPath: 'i18n/locales' });
}

beforeEach(() => {
	// A real http URL is required for jsdom to store cookies (about:blank is an opaque origin
	// where document.cookie is a no-op, which would mask the very behaviour under test).
	const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'http://localhost/' });
	const g = globalThis as any;
	g.window = dom.window;
	g.document = dom.window.document;
	g.navigator = dom.window.navigator;
	g.window.i18next = fakeI18next();
});

test('init() honours a Spanish language cookie over the browser/default', async () => {
	// jsdom's navigator.language is en-US, so an "es" result can only come from the cookie.
	document.cookie = 'corro_language=es';
	const binder = newBinder();

	await binder.init();

	assert.equal(binder.getCurrentLanguage(), 'es');
});

test('init() honours an English language cookie (the lobby choice)', async () => {
	document.cookie = 'corro_language=en';
	const binder = newBinder();

	await binder.init();

	assert.equal(binder.getCurrentLanguage(), 'en');
});

test('applyI18n reveals deferred copy only after localization and keeps readable fallbacks', async () => {
	document.cookie = 'corro_language=es';
	document.body.innerHTML = `
		<p id="translated" data-i18n="game.surface_intro.loading" data-i18n-defer hidden>English fallback</p>
		<p id="fallback" data-i18n="missing.key" data-i18n-defer hidden>Readable fallback</p>`;
	window.i18next = fakeI18next({
		'game.surface_intro.loading': 'Localized loading instructions',
	});
	const binder = newBinder();
	const translated = document.getElementById('translated') as HTMLElement;
	const fallback = document.getElementById('fallback') as HTMLElement;

	assert.equal(translated.hidden, true);
	assert.equal(translated.textContent, 'English fallback');
	await binder.init();
	await binder.applyI18n();

	assert.equal(translated.hidden, false);
	assert.equal(translated.hasAttribute('data-i18n-defer'), false);
	assert.equal(translated.textContent, 'Localized loading instructions');
	assert.equal(fallback.hidden, false);
	assert.equal(fallback.hasAttribute('data-i18n-defer'), false);
	assert.equal(fallback.textContent, 'Readable fallback');
});

// The language in force comes from the PAGE — there is no in-place switch to test (see the note
// in i18nBinder.ts). So the locale-sensitive behaviour is checked across two binders, which is
// also how a player actually meets it: one page per language.
test('formatNumber follows the language in force, not a hardcoded locale', async () => {
	document.cookie = 'corro_language=en';
	const english = newBinder();
	await english.init();
	assert.equal(english.formatNumber(1234), (1234).toLocaleString('en'));

	document.documentElement.lang = 'es';
	const spanish = newBinder();
	await spanish.init();
	assert.equal(spanish.formatNumber(1234), (1234).toLocaleString('es'),
		'the page it was loaded into decides, over the cookie');
});
