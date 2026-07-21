import { familyHomeSurface } from './familyTraits.js';
import type { GameHomeSurface } from './familyTraits.js';

export const GAME_SURFACE_INTRO_KEYS = {
	board: 'game.surface_intro.board',
	hand: 'game.surface_intro.hand',
} as const satisfies Record<GameHomeSurface, string>;

/** The visible keyboard introduction that matches the active family's real home surface. */
export function gameSurfaceIntroKey(gameType: string | null | undefined): string {
	return GAME_SURFACE_INTRO_KEYS[familyHomeSurface(gameType)];
}

/**
 * Switch the initially generic introduction once the first authoritative state names the
 * family. The update is idempotent: rewriting this paragraph on every state change would
 * create needless accessibility-tree churn while a screen reader is reading the page.
 */
export function updateGameSurfaceIntro(
	element: HTMLElement,
	gameType: string | null | undefined,
	translate: (key: string) => string,
): boolean {
	const key = gameSurfaceIntroKey(gameType);
	if (element.getAttribute('data-i18n') === key) return false;

	element.setAttribute('data-i18n', key);
	const translated = translate(key);
	if (translated !== key) element.textContent = translated;
	return true;
}