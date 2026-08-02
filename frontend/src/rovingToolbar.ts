// rovingToolbar.ts — the ARIA toolbar keyboard model, on its own.
//
// One tab stop, ArrowLeft/Right (and Up/Down) + Home/End between the buttons, native activation.
// A screen reader announces "toolbar" on the way in, which is what tells the reader the arrows
// mean something here; that is the whole bargain, and it only holds if the arrows really work.
//
// This was the in-game action bar's private machinery until the table wanted the same thing. The
// half that is genuinely generic lives here — roving tabindex, the key model, reconciling buttons
// without disturbing a focused survivor, and the never-`disabled` rule — and the half that is
// about a MATCH (which actions exist, what they are called, where the bar is mounted) stays in
// actions/actionBar.ts.
//
// Buttons are rendered from a descriptor list rather than toggled in static markup. That is not
// tidiness: a bar whose contents depend on WHO is reading it (host or guest, mid-match or not) has
// to be able to not-have a button, and hiding one that is always in the document leaves its
// wrapper behind to be kept in sync by hand — the kind of bookkeeping that silently rots.

import { reconcileChildren } from './domReconcile.js';

export interface ToolbarItem {
	/** Identity across renders: a surviving button is updated, never rebuilt. */
	id: string;
	/**
	 * A stable DOM id for this button. Worth having when something outside must point AT the
	 * control — a dialog returning focus to whatever opened it, or a test naming it.
	 */
	elementId?: string;
	/** Already translated — this module never guesses at a locale. */
	label: string;
	/** Announced as the button's shortcut (aria-keyshortcuts), when it has one. */
	shortcut?: string;
	/**
	 * Why this action cannot be taken right now, translated. Present means aria-disabled plus a
	 * described-by hint, and activating it SPEAKS the reason. Never the `disabled` attribute: a
	 * control nobody can reach is a control whose refusal nobody can hear.
	 */
	disabledReason?: string;
	/** Unavailable with nothing to explain (an action already in flight). */
	busy?: boolean;
	/** Extra class for the button, for the one action that carries visual weight. */
	className?: string;
	onActivate: () => void;
}

export interface RovingToolbarOptions {
	/** The toolbar's accessible name, translated. */
	label: string;
	/** Element id, when something outside needs to find it (panel navigation, tests). */
	id?: string;
	className?: string;
	buttonClassName?: string;
	/**
	 * Names the toolbar's internal parts (`<prefix>-buttons`, `-hints`, `-hint`) and its hint ids.
	 * Each toolbar owns its own CSS, and hint ids must not collide between two of them on a page.
	 */
	classPrefix?: string;
	orientation?: 'horizontal' | 'vertical';
	/** Speak a refused action's reason. Without it, a disabled button is silent — don't.  */
	announce?: (text: string) => void;
}

export class RovingToolbar {
	private container: HTMLElement | null = null;
	private list: HTMLElement | null = null;
	/** Disabled-action hints live OUTSIDE the button flow so reconciling only sees buttons. */
	private hintHost: HTMLElement | null = null;
	private buttons: HTMLButtonElement[] = [];
	private readonly hints = new WeakMap<HTMLButtonElement, HTMLElement>();
	private activeIndex = 0;
	private options: RovingToolbarOptions = { label: '' };
	private prefix = 'toolbar';

	/**
	 * Build the toolbar inside `host` (replacing whatever is there). `host` is a plain element in
	 * the page: the caller decides where a toolbar belongs, this decides how it behaves.
	 */
	mount(host: HTMLElement, options: RovingToolbarOptions): void {
		this.options = options;
		this.prefix = options.classPrefix ?? 'toolbar';

		// role="toolbar" is not valid on <section>; a neutral host keeps the exposed role honest.
		const section = document.createElement('div');
		if (options.id) section.id = options.id;
		section.className = options.className ?? '';
		section.setAttribute('role', 'toolbar');
		section.setAttribute('aria-label', options.label);
		section.setAttribute('aria-orientation', options.orientation ?? 'horizontal');
		section.hidden = true; // until there is something in it

		const list = document.createElement('div');
		list.className = `${this.prefix}-buttons`;
		section.appendChild(list);

		const hintHost = document.createElement('div');
		hintHost.className = `${this.prefix}-hints`;
		section.appendChild(hintHost);

		section.addEventListener('keydown', ev => this.onKeyDown(ev));

		host.replaceChildren(section);
		this.container = section;
		this.list = list;
		this.hintHost = hintHost;
	}

	/** Re-name the toolbar, for a language change. */
	setLabel(label: string): void {
		this.options.label = label;
		this.container?.setAttribute('aria-label', label);
	}

