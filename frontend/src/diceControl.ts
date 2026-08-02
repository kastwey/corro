// diceControl.ts — the visible dice.
//
// A tray that tumbles and settles on the roll everyone just made, for players who read the table
// with their eyes. It is aria-hidden: the result is announced by the server-driven pipeline, and
// a screen reader hearing it twice would be worse than not seeing the dice at all.
//
// It used to carry a ROLL BUTTON too, and that button was a second way to do something the action
// bar already offers (with Space, above the board, beside every other action of the turn). Two
// controls for one act, in two places, with two keyboard models — and the header one knew less:
// it enabled itself on `isMyTurn` alone, while the action bar also knows whether you have already
// rolled, whether a doubles re-roll is owed, whether your token is still moving and whether a
// modal owns the turn. Being in the page header rather than the board's layout, it also survived
// into the table, where it sat answering "it is not your turn" at a table where nobody has one.
// The tray stays; the act belongs to the action bar.

// Pip layout per die face, as [row, column] coordinates on a 3x3 grid.
const PIPS: Record<number, [number, number][]> = {
	1: [[2, 2]],
	2: [[1, 1], [3, 3]],
	3: [[1, 1], [2, 2], [3, 3]],
	4: [[1, 1], [1, 3], [3, 1], [3, 3]],
	5: [[1, 1], [1, 3], [2, 2], [3, 1], [3, 3]],
	6: [[1, 1], [1, 3], [2, 1], [2, 3], [3, 1], [3, 3]]
};

class DiceControl {
	private root: HTMLElement | null = null;
	private die1El: HTMLElement | null = null;
	private die2El: HTMLElement | null = null;
	private bonusEl: HTMLElement | null = null;

	init(mount: HTMLElement): void {
		if (this.root) return;

		const root = document.createElement('div');
		root.className = 'dice-control';

		const tray = document.createElement('div');
		tray.className = 'dice-tray';
		tray.setAttribute('aria-hidden', 'true');
		this.die1El = this.createDie();
		this.die2El = this.createDie();
		this.bonusEl = this.createDie();
		this.bonusEl.classList.add('die--bonus');
		this.bonusEl.hidden = true;
		tray.append(this.die1El, this.die2El, this.bonusEl);

		root.append(tray);
		mount.appendChild(root);

		this.root = root;
		this.setFace(this.die1El, 1);
		this.setFace(this.die2El, 1);
	}

	/** Show/hide the whole control: families without dice (journey) have no die to show —
	 *  their draw button lives in the hand panel instead. (An inline display, not the
	 *  hidden attribute: the control's own `display` rule would override `[hidden]`.) */
	setVisible(visible: boolean): void {
		if (this.root) this.root.style.display = visible ? '' : 'none';
	}

	/**
	 * Show the roll result. By default it plays a tumble first, but when `animate` is false
	 * (motion off) it sets the faces at once: with motion off the token snaps straight to its
	 * square, so a tumbling die would keep "rolling" while the board already shows where the
	 * player landed — revealing the destination before the animation ends (bug #14).
	 */
	animateRoll(die1: number, die2: number, animate = true, bonus?: { face: string; value?: number }): void {
		if (!this.die1El || !this.die2El || !this.bonusEl) return;
		const d1 = this.die1El;
		const d2 = this.die2El;
		const db = this.bonusEl;
		db.hidden = !bonus;
		const settle = () => {
			this.setFace(d1, die1);
			this.setFace(d2, die2);
			if (bonus) this.setBonusFace(db, bonus.face, bonus.value);
		};
		const dice = bonus ? [d1, d2, db] : [d1, d2];
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

	private setBonusFace(die: HTMLElement, face: string, value?: number): void {
		const normalized = face.toLowerCase();
		const numeric: Record<string, number> = { one: 1, two: 2, three: 3 };
		if (normalized in numeric) {
			this.setFace(die, value ?? numeric[normalized]);
			return;
		}
		die.dataset.face = normalized;
		die.innerHTML = '';
		const glyph = document.createElement('span');
		glyph.className = 'die-glyph';
		glyph.textContent = normalized === 'bus' ? 'B' : '»';
		die.appendChild(glyph);
	}
}

export const diceControl = new DiceControl();
