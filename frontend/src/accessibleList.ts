// accessibleList.ts — A reusable accessible "roving tabindex" list whose items each
// expose a small action toolbar, plus a context menu (Shift+F10 / Applications key)
// mirroring those actions. Both the notifications panel and the manage-properties
// dialog share this so they behave identically for keyboard / screen-reader users:
//
//   - Up/Down (and Home/End) move between items; each item is a single focus stop
//     whose aria-label reads its full content.
//   - Right enters the item's action toolbar; Left/Right (Home/End) move between the
//     actions; Left past the first action — or Escape — returns to the item.
//   - Shift+F10 / ContextMenu opens an accessible menu mirroring the toolbar actions.
//
// The navigation *decision* is a pure function (nextListFocus) so it can be unit
// tested without a DOM; the controller (RovingToolbarList) wires it to real elements.

import { typeaheadMatch } from './popupMenu.js';

// ==========================================
// KEYBOARD NAVIGATION (pure, testable)
// ==========================================

/** Where keyboard focus currently sits inside the list. */
export type ListFocus =
	| { level: 'item'; item: number }
	| { level: 'toolbar'; item: number; button: number };

/** Result of a navigation key: a new focus position, an "open menu" intent, or null (unhandled). */
export type ListNavResult = ListFocus | { action: 'openMenu'; item: number } | null;

/**
 * Pure keyboard-navigation decision for a roving toolbar list. Two levels:
 *  - 'item': move between items (Up/Down/Home/End). Right enters the item's action
 *    toolbar. ContextMenu / Shift+F10 opens the actions menu.
 *  - 'toolbar': move between an item's action buttons (Left/Right/Home/End). Left past
 *    the first button — or Escape — returns to the item. Up/Down leave the toolbar and
 *    move to the previous/next item.
 *
 * Translator-free and DOM-free so the model can be unit-tested in isolation.
 */
export function nextListFocus(
	current: ListFocus,
	key: string,
	shiftKey: boolean,
	itemCount: number,
	toolbarCountFor: (item: number) => number
): ListNavResult {
	if (itemCount <= 0) return null;
	const clampItem = (i: number) => Math.max(0, Math.min(i, itemCount - 1));
	const isMenuKey = key === 'ContextMenu' || (shiftKey && key === 'F10');

	if (current.level === 'item') {
		if (isMenuKey) return { action: 'openMenu', item: current.item };
		switch (key) {
			case 'ArrowDown': return { level: 'item', item: clampItem(current.item + 1) };
			case 'ArrowUp': return { level: 'item', item: clampItem(current.item - 1) };
			case 'Home': return { level: 'item', item: 0 };
			case 'End': return { level: 'item', item: itemCount - 1 };
			case 'ArrowRight':
				return toolbarCountFor(current.item) > 0
					? { level: 'toolbar', item: current.item, button: 0 }
					: null;
			default: return null;
		}
	}

	// current.level === 'toolbar'
	const count = toolbarCountFor(current.item);
	if (count <= 0) return { level: 'item', item: current.item };
	if (isMenuKey) return { action: 'openMenu', item: current.item };
	switch (key) {
		case 'ArrowRight': return { level: 'toolbar', item: current.item, button: Math.min(current.button + 1, count - 1) };
		case 'ArrowLeft':
			return current.button === 0
				? { level: 'item', item: current.item }
				: { level: 'toolbar', item: current.item, button: current.button - 1 };
		case 'Home': return { level: 'toolbar', item: current.item, button: 0 };
		case 'End': return { level: 'toolbar', item: current.item, button: count - 1 };
		case 'Escape': return { level: 'item', item: current.item };
		case 'ArrowDown': return { level: 'item', item: clampItem(current.item + 1) };
		case 'ArrowUp': return { level: 'item', item: clampItem(current.item - 1) };
		default: return null;
	}
}

// ==========================================
// ROVING CHECKBOX LIST (single tab stop, arrows + Space)
// ==========================================

/**
 * Pure navigation decision for a simple roving-tabindex list (no toolbar): a single
 * focus stop that moves with Up/Down/Home/End. Returns the new index, or null when the
 * key is not a navigation key (so the caller leaves it to native handling — e.g. Space
 * toggles a checkbox, Tab leaves the list). DOM-free so it is unit-testable.
 */
export function nextRovingIndex(current: number, key: string, count: number): number | null {
	if (count <= 0) return null;
	const clamp = (i: number) => Math.max(0, Math.min(i, count - 1));
	switch (key) {
		case 'ArrowDown':
		case 'ArrowRight': return clamp(current + 1);
		case 'ArrowUp':
		case 'ArrowLeft': return clamp(current - 1);
		case 'Home': return 0;
		case 'End': return count - 1;
		default: return null;
	}
}

