/**
 * Shared Forbidden Words deck-language helpers. Card content has one authoritative language
 * for the whole match; this is deliberately independent from each player's interface locale.
 */

const primaryLanguage = (value: string | null | undefined): string =>
	(value ?? '').trim().split(/[-_]/, 1)[0].toLowerCase();

/** Pick a package-owned deck language, preferring the host's current interface language. */
export function chooseWordLanguage(
	available: readonly string[] | null | undefined,
	preferred: string | null | undefined,
): string {
	const languages = (available ?? []).filter(language => language.trim().length > 0);
	const preferredPrimary = primaryLanguage(preferred);
	return languages.find(language => primaryLanguage(language) === preferredPrimary)
		?? languages.find(language => primaryLanguage(language) === 'en')
		?? languages[0]
		?? '';
}

/** Name a supported deck language in the listener's interface language. */
export function wordLanguageName(
	language: string,
	translate: (key: string) => string,
): string {
	switch (primaryLanguage(language)) {
		case 'en': return translate('language.english');
		case 'es': return translate('language.spanish');
		default: return language.toUpperCase();
	}
}
