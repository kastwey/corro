// actionBar.ts — Accessible, context-sensitive toolbar of the player's currently
// available actions. Built for screen-reader users: it is a single ARIA toolbar
// with a roving tabindex (one tab stop), ArrowLeft/Right + Home/End navigation,
// and native button activation (Enter/Space). The list of actions is computed by
// availableActions.ts; app.ts maps each action id to the matching gameManager call.

import { tSync } from '../i18nBinder.js';
import { reconcileChildren } from '../domReconcile.js';
import type { ActionDescriptor, ActionId } from './availableActions.js';

const t = (key: string, vars?: Record<string, any>) => tSync(key, vars);

class ActionBar {
	private container: HTMLElement | null = null;
	private list: HTMLElement | null = null;
	/** Holds disabled-action reason hints out of the toolbar's child flow (referenced by id). */
	private hintHost: HTMLElement | null = null;
	private buttons: HTMLButtonElement[] = [];
	/** A disabled button's reason hint, so updates mutate it in place instead of rebuilding. */
	private readonly hints = new WeakMap<HTMLButtonElement, HTMLElement>();
	private activeIndex = 0;
	private onActivate: ((id: ActionId) => void) | null = null;
	private announce: ((text: string) => void) | null = null;

	/**
	 * Create the toolbar and insert it just above the board grid. `onActivate`
	 * is called with the action id when an enabled button is activated. `announce`
	 * (optional) speaks the disabled reason when a disabled button is activated.
	 */
	init(onActivate: (id: ActionId) => void, announce?: (text: string) => void): void {
		this.onActivate = onActivate;
		this.announce = announce ?? null;
		if (this.container) return;

		// A toolbar role is not permitted on <section>; use a neutral host so the
		// semantic role exposed to assistive technology is valid.
		const section = document.createElement('div');
		section.id = 'action-bar';
		section.className = 'action-bar';
		section.setAttribute('role', 'toolbar');
		section.setAttribute('aria-label', t('game.actions.toolbar_label'));
		section.setAttribute('aria-orientation', 'horizontal');
		// Start hidden until there is at least one action to show.
		section.hidden = true;

		const list = document.createElement('div');
		list.className = 'action-bar-buttons';
		section.appendChild(list);

		// Disabled-action reason hints live here, OUTSIDE the toolbar's child flow, so the
		// button list reconciles cleanly (only buttons are its managed children). The hints
		// are referenced by aria-describedby and visually hidden via their own CSS (a clip,
		// NOT display:none, so they stay in the accessibility tree).
		const hintHost = document.createElement('div');
		hintHost.className = 'action-bar-hints';
		section.appendChild(hintHost);

		section.addEventListener('keydown', (ev) => this.onKeyDown(ev));

		// Insert above the board (after the turn indicator if present).
		const board = document.getElementById('board');
		if (board && board.parentElement) {
			board.parentElement.insertBefore(section, board);
		} else {
			document.body.prepend(section);
		}

		this.container = section;
		this.list = list;
		this.hintHost = hintHost;
	}

	/** Replace the rendered actions. Hides the toolbar when the list is empty. */
	render(actions: ActionDescriptor[]): void {
		if (!this.container || !this.list) return;

		if (actions.length === 0) {
			this.buttons.forEach(b => this.removeHint(b));
			this.list.replaceChildren();
			this.buttons = [];
			this.container.hidden = true;
			this.activeIndex = 0;
			return;
		}

		this.container.hidden = false;

		// Which action (if any) the keyboard user currently has focused. The whole point of
		// reconciling instead of rebuilding is that a SURVIVING focused button is never
		// touched — so a screen reader doesn't re-announce it on every unrelated state
		// update (e.g. another player building a house).
		const focused = document.activeElement as HTMLElement | null;
		const focusedId = focused && this.buttons.includes(focused as HTMLButtonElement)
			? (focused as HTMLButtonElement).dataset.actionId
			: undefined;

		this.buttons = reconcileChildren(this.list, {
			items: actions,
			key: a => a.id,
			keyOf: el => (el as HTMLElement).dataset.actionId,
			create: a => this.createButton(a),
			update: (btn, a) => this.updateButton(btn as HTMLButtonElement, a),
			onRemoved: btn => this.removeHint(btn as HTMLButtonElement),
			// A focused action that disappears hands focus to the first remaining button so
			// the keyboard user isn't dropped onto <body>.
			rescueFocus: () => this.list!.querySelector<HTMLButtonElement>('.action-bar-button'),
		}) as HTMLButtonElement[];

		// Roving tabindex: keep the single tab stop on the focused survivor (untouched), or
		// on the first button otherwise.
		const survivorIndex = focusedId ? this.buttons.findIndex(b => b.dataset.actionId === focusedId) : -1;
		this.activeIndex = survivorIndex >= 0 ? survivorIndex : 0;
		this.buttons.forEach((b, i) => { b.tabIndex = i === this.activeIndex ? 0 : -1; });
	}