export interface RovingCheckboxListOptions {
	/** The container holding the checkboxes; receives the delegated keydown handler. */
	container: HTMLElement;
	/** CSS selector matching each focusable checkbox within the container. */
	itemSelector: string;
}

/**
 * Turns a group of native checkboxes into an accessible roving-tabindex list: the whole
 * group is a SINGLE tab stop, Up/Down (and Home/End) move focus between checkboxes, and
 * Space still natively toggles the focused checkbox. Native checkbox semantics are kept
 * so screen readers announce "checked / not checked" — only the tab-stop bookkeeping and
 * arrow navigation are added.
 */
export class RovingCheckboxList {
	private readonly keydownHandler = (e: KeyboardEvent) => this.onKeydown(e);

	constructor(private readonly opts: RovingCheckboxListOptions) {
		opts.container.addEventListener('keydown', this.keydownHandler);
	}

	private getItems(): HTMLElement[] {
		return Array.from(this.opts.container.querySelectorAll<HTMLElement>(this.opts.itemSelector));
	}

	private setRoving(items: HTMLElement[], activeIndex: number): void {
		items.forEach((it, idx) => { it.tabIndex = idx === activeIndex ? 0 : -1; });
	}

	/** Keep exactly one tab stop as the list's contents are (re)built. */
	refreshRovingTabindex(): void {
		const items = this.getItems();
		if (items.length === 0) return;
		const active = items.findIndex(it => it.tabIndex === 0);
		this.setRoving(items, active >= 0 ? active : 0);
	}

	private onKeydown(e: KeyboardEvent): void {
		// Same modifier rule as the toolbar list: Ctrl/Alt/Meta arrows are other layers' keys.
		if (e.ctrlKey || e.altKey || e.metaKey) return;
		const items = this.getItems();
		const current = items.indexOf(document.activeElement as HTMLElement);
		if (current < 0) return;
		const next = nextRovingIndex(current, e.key, items.length);
		if (next === null) return;
		e.preventDefault();
		this.setRoving(items, next);
		items[next].focus();
	}

	destroy(): void {
		this.opts.container.removeEventListener('keydown', this.keydownHandler);
	}
}

// ==========================================
// CONTROLLER (DOM wiring)
// ==========================================

export interface RovingToolbarListOptions {
	/** The list container; receives the delegated keydown handler. */
	list: HTMLElement;
	/** CSS selector matching each focusable item within the list. */
	itemSelector: string;
	/** CSS selector matching the action buttons inside an item's toolbar. */
	toolbarButtonSelector: string;
	/**
	 * Optional: buttons owned by the LIST itself (not any row), mirrored into the context
	 * menu when the list CONTAINER holds focus — the emptied-by-filter case, where the
	 * filter toggle must stay reachable even though no row (and no row toolbar) exists.
	 */
	listActionsSelector?: string;
	/** aria-label for the context menu (lazy so it follows language changes). */
	menuLabel: () => string;
	/** Class for the context-menu container (so each host can theme it). */
	menuClass: string;
	/** Class for each context-menu item. */
	menuItemClass: string;
	/**
	 * Where to append the open context menu. Defaults to &lt;body&gt;, which is right for an
	 * in-page list (players panel, board). A list inside a MODAL &lt;dialog&gt; must pass the
	 * dialog element: showModal() makes everything outside the dialog inert, so a menu left on
	 * &lt;body&gt; would be non-interactive and unreadable (bug #12 — manage-properties dialog).
	 */
	menuHost?: () => HTMLElement | null;
	/** Where to send focus when navigation has no item to land on (e.g. the list
	 *  emptied). Optional. */
	fallbackFocus?: () => HTMLElement | null;
}

/**
 * Wires the roving-tabindex + toolbar + context-menu keyboard model onto a list
 * element. The host is responsible for rendering items (each focusable, with an
 * aria-label and an optional toolbar of buttons matching `toolbarButtonSelector`);
 * this controller owns the keyboard behaviour and focus bookkeeping.
 */
export class RovingToolbarList {
	/** The open context menu; `group` names the submenu currently shown (null = root);
	 *  `actionsFor` yields the mirrored buttons (a row's toolbar, or the list's own). */
	private contextMenu: {
		menu: HTMLElement; owner: HTMLElement; group: string | null;
		actionsFor: () => HTMLElement[];
	} | null = null;
	private readonly keydownHandler = (e: KeyboardEvent) => this.onListKeydown(e);
	private readonly contextMenuHandler = (e: MouseEvent) => this.onListContextMenu(e);

