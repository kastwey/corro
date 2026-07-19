// test/helpers/dom.ts — Shared jsdom setup for the DOM-dependent frontend tests.
//
// The production code targets the browser (document, window, native <dialog>, ARIA live
// regions). These helpers stand up a jsdom environment and a faithful-enough i18next stub
// (backed by the REAL locale files) so the few genuinely DOM-bound behaviours can be
// regression-tested. Pure logic stays in its own DOM-free tests.

import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { money } from '../../src/i18nBinder.js';
import { setBoardVocabulary } from '../../src/boardVocabulary.js';

const here = dirname(fileURLToPath(import.meta.url));
const localesDir = join(here, '..', '..', 'i18n', 'locales');

/**
 * Install a jsdom document/window onto the global scope so modules that reference
 * `document`/`window` at call time work. Call this BEFORE dynamically importing the
 * module under test. Returns the JSDOM instance.
 */
export function setupDom(): JSDOM {
	const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
	const g = globalThis as any;
	g.window = dom.window;
	g.document = dom.window.document;
	g.navigator = dom.window.navigator;
	g.HTMLElement = dom.window.HTMLElement;
	g.HTMLDialogElement = dom.window.HTMLDialogElement;
	g.KeyboardEvent = dom.window.KeyboardEvent;
	// Modules reference the bare `localStorage` global (persisted preferences); map jsdom's
	// so those paths behave like the platform instead of silently no-opping in tests.
	// Needs the explicit url above: opaque origins (about:blank) have no localStorage.
	try { g.localStorage = dom.window.localStorage; } catch { /* leave unmapped */ }
	g.Node = dom.window.Node;

	// jsdom does not implement the modal <dialog> methods; polyfill just enough so
	// open()/close() flip the `open` flag the code (and our assertions) rely on.
	const proto: any = dom.window.HTMLDialogElement?.prototype;
	if (proto && typeof proto.showModal !== 'function') {
		proto.showModal = function () { this.open = true; this.setAttribute('open', ''); };
		proto.show = function () { this.open = true; this.setAttribute('open', ''); };
		proto.close = function () {
			this.open = false;
			this.removeAttribute('open');
			// Real dialogs fire `close` (code relies on it for cleanup — e.g. a dragged
			// dialog resets its position there); dispatch it like the platform would.
			this.dispatchEvent(new dom.window.Event('close'));
		};
	}
	return dom;
}

/** Flatten a nested locale object into dotted keys ("game.auction_bid_button"). */
function flatten(obj: any, prefix = '', out: Record<string, string> = {}): Record<string, string> {
	for (const [k, v] of Object.entries(obj)) {
		const key = prefix ? `${prefix}.${k}` : k;
		if (v && typeof v === 'object') flatten(v, key, out);
		else out[key] = String(v);
	}
	return out;
}

/**
 * Install a minimal `window.i18next` backed by the real locale JSON. Supports `{{var}}`
 * interpolation and returns the key unchanged when missing (mirroring i18next/tSync).
 */
export function installFakeI18next(lang: 'en' | 'es' = 'en', extra: Record<string, string> = {}): void {
	const dict = JSON.parse(readFileSync(join(localesDir, `${lang}.json`), 'utf-8'));
	// 'currency.name' mimics a package i18n key so the default board vocabulary below resolves the
	// spoken currency word; `extra` mimics any other merged package keys a test needs.
	const flat = { ...flatten(dict), 'currency.name': 'euros', ...extra };
	(globalThis as any).window.i18next = {
		language: lang,
		t: (key: string, vars?: Record<string, any>) => {
			const tpl = flat[key];
			if (tpl === undefined) return key;
			// Mirror i18next interpolation, including the `{{amount, money}}` currency formatter
			// (delegated to the real money() so it reflects the board symbol set via setBoardVocabulary).
			return tpl.replace(/\{\{(\w+)(\s*,\s*money)?\}\}/g, (_m, name, fmt) => {
				if (!vars || !(name in vars)) return `{{${name}${fmt ?? ''}}}`;
				return fmt ? money(vars[name]) : String(vars[name]);
			});
		}
	};
	// Install a default euro-board vocabulary (symbol + currency name + generic terms) so strings
	// referencing {{currency}}/{{holding}}/{{transit}}… resolve in DOM tests, exactly as the app sets
	// it before rendering. Tests that exercise a specific board call setBoardVocabulary again.
	setBoardVocabulary({ currency: { symbol: '€', code: 'EUR', nameKey: 'currency.name' } } as any, lang);
}
