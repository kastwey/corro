// journeyCardArt.ts — engine-rendered card FACES for journey decks. Every package gets a
// dignified visual deck for FREE, straight from its cards.json data (type, kind, value,
// name): colour-coded card frames, traffic-sign icons for the classic kinds, sensible
// fallbacks for kinds the engine has never seen. A package ART SKIN can later replace
// these faces with images; the contract stays the same.
//
// ACCESSIBILITY: everything built here is aria-hidden decoration for sighted players.
// The accessible card is, and remains, the hand row's aria-label.

import { escapeHtml } from './escapeHtml.js';
import type { JourneyCardDef } from './models.js';

/** Options threaded from the game's rules (the speed-limit sign shows the ACTUAL cap). */
export interface JourneyCardArtOptions {
	limitCap?: number;
}

// ── Icons (compact inline SVG; traffic-sign aesthetic to match the road theme) ──

function svg(inner: string): string {
	return `<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${inner}</svg>`;
}

function trafficLightIcon(lit: 'red' | 'green'): string {
	return svg(
		`<rect x="10" y="1" width="12" height="30" rx="4" fill="#263238"/>`
		+ `<circle cx="16" cy="8" r="3.4" fill="${lit === 'red' ? '#ef5350' : '#455a64'}"/>`
		+ `<circle cx="16" cy="16" r="3.4" fill="#455a64"/>`
		+ `<circle cx="16" cy="24" r="3.4" fill="${lit === 'green' ? '#66bb6a' : '#455a64'}"/>`);
}

function fuelIcon(out: boolean): string {
	return svg(
		`<rect x="6" y="4" width="13" height="24" rx="2" fill="${out ? '#c62828' : '#2e7d32'}"/>`
		+ `<rect x="9" y="7" width="7" height="6" rx="1" fill="#eceff1"/>`
		+ `<path d="M21 10h3v12a3 3 0 0 1-6 0" fill="none" stroke="#546e7a" stroke-width="2.4"/>`
		+ `<rect x="4" y="28" width="17" height="3" rx="1" fill="#546e7a"/>`
		+ (out ? `<path d="M3 3l26 26" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>` : ''));
}

function tireIcon(flat: boolean): string {
	return flat
		? svg(
			`<path d="M16 4a12 12 0 0 1 12 12c0 5-2 8-4 10H8c-2-2-4-5-4-10A12 12 0 0 1 16 4z" fill="#37474f"/>`
			+ `<ellipse cx="16" cy="17" rx="5.5" ry="5" fill="#eceff1"/>`
			+ `<path d="M4 27h24" stroke="#c62828" stroke-width="3" stroke-linecap="round"/>`)
		: svg(
			`<circle cx="16" cy="16" r="12" fill="#37474f"/>`
			+ `<circle cx="16" cy="16" r="5.5" fill="#eceff1"/>`
			+ `<path d="M16 5v5M16 22v5M5 16h5M22 16h5" stroke="#eceff1" stroke-width="2"/>`);
}

function crashIcon(): string {
	return svg(
		`<path d="M16 2l3.4 7.2 7.6-3.2-3 7 7 3-7.4 2.6L26 26l-7.6-2.4L16 31l-2.4-7.4L6 26l2.4-7.6L1 16l7-3-3-7 7.6 3.2z"`
		+ ` fill="#ef5350" stroke="#8e0000" stroke-width="1"/>`);
}

function wrenchIcon(): string {
	return svg(
		`<path d="M28 9.5a7 7 0 0 1-9.4 6.6L10 24.7A3.2 3.2 0 1 1 5.4 20l8.6-8.6A7 7 0 0 1 22.6 2l-4 4 1.2 4.2L24 11.4l4-4z"`
		+ ` fill="#2e7d32"/>`);
}

