import { tSync } from './i18nBinder.js';
import { resolveLocalizedVars } from './announcer.js';

/** The active i18next language (the authoritative source, kept in sync on language change). */
const currentLang = (): string => (window as { i18next?: { language?: string } }).i18next?.language ?? 'en';

/**
 * Transient, purely-visual center-board toasts. They are an accessibility feature for
 * SIGHTED players: a screen-reader user hears every game event spoken, but a sighted
 * player (e.g. a child) often misses what just happened — especially money movements —
 * unless they happen to watch the cash counter change. The toast surfaces the salient
 * events in the middle of the board, colour-coded so a gain (green) or a loss (red) is
 * recognisable at a glance without reading.
 *
 * It is a PARALLEL presentation layer to the spoken announcements and the earcons — it
 * never replaces them and never touches the live region: the toast host is `aria-hidden`,
 * so it neither speaks nor steals focus. Like the sound layer, it hooks the ONE central
 * place every announcement flows through (the `announce` wrapper in app.ts) and keys off
 * the announcement, so no command handler needs to know about toasts (DRY).
 */

/** Visual tone of a toast, driving its colour so the feedback reads at a glance. */
export type ToastTone = 'gain' | 'loss' | 'neutral';

/**
 * The curated set of announcements that surface a center-board toast, mapped to their
 * tone. Deliberately limited to meaningful game moments (money in/out, holding, milestones)
 * so it informs without overwhelming — the frequent chatter (dice rolls, turn changes,
 * navigation) is intentionally left out.
 */
const TOAST_TONE_BY_KEY: Readonly<Record<string, ToastTone>> = {
	// ── Money in / good milestones (green) ──
	'game.passed_through_go': 'gain',
	'game.landed_on_go': 'gain',
	'game.free_parking_collect': 'gain',
	'game.collected_from_all': 'gain',
	'game.group_completed': 'gain',
	'game.game_over': 'gain',
	// Recovering from debt is a relief — surface it as a positive cue.
	'game.debt_cleared': 'gain',

	// ── Money out / setbacks (red) ──
	'game.rent_paid': 'loss',
	'game.tax_paid': 'loss',
	'game.paid_all_players': 'loss',
	'game.paid_repairs': 'loss',
	'game.paid_holding_release_cost': 'loss',
	'game.send_to_holding': 'loss',
	'game.sent_to_holding_by_card': 'loss',
	'game.player_bankrupt': 'loss',

	// ── Acquisitions / building: money out but you get something (neutral) ──
	'game.property_purchased': 'neutral',
	'game.auction_won': 'neutral',
	'game.building_built': 'neutral',
	'game.buildings_sold': 'neutral',

	// ── Property state changes: surface them so a sighted player sees the board change ──
	'game.property_mortgaged': 'neutral',
	'game.property_unmortgaged': 'neutral',
	'game.trade_completed': 'neutral',
};

const TONE_CLASSES: readonly string[] = ['board-toast--gain', 'board-toast--loss', 'board-toast--neutral'];

/** Strips the first-person `_self` suffix the acting player's client receives. */
function baseKey(key: string): string {
	return key.endsWith('_self') ? key.slice(0, -'_self'.length) : key;
}

/**
 * Returns the toast tone for an announcement, or `null` when it should not toast. Pure
 * (no DOM, no i18n) so it is unit-testable. The `_self` variant the actor receives toasts
 * just like the base key, so the acting player sees the cue too.
 */
export function toastToneForAnnouncement(key: string): ToastTone | null {
	if (!key) return null;
	return TOAST_TONE_BY_KEY[baseKey(key)] ?? null;
}

/** How long the toast stays fully shown before it fades out (ms). */
const TOAST_VISIBLE_MS = 2200;

class BoardToast {
	private host: HTMLElement | null = null;
	private hideTimer: ReturnType<typeof setTimeout> | null = null;

	/**
	 * Shows a fading, colour-coded center-board toast for the announcements that warrant a
	 * visual cue. The toast reuses the server-chosen i18n phrase — already personalized to
	 * first/third person by the time it reaches here — so its text always matches the
	 * spoken voice.
	 */
	playForAnnouncement(key: string, vars?: Record<string, any>): void {
		const tone = toastToneForAnnouncement(key);
		if (!tone) return;
		// Resolve any per-locale name var (a package board sends the square name as a { locale: text }
		// map) to this language BEFORE interpolation — otherwise the toast shows "[object Object]"
		// (bug #1) while the spoken line, which already does this, reads correctly.
		this.show(tSync(key, resolveLocalizedVars(vars, currentLang())), tone);
	}

	/**
	 * Shows a transient, colour-coded toast with an explicit, already-translated message.
	 * Use this for one-off visual cues that don't map to a fixed announcement key — e.g. a
	 * rejected action (red) or an invalid square number — so a sighted player sees WHY
	 * nothing happened. Like every toast it is purely visual (the host is `aria-hidden`);
	 * the spoken reason still comes from the live region.
	 */
	show(text: string, tone: ToastTone): void {
		if (!text) return;
		const host = this.ensureHost();
		if (!host) return;

		host.textContent = text;
		host.classList.remove(...TONE_CLASSES);
		host.classList.add(`board-toast--${tone}`);

		// Restart the fade-in animation even on back-to-back toasts.
		host.classList.remove('board-toast--show');
		void host.offsetWidth; // force a reflow so the animation re-triggers
		host.classList.add('board-toast--show');

		if (this.hideTimer !== null) clearTimeout(this.hideTimer);
		this.hideTimer = setTimeout(() => {
			host.classList.remove('board-toast--show');
			this.hideTimer = null;
		}, TOAST_VISIBLE_MS);
	}

	/**
	 * Lazily creates the toast host inside the (already `aria-hidden`) board center,
	 * falling back to the board container before the center exists. Re-creates it if the
	 * board was re-rendered and detached the previous host.
	 */
	private ensureHost(): HTMLElement | null {
		if (this.host && this.host.isConnected) return this.host;
		const parent = document.querySelector('.board-center') ?? document.getElementById('board');
		if (!parent) return null;
		const host = document.createElement('div');
		host.className = 'board-toast';
		host.setAttribute('aria-hidden', 'true');
		parent.appendChild(host);
		this.host = host;
		return host;
	}
}

export const boardToast = new BoardToast();