	constructor(private readonly opts: RovingToolbarListOptions) {
		opts.list.addEventListener('keydown', this.keydownHandler);
		// Suppress the browser's native context menu inside the list (Shift+F10 /
		// Applications key / right-click) and offer our own accessible menu instead.
		opts.list.addEventListener('contextmenu', this.contextMenuHandler);
	}

	/** All focusable items currently in the list, in DOM order. */
	getItems(): HTMLElement[] {
		return Array.from(this.opts.list.querySelectorAll<HTMLElement>(this.opts.itemSelector));
	}

	/** Action buttons inside an item's toolbar, in DOM order. */
	toolbarButtons(item: HTMLElement): HTMLElement[] {
		return Array.from(item.querySelectorAll<HTMLElement>(this.opts.toolbarButtonSelector));
	}

	/** Make exactly one item the tab stop (tabindex 0); the rest are -1. */
	setRovingItem(items: HTMLElement[], activeIndex: number): void {
		items.forEach((it, idx) => { it.tabIndex = idx === activeIndex ? 0 : -1; });
	}

	/** Ensure the list keeps exactly one tab stop as items come and go. */
	refreshRovingTabindex(): void {
		const items = this.getItems();
		if (items.length === 0) return;
		const activeIndex = items.findIndex(it => it.tabIndex === 0);
		this.setRovingItem(items, activeIndex >= 0 ? activeIndex : 0);
	}

	/** Focus a specific item (default: the current tab stop, else the first). */
	focusItem(index?: number): boolean {
		const items = this.getItems();
		if (items.length === 0) return false;
		const target = index ?? Math.max(0, items.findIndex(it => it.tabIndex === 0));
		const clamped = Math.max(0, Math.min(target, items.length - 1));
		this.setRovingItem(items, clamped);
		items[clamped].focus();
		return true;
	}

	/** Locate where focus currently sits (which item / toolbar button). */
	private locateFocus(active: Element, items: HTMLElement[]): ListFocus | null {
		for (let i = 0; i < items.length; i++) {
			if (active === items[i]) return { level: 'item', item: i };
			const bi = this.toolbarButtons(items[i]).indexOf(active as HTMLElement);
			if (bi >= 0) return { level: 'toolbar', item: i, button: bi };
		}
		return null;
	}

	private onListKeydown(e: KeyboardEvent): void {
		// Modified keys belong to OTHER layers (Ctrl+↑/↓ walks the announcement history):
		// the only modified combo this list owns is Shift+F10, handled by nextListFocus.
		if (e.ctrlKey || e.altKey || e.metaKey) return;
		const active = document.activeElement;
		if (!active) return;

		// Focus on the LIST CONTAINER itself (a filter emptied it): the menu must still
		// open, offering the list's own actions — or the filter could never be lifted.
		const isMenuKey = e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10');
		if (isMenuKey && active === this.opts.list && this.opts.listActionsSelector) {
			e.preventDefault();
			e.stopPropagation();
			this.openListContextMenu();
			return;
		}
		const items = this.getItems();
		const current = this.locateFocus(active, items);
		if (!current) return;

		const result = nextListFocus(
			current,
			e.key,
			e.shiftKey,
			items.length,
			(i) => this.toolbarButtons(items[i]).length
		);
		if (result === null) return;
		// Stop here so an enclosing handler (e.g. a modal's Escape-to-close) doesn't
		// also act when we've handled the key — Escape inside a toolbar must only
		// back out to the item, not close the dialog.
		e.preventDefault();
		e.stopPropagation();

		if ('action' in result && result.action === 'openMenu') {
			this.openContextMenu(items[result.item]);
			return;
		}

		const focus = result as ListFocus;
		this.setRovingItem(items, focus.item);
		if (focus.level === 'item') {
			items[focus.item]?.focus();
		} else {
			this.toolbarButtons(items[focus.item])[focus.button]?.focus();
		}
	}

	/**
	 * Open an accessible context menu (Shift+F10 / Applications key) mirroring the
	 * item's toolbar actions. Arrow keys move between items, Enter activates, Escape
	 * closes and returns focus to the item.
	 *
	 * Toolbar buttons sharing a `data-menu-group` collapse into ONE submenu entry
	 * (aria-haspopup) named after the group; opening it swaps the menu in place to the
	 * group's options, read as a radio set (menuitemradio + aria-checked from each
	 * button's aria-pressed). Escape / Left backs out to the root menu.
	 */
	openContextMenu(item: HTMLElement): void {
		// A row's menu mirrors ITS toolbar plus the LIST-level actions (sort/filter):
		// those are painted once for the whole list — not duplicated on every row — but
		// must stay reachable from any row without leaving it.
		this.openMenuFor(item, () => [...this.toolbarButtons(item), ...this.listActionButtons()]);
	}