function shieldIcon(): string {
	return svg(
		`<path d="M16 2l11 4v9c0 7-4.6 11.6-11 14C9.6 26.6 5 22 5 15V6z" fill="#f9a825" stroke="#c17900" stroke-width="1.5"/>`
		+ `<path d="M16 8l2 4.2 4.6.5-3.4 3.1 1 4.5-4.2-2.4-4.2 2.4 1-4.5-3.4-3.1 4.6-.5z" fill="#fff8e1"/>`);
}

function limitSignIcon(cap: number, lifted: boolean): string {
	return svg(
		`<circle cx="16" cy="16" r="13" fill="#fff" stroke="${lifted ? '#78909c' : '#c62828'}" stroke-width="4"/>`
		+ `<text x="16" y="20.5" text-anchor="middle" font-size="12" font-weight="700" fill="#263238"`
		+ ` font-family="system-ui, sans-serif">${cap}</text>`
		+ (lifted ? `<path d="M6 26L26 6" stroke="#78909c" stroke-width="3.5" stroke-linecap="round"/>` : ''));
}

function warningIcon(): string {
	return svg(
		`<path d="M16 3L30 28H2z" fill="#fff" stroke="#c62828" stroke-width="3" stroke-linejoin="round"/>`
		+ `<path d="M16 12v7" stroke="#263238" stroke-width="3" stroke-linecap="round"/>`
		+ `<circle cx="16" cy="23.5" r="1.8" fill="#263238"/>`);
}

/**
 * The icon for a hazard KIND, as its attack ("this just hit you") or its remedy ("fixed")
 * face. The classic kinds get real signs; unknown kinds return null (callers fall back by
 * card type). Also reused by the road strip's per-car state badges.
 */
export function journeyKindIconSvg(
	kind: string | null | undefined,
	variant: 'attack' | 'remedy',
	limitCap = 50,
): string | null {
	switch (kind) {
		case 'stop': return trafficLightIcon(variant === 'attack' ? 'red' : 'green');
		case 'speedLimit': return limitSignIcon(limitCap, variant === 'remedy');
		case 'outOfGas': return fuelIcon(variant === 'attack');
		case 'flat': return tireIcon(variant === 'attack');
		case 'accident': return variant === 'attack' ? crashIcon() : wrenchIcon();
		default: return null;
	}
}

// ── Card faces ────────────────────────────────────────────────────────────────

/** The card types the frame knows how to colour; anything else wears the attack red. */
const CARD_TYPES = new Set(['distance', 'attack', 'remedy', 'immunity']);

/**
 * A card FACE: colour-framed by type, a big kilometre figure for distances, the kind's
 * sign for attacks/remedies, a golden shield for immunities — and the localized name.
 */
export function journeyCardArtHtml(
	def: JourneyCardDef,
	name: string,
	opts: JourneyCardArtOptions = {},
): string {
	const type = CARD_TYPES.has(def.type) ? def.type : 'attack';
	let face: string;
	if (type === 'distance') {
		face = `<span class="jcard__value">${Number(def.value) || 0}</span><span class="jcard__unit">km</span>`;
	} else if (type === 'immunity') {
		face = shieldIcon();
	} else {
		face = journeyKindIconSvg(def.kind, type as 'attack' | 'remedy', opts.limitCap ?? 50)
			?? (type === 'remedy' ? wrenchIcon() : warningIcon());
	}
	return `<span class="jcard jcard--${type}">`
		+ `<span class="jcard__face">${face}</span>`
		+ `<span class="jcard__name">${escapeHtml(name)}</span>`
		+ `</span>`;
}

/** The golden immunity shield, reusable outside card faces (dashboard badges). */
export function journeyShieldIconSvg(): string {
	return shieldIcon();
}

/** A card BACK (the draw pile, the hand's deck-counter row), with an optional big label. */
export function journeyCardBackHtml(label = ''): string {
	return `<span class="jcard jcard--back">`
		+ `<span class="jcard__back-pattern"></span>`
		+ (label ? `<span class="jcard__back-label">${escapeHtml(label)}</span>` : '')
		+ `</span>`;
}