	/** Replace the rendered actions. An empty list puts the whole toolbar away. */
	render(items: ToolbarItem[]): void {
		if (!this.container || !this.list) return;

		if (items.length === 0) {
			this.buttons.forEach(button => this.removeHint(button));
			this.list.replaceChildren();
			this.buttons = [];
			this.container.hidden = true;
			this.activeIndex = 0;
			return;
		}
		this.container.hidden = false;

		// Reconciling rather than rebuilding exists for one reason: a button that SURVIVES a
		// render is never touched, so a screen reader does not re-announce the thing the reader
		// is standing on every time something unrelated changes elsewhere.
		const focused = document.activeElement as HTMLElement | null;
		const focusedId = focused && this.buttons.includes(focused as HTMLButtonElement)
			? (focused as HTMLButtonElement).dataset.actionId
			: undefined;

		this.buttons = reconcileChildren(this.list, {
			items,
			key: item => item.id,
			keyOf: el => (el as HTMLElement).dataset.actionId,
			create: item => this.createButton(item),
			update: (button, item) => this.applyItem(button as HTMLButtonElement, item),
			onRemoved: button => this.removeHint(button as HTMLButtonElement),
			// An action that disappears under the keyboard hands focus on rather than dropping
			// the reader onto <body>.
			rescueFocus: () => this.list!.querySelector<HTMLButtonElement>('button'),
		}) as HTMLButtonElement[];

		const survivor = focusedId ? this.buttons.findIndex(b => b.dataset.actionId === focusedId) : -1;
		this.activeIndex = survivor >= 0 ? survivor : 0;
		this.buttons.forEach((button, index) => { button.tabIndex = index === this.activeIndex ? 0 : -1; });
	}

	private createButton(item: ToolbarItem): HTMLButtonElement {
		const button = document.createElement('button');
		button.type = 'button';
		button.dataset.actionId = item.id;
		this.applyItem(button, item);
		return button;
	}

	/** Mutate a button to match its descriptor, changing only what actually differs. */
	private applyItem(button: HTMLButtonElement, item: ToolbarItem): void {
		if (item.elementId && button.id !== item.elementId) button.id = item.elementId;
		const className = [this.options.buttonClassName, item.className].filter(Boolean).join(' ');
		if (button.className !== className) button.className = className;
		if (button.textContent !== item.label) button.textContent = item.label;

		if (item.shortcut) {
			if (button.getAttribute('aria-keyshortcuts') !== item.shortcut) {
				button.setAttribute('aria-keyshortcuts', item.shortcut);
			}
		} else {
			button.removeAttribute('aria-keyshortcuts');
		}

		if (item.disabledReason) {
			button.setAttribute('aria-disabled', 'true');
			const hintId = `${this.prefix}-hint-${item.id}`;
			if (button.getAttribute('aria-describedby') !== hintId) {
				button.setAttribute('aria-describedby', hintId);
			}
			let hint = this.hints.get(button);
			if (!hint) {
				hint = document.createElement('span');
				hint.id = hintId;
				hint.className = `${this.prefix}-hint`;
				this.hints.set(button, hint);
				this.hintHost?.appendChild(hint);
			}
			if (hint.textContent !== item.disabledReason) hint.textContent = item.disabledReason;
			button.onclick = () => {
				this.activeIndex = this.buttons.indexOf(button);
				this.options.announce?.(item.disabledReason!);
			};
			return;
		}

		if (item.busy) button.setAttribute('aria-disabled', 'true');
		else button.removeAttribute('aria-disabled');
		button.removeAttribute('aria-describedby');
		this.removeHint(button);
		button.onclick = () => {
			this.activeIndex = this.buttons.indexOf(button);
			item.onActivate();
		};
	}

	private removeHint(button: HTMLButtonElement): void {
		const hint = this.hints.get(button);
		if (hint) {
			hint.remove();
			this.hints.delete(button);
		}
	}

	/** Move the keyboard into the toolbar. False when there is nothing to move into. */
	focus(): boolean {
		if (!this.container || this.container.hidden || this.buttons.length === 0) return false;
		this.setActiveIndex(Math.min(this.activeIndex, this.buttons.length - 1), true);
		return true;
	}

	get element(): HTMLElement | null {
		return this.container;
	}

	get hasItems(): boolean {
		return this.buttons.length > 0 && !!this.container && !this.container.hidden;
	}

	private setActiveIndex(index: number, focus: boolean): void {
		if (this.buttons.length === 0) return;
		this.activeIndex = Math.max(0, Math.min(index, this.buttons.length - 1));
		this.buttons.forEach((button, i) => { button.tabIndex = i === this.activeIndex ? 0 : -1; });
		if (focus) this.buttons[this.activeIndex]?.focus();
	}

	private onKeyDown(event: KeyboardEvent): void {
		if (this.buttons.length === 0) return;
		const last = this.buttons.length - 1;
		switch (event.key) {
			case 'ArrowRight':
			case 'ArrowDown':
				event.preventDefault();
				this.setActiveIndex((this.activeIndex + 1) % this.buttons.length, true);
				break;
			case 'ArrowLeft':
			case 'ArrowUp':
				event.preventDefault();
				this.setActiveIndex((this.activeIndex - 1 + this.buttons.length) % this.buttons.length, true);
				break;
			case 'Home':
				event.preventDefault();
				this.setActiveIndex(0, true);
				break;
			case 'End':
				event.preventDefault();
				this.setActiveIndex(last, true);
				break;
		}
	}
}
