// domReconcile.ts — Keyed, focus-preserving reconciliation of a container's children.
//
// Why this exists (and why it matters for accessibility):
// Our panels, lists and toolbars re-render on every authoritative state update the
// server pushes. The naive way — `innerHTML = …` or `replaceChildren(…)` — tears the
// subtree down and rebuilds it, which moves keyboard focus to <body> and makes a
// screen reader (JAWS/NVDA) re-announce everything on every unrelated change. That is
// exactly the "chattiness" and focus-loss we must avoid.
//
// Instead, this single helper reconciles a parent's DIRECT children against a desired
// list of items, matched by a STABLE key:
//   • a survivor (same key) is reused and only mutated where it differs (`update`),
//   • a new item is created (`create`),
//   • a vanished item is removed (and `onRemoved` cleans up any side resource),
//   • the order is fixed up to match `items`.
// The focused element is therefore never destroyed as long as its item survives, so a
// screen reader keeps its place silently. If the element that *did* hold focus is
// removed, `rescueFocus` decides where focus should land — never <body>.
//
// This is the one place the keyed-reconcile + focus-rescue pattern lives, so every
// surgical surface (the players panel, the action toolbar, the manage-properties
// dialog and their per-row toolbars) reads the same way instead of re-implementing it.

export interface ReconcileSpec<T> {
	/** The desired items, in the order they should appear. */
	items: readonly T[];
	/** A stable, unique key per item (e.g. a player id or an action id). */
	key: (item: T) => string;
	/**
	 * The key of an existing child, or null/undefined if the helper does not manage it
	 * (such a child is left untouched — useful when the parent holds other nodes too).
	 */
	keyOf: (el: Element) => string | null | undefined;
	/** Build the element for a brand-new item. */
	create: (item: T) => HTMLElement;
	/** Update a reused element to match its (possibly changed) item. */
	update?: (el: HTMLElement, item: T) => void;
	/** Clean up a side resource (e.g. a description hint) when an element is removed. */
	onRemoved?: (el: HTMLElement) => void;
	/**
	 * Where to send focus when the element that currently holds it is removed and focus
	 * has escaped the parent. Return the element to focus, or null to leave focus alone.
	 * Without this, a removed focused control drops focus to <body> (browse mode).
	 */
	rescueFocus?: (removed: HTMLElement) => HTMLElement | null | undefined;
}

/**
 * Reconcile `parent`'s managed children against `spec.items`, reusing survivors and
 * preserving focus. Returns the managed elements in their final order (handy for callers
 * that keep an array of the current items, e.g. for a roving tabindex).
 */
export function reconcileChildren<T>(parent: HTMLElement, spec: ReconcileSpec<T>): HTMLElement[] {
	const { items, key, keyOf, create, update, onRemoved, rescueFocus } = spec;

	// Note the element that holds focus *before* we touch the DOM, so we can tell whether
	// a later removal stole it.
	const focused = document.activeElement as HTMLElement | null;
	const focusWasInside = !!focused && parent.contains(focused);

	// Index the current managed children by key so survivors can be reused.
	const existing = new Map<string, HTMLElement>();
	for (const child of Array.from(parent.children)) {
		const k = keyOf(child);
		if (k != null) existing.set(k, child as HTMLElement);
	}

	// Reuse or create each item in its desired order, mutating only what changed.
	const ordered: HTMLElement[] = [];
	const desired = new Set<string>();
	let prev: HTMLElement | null = null;
	for (const item of items) {
		const k = key(item);
		desired.add(k);
		let el = existing.get(k);
		if (el) update?.(el, item);
		else el = create(item);

		if (prev) {
			if (prev.nextElementSibling !== el) prev.after(el);
		} else if (parent.firstElementChild !== el) {
			parent.prepend(el);
		}
		prev = el;
		ordered.push(el);
	}

	// Remove the children whose item vanished.
	for (const [k, el] of existing) {
		if (!desired.has(k)) {
			el.remove();
			onRemoved?.(el);
		}
	}

	// If focus was inside the parent and has now escaped (the focused element was removed
	// and nothing nested rescued it), hand it to the caller's fallback so a screen-reader
	// user is never dropped onto <body>.
	if (focusWasInside && focused && rescueFocus) {
		const now = document.activeElement as HTMLElement | null;
		const escaped = !now || now === document.body || !parent.contains(now);
		if (escaped) rescueFocus(focused)?.focus();
	}

	return ordered;
}
