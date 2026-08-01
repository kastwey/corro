// localizePages.js — emit one pre-translated copy of the lobby per language.
//
// The lobby shipped English text with `data-i18n` keys and let the browser swap all 81 strings
// once the locale files had been fetched. A Spanish player therefore read an English page and
// watched it change; worse, a screen reader could start reading it that way. The swap can never
// happen before the first paint, because the strings are fetched and the app is an ES module —
// both run after the browser has painted.
//
// So the page is translated HERE, at build time, and served already correct. Two consequences
// beyond the flicker:
//
//   * `/es/` is a real URL a search engine can index. Serving both languages from one URL keyed
//     on a cookie cannot be indexed at all: crawlers send no cookies, so only English would ever
//     be seen. `hreflang` then tells the engine which version belongs to whom.
//   * The output is GENERATED, never authored. Nobody maintains a second copy of the strings:
//     they come from the same locale files the translation-parity tests already guard, and
//     dist/ is rebuilt from scratch every time.
//
// The board is deliberately NOT localized this way: it carries five translatable attributes (one
// of them already deferred until the locale lands), its URL is a private game session that must
// not be indexed at all, and giving it per-language paths would mean rewriting every link to it.

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

/** The default language, served at `/` and advertised as hreflang's x-default. */
const DEFAULT_LOCALE = 'en';
const LOCALES = ['en', 'es'];

/** Flattens the nested locale JSON into the dotted keys the markup references. */
function flatten(node, prefix = '') {
	const flat = {};
	for (const [key, value] of Object.entries(node)) {
		const dotted = `${prefix}${key}`;
		if (value && typeof value === 'object' && !Array.isArray(value)) {
			Object.assign(flat, flatten(value, `${dotted}.`));
		} else {
			flat[dotted] = value;
		}
	}
	return flat;
}

function loadLocale(localesDir, locale) {
	return flatten(JSON.parse(fs.readFileSync(path.join(localesDir, `${locale}.json`), 'utf-8')));
}

/**
 * The path a locale is served from. The default language keeps the bare root so `/` is a real
 * page rather than a redirect, which is what x-default should point at.
 */
function localePath(locale) {
	return locale === DEFAULT_LOCALE ? '/' : `/${locale}/`;
}

/**
 * Applies a locale to a parsed document, mirroring i18nBinder.applyI18n exactly: `data-i18n`
 * replaces text, `data-i18n-attr:x` sets attribute x, and an untranslated key leaves the English
 * fallback in place rather than blanking the element.
 *
 * Returns the keys that had no translation, so the build can report drift instead of shipping a
 * half-translated page.
 */
function translateDocument(document, strings) {
	const missing = [];

	document.querySelectorAll('[data-i18n]').forEach(element => {
		const key = element.getAttribute('data-i18n');
		const text = strings[key];
		if (text === undefined) {
			missing.push(key);
			return;
		}
		element.textContent = text;
		// The title element also names the browser tab.
		if (element.tagName === 'TITLE') document.title = text;
	});

	document.querySelectorAll('*').forEach(element => {
		for (const attr of Array.from(element.attributes)) {
			if (!attr.name.startsWith('data-i18n-attr:')) continue;
			const text = strings[attr.value];
			if (text === undefined) {
				missing.push(attr.value);
				continue;
			}
			element.setAttribute(attr.name.slice('data-i18n-attr:'.length), text);
		}
	});

	// Copy that was hidden until the locale was known is already correct here, so it is revealed
	// in the markup itself — there is nothing left to wait for.
	document.querySelectorAll('[data-i18n-defer]').forEach(element => {
		element.removeAttribute('hidden');
		element.removeAttribute('data-i18n-defer');
	});

	return missing;
}

/** Cross-links every language version so a search engine can tell them apart. */
function addHreflang(document) {
	const head = document.head;
	for (const locale of LOCALES) {
		const link = document.createElement('link');
		link.setAttribute('rel', 'alternate');
		link.setAttribute('hreflang', locale);
		link.setAttribute('href', localePath(locale));
		head.appendChild(link);
	}
	const fallback = document.createElement('link');
	fallback.setAttribute('rel', 'alternate');
	fallback.setAttribute('hreflang', 'x-default');
	fallback.setAttribute('href', localePath(DEFAULT_LOCALE));
	head.appendChild(fallback);
}

