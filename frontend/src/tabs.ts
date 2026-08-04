// tabs.ts — the tab pattern, once.
//
// Two surfaces want it (the friends view, the settings screen) and there was none, so this is it
// rather than two that drift. It is the ARIA authoring-practices tablist: one tab stop for the whole
// strip, Left/Right between tabs, Home/End to the ends, and Tab from a tab into its panel.
//
// Selection follows the arrows rather than waiting for Enter. That is the right trade HERE because
// every panel is already in the page and costs nothing to reveal: a reader arrowing along the strip
// hears each tab AND lands in the content they asked for, instead of learning that they must press
// something else to actually get there. Where a panel were expensive to build, manual activation
// would be the kinder choice, and this would need an option.
//
// Panels are hidden with the `hidden` attribute, which now genuinely means hidden (see the rule in
// global.css and styles.css) — an earlier version of that would have left every panel on screen at
// once, and this pattern only works if exactly one is.

export interface TabsOptions {
	/** The element carrying role="tablist". Its `[role=tab]` descendants are the tabs. */
	tablist: HTMLElement;
	/** Called with the newly selected tab's id whenever selection changes. */
	onSelect?: (tabId: string) => void;
	/** Which tab to start on. Defaults to the first, or the one already marked selected. */
	initial?: string;
}

/** Every tab in a strip, in document order. */
function tabsIn(tablist: HTMLElement): HTMLElement[] {
	return Array.from(tablist.querySelectorAll<HTMLElement>('[role="tab"]'));
}

/** The panel a tab controls, or null when it names one that is not there. */
function panelFor(tab: HTMLElement): HTMLElement | null {
	const id = tab.getAttribute('aria-controls');
	return id ? document.getElementById(id) : null;
}

/**
 * Where an arrow key goes from the tab at `current`. Pure, so the wrapping — which is the part
 * everybody gets wrong at the ends — is testable without a DOM.
 */
export function nextTabIndex(current: number, key: string, count: number): number {
	if (count === 0) return -1;
	switch (key) {
		case 'ArrowRight': return (current + 1) % count;
		case 'ArrowLeft': return (current - 1 + count) % count;
		case 'Home': return 0;
		case 'End': return count - 1;
		default: return current;
	}
}

export class Tabs {
	private readonly tabs: HTMLElement[];

	constructor(private readonly options: TabsOptions) {
		this.tabs = tabsIn(options.tablist);
		options.tablist.addEventListener('keydown', event => this.onKeyDown(event));
		for (const tab of this.tabs) {
			tab.addEventListener('click', () => this.select(tab.id));
		}

		const already = this.tabs.find(tab => tab.getAttribute('aria-selected') === 'true');
		this.select(options.initial ?? already?.id ?? this.tabs[0]?.id ?? '', { silent: true });
	}

	/** The tab showing now. */
	selected(): string {
		return this.tabs.find(tab => tab.getAttribute('aria-selected') === 'true')?.id ?? '';
	}

	/** Show one tab's panel and hide the rest. Moves focus unless it is the initial paint. */
	select(tabId: string, options: { silent?: boolean } = {}): void {
		const chosen = this.tabs.find(tab => tab.id === tabId) ?? this.tabs[0];
		if (!chosen) return;

		for (const tab of this.tabs) {
			const isChosen = tab === chosen;
			tab.setAttribute('aria-selected', String(isChosen));
			// One tab stop for the strip: the arrows do the rest, so Tab never walks every tab.
			tab.tabIndex = isChosen ? 0 : -1;
			const panel = panelFor(tab);
			if (panel) panel.hidden = !isChosen;
		}

		if (!options.silent) {
			chosen.focus();
			this.options.onSelect?.(chosen.id);
		}
	}

	/** Re-label a tab, for a count that changes ("Requests, 2 waiting"). */
	setLabel(tabId: string, label: string): void {
		const tab = this.tabs.find(t => t.id === tabId);
		if (tab && tab.textContent !== label) tab.textContent = label;
	}

	private onKeyDown(event: KeyboardEvent): void {
		if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
		const current = this.tabs.findIndex(tab => tab === document.activeElement);
		if (current < 0) return;

		event.preventDefault();
		const next = nextTabIndex(current, event.key, this.tabs.length);
		this.select(this.tabs[next].id);
	}
}
