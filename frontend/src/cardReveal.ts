/**
 * CardReveal - Visual reveal for Fortune / Treasury cards.
 *
 * Shows a themed, animated card in the center of the screen when a card is
 * drawn, giving players time to read it WITHOUT blocking the turn:
 *  - Non-modal: it never traps keyboard focus nor gates input.
 *  - Decorative for assistive tech (aria-hidden): screen readers already get
 *    the card text from the live region + the persistent notification copy.
 *  - Auto-dismiss on a read-time budget, paused while the pointer hovers it.
 *  - Dismiss with Esc or a click anywhere.
 *  - Respects prefers-reduced-motion (skips the 3D flip).
 */

import { tSync } from './i18nBinder.js';
import { escapeHtml } from './escapeHtml.js';
import { cardArtStyle, cardArtSvg } from './cardArt.js';
import type { CardDrawnNotification } from './models.js';

const MIN_VISIBLE_MS = 3000;
const MAX_VISIBLE_MS = 9000;
const BASE_READ_MS = 2500;
const MS_PER_WORD = 350;
const FLIP_MS = 600;

class CardRevealClass {
	private overlay: HTMLElement | null = null;
	private cardEl: HTMLElement | null = null;
	private progressEl: HTMLElement | null = null;

	private hideTimeout: number | null = null;
	private flipTimeout: number | null = null;
	private deadline = 0;
	private remainingMs = 0;
	private paused = false;
	private keyListener: ((e: KeyboardEvent) => void) | null = null;

	init(): void {
		if (this.overlay) return;

		this.overlay = document.createElement('div');
		this.overlay.className = 'card-reveal-overlay';
		this.overlay.setAttribute('aria-hidden', 'true');
		this.overlay.hidden = true;
		this.overlay.addEventListener('click', () => this.hide());

		document.body.appendChild(this.overlay);
	}

	/**
	 * Reveal a drawn card. Self-contained: all text comes from the payload.
	 */
	show(card: CardDrawnNotification): void {
		if (!this.overlay) this.init();
		if (!this.overlay) return;

		// If a card is already showing, replace it cleanly.
		this.clearTimers();

		// Both classic and package cards resolve their text from an i18n key (a package key
		// resolves against the merged package i18n). The text/labels go into innerHTML and a
		// package can override them, so escape everything.
		const isClassicDeck = card.deckType === 'chance' || card.deckType === 'community';
		const deck = isClassicDeck ? card.deckType : 'community'; // CSS styling slot
		const deckLabel = escapeHtml(isClassicDeck ? tSync(`game.card_deck_${card.deckType}`) : tSync('game.card_deck_generic'));
		const title = card.titleKey ? escapeHtml(tSync(card.titleKey, card.descriptionVars)) : '';
		const description = escapeHtml(tSync(card.descriptionKey, card.descriptionVars));
		const illustration = cardArtSvg({
			type: card.artType ?? 'card',
			svg: card.svg,
			artColor: card.artColor,
		}, 'card-reveal__art-svg');
		const illustrationStyle = cardArtStyle(card.artColor, '--card-art-accent');

		const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

		this.overlay.innerHTML = `
			<div class="card-reveal card-reveal--${deck} ${reduceMotion ? 'card-reveal--static' : ''}">
				<div class="card-reveal__inner">
					<div class="card-reveal__face card-reveal__back">
						<span class="card-reveal__back-label">${deckLabel}</span>
					</div>
					<div class="card-reveal__face card-reveal__front">
						<div class="card-reveal__deck">
							<span class="card-reveal__deck-label">${deckLabel}</span>
						</div>
						<div class="card-reveal__art"${illustrationStyle}>${illustration}</div>
						${title ? `<h3 class="card-reveal__title">${title}</h3>` : ''}
						<p class="card-reveal__desc">${description}</p>
					</div>
				</div>
				<div class="card-reveal__progress"><span class="card-reveal__progress-bar"></span></div>
			</div>
		`;

		this.cardEl = this.overlay.querySelector('.card-reveal');
		this.progressEl = this.overlay.querySelector('.card-reveal__progress-bar');

		// Clicking the card itself should not bubble to the overlay's dismiss,
		// but hovering it should pause the auto-dismiss so players can read.
		if (this.cardEl) {
			this.cardEl.addEventListener('mouseenter', () => this.pause());
			this.cardEl.addEventListener('mouseleave', () => this.resume());
		}

		this.overlay.hidden = false;
		// Force reflow so the entrance/flip transition runs.
		void this.overlay.offsetWidth;
		this.overlay.classList.add('is-visible');
		if (this.cardEl && !reduceMotion) {
			this.flipTimeout = window.setTimeout(() => {
				this.cardEl?.classList.add('is-flipped');
			}, 30);
		} else {
			this.cardEl?.classList.add('is-flipped');
		}

		this.remainingMs = this.computeReadTime(title, description);
		this.startCountdown(reduceMotion ? 0 : FLIP_MS);

		this.keyListener = (e: KeyboardEvent) => {
			if (e.key === 'Escape') this.hide();
		};
		document.addEventListener('keydown', this.keyListener);
	}