	/** Build a fresh toolbar button for an action descriptor. */
	private createButton(action: ActionDescriptor): HTMLButtonElement {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'action-bar-button';
		btn.dataset.actionId = action.id;
		btn.textContent = t(action.labelKey);
		if (action.shortcut) {
			btn.setAttribute('aria-keyshortcuts', action.shortcut);
		}
		this.applyState(btn, action);
		return btn;
	}

	/** Mutate an existing button to match a descriptor, changing only what differs. */
	private updateButton(btn: HTMLButtonElement, action: ActionDescriptor): void {
		const label = t(action.labelKey);
		if (btn.textContent !== label) btn.textContent = label;
		if (action.shortcut) {
			if (btn.getAttribute('aria-keyshortcuts') !== action.shortcut) {
				btn.setAttribute('aria-keyshortcuts', action.shortcut);
			}
		} else {
			btn.removeAttribute('aria-keyshortcuts');
		}
		this.applyState(btn, action);
	}

	/**
	 * Apply a descriptor's enabled/disabled state to a button. A disabled action stays
	 * focusable (NEVER the `disabled` attribute) so a screen-reader user can reach it and
	 * hear WHY it is unavailable; the reason is exposed via aria-describedby and spoken on
	 * activation. The click handler is rebound (onclick, idempotent) so a reused button
	 * always targets the current action.
	 */
	private applyState(btn: HTMLButtonElement, action: ActionDescriptor): void {
		if (action.disabledReasonKey) {
			const reason = t(action.disabledReasonKey);
			if (btn.getAttribute('aria-disabled') !== 'true') btn.setAttribute('aria-disabled', 'true');
			const hintId = `action-bar-hint-${action.id}`;
			if (btn.getAttribute('aria-describedby') !== hintId) btn.setAttribute('aria-describedby', hintId);
			let hint = this.hints.get(btn);
			if (!hint) {
				hint = document.createElement('span');
				hint.id = hintId;
				hint.className = 'action-bar-hint';
				this.hints.set(btn, hint);
				this.hintHost?.appendChild(hint);
			}
			if (hint.textContent !== reason) hint.textContent = reason;
			btn.onclick = () => {
				this.activeIndex = this.buttons.indexOf(btn);
				this.announce?.(reason);
			};
		} else {
			btn.removeAttribute('aria-disabled');
			btn.removeAttribute('aria-describedby');
			this.removeHint(btn);
			btn.onclick = () => {
				this.activeIndex = this.buttons.indexOf(btn);
				this.onActivate?.(action.id);
			};
		}
	}

	/** Remove a button's hint span (if any) from the DOM and the tracking map. */
	private removeHint(btn: HTMLButtonElement): void {
		const hint = this.hints.get(btn);
		if (hint) {
			hint.remove();
			this.hints.delete(btn);
		}
	}

	/** Move keyboard focus into the toolbar. Returns false if it is empty/hidden. */
	focus(): boolean {
		if (!this.container || this.container.hidden || this.buttons.length === 0) return false;
		this.setActiveIndex(Math.min(this.activeIndex, this.buttons.length - 1), true);
		return true;
	}

	/** The toolbar element, for landmark/panel navigation. */
	get element(): HTMLElement | null {
		return this.container;
	}

	/** Whether the toolbar currently has any actions. */
	get hasActions(): boolean {
		return this.buttons.length > 0 && !!this.container && !this.container.hidden;
	}

	private setActiveIndex(index: number, focus: boolean): void {
		if (this.buttons.length === 0) return;
		this.activeIndex = Math.max(0, Math.min(index, this.buttons.length - 1));
		this.buttons.forEach((b, i) => { b.tabIndex = i === this.activeIndex ? 0 : -1; });
		if (focus) this.buttons[this.activeIndex]?.focus();
	}

	private onKeyDown(ev: KeyboardEvent): void {
		if (this.buttons.length === 0) return;
		switch (ev.key) {
			case 'ArrowRight':
			case 'ArrowDown':
				ev.preventDefault();
				this.setActiveIndex((this.activeIndex + 1) % this.buttons.length, true);
				break;
			case 'ArrowLeft':
			case 'ArrowUp':
				ev.preventDefault();
				this.setActiveIndex((this.activeIndex - 1 + this.buttons.length) % this.buttons.length, true);
				break;
			case 'Home':
				ev.preventDefault();
				this.setActiveIndex(0, true);
				break;
			case 'End':
				ev.preventDefault();
				this.setActiveIndex(this.buttons.length - 1, true);
				break;
		}
	}
}

export const actionBar = new ActionBar();
