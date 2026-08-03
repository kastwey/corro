// comboBox.ts — an editable combobox with a list you can also just walk.
//
// The ARIA "combobox with list autocomplete" pattern, in the variation where DOM focus MOVES into
// the listbox rather than staying in the textbox with aria-activedescendant. Both are valid; this
// one is chosen because it makes the list a real place. You can ignore the typing entirely and
// arrow through everything, which is how somebody who does not know the catalogue finds a game,
// and it is what makes rule (d) below possible at all.
//
// The behaviour, in the order somebody meets it:
//
//   * The list is always on screen, under the field, and is never a tab stop. You get into it with
//     Down (to the first item) or Up (to the last) — so the list reads as a loop hanging off the
//     field, and Up is a shortcut to the end rather than a dead key.
//   * Typing filters. Selecting an item puts its name in the field.
//   * From an item, any key that would TYPE something — a letter, Backspace, Delete — sends you
//     back to the field and performs that edit there. Nobody should have to know they must first
//     travel back to the box to correct a search they can see is wrong.
//   * The result count is shown instantly on screen and spoken LATE. Announcing on every keystroke
//     turns a four-letter search into four interruptions; the count is only interesting once the
//     typing stops, so the spoken copy waits for a pause (see ANNOUNCE_DELAY_MS).
//
// The two copies of that count are separate elements on purpose: one visible and aria-hidden, one
// visually hidden and live. One element cannot be both instant and patient.

export interface ComboBoxItem {
	readonly id: string;
	readonly label: string;
}

export interface ComboBoxOptions {
	/** The field. Must already carry role="combobox" and point at the listbox. */
	input: HTMLInputElement;
	/** The listbox element. Its options are built here. */
	listbox: HTMLElement;
	/** The count on screen: updated the moment the filter changes, and aria-hidden. */
	visualStatus: HTMLElement | null;
	/** The count for a screen reader: a live region, updated only once typing stops. */
	liveStatus: HTMLElement | null;
	/** "3 results found" / "No results" — the caller owns the words and their plurals. */
	describeResults: (count: number) => string;
	/** Fired when the reader picks something, and when a re-render invalidates the choice. */
	onSelect?: (item: ComboBoxItem | null) => void;
	/** Sorting language. Alphabetical means alphabetical for the reader, not for ASCII. */
	locale?: string;
	announceDelayMs?: number;
	/** Test seams, so the debounce can be driven without waiting in real time. */
	schedule?: (callback: () => void, ms: number) => number;
	cancel?: (handle: number) => void;
}

/** Long enough to cover the gap between keystrokes, short enough to feel like an answer. */
const ANNOUNCE_DELAY_MS = 500;

