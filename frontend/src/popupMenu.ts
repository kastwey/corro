// popupMenu.ts — A reusable accessible popup menu implementing the WAI-ARIA menu pattern
// (https://www.w3.org/WAI/ARIA/apg/patterns/menu/), like a desktop context menu:
//
//   • The container is role="menu" with an aria-label; each option is role="menuitem".
//   • Exactly one item is in the Tab order at a time (roving tabindex). Focus moves with the
//     ARROW keys (Up/Down, wrapping), Home/End jump to the first/last item, and a typed
//     character jumps to the next item starting with it (typeahead).
//   • Enter/Space activate the focused item; Escape or Tab close the menu and return focus
//     to the opener; a click outside also closes it.
//   • Unaffordable options stay focusable but are marked aria-disabled with an
//     aria-describedby hint; activating one voices the reason instead of acting, per the
//     project's accessibility rules (never use the `disabled` attribute).
//
// The keyboard decision and typeahead lookup are extracted as pure functions so they can be
// unit-tested without a DOM.

export interface PopupMenuItem {
	label: string;
	/** When true the item is shown aria-disabled and activating it voices `reason`. */
	disabled?: boolean;
	/** Spoken when a disabled item is activated (why it is unavailable). */
	reason?: string;
	/** Runs when an enabled item is activated (the menu closes first). */
	onSelect: () => void;
}

export interface PopupMenuOptions {
	/** Accessible name for the menu (role="menu" aria-label). */
	ariaLabel: string;
	items: PopupMenuItem[];
	/** Element the menu is anchored to: positions the popup and gets aria-expanded. */
	anchor?: HTMLElement | null;
	/** Called after the menu closes, to restore focus to the opener. */
	onClose?: () => void;
	/** Called ONLY when the menu closes without a selection (Escape, Tab, outside click) —
	 *  e.g. to voice that a pending multi-step play was cancelled. Runs after onClose. */
	onCancel?: () => void;
	/** Voices the disabled-reason and the optional open announcement. */
	announce?: (text: string) => void;
	/** Spoken once when the menu opens (e.g. the square name). */
	openAnnouncement?: string;
}

/** What a key press maps to inside an open menu. */
export type MenuKeyResult = number | 'activate' | 'close' | null;

/**
 * Pure keyboard mapping for the ARIA menu pattern. Returns the index to move focus to, the
 * intent ('activate' / 'close'), or null when the key is not handled. Navigation wraps.
 */
export function nextMenuIndex(key: string, current: number, count: number): MenuKeyResult {
	if (count <= 0) return key === 'Escape' || key === 'Tab' ? 'close' : null;
	switch (key) {
		case 'ArrowDown': return (current + 1) % count;
		case 'ArrowUp': return (current - 1 + count) % count;
		case 'Home': return 0;
		case 'End': return count - 1;
		case 'Enter':
		case ' ':
		case 'Spacebar': // legacy key name
			return 'activate';
		case 'Escape':
		case 'Tab':
			return 'close';
		default:
			return null;
	}
}

/** A typeahead hit: where to move, and whether it was the ONLY item starting with the key. */
export interface TypeaheadMatch {
	index: number;
	/** True when exactly one item starts with the typed character (→ auto-activate + close). */
	unique: boolean;
}

/**
 * Typeahead with single-match detection. Finds every item whose label starts with `char`
 * (case-insensitive); returns the next one circularly after `fromIndex` to move focus to,
 * plus whether it was the SOLE match. A sole match lets the caller activate it outright (like
 * pressing Enter) so a quick keystroke selects an unambiguous option without a second press.
 * Returns null when nothing matches or `char` is not a single printable key.
 */
export function typeaheadMatch(labels: readonly string[], char: string, fromIndex: number): TypeaheadMatch | null {
	if (!char || char.length !== 1 || char === ' ') return null;
	const needle = char.toLowerCase();
	const count = labels.length;
	const matches: number[] = [];
	for (let i = 0; i < count; i++) {
		if ((labels[i] ?? '').trim().toLowerCase().startsWith(needle)) matches.push(i);
	}
	if (matches.length === 0) return null;
	// The item to focus is the first match circularly after the current position.
	let next = matches[0];
	for (let step = 1; step <= count; step++) {
		const i = (fromIndex + step) % count;
		if (matches.includes(i)) { next = i; break; }
	}
	return { index: next, unique: matches.length === 1 };
}

class PopupMenu {
	private menu: HTMLElement | null = null;
	private buttons: HTMLButtonElement[] = [];
	private items: PopupMenuItem[] = [];
	private anchor: HTMLElement | null = null;
	private onClose?: () => void;
	private onCancel?: () => void;
	private announce?: (text: string) => void;
	/** True while close() runs because an item was ACTIVATED (a real selection, not a cancel). */
	private selecting = false;
	private activeIndex = 0;
	private readonly outsideHandler = (e: Event) => this.onOutsidePointer(e);

