// languageSelector.ts — the language control, one behaviour for every page that has one.
//
// It exists because there were two of them. The lobby had a labelled <select> with an Apply
// button; the privacy notice had a little row of links. Same job, two different things to learn,
// two different shapes under a screen reader — and the second one had no name for what those
// links WERE until you read them. A reader who has met this control on the lobby should meet the
// same control everywhere.
//
// The MARKUP is deliberately still written in each page's HTML rather than built here, and the two
// copies are identical on purpose. Every page is pre-translated at build time (localizePages.js),
// so the served document already reads in the right language before a single script runs; a
// control assembled at runtime would arrive late and untranslated, which is the thing that
// property exists to prevent. What is shared is everything that can be: the keyboard behaviour,
// remembering the choice, and the rule about what "apply" means.
//
// The one thing that genuinely differs between pages is WHERE each language lives, because each
// page is built per language and served from its own URL. That is the caller's to say.

import { i18nBinder } from './i18nBinder.js';

export interface LanguageSelectorOptions {
	/** Where THIS page lives in the given language, e.g. `/es/privacy/`. */
	pathFor: (language: string) => string;
	/**
	 * Whether the reader is already on that language's version. Applying the language you are
	 * reading should record the choice and stay put, not reload the page under you. Defaults to
	 * comparing against `pathFor`.
	 */
	isCurrent?: (pathname: string, language: string) => boolean;
	/**
	 * Carry the query string and hash across the switch. True for the lobby, where an invite link
	 * (`?code=ABCD`) must survive; pointless for a document page, which has neither.
	 */
	preserveLocation?: boolean;
	/** Test seam: where "apply" actually sends the reader. Defaults to a real navigation. */
	navigate?: (url: string) => void;
}

/**
 * Wire the control already in the page. Returns false when this page has none, which is a normal
 * answer — the board has no language picker, and a test fixture may not have built one.
 */
export function wireLanguageSelector(options: LanguageSelectorOptions): boolean {
	const select = document.getElementById('language-selector') as HTMLSelectElement | null;
	const apply = document.getElementById('language-apply-btn') as HTMLButtonElement | null;
	if (!select || !apply) return false;

	select.value = currentLanguage(select);
	apply.addEventListener('click', () => applyLanguage(select.value, options));
	return true;
}

/**
 * The language the reader is in. The page's own `lang` first — every page is BUILT in one language,
 * so that attribute is the honest answer — falling back to the runtime one for a page that is not.
 */
function currentLanguage(select: HTMLSelectElement): string {
	const offered = Array.from(select.options, option => option.value);
	const page = document.documentElement.lang;
	if (offered.includes(page)) return page;
	const runtime = (window as unknown as { i18next?: { language?: string } }).i18next?.language;
	return runtime && offered.includes(runtime) ? runtime : (offered[0] ?? 'en');
}

/**
 * Applying a language is NAVIGATION, not a translation pass: every page is built once per
 * language, so the reader lands on the page that WAS BUILT in it — URL, `<html lang>` and text all
 * agreeing — instead of a Spanish-looking English page.
 *
 * The choice is recorded first in every branch, including the one that goes nowhere. The root page
 * redirects by cookie, so a stale one would send somebody who just asked for English straight back
 * to Spanish; and somebody who arrived on `/es/` from a shared link and pressed Apply has just told
 * us where to send them from the root next time.
 */
function applyLanguage(language: string, options: LanguageSelectorOptions): void {
	i18nBinder.rememberLanguage(language);

	const isCurrent = options.isCurrent
		?? ((pathname, candidate) => normalize(pathname) === normalize(options.pathFor(candidate)));
	if (isCurrent(window.location.pathname, language)) return;

	const tail = options.preserveLocation
		? `${window.location.search}${window.location.hash}`
		: '';
	const target = `${options.pathFor(language)}${tail}`;
	(options.navigate ?? (url => window.location.assign(url)))(target);
}

/** Directory form, so `/es/privacy/` and `/es/privacy/index.html` are the same page. */
function normalize(pathname: string): string {
	const directory = pathname.replace(/index\.html$/, '');
	return directory.endsWith('/') ? directory : `${directory}/`;
}
