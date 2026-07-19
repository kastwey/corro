// diceControl.ts — visual dice + roll button.
//
// Purely additive: the existing Enter shortcut still rolls the dice. This
// control gives sighted players a clickable button and an animated result.
// The dice tray itself is aria-hidden because dice results are announced by
// the server-driven screen-reader pipeline.

import { tSync } from './i18nBinder.js';

const t = (key: string, vars?: Record<string, any>) => tSync(`game.${key}`, vars);

// Pip layout per die face, as [row, column] coordinates on a 3x3 grid.
const PIPS: Record<number, Array<[number, number]>> = {
	1: [[2, 2]],
	2: [[1, 1], [3, 3]],
	3: [[1, 1], [2, 2], [3, 3]],
	4: [[1, 1], [1, 3], [3, 1], [3, 3]],
	5: [[1, 1], [1, 3], [2, 2], [3, 1], [3, 3]],
	6: [[1, 1], [1, 3], [2, 1], [2, 3], [3, 1], [3, 3]]
};

class DiceControl {
	private root: HTMLElement | null = null;
	private button: HTMLButtonElement | null = null;
	private die1El: HTMLElement | null = null;
	private die2El: HTMLElement | null = null;
	private onRoll: () => void = () => {};
	private onUnavailable: (reason: string) => void = () => {};
	private enabled = false;

	init(mount: HTMLElement, opts: { onRoll: () => void; onUnavailable?: (reason: string) => void }): void {
		if (this.button) return;
		this.onRoll = opts.onRoll;
		this.onUnavailable = opts.onUnavailable ?? (() => {});

		const root = document.createElement('div');
		root.className = 'dice-control';

		const tray = document.createElement('div');
		tray.className = 'dice-tray';
		tray.setAttribute('aria-hidden', 'true');
		this.die1El = this.createDie();
		this.die2El = this.createDie();
		tray.append(this.die1El, this.die2El);

		const button = document.createElement('button');
		button.type = 'button';
		button.id = 'dice-button';
		button.className = 'btn btn--primary dice-button';
		button.textContent = t('roll_dice_button');
		button.addEventListener('click', () => {
			if (!this.enabled) {
				this.onUnavailable(t('roll_dice_not_your_turn'));
				return;
			}
			this.onRoll();
		});

		const unavailableReason = document.createElement('span');
		unavailableReason.id = 'dice-button-unavailable-reason';
		unavailableReason.className = 'sr-only';
		unavailableReason.textContent = t('roll_dice_not_your_turn');
		button.setAttribute('aria-describedby', unavailableReason.id);

		root.append(tray, button, unavailableReason);
		mount.appendChild(root);

		this.root = root;
		this.button = button;
		this.setFace(this.die1El, 1);
		this.setFace(this.die2El, 1);
		this.setEnabled(false);
	}

	/** Show/hide the whole control: families without dice (journey) have no die to show —
	 *  their draw button lives in the hand panel instead. (An inline display, not the
	 *  hidden attribute: the control's own `display` rule would override `[hidden]`.) */
	setVisible(visible: boolean): void {
		if (this.root) this.root.style.display = visible ? '' : 'none';
	}

	/** Enable/disable the roll button (e.g. only on the local player's turn). */
	setEnabled(enabled: boolean): void {
		if (!this.button) return;
		this.enabled = enabled;
		this.button.setAttribute('aria-disabled', String(!enabled));
		this.button.setAttribute('aria-label', enabled ? t('roll_dice_button') : t('roll_dice_not_your_turn'));
		if (enabled) this.button.removeAttribute('aria-describedby');
		else this.button.setAttribute('aria-describedby', 'dice-button-unavailable-reason');
	}

	/**
	 * Show the roll result. By default it plays a tumble first, but when `animate` is false
	 * (motion off) it sets the faces at once: with motion off the token snaps straight to its
	 * square, so a tumbling die would keep "rolling" while the board already shows where the
	 * player landed — revealing the destination before the animation ends (bug #14).
	 */
	animateRoll(die1: number, die2: number, animate = true): void {
		if (!this.die1El || !this.die2El) return;
		const d1 = this.die1El;
		const d2 = this.die2El;
		const settle = () => {
			this.setFace(d1, die1);
			this.setFace(d2, die2);
		};
		const dice = [d1, d2];
		if (!animate) {
			dice.forEach(d => d.classList.remove('die--rolling'));
			settle();
			return;
		}
		dice.forEach(d => d.classList.add('die--rolling'));
		window.setTimeout(() => {
			dice.forEach(d => d.classList.remove('die--rolling'));
			settle();
		}, 650);
	}

	private createDie(): HTMLElement {
		const die = document.createElement('div');
		die.className = 'die';
		return die;
	}

	private setFace(die: HTMLElement, value: number): void {
		const v = Math.max(1, Math.min(6, value));
		die.dataset.face = String(v);
		die.innerHTML = '';
		for (const [row, col] of PIPS[v]) {
			const pip = document.createElement('span');
			pip.className = 'pip';
			pip.style.gridRow = String(row);
			pip.style.gridColumn = String(col);
			die.appendChild(pip);
		}
	}
}

export const diceControl = new DiceControl();
