/**
 * tokenIcons.ts — inline SVG icons for the player tokens (game pieces).
 *
 * These replace the previous emoji tokens. They are purely decorative:
 * every render marks the SVG `aria-hidden="true"` and `focusable="false"`,
 * and the accessible information is always the token's localized NAME, which
 * callers render as visible/located text next to the icon.
 *
 * Icons are original, minimal silhouettes drawn on a 24x24 grid and filled
 * with `currentColor`, so they inherit the surrounding text/player color.
 * No external dependency, no network, no license attribution required.
 */

import type { TokenInfo } from './models.js';

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

/** A package token's icon is path-data only; allow just safe path chars (it's uploaded content). */
function sanitizePathData(d: string): string { return d.replace(/[^0-9A-Za-z.,\-\s]/g, ''); }

/**
 * Return decorative inline SVG markup for a token. Always `aria-hidden`. Every board ships its own
 * tokens (the engine has no built-in set), so this renders the package token's path; a generic disc
 * is only a defensive fallback for an unknown id.
 * @param token Token id.
 * @param className CSS class for the <svg> element.
 */
export function tokenIconHtml(token: string, className = 'token-icon'): string {
	const pkg = packageTokens.get(token);
	const inner = pkg?.svg != null
		? `<path d="${sanitizePathData(pkg.svg)}"/>`   // package token: path-data only
		: '<circle cx="12" cy="12" r="7"/>';            // unknown id: neutral disc
	return `<svg class="${className}" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">${inner}</svg>`;
}
