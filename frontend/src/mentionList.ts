// mentionList.ts — the floating list of names an "@" offers, once.
//
// Two chats want it. The in-game one had it right and the lobby's had it wrong in a way that only
// somebody listening would notice: bare buttons in a plain container, so a screen reader announced
// each one with no idea it was in a list at all — no position, no count, nothing to say how many
// more there were. That is the whole reason this is now one widget instead of two.
//
// The interaction is the one that was specified for the in-game chat and is kept exactly:
//
//  * REAL focus moves into the list. Not aria-activedescendant — the reader hears the option itself.
//  * ↑/↓ walk it, Enter and Tab complete, Escape closes.
//  * ←/→ hand focus back to the text so it can be read character by character, which an option list
//    cannot be. The list stays open; typing or ↑/↓ return to it.
//
// It renders and navigates. WHICH names are offered, and what completing one does, belong to the
// chat that owns it.

/** What a mention list needs from the surface around it. */
export interface MentionListDeps {
	/** The <ul role="listbox"> the options live in. */
	list: HTMLElement;
	/** The box being typed into, which focus returns to. */
	input: HTMLElement;
	/** Called with the chosen name. The caller edits the text; this widget does not. */
	onChoose: (name: string) => void;
	/**
	 * Called after a character typed ON the list has been put into the text. The owner re-filters
	 * and shows again, which is what makes typing narrow the list without leaving it — the
	 * alternative is a reader having to hop back to the box for every letter.
	 */
	onTyped?: () => void;
	/** Said when the list opens, so somebody listening learns it is there and how big it is. */
	announce?: (text: string) => void;
	/** Wording for that announcement, given how many matched. */
	countText?: (count: number) => string;
}

export class MentionList {
	private names: string[] = [];
	private active = 0;

	constructor(private readonly deps: MentionListDeps) {
		deps.list.addEventListener('keydown', event => this.onKeyDown(event));
	}

	/** Whether the list is showing anything. */
	get isOpen(): boolean {
		return this.names.length > 0;
	}

	/**
	 * Offer these names. An empty list closes rather than showing an empty box, and the count is
	 * said out loud: a list that appears in silence is one somebody listening never learns about.
	 */
	show(names: readonly string[], options: { takeFocus?: boolean } = {}): void {
		this.names = [...names];
		if (this.names.length === 0) {
			this.close();
			return;
		}

		this.active = 0;
		this.render();
		this.deps.list.hidden = false;
		if (this.deps.announce && this.deps.countText) {
			this.deps.announce(this.deps.countText(this.names.length));
		}
		if (options.takeFocus !== false) this.focusOption(0);
	}

	close(): void {
		this.names = [];
		this.deps.list.replaceChildren();
		this.deps.list.hidden = true;
	}

	/** Move the keyboard into the list from outside it (the Down that the announcement invites). */
	focusFirst(): void {
		if (this.isOpen) this.focusOption(this.active);
	}

	private render(): void {
		this.deps.list.replaceChildren(...this.names.map((name, i) => {
			const option = document.createElement('li');
			// role=option inside role=listbox is what gives a reader "3 of 7" instead of a button
			// floating on its own.
			option.setAttribute('role', 'option');
			option.setAttribute('aria-selected', String(i === this.active));
			option.className = 'mention-option';
			option.tabIndex = i === this.active ? 0 : -1;
			option.textContent = name;
			option.addEventListener('click', () => this.choose(i));
			return option;
		}));
	}

	private options(): HTMLElement[] {
		return Array.from(this.deps.list.querySelectorAll<HTMLElement>('[role="option"]'));
	}

	private focusOption(index: number): void {
		const options = this.options();
		if (options.length === 0) return;
		this.active = Math.max(0, Math.min(index, options.length - 1));
		options.forEach((option, i) => {
			option.tabIndex = i === this.active ? 0 : -1;
			option.setAttribute('aria-selected', String(i === this.active));
		});
		options[this.active].focus();
	}

	private choose(index: number): void {
		const name = this.names[index];
		this.close();
		if (name !== undefined) this.deps.onChoose(name);
	}

	private onKeyDown(event: KeyboardEvent): void {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			event.stopPropagation();
			this.focusOption(this.active + (event.key === 'ArrowDown' ? 1 : -1));
			return;
		}
		if (event.key === 'Enter' || event.key === 'Tab') {
			event.preventDefault();
			event.stopPropagation();
			this.choose(this.active);
			return;
		}
		if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
			// Back to the text, so it can be read character by character — which an option list
			// cannot be. The list stays open; ↑/↓ or typing return to it.
			event.preventDefault();
			event.stopPropagation();
			this.deps.input.focus();
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			this.close();
			this.deps.input.focus();
			return;
		}

		// Typing while standing IN the list keeps typing into the text and narrows what is offered.
		// Without it every letter would mean going back to the box and returning, which is the
		// difference between a list you can use and one you fight.
		if (this.deps.onTyped && !event.ctrlKey && !event.altKey && !event.metaKey) {
			if (event.key.length === 1) {
				event.preventDefault();
				this.typeIntoInput(event.key);
				return;
			}
			if (event.key === 'Backspace') {
				event.preventDefault();
				this.typeIntoInput('');
			}
		}
	}

	/** Insert (or, for an empty string, delete) one character at the text's caret. */
	private typeIntoInput(char: string): void {
		const input = this.deps.input as HTMLInputElement | HTMLTextAreaElement;
		const caret = input.selectionStart ?? input.value.length;
		if (char.length === 0) {
			if (caret === 0) return;
			input.value = input.value.slice(0, caret - 1) + input.value.slice(caret);
			input.setSelectionRange(caret - 1, caret - 1);
		} else {
			input.value = input.value.slice(0, caret) + char + input.value.slice(caret);
			input.setSelectionRange(caret + 1, caret + 1);
		}
		this.deps.onTyped?.();
	}
}
