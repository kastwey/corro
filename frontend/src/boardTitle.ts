import { pickLocale } from './localizeSquare.js';

/**
 * The board page's tab title: "<board name> - <site title>". A package game provides its localized
 * name (shared by every player via the game state); a built-in board localizes its saved id; when
 * neither is available it falls back to the deployment's title. `translate` returns the key
 * unchanged when the translation is missing, which is treated as "not localized".
 */
export function boardPageTitle(
	boardName: Record<string, string> | undefined,
	lang: string,
	savedBoard: string | undefined,
	translate: (key: string) => string,
	siteTitle = 'All Welcome',
): string {
	let name = boardName ? pickLocale(boardName, lang) : '';
	if (!name && savedBoard) {
		const key = `lobby.boards.${savedBoard}`;
		const localized = translate(key);
		name = localized && localized !== key ? localized : savedBoard;
	}
	return name ? `${name} - ${siteTitle}` : siteTitle;
}
