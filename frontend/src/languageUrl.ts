// languageUrl.ts — where each language is served from.
//
// The lobby is built once per language and served already translated (see localizePages.js), so
// the language a player reads is a property of the URL, not of a cookie or a DOM pass. Choosing a
// language is therefore navigation: send the player to that language's own page instead of
// retranslating this one. The choice then survives a reload, can be shared as a link and matches
// the `hreflang` pair a search engine was given.

/** The language served from the site root. Mirrors DEFAULT_LOCALE in localizePages.js. */
export const DEFAULT_LANGUAGE = 'en';

/** The lobby URL that serves `language`. Mirrors localePath() in localizePages.js. */
export function lobbyPathFor(language: string): string {
	return language === DEFAULT_LANGUAGE ? '/' : `/${language}/`;
}

/**
 * Whether `pathname` already serves `language`, so applying the language a player is reading does
 * nothing rather than reloading the page under them. Accepts the directory form and the explicit
 * `index.html` that a bookmark or a typed URL can carry.
 */
export function isLobbyPathFor(pathname: string, language: string): boolean {
	const directory = pathname.replace(/index\.html$/, '');
	return (directory.endsWith('/') ? directory : `${directory}/`) === lobbyPathFor(language);
}
