import { pickLocale } from './localizeSquare.js';

/**
 * The board page's tab title: "<board name> - Corro". A package game provides its localized
 * name (shared by every player via the game state); a built-in board localizes its saved id; when
 * neither is available it falls back to just "Corro". `translate` returns the key unchanged when
 * the translation is missing, which is treated as "not localized".
 */
export function boardPageTitle(
	boardName: Record<string, string> | undefined,
	lang: string,
	savedBoard: string | undefined,
	translate: (key: string) => string,
): string {
	let name = boardName ? pickLocale(boardName, lang) : '';
	if (!name && savedBoard) {
		const key = `lobby.boards.${savedBoard}`;
		const localized = translate(key);
		name = localized && localized !== key ? localized : savedBoard;
	}
	return name ? `${name} - Corro` : 'Corro';
}