	private computeReadTime(title: string, description: string): number {
		const words = `${title} ${description}`.trim().split(/\s+/).filter(Boolean).length;
		const budget = BASE_READ_MS + words * MS_PER_WORD;
		return Math.min(MAX_VISIBLE_MS, Math.max(MIN_VISIBLE_MS, budget));
	}

	private startCountdown(delayMs: number): void {
		this.paused = false;
		this.deadline = Date.now() + delayMs + this.remainingMs;

		// Drive the progress bar via a CSS transition over the full duration.
		if (this.progressEl) {
			const total = delayMs + this.remainingMs;
			this.progressEl.style.transition = 'none';
			this.progressEl.style.transform = 'scaleX(1)';
			void this.progressEl.offsetWidth;
			this.progressEl.style.transition = `transform ${total}ms linear`;
			this.progressEl.style.transform = 'scaleX(0)';
		}

		this.hideTimeout = window.setTimeout(() => this.hide(), delayMs + this.remainingMs);
	}

	private pause(): void {
		if (this.paused || this.hideTimeout === null) return;
		this.paused = true;
		this.remainingMs = Math.max(0, this.deadline - Date.now());
		if (this.hideTimeout !== null) {
			clearTimeout(this.hideTimeout);
			this.hideTimeout = null;
		}
		if (this.progressEl) {
			// Freeze the bar at its current width.
			const computed = getComputedStyle(this.progressEl).transform;
			this.progressEl.style.transition = 'none';
			this.progressEl.style.transform = computed === 'none' ? 'scaleX(0)' : computed;
		}
		this.cardEl?.classList.add('is-paused');
	}

	private resume(): void {
		if (!this.paused) return;
		this.cardEl?.classList.remove('is-paused');
		this.startCountdown(0);
	}

	hide(): void {
		if (!this.overlay || this.overlay.hidden) return;
		this.clearTimers();
		this.overlay.classList.remove('is-visible');
		const overlay = this.overlay;
		window.setTimeout(() => {
			if (!overlay.classList.contains('is-visible')) {
				overlay.hidden = true;
				overlay.innerHTML = '';
			}
		}, 250);
		this.cardEl = null;
		this.progressEl = null;
	}

	private clearTimers(): void {
		if (this.hideTimeout !== null) {
			clearTimeout(this.hideTimeout);
			this.hideTimeout = null;
		}
		if (this.flipTimeout !== null) {
			clearTimeout(this.flipTimeout);
			this.flipTimeout = null;
		}
		if (this.keyListener) {
			document.removeEventListener('keydown', this.keyListener);
			this.keyListener = null;
		}
		this.paused = false;
	}
}

export const cardReveal = new CardRevealClass();
