/**
 * Shared content-deck language helpers. A package whose CONTENT is language-split — the forbidden
 * words to guess, the trivia questions to answer — has one authoritative deck for the whole match,
 * deliberately independent from each player's interface locale, which stays personal.
 */

const primaryLanguage = (value: string | null | undefined): string =>
	(value ?? '').trim().split(/[-_]/, 1)[0].toLowerCase();

/** Pick a package-owned deck language, preferring the host's current interface language. */
export function chooseContentLanguage(
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

/**
 * Fill a deck-language selector with the package's languages, named in the reader's own
 * interface language, and select the active one. Shared by the create form and the table, which
 * offer the same choice at two different moments.
 */
export function fillContentLanguageSelect(
	select: HTMLSelectElement,
	languages: readonly string[],
	selected: string,
	translate: (key: string) => string,
): void {
	select.replaceChildren();
	for (const language of languages) {
		const option = document.createElement('option');
		option.value = language;
		option.textContent = contentLanguageName(language, translate);
		select.appendChild(option);
	}
	select.value = selected;
}

/** Name a supported deck language in the LISTENER's interface language, so a Spanish
 *  player reads "Inglés" for an English deck. */
export function contentLanguageName(
	language: string,
	translate: (key: string) => string,
): string {
	switch (primaryLanguage(language)) {
		case 'en': return translate('language.english');
		case 'es': return translate('language.spanish');
		default: return language.toUpperCase();
	}
}
