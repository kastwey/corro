/**
 * Transient, purely-visual center-board errors and refusals. Authoritative game events now
 * share the persistent visualNarrative surface in every family; this smaller layer remains for
 * one-off validation feedback where persistence would overwrite the game story.
 *
 * It is a PARALLEL presentation layer to the spoken announcements and the earcons — it
 * never replaces them and never touches the live region: the toast host is `aria-hidden`,
 * so it neither speaks nor steals focus.
 */

/** Visual tone of a toast, driving its colour so the feedback reads at a glance. */
export type ToastTone = 'gain' | 'loss' | 'neutral';

const TONE_CLASSES: readonly string[] = ['board-toast--gain', 'board-toast--loss', 'board-toast--neutral'];

/** How long the toast stays fully shown before it fades out (ms). */
const TOAST_VISIBLE_MS = 2200;

class BoardToast {
	private host: HTMLElement | null = null;
	private hideTimer: ReturnType<typeof setTimeout> | null = null;

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