	open(opts: PopupMenuOptions): void {
		// Re-opening replaces any previous menu so the newest opener always wins.
		if (this.menu) this.close();
		if (opts.items.length === 0) return;

		this.items = opts.items;
		this.anchor = opts.anchor ?? null;
		this.onClose = opts.onClose;
		this.onCancel = opts.onCancel;
		this.announce = opts.announce;
		this.activeIndex = 0;

		const menu = document.createElement('div');
		menu.className = 'popup-menu';
		menu.setAttribute('role', 'menu');
		menu.setAttribute('aria-label', opts.ariaLabel);

		this.buttons = opts.items.map((item, idx) => this.buildItem(menu, item, idx));

		menu.addEventListener('keydown', (e) => this.onKeydown(e));
		// The keyboard Applications / Shift+F10 key fires a follow-up `contextmenu` event;
		// swallow it so the browser's native menu never appears over ours.
		menu.addEventListener('contextmenu', (e) => e.preventDefault());

		// Keep transient UI inside the closest semantic page/dialog region. Appending directly
		// to body leaves the menu outside every landmark on the board page; fixed positioning
		// still uses viewport coordinates regardless of this semantic host.
		const host = this.anchor?.closest<HTMLElement>('dialog, main, [role="main"], [role="region"]')
			?? document.querySelector<HTMLElement>('main, [role="main"]')
			?? document.body;
		host.appendChild(menu);
		this.menu = menu;
		this.position(menu, this.anchor);

		if (this.anchor) this.anchor.setAttribute('aria-expanded', 'true');
		// Defer the outside-click listener so the very click that opened the menu (still
		// bubbling) does not immediately close it.
		setTimeout(() => document.addEventListener('pointerdown', this.outsideHandler, true), 0);

		if (opts.openAnnouncement) this.announce?.(opts.openAnnouncement);
		this.focusItem(0);
	}

	isOpen(): boolean {
		return this.menu !== null;
	}

	close(): void {
		if (!this.menu) return;
		document.removeEventListener('pointerdown', this.outsideHandler, true);
		this.menu.remove();
		this.menu = null;
		this.buttons = [];
		this.items = [];
		if (this.anchor) this.anchor.setAttribute('aria-expanded', 'false');
		this.anchor = null;
		const onClose = this.onClose;
		const onCancel = this.selecting ? undefined : this.onCancel;
		this.onClose = undefined;
		this.onCancel = undefined;
		this.announce = undefined;
		onClose?.();
		onCancel?.();
	}

	private buildItem(menu: HTMLElement, item: PopupMenuItem, idx: number): HTMLButtonElement {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'popup-menu__item';
		btn.setAttribute('role', 'menuitem');
		btn.tabIndex = idx === 0 ? 0 : -1;
		btn.textContent = item.label;
		btn.addEventListener('click', () => this.activate(idx));
		menu.appendChild(btn);

		if (item.disabled) {
			btn.setAttribute('aria-disabled', 'true');
			if (item.reason) {
				const hintId = `popup-menu-hint-${idx}`;
				btn.setAttribute('aria-describedby', hintId);
				const hint = document.createElement('span');
				hint.id = hintId;
				hint.className = 'popup-menu__hint';
				hint.textContent = item.reason;
				menu.appendChild(hint);
			}
		}
		return btn;
	}

	private onKeydown(e: KeyboardEvent): void {
		// While the menu is open it owns the keyboard: stop every key from reaching the
		// board's global shortcut handler (keys.ts) so e.g. a letter doesn't both typeahead
		// here AND trigger a board command. (The page focus trap runs in the capture phase
		// and still sees Tab, so wrap-around is unaffected.)
		e.stopPropagation();

		const count = this.buttons.length;
		const result = nextMenuIndex(e.key, this.activeIndex, count);

		if (result === null) {
			// Not a navigation/activation key: try typeahead (printable single character).
			const match = typeaheadMatch(this.items.map(i => i.label), e.key, this.activeIndex);
			if (match !== null) {
				e.preventDefault();
				// A sole match is unambiguous: activate it outright (and close), so a single
				// keystroke selects it. Several matches → just cycle focus to the next one.
				if (match.unique) {
					this.activate(match.index);
				} else {
					this.focusItem(match.index);
				}
			}
			return;
		}

		e.preventDefault();

		if (result === 'close') {
			this.close();
			return;
		}
		if (result === 'activate') {
			this.activate(this.activeIndex);
			return;
		}
		this.focusItem(result);
	}

	/** Activate item `idx`: enabled items run their handler (menu closes first); disabled ones voice the reason. */
	private activate(idx: number): void {
		const item = this.items[idx];
		if (!item) return;
		if (item.disabled) {
			this.focusItem(idx);
			if (item.reason) this.announce?.(item.reason);
			return;
		}
		const onSelect = item.onSelect;
		this.selecting = true;
		try {
			this.close();
		} finally {
			this.selecting = false;
		}
		onSelect();
	}

	private focusItem(idx: number): void {
		if (idx < 0 || idx >= this.buttons.length) return;
		this.activeIndex = idx;
		this.buttons.forEach((b, i) => { b.tabIndex = i === idx ? 0 : -1; });
		this.buttons[idx]?.focus();
	}

	private onOutsidePointer(e: Event): void {
		if (!this.menu) return;
		const target = e.target as Node | null;
		if (target && this.menu.contains(target)) return;
		this.close();
	}

	/** Position the popup near its anchor, kept within the viewport. */
	private position(menu: HTMLElement, anchor: HTMLElement | null): void {
		const rect = anchor?.getBoundingClientRect();
		const top = rect ? rect.bottom : 8;
		const left = rect ? rect.left : 8;
		const maxLeft = Math.max(8, window.innerWidth - menu.offsetWidth - 8);
		const maxTop = Math.max(8, window.innerHeight - menu.offsetHeight - 8);
		menu.style.top = `${Math.min(Math.max(8, top), maxTop)}px`;
		menu.style.left = `${Math.min(Math.max(8, left), maxLeft)}px`;
	}
}

export const popupMenu = new PopupMenu();
