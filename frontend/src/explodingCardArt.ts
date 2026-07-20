// explodingCardArt.ts — the exploding family's neutral card frame.
//
// Card identity and illustration belong to the package. cards/<id>.svg is loaded as safe
// path-data and wins automatically; an absent SVG gets a mechanics-only fallback selected by
// type. This module must never know a shipped package id, card id, character or title.

import { cardArtStyle, cardArtSvg } from './cardArt.js';
import { escapeHtml } from './escapeHtml.js';
import type { ExplodingCardDef } from './models.js';

const FACE_CLASS: Readonly<Record<string, string>> = {
	bomb: 'bomb',
	defuse: 'defuse',
	nope: 'nope',
	attack: 'attack',
	skip: 'skip',
	favor: 'favor',
	shuffle: 'shuffle',
	seeFuture: 'future',
	cat: 'cat',
};

/** Package illustration when present; otherwise a neutral icon for the generic card type. */
export function explodingCardArtHtml(def: ExplodingCardDef, name: string): string {
	const type = FACE_CLASS[def.type] ?? 'mystery';
	return `<span class="xcard xcard--${type}"${cardArtStyle(def.artColor, '--xcard-accent', '--xcard-soft')}>`
		+ `<span class="xcard__picture">${cardArtSvg(def, 'xcard__svg')}</span>`
		+ `<span class="xcard__name">${escapeHtml(name)}</span>`
		+ `</span>`;
}

/** The shared neutral exploding-family back, optionally carrying the remaining-card count. */
export function explodingCardBackHtml(label = ''): string {
	return `<span class="xcard xcard--back">`
		+ `<span class="xcard__back-burst"></span>`
		+ `<span class="xcard__back-cat">✦</span>`
		+ (label ? `<span class="xcard__back-label">${escapeHtml(label)}</span>` : '')
		+ `</span>`;
}

/** Empty discard placeholder, kept card-shaped so the table does not jump before the first play. */
export function explodingEmptyCardHtml(label = '—'): string {
	return `<span class="xcard xcard--empty"><span class="xcard__empty-label">${escapeHtml(label)}</span></span>`;
}
