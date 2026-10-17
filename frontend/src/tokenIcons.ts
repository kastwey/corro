/**
 * tokenIcons.ts — inline SVG icons for the player tokens (game pieces).
 *
 * These replace the previous emoji tokens. They are purely decorative:
 * every render marks the SVG `aria-hidden="true"` and `focusable="false"`,
 * and the accessible information is always the token's localized NAME, which
 * callers render as visible/located text next to the icon.
 *
 * Icons are package drawings on a 24x24 grid, server-sanitised to a closed SVG subset and
 * validated again here (svgArt.ts). A part drawn in `currentColor` inherits the surrounding
 * text/player color, so a token keeps its player's colour wherever the engine shows it.
 */

import type { TokenInfo } from './models.js';
import { sanitizeSvgArt } from './svgArt.js';

// Tokens a package brought (id -> {svg path-data, nameKey}); empty for built-in boards.
const packageTokens = new Map<string, TokenInfo>();

/** Registers the current game/package's tokens so {@link tokenIconHtml} renders their icons. */
export function setPackageTokens(tokens: TokenInfo[] | undefined): void {
	packageTokens.clear();
	for (const t of tokens ?? []) packageTokens.set(t.id, t);
}

/** The package token ids (in declaration order), or [] when the built-in set is in use. */
export function packageTokenIds(): string[] { return [...packageTokens.keys()]; }

/** The i18n name key for a package token id (for the accessible/visible label), if any. */
export function packageTokenNameKey(id: string): string | undefined { return packageTokens.get(id)?.nameKey; }

/**
 * Return decorative inline SVG markup for a token. Always `aria-hidden`. Every board ships its own
 * tokens (the engine has no built-in set), so this renders the package token's drawing; a generic
 * disc is only a defensive fallback for an unknown id or a drawing that fails validation.
 * @param token Token id.
 * @param className CSS class for the <svg> element.
 */
export function tokenIconHtml(token: string, className = 'token-icon'): string {
	const inner = sanitizeSvgArt(packageTokens.get(token)?.svg)
		?? '<circle cx="12" cy="12" r="7"/>'; // unknown id or rejected drawing: neutral disc
	return `<svg class="${className}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">${inner}</svg>`;
}
