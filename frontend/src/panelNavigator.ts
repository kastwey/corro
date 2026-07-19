// panelNavigator.ts — F6 / Shift+F6 cycling across the board's landmark regions
// for screen-reader users. Each registered region exposes a way to grab focus
// and (optionally) declare whether it is currently available (e.g. the action
// bar hides when empty). When focus moves to a region, its name is announced so
// the user always knows where they are.

export interface PanelRegion {
	id: string;
	/** i18n key (already namespaced) for the region's spoken name. */
	labelKey: string;
	/** Optional: a DYNAMIC spoken name computed on entry (key + interpolation vars).
	 *  Used by regions whose identity changes, e.g. the open dialog announces its
	 *  title — the reason it exists — not just "dialog". Falls back to labelKey. */
	getLabel?: () => { key: string; vars?: Record<string, unknown> };
	/** The region's container element, used to detect the current region. */
	getElement: () => HTMLElement | null;
	/** Move focus into the region. Returns false if it could not take focus. */
	focus: () => boolean;
	/** Optional: whether the region is currently focusable (default: true). */
	isAvailable?: () => boolean;
}

class PanelNavigator {
	private regions: PanelRegion[] = [];
	private announce: ((labelKey: string, vars?: Record<string, unknown>) => void) | null = null;

	init(announce: (labelKey: string, vars?: Record<string, unknown>) => void): void {
		this.announce = announce;
	}

	register(region: PanelRegion): void {
		if (this.regions.some(r => r.id === region.id)) return;
		this.regions.push(region);
	}

	/** Clear all registrations (used by tests). */
	reset(): void {
		this.regions = [];
	}

	/** Focus the next available region after the one that currently holds focus. */
	next(): boolean {
		return this.move(1);
	}

	/** Focus the previous available region before the one that currently holds focus. */
	prev(): boolean {
		return this.move(-1);
	}

	/** Focus a specific region by id (used by direct shortcuts like Ctrl+Shift+A). */
	focusById(id: string): boolean {
		const region = this.regions.find(r => r.id === id);
		if (!region || !this.available(region)) return false;
		return this.activate(region);
	}

	private available(region: PanelRegion): boolean {
		return region.isAvailable ? region.isAvailable() : true;
	}

	private currentIndex(): number {
		const active = document.activeElement as HTMLElement | null;
		if (!active) return -1;
		return this.regions.findIndex(r => {
			const el = r.getElement();
			return !!el && (el === active || el.contains(active));
		});
	}

	private move(direction: 1 | -1): boolean {
		const count = this.regions.length;
		if (count === 0) return false;
		const start = this.currentIndex();
		// When nothing is focused yet, bias the base so the first step lands on
		// the first region (forward) or the last region (backward).
		const base = start === -1 ? (direction === 1 ? -1 : 0) : start;
		// Walk through the ring once looking for the next available region.
		for (let step = 1; step <= count; step++) {
			const idx = (((base + direction * step) % count) + count) % count;
			const region = this.regions[idx];
			if (this.available(region) && this.activate(region)) {
				return true;
			}
		}
		return false;
	}

	private activate(region: PanelRegion): boolean {
		const ok = region.focus();
		if (ok) {
			const label = region.getLabel?.() ?? { key: region.labelKey };
			this.announce?.(label.key, label.vars);
		}
		return ok;
	}
}

export const panelNavigator = new PanelNavigator();
