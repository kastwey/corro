/**
 * CardFlight — the sighted-player "draw" animation.
 *
 * When a player draws a Fortune / Treasury card, a card sails out of its deck pile in
 * the center of the board, tumbling as it grows, toward the drawing player's token. It is a
 * PARALLEL visual layer (like {@link ./boardToast} and {@link ./cardReveal}): the host is
 * `aria-hidden`, it never touches the live region, never steals focus and never gates the
 * turn. The card's flavour text is still spoken by the server's announcement stream and read
 * in the centered {@link ./cardReveal} that follows the flight.
 *
 * The flight maths lives in the pure, unit-tested {@link flightStep}; the class only does the
 * DOM/animation orchestration. The caller skips the flight under `prefers-reduced-motion`, and
 * it degrades gracefully where the Web Animations API is missing (resolves immediately).
 */
import { tSync } from './i18nBinder.js';
import type { CardDrawnNotification } from './models.js';

/** A minimal viewport rectangle — the subset of {@link DOMRect} the geometry needs. */
export interface FlightRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

/** One waypoint of the flight: where to translate the card's top-left, and its scale. */
export interface FlightStep {
	x: number;
	y: number;
	scale: number;
}

/**
 * Positions a card of natural size {@link cardW}×{@link cardH} so its CENTER sits on the
 * center of {@link target}, scaled so the card's height matches the target height times
 * {@link scaleBoost}. Pure (no DOM) so the flight maths is unit-testable. `scaleBoost` lets
 * the landing waypoint end a little larger than a tiny token, so the card is glanceable as it
 * arrives.
 */
export function flightStep(target: FlightRect, cardW: number, cardH: number, scaleBoost = 1): FlightStep {
	const scale = (target.height / cardH) * scaleBoost;
	const x = target.left + target.width / 2 - cardW / 2;
	const y = target.top + target.height / 2 - cardH / 2;
	return { x, y, scale };
}

/** Natural (unscaled) size of the flying card element, in CSS pixels. */
const CARD_W = 150;
const CARD_H = 210;
/** A token is tiny; end the flight a few times larger so the card reads as it lands. */
const LANDING_SCALE_BOOST = 3.5;
/** A short overshoot as the card arrives, then it settles — a satisfying little "pop". */
const OVERSHOOT = 1.12;
const FLIGHT_MS = 1000;

class CardFlightClass {
	/**
	 * Flies a card from its deck pile ({@link deckRect}) to the drawing player's token
	 * ({@link tokenRect}): it tumbles and grows on the way, lands on the token with a small
	 * overshoot-and-settle "pop", then holds there for a beat. Resolves once the flight ends
	 * (or immediately if the Web Animations API is unavailable), so the caller can chain the
	 * centered reveal — the brief hold makes the "the card came to YOU" moment register
	 * before the card re-centers to be read.
	 */
	play(card: CardDrawnNotification, deckRect: FlightRect, tokenRect: FlightRect): Promise<void> {
		const deck = card.deckType === 'chance' ? 'chance' : 'community';
		const el = document.createElement('div');
		el.className = `card-flight card-flight--${deck}`;
		el.setAttribute('aria-hidden', 'true');
		el.style.width = `${CARD_W}px`;
		el.style.height = `${CARD_H}px`;
		el.innerHTML = `<span class="card-flight__label">${tSync(`game.card_deck_${deck}`)}</span>`;
		document.body.appendChild(el);

		const start = flightStep(deckRect, CARD_W, CARD_H, 1);
		const mid = flightStep(
			{ left: (deckRect.left + tokenRect.left) / 2, top: Math.min(deckRect.top, tokenRect.top) - 40, width: tokenRect.width, height: tokenRect.height },
			CARD_W,
			CARD_H,
			(1 + LANDING_SCALE_BOOST) / 2,
		);
		const end = flightStep(tokenRect, CARD_W, CARD_H, LANDING_SCALE_BOOST);

		const remove = () => el.remove();

		if (typeof el.animate !== 'function') {
			remove();
			return Promise.resolve();
		}

		const anim = el.animate(
			[
				// Out of the deck, small and tilted.
				{ transform: `translate(${start.x}px, ${start.y}px) scale(${start.scale}) rotate(-12deg)`, opacity: 0.25, offset: 0 },
				// Arc up and across, tumbling, at full opacity.
				{ transform: `translate(${mid.x}px, ${mid.y}px) scale(${mid.scale}) rotate(200deg)`, opacity: 1, offset: 0.5 },
				// Arrive at the token with a slight overshoot...
				{ transform: `translate(${end.x}px, ${end.y}px) scale(${end.scale * OVERSHOOT}) rotate(372deg)`, opacity: 1, offset: 0.72 },
				// ...settle to its resting size on the token...
				{ transform: `translate(${end.x}px, ${end.y}px) scale(${end.scale}) rotate(360deg)`, opacity: 1, offset: 0.84 },
				// ...and hold there for a beat before the centered reveal takes over.
				{ transform: `translate(${end.x}px, ${end.y}px) scale(${end.scale}) rotate(360deg)`, opacity: 1, offset: 1 },
			],
			{ duration: FLIGHT_MS, easing: 'cubic-bezier(0.3, 0.7, 0.2, 1)', fill: 'forwards' },
		);

		return new Promise<void>((resolve) => {
			const done = () => {
				remove();
				resolve();
			};
			anim.onfinish = done;
			anim.oncancel = done;
		});
	}
}

export const cardFlight = new CardFlightClass();
