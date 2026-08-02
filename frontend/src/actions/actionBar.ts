// actionBar.ts — the player's currently available actions, during a match.
//
// The KEYBOARD model (one tab stop, arrows, Home/End, reconciling without disturbing a focused
// button, aria-disabled instead of `disabled`) lives in ../rovingToolbar.ts, because the table
// wanted the same thing between matches. What stays here is everything that is about a MATCH:
// which actions exist (availableActions.ts computes them), what they are called, the shortcut
// each one announces, and the fact that this particular toolbar is mounted above the board.

import { tSync } from '../i18nBinder.js';
import { RovingToolbar, type ToolbarItem } from '../rovingToolbar.js';
import type { ActionDescriptor, ActionId } from './availableActions.js';

const t = (key: string, vars?: Record<string, any>) => tSync(key, vars);

class ActionBar {
	private readonly toolbar = new RovingToolbar();
	private mounted = false;
	private onActivate: ((id: ActionId) => void) | null = null;

	/**
	 * Create the toolbar and insert it just above the board grid. `onActivate` is called with the
	 * action id when an enabled button is activated. `announce` (optional) speaks the disabled
	 * reason when a disabled button is activated.
	 */
	init(onActivate: (id: ActionId) => void, announce?: (text: string) => void): void {
		this.onActivate = onActivate;
		if (this.mounted) return;

		// Its own host element, inserted above the board (after the turn indicator if present).
		const host = document.createElement('div');
		const board = document.getElementById('board');
		if (board?.parentElement) board.parentElement.insertBefore(host, board);
		else document.body.prepend(host);

		this.toolbar.mount(host, {
			id: 'action-bar',
			className: 'action-bar',
			buttonClassName: 'action-bar-button',
			classPrefix: 'action-bar',
			label: t('game.actions.toolbar_label'),
			announce,
		});
		this.mounted = true;
	}

	/** Replace the rendered actions. Hides the toolbar when the list is empty. */
	render(actions: ActionDescriptor[]): void {
		this.toolbar.setLabel(t('game.actions.toolbar_label'));
		this.toolbar.render(actions.map<ToolbarItem>(action => ({
			id: action.id,
			label: t(action.labelKey),
			shortcut: action.shortcut,
			disabledReason: action.disabledReasonKey ? t(action.disabledReasonKey) : undefined,
			onActivate: () => this.onActivate?.(action.id),
		})));
	}

	/** Move keyboard focus into the toolbar. Returns false if it is empty/hidden. */
	focus(): boolean {
		return this.toolbar.focus();
	}

	/** The toolbar element, for landmark/panel navigation. */
	get element(): HTMLElement | null {
		return this.toolbar.element;
	}

	/** Whether the toolbar currently has any actions. */
	get hasActions(): boolean {
		return this.toolbar.hasItems;
	}
}

export const actionBar = new ActionBar();