/**
 * Sends a player to their language. Only the default page carries this: from
 * `/es/` there is nothing to redirect to, and a redirect on both would loop.
 *
 * The saved choice wins; failing that, the browser's own language, so a Spanish speaker's FIRST
 * visit is not in English. Both are read here in the browser rather than negotiated on the
 * server, and that is what keeps `/` indexable: a crawler sends no cookie and reports English, so
 * it is never redirected and always sees the page it asked for, while `hreflang` still tells it
 * that `/es/` exists.
 *
 * `location.replace` leaves no history entry, so Back does not bounce the player straight in again.
 */
function addPreferredLanguageRedirect(document) {
	const script = document.createElement('script');
	script.textContent = [
		'(function () {',
		'  try {',
		"    var m = document.cookie.match(/(?:^|;\\s*)corro_language=([^;]*)/);",
		'    var lang = m ? decodeURIComponent(m[1]) : (navigator.language || "").slice(0, 2);',
		`    if (lang && lang !== '${DEFAULT_LOCALE}' && ${JSON.stringify(LOCALES)}.indexOf(lang) !== -1) {`,
		'      location.replace("/" + lang + "/" + location.search + location.hash);',
		'    }',
		'  } catch (e) { /* stay on the default page */ }',
		'})();',
	].join('\n');
	document.head.insertBefore(script, document.head.firstChild);
}

/** Search engines must not index a private game session. */
function addNoIndex(document) {
	const meta = document.createElement('meta');
	meta.setAttribute('name', 'robots');
	meta.setAttribute('content', 'noindex, nofollow');
	document.head.appendChild(meta);
}

/**
 * Writes the localized lobby copies into `dist`, and stamps the board as non-indexable.
 * Throws when a referenced key is missing from a locale: shipping a page that is half English is
 * exactly the outcome this step exists to prevent.
 */
function localizePages({ srcDir, distDir, localesDir }) {
	const written = [];
	const source = fs.readFileSync(path.join(srcDir, 'index.html'), 'utf-8');

	for (const locale of LOCALES) {
		const dom = new JSDOM(source);
		const { document } = dom.window;
		const strings = loadLocale(localesDir, locale);

		document.documentElement.setAttribute('lang', locale);
		const missing = translateDocument(document, strings);
		if (missing.length > 0) {
			throw new Error(
				`index.html references keys missing from ${locale}.json: ${[...new Set(missing)].join(', ')}`);
		}
		addHreflang(document);

		let destination;
		if (locale === DEFAULT_LOCALE) {
			destination = path.join(distDir, 'index.html');
			addPreferredLanguageRedirect(document);
		} else {
			destination = path.join(distDir, locale, 'index.html');
			// Served from a subdirectory, so every relative asset, script and link — including the
			// navigation to the shared board page — still resolves from the site root.
			const base = document.createElement('base');
			base.setAttribute('href', '/');
			document.head.insertBefore(base, document.head.firstChild);
			fs.mkdirSync(path.dirname(destination), { recursive: true });
		}

		fs.writeFileSync(destination, dom.serialize(), 'utf-8');
		written.push(path.relative(distDir, destination).replace(/\\/g, '/'));
	}

	// The board keeps its single URL (its links and the E2E suite address it directly) and its
	// runtime translation; it only gains the instruction not to be indexed.
	const boardPath = path.join(distDir, 'board.html');
	if (fs.existsSync(boardPath)) {
		const dom = new JSDOM(fs.readFileSync(boardPath, 'utf-8'));
		addNoIndex(dom.window.document);
		fs.writeFileSync(boardPath, dom.serialize(), 'utf-8');
		written.push('board.html (noindex)');
	}

	return written;
}

module.exports = { localizePages, flatten, localePath, DEFAULT_LOCALE, LOCALES };
