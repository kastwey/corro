// cardArt.ts — package-owned card illustrations plus neutral engine fallbacks.
//
// The package contract is deliberately the same safe subset as player tokens: an optional
// cards/<id>.svg is flattened by the server to path-data on a 64×64 canvas. The client still
// sanitizes that data before putting it in an attribute. Package geometry always wins; when it
// is absent, these helpers draw only generic MECHANICS (attack, remedy, number, etc.) and never
// branch on a shipped package id, card id, token id or title.
//
// ACCESSIBILITY: every SVG is aria-hidden decoration. The hand row / reveal text remains the
// accessible source of the card's localized name and rules.

import { escapeHtml } from './escapeHtml.js';

export interface CardArtSource {
	type: string;
	svg?: string | null;
	value?: number | null;
	artColor?: string | null;
}

/** Defense in depth for server-sanitized SVG path-data. Quotes and markup cannot survive. */
export function sanitizeCardPathData(pathData: string): string {
	return pathData.replace(/[^0-9A-Za-z.,\-\s]/g, '');
}

/** Only a complete #RRGGBB value may enter a style attribute. */
export function normalizeCardArtColor(value: string | null | undefined): string | null {
	return value && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
}

/** Inline custom properties are required for package data; every interpolated value is hex-only. */
export function cardArtStyle(
	value: string | null | undefined,
	accentVariable: string,
	softVariable?: string,
): string {
	const color = normalizeCardArtColor(value);
	if (!color) return '';
	const soft = softVariable
		? `;${softVariable}:color-mix(in srgb, ${color} 18%, #fffdf5)`
		: '';
	return ` style="${accentVariable}:${color}${soft}"`;
}

function svgColorStyle(value: string | null | undefined): string {
	const color = normalizeCardArtColor(value);
	return color ? ` style="color:${color}"` : '';
}

function safeClass(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9_-]/g, '') || 'unknown';
}

/** Render package path-data on the format's fixed 64×64 art canvas. */
export function packageCardArtSvg(
	pathData: string | null | undefined,
	className = 'card-art__svg',
	artColor?: string | null,
): string | null {
	if (!pathData) return null;
	const safe = sanitizeCardPathData(pathData).trim();
	if (!/^[Mm]/.test(safe) || !/\d/.test(safe)) return null;
	return `<svg class="${className}" viewBox="0 0 64 64" fill="currentColor"${svgColorStyle(artColor)}`
		+ ` aria-hidden="true" focusable="false" data-card-art="package">`
		+ `<path d="${safe}" fill-rule="evenodd"/></svg>`;
}

function svg(inner: string, className: string, artColor?: string | null): string {
	return `<svg class="${className}" viewBox="0 0 64 64" fill="currentColor"${svgColorStyle(artColor)}`
		+ ` aria-hidden="true" focusable="false" data-card-art="neutral">${inner}</svg>`;
}

const BURST = `<path d="M32 3l5 14 13-7-4 15 15 2-12 10 10 11-16-2-1 15-10-12-10 12-1-15-16 2 10-11L3 27l15-2-4-15 13 7z"/>`;
const SHIELD = `<path d="M32 4l23 9v17c0 14-9 24-23 30C18 54 9 44 9 30V13zm-3 15v9H20v8h9v9h7v-9h9v-8h-9v-9z" fill-rule="evenodd"/>`;
const ARROW = `<path d="M7 43c8-17 22-25 39-21V12l13 14-13 14v-9c-13-3-23 2-31 17z"/>`;
const REVERSE = `<path d="M7 23L19 10v8h25c7 0 12 5 12 12h-8c0-3-2-5-5-5H19v9zm50 18L45 54v-8H20C13 46 8 41 8 34h8c0 3 2 5 5 5h24v-9z"/>`;
const STAR = `<path d="M32 4l7 18 20 1-15 13 5 20-17-11-17 11 5-20L5 23l20-1z"/>`;
const CARDS = `<path d="M11 11h31v42H11zm12-6h31v42h-7V12H23z" fill-rule="evenodd"/>`;
const CAT = `<path d="M14 28l5-17 13 10 13-10 6 17c4 16-5 30-19 30S10 44 14 28zm11 7a3 3 0 1 0 0 .1zm14 0a3 3 0 1 0 0 .1zM26 45c4 5 8 5 12 0l-6-4z" fill-rule="evenodd"/>`;
const PIECE = `<path d="M10 14h16c0-7 12-7 12 0h16v15c7 0 7 12 0 12v15H38c0-7-12-7-12 0H10V41c-7 0-7-12 0-12z"/>`;
const HEART = `<path d="M32 56C15 44 7 35 7 23 7 9 25 5 32 18 39 5 57 9 57 23c0 12-8 21-25 33z"/>`;

/** A neutral icon selected only from generic rule vocabulary. */
export function neutralCardArtSvg(
	type: string,
	value?: number | null,
	className = 'card-art__svg',
	artColor?: string | null,
): string {
	const normalized = safeClass(type);
	if (['number', 'distance', 'points'].includes(normalized) && Number.isFinite(value)) {
		return svg(`<text x="32" y="41" text-anchor="middle" font-size="28" font-weight="800"`
			+ ` font-family="system-ui, sans-serif">${Number(value)}</text>`, className, artColor);
	}
	if (['attack', 'bomb', 'drawtwo', 'wilddrawfour', 'plague', 'scraphands'].includes(normalized)) {
		return svg(BURST, className, artColor);
	}
	if (['remedy', 'defuse', 'immunity'].includes(normalized)) return svg(SHIELD, className, artColor);
	if (normalized === 'skip') return svg(ARROW, className, artColor);
	if (['reverse', 'shuffle', 'fullswap', 'swappiece'].includes(normalized)) return svg(REVERSE, className, artColor);
	if (normalized === 'cat') return svg(CAT, className, artColor);
	if (normalized === 'piece') return svg(PIECE, className, artColor);
	if (normalized === 'favor') return svg(HEART, className, artColor);
	if (['set', 'scale', 'majority', 'multiplier', 'dessert', 'extra', 'wild', 'special', 'stealpiece'].includes(normalized)) {
		return svg(STAR, className, artColor);
	}
	return svg(CARDS, className, artColor);
}

/** Package art wins; the neutral type drawing is the backwards-compatible fallback. */
export function cardArtSvg(source: CardArtSource, className = 'card-art__svg'): string {
	return packageCardArtSvg(source.svg, className, source.artColor)
		?? neutralCardArtSvg(source.type, source.value, className, source.artColor);
}

/** Generic full card face used by families that do not need a specialised numeric layout. */
export function genericCardArtHtml(source: CardArtSource, name: string): string {
	const type = safeClass(source.type);
	return `<span class="gcard gcard--${type}"${cardArtStyle(source.artColor, '--gcard-accent', '--gcard-soft')}>`
		+ `<span class="gcard__picture">${cardArtSvg(source, 'gcard__svg')}</span>`
		+ `<span class="gcard__name">${escapeHtml(name)}</span>`
		+ `</span>`;
}

/** Shared neutral back for hidden piles and hand counter rows. */
export function genericCardBackHtml(label = ''): string {
	return `<span class="gcard gcard--back">`
		+ `<span class="gcard__back-pattern"></span>`
		+ (label ? `<span class="gcard__back-label">${escapeHtml(label)}</span>` : '')
		+ `</span>`;
}

export function genericEmptyCardHtml(label = '—'): string {
	return `<span class="gcard gcard--empty"><span class="gcard__empty-label">${escapeHtml(label)}</span></span>`;
}