	/** The menu for the LIST itself (its own sort/filter actions): the emptied-by-filter
	 *  case, where no row — and so no row toolbar — exists to mirror. */
	openListContextMenu(): void {
		if (!this.opts.listActionsSelector) return;
		this.openMenuFor(this.opts.list, () => this.listActionButtons());
	}

	/** The buttons owned by the LIST itself (empty when the host declared none). */
	private listActionButtons(): HTMLElement[] {
		const selector = this.opts.listActionsSelector;
		return selector ? Array.from(document.querySelectorAll<HTMLElement>(selector)) : [];
	}

	private openMenuFor(owner: HTMLElement, actionsFor: () => HTMLElement[]): void {
		this.closeContextMenu();
		if (actionsFor().length === 0) return;

		const menu = document.createElement('div');
		menu.className = this.opts.menuClass;
		menu.setAttribute('role', 'menu');
		menu.setAttribute('aria-label', this.opts.menuLabel());
		menu.addEventListener('keydown', (e) => this.onMenuKeydown(e, owner));
		// The keyboard Shift+F10 / Applications key fires a separate `contextmenu`
		// event after our keydown handler has already opened the menu and moved focus
		// onto a menuitem — swallow it so the browser's native menu never appears.
		menu.addEventListener('contextmenu', (e) => e.preventDefault());
		// Host inside the modal dialog when one is given (its ::backdrop makes <body> inert),
		// otherwise on <body> for an in-page list. position:fixed keeps viewport coords valid either way.
		(this.opts.menuHost?.() ?? document.body).appendChild(menu);

		const rect = owner.getBoundingClientRect();
		menu.style.top = `${rect.top}px`;
		menu.style.left = `${Math.max(8, rect.left - menu.offsetWidth)}px`;

		this.contextMenu = { menu, owner, group: null, actionsFor };
		this.renderMenuItems(null);
		this.focusFirstMenuItem();
	}

	/** Fill the open menu with the root entries, or with one group's options (in place). */
	private renderMenuItems(group: string | null): void {
		const open = this.contextMenu;
		if (!open) return;
		open.group = group;
		open.menu.innerHTML = '';
		const actions = open.actionsFor();
		const labelOf = (b: HTMLElement) => b.getAttribute('aria-label') || b.textContent?.trim() || '';

		const newEntry = (label: string) => {
			const mi = document.createElement('button');
			mi.type = 'button';
			mi.className = this.opts.menuItemClass;
			mi.tabIndex = open.menu.children.length === 0 ? 0 : -1;
			mi.textContent = label;
			open.menu.appendChild(mi);
			return mi;
		};
		const activates = (mi: HTMLElement, action: HTMLElement) => mi.addEventListener('click', () => {
			this.closeContextMenu();
			open.owner.focus();
			(action as HTMLButtonElement).click();
		});

		if (group !== null) {
			// One group's options: a radio set (which ordering/filter applies), checked from
			// each toolbar button's aria-pressed.
			for (const action of actions.filter(a => a.dataset.menuGroup === group)) {
				const mi = newEntry(labelOf(action));
				mi.setAttribute('role', 'menuitemradio');
				mi.setAttribute('aria-checked', action.getAttribute('aria-pressed') ?? 'false');
				activates(mi, action);
			}
			return;
		}

		const groupsSeen = new Set<string>();
		for (const action of actions) {
			const actionGroup = action.dataset.menuGroup;
			if (actionGroup) {
				// The whole group collapses into ONE submenu entry, at its first position.
				if (groupsSeen.has(actionGroup)) continue;
				groupsSeen.add(actionGroup);
				const mi = newEntry(actionGroup);
				mi.setAttribute('role', 'menuitem');
				mi.setAttribute('aria-haspopup', 'menu');
				mi.addEventListener('click', () => {
					this.renderMenuItems(actionGroup);
					this.focusFirstMenuItem();
				});
				continue;
			}
			const mi = newEntry(labelOf(action));
			// A TOGGLE action (aria-pressed on the toolbar button) mirrors as a checkable
			// menu item, so the menu reads "checked/unchecked" instead of two swapping labels.
			const pressed = action.getAttribute('aria-pressed');
			if (pressed !== null) {
				mi.setAttribute('role', 'menuitemcheckbox');
				mi.setAttribute('aria-checked', pressed);
			} else {
				mi.setAttribute('role', 'menuitem');
			}
			activates(mi, action);
		}
	}

