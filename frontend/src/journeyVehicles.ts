// journeyVehicles.ts — side-view vehicle art for the journey road strip.
//
// Each seat's marker is drawn as the VEHICLE its player picked in the lobby (live-play
// bug: a player chose the motorbike and still saw a car). The art is keyed by the
// package's token id — the shipped journey pack names them in Spanish (coche, moto,
// furgoneta, autobús, camión, taxi) — and every body panel uses `currentColor` so the
// seat's colour tints it, exactly like the original single car did. Unknown token ids
// fall back to the car, so any future pack still renders something sensible.

const WHEEL = (cx: number, r = 4.2): string =>
	`<circle cx="${cx}" cy="20" r="${r}" fill="#263238"/><circle cx="${cx}" cy="20" r="${(r * 0.43).toFixed(1)}" fill="#b0bec5"/>`;

const OPEN = '<svg viewBox="0 0 48 26" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">';
const CLOSE = '</svg>';

/** The classic side-view car (the strip's original marker). */
const CAR =
	OPEN
	+ '<path d="M2 17c0-4 3-6 8-7l5-5c1-1 2-1.5 4-1.5h8c2 0 3 .5 4 1.5l5 5c5 1 10 3 10 7v2c0 1-1 2-2 2H4c-1 0-2-1-2-2z" fill="currentColor"/>'
	+ '<path d="M17 10l3.5-3.5c.5-.5 1-.8 2-.8h5c1 0 1.7.3 2.3 1L33 10z" fill="#e3f2fd" opacity="0.92"/>'
	+ WHEEL(13) + WHEEL(36)
	+ CLOSE;

/** The car with a roof sign: the taxi. The sign stays amber on purpose (it IS the taxi). */
const TAXI =
	OPEN
	+ '<rect x="20" y="1" width="9" height="4.5" rx="1.2" fill="#f2c200"/>'
	+ '<path d="M2 17c0-4 3-6 8-7l5-5c1-1 2-1.5 4-1.5h8c2 0 3 .5 4 1.5l5 5c5 1 10 3 10 7v2c0 1-1 2-2 2H4c-1 0-2-1-2-2z" fill="currentColor"/>'
	+ '<path d="M17 10l3.5-3.5c.5-.5 1-.8 2-.8h5c1 0 1.7.3 2.3 1L33 10z" fill="#e3f2fd" opacity="0.92"/>'
	+ WHEEL(13) + WHEEL(36)
	+ CLOSE;

/** Two big wheels, an open frame and a rider silhouette: the motorbike. */
const MOTO =
	OPEN
	+ WHEEL(10, 5.4) + WHEEL(38, 5.4)
	+ '<path d="M10 20l7-9h9l6 5 6 4" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
	+ '<path d="M15 11h10" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/>'
	+ '<path d="M32 10l5-5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>'
	+ '<circle cx="38" cy="4.4" r="1.7" fill="currentColor"/>'
	+ CLOSE;

/** A boxy body with a sloped cab: the van. */
const FURGONETA =
	OPEN
	+ '<path d="M3 19v-9c0-1.6 1.1-2.7 2.7-2.7H28l7 4.7 8 2c1.2.3 2 1.2 2 2.4V19c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2z" fill="currentColor"/>'
	+ '<path d="M28.5 9l4.8 3.2h-6.6V9z" fill="#e3f2fd" opacity="0.92"/>'
	+ '<rect x="6" y="9.5" width="8" height="4.2" rx="1" fill="#e3f2fd" opacity="0.92"/>'
	+ WHEEL(12) + WHEEL(37)
	+ CLOSE;

/** A long single body with a row of windows: the bus. */
const AUTOBUS =
	OPEN
	+ '<rect x="2" y="5.5" width="44" height="14" rx="2.6" fill="currentColor"/>'
	+ '<rect x="6" y="8.5" width="6.4" height="4.4" rx="1" fill="#e3f2fd" opacity="0.92"/>'
	+ '<rect x="15" y="8.5" width="6.4" height="4.4" rx="1" fill="#e3f2fd" opacity="0.92"/>'
	+ '<rect x="24" y="8.5" width="6.4" height="4.4" rx="1" fill="#e3f2fd" opacity="0.92"/>'
	+ '<rect x="33" y="8.5" width="8.5" height="4.4" rx="1" fill="#e3f2fd" opacity="0.92"/>'
	+ WHEEL(11) + WHEEL(37)
	+ CLOSE;

/** A cab pulling a box trailer (three axles): the truck. */
const CAMION =
	OPEN
	+ '<rect x="2" y="6" width="27" height="12" rx="1.8" fill="currentColor" opacity="0.82"/>'
	+ '<path d="M31 9h8.2c.9 0 1.5.3 2 1l3.2 4.3c.4.5.6 1 .6 1.7V18c0 1.1-.9 2-2 2H31z" fill="currentColor"/>'
	+ '<path d="M32.5 10.5h5.6l2.8 3.8h-8.4z" fill="#e3f2fd" opacity="0.92"/>'
	+ WHEEL(9) + WHEEL(22) + WHEEL(38)
	+ CLOSE;

const BY_TOKEN: Record<string, string> = {
	coche: CAR,
	taxi: TAXI,
	moto: MOTO,
	furgoneta: FURGONETA,
	autobus: AUTOBUS,
	camion: CAMION,
};

/** The side-view SVG for a seat's chosen token; unknown/missing ids get the car. */
export function vehicleSvgFor(tokenId: string | undefined): string {
	return BY_TOKEN[tokenId ?? ''] ?? CAR;
}

/** The canonical vehicle key actually drawn for a token (for the data-vehicle hook/tests). */
export function vehicleKeyFor(tokenId: string | undefined): string {
	return tokenId && tokenId in BY_TOKEN ? tokenId : 'coche';
}
