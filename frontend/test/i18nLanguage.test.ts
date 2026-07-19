import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { I18nBinder } from '../src/i18nBinder.js';

// Regression guard: the language a player picks in the lobby is persisted in the
// `corro_language` cookie. When they open a game, init() must honour that cookie instead
// of forcing a hardcoded language (the game page used to force Spanish, ignoring the lobby).

// A minimal i18next stand-in: init/changeLanguage just record the active language so the
// binder can run without the real engine or network resources.
function fakeI18next() {
	const obj: any = {
		language: 'en',
		init: async (opts: any) => { obj.language = opts?.lng ?? obj.language; },
		changeLanguage: async (lng: string) => { obj.language = lng; },
		t: (k: string) => k,
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
	// The binder dispatches `new CustomEvent(...)` on document; map jsdom's constructor onto the
	// global so the event is a jsdom Event that document.dispatchEvent accepts and propagates.
	g.CustomEvent = dom.window.CustomEvent;
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

// Regression: the languageChanged event MUST bubble. The lobby subscribes on `window`; a
// non-bubbling event dispatched on `document` never reaches a window listener, so the whole
// live-refresh (token/board selectors, saved games, theme toggle) silently never ran and those
// imperatively-set labels stayed in the old language until a hard reload.
test('changeLanguage dispatches a bubbling languageChanged event that reaches window listeners', async () => {
	document.cookie = 'corro_language=en';
	const binder = newBinder();
	await binder.init();

	let heardOnWindow: string | null = null;
	window.addEventListener('languageChanged', (e: any) => { heardOnWindow = e.detail?.language ?? null; });

	await binder.changeLanguage('es');

	assert.equal(heardOnWindow, 'es');
});
