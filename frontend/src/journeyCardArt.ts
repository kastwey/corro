// journeyCardArt.ts — neutral engine-rendered faces for journey decks.
//
// A package may supply assets/cards/<id>.svg; its sanitized geometry always replaces the picture.
// Without it, the engine draws only generic mechanics (distance, attack, remedy, immunity).
// Package-defined hazard KIND ids never appear here.

import { cardArtStyle, packageCardArtSvg } from './cardArt.js';
import { escapeHtml } from './escapeHtml.js';
import type { JourneyCardDef } from './models.js';

function svg(inner: string): string {
	return `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${inner}</svg>`;
}

function warningIcon(): string {
	return svg(
		`<path d="M16 3L30 28H2z" fill="#fff" stroke="#a52d32" stroke-width="3" stroke-linejoin="round"/>`
		+ `<path d="M16 12v7" stroke="#263238" stroke-width="3" stroke-linecap="round"/>`
		+ `<circle cx="16" cy="23.5" r="1.8" fill="#263238"/>`);
}

function wrenchIcon(): string {
	return svg(
		`<path d="M28 9.5a7 7 0 0 1-9.4 6.6L10 24.7A3.2 3.2 0 1 1 5.4 20l8.6-8.6A7 7 0 0 1 22.6 2l-4 4 1.2 4.2L24 11.4l4-4z"`
		+ ` fill="#147353"/>`);
}

function shieldIcon(): string {
	return svg(
		`<path d="M16 2l11 4v9c0 7-4.6 11.6-11 14C9.6 26.6 5 22 5 15V6z" fill="#d39b13" stroke="#815d00" stroke-width="1.5"/>`
		+ `<path d="M16 8l2 4.2 4.6.5-3.4 3.1 1 4.5-4.2-2.4-4.2 2.4 1-4.5-3.4-3.1 4.6-.5z" fill="#fff8e1"/>`);
}

/** Package art for a hazard card, or the neutral warning used by public state badges. */
export function journeyHazardIconSvg(pathData?: string | null, artColor?: string | null): string {
	const packageSvg = packageCardArtSvg(pathData, 'journey-hazard-art');
	return packageSvg
		? `<span class="journey-package-icon"${cardArtStyle(artColor, '--journey-art-accent')}>${packageSvg}</span>`
		: warningIcon();
}

/** A card face: package picture first, otherwise generic type/value, then localized name. */
export function journeyCardArtHtml(def: JourneyCardDef, name: string): string {
	const type = ['distance', 'attack', 'remedy', 'immunity'].includes(def.type) ? def.type : 'attack';
	let face = packageCardArtSvg(def.svg, 'journey-package-art');
	if (!face) {
		if (type === 'distance') {
			face = `<span class="jcard__value">${Number(def.value) || 0}</span><span class="jcard__unit">km</span>`;
		} else if (type === 'immunity') {
			face = shieldIcon();
		} else {
			face = type === 'remedy' ? wrenchIcon() : warningIcon();
		}
	}
	return `<span class="jcard jcard--${type}"${cardArtStyle(def.artColor, '--jcard-accent')}>`
		+ `<span class="jcard__face">${face}</span>`
		+ `<span class="jcard__name">${escapeHtml(name)}</span>`
		+ `</span>`;
}

export function journeyShieldIconSvg(pathData?: string | null, artColor?: string | null): string {
	const packageSvg = packageCardArtSvg(pathData, 'journey-immunity-art');
	return packageSvg
		? `<span class="journey-package-icon"${cardArtStyle(artColor, '--journey-art-accent')}>${packageSvg}</span>`
		: shieldIcon();
}

/** A neutral card back (the draw pile and the hand's deck-counter row). */
export function journeyCardBackHtml(label = ''): string {
	return `<span class="jcard jcard--back">`
		+ `<span class="jcard__back-pattern"></span>`
		+ (label ? `<span class="jcard__back-label">${escapeHtml(label)}</span>` : '')
		+ `</span>`;
}