/** Case- and accent-insensitive, because "Espana" must find "España". */
export function normalizeForSearch(value: string): string {
	return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

/** The items whose label contains the query. An empty query matches everything. */
export function filterItems(
	items: readonly ComboBoxItem[],
	query: string,
): ComboBoxItem[] {
	const needle = normalizeForSearch(query);
	if (!needle) return [...items];
	return items.filter(item => normalizeForSearch(item.label).includes(needle));
}

/** Alphabetical in the reader's language: localeCompare, not code-point order. */
export function sortItems(items: readonly ComboBoxItem[], locale: string): ComboBoxItem[] {
	return [...items].sort((a, b) => a.label.localeCompare(b.label, locale));
}

export class ComboBox {
	private items: ComboBoxItem[] = [];
	private visible: ComboBoxItem[] = [];
	/**
	 * What the reader is SEARCHING for, which is not the same as what the field says. After a
	 * choice the field holds the game's name, and filtering by that would leave one item on
	 * screen — which reads as "there is only one" rather than "this is the one you picked".
	 * The query is only ever set by typing.
	 */
	private query = '';
	private selectedId: string | null = null;
	private announceHandle: number | null = null;
	private readonly optionIdPrefix: string;

	constructor(private readonly options: ComboBoxOptions) {
		this.optionIdPrefix = `${options.listbox.id || 'combo'}-option`;
		options.input.addEventListener('input', () => this.onInput());
		// Coming into the field selects what is in it, so the first keystroke REPLACES a committed
		// game name instead of extending it. Same reason as editFromList: typing means searching.
		options.input.addEventListener('focus', () => {
			if (this.query === '') options.input.select();
		});
		options.input.addEventListener('keydown', event => this.onInputKeyDown(event));
		options.listbox.addEventListener('keydown', event => this.onOptionKeyDown(event));
		options.listbox.addEventListener('click', event => this.onOptionClick(event));
	}

	/**
	 * Replace the catalogue. The list is sorted here rather than by the caller so every combobox
	 * is ordered the same way, and a selection that survives the change is kept — re-rendering
	 * because a language arrived must not silently pick a different game.
	 */
	setItems(items: readonly ComboBoxItem[]): void {
		this.items = sortItems(items, this.options.locale ?? document.documentElement.lang ?? 'en');
		if (this.selectedId && !this.items.some(item => item.id === this.selectedId)) {
			this.selectedId = null;
			this.options.onSelect?.(null);
		}
		this.render({ announce: false });
	}

	/** The chosen item's id, or null while nothing is chosen. */
	get value(): string | null {
		return this.selectedId;
	}

	/**
	 * Choose an item programmatically (restoring a saved choice, or defaulting to the first). The
	 * field shows its name and the SEARCH is cleared, because a field showing "Uno" that is also
	 * filtering by "Uno" is a trap: the reader sees one item and assumes there is only one.
	 */
	setValue(id: string | null, options: { notify?: boolean } = {}): void {
		const item = this.items.find(candidate => candidate.id === id) ?? null;
		this.selectedId = item?.id ?? null;
		this.options.input.value = item?.label ?? '';
		this.query = '';
		this.render({ announce: false });
		if (options.notify !== false) this.options.onSelect?.(item);
	}

	/** The items currently on offer, in the order they are shown. Exposed for tests. */
	get visibleItems(): readonly ComboBoxItem[] {
		return this.visible;
	}

	private onInput(): void {
		this.query = this.options.input.value;
		this.render({ announce: true });
	}

	private onInputKeyDown(event: KeyboardEvent): void {
		if (event.altKey || event.ctrlKey || event.metaKey) return;
		switch (event.key) {
			case 'ArrowDown':
				event.preventDefault();
				this.focusOption(0);
				break;
			case 'ArrowUp':
				// Up from the field is a shortcut to the END of the list, not a dead key.
				event.preventDefault();
				this.focusOption(this.visible.length - 1);
				break;
			case 'Enter':
				// This field lives inside the create form, so Enter must never reach it and submit
				// a half-filled game. With one candidate left, Enter is the obvious "that one".
				event.preventDefault();
				if (this.visible.length === 1) this.choose(this.visible[0]);
				break;
			case 'Escape':
				// Back to the chosen game and the whole list, rather than an empty field the
				// reader now has to reconstruct.
				event.preventDefault();
				this.setValue(this.selectedId, { notify: false });
				break;
		}
	}

	private onOptionKeyDown(event: KeyboardEvent): void {
		if (event.ctrlKey || event.metaKey || event.altKey) return;
		const options = this.optionElements();
		const index = options.indexOf(document.activeElement as HTMLElement);
		if (index < 0) return;

		switch (event.key) {
			case 'ArrowDown':
				event.preventDefault();
				// Past the end is back to the field: the list hangs off it, so it is where you
				// come back to rather than a wall.
				if (index === options.length - 1) this.options.input.focus();
				else this.focusOption(index + 1);
				return;
			case 'ArrowUp':
				event.preventDefault();
				if (index === 0) this.options.input.focus();
				else this.focusOption(index - 1);
				return;
			case 'Home':
				event.preventDefault();
				this.focusOption(0);
				return;
			case 'End':
				event.preventDefault();
				this.focusOption(options.length - 1);
				return;
			case 'Enter':
			case ' ':
				event.preventDefault();
				this.choose(this.visible[index]);
				return;
			case 'Escape':
				event.preventDefault();
				this.options.input.focus();
				return;
			case 'Backspace':
			case 'Delete':
				// Correcting the search from inside the list, without having to know you must
				// travel back to the field first.
				event.preventDefault();
				this.editFromList(current => current.slice(0, -1));
				return;
			case 'Tab':
				// Native: the options are never tab stops, so this leaves the whole control.
				return;
		}

		if (event.key.length === 1) {
			event.preventDefault();
			this.editFromList(current => current + event.key);
		}
	}

	private onOptionClick(event: MouseEvent): void {
		const option = (event.target as HTMLElement | null)?.closest<HTMLElement>('[role="option"]');
		if (!option) return;
		const item = this.visible.find(candidate => candidate.id === option.dataset.itemId);
		if (item) this.choose(item);
	}

	/**
	 * Hand the keystroke to the field, where it belongs, and let the filter follow.
	 *
	 * The edit continues the SEARCH, not the text on screen. After a choice the field holds the
	 * game's name, and appending to that ("Carrera Galácticas" + "s") searches for something
	 * nobody asked for and finds nothing — whereas typing a letter while looking at the list
	 * plainly means "start looking for this".
	 */
	private editFromList(edit: (current: string) => string): void {
		const input = this.options.input;
		input.value = edit(this.query);
		this.query = input.value;
		input.focus();
		input.setSelectionRange(input.value.length, input.value.length);
		this.render({ announce: true });
	}

	private choose(item: ComboBoxItem | undefined): void {
		if (!item) return;
		this.setValue(item.id);
		this.options.input.focus();
	}

	private focusOption(index: number): void {
		const options = this.optionElements();
		if (options.length === 0) return;
		const clamped = Math.max(0, Math.min(index, options.length - 1));
		options[clamped]?.focus();
	}

	private optionElements(): HTMLElement[] {
		return Array.from(this.options.listbox.querySelectorAll<HTMLElement>('[role="option"]'));
	}

	private render(options: { announce: boolean }): void {
		this.visible = filterItems(this.items, this.query);

		this.options.listbox.replaceChildren(...this.visible.map((item, index) => {
			const option = document.createElement('li');
			option.id = `${this.optionIdPrefix}-${index}`;
			option.setAttribute('role', 'option');
			option.className = 'combo-option';
			// Never a tab stop: the way in is the arrow key, which is the bargain the field's
			// role and the arrows advertise.
			option.tabIndex = -1;
			option.dataset.itemId = item.id;
			option.textContent = item.label;
			option.setAttribute('aria-selected', String(item.id === this.selectedId));
			return option;
		}));

		// A popup with nothing in it is not expanded, whatever is on screen.
		this.options.input.setAttribute('aria-expanded', String(this.visible.length > 0));

		const described = this.options.describeResults(this.visible.length);
		if (this.options.visualStatus) this.options.visualStatus.textContent = described;
		if (options.announce) this.scheduleAnnouncement(described);
	}

	/**
	 * Speak the count once the typing stops. Every keystroke cancels the pending one, so a
	 * four-letter search is one announcement rather than four — the reader hears the answer, not
	 * the search being carried out.
	 */
	private scheduleAnnouncement(text: string): void {
		const cancel = this.options.cancel ?? ((handle: number) => window.clearTimeout(handle));
		const schedule = this.options.schedule
			?? ((callback: () => void, ms: number) => window.setTimeout(callback, ms));

		if (this.announceHandle !== null) cancel(this.announceHandle);
		this.announceHandle = schedule(() => {
			this.announceHandle = null;
			if (this.options.liveStatus) this.options.liveStatus.textContent = text;
		}, this.options.announceDelayMs ?? ANNOUNCE_DELAY_MS);
	}
}