	private focusFirstMenuItem(): void {
		this.contextMenu?.menu
			.querySelector<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]')
			?.focus();
	}

	private onMenuKeydown(e: KeyboardEvent, owner: HTMLElement): void {
		const menu = this.contextMenu?.menu;
		if (!menu) return;
		const items = Array.from(menu.querySelectorAll<HTMLElement>(
			'[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]'));
		const idx = items.indexOf(document.activeElement as HTMLElement);

		switch (e.key) {
			case 'ArrowDown':
			case 'ArrowUp': {
				e.preventDefault();
				const delta = e.key === 'ArrowDown' ? 1 : -1;
				const next = (idx + delta + items.length) % items.length;
				items.forEach((it, i) => { it.tabIndex = i === next ? 0 : -1; });
				items[next]?.focus();
				break;
			}
			case 'Home':
			case 'End': {
				e.preventDefault();
				const target = e.key === 'Home' ? 0 : items.length - 1;
				items.forEach((it, i) => { it.tabIndex = i === target ? 0 : -1; });
				items[target]?.focus();
				break;
			}
			case 'ArrowRight': {
				// The menu convention: Right opens the focused submenu entry.
				const active = document.activeElement as HTMLElement | null;
				if (active?.getAttribute('aria-haspopup') === 'menu') {
					e.preventDefault();
					active.click();
				}
				break;
			}
			case 'ArrowLeft':
			case 'Escape':
			case 'Tab': {
				// Inside a submenu, Escape/Left backs out to the root, refocusing the group
				// entry. At the root, Left stays inert (as always); Escape/Tab close.
				const group = this.contextMenu?.group;
				if (group !== null && group !== undefined && e.key !== 'Tab') {
					e.preventDefault();
					e.stopPropagation();
					this.renderMenuItems(null);
					const back = Array.from(menu.querySelectorAll<HTMLElement>('[aria-haspopup="menu"]'))
						.find(mi => mi.textContent === group);
					(back ?? menu.querySelector<HTMLElement>('[role^="menuitem"]'))?.focus();
					break;
				}
				if (e.key === 'ArrowLeft') break;
				e.preventDefault();
				e.stopPropagation();
				this.closeContextMenu();
				owner.focus();
				break;
			}
			default: {
				// Typeahead, shared with popupMenu: jump to the next item starting with the
				// typed letter. A SOLE match is unambiguous, so activate it outright (like
				// Enter) and close; several matches just cycle focus.
				const match = typeaheadMatch(items.map(it => it.textContent ?? ''), e.key, idx < 0 ? 0 : idx);
				if (!match) return;
				e.preventDefault();
				if (match.unique) {
					items[match.index]?.click();
				} else {
					items.forEach((it, i) => { it.tabIndex = i === match.index ? 0 : -1; });
					items[match.index]?.focus();
				}
				break;
			}
		}
	}

	/**
	 * Suppress the browser's native context menu inside the list and, for a mouse
	 * right-click on an item, open our own accessible menu instead. Keyboard
	 * Shift+F10 / Applications key on an item with actions is already handled by the
	 * keydown path (which moves focus into the menu, so that follow-up `contextmenu`
	 * event lands on the menu and is swallowed there); this also covers the
	 * no-actions case where focus stays on the item and no menu opens.
	 */
	private onListContextMenu(e: MouseEvent): void {
		const target = e.target as Element | null;
		const item = target?.closest<HTMLElement>(this.opts.itemSelector) ?? null;
		if (!item || !this.opts.list.contains(item)) {
			// A right-click on the LIST itself (no row under it — the filtered-empty case)
			// opens the list-level menu when the host declared list actions.
			if (this.opts.listActionsSelector && target
				&& (target === this.opts.list || this.opts.list.contains(target))) {
				e.preventDefault();
				if (this.contextMenu?.owner === this.opts.list) return;
				this.openListContextMenu();
			}
			return;
		}
		e.preventDefault();
		if (this.contextMenu && this.contextMenu.owner === item) return;
		this.openContextMenu(item);
	}

	closeContextMenu(): void {
		if (!this.contextMenu) return;
		this.contextMenu.menu.remove();
		this.contextMenu = null;
	}

	/** Detach the keydown handler and remove any open menu. */
	destroy(): void {
		this.closeContextMenu();
		this.opts.list.removeEventListener('keydown', this.keydownHandler);
		this.opts.list.removeEventListener('contextmenu', this.contextMenuHandler);
	}
}
