// toolbarButtons.ts — Shared builder for an accessible per-row action toolbar.
//
// Several surfaces show a small horizontal toolbar of text buttons next to a list row:
// the players panel (Information / Propose trade / Go to player) and the manage-properties
// dialog (Build / Sell / Mortgage / Unmortgage). They are identical in shape — a button
// per action, each a roving-tabindex stop (tabIndex -1, the parent list owns the tab
// order), keyed by a stable id so the focused button survives a refresh.
//
// This wraps {@link reconcileChildren} with that button shape so the two surfaces share
// one tested implementation instead of re-deriving it. The decision of WHICH actions to
// offer stays with each surface; this only renders and reconciles them.

import { reconcileChildren } from './domReconcile.js';

/** A single toolbar action: a stable key (also its dataset value), a label, and a handler. */
export interface ToolbarAction {
	key: string;
	label: string;
	onClick: () => void;
	/** For TOGGLE actions: renders aria-pressed (and the shared context menu mirrors the
	 *  button as a checkable menu item). Omit for plain actions. */
	pressed?: boolean;
	/** Actions sharing a group label collapse into ONE submenu entry of the context menu,
	 *  where they read as a radio set (aria-checked from `pressed`). */
	group?: string;
}

export interface ToolbarButtonOptions {
	/** CSS class applied to every button. */
	buttonClass: string;
	/** The dataset key (camelCase) that stores each action's key, e.g. 'action' → data-action. */
	keyAttr: string;
	/**
	 * Mirror the label into aria-label too. Redundant for a plain text button, but some
	 * surfaces set it explicitly; off by default.
	 */
	labelAsAriaLabel?: boolean;
	/**
	 * Where focus should land if the button that held it is removed (e.g. the owning row),
	 * so a screen-reader user is never dropped onto <body>. Omit when a higher level rescues.
	 */
	rescueFocus?: (removed: HTMLElement) => HTMLElement | null | undefined;
}

/** Reconcile `toolbar`'s buttons against `actions`, reusing survivors and preserving focus. */
export function reconcileToolbarButtons(
	toolbar: HTMLElement,
	actions: ToolbarAction[],
	opts: ToolbarButtonOptions
): void {
	reconcileChildren(toolbar, {
		items: actions,
		key: a => a.key,
		keyOf: el => (el as HTMLElement).dataset[opts.keyAttr],
		create: a => {
			const btn = document.createElement('button');
			btn.type = 'button';
			btn.className = opts.buttonClass;
			btn.tabIndex = -1;
			btn.dataset[opts.keyAttr] = a.key;
			btn.textContent = a.label;
			if (opts.labelAsAriaLabel) btn.setAttribute('aria-label', a.label);
			if (a.pressed !== undefined) btn.setAttribute('aria-pressed', String(a.pressed));
			if (a.group) btn.dataset.menuGroup = a.group;
			btn.onclick = a.onClick;
			return btn;
		},
		update: (btn, a) => {
			if (btn.textContent !== a.label) btn.textContent = a.label;
			if (opts.labelAsAriaLabel && btn.getAttribute('aria-label') !== a.label) {
				btn.setAttribute('aria-label', a.label);
			}
			if (a.pressed !== undefined) {
				if (btn.getAttribute('aria-pressed') !== String(a.pressed)) {
					btn.setAttribute('aria-pressed', String(a.pressed));
				}
			} else {
				btn.removeAttribute('aria-pressed');
			}
			if (a.group) btn.dataset.menuGroup = a.group;
			else delete btn.dataset.menuGroup;
			// Rebind so a reused button always targets its row's current data.
			(btn as HTMLButtonElement).onclick = a.onClick;
		},
		rescueFocus: opts.rescueFocus,
	});
}
